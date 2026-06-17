import { describe, expect, it } from "vitest";

import { deriveSidebarDraftTitle } from "./view-model";

describe("deriveSidebarDraftTitle", () => {
  it("labels empty drafts as New Agent", () => {
    expect(
      deriveSidebarDraftTitle({
        attachmentCount: 0,
        firstAttachmentName: null,
        text: "",
      }),
    ).toBe("New Agent");
  });
});
