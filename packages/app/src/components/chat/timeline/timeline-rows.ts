import { type MessageId } from "@multi/contracts";

import { type TimelineEntry, type WorkLogEntry } from "../../../session-logic";
import {
  computeMessageDurationStart,
  deriveTimelineRenderItems,
  isCommandWorkEntry,
  summarizeWorkGroup,
  type GroupedSteps,
  type TimelineDurationMessage,
  type TimelineMessageStep,
  type TimelineProposedPlanStep,
  type TimelineRenderItem,
  type TimelineStep,
  type TimelineWaitingStep,
  type TimelineWorkStep,
  type WaitingGroupedSteps,
  type WorkGroupSummary,
} from "./timeline-render-items";

export {
  computeMessageDurationStart,
  isCommandWorkEntry,
  summarizeWorkGroup,
  type GroupedSteps,
  type TimelineDurationMessage,
  type TimelineRenderItem,
  type TimelineStep,
  type TimelineWaitingStep,
  type TimelineWorkStep,
  type WaitingGroupedSteps,
  type WorkGroupSummary,
};

export interface WorkTimelineRow {
  kind: "work";
  id: string;
  createdAt: string;
  completedDurationLabel: string | null;
  isRunning: boolean;
  isThinkingGroup: boolean;
  isCommandGroup: boolean;
  summary: WorkGroupSummary;
  steps: TimelineWorkStep[];
  groupedEntries: WorkLogEntry[];
  renderItem: Extract<TimelineRenderItem, { kind: "group" }>;
}

export type MessageTimelineRow = TimelineMessageStep;

export type ProposedPlanTimelineRow = TimelineProposedPlanStep;

export interface WorkingTimelineRow {
  kind: "working";
  id: string;
  createdAt: string | null;
  step: TimelineWaitingStep;
  renderItem: Extract<TimelineRenderItem, { kind: "waitingGroup" }>;
}

export type BaseMessagesTimelineRow =
  | WorkTimelineRow
  | MessageTimelineRow
  | ProposedPlanTimelineRow
  | WorkingTimelineRow;

export type MessagesTimelineRow = BaseMessagesTimelineRow;

export interface StableMessagesTimelineRowsState {
  byId: Map<string, MessagesTimelineRow>;
  result: MessagesTimelineRow[];
}

export function deriveMessagesTimelineRows(input: {
  timelineEntries: ReadonlyArray<TimelineEntry>;
  isWorking: boolean;
  activeTurnStartedAt: string | null;
  editableUserMessageIds: ReadonlySet<MessageId>;
  projectRoot?: string | undefined;
}): MessagesTimelineRow[] {
  return deriveTimelineRenderItems(input).map(timelineRenderItemToRow);
}

export function computeStableMessagesTimelineRows(
  rows: MessagesTimelineRow[],
  previous: StableMessagesTimelineRowsState,
): StableMessagesTimelineRowsState {
  const next = new Map<string, MessagesTimelineRow>();
  let anyChanged = rows.length !== previous.byId.size;

  const result = rows.map((row, index) => {
    const prevRow = previous.byId.get(row.id);
    const nextRow = prevRow && isRowUnchanged(prevRow, row) ? prevRow : row;
    next.set(row.id, nextRow);
    if (!anyChanged && previous.result[index] !== nextRow) {
      anyChanged = true;
    }
    return nextRow;
  });

  return anyChanged ? { byId: next, result } : previous;
}

function timelineRenderItemToRow(item: TimelineRenderItem): MessagesTimelineRow {
  switch (item.kind) {
    case "single":
      return item.step;

    case "group":
      return {
        kind: "work",
        id: item.id,
        createdAt: item.createdAt,
        completedDurationLabel: item.group.completedDurationLabel,
        isRunning: item.group.isRunning,
        isThinkingGroup: item.group.isThinkingGroup,
        isCommandGroup: item.group.isCommandGroup,
        summary: item.group.summary,
        steps: item.group.steps,
        groupedEntries: item.group.entries,
        renderItem: item,
      };

    case "waitingGroup": {
      const step = item.group.steps[0];
      return {
        kind: "working",
        id: item.id,
        createdAt: item.createdAt,
        step,
        renderItem: item,
      };
    }
  }
}

function isRowUnchanged(a: MessagesTimelineRow, b: MessagesTimelineRow): boolean {
  if (a.kind !== b.kind || a.id !== b.id) return false;

  switch (a.kind) {
    case "working":
      return a.createdAt === (b as typeof a).createdAt;

    case "proposed-plan":
      return a.proposedPlan === (b as typeof a).proposedPlan;

    case "work":
      return isWorkRowUnchanged(a, b as typeof a);

    case "message": {
      const bm = b as typeof a;
      return (
        a.message === bm.message &&
        a.durationStart === bm.durationStart &&
        a.editAvailable === bm.editAvailable &&
        a.pairId === bm.pairId &&
        a.messageIndex === bm.messageIndex
      );
    }
  }
}

function isWorkRowUnchanged(a: WorkTimelineRow, b: WorkTimelineRow): boolean {
  return (
    a.createdAt === b.createdAt &&
    a.completedDurationLabel === b.completedDurationLabel &&
    a.isRunning === b.isRunning &&
    a.isThinkingGroup === b.isThinkingGroup &&
    a.isCommandGroup === b.isCommandGroup &&
    a.summary.action === b.summary.action &&
    a.summary.details === b.summary.details &&
    a.summary.additions === b.summary.additions &&
    a.summary.deletions === b.summary.deletions &&
    areSameWorkEntries(a.groupedEntries, b.groupedEntries)
  );
}

function areSameWorkEntries(
  left: ReadonlyArray<WorkLogEntry>,
  right: ReadonlyArray<WorkLogEntry>,
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}
