import { describe, expect, it } from "vitest";

import { resolveComposerThreadTitle } from "./composer-submit";

describe("resolveComposerThreadTitle", () => {
  it("labels empty submissions as New Agent", () => {
    expect(
      resolveComposerThreadTitle({
        composerImages: [],
        trimmedPrompt: "",
      }),
    ).toBe("New Agent");
  });
});
