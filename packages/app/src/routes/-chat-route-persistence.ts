import { ScopedThreadRef } from "@multi/contracts";
import { Option, Schema } from "effect";

import { DraftId } from "~/stores/chat-drafts";
import type { ThreadRouteTarget } from "./-thread-route-targets";

const LAST_CHAT_ROUTE_KEY = "multi:last-chat-route";

const LastChatRouteTargetSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("server"),
    threadRef: ScopedThreadRef,
  }),
  Schema.Struct({
    kind: Schema.Literal("draft"),
    draftId: DraftId,
  }),
]);
const decodeLastChatRouteTargetOption = Schema.decodeUnknownOption(LastChatRouteTargetSchema);

export function readLastChatRouteTarget(): ThreadRouteTarget | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(LAST_CHAT_ROUTE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return Option.getOrNull(decodeLastChatRouteTargetOption(JSON.parse(raw)));
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
