import type { AgentRuntimeEvent } from "@honk/contracts";

import { asNonArrayRecord } from "./runtime-record";

const WIRE_DATA_EVENT_TYPES = new Set<AgentRuntimeEvent["type"]>([
  "context-window.updated",
  "turn.started",
  "turn.completed",
  "turn.proposed.completed",
]);

function shouldKeepRuntimeEventData(event: AgentRuntimeEvent): boolean {
  if (WIRE_DATA_EVENT_TYPES.has(event.type)) {
    return true;
  }
  if (event.type !== "tool.updated" && event.type !== "tool.completed") {
    return false;
  }
  return asNonArrayRecord(event.data)?.toolName === "subagent";
}

export function toWireRuntimeEvent(event: AgentRuntimeEvent): AgentRuntimeEvent {
  if (shouldKeepRuntimeEventData(event)) {
    return event;
  }
  const { data: _data, ...wireEvent } = event;
  return wireEvent;
}
