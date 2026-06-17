import {
  SessionMessageRole,
  type AgentRuntimeEvent,
  type AgentRuntimeEventType,
  type RuntimeSessionId,
  type ThreadId,
  type TurnId,
} from "@honk/contracts";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { AssistantMessageEvent, ToolCall } from "@earendil-works/pi-ai";
import { Schema } from "effect";
import {
  extractMessageText,
  extractMessageThinking,
  extractProviderFailureMessage,
  toUnknownRecord,
} from "./message-text";
import { makeRuntimeEventId } from "./ids";

const CURSOR_SYNTHETIC_TOOL_EVENT_ARG = "__honkCursorSyntheticToolEvent";
const CURSOR_SYNTHETIC_TOOL_RESULT_ARG = "__honkCursorResult";

export interface RuntimeEventProjectionContext {
  readonly threadId: ThreadId;
  readonly runtimeSessionId: RuntimeSessionId;
  readonly turnId?: TurnId;
  readonly sequence: number;
  readonly now?: Date;
}

interface CursorSyntheticToolEvent {
  readonly type: Extract<AgentRuntimeEventType, "tool.started" | "tool.completed">;
  readonly summary: string;
  readonly data: Record<string, unknown>;
}

function eventTypeForPiEvent(event: AgentSessionEvent): AgentRuntimeEventType {
  switch (event.type) {
    case "agent_start":
      return "agent.started";
    case "agent_end":
      return event.willRetry ? "session.state.changed" : "agent.completed";
    case "turn_start":
      return "turn.started";
    case "turn_end":
      return "turn.completed";
    case "message_start":
      return "message.started";
    case "message_update":
      return "message.updated";
    case "message_end":
      return "message.completed";
    case "tool_execution_start":
      return "tool.started";
    case "tool_execution_update":
      return "tool.updated";
    case "tool_execution_end":
      return "tool.completed";
    case "queue_update":
      return "queue.updated";
    case "thinking_level_changed":
      return "thinking.changed";
    case "session_info_changed":
      return "session.state.changed";
    case "compaction_start":
    case "compaction_end":
      return "tree.updated";
    case "auto_retry_start":
      return "runtime.warning";
    case "auto_retry_end":
      return event.success ? "session.state.changed" : "runtime.error";
    default:
      return "session.state.changed";
  }
}

function cursorSyntheticToolEvent(event: AgentSessionEvent): CursorSyntheticToolEvent | null {
  if (event.type !== "message_update") {
    return null;
  }
  const assistantMessageEvent = event.assistantMessageEvent;
  if (
    assistantMessageEvent.type !== "toolcall_start" &&
    assistantMessageEvent.type !== "toolcall_end"
  ) {
    return null;
  }
  const toolCall = toolCallFromAssistantMessageEvent(assistantMessageEvent);
  if (!toolCall || toolCall.arguments[CURSOR_SYNTHETIC_TOOL_EVENT_ARG] !== true) {
    return null;
  }

  const args = publicCursorToolArguments(toolCall.arguments);
  const rawResult = toolCall.arguments[CURSOR_SYNTHETIC_TOOL_RESULT_ARG];
  const isError = cursorToolResultIsError(rawResult);
  const type = assistantMessageEvent.type === "toolcall_start" ? "tool.started" : "tool.completed";
  return {
    type,
    summary: cursorToolSummary(type, toolCall.name, isError),
    data: {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      args,
      ...(type === "tool.completed" ? { result: cursorToolResult(rawResult), isError } : {}),
    },
  };
}

function toolCallFromAssistantMessageEvent(event: AssistantMessageEvent): ToolCall | null {
  if (event.type === "toolcall_end") {
    return event.toolCall;
  }
  if (event.type !== "toolcall_start") {
    return null;
  }
  const content = event.partial.content[event.contentIndex];
  return content?.type === "toolCall" ? content : null;
}

function publicCursorToolArguments(input: Record<string, unknown>): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === CURSOR_SYNTHETIC_TOOL_EVENT_ARG || key === CURSOR_SYNTHETIC_TOOL_RESULT_ARG) {
      continue;
    }
    args[key] = value;
  }
  return args;
}

function cursorToolSummary(
  type: CursorSyntheticToolEvent["type"],
  toolName: string,
  isError: boolean,
): string {
  if (toolName === "bash") {
    if (type === "tool.started") {
      return "Started command";
    }
    return isError ? "Command failed" : "Ran command";
  }
  if (type === "tool.started") {
    return `Started ${toolName}`;
  }
  return isError ? `${toolName} failed` : `Completed ${toolName}`;
}

function cursorToolResultIsError(result: unknown): boolean {
  const record = toUnknownRecord(result);
  return record?.status === "error";
}

function cursorToolResult(result: unknown): unknown {
  const record = toUnknownRecord(result);
  if (!record) {
    return result;
  }
  if (record.status === "success") {
    const value = toUnknownRecord(record.value);
    if (!value) {
      return result;
    }
    const stdout = typeof value.stdout === "string" ? value.stdout : "";
    const stderr = typeof value.stderr === "string" ? value.stderr : "";
    const output = [stdout, stderr].filter((text) => text.length > 0).join("\n");
    return {
      content: output.length > 0 ? [{ type: "text", text: output }] : [],
      details: {
        status: "success",
        ...(typeof value.exitCode === "number" ? { exitCode: value.exitCode } : {}),
        ...(typeof value.signal === "string" ? { signal: value.signal } : {}),
        ...(typeof value.executionTime === "number"
          ? { executionTime: value.executionTime }
          : {}),
      },
    };
  }
  if (record.status === "error") {
    return {
      content: [{ type: "text", text: cursorToolErrorText(record.error) }],
      details: { status: "error" },
    };
  }
  return result;
}

function cursorToolErrorText(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  const record = toUnknownRecord(error);
  if (typeof record?.message === "string") {
    return record.message;
  }
  return "Cursor tool failed";
}

function summarizePiEvent(event: AgentSessionEvent): string | undefined {
  switch (event.type) {
    case "queue_update":
      return `${event.steering.length} steering, ${event.followUp.length} follow-up`;
    case "tool_execution_start":
      return `Started ${event.toolName}`;
    case "tool_execution_update":
      return `Running ${event.toolName}`;
    case "tool_execution_end":
      return event.isError ? `${event.toolName} failed` : `Completed ${event.toolName}`;
    case "thinking_level_changed":
      return `Thinking ${event.level}`;
    case "session_info_changed":
      return event.name ? `Session named ${event.name}` : "Session name cleared";
    case "compaction_start":
      return `Compaction started: ${event.reason}`;
    case "compaction_end":
      return event.aborted
        ? `Compaction aborted: ${event.reason}`
        : `Compaction ended: ${event.reason}`;
    case "auto_retry_start":
      return event.errorMessage;
    case "auto_retry_end":
      return event.finalError;
    case "message_end":
      if ("message" in event) {
        const providerFailure = extractProviderFailureMessage(event.message);
        return providerFailure ?? undefined;
      }
      return undefined;
    default:
      return undefined;
  }
}

function textForPiEvent(event: AgentSessionEvent): string | undefined {
  if ("message" in event) {
    if (extractProviderFailureMessage(event.message)) {
      return undefined;
    }
    const text = extractMessageText(event.message);
    return text ? text : undefined;
  }
  return undefined;
}

function providerFailureForPiEvent(event: AgentSessionEvent): string | undefined {
  if (!("message" in event)) {
    return undefined;
  }
  const providerFailure = extractProviderFailureMessage(event.message);
  return providerFailure ?? undefined;
}

function dataForPiEvent(input: {
  readonly event: AgentSessionEvent;
  readonly syntheticToolEvent: CursorSyntheticToolEvent | null;
  readonly providerFailure: string | undefined;
}): Record<string, unknown> {
  if (input.syntheticToolEvent) {
    return input.syntheticToolEvent.data;
  }
  const data = toUnknownRecord(input.event);
  if (input.providerFailure) {
    return { ...data, providerFailure: input.providerFailure };
  }
  return data;
}

function thinkingForPiEvent(event: AgentSessionEvent): string | undefined {
  if ("message" in event) {
    const thinking = extractMessageThinking(event.message);
    return thinking ? thinking : undefined;
  }
  return undefined;
}

export function projectPiAgentSessionEvent(
  event: AgentSessionEvent,
  context: RuntimeEventProjectionContext,
): AgentRuntimeEvent {
  const syntheticToolEvent = cursorSyntheticToolEvent(event);
  const providerFailure = syntheticToolEvent ? undefined : providerFailureForPiEvent(event);
  const summary = syntheticToolEvent?.summary ?? summarizePiEvent(event);
  const text = syntheticToolEvent ? undefined : textForPiEvent(event);
  const thinking = syntheticToolEvent ? undefined : thinkingForPiEvent(event);
  const messageRole =
    !syntheticToolEvent && "message" in event && Schema.is(SessionMessageRole)(event.message.role)
      ? event.message.role
      : undefined;
  return {
    id: makeRuntimeEventId(context.sequence),
    type: syntheticToolEvent?.type ?? eventTypeForPiEvent(event),
    agentRuntime: "pi",
    threadId: context.threadId,
    runtimeSessionId: context.runtimeSessionId,
    ...(context.turnId ? { turnId: context.turnId } : {}),
    createdAt: (context.now ?? new Date()).toISOString(),
    ...(summary ? { summary } : {}),
    ...(messageRole ? { messageRole } : {}),
    ...(text ? { text } : {}),
    ...(thinking ? { thinking } : {}),
    data: dataForPiEvent({ event, syntheticToolEvent, providerFailure }),
  };
}
