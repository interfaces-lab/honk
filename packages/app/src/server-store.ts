import {
  createOpenCodeClient,
  createOpenCodeServer,
  normalizeRemoteOpenCodeOrigin,
  parseOpenCodeConnection,
  type OpenCodeServerDescriptor,
  type OpenCodeServerKey,
} from "@honk/opencode";
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
import {
  readRemoteServerRegistry,
  writeRemoteServerRegistry,
  type StoredRemoteServer,
} from "./server-registry";
import {
  createServerPairingTransactions,
  descriptorFromRecord,
  type RemoteServerState,
  type RemoteServerStatus,
} from "./server-pairing-transaction";
import { actions as tabActions } from "./tab-store";
import {
  getOpenCodeClient,
  getOpenCodeServersSnapshot,
  registerOpenCodeClient,
  selectOpenCodeServer,
  subscribeOpenCodeServers,
  unregisterOpenCodeClient,
} from "./watch-registry";

export type OpenCodeServerConnection = {
  readonly server: OpenCodeServerDescriptor;
  readonly status: RemoteServerStatus;
  readonly selected: boolean;
  readonly removable: boolean;
  readonly removing: boolean;
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
const serverGenerations = new Map<OpenCodeServerKey, number>();
const restored = readRemoteServerRegistry();
const remoteStates = new Map<OpenCodeServerKey, RemoteServerState>(
  restored.servers.map((record) => {
    const descriptor = descriptorFromRecord(record);
    return [
      descriptor.key,
      {
        record,
        descriptor,
        client: null,
        status:
          record.removing ||
          record.pendingPairing?.protectedCredential === null ||
          (record.pendingPairing === null && record.protectedCredential === null)
            ? record.removing
              ? "failed"
              : "credential-missing"
            : "connecting",
        error: record.removing
          ? "Finish removing access from this computer."
          : record.pendingPairing?.protectedCredential === null
            ? "Paste the same connection link to resume connecting."
            : record.pendingPairing === null && record.protectedCredential === null
              ? "Reconnect this server to restore its saved password."
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
const pairingTransactions = createServerPairingTransactions({
  states: remoteStates,
  selected: () => selectedRemote,
  getMemoryCredential: (server) => memoryCredentials.get(server) ?? null,
  persist: persistRegistry,
  publish,
  nextGeneration: nextServerGeneration,
  isCurrentGeneration: isCurrentServerGeneration,
  connectRecord,
  activateConnectedState: activatePairedServer,
  forgetRemoteServer,
  updateRemoteState,
});

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
      throw new Error("Enter a server address and its connection link or computer password.");
    }
    const candidateOrigin = normalizeRemoteOpenCodeOrigin(candidate.origin);
    const label = input.label?.trim() ?? "";
    const candidateDescriptor = createOpenCodeServer({
      origin: candidateOrigin,
      ...(label.length > 0 ? { label } : {}),
      kind: "remote",
    });
    const existingState = remoteStates.get(candidateDescriptor.key);
    const existingClient = getOpenCodeClient(candidateDescriptor.key);
    if (existingState?.record.removing) {
      throw new Error("Finish removing access before connecting this server again.");
    }
    if (candidate.credential.type === "pairing") {
      if (
        (existingState !== undefined && existingState.record.pendingPairing === null) ||
        (existingClient !== null && existingState?.client !== existingClient)
      ) {
        throw new Error("This server is already connected. Select it from the server list.");
      }
      await pairingTransactions.connect(
        candidateDescriptor,
        label,
        { phase: "exchange", token: candidate.credential.value },
        existingState,
        true,
      );
      return;
    }

    const connection = { origin: candidateOrigin, password: candidate.credential.value };
    const origin = normalizeRemoteOpenCodeOrigin(connection.origin);
    const descriptor = createOpenCodeServer({
      origin,
      ...(label.length > 0 ? { label } : {}),
      kind: "remote",
    });
    const directClient = getOpenCodeClient(descriptor.key);
    const directState = remoteStates.get(descriptor.key);
    if (directClient !== null && directState?.client !== directClient) {
      throw new Error("This server is already open in Honk.");
    }

    const draftRecord: StoredRemoteServer = {
      origin,
      label,
      protectedCredential: null,
      pendingPairing: null,
      paired: false,
      removing: false,
    };
    const generation = nextServerGeneration(descriptor.key);
    const connected = await connectRecord(draftRecord, connection.password);
    if (!isCurrentServerGeneration(descriptor.key, generation)) {
      connected.client?.close();
      return;
    }

    const persistence = canPersistRemoteCredential()
      ? await protectRemoteCredential(connection.password).then(
          (protectedCredential) => ({ protectedCredential, error: null }),
          (cause: unknown) => ({
            protectedCredential: null,
            error: messageOf(cause, "This server is connected for this launch only."),
          }),
        )
      : { protectedCredential: null, error: null };
    if (!isCurrentServerGeneration(descriptor.key, generation)) {
      connected.client?.close();
      return;
    }

    const record: StoredRemoteServer = {
      ...draftRecord,
      protectedCredential: persistence.protectedCredential,
    };
    const nextState: RemoteServerState = {
      ...connected,
      record,
      error: persistence.error,
    };
    const nextStates = new Map(remoteStates);
    nextStates.set(descriptor.key, nextState);
    const registryError = persistRegistry(nextStates, descriptor.key);
    if (registryError !== null) {
      connected.client?.close();
      if (directState !== undefined) {
        updateRemoteState(descriptor.key, {
          client: directState.client,
          status: directState.status,
          error: registryError,
        });
      }
      throw new Error(registryError);
    }
    commitConnectedState(nextState);
    memoryCredentials.set(descriptor.key, connection.password);
    selectedRemote = descriptor.key;
    tabActions.registerServer(descriptor);
    selectOpenCodeServer(descriptor.key);
    publish();
  },

  async retry(server: OpenCodeServerKey): Promise<void> {
    const state = remoteStates.get(server);
    if (state === undefined) return;
    if (state.record.removing) {
      await pairingTransactions.finishRemoval(server);
      return;
    }
    if (state.record.pendingPairing !== null) {
      const secret = await pairingTransactions.readSecret(server, state.record);
      if (secret === null) {
        updateRemoteState(server, {
          client: state.client,
          status: "credential-missing",
          error: "Paste the same connection link to resume connecting.",
        });
        return;
      }
      await pairingTransactions.connect(state.descriptor, state.record.label, secret, state, true);
      return;
    }
    const generation = nextServerGeneration(server);
    let credential = memoryCredentials.get(server) ?? null;
    if (credential === null && state.record.protectedCredential !== null) {
      try {
        credential = await revealRemoteCredential(state.record.protectedCredential);
      } catch (cause) {
        updateRemoteState(server, {
          client: null,
          status: "failed",
          error: messageOf(cause, "The saved computer password could not be read."),
        });
        return;
      }
    }
    if (!isCurrentServerGeneration(server, generation)) return;
    if (credential === null || credential.length === 0) {
      updateRemoteState(server, {
        client: null,
        status: "credential-missing",
        error: "Reconnect this server to restore its saved password.",
      });
      return;
    }
    let connected: RemoteServerState;
    try {
      connected = await connectRecord(state.record, credential);
    } catch (cause) {
      if (state.client === null) {
        updateRemoteState(server, {
          client: null,
          status: "failed",
          error: messageOf(cause, "Honk could not reach this server."),
        });
      }
      throw cause;
    }
    if (!isCurrentServerGeneration(server, generation)) {
      connected.client?.close();
      return;
    }
    commitConnectedState(connected);
    memoryCredentials.set(server, credential);
    tabActions.registerServer(connected.descriptor);
    if (selectedRemote === server) selectOpenCodeServer(server);
    publish();
  },

  select(server: OpenCodeServerKey): void {
    if (!getOpenCodeServersSnapshot().servers.some((item) => item.server.key === server)) return;
    const nextSelected = remoteStates.has(server) ? server : null;
    const persistenceError = persistRegistry(remoteStates, nextSelected);
    if (persistenceError !== null) {
      updateRemoteState(server, {
        client: remoteStates.get(server)?.client ?? null,
        status: remoteStates.get(server)?.status ?? "failed",
        error: persistenceError,
      });
      return;
    }
    if (!selectOpenCodeServer(server)) return;
    selectedRemote = nextSelected;
    publish();
  },

  remove(server: OpenCodeServerKey): void {
    const state = remoteStates.get(server);
    if (state === undefined) return;
    if (state.record.removing) {
      void pairingTransactions.finishRemoval(server).catch(() => undefined);
      return;
    }
    if (state.record.paired || state.record.pendingPairing !== null) {
      const removingState: RemoteServerState = {
        ...state,
        record: { ...state.record, removing: true },
        status: "connecting",
        error: null,
      };
      const removingStates = new Map(remoteStates);
      removingStates.set(server, removingState);
      const nextSelected = selectedRemote === server ? null : selectedRemote;
      const persistenceError = persistRegistry(removingStates, nextSelected);
      if (persistenceError !== null) {
        updateRemoteState(server, {
          client: state.client,
          status: state.status,
          error: persistenceError,
        });
        return;
      }
      nextServerGeneration(server);
      stopRemoteState(state);
      remoteStates.set(server, { ...removingState, client: null });
      tabActions.removeServer(server);
      if (selectedRemote === server) {
        selectedRemote = null;
        const fallback = getOpenCodeServersSnapshot().servers.find(
          (item) => !remoteStates.has(item.server.key),
        );
        if (fallback !== undefined) selectOpenCodeServer(fallback.server.key);
      }
      publish();
      void pairingTransactions.finishRemoval(server).catch(() => undefined);
      return;
    }
    forgetRemoteServer(server, state);
  },

  forget(server: OpenCodeServerKey): void {
    const state = remoteStates.get(server);
    if (state === undefined) return;
    forgetRemoteServer(server, state);
  },
} as const;

function forgetRemoteServer(server: OpenCodeServerKey, state: RemoteServerState): string | null {
  const nextStates = new Map(remoteStates);
  nextStates.delete(server);
  const nextSelected = selectedRemote === server ? null : selectedRemote;
  const persistenceError = persistRegistry(nextStates, nextSelected);
  if (persistenceError !== null) {
    updateRemoteState(server, {
      client: state.client,
      status: state.status,
      error: persistenceError,
    });
    return persistenceError;
  }
  nextServerGeneration(server);
  stopRemoteState(state);
  remoteStates.delete(server);
  memoryCredentials.delete(server);
  pairingTransactions.forget(server);
  tabActions.removeServer(server);
  if (selectedRemote === server) {
    selectedRemote = null;
    const fallback = getOpenCodeServersSnapshot().servers.find(
      (item) => !remoteStates.has(item.server.key),
    );
    if (fallback !== undefined) selectOpenCodeServer(fallback.server.key);
  }
  publish();
  return null;
}

async function restoreRemoteServers(): Promise<void> {
  if (restoreStarted) return;
  restoreStarted = true;
  restoring = true;
  publish();
  await Promise.all(
    [...remoteStates.entries()].map(async ([server, state]) => {
      if (state.record.removing) {
        try {
          await pairingTransactions.finishRemoval(server);
        } catch {
          // The retained cleanup record keeps access removal retryable.
        }
        return;
      }
      if (state.record.pendingPairing !== null) {
        try {
          const secret = await pairingTransactions.readSecret(server, state.record);
          if (secret === null) {
            updateRemoteState(server, {
              client: null,
              status: "credential-missing",
              error: "Paste the same connection link to resume connecting.",
            });
            return;
          }
          await pairingTransactions.connect(
            state.descriptor,
            state.record.label,
            secret,
            state,
            false,
          );
        } catch (cause) {
          updateRemoteState(server, {
            client: state.client,
            status: "failed",
            error: messageOf(cause, "Honk could not resume pairing this server."),
          });
        }
        return;
      }
      const protectedCredential = state.record.protectedCredential;
      if (protectedCredential === null) return;
      const generation = nextServerGeneration(server);
      try {
        const credential = await revealRemoteCredential(protectedCredential);
        if (!isCurrentServerGeneration(server, generation)) return;
        if (credential === null || credential.length === 0) {
          updateRemoteState(server, {
            client: null,
            status: "credential-missing",
            error: "Reconnect this server to restore its saved password.",
          });
          return;
        }
        const connected = await connectRecord(state.record, credential);
        if (!isCurrentServerGeneration(server, generation)) {
          connected.client?.close();
          return;
        }
        commitConnectedState(connected);
        memoryCredentials.set(server, credential);
        tabActions.registerServer(connected.descriptor);
      } catch (cause) {
        updateRemoteState(server, {
          client: null,
          status: "failed",
          error: messageOf(cause, "Honk could not restore this server."),
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
  const client = createOpenCodeClient(descriptor, { password: credential });
  try {
    await client.health();
  } catch (cause) {
    client.close();
    throw cause;
  }
  return {
    record,
    descriptor,
    client,
    status: "live",
    error: null,
  };
}

function commitConnectedState(state: RemoteServerState): void {
  const previous = remoteStates.get(state.descriptor.key);
  if (previous !== undefined) stopRemoteState(previous);
  if (state.client !== null) registerOpenCodeClient(state.client);
  remoteStates.set(state.descriptor.key, state);
}

function activatePairedServer(
  state: RemoteServerState,
  credential: string,
  selected: OpenCodeServerKey | null,
  selectOnSuccess: boolean,
): void {
  commitConnectedState(state);
  memoryCredentials.set(state.descriptor.key, credential);
  selectedRemote = selected;
  tabActions.registerServer(state.descriptor);
  if (selectOnSuccess) selectOpenCodeServer(state.descriptor.key);
  publish();
}

function nextServerGeneration(server: OpenCodeServerKey): number {
  const generation = (serverGenerations.get(server) ?? 0) + 1;
  serverGenerations.set(server, generation);
  return generation;
}

function isCurrentServerGeneration(server: OpenCodeServerKey, generation: number): boolean {
  return serverGenerations.get(server) === generation;
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
      removing: remote?.record.removing ?? false,
      persistent:
        remote !== undefined &&
        (remote.record.protectedCredential !== null ||
          remote.record.pendingPairing?.protectedCredential != null),
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
        removing: remote.record.removing,
        persistent:
          remote.record.protectedCredential !== null ||
          remote.record.pendingPairing?.protectedCredential != null,
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

function persistRegistry(
  states: ReadonlyMap<OpenCodeServerKey, RemoteServerState> = remoteStates,
  selected: OpenCodeServerKey | null = selectedRemote,
): string | null {
  return writeRemoteServerRegistry({
    selectedRemoteOrigin: selected === null ? null : (states.get(selected)?.record.origin ?? null),
    servers: [...states.values()].map((state) => state.record),
  });
}

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim().length > 0 ? cause.message : fallback;
}
