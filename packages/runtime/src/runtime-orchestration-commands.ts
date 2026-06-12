import {
  ClientOrchestrationCommand,
  CommandId,
  EventId,
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

const isThreadTokenUsageSnapshot = Schema.is(ThreadTokenUsageSnapshot);

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

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function runtimeAssistantCompleteCommandId(
  tree: SessionTreeProjection,
  entry: SessionTreeEntry,
): CommandId {
  return CommandId.make(`runtime-assistant:${tree.threadId}:${tree.runtimeSessionId}:${entry.id}`);
}

export function runtimeToolActivityCommandId(
  event: AgentRuntimeEvent,
  activity: OrchestrationThreadActivity,
): CommandId {
  return CommandId.make(`runtime-tool:${event.threadId}:${event.runtimeSessionId}:${activity.id}`);
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
}): ClientOrchestrationCommand | null {
  if (
    input.entry.role !== "assistant" ||
    !input.entry.turnId ||
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
}): ClientOrchestrationCommand[] {
  const entryById = new Map(input.tree.entries.map((entry) => [entry.id, entry] as const));
  const commands: ClientOrchestrationCommand[] = [];
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

function runtimeToolItemTypeForName(toolName: string): ToolLifecycleItemType {
  switch (toolName) {
    case "bash":
    case "shell":
      return "command_execution";
    case "read":
      return "file_read";
    case "grep":
    case "find":
    case "ls":
      return "file_search";
    case "edit":
    case "write":
      return "file_change";
    case "subagent":
      return "collab_agent_tool_call";
    default:
      return "dynamic_tool_call";
  }
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
  const toolName = asTrimmedString(record.toolName) ?? "tool";
  const toolCallId = asTrimmedString(record.toolCallId) ?? event.id;
  const isError = record.isError === true;
  const summary = asTrimmedString(event.summary) ?? (isError ? "Tool failed" : "Tool completed");
  const detail = typeof event.summary === "string" ? event.summary : undefined;
  const subagentActivities = runtimeSubagentActivitiesForToolEvent(event);
  const subagentParentItem =
    toolName === "subagent"
      ? compactSubagentParentItem(record, isError ? "failed" : "completed")
      : null;
  const activity: OrchestrationThreadActivity = {
    id: EventId.make(`runtime-activity:${event.id}`),
    tone: isError ? ("error" as const) : ("tool" as const),
    kind: "tool.completed",
    summary,
    payload: {
      itemId: toolCallId,
      itemType: runtimeToolItemTypeForName(toolName),
      status: isError ? "error" : "completed",
      title: toolName,
      ...(detail !== undefined ? { detail } : {}),
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
): ClientOrchestrationCommand[] {
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
): ClientOrchestrationCommand[] {
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
