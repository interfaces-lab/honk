import "../../../index.css";

import { EnvironmentId, MessageId, ThreadId } from "@multi/contracts";
import { createRef, type ComponentProps } from "react";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { MessagesTimeline, type MessagesTimelineController } from "./messages-timeline";
import type { ChatMessage } from "../../../types";

const TIMELINE_SCROLL_SETTLE_MS = 40;
let nextTimelineInstanceId = 0;

function buildProps() {
  const activeThreadId = ThreadId.make(`thread-local-${nextTimelineInstanceId}`);
  nextTimelineInstanceId += 1;

  return {
    isWorking: false,
    editUserMessagesDisabled: false,
    activeTurnStartedAt: null,
    timelineControllerRef: createRef<MessagesTimelineController | null>(),
    editableUserMessageIds: new Set<MessageId>(),
    isServerThread: true,
    onBeginEditUserMessage: vi.fn(),
    onImageExpand: vi.fn(),
    activeThreadEnvironmentId: EnvironmentId.make("environment-local"),
    activeThreadId,
    timelineCacheKey: `${activeThreadId}:linear`,
    markdownCwd: undefined,
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

function buildEditableUserMessageIds(timelineEntries: readonly TimelineEntry[]) {
  return new Set(
    timelineEntries.flatMap((entry) =>
      entry.kind === "message" && entry.message.role === "user" ? [entry.message.id] : [],
    ),
  );
}

function buildRunningWorkEntries(count: number): TimelineEntry[] {
  return Array.from({ length: count }, (_, index) => {
    const createdAt = new Date(Date.UTC(2026, 3, 13, 12, 0, index)).toISOString();
    return {
      id: `work-running-group-${index}`,
      kind: "work",
      createdAt,
      entry: {
        id: `work-running-${index}`,
        createdAt,
        label: "reading",
        detail: `src/file-${index}.ts`,
        tone: "tool",
        status: "running",
        requestKind: "file-read",
      },
    };
  });
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

function getDistanceFromBottom(scrollElement: HTMLElement) {
  return getMaxScrollTop(scrollElement) - scrollElement.scrollTop;
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

async function waitForTimelineScrollState(
  props: ReturnType<typeof buildProps>,
  isAtBottom: boolean,
) {
  await vi.waitFor(() => {
    expect(props.timelineControllerRef.current?.getScrollState()).toEqual({ isAtBottom });
  });
}

async function waitForTimelineScrollSettle() {
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, TIMELINE_SCROLL_SETTLE_MS);
  });
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

async function scrollTo(scrollElement: HTMLElement, scrollTop: number) {
  scrollElement.scrollTop = scrollTop;
  scrollElement.dispatchEvent(new Event("scroll", { bubbles: true }));
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

interface VisibleTimelineRow {
  id: string;
  top: number;
  scrollTop: number;
}

function getFirstVisibleTimelineRow(
  scrollElement: HTMLElement,
  options?: { messageRole?: ChatMessage["role"] },
): VisibleTimelineRow | null {
  const viewportRect = scrollElement.getBoundingClientRect();
  const rowElements = document.querySelectorAll<HTMLElement>("[data-index]");

  for (const rowElement of rowElements) {
    if (rowElement.dataset.sticky === "true") {
      continue;
    }

    const timelineRoot = rowElement.querySelector<HTMLElement>("[data-timeline-row-id]");
    if (!timelineRoot?.dataset.timelineRowId) {
      continue;
    }
    if (options?.messageRole && timelineRoot.dataset.messageRole !== options.messageRole) {
      continue;
    }

    const rowRect = timelineRoot.getBoundingClientRect();
    if (rowRect.bottom > viewportRect.top + 1 && rowRect.top < viewportRect.bottom - 1) {
      return {
        id: timelineRoot.dataset.timelineRowId,
        top: rowRect.top,
        scrollTop: scrollElement.scrollTop,
      };
    }
  }

  return null;
}

async function waitForFirstVisibleTimelineRow(
  scrollElement: HTMLElement,
  options?: { messageRole?: ChatMessage["role"] },
): Promise<VisibleTimelineRow> {
  let visibleRow: VisibleTimelineRow | null = null;
  await vi.waitFor(() => {
    visibleRow = getFirstVisibleTimelineRow(scrollElement, options);
    expect(visibleRow).not.toBeNull();
  });
  if (!visibleRow) {
    throw new Error("Expected a visible timeline row.");
  }
  return visibleRow;
}

function growLastAssistantMessage(
  entries: readonly TimelineEntry[],
  extraLineCount: number,
): TimelineEntry[] {
  const nextEntries = [...entries];
  for (let index = nextEntries.length - 1; index >= 0; index -= 1) {
    const entry = nextEntries[index];
    if (!entry || entry.kind !== "message" || entry.message.role !== "assistant") {
      continue;
    }

    nextEntries[index] = {
      ...entry,
      message: {
        ...entry.message,
        text: [
          entry.message.text,
          ...Array.from(
            { length: extraLineCount },
            (_, lineIndex) => `Streaming response growth line ${lineIndex}.`,
          ),
        ].join("\n"),
      },
    };
    break;
  }
  return nextEntries;
}

function requireElement<T extends Element>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Expected element matching ${selector}.`);
  }
  return element;
}

describe("messages-timeline", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("renders activity rows when a thread has non-message timeline data", async () => {
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
              status: "running",
            },
          },
        ]}
      />,
    );

    try {
      await expect.element(page.getByText("Thinking - Inspecting repository state")).toBeVisible();
    } finally {
      await screen.unmount();
    }
  });

  it("shows the collapsed work summary and keeps chevrons adjacent after expanding", async () => {
    const props = buildProps();
    const screen = await renderTimeline(props, [
      {
        id: "work-command-1",
        kind: "work",
        createdAt: "2026-04-13T12:00:00.000Z",
        entry: {
          id: "work-command-1",
          createdAt: "2026-04-13T12:00:00.000Z",
          label: "ran",
          command:
            "pnpm exec vitest run --config vitest.browser.config.ts src/components/chat/timeline/messages-timeline.browser.tsx --reporter verbose --maxWorkers 1",
          output: "completed",
          tone: "tool",
          status: "completed",
          requestKind: "command",
        },
      },
    ]);

    try {
      await vi.waitFor(() => {
        expect(document.querySelector("[data-assistant-work-group]")).not.toBeNull();
      });

      const group = requireElement<HTMLElement>("[data-assistant-work-group]");
      expect(group.getAttribute("data-work-group-expanded")).toBe("false");
      const header = requireElement<HTMLElement>("[data-work-group-header]", group);
      const collapsedSummary = requireElement<HTMLElement>("[data-work-group-summary]", header);
      expect(
        collapsedSummary.textContent,
        "collapsed work group should show action and details without expanding",
      ).toMatch(/Ran/);
      expect(
        document.querySelector("[data-tool-call-line]"),
        "tool rows should not render while the work group is collapsed",
      ).toBeNull();

      header.click();
      await vi.waitFor(() => {
        expect(group.getAttribute("data-work-group-expanded")).toBe("true");
        expect(document.querySelector("[data-tool-call-line]")).not.toBeNull();
      });

      const line = requireElement<HTMLElement>("[data-tool-call-line]", group);
      const action = requireElement<HTMLElement>("[data-tool-call-line-action]", line);
      const details = requireElement<HTMLElement>("[data-tool-call-line-details]", line);
      const chevron = requireElement<HTMLElement>("[data-tool-call-line-chevron]", line);

      const groupRect = group.getBoundingClientRect();
      const lineRect = line.getBoundingClientRect();
      const actionRect = action.getBoundingClientRect();
      const detailsRect = details.getBoundingClientRect();
      const chevronRect = chevron.getBoundingClientRect();

      expect(
        lineRect.width,
        "tool row should use the available chat lane when text overflows",
      ).toBeGreaterThan(groupRect.width * 0.9);
      expect(
        lineRect.right,
        "tool row should not overflow the work group lane",
      ).toBeLessThanOrEqual(groupRect.right + 1);
      expect(actionRect.width, "tool row action should remain visible").toBeGreaterThan(0);
      expect(detailsRect.width, "tool row details should receive truncation space").toBeGreaterThan(
        0,
      );
      expect(
        chevronRect.left - detailsRect.right,
        "tool row chevron should sit next to the visible details text, not in a far-right column",
      ).toBeLessThanOrEqual(6);
    } finally {
      await screen.unmount();
    }
  });

  it("caps the running work preview to the recent tool tail", async () => {
    const props = buildProps();
    const screen = await renderTimeline(props, buildRunningWorkEntries(12));

    try {
      await vi.waitFor(() => {
        expect(document.querySelector("[data-work-group-preview]")).not.toBeNull();
      });

      const preview = requireElement<HTMLElement>("[data-work-group-preview]");
      expect(preview.clientHeight).toBeLessThanOrEqual(145);
      expect(preview.scrollHeight).toBeLessThanOrEqual(preview.clientHeight + 1);
      expect(preview.getAttribute("data-work-preview-scrollable")).toBe("false");
      expect(preview.querySelectorAll("[data-tool-call-line]")).toHaveLength(6);
      expect(preview.textContent).not.toContain("src/file-0.ts");
      expect(preview.textContent).toContain("src/file-11.ts");
    } finally {
      await screen.unmount();
    }
  });

  it("renders a live preview pane when a running work group is collapsed", async () => {
    const props = buildProps();
    const screen = await renderTimeline(props, [
      {
        id: "work-running-1",
        kind: "work",
        createdAt: "2026-04-13T12:00:00.000Z",
        entry: {
          id: "work-running-1",
          createdAt: "2026-04-13T12:00:00.000Z",
          label: "reading",
          detail: "src/example.ts",
          tone: "tool",
          status: "running",
          requestKind: "file-read",
        },
      },
    ]);

    try {
      await vi.waitFor(() => {
        const preview = document.querySelector<HTMLElement>("[data-work-group-preview]");
        expect(preview).not.toBeNull();
      });

      const group = requireElement<HTMLElement>("[data-assistant-work-group]");
      expect(group.getAttribute("data-work-group-running")).toBe("true");
      expect(group.getAttribute("data-work-group-expanded")).toBe("false");

      const preview = requireElement<HTMLElement>("[data-work-group-preview]", group);
      expect(preview.getAttribute("role")).toBe("button");
      expect(preview.querySelectorAll("[data-tool-call-line]").length).toBeGreaterThan(0);

      preview.click();
      await vi.waitFor(() => {
        expect(group.getAttribute("data-work-group-expanded")).toBe("true");
        expect(
          document.querySelector("[data-work-group-preview]"),
          "expanded running groups must render every child row, not the preview tail",
        ).toBeNull();
        expect(document.querySelector("[data-tool-call-line]")).not.toBeNull();
      });
    } finally {
      await screen.unmount();
    }
  });

  it("expands every entry of a running work group when the header is opened", async () => {
    const props = buildProps();
    const screen = await renderTimeline(props, buildRunningWorkEntries(16));

    try {
      await vi.waitFor(() => {
        expect(document.querySelector("[data-assistant-work-group]")).not.toBeNull();
      });

      const group = requireElement<HTMLElement>("[data-assistant-work-group]");
      expect(group.getAttribute("data-work-group-running")).toBe("true");
      expect(group.getAttribute("data-work-group-expanded")).toBe("false");

      const header = requireElement<HTMLElement>("[data-work-group-header]", group);
      header.click();

      await vi.waitFor(() => {
        expect(group.getAttribute("data-work-group-expanded")).toBe("true");
        expect(document.querySelector("[data-work-group-preview]")).toBeNull();
        expect(group.querySelectorAll("[data-tool-call-line]")).toHaveLength(16);
      });
    } finally {
      await screen.unmount();
    }
  });

  it("snaps to the bottom when timeline rows appear after an initially empty render", async () => {
    const props = buildProps();
    const screen = await renderTimeline(props, []);

    try {
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
                  status: "running",
                },
              },
            ]}
          />
        </div>,
      );

      await expect.element(page.getByText("Thinking - Inspecting repository state")).toBeVisible();
      await waitForTimelineScrollState(props, true);
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
      await waitForTimelineScrollState(props, true);
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
      await waitForTimelineScrollSettle();
      await scrollTo(scrollElement, Math.round(getMaxScrollTop(scrollElement) * 0.35));

      await vi.waitFor(() => {
        expect(props.onIsAtBottomChange).toHaveBeenCalledWith(false);
      });
      const scrollTopBeforeAppend = scrollElement.scrollTop;
      expect(getDistanceFromBottom(scrollElement)).toBeGreaterThan(2);

      await screen.rerender(
        <div style={{ height: 360, width: 860 }}>
          <MessagesTimeline
            {...props}
            timelineEntries={[...initialEntries, ...buildConversationEntries(1, 18)]}
          />
        </div>,
      );

      await vi.waitFor(() => {
        expect(getMaxScrollTop(scrollElement)).toBeGreaterThan(0);
        expect(getDistanceFromBottom(scrollElement)).toBeGreaterThan(2);
      });
      expect(scrollElement.scrollTop).toBeLessThanOrEqual(scrollTopBeforeAppend + 2);
      await waitForTimelineScrollState(props, false);
    } finally {
      await screen.unmount();
    }
  });

  it("keeps the same visible row in view when older rows are prepended", async () => {
    const props = buildProps();
    const initialEntries = buildConversationEntries(22);
    const screen = await renderTimeline(props, initialEntries);

    try {
      const scrollElement = await waitForScrollable();
      props.timelineControllerRef.current?.scrollToBottom({ animated: false });
      await waitForBottom(scrollElement);
      await waitForTimelineScrollSettle();
      await scrollTo(scrollElement, 180);
      await waitForTimelineScrollState(props, false);

      const beforePrepend = await waitForFirstVisibleTimelineRow(scrollElement, {
        messageRole: "assistant",
      });
      const olderEntries = buildConversationEntries(2, -2);

      await screen.rerender(
        <div style={{ height: 360, width: 860 }}>
          <MessagesTimeline {...props} timelineEntries={[...olderEntries, ...initialEntries]} />
        </div>,
      );

      await vi.waitFor(() => {
        const afterPrepend = getFirstVisibleTimelineRow(scrollElement, {
          messageRole: "assistant",
        });
        expect(afterPrepend).not.toBeNull();
        if (!afterPrepend) {
          return;
        }
        expect(afterPrepend.id).toBe(beforePrepend.id);
        expect(afterPrepend.scrollTop).toBeGreaterThan(beforePrepend.scrollTop);
      });
      await waitForTimelineScrollState(props, false);
    } finally {
      await screen.unmount();
    }
  });

  it("keeps the viewport pinned when the final message grows while streaming", async () => {
    const props = buildProps();
    const initialEntries = buildConversationEntries(16);
    const screen = await renderTimeline(props, initialEntries);

    try {
      const scrollElement = await waitForScrollable();
      props.timelineControllerRef.current?.scrollToBottom({ animated: false });
      await waitForBottom(scrollElement);
      await waitForTimelineScrollState(props, true);

      await screen.rerender(
        <div style={{ height: 360, width: 860 }}>
          <MessagesTimeline
            {...props}
            timelineEntries={growLastAssistantMessage(initialEntries, 18)}
          />
        </div>,
      );

      await waitForBottom(scrollElement);
      await waitForTimelineScrollState(props, true);
    } finally {
      await screen.unmount();
    }
  });

  it("keeps the sticky user row unique and editable while scrolling", async () => {
    const props = buildProps();
    const timelineEntries = buildConversationEntries(20);
    props.editableUserMessageIds = buildEditableUserMessageIds(timelineEntries);
    const screen = await renderTimeline(props, timelineEntries);

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
