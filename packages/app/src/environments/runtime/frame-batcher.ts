export interface FrameBatcher<T> {
  enqueue: (item: T) => void;
  flush: () => void;
  cancel: () => void;
}

export function createFrameBatcher<T>({
  flush,
  timeoutMs,
}: {
  flush: (items: ReadonlyArray<T>) => void;
  timeoutMs: number;
}): FrameBatcher<T> {
  let items: T[] = [];
  let animationFrameId: number | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const clearScheduledFlush = () => {
    if (
      animationFrameId !== null &&
      typeof globalThis.cancelAnimationFrame === "function"
    ) {
      globalThis.cancelAnimationFrame(animationFrameId);
    }
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    animationFrameId = null;
    timeoutId = null;
  };

  const flushNow = () => {
    const batch = items;
    items = [];
    clearScheduledFlush();
    if (batch.length > 0) {
      flush(batch);
    }
  };

  const scheduleFlush = () => {
    if (animationFrameId !== null || timeoutId !== null) {
      return;
    }
    if (typeof globalThis.requestAnimationFrame === "function") {
      animationFrameId = globalThis.requestAnimationFrame(flushNow);
    }
    timeoutId = setTimeout(flushNow, timeoutMs);
  };

  return {
    enqueue: (item) => {
      items.push(item);
      scheduleFlush();
    },
    flush: flushNow,
    cancel: () => {
      items = [];
      clearScheduledFlush();
    },
  };
}
