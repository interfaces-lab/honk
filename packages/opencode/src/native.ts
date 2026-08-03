import EventSource, {
  type ErrorEvent,
  type ExceptionEvent,
  type MessageEvent,
  type TimeoutEvent,
} from "react-native-sse";

import type { OpenCodeEventSourceFactory, OpenCodeEventSourceInput } from "./event-stream";

type QueueWaiter<T> = {
  readonly resolve: (result: IteratorResult<T>) => void;
  readonly reject: (error: unknown) => void;
};

class AsyncQueue<T> {
  readonly #values: T[] = [];
  readonly #waiters: QueueWaiter<T>[] = [];
  #closed = false;
  #failed = false;
  #failure: unknown;

  push(value: T): void {
    if (this.#closed || this.#failed) return;
    const waiter = this.#waiters.shift();
    if (waiter === undefined) {
      this.#values.push(value);
      return;
    }
    waiter.resolve({ done: false, value });
  }

  close(): void {
    if (this.#closed || this.#failed) return;
    this.#closed = true;
    for (const waiter of this.#waiters.splice(0)) {
      waiter.resolve({ done: true, value: undefined });
    }
  }

  fail(error: unknown): void {
    if (this.#closed || this.#failed) return;
    this.#failed = true;
    this.#failure = error;
    for (const waiter of this.#waiters.splice(0)) {
      waiter.reject(error);
    }
  }

  next(): Promise<IteratorResult<T>> {
    const value = this.#values.shift();
    if (value !== undefined) return Promise.resolve({ done: false, value });
    if (this.#failed) return Promise.reject(this.#failure);
    if (this.#closed) return Promise.resolve({ done: true, value: undefined });
    return new Promise<IteratorResult<T>>((resolve, reject) => {
      this.#waiters.push({ resolve, reject });
    });
  }
}

class OpenCodeEventStreamError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "OpenCodeEventStreamError";
    this.status = status;
  }
}

function errorFromEvent(event: ErrorEvent | TimeoutEvent | ExceptionEvent): Error {
  if (event.type === "error") {
    return new OpenCodeEventStreamError(
      event.message.trim().length > 0 ? event.message : "The OpenCode event stream failed.",
      event.xhrStatus,
    );
  }
  if (event.type === "exception") return event.error;
  return new Error("The OpenCode event stream timed out.");
}

async function createNativeOpenCodeEventSource(
  input: OpenCodeEventSourceInput,
): Promise<AsyncIterable<unknown>> {
  const queue = new AsyncQueue<unknown>();
  const source = new EventSource(input.url, {
    headers: { ...input.headers },
    pollingInterval: 0,
    timeoutBeforeConnection: 0,
  });
  let cleanedUp = false;

  const cleanup = (): void => {
    if (cleanedUp) return;
    cleanedUp = true;
    input.signal.removeEventListener("abort", onAbort);
    source.removeAllEventListeners();
    source.close();
  };

  const fail = (error: unknown): void => {
    queue.fail(error);
    cleanup();
  };

  const onAbort = (): void => {
    queue.close();
    cleanup();
  };

  const onMessage = (event: MessageEvent): void => {
    if (event.data === null) return;
    try {
      const parsed: unknown = JSON.parse(event.data);
      queue.push(parsed);
    } catch (error) {
      fail(error);
    }
  };

  const onError = (event: ErrorEvent | TimeoutEvent | ExceptionEvent): void => {
    fail(errorFromEvent(event));
  };

  const onClose = (): void => {
    queue.close();
    cleanup();
  };

  source.addEventListener("message", onMessage);
  source.addEventListener("error", onError);
  source.addEventListener("close", onClose);
  input.signal.addEventListener("abort", onAbort, { once: true });

  if (input.signal.aborted) onAbort();

  return {
    [Symbol.asyncIterator](): AsyncIterator<unknown> {
      return {
        next: () => queue.next(),
        return: async () => {
          queue.close();
          cleanup();
          return { done: true, value: undefined };
        },
      };
    },
  };
}

export const nativeOpenCodeEventSource: OpenCodeEventSourceFactory =
  createNativeOpenCodeEventSource;
