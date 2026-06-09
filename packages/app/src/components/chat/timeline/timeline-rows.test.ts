import {
  EventId,
  MessageId,
  RuntimeItemId,
  RuntimeSessionId,
  ThreadEntryId,
  ThreadId,
  TurnId,
} from "@multi/contracts";
import { describe, expect, it } from "vitest";

import {
  computeStableMessagesTimelineRows,
  type MessagesTimelineRow,
  type StableMessagesTimelineRowsState,
} from "./timeline-rows";

const createdAt = "2026-06-05T20:30:00.000Z";
const turnId = TurnId.make("turn:runtime-row-stability");
const threadId = ThreadId.make("thread:runtime-row-stability");
const runtimeSessionId = RuntimeSessionId.make("runtime:runtime-row-stability");
const runtimeToolArgs = { command: "git status --short" };

function emptyState(): StableMessagesTimelineRowsState {
  return {
    byId: new Map(),
    result: [],
  };
}

describe("computeStableMessagesTimelineRows", () => {
  it("reuses synthetic runtime message rows when object identity changes without visible data changes", () => {
    const first = messageRow("message:synthetic-assistant", "Finished", true);
    const firstState = computeStableMessagesTimelineRows([first], emptyState());
    const second = messageRow("message:synthetic-assistant", "Finished", true);
    const secondState = computeStableMessagesTimelineRows([second], firstState);

    expect(secondState).toBe(firstState);
    expect(secondState.result[0]).toBe(first);
  });

  it("replaces synthetic runtime message rows when streamed text changes", () => {
    const firstState = computeStableMessagesTimelineRows(
      [messageRow("message:synthetic-assistant", "Fin", true)],
      emptyState(),
    );
    const updated = messageRow("message:synthetic-assistant", "Finished", true);
    const secondState = computeStableMessagesTimelineRows([updated], firstState);

    expect(secondState).not.toBe(firstState);
    expect(secondState.result[0]).toBe(updated);
  });

  it("reuses user message rows when only committed metadata changes", () => {
    const first = userMessageRow({
      completedAt: undefined,
      streaming: false,
      turnId: null,
    });
    const firstState = computeStableMessagesTimelineRows([first], emptyState());
    const committed = userMessageRow({
      completedAt: createdAt,
      streaming: false,
      turnId,
    });
    const secondState = computeStableMessagesTimelineRows([committed], firstState);

    expect(secondState).toBe(firstState);
    expect(secondState.result[0]).toBe(first);
  });

  it("reuses runtime tool rows when projection object identity changes without data changes", () => {
    const first = runtimeToolRow("completed");
    const firstState = computeStableMessagesTimelineRows([first], emptyState());
    const second = runtimeToolRow("completed");
    const secondState = computeStableMessagesTimelineRows([second], firstState);

    expect(firstState.result[0]).toBe(first);
    expect(secondState).toBe(firstState);
    expect(secondState.result[0]).toBe(first);
  });

  it("reuses runtime tool rows when only event lineage changes", () => {
    const first = runtimeToolRow("running", [EventId.make("runtime-event:tool-started")]);
    const firstState = computeStableMessagesTimelineRows([first], emptyState());
    const second = runtimeToolRow("running", [
      EventId.make("runtime-event:tool-started"),
      EventId.make("runtime-event:tool-updated"),
    ]);
    const secondState = computeStableMessagesTimelineRows([second], firstState);

    expect(secondState).toBe(firstState);
    expect(secondState.result[0]).toBe(first);
  });

  it("reuses runtime tool rows when raw payloads change without visible field changes", () => {
    const first = runtimeToolRow("running");
    const firstState = computeStableMessagesTimelineRows([first], emptyState());
    const baseSecond = runtimeToolRow("running") as Extract<
      MessagesTimelineRow,
      { kind: "runtime-tool" }
    >;
    const second = {
      ...baseSecond,
      tool: {
        ...baseSecond.tool,
        args: { command: "git status --short", cwd: "/tmp/updated" },
        details: { exitCode: null, observedAt: "2026-06-05T20:31:00.000Z" },
        result: { content: [{ type: "text", text: "clean" }] },
      },
    } satisfies Extract<MessagesTimelineRow, { kind: "runtime-tool" }>;
    const secondState = computeStableMessagesTimelineRows([second], firstState);

    expect(secondState).toBe(firstState);
    expect(secondState.result[0]).toBe(first);
  });

  it("reuses runtime tool rows when stale command fields change but typed display does not", () => {
    const first = runtimeToolRow("running");
    const firstState = computeStableMessagesTimelineRows([first], emptyState());
    const baseSecond = runtimeToolRow("running") as Extract<
      MessagesTimelineRow,
      { kind: "runtime-tool" }
    >;
    const second = {
      ...baseSecond,
      tool: {
        ...baseSecond.tool,
        command: "git diff --stat",
        output: "1 file changed",
      },
    } satisfies Extract<MessagesTimelineRow, { kind: "runtime-tool" }>;
    const secondState = computeStableMessagesTimelineRows([second], firstState);

    expect(secondState).toBe(firstState);
    expect(secondState.result[0]).toBe(first);
  });

  it("replaces runtime tool rows when typed display changes", () => {
    const firstState = computeStableMessagesTimelineRows([runtimeToolRow("running")], emptyState());
    const updated = runtimeToolRow("running") as Extract<
      MessagesTimelineRow,
      { kind: "runtime-tool" }
    >;
    const next = {
      ...updated,
      tool: {
        ...updated.tool,
        display: {
          kind: "shell",
          command: "git diff --stat",
          output: "1 file changed",
        },
      },
    } satisfies Extract<MessagesTimelineRow, { kind: "runtime-tool" }>;
    const secondState = computeStableMessagesTimelineRows([next], firstState);

    expect(secondState).not.toBe(firstState);
    expect(secondState.result[0]).toBe(next);
  });

  it("replaces runtime task rows when subagent run state changes", () => {
    const first = runtimeSubagentToolRow("running");
    const firstState = computeStableMessagesTimelineRows([first], emptyState());
    const completed = runtimeSubagentToolRow("completed");
    const secondState = computeStableMessagesTimelineRows([completed], firstState);

    expect(secondState).not.toBe(firstState);
    expect(secondState.result[0]).toBe(completed);
  });

  it("replaces runtime tool rows when typed status changes", () => {
    const firstState = computeStableMessagesTimelineRows([runtimeToolRow("running")], emptyState());
    const completed = runtimeToolRow("completed");
    const secondState = computeStableMessagesTimelineRows([completed], firstState);

    expect(secondState).not.toBe(firstState);
    expect(secondState.result[0]).toBe(completed);
  });

  it("reuses grouped runtime tool rows when visible grouped steps are unchanged", () => {
    const first = groupedRuntimeToolRow("running");
    const firstState = computeStableMessagesTimelineRows([first], emptyState());
    const second = groupedRuntimeToolRow("running");
    const secondState = computeStableMessagesTimelineRows([second], firstState);

    expect(secondState).toBe(firstState);
    expect(secondState.result[0]).toBe(first);
  });

  it("replaces grouped runtime tool rows when a grouped step changes", () => {
    const first = groupedRuntimeToolRow("running");
    const firstState = computeStableMessagesTimelineRows([first], emptyState());
    const completed = groupedRuntimeToolRow("completed");
    const secondState = computeStableMessagesTimelineRows([completed], firstState);

    expect(secondState).not.toBe(firstState);
    expect(secondState.result[0]).toBe(completed);
  });

  it("reuses runtime extension UI rows when copied option arrays contain the same values", () => {
    const first = runtimeExtensionUiRequestRow(["Yes", "No"]);
    const firstState = computeStableMessagesTimelineRows([first], emptyState());
    const second = runtimeExtensionUiRequestRow(["Yes", "No"]);
    const secondState = computeStableMessagesTimelineRows([second], firstState);

    expect(secondState).toBe(firstState);
    expect(secondState.result[0]).toBe(first);
  });

  it("reuses runtime extension UI rows when non-rendered values change", () => {
    const first = runtimeExtensionUiRequestRow(["Yes", "No"]);
    const firstState = computeStableMessagesTimelineRows([first], emptyState());
    const baseSecond = runtimeExtensionUiRequestRow(["Yes", "No"]) as Extract<
      MessagesTimelineRow,
      { kind: "runtime-extension-ui-request" }
    >;
    const second = {
      ...baseSecond,
      request: {
        ...baseSecond.request,
        options: ["Allow", "Deny"],
        value: { selected: "Allow" },
      },
    } satisfies Extract<MessagesTimelineRow, { kind: "runtime-extension-ui-request" }>;
    const secondState = computeStableMessagesTimelineRows([second], firstState);

    expect(secondState).toBe(firstState);
    expect(secondState.result[0]).toBe(first);
  });

  it("reuses runtime thinking rows when projection object identity changes without data changes", () => {
    const first = runtimeThinkingRow("Inspecting repo");
    const firstState = computeStableMessagesTimelineRows([first], emptyState());
    const second = runtimeThinkingRow("Inspecting repo");
    const secondState = computeStableMessagesTimelineRows([second], firstState);

    expect(secondState).toBe(firstState);
    expect(secondState.result[0]).toBe(first);
  });

  it("reuses runtime thinking rows when only event lineage changes", () => {
    const first = runtimeThinkingRow("Inspecting repo", [
      EventId.make("runtime-event:message-updated"),
    ]);
    const firstState = computeStableMessagesTimelineRows([first], emptyState());
    const second = runtimeThinkingRow("Inspecting repo", [
      EventId.make("runtime-event:message-updated"),
      EventId.make("runtime-event:message-completed"),
    ]);
    const secondState = computeStableMessagesTimelineRows([second], firstState);

    expect(secondState).toBe(firstState);
    expect(secondState.result[0]).toBe(first);
  });

  it("replaces runtime thinking rows when thinking text changes", () => {
    const firstState = computeStableMessagesTimelineRows(
      [runtimeThinkingRow("Inspecting repo")],
      emptyState(),
    );
    const updated = runtimeThinkingRow("Inspecting repo state");
    const secondState = computeStableMessagesTimelineRows([updated], firstState);

    expect(secondState).not.toBe(firstState);
    expect(secondState.result[0]).toBe(updated);
  });
});

function messageRow(id: string, text: string, streaming: boolean): MessagesTimelineRow {
  return {
    kind: "message",
    id,
    createdAt,
    message: {
      id: MessageId.make(id),
      role: "assistant",
      text,
      turnId,
      createdAt,
      completedAt: streaming ? undefined : createdAt,
      streaming,
    },
    durationStart: createdAt,
    editAvailable: false,
    pairId: null,
    messageIndex: 0,
  };
}

function userMessageRow(input: {
  completedAt: string | undefined;
  streaming: boolean;
  turnId: TurnId | null;
}): MessagesTimelineRow {
  return {
    kind: "message",
    id: "message:message:user-row-stability",
    createdAt,
    message: {
      id: MessageId.make("message:user-row-stability"),
      role: "user",
      text: "Commit & Push",
      turnId: input.turnId,
      createdAt,
      ...(input.completedAt !== undefined ? { completedAt: input.completedAt } : {}),
      streaming: input.streaming,
    },
    durationStart: createdAt,
    editAvailable: false,
    pairId: MessageId.make("message:user-row-stability"),
    messageIndex: 0,
  };
}

function runtimeToolRow(
  status: "running" | "completed" | "error",
  eventIds: EventId[] = [EventId.make("runtime-event:tool-started")],
): MessagesTimelineRow {
  return {
    kind: "runtime-tool",
    id: "tool:toolu-row-stability",
    createdAt,
    tool: {
      id: "tool:toolu-row-stability",
      kind: "tool",
      orderKey: `${createdAt}:tool:toolu-row-stability`,
      createdAt,
      toolCallId: "toolu-row-stability",
      toolName: "shell",
      turnId,
      status,
      eventIds,
      args: runtimeToolArgs,
      command: runtimeToolArgs.command,
      display: {
        kind: "shell",
        command: runtimeToolArgs.command,
        output: "clean",
      },
      argsComplete: true,
      executionStarted: true,
      isPartial: false,
      isError: status === "error",
      result: "clean",
      output: "clean",
      summary: "Completed shell",
    },
  };
}

function runtimeSubagentToolRow(
  state: "running" | "completed" | "failed" | "aborted",
): MessagesTimelineRow {
  return {
    kind: "runtime-task",
    id: "tool:toolu-subagent-row-stability",
    createdAt,
    tool: {
      id: "tool:toolu-subagent-row-stability",
      kind: "tool",
      orderKey: `${createdAt}:tool:toolu-subagent-row-stability`,
      createdAt,
      toolCallId: "toolu-subagent-row-stability",
      toolName: "subagent",
      turnId,
      status: state === "running" ? "running" : "completed",
      eventIds: [EventId.make("runtime-event:subagent-tool")],
      display: {
        kind: "subagent",
        mode: "single",
        agentScope: "project",
        projectAgentsDir: null,
        runs: [
          {
            subagentThreadId: "thread:child-row",
            agentId: "agent:child-row",
            nickname: "Research",
            role: "general-purpose",
            model: "gpt-5.5",
            prompt: "Inspect rows",
            state,
            finalText: state === "completed" ? "Done" : null,
            errorMessage: state === "failed" ? "Failed" : null,
          },
        ],
        activities: [],
      },
    },
  };
}

function groupedRuntimeToolRow(status: "running" | "completed"): MessagesTimelineRow {
  const toolStep = runtimeToolRow(status) as Extract<MessagesTimelineRow, { kind: "runtime-tool" }>;
  return {
    kind: "work",
    id: "tool:toolu-row-stability",
    createdAt,
    completedDurationLabel: status === "running" ? null : "briefly",
    isRunning: status === "running",
    isTailGroup: true,
    isThinkingGroup: false,
    isCommandGroup: true,
    isWaitingGroup: false,
    isBrowserGroup: false,
    summary: {
      action: status === "running" ? "Running" : "Ran",
      details: "1 command",
    },
    steps: [toolStep],
    groupedEntries: [],
    renderItem: {
      kind: "group",
      id: "tool:toolu-row-stability",
      createdAt,
      group: {
        id: "tool:toolu-row-stability",
        createdAt,
        completedDurationLabel: status === "running" ? null : "briefly",
        isRunning: status === "running",
        isTailGroup: true,
        isThinkingGroup: false,
        isCommandGroup: true,
        isWaitingGroup: false,
        isBrowserGroup: false,
        summary: {
          action: status === "running" ? "Running" : "Ran",
          details: "1 command",
        },
        steps: [toolStep],
        entries: [],
      },
    },
  };
}

function runtimeExtensionUiRequestRow(options: string[]): MessagesTimelineRow {
  return {
    kind: "runtime-extension-ui-request",
    id: "extension-ui:request-row-stability",
    createdAt,
    request: {
      id: "extension-ui:request-row-stability",
      kind: "extension-ui-request",
      orderKey: `${createdAt}:extension-ui:request-row-stability`,
      createdAt,
      requestId: "request-row-stability",
      requestKind: "select",
      status: "pending",
      threadId,
      runtimeSessionId,
      eventIds: [EventId.make("runtime-event:extension-ui-requested")],
      title: "Choose",
      message: "Pick one",
      options,
      turnId,
    },
  };
}

function runtimeThinkingRow(
  thinking: string,
  eventIds: EventId[] = [EventId.make("runtime-event:message-updated")],
): MessagesTimelineRow {
  return {
    kind: "runtime-thinking",
    id: `message:${turnId}:assistant:thinking`,
    createdAt,
    message: {
      id: `message:${turnId}:assistant`,
      kind: "message",
      source: "live-event",
      orderKey: `${createdAt}:message:${turnId}:assistant`,
      createdAt,
      role: "assistant",
      turnId,
      eventIds,
      streaming: true,
      thinking,
    },
  };
}
