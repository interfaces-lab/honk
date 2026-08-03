import { describe, expect, it } from "vitest";

import { suggestedModeForPrompt } from "./mode-suggestion";

const unused = { plan: false, debug: false } as const;

describe("suggestedModeForPrompt", () => {
  it.each([
    ["keyword", "Refactor the authentication boundary", "plan"],
    ["Chinese planning language", "请给出迁移方案", "plan"],
    ["terminal punctuation", "Make this safer?", "plan"],
    [
      "35 words",
      "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone twentytwo twentythree twentyfour twentyfive twentysix twentyseven twentyeight twentynine thirty thirtyone thirtytwo thirtythree thirtyfour thirtyfive",
      "plan",
    ],
    ["debug language", "Please debug this crash", "debug"],
  ])("suggests %s", (_case, prompt, expected) => {
    expect(suggestedModeForPrompt(prompt, "build", unused)).toBe(expected);
  });

  it("prefers an eligible plan suggestion over debug", () => {
    expect(suggestedModeForPrompt("Plan how to debug this bug", "build", unused)).toBe("plan");
  });

  it("does not suggest the current mode", () => {
    expect(suggestedModeForPrompt("Plan the migration", "plan", unused)).toBeNull();
    expect(suggestedModeForPrompt("Debug this issue", "debug", unused)).toBeNull();
  });

  it("respects each suggestion's used gate independently", () => {
    expect(
      suggestedModeForPrompt("Plan how to debug this bug", "build", { plan: true, debug: false }),
    ).toBe("debug");
    expect(
      suggestedModeForPrompt("Debug this issue", "build", { plan: false, debug: true }),
    ).toBeNull();
  });
});
