import { EnvironmentId, ThreadId, TurnId } from "@multi/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  flattenSubagentSnapshotItems,
  hasRenderableSubagentSnapshotItem,
  hasRenderableSubagentTranscriptItem,
  isSubagentReasoningSnapshotItem,
  shouldPresentSubagentPreviewTray,
  subagentSnapshotDisplayDetail,
  SubagentTranscriptItemRow,
} from "./subagent-preview-tray";

describe("shouldPresentSubagentPreviewTray", () => {
  it("allows a focused subagent tray whenever the caller marks previews visible", () => {
    const activeThreadId = ThreadId.make("thread-1");

    expect(
      shouldPresentSubagentPreviewTray({
        activeThreadId,
        previewActiveThreadId: activeThreadId,
        hasFocus: true,
        visible: true,
      }),
    ).toBe(true);
  });

  it("keeps inline edit and inactive-thread previews hidden", () => {
    expect(
      shouldPresentSubagentPreviewTray({
        activeThreadId: ThreadId.make("thread-1"),
        previewActiveThreadId: ThreadId.make("thread-1"),
        hasFocus: true,
        visible: false,
      }),
    ).toBe(false);

    expect(
      shouldPresentSubagentPreviewTray({
        activeThreadId: ThreadId.make("thread-1"),
        previewActiveThreadId: ThreadId.make("thread-2"),
        hasFocus: true,
        visible: true,
      }),
    ).toBe(false);
  });
});

describe("hasRenderableSubagentTranscriptItem", () => {
  it("treats empty message transcript items as placeholders", () => {
    expect(
      hasRenderableSubagentTranscriptItem({
        id: "user-message-1",
        itemId: "user-message-1",
        kind: "message",
        role: "user",
        title: "User message",
        loading: false,
        createdAt: "2026-02-23T00:00:01.000Z",
        sequence: 0,
      }),
    ).toBe(false);
  });

  it("keeps hydrated message transcript items renderable", () => {
    expect(
      hasRenderableSubagentTranscriptItem({
        id: "user-message-1",
        itemId: "user-message-1",
        kind: "message",
        role: "user",
        title: "User message",
        text: "Review the current code.",
        loading: false,
        createdAt: "2026-02-23T00:00:01.000Z",
        sequence: 0,
      }),
    ).toBe(true);
  });

  it("treats stale tool-shaped message rows as chat messages", () => {
    expect(
      hasRenderableSubagentTranscriptItem({
        id: "user-message-1",
        itemId: "user-message-1",
        kind: "tool",
        title: "User message",
        text: "Review the current code.",
        loading: false,
        createdAt: "2026-02-23T00:00:01.000Z",
        sequence: 0,
      }),
    ).toBe(true);
  });

  it("does not render empty stale message lifecycle placeholders", () => {
    expect(
      hasRenderableSubagentTranscriptItem({
        id: "user-message-1",
        itemId: "user-message-1",
        kind: "tool",
        itemType: "user_message",
        title: "User message",
        loading: false,
        createdAt: "2026-02-23T00:00:01.000Z",
        sequence: 0,
      }),
    ).toBe(false);
  });

  it("requires visible text for reasoning placeholders", () => {
    expect(
      hasRenderableSubagentTranscriptItem({
        id: "reasoning-1",
        itemId: "reasoning-1",
        kind: "tool",
        itemType: "reasoning",
        title: "Reasoning",
        loading: false,
        createdAt: "2026-02-23T00:00:01.000Z",
        sequence: 0,
      }),
    ).toBe(false);
  });
});

describe("hasRenderableSubagentSnapshotItem", () => {
  it("treats empty snapshot message items as placeholders", () => {
    expect(
      hasRenderableSubagentSnapshotItem({
        id: "snapshot-user-message-1",
        itemType: "user_message",
        role: "user",
        title: "User message",
      }),
    ).toBe(false);
  });

  it("keeps hydrated snapshot message items renderable", () => {
    expect(
      hasRenderableSubagentSnapshotItem({
        id: "snapshot-user-message-1",
        itemType: "user_message",
        role: "user",
        title: "User message",
        detail: "Review the current code.",
      }),
    ).toBe(true);
  });

  it("requires visible text for snapshot reasoning placeholders", () => {
    expect(
      hasRenderableSubagentSnapshotItem({
        id: "snapshot-reasoning-1",
        itemType: "reasoning",
        role: "assistant",
        title: "Reasoning",
      }),
    ).toBe(false);
  });

  it("uses raw snapshot message text instead of truncated detail previews", () => {
    const fullText =
      "Multi is a pnpm/Turbo TypeScript monorepo for a desktop coding-agent app. The product is a local server plus a web UI, wrapped by Electron for desktop.";

    expect(
      subagentSnapshotDisplayDetail({
        id: "snapshot-assistant-message-1",
        itemType: "assistant_message",
        role: "assistant",
        title: "Assistant message",
        detail:
          "Multi is a pnpm/Turbo TypeScript monorepo for a desktop coding-agent app. The product is a local ser...",
        data: {
          item: {
            id: "snapshot-assistant-message-1",
            text: fullText,
            type: "agentMessage",
          },
        },
      }),
    ).toBe(fullText);
  });

  it("uses raw Codex snapshot item text when data is the item itself", () => {
    const fullText =
      "Multi is a pnpm/Turbo TypeScript monorepo for a desktop coding-agent app. The final sentence remains visible.";

    expect(
      subagentSnapshotDisplayDetail({
        id: "snapshot-assistant-message-2",
        itemType: "assistant_message",
        role: "assistant",
        title: "Assistant message",
        detail:
          "Multi is a pnpm/Turbo TypeScript monorepo for a desktop coding-agent app. The final sentence...",
        data: {
          id: "snapshot-assistant-message-2",
          text: fullText,
          type: "agentMessage",
        },
      }),
    ).toBe(fullText);
  });

  it("classifies canonical reasoning snapshots without requiring the Reasoning title", () => {
    expect(
      isSubagentReasoningSnapshotItem({
        id: "snapshot-reasoning-summary-1",
        itemType: "reasoning",
        role: "assistant",
        title: "Summary text",
        detail: "Checked the command renderer and tray snapshot paths.",
      }),
    ).toBe(true);
  });

  it("coalesces duplicate snapshot command lifecycle rows by provider item id", () => {
    const snapshotItems = flattenSubagentSnapshotItems([
      {
        id: TurnId.make("turn-1"),
        items: [
          {
            id: "command-started-row",
            itemType: "command_execution",
            role: "tool",
            title: "Ran command",
            detail: "pnpm test",
            data: {
              item: {
                id: "command-1",
                command: "pnpm test",
              },
            },
          },
          {
            id: "command-completed-row",
            itemType: "command_execution",
            role: "tool",
            title: "Ran command",
            detail: "pnpm test",
            data: {
              item: {
                id: "command-1",
                command: "pnpm test",
                result: {
                  stdout: "ok",
                },
              },
            },
          },
        ],
      },
    ]);

    expect(snapshotItems).toHaveLength(1);
    expect(JSON.stringify(snapshotItems[0]?.item.data)).toContain("ok");
  });

  it("coalesces duplicate snapshot message rows without keeping truncated text", () => {
    const fullText =
      "Multi is a pnpm/Turbo TypeScript monorepo for a desktop coding-agent app. The final sentence remains visible.";
    const snapshotItems = flattenSubagentSnapshotItems([
      {
        id: TurnId.make("turn-1"),
        items: [
          {
            id: "assistant-message-1",
            itemType: "assistant_message",
            role: "assistant",
            title: "Assistant message",
            detail: "Multi is a pnpm/Turbo TypeScript monorepo...",
          },
          {
            id: "assistant-message-1",
            itemType: "assistant_message",
            role: "assistant",
            title: "Assistant message",
            detail: "Multi is a pnpm/Turbo TypeScript monorepo...",
            data: {
              item: {
                id: "assistant-message-1",
                text: fullText,
                type: "agentMessage",
              },
            },
          },
        ],
      },
    ]);

    expect(snapshotItems).toHaveLength(1);
    expect(subagentSnapshotDisplayDetail(snapshotItems[0]!.item)).toBe(fullText);
  });
});

describe("SubagentTranscriptItemRow", () => {
  it("renders stale user message lifecycle rows through the human message component", () => {
    const markup = renderToStaticMarkup(
      createElement(SubagentTranscriptItemRow, {
        activeThreadId: ThreadId.make("thread-1"),
        environmentId: EnvironmentId.make("environment-1"),
        isStreaming: false,
        item: {
          id: "user-message-1",
          itemId: "user-message-1",
          kind: "tool",
          title: "User message",
          text: "Review the current code.",
          loading: false,
          createdAt: "2026-02-23T00:00:01.000Z",
          sequence: 0,
        },
        projectRoot: undefined,
      }),
    );

    expect(markup).toContain("Review the current code.");
    expect(markup).not.toContain("data-tool-call-line-action");
    expect(markup).not.toContain("User message");
  });

  it("renders stale reasoning lifecycle rows without the reasoning label", () => {
    const markup = renderToStaticMarkup(
      createElement(SubagentTranscriptItemRow, {
        activeThreadId: ThreadId.make("thread-1"),
        environmentId: EnvironmentId.make("environment-1"),
        isStreaming: false,
        item: {
          id: "reasoning-1",
          itemId: "reasoning-1",
          kind: "tool",
          itemType: "reasoning",
          title: "Reasoning",
          text: "Checking the repository state.",
          loading: false,
          createdAt: "2026-02-23T00:00:01.000Z",
          sequence: 0,
        },
        projectRoot: undefined,
      }),
    );

    expect(markup).toContain("Checking the repository state.");
    expect(markup).not.toContain("data-tool-call-line-action");
    expect(markup).not.toContain(">Reasoning<");
  });

  it("renders command transcript rows without a duplicate expandable command body", () => {
    const markup = renderToStaticMarkup(
      createElement(SubagentTranscriptItemRow, {
        activeThreadId: ThreadId.make("thread-1"),
        environmentId: EnvironmentId.make("environment-1"),
        isStreaming: false,
        item: {
          id: "command-1",
          itemId: "command-1",
          kind: "command",
          itemType: "command_execution",
          title: "Ran command",
          command: "pnpm test",
          loading: false,
          createdAt: "2026-02-23T00:00:01.000Z",
          sequence: 0,
        },
        projectRoot: undefined,
      }),
    );

    expect(markup).toContain(">Ran<");
    expect(markup).not.toContain("Ran command");
    expect(markup.match(/pnpm test/g)).toHaveLength(1);
    expect(markup).not.toContain("data-shell-tool-call-body");
  });

  it("renders full assistant transcript text through the chat message component", () => {
    const fullText =
      "Multi is a pnpm/Turbo TypeScript monorepo for a desktop coding-agent app. The final sentence must remain visible after markdown rendering.";
    const markup = renderToStaticMarkup(
      createElement(SubagentTranscriptItemRow, {
        activeThreadId: ThreadId.make("thread-1"),
        environmentId: EnvironmentId.make("environment-1"),
        isStreaming: false,
        item: {
          id: "assistant-message-1",
          itemId: "assistant-message-1",
          kind: "message",
          role: "assistant",
          title: "Assistant message",
          text: fullText,
          loading: false,
          createdAt: "2026-02-23T00:00:01.000Z",
          sequence: 0,
        },
        projectRoot: undefined,
      }),
    );

    expect(markup).toContain("Multi is a pnpm/Turbo TypeScript monorepo");
    expect(markup).toContain("final sentence must remain visible");
    expect(markup).not.toContain("Assistant message");
  });

});
