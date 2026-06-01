import { getModel } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
  accountIdFromProvider,
  authProviderIdFromPiModel,
  createAuthStatus,
  createModelPolicy,
  modelIdFromPiModel,
} from "../src/auth-model-policy";

describe("agent mode policy", () => {
  it("derives canonical auth and model ids from Pi models", () => {
    const model = getModel("anthropic", "claude-sonnet-4-5")!;

    expect(authProviderIdFromPiModel(model)).toBe("anthropic");
    expect(modelIdFromPiModel(model)).toBe("anthropic/claude-sonnet-4-5");
    expect(accountIdFromProvider(model.provider)).toBe("anthropic:default");
  });

  it("clamps thinking and preserves runtime policy defaults", () => {
    const model = getModel("openai", "gpt-4.1")!;
    const policy = createModelPolicy({
      model,
      thinkingLevel: "high",
      allowedToolNames: ["read", "write"],
    });

    expect(policy.interactionMode).toBe("default");
    expect(policy.permissionMode).toBe("project-write");
    expect(policy.modelId).toBe(`${model.provider}/${model.id}`);
    expect(policy.allowedToolNames).toEqual(["read", "write"]);
    expect(["off", "low", "medium", "high"]).toContain(policy.thinkingLevel);
  });

  it("reports missing and available auth states without provider-driver identity", () => {
    const authProviderId = authProviderIdFromPiModel(getModel("anthropic", "claude-sonnet-4-5")!);

    expect(createAuthStatus({ authProviderId, hasCredential: false }).state).toBe("missing");
    expect(createAuthStatus({ authProviderId, hasCredential: true }).state).toBe("available");
  });
});
