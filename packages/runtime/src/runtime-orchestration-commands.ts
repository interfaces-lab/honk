import {
  CommandId,
  EventId,
  type InternalOrchestrationCommand,
  type RuntimeIngestionRecord,
  RuntimeIngestionRecordId,
  MessageId,
  runtimeSessionEntryMessageId,
  ThreadTokenUsageSnapshot,
  TurnId,
  type AgentRuntimeEvent,
  type OrchestrationThreadActivity,
  type SessionTreeEntry,
  type SessionTreeProjection,
  type ThreadEntryId,
  type ThreadId,
  type ToolLifecycleItemType,
} from "@honk/contracts";
import { toJsonValue } from "@honk/shared/schema-json";
import { Schema } from "effect";

import { runtimeSubagentActivitiesForToolEvent } from "./runtime-subagent-activities";
import { asRecord } from "./runtime-record";
import { runtimeToolItemTypeForName } from "./runtime-tool-item-type";
import { extractProviderFailureMessage } from "./message-text";
import {
  isProviderFailureAssistantMessageText,
  providerFailureFromAssistantMessageText,
} from "./provider-error";

const isThreadTokenUsageSnapshot = Schema.is(ThreadTokenUsageSnapshot);

const legacyCommandActivitySummaryByText: Readonly<Record<string, string>> = {
  "Started bash": "Started command",
  "Running bash": "Running command",
  "Ran bash": "Ran command",
  "Completed bash": "Ran command",
  "Bash failed": "Command failed",
  "bash failed": "Command failed",
};

const commandLifecycleSummaries: ReadonlySet<string> = new Set([
  "Started command",
  "Running command",
  "Ran command",
  "Command failed",
]);
const metadataOnlyToolActivitySummaries: ReadonlySet<string> = new Set([
  ...commandLifecycleSummaries,
  "Tool completed",
  "Tool failed",
]);

export interface RuntimeOrchestrationCommandContext {
  readonly resolveTurnUserEntryId?: (threadId: ThreadId, turnId: TurnId) => ThreadEntryId | null;
}

export function runtimeEventIngestionKey(event: AgentRuntimeEvent): string {
  return `${event.threadId}:${event.runtimeSessionId}:${event.id}`;
}

export function runtimeAssistantEntryIngestionKey(
  tree: SessionTreeProjection,
  entry: SessionTreeEntry,
): string {
  return `${tree.threadId}:${tree.runtimeSessionId}:${entry.id}`;
}

function asTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isLegacyCommandActivitySummary(value: unknown): boolean {
  const summary = asTrimmedString(value);
  return summary !== null && legacyCommandActivitySummaryByText[summary] !== undefined;
}

function runtimeToolNameForActivity(input: {
  readonly rawToolName: string;
  readonly eventSummary: unknown;
}): string {
  if (isLegacyCommandActivitySummary(input.eventSummary)) {
    return "bash";
  }
  return input.rawToolName;
}

function hasRenderableToolEventData(
  record: Record<string, unknown>,
  subagentParentItem: Record<string, unknown> | null,
): boolean {
  return (
    record.args !== undefined ||
    record.result !== undefined ||
    record.partialResult !== undefined ||
    record.output !== undefined ||
    record.command !== undefined ||
    subagentParentItem !== null
  );
}

function shouldOmitMetadataOnlyToolCompletedActivity(input: {
  readonly record: Record<string, unknown>;
  readonly summary: string;
  readonly isError: boolean;
  readonly subagentActivities: ReadonlyArray<OrchestrationThreadActivity>;
  readonly subagentParentItem: Record<string, unknown> | null;
}): boolean {
  if (input.subagentActivities.length > 0) {
    return false;
  }
  if (hasRenderableToolEventData(input.record, input.subagentParentItem)) {
    return false;
  }
  if (!input.isError) {
    return true;
  }
  return metadataOnlyToolActivitySummaries.has(input.summary);
}

function runtimeToolActivitySummary(input: {
  readonly eventSummary: unknown;
  readonly itemType: ToolLifecycleItemType;
  readonly isError: boolean;
  readonly subagentParentItem: Record<string, unknown> | null;
}): { readonly summary: string; readonly detail?: string } {
  const eventSummary = asTrimmedString(input.eventSummary);
  const subagentSummary = subagentParentItemSummary(input.subagentParentItem, input.isError);
  if (
    input.itemType === "collab_agent_tool_call" &&
    subagentSummary !== null &&
    (eventSummary === null || isGenericSubagentLifecycleSummary(eventSummary))
  ) {
    return { summary: subagentSummary };
  }
  if (eventSummary !== null) {
    const migratedSummary = legacyCommandActivitySummaryByText[eventSummary];
    if (migratedSummary !== undefined) {
      return { summary: migratedSummary };
    }
    if (input.itemType === "command_execution" && commandLifecycleSummaries.has(eventSummary)) {
      return { summary: eventSummary };
    }
    return { summary: eventSummary, detail: eventSummary };
  }

  if (input.itemType === "command_execution") {
    return { summary: input.isError ? "Command failed" : "Ran command" };
  }

  return { summary: input.isError ? "Tool failed" : "Tool completed" };
}

function isGenericSubagentLifecycleSummary(summary: string): boolean {
  const normalized = summary
    .trim()
    .toLowerCase()
    .replace(/[.:]+$/, "");
  return (
    normalized === "completed subagent" ||
    normalized === "completed subagents" ||
    normalized === "subagent completed" ||
    normalized === "subagents completed" ||
    normalized === "started subagent" ||
    normalized === "started subagents" ||
    normalized === "subagent started" ||
    normalized === "subagents started" ||
    normalized === "running subagent" ||
    normalized === "running subagents" ||
    normalized === "subagent running" ||
    normalized === "subagents running"
  );
}

function subagentParentItemSummary(
  subagentParentItem: Record<string, unknown> | null,
  isError: boolean,
): string | null {
  const itemDetails = asRecord(subagentParentItem?.details);
  const runs = Array.isArray(itemDetails?.runs)
    ? itemDetails.runs.map(asRecord).filter((run): run is Record<string, unknown> => run !== null)
    : [];
  if (runs.length === 0) {
    return null;
  }
  const stateCounts = countSubagentRunStates(runs);
  const active = stateCounts.queued + stateCounts.running;
  if (active > 0) {
    return stateCounts.running > 0
      ? `${active} ${pluralize("subagent", active)} running`
      : active === 1
        ? "Starting up"
        : `${active} subagents starting`;
  }
  const failed = stateCounts.failed + (isError && stateCounts.failed === 0 ? 1 : 0);
  if (failed > 0) {
    return failed === 1 ? "Background task failed" : "Background tasks failed";
  }
  if (stateCounts.aborted > 0) {
    return stateCounts.aborted === 1 ? "Background task stopped" : "Background tasks stopped";
  }
  return runs.length === 1 ? "Background task completed" : "Background tasks completed";
}

function countSubagentRunStates(runs: readonly Record<string, unknown>[]): {
  readonly queued: number;
  readonly running: number;
  readonly failed: number;
  readonly aborted: number;
} {
  let queued = 0;
  let running = 0;
  let failed = 0;
  let aborted = 0;
  for (const run of runs) {
    switch (asTrimmedString(run.state)) {
      case "queued":
        queued += 1;
        break;
      case "running":
        running += 1;
        break;
      case "failed":
        failed += 1;
        break;
      case "aborted":
        aborted += 1;
        break;
    }
  }
  return { queued, running, failed, aborted };
}

function pluralize(noun: string, count: number): string {
  return count === 1 ? noun : `${noun}s`;
}

function runtimeAssistantCompleteCommandId(
  tree: SessionTreeProjection,
  entry: SessionTreeEntry,
): CommandId {
  return CommandId.make(`runtime-assistant:${tree.threadId}:${tree.runtimeSessionId}:${entry.id}`);
}

function runtimeAssistantCompleteRecordId(
  tree: SessionTreeProjection,
  entry: SessionTreeEntry,
): RuntimeIngestionRecordId {
  return RuntimeIngestionRecordId.make(
    `runtime-assistant:${tree.threadId}:${tree.runtimeSessionId}:${entry.id}`,
  );
}

export function runtimeToolActivityCommandId(
  event: AgentRuntimeEvent,
  activity: OrchestrationThreadActivity,
): CommandId {
  return CommandId.make(`runtime-tool:${event.threadId}:${event.runtimeSessionId}:${activity.id}`);
}

function runtimeToolActivityRecordId(
  event: AgentRuntimeEvent,
  activity: OrchestrationThreadActivity,
): RuntimeIngestionRecordId {
  return RuntimeIngestionRecordId.make(
    `runtime-tool:${event.threadId}:${event.runtimeSessionId}:${activity.id}`,
  );
}

function findSessionTreeUserAncestorClientMessageId(
  entry: SessionTreeEntry,
  entryById: ReadonlyMap<SessionTreeEntry["id"], SessionTreeEntry>,
): MessageId | null {
  const seen = new Set<SessionTreeEntry["id"]>();
  let cursor = entry.parentId;
  while (cursor) {
    if (seen.has(cursor)) {
      return null;
    }
    seen.add(cursor);
    const parent = entryById.get(cursor);
    if (!parent) {
      return null;
    }
    if (parent.role === "user" && parent.clientMessageId) {
      return parent.clientMessageId;
    }
    cursor = parent.parentId;
  }
  return null;
}

function sessionTreeEntryProviderFailure(entry: SessionTreeEntry): string | null {
  if (entry.role !== "assistant") {
    return null;
  }
  const rawEntry = asRecord(entry.rawEntry);
  const rawMessage = rawEntry?.message ?? rawEntry;
  const providerFailure = extractProviderFailureMessage(rawMessage);
  if (providerFailure) {
    return providerFailure;
  }
  return providerFailureFromAssistantMessageText(entry.text ?? "");
}

function isProviderFailureAssistantEntry(entry: SessionTreeEntry): boolean {
  if (entry.role !== "assistant") {
    return false;
  }
  const failure = sessionTreeEntryProviderFailure(entry);
  if (!failure) {
    return false;
  }
  const text = entry.text?.trim() ?? "";
  if (text.length === 0) {
    return true;
  }
  return isProviderFailureAssistantMessageText(entry.text ?? "");
}

function runtimeProviderFailureActivityId(
  tree: SessionTreeProjection,
  entry: SessionTreeEntry,
): EventId {
  return EventId.make(
    `runtime-provider-failure:${tree.threadId}:${tree.runtimeSessionId}:${entry.id}`,
  );
}

function runtimeProviderFailureRecordId(
  tree: SessionTreeProjection,
  entry: SessionTreeEntry,
): RuntimeIngestionRecordId {
  return RuntimeIngestionRecordId.make(
    `runtime-provider-failure:${tree.threadId}:${tree.runtimeSessionId}:${entry.id}`,
  );
}

export function runtimeSessionTreeProviderFailureActivity(input: {
  readonly tree: SessionTreeProjection;
  readonly entry: SessionTreeEntry;
  readonly entryById: ReadonlyMap<SessionTreeEntry["id"], SessionTreeEntry>;
}): OrchestrationThreadActivity | null {
  if (!isProviderFailureAssistantEntry(input.entry) || !input.entry.turnId) {
    return null;
  }
  const detail = sessionTreeEntryProviderFailure(input.entry);
  if (!detail) {
    return null;
  }
  const messageId = findSessionTreeUserAncestorClientMessageId(input.entry, input.entryById);
  if (!messageId) {
    return null;
  }
  return {
    id: runtimeProviderFailureActivityId(input.tree, input.entry),
    tone: "error",
    kind: "runtime.turn.provider.failed",
    summary: "Provider request failed",
    payload: {
      detail,
      messageId,
    },
    turnId: TurnId.make(input.entry.turnId),
    createdAt: input.entry.createdAt,
  };
}

export function runtimeSessionTreeProviderFailureRecord(input: {
  readonly tree: SessionTreeProjection;
  readonly entry: SessionTreeEntry;
  readonly entryById: ReadonlyMap<SessionTreeEntry["id"], SessionTreeEntry>;
}): RuntimeIngestionRecord | null {
  const activity = runtimeSessionTreeProviderFailureActivity(input);
  if (!activity) {
    return null;
  }
  return {
    recordId: runtimeProviderFailureRecordId(input.tree, input.entry),
    threadId: input.tree.threadId,
    runtimeSessionId: input.tree.runtimeSessionId,
    sourceEventId: input.entry.id,
    kind: "thread.activity",
    createdAt: input.entry.createdAt,
    payload: { activity },
  };
}

export function runtimeSessionTreeProviderFailureRecords(input: {
  readonly tree: SessionTreeProjection;
}): RuntimeIngestionRecord[] {
  const entryById = new Map(input.tree.entries.map((entry) => [entry.id, entry] as const));
  const records: RuntimeIngestionRecord[] = [];
  for (const entry of input.tree.entries) {
    const record = runtimeSessionTreeProviderFailureRecord({
      tree: input.tree,
      entry,
      entryById,
    });
    if (record) {
      records.push(record);
    }
  }
  return records;
}

function findSessionTreeUserAncestorEntryId(
  entry: SessionTreeEntry,
  entryById: ReadonlyMap<SessionTreeEntry["id"], SessionTreeEntry>,
): ThreadEntryId | null {
  const seen = new Set<SessionTreeEntry["id"]>();
  let cursor = entry.parentId;
  while (cursor) {
    if (seen.has(cursor)) {
      return null;
    }
    seen.add(cursor);
    const parent = entryById.get(cursor);
    if (!parent) {
      return null;
    }
    if (parent.role === "user" && parent.clientMessageId) {
      return parent.threadEntryId;
    }
    cursor = parent.parentId;
  }
  return null;
}

export function runtimeSessionTreeAssistantCompleteCommand(input: {
  readonly tree: SessionTreeProjection;
  readonly entry: SessionTreeEntry;
  readonly entryById: ReadonlyMap<SessionTreeEntry["id"], SessionTreeEntry>;
  readonly context?: RuntimeOrchestrationCommandContext;
}): InternalOrchestrationCommand | null {
  if (
    input.entry.role !== "assistant" ||
    !input.entry.turnId ||
    isProviderFailureAssistantEntry(input.entry) ||
    (input.entry.text?.trim().length ?? 0) === 0
  ) {
    return null;
  }

  const turnId = TurnId.make(input.entry.turnId);
  const parentEntryId =
    findSessionTreeUserAncestorEntryId(input.entry, input.entryById) ??
    input.context?.resolveTurnUserEntryId?.(input.tree.threadId, turnId) ??
    null;
  if (!parentEntryId) {
    return null;
  }

  return {
    type: "thread.message.assistant.complete",
    commandId: runtimeAssistantCompleteCommandId(input.tree, input.entry),
    threadId: input.tree.threadId,
    messageId: runtimeSessionEntryMessageId(input.tree.runtimeSessionId, input.entry.id),
    text: input.entry.text ?? "",
    turnId,
    parentEntryId,
    createdAt: input.entry.createdAt,
  };
}

export function runtimeSessionTreeAssistantCompleteCommands(input: {
  readonly tree: SessionTreeProjection;
  readonly context?: RuntimeOrchestrationCommandContext;
}): InternalOrchestrationCommand[] {
  const entryById = new Map(input.tree.entries.map((entry) => [entry.id, entry] as const));
  const commands: InternalOrchestrationCommand[] = [];
  for (const entry of input.tree.entries) {
    const command = runtimeSessionTreeAssistantCompleteCommand({
      tree: input.tree,
      entry,
      entryById,
      ...(input.context ? { context: input.context } : {}),
    });
    if (command) {
      commands.push(command);
    }
  }
  return commands;
}

export function runtimeSessionTreeAssistantCompleteRecord(input: {
  readonly tree: SessionTreeProjection;
  readonly entry: SessionTreeEntry;
  readonly entryById: ReadonlyMap<SessionTreeEntry["id"], SessionTreeEntry>;
  readonly context?: RuntimeOrchestrationCommandContext;
}): RuntimeIngestionRecord | null {
  const command = runtimeSessionTreeAssistantCompleteCommand(input);
  if (!command) {
    return null;
  }
  if (command.type !== "thread.message.assistant.complete") {
    return null;
  }
  return {
    recordId: runtimeAssistantCompleteRecordId(input.tree, input.entry),
    threadId: input.tree.threadId,
    runtimeSessionId: input.tree.runtimeSessionId,
    sourceEventId: input.entry.id,
    kind: "assistant.completion",
    createdAt: command.createdAt,
    payload: {
      messageId: command.messageId,
      text: command.text,
      turnId: command.turnId,
      parentEntryId: command.parentEntryId,
    },
  };
}

export function runtimeSessionTreeAssistantCompleteRecords(input: {
  readonly tree: SessionTreeProjection;
  readonly context?: RuntimeOrchestrationCommandContext;
}): RuntimeIngestionRecord[] {
  const entryById = new Map(input.tree.entries.map((entry) => [entry.id, entry] as const));
  const records: RuntimeIngestionRecord[] = [];
  for (const entry of input.tree.entries) {
    const record = runtimeSessionTreeAssistantCompleteRecord({
      tree: input.tree,
      entry,
      entryById,
      ...(input.context ? { context: input.context } : {}),
    });
    if (record) {
      records.push(record);
    }
  }
  return records;
}

function compactSubagentParentRun(
  value: unknown,
  fallbackState: "completed" | "failed",
): Record<string, unknown> | null {
  const run = asRecord(value);
  if (!run) {
    return null;
  }
  const subagentThreadId = asTrimmedString(run.subagentThreadId);
  if (!subagentThreadId) {
    return null;
  }
  const agentId = asTrimmedString(run.agentId);
  const nickname = asTrimmedString(run.nickname);
  const role = asTrimmedString(run.role);
  const model = asTrimmedString(run.model);
  const prompt = asTrimmedString(run.prompt);
  const state = asTrimmedString(run.state) ?? fallbackState;
  const errorMessage = asTrimmedString(run.errorMessage);
  return {
    subagentThreadId,
    ...(agentId ? { agentId } : {}),
    ...(nickname ? { nickname } : {}),
    ...(role ? { role } : {}),
    ...(model ? { model } : {}),
    ...(prompt ? { prompt } : {}),
    state,
    finalText: null,
    errorMessage: errorMessage ?? null,
  };
}

function compactSubagentParentItem(
  record: Record<string, unknown>,
  fallbackState: "completed" | "failed",
): Record<string, unknown> | null {
  const result = asRecord(record.result);
  const details = asRecord(result?.details);
  const rawRuns = Array.isArray(details?.runs) ? details.runs : [];
  const runs = rawRuns
    .map((run) => compactSubagentParentRun(run, fallbackState))
    .filter((run): run is Record<string, unknown> => run !== null);
  if (runs.length === 0) {
    return null;
  }
  return {
    tool: "subagent",
    details: { runs },
  };
}

export function runtimeToolCompletedActivities(
  event: AgentRuntimeEvent,
): OrchestrationThreadActivity[] {
  if (event.type !== "tool.completed") {
    return [];
  }
  const record = asRecord(event.data) ?? {};
  const rawToolName = asTrimmedString(record.toolName) ?? "tool";
  const toolName = runtimeToolNameForActivity({
    rawToolName,
    eventSummary: event.summary,
  });
  const toolCallId = asTrimmedString(record.toolCallId) ?? event.id;
  const isError = record.isError === true;
  const itemType = runtimeToolItemTypeForName(toolName);
  const title = itemType === "command_execution" ? "command" : toolName;
  const subagentActivities = runtimeSubagentActivitiesForToolEvent(event);
  const subagentParentItem =
    toolName === "subagent"
      ? compactSubagentParentItem(record, isError ? "failed" : "completed")
      : null;
  const summary = runtimeToolActivitySummary({
    eventSummary: event.summary,
    itemType,
    isError,
    subagentParentItem,
  });
  if (
    shouldOmitMetadataOnlyToolCompletedActivity({
      record,
      summary: summary.summary,
      isError,
      subagentActivities,
      subagentParentItem,
    })
  ) {
    return [];
  }
  const activity: OrchestrationThreadActivity = {
    id: EventId.make(`runtime-activity:${event.id}`),
    tone: isError ? ("error" as const) : ("tool" as const),
    kind: "tool.completed",
    summary: summary.summary,
    payload: {
      itemId: toolCallId,
      itemType,
      status: isError ? "error" : "completed",
      title,
      ...(summary.detail !== undefined ? { detail: summary.detail } : {}),
      data:
        toJsonValue({
          toolCallId,
          toolName,
          isError,
          ...(record.args !== undefined ? { args: record.args } : {}),
          ...(subagentParentItem ? { item: subagentParentItem } : {}),
          ...(!subagentParentItem && record.result !== undefined ? { result: record.result } : {}),
        }) ?? null,
    },
    turnId: event.turnId ?? null,
    createdAt: subagentActivities[0]?.createdAt ?? event.createdAt,
  };
  return subagentActivities.length > 0 ? [activity, ...subagentActivities] : [activity];
}

export function runtimeContextWindowActivities(
  event: AgentRuntimeEvent,
): OrchestrationThreadActivity[] {
  if (event.type !== "context-window.updated" || !isThreadTokenUsageSnapshot(event.data)) {
    return [];
  }
  return [
    {
      id: EventId.make(`runtime-activity:${event.id}`),
      tone: "info" as const,
      kind: "context-window.updated",
      summary: event.summary ?? "Context usage updated",
      payload: event.data,
      turnId: event.turnId ?? null,
      createdAt: event.createdAt,
    },
  ];
}

export function runtimeContextWindowActivityCommands(
  event: AgentRuntimeEvent,
): InternalOrchestrationCommand[] {
  return runtimeContextWindowActivities(event).map((activity) => ({
    type: "thread.activity.append",
    commandId: CommandId.make(
      `runtime-context-window:${event.threadId}:${event.runtimeSessionId}:${event.id}`,
    ),
    threadId: event.threadId,
    activity,
    createdAt: event.createdAt,
  }));
}

export function runtimeToolCompletedActivityCommands(
  event: AgentRuntimeEvent,
): InternalOrchestrationCommand[] {
  if (event.type !== "tool.completed") {
    return [];
  }
  const activities = runtimeToolCompletedActivities(event);
  return activities.map((activity) => ({
    type: "thread.activity.append",
    commandId: runtimeToolActivityCommandId(event, activity),
    threadId: event.threadId,
    activity,
    createdAt: event.createdAt,
  }));
}

export function runtimeContextWindowActivityRecords(
  event: AgentRuntimeEvent,
): RuntimeIngestionRecord[] {
  return runtimeContextWindowActivities(event).map((activity) => ({
    recordId: RuntimeIngestionRecordId.make(
      `runtime-context-window:${event.threadId}:${event.runtimeSessionId}:${event.id}`,
    ),
    threadId: event.threadId,
    runtimeSessionId: event.runtimeSessionId,
    sourceEventId: event.id,
    kind: "thread.activity",
    createdAt: event.createdAt,
    payload: { activity },
  }));
}

export function runtimeToolCompletedActivityRecords(
  event: AgentRuntimeEvent,
): RuntimeIngestionRecord[] {
  if (event.type !== "tool.completed") {
    return [];
  }
  const activities = runtimeToolCompletedActivities(event);
  return activities.map((activity) => ({
    recordId: runtimeToolActivityRecordId(event, activity),
    threadId: event.threadId,
    runtimeSessionId: event.runtimeSessionId,
    sourceEventId: event.id,
    kind: "thread.activity",
    createdAt: event.createdAt,
    payload: { activity },
  }));
}
