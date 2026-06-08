import { type MessageId } from "@multi/contracts";

import { type TimelineEntry, type WorkLogEntry } from "../../../session-logic";
import { runtimeParentToolDisplaySignature } from "../../../lib/runtime-tool-display";
import {
  computeMessageDurationStart,
  deriveTimelineRenderItems,
  isCommandWorkEntry,
  summarizeWorkGroup,
  type GroupedSteps,
  type TimelineCustomMessageStep,
  type TimelineDurationMessage,
  type TimelineGroupedStep,
  type TimelineMessageStep,
  type TimelineProposedPlanStep,
  type TimelineRenderItem,
  type TimelineRuntimeExtensionUiRequestStep,
  type TimelineRuntimeThinkingStep,
  type TimelineRuntimeToolStep,
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
  steps: TimelineGroupedStep[];
  groupedEntries: WorkLogEntry[];
  renderItem: Extract<TimelineRenderItem, { kind: "group" }>;
}

export type MessageTimelineRow = TimelineMessageStep;

export type ProposedPlanTimelineRow = TimelineProposedPlanStep;

export type CustomMessageTimelineRow = TimelineCustomMessageStep;

export type RuntimeThinkingTimelineRow = TimelineRuntimeThinkingStep;

export type RuntimeToolTimelineRow = TimelineRuntimeToolStep;

export type RuntimeExtensionUiRequestTimelineRow = TimelineRuntimeExtensionUiRequestStep;

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
  | CustomMessageTimelineRow
  | RuntimeThinkingTimelineRow
  | RuntimeToolTimelineRow
  | RuntimeExtensionUiRequestTimelineRow
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

    case "custom-message":
      return isCustomMessageRowUnchanged(a, b as typeof a);

    case "runtime-tool":
      return isRuntimeToolRowUnchanged(a, b as typeof a);

    case "runtime-thinking":
      return isRuntimeThinkingRowUnchanged(a, b as typeof a);

    case "runtime-extension-ui-request":
      return isRuntimeExtensionUiRequestRowUnchanged(a, b as typeof a);

    case "work":
      return isWorkRowUnchanged(a, b as typeof a);

    case "message": {
      const bm = b as typeof a;
      return (
        isMessageRowMessageUnchanged(a.message, bm.message) &&
        a.durationStart === bm.durationStart &&
        a.editAvailable === bm.editAvailable &&
        a.pairId === bm.pairId &&
        a.messageIndex === bm.messageIndex
      );
    }
  }
}

function isRuntimeThinkingRowUnchanged(
  a: RuntimeThinkingTimelineRow,
  b: RuntimeThinkingTimelineRow,
): boolean {
  return (
    a.createdAt === b.createdAt &&
    a.message.turnId === b.message.turnId &&
    a.message.role === b.message.role &&
    a.message.thinking === b.message.thinking &&
    a.message.streaming === b.message.streaming
  );
}

function isMessageRowMessageUnchanged(
  a: MessageTimelineRow["message"],
  b: MessageTimelineRow["message"],
): boolean {
  if (a.role === "user" && b.role === "user") {
    return (
      a.id === b.id &&
      a.text === b.text &&
      a.richText === b.richText &&
      a.createdAt === b.createdAt &&
      areSameAttachments(a.attachments ?? [], b.attachments ?? [])
    );
  }

  return (
    a.id === b.id &&
    a.role === b.role &&
    a.text === b.text &&
    a.richText === b.richText &&
    a.turnId === b.turnId &&
    a.createdAt === b.createdAt &&
    a.completedAt === b.completedAt &&
    a.streaming === b.streaming &&
    areSameAttachments(a.attachments ?? [], b.attachments ?? [])
  );
}

function isCustomMessageRowUnchanged(
  a: CustomMessageTimelineRow,
  b: CustomMessageTimelineRow,
): boolean {
  return (
    a.createdAt === b.createdAt &&
    a.customMessage.customType === b.customMessage.customType &&
    a.customMessage.display === b.customMessage.display &&
    runtimeCustomMessageVisibleText(a.customMessage.content, a.customMessage.text) ===
      runtimeCustomMessageVisibleText(b.customMessage.content, b.customMessage.text)
  );
}

function isRuntimeToolRowUnchanged(
  a: RuntimeToolTimelineRow,
  b: RuntimeToolTimelineRow,
): boolean {
  return (
    a.createdAt === b.createdAt &&
    a.tool.toolCallId === b.tool.toolCallId &&
    a.tool.toolName === b.tool.toolName &&
    a.tool.turnId === b.tool.turnId &&
    a.tool.status === b.tool.status &&
    a.tool.argsComplete === b.tool.argsComplete &&
    a.tool.executionStarted === b.tool.executionStarted &&
    a.tool.isPartial === b.tool.isPartial &&
    a.tool.isError === b.tool.isError &&
    a.tool.summary === b.tool.summary &&
    areRuntimeToolVisibleDetailsUnchanged(a, b)
  );
}

function areRuntimeToolVisibleDetailsUnchanged(
  a: RuntimeToolTimelineRow,
  b: RuntimeToolTimelineRow,
): boolean {
  if (a.tool.display || b.tool.display) {
    return (
      runtimeParentToolDisplaySignature(a.tool.display) ===
      runtimeParentToolDisplaySignature(b.tool.display)
    );
  }
  return a.tool.command === b.tool.command && a.tool.output === b.tool.output;
}

function isRuntimeExtensionUiRequestRowUnchanged(
  a: RuntimeExtensionUiRequestTimelineRow,
  b: RuntimeExtensionUiRequestTimelineRow,
): boolean {
  return (
    a.createdAt === b.createdAt &&
    a.request.requestId === b.request.requestId &&
    a.request.requestKind === b.request.requestKind &&
    a.request.status === b.request.status &&
    a.request.threadId === b.request.threadId &&
    a.request.runtimeSessionId === b.request.runtimeSessionId &&
    a.request.title === b.request.title &&
    a.request.message === b.request.message &&
    a.request.placeholder === b.request.placeholder &&
    a.request.turnId === b.request.turnId
  );
}

function runtimeCustomMessageVisibleText(content: unknown, fallbackText: string | undefined): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .flatMap((entry) => {
        if (!entry || typeof entry !== "object") {
          return [];
        }
        const record = entry as Record<string, unknown>;
        return record.type === "text" && typeof record.text === "string" ? [record.text] : [];
      })
      .join("\n");
  }
  return fallbackText ?? "";
}

function areSameAttachments(
  left: NonNullable<MessageTimelineRow["message"]["attachments"]>,
  right: NonNullable<MessageTimelineRow["message"]["attachments"]>,
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const leftAttachment = left[index];
    const rightAttachment = right[index];
    if (!leftAttachment || !rightAttachment) {
      return false;
    }
    if (
      leftAttachment.type !== rightAttachment.type ||
      leftAttachment.id !== rightAttachment.id ||
      leftAttachment.name !== rightAttachment.name ||
      leftAttachment.mimeType !== rightAttachment.mimeType ||
      leftAttachment.sizeBytes !== rightAttachment.sizeBytes ||
      leftAttachment.previewUrl !== rightAttachment.previewUrl
    ) {
      return false;
    }
  }
  return true;
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
    areSameWorkEntries(a.groupedEntries, b.groupedEntries) &&
    areSameGroupedSteps(a.steps, b.steps)
  );
}

function areSameGroupedSteps(
  left: ReadonlyArray<TimelineGroupedStep>,
  right: ReadonlyArray<TimelineGroupedStep>,
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const leftStep = left[index];
    const rightStep = right[index];
    if (!leftStep || !rightStep || leftStep.kind !== rightStep.kind || leftStep.id !== rightStep.id) {
      return false;
    }
    switch (leftStep.kind) {
      case "work":
        if ((rightStep as typeof leftStep).entry !== leftStep.entry) {
          return false;
        }
        break;
      case "runtime-thinking":
        if (!isRuntimeThinkingRowUnchanged(leftStep, rightStep as typeof leftStep)) {
          return false;
        }
        break;
      case "runtime-tool":
        if (!isRuntimeToolRowUnchanged(leftStep, rightStep as typeof leftStep)) {
          return false;
        }
        break;
    }
  }
  return true;
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
