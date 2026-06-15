import { describe, expect, it } from "vitest";

import {
  DEFAULT_SUBAGENT_AGENT_NAME,
  resolveSubagentProfile,
} from "../src/subagent-profiles";

describe("resolveSubagentProfile", () => {
  it("only resolves Honk built-in subagent profiles", () => {
    expect(resolveSubagentProfile({ name: "scout" }).name).toBe("scout");
    expect(resolveSubagentProfile({ name: "oracle" }).name).toBe("oracle");
    expect(resolveSubagentProfile({ name: "custom-reviewer" }).name).toBe(
      DEFAULT_SUBAGENT_AGENT_NAME,
    );
  });

  it("applies model and tool overrides without turning unknown names into custom agents", () => {
    const profile = resolveSubagentProfile({
      name: "custom-reviewer",
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
