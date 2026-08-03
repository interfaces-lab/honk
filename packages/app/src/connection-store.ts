// Connection boot store. Timers and promises live here so components stay effect-free.

import {
  createOpenCodeClient,
  createOpenCodeRegistry,
  createOpenCodeServer,
  HonkPairingRequestError,
  normalizeOpenCodeOrigin,
  openCodeAuthorizationHeader,
  parseOpenCodeConnection,
  type OpenCodeClient,
  type OpenCodeConnection,
  type OpenCodeConnectionCandidate,
} from "@honk/opencode";
import { useSyncExternalStore } from "react";

import {
  BrowserPairingTransaction,
  discardBrowserPairingCode,
  recoverCommittedBrowserPairing,
  stripBrowserConnectionCredential,
  type PendingConnectionPairing,
} from "./browser-pairing";
import { bindProviderAuthClient } from "./provider-auth";
import { bindOpenCodeClient } from "./watch-registry";

export type { PendingConnectionPairing } from "./browser-pairing";

export type ConnectionSnapshot =
  | {
      readonly status: "connecting";
      readonly errorMessage: null;
      /** Resolved OpenCode HTTP origin once known (null only before the first resolve). */
      readonly origin: string | null;
    }
  | {
      readonly status: "confirm-pairing";
      readonly errorMessage: string | null;
      readonly origin: string;
      readonly pairing: PendingConnectionPairing;
    }
  | {
      readonly status: "authenticated";
      readonly errorMessage: null;
      readonly origin: string;
    }
  | {
      readonly status: "requires-auth";
      readonly errorMessage: string | null;
      readonly origin: string | null;
    }
  | {
      readonly status: "unreachable";
      readonly errorMessage: string;
      readonly origin: string | null;
    };

export type ConnectionStatus = ConnectionSnapshot["status"];

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
let activePairing: BrowserPairingTransaction | null = null;
let retryCandidate: OpenCodeConnectionCandidate | null = null;
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
        throw new ProbeHttpError("This computer could not finish connecting.", response.status);
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
  if (candidate.credential.type !== "password") {
    throw new Error("Pairing access must be confirmed before it can be used.");
  }
  return { origin: candidate.origin, password: candidate.credential.value };
}

type ConnectionResolution =
  | { readonly kind: "connection"; readonly connection: OpenCodeConnection }
  | { readonly kind: "confirmation"; readonly transaction: BrowserPairingTransaction };

type AppliedConnectionResolution = "bound" | "confirmation" | "requires-auth" | "stale";

async function resolveCandidate(
  candidate: OpenCodeConnectionCandidate,
): Promise<ConnectionResolution> {
  if (candidate.credential.type === "password") {
    return { kind: "connection", connection: await connectionFromCandidate(candidate) };
  }

  return {
    kind: "confirmation",
    transaction: await BrowserPairingTransaction.preview(
      candidate.origin,
      candidate.credential.value,
    ),
  };
}

async function resolveConnection(
  origin: string,
  generation: number,
): Promise<ConnectionResolution> {
  const urlCandidate = parseOpenCodeConnection(window.location.href, origin);
  if (urlCandidate !== null) {
    try {
      const resolution = await resolveCandidate(urlCandidate);
      if (generation === bootGeneration && resolution.kind === "connection") {
        stripBrowserConnectionCredential();
      }
      return resolution;
    } catch (error) {
      if (
        generation === bootGeneration &&
        urlCandidate.credential.type === "pairing" &&
        error instanceof HonkPairingRequestError &&
        error.kind === "invalid"
      ) {
        if (bootstrapOriginProvider === null) {
          // A stale preview can mean confirmation succeeded before its response was lost.
          // If recovery throws, leave the link intact until the computer is reachable again.
          const recovered = await recoverCommittedBrowserPairing(
            urlCandidate.origin,
            urlCandidate.credential.value,
            () => probeHealth(urlCandidate.origin, null),
          );
          if (recovered !== null) {
            return {
              kind: "connection",
              connection: recovered,
            };
          }
        }
        await discardBrowserPairingCode(urlCandidate.origin, urlCandidate.credential.value);
      }
      throw error;
    }
  }

  if (bootstrapCredentialProvider !== null) {
    const credential = await bootstrapCredentialProvider();
    if (credential !== null) {
      const candidate: OpenCodeConnectionCandidate = {
        origin,
        credential: {
          type: credential.kind === "pairing-token" ? "pairing" : "password",
          value: credential.credential,
        },
      };
      return credential.kind === "pairing-token"
        ? resolveCandidate(candidate)
        : { kind: "connection", connection: await connectionFromCandidate(candidate) };
    }
  }

  return {
    kind: "connection",
    connection: { origin, password: readStoredPassword(origin) ?? "" },
  };
}

async function applyResolution(
  resolution: ConnectionResolution,
  generation: number,
): Promise<AppliedConnectionResolution> {
  if (generation !== bootGeneration) return "stale";
  if (resolution.kind === "confirmation") {
    retryCandidate = null;
    activePairing = resolution.transaction;
    emit({
      status: "confirm-pairing",
      errorMessage: null,
      origin: resolution.transaction.pending.origin,
      pairing: resolution.transaction.pending,
    });
    return "confirmation";
  }

  emit({
    status: "connecting",
    errorMessage: null,
    origin: resolution.connection.origin,
  });
  const password =
    resolution.connection.password.length > 0 ? resolution.connection.password : null;
  if (password !== null) {
    // URL credentials are removed before the health check. Keep the password in memory so a
    // temporary network failure can retry without asking the user to paste it again.
    writeStoredPassword(resolution.connection.origin, password);
  }
  const outcome = await probeHealth(resolution.connection.origin, password);
  if (generation !== bootGeneration) return "stale";
  if (outcome === "requires-auth") {
    if (
      password !== null &&
      memoryPassword?.origin === resolution.connection.origin &&
      memoryPassword.password === password
    ) {
      clearStoredPassword();
    }
    retryCandidate = null;
    emit({
      status: "requires-auth",
      errorMessage: password === null ? null : "This computer did not accept that password.",
      origin: resolution.connection.origin,
    });
    return "requires-auth";
  }
  return (await bindClient(resolution.connection.origin, password, generation)) ? "bound" : "stale";
}

type ConnectionAttempt =
  | {
      readonly kind: "resolve-candidate";
      readonly candidate: OpenCodeConnectionCandidate;
    }
  | { readonly kind: "confirm-pairing"; readonly transaction: BrowserPairingTransaction };

type ConnectionFailureContext =
  | { readonly kind: "connection"; readonly origin: string | null }
  | { readonly kind: "pairing-preview"; readonly origin: string; readonly token: string }
  | { readonly kind: "pairing-confirmation"; readonly transaction: BrowserPairingTransaction };

async function handleConnectionFailure(
  error: unknown,
  generation: number,
  context: ConnectionFailureContext,
): Promise<void> {
  if (generation !== bootGeneration) return;
  await disposeLiveClient();
  if (generation !== bootGeneration) return;
  if (
    context.kind === "pairing-confirmation" &&
    ((error instanceof HonkPairingRequestError && error.kind === "retryable") ||
      isTransportError(error))
  ) {
    activePairing = context.transaction;
    emit({
      status: "confirm-pairing",
      errorMessage:
        "Could not finish connecting. Check that Honk is running on this computer, then try again.",
      origin: context.transaction.pending.origin,
      pairing: context.transaction.pending,
    });
    return;
  }
  if (context.kind === "pairing-confirmation") {
    context.transaction.forget();
    if (activePairing?.pending.requestId === context.transaction.pending.requestId) {
      activePairing = null;
    }
    void context.transaction.abandon();
  }
  if (
    context.kind === "pairing-preview" &&
    error instanceof HonkPairingRequestError &&
    error.kind === "invalid"
  ) {
    retryCandidate = null;
    void discardBrowserPairingCode(context.origin, context.token);
  }
  const classified = classifyFailure(error);
  emit({
    status: classified.status,
    errorMessage: classified.errorMessage,
    origin:
      context.kind === "connection"
        ? context.origin
        : context.kind === "pairing-preview"
          ? context.origin
          : context.transaction.pending.origin,
  });
}

async function finishConnectionPairing(
  pairing: BrowserPairingTransaction,
  generation: number,
): Promise<void> {
  let current = pairing;
  try {
    current = await current.claim(readStoredPassword(current.pending.origin));
  } catch (error) {
    await handleConnectionFailure(error, generation, {
      kind: "pairing-confirmation",
      transaction: current,
    });
    return;
  }
  if (generation !== bootGeneration) {
    await current.abandon();
    return;
  }
  activePairing = current;

  let connection: OpenCodeConnection;
  try {
    connection = await current.confirm();
  } catch (error) {
    if (generation !== bootGeneration) {
      await current.abandon();
      return;
    }
    await handleConnectionFailure(error, generation, {
      kind: "pairing-confirmation",
      transaction: current,
    });
    return;
  }
  if (generation !== bootGeneration) {
    await current.revoke(connection);
    return;
  }

  try {
    const outcome = await applyResolution({ kind: "connection", connection }, generation);
    if (outcome === "stale") {
      await current.revoke(connection);
      return;
    }
    if (outcome === "bound" || outcome === "requires-auth") {
      current.forget();
      if (activePairing?.pending.requestId === current.pending.requestId) activePairing = null;
    }
  } catch (error) {
    await handleConnectionFailure(error, generation, {
      kind: "connection",
      origin: connection.origin,
    });
  }
}

function beginConnectionAttempt(attempt: ConnectionAttempt): void {
  retryCandidate = attempt.kind === "resolve-candidate" ? attempt.candidate : null;
  const generation = ++bootGeneration;
  if (attempt.kind === "resolve-candidate" && activePairing !== null) {
    const previous = activePairing;
    previous.forget();
    activePairing = null;
    void previous.cancel(readStoredPassword(previous.pending.origin));
  }
  if (attempt.kind === "confirm-pairing") activePairing = attempt.transaction;
  void (async () => {
    emit({
      status: "connecting",
      errorMessage: null,
      origin:
        attempt.kind === "resolve-candidate"
          ? attempt.candidate.origin
          : attempt.transaction.pending.origin,
    });
    await disposeLiveClient();
    if (generation !== bootGeneration) return;

    if (attempt.kind === "confirm-pairing") {
      await finishConnectionPairing(attempt.transaction, generation);
      return;
    }

    let resolution: ConnectionResolution;
    try {
      resolution = await resolveCandidate(attempt.candidate);
    } catch (error) {
      await handleConnectionFailure(
        error,
        generation,
        attempt.candidate.credential.type === "pairing"
          ? {
              kind: "pairing-preview",
              origin: attempt.candidate.origin,
              token: attempt.candidate.credential.value,
            }
          : { kind: "connection", origin: attempt.candidate.origin },
      );
      return;
    }

    try {
      await applyResolution(resolution, generation);
    } catch (error) {
      await handleConnectionFailure(error, generation, {
        kind: "connection",
        origin:
          resolution.kind === "connection"
            ? resolution.connection.origin
            : resolution.transaction.pending.origin,
      });
    }
  })();
}

function classifyFailure(error: unknown): {
  readonly status: "requires-auth" | "unreachable";
  readonly errorMessage: string;
} {
  if (error instanceof HonkPairingRequestError) {
    return error.kind !== "retryable"
      ? {
          status: "requires-auth",
          errorMessage: error.message,
        }
      : {
          status: "unreachable",
          errorMessage:
            "Could not finish connecting. Check that Honk is running on this computer, then try again.",
        };
  }
  if (isTransportError(error)) {
    return {
      status: "unreachable",
      errorMessage: "Could not reach this computer. Check that Honk is running there, then retry.",
    };
  }
  if (isRetryable(error)) {
    return {
      status: "unreachable",
      errorMessage: errorMessageOf(
        error,
        "Could not reach this computer. Check that Honk is running there, then retry.",
      ),
    };
  }
  return {
    status: "unreachable",
    errorMessage: errorMessageOf(error, "Could not connect to this computer."),
  };
}

async function bindClient(
  origin: string,
  password: string | null,
  generation: number,
): Promise<boolean> {
  const client = createOpenCodeClient(createOpenCodeServer({ origin }), {
    ...(password === null ? {} : { password }),
  });
  if (generation !== bootGeneration) {
    client.close();
    return false;
  }
  clientRegistry.register(client);
  liveClient = client;
  livePassword = password;
  retryCandidate = null;
  bindOpenCodeClient(client);
  bindProviderAuthClient(client);
  emit({ status: "authenticated", errorMessage: null, origin });
  return true;
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
      errorMessage: errorMessageOf(error, "Could not read this computer's address."),
      origin: null,
    });
    return;
  }

  if (generation !== bootGeneration) {
    return;
  }
  emit({ status: "connecting", errorMessage: null, origin });

  try {
    await applyResolution(await resolveConnection(origin, generation), generation);
  } catch (error) {
    await handleConnectionFailure(error, generation, { kind: "connection", origin });
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
  confirmPairing(): void {
    if (snapshot.status !== "confirm-pairing") return;
    if (activePairing?.pending.requestId !== snapshot.pairing.requestId) return;
    beginConnectionAttempt({ kind: "confirm-pairing", transaction: activePairing });
  },

  cancelPairing(): void {
    const pairing = activePairing;
    retryCandidate = null;
    if (pairing === null) {
      beginBoot();
      return;
    }
    const previousPassword = readStoredPassword(pairing.pending.origin);
    const generation = ++bootGeneration;
    emit({ status: "connecting", errorMessage: null, origin: pairing.pending.origin });
    void pairing.cancel(previousPassword).then(
      () => {
        if (generation !== bootGeneration) return;
        pairing.forget();
        if (activePairing?.pending.requestId === pairing.pending.requestId) {
          activePairing = null;
        }
        if (previousPassword !== null) {
          beginConnectionAttempt({
            kind: "resolve-candidate",
            candidate: {
              origin: pairing.pending.origin,
              credential: { type: "password", value: previousPassword },
            },
          });
          return;
        }
        beginBoot();
      },
      () => {
        if (generation !== bootGeneration) return;
        activePairing = pairing;
        emit({
          status: "confirm-pairing",
          errorMessage:
            "Could not cancel this connection. Check that Honk is running on this computer, then try again.",
          origin: pairing.pending.origin,
          pairing: pairing.pending,
        });
      },
    );
  },

  /** Manual password / pairing-link entry (no reload-only dead end). */
  submitToken: (raw: string): void => {
    const trimmed = raw.trim();
    retryCandidate = null;
    if (trimmed.length === 0) {
      emit({
        status: "requires-auth",
        errorMessage: "Paste a Honk connection link or computer password to connect this browser.",
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
        errorMessage: "That link does not contain a connection code or computer password.",
        origin: snapshot.origin,
      });
      return;
    }
    beginConnectionAttempt({
      kind: "resolve-candidate",
      candidate,
    });
  },

  retry: (): void => {
    if (retryCandidate !== null) {
      beginConnectionAttempt({ kind: "resolve-candidate", candidate: retryCandidate });
      return;
    }
    beginBoot();
  },

  /** Revoke the paired browser credential when possible, then drop the local client. */
  signOut: (): void => {
    const generation = ++bootGeneration;
    const origin = snapshot.origin;
    const password = livePassword;
    retryCandidate = null;
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
