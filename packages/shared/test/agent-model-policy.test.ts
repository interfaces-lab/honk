import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_RESOURCE_PREFERENCES } from "@multi/contracts";
import { createAgentModelPolicy } from "../src/agent-model-policy";

const preferences = {
  agentMode: "deep",
  interactionMode: "agent",
  thinkingLevel: "high",
  resources: DEFAULT_AGENT_RESOURCE_PREFERENCES,
  credentials: [],
} as const;

describe("createAgentModelPolicy", () => {
  it("maps rush to GPT 5.5 with no thinking", () => {
    const policy = createAgentModelPolicy({
      preferences: { ...preferences, agentMode: "rush", thinkingLevel: "xhigh" },
      interactionMode: "plan",
    });

    expect(policy).toMatchObject({
      agentMode: "rush",
      interactionMode: "plan",
      thinkingLevel: "off",
      modelSelection: {
        type: "explicit",
        authProviderId: "openai-codex",
        accountId: "openai-codex:default",
        modelId: "codex/gpt-5.5",
      },
    });
  });

  it("keeps smart and deep thinking user-adjustable", () => {
    expect(
      createAgentModelPolicy({
        preferences: { ...preferences, agentMode: "smart", thinkingLevel: "low" },
        interactionMode: "agent",
      }),
    ).toMatchObject({
      agentMode: "smart",
      thinkingLevel: "low",
      modelSelection: {
        type: "explicit",
        authProviderId: "openai-codex",
        accountId: "openai-codex:default",
        modelId: "codex/gpt-5.5",
      },
    });
  });
});
