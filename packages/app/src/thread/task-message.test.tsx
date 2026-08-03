import { createOpenCodeServer } from "@honk/opencode";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const watchState = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("../use-sdk-watch", () => ({
  useSessionWatch: () => ({ state: watchState.current, status: "live" }),
}));

import type { AppChildSessionSummary, ThreadViewState } from "../open-code-view";
import type { TaskChildLink } from "./subagent-session";
import { latestTaskActivity, needsYouActivity, TaskMessage } from "./task-message";
import type { ThreadPart, ToolPart } from "./transcript-model";

const server = createOpenCodeServer({ origin: "http://127.0.0.1:4096" });

function task(): ToolPart {
  return {
    id: "part-task",
    sessionID: "session-parent",
    messageID: "message-parent",
    type: "tool",
    callID: "call-task",
    tool: "task",
    state: {
      status: "completed",
      input: {
        description: "Review the transcript",
        subagent_type: "honk-sidekick-medium",
      },
      output: "Background task started",
      title: "Task",
      metadata: { sessionId: "session-child" },
      time: { start: 1, end: 2 },
    },
  };
}

function child(): AppChildSessionSummary {
  return {
    id: "session-child",
    server: server.key,
    agent: "honk-sidekick-medium",
    model: null,
    title: "Review the transcript",
    status: "idle",
    needsAttention: false,
    archivedAt: null,
    updatedAt: new Date(2).toISOString(),
    revertMessageId: null,
    projectId: null,
    projectDirectory: "/repo",
    location: { directory: "/repo" },
    worktree: null,
    parentSessionId: "session-parent",
  };
}

function activityState(parts: readonly ThreadPart[]): Pick<ThreadViewState, "messages" | "parts"> {
  return {
    messages: [
      { id: "message-user", role: "user" },
      { id: "message-child", role: "assistant" },
    ] as unknown as ThreadViewState["messages"],
    parts,
  };
}

describe("task message", () => {
  it("uses the latest explicit child progress message", () => {
    expect(
      latestTaskActivity(
        activityState([
          {
            id: "progress-old",
            sessionID: "session-child",
            messageID: "message-child",
            type: "text",
            text: "Inspecting the transcript",
          } as ThreadPart,
          {
            id: "progress-user",
            sessionID: "session-child",
            messageID: "message-user",
            type: "text",
            text: "Ignore user text",
          } as ThreadPart,
          {
            id: "progress-new",
            sessionID: "session-child",
            messageID: "message-child",
            type: "text",
            text: "Checking   the final\nordering",
          } as ThreadPart,
        ]),
      ),
    ).toBe("Checking the final ordering");
  });

  it("falls back to the latest structured tool activity", () => {
    expect(
      latestTaskActivity(
        activityState([
          {
            id: "tool-read",
            sessionID: "session-child",
            messageID: "message-child",
            type: "tool",
            callID: "call-read",
            tool: "read",
            state: {
              status: "running",
              input: { filePath: "src/value.ts" },
              metadata: {},
              time: { start: 1 },
            },
          } as ToolPart,
        ]),
      ),
    ).toBe("Reading src/value.ts");
  });

  it("renders a linked mission as a two-line bottom-sheet trigger", () => {
    const link: TaskChildLink = {
      partID: "part-task",
      child: child(),
      ownsLiveState: true,
      state: "done",
    };
    const html = renderToStaticMarkup(
      <TaskMessage
        part={task()}
        link={link}
        isThreadRunning
        isOpen={false}
        onOpen={() => undefined}
      />,
    );

    expect(html).toContain("Review the transcript");
    expect(html).toContain("Sol Medium");
    expect(html).toContain("Completed");
    expect(html).toContain('aria-controls="task-tool-region:part-task"');
    expect(html).toContain("Open work details");
    expect(html).not.toContain("Sidekick");
    expect(html).not.toContain("Subagent");
  });

  it("reports a running subagent blocked on a request as needing the user", () => {
    watchState.current = {
      app: {
        summary: { status: "running" },
        messages: [],
        parts: [],
        permissions: [{ id: "per_1", action: "external_directory", resources: ["/outside/*"] }],
        questions: [],
      },
      attachedDirectories: [],
      activity: "busy",
    };
    const link: TaskChildLink = {
      partID: "part-task",
      child: child(),
      ownsLiveState: true,
      state: "running",
    };
    const html = renderToStaticMarkup(
      <TaskMessage
        part={task()}
        link={link}
        isThreadRunning
        isOpen={false}
        onOpen={() => undefined}
      />,
    );

    expect(html).toContain("Needs you — external_directory");
    expect(html).not.toContain("Planning next moves");
    expect(html).toContain('data-tool-call-status-glyph="attention"');
    expect(html).toContain("Review the transcript, Sol Medium. Needs you. Open work details");
    watchState.current = null;
  });

  it("names pending question headers when no permission action is waiting", () => {
    expect(
      needsYouActivity({
        permissions: [],
        questions: [
          {
            questions: [{ header: "Scope" }, { header: "Risk" }],
          },
        ],
      } as unknown as Pick<ThreadViewState, "permissions" | "questions">),
    ).toBe("Needs you — Scope, Risk");
  });
});
