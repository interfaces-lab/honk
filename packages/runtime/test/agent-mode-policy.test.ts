import type { Model } from "@earendil-works/pi-ai/base";
import { AGENT_THINKING_LEVELS } from "@honk/contracts";
import { describe, expect, it } from "vitest";
import {
  accountIdFromProvider,
  authProviderIdFromPiModel,
  createAuthStatus,
  createModelPolicy,
  modelIdFromPiModel,
  thinkingLevelForAgentMode,
} from "../src/auth-model-policy";

const anthropicModel: Model<"anthropic-messages"> = {
  id: "claude-opus-4-8",
  name: "Claude Opus 4.8",
  api: "anthropic-messages",
  provider: "anthropic",
  baseUrl: "https://api.anthropic.com",
  reasoning: true,
  input: ["text", "image"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200_000,
  maxTokens: 32_000,
};

const openAiModel: Model<"openai-responses"> = {
  id: "gpt-5.5",
  name: "GPT-5.5",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  reasoning: true,
  input: ["text", "image"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 400_000,
  maxTokens: 128_000,
};

describe("agent mode policy", () => {
  it("derives canonical auth and model ids from Pi models", () => {
    const model = anthropicModel;

    expect(authProviderIdFromPiModel(model)).toBe("anthropic");
    expect(modelIdFromPiModel(model)).toBe("anthropic/claude-opus-4-8");
    expect(accountIdFromProvider(model.provider)).toBe("anthropic:default");
  });

  it("clamps thinking and preserves runtime policy defaults", () => {
    const model = openAiModel;
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
    const model = anthropicModel;
    const authProviderId = authProviderIdFromPiModel(model);

    expect(createAuthStatus({ authProviderId, hasCredential: false }).state).toBe("missing");
    expect(createAuthStatus({ authProviderId, hasCredential: true }).state).toBe("available");
  });
});
