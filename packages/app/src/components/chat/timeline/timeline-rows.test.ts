import { EventId, MessageId, RuntimeSessionId, ThreadId, TurnId } from "@honk/contracts";
import { describe, expect, it } from "vitest";

import type { TimelineEntry, TimelineEntryId, WorkLogEntry } from "../../../session-logic";
import { timelineMessageEntryId } from "../view/timeline-entry-ids";
import {
  computeStableMessagesTimelineRows,
  deriveMessagesTimelineRows,
  type MessagesTimelineRow,
  type StableMessagesTimelineRowsState,
} from "./timeline-rows";

const createdAt = "2026-06-05T20:30:00.000Z";
const turnId = TurnId.make("turn:runtime-row-stability");
const threadId = ThreadId.make("thread:runtime-row-stability");
const runtimeSessionId = RuntimeSessionId.make("runtime:runtime-row-stability");
const runtimeToolArgs = { command: "git status --short" };

function rowId(value: string): TimelineEntryId {
  return value as TimelineEntryId;
}

describe("deriveMessagesTimelineRows", () => {
  it("fails loudly when projected timeline entries produce duplicate row ids", () => {
    const messageId = MessageId.make("message:duplicate-row-id");
    const entries: TimelineEntry[] = [
      messageEntry(messageId, "First"),
      messageEntry(messageId, "Second"),
    ];

    expect(() =>
      deriveMessagesTimelineRows({
        timelineEntries: entries,
        isTurnActive: false,
        editableUserMessageIds: new Set(),
      }),
    ).toThrow("Duplicate timeline render item id: message:message:duplicate-row-id");
  });

  it("fails loudly when grouped timeline steps produce duplicate ids", () => {
    const duplicateId = rowId("work:duplicate-grouped-step");
    const entries: TimelineEntry[] = [
      workTimelineEntry(duplicateId, "git status"),
      workTimelineEntry(duplicateId, "git diff"),
    ];

    expect(() =>
      deriveMessagesTimelineRows({
        timelineEntries: entries,
        isTurnActive: true,
        editableUserMessageIds: new Set(),
        conversationDensity: "compact-all-grouped",
      }),
    ).toThrow("Duplicate grouped timeline step id: work:duplicate-grouped-step");
  });
});

function emptyState(): StableMessagesTimelineRowsState {
  return {
    byId: new Map(),
    result: [],
  };
}

function messageEntry(messageId: MessageId, text: string): TimelineEntry {
  return {
    kind: "message",
    id: timelineMessageEntryId(messageId),
    createdAt,
    message: {
      id: messageId,
      role: "assistant",
      text,
      turnId,
      createdAt,
      completedAt: createdAt,
      streaming: false,
    },
  };
}

function workTimelineEntry(id: TimelineEntryId, command: string): TimelineEntry {
  return {
    kind: "work",
    id,
    createdAt,
    entry: {
      id,
      createdAt,
      label: "Running command",
      tone: "tool",
      status: "running",
      requestKind: "command",
      command,
    },
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
          kind: "bash",
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

  it("replaces a grouped work row when the next projection has a single work row with the same id", () => {
    const first = groupedRuntimeToolRow("running");
    const firstState = computeStableMessagesTimelineRows([first], emptyState());
    const single = singleWorkRow(first.id);
    const secondState = computeStableMessagesTimelineRows([single], firstState);

    expect(secondState).not.toBe(firstState);
    expect(secondState.result[0]).toBe(single);
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

  it("preserves unchanged grouped step references when only one step in a work row changes", () => {
    const first = groupedWorkRowWithSteps([
      runtimeToolStep("toolu-step-a", "completed", "clean"),
      runtimeToolStep("toolu-step-b", "running", "partial"),
    ]);
    const firstState = computeStableMessagesTimelineRows([first], emptyState());

    const second = groupedWorkRowWithSteps([
      runtimeToolStep("toolu-step-a", "completed", "clean"),
      runtimeToolStep("toolu-step-b", "completed", "done"),
    ]);
    const secondState = computeStableMessagesTimelineRows([second], firstState);

    const firstRow = firstState.result[0] as Extract<MessagesTimelineRow, { kind: "work" }> & {
      steps: unknown[];
    };
    const secondRow = secondState.result[0] as Extract<MessagesTimelineRow, { kind: "work" }> & {
      steps: unknown[];
    };

    // The row itself changes (one child updated), but the unchanged child keeps its reference so
    // the compiler-memoized step renderer can bail out instead of re-rendering the whole group.
    expect(secondState).not.toBe(firstState);
    expect(secondRow).not.toBe(firstRow);
    expect(secondRow.steps[0]).toBe(firstRow.steps[0]);
    expect(secondRow.steps[1]).not.toBe(firstRow.steps[1]);
  });
});

function runtimeToolStep(
  toolCallId: string,
  status: "running" | "completed" | "error",
  output: string,
) {
  const base = runtimeToolRow(status) as Extract<MessagesTimelineRow, { kind: "runtime-tool" }>;
  return {
    ...base,
    id: rowId(`tool:${toolCallId}`),
    tool: {
      ...base.tool,
      id: `tool:${toolCallId}`,
      toolCallId,
      status,
      isError: status === "error",
      output,
      result: output,
      display: {
        kind: "bash" as const,
        command: runtimeToolArgs.command,
        output,
      },
    },
  } satisfies Extract<MessagesTimelineRow, { kind: "runtime-tool" }>;
}

function groupedWorkRowWithSteps(
  steps: Array<Extract<MessagesTimelineRow, { kind: "runtime-tool" }>>,
): Extract<MessagesTimelineRow, { kind: "work" }> {
  const id = rowId("work:multi-step-group");
  return {
    kind: "work",
    id,
    createdAt,
    completedDurationLabel: null,
    isRunning: true,
    isTailGroup: true,
    isThinkingGroup: false,
    isCommandGroup: true,
    isWaitingGroup: false,
    isBrowserGroup: false,
    summary: {
      action: "Running",
      details: `${steps.length} commands`,
    },
    steps,
    groupedEntries: [],
    renderItem: {
      kind: "group",
      id,
      createdAt,
      group: {
        id,
        createdAt,
        completedDurationLabel: null,
        isRunning: true,
        isTailGroup: true,
        isThinkingGroup: false,
        isCommandGroup: true,
        isWaitingGroup: false,
        isBrowserGroup: false,
        summary: {
          action: "Running",
          details: `${steps.length} commands`,
        },
        steps,
        entries: [],
      },
    },
  };
}

function messageRow(id: string, text: string, streaming: boolean): MessagesTimelineRow {
  return {
    kind: "message",
    id: rowId(id),
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
    id: rowId("message:message:user-row-stability"),
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
    id: rowId("tool:toolu-row-stability"),
    createdAt,
    tool: {
      id: "tool:toolu-row-stability",
      kind: "tool",
      orderKey: `${createdAt}:tool:toolu-row-stability`,
      createdAt,
      toolCallId: "toolu-row-stability",
      toolName: "bash",
      turnId,
      status,
      eventIds,
      args: runtimeToolArgs,
      command: runtimeToolArgs.command,
      display: {
        kind: "bash",
        command: runtimeToolArgs.command,
        output: "clean",
      },
      argsComplete: true,
      executionStarted: true,
      isPartial: false,
      isError: status === "error",
      result: "clean",
      output: "clean",
      summary: "Completed bash",
    },
  };
}

function runtimeSubagentToolRow(
  state: "running" | "completed" | "failed" | "aborted",
): MessagesTimelineRow {
  return {
    kind: "runtime-task",
    id: rowId("tool:toolu-subagent-row-stability"),
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
    id: rowId("tool:toolu-row-stability"),
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
      id: rowId("tool:toolu-row-stability"),
      createdAt,
      group: {
        id: rowId("tool:toolu-row-stability"),
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

function singleWorkRow(id: string): MessagesTimelineRow {
  const entry: WorkLogEntry = {
    id,
    createdAt,
    label: "Reading files",
    tone: "tool",
    status: "running",
  };
  return {
    kind: "work",
    id: rowId(id),
    createdAt,
    entry,
  };
}

function runtimeExtensionUiRequestRow(options: string[]): MessagesTimelineRow {
  return {
    kind: "runtime-extension-ui-request",
    id: rowId("extension-ui:request-row-stability"),
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
    id: rowId(`message:${turnId}:assistant:thinking`),
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
