import { describe, expect, it } from "vitest";

import {
  formatTurnFailureMessage,
  providerFailureFromAssistantMessageText,
} from "../src/provider-error";

describe("formatTurnFailureMessage", () => {
  it("formats Codex usage_limit_reached JSON with a reset hint", () => {
    const raw =
      'Codex error: {"type":"error","error":{"type":"usage_limit_reached","message":"The usage limit has been reached","plan_type":"pro","resets_at":1781748853,"resets_in_seconds":21883}}';

    const formatted = formatTurnFailureMessage(raw);

    expect(formatted).toContain("The usage limit has been reached");
    expect(formatted).toMatch(/Resets in about \d+ minutes\./);
  });

  it("strips provider and Codex wrappers from plain text", () => {
    expect(formatTurnFailureMessage("Provider error: Codex error: overloaded")).toBe("overloaded");
  });
});

describe("providerFailureFromAssistantMessageText", () => {
  it("normalizes stored provider-failure assistant message text", () => {
    expect(providerFailureFromAssistantMessageText("Provider error: Codex error: overloaded")).toBe(
      "overloaded",
    );
  });

  it("returns null for regular assistant text", () => {
    expect(providerFailureFromAssistantMessageText("Here is the answer.")).toBeNull();
  });
});
