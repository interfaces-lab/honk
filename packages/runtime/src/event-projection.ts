import type {
  AgentRuntimeEvent,
  AgentRuntimeEventType,
  RuntimeSessionId,
  ThreadId,
  TurnId,
} from "@multi/contracts";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { extractMessageText, extractMessageThinking, toUnknownRecord } from "./message-text";
import { makeRuntimeEventId } from "./ids";

export interface RuntimeEventProjectionContext {
  readonly threadId: ThreadId;
  readonly runtimeSessionId: RuntimeSessionId;
  readonly turnId?: TurnId;
  readonly sequence: number;
  readonly now?: Date;
}

function eventTypeForPiEvent(event: AgentSessionEvent): AgentRuntimeEventType {
  switch (event.type) {
    case "agent_start":
      return "agent.started";
    case "agent_end":
      return "agent.completed";
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
      return "runtime.error";
    default:
      return "session.state.changed";
  }
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
      return event.aborted ? `Compaction aborted: ${event.reason}` : `Compaction ended: ${event.reason}`;
    case "auto_retry_start":
      return event.errorMessage;
    case "auto_retry_end":
      return event.finalError;
    default:
      return undefined;
  }
}

function textForPiEvent(event: AgentSessionEvent): string | undefined {
  if ("message" in event) {
    const text = extractMessageText(event.message);
    return text ? text : undefined;
  }
  return undefined;
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
  const summary = summarizePiEvent(event);
  const text = textForPiEvent(event);
  const thinking = thinkingForPiEvent(event);
  return {
    id: makeRuntimeEventId(context.sequence),
    type: eventTypeForPiEvent(event),
    agentRuntime: "pi",
    threadId: context.threadId,
    runtimeSessionId: context.runtimeSessionId,
    ...(context.turnId ? { turnId: context.turnId } : {}),
    createdAt: (context.now ?? new Date()).toISOString(),
    ...(summary ? { summary } : {}),
    ...(text ? { text } : {}),
    ...(thinking ? { thinking } : {}),
    data: toUnknownRecord(event),
    raw: event,
  };
}
