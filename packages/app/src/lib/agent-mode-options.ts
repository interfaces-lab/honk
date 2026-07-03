import {
  AGENT_CONFIGURABLE_THINKING_LEVELS,
  AGENT_MODES,
  type AgentMode,
  type AgentThinkingLevel,
} from "@honk/shared/agent-model-policy";
import type { AgentAuthStatus } from "@honk/shared/runtime";
import type { ModelSelection } from "@honk/shared/model";
import { authProviderIdForModelSelection } from "@honk/shared/agent-model-policy";

export interface AgentModeAvailability {
  readonly anthropic: boolean;
  readonly codex: boolean;
  readonly cursor: boolean;
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
    cursor: true,
  };
}

export function isAgentModeAvailable(
  mode: AgentMode,
  availability: AgentModeAvailability,
): boolean {
  switch (mode) {
    case "smart":
      return availability.anthropic;
    case "composer":
      return availability.cursor;
    case "rush":
    case "deep":
      return availability.codex;
  }
}

export function unavailableAgentModeReason(
  mode: AgentMode,
  availability: AgentModeAvailability,
): string | null {
  if (isAgentModeAvailable(mode, availability)) {
    return null;
  }
  switch (mode) {
    case "smart":
      return "Requires Claude sign-in.";
    case "composer":
      return "Requires Cursor Agent CLI.";
    case "rush":
    case "deep":
      return "Requires Codex sign-in.";
  }
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
  if (authProviderId === "cursor") {
    return availability.cursor;
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
  const authProviderId = authProviderIdForModelSelection(modelSelection);
  if (authProviderId === "anthropic") {
    return "Requires Claude sign-in.";
  }
  if (authProviderId === "cursor") {
    return "Requires Cursor Agent CLI.";
  }
  return "Requires Codex sign-in.";
}

export const AGENT_MODE_LABELS: Record<AgentMode, string> = {
  rush: "Rush",
  smart: "Smart",
  deep: "Deep",
  composer: "Composer",
};

export const AGENT_MODE_THINKING_LEVELS: Record<AgentMode, AgentThinkingLevel> = {
  rush: "off",
  smart: "medium",
  deep: "high",
  composer: "off",
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
  return agentMode !== "rush" && agentMode !== "composer";
}
