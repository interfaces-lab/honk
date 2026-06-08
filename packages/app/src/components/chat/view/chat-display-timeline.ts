import {
  type OrchestrationChatTimelineRow,
  type OrchestrationThreadActivity,
  type RuntimeDisplayTimelineProjection,
  type TurnId,
} from "@multi/contracts";

import type { TimelineEntry, WorkLogEntry } from "../../../session-logic";
import type { ChatMessage, PendingTimelineRow, ProposedPlan } from "../../../types";
import {
  appendMissingRuntimeTimelineMessageEntries,
  appendTransientTimelineEntries,
} from "./pending-timeline-rows";
import {
  materializeTimelineEntriesFromRuntimeDisplayTimeline,
  shouldUseRuntimeDisplayTimelineEntries,
} from "./runtime-display-timeline";
import { materializeTimelineEntriesFromChatTimelineRows } from "./thread-branch-view";

export function buildChatDisplayTimeline(input: {
  readonly visibleChatTimelineRows: ReadonlyArray<OrchestrationChatTimelineRow>;
  readonly timelineMessages: ReadonlyArray<ChatMessage>;
  readonly proposedPlans: ReadonlyArray<ProposedPlan>;
  readonly threadActivities: ReadonlyArray<OrchestrationThreadActivity>;
  readonly timelineWorkLogEntries: ReadonlyArray<WorkLogEntry>;
  readonly activeRunningTurnId: TurnId | null;
  readonly transientPendingTimelineRows: ReadonlyArray<PendingTimelineRow>;
  readonly activeRuntimeDisplayTimeline: RuntimeDisplayTimelineProjection | null;
  readonly runtimeDisplayRegressedToUserOnly: boolean;
}): ReadonlyArray<TimelineEntry> {
  const committedEntries = materializeTimelineEntriesFromChatTimelineRows({
    rows: input.visibleChatTimelineRows,
    messages: input.timelineMessages,
    proposedPlans: input.proposedPlans,
    activities: input.threadActivities,
    workEntries: input.timelineWorkLogEntries,
    workLogOptions: { activeRunningTurnId: input.activeRunningTurnId },
  });
  const committedEntriesWithTransientRows = appendTransientTimelineEntries({
    entries: committedEntries,
    messages: input.timelineMessages,
    pendingRows: input.transientPendingTimelineRows,
  });
  if (input.runtimeDisplayRegressedToUserOnly) {
    return committedEntriesWithTransientRows;
  }
  if (!input.activeRuntimeDisplayTimeline) {
    return committedEntriesWithTransientRows;
  }

  const runtimeEntries = materializeTimelineEntriesFromRuntimeDisplayTimeline({
    timeline: input.activeRuntimeDisplayTimeline,
    messages: input.timelineMessages,
    proposedPlans: input.proposedPlans,
  });
  if (
    !shouldUseRuntimeDisplayTimelineEntries({
      runtimeEntries,
      committedEntries: committedEntriesWithTransientRows,
    })
  ) {
    return committedEntriesWithTransientRows;
  }
  return appendMissingRuntimeTimelineMessageEntries({
    entries: runtimeEntries,
    messages: input.timelineMessages,
    pendingRows: input.transientPendingTimelineRows,
  });
}
