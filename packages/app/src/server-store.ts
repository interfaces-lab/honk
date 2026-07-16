import {
  createOpenCodeClient,
  createOpenCodeServer,
  exchangeHonkPairing,
  normalizeRemoteOpenCodeOrigin,
  parseOpenCodeConnection,
  type OpenCodeClient,
  type OpenCodeServerDescriptor,
  type OpenCodeServerKey,
} from "@honk/opencode";
import { decodeJsonResult } from "@honk/shared/schema-json";
import { Option, Result, Schema } from "effect";
import { useSyncExternalStore } from "react";

import {
  getSnapshot as getConnectionSnapshot,
  subscribe as subscribeConnection,
} from "./connection-store";
import {
  canPersistRemoteCredential,
  protectRemoteCredential,
  revealRemoteCredential,
} from "./desktop-bridge";
import { actions as tabActions } from "./tab-store";
import {
  getOpenCodeClient,
  getOpenCodeServersSnapshot,
  registerOpenCodeClient,
  selectOpenCodeServer,
  subscribeOpenCodeServers,
  unregisterOpenCodeClient,
  type AdapterWatchStatus,
} from "./watch-registry";

const STORAGE_KEY = "honk:opencode:servers";
const STORAGE_VERSION = 1;

type StoredRemoteServer = {
  readonly origin: string;
  readonly label: string;
  readonly protectedCredential: string | null;
};

type StoredRemoteRegistry = {
  readonly version: typeof STORAGE_VERSION;
  readonly selectedRemoteOrigin: string | null;
  readonly servers: readonly StoredRemoteServer[];
};

const StoredRemoteServerSchema = Schema.Struct({
  origin: Schema.String,
  label: Schema.String,
  protectedCredential: Schema.NullOr(Schema.String),
});

const StoredRemoteRegistrySchema = Schema.Struct({
  version: Schema.Literal(STORAGE_VERSION),
  // Kept lenient (Unknown) so a malformed selectedRemoteOrigin never discards
  // otherwise-valid servers; the value is validated separately below.
  selectedRemoteOrigin: Schema.optionalKey(Schema.Unknown),
  // Only the array shape is enforced here; entries are decoded per-element so a
  // single bad entry is skipped rather than rejecting the whole registry.
  servers: Schema.Array(Schema.Unknown),
});

const SelectedRemoteOriginSchema = Schema.NullOr(Schema.String);

const decodeStoredRegistryJson = decodeJsonResult(StoredRemoteRegistrySchema);
const decodeStoredRemoteServer = Schema.decodeUnknownOption(StoredRemoteServerSchema);
const decodeSelectedRemoteOrigin = Schema.decodeUnknownOption(SelectedRemoteOriginSchema);

type RemoteServerStatus = AdapterWatchStatus | "credential-missing" | "failed";

type RemoteServerState = {
  readonly record: StoredRemoteServer;
  readonly descriptor: OpenCodeServerDescriptor;
  readonly client: OpenCodeClient | null;
  readonly status: RemoteServerStatus;
  readonly error: string | null;
};

export type OpenCodeServerConnection = {
  readonly server: OpenCodeServerDescriptor;
  readonly status: RemoteServerStatus;
  readonly selected: boolean;
  readonly removable: boolean;
  readonly persistent: boolean;
  readonly error: string | null;
};

export type OpenCodeServerConnectionsSnapshot = {
  readonly servers: readonly OpenCodeServerConnection[];
  readonly restoring: boolean;
};

export type ConnectOpenCodeServerInput = {
  readonly origin: string;
  readonly credential: string;
  readonly label?: string;
};

const EMPTY_SNAPSHOT: OpenCodeServerConnectionsSnapshot = Object.freeze({
  servers: Object.freeze([]),
  restoring: false,
});

const listeners = new Set<() => void>();
const memoryCredentials = new Map<OpenCodeServerKey, string>();
const restored = hydrateRegistry();
const remoteStates = new Map<OpenCodeServerKey, RemoteServerState>(
  restored.servers.map((record) => {
    const descriptor = descriptorFromRecord(record);
    return [
      descriptor.key,
      {
        record,
        descriptor,
        client: null,
        status: record.protectedCredential === null ? "credential-missing" : "connecting",
        error:
          record.protectedCredential === null
            ? "Reconnect this server to restore its device credential."
            : null,
      },
    ];
  }),
);
let selectedRemote =
  restored.selectedRemoteOrigin === null
    ? null
    : createOpenCodeServer({ origin: restored.selectedRemoteOrigin }).key;
let restoring = remoteStates.size > 0;
let restoreStarted = false;
let restoreInstalled = false;
let selectingPersistedServer = false;
let snapshot = projectSnapshot();

subscribeOpenCodeServers(() => {
  const selected = selectedRemote;
  const watched = getOpenCodeServersSnapshot().servers;
  if (
    selected !== null &&
    !selectingPersistedServer &&
    watched.some((item) => item.server.key === selected && !item.selected)
  ) {
    selectingPersistedServer = true;
    try {
      selectOpenCodeServer(selected);
    } finally {
      selectingPersistedServer = false;
    }
  }
  publish();
});

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): OpenCodeServerConnectionsSnapshot {
  return snapshot;
}

export function getServerSnapshot(): OpenCodeServerConnectionsSnapshot {
  return EMPTY_SNAPSHOT;
}

export function useOpenCodeServerConnections(): OpenCodeServerConnectionsSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function installRemoteServerRestore(): void {
  if (restoreInstalled) return;
  restoreInstalled = true;
  const startWhenReady = (): void => {
    if (getConnectionSnapshot().status === "authenticated") void restoreRemoteServers();
  };
  subscribeConnection(startWhenReady);
  startWhenReady();
}

export const actions = {
  async connect(input: ConnectOpenCodeServerInput): Promise<void> {
    const candidate = parseOpenCodeConnection(input.credential, input.origin);
    if (candidate === null) {
      throw new Error("Enter a server address and its pairing link or device password.");
    }
    const candidateOrigin = normalizeRemoteOpenCodeOrigin(candidate.origin);
    const connection =
      candidate.credential.type === "pairing"
        ? await exchangeHonkPairing(candidateOrigin, candidate.credential.value, {
            label: "Honk desktop",
          })
        : { origin: candidateOrigin, password: candidate.credential.value };
    const origin = normalizeRemoteOpenCodeOrigin(connection.origin);
    const label = input.label?.trim() ?? "";
    const descriptor = createOpenCodeServer({
      origin,
      ...(label.length > 0 ? { label } : {}),
      kind: "remote",
    });
    const existingClient = getOpenCodeClient(descriptor.key);
    const existingState = remoteStates.get(descriptor.key);
    if (existingClient !== null && existingState?.client !== existingClient) {
      throw new Error("This OpenCode server is already managed by the current desktop session.");
    }

    const draftRecord: StoredRemoteServer = {
      origin,
      label,
      protectedCredential: existingState?.record.protectedCredential ?? null,
    };
    const connected = await connectRecord(draftRecord, connection.password);

    let protectedCredential = existingState?.record.protectedCredential ?? null;
    let persistenceError: string | null = null;
    if (canPersistRemoteCredential()) {
      try {
        protectedCredential = await protectRemoteCredential(connection.password);
      } catch (cause) {
        persistenceError = messageOf(cause, "This server is connected for this launch only.");
      }
    }

    const record: StoredRemoteServer = { ...draftRecord, protectedCredential };
    const nextState: RemoteServerState = {
      ...connected,
      record,
      error: persistenceError,
    };
    remoteStates.set(descriptor.key, nextState);
    memoryCredentials.set(descriptor.key, connection.password);
    selectedRemote = descriptor.key;
    tabActions.registerServer(descriptor);
    selectOpenCodeServer(descriptor.key);
    const registryError = persistRegistry();
    if (registryError !== null && persistenceError === null) {
      remoteStates.set(descriptor.key, {
        ...nextState,
        error: registryError,
      });
    }
    publish();
  },

  async retry(server: OpenCodeServerKey): Promise<void> {
    const state = remoteStates.get(server);
    if (state === undefined) return;
    let credential = memoryCredentials.get(server) ?? null;
    if (credential === null && state.record.protectedCredential !== null) {
      try {
        credential = await revealRemoteCredential(state.record.protectedCredential);
      } catch (cause) {
        updateRemoteState(server, {
          client: null,
          status: "failed",
          error: messageOf(cause, "The saved device credential could not be decrypted."),
        });
        return;
      }
    }
    if (credential === null || credential.length === 0) {
      updateRemoteState(server, {
        client: null,
        status: "credential-missing",
        error: "Reconnect this server to restore its device credential.",
      });
      return;
    }
    const connected = await connectRecord(state.record, credential);
    remoteStates.set(server, connected);
    memoryCredentials.set(server, credential);
    tabActions.registerServer(connected.descriptor);
    if (selectedRemote === server) selectOpenCodeServer(server);
    publish();
  },

  select(server: OpenCodeServerKey): void {
    if (!selectOpenCodeServer(server)) return;
    selectedRemote = remoteStates.has(server) ? server : null;
    persistRegistry();
    publish();
  },

  remove(server: OpenCodeServerKey): void {
    const state = remoteStates.get(server);
    if (state === undefined) return;
    stopRemoteState(state);
    remoteStates.delete(server);
    memoryCredentials.delete(server);
    tabActions.removeServer(server);
    if (selectedRemote === server) {
      selectedRemote = null;
      const fallback = getOpenCodeServersSnapshot().servers.find(
        (item) => !remoteStates.has(item.server.key),
      );
      if (fallback !== undefined) selectOpenCodeServer(fallback.server.key);
    }
    persistRegistry();
    publish();
  },
} as const;

async function restoreRemoteServers(): Promise<void> {
  if (restoreStarted) return;
  restoreStarted = true;
  restoring = true;
  publish();
  await Promise.all(
    [...remoteStates.entries()].map(async ([server, state]) => {
      const protectedCredential = state.record.protectedCredential;
      if (protectedCredential === null) return;
      try {
        const credential = await revealRemoteCredential(protectedCredential);
        if (credential === null || credential.length === 0) {
          updateRemoteState(server, {
            client: null,
            status: "credential-missing",
            error: "Reconnect this server to restore its device credential.",
          });
          return;
        }
        const connected = await connectRecord(state.record, credential);
        remoteStates.set(server, connected);
        memoryCredentials.set(server, credential);
        tabActions.registerServer(connected.descriptor);
      } catch (cause) {
        updateRemoteState(server, {
          client: null,
          status: "failed",
          error: messageOf(cause, "The remote OpenCode server could not be restored."),
        });
      }
    }),
  );
  restoring = false;
  if (selectedRemote !== null && getOpenCodeClient(selectedRemote) !== null) {
    selectOpenCodeServer(selectedRemote);
  }
  publish();
}

async function connectRecord(
  record: StoredRemoteServer,
  credential: string,
): Promise<RemoteServerState> {
  const descriptor = descriptorFromRecord(record);
  updateRemoteState(descriptor.key, {
    client: remoteStates.get(descriptor.key)?.client ?? null,
    status: "connecting",
    error: null,
  });
  const client = createOpenCodeClient(descriptor, { password: credential });
  try {
    await client.health();
  } catch (cause) {
    client.close();
    updateRemoteState(descriptor.key, {
      client: null,
      status: "failed",
      error: messageOf(cause, "The remote OpenCode server could not be reached."),
    });
    throw cause;
  }

  const previous = remoteStates.get(descriptor.key);
  if (previous !== undefined) stopRemoteState(previous);
  registerOpenCodeClient(client);
  return {
    record,
    descriptor,
    client,
    status: "live",
    error: null,
  };
}

function stopRemoteState(state: RemoteServerState): void {
  if (state.client === null) return;
  unregisterOpenCodeClient(state.descriptor.key);
  state.client.close();
}

function updateRemoteState(
  server: OpenCodeServerKey,
  update: Pick<RemoteServerState, "client" | "status" | "error">,
): void {
  const current = remoteStates.get(server);
  if (current === undefined) return;
  remoteStates.set(server, { ...current, ...update });
  publish();
}

function projectSnapshot(): OpenCodeServerConnectionsSnapshot {
  const watched = getOpenCodeServersSnapshot();
  const watchedKeys = new Set(watched.servers.map((item) => item.server.key));
  const connections: OpenCodeServerConnection[] = watched.servers.map((item) => {
    const remote = remoteStates.get(item.server.key);
    return Object.freeze({
      server: remote?.descriptor ?? item.server,
      status: item.status,
      selected: item.selected,
      removable: remote !== undefined,
      persistent: remote !== undefined && remote.record.protectedCredential !== null,
      error: remote?.error ?? null,
    });
  });
  for (const [server, remote] of remoteStates) {
    if (watchedKeys.has(server)) continue;
    connections.push(
      Object.freeze({
        server: remote.descriptor,
        status: remote.status,
        selected: false,
        removable: true,
        persistent: remote.record.protectedCredential !== null,
        error: remote.error,
      }),
    );
  }
  return Object.freeze({ servers: Object.freeze(connections), restoring });
}

function publish(): void {
  snapshot = projectSnapshot();
  for (const listener of listeners) listener();
}

function descriptorFromRecord(record: StoredRemoteServer): OpenCodeServerDescriptor {
  return createOpenCodeServer({
    origin: record.origin,
    ...(record.label.length > 0 ? { label: record.label } : {}),
    kind: "remote",
  });
}

function hydrateRegistry(): StoredRemoteRegistry {
  if (typeof window === "undefined") return emptyRegistry();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return emptyRegistry();
    const parsed = decodeStoredRegistryJson(raw);
    if (Result.isFailure(parsed)) return emptyRegistry();
    const registry = parsed.success;

    const servers: StoredRemoteServer[] = [];
    for (const item of registry.servers) {
      const decoded = decodeStoredRemoteServer(item);
      if (Option.isNone(decoded)) continue;
      const entry = decoded.value;
      try {
        servers.push({
          origin: normalizeRemoteOpenCodeOrigin(entry.origin),
          label: entry.label.trim(),
          protectedCredential: entry.protectedCredential,
        });
      } catch {
        // Ignore malformed persisted entries without discarding the remaining registry.
      }
    }

    const selectedOption = decodeSelectedRemoteOrigin(registry.selectedRemoteOrigin);
    const selected = Option.isNone(selectedOption) ? null : selectedOption.value;
    let selectedRemoteOrigin: string | null = null;
    if (typeof selected === "string") {
      try {
        const normalized = normalizeRemoteOpenCodeOrigin(selected);
        if (servers.some((server) => server.origin === normalized)) {
          selectedRemoteOrigin = normalized;
        }
      } catch {
        selectedRemoteOrigin = null;
      }
    }

    return {
      version: STORAGE_VERSION,
      selectedRemoteOrigin,
      servers,
    };
  } catch {
    return emptyRegistry();
  }
}

function emptyRegistry(): StoredRemoteRegistry {
  return { version: STORAGE_VERSION, selectedRemoteOrigin: null, servers: [] };
}

function persistRegistry(): string | null {
  if (typeof window === "undefined") return null;
  const value: StoredRemoteRegistry = {
    version: STORAGE_VERSION,
    selectedRemoteOrigin:
      selectedRemote === null ? null : (remoteStates.get(selectedRemote)?.record.origin ?? null),
    servers: [...remoteStates.values()].map((state) => state.record),
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    return null;
  } catch (cause) {
    return messageOf(cause, "The server registry could not be saved.");
  }
}

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim().length > 0 ? cause.message : fallback;
}
