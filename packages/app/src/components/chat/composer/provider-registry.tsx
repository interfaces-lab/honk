import {
  type ProviderDriverKind,
  type ProviderOptionSelection,
  type ScopedThreadRef,
  type ServerProviderModel,
} from "@multi/contracts";
import type { ReactNode } from "react";

import type { DraftId } from "../../../stores/chat-drafts";
import {
  getTraitsSectionVisibility,
  shouldRenderTraitsControls,
  TraitsMenuContent,
  TraitsPicker,
} from "../picker/traits-picker";

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
