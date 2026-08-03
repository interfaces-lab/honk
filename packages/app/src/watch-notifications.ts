export function createWatchNotificationBatcher(frameMs: number) {
  let depth = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const pending = new Set<ReadonlySet<() => void>>();

  function flush(): void {
    if (depth > 0) return;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (pending.size === 0) return;
    const listeners = new Set([...pending].flatMap((current) => [...current]));
    pending.clear();
    for (const listener of listeners) listener();
  }

  function schedule(): void {
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, frameMs);
  }

  const notify = (listeners: ReadonlySet<() => void>): void => {
    if (depth > 0) {
      pending.add(listeners);
      return;
    }
    for (const listener of listeners) listener();
  };

  const batch = (operation: () => void): void => {
    depth += 1;
    try {
      operation();
    } finally {
      depth -= 1;
      schedule();
    }
  };

  return {
    notify,
    batch,
    flush,
  };
}
