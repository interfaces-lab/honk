import { Effect, Schema } from "effect";
import {
  AccountId,
  AuthProviderId,
  ModelId,
  TrimmedNonEmptyString,
} from "./base-schemas";
import { cursorComposerFastEnabled, cursorComposerPolicyModelSelection } from "./cursor-composer";
import { AgentInteractionMode } from "./interaction-mode";
import { ModelOptionSelections, type ModelSelection } from "./model";

export const AGENT_MODES = ["rush", "smart", "deep", "composer"] as const;
export const AgentMode = Schema.Literals(AGENT_MODES);
export type AgentMode = typeof AgentMode.Type;

export const AGENT_THINKING_LEVELS = ["off", "low", "medium", "high", "xhigh"] as const;
export const AGENT_CONFIGURABLE_THINKING_LEVELS = ["medium", "high", "xhigh"] as const;
export const AgentThinkingLevel = Schema.Literals(AGENT_THINKING_LEVELS);
export type AgentThinkingLevel = typeof AgentThinkingLevel.Type;

const AgentPolicyToolNames = Schema.Array(TrimmedNonEmptyString).pipe(
  Schema.withDecodingDefault(Effect.succeed([])),
);

export const AgentPolicyModelSelection = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("pi-managed"),
  }),
  Schema.Struct({
    type: Schema.Literal("explicit"),
    authProviderId: AuthProviderId,
    accountId: AccountId,
    modelId: ModelId,
    options: Schema.optionalKey(ModelOptionSelections),
  }),
]).pipe(Schema.withDecodingDefault(Effect.succeed({ type: "pi-managed" as const })));
export type AgentPolicyModelSelection = typeof AgentPolicyModelSelection.Type;

export const DEFAULT_AGENT_POLICY_MODEL_SELECTION: AgentPolicyModelSelection = {
  type: "explicit",
  authProviderId: AuthProviderId.make("openai-codex"),
  accountId: AccountId.make("openai-codex:default"),
  modelId: ModelId.make("openai-codex/gpt-5.5"),
};

export const AgentModelSettings = Schema.Struct({
  thinkingLevel: Schema.optionalKey(AgentThinkingLevel),
});
export type AgentModelSettings = typeof AgentModelSettings.Type;

export const AgentModelPolicy = Schema.Struct({
  agentMode: AgentMode.pipe(Schema.withDecodingDefault(Effect.succeed("deep" as const))),
  interactionMode: AgentInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed("agent" as const)),
  ),
  modelSelection: AgentPolicyModelSelection,
  fast: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  thinkingLevel: Schema.NullOr(AgentThinkingLevel).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  allowedToolNames: AgentPolicyToolNames,
  excludedToolNames: AgentPolicyToolNames,
});
export type AgentModelPolicy = typeof AgentModelPolicy.Type;

export const AgentCredentialKind = Schema.Literals([
  "claude-api-key",
  "claude-oauth",
  "codex-oauth",
  "codex-api-key",
]);
export type AgentCredentialKind = typeof AgentCredentialKind.Type;

export const AgentCredentialPreference = Schema.Struct({
  kind: AgentCredentialKind,
  label: TrimmedNonEmptyString,
  authProviderId: AuthProviderId,
  accountId: Schema.NullOr(AccountId).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
});
export type AgentCredentialPreference = typeof AgentCredentialPreference.Type;

export const DEFAULT_AGENT_CREDENTIAL_PREFERENCES: readonly AgentCredentialPreference[] = [
  {
    kind: "claude-api-key",
    label: "Claude API Key",
    authProviderId: AuthProviderId.make("anthropic"),
    accountId: null,
  },
  {
    kind: "claude-oauth",
    label: "Claude OAuth",
    authProviderId: AuthProviderId.make("anthropic"),
    accountId: null,
  },
  {
    kind: "codex-oauth",
    label: "Codex OAuth",
    authProviderId: AuthProviderId.make("openai-codex"),
    accountId: null,
  },
  {
    kind: "codex-api-key",
    label: "Codex API Key",
    authProviderId: AuthProviderId.make("openai"),
    accountId: null,
  },
];

export const AgentResourcePreferences = Schema.Struct({
  workspaceFiles: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  git: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  terminal: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
});
export type AgentResourcePreferences = typeof AgentResourcePreferences.Type;
export const DEFAULT_AGENT_RESOURCE_PREFERENCES = {
  workspaceFiles: true,
  git: true,
  terminal: true,
} satisfies AgentResourcePreferences;

export const AgentPreferences = Schema.Struct({
  agentMode: AgentMode.pipe(Schema.withDecodingDefault(Effect.succeed("deep" as const))),
  interactionMode: AgentInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed("agent" as const)),
  ),
  modelSelection: AgentPolicyModelSelection.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_AGENT_POLICY_MODEL_SELECTION)),
  ),
  modelSettingsByModelId: Schema.Record(ModelId, AgentModelSettings).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
  fast: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  thinkingLevel: AgentThinkingLevel.pipe(
    Schema.withDecodingDefault(Effect.succeed("high" as const)),
  ),
  resources: AgentResourcePreferences.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_AGENT_RESOURCE_PREFERENCES)),
  ),
  credentials: Schema.Array(AgentCredentialPreference).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
});
export type AgentPreferences = typeof AgentPreferences.Type;

export function createDefaultAgentPreferences(): AgentPreferences {
  return {
    agentMode: "deep",
    interactionMode: "agent",
    modelSelection: { ...DEFAULT_AGENT_POLICY_MODEL_SELECTION },
    modelSettingsByModelId: {},
    fast: false,
    thinkingLevel: "high",
    resources: { ...DEFAULT_AGENT_RESOURCE_PREFERENCES },
    credentials: DEFAULT_AGENT_CREDENTIAL_PREFERENCES.map((credential) => ({ ...credential })),
  };
}

export const DEFAULT_AGENT_PREFERENCES: AgentPreferences = createDefaultAgentPreferences();

export const decodeAgentPreferences = Schema.decodeUnknownSync(AgentPreferences);
export const AgentPreferencesPatch = Schema.Struct({
  agentMode: Schema.optionalKey(AgentMode),
  interactionMode: Schema.optionalKey(AgentInteractionMode),
  modelSelection: Schema.optionalKey(AgentPolicyModelSelection),
  modelSettingsByModelId: Schema.optionalKey(Schema.Record(ModelId, AgentModelSettings)),
  fast: Schema.optionalKey(Schema.Boolean),
  thinkingLevel: Schema.optionalKey(AgentThinkingLevel),
  resources: Schema.optionalKey(AgentResourcePreferences),
  credentials: Schema.optionalKey(Schema.Array(AgentCredentialPreference)),
});
export type AgentPreferencesPatch = typeof AgentPreferencesPatch.Type;

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
