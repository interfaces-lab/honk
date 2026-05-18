import type { EnvironmentId, ThreadId } from "@multi/contracts";

import type { DraftId } from "./stores/chat-drafts";
import type { ThreadRouteTarget } from "./thread-routes";

const LAST_CHAT_ROUTE_KEY = "multi:last-chat-route";

export function readLastChatRouteTarget(): ThreadRouteTarget | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(LAST_CHAT_ROUTE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const candidate = JSON.parse(raw) as Partial<Record<string, unknown>> | null;
    if (!candidate || typeof candidate !== "object") {
      return null;
    }

    if (candidate.kind === "draft" && typeof candidate.draftId === "string") {
      return { kind: "draft", draftId: candidate.draftId as DraftId };
    }

    if (candidate.kind !== "server" || typeof candidate.threadRef !== "object") {
      return null;
    }

    const threadRef = candidate.threadRef as Partial<Record<string, unknown>> | null;
    if (
      !threadRef ||
      typeof threadRef.environmentId !== "string" ||
      typeof threadRef.threadId !== "string"
    ) {
      return null;
    }

    return {
      kind: "server",
      threadRef: {
        environmentId: threadRef.environmentId as EnvironmentId,
        threadId: threadRef.threadId as ThreadId,
      },
    };
  } catch {
    return null;
  }
}

export function writeLastChatRouteTarget(target: ThreadRouteTarget): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(LAST_CHAT_ROUTE_KEY, JSON.stringify(target));
}

export function clearLastChatRouteTarget(target: ThreadRouteTarget): void {
  if (typeof window === "undefined") {
    return;
  }

  const current = readLastChatRouteTarget();
  const matches =
    current?.kind === target.kind &&
    (target.kind === "draft"
      ? current.kind === "draft" && current.draftId === target.draftId
      : current.kind === "server" &&
        current.threadRef.environmentId === target.threadRef.environmentId &&
        current.threadRef.threadId === target.threadRef.threadId);

  if (matches) {
    window.localStorage.removeItem(LAST_CHAT_ROUTE_KEY);
  }
}
