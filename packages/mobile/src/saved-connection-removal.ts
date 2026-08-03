export interface SavedConnectionRemoval<Key, Value> {
  readonly servers: ReadonlyMap<Key, Value>;
  readonly activeServerKey: Key | null;
}

export async function persistSavedConnectionRemoval<Key, Value>(
  servers: ReadonlyMap<Key, Value>,
  activeServerKey: Key | null,
  removedServerKey: Key,
  persist: (servers: ReadonlyMap<Key, Value>, activeServerKey: Key | null) => Promise<void>,
): Promise<SavedConnectionRemoval<Key, Value>> {
  const nextServers = new Map(servers);
  nextServers.delete(removedServerKey);
  const nextActiveServerKey =
    activeServerKey === removedServerKey
      ? (nextServers.keys().next().value ?? null)
      : activeServerKey;
  await persist(nextServers, nextActiveServerKey);
  return { servers: nextServers, activeServerKey: nextActiveServerKey };
}
