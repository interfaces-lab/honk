import {
  AGENT_CONFIGURABLE_THINKING_LEVELS,
  AGENT_MODES,
  type AgentAuthStatus,
  type AgentMode,
  type AgentThinkingLevel,
  type ModelSelection,
} from "@honk/contracts";
import { authProviderIdForModelSelection } from "@honk/shared/agent-model-policy";

export interface AgentModeAvailability {
  readonly anthropic: boolean;
  readonly codex: boolean;
}

export function deriveAgentModeAvailability(
  authStatuses: readonly AgentAuthStatus[],
): AgentModeAvailability {
  return {
    anthropic: authStatuses.some(
      (status) => status.authProviderId === "anthropic" && status.state === "available",
    ),
    codex: authStatuses.some(
      (status) =>
        (status.authProviderId === "openai-codex" || status.authProviderId === "openai") &&
        status.state === "available",
    ),
  };
}

export function isAgentModeAvailable(
  mode: AgentMode,
  availability: AgentModeAvailability,
): boolean {
  return mode === "smart" ? availability.anthropic : availability.codex;
}

export function unavailableAgentModeReason(
  mode: AgentMode,
  availability: AgentModeAvailability,
): string | null {
  if (isAgentModeAvailable(mode, availability)) {
    return null;
  }
  return mode === "smart" ? "Requires Claude sign-in." : "Requires Codex sign-in.";
}

export function isModelSelectionAvailable(
  modelSelection: ModelSelection,
  availability: AgentModeAvailability,
): boolean {
  const authProviderId = authProviderIdForModelSelection(modelSelection);
  if (authProviderId === "anthropic") {
    return availability.anthropic;
  }
  if (authProviderId === "openai-codex" || authProviderId === "openai") {
    return availability.codex;
  }
  return true;
}

export function unavailableModelSelectionReason(
  modelSelection: ModelSelection,
  availability: AgentModeAvailability,
): string | null {
  if (isModelSelectionAvailable(modelSelection, availability)) {
    return null;
  }
  return authProviderIdForModelSelection(modelSelection) === "anthropic"
    ? "Requires Claude sign-in."
    : "Requires Codex sign-in.";
}

export const AGENT_MODE_LABELS: Record<AgentMode, string> = {
  rush: "Rush",
  smart: "Smart",
  deep: "Deep",
};

export const AGENT_MODE_THINKING_LEVELS: Record<AgentMode, AgentThinkingLevel> = {
  rush: "off",
  smart: "medium",
  deep: "high",
};

export const AGENT_MODE_OPTIONS = AGENT_MODES.map((value) => ({
  value,
  label: AGENT_MODE_LABELS[value],
}));

export const AGENT_THINKING_LEVEL_LABELS: Record<AgentThinkingLevel, string> = {
  off: "Off",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "XHigh",
};

export type ConfigurableAgentThinkingLevel = (typeof AGENT_CONFIGURABLE_THINKING_LEVELS)[number];

export const AGENT_THINKING_LEVEL_OPTIONS = AGENT_CONFIGURABLE_THINKING_LEVELS.map((value) => ({
  value,
  label: AGENT_THINKING_LEVEL_LABELS[value],
}));

export function isAgentThinkingLevelConfigurable(
  thinkingLevel: AgentThinkingLevel,
): thinkingLevel is ConfigurableAgentThinkingLevel {
  return (AGENT_CONFIGURABLE_THINKING_LEVELS as readonly AgentThinkingLevel[]).includes(
    thinkingLevel,
  );
}

export function normalizedConfigurableThinkingLevel(
  thinkingLevel: AgentThinkingLevel,
): ConfigurableAgentThinkingLevel {
  return isAgentThinkingLevelConfigurable(thinkingLevel) ? thinkingLevel : "medium";
}

export function agentModeSupportsThinkingLevelSelection(agentMode: AgentMode): boolean {
  return agentMode !== "rush";
}
