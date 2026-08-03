import { hmacSha256Hex, type Sha256Digest } from "./hmac";

export type OpenCodeFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface OpenCodeConnection {
  readonly origin: string;
  readonly password: string;
}

export interface HonkConfirmedConnection extends OpenCodeConnection {
  readonly deviceId: string | null;
  readonly serverId: string | null;
}

export interface HonkPairingPreview {
  readonly name: string;
  readonly origin: string;
  readonly expiresAt: string;
  readonly serverId: string | null;
}

export type HonkServerIdentityProbeResult =
  | { readonly kind: "verified" }
  | { readonly kind: "mismatch" }
  | { readonly kind: "unavailable" };

export interface HonkProvisionalConnection {
  readonly deviceId: string | null;
  readonly origin: string;
  readonly password: string;
  readonly requestId: string;
  readonly expiresAt: string;
}

export class HonkPairingRequestError extends Error {
  readonly kind: "existing-access-invalid" | "invalid" | "retryable";

  constructor(
    kind: "existing-access-invalid" | "invalid" | "retryable",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "HonkPairingRequestError";
    this.kind = kind;
  }
}

export type OpenCodeConnectionCandidate = {
  readonly origin: string;
  readonly credential:
    | { readonly type: "password"; readonly value: string }
    | { readonly type: "pairing"; readonly value: string };
};

const isObject = (value: unknown): value is object => typeof value === "object" && value !== null;

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

async function sendPairingRequest(
  input: string,
  init: RequestInit,
  fetchImpl: OpenCodeFetch,
): Promise<Response> {
  try {
    return await fetchImpl(input, init);
  } catch (cause) {
    throw new HonkPairingRequestError(
      "retryable",
      "Honk could not reach this computer. Check the connection and try again.",
      { cause },
    );
  }
}

async function readPairingResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (cause) {
    throw new HonkPairingRequestError(
      "retryable",
      "This computer returned an unreadable connection response. Try again.",
      { cause },
    );
  }
}

async function pairingErrorCode(response: Response): Promise<string | null> {
  try {
    const payload: unknown = await response.json();
    const code = isObject(payload) ? Reflect.get(payload, "code") : undefined;
    return typeof code === "string" ? code : null;
  } catch {
    return null;
  }
}

function normalizePairingResponseOrigin(value: string): string {
  try {
    return normalizeOpenCodeOrigin(value);
  } catch (cause) {
    throw new HonkPairingRequestError(
      "retryable",
      "This computer returned an invalid address. Try again.",
      { cause },
    );
  }
}

/** Strip paths and embedded credentials from an `opencode serve` base URL. */
export function normalizeOpenCodeOrigin(value: string): string {
  const input = value.trim();
  const url = parseUrl(input);
  if (url === null) {
    throw new Error("Enter the HTTP or HTTPS address shown by Honk on your computer.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("The computer address must use HTTP or HTTPS.");
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new Error("The computer address cannot contain sign-in details.");
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    throw new Error("The computer address cannot contain extra link details.");
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${pathname === "" || pathname === "/" ? "" : pathname}`;
}

// Matching the whole 127/8 literal rather than a "127." prefix keeps registrable domains such as
// 127.0.0.1.attacker.com out of loopback, which would otherwise permit cleartext to a public host.
const LOOPBACK_IPV4 = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

export function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    LOOPBACK_IPV4.test(hostname) ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

export function normalizeRemoteOpenCodeOrigin(value: string): string {
  const origin = normalizeOpenCodeOrigin(value);
  const url = new URL(origin);
  if (url.protocol !== "https:" && !isLoopbackHost(url.hostname)) {
    throw new Error("Connections to another computer must use HTTPS.");
  }
  return origin;
}

const IDENTITY_PROBE_TIMEOUT_MS = 5_000;

/**
 * Ask the host answering at `origin` to prove it still holds `serverId`, before any credential is
 * offered. The host answers `HMAC-SHA256(serverId, `${origin}\n${nonce}`)`, so only a caller that
 * already knows the id can verify the response for its nonce.
 *
 * The result distinguishes a host that answered with an invalid proof from a transport failure so
 * reconnectors can block the former and safely retry the latter without sending a credential.
 */
export async function probeHonkServerIdentity(
  origin: string,
  serverId: string,
  nonce: string,
  digest: Sha256Digest,
  options: {
    readonly fetch?: OpenCodeFetch;
    readonly signal?: AbortSignal;
    readonly timeoutMs?: number;
  } = {},
): Promise<HonkServerIdentityProbeResult> {
  const normalizedOrigin = identityProbeOrigin(origin);
  if (normalizedOrigin === null) return { kind: "mismatch" };
  const controller = new AbortController();
  const abort = (): void => controller.abort(options.signal?.reason);
  if (options.signal?.aborted === true) {
    abort();
  } else {
    options.signal?.addEventListener("abort", abort, { once: true });
  }
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? IDENTITY_PROBE_TIMEOUT_MS,
  );
  const response = await (options.fetch ?? fetch)(
    `${normalizedOrigin}/honk/health?probe=${encodeURIComponent(nonce)}`,
    { signal: controller.signal },
  ).catch(() => null);
  if (response === null) {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
    return { kind: "unavailable" };
  }
  if (!response.ok) {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
    return response.status === 408 || response.status === 429 || response.status >= 500
      ? { kind: "unavailable" }
      : { kind: "mismatch" };
  }
  // The abort has to outlive the headers: cancelling it earlier would leave a stalled body
  // hanging on a host that answered and then stopped writing.
  const payload: unknown = await response.json().catch(() => null);
  clearTimeout(timeout);
  options.signal?.removeEventListener("abort", abort);
  if (controller.signal.aborted) return { kind: "unavailable" };
  const proof = isObject(payload) ? Reflect.get(payload, "proof") : undefined;
  if (typeof proof !== "string" || proof.length === 0) return { kind: "mismatch" };
  const expectedProof = await hmacSha256Hex(
    digest,
    serverId,
    `${normalizedOrigin}\n${nonce}`,
  ).catch(() => null);
  if (expectedProof === null) return { kind: "unavailable" };
  if (proof.length !== expectedProof.length) return { kind: "mismatch" };
  // Accumulate every character difference so a wrong proof cannot be recovered one character at a
  // time from how early the comparison stops.
  return Array.from(
    { length: proof.length },
    (_slot, index) => proof.charCodeAt(index) ^ expectedProof.charCodeAt(index),
  ).reduce((difference, character) => difference | character, 0) === 0
    ? { kind: "verified" }
    : { kind: "mismatch" };
}

/**
 * Fail-closed compatibility helper for callers that only need a yes/no identity decision.
 */
export async function verifyHonkServerIdentity(
  origin: string,
  serverId: string,
  nonce: string,
  digest: Sha256Digest,
  options: {
    readonly fetch?: OpenCodeFetch;
    readonly signal?: AbortSignal;
    readonly timeoutMs?: number;
  } = {},
): Promise<boolean> {
  return (
    (await probeHonkServerIdentity(origin, serverId, nonce, digest, options)).kind === "verified"
  );
}

function identityProbeOrigin(value: string): string | null {
  try {
    return normalizeOpenCodeOrigin(value);
  } catch {
    return null;
  }
}

function utf8Bytes(value: string): number[] {
  const bytes: number[] = [];
  for (const character of value) {
    const point = character.codePointAt(0);
    if (point === undefined) continue;
    if (point <= 0x7f) {
      bytes.push(point);
    } else if (point <= 0x7ff) {
      bytes.push(0xc0 | (point >> 6), 0x80 | (point & 0x3f));
    } else if (point <= 0xffff) {
      bytes.push(0xe0 | (point >> 12), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f));
    } else {
      bytes.push(
        0xf0 | (point >> 18),
        0x80 | ((point >> 12) & 0x3f),
        0x80 | ((point >> 6) & 0x3f),
        0x80 | (point & 0x3f),
      );
    }
  }
  return bytes;
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64Utf8(value: string): string {
  const bytes = utf8Bytes(value);
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const hasSecond = index + 1 < bytes.length;
    const hasThird = index + 2 < bytes.length;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const packed = (first << 16) | (second << 8) | third;
    output += BASE64_ALPHABET.charAt((packed >> 18) & 63);
    output += BASE64_ALPHABET.charAt((packed >> 12) & 63);
    output += hasSecond ? BASE64_ALPHABET.charAt((packed >> 6) & 63) : "=";
    output += hasThird ? BASE64_ALPHABET.charAt(packed & 63) : "=";
  }
  return output;
}

export function openCodeAuthorizationHeader(password: string): string {
  // HTTP Basic username is fixed as "opencode".
  return `Basic ${base64Utf8(`opencode:${password}`)}`;
}

export async function probeOpenCodeConnection(
  connection: OpenCodeConnection,
  fetchImpl: OpenCodeFetch = fetch,
): Promise<void> {
  const origin = normalizeOpenCodeOrigin(connection.origin);
  const response = await fetchImpl(`${origin}/global/health`, {
    headers: { Authorization: openCodeAuthorizationHeader(connection.password) },
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error("The computer password is incorrect.");
  }
  if (!response.ok) {
    throw new Error("The computer could not answer the connection check. Try again.");
  }
  const payload: unknown = await response.json();
  if (!isObject(payload) || Reflect.get(payload, "healthy") !== true) {
    throw new Error("The address answered, but Honk is not ready on that computer.");
  }
}

/** Revoke the device credential represented by this connection. */
export async function revokeHonkConnection(
  connection: OpenCodeConnection,
  fetchImpl: OpenCodeFetch = fetch,
): Promise<void> {
  const origin = normalizeOpenCodeOrigin(connection.origin);
  const response = await fetchImpl(`${origin}/honk/sign-out`, {
    method: "POST",
    headers: { Authorization: openCodeAuthorizationHeader(connection.password) },
  });
  if (!response.ok) {
    throw new Error("The computer could not remove the old access. Try again.");
  }
}

/** Accept a Honk attach link, authenticated HTTP URL, or raw password with fallback host. */
export function parseOpenCodeConnection(
  value: string,
  fallbackOrigin?: string,
): OpenCodeConnectionCandidate | null {
  const input = value.trim();
  if (input.length === 0) return null;
  const url = parseUrl(input);
  if (url === null) {
    if (input.includes("://")) {
      throw new Error("Enter a valid Honk link or HTTP address.");
    }
    const origin = fallbackOrigin?.trim() ?? "";
    if (origin.length === 0) return null;
    return {
      origin: normalizeOpenCodeOrigin(origin),
      credential: { type: "password", value: input },
    };
  }

  const fragment = new URLSearchParams(url.hash.slice(1));
  const pairing = url.searchParams.get("pairing")?.trim() || fragment.get("pairing")?.trim() || "";
  const password =
    url.searchParams.get("password")?.trim() || fragment.get("password")?.trim() || "";
  const token = url.searchParams.get("token")?.trim() || fragment.get("token")?.trim() || "";
  if (pairing.length === 0 && password.length === 0 && token.length === 0) return null;

  const embeddedOrigin =
    url.searchParams.get("origin")?.trim() || url.searchParams.get("host")?.trim() || "";
  const origin =
    embeddedOrigin || (url.protocol === "http:" || url.protocol === "https:" ? url.origin : "");
  if (origin.length === 0) return null;
  const tokenIsPairing =
    embeddedOrigin.length > 0 ||
    url.protocol === "honk:" ||
    url.pathname.replace(/\/+$/, "") === "/pair";
  return {
    origin: normalizeOpenCodeOrigin(origin),
    credential:
      pairing.length > 0
        ? { type: "pairing", value: pairing }
        : password.length > 0
          ? { type: "password", value: password }
          : tokenIsPairing
            ? { type: "pairing", value: token }
            : { type: "password", value: token },
  };
}

/** Keep the password in the fragment so referrers and server logs do not see it. */
export function createOpenCodeAttachUrl(connection: OpenCodeConnection): string {
  const origin = normalizeOpenCodeOrigin(connection.origin);
  const query = new URLSearchParams({ origin });
  const fragment = new URLSearchParams({ password: connection.password });
  return `honk://connect?${query.toString()}#${fragment.toString()}`;
}

export async function exchangeHonkPairing(
  origin: string,
  pairingToken: string,
  options: {
    readonly requestId: string;
    readonly label?: string;
    readonly replacePassword?: string;
    readonly fetch?: OpenCodeFetch;
  },
): Promise<HonkProvisionalConnection> {
  const normalizedOrigin = normalizeOpenCodeOrigin(origin);
  const response = await sendPairingRequest(
    `${normalizedOrigin}/honk/pair`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(options.replacePassword === undefined
          ? {}
          : { Authorization: openCodeAuthorizationHeader(options.replacePassword) }),
      },
      body: JSON.stringify({
        token: pairingToken,
        requestId: options.requestId,
        ...(options.label !== undefined ? { label: options.label } : {}),
      }),
    },
    options.fetch ?? fetch,
  );
  if (response.status === 401 || response.status === 403) {
    if ((await pairingErrorCode(response)) === "existing_access_invalid") {
      throw new HonkPairingRequestError(
        "existing-access-invalid",
        "The saved access for this computer no longer works. Remove the saved connection, then use this code again.",
      );
    }
    throw new HonkPairingRequestError(
      "invalid",
      "This connection code is invalid, expired, or was already used.",
    );
  }
  if (response.status === 409 && (await pairingErrorCode(response)) === "pairing_in_progress") {
    throw new HonkPairingRequestError(
      "invalid",
      "Another device already started using this connection code. Ask for a new code and try again.",
    );
  }
  if (response.status === 400) {
    throw new HonkPairingRequestError(
      "invalid",
      "This computer could not accept the connection request. Ask for a new code and try again.",
    );
  }
  if (response.status !== 202) {
    throw new HonkPairingRequestError(
      "retryable",
      "This computer could not finish connecting. Try again.",
    );
  }
  const payload = await readPairingResponse(response);
  const password = isObject(payload) ? Reflect.get(payload, "password") : undefined;
  const deviceId = isObject(payload) ? Reflect.get(payload, "deviceId") : undefined;
  const requestId = isObject(payload) ? Reflect.get(payload, "requestId") : undefined;
  const expiresAt = isObject(payload) ? Reflect.get(payload, "expiresAt") : undefined;
  if (
    !isObject(payload) ||
    Reflect.get(payload, "status") !== "provisional" ||
    typeof password !== "string" ||
    password.length === 0 ||
    (deviceId !== undefined && (typeof deviceId !== "string" || deviceId.trim().length === 0)) ||
    requestId !== options.requestId ||
    typeof expiresAt !== "string" ||
    !Number.isFinite(Date.parse(expiresAt))
  ) {
    throw new HonkPairingRequestError(
      "retryable",
      "This computer returned an invalid connection. Try again.",
    );
  }
  return {
    deviceId: typeof deviceId === "string" ? deviceId.trim() : null,
    origin: normalizedOrigin,
    password,
    requestId,
    expiresAt,
  };
}

async function reconcileHonkPairingConfirmation(
  deviceId: string | null,
  origin: string,
  password: string,
  unauthorized: "invalid" | "retryable",
  fetchImpl: OpenCodeFetch,
): Promise<HonkConfirmedConnection> {
  const health = await sendPairingRequest(
    `${origin}/global/health`,
    { headers: { Authorization: openCodeAuthorizationHeader(password) } },
    fetchImpl,
  ).catch(() => null);
  if (health?.status === 401 || health?.status === 403) {
    if (unauthorized === "invalid") {
      throw new HonkPairingRequestError(
        "invalid",
        "This connection code expired before access was confirmed. Ask for a new code and try again.",
      );
    }
    throw new HonkPairingRequestError(
      "retryable",
      "Honk could not verify whether access was confirmed. Try again.",
    );
  }
  if (health?.status === 200) {
    const payload = await readPairingResponse(health).catch(() => null);
    if (isObject(payload) && Reflect.get(payload, "healthy") === true) {
      return { deviceId, origin, password, serverId: null };
    }
  }
  throw new HonkPairingRequestError(
    "retryable",
    "Honk could not verify whether access was confirmed. Try again.",
  );
}

export async function confirmHonkPairing(
  provisional: HonkProvisionalConnection,
  fetchImpl: OpenCodeFetch = fetch,
): Promise<HonkConfirmedConnection> {
  const origin = normalizeOpenCodeOrigin(provisional.origin);
  const response = await sendPairingRequest(
    `${origin}/honk/pair/confirm`,
    {
      method: "POST",
      headers: { Authorization: openCodeAuthorizationHeader(provisional.password) },
    },
    fetchImpl,
  ).catch(() => null);
  if (response === null) {
    return reconcileHonkPairingConfirmation(
      provisional.deviceId,
      origin,
      provisional.password,
      "retryable",
      fetchImpl,
    );
  }
  if (response.status === 401 || response.status === 403 || response.status === 409) {
    return reconcileHonkPairingConfirmation(
      provisional.deviceId,
      origin,
      provisional.password,
      "invalid",
      fetchImpl,
    );
  }
  if (response.status !== 200) {
    throw new HonkPairingRequestError(
      "retryable",
      "This computer could not confirm access. Try again.",
    );
  }
  const payload = await readPairingResponse(response).catch(() => null);
  if (payload === null) {
    return reconcileHonkPairingConfirmation(
      provisional.deviceId,
      origin,
      provisional.password,
      "retryable",
      fetchImpl,
    );
  }
  const password = isObject(payload) ? Reflect.get(payload, "password") : undefined;
  const deviceId = isObject(payload) ? Reflect.get(payload, "deviceId") : undefined;
  const serverId = isObject(payload) ? Reflect.get(payload, "serverId") : undefined;
  if (
    !isObject(payload) ||
    Reflect.get(payload, "status") !== "completed" ||
    typeof password !== "string" ||
    password !== provisional.password ||
    (deviceId !== undefined &&
      (typeof deviceId !== "string" ||
        deviceId.trim().length === 0 ||
        (provisional.deviceId !== null && deviceId.trim() !== provisional.deviceId)))
  ) {
    throw new HonkPairingRequestError(
      "retryable",
      "This computer returned an invalid confirmation. Try again.",
    );
  }
  return {
    deviceId: typeof deviceId === "string" ? deviceId.trim() : provisional.deviceId,
    origin,
    password,
    serverId: typeof serverId === "string" && serverId.length > 0 ? serverId : null,
  };
}

export async function cancelHonkPairing(
  provisional: HonkProvisionalConnection,
  fetchImpl: OpenCodeFetch = fetch,
): Promise<void> {
  const origin = normalizeOpenCodeOrigin(provisional.origin);
  const response = await sendPairingRequest(
    `${origin}/honk/pair/cancel`,
    {
      method: "POST",
      headers: { Authorization: openCodeAuthorizationHeader(provisional.password) },
    },
    fetchImpl,
  );
  if (!response.ok) {
    throw new HonkPairingRequestError(
      "retryable",
      "This computer could not cancel the pending connection. Try again.",
    );
  }
}

export async function previewHonkPairing(
  origin: string,
  pairingToken: string,
  fetchImpl: OpenCodeFetch = fetch,
): Promise<HonkPairingPreview> {
  const normalizedOrigin = normalizeOpenCodeOrigin(origin);
  const response = await sendPairingRequest(
    `${normalizedOrigin}/honk/pair/preview`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: pairingToken }),
    },
    fetchImpl,
  );
  if (response.status === 401 || response.status === 403) {
    throw new HonkPairingRequestError(
      "invalid",
      "This connection code is invalid, expired, or was already used.",
    );
  }
  if (!response.ok) {
    throw new HonkPairingRequestError(
      "retryable",
      "This computer could not check the connection code. Try again.",
    );
  }
  const payload = await readPairingResponse(response);
  const name = isObject(payload) ? Reflect.get(payload, "name") : undefined;
  const previewOrigin = isObject(payload) ? Reflect.get(payload, "origin") : undefined;
  const expiresAt = isObject(payload) ? Reflect.get(payload, "expiresAt") : undefined;
  const serverId = isObject(payload) ? Reflect.get(payload, "serverId") : undefined;
  if (
    typeof name !== "string" ||
    name.trim().length === 0 ||
    typeof previewOrigin !== "string" ||
    typeof expiresAt !== "string" ||
    !Number.isFinite(Date.parse(expiresAt))
  ) {
    throw new HonkPairingRequestError(
      "retryable",
      "This computer returned invalid connection details. Try again.",
    );
  }
  const confirmedOrigin = normalizePairingResponseOrigin(previewOrigin);
  if (confirmedOrigin !== normalizedOrigin) {
    throw new HonkPairingRequestError(
      "invalid",
      "This connection link does not match the computer that answered.",
    );
  }
  return {
    name: name.trim(),
    origin: confirmedOrigin,
    expiresAt,
    serverId: typeof serverId === "string" && serverId.length > 0 ? serverId : null,
  };
}
