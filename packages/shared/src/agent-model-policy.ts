import {
  AccountId,
  AuthProviderId,
  ModelId,
  DEFAULT_TEXT_GENERATION_MODEL_SELECTION,
  type AgentInteractionMode,
  type AgentModelPolicy,
  type AgentPreferences,
  type AgentThinkingLevel,
} from "@multi/contracts";

function thinkingLevelForAgentMode(agentMode: AgentPreferences["agentMode"]): AgentThinkingLevel {
  switch (agentMode) {
    case "rush":
      return "off";
    case "smart":
      return "medium";
    case "deep":
      return "high";
  }
}

function canonicalPolicyModelSelection(): AgentModelPolicy["modelSelection"] {
  const selection = DEFAULT_TEXT_GENERATION_MODEL_SELECTION;
  const provider = selection.instanceId.trim();
  const model = selection.model.trim();
  if (!provider || !model) {
    throw new Error("Default text generation model selection is invalid.");
  }

  const authProviderId = AuthProviderId.make(
    provider === "codex" ? "openai-codex" : provider,
  );
  return {
    type: "explicit",
    authProviderId,
    accountId: AccountId.make(`${authProviderId}:default`),
    modelId: ModelId.make(`${provider}/${model}`),
  };
}

export function createAgentModelPolicy(input: {
  readonly preferences: AgentPreferences;
  readonly interactionMode: AgentInteractionMode;
}): AgentModelPolicy {
  return {
    agentMode: input.preferences.agentMode,
    interactionMode: input.interactionMode,
    modelSelection: canonicalPolicyModelSelection(),
    thinkingLevel:
      input.preferences.agentMode === "rush"
        ? thinkingLevelForAgentMode(input.preferences.agentMode)
        : input.preferences.thinkingLevel,
    allowedToolNames: [],
    excludedToolNames: [],
  };
}
