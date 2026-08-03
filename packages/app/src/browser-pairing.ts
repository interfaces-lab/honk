import {
  cancelHonkPairing,
  confirmHonkPairing,
  exchangeHonkPairing,
  HonkPairingRequestError,
  previewHonkPairing,
  revokeHonkConnection,
  type HonkPairingPreview,
  type HonkProvisionalConnection,
  type OpenCodeConnection,
} from "@honk/opencode";

export interface PendingConnectionPairing {
  readonly origin: string;
  readonly token: string;
  readonly requestId: string;
  readonly preview: HonkPairingPreview;
}

const URL_CREDENTIAL_PARAMS = ["pairing", "password", "token"] as const;
const PAIRING_REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const PAIRING_REQUEST_STORAGE_PREFIX = "honk.pairing-request.";

/**
 * Owns one browser pairing attempt from preview through confirmation or cancellation.
 * Instances are immutable so an in-flight claim cannot mutate a superseded attempt.
 */
export class BrowserPairingTransaction {
  readonly pending: PendingConnectionPairing;
  readonly #provisional: HonkProvisionalConnection | null;
  readonly #requestStorageKey: string | null;

  private constructor(
    pairing: PendingConnectionPairing,
    provisional: HonkProvisionalConnection | null,
    requestStorageKey: string | null,
  ) {
    this.pending = pairing;
    this.#provisional = provisional;
    this.#requestStorageKey = requestStorageKey;
  }

  static async preview(origin: string, token: string): Promise<BrowserPairingTransaction> {
    // `crypto.randomUUID` is secure-context only, so browser pairing cannot work over plaintext.
    // The host already omits the browser link for those endpoints; this keeps a page reached some
    // other way from failing later with a bare TypeError.
    if (typeof crypto.randomUUID !== "function") {
      throw new Error(
        "This page is not on a secure address, so it cannot connect to Honk. Use the Honk app, or open Honk at an https address.",
      );
    }
    const preview = await previewHonkPairing(origin, token);
    const identity = await pairingRequestIdentity(preview.origin, token);
    return new BrowserPairingTransaction(
      {
        origin: preview.origin,
        token,
        requestId: identity.requestId,
        preview,
      },
      null,
      identity.requestStorageKey,
    );
  }

  async claim(replacePassword: string | null): Promise<BrowserPairingTransaction> {
    if (this.#provisional !== null) return this;
    return new BrowserPairingTransaction(
      this.pending,
      await exchangeHonkPairing(this.pending.origin, this.pending.token, {
        requestId: this.pending.requestId,
        label: "Honk web",
        ...(replacePassword === null ? {} : { replacePassword }),
      }),
      this.#requestStorageKey,
    );
  }

  async confirm(): Promise<OpenCodeConnection> {
    if (this.#provisional === null) {
      throw new Error("A browser pairing must be claimed before confirmation.");
    }
    return confirmHonkPairing(this.#provisional);
  }

  async cancel(replacePassword: string | null): Promise<void> {
    if (this.#provisional !== null) {
      await cancelPairingCredential(this.#provisional);
      return;
    }
    try {
      const claimed = await this.claim(replacePassword);
      if (claimed.#provisional !== null) await cancelPairingCredential(claimed.#provisional);
    } catch (error) {
      // An unclaimed transaction may already have expired or been canceled remotely.
      if (error instanceof HonkPairingRequestError && error.kind === "invalid") return;
      throw error;
    }
  }

  async abandon(): Promise<void> {
    if (this.#provisional === null) return;
    await cancelPairingCredential(this.#provisional).catch(() => undefined);
  }

  async revoke(connection: OpenCodeConnection): Promise<void> {
    await revokeHonkConnection(connection, (input, init) =>
      fetch(input, { ...init, credentials: "omit" }),
    ).catch(() => undefined);
  }

  forget(): void {
    stripBrowserConnectionCredential(this.pending.token);
    if (this.#requestStorageKey === null) return;
    try {
      if (sessionStorage.getItem(this.#requestStorageKey) === this.pending.requestId) {
        sessionStorage.removeItem(this.#requestStorageKey);
      }
    } catch {
      // The host still expires the claim when private browsing disables session storage.
    }
  }
}

export function stripBrowserConnectionCredential(pairingToken?: string): void {
  const url = new URL(window.location.href);
  const next = new URL(url.toString());
  const hashParams = new URLSearchParams(
    next.hash.startsWith("#") ? next.hash.slice(1) : next.hash,
  );
  if (
    pairingToken !== undefined &&
    !URL_CREDENTIAL_PARAMS.some(
      (parameter) =>
        hashParams.get(parameter) === pairingToken ||
        next.searchParams.get(parameter) === pairingToken,
    )
  ) {
    return;
  }
  for (const parameter of URL_CREDENTIAL_PARAMS) {
    hashParams.delete(parameter);
    next.searchParams.delete(parameter);
  }
  next.hash = hashParams.toString();
  if (next.pathname.replace(/\/+$/, "") === "/pair") next.pathname = "/";
  if (next.toString() === url.toString()) return;
  window.history.replaceState(window.history.state, document.title, next.toString());
  // replaceState does not notify TanStack's browser history. Keep the mounted router aligned.
  window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
}

export async function discardBrowserPairingCode(origin: string, token: string): Promise<void> {
  stripBrowserConnectionCredential(token);
  const requestStorageKey = await pairingRequestStorageKey(origin, token);
  if (requestStorageKey === null) return;
  try {
    sessionStorage.removeItem(requestStorageKey);
  } catch {
    // Private browsing can make session storage unavailable.
  }
}

/** Recovers a same-origin pairing whose confirmation response was lost after cookies were set. */
export async function recoverCommittedBrowserPairing(
  origin: string,
  token: string,
  probe: () => Promise<"ok" | "requires-auth">,
): Promise<OpenCodeConnection | null> {
  if (new URL(origin).origin !== new URL(window.location.href).origin) return null;
  if ((await probe()) === "ok") {
    await discardBrowserPairingCode(origin, token);
    return { origin, password: "" };
  }
  const confirmation = await fetch(`${origin}/honk/pair/confirm`, {
    method: "POST",
    credentials: "include",
  });
  if (!confirmation.ok || (await probe()) !== "ok") return null;
  await discardBrowserPairingCode(origin, token);
  return { origin, password: "" };
}

async function pairingRequestIdentity(
  origin: string,
  token: string,
): Promise<{ readonly requestId: string; readonly requestStorageKey: string | null }> {
  const requestId = crypto.randomUUID();
  const requestStorageKey = await pairingRequestStorageKey(origin, token);
  if (requestStorageKey === null) return { requestId, requestStorageKey: null };
  try {
    const stored = sessionStorage.getItem(requestStorageKey);
    if (stored !== null && PAIRING_REQUEST_ID_PATTERN.test(stored)) {
      return { requestId: stored, requestStorageKey };
    }
    sessionStorage.setItem(requestStorageKey, requestId);
    return { requestId, requestStorageKey };
  } catch {
    return { requestId, requestStorageKey: null };
  }
}

async function pairingRequestStorageKey(origin: string, token: string): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${origin}\0${token}`),
    );
    return `${PAIRING_REQUEST_STORAGE_PREFIX}${Array.from(new Uint8Array(digest), (value) =>
      value.toString(16).padStart(2, "0"),
    ).join("")}`;
  } catch {
    return null;
  }
}

function cancelPairingCredential(connection: HonkProvisionalConnection): Promise<void> {
  return cancelHonkPairing(connection, (input, init) =>
    fetch(input, { ...init, credentials: "omit" }),
  );
}
