import {
  AccountId,
  AuthProviderId,
  ModelId,
  type AgentAuthStatus,
  type AgentInteractionMode,
  type AgentModelPolicy,
  type AgentPermissionMode,
  type AgentThinkingLevel,
} from "@multi/contracts";
import type { Model } from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { clampThinkingLevel } from "@earendil-works/pi-ai";

export const DEFAULT_AGENT_INTERACTION_MODE: AgentInteractionMode = "default";
export const DEFAULT_AGENT_PERMISSION_MODE: AgentPermissionMode = "project-write";
export const DEFAULT_AGENT_THINKING_LEVEL: AgentThinkingLevel = "medium";

export interface RuntimeModelSelection {
  readonly model: Model<string>;
  readonly thinkingLevel: ThinkingLevel;
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

export function createModelPolicy(input: {
  readonly model?: Model<string>;
  readonly thinkingLevel?: ThinkingLevel;
  readonly interactionMode?: AgentInteractionMode;
  readonly permissionMode?: AgentPermissionMode;
  readonly allowedToolNames?: readonly string[];
  readonly excludedToolNames?: readonly string[];
}): AgentModelPolicy {
  const authProviderId = input.model ? authProviderIdFromPiModel(input.model) : undefined;
  const modelId = input.model ? modelIdFromPiModel(input.model) : undefined;
  const thinkingLevel =
    input.model && input.thinkingLevel
      ? (clampThinkingLevel(input.model, input.thinkingLevel) as AgentThinkingLevel)
      : input.thinkingLevel;

  return {
    interactionMode: input.interactionMode ?? DEFAULT_AGENT_INTERACTION_MODE,
    permissionMode: input.permissionMode ?? DEFAULT_AGENT_PERMISSION_MODE,
    ...(authProviderId ? { authProviderId } : {}),
    ...(authProviderId ? { accountId: accountIdFromProvider(authProviderId) } : {}),
    ...(modelId ? { modelId } : {}),
    ...(thinkingLevel ? { thinkingLevel: thinkingLevel as AgentThinkingLevel } : {}),
    ...(input.allowedToolNames ? { allowedToolNames: [...input.allowedToolNames] } : {}),
    ...(input.excludedToolNames ? { excludedToolNames: [...input.excludedToolNames] } : {}),
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
    ...(input.accountId ? { accountId: input.accountId } : {}),
    state: input.hasCredential ? "available" : "missing",
    ...(input.message ? { message: input.message } : {}),
    updatedAt: (input.now ?? new Date()).toISOString(),
  };
}
