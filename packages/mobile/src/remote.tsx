import {
  createOpenCodeClient,
  createOpenCodeRegistry,
  createOpenCodeServer,
  openCodeServerKey,
  openCodeSessionRef,
  resolveOpenCodeProjectDirectories,
  type OpenCodeClient,
  type OpenCodeRegistry,
  type OpenCodeServerDescriptor,
  type OpenCodeServerKey,
  type OpenCodeSessionInfo,
} from "@honk/opencode";
import { nativeOpenCodeEventSource } from "@honk/opencode/native";
import * as SecureStore from "expo-secure-store";
import * as React from "react";

import {
  RemoteContext,
  type ConnectRemoteInput,
  type RemoteContextValue,
  type RemoteServer,
  type RemoteSession,
  type RemoteStatus,
} from "./remote-context";
import { normalizeRemoteOrigin } from "./pairing";

const REGISTRY_STORAGE_KEY = "honk.mobile.opencode.servers";
const REGISTRY_SCHEMA = "honk.mobile.opencode.servers";
const REGISTRY_VERSION = 1;
const CREDENTIAL_STORAGE_PREFIX = "honk.mobile.opencode.credential.";
const PAGE_SIZE = 100;
const ATTENTION_CONCURRENCY = 6;
const REFRESH_DEBOUNCE_MS = 80;
const RECONNECT_MIN_MS = 750;
const RECONNECT_MAX_MS = 15_000;

interface StoredServer {
  readonly origin: string;
  readonly label: string;
  readonly defaultDirectory: string;
}

interface StoredRegistry {
  readonly schema: typeof REGISTRY_SCHEMA;
  readonly version: typeof REGISTRY_VERSION;
  readonly activeServerKey: string | null;
  readonly servers: readonly StoredServer[];
}

interface StoredCredential {
  readonly origin: string;
  readonly password: string;
}

interface ManagedServer {
  readonly client: OpenCodeClient;
  readonly controller: AbortController;
  refreshTimer: ReturnType<typeof setTimeout> | null;
}

interface RemoteViewState {
  readonly servers: readonly RemoteServer[];
  readonly sessions: readonly RemoteSession[];
  readonly activeServerKey: OpenCodeServerKey | null;
  readonly status: RemoteStatus;
  readonly error: string | null;
}

const INITIAL_VIEW: RemoteViewState = Object.freeze({
  servers: Object.freeze([]),
  sessions: Object.freeze([]),
  activeServerKey: null,
  status: "restoring",
  error: null,
});

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The Honk connection failed.";
}

function errorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const value = Reflect.get(error, "status");
  return typeof value === "number" ? value : null;
}

function connectionFailureStatus(error: unknown): RemoteServer["status"] {
  const status = errorStatus(error);
  return status === 401 || status === 403 ? "unauthorized" : "failed";
}

function serverKeyHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function credentialStorageKey(origin: string): string {
  return `${CREDENTIAL_STORAGE_PREFIX}${serverKeyHash(origin)}`;
}

function decodeStoredRegistry(raw: string | null): StoredRegistry {
  if (raw === null) {
    return {
      schema: REGISTRY_SCHEMA,
      version: REGISTRY_VERSION,
      activeServerKey: null,
      servers: [],
    };
  }
  const value: unknown = JSON.parse(raw);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("The saved Honk server registry is invalid.");
  }
  if (
    Reflect.get(value, "schema") !== REGISTRY_SCHEMA ||
    Reflect.get(value, "version") !== REGISTRY_VERSION
  ) {
    throw new Error("The saved Honk server registry uses an unsupported format.");
  }
  const active = Reflect.get(value, "activeServerKey");
  const servers = Reflect.get(value, "servers");
  if ((active !== null && typeof active !== "string") || !Array.isArray(servers)) {
    throw new Error("The saved Honk server registry is incomplete.");
  }
  const decoded: StoredServer[] = [];
  for (const item of servers) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error("A saved Honk server is invalid.");
    }
    const origin = Reflect.get(item, "origin");
    const label = Reflect.get(item, "label");
    const defaultDirectory = Reflect.get(item, "defaultDirectory");
    if (
      typeof origin !== "string" ||
      typeof label !== "string" ||
      typeof defaultDirectory !== "string"
    ) {
      throw new Error("A saved Honk server is incomplete.");
    }
    decoded.push({
      origin: normalizeRemoteOrigin(origin),
      label: label.trim(),
      defaultDirectory: defaultDirectory.trim(),
    });
  }
  let activeServerKey: string | null = null;
  if (typeof active === "string") {
    try {
      const normalized = normalizeRemoteOrigin(active);
      if (decoded.some((server) => server.origin === normalized)) activeServerKey = normalized;
    } catch {
      activeServerKey = null;
    }
  }
  return {
    schema: REGISTRY_SCHEMA,
    version: REGISTRY_VERSION,
    activeServerKey,
    servers: decoded,
  };
}

async function readCredential(origin: string): Promise<string | null> {
  const raw = await SecureStore.getItemAsync(credentialStorageKey(origin));
  if (raw === null) return null;
  const value: unknown = JSON.parse(raw);
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const savedOrigin = Reflect.get(value, "origin");
  const password = Reflect.get(value, "password");
  return savedOrigin === origin && typeof password === "string" && password.length > 0
    ? password
    : null;
}

async function writeCredential(origin: string, password: string): Promise<void> {
  const value: StoredCredential = { origin, password };
  await SecureStore.setItemAsync(credentialStorageKey(origin), JSON.stringify(value));
}

function waitForReconnect(signal: AbortSignal, delay: number): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(done, delay);
    function done(): void {
      clearTimeout(timeout);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

async function listAllSessions(client: OpenCodeClient): Promise<readonly OpenCodeSessionInfo[]> {
  const sessions: OpenCodeSessionInfo[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await client.sessions.list({
      limit: PAGE_SIZE,
      order: "desc",
      ...(cursor === undefined ? {} : { cursor }),
    });
    sessions.push(...page.data);
    const next = page.cursor?.next;
    if (next === undefined || seenCursors.has(next)) break;
    seenCursors.add(next);
    cursor = next;
  } while (true);
  return sessions;
}

async function loadAttention(
  client: OpenCodeClient,
  sessions: readonly OpenCodeSessionInfo[],
  activeSessions: Readonly<Record<string, unknown>>,
): Promise<ReadonlySet<string>> {
  const attention = new Set<string>();
  const groups = new Map<
    string,
    {
      readonly location: OpenCodeSessionInfo["location"];
      readonly sessionIDs: Set<string>;
    }
  >();
  for (const info of sessions) {
    if (!(info.id in activeSessions)) continue;
    const key = JSON.stringify([info.location.directory, info.location.workspaceID ?? null]);
    const existing = groups.get(key);
    if (existing !== undefined) {
      existing.sessionIDs.add(info.id);
      continue;
    }
    groups.set(key, {
      location: info.location,
      sessionIDs: new Set([info.id]),
    });
  }
  const locations = [...groups.values()];
  let index = 0;

  async function worker(): Promise<void> {
    while (index < locations.length) {
      const group = locations[index];
      index += 1;
      if (group === undefined) continue;
      try {
        const [permissions, questions] = await Promise.all([
          client.requests.permissions(group.location),
          client.requests.questions(group.location),
        ]);
        for (const request of [...permissions.data, ...questions.data]) {
          if (group.sessionIDs.has(request.sessionID)) attention.add(request.sessionID);
        }
      } catch {
        // A temporarily unavailable location queue should not discard the rest of the
        // server's session index.
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(ATTENTION_CONCURRENCY, locations.length) }, () => worker()),
  );
  return attention;
}

function serverDescriptor(stored: StoredServer): OpenCodeServerDescriptor {
  return createOpenCodeServer({
    origin: stored.origin,
    ...(stored.label.length > 0 ? { label: stored.label } : {}),
  });
}

async function pumpManagedServerEvents(
  descriptor: OpenCodeServerDescriptor,
  stored: StoredServer,
  managed: ManagedServer,
  updateServer: (
    descriptor: OpenCodeServerDescriptor,
    stored: StoredServer,
    status: RemoteServer["status"],
    error: string | null,
  ) => void,
  scheduleRefresh: (server: OpenCodeServerKey) => void,
): Promise<void> {
  const signal = managed.controller.signal;
  let retryDelay = RECONNECT_MIN_MS;
  while (!signal.aborted) {
    try {
      for await (const event of managed.client.events(signal)) {
        if (signal.aborted) return;
        retryDelay = RECONNECT_MIN_MS;
        updateServer(descriptor, stored, "live", null);
        const eventType: string = event.type;
        if (eventType !== "server.heartbeat") scheduleRefresh(descriptor.key);
      }
      if (signal.aborted) return;
    } catch (error) {
      if (signal.aborted) return;
      const status = connectionFailureStatus(error);
      updateServer(
        descriptor,
        stored,
        status === "unauthorized" ? status : "reconnecting",
        errorMessage(error),
      );
      if (status === "unauthorized") return;
    }
    await waitForReconnect(signal, retryDelay);
    retryDelay = Math.min(retryDelay * 2, RECONNECT_MAX_MS);
  }
}

export function RemoteProvider({ children }: React.PropsWithChildren): React.ReactElement {
  const [registry] = React.useState<OpenCodeRegistry>(createOpenCodeRegistry);
  const [view, setView] = React.useState<RemoteViewState>(INITIAL_VIEW);
  const mountedRef = React.useRef(true);
  const restoringRef = React.useRef(true);
  const storedRef = React.useRef(new Map<OpenCodeServerKey, StoredServer>());
  const serverStateRef = React.useRef(new Map<OpenCodeServerKey, RemoteServer>());
  const sessionsRef = React.useRef(new Map<OpenCodeServerKey, readonly RemoteSession[]>());
  const managedRef = React.useRef(new Map<OpenCodeServerKey, ManagedServer>());
  const activeServerKeyRef = React.useRef<OpenCodeServerKey | null>(null);

  const publish = React.useCallback((error: string | null = null): void => {
    if (!mountedRef.current) return;
    const servers = [...serverStateRef.current.values()];
    const activeServerKey = activeServerKeyRef.current;
    const activeServer =
      activeServerKey === null ? undefined : serverStateRef.current.get(activeServerKey);
    const status: RemoteStatus = restoringRef.current
      ? "restoring"
      : servers.length === 0
        ? "disconnected"
        : (activeServer?.status ?? "failed");
    const sessions = [...sessionsRef.current.values()]
      .flat()
      .sort((left, right) => right.info.time.updated - left.info.time.updated);
    setView({
      servers: Object.freeze(servers),
      sessions: Object.freeze(sessions),
      activeServerKey,
      status,
      error,
    });
  }, []);

  const persistRegistry = React.useCallback(async (): Promise<void> => {
    const value: StoredRegistry = {
      schema: REGISTRY_SCHEMA,
      version: REGISTRY_VERSION,
      activeServerKey: activeServerKeyRef.current,
      servers: [...storedRef.current.values()],
    };
    await SecureStore.setItemAsync(REGISTRY_STORAGE_KEY, JSON.stringify(value));
  }, []);

  const updateServer = React.useCallback(
    (
      descriptor: OpenCodeServerDescriptor,
      stored: StoredServer,
      status: RemoteServer["status"],
      error: string | null,
    ): void => {
      serverStateRef.current.set(descriptor.key, {
        descriptor,
        defaultDirectory: stored.defaultDirectory,
        status,
        error,
      });
      publish(error);
    },
    [publish],
  );

  const refreshServer = React.useCallback(
    async (server: OpenCodeServerKey): Promise<void> => {
      const client = registry.get(server);
      if (client === null) return;
      const [infos, active] = await Promise.all([
        listAllSessions(client),
        client.sessions.active(),
      ]);
      const [attention, projectDirectories] = await Promise.all([
        loadAttention(client, infos, active),
        resolveOpenCodeProjectDirectories(client, infos),
      ]);
      const rows = infos.map<RemoteSession>((info) => ({
        ref: openCodeSessionRef(server, info.id),
        server: client.server,
        info,
        projectDirectory: projectDirectories.get(info.projectID) ?? info.location.directory,
        status: active[info.id] === undefined ? "idle" : "running",
        needsAttention: attention.has(info.id),
      }));
      sessionsRef.current.set(server, Object.freeze(rows));
      publish();
    },
    [publish, registry],
  );

  const scheduleRefresh = React.useCallback(
    (server: OpenCodeServerKey): void => {
      const managed = managedRef.current.get(server);
      if (managed === undefined || managed.refreshTimer !== null) return;
      managed.refreshTimer = setTimeout(() => {
        managed.refreshTimer = null;
        void refreshServer(server).catch((error: unknown) => publish(errorMessage(error)));
      }, REFRESH_DEBOUNCE_MS);
    },
    [publish, refreshServer],
  );

  const pumpEvents = React.useCallback(
    (
      descriptor: OpenCodeServerDescriptor,
      stored: StoredServer,
      managed: ManagedServer,
    ): Promise<void> =>
      pumpManagedServerEvents(descriptor, stored, managed, updateServer, scheduleRefresh),
    [scheduleRefresh, updateServer],
  );

  const stopManaged = React.useCallback(
    (server: OpenCodeServerKey): void => {
      const managed = managedRef.current.get(server);
      if (managed !== undefined) {
        managed.controller.abort();
        if (managed.refreshTimer !== null) clearTimeout(managed.refreshTimer);
        managedRef.current.delete(server);
      }
      registry.disconnect(server);
    },
    [registry],
  );

  const connectManaged = React.useCallback(
    async (stored: StoredServer, password: string): Promise<OpenCodeServerDescriptor> => {
      const descriptor = serverDescriptor(stored);
      stopManaged(descriptor.key);
      updateServer(descriptor, stored, "connecting", null);
      const client = createOpenCodeClient(descriptor, {
        password,
        eventSource: nativeOpenCodeEventSource,
      });
      try {
        await client.health();
        registry.register(client);
        const managed: ManagedServer = {
          client,
          controller: new AbortController(),
          refreshTimer: null,
        };
        managedRef.current.set(descriptor.key, managed);
        updateServer(descriptor, stored, "live", null);
        await refreshServer(descriptor.key);
        void pumpEvents(descriptor, stored, managed);
        return descriptor;
      } catch (error) {
        client.close();
        registry.disconnect(descriptor.key);
        updateServer(descriptor, stored, connectionFailureStatus(error), errorMessage(error));
        throw error;
      }
    },
    [pumpEvents, refreshServer, registry, stopManaged, updateServer],
  );

  React.useEffect(() => {
    mountedRef.current = true;
    void (async () => {
      try {
        const saved = decodeStoredRegistry(await SecureStore.getItemAsync(REGISTRY_STORAGE_KEY));
        for (const stored of saved.servers) {
          const descriptor = serverDescriptor(stored);
          storedRef.current.set(descriptor.key, stored);
          serverStateRef.current.set(descriptor.key, {
            descriptor,
            defaultDirectory: stored.defaultDirectory,
            status: "connecting",
            error: null,
          });
        }
        const requestedActive =
          saved.activeServerKey === null ? null : openCodeServerKey(saved.activeServerKey);
        activeServerKeyRef.current =
          requestedActive !== null && storedRef.current.has(requestedActive)
            ? requestedActive
            : (storedRef.current.keys().next().value ?? null);
        publish();

        await Promise.all(
          [...storedRef.current.entries()].map(async ([server, stored]) => {
            const password = await readCredential(stored.origin);
            if (password === null) {
              const descriptor = serverDescriptor(stored);
              updateServer(
                descriptor,
                stored,
                "unauthorized",
                "This server's device credential is missing.",
              );
              return;
            }
            try {
              await connectManaged(stored, password);
            } catch {
              // connectManaged publishes the per-server failure without exposing the credential.
            }
            if (!storedRef.current.has(server)) stopManaged(server);
          }),
        );
      } catch (error) {
        publish(errorMessage(error));
      }
      restoringRef.current = false;
      publish();
    })();

    return () => {
      mountedRef.current = false;
      restoringRef.current = false;
      for (const managed of managedRef.current.values()) {
        managed.controller.abort();
        if (managed.refreshTimer !== null) clearTimeout(managed.refreshTimer);
      }
      managedRef.current.clear();
      registry.close();
    };
  }, [connectManaged, publish, registry, stopManaged, updateServer]);

  const connect = React.useCallback(
    async (input: ConnectRemoteInput): Promise<void> => {
      const origin = normalizeRemoteOrigin(input.origin);
      const stored: StoredServer = {
        origin,
        label: input.label?.trim() ?? "",
        defaultDirectory: input.defaultDirectory.trim(),
      };
      const descriptor = await connectManaged(stored, input.password);
      try {
        await writeCredential(origin, input.password);
        storedRef.current.set(descriptor.key, stored);
        activeServerKeyRef.current = descriptor.key;
        await persistRegistry();
        publish();
      } catch (error) {
        stopManaged(descriptor.key);
        serverStateRef.current.delete(descriptor.key);
        sessionsRef.current.delete(descriptor.key);
        publish(errorMessage(error));
        throw error;
      }
    },
    [connectManaged, persistRegistry, publish, stopManaged],
  );

  const retry = React.useCallback(
    async (requested?: OpenCodeServerKey): Promise<void> => {
      const server = requested ?? activeServerKeyRef.current;
      if (server === null) return;
      const stored = storedRef.current.get(server);
      if (stored === undefined) return;
      const password = await readCredential(stored.origin);
      if (password === null) {
        updateServer(
          serverDescriptor(stored),
          stored,
          "unauthorized",
          "This server's device credential is missing.",
        );
        return;
      }
      await connectManaged(stored, password);
    },
    [connectManaged, updateServer],
  );

  const refreshSessions = React.useCallback(
    async (requested?: OpenCodeServerKey): Promise<void> => {
      if (requested !== undefined) {
        await refreshServer(requested);
        return;
      }
      await Promise.all([...managedRef.current.keys()].map((server) => refreshServer(server)));
    },
    [refreshServer],
  );

  const disconnect = React.useCallback(
    async (requested?: OpenCodeServerKey): Promise<void> => {
      const server = requested ?? activeServerKeyRef.current;
      if (server === null) return;
      const stored = storedRef.current.get(server);
      if (stored === undefined) return;

      // Credential deletion is deliberately first and local-only, so disconnect succeeds offline
      // without leaving a reusable device secret behind.
      await SecureStore.deleteItemAsync(credentialStorageKey(stored.origin));
      stopManaged(server);
      storedRef.current.delete(server);
      serverStateRef.current.delete(server);
      sessionsRef.current.delete(server);
      if (activeServerKeyRef.current === server) {
        activeServerKeyRef.current = storedRef.current.keys().next().value ?? null;
      }
      await persistRegistry();
      publish();
    },
    [persistRegistry, publish, stopManaged],
  );

  const setDefaultDirectory = React.useCallback(
    async (server: OpenCodeServerKey, directory: string): Promise<void> => {
      const stored = storedRef.current.get(server);
      if (stored === undefined) return;
      const next: StoredServer = { ...stored, defaultDirectory: directory.trim() };
      storedRef.current.set(server, next);
      const current = serverStateRef.current.get(server);
      if (current !== undefined) {
        serverStateRef.current.set(server, {
          ...current,
          defaultDirectory: next.defaultDirectory,
        });
      }
      await persistRegistry();
      publish();
    },
    [persistRegistry, publish],
  );

  const selectServer = React.useCallback(
    (server: OpenCodeServerKey): void => {
      if (!storedRef.current.has(server)) return;
      activeServerKeyRef.current = server;
      publish();
      void persistRegistry().catch((error: unknown) => publish(errorMessage(error)));
    },
    [persistRegistry, publish],
  );

  const activeServer =
    view.activeServerKey === null
      ? null
      : (view.servers.find((server) => server.descriptor.key === view.activeServerKey) ?? null);
  const value: RemoteContextValue = {
    ...view,
    activeServer,
    client: view.activeServerKey === null ? null : registry.get(view.activeServerKey),
    hasCredential: view.servers.length > 0,
    clientFor: (server) => registry.get(server),
    selectServer,
    connect,
    retry,
    refreshSessions,
    disconnect,
    setDefaultDirectory,
  };

  return <RemoteContext.Provider value={value}>{children}</RemoteContext.Provider>;
}
