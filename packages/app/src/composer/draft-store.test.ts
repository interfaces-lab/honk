import { afterEach, describe, expect, it } from "vitest";

import { readComposerDraft, writeComposerDraft } from "./draft-store";

const KEY = "test:composer-draft";

afterEach(() => {
  writeComposerDraft(KEY, { text: "", files: [] });
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

  it("removes the saved draft after a successful clear", () => {
    writeComposerDraft(KEY, { text: "sent", files: [] });
    writeComposerDraft(KEY, { text: "", files: [] });

    expect(readComposerDraft(KEY)).toBeUndefined();
  });
});
