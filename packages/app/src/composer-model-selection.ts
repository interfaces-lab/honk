import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ModelSelection,
  type ServerProvider,
  type ServerProviderModel,
} from "@multi/contracts";
import type { UnifiedSettings } from "@multi/contracts/settings";
import { createModelSelection, normalizeModelSlug } from "@multi/shared/model";

import {
  deriveEffectiveComposerModelState,
  type ComposerThreadDraftState,
  type EffectiveComposerModelState,
} from "./composer-draft-store";
import { getComposerProviderState } from "./components/chat/composer/provider-registry";
import { getAppModelOptionsForInstance, type AppModelOption } from "./model-selection";
import {
  deriveProviderInstanceEntriesForSettings,
  resolveProviderDriverKindForInstanceSelection,
  sortProviderInstanceEntries,
  type ProviderInstanceEntry,
} from "./provider-instances";

type ComposerModelDraft = Pick<
  ComposerThreadDraftState,
  "activeProvider" | "modelSelectionByProvider"
>;

export interface ComposerModelSelectionInput {
  draft: ComposerModelDraft | null | undefined;
  providers: ReadonlyArray<ServerProvider>;
  settings: UnifiedSettings;
  sessionProviderInstanceId: ProviderInstanceId | null | undefined;
  threadModelSelection: ModelSelection | null | undefined;
  projectModelSelection: ModelSelection | null | undefined;
}

export interface ComposerModelSelectionResolution {
  providerInstanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  selectedProvider: ProviderDriverKind;
  selectedInstanceId: ProviderInstanceId;
  selectedModel: string;
  selectedProviderEntry: ProviderInstanceEntry | undefined;
  selectedProviderModels: ReadonlyArray<ServerProviderModel>;
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<AppModelOption>>;
  composerModelOptions: EffectiveComposerModelState["modelOptions"];
  modelSelection: ModelSelection;
}

function resolveSelectedInstanceId(input: {
  providerInstanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  selectedProvider: ProviderDriverKind;
  candidateInstanceIds: ReadonlyArray<ProviderInstanceId | null | undefined>;
  explicitSelectedInstanceId: ProviderInstanceId | null | undefined;
  threadModelSelection: ModelSelection | null | undefined;
  projectModelSelection: ModelSelection | null | undefined;
}): ProviderInstanceId {
  for (const candidate of input.candidateInstanceIds) {
    if (!candidate) {
      continue;
    }
    const match = input.providerInstanceEntries.find(
      (entry) => entry.instanceId === candidate && entry.enabled,
    );
    if (match) {
      return match.instanceId;
    }
  }

  if (
    input.explicitSelectedInstanceId &&
    !input.providerInstanceEntries.some(
      (entry) => entry.instanceId === input.explicitSelectedInstanceId,
    )
  ) {
    return input.explicitSelectedInstanceId;
  }

  return (
    input.providerInstanceEntries.find(
      (entry) => entry.enabled && entry.driverKind === input.selectedProvider,
    )?.instanceId ??
    input.providerInstanceEntries.find((entry) => entry.enabled)?.instanceId ??
    input.providerInstanceEntries[0]?.instanceId ??
    input.threadModelSelection?.instanceId ??
    input.projectModelSelection?.instanceId ??
    ProviderInstanceId.make("codex")
  );
}

export function resolveComposerModelSelection(
  input: ComposerModelSelectionInput,
): ComposerModelSelectionResolution {
  const providerInstanceEntries = sortProviderInstanceEntries(
    deriveProviderInstanceEntriesForSettings(input.settings, input.providers),
  );
  const threadProvider =
    input.sessionProviderInstanceId ??
    input.threadModelSelection?.instanceId ??
    input.projectModelSelection?.instanceId ??
    null;
  const explicitSelectedInstanceId = input.draft?.activeProvider ?? threadProvider;
  const selectedProvider =
    resolveProviderDriverKindForInstanceSelection(
      providerInstanceEntries,
      input.providers,
      explicitSelectedInstanceId,
    ) ?? ProviderDriverKind.make("codex");
  const selectedInstanceId = resolveSelectedInstanceId({
    providerInstanceEntries,
    selectedProvider,
    candidateInstanceIds: [
      input.draft?.activeProvider,
      input.sessionProviderInstanceId,
      input.threadModelSelection?.instanceId,
      input.projectModelSelection?.instanceId,
    ],
    explicitSelectedInstanceId,
    threadModelSelection: input.threadModelSelection,
    projectModelSelection: input.projectModelSelection,
  });
  const effectiveModelState = deriveEffectiveComposerModelState({
    draft: input.draft,
    providers: input.providers,
    selectedProvider,
    selectedInstanceId,
    threadModelSelection: input.threadModelSelection,
    projectModelSelection: input.projectModelSelection,
    settings: input.settings,
  });
  const modelOptionsByInstance = new Map<ProviderInstanceId, ReadonlyArray<AppModelOption>>();
  for (const entry of providerInstanceEntries) {
    modelOptionsByInstance.set(
      entry.instanceId,
      getAppModelOptionsForInstance(input.settings, entry),
    );
  }
  const currentOptions = modelOptionsByInstance.get(selectedInstanceId) ?? [];
  const optionSlugs = new Set(currentOptions.map((option) => option.slug));
  const normalizedModel = normalizeModelSlug(effectiveModelState.selectedModel, selectedProvider);
  const selectedModel = optionSlugs.has(effectiveModelState.selectedModel)
    ? effectiveModelState.selectedModel
    : normalizedModel && optionSlugs.has(normalizedModel)
      ? normalizedModel
      : (currentOptions[0]?.slug ?? effectiveModelState.selectedModel);
  const selectedProviderEntry = providerInstanceEntries.find(
    (entry) => entry.instanceId === selectedInstanceId,
  );
  const selectedProviderModels = selectedProviderEntry?.models ?? [];
  const composerProviderState = getComposerProviderState({
    provider: selectedProvider,
    model: selectedModel,
    models: selectedProviderModels,
    prompt: "",
    modelOptions: effectiveModelState.modelOptions?.[selectedProvider],
  });

  return {
    providerInstanceEntries,
    selectedProvider,
    selectedInstanceId,
    selectedModel,
    selectedProviderEntry,
    selectedProviderModels,
    modelOptionsByInstance,
    composerModelOptions: effectiveModelState.modelOptions,
    modelSelection: createModelSelection(
      selectedInstanceId,
      selectedModel,
      composerProviderState.modelOptionsForDispatch,
    ),
  };
}
