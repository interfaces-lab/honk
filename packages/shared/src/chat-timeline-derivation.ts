import {
  type EventId,
  type OrchestrationChatTimelineRow,
  type OrchestrationMessage,
  type OrchestrationProposedPlan,
  type OrchestrationThreadActivity,
  type OrchestrationThreadEntry,
  RuntimeTaskId,
  type RuntimeTaskId as RuntimeTaskIdType,
  type TurnId,
} from "@multi/contracts";

export interface DeriveChatTimelineRowsInput {
  readonly messages: ReadonlyArray<OrchestrationMessage>;
  readonly entries: ReadonlyArray<OrchestrationThreadEntry>;
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
  readonly proposedPlans: ReadonlyArray<OrchestrationProposedPlan>;
  readonly activeRunningTurnId?: TurnId | null | undefined;
}

const GLOBAL_STATUS_ACTIVITY_KINDS = new Set<OrchestrationThreadActivity["kind"]>([
  "runtime.error",
  "runtime.warning",
  "context-compaction",
  "setup-script.requested",
  "setup-script.started",
  "setup-script.failed",
]);

const GENERIC_DUPLICATE_TOOL_SUMMARY_LABELS = new Set([
  "ran",
  "ran command",
  "running",
  "running command",
  "command",
]);

interface MutableWorkRow {
  id: string;
  orderKey: string;
  createdAt: string;
  workId: string;
  activityIds: EventId[];
  turnId: TurnId | null;
  toolCallId?: string;
  taskId?: RuntimeTaskIdType;
}

export function deriveChatTimelineRows(
  input: DeriveChatTimelineRowsInput,
): OrchestrationChatTimelineRow[] {
  const entryIdByMessageId = buildEntryIdByMessageId(input.entries);
  const rows: OrchestrationChatTimelineRow[] = [];

  for (const message of input.messages) {
    const entryId = entryIdByMessageId.get(message.id) ?? null;
    rows.push({
      kind: "message",
      id: `message:${message.id}`,
      orderKey: buildOrderKey(message.createdAt, `message:${message.id}`),
      createdAt: message.createdAt,
      messageId: message.id,
      turnId: message.turnId,
      entryId,
    });
  }

  for (const proposedPlan of input.proposedPlans) {
    rows.push({
      kind: "proposed-plan",
      id: `proposed-plan:${proposedPlan.id}`,
      orderKey: buildOrderKey(proposedPlan.createdAt, `proposed-plan:${proposedPlan.id}`),
      createdAt: proposedPlan.createdAt,
      planId: proposedPlan.id,
      turnId: proposedPlan.turnId,
    });
  }

  const orderedActivities = [...input.activities].toSorted(compareActivitiesByOrder);
  const workRows: MutableWorkRow[] = [];
  const workRowIndexByWorkId = new Map<string, number>();
  const workRowIndexByUnscopedKey = new Map<string, number>();
  const visibleToolCallIds = new Set<string>();

  for (const activity of orderedActivities) {
    if (shouldSkipActivity(activity)) {
      continue;
    }

    if (activity.kind === "tool.summary") {
      if (shouldSuppressToolSummaryRow(activity, visibleToolCallIds)) {
        continue;
      }
    }

    if (activity.turnId === null && !GLOBAL_STATUS_ACTIVITY_KINDS.has(activity.kind)) {
      continue;
    }

    const workRow = toWorkRowSeed(activity);
    if (!workRow) {
      continue;
    }

    const exactIndex = workRowIndexByWorkId.get(workRow.workId);
    const unscopedKey = unscopedWorkRowKey(workRow);
    const fallbackIndex =
      exactIndex === undefined && unscopedKey
        ? workRowIndexByUnscopedKey.get(unscopedKey)
        : undefined;
    const fallbackRow = fallbackIndex === undefined ? undefined : workRows[fallbackIndex];
    const existingIndex =
      exactIndex ??
      (fallbackRow && shouldUseUnscopedWorkRowFallback(fallbackRow, workRow)
        ? fallbackIndex
        : undefined);
    const existingRow = existingIndex === undefined ? undefined : workRows[existingIndex];

    if (existingRow && shouldCollapseWorkRows(existingRow, workRow, activity)) {
      existingRow.activityIds.push(activity.id);
      mergeWorkRowMetadata(existingRow, workRow);
      if (existingRow.toolCallId) {
        visibleToolCallIds.add(existingRow.toolCallId);
      }
      continue;
    }

    workRows.push(workRow);
    const nextIndex = workRows.length - 1;
    workRowIndexByWorkId.set(workRow.workId, nextIndex);
    if (unscopedKey) {
      workRowIndexByUnscopedKey.set(unscopedKey, nextIndex);
    }
    if (workRow.toolCallId) {
      visibleToolCallIds.add(workRow.toolCallId);
    }
  }

  for (const workRow of workRows) {
    rows.push({
      kind: "work",
      id: workRow.id,
      orderKey: workRow.orderKey,
      createdAt: workRow.createdAt,
      workId: workRow.workId,
      activityIds: [...workRow.activityIds],
      turnId: workRow.turnId,
      ...(workRow.toolCallId ? { toolCallId: workRow.toolCallId } : {}),
      ...(workRow.taskId ? { taskId: workRow.taskId } : {}),
    });
  }

  return rows.toSorted((left, right) => left.orderKey.localeCompare(right.orderKey));
}

function buildEntryIdByMessageId(
  entries: ReadonlyArray<OrchestrationThreadEntry>,
): Map<OrchestrationMessage["id"], OrchestrationThreadEntry["id"]> {
  const entryIdByMessageId = new Map<
    OrchestrationMessage["id"],
    OrchestrationThreadEntry["id"]
  >();
  for (const entry of entries) {
    if (entry.kind === "message" && entry.messageId !== null) {
      entryIdByMessageId.set(entry.messageId, entry.id);
    }
  }
  return entryIdByMessageId;
}

function buildOrderKey(createdAt: string, tieBreaker: string): string {
  return `${createdAt}:${tieBreaker}`;
}

function buildActivityOrderKey(activity: OrchestrationThreadActivity): string {
  const sequence =
    "sequence" in activity && typeof activity.sequence === "number"
      ? String(activity.sequence).padStart(12, "0")
      : "000000000000";
  return buildOrderKey(activity.createdAt, `${sequence}:${activity.id}`);
}

function compareActivitiesByOrder(
  left: OrchestrationThreadActivity,
  right: OrchestrationThreadActivity,
): number {
  const leftSequence = "sequence" in left && typeof left.sequence === "number" ? left.sequence : null;
  const rightSequence =
    "sequence" in right && typeof right.sequence === "number" ? right.sequence : null;
  if (leftSequence !== null && rightSequence !== null && leftSequence !== rightSequence) {
    return leftSequence - rightSequence;
  }
  if (leftSequence !== null && rightSequence === null) {
    return -1;
  }
  if (leftSequence === null && rightSequence !== null) {
    return 1;
  }

  const createdAtComparison = left.createdAt.localeCompare(right.createdAt);
  if (createdAtComparison !== 0) {
    return createdAtComparison;
  }

  const lifecycleRankComparison =
    compareActivityLifecycleRank(left.kind) - compareActivityLifecycleRank(right.kind);
  if (lifecycleRankComparison !== 0) {
    return lifecycleRankComparison;
  }

  return left.id.localeCompare(right.id);
}

function compareActivityLifecycleRank(kind: OrchestrationThreadActivity["kind"]): number {
  if (kind.endsWith(".started") || kind === "tool.started") {
    return 0;
  }
  if (kind.endsWith(".progress") || kind.endsWith(".updated")) {
    return 1;
  }
  if (kind.endsWith(".completed") || kind.endsWith(".resolved")) {
    return 2;
  }
  return 1;
}

function shouldSkipActivity(activity: OrchestrationThreadActivity): boolean {
  if (activity.kind === "context-window.updated") {
    return true;
  }
  if (activity.kind.startsWith("subagent.")) {
    return true;
  }
  if (isPlanBoundaryToolActivity(activity)) {
    return true;
  }
  return false;
}

function isPlanBoundaryToolActivity(activity: OrchestrationThreadActivity): boolean {
  if (activity.kind !== "tool.updated" && activity.kind !== "tool.completed") {
    return false;
  }
  const payload = asRecord(activity.payload);
  return typeof payload?.detail === "string" && payload.detail.startsWith("ExitPlanMode:");
}

function shouldSuppressToolSummaryRow(
  activity: OrchestrationThreadActivity,
  visibleToolCallIds: ReadonlySet<string>,
): boolean {
  if (!isGenericDuplicateToolSummary(activity.summary)) {
    return false;
  }
  const payload = asRecord(activity.payload);
  const precedingToolUseIds = asTrimmedStringArray(payload?.precedingToolUseIds);
  return precedingToolUseIds.some((toolUseId) => visibleToolCallIds.has(toolUseId));
}

function isGenericDuplicateToolSummary(label: string): boolean {
  const normalized = label.trim().toLowerCase().replace(/[.:]+$/, "");
  return GENERIC_DUPLICATE_TOOL_SUMMARY_LABELS.has(normalized);
}

function toWorkRowSeed(activity: OrchestrationThreadActivity): MutableWorkRow | null {
  const payload = asRecord(activity.payload);
  const toolCallId = isToolLifecycleActivityKind(activity.kind)
    ? asTrimmedString(payload?.itemId)
    : undefined;
  const taskId = isTaskLifecycleActivityKind(activity.kind)
    ? asRuntimeTaskId(payload?.taskId)
    : undefined;
  const workId = deriveWorkId(activity.turnId, toolCallId, taskId, activity.id);
  const id = `work:${workId}`;

  return {
    id,
    orderKey: buildActivityOrderKey(activity),
    createdAt: activity.createdAt,
    workId,
    activityIds: [activity.id],
    turnId: activity.turnId,
    ...(toolCallId ? { toolCallId } : {}),
    ...(taskId ? { taskId } : {}),
  };
}

function deriveWorkId(
  turnId: TurnId | null,
  toolCallId: string | undefined,
  taskId: string | undefined,
  activityId: EventId,
): string {
  if (toolCallId) {
    return turnId === null ? `tool:${toolCallId}` : `tool:${turnId}:${toolCallId}`;
  }
  if (taskId) {
    return turnId === null ? `task:${taskId}` : `task:${turnId}:${taskId}`;
  }
  return `activity:${activityId}`;
}

function unscopedWorkRowKey(workRow: MutableWorkRow): string | undefined {
  if (workRow.toolCallId) {
    return `tool:${workRow.toolCallId}`;
  }
  if (workRow.taskId) {
    return `task:${workRow.taskId}`;
  }
  return undefined;
}

function shouldUseUnscopedWorkRowFallback(
  previous: MutableWorkRow,
  next: MutableWorkRow,
): boolean {
  if (previous.turnId !== next.turnId) {
    return false;
  }
  return previous.toolCallId === undefined && next.toolCallId === undefined
    ? true
    : previous.taskId === undefined && next.taskId === undefined;
}

function shouldCollapseWorkRows(
  previous: MutableWorkRow,
  next: MutableWorkRow,
  nextActivity: OrchestrationThreadActivity,
): boolean {
  if (isToolLifecycleActivityKind(nextActivity.kind)) {
    if (nextActivity.kind === "tool.started") {
      return false;
    }
    if (
      previous.toolCallId !== undefined &&
      previous.toolCallId === next.toolCallId &&
      previous.turnId === next.turnId
    ) {
      return true;
    }
    return (
      previous.toolCallId === undefined &&
      next.toolCallId === undefined &&
      previous.workId === next.workId
    );
  }

  if (isTaskLifecycleActivityKind(nextActivity.kind)) {
    if (nextActivity.kind === "task.started") {
      return false;
    }
    if (
      previous.taskId !== undefined &&
      previous.taskId === next.taskId &&
      previous.turnId === next.turnId
    ) {
      return true;
    }
    return (
      previous.taskId === undefined &&
      next.taskId === undefined &&
      previous.workId === next.workId
    );
  }

  return false;
}

function mergeWorkRowMetadata(previous: MutableWorkRow, next: MutableWorkRow): void {
  if (!previous.toolCallId && next.toolCallId) {
    previous.toolCallId = next.toolCallId;
    previous.workId = next.workId;
    previous.id = next.id;
  }
  if (!previous.taskId && next.taskId) {
    previous.taskId = next.taskId;
    previous.workId = next.workId;
    previous.id = next.id;
  }
}

function isToolLifecycleActivityKind(kind: OrchestrationThreadActivity["kind"]): boolean {
  return kind === "tool.started" || kind === "tool.updated" || kind === "tool.completed";
}

function isTaskLifecycleActivityKind(kind: OrchestrationThreadActivity["kind"]): boolean {
  return kind === "task.started" || kind === "task.progress" || kind === "task.completed";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asRuntimeTaskId(value: unknown): RuntimeTaskIdType | undefined {
  const trimmed = asTrimmedString(value);
  return trimmed ? RuntimeTaskId.make(trimmed) : undefined;
}

function asTrimmedStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const trimmed = asTrimmedString(entry);
    return trimmed ? [trimmed] : [];
  });
}
