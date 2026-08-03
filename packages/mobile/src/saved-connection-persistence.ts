export interface SavedConnectionSnapshot<Key, Value> {
  readonly servers: ReadonlyMap<Key, Value>;
  readonly activeServerKey: Key | null;
  readonly credential: string | null;
}

export interface SavedConnectionTransaction<Key, Value> {
  readonly serverKey: Key;
  readonly target: "candidate" | "previous";
  readonly previous: SavedConnectionSnapshot<Key, Value>;
  readonly candidate: SavedConnectionSnapshot<Key, Value> & { readonly credential: string };
}

export interface SavedConnectionTransactionOperations<Key, Value> {
  readonly writeCredential: (credential: string) => Promise<void>;
  readonly deleteCredential: () => Promise<void>;
  readonly writeRegistry: (
    servers: ReadonlyMap<Key, Value>,
    activeServerKey: Key | null,
  ) => Promise<void>;
  readonly writeTransaction: (transaction: SavedConnectionTransaction<Key, Value>) => Promise<void>;
  readonly clearTransaction: () => Promise<void>;
}

export interface SavedConnectionPersistence<Key, Value> {
  readonly servers: ReadonlyMap<Key, Value>;
  readonly activeServerKey: Key;
  readonly restore: () => Promise<void>;
}

export async function persistSavedConnectionCandidate<Key, Value>(
  servers: ReadonlyMap<Key, Value>,
  activeServerKey: Key | null,
  serverKey: Key,
  server: Value,
  previousCredential: string | null,
  nextCredential: string,
  operations: SavedConnectionTransactionOperations<Key, Value>,
): Promise<SavedConnectionPersistence<Key, Value>> {
  const nextServers = new Map(servers);
  nextServers.set(serverKey, server);
  const transaction: SavedConnectionTransaction<Key, Value> = {
    serverKey,
    target: "candidate",
    previous: { servers, activeServerKey, credential: previousCredential },
    candidate: {
      servers: nextServers,
      activeServerKey: serverKey,
      credential: nextCredential,
    },
  };

  // The marker must land before either snapshot changes, and it is cleared only after the
  // credential and registry for one side are both durable.
  await operations.writeTransaction(transaction);
  try {
    await persistSavedConnectionSnapshot(transaction.candidate, operations);
    await operations.clearTransaction();
  } catch (cause) {
    try {
      await restoreSavedConnectionTransaction(transaction, operations);
    } catch (rollbackCause) {
      throw new AggregateError(
        [cause, rollbackCause],
        "The connection registry failed and its saved password could not be restored.",
      );
    }
    throw cause;
  }
  return {
    servers: nextServers,
    activeServerKey: serverKey,
    restore: async () => {
      await restoreSavedConnectionTransaction(transaction, operations);
    },
  };
}

export async function resolveSavedConnectionTransaction<Key, Value>(
  transaction: SavedConnectionTransaction<Key, Value>,
  servers: ReadonlyMap<Key, Value>,
  activeServerKey: Key | null,
  operations: SavedConnectionTransactionOperations<Key, Value> & {
    readonly isSameRegistry: (
      leftServers: ReadonlyMap<Key, Value>,
      leftActiveServerKey: Key | null,
      rightServers: ReadonlyMap<Key, Value>,
      rightActiveServerKey: Key | null,
    ) => boolean;
  },
): Promise<SavedConnectionSnapshot<Key, Value>> {
  // A registry that already matches the candidate proves the forward write completed, so the
  // adoption finishes; every other state rolls back to the previous snapshot.
  if (
    transaction.target === "candidate" &&
    operations.isSameRegistry(
      servers,
      activeServerKey,
      transaction.candidate.servers,
      transaction.candidate.activeServerKey,
    )
  ) {
    await persistSavedConnectionSnapshot(transaction.candidate, operations);
    await operations.clearTransaction();
    return transaction.candidate;
  }
  return restoreSavedConnectionTransaction(transaction, operations);
}

async function restoreSavedConnectionTransaction<Key, Value>(
  transaction: SavedConnectionTransaction<Key, Value>,
  operations: SavedConnectionTransactionOperations<Key, Value>,
): Promise<SavedConnectionSnapshot<Key, Value>> {
  const rollback: SavedConnectionTransaction<Key, Value> = {
    ...transaction,
    target: "previous",
  };
  // Persisting the rollback decision first makes every later rollback write safe to repeat.
  await operations.writeTransaction(rollback);
  await persistSavedConnectionSnapshot(rollback.previous, operations);
  await operations.clearTransaction();
  return rollback.previous;
}

async function persistSavedConnectionSnapshot<Key, Value>(
  snapshot: SavedConnectionSnapshot<Key, Value>,
  operations: SavedConnectionTransactionOperations<Key, Value>,
): Promise<void> {
  if (snapshot.credential === null) await operations.deleteCredential();
  if (snapshot.credential !== null) await operations.writeCredential(snapshot.credential);
  await operations.writeRegistry(snapshot.servers, snapshot.activeServerKey);
}
