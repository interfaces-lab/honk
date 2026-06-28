import type { MessageId } from "@honk/contracts";

import type { TimelineEntryId } from "../../../session-logic";

function makeTimelineEntryId(value: string): TimelineEntryId {
  return value as TimelineEntryId;
}

export function timelineMessageEntryId(messageId: MessageId): TimelineEntryId {
  return makeTimelineEntryId(`message:${messageId}`);
}

// Assistant rows are keyed by turn + occurrence so the row id survives every stage of the
// message lifecycle — live streaming item, settled session entry, committed message, reload.
// The payload upgrades in place; the row never re-keys, so the timeline never remounts it.
export function timelineTurnAssistantEntryId(turnId: string, index: number): TimelineEntryId {
  return makeTimelineEntryId(`message:turn:${turnId}:assistant:${index}`);
}

export function timelineTurnThinkingEntryId(turnId: string, index: number): TimelineEntryId {
  return makeTimelineEntryId(`thinking:turn:${turnId}:${index}`);
}

// Tool rows are keyed by tool call id so the committed work entry and the runtime display
// item for the same call resolve to the same row, whichever arrives first and whichever
// branch the projector renders from.
export function timelineToolCallEntryId(toolCallId: string): TimelineEntryId {
  return makeTimelineEntryId(`tool-call:${toolCallId}`);
}

export function timelineProposedPlanEntryId(proposedPlanId: string): TimelineEntryId {
  return makeTimelineEntryId(`proposed-plan:${proposedPlanId}`);
}

export function timelineExtensionUiRequestEntryId(requestId: string): TimelineEntryId {
  return makeTimelineEntryId(`extension-ui:${requestId}`);
}

export function timelineRuntimeThinkingFallbackEntryId(itemId: string): TimelineEntryId {
  return makeTimelineEntryId(`runtime-thinking:${itemId}`);
}

export function timelineRuntimeItemEntryId(itemId: string): TimelineEntryId {
  return makeTimelineEntryId(`runtime:${itemId}`);
}

export function timelineWorkEntryId(entryId: string): TimelineEntryId {
  return makeTimelineEntryId(`work:${entryId}`);
}

export function timelineWaitingEntryId(): TimelineEntryId {
  return makeTimelineEntryId("working-indicator-row");
}
