import { Schema } from "effect";

export const AGENT_INTERACTION_MODES = ["agent", "ask", "plan", "debug", "multitask"] as const;
const CanonicalAgentInteractionMode = Schema.Literals(AGENT_INTERACTION_MODES);
export const AgentInteractionMode = Schema.Union([
  CanonicalAgentInteractionMode,
  Schema.Literal("default").transform("agent"),
]);
export type AgentInteractionMode = typeof AgentInteractionMode.Type;
export const DEFAULT_AGENT_INTERACTION_MODE: AgentInteractionMode = "agent";
