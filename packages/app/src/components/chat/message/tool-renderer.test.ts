import { describe, expect, it } from "vitest";

import {
  hasRenderableText,
  hasShellToolPotentialOutput,
  resolveStreamingShellOutput,
} from "./tool-renderer";

describe("tool renderer shell output helpers", () => {
  it("detects renderable shell output without trimming the full string", () => {
    expect(hasRenderableText(null)).toBe(false);
    expect(hasRenderableText(" \n\t\r")).toBe(false);
    expect(hasRenderableText("\n  pushed to origin")).toBe(true);
  });

  it("uses output presence as the collapsed shell expansion predicate", () => {
    expect(hasShellToolPotentialOutput(null)).toBe(false);
    expect(hasShellToolPotentialOutput("")).toBe(false);
    expect(hasShellToolPotentialOutput(" \n")).toBe(true);
  });

  it("shows only the latest complete output lines while a large command is streaming", () => {
    const output = `${"x".repeat(12_010)}\nlatest line`;

    expect(resolveStreamingShellOutput(output, true)).toEqual({
      text: "latest line",
      truncated: true,
    });
    expect(resolveStreamingShellOutput(output, false)).toEqual({
      text: output,
      truncated: false,
    });
  });
});
