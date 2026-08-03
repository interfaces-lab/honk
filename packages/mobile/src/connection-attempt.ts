export function beginConnectionAttempt<Key>(attempts: Map<Key, number>, key: Key): number {
  const attempt = (attempts.get(key) ?? 0) + 1;
  attempts.set(key, attempt);
  return attempt;
}

export function invalidateConnectionAttempt<Key>(attempts: Map<Key, number>, key: Key): void {
  attempts.set(key, (attempts.get(key) ?? 0) + 1);
}

export function isCurrentConnectionAttempt<Key>(
  attempts: ReadonlyMap<Key, number>,
  key: Key,
  attempt: number,
): boolean {
  return attempts.get(key) === attempt;
}

export async function probeConnectionCandidate(operations: {
  readonly probe: () => Promise<void>;
  readonly isCurrent: () => boolean;
  readonly close: () => void;
  readonly commit: () => Promise<void>;
}): Promise<"committed" | "stale"> {
  try {
    await operations.probe();
  } catch (error) {
    operations.close();
    if (!operations.isCurrent()) return "stale";
    throw error;
  }
  if (!operations.isCurrent()) {
    operations.close();
    return "stale";
  }
  await operations.commit();
  return "committed";
}
