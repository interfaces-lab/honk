import {
  cancelHonkPairing,
  confirmHonkPairing,
  createOpenCodeClient,
  createOpenCodeRegistry,
  createOpenCodeServer,
  exchangeHonkPairing,
  openCodeServerKey,
  openCodeSessionRef,
  probeHonkServerIdentity,
  resolveOpenCodeProjectDirectories,
  verifyHonkServerIdentity,
  type OpenCodeClient,
  type OpenCodeEvent,
  type OpenCodeRegistry,
  type OpenCodeServerDescriptor,
  type OpenCodeServerKey,
  type OpenCodeSessionInfo,
} from "@honk/opencode";
import { nativeOpenCodeEventSource } from "@honk/opencode/native";
import { CryptoDigestAlgorithm, digest, randomUUID } from "expo-crypto";
import * as Network from "expo-network";
import * as SecureStore from "expo-secure-store";
import * as React from "react";
import { AppState } from "react-native";

import {
  RemoteContext,
  type ConnectRemoteInput,
  type PairingOutcome,
  type PairRemoteInput,
  type RemoteContextValue,
  type RemoteServer,
  type RemoteSession,
  type RemoteStatus,
} from "./remote-context";
import {
  beginPairingAdoption,
  decodePairingAdoption,
  removePairingAdoption,
  resumePairingAdoption,
  type PairingAdoptionOperations,
  type PendingPairingAdoption,
} from "./pairing-adoption";
import { pairingServer } from "./pairing-server";
import {
  beginConnectionAttempt,
  invalidateConnectionAttempt,
  isCurrentConnectionAttempt,
  probeConnectionCandidate,
} from "./connection-attempt";
import {
  mobileApplicationActiveWakeup,
  superviseMobileConnection,
  type MobileApplicationActiveWakeup,
  type SupervisedConnectionState,
} from "./connection-supervisor";
import {
  MOBILE_EVENT_HEARTBEAT_TIMEOUT_MS,
  readConnectionEvent,
} from "./connection-event-watchdog";
import {
  createBoundedConnectionFetch,
  createConnectionAttemptFetch,
  runWithConnectionDeadline,
  runWithConnectionRequestDeadline,
} from "./connection-request";
import { normalizeRemoteOrigin } from "./pairing";
import {
  persistSavedConnectionCandidate,
  resolveSavedConnectionTransaction,
  type SavedConnectionTransaction,
} from "./saved-connection-persistence";
import { persistSavedConnectionRemoval } from "./saved-connection-removal";
import {
  credentialStorageKey,
  decodeStoredRegistry,
  findRebindableServer,
  sameStoredRegistry,
  storedRegistry,
  storedServerMap,
  type StoredRegistry,
  type StoredServer,
} from "./server-registry-store";
import { createServerStorageQueue } from "./server-storage-queue";
import {
  persistSessionCacheServer,
  readSessionCache,
  writeSessionCache,
} from "./session-cache-storage";
import {
  EMPTY_SESSION_CACHE,
  mergeSessionCacheServer,
  removeSessionCacheServer,
  replaceSessionCacheServer,
} from "./session-cache-store";

const REGISTRY_STORAGE_KEY = "honk.mobile.opencode.servers";
const CONNECTION_TRANSACTION_STORAGE_KEY = "honk.mobile.opencode.connection-transaction";
const CONNECTION_TRANSACTION_SCHEMA = "honk.mobile.opencode.connection-transaction";
const CONNECTION_TRANSACTION_VERSION = 1;
const PENDING_PAIRING_STORAGE_KEY = "honk.mobile.opencode.pending-pairing";
const PAGE_SIZE = 100;
const ATTENTION_CONCURRENCY = 6;
const REFRESH_DEBOUNCE_MS = 80;
// A failed proof cannot tell "another computer took this address" apart from "this computer is
// unreachable right now", so the copy states only what is certain and what Honk did about it.
const UNVERIFIED_IDENTITY_MESSAGE =
  "Honk could not confirm this is the same computer, so it did not send your saved password.";
const UNAVAILABLE_IDENTITY_MESSAGE =
  "Honk can’t verify this computer yet. It will keep trying without sending your saved password.";
// expo-crypto exposes a digest but no HMAC, so the shared RFC 2104 construction runs over it. The
// copy narrows the caller's ArrayBufferLike-backed view to the ArrayBuffer-backed BufferSource
// expo-crypto declares.
const sha256 = async (bytes: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, new Uint8Array(bytes)));
const STREAMING_EVENT_TYPES = new Set([
  "message.part.updated",
  "message.part.delta",
  "session.next.text.delta",
  "session.next.reasoning.delta",
  "session.next.tool.input.delta",
  "session.next.tool.progress",
  "session.next.compaction.delta",
]);

interface StoredCredential {
  readonly origin: string;
  readonly password: string;
}

interface StoredConnectionTransaction {
  readonly schema: typeof CONNECTION_TRANSACTION_SCHEMA;
  readonly version: typeof CONNECTION_TRANSACTION_VERSION;
  readonly origin: string;
  readonly target: "candidate" | "previous";
  readonly previousPassword: string | null;
  readonly nextPassword: string;
  readonly previousRegistry: StoredRegistry;
  readonly candidateRegistry: StoredRegistry;
}

interface ManagedServer {
  readonly client: OpenCodeClient;
  readonly controller: AbortController;
  lifetime: Promise<"disconnected" | "stopped" | "unauthorized"> | null;
  refreshTimer: ReturnType<typeof setTimeout> | null;
  sawHeartbeat: boolean;
}

type SavedServerWakeup = MobileApplicationActiveWakeup | "availability-changed";

class StaleConnectionAttemptError extends Error {
  constructor() {
    super("This connection attempt was replaced by a newer one.");
    this.name = "StaleConnectionAttemptError";
  }
}

class ServerIdentityMismatchError extends Error {
  constructor() {
    super(UNVERIFIED_IDENTITY_MESSAGE);
    this.name = "ServerIdentityMismatchError";
  }
}

class ServerIdentityUnavailableError extends Error {
  constructor() {
    super(UNAVAILABLE_IDENTITY_MESSAGE);
    this.name = "ServerIdentityUnavailableError";
  }
}

class ManagedCredentialUpgradeRequiredError extends Error {
  constructor() {
    super("Remote access setup is not finished yet. This computer is still saved on your phone.");
    this.name = "ManagedCredentialUpgradeRequiredError";
  }
}

class ServerEventStreamDisconnectedError extends Error {
  readonly resetBackoff: boolean;

  constructor(resetBackoff: boolean) {
    super("The live connection closed. Honk is reconnecting.");
    this.name = "ServerEventStreamDisconnectedError";
    this.resetBackoff = resetBackoff;
  }
}

class ServerAuthorizationError extends Error {
  readonly status = 401;

  constructor() {
    super("This computer no longer accepts the saved access.");
    this.name = "ServerAuthorizationError";
  }
}

interface RemoteViewState {
  readonly servers: readonly RemoteServer[];
  readonly sessions: readonly RemoteSession[];
  readonly activeServerKey: OpenCodeServerKey | null;
  readonly status: RemoteStatus;
  readonly error: string | null;
  readonly pendingPairing: {
    readonly origin: string;
    readonly rebindOrigin: string | null;
    readonly requestId: string;
    readonly computerName: string;
    readonly status: "requesting" | "confirming" | "removing";
  } | null;
  readonly pairingOutcome: PairingOutcome | null;
}

const INITIAL_VIEW: RemoteViewState = Object.freeze({
  servers: Object.freeze([]),
  sessions: Object.freeze([]),
  activeServerKey: null,
  status: "restoring",
  error: null,
  pendingPairing: null,
  pairingOutcome: null,
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
  if (error instanceof ManagedCredentialUpgradeRequiredError) return "remote-setup";
  const status = errorStatus(error);
  return status === 401 || status === 403 ? "unauthorized" : "failed";
}

function isBlockedConnectionFailure(error: unknown): boolean {
  return (
    error instanceof ManagedCredentialUpgradeRequiredError ||
    error instanceof ServerIdentityMismatchError ||
    connectionFailureStatus(error) === "unauthorized"
  );
}

function connectionLifetimeController(signal?: AbortSignal): AbortController {
  const controller = new AbortController();
  const abort = (): void => controller.abort(signal?.reason);
  if (signal?.aborted === true) {
    abort();
  } else {
    signal?.addEventListener("abort", abort, { once: true });
  }
  controller.signal.addEventListener("abort", () => signal?.removeEventListener("abort", abort), {
    once: true,
  });
  return controller;
}

function isActiveConnectionAttempt(isCurrent: () => boolean, signal?: AbortSignal): boolean {
  return isCurrent() && signal?.aborted !== true;
}

function runPairingRequest<Result>(
  ownerSignal: AbortSignal,
  operation: (request: typeof fetch, signal: AbortSignal) => Promise<Result>,
): Promise<Result> {
  return runWithConnectionRequestDeadline(ownerSignal, (signal) =>
    operation(createConnectionAttemptFetch({ signal }), signal),
  );
}

function mobileNetworkStatus(state: Network.NetworkState): "offline" | "online" | "unknown" {
  if (state.isConnected === false) return "offline";
  if (state.isConnected === true) return "online";
  return "unknown";
}

function decodeSavedConnectionTransaction(
  raw: string | null,
): SavedConnectionTransaction<OpenCodeServerKey, StoredServer> | null {
  if (raw === null) return null;
  const value: unknown = JSON.parse(raw);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("The unfinished saved connection record is invalid.");
  }
  const origin = Reflect.get(value, "origin");
  const target = Reflect.get(value, "target");
  const previousPassword = Reflect.get(value, "previousPassword");
  const nextPassword = Reflect.get(value, "nextPassword");
  const previousRegistryValue = Reflect.get(value, "previousRegistry");
  const candidateRegistryValue = Reflect.get(value, "candidateRegistry");
  if (
    Reflect.get(value, "schema") !== CONNECTION_TRANSACTION_SCHEMA ||
    Reflect.get(value, "version") !== CONNECTION_TRANSACTION_VERSION ||
    typeof origin !== "string" ||
    (target !== "candidate" && target !== "previous") ||
    (previousPassword !== null &&
      (typeof previousPassword !== "string" || previousPassword.length === 0)) ||
    typeof nextPassword !== "string" ||
    nextPassword.length === 0 ||
    typeof previousRegistryValue !== "object" ||
    previousRegistryValue === null ||
    typeof candidateRegistryValue !== "object" ||
    candidateRegistryValue === null
  ) {
    throw new Error("The unfinished saved connection record is incomplete.");
  }
  const normalizedOrigin = normalizeRemoteOrigin(origin);
  const serverKey = openCodeServerKey(normalizedOrigin);
  const previousRegistry = decodeStoredRegistry(previousRegistryValue);
  const candidateRegistry = decodeStoredRegistry(candidateRegistryValue);
  const candidateServers = storedServerMap(candidateRegistry);
  if (candidateRegistry.activeServerKey !== normalizedOrigin || !candidateServers.has(serverKey)) {
    throw new Error("The unfinished saved connection record has an invalid candidate.");
  }
  return {
    serverKey,
    target,
    previous: {
      servers: storedServerMap(previousRegistry),
      activeServerKey:
        previousRegistry.activeServerKey === null
          ? null
          : openCodeServerKey(previousRegistry.activeServerKey),
      credential: previousPassword,
    },
    candidate: {
      servers: candidateServers,
      activeServerKey: serverKey,
      credential: nextPassword,
    },
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

async function writeSavedConnectionTransaction(
  transaction: SavedConnectionTransaction<OpenCodeServerKey, StoredServer>,
): Promise<void> {
  const value: StoredConnectionTransaction = {
    schema: CONNECTION_TRANSACTION_SCHEMA,
    version: CONNECTION_TRANSACTION_VERSION,
    origin: transaction.serverKey,
    target: transaction.target,
    previousPassword: transaction.previous.credential,
    nextPassword: transaction.candidate.credential,
    previousRegistry: storedRegistry(
      transaction.previous.servers,
      transaction.previous.activeServerKey,
    ),
    candidateRegistry: storedRegistry(
      transaction.candidate.servers,
      transaction.candidate.activeServerKey,
    ),
  };
  await SecureStore.setItemAsync(CONNECTION_TRANSACTION_STORAGE_KEY, JSON.stringify(value));
}

async function listAllSessions(client: OpenCodeClient): Promise<readonly OpenCodeSessionInfo[]> {
  const sessions: OpenCodeSessionInfo[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined | null;
  while (cursor !== null) {
    const page = await client.sessions.list({
      limit: PAGE_SIZE,
      order: "desc",
      ...(cursor === undefined ? {} : { cursor }),
    });
    sessions.push(...page.data);
    const next = page.cursor?.next;
    if (next === undefined || seenCursors.has(next)) {
      cursor = null;
      continue;
    }
    seenCursors.add(next);
    cursor = next;
  }
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
  publishEvent: (server: OpenCodeServerKey, event: OpenCodeEvent) => void,
): Promise<"disconnected" | "stopped" | "unauthorized"> {
  const signal = managed.controller.signal;
  const events = managed.client.events(signal)[Symbol.asyncIterator]();
  while (!signal.aborted) {
    const next = await readConnectionEvent(events, signal, MOBILE_EVENT_HEARTBEAT_TIMEOUT_MS);
    if (next.kind === "stopped") return "stopped";
    if (next.kind === "event") {
      updateServer(descriptor, stored, "live", null);
      publishEvent(descriptor.key, next.event);
      const eventType: string = next.event.type;
      if (eventType === "server.heartbeat") managed.sawHeartbeat = true;
      if (eventType !== "server.heartbeat" && !STREAMING_EVENT_TYPES.has(eventType)) {
        scheduleRefresh(descriptor.key);
      }
      continue;
    }
    if (next.kind === "error") {
      const status = connectionFailureStatus(next.error);
      updateServer(
        descriptor,
        stored,
        status === "unauthorized" ? status : "reconnecting",
        errorMessage(next.error),
      );
      return status === "unauthorized" ? "unauthorized" : "disconnected";
    }
    updateServer(
      descriptor,
      stored,
      "reconnecting",
      next.kind === "timeout"
        ? "The live connection stopped responding. Honk is reconnecting."
        : "The live connection closed. Honk is reconnecting.",
    );
    return "disconnected";
  }
  return "stopped";
}

export function RemoteProvider({ children }: React.PropsWithChildren): React.ReactElement {
  const [registry] = React.useState<OpenCodeRegistry>(createOpenCodeRegistry);
  const [storageQueue] = React.useState(createServerStorageQueue);
  const [sessionCacheRef] = React.useState(() => ({ current: readSessionCache() }));
  const [view, setView] = React.useState<RemoteViewState>(INITIAL_VIEW);
  const mountedRef = React.useRef(true);
  const restoringRef = React.useRef(true);
  const storedRef = React.useRef(new Map<OpenCodeServerKey, StoredServer>());
  const serverStateRef = React.useRef(new Map<OpenCodeServerKey, RemoteServer>());
  const sessionsRef = React.useRef(new Map<OpenCodeServerKey, readonly RemoteSession[]>());
  const managedRef = React.useRef(new Map<OpenCodeServerKey, ManagedServer>());
  const supervisorsRef = React.useRef(new Map<OpenCodeServerKey, AbortController>());
  const serverRemovalsRef = React.useRef(new Map<OpenCodeServerKey, Promise<void>>());
  const pendingCredentialOriginsRef = React.useRef(new Set<string>());
  const connectAttemptsRef = React.useRef(new Map<OpenCodeServerKey, number>());
  const eventListenersRef = React.useRef(
    new Map<OpenCodeServerKey, Set<(event: OpenCodeEvent) => void>>(),
  );
  const activeServerKeyRef = React.useRef<OpenCodeServerKey | null>(null);
  const pendingPairingRef = React.useRef<PendingPairingAdoption | null>(null);
  const pendingPairingRemovingRef = React.useRef(false);
  const pairingGenerationRef = React.useRef(0);
  const pairingControllerRef = React.useRef<AbortController | null>(null);
  const pairingOutcomeRef = React.useRef<PairingOutcome | null>(null);
  const networkStatusRef = React.useRef<"offline" | "online" | "unknown">("unknown");
  const reconnectSavedServersRef = React.useRef<
    (wakeup?: SavedServerWakeup, requested?: OpenCodeServerKey) => void
  >(() => undefined);

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
      pendingPairing:
        pendingPairingRef.current === null
          ? null
          : {
              origin: pendingPairingRef.current.origin,
              rebindOrigin: pendingPairingRef.current.rebindOrigin,
              requestId: pendingPairingRef.current.requestId,
              computerName: pendingPairingRef.current.serverLabel,
              status:
                pendingPairingRemovingRef.current || pendingPairingRef.current.status === "removing"
                  ? "removing"
                  : pendingPairingRef.current.status === "requesting"
                    ? "requesting"
                    : "confirming",
            },
      pairingOutcome: pairingOutcomeRef.current,
    });
  }, []);

  const beginPairingAttempt = React.useCallback(() => {
    pairingControllerRef.current?.abort(new Error("This pairing attempt was superseded."));
    const controller = new AbortController();
    pairingControllerRef.current = controller;
    const generation = pairingGenerationRef.current + 1;
    pairingGenerationRef.current = generation;
    pairingOutcomeRef.current = null;
    publish();
    return {
      controller,
      isOwned: () => pairingGenerationRef.current === generation,
      isCurrent: () => pairingGenerationRef.current === generation && !controller.signal.aborted,
    };
  }, [publish]);

  const runPairingAttempt = React.useCallback(
    async (
      pairing: { readonly origin: string; readonly requestId: string },
      result: "connected" | "removed",
      isCurrent: () => boolean,
      run: () => Promise<void>,
    ): Promise<void> => {
      try {
        await run();
      } catch (error) {
        // A superseded attempt's failure belongs to the newer flow; surfacing it would let a
        // stale rejection overwrite the state the newer attempt is publishing.
        if (!isCurrent()) return;
        pairingOutcomeRef.current = {
          origin: pairing.origin,
          requestId: pairing.requestId,
          result: "failed",
        };
        publish(errorMessage(error));
        throw error;
      }
      if (!isCurrent()) return;
      pairingOutcomeRef.current = {
        origin: pairing.origin,
        requestId: pairing.requestId,
        result,
      };
      publish();
    },
    [publish],
  );

  // Pairing, connection, selection, and removal share one durable mutation queue. Besides keeping
  // superseded pairing writes ordered, this prevents an older registry snapshot from resurrecting
  // a row that a concurrent removal already deleted.
  const runPairingStorage = React.useCallback(
    async (isCurrent: () => boolean, run: () => Promise<void>): Promise<void> => {
      await storageQueue.run(async () => {
        if (!isCurrent()) return;
        await run();
      });
    },
    [storageQueue],
  );

  const writeRegistry = React.useCallback(
    async (
      servers: ReadonlyMap<OpenCodeServerKey, StoredServer>,
      activeServerKey: OpenCodeServerKey | null,
      pendingCredentialOrigins: ReadonlySet<string> = pendingCredentialOriginsRef.current,
    ): Promise<void> => {
      await SecureStore.setItemAsync(
        REGISTRY_STORAGE_KEY,
        JSON.stringify(
          storedRegistry(servers, activeServerKey, [...pendingCredentialOrigins].sort()),
        ),
      );
    },
    [],
  );

  const updateServer = React.useCallback(
    (
      descriptor: OpenCodeServerDescriptor,
      stored: StoredServer,
      status: RemoteServer["status"],
      error: string | null,
    ): void => {
      serverStateRef.current.set(descriptor.key, {
        descriptor,
        environmentId: stored.environmentId ?? null,
        deviceId: stored.deviceId ?? null,
        serverId: stored.serverId,
        proofKeyThumbprint: stored.proofKeyThumbprint ?? null,
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
      // A refresh that outlives its server's removal or replacement must not resurrect rows.
      if (!storedRef.current.has(server) || registry.get(server) !== client) return;
      const rows = infos.map<RemoteSession>((info) => ({
        ref: openCodeSessionRef(server, info.id),
        server: client.server,
        info,
        projectDirectory: projectDirectories.get(info.projectID) ?? info.location.directory,
        status: active[info.id] === undefined ? "idle" : "running",
        needsAttention: attention.has(info.id),
        cached: false,
      }));
      sessionCacheRef.current = persistSessionCacheServer(sessionCacheRef.current, {
        server: client.server,
        sessions: rows,
      });
      sessionsRef.current.set(server, Object.freeze(rows));
      publish();
    },
    [publish, registry, sessionCacheRef],
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
    ): Promise<"disconnected" | "stopped" | "unauthorized"> =>
      pumpManagedServerEvents(
        descriptor,
        stored,
        managed,
        updateServer,
        scheduleRefresh,
        (server, event) => {
          for (const listener of eventListenersRef.current.get(server) ?? []) listener(event);
        },
      ),
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

  const stopSupervisor = React.useCallback((server: OpenCodeServerKey): void => {
    supervisorsRef.current.get(server)?.abort();
    supervisorsRef.current.delete(server);
    invalidateConnectionAttempt(connectAttemptsRef.current, server);
  }, []);

  const connectManaged = React.useCallback(
    async (
      stored: StoredServer,
      password: string,
      isPairingCurrent: () => boolean = () => true,
      signal?: AbortSignal,
      holdUntilDisconnect = false,
    ): Promise<OpenCodeServerDescriptor> => {
      const descriptor = serverDescriptor(stored);
      if (
        serverRemovalsRef.current.has(descriptor.key) ||
        !isActiveConnectionAttempt(isPairingCurrent, signal)
      ) {
        throw new StaleConnectionAttemptError();
      }
      // Managed relays are not allowed to see the durable device password. Activation stays
      // blocked until the proof-bound, short-lived credential path is available.
      if (stored.environmentId !== null && stored.environmentId !== undefined) {
        throw new ManagedCredentialUpgradeRequiredError();
      }
      // A saved computer proves it still holds the id we paired with before it is offered the saved
      // password. Fail-closed on purpose: an address that cannot prove it never sees the credential,
      // which is what stops a recycled LAN address from harvesting one.
      if (stored.serverId !== null) {
        const identity = await probeHonkServerIdentity(
          stored.origin,
          stored.serverId,
          randomUUID(),
          sha256,
          { ...(signal === undefined ? {} : { signal }) },
        );
        if (
          serverRemovalsRef.current.has(descriptor.key) ||
          !isActiveConnectionAttempt(isPairingCurrent, signal)
        ) {
          throw new StaleConnectionAttemptError();
        }
        if (identity.kind === "mismatch") {
          updateServer(descriptor, stored, "failed", UNVERIFIED_IDENTITY_MESSAGE);
          throw new ServerIdentityMismatchError();
        }
        if (identity.kind === "unavailable") {
          throw new ServerIdentityUnavailableError();
        }
      }
      const attempt = beginConnectionAttempt(connectAttemptsRef.current, descriptor.key);
      const controller = connectionLifetimeController(signal);
      const establishmentFetch = createConnectionAttemptFetch({ signal: controller.signal });
      const connectedFetch = createBoundedConnectionFetch({ signal: controller.signal });
      const connectionPhase = { established: false };
      updateServer(descriptor, stored, "connecting", null);
      const client = createOpenCodeClient(descriptor, {
        password,
        eventSource: nativeOpenCodeEventSource,
        fetch: (input, init) =>
          (connectionPhase.established ? connectedFetch : establishmentFetch)(input, init),
      });
      try {
        const outcome = await runWithConnectionDeadline(controller, () =>
          probeConnectionCandidate({
            probe: async () => {
              await client.health();
            },
            isCurrent: () =>
              !controller.signal.aborted &&
              !serverRemovalsRef.current.has(descriptor.key) &&
              isActiveConnectionAttempt(isPairingCurrent, signal) &&
              isCurrentConnectionAttempt(connectAttemptsRef.current, descriptor.key, attempt),
            close: () => client.close(),
            commit: async () => {
              stopManaged(descriptor.key);
              registry.register(client);
              const managed: ManagedServer = {
                client,
                controller,
                lifetime: null,
                refreshTimer: null,
                sawHeartbeat: false,
              };
              managedRef.current.set(descriptor.key, managed);
              updateServer(descriptor, stored, "live", null);
              await refreshServer(descriptor.key);
              if (
                isCurrentConnectionAttempt(connectAttemptsRef.current, descriptor.key, attempt) &&
                managedRef.current.get(descriptor.key)?.client === client
              ) {
                managed.lifetime = pumpEvents(descriptor, stored, managed);
                void managed.lifetime.then((outcome) => {
                  if (managedRef.current.get(descriptor.key)?.client !== client) return;
                  stopManaged(descriptor.key);
                  if (outcome === "disconnected" && !holdUntilDisconnect) {
                    reconnectSavedServersRef.current("availability-changed", descriptor.key);
                  }
                });
              }
            },
          }),
        );
        if (outcome === "stale") throw new StaleConnectionAttemptError();
        connectionPhase.established = true;
        if (holdUntilDisconnect) {
          const managed = managedRef.current.get(descriptor.key);
          if (managed?.client !== client || managed.lifetime === null) {
            throw new StaleConnectionAttemptError();
          }
          const eventOutcome = await managed.lifetime;
          if (eventOutcome === "stopped") throw new StaleConnectionAttemptError();
          if (eventOutcome === "unauthorized") throw new ServerAuthorizationError();
          throw new ServerEventStreamDisconnectedError(managed.sawHeartbeat);
        }
        return descriptor;
      } catch (error) {
        controller.abort();
        client.close();
        if (managedRef.current.get(descriptor.key)?.client === client) {
          stopManaged(descriptor.key);
        }
        if (
          !serverRemovalsRef.current.has(descriptor.key) &&
          isActiveConnectionAttempt(isPairingCurrent, signal) &&
          isCurrentConnectionAttempt(connectAttemptsRef.current, descriptor.key, attempt)
        ) {
          updateServer(descriptor, stored, connectionFailureStatus(error), errorMessage(error));
        }
        throw error;
      }
    },
    [pumpEvents, refreshServer, registry, stopManaged, updateServer],
  );

  const superviseServer = React.useCallback(
    (stored: StoredServer, password: string): Promise<"blocked" | "connected" | "stopped"> => {
      const descriptor = serverDescriptor(stored);
      stopSupervisor(descriptor.key);
      if (networkStatusRef.current === "offline") {
        updateServer(descriptor, stored, "offline", null);
        return Promise.resolve("stopped");
      }

      const controller = new AbortController();
      supervisorsRef.current.set(descriptor.key, controller);
      let blockedStatus: RemoteServer["status"] = "failed";
      const run = superviseMobileConnection(controller.signal, {
        connect: (_attempt, signal) =>
          connectManaged(
            stored,
            password,
            () =>
              !signal.aborted && storedRef.current.get(descriptor.key)?.origin === stored.origin,
            signal,
            true,
          ).then(() => undefined),
        classifyFailure: (error) => {
          blockedStatus = connectionFailureStatus(error);
          if (isBlockedConnectionFailure(error)) return "blocked";
          return error instanceof ServerEventStreamDisconnectedError && error.resetBackoff
            ? "transient-reset"
            : "transient";
        },
        errorMessage,
        publish: (state: SupervisedConnectionState) => {
          if (supervisorsRef.current.get(descriptor.key) !== controller) return;
          updateServer(
            descriptor,
            stored,
            state.phase === "connected"
              ? "live"
              : state.phase === "blocked"
                ? blockedStatus
                : state.phase === "reconnecting"
                  ? "reconnecting"
                  : "connecting",
            state.error,
          );
        },
      });
      return run.finally(() => {
        if (supervisorsRef.current.get(descriptor.key) === controller) {
          supervisorsRef.current.delete(descriptor.key);
        }
      });
    },
    [connectManaged, stopSupervisor, updateServer],
  );

  const queueSavedServerConnection = React.useCallback(
    (server: OpenCodeServerKey, stored: StoredServer): void => {
      if (serverRemovalsRef.current.has(server)) return;
      stopSupervisor(server);
      if (stored.environmentId !== null && stored.environmentId !== undefined) {
        updateServer(
          serverDescriptor(stored),
          stored,
          "remote-setup",
          new ManagedCredentialUpgradeRequiredError().message,
        );
        return;
      }
      const pending = new AbortController();
      supervisorsRef.current.set(server, pending);
      void readCredential(stored.origin).then(
        (password) => {
          if (
            pending.signal.aborted ||
            supervisorsRef.current.get(server) !== pending ||
            serverRemovalsRef.current.has(server) ||
            storedRef.current.get(server)?.origin !== stored.origin
          ) {
            return;
          }
          if (password === null) {
            supervisorsRef.current.delete(server);
            updateServer(
              serverDescriptor(stored),
              stored,
              "unauthorized",
              "Honk can’t find the saved password for this computer.",
            );
            return;
          }
          void superviseServer(stored, password);
        },
        (error: unknown) => {
          if (
            pending.signal.aborted ||
            supervisorsRef.current.get(server) !== pending ||
            serverRemovalsRef.current.has(server) ||
            storedRef.current.get(server)?.origin !== stored.origin
          ) {
            return;
          }
          supervisorsRef.current.delete(server);
          updateServer(serverDescriptor(stored), stored, "failed", errorMessage(error));
        },
      );
    },
    [stopSupervisor, superviseServer, updateServer],
  );

  const probeSavedServer = React.useCallback(
    (server: OpenCodeServerKey, stored: StoredServer): void => {
      const managed = managedRef.current.get(server);
      if (managed === undefined) {
        queueSavedServerConnection(server, stored);
        return;
      }
      void (async () => {
        if (stored.serverId !== null) {
          const identity = await probeHonkServerIdentity(
            stored.origin,
            stored.serverId,
            randomUUID(),
            sha256,
            { signal: managed.controller.signal },
          );
          if (
            managed.controller.signal.aborted ||
            managedRef.current.get(server) !== managed ||
            serverRemovalsRef.current.has(server) ||
            storedRef.current.get(server)?.origin !== stored.origin
          ) {
            return;
          }
          if (identity.kind === "mismatch") {
            stopManaged(server);
            updateServer(serverDescriptor(stored), stored, "failed", UNVERIFIED_IDENTITY_MESSAGE);
            return;
          }
          if (identity.kind === "unavailable") {
            stopManaged(server);
            queueSavedServerConnection(server, stored);
            return;
          }
        }
        const healthy = await managed.client.health().then(
          () => true,
          () => false,
        );
        if (
          managed.controller.signal.aborted ||
          managedRef.current.get(server) !== managed ||
          serverRemovalsRef.current.has(server) ||
          storedRef.current.get(server)?.origin !== stored.origin
        ) {
          return;
        }
        if (healthy) return;
        stopManaged(server);
        queueSavedServerConnection(server, stored);
      })().catch(() => {
        if (
          managed.controller.signal.aborted ||
          managedRef.current.get(server) !== managed ||
          serverRemovalsRef.current.has(server) ||
          storedRef.current.get(server)?.origin !== stored.origin
        ) {
          return;
        }
        stopManaged(server);
        queueSavedServerConnection(server, stored);
      });
    },
    [queueSavedServerConnection, stopManaged, updateServer],
  );

  const reconnectSavedServers = React.useCallback(
    (wakeup: SavedServerWakeup = "availability-changed", requested?: OpenCodeServerKey): void => {
      for (const [server, stored] of storedRef.current) {
        if (requested !== undefined && requested !== server) continue;
        if (serverRemovalsRef.current.has(server)) continue;
        const status = serverStateRef.current.get(server)?.status;
        if (status === "failed" || status === "unauthorized" || status === "remote-setup") continue;
        if (
          wakeup === "availability-changed" &&
          ((status === "live" && managedRef.current.has(server)) ||
            supervisorsRef.current.has(server))
        ) {
          continue;
        }
        if (wakeup === "application-active-probe" && status === "live") {
          probeSavedServer(server, stored);
          continue;
        }
        if (wakeup === "application-active-reconnect") stopManaged(server);
        queueSavedServerConnection(server, stored);
      }
    },
    [probeSavedServer, queueSavedServerConnection, stopManaged],
  );

  React.useEffect(() => {
    reconnectSavedServersRef.current = reconnectSavedServers;
  }, [reconnectSavedServers]);

  const finishCredentialCleanup = React.useCallback(
    async (origin: string): Promise<void> => {
      await SecureStore.deleteItemAsync(credentialStorageKey(origin)).catch((cause: unknown) => {
        throw new Error(
          "Honk removed this computer, but could not delete its saved password. Honk will retry when the app opens again.",
          { cause },
        );
      });
      const completed = new Set(pendingCredentialOriginsRef.current);
      completed.delete(origin);
      await writeRegistry(storedRef.current, activeServerKeyRef.current, completed);
      pendingCredentialOriginsRef.current = completed;
    },
    [writeRegistry],
  );

  // This core runs only inside storageQueue. Keeping it separate lets pairing rollback and rebind
  // participate in the same transaction without recursively queueing and deadlocking.
  const removeSavedServerFromStorage = React.useCallback(
    async (server: OpenCodeServerKey, origin: string): Promise<void> => {
      const stored = storedRef.current.get(server);
      if (stored === undefined) {
        if (pendingCredentialOriginsRef.current.has(origin)) {
          await finishCredentialCleanup(origin);
        }
        return;
      }
      if (stored.origin !== origin) return;

      const previousPending = pendingCredentialOriginsRef.current;
      const pending = new Set(previousPending);
      pending.add(origin);
      pendingCredentialOriginsRef.current = pending;
      const result = await persistSavedConnectionRemoval(
        storedRef.current,
        activeServerKeyRef.current,
        server,
        writeRegistry,
      ).catch((error: unknown) => {
        pendingCredentialOriginsRef.current = previousPending;
        throw error;
      });
      // Stop the runtime only after the durable row removal commits. A failed write leaves the
      // existing connection intact, while a successful write cannot be undone by another writer.
      stopSupervisor(server);
      stopManaged(server);
      storedRef.current = new Map(result.servers);
      serverStateRef.current.delete(server);
      sessionCacheRef.current = writeSessionCache(
        removeSessionCacheServer(sessionCacheRef.current, server),
      );
      sessionsRef.current.delete(server);
      activeServerKeyRef.current = result.activeServerKey;
      publish();
      await finishCredentialCleanup(origin);
    },
    [finishCredentialCleanup, publish, sessionCacheRef, stopManaged, stopSupervisor, writeRegistry],
  );

  const removeSavedServer = React.useCallback(
    (server: OpenCodeServerKey, origin: string): Promise<void> => {
      const activeRemoval = serverRemovalsRef.current.get(server);
      if (activeRemoval !== undefined) return activeRemoval;

      const pendingPairing =
        pendingPairingRef.current?.origin === origin ? pendingPairingRef.current : null;
      if (pendingPairing !== null) {
        pairingGenerationRef.current += 1;
        pairingControllerRef.current?.abort(new Error("This pairing attempt was removed."));
      }
      const removal = storageQueue.run(async () => {
        const outcome = await removeSavedServerFromStorage(server, origin).then(
          () => ({ ok: true as const }),
          (error: unknown) => ({ ok: false as const, error }),
        );
        if (
          pendingPairing !== null &&
          !storedRef.current.has(server) &&
          pendingPairingRef.current?.requestId === pendingPairing.requestId
        ) {
          await SecureStore.deleteItemAsync(PENDING_PAIRING_STORAGE_KEY);
          pendingPairingRef.current = null;
          pendingPairingRemovingRef.current = false;
          pairingOutcomeRef.current = null;
          publish();
        }
        if (!outcome.ok) throw outcome.error;
      });
      serverRemovalsRef.current.set(server, removal);
      return removal.finally(() => {
        if (serverRemovalsRef.current.get(server) === removal) {
          serverRemovalsRef.current.delete(server);
        }
        if (storedRef.current.has(server)) {
          reconnectSavedServersRef.current("availability-changed", server);
        }
      });
    },
    [publish, removeSavedServerFromStorage, storageQueue],
  );

  const releaseReboundServerFromStorage = React.useCallback(
    async (adoption: PendingPairingAdoption): Promise<void> => {
      if (adoption.rebindOrigin === null) return;
      const reboundServer = openCodeServerKey(adoption.origin);
      const previousServer = openCodeServerKey(adoption.rebindOrigin);
      if (reboundServer === previousServer) return;

      const candidate = storedRef.current.get(reboundServer);
      if (candidate === undefined) {
        throw new Error("Honk could not find the newly paired computer in saved storage.");
      }
      const confirmed = pairingServer(adoption, true);
      if (
        confirmed.environmentId !== null &&
        confirmed.environmentId !== undefined &&
        [...storedRef.current].some(
          ([server, stored]) =>
            server !== previousServer &&
            server !== reboundServer &&
            stored.environmentId === confirmed.environmentId,
        )
      ) {
        throw new Error("This managed computer is already saved at another address.");
      }

      const old = storedRef.current.get(previousServer);
      const previousPending = pendingCredentialOriginsRef.current;
      const pending = new Set(previousPending);
      if (old !== undefined) pending.add(adoption.rebindOrigin);
      const servers = new Map(storedRef.current);
      servers.set(reboundServer, confirmed);
      servers.delete(previousServer);
      const activeServerKey =
        activeServerKeyRef.current === previousServer ? reboundServer : activeServerKeyRef.current;
      pendingCredentialOriginsRef.current = pending;
      await writeRegistry(servers, activeServerKey, pending).catch((error: unknown) => {
        pendingCredentialOriginsRef.current = previousPending;
        throw error;
      });

      const previousCache = sessionCacheRef.current.servers.find(
        (snapshot) => snapshot.server.key === previousServer,
      );
      const reboundHasLiveSnapshot =
        managedRef.current.has(reboundServer) && sessionsRef.current.has(reboundServer);
      sessionCacheRef.current = writeSessionCache(
        reboundHasLiveSnapshot
          ? removeSessionCacheServer(sessionCacheRef.current, previousServer)
          : mergeSessionCacheServer(
              removeSessionCacheServer(sessionCacheRef.current, previousServer),
              {
                server: serverDescriptor(confirmed),
                sessions: previousCache?.sessions ?? [],
              },
            ),
      );
      stopSupervisor(previousServer);
      stopManaged(previousServer);
      storedRef.current = servers;
      serverStateRef.current.delete(previousServer);
      sessionsRef.current.delete(previousServer);
      if (!reboundHasLiveSnapshot) {
        const reboundCache = sessionCacheRef.current.servers.find(
          (snapshot) => snapshot.server.key === reboundServer,
        );
        if (reboundCache !== undefined) {
          sessionsRef.current.set(reboundServer, reboundCache.sessions);
        }
      }
      activeServerKeyRef.current = activeServerKey;
      const current = serverStateRef.current.get(reboundServer);
      if (current !== undefined) {
        serverStateRef.current.set(reboundServer, {
          ...current,
          environmentId: confirmed.environmentId ?? null,
          deviceId: confirmed.deviceId ?? null,
          proofKeyThumbprint: confirmed.proofKeyThumbprint ?? null,
        });
      }
      publish();
      if (pending.has(adoption.rebindOrigin)) {
        await finishCredentialCleanup(adoption.rebindOrigin);
      }
    },
    [finishCredentialCleanup, publish, sessionCacheRef, stopManaged, stopSupervisor, writeRegistry],
  );

  const pairingOperations = React.useCallback(
    (isCurrent: () => boolean, controller: AbortController): PairingAdoptionOperations => {
      return {
        isCurrent,
        verifyIdentity: (target) =>
          runPairingRequest(controller.signal, (request, signal) =>
            verifyHonkServerIdentity(target.origin, target.serverId, randomUUID(), sha256, {
              fetch: request,
              signal,
            }),
          ),
        exchange: (request) =>
          runPairingRequest(controller.signal, (fetch) =>
            exchangeHonkPairing(request.origin, request.token, {
              requestId: request.requestId,
              label: request.deviceLabel,
              ...(request.replacePassword === null
                ? {}
                : { replacePassword: request.replacePassword }),
              fetch,
            }),
          ),
        stage: (pending) =>
          runPairingStorage(isCurrent, async () => {
            await SecureStore.setItemAsync(PENDING_PAIRING_STORAGE_KEY, JSON.stringify(pending));
            // A removal can begin while SecureStore is writing. Erase this now-stale marker before
            // releasing the queue so a restart cannot resume and recreate the removed computer.
            if (!isCurrent()) {
              await SecureStore.deleteItemAsync(PENDING_PAIRING_STORAGE_KEY);
              return;
            }
            pendingPairingRef.current = pending;
            pendingPairingRemovingRef.current = pending.status === "removing";
            publish();
          }),
        persist: (adoption) =>
          runPairingStorage(isCurrent, async () => {
            const stored = pairingServer(adoption, false);
            const descriptor = serverDescriptor(stored);
            await writeCredential(adoption.origin, adoption.password);
            if (!isCurrent()) return;
            storedRef.current.set(descriptor.key, stored);
            activeServerKeyRef.current = descriptor.key;
            await writeRegistry(storedRef.current, activeServerKeyRef.current);
            if (!isCurrent()) return;
            publish();
          }),
        confirm: (adoption) =>
          runPairingRequest(controller.signal, (request) => confirmHonkPairing(adoption, request)),
        releaseRebind: (adoption) =>
          runPairingStorage(isCurrent, async () => {
            await releaseReboundServerFromStorage(adoption);
          }),
        isAccessRejected: (error) => connectionFailureStatus(error) === "unauthorized",
        activate: async (adoption) => {
          stopSupervisor(openCodeServerKey(adoption.origin));
          await connectManaged(pairingServer(adoption, true), adoption.password, isCurrent);
        },
        probe: async (connection) => {
          await runPairingRequest(controller.signal, async (request) => {
            const client = createOpenCodeClient(
              createOpenCodeServer({ origin: connection.origin }),
              {
                password: connection.password,
                fetch: request,
              },
            );
            await client.health().finally(() => client.close());
          });
        },
        cancel: (adoption) =>
          runPairingRequest(controller.signal, (request) =>
            cancelHonkPairing(adoption, request),
          ).then(() => {
            if (!isCurrent()) return;
            if (pendingPairingRef.current?.requestId === adoption.requestId) {
              pendingPairingRemovingRef.current = true;
              publish();
            }
          }),
        rollback: (pending) =>
          runPairingStorage(isCurrent, async () => {
            const candidate = pairingServer(pending, false);
            const descriptor = serverDescriptor(candidate);
            if (pendingPairingRef.current?.requestId === pending.requestId) {
              pendingPairingRemovingRef.current = true;
              publish();
            }
            invalidateConnectionAttempt(connectAttemptsRef.current, descriptor.key);
            if (
              pending.restorePreviousAccess &&
              pending.replacePassword !== null &&
              pending.previousServerLabel !== null &&
              pending.previousDefaultDirectory !== null
            ) {
              const previous: StoredServer = {
                environmentId: pending.previousEnvironmentId,
                deviceId: pending.previousDeviceId,
                proofKeyThumbprint: pending.previousProofKeyThumbprint,
                origin: pending.origin,
                label: pending.previousServerLabel,
                defaultDirectory: pending.previousDefaultDirectory,
                serverId: pending.replaceServerId,
              };
              await writeCredential(pending.origin, pending.replacePassword);
              if (!isCurrent()) return;
              storedRef.current.set(descriptor.key, previous);
              activeServerKeyRef.current =
                pending.previousActiveServerKey === null
                  ? null
                  : openCodeServerKey(pending.previousActiveServerKey);
              await writeRegistry(storedRef.current, activeServerKeyRef.current);
              if (!isCurrent()) return;
              publish();
              await connectManaged(previous, pending.replacePassword, isCurrent).catch(
                () => undefined,
              );
              return;
            }

            // Cancellation already ran while the provisional credential was in memory. Reconcile
            // local storage before complete clears the durable recovery marker.
            await removeSavedServerFromStorage(descriptor.key, pending.origin);
            if (!isCurrent()) return;
          }),
        complete: (pending) =>
          runPairingStorage(isCurrent, async () => {
            await SecureStore.deleteItemAsync(PENDING_PAIRING_STORAGE_KEY);
            if (!isCurrent()) return;
            if (
              pendingPairingRef.current?.origin === pending.origin &&
              pendingPairingRef.current.requestId === pending.requestId
            ) {
              pendingPairingRef.current = null;
              pendingPairingRemovingRef.current = false;
            }
            publish();
          }),
      };
    },
    [
      connectManaged,
      publish,
      releaseReboundServerFromStorage,
      removeSavedServerFromStorage,
      runPairingStorage,
      stopSupervisor,
      writeRegistry,
    ],
  );

  React.useEffect(() => {
    mountedRef.current = true;
    void (async () => {
      const [saved, pendingPairing, connectionTransaction] = await Promise.all([
        SecureStore.getItemAsync(REGISTRY_STORAGE_KEY).then(decodeStoredRegistry),
        SecureStore.getItemAsync(PENDING_PAIRING_STORAGE_KEY).then(decodePairingAdoption),
        SecureStore.getItemAsync(CONNECTION_TRANSACTION_STORAGE_KEY).then(
          decodeSavedConnectionTransaction,
        ),
      ]);
      pendingCredentialOriginsRef.current = new Set(saved.pendingCredentialOrigins);
      // Manual connection recovery must finish before this origin can connect or pending
      // pairing recovery can mutate the same saved registry.
      const resolvedSaved =
        connectionTransaction === null
          ? {
              servers: storedServerMap(saved),
              activeServerKey:
                saved.activeServerKey === null ? null : openCodeServerKey(saved.activeServerKey),
            }
          : await resolveSavedConnectionTransaction(
              connectionTransaction,
              storedServerMap(saved),
              saved.activeServerKey === null ? null : openCodeServerKey(saved.activeServerKey),
              {
                writeCredential: (password) =>
                  writeCredential(connectionTransaction.serverKey, password),
                deleteCredential: () =>
                  SecureStore.deleteItemAsync(
                    credentialStorageKey(connectionTransaction.serverKey),
                  ),
                writeRegistry,
                writeTransaction: writeSavedConnectionTransaction,
                clearTransaction: () =>
                  SecureStore.deleteItemAsync(CONNECTION_TRANSACTION_STORAGE_KEY),
                isSameRegistry: sameStoredRegistry,
              },
            );
      const retainedCredentialOrigins = new Set(
        (
          await Promise.all(
            [...pendingCredentialOriginsRef.current].map(async (origin) => {
              if (resolvedSaved.servers.has(openCodeServerKey(origin))) return null;
              return SecureStore.deleteItemAsync(credentialStorageKey(origin)).then(
                () => null,
                () => origin,
              );
            }),
          )
        ).filter((origin): origin is string => origin !== null),
      );
      if (pendingCredentialOriginsRef.current.size > 0) {
        await writeRegistry(
          resolvedSaved.servers,
          resolvedSaved.activeServerKey,
          retainedCredentialOrigins,
        ).catch(() => undefined);
      }
      pendingCredentialOriginsRef.current = retainedCredentialOrigins;
      pendingPairingRef.current = pendingPairing;
      pendingPairingRemovingRef.current = pendingPairing?.status === "removing";
      for (const stored of resolvedSaved.servers.values()) {
        const descriptor = serverDescriptor(stored);
        storedRef.current.set(descriptor.key, stored);
        serverStateRef.current.set(descriptor.key, {
          descriptor,
          environmentId: stored.environmentId ?? null,
          deviceId: stored.deviceId ?? null,
          serverId: stored.serverId,
          proofKeyThumbprint: stored.proofKeyThumbprint ?? null,
          defaultDirectory: stored.defaultDirectory,
          status: "connecting",
          error: null,
        });
      }
      if (pendingPairing !== null) {
        const stored = pairingServer(pendingPairing, false);
        const descriptor = serverDescriptor(stored);
        storedRef.current.set(descriptor.key, stored);
        serverStateRef.current.set(descriptor.key, {
          descriptor,
          environmentId: stored.environmentId ?? null,
          deviceId: stored.deviceId ?? null,
          serverId: stored.serverId,
          proofKeyThumbprint: stored.proofKeyThumbprint ?? null,
          defaultDirectory: stored.defaultDirectory,
          status: "connecting",
          error: null,
        });
      }
      const restoredCache = [...storedRef.current].reduce((cache, [server, stored]) => {
        const cached = sessionCacheRef.current.servers.find(
          (snapshot) => snapshot.server.key === server,
        );
        return cached === undefined
          ? cache
          : replaceSessionCacheServer(cache, {
              server: serverDescriptor(stored),
              sessions: cached.sessions,
            });
      }, EMPTY_SESSION_CACHE);
      sessionCacheRef.current = writeSessionCache(restoredCache);
      for (const snapshot of sessionCacheRef.current.servers) {
        sessionsRef.current.set(snapshot.server.key, snapshot.sessions);
      }
      const requestedActive = resolvedSaved.activeServerKey;
      activeServerKeyRef.current =
        pendingPairing === null
          ? requestedActive !== null && storedRef.current.has(requestedActive)
            ? requestedActive
            : (storedRef.current.keys().next().value ?? null)
          : openCodeServerKey(pendingPairing.origin);
      publish();

      const pendingPairingServer =
        pendingPairing === null ? null : openCodeServerKey(pendingPairing.origin);
      for (const server of storedRef.current.keys()) {
        if (server === pendingPairingServer) continue;
        const state = serverStateRef.current.get(server);
        if (state !== undefined) {
          serverStateRef.current.set(server, { ...state, status: "connecting", error: null });
        }
      }
      reconnectSavedServers();
      return pendingPairing;
    })().then(
      (pendingPairing) => {
        if (!mountedRef.current) return;
        restoringRef.current = false;
        publish();
        if (pendingPairing === null) return;
        const attempt = beginPairingAttempt();
        void runPairingAttempt(
          pendingPairing,
          pendingPairing.status === "removing" ? "removed" : "connected",
          attempt.isOwned,
          () =>
            resumePairingAdoption(
              pendingPairing,
              pairingOperations(attempt.isCurrent, attempt.controller),
            ),
        ).catch(() => undefined);
      },
      (error: unknown) => {
        if (!mountedRef.current) return;
        restoringRef.current = false;
        publish(errorMessage(error));
      },
    );

    return () => {
      mountedRef.current = false;
      restoringRef.current = false;
      pairingControllerRef.current?.abort(new Error("Honk stopped restoring this connection."));
      for (const controller of supervisorsRef.current.values()) controller.abort();
      supervisorsRef.current.clear();
      for (const managed of managedRef.current.values()) {
        managed.controller.abort();
        if (managed.refreshTimer !== null) clearTimeout(managed.refreshTimer);
      }
      managedRef.current.clear();
      eventListenersRef.current.clear();
      registry.close();
    };
  }, [
    beginPairingAttempt,
    pairingOperations,
    publish,
    reconnectSavedServers,
    registry,
    runPairingAttempt,
    sessionCacheRef,
    writeRegistry,
  ]);

  React.useEffect(() => {
    let active = true;
    let backgroundedAt = AppState.currentState === "background" ? Date.now() : null;

    const onNetworkChange = (state: Network.NetworkState, reconnectOnOnline = true): void => {
      if (!active) return;
      const next = mobileNetworkStatus(state);
      const previous = networkStatusRef.current;
      networkStatusRef.current = next;
      if (next === "offline") {
        for (const server of [...supervisorsRef.current.keys()]) stopSupervisor(server);
        for (const [server, stored] of storedRef.current) {
          stopManaged(server);
          const current = serverStateRef.current.get(server);
          if (
            current?.status === "unauthorized" ||
            current?.status === "failed" ||
            current?.status === "remote-setup" ||
            current?.error === UNVERIFIED_IDENTITY_MESSAGE
          ) {
            continue;
          }
          updateServer(serverDescriptor(stored), stored, "offline", current?.error ?? null);
        }
        return;
      }
      if (reconnectOnOnline && next === "online" && previous !== "online") {
        reconnectSavedServers();
      }
    };

    const networkSubscription = Network.addNetworkStateListener(onNetworkChange);
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "background") {
        backgroundedAt = Date.now();
        return;
      }
      if (state !== "active") return;
      const wakeup = mobileApplicationActiveWakeup(backgroundedAt, Date.now());
      backgroundedAt = null;
      void Network.getNetworkStateAsync().then(
        (current) => {
          if (!active || AppState.currentState !== "active") return;
          onNetworkChange(current, false);
          if (mobileNetworkStatus(current) !== "offline") reconnectSavedServers(wakeup);
        },
        () => {
          if (!active || AppState.currentState !== "active") return;
          networkStatusRef.current = "unknown";
          reconnectSavedServers(wakeup);
        },
      );
    });
    void Network.getNetworkStateAsync().then(onNetworkChange, () => undefined);

    return () => {
      active = false;
      networkSubscription.remove();
      appStateSubscription.remove();
    };
  }, [reconnectSavedServers, stopManaged, stopSupervisor, updateServer]);

  const connect = React.useCallback(
    async (input: ConnectRemoteInput): Promise<void> => {
      const origin = normalizeRemoteOrigin(input.origin);
      const server = openCodeServerKey(origin);
      if (serverRemovalsRef.current.has(server)) {
        throw new Error("Finish removing this computer before connecting it again.");
      }
      const transaction = await storageQueue.run(async () => {
        if (serverRemovalsRef.current.has(server)) {
          throw new Error("Finish removing this computer before connecting it again.");
        }
        const existing = storedRef.current.get(server);
        const stored: StoredServer = {
          environmentId: existing?.environmentId ?? null,
          deviceId: existing?.deviceId ?? null,
          proofKeyThumbprint: existing?.proofKeyThumbprint ?? null,
          origin,
          label: input.label?.trim() ?? "",
          defaultDirectory: input.defaultDirectory.trim(),
          // A manual password entry learns no identity; keep whatever this address already proved.
          serverId: existing?.serverId ?? null,
        };
        const descriptor = serverDescriptor(stored);
        const previousServers = new Map(storedRef.current);
        const previousActiveServerKey = activeServerKeyRef.current;
        const previousServerState = serverStateRef.current.get(descriptor.key);
        const previousPassword = await readCredential(origin);
        if (serverRemovalsRef.current.has(server)) {
          throw new Error("Finish removing this computer before connecting it again.");
        }
        stopSupervisor(descriptor.key);
        const persistence = await persistSavedConnectionCandidate(
          previousServers,
          previousActiveServerKey,
          descriptor.key,
          stored,
          previousPassword,
          input.password,
          {
            writeCredential: (password) => writeCredential(origin, password),
            deleteCredential: () => SecureStore.deleteItemAsync(credentialStorageKey(origin)),
            writeRegistry,
            writeTransaction: writeSavedConnectionTransaction,
            clearTransaction: () => SecureStore.deleteItemAsync(CONNECTION_TRANSACTION_STORAGE_KEY),
          },
        );
        storedRef.current = new Map(persistence.servers);
        activeServerKeyRef.current = persistence.activeServerKey;
        publish();
        return {
          descriptor,
          persistence,
          previousActiveServerKey,
          previousServers,
          previousServerState,
          stored,
        };
      });
      try {
        await connectManaged(transaction.stored, input.password);
      } catch (error) {
        if (error instanceof StaleConnectionAttemptError) throw error;
        await storageQueue.run(async () => {
          // A removal or newer edit that landed while the network probe was running owns the
          // current snapshot. Restoring this older transaction would resurrect or discard it.
          if (
            !sameStoredRegistry(
              storedRef.current,
              activeServerKeyRef.current,
              transaction.persistence.servers,
              transaction.persistence.activeServerKey,
            )
          ) {
            return;
          }
          await transaction.persistence.restore().catch((restoreError: unknown) => {
            throw new AggregateError(
              [error, restoreError],
              "The connection failed and the previous saved connection could not be restored.",
            );
          });
          storedRef.current = transaction.previousServers;
          activeServerKeyRef.current = transaction.previousActiveServerKey;
          const previousStored = transaction.previousServers.get(transaction.descriptor.key);
          if (
            transaction.previousServerState !== undefined &&
            managedRef.current.has(transaction.descriptor.key)
          ) {
            serverStateRef.current.set(transaction.descriptor.key, transaction.previousServerState);
          }
          if (previousStored !== undefined && !managedRef.current.has(transaction.descriptor.key)) {
            serverStateRef.current.set(transaction.descriptor.key, {
              descriptor: serverDescriptor(previousStored),
              environmentId: previousStored.environmentId ?? null,
              deviceId: previousStored.deviceId ?? null,
              serverId: previousStored.serverId,
              proofKeyThumbprint: previousStored.proofKeyThumbprint ?? null,
              defaultDirectory: previousStored.defaultDirectory,
              status: "failed",
              error: "The previous connection was restored. Try connecting again.",
            });
          }
          if (previousStored === undefined) {
            serverStateRef.current.delete(transaction.descriptor.key);
            sessionsRef.current.delete(transaction.descriptor.key);
          }
          publish();
        });
        throw error;
      }
    },
    [connectManaged, publish, stopSupervisor, storageQueue, writeRegistry],
  );

  const retryPendingPairing = React.useCallback(async (): Promise<void> => {
    const pending = pendingPairingRef.current;
    if (pending === null) return;
    const attempt = beginPairingAttempt();
    const server = openCodeServerKey(pending.origin);
    const isCurrent = (): boolean => attempt.isCurrent() && !serverRemovalsRef.current.has(server);
    await runPairingAttempt(
      pending,
      pending.status === "removing" ? "removed" : "connected",
      attempt.isOwned,
      async () => {
        const operations = pairingOperations(isCurrent, attempt.controller);
        // Re-assert the durable marker under this attempt: a superseded flow's in-flight
        // marker write (for example complete's delete) cannot be cancelled, so this queued
        // write is what guarantees storage matches the record this retry resumes from.
        await operations.stage(pending);
        if (!isCurrent()) return;
        await resumePairingAdoption(pending, operations);
      },
    );
  }, [beginPairingAttempt, pairingOperations, runPairingAttempt]);

  const cancelPendingPairing = React.useCallback(async (): Promise<void> => {
    const pending = pendingPairingRef.current;
    if (pending === null) return;
    const attempt = beginPairingAttempt();
    const server = openCodeServerKey(pending.origin);
    const isCurrent = (): boolean => attempt.isCurrent() && !serverRemovalsRef.current.has(server);
    await runPairingAttempt(pending, "removed", attempt.isOwned, () =>
      removePairingAdoption(pending, pairingOperations(isCurrent, attempt.controller)),
    );
  }, [beginPairingAttempt, pairingOperations, runPairingAttempt]);

  const acknowledgePairingOutcome = React.useCallback(
    (requestId: string): void => {
      if (pairingOutcomeRef.current?.requestId !== requestId) return;
      pairingOutcomeRef.current = null;
      publish();
    },
    [publish],
  );

  const pair = React.useCallback(
    async (input: PairRemoteInput): Promise<void> => {
      const origin = normalizeRemoteOrigin(input.origin);
      // Never adopt a new code while a durable request exists: an implicit retry here could
      // finish a different request than the one the screen is showing.
      if (pendingPairingRef.current !== null) {
        if (pendingPairingRef.current.origin !== origin) {
          throw new Error("Finish the current connection before connecting another computer.");
        }
        throw new Error("Finish the current connection, or start over to use a new code.");
      }

      const server = openCodeServerKey(origin);
      if (serverRemovalsRef.current.has(server)) {
        throw new Error("Finish removing this computer before pairing it again.");
      }
      const existing = storedRef.current.get(server);
      if (!input.replace && existing !== undefined) {
        throw new Error("This computer is already connected.");
      }
      // Identity rebinding happens only inside an explicit user-initiated pairing, never on restore
      // and never in the background: /honk/pair/preview is unauthenticated, so on a LAN any peer can
      // claim any serverId, and bounding this to a fresh scan is what keeps that from relocating a
      // credential.
      const rebind = findRebindableServer(storedRef.current, origin, input.serverId);
      const previousManaged = input.replace ? existing : rebind?.[1];
      const previousActiveServerKey = activeServerKeyRef.current;
      const attempt = beginPairingAttempt();
      const isCurrent = (): boolean =>
        attempt.isCurrent() &&
        !serverRemovalsRef.current.has(server) &&
        (rebind === null || !serverRemovalsRef.current.has(rebind[0]));
      await runPairingAttempt(
        { origin, requestId: input.requestId },
        "connected",
        attempt.isOwned,
        async () => {
          const replacePassword = input.replace ? await readCredential(origin) : null;
          if (!isCurrent()) return;
          if (input.replace && (existing === undefined || replacePassword === null)) {
            throw new Error(
              "Honk can’t find the saved password for this computer. Remove this saved connection, then scan a new code.",
            );
          }
          await beginPairingAdoption(
            {
              origin,
              serverId: input.serverId,
              rebindOrigin: rebind?.[1].origin ?? null,
              token: input.token,
              requestId: input.requestId,
              serverLabel: input.serverLabel.trim(),
              deviceLabel: input.deviceLabel.trim(),
              defaultDirectory:
                input.replace && existing !== undefined
                  ? existing.defaultDirectory
                  : input.defaultDirectory.trim(),
              replacePassword,
              // The saved record's id is trusted; the scanned preview's id is not.
              replaceServerId: input.replace ? (existing?.serverId ?? null) : null,
              previousServerLabel: input.replace ? (existing?.label ?? null) : null,
              previousDefaultDirectory: input.replace ? (existing?.defaultDirectory ?? null) : null,
              previousActiveServerKey,
              previousEnvironmentId: previousManaged?.environmentId ?? null,
              previousDeviceId: previousManaged?.deviceId ?? null,
              previousProofKeyThumbprint: previousManaged?.proofKeyThumbprint ?? null,
            },
            pairingOperations(isCurrent, attempt.controller),
          );
        },
      );
    },
    [beginPairingAttempt, pairingOperations, runPairingAttempt],
  );

  const retry = React.useCallback(
    async (requested?: OpenCodeServerKey): Promise<void> => {
      const server = requested ?? activeServerKeyRef.current;
      if (server === null) return;
      if (serverRemovalsRef.current.has(server)) return;
      const stored = storedRef.current.get(server);
      if (stored === undefined) return;
      if (stored.environmentId !== null && stored.environmentId !== undefined) {
        updateServer(
          serverDescriptor(stored),
          stored,
          "remote-setup",
          new ManagedCredentialUpgradeRequiredError().message,
        );
        return;
      }
      const password = await readCredential(stored.origin);
      if (password === null) {
        updateServer(
          serverDescriptor(stored),
          stored,
          "unauthorized",
          "Honk can’t find the saved password for this computer.",
        );
        return;
      }
      await superviseServer(stored, password);
    },
    [superviseServer, updateServer],
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
      await removeSavedServer(server, stored.origin);
    },
    [removeSavedServer],
  );

  const setDefaultDirectory = React.useCallback(
    async (server: OpenCodeServerKey, directory: string): Promise<void> => {
      if (serverRemovalsRef.current.has(server)) return;
      await storageQueue.run(async () => {
        if (serverRemovalsRef.current.has(server)) return;
        const stored = storedRef.current.get(server);
        if (stored === undefined) return;
        const next: StoredServer = { ...stored, defaultDirectory: directory.trim() };
        const servers = new Map(storedRef.current);
        servers.set(server, next);
        await writeRegistry(servers, activeServerKeyRef.current);
        storedRef.current = servers;
        const current = serverStateRef.current.get(server);
        if (current !== undefined) {
          serverStateRef.current.set(server, {
            ...current,
            defaultDirectory: next.defaultDirectory,
          });
        }
        publish();
      });
    },
    [publish, storageQueue, writeRegistry],
  );

  const selectServer = React.useCallback(
    (server: OpenCodeServerKey): void => {
      if (serverRemovalsRef.current.has(server)) return;
      void storageQueue
        .run(async () => {
          if (serverRemovalsRef.current.has(server) || !storedRef.current.has(server)) return;
          await writeRegistry(storedRef.current, server);
          activeServerKeyRef.current = server;
          publish();
        })
        .catch((error: unknown) => publish(errorMessage(error)));
    },
    [publish, storageQueue, writeRegistry],
  );

  const activeServer =
    view.activeServerKey === null
      ? null
      : (view.servers.find((server) => server.descriptor.key === view.activeServerKey) ?? null);
  const subscribeEvents = (
    server: OpenCodeServerKey,
    listener: (event: OpenCodeEvent) => void,
  ): (() => void) => {
    const listeners = eventListenersRef.current.get(server) ?? new Set();
    listeners.add(listener);
    eventListenersRef.current.set(server, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) eventListenersRef.current.delete(server);
    };
  };

  const value: RemoteContextValue = {
    ...view,
    activeServer,
    client: view.activeServerKey === null ? null : registry.get(view.activeServerKey),
    hasCredential: view.servers.length > 0,
    clientFor: (server) => registry.get(server),
    subscribeEvents,
    selectServer,
    connect,
    pair,
    retryPendingPairing,
    cancelPendingPairing,
    acknowledgePairingOutcome,
    retry,
    refreshSessions,
    disconnect,
    setDefaultDirectory,
  };

  return <RemoteContext.Provider value={value}>{children}</RemoteContext.Provider>;
}
