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
    revertTurnCountByUserMessageId: new Map(),
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
    expect(markup).not.toContain("/bin/zsh -lc");
  });
});
