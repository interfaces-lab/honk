import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { formatInlineContextDataUrl } from "../composer/submission";
import { ThreadTranscriptRow } from "./transcript-turn";
import type { TranscriptRow } from "./transcript-model";

describe("user transcript inline context", () => {
  it("renders generated chat context inline instead of in the attachment strip", () => {
    const messageID = "message-1";
    const html = renderToStaticMarkup(
      <ThreadTranscriptRow
        conversationDensity="detailed"
        row={
          {
            kind: "human",
            key: "human:message-1",
            turnKey: messageID,
            message: { id: messageID, role: "user" },
            requiresRevertConfirmation: false,
            parts: [
              {
                id: "text-1",
                messageID,
                type: "text",
                text: "Compare @Earlier approach with this file",
              },
              {
                id: "context-1",
                messageID,
                type: "file",
                filename: "Earlier approach",
                mime: "text/plain",
                url: formatInlineContextDataUrl("chat", "user: prior context"),
              },
              {
                id: "file-1",
                messageID,
                type: "file",
                filename: "notes.txt",
                mime: "text/plain",
                url: "file:///tmp/notes.txt",
              },
            ],
          } as unknown as TranscriptRow
        }
      />,
    );

    expect(html).toContain('title="Past chat"');
    expect(html).not.toContain('title="Earlier approach"');
    expect(html).toContain('title="notes.txt"');
  });

  it("renders a sent skill with the same neutral inline chip anatomy as the composer", () => {
    const messageID = "message-2";
    const html = renderToStaticMarkup(
      <ThreadTranscriptRow
        conversationDensity="detailed"
        row={
          {
            kind: "human",
            key: "human:message-2",
            turnKey: messageID,
            message: { id: messageID, role: "user" },
            requiresRevertConfirmation: false,
            parts: [
              {
                id: "text-2",
                messageID,
                type: "text",
                text: "Use [parallel-web-extract][/skills/parallel-web-extract/SKILL.md]",
              },
            ],
          } as unknown as TranscriptRow
        }
      />,
    );

    expect(html).toContain('title="/skills/parallel-web-extract/SKILL.md"');
    expect(html).toContain("/parallel-web-extract");
    expect(html).toContain('data-slot="icon"');
    expect(html).not.toContain('data-slot="pill"');
  });

  it("does not repaint a sourced file mention as a transcript attachment", () => {
    const messageID = "message-3";
    const html = renderToStaticMarkup(
      <ThreadTranscriptRow
        conversationDensity="detailed"
        row={
          {
            kind: "human",
            key: "human:message-3",
            turnKey: messageID,
            message: { id: messageID, role: "user" },
            requiresRevertConfirmation: false,
            parts: [
              {
                id: "text-3",
                messageID,
                type: "text",
                text: "Review @docs/handbook.md",
              },
              {
                id: "file-3",
                messageID,
                type: "file",
                filename: "handbook.md",
                mime: "text/markdown",
                url: "file:///repo/docs/handbook.md",
                source: {
                  type: "file",
                  path: "docs/handbook.md",
                  text: { value: "@docs/handbook.md", start: 7, end: 24 },
                },
              },
            ],
          } as unknown as TranscriptRow
        }
      />,
    );

    expect(html).toContain("@docs/handbook.md");
    expect(html).not.toContain('title="handbook.md"');
  });
});
