import type { OpenCodeServerKey } from "@honk/opencode";

import type { AppChildSessionSummary } from "../open-code-view";
import type { ThreadPart, ToolPart } from "./transcript-model";

export type TaskPresentationState = "running" | "done" | "failed";

export type TaskChildLink = {
  readonly partID: string;
  readonly child: AppChildSessionSummary;
  readonly ownsLiveState: boolean;
  readonly state: TaskPresentationState;
};

export function taskToolControlID(partID: string): string {
  return `task-tool-control:${partID}`;
}

export function taskToolRegionID(partID: string): string {
  return `task-tool-region:${partID}`;
}

function stringField(value: Readonly<Record<string, unknown>>, key: string): string | null {
  const field = value[key];
  return typeof field === "string" && field.length > 0 ? field : null;
}

function taskSessionID(part: ToolPart): string | null {
  if (part.tool !== "task") return null;
  const metadata = part.state.status === "pending" ? undefined : part.state.metadata;
  return (
    (metadata === undefined ? null : stringField(metadata, "sessionId")) ??
    (metadata === undefined ? null : stringField(metadata, "sessionID")) ??
    stringField(part.metadata ?? {}, "sessionId") ??
    stringField(part.metadata ?? {}, "sessionID") ??
    stringField(part.state.input, "task_id")
  );
}

function taskAgent(part: ToolPart): string | null {
  return part.tool === "task" ? stringField(part.state.input, "subagent_type") : null;
}

export function resolveTaskChildSession(input: {
  readonly part: ToolPart;
  readonly children: readonly AppChildSessionSummary[];
  readonly parentSessionID: string;
  readonly server: OpenCodeServerKey;
}): AppChildSessionSummary | null {
  if (input.part.tool !== "task") return null;
  const children = input.children.filter(
    (child) => child.server === input.server && child.parentSessionId === input.parentSessionID,
  );
  const sessionID = taskSessionID(input.part);
  if (sessionID !== null) {
    return children.find((child) => child.id === sessionID) ?? null;
  }

  const agent = taskAgent(input.part);
  if (agent === null) return null;
  const candidates = children.filter((child) => child.agent === agent);
  return candidates.length === 1 ? (candidates[0] ?? null) : null;
}

export function projectTaskChildLinks(input: {
  readonly parts: readonly ThreadPart[];
  readonly children: readonly AppChildSessionSummary[];
  readonly parentSessionID: string;
  readonly server: OpenCodeServerKey;
}): readonly TaskChildLink[] {
  const resolved = input.parts.flatMap((part) => {
    if (part.type !== "tool" || part.tool !== "task") return [];
    const child = resolveTaskChildSession({
      part,
      children: input.children,
      parentSessionID: input.parentSessionID,
      server: input.server,
    });
    return child === null
      ? []
      : [{ part, child, childKey: JSON.stringify([child.server, child.id]) }];
  });
  const lastIndexByChild = new Map(resolved.map((link, index) => [link.childKey, index] as const));

  return resolved.map((link, index) => {
    const ownsLiveState = lastIndexByChild.get(link.childKey) === index;
    return {
      partID: link.part.id,
      child: link.child,
      ownsLiveState,
      state: taskPresentationState(link.part, link.child, ownsLiveState),
    };
  });
}

function taskPresentationState(
  part: ToolPart,
  child: AppChildSessionSummary,
  ownsLiveState: boolean,
): TaskPresentationState {
  if (part.state.status === "error") return "failed";
  if (part.state.status === "pending" || part.state.status === "running") return "running";
  if (ownsLiveState && child.status === "failed") return "failed";
  if (ownsLiveState && child.status === "running") return "running";
  return "done";
}

export { taskAgent, taskSessionID };
