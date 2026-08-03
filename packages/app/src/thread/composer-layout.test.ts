import { describe, expect, it } from "vitest";

import { composerStateBandHeightPx, measuredComposerObstructionHeight } from "./composer-layout";

describe("thread composer obstruction", () => {
  it("reserves one state band without shifting for empty, compact, or full-band headers", () => {
    const inputHeightPx = composerStateBandHeightPx;

    expect(
      measuredComposerObstructionHeight({
        composerHeightPx: inputHeightPx,
        inputHeightPx,
      }),
    ).toBe(composerStateBandHeightPx * 2);
    expect(
      measuredComposerObstructionHeight({
        composerHeightPx: inputHeightPx + 28,
        inputHeightPx,
      }),
    ).toBe(composerStateBandHeightPx * 2);
    expect(
      measuredComposerObstructionHeight({
        composerHeightPx: inputHeightPx + composerStateBandHeightPx,
        inputHeightPx,
      }),
    ).toBe(composerStateBandHeightPx * 2);
  });

  it("uses live height only when content exceeds the reserved state band", () => {
    expect(
      measuredComposerObstructionHeight({
        composerHeightPx: composerStateBandHeightPx + 88,
        inputHeightPx: composerStateBandHeightPx,
      }),
    ).toBe(132);
    expect(
      measuredComposerObstructionHeight({
        composerHeightPx: 105.2,
        inputHeightPx: 61.2,
      }),
    ).toBe(106);
  });
});
