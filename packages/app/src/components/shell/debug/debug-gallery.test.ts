import { describe, expect, it } from "vitest";

import { cursorNativePreviewTitles } from "./cursor-native-previews";

describe("debug intents composer page", () => {
  it("keeps at least one native preview key for gallery tooling", () => {
    expect(cursorNativePreviewTitles.length).toBeGreaterThan(0);
  });

  it("includes workbench titles used by CursorNativePreview map", () => {
    for (const title of [
      "ShellToolCallFull",
      "ShellToolCallCompleted",
      "FileToolCardEdit",
      "AgentPanelToolStack",
    ] as const) {
      expect(cursorNativePreviewTitles).toContain(title);
    }
  });
});
