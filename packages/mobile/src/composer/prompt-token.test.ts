import { describe, expect, it } from "vitest";

import {
  applyPromptSuggestion,
  detectPromptToken,
  mergePromptCommands,
  rankPromptCommands,
  rankPromptFiles,
} from "./prompt-token";

describe("detectPromptToken", () => {
  it("opens the command menu on a trigger at the start of the input", () => {
    expect(detectPromptToken("/", 1)).toEqual({ kind: "command", query: "", start: 0, end: 1 });
    expect(detectPromptToken("/rev", 4)).toEqual({
      kind: "command",
      query: "rev",
      start: 0,
      end: 4,
    });
  });

  it("opens the file menu on a trigger at the start of the input", () => {
    expect(detectPromptToken("@", 1)).toEqual({ kind: "file", query: "", start: 0, end: 1 });
  });

  it("opens only when the trigger follows whitespace", () => {
    expect(detectPromptToken("fix a/b", 7)).toBeNull();
    expect(detectPromptToken("mail foo@bar", 12)).toBeNull();
    expect(detectPromptToken("fix the /re", 11)).toEqual({
      kind: "command",
      query: "re",
      start: 8,
      end: 11,
    });
    expect(detectPromptToken("look at @src", 12)).toEqual({
      kind: "file",
      query: "src",
      start: 8,
      end: 12,
    });
  });

  it("treats a newline as opening whitespace", () => {
    expect(detectPromptToken("hi\n/pl", 6)).toEqual({
      kind: "command",
      query: "pl",
      start: 3,
      end: 6,
    });
  });

  it("closes once a space is typed", () => {
    expect(detectPromptToken("/plan ", 6)).toBeNull();
    expect(detectPromptToken("@src ", 5)).toBeNull();
  });

  it("closes on a second @", () => {
    expect(detectPromptToken("@a@", 3)).toBeNull();
  });

  it("stays open with an empty query", () => {
    expect(detectPromptToken("do @", 4)).toEqual({ kind: "file", query: "", start: 3, end: 4 });
  });

  it("reopens when the cursor sits at the end of an already-completed token", () => {
    expect(detectPromptToken("@src/foo.ts and more", 11)).toEqual({
      kind: "file",
      query: "src/foo.ts",
      start: 0,
      end: 11,
    });
  });

  it("reports a range that stops at the cursor inside a completed token", () => {
    expect(detectPromptToken("@src/foo.ts and more", 6)).toEqual({
      kind: "file",
      query: "src/f",
      start: 0,
      end: 6,
    });
  });

  it("prefers the command trigger when both could match", () => {
    expect(detectPromptToken("@a /b", 5)?.kind).toBe("command");
  });

  it("returns null for an out-of-range cursor", () => {
    expect(detectPromptToken("/plan", -1)).toBeNull();
    expect(detectPromptToken("/plan", 6)).toBeNull();
  });
});

describe("applyPromptSuggestion", () => {
  it("replaces the trigger and query, then leaves the cursor past a trailing space", () => {
    const token = detectPromptToken("@src", 4);
    expect(token).not.toBeNull();
    expect(applyPromptSuggestion("@src", token!, "@src/foo.ts")).toEqual({
      text: "@src/foo.ts ",
      cursor: 12,
    });
  });

  it("keeps text after the cursor", () => {
    const token = detectPromptToken("look at @sr tomorrow", 11);
    expect(applyPromptSuggestion("look at @sr tomorrow", token!, "@src/foo.ts")).toEqual({
      text: "look at @src/foo.ts tomorrow",
      cursor: 20,
    });
  });

  it("does not stack a second space on one already there", () => {
    const token = detectPromptToken("/pl next", 3);
    expect(applyPromptSuggestion("/pl next", token!, "/plan")).toEqual({
      text: "/plan next",
      cursor: 6,
    });
  });
});

describe("mergePromptCommands", () => {
  it("lists skills first and drops commands that collide with a skill", () => {
    expect(
      mergePromptCommands({
        skills: [
          { name: "review", description: "Review a diff" },
          { name: "hidden", slash: false },
        ],
        commands: [{ name: "review" }, { name: "deploy", description: "Ship it" }],
      }),
    ).toEqual([
      { name: "review", description: "Review a diff", isSkill: true },
      { name: "deploy", description: "Ship it", isSkill: false },
    ]);
  });
});

describe("rankPromptCommands", () => {
  const entries = [
    { name: "skill-a", description: "A", isSkill: true },
    { name: "skill-b", description: "B", isSkill: true },
    { name: "skill-c", description: "C", isSkill: true },
    { name: "skill-d", description: "D", isSkill: true },
    { name: "cmd-a", description: "", isSkill: false },
    { name: "cmd-b", description: "b", isSkill: false },
    { name: "cmd-c", description: "c", isSkill: false },
    { name: "cmd-d", description: "d", isSkill: false },
  ];

  it("caps each section at three while browsing an empty query", () => {
    expect(rankPromptCommands(entries, "").map((item) => item.title)).toEqual([
      "skill-a",
      "skill-b",
      "skill-c",
      "cmd-a",
      "cmd-b",
      "cmd-c",
    ]);
  });

  it("filters by a case-insensitive substring of the name", () => {
    expect(rankPromptCommands(entries, "L-D").map((item) => item.title)).toEqual(["skill-d"]);
  });

  it("carries the insert text, section, and a null detail for an empty description", () => {
    expect(rankPromptCommands(entries, "cmd-a")).toEqual([
      {
        key: "command:cmd-a",
        title: "cmd-a",
        detail: null,
        section: "Commands",
        insert: "/cmd-a",
      },
    ]);
  });
});

describe("rankPromptFiles", () => {
  it("keeps server order and shows the basename over the full path", () => {
    expect(
      rankPromptFiles([
        { path: "src/composer/prompt-token.ts", type: "file" },
        { path: "src/composer/", type: "directory" },
      ]),
    ).toEqual([
      {
        key: "file:src/composer/prompt-token.ts",
        title: "prompt-token.ts",
        detail: "src/composer/prompt-token.ts",
        section: "Files & folders",
        insert: "@src/composer/prompt-token.ts",
      },
      {
        key: "directory:src/composer/",
        title: "composer",
        detail: "src/composer/",
        section: "Files & folders",
        insert: "@src/composer/",
      },
    ]);
  });

  it("caps the list at the shared maximum", () => {
    expect(
      rankPromptFiles(
        Array.from({ length: 40 }, (_, index) => ({ path: `f${index}.ts`, type: "file" as const })),
      ),
    ).toHaveLength(32);
  });
});
