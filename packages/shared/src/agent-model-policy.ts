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
import {
  createCursorComposerAgentPolicyModelSelection,
  isCursorComposerPolicyModelSelection,
} from "./cursor-composer";

function thinkingLevelForAgentMode(agentMode: AgentPreferences["agentMode"]): AgentThinkingLevel {
  switch (agentMode) {
    case "rush":
      return "off";
    case "composer":
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
  const options = modelSelection.options?.map((option) => ({ ...option })) ?? [];
  return {
    type: "explicit",
    authProviderId,
    accountId: AccountId.make(`${authProviderId}:default`),
    modelId: ModelId.make(`${authProviderId}/${modelSelection.model}`),
    ...(options.length > 0 ? { options } : {}),
  };
}

function agentPolicyModelSelectionForPreferences(
  preferences: AgentPreferences,
  fallbackModelSelection: ModelSelection,
): AgentModelPolicy["modelSelection"] {
  if (preferences.agentMode !== "composer") {
    return agentPolicyModelSelectionForPinnedModel(fallbackModelSelection);
  }
  return isCursorComposerPolicyModelSelection(preferences.modelSelection)
    ? {
        ...preferences.modelSelection,
        ...(preferences.modelSelection.options
          ? { options: preferences.modelSelection.options.map((option) => ({ ...option })) }
          : {}),
      }
    : createCursorComposerAgentPolicyModelSelection();
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
  const modelSelection = agentPolicyModelSelectionForPreferences(
    input.preferences,
    input.modelSelection,
  );
  const modelThinkingLevel = selectedModelThinkingLevel({
    preferences: input.preferences,
    modelSelection,
  });
  return {
    agentMode: input.preferences.agentMode,
    interactionMode: input.interactionMode,
    modelSelection,
    thinkingLevel:
      input.preferences.agentMode === "rush" || input.preferences.agentMode === "composer"
        ? thinkingLevelForAgentMode(input.preferences.agentMode)
        : (modelThinkingLevel ?? input.preferences.thinkingLevel),
    allowedToolNames: [],
    excludedToolNames: [],
  };
}
