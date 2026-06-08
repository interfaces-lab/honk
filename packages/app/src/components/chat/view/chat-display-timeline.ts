import {
  type OrchestrationChatTimelineRow,
  type OrchestrationThreadActivity,
  type RuntimeDisplayTimelineProjection,
  type TurnId,
} from "@multi/contracts";

import type { TimelineEntry, WorkLogEntry } from "../../../session-logic";
import type { ChatMessage, PendingTimelineRow, ProposedPlan } from "../../../types";
import { resolveGitAgentActionFromPrompt } from "~/lib/git-agent-actions";
import {
  appendMissingRuntimeTimelineMessageEntries,
  appendTransientTimelineEntries,
  userTimestampTextCoverageKey,
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
    return normalizeDisplayTimelineEntries(committedEntriesWithTransientRows);
  }
  if (!input.activeRuntimeDisplayTimeline) {
    return normalizeDisplayTimelineEntries(committedEntriesWithTransientRows);
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
    return normalizeDisplayTimelineEntries(committedEntriesWithTransientRows);
  }
  return normalizeDisplayTimelineEntries(
    appendMissingRuntimeTimelineMessageEntries({
      entries: runtimeEntries,
      messages: input.timelineMessages,
      pendingRows: input.transientPendingTimelineRows,
    }),
  );
}

function normalizeDisplayTimelineEntries(
  entries: ReadonlyArray<TimelineEntry>,
): TimelineEntry[] {
  return dedupeUserMessagesByTimestampText(filterRedundantGitAgentCustomMessages(entries));
}

function filterRedundantGitAgentCustomMessages(
  entries: ReadonlyArray<TimelineEntry>,
): TimelineEntry[] {
  const hasGitAgentUserMessage = entries.some(
    (entry) =>
      entry.kind === "message" &&
      entry.message.role === "user" &&
      resolveGitAgentActionFromPrompt(entry.message.text) !== null,
  );
  if (!hasGitAgentUserMessage) {
    return [...entries];
  }
  return entries.filter(
    (entry) =>
      entry.kind !== "custom-message" || entry.customMessage.customType !== "git-agent-action",
  );
}

function dedupeUserMessagesByTimestampText(
  entries: ReadonlyArray<TimelineEntry>,
): TimelineEntry[] {
  const seenUserTimestampTextKeys = new Set<string>();
  return entries.filter((entry) => {
    if (entry.kind !== "message" || entry.message.role !== "user") {
      return true;
    }
    const key = userTimestampTextCoverageKey(entry.message);
    if (key === null) {
      return true;
    }
    if (seenUserTimestampTextKeys.has(key)) {
      return false;
    }
    seenUserTimestampTextKeys.add(key);
    return true;
  });
}
