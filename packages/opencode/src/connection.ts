export type OpenCodeFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface OpenCodeConnection {
  readonly origin: string;
  readonly password: string;
}

export type OpenCodeConnectionCandidate = {
  readonly origin: string;
  readonly credential:
    | { readonly type: "password"; readonly value: string }
    | { readonly type: "pairing"; readonly value: string };
};

const isObject = (value: unknown): value is object => typeof value === "object" && value !== null;

/** Normalize an `opencode serve` base URL without carrying paths or embedded credentials. */
export function normalizeOpenCodeOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter the HTTP or HTTPS address shown by the Honk host.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("The OpenCode address must use HTTP or HTTPS.");
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new Error("The OpenCode address cannot contain credentials.");
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    throw new Error("The OpenCode address cannot contain query parameters or a fragment.");
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${pathname === "" || pathname === "/" ? "" : pathname}`;
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
  return `Basic ${base64Utf8(`opencode:${password}`)}`;
}

/** Fail fast before constructing the long-lived SDK client and SSE stream. */
export async function probeOpenCodeConnection(
  connection: OpenCodeConnection,
  fetchImpl: OpenCodeFetch = fetch,
): Promise<void> {
  const origin = normalizeOpenCodeOrigin(connection.origin);
  const response = await fetchImpl(`${origin}/global/health`, {
    headers: { Authorization: openCodeAuthorizationHeader(connection.password) },
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error("The OpenCode password is incorrect.");
  }
  if (!response.ok) {
    throw new Error(`The OpenCode host returned HTTP ${response.status}.`);
  }
  const payload: unknown = await response.json();
  if (!isObject(payload) || Reflect.get(payload, "healthy") !== true) {
    throw new Error("The address responded, but it is not a healthy OpenCode server.");
  }
}

function secretFromUrl(url: URL): string | null {
  const query = url.searchParams.get("password") ?? url.searchParams.get("token");
  if (query !== null && query.trim().length > 0) return query.trim();
  const fragment = new URLSearchParams(url.hash.slice(1));
  const secret = fragment.get("password") ?? fragment.get("token");
  return secret !== null && secret.trim().length > 0 ? secret.trim() : null;
}

function pairingTokenFromUrl(url: URL): string | null {
  const query = url.searchParams.get("pairing") ?? url.searchParams.get("token");
  if (query !== null && query.trim().length > 0) return query.trim();
  const fragment = new URLSearchParams(url.hash.slice(1));
  const secret = fragment.get("pairing") ?? fragment.get("token");
  return secret !== null && secret.trim().length > 0 ? secret.trim() : null;
}

/** Parse a Honk attach link, an authenticated HTTP URL, or a raw password plus fallback host. */
export function parseOpenCodeConnection(
  value: string,
  fallbackOrigin?: string,
): OpenCodeConnectionCandidate | null {
  const input = value.trim();
  if (input.length === 0) return null;
  try {
    const url = new URL(input);
    const embeddedOrigin = url.searchParams.get("origin") ?? url.searchParams.get("host");
    const origin = normalizeOpenCodeOrigin(
      embeddedOrigin ?? (url.protocol === "http:" || url.protocol === "https:" ? url.origin : ""),
    );
    const password = new URLSearchParams(url.hash.slice(1)).get("password");
    if (password !== null && password.trim().length > 0) {
      return { origin, credential: { type: "password", value: password.trim() } };
    }
    const pairingToken = pairingTokenFromUrl(url);
    const isPairingPath = url.pathname.replace(/\/+$/, "") === "/pair";
    if (
      pairingToken !== null &&
      (embeddedOrigin !== null || url.protocol === "honk:" || isPairingPath)
    ) {
      return { origin, credential: { type: "pairing", value: pairingToken } };
    }
    const directPassword = secretFromUrl(url);
    return directPassword === null
      ? null
      : { origin, credential: { type: "password", value: directPassword } };
  } catch (error) {
    if (input.includes("://")) throw error;
    if (fallbackOrigin === undefined || fallbackOrigin.trim().length === 0) return null;
    return {
      origin: normalizeOpenCodeOrigin(fallbackOrigin),
      credential: { type: "password", value: input },
    };
  }
}

/** Password stays in the fragment so normal HTTP referrers and server logs do not receive it. */
export function createOpenCodeAttachUrl(connection: OpenCodeConnection): string {
  const origin = normalizeOpenCodeOrigin(connection.origin);
  const query = new URLSearchParams({ origin });
  const fragment = new URLSearchParams({ password: connection.password });
  return `honk://connect?${query.toString()}#${fragment.toString()}`;
}

export async function exchangeHonkPairing(
  origin: string,
  pairingToken: string,
  options?: { readonly label?: string; readonly fetch?: OpenCodeFetch },
): Promise<OpenCodeConnection> {
  const normalizedOrigin = normalizeOpenCodeOrigin(origin);
  const response = await (options?.fetch ?? fetch)(`${normalizedOrigin}/honk/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: pairingToken,
      ...(options?.label !== undefined ? { label: options.label } : {}),
    }),
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error("This attach link is invalid, expired, or was already used.");
  }
  if (!response.ok) {
    throw new Error(`The Honk host rejected pairing with HTTP ${response.status}.`);
  }
  const payload: unknown = await response.json();
  const password = isObject(payload) ? Reflect.get(payload, "password") : undefined;
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("The Honk host returned an invalid device credential.");
  }
  return { origin: normalizedOrigin, password };
}
