import { composerStateBandHeightPx } from "@honk/ui/tokens.stylex";

function measuredComposerObstructionHeight(input: {
  readonly composerHeightPx: number;
  readonly inputHeightPx: number;
}): number {
  return Math.ceil(
    input.inputHeightPx +
      Math.max(
        composerStateBandHeightPx,
        Math.max(0, input.composerHeightPx - input.inputHeightPx),
      ),
  );
}

export { composerStateBandHeightPx, measuredComposerObstructionHeight };
