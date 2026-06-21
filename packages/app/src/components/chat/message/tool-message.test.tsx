import { EnvironmentId, ThreadId, type RuntimeDisplayTimelineToolItem } from "@honk/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { WorkLogEntry } from "../../../session-logic";
import {
  RuntimeToolCallMessage,
  ToolCallMessage,
  runtimeToolDisplayToToolCall,
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
          case: "bashToolCall",
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
      toolName: "bash",
      status: "completed",
      eventIds: [],
      details: "M AGENTS.md M packages/app/src/session-logic.ts",
      result: { content: [{ type: "text", text: "M AGENTS.md" }] },
      output: "M AGENTS.md",
      summary: "Completed bash",
      display: {
        kind: "unknown",
        toolName: "bash",
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
      toolName: "bash",
      status: "completed",
      eventIds: [],
      args: { command: "git status --short" },
      command: "git status --short",
      result: { content: [{ type: "text", text: "M AGENTS.md" }] },
      output: "M AGENTS.md",
      summary: "Completed bash",
      display: {
        kind: "bash",
        command: "git status --short",
        output: "M AGENTS.md",
      },
    });

    expect(html).toContain("Ran");
    expect(html).toContain("git status --short");
    expect(html).not.toContain("M AGENTS.md");
  });

  it("prefers runtime short descriptions over generated command details", () => {
    const tool: RuntimeDisplayTimelineToolItem = {
      id: "tool:short-description",
      kind: "tool",
      orderKey: `${createdAt}:tool:short-description`,
      createdAt,
      toolCallId: "toolu-short-description",
      toolName: "bash",
      status: "completed",
      eventIds: [],
      shortDescription: "Check repository status",
      args: { command: "git status --short", description: "Check repository status" },
      command: "git status --short",
      display: {
        kind: "bash",
        command: "git status --short",
      },
    };

    const toolCall = runtimeToolDisplayToToolCall(tool, tool.display);
    const html = renderRuntimeTool(tool);

    expect(toolCall.tool.value.details).toBe("Check repository status");
    expect(toolCall.tool.value.command).toBe("git status --short");
    expect(html).toContain("Check repository status");
  });

  it("falls back to generated runtime details when short descriptions are absent", () => {
    const tool: RuntimeDisplayTimelineToolItem = {
      id: "tool:short-description-fallback",
      kind: "tool",
      orderKey: `${createdAt}:tool:short-description-fallback`,
      createdAt,
      toolCallId: "toolu-short-description-fallback",
      toolName: "read",
      status: "completed",
      eventIds: [],
      display: {
        kind: "read",
        path: "packages/app/src/components/chat/message/tool-message.tsx",
        startLine: 10,
        endLine: 20,
      },
    };

    const toolCall = runtimeToolDisplayToToolCall(tool, tool.display);

    expect(toolCall.tool.value.details).toBe(
      "packages/app/src/components/chat/message/tool-message.tsx:10-20",
    );
  });

  it("keeps command chrome for runtime shell displays without command text", () => {
    const tool: RuntimeDisplayTimelineToolItem = {
      id: "tool:shell-output-only",
      kind: "tool",
      orderKey: `${createdAt}:tool:shell-output-only`,
      createdAt,
      toolCallId: "toolu-shell-output-only",
      toolName: "bash",
      status: "completed",
      eventIds: [],
      output: "done",
      summary: "Completed bash",
      display: {
        kind: "bash",
        output: "done",
      },
    };
    const html = renderToStaticMarkup(
      <ToolCallRenderer
        toolCall={runtimeToolDisplayToToolCall(tool, tool.display)}
        conversationDensity="detailed"
        defaultExpanded
      />,
    );

    expect(html).toContain("data-shell-tool-call");
    expect(html).toContain("data-shell-tool-call-output");
    expect(html).toContain("done");
    expect(html).not.toContain("Completed bash");
    expect(html).not.toContain("raw");
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

  it("maps a runtime edit display diff into a unified diff artifact", () => {
    const patch = [
      "--- packages/app/src/components/chat/view/chat-view.tsx",
      "+++ packages/app/src/components/chat/view/chat-view.tsx",
      "@@ -315,2 +315,2 @@",
      "-old line",
      "+new line",
    ].join("\n");
    const tool: RuntimeDisplayTimelineToolItem = {
      id: "tool:edit-diff",
      kind: "tool",
      orderKey: `${createdAt}:tool:edit-diff`,
      createdAt,
      toolCallId: "toolu-edit-diff",
      toolName: "edit",
      status: "completed",
      eventIds: [],
      display: {
        kind: "edit",
        path: "packages/app/src/components/chat/view/chat-view.tsx",
        additions: 1,
        deletions: 1,
        diff: patch,
      },
    };

    const toolCall = runtimeToolDisplayToToolCall(tool, tool.display);

    expect(toolCall.tool.case).toBe("editToolCall");
    expect(toolCall.tool.value.artifacts).toEqual([
      {
        type: "diff",
        format: "unified",
        source: "result",
        files: [
          {
            path: "packages/app/src/components/chat/view/chat-view.tsx",
            additions: 1,
            deletions: 1,
          },
        ],
        unifiedDiff: patch,
      },
    ]);
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

  it("renders runtime subagent display as bare status rows without task chrome", () => {
    const tool = runtimeSubagentTool();
    const html = renderRuntimeToolWithContext(tool);

    expect(html).toContain("data-subagent-status-container");
    expect(html).toContain("data-subagent-row");
    expect(html).toContain("data-subagent-role");
    expect(html).toContain("data-subagent-name");
    expect(html).toContain("data-subagent-task");
    expect(html).toContain("Worker");
    expect(html).not.toContain("General Purpose");
    expect(html).toContain("Research");
    expect(html).toContain("gpt-5.5");
    expect(html).toContain("Renderer reviewed");
    expect(html).not.toContain("data-task-tool-call");
    expect(html).not.toContain("Inspect the renderer");
    expect(html).not.toContain("Ran");
  });

  it("renders runtime subagent display as a task row without tray context", () => {
    const html = renderRuntimeTool(runtimeSubagentTool());

    expect(html).toContain("Task");
    expect(html).toContain("Inspect the renderer");
    expect(html).not.toContain("data-subagent-status-container");
    expect(html).not.toContain("Ran");
  });

  it("renders active default subagents as Worker rows with the task description", () => {
    const html = renderRuntimeToolWithContext(
      runtimeActiveSubagentTool({
        nickname: "Research session IDs",
        role: "general-purpose",
      }),
    );

    expect(html).toContain("Worker handling");
    expect(html).toContain("Research session IDs");
    expect(html).toContain('data-slot="chat-loader-matrix"');
    expect(html).not.toContain(">Running<");
  });

  it("renders active specialist subagents with product verbs", () => {
    const librarianHtml = renderRuntimeToolWithContext(
      runtimeActiveSubagentTool({
        nickname: "Research files",
        role: "librarian",
      }),
    );
    const oracleHtml = renderRuntimeToolWithContext(
      runtimeActiveSubagentTool({
        nickname: "Migration plan",
        role: "oracle",
      }),
    );

    expect(librarianHtml).toContain("Librarian researching");
    expect(oracleHtml).toContain("Oracle manifesting");
  });

  it("renders active runtime subagent logs as a bounded inline activity tree", () => {
    const html = renderRuntimeToolWithContext(
      runtimeActiveSubagentTool({
        nickname: "Research session IDs",
        role: "librarian",
        activityCount: 18,
      }),
    );

    expect(html).toContain("data-subagent-inline-activity");
    expect(html).toContain("Activity 17");
    expect(html).not.toContain("Activity 0");
  });

  it("does not project parent runtime subagent activities into tray transcript items", () => {
    const subagents = runtimeToolItemToSubagents(runtimeSubagentToolWithTranscript());

    expect(subagents).toHaveLength(1);
    expect(subagents[0]?.logs).toHaveLength(2);
    expect(subagents[0]?.transcriptItems).toBeUndefined();
    expect(subagents[0]?.latestUpdate).toBe("Renderer reviewed");
  });
});

function runtimeActiveSubagentTool(input: {
  nickname: string;
  role: string;
  activityCount?: number | undefined;
}): RuntimeDisplayTimelineToolItem {
  const activityCount = input.activityCount ?? 1;
  return {
    id: "tool:active-subagent",
    kind: "tool",
    orderKey: `${createdAt}:tool:active-subagent`,
    createdAt,
    toolCallId: "toolu-active-subagent",
    toolName: "subagent",
    status: "running",
    eventIds: [],
    display: {
      kind: "subagent",
      mode: "single",
      runs: [
        {
          subagentThreadId: "thread:active-child",
          agentId: "agent:active-child",
          nickname: input.nickname,
          role: input.role,
          model: "gpt-5.5",
          prompt: "Inspect active subagent display",
          state: "running",
          finalText: null,
          errorMessage: null,
        },
      ],
      activities: Array.from({ length: activityCount }, (_, index) => ({
        id: `runtime-subagent:toolu-active-subagent:thread:active-child:${index}`,
        kind: index === 0 ? "subagent.thread.started" : "subagent.item.updated",
        tone: "info",
        summary: `Activity ${index}`,
        createdAt,
        sequence: index + 1,
        payload: {
          subagentThreadId: "thread:active-child",
          parentThreadId: "thread:runtime-tool-context",
          parentItemId: "toolu-active-subagent",
          agentId: "agent:active-child",
          nickname: input.nickname,
          role: input.role,
          model: "gpt-5.5",
          prompt: "Inspect active subagent display",
          state: "running",
          itemType: index === 0 ? null : "file_search",
          itemId: index === 0 ? null : `item:${index}`,
          status: index === activityCount - 1 ? "running" : "completed",
          title: `Activity ${index}`,
          detail: index === 0 ? null : `Detail ${index}`,
          data: null,
        },
      })),
    },
  };
}

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
