import {
  type ProviderDriverKind,
  type ProviderOptionDescriptor,
  type ProviderOptionSelection,
  type ServerProviderModel,
} from "@multi/contracts";
import {
  buildProviderOptionSelectionsFromDescriptors,
  getProviderOptionCurrentLabel,
  getProviderOptionCurrentValue,
  getProviderOptionDescriptors,
  isClaudeUltrathinkPrompt,
} from "@multi/shared/model";

import { getProviderModelCapabilities } from "./provider-models";

type ComposerProviderStateInput = {
  provider: ProviderDriverKind;
  model: string;
  models: ReadonlyArray<ServerProviderModel>;
  prompt: string;
  modelOptions: ReadonlyArray<ProviderOptionSelection> | null | undefined;
};

type ComposerProviderState = {
  provider: ProviderDriverKind;
  promptEffort: string | null;
  modelOptionsForDispatch: ReadonlyArray<ProviderOptionSelection> | undefined;
  ultrathinkActive: boolean;
};

type ProviderSelectDescriptor = Extract<ProviderOptionDescriptor, { type: "select" }>;
type ProviderBooleanDescriptor = Extract<ProviderOptionDescriptor, { type: "boolean" }>;

export type ProviderTraitsScope = "all" | "fast-only" | "except-fast";

type ProviderTraitsStateInput = {
  provider: ProviderDriverKind;
  models: ReadonlyArray<ServerProviderModel>;
  model: string | null | undefined;
  prompt: string;
  modelOptions: ReadonlyArray<ProviderOptionSelection> | null | undefined;
  allowPromptInjectedEffort?: boolean;
};

type ProviderTraitsState = {
  caps: ReturnType<typeof getProviderModelCapabilities>;
  descriptors: ReadonlyArray<ProviderOptionDescriptor>;
  selectDescriptors: ReadonlyArray<ProviderSelectDescriptor>;
  booleanDescriptors: ReadonlyArray<ProviderBooleanDescriptor>;
  restBooleanDescriptors: ReadonlyArray<ProviderBooleanDescriptor>;
  primarySelectDescriptor: ProviderSelectDescriptor | null;
  contextWindowDescriptor: ProviderSelectDescriptor | null;
  agentDescriptor: ProviderSelectDescriptor | null;
  fastModeDescriptor: ProviderBooleanDescriptor | null;
  thinkingDescriptor: ProviderBooleanDescriptor | null;
  effort: string | null;
  thinkingEnabled: boolean | null;
  fastModeEnabled: boolean;
  contextWindow: string | null;
  ultrathinkPromptControlled: boolean;
  ultrathinkInBodyText: boolean;
  selectedAgent: string | null;
  selectedAgentLabel: string | null;
  showEffort: boolean;
  showThinking: boolean;
  showFastMode: boolean;
  showContextWindow: boolean;
  showAgent: boolean;
  hasRestControls: boolean;
  hasAnyControls: boolean;
};

export function getProviderSelectTraitValue(
  descriptor: ProviderSelectDescriptor | null,
): string | null {
  if (!descriptor) {
    return null;
  }
  const value = getProviderOptionCurrentValue(descriptor);
  return typeof value === "string" ? value : null;
}

export function resolveProviderTraitsState(input: ProviderTraitsStateInput): ProviderTraitsState {
  const caps = getProviderModelCapabilities(input.models, input.model, input.provider);
  const descriptors = getProviderOptionDescriptors({
    caps,
    selections: input.modelOptions,
  });
  const selectDescriptors = descriptors.filter(
    (descriptor): descriptor is ProviderSelectDescriptor => descriptor.type === "select",
  );
  const booleanDescriptors = descriptors.filter(
    (descriptor): descriptor is ProviderBooleanDescriptor => descriptor.type === "boolean",
  );
  const primarySelectDescriptor = selectDescriptors[0] ?? null;
  const contextWindowDescriptor =
    selectDescriptors.find((descriptor) => descriptor.id === "contextWindow") ?? null;
  const agentDescriptor = selectDescriptors.find((descriptor) => descriptor.id === "agent") ?? null;
  const fastModeDescriptor =
    booleanDescriptors.find((descriptor) => descriptor.id === "fastMode") ?? null;
  const thinkingDescriptor =
    booleanDescriptors.find((descriptor) => descriptor.id === "thinking") ?? null;
  const restBooleanDescriptors = booleanDescriptors.filter(
    (descriptor) => descriptor.id !== "fastMode",
  );

  const ultrathinkPromptControlled =
    (input.allowPromptInjectedEffort ?? true) &&
    (primarySelectDescriptor?.promptInjectedValues?.length ?? 0) > 0 &&
    isClaudeUltrathinkPrompt(input.prompt);
  const ultrathinkInBodyText =
    ultrathinkPromptControlled &&
    isClaudeUltrathinkPrompt(input.prompt.replace(/^Ultrathink:\s*/i, ""));
  const effort =
    (ultrathinkPromptControlled
      ? "ultrathink"
      : getProviderSelectTraitValue(primarySelectDescriptor)) ?? null;
  const thinkingEnabled =
    typeof thinkingDescriptor?.currentValue === "boolean" ? thinkingDescriptor.currentValue : null;
  const fastModeEnabled =
    typeof fastModeDescriptor?.currentValue === "boolean" ? fastModeDescriptor.currentValue : false;
  const contextWindow = getProviderSelectTraitValue(contextWindowDescriptor);
  const selectedAgent = getProviderSelectTraitValue(agentDescriptor);
  const selectedAgentLabel = agentDescriptor
    ? (getProviderOptionCurrentLabel(agentDescriptor) ?? null)
    : null;
  const showEffort = primarySelectDescriptor !== null;
  const showThinking = thinkingDescriptor !== null;
  const showFastMode = fastModeDescriptor !== null;
  const showContextWindow = contextWindowDescriptor !== null;
  const showAgent = agentDescriptor !== null;
  const hasRestControls = selectDescriptors.length > 0 || restBooleanDescriptors.length > 0;

  return {
    caps,
    descriptors,
    selectDescriptors,
    booleanDescriptors,
    restBooleanDescriptors,
    primarySelectDescriptor,
    contextWindowDescriptor,
    agentDescriptor,
    fastModeDescriptor,
    thinkingDescriptor,
    effort,
    thinkingEnabled,
    fastModeEnabled,
    contextWindow,
    ultrathinkPromptControlled,
    ultrathinkInBodyText,
    selectedAgent,
    selectedAgentLabel,
    showEffort,
    showThinking,
    showFastMode,
    showContextWindow,
    showAgent,
    hasRestControls,
    hasAnyControls: showEffort || showThinking || showFastMode || showContextWindow || showAgent,
  };
}

export function getComposerProviderState(input: ComposerProviderStateInput): ComposerProviderState {
  const { provider, model, models, prompt, modelOptions } = input;
  const caps = getProviderModelCapabilities(models, model, provider);
  const descriptors = getProviderOptionDescriptors({ caps, selections: modelOptions });
  const primarySelectDescriptor = descriptors.find(
    (descriptor): descriptor is Extract<(typeof descriptors)[number], { type: "select" }> =>
      descriptor.type === "select",
  );
  const primaryValue = getProviderOptionCurrentValue(primarySelectDescriptor ?? null);
  const promptEffort = typeof primaryValue === "string" ? primaryValue : null;
  const ultrathinkActive =
    (primarySelectDescriptor?.promptInjectedValues?.length ?? 0) > 0 &&
    isClaudeUltrathinkPrompt(prompt);

  return {
    provider,
    promptEffort,
    modelOptionsForDispatch: buildProviderOptionSelectionsFromDescriptors(descriptors),
    ultrathinkActive,
  };
}
