import {
  EnvironmentId,
  RuntimeItemId,
  ThreadEntryId,
  ThreadId,
  type RuntimeDisplayTimelineCustomMessageItem,
} from "@multi/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StepRenderer } from "./step-renderer";
import type { TimelineCustomMessageStep } from "./timeline-render-items";

const createdAt = "2026-06-05T20:30:00.000Z";

function renderCustomMessage(customMessage: RuntimeDisplayTimelineCustomMessageItem): string {
  const step: TimelineCustomMessageStep = {
    kind: "custom-message",
    id: customMessage.id,
    createdAt: customMessage.createdAt,
    customMessage,
  };

  return renderToStaticMarkup(
    <StepRenderer
      step={step}
      editUserMessagesDisabled
      ctx={{
        markdownCwd: "/Users/workgyver/Developer/multi",
        projectRoot: "/Users/workgyver/Developer/multi",
        activeThreadId: ThreadId.make("thread:custom-message-renderer"),
        activeThreadEnvironmentId: EnvironmentId.make("environment:custom-message-renderer"),
        isServerThread: true,
        onBeginEditUserMessage: undefined,
        renderEditComposer: undefined,
        onUpdateProposedPlan: undefined,
        onImageExpand: () => undefined,
      }}
    />,
  );
}

function customMessage(input: {
  readonly id: string;
  readonly customType: string;
  readonly content: unknown;
}): RuntimeDisplayTimelineCustomMessageItem {
  return {
    id: input.id,
    kind: "custom-message",
    orderKey: `${createdAt}:${input.id}`,
    createdAt,
    entryId: RuntimeItemId.make(`runtime:${input.id}`),
    threadEntryId: ThreadEntryId.make(`thread-entry:${input.id}`),
    parentEntryId: null,
    parentThreadEntryId: null,
    customType: input.customType,
    content: input.content,
    display: true,
  };
}

describe("StepRenderer runtime custom messages", () => {
  it("renders known custom message types through the markdown renderer without leaking the type label", () => {
    const html = renderCustomMessage(
      customMessage({
        id: "custom-message:git-agent-action",
        customType: "git-agent-action",
        content: "**Commit & Push** queued",
      }),
    );

    expect(html).toContain('data-runtime-custom-message-renderer="markdown"');
    expect(html).toContain("<strong");
    expect(html).toContain("Commit &amp; Push");
    expect(html).not.toContain("[git-agent-action]");
  });

  it("uses an explicit unknown renderer fallback for unsupported custom message types", () => {
    const html = renderCustomMessage(
      customMessage({
        id: "custom-message:unknown",
        customType: "unknown-extension-message",
        content: "Visible fallback",
      }),
    );

    expect(html).toContain('data-runtime-custom-message-renderer="unknown"');
    expect(html).toContain("[unknown-extension-message]");
    expect(html).toContain("Visible fallback");
  });
});
