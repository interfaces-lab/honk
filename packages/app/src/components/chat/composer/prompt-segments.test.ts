import { describe, expect, it } from "vitest";

import { splitPromptIntoComposerSegments } from "./prompt-segments";

describe("splitPromptIntoComposerSegments", () => {
  describe("skill tokens", () => {
    it("parses digit-leading bare skill tokens", () => {
      expect(splitPromptIntoComposerSegments("$9name ")).toEqual([
        { type: "skill", name: "9name" },
        { type: "text", text: " " },
      ]);
    });

    it("parses digit-leading markdown skill tokens", () => {
      expect(splitPromptIntoComposerSegments("[$9name](/tmp/skills/9name/SKILL.md) ")).toEqual([
        { type: "skill", name: "9name", path: "/tmp/skills/9name/SKILL.md" },
        { type: "text", text: " " },
      ]);
    });

    it("parses digit-leading skill names with the full tail character set", () => {
      expect(splitPromptIntoComposerSegments("run $9a-b:c_d now")).toEqual([
        { type: "text", text: "run " },
        { type: "skill", name: "9a-b:c_d" },
        { type: "text", text: " now" },
      ]);
    });

    it("still parses letter-leading bare skill tokens", () => {
      expect(splitPromptIntoComposerSegments("$deploy ")).toEqual([
        { type: "skill", name: "deploy" },
        { type: "text", text: " " },
      ]);
    });

    it("still parses letter-leading markdown skill tokens", () => {
      expect(splitPromptIntoComposerSegments("[$deploy](/x/SKILL.md) ")).toEqual([
        { type: "skill", name: "deploy", path: "/x/SKILL.md" },
        { type: "text", text: " " },
      ]);
    });

    it("does not parse a bare dollar sign as a skill", () => {
      expect(splitPromptIntoComposerSegments("$ name")).toEqual([{ type: "text", text: "$ name" }]);
    });

    it("keeps skill tokens after an opening paren as raw text (lead group unchanged)", () => {
      expect(splitPromptIntoComposerSegments("($deploy ")).toEqual([
        { type: "text", text: "($deploy " },
      ]);
      expect(splitPromptIntoComposerSegments("($9name ")).toEqual([
        { type: "text", text: "($9name " },
      ]);
    });
  });

  describe("mention tokens (regression)", () => {
    it("parses '@path ' mentions", () => {
      expect(splitPromptIntoComposerSegments("@src/index.ts ")).toEqual([
        { type: "mention", path: "src/index.ts" },
        { type: "text", text: " " },
      ]);
    });

    it("parses mentions embedded in text", () => {
      expect(splitPromptIntoComposerSegments("see @docs/readme.md please")).toEqual([
        { type: "text", text: "see " },
        { type: "mention", path: "docs/readme.md" },
        { type: "text", text: " please" },
      ]);
    });
  });

  describe("inline tokens (regression)", () => {
    it("parses '[@Label](file:///x) ' inline tokens", () => {
      expect(splitPromptIntoComposerSegments("[@Label](file:///x) ")).toEqual([
        {
          type: "inline-token",
          label: "Label",
          sourceUri: "file:///x",
          markdown: "[@Label](file:///x)",
        },
        { type: "text", text: " " },
      ]);
    });

    it("parses inline tokens embedded in text", () => {
      expect(
        splitPromptIntoComposerSegments("read [@Old chat](file:///tmp/s.jsonl) first"),
      ).toEqual([
        { type: "text", text: "read " },
        {
          type: "inline-token",
          label: "Old chat",
          sourceUri: "file:///tmp/s.jsonl",
          markdown: "[@Old chat](file:///tmp/s.jsonl)",
        },
        { type: "text", text: " first" },
      ]);
    });
  });

  it("parses mixed prompts with mention, skill, and inline-token segments", () => {
    expect(
      splitPromptIntoComposerSegments("@a/b.ts then $9name and [@T](file:///t.jsonl) done"),
    ).toEqual([
      { type: "mention", path: "a/b.ts" },
      { type: "text", text: " then " },
      { type: "skill", name: "9name" },
      { type: "text", text: " and " },
      {
        type: "inline-token",
        label: "T",
        sourceUri: "file:///t.jsonl",
        markdown: "[@T](file:///t.jsonl)",
      },
      { type: "text", text: " done" },
    ]);
  });
});
