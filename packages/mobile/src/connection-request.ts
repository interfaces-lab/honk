export const CONNECTION_REQUEST_TIMEOUT_MS = 15_000;

export class ConnectionRequestTimeoutError extends Error {
  constructor() {
    super("This computer took too long to respond.");
    this.name = "ConnectionRequestTimeoutError";
  }
}

export function runWithConnectionDeadline<Result>(
  controller: AbortController,
  operation: () => Promise<Result>,
  timeoutMs: number = CONNECTION_REQUEST_TIMEOUT_MS,
): Promise<Result> {
  if (controller.signal.aborted) {
    return Promise.reject(new Error("This connection attempt was stopped."));
  }
  const timeoutError = new ConnectionRequestTimeoutError();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (result: { readonly value: Result } | { readonly error: unknown }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      controller.signal.removeEventListener("abort", stop);
      if ("error" in result) {
        reject(result.error);
        return;
      }
      resolve(result.value);
    };
    const stop = (): void => finish({ error: new Error("This connection attempt was stopped.") });
    const timeout = setTimeout(() => {
      // React Native's AbortController ignores abort reasons, so settle with the typed error first
      // and use abort only to stop the underlying fetch/body.
      finish({ error: timeoutError });
      controller.abort();
    }, timeoutMs);
    controller.signal.addEventListener("abort", stop, { once: true });
    void operation().then(
      (value) => finish({ value }),
      (error: unknown) => finish({ error }),
    );
  });
}

export function runWithConnectionRequestDeadline<Result>(
  ownerSignal: AbortSignal,
  operation: (signal: AbortSignal) => Promise<Result>,
  timeoutMs: number = CONNECTION_REQUEST_TIMEOUT_MS,
): Promise<Result> {
  const controller = new AbortController();
  const stop = (): void => controller.abort();
  if (ownerSignal.aborted) {
    stop();
  } else {
    ownerSignal.addEventListener("abort", stop, { once: true });
  }
  return runWithConnectionDeadline(
    controller,
    () => operation(controller.signal),
    timeoutMs,
  ).finally(() => {
    ownerSignal.removeEventListener("abort", stop);
    controller.abort();
  });
}

export function createConnectionAttemptFetch(options: {
  readonly fetch?: typeof fetch;
  readonly signal: AbortSignal;
}): typeof fetch {
  const fetchImpl = options.fetch ?? fetch;
  // The attempt signal is placed directly on the native request and remains attached after headers,
  // so aborting the attempt also interrupts response.json()/response.text() body consumption.
  return (input, init) => fetchImpl(input, { ...init, signal: options.signal });
}

export function createBoundedConnectionFetch(options: {
  readonly fetch?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}): typeof fetch {
  const fetchImpl = options.fetch ?? fetch;
  return (input, init) => {
    const controller = new AbortController();
    const timeoutError = new ConnectionRequestTimeoutError();
    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let cleaned = false;
    const cleanup = (): void => {
      if (cleaned) return;
      cleaned = true;
      if (timeout !== null) clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abortConnection);
      init?.signal?.removeEventListener("abort", abortRequest);
    };
    const abortConnection = (): void => {
      controller.abort();
      cleanup();
    };
    const abortRequest = (): void => {
      controller.abort();
      cleanup();
    };
    if (options.signal?.aborted === true) {
      abortConnection();
    } else {
      options.signal?.addEventListener("abort", abortConnection, { once: true });
    }
    if (init?.signal?.aborted === true) {
      abortRequest();
    } else {
      init?.signal?.addEventListener("abort", abortRequest, { once: true });
    }
    if (!controller.signal.aborted) {
      timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
        cleanup();
      }, options.timeoutMs ?? CONNECTION_REQUEST_TIMEOUT_MS);
    }

    return fetchImpl(input, { ...init, signal: controller.signal })
      .then((response) => {
        if (response.body !== null) {
          return connectionDeadlineResponse(response, () => timedOut, timeoutError, cleanup);
        }
        cleanup();
        return response;
      })
      .catch((error: unknown) => {
        cleanup();
        if (timedOut) throw timeoutError;
        throw error;
      });
  };
}

function connectionDeadlineResponse(
  response: Response,
  timedOut: () => boolean,
  timeoutError: ConnectionRequestTimeoutError,
  cleanup: () => void,
): Response {
  const consume = <Result>(operation: () => Promise<Result>): Promise<Result> =>
    Promise.resolve()
      .then(operation)
      .catch((error: unknown) => {
        if (timedOut()) throw timeoutError;
        throw error;
      })
      .finally(cleanup);

  return new Proxy(response, {
    get(target, property) {
      if (property === "arrayBuffer") return () => consume(() => target.arrayBuffer());
      if (property === "blob") return () => consume(() => target.blob());
      if (property === "formData") return () => consume(() => target.formData());
      if (property === "json") return () => consume(() => target.json());
      if (property === "text") return () => consume(() => target.text());
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
