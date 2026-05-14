import "../../index.css";

import { EnvironmentId, MessageId } from "@multi/contracts";
import { createRef, type ComponentProps } from "react";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { MessagesTimeline, type MessagesTimelineController } from "./messages-timeline";
import type { ChatMessage } from "../../../types";

function buildProps() {
  return {
    isWorking: false,
    activeTurnInProgress: false,
    activeTurnId: null,
    activeTurnStartedAt: null,
    timelineControllerRef: createRef<MessagesTimelineController | null>(),
    completionDividerBeforeEntryId: null,
    completionSummary: null,
    turnDiffSummaryByAssistantMessageId: new Map(),
    routeThreadKey: "environment-local:thread-1",
    onOpenTurnDiff: vi.fn(),
    revertTurnCountByUserMessageId: new Map(),
    isServerThread: true,
    onBeginEditUserMessage: vi.fn(),
    isRevertingCheckpoint: false,
    onImageExpand: vi.fn(),
    activeThreadEnvironmentId: EnvironmentId.make("environment-local"),
    markdownCwd: undefined,
    resolvedTheme: "dark" as const,
    projectRoot: undefined,
    onIsAtBottomChange: vi.fn(),
  };
}

type TimelineEntry = ComponentProps<typeof MessagesTimeline>["timelineEntries"][number];

function renderTimeline(props: ReturnType<typeof buildProps>, timelineEntries: TimelineEntry[]) {
  return render(
    <div style={{ height: 360, width: 860 }}>
      <MessagesTimeline {...props} timelineEntries={timelineEntries} />
    </div>,
  );
}

function buildMessageEntry(message: ChatMessage, index: number): TimelineEntry {
  return {
    id: `entry-${index}-${message.id}`,
    kind: "message",
    createdAt: message.createdAt,
    message,
  };
}

function buildConversationEntries(pairCount: number, startIndex = 0): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  for (let offset = 0; offset < pairCount; offset += 1) {
    const index = startIndex + offset;
    const createdAt = new Date(Date.UTC(2026, 3, 13, 12, 0, index)).toISOString();
    entries.push(
      buildMessageEntry(
        {
          id: MessageId.make(`message-user-${index}`),
          role: "user",
          text: `User prompt ${index}`,
          createdAt,
          streaming: false,
        },
        entries.length,
      ),
    );
    entries.push(
      buildMessageEntry(
        {
          id: MessageId.make(`message-assistant-${index}`),
          role: "assistant",
          text: Array.from(
            { length: 6 },
            (_, lineIndex) =>
              `Assistant response ${index}.${lineIndex} with enough text to measure.`,
          ).join("\n"),
          createdAt,
          streaming: false,
        },
        entries.length,
      ),
    );
  }
  return entries;
}

function getScrollElement() {
  const scrollElement = document.querySelector<HTMLDivElement>("[data-chat-timeline-scroll]");
  if (!scrollElement) {
    throw new Error("Messages timeline scroll element was not rendered.");
  }
  return scrollElement;
}

function getMaxScrollTop(scrollElement: HTMLElement) {
  return Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight);
}

async function waitForScrollable() {
  await vi.waitFor(() => {
    expect(getMaxScrollTop(getScrollElement())).toBeGreaterThan(0);
  });
  return getScrollElement();
}

async function waitForBottom(scrollElement: HTMLElement) {
  await vi.waitFor(() => {
    expect(scrollElement.scrollTop).toBeGreaterThanOrEqual(getMaxScrollTop(scrollElement) - 2);
  });
}

async function scrollTo(scrollElement: HTMLElement, scrollTop: number) {
  scrollElement.scrollTop = scrollTop;
  scrollElement.dispatchEvent(new Event("scroll", { bubbles: true }));
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function firstVisibleMessageId(scrollElement: HTMLElement) {
  const scrollRect = scrollElement.getBoundingClientRect();
  const messageRows = Array.from(scrollElement.querySelectorAll<HTMLElement>("[data-message-id]"));
  const firstVisibleMessage = messageRows.find((row) => {
    if (row.closest('[data-sticky="true"]')) {
      return false;
    }
    const rowRect = row.getBoundingClientRect();
    return rowRect.bottom > scrollRect.top && rowRect.top < scrollRect.bottom;
  });
  return firstVisibleMessage?.dataset.messageId ?? null;
}

describe("messages-timeline", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("renders activity rows instead of the empty placeholder when a thread has non-message timeline data", async () => {
    const screen = await render(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "work-1",
            kind: "work",
            createdAt: "2026-04-13T12:00:00.000Z",
            entry: {
              id: "work-1",
              createdAt: "2026-04-13T12:00:00.000Z",
              label: "thinking",
              detail: "Inspecting repository state",
              tone: "thinking",
            },
          },
        ]}
      />,
    );

    try {
      await expect
        .element(page.getByText("Send a message to start the conversation."))
        .not.toBeInTheDocument();
      await expect.element(page.getByText("Thinking - Inspecting repository state")).toBeVisible();
    } finally {
      await screen.unmount();
    }
  });

  it("snaps to the bottom when timeline rows appear after an initially empty render", async () => {
    const props = buildProps();
    const screen = await renderTimeline(props, []);

    try {
      await expect
        .element(page.getByText("Send a message to start the conversation."))
        .toBeVisible();

      await screen.rerender(
        <div style={{ height: 360, width: 860 }}>
          <MessagesTimeline
            {...props}
            timelineEntries={[
              {
                id: "work-1",
                kind: "work",
                createdAt: "2026-04-13T12:00:00.000Z",
                entry: {
                  id: "work-1",
                  createdAt: "2026-04-13T12:00:00.000Z",
                  label: "thinking",
                  detail: "Inspecting repository state",
                  tone: "thinking",
                },
              },
            ]}
          />
        </div>,
      );

      await expect.element(page.getByText("Thinking - Inspecting repository state")).toBeVisible();
      expect(props.timelineControllerRef.current?.getScrollState()).toEqual({ isAtBottom: true });
      expect(props.onIsAtBottomChange).toHaveBeenCalledWith(true);
    } finally {
      await screen.unmount();
    }
  });

  it("keeps the viewport pinned when new rows arrive at the bottom", async () => {
    const props = buildProps();
    const initialEntries = buildConversationEntries(16);
    const screen = await renderTimeline(props, initialEntries);

    try {
      const scrollElement = await waitForScrollable();
      props.timelineControllerRef.current?.scrollToBottom({ animated: false });
      await waitForBottom(scrollElement);

      await screen.rerender(
        <div style={{ height: 360, width: 860 }}>
          <MessagesTimeline
            {...props}
            timelineEntries={[...initialEntries, ...buildConversationEntries(1, 16)]}
          />
        </div>,
      );

      await waitForBottom(scrollElement);
      expect(props.timelineControllerRef.current?.getScrollState()).toEqual({ isAtBottom: true });
    } finally {
      await screen.unmount();
    }
  });

  it("does not jump to the bottom when the user is reading older messages", async () => {
    const props = buildProps();
    const initialEntries = buildConversationEntries(18);
    const screen = await renderTimeline(props, initialEntries);

    try {
      const scrollElement = await waitForScrollable();
      props.timelineControllerRef.current?.scrollToBottom({ animated: false });
      await waitForBottom(scrollElement);
      await scrollTo(scrollElement, Math.round(getMaxScrollTop(scrollElement) * 0.35));

      await vi.waitFor(() => {
        expect(props.onIsAtBottomChange).toHaveBeenCalledWith(false);
      });
      const firstVisibleBeforeAppend = firstVisibleMessageId(scrollElement);
      expect(firstVisibleBeforeAppend).toBeTruthy();

      await screen.rerender(
        <div style={{ height: 360, width: 860 }}>
          <MessagesTimeline
            {...props}
            timelineEntries={[...initialEntries, ...buildConversationEntries(1, 18)]}
          />
        </div>,
      );

      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });
      expect(firstVisibleMessageId(scrollElement)).toBe(firstVisibleBeforeAppend);
      expect(props.timelineControllerRef.current?.getScrollState()).toEqual({ isAtBottom: false });
    } finally {
      await screen.unmount();
    }
  });

  it("keeps the sticky user row unique and editable while scrolling", async () => {
    const props = buildProps();
    const screen = await renderTimeline(props, buildConversationEntries(20));

    try {
      const scrollElement = await waitForScrollable();
      await scrollTo(scrollElement, Math.round(getMaxScrollTop(scrollElement) * 0.45));

      await vi.waitFor(() => {
        expect(
          document.querySelector('[data-sticky="true"] [data-message-role="user"]'),
        ).toBeInstanceOf(HTMLElement);
      });

      const stickyRow = document.querySelector<HTMLElement>('[data-sticky="true"]');
      const stickyMessage = stickyRow?.querySelector<HTMLElement>("[data-message-id]");
      const stickyButton = stickyRow?.querySelector<HTMLElement>('[aria-label="Edit message"]');
      if (!stickyRow || !stickyMessage || !stickyButton) {
        throw new Error("Sticky user row did not render as an editable message.");
      }

      const stickyMessageId = stickyMessage.dataset.messageId;
      expect(stickyMessageId).toBeTruthy();
      expect(document.querySelectorAll(`[data-message-id="${stickyMessageId}"]`)).toHaveLength(1);

      stickyButton.click();
      await vi.waitFor(() => {
        expect(props.onBeginEditUserMessage).toHaveBeenCalledWith(stickyMessageId);
      });
    } finally {
      await screen.unmount();
    }
  });
});
