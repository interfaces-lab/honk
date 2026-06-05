import {
  AccountId,
  AuthProviderId,
  AGENT_THINKING_LEVELS,
  ModelId,
  type AgentAuthStatus,
  type AgentInteractionMode,
  type AgentMode,
  type AgentModelPolicy,
  type AgentThinkingLevel,
} from "@multi/contracts";
import type { Model } from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { clampThinkingLevel } from "@earendil-works/pi-ai";

export const DEFAULT_AGENT_INTERACTION_MODE: AgentInteractionMode = "agent";
export const DEFAULT_AGENT_MODE: AgentMode = "deep";
export const DEFAULT_AGENT_THINKING_LEVEL: AgentThinkingLevel = "high";

export interface RuntimeModelSelection {
  readonly model: Model<string>;
  readonly thinkingLevel: ThinkingLevel;
}

const AGENT_THINKING_LEVEL_SET: ReadonlySet<ThinkingLevel> = new Set(AGENT_THINKING_LEVELS);

function isAgentThinkingLevel(level: ThinkingLevel): level is AgentThinkingLevel {
  return AGENT_THINKING_LEVEL_SET.has(level);
}

export function modelIdFromPiModel(model: Pick<Model<string>, "provider" | "id">): ModelId {
  return ModelId.make(`${model.provider}/${model.id}`);
}

export function authProviderIdFromPiModel(model: Pick<Model<string>, "provider">): AuthProviderId {
  return AuthProviderId.make(model.provider);
}

export function accountIdFromProvider(provider: string, account = "default"): AccountId {
  return AccountId.make(`${provider}:${account}`);
}

export function thinkingLevelForAgentMode(agentMode: AgentMode): AgentThinkingLevel {
  switch (agentMode) {
    case "rush":
      return "off";
    case "smart":
      return "medium";
    case "deep":
      return "high";
    default:
      return DEFAULT_AGENT_THINKING_LEVEL;
  }
}

function toAgentThinkingLevel(level: ThinkingLevel): AgentThinkingLevel {
  return isAgentThinkingLevel(level) ? level : DEFAULT_AGENT_THINKING_LEVEL;
}

export function createModelPolicy(input: {
  readonly model?: Model<string>;
  readonly agentMode?: AgentMode;
  readonly thinkingLevel?: ThinkingLevel;
  readonly interactionMode?: AgentInteractionMode;
  readonly allowedToolNames?: readonly string[];
  readonly excludedToolNames?: readonly string[];
}): AgentModelPolicy {
  const modelSelection: AgentModelPolicy["modelSelection"] = input.model
    ? {
        type: "explicit",
        authProviderId: authProviderIdFromPiModel(input.model),
        accountId: accountIdFromProvider(input.model.provider),
        modelId: modelIdFromPiModel(input.model),
      }
    : { type: "pi-managed" };
  const agentMode = input.agentMode ?? DEFAULT_AGENT_MODE;
  const thinkingLevel =
    input.model && input.thinkingLevel
      ? toAgentThinkingLevel(clampThinkingLevel(input.model, input.thinkingLevel))
      : input.thinkingLevel
        ? toAgentThinkingLevel(input.thinkingLevel)
        : thinkingLevelForAgentMode(agentMode);

  return {
    agentMode,
    interactionMode: input.interactionMode ?? DEFAULT_AGENT_INTERACTION_MODE,
    modelSelection,
    thinkingLevel,
    allowedToolNames: input.allowedToolNames ? [...input.allowedToolNames] : [],
    excludedToolNames: input.excludedToolNames ? [...input.excludedToolNames] : [],
  };
}

export function createAuthStatus(input: {
  readonly authProviderId: AuthProviderId;
  readonly accountId?: AccountId;
  readonly hasCredential: boolean;
  readonly message?: string;
  readonly now?: Date;
}): AgentAuthStatus {
  return {
    authProviderId: input.authProviderId,
    accountId: input.accountId ?? null,
    state: input.hasCredential ? "available" : "missing",
    label: null,
    message: input.message ?? null,
    updatedAt: (input.now ?? new Date()).toISOString(),
  };
}
