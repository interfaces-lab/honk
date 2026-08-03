import { describe, expect, it } from "vitest";

import { parsePromptComposerFile, physicalAttachmentsFromPromptFiles } from "./prompt-files";

describe("composer prompt files", () => {
  it("preserves canonical source metadata from persisted drafts", () => {
    expect(
      parsePromptComposerFile({
        path: "docs/handbook.md",
        filename: "handbook.md",
        mime: "text/markdown",
        source: { text: "@docs/handbook.md", start: 7, end: 24 },
      }),
    ).toEqual({
      path: "docs/handbook.md",
      filename: "handbook.md",
      mime: "text/markdown",
      source: { text: "@docs/handbook.md", start: 7, end: 24 },
    });
  });

  it("keeps inline sources out of physical attachment chrome", () => {
    expect(
      physicalAttachmentsFromPromptFiles(
        [
          {
            path: "docs/handbook.md",
            filename: "handbook.md",
            source: { text: "@docs/handbook.md", start: 0, end: 17 },
          },
          {
            path: "data:text/plain,context",
            filename: "Earlier approach",
            context: { kind: "chat", sourceKey: "chat:one" },
          },
          { path: "data:image/png;base64,AAAA", filename: "capture.png", mime: "image/png" },
          { path: "/tmp/notes.txt", filename: "notes.txt", mime: "text/plain" },
        ],
        "draft",
      ),
    ).toEqual([
      {
        key: "draft:2:capture.png",
        label: "capture.png",
        path: "data:image/png;base64,AAAA",
        mime: "image/png",
      },
      {
        key: "draft:3:notes.txt",
        label: "notes.txt",
        path: "/tmp/notes.txt",
        mime: "text/plain",
      },
    ]);
  });

  it("recognizes legacy untagged mentions from their Lexical nodes without hiding real files", () => {
    expect(
      physicalAttachmentsFromPromptFiles(
        [
          { path: "docs/handbook.md", filename: "handbook.md" },
          { path: "docs/handbook.md", filename: "handbook.md" },
          { path: "/tmp/notes.txt", filename: "notes.txt" },
        ],
        "draft",
        JSON.stringify({
          root: {
            children: [
              {
                type: "paragraph",
                children: [
                  {
                    type: "composerMention",
                    kind: "file",
                    path: "docs/handbook.md",
                    label: "handbook.md",
                  },
                ],
              },
            ],
          },
        }),
      ),
    ).toEqual([
      {
        key: "draft:1:handbook.md",
        label: "handbook.md",
        path: "docs/handbook.md",
      },
      {
        key: "draft:2:notes.txt",
        label: "notes.txt",
        path: "/tmp/notes.txt",
      },
    ]);
  });

  it("keeps a physical file that shares a path with a canonical sourced mention", () => {
    expect(
      physicalAttachmentsFromPromptFiles(
        [
          {
            path: "docs/handbook.md",
            filename: "handbook.md",
            source: { text: "@docs/handbook.md", start: 0, end: 17 },
          },
          { path: "docs/handbook.md", filename: "handbook.md" },
        ],
        "draft",
        JSON.stringify({
          root: {
            children: [
              {
                type: "paragraph",
                children: [
                  {
                    type: "composerMention",
                    kind: "file",
                    path: "docs/handbook.md",
                    label: "handbook.md",
                  },
                ],
              },
            ],
          },
        }),
      ),
    ).toEqual([
      {
        key: "draft:1:handbook.md",
        label: "handbook.md",
        path: "docs/handbook.md",
      },
    ]);
  });
});
