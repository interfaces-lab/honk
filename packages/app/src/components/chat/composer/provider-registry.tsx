import {
  type ProviderDriverKind,
  type ProviderOptionSelection,
  type ScopedThreadRef,
  type ServerProviderModel,
} from "@multi/contracts";
import {
  buildProviderOptionSelectionsFromDescriptors,
  getProviderOptionCurrentValue,
  getProviderOptionDescriptors,
  isClaudeUltrathinkPrompt,
} from "@multi/shared/model";
import type { ReactNode } from "react";

import type { DraftId } from "../../../composer-draft-store";
import { getProviderModelCapabilities } from "../../../provider-models";
import {
  getTraitsSectionVisibility,
  shouldRenderTraitsControls,
  TraitsMenuContent,
  TraitsPicker,
} from "../picker/traits-picker";

export type ComposerProviderStateInput = {
  provider: ProviderDriverKind;
  model: string;
  models: ReadonlyArray<ServerProviderModel>;
  prompt: string;
  modelOptions: ReadonlyArray<ProviderOptionSelection> | null | undefined;
};

export type ComposerProviderState = {
  provider: ProviderDriverKind;
  promptEffort: string | null;
  modelOptionsForDispatch: ReadonlyArray<ProviderOptionSelection> | undefined;
  ultrathinkActive: boolean;
};

type TraitsRenderInput = {
  provider: ProviderDriverKind;
  threadRef?: ScopedThreadRef;
  draftId?: DraftId;
  model: string;
  models: ReadonlyArray<ServerProviderModel>;
  modelOptions: ReadonlyArray<ProviderOptionSelection> | undefined;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  /** Default `all`. Applies to `TraitsMenuContent` splits in the compact composer overflow. */
  traitsScope?: "all" | "fast-only" | "except-fast";
};

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

function renderTraitsControl(
  Component: typeof TraitsMenuContent | typeof TraitsPicker,
  input: TraitsRenderInput,
): ReactNode {
  const {
    provider,
    threadRef,
    draftId,
    model,
    models,
    modelOptions,
    prompt,
    onPromptChange,
    traitsScope: traitsScopeRequested = "all",
  } = input;
  const traitsScopeForComponent = Component === TraitsPicker ? "all" : traitsScopeRequested;

  const hasTarget = threadRef !== undefined || draftId !== undefined;
  if (!hasTarget) {
    return null;
  }

  const visibilityInput = {
    provider,
    models,
    model,
    prompt,
    modelOptions,
    allowPromptInjectedEffort: true as boolean,
  };

  if (traitsScopeForComponent === "fast-only") {
    if (!getTraitsSectionVisibility(visibilityInput).showFastMode) {
      return null;
    }
  } else if (traitsScopeForComponent === "except-fast") {
    const visibility = getTraitsSectionVisibility(visibilityInput);
    const booleansExceptFastMode = visibility.booleanDescriptors.filter(
      (descriptor) => descriptor.id !== "fastMode",
    );
    const hasRest = visibility.selectDescriptors.length > 0 || booleansExceptFastMode.length > 0;
    if (!hasRest) {
      return null;
    }
  } else if (!shouldRenderTraitsControls(visibilityInput)) {
    return null;
  }

  return (
    <Component
      provider={provider}
      models={models}
      {...(threadRef ? { threadRef } : {})}
      {...(draftId ? { draftId } : {})}
      model={model}
      modelOptions={modelOptions}
      prompt={prompt}
      onPromptChange={onPromptChange}
      {...(Component === TraitsMenuContent ? { traitsScope: traitsScopeForComponent } : {})}
    />
  );
}

export function renderProviderTraitsMenuContent(input: TraitsRenderInput): ReactNode {
  return renderTraitsControl(TraitsMenuContent, input);
}

export function renderProviderTraitsPicker(input: TraitsRenderInput): ReactNode {
  return renderTraitsControl(TraitsPicker, input);
}
