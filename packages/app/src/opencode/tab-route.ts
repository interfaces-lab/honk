import { openCodeServerKey, openCodeSessionRef, type OpenCodeSessionRef } from "@honk/opencode";

import type { OpenCodeTab } from "./tab-model";

type OpenCodeHomeRoute = {
  readonly type: "home";
};

type OpenCodeDraftRoute = {
  readonly type: "draft";
  readonly draftID: string;
};

type OpenCodeWorkbenchToolKind = "changes" | "tasks" | "browser" | "terminal" | "files";

type OpenCodeWorkbenchRouteTarget =
  | {
      readonly type: "tab";
      readonly tabID: string;
    }
  | {
      readonly type: "side-chat";
      readonly sessionID: string;
    };

type OpenCodeSessionRoute = {
  readonly type: "session";
  readonly ref: OpenCodeSessionRef;
  /** The active workbench deep link. Open-tab inventory is workspace-owned, never URL-owned. */
  readonly workbench?: OpenCodeWorkbenchRouteTarget;
};

type OpenCodeTabRoute = OpenCodeHomeRoute | OpenCodeDraftRoute | OpenCodeSessionRoute;

const ROUTE_BASE = "https://honk.invalid";
const SESSION_ROUTE_PATTERN =
  /^\/server\/([^/]+)\/session\/([^/]+)(?:(?:\/workbench\/([^/]+))|(?:\/side-chat\/([^/]+))|(?:\/(browser|changes)))?\/?$/;

function openCodeSessionHref(ref: OpenCodeSessionRef): string {
  return `/server/${encodeBase64Url(ref.server)}/session/${encodeURIComponent(ref.sessionID)}`;
}

function openCodeDraftHref(draftID: string): string {
  const value = requireIdentifier(draftID, "draft ID");
  return `/new-session?draftId=${encodeURIComponent(value)}`;
}

function openCodeWorkbenchTabHref(ref: OpenCodeSessionRef, tabID: string): string {
  return `${openCodeSessionHref(ref)}/workbench/${encodeURIComponent(
    requireIdentifier(tabID, "workbench tab ID"),
  )}`;
}

function openCodeWorkbenchToolHref(
  ref: OpenCodeSessionRef,
  tool: OpenCodeWorkbenchToolKind,
): string {
  return openCodeWorkbenchTabHref(ref, tool);
}

function openCodeSideChatHref(ref: OpenCodeSessionRef, sessionID: string): string {
  return `${openCodeSessionHref(ref)}/side-chat/${encodeURIComponent(
    requireIdentifier(sessionID, "side chat session ID"),
  )}`;
}

function openCodeWorkbenchClosedHref(ref: OpenCodeSessionRef): string {
  return openCodeSessionHref(ref);
}

function openCodeTabHref(tab: OpenCodeTab): string {
  if (tab.type === "draft") return openCodeDraftHref(tab.draftID);
  return openCodeSessionHref(openCodeSessionRef(tab.server, tab.sessionID));
}

function openCodeSessionRefFromRouteParams(
  serverSegment: unknown,
  sessionID: unknown,
): OpenCodeSessionRef | null {
  if (typeof serverSegment !== "string" || typeof sessionID !== "string") return null;

  try {
    const decodedServer = decodeBase64Url(serverSegment);
    if (encodeBase64Url(decodedServer) !== serverSegment) return null;
    return openCodeSessionRef(openCodeServerKey(decodedServer), sessionID);
  } catch {
    return null;
  }
}

function parseOpenCodeTabHref(href: string): OpenCodeTabRoute | null {
  let url: URL;
  try {
    url = new URL(href, ROUTE_BASE);
  } catch {
    return null;
  }

  if (url.origin !== ROUTE_BASE) return null;
  if ((url.pathname === "/" || url.pathname === "") && url.search.length === 0) {
    return Object.freeze({ type: "home" });
  }
  if (url.pathname === "/new-session") {
    const draftID = url.searchParams.get("draftId")?.trim() ?? "";
    return draftID.length > 0 ? Object.freeze({ type: "draft", draftID }) : null;
  }

  const match = SESSION_ROUTE_PATTERN.exec(url.pathname);
  const serverSegment = match?.[1];
  const sessionSegment = match?.[2];
  const workbenchSegment = match?.[3];
  const sideChatSegment = match?.[4];
  const legacyUtility = match?.[5];
  if (serverSegment === undefined || sessionSegment === undefined) return null;

  try {
    const ref = openCodeSessionRefFromRouteParams(
      serverSegment,
      decodeURIComponent(sessionSegment),
    );
    if (ref === null) return null;
    const workbench: OpenCodeWorkbenchRouteTarget | undefined =
      workbenchSegment !== undefined
        ? Object.freeze({
            type: "tab",
            tabID: requireIdentifier(decodeURIComponent(workbenchSegment), "workbench tab ID"),
          })
        : sideChatSegment !== undefined
          ? Object.freeze({
              type: "side-chat",
              sessionID: requireIdentifier(
                decodeURIComponent(sideChatSegment),
                "side chat session ID",
              ),
            })
          : legacyUtility === "browser" || legacyUtility === "changes"
            ? Object.freeze({ type: "tab", tabID: legacyUtility })
            : undefined;
    return Object.freeze({
      type: "session",
      ref,
      ...(workbench === undefined ? {} : { workbench }),
    });
  } catch {
    return null;
  }
}

function isWorkbenchTool(value: string): value is OpenCodeWorkbenchToolKind {
  return (
    value === "changes" ||
    value === "tasks" ||
    value === "browser" ||
    value === "terminal" ||
    value === "files"
  );
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Invalid OpenCode server route.");
  }
  const standard = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = `${standard}${"=".repeat((4 - (standard.length % 4)) % 4)}`;
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function requireIdentifier(value: string, label: string): string {
  const identifier = value.trim();
  if (identifier.length === 0) {
    throw new Error(`An OpenCode ${label} is required.`);
  }
  return identifier;
}

export {
  isWorkbenchTool,
  openCodeDraftHref,
  openCodeSessionHref,
  openCodeSessionRefFromRouteParams,
  openCodeSideChatHref,
  openCodeTabHref,
  openCodeWorkbenchClosedHref,
  openCodeWorkbenchTabHref,
  openCodeWorkbenchToolHref,
  parseOpenCodeTabHref,
};
export type {
  OpenCodeDraftRoute,
  OpenCodeHomeRoute,
  OpenCodeSessionRoute,
  OpenCodeTabRoute,
  OpenCodeWorkbenchRouteTarget,
  OpenCodeWorkbenchToolKind,
};
