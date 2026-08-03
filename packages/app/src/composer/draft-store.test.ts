import { afterEach, describe, expect, it } from "vitest";

import { readComposerDraft, writeComposerDraft } from "./draft-store";

const KEY = "test:composer-draft";
const OTHER_KEY = "test:composer-draft:other";

afterEach(() => {
  writeComposerDraft(KEY, { text: "", files: [] });
  writeComposerDraft(OTHER_KEY, { text: "", files: [] });
});

describe("composer draft store", () => {
  it("retains text and attachments across composer remounts", () => {
    writeComposerDraft(KEY, {
      text: "keep this reply",
      files: [{ path: "/tmp/context.ts", filename: "context.ts", mime: "text/typescript" }],
    });

    expect(readComposerDraft(KEY)).toEqual({
      text: "keep this reply",
      files: [{ path: "/tmp/context.ts", filename: "context.ts", mime: "text/typescript" }],
    });
  });

  it("retains Lexical state so inline tokens restore in place", () => {
    writeComposerDraft(KEY, {
      text: "review ",
      files: [],
      editorState: '{"root":{"children":[]}}',
    });

    expect(readComposerDraft(KEY)?.editorState).toBe('{"root":{"children":[]}}');
  });

  it("retains file-mention source ranges across composer remounts", () => {
    writeComposerDraft(KEY, {
      text: "Review @docs/handbook.md",
      files: [
        {
          path: "docs/handbook.md",
          filename: "handbook.md",
          source: { text: "@docs/handbook.md", start: 7, end: 24 },
        },
      ],
    });

    expect(readComposerDraft(KEY)?.files[0]?.source).toEqual({
      text: "@docs/handbook.md",
      start: 7,
      end: 24,
    });
  });

  it("removes the saved draft after a successful clear", () => {
    writeComposerDraft(KEY, { text: "sent", files: [] });
    writeComposerDraft(KEY, { text: "", files: [] });

    expect(readComposerDraft(KEY)).toBeUndefined();
  });

  it("keeps drafts isolated by conversation", () => {
    writeComposerDraft(KEY, { text: "first conversation", files: [] });
    writeComposerDraft(OTHER_KEY, { text: "second conversation", files: [] });

    expect(readComposerDraft(KEY)?.text).toBe("first conversation");
    expect(readComposerDraft(OTHER_KEY)?.text).toBe("second conversation");

    writeComposerDraft(KEY, { text: "", files: [] });

    expect(readComposerDraft(KEY)).toBeUndefined();
    expect(readComposerDraft(OTHER_KEY)?.text).toBe("second conversation");
  });
});
