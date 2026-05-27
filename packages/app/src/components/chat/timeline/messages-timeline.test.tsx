import { EnvironmentId, MessageId, ThreadId } from "@multi/contracts";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ToolCallRenderer, type ToolCallModel } from "../message/tool-renderer";
import type { MessagesTimelineController } from "./messages-timeline";

function matchMedia() {
  return {
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

function createMockElement() {
  let innerHTML = "";
  const element = {
    append: () => {},
    get innerHTML() {
      return innerHTML;
    },
    set innerHTML(value: string) {
      innerHTML = value;
      element.textContent = value;
    },
    name: "",
    setAttribute: () => {},
    style: {
      backgroundColor: "",
      removeProperty: () => {},
      setProperty: () => {},
    },
    textContent: "",
  };
  return element;
}

beforeAll(() => {
  const classList = {
    add: () => {},
    remove: () => {},
    toggle: () => {},
    contains: () => false,
  };

  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  });
  vi.stubGlobal("window", {
    matchMedia,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    },
    cancelAnimationFrame: () => {},
    desktopBridge: undefined,
  });
  vi.stubGlobal("getComputedStyle", () => ({
    backgroundColor: "rgb(255, 255, 255)",
  }));
  vi.stubGlobal("document", {
    body: createMockElement(),
    documentElement: {
      classList,
      dataset: {},
      offsetHeight: 0,
      style: {
        backgroundColor: "",
        removeProperty: () => {},
        setProperty: () => {},
      },
    },
    createElement: createMockElement,
    head: {
      append: () => {},
    },
    querySelector: () => null,
  });
});

const ACTIVE_THREAD_ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const ACTIVE_THREAD_ID = ThreadId.make("thread-local");

function buildProps() {
  return {
    isWorking: false,
    activeTurnInProgress: false,
    editUserMessagesDisabled: false,
    activeTurnStartedAt: null,
    timelineControllerRef: createRef<MessagesTimelineController | null>(),
    editableUserMessageIds: new Set<MessageId>(),
    isServerThread: true,
    onBeginEditUserMessage: () => {},
    onImageExpand: () => {},
    activeThreadEnvironmentId: ACTIVE_THREAD_ENVIRONMENT_ID,
    activeThreadId: ACTIVE_THREAD_ID,
    timelineCacheKey: `${ACTIVE_THREAD_ID}:linear`,
    markdownCwd: undefined,
    projectRoot: undefined,
    onIsAtBottomChange: () => {},
  };
}

describe("messages-timeline", () => {
  it("renders inline terminal labels with the composer chip UI", async () => {
    const { MessagesTimeline } = await import("./messages-timeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "entry-1",
            kind: "message",
            createdAt: "2026-03-17T19:12:28.000Z",
            message: {
              id: MessageId.make("message-2"),
              role: "user",
              text: [
                "yoo what's @terminal-1:1-5 mean",
                "",
                "<terminal_context>",
                "- Terminal 1 lines 1-5:",
                "  1 | julius@mac effect-http-ws-cli % bun i",
                "  2 | bun install v1.3.9 (cf6cdbbb)",
                "</terminal_context>",
              ].join("\n"),
              createdAt: "2026-03-17T19:12:28.000Z",
              streaming: false,
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("Terminal 1 lines 1-5");
    expect(markup).toContain('viewBox="0 0 24 24"');
    expect(markup).toContain("yoo what&#x27;s ");
  }, 20_000);

  it("renders proposed plan rows in the conversation timeline", async () => {
    const { MessagesTimeline } = await import("./messages-timeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "plan-1",
            kind: "proposed-plan",
            createdAt: "2026-02-23T00:00:01.000Z",
            proposedPlan: {
              id: "plan-1",
              turnId: null,
              planMarkdown: "# Ship feature\n\n- Render the plan card",
              implementedAt: null,
              implementationThreadId: null,
              createdAt: "2026-02-23T00:00:01.000Z",
              updatedAt: "2026-02-23T00:00:01.000Z",
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("data-proposed-plan-message");
    expect(markup).toContain("Ship feature");
    expect(markup).toContain("Render the plan card");
  }, 20_000);

  it("renders edit affordance for user messages with session entries", async () => {
    const { MessagesTimeline } = await import("./messages-timeline");
    const messageId = MessageId.make("message-entry-edit");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        editableUserMessageIds={new Set([messageId])}
        timelineEntries={[
          {
            id: "entry-1",
            kind: "message",
            createdAt: "2026-03-17T19:12:28.000Z",
            message: {
              id: messageId,
              role: "user",
              text: "Entry-backed edit target",
              createdAt: "2026-03-17T19:12:28.000Z",
              streaming: false,
            },
          },
        ]}
      />,
    );

    expect(markup).toContain('aria-label="Edit message"');
  }, 20_000);

  it("renders context compaction entries in the normal work log", async () => {
    const { MessagesTimeline } = await import("./messages-timeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "entry-1",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "work-1",
              createdAt: "2026-03-17T19:12:28.000Z",
              label: "Context compacted",
              tone: "info",
            },
          },
        ]}
      />,
    );

    expect(markup).toContain('data-timeline-row-kind="work"');
    expect(markup).toContain('data-work-group-summary=""');
    expect(markup).toMatch(/Worked\b[\s\S]*1 step/);
  });

  it("formats changed file paths from the project root", async () => {
    const { MessagesTimeline } = await import("./messages-timeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "entry-1",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "work-1",
              createdAt: "2026-03-17T19:12:28.000Z",
              label: "Updated files",
              tone: "tool",
              changedFiles: ["C:/Users/mike/dev-stuff/multi/packages/app/src/session-logic.ts"],
            },
          },
        ]}
        projectRoot="C:/Users/mike/dev-stuff/multi"
      />,
    );

    expect(markup).toContain("multi/packages/app/src/session-logic.ts");
    expect(markup).not.toContain("C:/Users/mike/dev-stuff/multi/packages/app/src/session-logic.ts");
  });

  it("renders shell tool output instead of repeating the raw wrapped command", () => {
    const toolCall: ToolCallModel = {
      tool: {
        case: "shellToolCall",
        value: {
          action: "Ran",
          details: "sed -n '1,220p' CONTEXT.md",
          command: "sed -n '1,220p' CONTEXT.md",
          output: "first line\nsecond line",
        },
      },
    };

    const markup = renderToStaticMarkup(<ToolCallRenderer toolCall={toolCall} defaultExpanded />);

    expect(markup).toContain("first line");
    expect(markup).toContain("data-shell-tool-call-body");
    expect(markup.split("CONTEXT.md")).toHaveLength(2);
    expect(markup).not.toContain("/bin/zsh -lc");
  });

  it("renders command-only shell rows as a single non-expandable command line", () => {
    const toolCall: ToolCallModel = {
      tool: {
        case: "shellToolCall",
        value: {
          action: "Ran command",
          details: "pnpm test",
          command: "pnpm test",
          output: null,
        },
      },
    };

    const markup = renderToStaticMarkup(<ToolCallRenderer toolCall={toolCall} defaultExpanded />);

    expect(markup).toContain(">Ran<");
    expect(markup).not.toContain("Ran command");
    expect(markup.match(/pnpm test/g)).toHaveLength(1);
    expect(markup).not.toContain("data-shell-tool-call-body");
    expect(markup).not.toContain("aria-expanded");
  });

  it("does not expose generic completed task labels for subagent tool calls", () => {
    const toolCall: ToolCallModel = {
      tool: {
        case: "taskToolCall",
        value: {
          action: "Task",
          details: "Please inspect the local codebase.",
        },
      },
    };

    const markup = renderToStaticMarkup(<ToolCallRenderer toolCall={toolCall} />);

    expect(markup).toContain("Subagent");
    expect(markup).not.toContain("Completed task");
    expect(markup).not.toContain("Please inspect the local codebase.");
  });
});
