import {
  DEFAULT_AGENT_POLICY_MODEL_SELECTION,
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
}): AgentModelPolicy {
  const modelSelection = input.preferences.modelSelection ?? DEFAULT_AGENT_POLICY_MODEL_SELECTION;
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
