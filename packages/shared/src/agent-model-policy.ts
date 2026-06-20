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
import { cursorComposerFastEnabled, cursorComposerPolicyModelSelection } from "./cursor-composer";

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

export function resolveAgentModeForModelSelection(
  modelSelection: ModelSelection,
  preferredAgentMode: AgentPreferences["agentMode"],
): AgentPreferences["agentMode"] {
  const authProviderId = authProviderIdForModelSelection(modelSelection);
  if (authProviderId === "cursor") {
    return "composer";
  }
  if (preferredAgentMode !== "composer") {
    return preferredAgentMode;
  }
  if (authProviderId === "anthropic") {
    return "smart";
  }
  return "deep";
}

function agentPolicyModelSelectionForPreferences(input: {
  preferences: AgentPreferences;
  modelSelection: ModelSelection;
  agentMode: AgentPreferences["agentMode"];
}): AgentModelPolicy["modelSelection"] {
  if (input.agentMode !== "composer") {
    return agentPolicyModelSelectionForPinnedModel(input.modelSelection);
  }
  return cursorComposerPolicyModelSelection(
    cursorComposerFastEnabled(input.preferences.modelSelection),
  );
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
  const agentMode = resolveAgentModeForModelSelection(
    input.modelSelection,
    input.preferences.agentMode,
  );
  const modelSelection = agentPolicyModelSelectionForPreferences({
    preferences: input.preferences,
    modelSelection: input.modelSelection,
    agentMode,
  });
  const modelThinkingLevel = selectedModelThinkingLevel({
    preferences: input.preferences,
    modelSelection,
  });
  return {
    agentMode,
    interactionMode: input.interactionMode,
    modelSelection,
    fast: input.preferences.fast,
    thinkingLevel:
      agentMode === "rush" || agentMode === "composer" || input.preferences.agentMode === "composer"
        ? thinkingLevelForAgentMode(agentMode)
        : (modelThinkingLevel ?? input.preferences.thinkingLevel),
    allowedToolNames: [],
    excludedToolNames: [],
  };
}
