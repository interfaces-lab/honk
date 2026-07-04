import {
  AuthSnapshot,
  PairingIssue,
  Session,
  SessionGrant,
  type PairingIssue as PairingIssueValue,
  type Session as CoreSession,
} from "@honk/api/core/v1";
import { AuthSessionId } from "@honk/shared/base-schemas";

import {
  getPairingTokenFromUrl,
  stripPairingTokenFromUrl as stripPairingTokenUrl,
} from "./pairing-url";

import {
  readDesktopLocalEnvironmentBootstrap,
  readPrimaryEnvironmentTarget,
  resolvePrimaryEnvironmentHttpUrl,
} from "./target";
import { Data, Predicate, Schema } from "effect";

export class BootstrapHttpError extends Data.TaggedError("BootstrapHttpError")<{
  readonly message: string;
  readonly status: number;
}> {}
const isBootstrapHttpError = (u: unknown): u is BootstrapHttpError =>
  Predicate.isTagged(u, "BootstrapHttpError");

function decodeJsonBody<A>(body: unknown, schema: Schema.Schema<A>): A {
  return Schema.decodeUnknownSync(schema as never)(body) as A;
}

async function readJsonResponse<A>(response: Response, schema: Schema.Schema<A>): Promise<A> {
  const body: unknown = await response.json();
  return decodeJsonBody(body, schema);
}

export interface ServerPairingLinkRecord {
  readonly id: string;
  readonly credential: string;
  readonly role: "owner" | "client";
  readonly subject: string;
  readonly label?: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface AuthClientMetadata {
  readonly label?: string;
  readonly ipAddress?: string;
  readonly userAgent?: string;
  readonly deviceType: "desktop" | "mobile" | "tablet" | "bot" | "unknown";
  readonly os?: string;
  readonly browser?: string;
}

export interface ServerClientSessionRecord {
  readonly sessionId: AuthSessionId;
  readonly subject: string;
  readonly role: "owner" | "client";
  readonly method: "bearer-session-token";
  readonly client: AuthClientMetadata;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly lastConnectedAt: string | null;
  readonly connected: boolean;
  readonly current: boolean;
}

type ServerAuthGateState =
  | { status: "authenticated" }
  | {
      status: "requires-auth";
      errorMessage?: string;
    };

let bootstrapPromise: Promise<ServerAuthGateState> | null = null;
let resolvedAuthenticatedGateState: ServerAuthGateState | null = null;
let serverBearerSessionRecord: ServerBearerSessionRecord | null = null;
let validatedServerBearerSessionRecord: ValidatedServerBearerSessionRecord | null = null;
let resolveAuthenticatedServerBearerTokenPromise: Promise<string | null> | null = null;
const SERVER_BEARER_SESSION_STORAGE_KEY = "honk.server.bearerSession.v1";
const SERVER_BEARER_SESSION_VALIDATION_TTL_MS = 60_000;

interface ServerBearerSessionRecord {
  readonly httpBaseUrl: string;
  readonly sessionToken: string;
  readonly expiresAt: string | null;
}

interface ValidatedServerBearerSessionRecord {
  readonly httpBaseUrl: string;
  readonly sessionToken: string;
  readonly validatedAtMs: number;
}

type BootstrapCredential =
  | { readonly kind: "pairing-token"; readonly credential: string }
  | { readonly kind: "bearer"; readonly credential: string };

const SessionListResponse = Schema.Struct({
  sessions: Schema.Array(Session),
});

export function peekPairingTokenFromUrl(): string | null {
  return getPairingTokenFromUrl(new URL(window.location.href));
}

export function stripPairingTokenFromUrl() {
  const url = new URL(window.location.href);
  const next = stripPairingTokenUrl(url);
  if (next.toString() === url.toString()) {
    return;
  }
  window.history.replaceState({}, document.title, next.toString());
}

export function takePairingTokenFromUrl(): string | null {
  const token = peekPairingTokenFromUrl();
  if (!token) {
    return null;
  }
  stripPairingTokenFromUrl();
  return token;
}

function readCurrentHttpBaseUrl(): string | null {
  return readPrimaryEnvironmentTarget()?.target.httpBaseUrl ?? null;
}

function readBootstrapCredential(): BootstrapCredential | null {
  const pairingToken = takePairingTokenFromUrl();
  if (pairingToken) {
    return { kind: "pairing-token", credential: pairingToken };
  }
  const bearer = readDesktopLocalEnvironmentBootstrap()?.bootstrapToken ?? null;
  return bearer ? { kind: "bearer", credential: bearer } : null;
}

function parseServerBearerSessionRecord(raw: string | null): ServerBearerSessionRecord | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const httpBaseUrl = Reflect.get(parsed, "httpBaseUrl");
    const sessionToken = Reflect.get(parsed, "sessionToken");
    const expiresAt = Reflect.get(parsed, "expiresAt");
    if (
      typeof httpBaseUrl !== "string" ||
      typeof sessionToken !== "string" ||
      (typeof expiresAt !== "string" && expiresAt !== null)
    ) {
      return null;
    }
    return {
      httpBaseUrl,
      sessionToken,
      expiresAt,
    };
  } catch {
    return null;
  }
}

function isExpired(isoTime: string | null): boolean {
  if (isoTime === null) {
    return false;
  }
  const timestamp = Date.parse(isoTime);
  return !Number.isFinite(timestamp) || timestamp <= Date.now();
}

function clearServerBearerSession(): void {
  serverBearerSessionRecord = null;
  validatedServerBearerSessionRecord = null;
  window.sessionStorage?.removeItem(SERVER_BEARER_SESSION_STORAGE_KEY);
}

function readServerBearerSession(): ServerBearerSessionRecord | null {
  const httpBaseUrl = readCurrentHttpBaseUrl();
  if (!httpBaseUrl) {
    return null;
  }

  const record =
    serverBearerSessionRecord ??
    parseServerBearerSessionRecord(
      window.sessionStorage?.getItem(SERVER_BEARER_SESSION_STORAGE_KEY) ?? null,
    );
  if (!record) {
    return null;
  }

  if (record.httpBaseUrl !== httpBaseUrl || isExpired(record.expiresAt)) {
    clearServerBearerSession();
    return null;
  }

  serverBearerSessionRecord = record;
  return record;
}

function writeServerBearerSession(input: {
  readonly sessionToken: string;
  readonly expiresAt: string | null;
}): void {
  const httpBaseUrl = readCurrentHttpBaseUrl();
  if (!httpBaseUrl) {
    return;
  }

  const record: ServerBearerSessionRecord = {
    httpBaseUrl,
    sessionToken: input.sessionToken,
    expiresAt: input.expiresAt,
  };
  serverBearerSessionRecord = record;
  rememberServerBearerSessionValidated(record);
  window.sessionStorage?.setItem(SERVER_BEARER_SESSION_STORAGE_KEY, JSON.stringify(record));
}

export function getServerBearerSessionToken(): string | null {
  return readServerBearerSession()?.sessionToken ?? null;
}

function rememberServerBearerSessionValidated(record: ServerBearerSessionRecord): void {
  validatedServerBearerSessionRecord = {
    httpBaseUrl: record.httpBaseUrl,
    sessionToken: record.sessionToken,
    validatedAtMs: Date.now(),
  };
}

function hasFreshServerBearerSessionValidation(record: ServerBearerSessionRecord): boolean {
  return (
    validatedServerBearerSessionRecord?.httpBaseUrl === record.httpBaseUrl &&
    validatedServerBearerSessionRecord.sessionToken === record.sessionToken &&
    Date.now() - validatedServerBearerSessionRecord.validatedAtMs <
      SERVER_BEARER_SESSION_VALIDATION_TTL_MS
  );
}

async function resolveAuthenticatedServerBearerTokenOnce(): Promise<string | null> {
  const existingSession = readServerBearerSession();
  if (existingSession) {
    if (hasFreshServerBearerSessionValidation(existingSession)) {
      return existingSession.sessionToken;
    }

    const currentSession = await fetchSessionState();
    if (currentSession.authenticated) {
      rememberServerBearerSessionValidated(existingSession);
      return existingSession.sessionToken;
    }
    clearServerBearerSession();
    resolvedAuthenticatedGateState = null;
  }

  await resolveInitialServerAuthGateState();

  const refreshedExistingToken = getServerBearerSessionToken();
  if (refreshedExistingToken) {
    return refreshedExistingToken;
  }

  const credential = readBootstrapCredential();
  if (!credential) {
    return null;
  }

  const bearerSession =
    credential.kind === "bearer"
      ? await validateBearerBootstrapCredential(credential.credential)
      : await exchangePairingCredential(credential.credential);
  writeServerBearerSession(bearerSession);
  resolvedAuthenticatedGateState = { status: "authenticated" };
  return bearerSession.sessionToken;
}

export async function resolveAuthenticatedServerBearerToken(): Promise<string | null> {
  if (resolveAuthenticatedServerBearerTokenPromise) {
    return resolveAuthenticatedServerBearerTokenPromise;
  }

  const nextPromise = resolveAuthenticatedServerBearerTokenOnce();
  resolveAuthenticatedServerBearerTokenPromise = nextPromise;
  return nextPromise.finally(() => {
    if (resolveAuthenticatedServerBearerTokenPromise === nextPromise) {
      resolveAuthenticatedServerBearerTokenPromise = null;
    }
  });
}

export function createAuthenticatedRequestInit(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  const bearerToken = getServerBearerSessionToken();
  if (bearerToken) {
    headers.set("authorization", `Bearer ${bearerToken}`);
  }

  return {
    ...init,
    headers,
  };
}

export async function fetchSessionState(): Promise<{ readonly authenticated: boolean }> {
  return retryTransientBootstrap(async () => {
    const response = await fetch(
      resolvePrimaryEnvironmentHttpUrl("/core/v1/auth"),
      createAuthenticatedRequestInit(),
    );
    if (response.status === 401) {
      return { authenticated: false };
    }
    if (!response.ok) {
      throw new BootstrapHttpError({
        message: `Failed to load core auth snapshot (${response.status}).`,
        status: response.status,
      });
    }
    await readJsonResponse(response, AuthSnapshot);
    return { authenticated: true };
  });
}

async function readErrorMessage(response: Response, fallbackMessage: string): Promise<string> {
  const text = await response.text();
  if (!text) {
    return fallbackMessage;
  }

  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null) {
      const error = Reflect.get(parsed, "error");
      if (typeof error === "string" && error.trim().length > 0) {
        return error;
      }
      const message = Reflect.get(parsed, "message");
      if (typeof message === "string" && message.trim().length > 0) {
        return message;
      }
    }
  } catch {
    return text;
  }

  return text;
}

async function exchangePairingCredential(credential: string): Promise<{
  readonly sessionToken: string;
  readonly expiresAt: string | null;
}> {
  return retryTransientBootstrap(async () => {
    const response = await fetch(resolvePrimaryEnvironmentHttpUrl("/core/v1/sessions/exchange"), {
      body: JSON.stringify({ token: credential }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    });

    if (!response.ok) {
      const message = await readErrorMessage(
        response,
        `Failed to exchange pairing token (${response.status}).`,
      );
      throw new BootstrapHttpError({
        message,
        status: response.status,
      });
    }

    const grant = await readJsonResponse(response, SessionGrant);
    return {
      sessionToken: grant.bearer,
      expiresAt: grant.session.expiresAt,
    };
  });
}

async function validateBearerBootstrapCredential(credential: string): Promise<{
  readonly sessionToken: string;
  readonly expiresAt: string | null;
}> {
  return retryTransientBootstrap(async () => {
    const response = await fetch(resolvePrimaryEnvironmentHttpUrl("/core/v1/auth"), {
      headers: {
        authorization: `Bearer ${credential}`,
      },
      method: "GET",
    });

    if (!response.ok) {
      const message = await readErrorMessage(
        response,
        `Failed to validate desktop core credential (${response.status}).`,
      );
      throw new BootstrapHttpError({
        message,
        status: response.status,
      });
    }

    await readJsonResponse(response, AuthSnapshot);
    return {
      sessionToken: credential,
      expiresAt: null,
    };
  });
}

async function createPairingCredential(): Promise<PairingIssueValue> {
  return retryTransientBootstrap(async () => {
    const response = await fetch(
      resolvePrimaryEnvironmentHttpUrl("/core/v1/sessions/pairings"),
      createAuthenticatedRequestInit({ method: "POST" }),
    );

    if (!response.ok) {
      const message = await readErrorMessage(
        response,
        `Failed to create pairing token (${response.status}).`,
      );
      throw new BootstrapHttpError({
        message,
        status: response.status,
      });
    }

    return readJsonResponse(response, PairingIssue);
  });
}

const TRANSIENT_BOOTSTRAP_STATUS_CODES = new Set([502, 503, 504]);
const BOOTSTRAP_RETRY_TIMEOUT_MS = 15_000;
const BOOTSTRAP_RETRY_STEP_MS = 500;

export async function retryTransientBootstrap<T>(operation: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (!isTransientBootstrapError(error)) {
        throw error;
      }

      if (Date.now() - startedAt >= BOOTSTRAP_RETRY_TIMEOUT_MS) {
        throw error;
      }

      await waitForBootstrapRetry(BOOTSTRAP_RETRY_STEP_MS);
    }
  }
}

function waitForBootstrapRetry(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function isTransientBootstrapError(error: unknown): boolean {
  if (isBootstrapHttpError(error)) {
    return TRANSIENT_BOOTSTRAP_STATUS_CODES.has(error.status);
  }

  if (error instanceof TypeError) {
    return true;
  }

  return error instanceof DOMException && error.name === "AbortError";
}

async function bootstrapServerAuth(): Promise<ServerAuthGateState> {
  const currentSession = await fetchSessionState();
  if (currentSession.authenticated) {
    return { status: "authenticated" };
  }

  clearServerBearerSession();

  try {
    const credential = readBootstrapCredential();
    if (!credential) {
      return {
        status: "requires-auth",
      };
    }
    const bearerSession =
      credential.kind === "bearer"
        ? await validateBearerBootstrapCredential(credential.credential)
        : await exchangePairingCredential(credential.credential);
    writeServerBearerSession(bearerSession);
    return { status: "authenticated" };
  } catch (error) {
    return {
      status: "requires-auth",
      errorMessage: error instanceof Error ? error.message : "Authentication failed.",
    };
  }
}

export async function submitServerAuthCredential(credential: string): Promise<void> {
  const trimmedCredential = credential.trim();
  if (!trimmedCredential) {
    throw new Error("Enter a pairing token to continue.");
  }

  resolvedAuthenticatedGateState = null;
  const bearerSession = await exchangePairingCredential(trimmedCredential);
  writeServerBearerSession(bearerSession);
  bootstrapPromise = null;
  stripPairingTokenFromUrl();
}

export async function createServerPairingCredential(
  _label?: string,
): Promise<{
  readonly id: string;
  readonly credential: string;
  readonly expiresAt: string;
}> {
  const issue = await createPairingCredential();
  return {
    id: issue.token,
    credential: issue.token,
    expiresAt: issue.expiresAt,
  };
}

export async function listServerPairingLinks(): Promise<ReadonlyArray<ServerPairingLinkRecord>> {
  return [];
}

export async function revokeServerPairingLink(id: string): Promise<void> {
  void id;
}

function sessionClientMetadata(session: CoreSession): AuthClientMetadata {
  return {
    label: session.label ?? session.role,
    deviceType: session.role === "core-app" ? "desktop" : "unknown",
  };
}

export async function listServerClientSessions(): Promise<
  ReadonlyArray<ServerClientSessionRecord>
> {
  const response = await fetch(
    resolvePrimaryEnvironmentHttpUrl("/core/v1/sessions"),
    createAuthenticatedRequestInit(),
  );

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, `Failed to load paired clients (${response.status}).`),
    );
  }

  const { sessions } = await readJsonResponse(response, SessionListResponse);
  return sessions.map(
    (session): ServerClientSessionRecord => ({
      sessionId: AuthSessionId.make(String(session.id)),
      subject: session.label ?? session.role,
      role: session.role === "core-app" ? "owner" : "client",
      method: "bearer-session-token",
      client: sessionClientMetadata(session),
      issuedAt: session.createdAt,
      expiresAt: session.expiresAt ?? "",
      lastConnectedAt: session.lastSeenAt,
      connected: true,
      current: session.role === "core-app",
    }),
  );
}

export async function revokeServerClientSession(sessionId: AuthSessionId): Promise<void> {
  const response = await fetch(
    resolvePrimaryEnvironmentHttpUrl(
      `/core/v1/sessions/${encodeURIComponent(String(sessionId))}`,
    ),
    createAuthenticatedRequestInit({ method: "DELETE" }),
  );

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, `Failed to revoke client session (${response.status}).`),
    );
  }
}

export async function revokeOtherServerClientSessions(): Promise<number> {
  const sessions = await listServerClientSessions();
  const revocable = sessions.filter((session) => !session.current);
  await Promise.all(revocable.map((session) => revokeServerClientSession(session.sessionId)));
  return revocable.length;
}

export async function resolveInitialServerAuthGateState(): Promise<ServerAuthGateState> {
  if (resolvedAuthenticatedGateState?.status === "authenticated") {
    return resolvedAuthenticatedGateState;
  }

  if (bootstrapPromise) {
    return bootstrapPromise;
  }

  const nextPromise = bootstrapServerAuth();
  bootstrapPromise = nextPromise;
  return nextPromise
    .then((result) => {
      if (result.status === "authenticated") {
        resolvedAuthenticatedGateState = result;
      }
      return result;
    })
    .finally(() => {
      if (bootstrapPromise === nextPromise) {
        bootstrapPromise = null;
      }
    });
}

export function __resetServerAuthBootstrapForTests() {
  bootstrapPromise = null;
  resolvedAuthenticatedGateState = null;
  serverBearerSessionRecord = null;
  validatedServerBearerSessionRecord = null;
  resolveAuthenticatedServerBearerTokenPromise = null;
}
