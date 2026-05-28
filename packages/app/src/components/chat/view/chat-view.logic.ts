import type {
  EnvironmentId,
  MessageId,
  ProviderInteractionMode,
  RuntimeMode,
  ThreadId,
} from "@multi/contracts";

import type { WorkLogEntry, WorkLogSubagent } from "../../../session-logic";
import { DEFAULT_INTERACTION_MODE, type Thread } from "../../../types";
import type { ComposerSubmitContext } from "../composer-submit";
import type { DraftId as ComposerDraftId } from "../../../stores/chat-drafts";

export const COMPOSER_INTERACTION_MODE_CYCLE = [
  "default",
  "plan",
  "ask",
] as const satisfies readonly ProviderInteractionMode[];

export function nextComposerInteractionMode(
  mode: ProviderInteractionMode,
): ProviderInteractionMode {
  const index = COMPOSER_INTERACTION_MODE_CYCLE.indexOf(mode);
  const nextIndex =
    index < 0 ? 0 : (index + 1) % COMPOSER_INTERACTION_MODE_CYCLE.length;
  return COMPOSER_INTERACTION_MODE_CYCLE[nextIndex] ?? DEFAULT_INTERACTION_MODE;
}

export function workLogEntrySubagents(
  entry: WorkLogEntry,
): ReadonlyArray<WorkLogSubagent> {
  return entry.subagents ?? [];
}

export type ComposerSendSnapshot = {
  sendContext: ComposerSubmitContext;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  planFollowUp: { planMarkdown: string } | null;
  clearComposerOnSubmit: boolean;
  messageId?: MessageId;
  createdAt?: string;
};

export type ChatViewRouteKind = "server" | "draft";

export function assertActiveThread(
  activeThread: Thread | undefined,
  input: {
    routeKind: ChatViewRouteKind;
    environmentId: EnvironmentId;
    threadId: ThreadId;
    draftId: ComposerDraftId | null;
  },
): asserts activeThread is Thread {
  if (activeThread) {
    return;
  }

  throw new Error(
    `ChatView rendered without an active thread for ${input.routeKind} route ${input.environmentId}/${input.threadId}${
      input.draftId ? ` (${input.draftId})` : ""
    }.`,
  );
}
