import type {
  EnvironmentId,
  MessageId,
  OrchestrationProposedPlanId,
  AgentInteractionMode,
  ThreadId,
} from "@honk/contracts";

import type { WorkLogEntry, WorkLogSubagent } from "../../../session-logic";
import type { Thread } from "../../../types";
import type { ComposerSubmitContext } from "../composer-submit";
import type { DraftId as ComposerDraftId } from "../../../stores/chat-drafts";
export {
  COMPOSER_INTERACTION_MODE_CYCLE,
  nextComposerInteractionMode,
} from "../composer/interaction-modes";

export function workLogEntrySubagents(entry: WorkLogEntry): ReadonlyArray<WorkLogSubagent> {
  return entry.subagents ?? [];
}

export type ComposerSendSnapshot = {
  sendContext: ComposerSubmitContext;
  interactionMode: AgentInteractionMode;
  planFollowUp: {
    planMarkdown: string;
    planId: OrchestrationProposedPlanId;
    planThreadId: ThreadId;
  } | null;
  clearComposerOnSubmit: boolean;
  messageId?: MessageId;
  createdAt?: string;
};

export type ChatViewRouteKind = "server" | "draft";

export type MissingActiveThreadDiagnostics = {
  readonly routeKind: ChatViewRouteKind;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly draftId: ComposerDraftId | null;
  readonly serverThreadExists: boolean;
};

export function missingActiveThreadMessage(input: MissingActiveThreadDiagnostics): string {
  return `ChatView rendered without an active thread for ${input.routeKind} route ${input.environmentId}/${input.threadId}${
    input.draftId ? ` (${input.draftId})` : ""
  }.`;
}

export function reportMissingActiveThread(
  activeThread: Thread | undefined,
  input: MissingActiveThreadDiagnostics,
): activeThread is Thread {
  if (activeThread) {
    return true;
  }

  const message = missingActiveThreadMessage(input);
  console.warn(message, input);
  return false;
}

export function deriveChatViewLiveness(input: {
  readonly runtimeOwned: boolean;
  readonly latestTurnSettled: boolean;
  readonly activeRunningTurnId: string | null;
  readonly runtimeAgentRunActive: boolean;
  readonly runtimeTimelineHasActiveWork: boolean;
  readonly runtimePresentationActive: boolean;
  readonly visibleSendIntentCount: number;
  readonly isCompactingActive: boolean;
  readonly isSendBusy: boolean;
  readonly isConnecting: boolean;
}): {
  readonly isTurnRunning: boolean;
  readonly isTimelineSurfaceActive: boolean;
  readonly isWorking: boolean;
  readonly timelineTurnActive: boolean;
  readonly goalStatusProgressActive: boolean;
} {
  const runtimeTurnRunning =
    input.runtimeAgentRunActive || input.runtimeTimelineHasActiveWork;
  if (input.runtimeOwned) {
    const canonicalRuntimeTurnActive =
      !input.latestTurnSettled &&
      (input.activeRunningTurnId !== null || runtimeTurnRunning);
    const isTimelineSurfaceActive = canonicalRuntimeTurnActive || input.isCompactingActive;
    const timelineTurnActive =
      isTimelineSurfaceActive || input.visibleSendIntentCount > 0;
    const isWorking = isTimelineSurfaceActive || input.isSendBusy || input.isConnecting;
    return {
      isTurnRunning: canonicalRuntimeTurnActive || input.isCompactingActive,
      isTimelineSurfaceActive,
      isWorking,
      timelineTurnActive,
      goalStatusProgressActive: timelineTurnActive || input.isSendBusy || input.isConnecting,
    };
  }

  const runtimeSurfaceActive = runtimeTurnRunning || input.runtimePresentationActive;
  const isTimelineSurfaceActive =
    input.activeRunningTurnId !== null || runtimeSurfaceActive || input.isCompactingActive;
  const timelineTurnActive =
    isTimelineSurfaceActive || input.visibleSendIntentCount > 0;
  const isWorking = isTimelineSurfaceActive || input.isSendBusy || input.isConnecting;
  return {
    isTurnRunning:
      input.activeRunningTurnId !== null || runtimeTurnRunning || input.isCompactingActive,
    isTimelineSurfaceActive,
    isWorking,
    timelineTurnActive,
    goalStatusProgressActive: timelineTurnActive || input.isSendBusy || input.isConnecting,
  };
}
