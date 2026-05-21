import { describe, expect, it } from "vitest";

import {
  selectionTouchesMentionBoundary,
  splitPromptIntoComposerSegments,
} from "./prompt-segments";

describe("splitPromptIntoComposerSegments", () => {
  it("splits mention tokens followed by whitespace into mention segments", () => {
    expect(splitPromptIntoComposerSegments("Inspect @AGENTS.md please")).toEqual([
      { type: "text", text: "Inspect " },
      { type: "mention", path: "AGENTS.md" },
      { type: "text", text: " please" },
    ]);
  });

  it("does not convert an incomplete trailing mention token", () => {
    expect(splitPromptIntoComposerSegments("Inspect @AGENTS.md")).toEqual([
      { type: "text", text: "Inspect @AGENTS.md" },
    ]);
  });

  it("keeps newlines around mention tokens", () => {
    expect(splitPromptIntoComposerSegments("one\n@src/index.ts \ntwo")).toEqual([
      { type: "text", text: "one\n" },
      { type: "mention", path: "src/index.ts" },
      { type: "text", text: " \ntwo" },
    ]);
  });

  it("splits skill tokens followed by whitespace into skill segments", () => {
    expect(splitPromptIntoComposerSegments("Use $review-follow-up please")).toEqual([
      { type: "text", text: "Use " },
      { type: "skill", name: "review-follow-up" },
      { type: "text", text: " please" },
    ]);
  });

  it("does not convert an incomplete trailing skill token", () => {
    expect(splitPromptIntoComposerSegments("Use $review-follow-up")).toEqual([
      { type: "text", text: "Use $review-follow-up" },
    ]);
  });

  it("splits markdown skill links followed by whitespace into skill segments", () => {
    expect(
      splitPromptIntoComposerSegments(
        "Use [$grill-me](/Users/workgyver/.agents/skills/grill-me/SKILL.md) please",
      ),
    ).toEqual([
      { type: "text", text: "Use " },
      {
        type: "skill",
        name: "grill-me",
        path: "/Users/workgyver/.agents/skills/grill-me/SKILL.md",
      },
      { type: "text", text: " please" },
    ]);
  });

  it("does not convert an incomplete trailing markdown skill link", () => {
    expect(
      splitPromptIntoComposerSegments(
        "Use [$grill-me](/Users/workgyver/.agents/skills/grill-me/SKILL.md)",
      ),
    ).toEqual([
      {
        type: "text",
        text: "Use [$grill-me](/Users/workgyver/.agents/skills/grill-me/SKILL.md)",
      },
    ]);
  });

  it("keeps skill parsing alongside mentions", () => {
    expect(splitPromptIntoComposerSegments("Inspect $review-follow-up after @AGENTS.md ")).toEqual([
      { type: "text", text: "Inspect " },
      { type: "skill", name: "review-follow-up" },
      { type: "text", text: " after " },
      { type: "mention", path: "AGENTS.md" },
      { type: "text", text: " " },
    ]);
  });
});

describe("selectionTouchesMentionBoundary", () => {
  it("returns true when selection includes the whitespace after a mention", () => {
    expect(
      selectionTouchesMentionBoundary(
        "hi @package.json there",
        "hi @package.json".length,
        "hi @package.json there".length,
      ),
    ).toBe(true);
  });

  it("returns true when selection includes the whitespace before a mention", () => {
    expect(
      selectionTouchesMentionBoundary(
        "hi there @package.json later",
        "hi there".length,
        "hi there ".length,
      ),
    ).toBe(true);
  });

  it("returns false when selection starts after the mention boundary whitespace", () => {
    expect(
      selectionTouchesMentionBoundary(
        "hi @package.json there",
        "hi @package.json ".length,
        "hi @package.json there".length,
      ),
    ).toBe(false);
  });

  it("returns true when selection includes whitespace after a leading mention", () => {
    const prompt = "@AGENTS.md there";
    expect(selectionTouchesMentionBoundary(prompt, "@AGENTS.md".length, prompt.length)).toBe(true);
  });
});
