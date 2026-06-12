import {
  AccountId,
  AuthProviderId,
  ModelId,
  type AgentInteractionMode,
  type AgentModelPolicy,
  type AgentPreferences,
  type AgentThinkingLevel,
  type ModelSelection,
} from "@honk/contracts";

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

export function authProviderIdForModelSelection(modelSelection: ModelSelection): AuthProviderId {
  switch (modelSelection.instanceId) {
    case "claudeAgent":
      return AuthProviderId.make("anthropic");
    case "codex":
      return AuthProviderId.make("openai-codex");
    default:
      return AuthProviderId.make(modelSelection.instanceId);
  }
}

export function agentPolicyModelSelectionForPinnedModel(
  modelSelection: ModelSelection,
): AgentModelPolicy["modelSelection"] {
  const authProviderId = authProviderIdForModelSelection(modelSelection);
  return {
    type: "explicit",
    authProviderId,
    accountId: AccountId.make(`${authProviderId}:default`),
    modelId: ModelId.make(`${authProviderId}/${modelSelection.model}`),
  };
}

function selectedModelThinkingLevel(input: {
  readonly preferences: AgentPreferences;
  readonly modelSelection: AgentModelPolicy["modelSelection"];
}): AgentThinkingLevel | undefined {
  if (input.modelSelection.type !== "explicit") {
    return undefined;
  }
  return input.preferences.modelSettingsByModelId[input.modelSelection.modelId]?.thinkingLevel;
}

export function createAgentModelPolicy(input: {
  readonly preferences: AgentPreferences;
  readonly interactionMode: AgentInteractionMode;
  readonly modelSelection: ModelSelection;
}): AgentModelPolicy {
  const modelSelection = agentPolicyModelSelectionForPinnedModel(input.modelSelection);
  const modelThinkingLevel = selectedModelThinkingLevel({
    preferences: input.preferences,
    modelSelection,
  });
  return {
    agentMode: input.preferences.agentMode,
    interactionMode: input.interactionMode,
    modelSelection,
    thinkingLevel:
      input.preferences.agentMode === "rush"
        ? thinkingLevelForAgentMode(input.preferences.agentMode)
        : (modelThinkingLevel ?? input.preferences.thinkingLevel),
    allowedToolNames: [],
    excludedToolNames: [],
  };
}
