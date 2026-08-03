export type ConnectionEventRead<Event> =
  | { readonly kind: "event"; readonly event: Event }
  | { readonly kind: "closed" }
  | { readonly kind: "error"; readonly error: unknown }
  | { readonly kind: "stopped" }
  | { readonly kind: "timeout" };

// OpenCode sends a heartbeat every 30 seconds. The extra 15 seconds covers normal scheduling delay.
export const MOBILE_EVENT_HEARTBEAT_TIMEOUT_MS = 45_000;

export function readConnectionEvent<Event>(
  iterator: AsyncIterator<Event>,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<ConnectionEventRead<Event>> {
  if (signal.aborted) return Promise.resolve({ kind: "stopped" });
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: ConnectionEventRead<Event>): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", stop);
      resolve(result);
    };
    const stop = (): void => finish({ kind: "stopped" });
    const timeout = setTimeout(() => finish({ kind: "timeout" }), timeoutMs);
    signal.addEventListener("abort", stop, { once: true });
    void iterator.next().then(
      (result) => finish(result.done ? { kind: "closed" } : { kind: "event", event: result.value }),
      (error: unknown) => finish({ kind: "error", error }),
    );
  });
}
