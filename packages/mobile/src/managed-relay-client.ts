import {
  ManagedRelayEnvironmentLinkRecoveryResponse,
  ManagedRelayEnvironmentLinkRequest,
  ManagedRelayEnvironmentLinkResponse,
  ManagedRelayEnvironmentStatusResponse,
  ManagedRelayLinkChallengeRequest,
  ManagedRelayLinkChallengeResponse,
  type ManagedRelayLinkRequestId,
  ManagedRelayListEnvironmentsResponse,
} from "@honk/shared/managed-relay";
import type { ManagedEnvironmentId } from "@honk/shared/managed-remote-access";
import { Schema } from "effect";

export const MANAGED_RELAY_REQUEST_TIMEOUT_MS = 10_000;

export type ManagedRelayOperation =
  | "create_link_challenge"
  | "submit_link"
  | "recover_link"
  | "list_environments"
  | "get_environment_status";

export type ManagedRelayClientErrorCode =
  | "invalid_origin"
  | "invalid_configuration"
  | "authorization_failed"
  | "request_aborted"
  | "request_timed_out"
  | "request_failed"
  | "http_error"
  | "invalid_response";

export class ManagedRelayClientError extends Error {
  readonly code: ManagedRelayClientErrorCode;
  readonly operation: ManagedRelayOperation | null;

  constructor(
    code: ManagedRelayClientErrorCode,
    message: string,
    operation: ManagedRelayOperation | null,
  ) {
    super(message);
    this.name = "ManagedRelayClientError";
    this.code = code;
    this.operation = operation;
  }
}

export class ManagedRelayOriginInvalidError extends ManagedRelayClientError {
  constructor() {
    super("invalid_origin", "Relay origin must be a secure absolute HTTPS origin.", null);
    this.name = "ManagedRelayOriginInvalidError";
  }
}

export class ManagedRelayConfigurationInvalidError extends ManagedRelayClientError {
  constructor() {
    super("invalid_configuration", "Relay request timeout must be a positive number.", null);
    this.name = "ManagedRelayConfigurationInvalidError";
  }
}

export class ManagedRelayAuthorizationError extends ManagedRelayClientError {
  constructor(operation: ManagedRelayOperation) {
    super("authorization_failed", "Relay account authorization failed.", operation);
    this.name = "ManagedRelayAuthorizationError";
  }
}

export class ManagedRelayRequestAbortedError extends ManagedRelayClientError {
  constructor(operation: ManagedRelayOperation) {
    super("request_aborted", "Relay request was cancelled.", operation);
    this.name = "ManagedRelayRequestAbortedError";
  }
}

export class ManagedRelayRequestTimeoutError extends ManagedRelayClientError {
  readonly timeoutMs: number;

  constructor(operation: ManagedRelayOperation, timeoutMs: number) {
    super("request_timed_out", "Relay request timed out.", operation);
    this.name = "ManagedRelayRequestTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export class ManagedRelayRequestFailedError extends ManagedRelayClientError {
  constructor(operation: ManagedRelayOperation) {
    super("request_failed", "Relay request failed.", operation);
    this.name = "ManagedRelayRequestFailedError";
  }
}

export class ManagedRelayHttpError extends ManagedRelayClientError {
  readonly status: number;

  constructor(operation: ManagedRelayOperation, status: number) {
    super("http_error", `Relay request failed with HTTP ${status}.`, operation);
    this.name = "ManagedRelayHttpError";
    this.status = status;
  }
}

export class ManagedRelayResponseInvalidError extends ManagedRelayClientError {
  constructor(operation: ManagedRelayOperation) {
    super("invalid_response", "Relay returned an invalid response.", operation);
    this.name = "ManagedRelayResponseInvalidError";
  }
}

export type ManagedRelayClient<AccountSession> = {
  readonly relayOrigin: string;
  readonly createLinkChallenge: (input: {
    readonly session: AccountSession;
    readonly payload: ManagedRelayLinkChallengeRequest;
    readonly signal?: AbortSignal;
  }) => Promise<ManagedRelayLinkChallengeResponse>;
  readonly submitLink: (input: {
    readonly session: AccountSession;
    readonly payload: ManagedRelayEnvironmentLinkRequest;
    readonly signal?: AbortSignal;
  }) => Promise<ManagedRelayEnvironmentLinkResponse>;
  readonly recoverLink: (input: {
    readonly session: AccountSession;
    readonly requestId: ManagedRelayLinkRequestId;
    readonly signal?: AbortSignal;
  }) => Promise<ManagedRelayEnvironmentLinkRecoveryResponse>;
  readonly listEnvironments: (input: {
    readonly session: AccountSession;
    readonly signal?: AbortSignal;
  }) => Promise<ManagedRelayListEnvironmentsResponse>;
  readonly getEnvironmentStatus: (input: {
    readonly session: AccountSession;
    readonly environmentId: ManagedEnvironmentId;
    readonly signal?: AbortSignal;
  }) => Promise<ManagedRelayEnvironmentStatusResponse>;
};

export type ManagedRelayFetch = (input: string, init: RequestInit) => Promise<Response>;

const decodeLinkChallengeResponse = Schema.decodeUnknownPromise(ManagedRelayLinkChallengeResponse);
const decodeEnvironmentLinkResponse = Schema.decodeUnknownPromise(
  ManagedRelayEnvironmentLinkResponse,
);
const decodeEnvironmentLinkRecoveryResponse = Schema.decodeUnknownPromise(
  ManagedRelayEnvironmentLinkRecoveryResponse,
);
const decodeListEnvironmentsResponse = Schema.decodeUnknownPromise(
  ManagedRelayListEnvironmentsResponse,
);
const decodeEnvironmentStatusResponse = Schema.decodeUnknownPromise(
  ManagedRelayEnvironmentStatusResponse,
);

export function normalizeManagedRelayOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.search.length > 0 ||
      url.hash.length > 0 ||
      !/^\/+$/u.test(url.pathname)
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function createManagedRelayClient<AccountSession>(options: {
  readonly relayOrigin: string;
  readonly readAccountToken: (input: {
    readonly session: AccountSession;
    readonly signal: AbortSignal;
  }) => Promise<string | null>;
  readonly fetch?: ManagedRelayFetch;
  readonly timeoutMs?: number;
}): ManagedRelayClient<AccountSession> {
  const relayOrigin = normalizeManagedRelayOrigin(options.relayOrigin);
  if (relayOrigin === null) throw new ManagedRelayOriginInvalidError();
  const timeoutMs = options.timeoutMs ?? MANAGED_RELAY_REQUEST_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new ManagedRelayConfigurationInvalidError();
  }
  const fetchImpl = options.fetch ?? fetch;

  const request = <Result>(input: {
    readonly operation: ManagedRelayOperation;
    readonly method: "GET" | "POST";
    readonly path: string;
    readonly session: AccountSession;
    readonly signal: AbortSignal | undefined;
    readonly payload?: unknown;
    readonly decode: (value: unknown) => Promise<Result>;
  }): Promise<Result> =>
    runManagedRelayRequest({
      operation: input.operation,
      signal: input.signal,
      timeoutMs,
      execute: async (signal) => {
        const token = await options.readAccountToken({ session: input.session, signal }).then(
          (value) => value,
          () => Promise.reject(new ManagedRelayAuthorizationError(input.operation)),
        );
        if (
          token === null ||
          token.length === 0 ||
          token.trim() !== token ||
          token.includes("\r") ||
          token.includes("\n")
        ) {
          throw new ManagedRelayAuthorizationError(input.operation);
        }
        const body =
          input.payload === undefined
            ? undefined
            : await Promise.resolve()
                .then(() => JSON.stringify(input.payload))
                .then(
                  (value) => value,
                  () => Promise.reject(new ManagedRelayRequestFailedError(input.operation)),
                );
        const response = await fetchImpl(`${relayOrigin}${input.path}`, {
          method: input.method,
          headers: {
            accept: "application/json",
            authorization: `Bearer ${token}`,
            ...(body === undefined ? {} : { "content-type": "application/json" }),
          },
          ...(body === undefined ? {} : { body }),
          credentials: "omit",
          redirect: "error",
          signal,
        }).then(
          (value) => value,
          () => Promise.reject(new ManagedRelayRequestFailedError(input.operation)),
        );
        if (!response.ok) {
          void response.body?.cancel().catch(() => undefined);
          throw new ManagedRelayHttpError(input.operation, response.status);
        }
        const value = await response.json().then(
          (decoded) => decoded,
          () => Promise.reject(new ManagedRelayResponseInvalidError(input.operation)),
        );
        return input.decode(value).then(
          (decoded) => decoded,
          () => Promise.reject(new ManagedRelayResponseInvalidError(input.operation)),
        );
      },
    });

  return {
    relayOrigin,
    createLinkChallenge: (input) =>
      request({
        operation: "create_link_challenge",
        method: "POST",
        path: "/v1/link-challenges",
        session: input.session,
        signal: input.signal,
        payload: input.payload,
        decode: decodeLinkChallengeResponse,
      }),
    submitLink: (input) =>
      request({
        operation: "submit_link",
        method: "POST",
        path: "/v1/environments/link",
        session: input.session,
        signal: input.signal,
        payload: input.payload,
        decode: decodeEnvironmentLinkResponse,
      }),
    recoverLink: (input) =>
      request({
        operation: "recover_link",
        method: "GET",
        path: `/v1/environment-links/${encodeURIComponent(input.requestId)}`,
        session: input.session,
        signal: input.signal,
        decode: decodeEnvironmentLinkRecoveryResponse,
      }),
    listEnvironments: (input) =>
      request({
        operation: "list_environments",
        method: "GET",
        path: "/v1/environments",
        session: input.session,
        signal: input.signal,
        decode: decodeListEnvironmentsResponse,
      }),
    getEnvironmentStatus: (input) =>
      request({
        operation: "get_environment_status",
        method: "GET",
        path: `/v1/environments/${encodeURIComponent(input.environmentId)}/status`,
        session: input.session,
        signal: input.signal,
        decode: decodeEnvironmentStatusResponse,
      }),
  };
}

function runManagedRelayRequest<Result>(input: {
  readonly operation: ManagedRelayOperation;
  readonly signal: AbortSignal | undefined;
  readonly timeoutMs: number;
  readonly execute: (signal: AbortSignal) => Promise<Result>;
}): Promise<Result> {
  if (input.signal?.aborted === true) {
    return Promise.reject(new ManagedRelayRequestAbortedError(input.operation));
  }
  const controller = new AbortController();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (
      result: { readonly value: Result } | { readonly error: ManagedRelayClientError },
    ): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", stop);
      if ("error" in result) {
        reject(result.error);
        return;
      }
      resolve(result.value);
    };
    const stop = (): void => {
      finish({ error: new ManagedRelayRequestAbortedError(input.operation) });
      controller.abort();
    };
    const timeout = setTimeout(() => {
      finish({
        error: new ManagedRelayRequestTimeoutError(input.operation, input.timeoutMs),
      });
      controller.abort();
    }, input.timeoutMs);
    input.signal?.addEventListener("abort", stop, { once: true });
    void Promise.resolve()
      .then(() => input.execute(controller.signal))
      .then(
        (value) => finish({ value }),
        (error: unknown) =>
          finish({
            error:
              error instanceof ManagedRelayClientError
                ? error
                : new ManagedRelayRequestFailedError(input.operation),
          }),
      );
  });
}
