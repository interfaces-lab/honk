import { EnvironmentId, ThreadId } from "@multi/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  hasRenderableSubagentTranscriptItem,
  SubagentTranscriptItemRow,
} from "./subagent-preview-tray";

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
});
