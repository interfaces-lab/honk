import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_POLICY_MODEL_SELECTION,
  DEFAULT_AGENT_RESOURCE_PREFERENCES,
} from "@honk/contracts";
import { createAgentModelPolicy } from "../src/agent-model-policy";
import { cursorComposerPolicyModelSelection } from "../src/cursor-composer";

const preferences = {
  agentMode: "deep",
  interactionMode: "agent",
  modelSelection: DEFAULT_AGENT_POLICY_MODEL_SELECTION,
  modelSettingsByModelId: {},
  fast: false,
  thinkingLevel: "high",
  resources: DEFAULT_AGENT_RESOURCE_PREFERENCES,
  credentials: [],
} as const;

const codexModelSelection = {
  instanceId: "codex",
  model: "gpt-5.5",
} as const;

const claudeModelSelection = {
  instanceId: "claudeAgent",
  model: "claude-opus-4-8",
} as const;

describe("createAgentModelPolicy", () => {
  it("uses the pinned Codex model with no thinking in rush mode", () => {
    const policy = createAgentModelPolicy({
      preferences: { ...preferences, agentMode: "rush", thinkingLevel: "xhigh" },
      interactionMode: "plan",
      modelSelection: codexModelSelection,
    });

    expect(policy).toMatchObject({
      agentMode: "rush",
      interactionMode: "plan",
      thinkingLevel: "off",
      modelSelection: {
        type: "explicit",
        authProviderId: "openai-codex",
        accountId: "openai-codex:default",
        modelId: "openai-codex/gpt-5.5",
      },
    });
  });

  it("uses the pinned Claude model independent of agent mode", () => {
    expect(
      createAgentModelPolicy({
        preferences: { ...preferences, agentMode: "smart", thinkingLevel: "low" },
        interactionMode: "agent",
        modelSelection: claudeModelSelection,
      }),
    ).toMatchObject({
      agentMode: "smart",
      thinkingLevel: "low",
      modelSelection: {
        authProviderId: "anthropic",
        accountId: "anthropic:default",
        modelId: "anthropic/claude-opus-4-8",
      },
    });
  });

  it("uses the pinned Codex model with user-adjustable thinking", () => {
    expect(
      createAgentModelPolicy({
        preferences: { ...preferences, agentMode: "deep", thinkingLevel: "xhigh" },
        interactionMode: "agent",
        modelSelection: codexModelSelection,
      }),
    ).toMatchObject({
      agentMode: "deep",
      thinkingLevel: "xhigh",
      modelSelection: {
        authProviderId: "openai-codex",
        accountId: "openai-codex:default",
        modelId: "openai-codex/gpt-5.5",
      },
    });
  });

  it("pins Composer mode to the Cursor Composer model and preserves fast mode", () => {
    expect(
      createAgentModelPolicy({
        preferences: {
          ...preferences,
          agentMode: "composer",
          thinkingLevel: "xhigh",
          modelSelection: cursorComposerPolicyModelSelection(true),
        },
        interactionMode: "agent",
        modelSelection: codexModelSelection,
      }),
    ).toMatchObject({
      agentMode: "composer",
      thinkingLevel: "off",
      modelSelection: {
        type: "explicit",
        authProviderId: "cursor",
        accountId: "cursor:default",
        modelId: "cursor/composer-2-5",
        options: [{ id: "fast", value: true }],
      },
    });
  });
});
