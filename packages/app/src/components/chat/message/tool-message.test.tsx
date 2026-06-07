import { EnvironmentId, ThreadId, type RuntimeDisplayTimelineToolItem } from "@multi/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { WorkLogEntry } from "../../../session-logic";
import {
  RuntimeToolCallMessage,
  ToolCallMessage,
  runtimeToolItemToSubagents,
} from "./tool-message";
import { ToolCallRenderer } from "./tool-renderer";

const createdAt = "2026-06-03T21:13:00.000Z";

function renderWorkEntry(workEntry: WorkLogEntry): string {
  return renderToStaticMarkup(
    <ToolCallMessage
      workEntry={workEntry}
      projectRoot="/Users/workgyver/Developer/multi"
      activeThreadId={ThreadId.make("thread:thinking-markdown")}
      environmentId={EnvironmentId.make("environment:thinking-markdown")}
    />,
  );
}

function renderRuntimeTool(tool: RuntimeDisplayTimelineToolItem): string {
  return renderToStaticMarkup(<RuntimeToolCallMessage tool={tool} />);
}

function renderRuntimeToolWithContext(tool: RuntimeDisplayTimelineToolItem): string {
  return renderToStaticMarkup(
    <RuntimeToolCallMessage
      tool={tool}
      projectRoot="/Users/workgyver/Developer/multi"
      activeThreadId={ThreadId.make("thread:runtime-tool-context")}
      environmentId={EnvironmentId.make("environment:runtime-tool-context")}
    />,
  );
}

function renderShellRendererWithoutCommand(): string {
  return renderToStaticMarkup(
    <ToolCallRenderer
      toolCall={{
        tool: {
          case: "shellToolCall",
          value: {
            action: "Ran",
            details: "M AGENTS.md M packages/app/src/session-logic.ts",
            output: "M AGENTS.md",
          },
        },
      }}
      loading={false}
    />,
  );
}

describe("ToolCallMessage thinking entries", () => {
  it("renders thought detail as markdown instead of a truncated status label", () => {
    const html = renderWorkEntry({
      id: "thought:1",
      createdAt,
      label: "Thinking",
      detail: "**Considering package inspection** I need to inspect the package.",
      tone: "thinking",
      status: "completed",
    });

    expect(html).toContain("data-thinking-markdown");
    expect(html).toContain("<strong");
    expect(html).toContain("Considering package inspection");
    expect(html).not.toContain("Thought -");
  });
});

describe("ToolCallMessage command entries", () => {
  it("does not use shell details as a command fallback", () => {
    const html = renderShellRendererWithoutCommand();

    expect(html).toContain("Ran");
    expect(html).not.toContain("M AGENTS.md");
    expect(html).not.toContain("packages/app/src/session-logic.ts");
  });

  it("does not render command output as the collapsed Ran detail", () => {
    const html = renderWorkEntry({
      id: "command:output-only",
      createdAt,
      label: "Ran command",
      detail: "M AGENTS.md M packages/app/src/session-logic.ts",
      tone: "tool",
      status: "completed",
      itemType: "command_execution",
      artifacts: [
        {
          type: "command",
          exitCode: 0,
        },
      ],
    });

    expect(html).toContain("Ran");
    expect(html).not.toContain("M AGENTS.md");
    expect(html).not.toContain("packages/app/src/session-logic.ts");
  });

  it("renders typed commands as the collapsed Ran detail", () => {
    const html = renderWorkEntry({
      id: "command:typed",
      createdAt,
      label: "Ran command",
      command: "git status --short",
      output: "M AGENTS.md",
      tone: "tool",
      status: "completed",
      itemType: "command_execution",
      artifacts: [
        {
          type: "command",
          command: "git status --short",
          output: "M AGENTS.md",
          exitCode: 0,
        },
      ],
    });

    expect(html).toContain("Ran");
    expect(html).toContain("git status --short");
    expect(html).not.toContain("M AGENTS.md");
  });
});

describe("RuntimeToolCallMessage command entries", () => {
  it("does not render runtime output as the collapsed Ran detail", () => {
    const html = renderRuntimeTool({
      id: "tool:output-only",
      kind: "tool",
      orderKey: `${createdAt}:tool:output-only`,
      createdAt,
      toolCallId: "toolu-output-only",
      toolName: "shell",
      status: "completed",
      eventIds: [],
      details: "M AGENTS.md M packages/app/src/session-logic.ts",
      result: { content: [{ type: "text", text: "M AGENTS.md" }] },
      output: "M AGENTS.md",
      summary: "Completed shell",
      display: {
        kind: "unknown",
        toolName: "shell",
        output: "M AGENTS.md",
      },
    });

    expect(html).toContain("Ran");
    expect(html).toContain("shell");
    expect(html).not.toContain("M AGENTS.md");
    expect(html).not.toContain("packages/app/src/session-logic.ts");
  });

  it("renders runtime typed commands as the collapsed Ran detail", () => {
    const html = renderRuntimeTool({
      id: "tool:typed-command",
      kind: "tool",
      orderKey: `${createdAt}:tool:typed-command`,
      createdAt,
      toolCallId: "toolu-typed-command",
      toolName: "shell",
      status: "completed",
      eventIds: [],
      args: { command: "git status --short" },
      command: "git status --short",
      result: { content: [{ type: "text", text: "M AGENTS.md" }] },
      output: "M AGENTS.md",
      summary: "Completed shell",
      display: {
        kind: "shell",
        command: "git status --short",
        output: "M AGENTS.md",
      },
    });

    expect(html).toContain("Ran");
    expect(html).toContain("git status --short");
    expect(html).not.toContain("M AGENTS.md");
  });

  it("renders runtime read display as a typed read row", () => {
    const html = renderRuntimeTool({
      id: "tool:read-file",
      kind: "tool",
      orderKey: `${createdAt}:tool:read-file`,
      createdAt,
      toolCallId: "toolu-read-file",
      toolName: "read_file",
      status: "completed",
      eventIds: [],
      display: {
        kind: "read",
        path: "packages/app/src/components/chat/message/tool-message.tsx",
        output: "export function RuntimeToolCallMessage() {}",
      },
    });

    expect(html).toContain("Read");
    expect(html).toContain("packages/app/src/components/chat/message/tool-message.tsx");
    expect(html).not.toContain("Ran");
  });

  it("renders runtime grep display as a typed grep row", () => {
    const html = renderRuntimeTool({
      id: "tool:grep",
      kind: "tool",
      orderKey: `${createdAt}:tool:grep`,
      createdAt,
      toolCallId: "toolu-grep",
      toolName: "grep",
      status: "completed",
      eventIds: [],
      display: {
        kind: "grep",
        query: "RuntimeToolCallMessage",
        path: "packages/app/src",
        output: "tool-message.tsx: RuntimeToolCallMessage",
        matchedFiles: ["packages/app/src/components/chat/message/tool-message.tsx"],
      },
    });

    expect(html).toContain("Grepped");
    expect(html).toContain("RuntimeToolCallMessage");
    expect(html).not.toContain("Ran");
  });

  it("renders runtime edit display as a typed edit row", () => {
    const html = renderRuntimeTool({
      id: "tool:edit",
      kind: "tool",
      orderKey: `${createdAt}:tool:edit`,
      createdAt,
      toolCallId: "toolu-edit",
      toolName: "edit",
      status: "completed",
      eventIds: [],
      display: {
        kind: "edit",
        path: "packages/app/src/components/chat/message/tool-message.tsx",
        output: "Updated tool renderer",
        additions: 4,
        deletions: 1,
      },
    });

    expect(html).toContain("Edited");
    expect(html).toContain("packages/app/src/components/chat/message/tool-message.tsx");
    expect(html).not.toContain("Ran");
  });

  it("renders runtime MCP display with MCP action text", () => {
    const html = renderRuntimeTool({
      id: "tool:mcp",
      kind: "tool",
      orderKey: `${createdAt}:tool:mcp`,
      createdAt,
      toolCallId: "toolu-mcp",
      toolName: "mcp__github__get_issue",
      status: "completed",
      eventIds: [],
      display: {
        kind: "mcp",
        providerIdentifier: "github",
      },
    });

    expect(html).toContain("Ran MCP");
    expect(html).toContain("github");
  });

  it("renders runtime subagent display through the subagent status surface", () => {
    const tool = runtimeSubagentTool();
    const html = renderRuntimeToolWithContext(tool);

    expect(html).toContain("data-task-tool-call");
    expect(html).toContain("data-task-tool-call-header");
    expect(html).toContain("data-tool-call-line");
    expect(html).toContain("data-task-tool-call-body");
    expect(html).toContain("data-task-tool-call-subtitle");
    expect(html).toContain("aria-expanded=\"true\"");
    expect(html).toContain("data-subagent-status-container");
    expect(html).toContain("data-subagent-status-embedded");
    expect(html).toContain("data-subagent-row");
    expect(html).toContain("Research");
    expect(html).toContain("gpt-5.5");
    expect(html).toContain("Renderer reviewed");
    expect(html).toContain("Task");
    expect(html).toContain("Inspect the renderer");
    expect(html).not.toContain("Ran");
  });

  it("renders runtime subagent display as a task row without tray context", () => {
    const html = renderRuntimeTool(runtimeSubagentTool());

    expect(html).toContain("Task");
    expect(html).toContain("Inspect the renderer");
    expect(html).not.toContain("data-subagent-status-container");
    expect(html).not.toContain("Ran");
  });

  it("does not duplicate the subagent prompt as a transcript user bubble", () => {
    const subagents = runtimeToolItemToSubagents(runtimeSubagentToolWithTranscript());

    expect(subagents).toHaveLength(1);
    expect(subagents[0]?.transcriptItems).toEqual([
      expect.objectContaining({
        itemId: "item:assistant",
        kind: "message",
        role: "assistant",
        text: "Renderer reviewed",
      }),
    ]);
  });

  it("does not duplicate formatted variants of the subagent prompt", () => {
    const tool = runtimeSubagentToolWithTranscript();
    const display = tool.display;
    if (display?.kind !== "subagent") {
      throw new Error("expected subagent display");
    }
    const subagents = runtimeToolItemToSubagents({
      ...tool,
      display: {
        ...display,
        activities: display.activities.map((activity) =>
          activity.payload.itemType === "user_message"
            ? {
                ...activity,
                payload: {
                  ...activity.payload,
                  detail: "Inspect\n\n  the renderer",
                },
              }
            : activity,
        ),
      },
    });

    expect(subagents[0]?.transcriptItems).toEqual([
      expect.objectContaining({
        itemId: "item:assistant",
        kind: "message",
        role: "assistant",
        text: "Renderer reviewed",
      }),
    ]);
  });

  it("bounds runtime subagent transcript mapping to recent activities", () => {
    const subagents = runtimeToolItemToSubagents(runtimeSubagentToolWithManyActivities());
    const transcriptItems = subagents[0]?.transcriptItems ?? [];

    expect(transcriptItems).toHaveLength(80);
    expect(transcriptItems[0]).toEqual(
      expect.objectContaining({
        itemId: "item:21",
        text: "Assistant update 21",
      }),
    );
    expect(transcriptItems.at(-1)).toEqual(
      expect.objectContaining({
        itemId: "item:100",
        text: "Assistant update 100",
      }),
    );
  });

  it("bounds runtime subagent transcript mapping per subagent", () => {
    const subagents = runtimeToolItemToSubagents(runtimeSubagentToolWithParallelActivities());
    const firstTranscriptItems = subagents[0]?.transcriptItems ?? [];
    const secondTranscriptItems = subagents[1]?.transcriptItems ?? [];

    expect(firstTranscriptItems).toHaveLength(80);
    expect(secondTranscriptItems).toHaveLength(80);
    expect(firstTranscriptItems[0]).toEqual(
      expect.objectContaining({
        itemId: "item:child-a:21",
        text: "Child A update 21",
      }),
    );
    expect(firstTranscriptItems.at(-1)).toEqual(
      expect.objectContaining({
        itemId: "item:child-a:100",
        text: "Child A update 100",
      }),
    );
    expect(secondTranscriptItems[0]).toEqual(
      expect.objectContaining({
        itemId: "item:child-b:21",
        text: "Child B update 21",
      }),
    );
    expect(secondTranscriptItems.at(-1)).toEqual(
      expect.objectContaining({
        itemId: "item:child-b:100",
        text: "Child B update 100",
      }),
    );
  });
});

function runtimeSubagentTool(): RuntimeDisplayTimelineToolItem {
  return {
    id: "tool:subagent",
    kind: "tool",
    orderKey: `${createdAt}:tool:subagent`,
    createdAt,
    toolCallId: "toolu-subagent",
    toolName: "subagent",
    status: "completed",
    eventIds: [],
    display: {
      kind: "subagent",
      mode: "single",
      agentScope: "project",
      projectAgentsDir: null,
      runs: [
        {
          subagentThreadId: "thread:child",
          agentId: "agent:child",
          nickname: "Research",
          role: "general-purpose",
          model: "gpt-5.5",
          prompt: "Inspect the renderer",
          state: "completed",
          finalText: "Renderer reviewed",
          errorMessage: null,
        },
      ],
      activities: [
        {
          id: "runtime-subagent:toolu-subagent:thread:child:1",
          kind: "subagent.thread.started",
          tone: "info",
          summary: "Started Research",
          createdAt,
          sequence: 1,
          payload: {
            subagentThreadId: "thread:child",
            parentThreadId: "thread:runtime-tool-context",
            parentItemId: "toolu-subagent",
            agentId: "agent:child",
            nickname: "Research",
            role: "general-purpose",
            model: "gpt-5.5",
            prompt: "Inspect the renderer",
            state: "running",
            itemType: null,
            itemId: null,
            status: null,
            title: "Research",
            detail: null,
            data: null,
          },
        },
      ],
    },
  };
}

function runtimeSubagentToolWithTranscript(): RuntimeDisplayTimelineToolItem {
  return {
    ...runtimeSubagentTool(),
    display: {
      kind: "subagent",
      mode: "single",
      agentScope: "project",
      projectAgentsDir: null,
      runs: [
        {
          subagentThreadId: "thread:child",
          agentId: "agent:child",
          nickname: "Research",
          role: "general-purpose",
          model: "gpt-5.5",
          prompt: "Inspect the renderer",
          state: "completed",
          finalText: "Renderer reviewed",
          errorMessage: null,
        },
      ],
      activities: [
        {
          id: "runtime-subagent:toolu-subagent:thread:child:user",
          kind: "subagent.item.completed",
          tone: "info",
          summary: "User message",
          createdAt,
          sequence: 1,
          payload: {
            subagentThreadId: "thread:child",
            parentThreadId: "thread:runtime-tool-context",
            parentItemId: "toolu-subagent",
            agentId: "agent:child",
            nickname: "Research",
            role: "general-purpose",
            model: "gpt-5.5",
            prompt: "Inspect the renderer",
            state: "completed",
            itemType: "user_message",
            itemId: "item:user",
            status: "completed",
            title: "User message",
            detail: "Inspect the renderer",
            data: null,
          },
        },
        {
          id: "runtime-subagent:toolu-subagent:thread:child:assistant",
          kind: "subagent.item.completed",
          tone: "info",
          summary: "Assistant message",
          createdAt,
          sequence: 2,
          payload: {
            subagentThreadId: "thread:child",
            parentThreadId: "thread:runtime-tool-context",
            parentItemId: "toolu-subagent",
            agentId: "agent:child",
            nickname: "Research",
            role: "general-purpose",
            model: "gpt-5.5",
            prompt: "Inspect the renderer",
            state: "completed",
            itemType: "assistant_message",
            itemId: "item:assistant",
            status: "completed",
            title: "Assistant message",
            detail: "Renderer reviewed",
            data: null,
          },
        },
      ],
    },
  };
}

function runtimeSubagentToolWithManyActivities(): RuntimeDisplayTimelineToolItem {
  return {
    ...runtimeSubagentTool(),
    display: {
      kind: "subagent",
      mode: "single",
      agentScope: "project",
      projectAgentsDir: null,
      runs: [
        {
          subagentThreadId: "thread:child",
          agentId: "agent:child",
          nickname: "Research",
          role: "general-purpose",
          model: "gpt-5.5",
          prompt: "Inspect the renderer",
          state: "running",
          finalText: null,
          errorMessage: null,
        },
      ],
      activities: Array.from({ length: 100 }, (_, index) => {
        const sequence = index + 1;
        return {
          id: `runtime-subagent:toolu-subagent:thread:child:${sequence}`,
          kind: "subagent.item.completed",
          tone: "info",
          summary: `Assistant update ${sequence}`,
          createdAt,
          sequence,
          payload: {
            subagentThreadId: "thread:child",
            parentThreadId: "thread:runtime-tool-context",
            parentItemId: "toolu-subagent",
            agentId: "agent:child",
            nickname: "Research",
            role: "general-purpose",
            model: "gpt-5.5",
            prompt: "Inspect the renderer",
            state: "running",
            itemType: "assistant_message",
            itemId: `item:${sequence}`,
            status: "completed",
            title: "Assistant message",
            detail: `Assistant update ${sequence}`,
            data: null,
          },
        } as const;
      }),
    },
  };
}

function runtimeSubagentToolWithParallelActivities(): RuntimeDisplayTimelineToolItem {
  return {
    ...runtimeSubagentTool(),
    display: {
      kind: "subagent",
      mode: "parallel",
      agentScope: "project",
      projectAgentsDir: null,
      runs: [
        runtimeSubagentRun({
          subagentThreadId: "thread:child-a",
          nickname: "Research A",
          prompt: "Inspect renderer A",
        }),
        runtimeSubagentRun({
          subagentThreadId: "thread:child-b",
          nickname: "Research B",
          prompt: "Inspect renderer B",
        }),
      ],
      activities: [
        ...runtimeSubagentActivities({
          subagentThreadId: "thread:child-a",
          nickname: "Research A",
          prompt: "Inspect renderer A",
          label: "Child A",
        }),
        ...runtimeSubagentActivities({
          subagentThreadId: "thread:child-b",
          nickname: "Research B",
          prompt: "Inspect renderer B",
          label: "Child B",
        }),
      ],
    },
  };
}

function runtimeSubagentRun(input: {
  subagentThreadId: string;
  nickname: string;
  prompt: string;
}): Extract<
  NonNullable<RuntimeDisplayTimelineToolItem["display"]>,
  { kind: "subagent" }
>["runs"][number] {
  return {
    subagentThreadId: input.subagentThreadId,
    agentId: `agent:${input.subagentThreadId}`,
    nickname: input.nickname,
    role: "general-purpose",
    model: "gpt-5.5",
    prompt: input.prompt,
    state: "running",
    finalText: null,
    errorMessage: null,
  };
}

function runtimeSubagentActivities(input: {
  subagentThreadId: string;
  nickname: string;
  prompt: string;
  label: string;
}): Extract<
  NonNullable<RuntimeDisplayTimelineToolItem["display"]>,
  { kind: "subagent" }
>["activities"] {
  return Array.from({ length: 100 }, (_, index) => {
    const sequence = index + 1;
    return {
      id: `runtime-subagent:toolu-subagent:${input.subagentThreadId}:${sequence}`,
      kind: "subagent.item.completed",
      tone: "info",
      summary: `${input.label} update ${sequence}`,
      createdAt,
      sequence,
      payload: {
        subagentThreadId: input.subagentThreadId,
        parentThreadId: "thread:runtime-tool-context",
        parentItemId: "toolu-subagent",
        agentId: `agent:${input.subagentThreadId}`,
        nickname: input.nickname,
        role: "general-purpose",
        model: "gpt-5.5",
        prompt: input.prompt,
        state: "running",
        itemType: "assistant_message",
        itemId: `item:${input.subagentThreadId.replace("thread:", "")}:${sequence}`,
        status: "completed",
        title: "Assistant message",
        detail: `${input.label} update ${sequence}`,
        data: null,
      },
    } as const;
  });
}
