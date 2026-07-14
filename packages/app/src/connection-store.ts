// Connection / boot store. Owns the reach-the-sidecar state machine as a plain
// {subscribe, getSnapshot, actions} module so components stay effect-free. Timers
// and promises live here; React only reads.
//
// Altitude change (opencode sidecar): the old honk Core auth wire
// (/core/v1/sessions/exchange, /core/v1/auth, pairing-token exchange) is gone.
// The desktop sidecar supervisor spawns `opencode serve` and hands the renderer
// {httpBaseUrl, bootstrapToken} through the preload bridge. We treat that as
// {origin, password}: opencode uses HTTP Basic auth with a fixed "opencode"
// username when a password is set, and no auth on a bare loopback server.
//
// Boot: resolve origin → resolve optional password → probe /global/health →
// build the sidecar client and bind it into the watch registry. Manual paste
// (submitToken) sets the password and re-probes; retry restarts the probe.

import { useSyncExternalStore } from "react";

import { createSidecarClient, type SidecarClient } from "./sidecar";
import { bindHonkClient } from "./watch-registry";

// ── Public snapshot ──────────────────────────────────────────────────────────────────────────

export type ConnectionStatus = "connecting" | "authenticated" | "requires-auth" | "unreachable";

export type ConnectionSnapshot = {
  readonly status: ConnectionStatus;
  readonly errorMessage: string | null;
  /** Resolved sidecar HTTP origin once known (null only before the first resolve). */
  readonly origin: string | null;
};

const INITIAL_SNAPSHOT: ConnectionSnapshot = Object.freeze({
  status: "connecting",
  errorMessage: null,
  origin: null,
});

// ── Bootstrap seam (Electron host) ───────────────────────────────────────────────────────────
// Desktop injects the sidecar origin + optional Basic-auth password here. The
// Vite web build has no bridge, so without a provider only URL tokens +
// sessionStorage + manual paste can attach a password.

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

// ── Persistence (sessionStorage password, keyed by origin) ────────────────────────────────────

const SIDECAR_PASSWORD_STORAGE_KEY = "honk.sidecar.password.v1";

const TRANSIENT_STATUS_CODES = new Set([502, 503, 504]);
const PROBE_RETRY_TIMEOUT_MS = 15_000;
const PROBE_RETRY_STEP_MS = 500;

type PasswordRecord = {
  readonly origin: string;
  readonly password: string;
};

let memoryPassword: PasswordRecord | null = null;

// ── Store wiring ─────────────────────────────────────────────────────────────────────────────

const listeners = new Set<() => void>();
let snapshot: ConnectionSnapshot = INITIAL_SNAPSHOT;
let bootGeneration = 0;
let liveClient: SidecarClient | null = null;
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
 * renderer; normal UI should use the bound sidecar client instead.
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
  bindHonkClient(null);
  if (previous !== null) {
    try {
      await previous.close();
    } catch {
      // Closing a half-open client must not block the next boot attempt.
    }
  }
}

// ── Origin + URL token ─────────────────────────────────────────────────────────────────────────

function resolveOrigin(): string {
  // Electron chooses the sidecar port at runtime, so its preload bootstrap must
  // win over build-time Vite config. Web has no provider and keeps the fallback.
  const bootstrapOrigin = bootstrapOriginProvider?.()?.trim() ?? "";
  if (bootstrapOrigin.length > 0) {
    return new URL(bootstrapOrigin, window.location.origin).toString().replace(/\/+$/, "");
  }

  const configured = import.meta.env.VITE_HTTP_URL;
  if (typeof configured === "string" && configured.trim().length > 0) {
    return new URL(configured.trim(), window.location.origin).toString().replace(/\/+$/, "");
  }
  return new URL(window.location.origin, window.location.origin).toString().replace(/\/+$/, "");
}

const PAIRING_TOKEN_PARAM = "token";

function readHashParams(url: URL): URLSearchParams {
  return new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
}

function peekTokenFromUrl(): string | null {
  const url = new URL(window.location.href);
  const hashToken = readHashParams(url).get(PAIRING_TOKEN_PARAM)?.trim() ?? "";
  if (hashToken.length > 0) {
    return hashToken;
  }
  const searchToken = url.searchParams.get(PAIRING_TOKEN_PARAM)?.trim() ?? "";
  return searchToken.length > 0 ? searchToken : null;
}

function stripTokenFromUrl(): void {
  const url = new URL(window.location.href);
  const next = new URL(url.toString());
  const hashParams = readHashParams(next);
  if (hashParams.has(PAIRING_TOKEN_PARAM)) {
    hashParams.delete(PAIRING_TOKEN_PARAM);
    next.hash = hashParams.toString();
  }
  next.searchParams.delete(PAIRING_TOKEN_PARAM);
  if (next.toString() === url.toString()) {
    return;
  }
  window.history.replaceState({}, document.title, next.toString());
}

function takeTokenFromUrl(): string | null {
  const token = peekTokenFromUrl();
  if (token === null) {
    return null;
  }
  stripTokenFromUrl();
  return token;
}

// ── Password storage ─────────────────────────────────────────────────────────────────────────

function readStoredPassword(origin: string): string | null {
  if (memoryPassword !== null && memoryPassword.origin === origin) {
    return memoryPassword.password;
  }
  try {
    const raw = window.sessionStorage?.getItem(SIDECAR_PASSWORD_STORAGE_KEY);
    if (raw === null || raw === undefined) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const storedOrigin = Reflect.get(parsed, "origin");
    const password = Reflect.get(parsed, "password");
    if (storedOrigin !== origin || typeof password !== "string" || password.length === 0) {
      return null;
    }
    memoryPassword = { origin, password };
    return password;
  } catch {
    return null;
  }
}

function writeStoredPassword(origin: string, password: string): void {
  memoryPassword = { origin, password };
  try {
    window.sessionStorage?.setItem(
      SIDECAR_PASSWORD_STORAGE_KEY,
      JSON.stringify({ origin, password }),
    );
  } catch {
    // Persist best-effort; memory covers this tab.
  }
}

function clearStoredPassword(): void {
  memoryPassword = null;
  try {
    window.sessionStorage?.removeItem(SIDECAR_PASSWORD_STORAGE_KEY);
  } catch {
    // Private mode / blocked storage — memory clear is enough for this tab.
  }
}

// ── Probe helpers ────────────────────────────────────────────────────────────────────────────

class ProbeHttpError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ProbeHttpError";
    this.status = status;
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
  return { authorization: `Basic ${btoa(`opencode:${password}`)}` };
}

/**
 * Probe outcome: "ok" once the sidecar answers health, "requires-auth" on 401/403,
 * throws (retryable/transport) otherwise so the caller can classify unreachable.
 */
async function probeHealth(origin: string, password: string | null): Promise<"ok" | "requires-auth"> {
  const startedAt = Date.now();
  while (true) {
    try {
      const response = await fetch(`${origin}/global/health`, {
        method: "GET",
        headers: basicAuthHeader(password),
      });
      if (response.status === 401 || response.status === 403) {
        return "requires-auth";
      }
      if (!response.ok) {
        throw new ProbeHttpError(
          `Sidecar health check failed (${response.status}).`,
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

async function resolvePassword(origin: string): Promise<string | null> {
  const stored = readStoredPassword(origin);
  if (stored !== null) {
    return stored;
  }
  const urlToken = takeTokenFromUrl();
  if (urlToken !== null) {
    return urlToken;
  }
  if (bootstrapCredentialProvider !== null) {
    const credential = await bootstrapCredentialProvider();
    if (credential !== null) {
      return credential.credential;
    }
  }
  return null;
}

function classifyFailure(error: unknown): {
  readonly status: "requires-auth" | "unreachable";
  readonly errorMessage: string;
} {
  if (isTransportError(error)) {
    return {
      status: "unreachable",
      errorMessage: "Could not reach the sidecar. Check that it is running, then retry.",
    };
  }
  if (isRetryable(error)) {
    return {
      status: "unreachable",
      errorMessage: errorMessageOf(
        error,
        "Could not reach the sidecar. Check that it is running, then retry.",
      ),
    };
  }
  return {
    status: "unreachable",
    errorMessage: errorMessageOf(error, "Could not connect to the sidecar."),
  };
}

async function bindClient(origin: string, password: string | null, generation: number): Promise<void> {
  const client = createSidecarClient(origin, password === null ? undefined : { password });
  if (generation !== bootGeneration) {
    try {
      await client.close();
    } catch {
      // Superseded boot — drop the orphan client.
    }
    return;
  }
  liveClient = client;
  livePassword = password;
  bindHonkClient(client);
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
      errorMessage: errorMessageOf(error, "Could not resolve the sidecar URL."),
      origin: null,
    });
    return;
  }

  if (generation !== bootGeneration) {
    return;
  }
  emit({ status: "connecting", errorMessage: null, origin });

  try {
    const password = await resolvePassword(origin);
    if (generation !== bootGeneration) {
      return;
    }
    const outcome = await probeHealth(origin, password);
    if (generation !== bootGeneration) {
      return;
    }
    if (outcome === "requires-auth") {
      emit({
        status: "requires-auth",
        errorMessage: password === null ? null : "The sidecar rejected this password.",
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
  /** Manual password / paste-link entry (no reload-only dead end). */
  submitToken(raw: string): void {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      emit({
        status: "requires-auth",
        errorMessage: "Paste the sidecar password or pairing link to attach this browser.",
        origin: snapshot.origin,
      });
      return;
    }

    // Accept a full pairing URL: extract #token= / ?token= when a link is pasted.
    let password = trimmed;
    try {
      if (trimmed.includes("://") || trimmed.startsWith("/") || trimmed.includes("#token=")) {
        const url = new URL(trimmed, window.location.origin);
        const fromLink = (() => {
          const hashToken = readHashParams(url).get(PAIRING_TOKEN_PARAM)?.trim() ?? "";
          if (hashToken.length > 0) {
            return hashToken;
          }
          return url.searchParams.get(PAIRING_TOKEN_PARAM)?.trim() ?? "";
        })();
        if (fromLink.length > 0) {
          password = fromLink;
        }
      }
    } catch {
      // Not a URL — treat the whole string as the password.
    }

    const generation = ++bootGeneration;
    void (async () => {
      emit({ status: "connecting", errorMessage: null, origin: snapshot.origin });
      await disposeLiveClient();

      let origin: string;
      try {
        origin = snapshot.origin ?? resolveOrigin();
      } catch (error) {
        if (generation !== bootGeneration) {
          return;
        }
        emit({
          status: "unreachable",
          errorMessage: errorMessageOf(error, "Could not resolve the sidecar URL."),
          origin: null,
        });
        return;
      }

      try {
        const outcome = await probeHealth(origin, password);
        if (generation !== bootGeneration) {
          return;
        }
        if (outcome === "requires-auth") {
          emit({
            status: "requires-auth",
            errorMessage: "The sidecar rejected this password.",
            origin,
          });
          return;
        }
        writeStoredPassword(origin, password);
        stripTokenFromUrl();
        await bindClient(origin, password, generation);
      } catch (error) {
        if (generation !== bootGeneration) {
          return;
        }
        await disposeLiveClient();
        const classified = classifyFailure(error);
        emit({
          status: classified.status === "unreachable" ? "unreachable" : "requires-auth",
          errorMessage: classified.errorMessage,
          origin,
        });
      }
    })();
  },

  retry(): void {
    beginBoot();
  },

  /** Clear the stored password and drop the sidecar client (explicit sign-out). */
  signOut(): void {
    bootGeneration += 1;
    clearStoredPassword();
    void disposeLiveClient().then(() => {
      emit({ status: "requires-auth", errorMessage: null, origin: snapshot.origin });
    });
  },
};
