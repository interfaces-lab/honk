import { EnvironmentId, ThreadId, type RuntimeDisplayTimelineToolItem } from "@honk/contracts";
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
      projectRoot="/Users/workgyver/Developer/honk"
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
      projectRoot="/Users/workgyver/Developer/honk"
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

  it("renders runtime find display as a typed search row", () => {
    const html = renderRuntimeTool({
      id: "tool:find",
      kind: "tool",
      orderKey: `${createdAt}:tool:find`,
      createdAt,
      toolCallId: "toolu-find",
      toolName: "find",
      status: "completed",
      eventIds: [],
      display: {
        kind: "find",
        query: "tool renderer",
        path: "packages/app/src",
        output: "packages/app/src/components/chat/message/tool-renderer.tsx",
        totalMatched: 1,
        totalIndexedFiles: 240,
      },
    });

    expect(html).toContain("Searched");
    expect(html).toContain("tool renderer");
    expect(html).toContain("1 file");
    expect(html).not.toContain("240 files");
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
    expect(html).toContain('aria-expanded="true"');
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

  it("does not project parent runtime subagent activities into tray transcript items", () => {
    const subagents = runtimeToolItemToSubagents(runtimeSubagentToolWithTranscript());

    expect(subagents).toHaveLength(1);
    expect(subagents[0]?.logs).toEqual([]);
    expect(subagents[0]?.transcriptItems).toBeUndefined();
    expect(subagents[0]?.latestUpdate).toBe("Renderer reviewed");
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
