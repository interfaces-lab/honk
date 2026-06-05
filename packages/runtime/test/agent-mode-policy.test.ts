import { getModel } from "@earendil-works/pi-ai";
import { AGENT_THINKING_LEVELS } from "@multi/contracts";
import { describe, expect, it } from "vitest";
import {
  accountIdFromProvider,
  authProviderIdFromPiModel,
  createAuthStatus,
  createModelPolicy,
  modelIdFromPiModel,
  thinkingLevelForAgentMode,
} from "../src/auth-model-policy";

describe("agent mode policy", () => {
  it("derives canonical auth and model ids from Pi models", () => {
    const model = getModel("anthropic", "claude-sonnet-4-5");
    if (!model) throw new Error("Expected anthropic model");

    expect(authProviderIdFromPiModel(model)).toBe("anthropic");
    expect(modelIdFromPiModel(model)).toBe("anthropic/claude-sonnet-4-5");
    expect(accountIdFromProvider(model.provider)).toBe("anthropic:default");
  });

  it("clamps thinking and preserves runtime policy defaults", () => {
    const model = getModel("openai", "gpt-4.1");
    if (!model) throw new Error("Expected openai model");
    const policy = createModelPolicy({
      model,
      thinkingLevel: "high",
      allowedToolNames: ["read", "write"],
    });

    expect(policy.agentMode).toBe("deep");
    expect(policy.interactionMode).toBe("agent");
    expect(policy.modelSelection).toEqual({
      type: "explicit",
      authProviderId: model.provider,
      accountId: `${model.provider}:default`,
      modelId: `${model.provider}/${model.id}`,
    });
    expect(policy.allowedToolNames).toEqual(["read", "write"]);
    expect(AGENT_THINKING_LEVELS).toContain(policy.thinkingLevel);
  });

  it("maps agent modes to default thinking levels", () => {
    expect(thinkingLevelForAgentMode("rush")).toBe("off");
    expect(thinkingLevelForAgentMode("smart")).toBe("medium");
    expect(thinkingLevelForAgentMode("deep")).toBe("high");
    expect(createModelPolicy({ agentMode: "deep" })).toMatchObject({
      agentMode: "deep",
      modelSelection: { type: "pi-managed" },
      thinkingLevel: "high",
    });
    expect(createModelPolicy({ agentMode: "deep", thinkingLevel: "xhigh" })).toMatchObject({
      agentMode: "deep",
      modelSelection: { type: "pi-managed" },
      thinkingLevel: "xhigh",
    });
  });

  it("reports missing and available auth states without provider-driver identity", () => {
    const model = getModel("anthropic", "claude-sonnet-4-5");
    if (!model) throw new Error("Expected anthropic model");
    const authProviderId = authProviderIdFromPiModel(model);

    expect(createAuthStatus({ authProviderId, hasCredential: false }).state).toBe("missing");
    expect(createAuthStatus({ authProviderId, hasCredential: true }).state).toBe("available");
  });
});
