import {
  CanonicalItemType,
  EventId,
  RuntimeItemId,
  TurnId,
  type AgentRuntimeEvent,
  type OrchestrationThreadActivity,
} from "@multi/contracts";
import { toJsonValue } from "@multi/shared/schema-json";

type RuntimeSubagentActivityKind = Extract<
  OrchestrationThreadActivity["kind"],
  | "subagent.thread.started"
  | "subagent.thread.state.changed"
  | "subagent.item.started"
  | "subagent.item.updated"
  | "subagent.item.completed"
  | "subagent.content.delta"
  | "subagent.usage.updated"
>;

type RuntimeSubagentContentStreamKind = Extract<
  OrchestrationThreadActivity,
  { kind: "subagent.content.delta" }
>["payload"]["streamKind"];

function isIndexableRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isIndexableRecord(value) ? value : null;
}

function asTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function asNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function asPositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function isRuntimeSubagentActivityKind(value: unknown): value is RuntimeSubagentActivityKind {
  switch (value) {
    case "subagent.thread.started":
    case "subagent.thread.state.changed":
    case "subagent.item.started":
    case "subagent.item.updated":
    case "subagent.item.completed":
    case "subagent.content.delta":
    case "subagent.usage.updated":
      return true;
    default:
      return false;
  }
}

function isRuntimeSubagentContentStreamKind(
  value: unknown,
): value is RuntimeSubagentContentStreamKind {
  switch (value) {
    case "assistant_text":
    case "reasoning_text":
    case "reasoning_summary_text":
    case "plan_text":
    case "command_output":
    case "file_change_output":
    case "unknown":
      return true;
    default:
      return false;
  }
}

function isCanonicalItemType(value: string): value is CanonicalItemType {
  switch (value) {
    case "user_message":
    case "assistant_message":
    case "reasoning":
    case "plan":
    case "command_execution":
    case "file_read":
    case "file_search":
    case "file_change":
    case "mcp_tool_call":
    case "dynamic_tool_call":
    case "collab_agent_tool_call":
    case "web_search":
    case "web_fetch":
    case "image_view":
    case "review_entered":
    case "review_exited":
    case "context_compaction":
    case "error":
    case "unknown":
      return true;
    default:
      return false;
  }
}

function normalizeRuntimeSubagentThreadState(
  value: unknown,
): "active" | "idle" | "archived" | "closed" | "compacted" | "error" | null {
  switch (value) {
    case "running":
    case "active":
      return "active";
    case "completed":
    case "idle":
      return "idle";
    case "failed":
    case "aborted":
    case "error":
      return "error";
    case "archived":
    case "closed":
    case "compacted":
      return value;
    default:
      return null;
  }
}

function compactRuntimeSubagentIdentityPayload(
  payload: Record<string, unknown> | null,
  parentTurnId: TurnId | undefined,
) {
  const subagentThreadId = asTrimmedString(payload?.subagentThreadId);
  if (!subagentThreadId) {
    return null;
  }
  const parentThreadId = asTrimmedString(payload?.parentThreadId);
  const parentItemId = asTrimmedString(payload?.parentItemId);
  const agentId = asTrimmedString(payload?.agentId);
  const nickname = asTrimmedString(payload?.nickname);
  const role = asTrimmedString(payload?.role);
  const model = asTrimmedString(payload?.model);
  const prompt = asTrimmedString(payload?.prompt);
  return {
    subagentThreadId,
    ...(parentThreadId ? { parentThreadId } : {}),
    ...(parentTurnId ? { parentTurnId } : {}),
    ...(parentItemId ? { parentItemId: RuntimeItemId.make(parentItemId) } : {}),
    ...(agentId ? { agentId } : {}),
    ...(nickname ? { nickname } : {}),
    ...(role ? { role } : {}),
    ...(model ? { model } : {}),
    ...(prompt ? { prompt } : {}),
  };
}

function compactRuntimeSubagentItemPayload(
  payload: Record<string, unknown> | null,
  parentTurnId: TurnId | undefined,
) {
  const identity = compactRuntimeSubagentIdentityPayload(payload, parentTurnId);
  if (!identity) {
    return null;
  }
  const itemType = asTrimmedString(payload?.itemType);
  const itemId = asTrimmedString(payload?.itemId);
  const status = asTrimmedString(payload?.status);
  const title = asTrimmedString(payload?.title);
  const detail = asTrimmedString(payload?.detail);
  const data = toJsonValue(payload?.data);
  return {
    ...identity,
    ...(itemType && isCanonicalItemType(itemType) ? { itemType } : {}),
    ...(itemId ? { itemId } : {}),
    ...(status ? { status } : {}),
    ...(title ? { title } : {}),
    ...(detail ? { detail } : {}),
    ...(data !== undefined && data !== null ? { data } : {}),
  };
}

function compactRuntimeSubagentContentDeltaPayload(
  payload: Record<string, unknown> | null,
  parentTurnId: TurnId | undefined,
) {
  const identity = compactRuntimeSubagentIdentityPayload(payload, parentTurnId);
  if (!identity) {
    return null;
  }
  const streamKind = payload?.streamKind;
  const delta = typeof payload?.delta === "string" ? payload.delta : null;
  const itemId = asTrimmedString(payload?.itemId);
  const contentIndex = asInteger(payload?.contentIndex);
  const summaryIndex = asInteger(payload?.summaryIndex);
  if (!isRuntimeSubagentContentStreamKind(streamKind) || delta === null) {
    return null;
  }
  return {
    ...identity,
    streamKind,
    delta,
    ...(itemId ? { itemId } : {}),
    ...(contentIndex !== null ? { contentIndex } : {}),
    ...(summaryIndex !== null ? { summaryIndex } : {}),
  };
}

function compactRuntimeSubagentUsagePayload(
  payload: Record<string, unknown> | null,
  parentTurnId: TurnId | undefined,
) {
  const identity = compactRuntimeSubagentIdentityPayload(payload, parentTurnId);
  if (!identity) {
    return null;
  }
  const usedTokens = asNonNegativeInteger(payload?.usedTokens);
  if (usedTokens === null) {
    return null;
  }
  const maxTokens = asPositiveInteger(payload?.maxTokens);
  return {
    ...identity,
    usedTokens,
    ...(maxTokens !== null ? { maxTokens } : {}),
  };
}

export function runtimeSubagentActivitiesForToolEvent(
  event: AgentRuntimeEvent,
): OrchestrationThreadActivity[] {
  const data = asRecord(event.data);
  if (data?.toolName !== "subagent") {
    return [];
  }
  const result = asRecord(event.type === "tool.completed" ? data.result : data?.partialResult);
  const details = asRecord(result?.details);
  const rawActivities = Array.isArray(details?.activities) ? details.activities : [];
  const turnId = event.turnId ? TurnId.make(event.turnId) : undefined;
  const activities: OrchestrationThreadActivity[] = [];

  for (const rawActivity of rawActivities) {
    const activity = asRecord(rawActivity);
    if (!activity) {
      continue;
    }
    const kind = activity?.kind;
    if (!isRuntimeSubagentActivityKind(kind)) {
      continue;
    }

    const id = EventId.make(asTrimmedString(activity.id) ?? `runtime-subagent:${event.id}`);
    const summary = asTrimmedString(activity.summary) ?? "Subagent update";
    const createdAt = asTrimmedString(activity.createdAt) ?? event.createdAt;
    const payload = asRecord(activity.payload);
    const sequence = asNonNegativeInteger(activity.sequence) ?? undefined;

    switch (kind) {
      case "subagent.thread.started": {
        const identity = compactRuntimeSubagentIdentityPayload(payload, turnId);
        if (!identity) {
          break;
        }
        activities.push({
          id,
          kind,
          tone: "info",
          summary,
          turnId: turnId ?? null,
          ...(sequence !== undefined ? { sequence } : {}),
          createdAt,
          payload: identity,
        });
        break;
      }
      case "subagent.thread.state.changed": {
        const identity = compactRuntimeSubagentIdentityPayload(payload, turnId);
        const state = normalizeRuntimeSubagentThreadState(payload?.state);
        if (!identity || !state) {
          break;
        }
        activities.push({
          id,
          kind,
          tone: state === "error" ? "error" : "info",
          summary,
          turnId: turnId ?? null,
          ...(sequence !== undefined ? { sequence } : {}),
          createdAt,
          payload: {
            ...identity,
            state,
            ...(payload?.detail !== undefined
              ? { detail: toJsonValue(payload.detail) ?? null }
              : {}),
          },
        });
        break;
      }
      case "subagent.item.started":
      case "subagent.item.updated":
      case "subagent.item.completed": {
        const itemPayload = compactRuntimeSubagentItemPayload(payload, turnId);
        if (!itemPayload) {
          break;
        }
        activities.push({
          id,
          kind,
          tone: "info",
          summary,
          turnId: turnId ?? null,
          ...(sequence !== undefined ? { sequence } : {}),
          createdAt,
          payload: itemPayload,
        });
        break;
      }
      case "subagent.content.delta": {
        const deltaPayload = compactRuntimeSubagentContentDeltaPayload(payload, turnId);
        if (!deltaPayload) {
          break;
        }
        activities.push({
          id,
          kind,
          tone: "info",
          summary,
          turnId: turnId ?? null,
          ...(sequence !== undefined ? { sequence } : {}),
          createdAt,
          payload: deltaPayload,
        });
        break;
      }
      case "subagent.usage.updated": {
        const usagePayload = compactRuntimeSubagentUsagePayload(payload, turnId);
        if (!usagePayload) {
          break;
        }
        activities.push({
          id,
          kind,
          tone: "info",
          summary,
          turnId: turnId ?? null,
          ...(sequence !== undefined ? { sequence } : {}),
          createdAt,
          payload: usagePayload,
        });
        break;
      }
    }
  }

  return activities;
}
