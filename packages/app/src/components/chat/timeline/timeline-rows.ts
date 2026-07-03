import { type MessageId } from "@honk/contracts";
import type { ConversationDensity } from "@honk/shared/conversation-density";

import {
  type TimelineEntry,
  type TimelineEntryId,
  type WorkLogEntry,
} from "../../../session-logic";
import { runtimeParentToolDisplaySignature } from "../../../lib/runtime-tool-display";
import {
  computeMessageDurationStart,
  deriveTimelineRenderItems,
  isCommandWorkEntry,
  summarizeWorkGroup,
  type GroupedSteps,
  type PendingApprovalRequestKind,
  type TimelineDurationMessage,
  type TimelineGroupedStep,
  type TimelineMessageStep,
  type TimelineProposedPlanStep,
  type TimelineRenderItem,
  type TimelineRuntimeExtensionUiRequestStep,
  type TimelineRuntimeTaskStep,
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
  id: TimelineEntryId;
  createdAt: string;
  completedDurationLabel: string | null;
  isRunning: boolean;
  isTailGroup: boolean;
  isThinkingGroup: boolean;
  isCommandGroup: boolean;
  isWaitingGroup: boolean;
  isBrowserGroup: boolean;
  summary: WorkGroupSummary;
  steps: TimelineGroupedStep[];
  groupedEntries: WorkLogEntry[];
  renderItem: Extract<TimelineRenderItem, { kind: "group" }>;
}

export type MessageTimelineRow = TimelineMessageStep;

export type ProposedPlanTimelineRow = TimelineProposedPlanStep;

export type RuntimeThinkingTimelineRow = TimelineRuntimeThinkingStep;

export type RuntimeTaskTimelineRow = TimelineRuntimeTaskStep;

export type RuntimeToolTimelineRow = TimelineRuntimeToolStep;

export type RuntimeExtensionUiRequestTimelineRow = TimelineRuntimeExtensionUiRequestStep;

export interface WorkingTimelineRow {
  kind: "working";
  id: TimelineEntryId;
  createdAt: string | null;
  step: TimelineWaitingStep;
  renderItem: Extract<TimelineRenderItem, { kind: "waitingGroup" }>;
}

export type BaseMessagesTimelineRow =
  | WorkTimelineRow
  | TimelineWorkStep
  | MessageTimelineRow
  | ProposedPlanTimelineRow
  | RuntimeThinkingTimelineRow
  | RuntimeTaskTimelineRow
  | RuntimeToolTimelineRow
  | RuntimeExtensionUiRequestTimelineRow
  | WorkingTimelineRow;

export type MessagesTimelineRow = BaseMessagesTimelineRow;

export interface StableMessagesTimelineRowsState {
  byId: Map<TimelineEntryId, MessagesTimelineRow>;
  result: MessagesTimelineRow[];
}

export function deriveMessagesTimelineRows(input: {
  timelineEntries: ReadonlyArray<TimelineEntry>;
  isTurnActive: boolean;
  editableUserMessageIds: ReadonlySet<MessageId>;
  projectRoot?: string | undefined;
  conversationDensity?: ConversationDensity | undefined;
  pendingApprovalKinds?: ReadonlySet<PendingApprovalRequestKind> | undefined;
}): MessagesTimelineRow[] {
  const renderItems = deriveTimelineRenderItems(input);
  assertUniqueTimelineRenderItemIds(renderItems);
  return renderItems.map(timelineRenderItemToRow);
}

export function computeStableMessagesTimelineRows(
  rows: MessagesTimelineRow[],
  previous: StableMessagesTimelineRowsState,
): StableMessagesTimelineRowsState {
  const next = new Map<TimelineEntryId, MessagesTimelineRow>();
  let anyChanged = rows.length !== previous.byId.size;

  const result = rows.map((row, index) => {
    const prevRow = previous.byId.get(row.id);
    const nextRow = prevRow && isRowUnchanged(prevRow, row) ? prevRow : stabilizeRow(prevRow, row);
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
        isTailGroup: item.group.isTailGroup,
        isThinkingGroup: item.group.isThinkingGroup,
        isCommandGroup: item.group.isCommandGroup,
        isWaitingGroup: item.group.isWaitingGroup,
        isBrowserGroup: item.group.isBrowserGroup,
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

function assertUniqueTimelineRenderItemIds(items: ReadonlyArray<TimelineRenderItem>): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) {
      throw new Error(`Duplicate timeline render item id: ${item.id}`);
    }
    seen.add(item.id);
    assertUniqueGroupedStepIds(item);
  }
}

function assertUniqueGroupedStepIds(item: TimelineRenderItem): void {
  if (item.kind === "single") {
    return;
  }

  const seen = new Set<string>();
  for (const step of item.group.steps) {
    if (seen.has(step.id)) {
      throw new Error(`Duplicate grouped timeline step id: ${step.id}`);
    }
    seen.add(step.id);
  }
}

// When a work group's data changes, only some of its grouped steps actually changed (e.g. one
// streaming tool call). Reuse the previous step references for the unchanged steps so the
// compiler-memoized step renderers bail out and only the changed child re-renders, instead of the
// whole preview group re-rendering on every streaming tick.
function stabilizeRow(
  prevRow: MessagesTimelineRow | undefined,
  row: MessagesTimelineRow,
): MessagesTimelineRow {
  if (
    prevRow === undefined ||
    prevRow.kind !== "work" ||
    !("steps" in prevRow) ||
    row.kind !== "work" ||
    !("steps" in row)
  ) {
    return row;
  }

  const prevStepsById = new Map<string, TimelineGroupedStep>();
  for (const step of prevRow.steps) {
    prevStepsById.set(step.id, step);
  }

  let reusedAnyStep = false;
  const steps = row.steps.map((step) => {
    const prevStep = prevStepsById.get(step.id);
    if (prevStep && prevStep !== step && isGroupedStepUnchanged(prevStep, step)) {
      reusedAnyStep = true;
      return prevStep;
    }
    return step;
  });

  return reusedAnyStep ? { ...row, steps } : row;
}

function isRowUnchanged(a: MessagesTimelineRow, b: MessagesTimelineRow): boolean {
  if (a.kind !== b.kind || a.id !== b.id) return false;

  switch (a.kind) {
    case "working":
      return (
        a.createdAt === (b as typeof a).createdAt &&
        a.step.elapsedStartedAt === (b as typeof a).step.elapsedStartedAt
      );

    case "proposed-plan":
      return a.proposedPlan === (b as typeof a).proposedPlan;

    case "runtime-tool":
      return isRuntimeToolRowUnchanged(a, b as typeof a);

    case "runtime-task":
      return isRuntimeTaskRowUnchanged(a, b as typeof a);

    case "runtime-thinking":
      return isRuntimeThinkingRowUnchanged(a, b as typeof a);

    case "runtime-extension-ui-request":
      return isRuntimeExtensionUiRequestRowUnchanged(a, b as typeof a);

    case "work": {
      const workB = b as WorkTimelineRow | TimelineWorkStep;
      if ("entry" in a || "entry" in workB) {
        return (
          "entry" in a &&
          "entry" in workB &&
          a.createdAt === workB.createdAt &&
          a.entry === workB.entry
        );
      }
      return isWorkRowUnchanged(a, workB);
    }

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
      a.turnFailure === b.turnFailure &&
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

function isRuntimeToolRowUnchanged(a: RuntimeToolTimelineRow, b: RuntimeToolTimelineRow): boolean {
  return isRuntimeToolPayloadUnchanged(a, b);
}

function isRuntimeTaskRowUnchanged(a: RuntimeTaskTimelineRow, b: RuntimeTaskTimelineRow): boolean {
  return isRuntimeToolPayloadUnchanged(a, b);
}

function isRuntimeToolPayloadUnchanged(
  a: Pick<RuntimeToolTimelineRow, "createdAt" | "tool">,
  b: Pick<RuntimeToolTimelineRow, "createdAt" | "tool">,
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
  a: Pick<RuntimeToolTimelineRow, "tool">,
  b: Pick<RuntimeToolTimelineRow, "tool">,
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
  const preserveTailRunningRow =
    a.id === b.id && a.isTailGroup && a.isRunning && b.isTailGroup && b.isRunning;
  const summaryUnchanged =
    preserveTailRunningRow ||
    (a.summary.action === b.summary.action &&
      a.summary.details === b.summary.details &&
      a.summary.additions === b.summary.additions &&
      a.summary.deletions === b.summary.deletions);

  return (
    a.createdAt === b.createdAt &&
    a.completedDurationLabel === b.completedDurationLabel &&
    a.isRunning === b.isRunning &&
    a.isTailGroup === b.isTailGroup &&
    a.isThinkingGroup === b.isThinkingGroup &&
    a.isCommandGroup === b.isCommandGroup &&
    a.isWaitingGroup === b.isWaitingGroup &&
    a.isBrowserGroup === b.isBrowserGroup &&
    summaryUnchanged &&
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
    if (!leftStep || !rightStep || !isGroupedStepUnchanged(leftStep, rightStep)) {
      return false;
    }
  }
  return true;
}

function isGroupedStepUnchanged(a: TimelineGroupedStep, b: TimelineGroupedStep): boolean {
  if (a === b) {
    return true;
  }
  if (a.kind !== b.kind || a.id !== b.id) {
    return false;
  }
  switch (a.kind) {
    case "work":
      return (b as typeof a).entry === a.entry;
    case "runtime-thinking":
      return isRuntimeThinkingRowUnchanged(a, b as typeof a);
    case "runtime-tool":
      return isRuntimeToolRowUnchanged(a, b as typeof a);
    case "message":
      return isMessageRowMessageUnchanged(a.message, (b as typeof a).message);
  }
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
