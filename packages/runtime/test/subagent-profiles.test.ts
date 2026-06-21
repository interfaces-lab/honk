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
});
