import {
  cancelHonkPairing,
  confirmHonkPairing,
  createOpenCodeServer,
  exchangeHonkPairing,
  revokeHonkConnection,
  type HonkProvisionalConnection,
  type OpenCodeClient,
  type OpenCodeServerDescriptor,
  type OpenCodeServerKey,
} from "@honk/opencode";

import {
  canPersistRemoteCredential,
  protectRemoteCredential,
  revealRemoteCredential,
} from "./desktop-bridge";
import type { StoredRemoteServer } from "./server-registry";
import type { AdapterWatchStatus } from "./watch-registry";

export type RemoteServerStatus = AdapterWatchStatus | "credential-missing" | "failed";

export type RemoteServerState = {
  readonly record: StoredRemoteServer;
  readonly descriptor: OpenCodeServerDescriptor;
  readonly client: OpenCodeClient | null;
  readonly status: RemoteServerStatus;
  readonly error: string | null;
};

export type PendingPairingSecret =
  | { readonly phase: "exchange"; readonly token: string }
  | { readonly phase: "confirm"; readonly provisional: HonkProvisionalConnection };

type PairingTransactionHost = {
  readonly states: Map<OpenCodeServerKey, RemoteServerState>;
  readonly selected: () => OpenCodeServerKey | null;
  readonly getMemoryCredential: (server: OpenCodeServerKey) => string | null;
  readonly persist: (
    states: ReadonlyMap<OpenCodeServerKey, RemoteServerState>,
    selected: OpenCodeServerKey | null,
  ) => string | null;
  readonly publish: () => void;
  readonly nextGeneration: (server: OpenCodeServerKey) => number;
  readonly isCurrentGeneration: (server: OpenCodeServerKey, generation: number) => boolean;
  readonly connectRecord: (
    record: StoredRemoteServer,
    credential: string,
  ) => Promise<RemoteServerState>;
  readonly activateConnectedState: (
    state: RemoteServerState,
    credential: string,
    selected: OpenCodeServerKey | null,
    selectOnSuccess: boolean,
  ) => void;
  readonly forgetRemoteServer: (
    server: OpenCodeServerKey,
    state: RemoteServerState,
  ) => string | null;
  readonly updateRemoteState: (
    server: OpenCodeServerKey,
    update: Pick<RemoteServerState, "client" | "status" | "error">,
  ) => void;
};

export function createServerPairingTransactions(host: PairingTransactionHost) {
  const secrets = new Map<OpenCodeServerKey, PendingPairingSecret>();
  const pairingOperations = new Map<OpenCodeServerKey, Promise<void>>();
  const removalOperations = new Map<OpenCodeServerKey, Promise<void>>();

  async function connect(
    descriptor: OpenCodeServerDescriptor,
    label: string,
    requestedSecret: PendingPairingSecret,
    existingState: RemoteServerState | undefined,
    selectOnSuccess: boolean,
  ): Promise<void> {
    const running = pairingOperations.get(descriptor.key);
    if (running !== undefined) return running;
    const generation = host.nextGeneration(descriptor.key);

    const operation = (async () => {
      const state = existingState ?? (await stage(descriptor, label, requestedSecret));
      if (!host.isCurrentGeneration(descriptor.key, generation)) return;
      const pending = state.record.pendingPairing;
      if (pending === null) {
        throw new Error("This server is already connected. Select it from the server list.");
      }
      const secret = secrets.get(descriptor.key) ?? requestedSecret;
      const provisional =
        secret.phase === "confirm"
          ? secret.provisional
          : await exchangeHonkPairing(descriptor.origin, secret.token, {
              requestId: pending.requestId,
              label: "Honk desktop",
            });
      if (!host.isCurrentGeneration(descriptor.key, generation)) {
        await discard(descriptor.key, provisional);
        return;
      }
      secrets.set(descriptor.key, { phase: "confirm", provisional });

      const persistentCredentialsAvailable = canPersistRemoteCredential();
      const protectedCredential =
        pending.phase === "confirm" &&
        secret.phase === "confirm" &&
        pending.protectedCredential !== null
          ? pending.protectedCredential
          : persistentCredentialsAvailable
            ? await protectRemoteCredential(provisional.password)
            : null;
      if (persistentCredentialsAvailable && protectedCredential === null) {
        throw new Error("Honk could not protect the pending computer password.");
      }
      if (!host.isCurrentGeneration(descriptor.key, generation)) {
        await discard(descriptor.key, provisional);
        return;
      }
      const confirmationState: RemoteServerState = {
        ...state,
        record: {
          ...state.record,
          pendingPairing: {
            phase: "confirm",
            requestId: provisional.requestId,
            expiresAt: provisional.expiresAt,
            protectedCredential,
          },
        },
        status: "connecting",
        error: null,
      };
      const confirmationStates = new Map(host.states);
      confirmationStates.set(descriptor.key, confirmationState);
      const confirmationPersistenceError = host.persist(confirmationStates, host.selected());
      if (confirmationPersistenceError !== null) {
        throw new Error(confirmationPersistenceError);
      }
      host.states.set(descriptor.key, confirmationState);
      host.publish();

      if (!host.isCurrentGeneration(descriptor.key, generation)) {
        await discard(descriptor.key, provisional);
        return;
      }

      const connection = await confirmHonkPairing(provisional);
      if (!host.isCurrentGeneration(descriptor.key, generation)) {
        await discard(descriptor.key, provisional, connection);
        return;
      }
      const finalRecord: StoredRemoteServer = {
        origin: connection.origin,
        label: state.record.label,
        protectedCredential,
        pendingPairing: null,
        paired: true,
        removing: false,
      };
      const finalDescriptor = descriptorFromRecord(finalRecord);
      const connected = await host.connectRecord(finalRecord, connection.password);
      if (!host.isCurrentGeneration(descriptor.key, generation)) {
        connected.client?.close();
        await discard(descriptor.key, provisional, connection);
        return;
      }
      const finalStates = new Map(host.states);
      finalStates.set(finalDescriptor.key, connected);
      const nextSelected = selectOnSuccess ? finalDescriptor.key : host.selected();
      const finalPersistenceError = host.persist(finalStates, nextSelected);
      if (finalPersistenceError !== null) {
        connected.client?.close();
        throw new Error(finalPersistenceError);
      }
      if (!host.isCurrentGeneration(descriptor.key, generation)) {
        connected.client?.close();
        await discard(descriptor.key, provisional, connection);
        return;
      }
      secrets.delete(finalDescriptor.key);
      host.activateConnectedState(connected, connection.password, nextSelected, selectOnSuccess);
    })().catch((cause: unknown) => {
      if (host.isCurrentGeneration(descriptor.key, generation)) {
        const state = host.states.get(descriptor.key);
        if (state !== undefined) {
          host.updateRemoteState(descriptor.key, {
            client: state.client,
            status: "failed",
            error: messageOf(cause, "Honk could not finish connecting this server."),
          });
        }
      }
      throw cause;
    });

    pairingOperations.set(descriptor.key, operation);
    try {
      await operation;
    } finally {
      if (pairingOperations.get(descriptor.key) === operation) {
        pairingOperations.delete(descriptor.key);
      }
    }
  }

  async function finishRemoval(server: OpenCodeServerKey): Promise<void> {
    const running = removalOperations.get(server);
    if (running !== undefined) return running;

    const operation = (async () => {
      const state = host.states.get(server);
      if (state === undefined || !state.record.removing) return;
      const pending = state.record.pendingPairing;
      if (pending !== null) {
        const secret = await readSecret(server, state.record);
        if (secret === null) {
          throw new Error("Reconnect this computer to finish removing access.");
        }
        const provisional =
          secret.phase === "confirm"
            ? secret.provisional
            : await exchangeHonkPairing(state.descriptor.origin, secret.token, {
                requestId: pending.requestId,
                label: "Honk desktop",
              });
        if (secret.phase === "exchange") {
          const persistentCredentialsAvailable = canPersistRemoteCredential();
          const protectedCredential = persistentCredentialsAvailable
            ? await protectRemoteCredential(provisional.password)
            : null;
          if (persistentCredentialsAvailable && protectedCredential === null) {
            throw new Error("Honk could not protect the pending computer password.");
          }
          const confirmationState: RemoteServerState = {
            ...state,
            record: {
              ...state.record,
              pendingPairing: {
                phase: "confirm",
                requestId: provisional.requestId,
                expiresAt: provisional.expiresAt,
                protectedCredential,
              },
            },
          };
          const confirmationStates = new Map(host.states);
          confirmationStates.set(server, confirmationState);
          const persistenceError = host.persist(confirmationStates, host.selected());
          if (persistenceError !== null) throw new Error(persistenceError);
          host.states.set(server, confirmationState);
          secrets.set(server, { phase: "confirm", provisional });
          host.publish();
        }
        await cancelHonkPairing(provisional);
      } else {
        const credential =
          host.getMemoryCredential(server) ??
          (state.record.protectedCredential === null
            ? null
            : await revealRemoteCredential(state.record.protectedCredential));
        if (credential === null || credential.length === 0) {
          throw new Error("Reconnect this computer to finish removing access.");
        }
        await revokeHonkConnection({ origin: state.record.origin, password: credential });
      }

      const current = host.states.get(server);
      if (current === undefined || !current.record.removing) return;
      const persistenceError = host.forgetRemoteServer(server, current);
      if (persistenceError !== null) throw new Error(persistenceError);
    })().catch((cause: unknown) => {
      const state = host.states.get(server);
      if (state?.record.removing) {
        host.updateRemoteState(server, {
          client: null,
          status: "failed",
          error: messageOf(cause, "Finish removing access from this computer."),
        });
      }
      throw cause;
    });

    removalOperations.set(server, operation);
    try {
      await operation;
    } finally {
      if (removalOperations.get(server) === operation) removalOperations.delete(server);
    }
  }

  async function readSecret(
    server: OpenCodeServerKey,
    record: StoredRemoteServer,
  ): Promise<PendingPairingSecret | null> {
    const inMemory = secrets.get(server);
    if (inMemory !== undefined) return inMemory;
    const pending = record.pendingPairing;
    if (pending?.protectedCredential === null || pending === null) return null;
    const credential = await revealRemoteCredential(pending.protectedCredential);
    if (credential === null || credential.length === 0) return null;
    const secret: PendingPairingSecret =
      pending.phase === "exchange"
        ? { phase: "exchange", token: credential }
        : {
            phase: "confirm",
            provisional: {
              // Stored pairing records do not persist the device id; confirmation
              // tolerates null and reconciles against the server.
              deviceId: null,
              origin: record.origin,
              password: credential,
              requestId: pending.requestId,
              expiresAt: pending.expiresAt,
            },
          };
    secrets.set(server, secret);
    return secret;
  }

  async function stage(
    descriptor: OpenCodeServerDescriptor,
    label: string,
    secret: PendingPairingSecret,
  ): Promise<RemoteServerState> {
    if (secret.phase !== "exchange") throw new Error("The pending pairing state is invalid.");
    const persistentCredentialsAvailable = canPersistRemoteCredential();
    const protectedCredential = persistentCredentialsAvailable
      ? await protectRemoteCredential(secret.token)
      : null;
    if (persistentCredentialsAvailable && protectedCredential === null) {
      throw new Error("Honk could not protect this connection code.");
    }
    const record: StoredRemoteServer = {
      origin: descriptor.origin,
      label,
      protectedCredential: null,
      pendingPairing: {
        phase: "exchange",
        requestId: crypto.randomUUID(),
        protectedCredential,
      },
      paired: true,
      removing: false,
    };
    const pending: RemoteServerState = {
      record,
      descriptor,
      client: null,
      status: "connecting",
      error: null,
    };
    const nextStates = new Map(host.states);
    nextStates.set(descriptor.key, pending);
    const persistenceError = host.persist(nextStates, host.selected());
    if (persistenceError !== null) throw new Error(persistenceError);
    host.states.set(descriptor.key, pending);
    secrets.set(descriptor.key, secret);
    host.publish();
    return pending;
  }

  async function discard(
    server: OpenCodeServerKey,
    provisional: HonkProvisionalConnection,
    connection?: { readonly origin: string; readonly password: string },
  ): Promise<void> {
    if (host.states.get(server)?.record.removing) {
      await finishRemoval(server).catch(() => undefined);
      if (connection !== undefined) await revokeHonkConnection(connection).catch(() => undefined);
      return;
    }
    await (
      connection === undefined ? cancelHonkPairing(provisional) : revokeHonkConnection(connection)
    ).catch(() => undefined);
  }

  return {
    connect,
    finishRemoval,
    readSecret,
    forget(server: OpenCodeServerKey): void {
      secrets.delete(server);
    },
  } as const;
}

export function descriptorFromRecord(record: StoredRemoteServer): OpenCodeServerDescriptor {
  return createOpenCodeServer({
    origin: record.origin,
    ...(record.label.length > 0 ? { label: record.label } : {}),
    kind: "remote",
  });
}

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim().length > 0 ? cause.message : fallback;
}
