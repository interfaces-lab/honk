import { describe, expect, it } from "vitest";

import { DEFAULT_SUBAGENT_AGENT_NAME, resolveSubagentProfile } from "../src/subagent-profiles";

describe("resolveSubagentProfile", () => {
  it("only resolves Honk built-in subagent profiles", () => {
    expect(resolveSubagentProfile({ name: "librarian" }).name).toBe("librarian");
    expect(resolveSubagentProfile({ name: "oracle" }).name).toBe("oracle");
    expect(() => resolveSubagentProfile({ name: "custom-reviewer" })).toThrow(
      'Unknown subagent agent type "custom-reviewer"',
    );
  });

  it("applies model and tool overrides to the default agent", () => {
    const profile = resolveSubagentProfile({
      name: null,
      overrides: {
        model: "provider/model",
        tools: ["read", "grep"],
      },
    });

    expect(profile.name).toBe(DEFAULT_SUBAGENT_AGENT_NAME);
    expect(profile.model).toBe("provider/model");
    expect(profile.tools).toEqual(["read", "grep"]);
  });

  it("keeps reconnaissance specialists on true read-only tools", () => {
    expect(resolveSubagentProfile({ name: "librarian" }).tools).toEqual([
      "read",
      "grep",
      "find",
      "ls",
    ]);
    expect(resolveSubagentProfile({ name: "oracle" }).tools).toEqual([
      "read",
      "grep",
      "find",
      "ls",
    ]);
  });

  it("runs the librarian on GPT-5.5 medium by default", () => {
    expect(resolveSubagentProfile({ name: "librarian" })).toMatchObject({
      model: "openai-codex/gpt-5.5",
      thinkingLevel: "medium",
    });
  });
});
