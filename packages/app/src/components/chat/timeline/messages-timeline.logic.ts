import { type TimelineEntry, type WorkLogEntry } from "../../../session-logic";
import { type ChatMessage, type ProposedPlan, type TurnDiffSummary } from "../../../types";
import { type MessageId, type TurnId } from "@multi/contracts";

export interface TimelineDurationMessage {
  id: string;
  role: "user" | "assistant" | "system";
  createdAt: string;
  completedAt?: string | undefined;
}

export interface WorkTimelineRow {
  kind: "work";
  id: string;
  createdAt: string;
  groupedEntries: WorkLogEntry[];
}

export interface MessageTimelineRow {
  kind: "message";
  id: string;
  createdAt: string;
  message: ChatMessage;
  durationStart: string;
  showCompletionDivider: boolean;
  assistantTurnDiffSummary?: TurnDiffSummary | undefined;
  revertTurnCount?: number | undefined;
}

export interface ProposedPlanTimelineRow {
  kind: "proposed-plan";
  id: string;
  createdAt: string;
  proposedPlan: ProposedPlan;
}

export interface WorkingTimelineRow {
  kind: "working";
  id: string;
  createdAt: string | null;
}

export interface WorkedBlockTimelineRow {
  kind: "worked-block";
  id: string;
  createdAt: string;
  turnId: TurnId | null;
  durationStart: string;
  completedAt?: string | undefined;
  childRows: BaseMessagesTimelineRow[];
}

export type BaseMessagesTimelineRow =
  | WorkTimelineRow
  | MessageTimelineRow
  | ProposedPlanTimelineRow
  | WorkingTimelineRow;

export type MessagesTimelineRow =
  | BaseMessagesTimelineRow
  | WorkedBlockTimelineRow;

export interface StableMessagesTimelineRowsState {
  byId: Map<string, MessagesTimelineRow>;
  result: MessagesTimelineRow[];
}

export function computeMessageDurationStart(
  messages: ReadonlyArray<TimelineDurationMessage>,
): Map<string, string> {
  const result = new Map<string, string>();
  let lastBoundary: string | null = null;

  for (const message of messages) {
    if (message.role === "user") {
      lastBoundary = message.createdAt;
    }
    result.set(message.id, lastBoundary ?? message.createdAt);
    if (message.role === "assistant" && message.completedAt) {
      lastBoundary = message.completedAt;
    }
  }

  return result;
}

export function deriveMessagesTimelineRows(input: {
  timelineEntries: ReadonlyArray<TimelineEntry>;
  completionDividerBeforeEntryId: string | null;
  isWorking: boolean;
  activeTurnStartedAt: string | null;
  turnDiffSummaryByAssistantMessageId: ReadonlyMap<MessageId, TurnDiffSummary>;
  revertTurnCountByUserMessageId: ReadonlyMap<MessageId, number>;
}): MessagesTimelineRow[] {
  const baseRows: BaseMessagesTimelineRow[] = [];
  const durationStartByMessageId = computeMessageDurationStart(
    input.timelineEntries.flatMap((entry) => (entry.kind === "message" ? [entry.message] : [])),
  );

  for (let index = 0; index < input.timelineEntries.length; index += 1) {
    const timelineEntry = input.timelineEntries[index];
    if (!timelineEntry) {
      continue;
    }

    if (timelineEntry.kind === "work") {
      const groupedEntries = [timelineEntry.entry];
      let cursor = index + 1;
      while (cursor < input.timelineEntries.length) {
        const nextEntry = input.timelineEntries[cursor];
        if (!nextEntry || nextEntry.kind !== "work") break;
        groupedEntries.push(nextEntry.entry);
        cursor += 1;
      }
      baseRows.push({
        kind: "work",
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        groupedEntries,
      });
      index = cursor - 1;
      continue;
    }

    if (timelineEntry.kind === "proposed-plan") {
      baseRows.push({
        kind: "proposed-plan",
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        proposedPlan: timelineEntry.proposedPlan,
      });
      continue;
    }

    baseRows.push({
      kind: "message",
      id: timelineEntry.id,
      createdAt: timelineEntry.createdAt,
      message: timelineEntry.message,
      durationStart:
        durationStartByMessageId.get(timelineEntry.message.id) ?? timelineEntry.message.createdAt,
      showCompletionDivider:
        timelineEntry.message.role === "assistant" &&
        input.completionDividerBeforeEntryId === timelineEntry.id,
      assistantTurnDiffSummary:
        timelineEntry.message.role === "assistant"
          ? input.turnDiffSummaryByAssistantMessageId.get(timelineEntry.message.id)
          : undefined,
      revertTurnCount:
        timelineEntry.message.role === "user"
          ? input.revertTurnCountByUserMessageId.get(timelineEntry.message.id)
          : undefined,
    });
  }

  if (input.isWorking) {
    baseRows.push({
      kind: "working",
      id: "working-indicator-row",
      createdAt: input.activeTurnStartedAt,
    });
  }

  return groupAssistantTurnRows(baseRows);
}

function groupAssistantTurnRows(
  rows: ReadonlyArray<BaseMessagesTimelineRow>,
): MessagesTimelineRow[] {
  const result: MessagesTimelineRow[] = [];

  for (let index = 0; index < rows.length; ) {
    const row = rows[index];
    if (!row) {
      index += 1;
      continue;
    }

    if (!isUserMessageTimelineRow(row)) {
      result.push(row);
      index += 1;
      continue;
    }

    result.push(row);
    index += 1;

    const childRows: BaseMessagesTimelineRow[] = [];
    while (index < rows.length) {
      const childRow = rows[index];
      if (!childRow || isUserMessageTimelineRow(childRow)) {
        break;
      }
      childRows.push(childRow);
      index += 1;
    }

    const workedBlockRow = toWorkedBlockRow(childRows);
    if (workedBlockRow) {
      const summaryRow = childRows.findLast(
        (childRow): childRow is MessageTimelineRow =>
          childRow.kind === "message" && childRow.message.role === "assistant",
      );
      result.push(workedBlockRow);
      if (summaryRow) {
        result.push(summaryRow);
      }
    } else {
      result.push(...childRows);
    }
  }

  return result;
}

function isUserMessageTimelineRow(row: BaseMessagesTimelineRow): boolean {
  return row.kind === "message" && row.message.role === "user";
}

function toWorkedBlockRow(rows: BaseMessagesTimelineRow[]): WorkedBlockTimelineRow | null {
  const firstRow = rows[0];
  if (!firstRow) {
    return null;
  }

  const firstAssistantMessageRow = rows.find(
    (row): row is MessageTimelineRow => row.kind === "message" && row.message.role === "assistant",
  );
  if (!firstAssistantMessageRow) {
    return null;
  }

  const summaryIndex = rows.findLastIndex(
    (row) => row.kind === "message" && row.message.role === "assistant",
  );
  const turnId = firstAssistantMessageRow.message.turnId ?? null;
  const durationStart = firstAssistantMessageRow.durationStart;
  const createdAt = firstRow.createdAt ?? durationStart;
  const completedAt = rows.reduce<string | undefined>((latestCompletedAt, row) => {
    if (row.kind !== "message" || row.message.role !== "assistant" || !row.message.completedAt) {
      return latestCompletedAt;
    }
    if (!latestCompletedAt || row.message.completedAt.localeCompare(latestCompletedAt) > 0) {
      return row.message.completedAt;
    }
    return latestCompletedAt;
  }, undefined);
  if (!completedAt) {
    return null;
  }

  const id = turnId ? `worked-block:${turnId}` : `worked-block:${firstRow.id}`;

  return {
    kind: "worked-block",
    id,
    createdAt,
    turnId,
    durationStart,
    completedAt,
    childRows: rows.filter((_, index) => index !== summaryIndex),
  };
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

/** Shallow field comparison per row variant — avoids deep equality cost. */
function isRowUnchanged(a: MessagesTimelineRow, b: MessagesTimelineRow): boolean {
  if (a.kind !== b.kind || a.id !== b.id) return false;

  switch (a.kind) {
    case "working":
      return a.createdAt === (b as typeof a).createdAt;

    case "proposed-plan":
      return a.proposedPlan === (b as typeof a).proposedPlan;

    case "work":
      return a.groupedEntries === (b as typeof a).groupedEntries;

    case "message": {
      const bm = b as typeof a;
      return (
        a.message === bm.message &&
        a.durationStart === bm.durationStart &&
        a.showCompletionDivider === bm.showCompletionDivider &&
        a.assistantTurnDiffSummary === bm.assistantTurnDiffSummary &&
        a.revertTurnCount === bm.revertTurnCount
      );
    }

    case "worked-block": {
      const bm = b as typeof a;
      return (
        a.turnId === bm.turnId &&
        a.durationStart === bm.durationStart &&
        a.completedAt === bm.completedAt &&
        areRowsEqual(a.childRows, bm.childRows)
      );
    }
  }
}

function areRowsEqual(
  a: ReadonlyArray<BaseMessagesTimelineRow>,
  b: ReadonlyArray<BaseMessagesTimelineRow>,
): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((row, index) => {
    const nextRow = b[index];
    return nextRow !== undefined && isRowUnchanged(row, nextRow);
  });
}
