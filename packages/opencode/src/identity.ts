import type {
  LocationRef as OpenCodeLocation,
  SessionV2Info as OpenCodeSessionInfo,
} from "@opencode-ai/sdk/v2/client";

import { normalizeOpenCodeOrigin } from "./connection";

declare const serverKeyBrand: unique symbol;
declare const locationKeyBrand: unique symbol;
declare const sessionKeyBrand: unique symbol;

type OpenCodeServerKey = string & { readonly [serverKeyBrand]: "OpenCodeServerKey" };
type OpenCodeLocationKey = string & { readonly [locationKeyBrand]: "OpenCodeLocationKey" };
type OpenCodeSessionKey = string & { readonly [sessionKeyBrand]: "OpenCodeSessionKey" };
type OpenCodeMessageID = `msg_${string}`;

type OpenCodeServerKind = "local" | "remote" | "cloud";

type OpenCodeServerDescriptor = {
  readonly key: OpenCodeServerKey;
  readonly origin: string;
  readonly label: string;
  readonly kind: OpenCodeServerKind;
};

type OpenCodeServerInput = {
  readonly origin: string;
  readonly label?: string;
  readonly kind?: OpenCodeServerKind;
};

type OpenCodeLocationRef = Readonly<OpenCodeLocation>;

type OpenCodeSessionRef = {
  readonly server: OpenCodeServerKey;
  readonly sessionID: string;
};

const LOCATION_KEY_PREFIX = "opencode:location:";
const SESSION_KEY_PREFIX = "opencode:session:";

function inferServerKind(origin: string): OpenCodeServerKind {
  const hostname = new URL(origin).hostname.toLowerCase();
  return hostname === "localhost" ||
    hostname === "[::1]" ||
    hostname === "0.0.0.0" ||
    hostname.startsWith("127.")
    ? "local"
    : "remote";
}

function openCodeServerKey(origin: string): OpenCodeServerKey {
  return normalizeOpenCodeOrigin(origin) as OpenCodeServerKey;
}

function createOpenCodeServer(input: OpenCodeServerInput): OpenCodeServerDescriptor {
  const origin = normalizeOpenCodeOrigin(input.origin);
  const label = input.label?.trim() ?? "";
  return Object.freeze({
    key: openCodeServerKey(origin),
    origin,
    label: label.length > 0 ? label : new URL(origin).host,
    kind: input.kind ?? inferServerKind(origin),
  });
}

function requireDirectory(directory: string): string {
  const value = directory.trim();
  if (value.length === 0) {
    throw new Error("An OpenCode location requires a directory.");
  }
  return value;
}

function canonicalDirectoryKey(directory: string): string {
  const normalized = requireDirectory(directory).replaceAll("\\", "/");
  if (normalized === "/" || /^[A-Za-z]:\/$/.test(normalized)) {
    return normalized;
  }
  return normalized.replace(/\/+$/, "");
}

function openCodeLocationRef(location: OpenCodeLocation): OpenCodeLocationRef {
  return Object.freeze({
    directory: requireDirectory(location.directory),
    ...(location.workspaceID !== undefined ? { workspaceID: location.workspaceID } : {}),
  });
}

function openCodeLocationKey(
  server: OpenCodeServerKey,
  location: OpenCodeLocationRef,
): OpenCodeLocationKey {
  return `${LOCATION_KEY_PREFIX}${encodeURIComponent(server)}:${encodeURIComponent(
    location.workspaceID ?? "",
  )}:${encodeURIComponent(canonicalDirectoryKey(location.directory))}` as OpenCodeLocationKey;
}

function openCodeSessionRef(server: OpenCodeServerKey, sessionID: string): OpenCodeSessionRef {
  const value = sessionID.trim();
  if (value.length === 0) {
    throw new Error("An OpenCode session reference requires a session ID.");
  }
  return Object.freeze({ server, sessionID: value });
}

function openCodeMessageID(value: string): OpenCodeMessageID {
  const id = value.trim();
  if (id.length === 0) {
    throw new Error("An OpenCode message ID cannot be empty.");
  }
  return (id.startsWith("msg_") ? id : `msg_${id}`) as OpenCodeMessageID;
}

function openCodeSessionRefFromInfo(
  server: OpenCodeServerKey,
  session: Pick<OpenCodeSessionInfo, "id">,
): OpenCodeSessionRef {
  return openCodeSessionRef(server, session.id);
}

function openCodeSessionKey(ref: OpenCodeSessionRef): OpenCodeSessionKey {
  return `${SESSION_KEY_PREFIX}${encodeURIComponent(ref.server)}:${encodeURIComponent(
    ref.sessionID,
  )}` as OpenCodeSessionKey;
}

function parseOpenCodeSessionKey(value: string): OpenCodeSessionRef | null {
  if (!value.startsWith(SESSION_KEY_PREFIX)) {
    return null;
  }
  const encoded = value.slice(SESSION_KEY_PREFIX.length).split(":");
  if (encoded.length !== 2) {
    return null;
  }
  const [server, sessionID] = encoded;
  if (server === undefined || sessionID === undefined) {
    return null;
  }
  try {
    return openCodeSessionRef(
      openCodeServerKey(decodeURIComponent(server)),
      decodeURIComponent(sessionID),
    );
  } catch {
    return null;
  }
}

function sameOpenCodeLocation(left: OpenCodeLocationRef, right: OpenCodeLocationRef): boolean {
  return (
    canonicalDirectoryKey(left.directory) === canonicalDirectoryKey(right.directory) &&
    left.workspaceID === right.workspaceID
  );
}

export {
  createOpenCodeServer,
  openCodeLocationKey,
  openCodeLocationRef,
  openCodeMessageID,
  openCodeServerKey,
  openCodeSessionKey,
  openCodeSessionRef,
  openCodeSessionRefFromInfo,
  parseOpenCodeSessionKey,
  sameOpenCodeLocation,
};
export type {
  OpenCodeLocationKey,
  OpenCodeMessageID,
  OpenCodeServerDescriptor,
  OpenCodeServerInput,
  OpenCodeServerKey,
  OpenCodeServerKind,
  OpenCodeSessionKey,
  OpenCodeSessionRef,
  OpenCodeLocationRef,
};
