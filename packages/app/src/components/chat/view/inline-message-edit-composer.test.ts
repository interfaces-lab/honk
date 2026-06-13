import { describe, expect, it } from "vitest";

import { isInlineEditSubmitDisabled } from "./inline-message-edit-composer";

describe("isInlineEditSubmitDisabled", () => {
  it("allows unchanged resend when the draft still has sendable content", () => {
    expect(isInlineEditSubmitDisabled({ hasSendableContent: true })).toBe(false);
  });

  it("blocks empty inline edit drafts", () => {
    expect(isInlineEditSubmitDisabled({ hasSendableContent: false })).toBe(true);
  });
});
