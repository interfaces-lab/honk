// Connection boot store. Timers and promises live here so components stay effect-free.

import {
  createOpenCodeClient,
  createOpenCodeRegistry,
  createOpenCodeServer,
  exchangeHonkPairing,
  normalizeOpenCodeOrigin,
  openCodeAuthorizationHeader,
  parseOpenCodeConnection,
  type OpenCodeClient,
  type OpenCodeConnection,
  type OpenCodeConnectionCandidate,
} from "@honk/opencode";
import { useSyncExternalStore } from "react";

import { bindProviderAuthClient } from "./provider-auth";
import { bindOpenCodeClient } from "./watch-registry";

export type ConnectionStatus = "connecting" | "authenticated" | "requires-auth" | "unreachable";

export type ConnectionSnapshot = {
  readonly status: ConnectionStatus;
  readonly errorMessage: string | null;
  /** Resolved OpenCode HTTP origin once known (null only before the first resolve). */
  readonly origin: string | null;
};

const INITIAL_SNAPSHOT: ConnectionSnapshot = Object.freeze({
  status: "connecting",
  errorMessage: null,
  origin: null,
});

// Desktop injects the sidecar origin + optional Basic-auth password here. The
// Vite web build has no bridge, so it uses a same-origin HttpOnly cookie, a
// one-time URL, or manual paste. Passwords stay in memory only.

export type BootstrapCredential =
  | { readonly kind: "pairing-token"; readonly credential: string }
  | { readonly kind: "bearer"; readonly credential: string };

export type BootstrapCredentialProvider = () =>
  | BootstrapCredential
  | null
  | Promise<BootstrapCredential | null>;

export type BootstrapOriginProvider = () => string | null;

let bootstrapCredentialProvider: BootstrapCredentialProvider | null = null;
let bootstrapOriginProvider: BootstrapOriginProvider | null = null;

/** Electron host: register before `startConnection()` so first boot uses the sidecar password. */
export function setBootstrapCredentialProvider(provider: BootstrapCredentialProvider | null): void {
  bootstrapCredentialProvider = provider;
}

/** Electron host: provide the runtime-selected sidecar origin before the first boot. */
export function setBootstrapOriginProvider(provider: BootstrapOriginProvider | null): void {
  bootstrapOriginProvider = provider;
}

const TRANSIENT_STATUS_CODES = new Set([502, 503, 504]);
const PROBE_RETRY_TIMEOUT_MS = 15_000;
const PROBE_RETRY_STEP_MS = 500;

type PasswordRecord = {
  readonly origin: string;
  readonly password: string;
};

let memoryPassword: PasswordRecord | null = null;

const listeners = new Set<() => void>();
let snapshot: ConnectionSnapshot = INITIAL_SNAPSHOT;
let bootGeneration = 0;
const clientRegistry = createOpenCodeRegistry();
let liveClient: OpenCodeClient | null = null;
let livePassword: string | null = null;

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): ConnectionSnapshot {
  return snapshot;
}

export function getServerSnapshot(): ConnectionSnapshot {
  return INITIAL_SNAPSHOT;
}

export function useConnection(): ConnectionSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Returns the Basic-auth password owned by the current authenticated client.
 * Local bridges (e.g. the legacy iframe host) may hand it to another trusted
 * renderer; normal UI should use the bound OpenCode client instead.
 */
export function getAuthenticatedBearer(): string | null {
  return snapshot.status === "authenticated" ? livePassword : null;
}

function emit(next: ConnectionSnapshot): void {
  snapshot = next;
  for (const listener of listeners) {
    listener();
  }
}

async function disposeLiveClient(): Promise<void> {
  const previous = liveClient;
  liveClient = null;
  livePassword = null;
  bindOpenCodeClient(null);
  bindProviderAuthClient(null);
  if (previous !== null) {
    clientRegistry.disconnect(previous.server.key);
  }
}

const URL_CREDENTIAL_PARAMS = ["pairing", "password", "token"] as const;

function absoluteOrigin(value: string): string {
  return normalizeOpenCodeOrigin(new URL(value, window.location.origin).toString());
}

function resolveOrigin(): string {
  // Electron chooses the sidecar port at runtime, so its preload bootstrap must
  // win over build-time Vite config. Web has no provider and keeps the fallback.
  const bootstrapOrigin = bootstrapOriginProvider?.()?.trim() ?? "";
  if (bootstrapOrigin.length > 0) {
    return absoluteOrigin(bootstrapOrigin);
  }

  const pageUrl = new URL(window.location.href);
  const attachedOrigin = pageUrl.searchParams.get("origin") ?? pageUrl.searchParams.get("host");
  if (attachedOrigin !== null && attachedOrigin.trim().length > 0) {
    return absoluteOrigin(attachedOrigin.trim());
  }

  const configured = import.meta.env.VITE_HTTP_URL;
  if (typeof configured === "string" && configured.trim().length > 0) {
    return absoluteOrigin(configured.trim());
  }
  return normalizeOpenCodeOrigin(window.location.origin);
}

function readHashParams(url: URL): URLSearchParams {
  return new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
}

function stripCredentialFromUrl(): void {
  const url = new URL(window.location.href);
  const next = new URL(url.toString());
  const hashParams = readHashParams(next);
  for (const parameter of URL_CREDENTIAL_PARAMS) {
    hashParams.delete(parameter);
    next.searchParams.delete(parameter);
  }
  next.hash = hashParams.toString();
  if (next.toString() === url.toString()) {
    return;
  }
  window.history.replaceState({}, document.title, next.toString());
}

function takeConnectionFromUrl(fallbackOrigin: string): OpenCodeConnectionCandidate | null {
  const candidate = parseOpenCodeConnection(window.location.href, fallbackOrigin);
  if (candidate !== null) stripCredentialFromUrl();
  return candidate;
}

function readStoredPassword(origin: string): string | null {
  return memoryPassword !== null && memoryPassword.origin === origin
    ? memoryPassword.password
    : null;
}

function writeStoredPassword(origin: string, password: string): void {
  memoryPassword = { origin, password };
}

function clearStoredPassword(): void {
  memoryPassword = null;
}

class ProbeHttpError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ProbeHttpError";
    this.status = status;
  }
}

class RequiresAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequiresAuthError";
  }
}

function isTransportError(error: unknown): boolean {
  return (
    error instanceof TypeError || (error instanceof DOMException && error.name === "AbortError")
  );
}

function isRetryable(error: unknown): boolean {
  return error instanceof ProbeHttpError && TRANSIENT_STATUS_CODES.has(error.status);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function errorMessageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
}

function basicAuthHeader(password: string | null): Record<string, string> {
  if (password === null || password.length === 0) {
    return {};
  }
  return { authorization: openCodeAuthorizationHeader(password) };
}

function browserRequestCredentials(): RequestCredentials {
  // The web client may authenticate with a same-origin HttpOnly cookie. Electron receives a
  // Basic-auth password from preload, and OpenCode deliberately does not allow credentialed CORS.
  return bootstrapOriginProvider === null ? "include" : "omit";
}

/**
 * Probe outcome: "ok" once OpenCode answers health, "requires-auth" on 401/403,
 * throws (retryable/transport) otherwise so the caller can classify unreachable.
 */
async function probeHealth(
  origin: string,
  password: string | null,
): Promise<"ok" | "requires-auth"> {
  const startedAt = Date.now();
  while (true) {
    try {
      const response = await fetch(`${origin}/global/health`, {
        method: "GET",
        headers: basicAuthHeader(password),
        credentials: browserRequestCredentials(),
      });
      if (response.status === 401 || response.status === 403) {
        return "requires-auth";
      }
      if (!response.ok) {
        throw new ProbeHttpError(
          `OpenCode health check failed (${response.status}).`,
          response.status,
        );
      }
      return "ok";
    } catch (error) {
      if (!isRetryable(error)) {
        throw error;
      }
      if (Date.now() - startedAt >= PROBE_RETRY_TIMEOUT_MS) {
        throw error;
      }
      await wait(PROBE_RETRY_STEP_MS);
    }
  }
}

async function connectionFromCandidate(
  candidate: OpenCodeConnectionCandidate,
): Promise<OpenCodeConnection> {
  if (candidate.credential.type === "password") {
    return { origin: candidate.origin, password: candidate.credential.value };
  }
  try {
    const connection = await exchangeHonkPairing(candidate.origin, candidate.credential.value, {
      label: "Honk web",
    });
    // Pairing tokens are one-use. Persist the issued device password before the
    // OpenCode probe so a slow first start cannot strand this browser.
    writeStoredPassword(connection.origin, connection.password);
    return connection;
  } catch (error) {
    throw new RequiresAuthError(
      errorMessageOf(error, "This pairing link is invalid, expired, or already used."),
    );
  }
}

async function resolveConnection(origin: string): Promise<OpenCodeConnection> {
  const urlCandidate = takeConnectionFromUrl(origin);
  if (urlCandidate !== null) {
    return connectionFromCandidate(urlCandidate);
  }

  if (bootstrapCredentialProvider !== null) {
    const credential = await bootstrapCredentialProvider();
    if (credential !== null) {
      return connectionFromCandidate({
        origin,
        credential: {
          type: credential.kind === "pairing-token" ? "pairing" : "password",
          value: credential.credential,
        },
      });
    }
  }

  return { origin, password: readStoredPassword(origin) ?? "" };
}

function classifyFailure(error: unknown): {
  readonly status: "requires-auth" | "unreachable";
  readonly errorMessage: string;
} {
  if (error instanceof RequiresAuthError) {
    return { status: "requires-auth", errorMessage: error.message };
  }
  if (isTransportError(error)) {
    return {
      status: "unreachable",
      errorMessage: "Could not reach OpenCode. Check that the Honk host is running, then retry.",
    };
  }
  if (isRetryable(error)) {
    return {
      status: "unreachable",
      errorMessage: errorMessageOf(
        error,
        "Could not reach OpenCode. Check that the Honk host is running, then retry.",
      ),
    };
  }
  return {
    status: "unreachable",
    errorMessage: errorMessageOf(error, "Could not connect to OpenCode."),
  };
}

async function bindClient(
  origin: string,
  password: string | null,
  generation: number,
): Promise<void> {
  const client = createOpenCodeClient(createOpenCodeServer({ origin }), {
    ...(password === null ? {} : { password }),
  });
  if (generation !== bootGeneration) {
    client.close();
    return;
  }
  clientRegistry.register(client);
  liveClient = client;
  livePassword = password;
  bindOpenCodeClient(client);
  bindProviderAuthClient(client);
  emit({ status: "authenticated", errorMessage: null, origin });
}

async function runBoot(generation: number): Promise<void> {
  emit({ status: "connecting", errorMessage: null, origin: snapshot.origin });
  await disposeLiveClient();

  let origin: string;
  try {
    origin = resolveOrigin();
  } catch (error) {
    if (generation !== bootGeneration) {
      return;
    }
    emit({
      status: "unreachable",
      errorMessage: errorMessageOf(error, "Could not resolve the OpenCode URL."),
      origin: null,
    });
    return;
  }

  if (generation !== bootGeneration) {
    return;
  }
  emit({ status: "connecting", errorMessage: null, origin });

  try {
    const connection = await resolveConnection(origin);
    if (generation !== bootGeneration) {
      return;
    }
    origin = connection.origin;
    emit({ status: "connecting", errorMessage: null, origin });
    const password = connection.password.length > 0 ? connection.password : null;
    const outcome = await probeHealth(origin, password);
    if (generation !== bootGeneration) {
      return;
    }
    if (outcome === "requires-auth") {
      emit({
        status: "requires-auth",
        errorMessage: password === null ? null : "The Honk host rejected this password.",
        origin,
      });
      return;
    }
    if (password !== null) {
      writeStoredPassword(origin, password);
    }
    await bindClient(origin, password, generation);
  } catch (error) {
    if (generation !== bootGeneration) {
      return;
    }
    await disposeLiveClient();
    const classified = classifyFailure(error);
    emit({ status: classified.status, errorMessage: classified.errorMessage, origin });
  }
}

function beginBoot(): void {
  const generation = ++bootGeneration;
  void runBoot(generation);
}

/** Kick off the gate before React mounts (called from main.tsx, like bindRouter). */
export function startConnection(): void {
  beginBoot();
}

export const actions = {
  /** Manual password / pairing-link entry (no reload-only dead end). */
  submitToken: (raw: string): void => {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      emit({
        status: "requires-auth",
        errorMessage: "Paste a Honk pairing link or OpenCode password to attach this browser.",
        origin: snapshot.origin,
      });
      return;
    }

    let candidate: OpenCodeConnectionCandidate | null;
    try {
      candidate = parseOpenCodeConnection(trimmed, snapshot.origin ?? resolveOrigin());
    } catch (error) {
      emit({
        status: "requires-auth",
        errorMessage: errorMessageOf(error, "That connection value is not valid."),
        origin: snapshot.origin,
      });
      return;
    }
    if (candidate === null) {
      emit({
        status: "requires-auth",
        errorMessage: "That link does not contain a pairing token or password.",
        origin: snapshot.origin,
      });
      return;
    }

    const generation = ++bootGeneration;
    void (async () => {
      emit({ status: "connecting", errorMessage: null, origin: snapshot.origin });
      await disposeLiveClient();

      let origin = candidate.origin;

      try {
        const connection = await connectionFromCandidate(candidate);
        origin = connection.origin;
        const password = connection.password;
        const outcome = await probeHealth(origin, password);
        if (generation !== bootGeneration) {
          return;
        }
        if (outcome === "requires-auth") {
          emit({
            status: "requires-auth",
            errorMessage: "The Honk host rejected this password.",
            origin,
          });
          return;
        }
        writeStoredPassword(origin, password);
        await bindClient(origin, password, generation);
      } catch (error) {
        if (generation !== bootGeneration) {
          return;
        }
        await disposeLiveClient();
        const classified = classifyFailure(error);
        emit({
          status: classified.status,
          errorMessage: classified.errorMessage,
          origin,
        });
      }
    })();
  },

  retry: (): void => {
    beginBoot();
  },

  /** Revoke the paired browser credential when possible, then drop the local client. */
  signOut: (): void => {
    const generation = ++bootGeneration;
    const origin = snapshot.origin;
    const password = livePassword;
    clearStoredPassword();
    void disposeLiveClient().then(async () => {
      if (origin !== null) {
        await fetch(`${origin}/honk/sign-out`, {
          method: "POST",
          headers: basicAuthHeader(password),
          credentials: browserRequestCredentials(),
        }).catch(() => undefined);
      }
      if (generation === bootGeneration) {
        emit({ status: "requires-auth", errorMessage: null, origin });
      }
    });
  },
};
