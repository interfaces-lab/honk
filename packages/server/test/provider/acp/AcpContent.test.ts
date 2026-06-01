import { describe, expect, it } from "vitest";

import {
  compactAcpContentBlocks,
  imageBytesToAcpContentBlock,
  textToAcpContentBlock,
} from "../../../src/provider/acp/AcpContent.ts";

// Adapted from anomalyco/opencode packages/opencode/test/acp/content.test.ts for Multi's client-side prompt path.
describe("AcpContent", () => {
  it("converts non-empty text to an ACP text content block", () => {
    expect(textToAcpContentBlock("hello")).toEqual({ type: "text", text: "hello" });
    expect(textToAcpContentBlock("")).toBeUndefined();
  });

  it("converts image bytes to an ACP image content block", () => {
    expect(
      imageBytesToAcpContentBlock({
        bytes: new Uint8Array([1, 2, 3, 4]),
        mimeType: "image/png",
      }),
    ).toEqual({
      type: "image",
      data: "AQIDBA==",
      mimeType: "image/png",
    });
  });

  it("compacts optional content blocks for Cursor prompts", () => {
    expect(
      compactAcpContentBlocks([
        undefined,
        { type: "text", text: "Use this image" },
        imageBytesToAcpContentBlock({
          bytes: new Uint8Array([255]),
          mimeType: "image/jpeg",
        }),
      ]),
    ).toEqual([
      { type: "text", text: "Use this image" },
      { type: "image", data: "/w==", mimeType: "image/jpeg" },
    ]);
  });
});
