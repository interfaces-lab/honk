import {
  AGENT_CONFIGURABLE_THINKING_LEVELS,
  AGENT_MODES,
  type AgentMode,
  type AgentThinkingLevel,
} from "@multi/contracts";

export const AGENT_MODE_LABELS: Record<AgentMode, string> = {
  rush: "Rush",
  smart: "Smart",
  deep: "Deep",
};

export const AGENT_MODE_THINKING_LEVELS: Record<AgentMode, AgentThinkingLevel> = {
  rush: "low",
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
