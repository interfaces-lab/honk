import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ModelSelection,
  type ProviderOptionSelection,
  type ServerProvider,
  type ServerProviderModel,
} from "@multi/contracts";
import type { UnifiedSettings } from "@multi/contracts/settings";
import { createModelSelection, normalizeModelSlug } from "@multi/shared/model";

import {
  getAppModelOptionsForInstance,
  resolveAppModelSelection,
  resolveAppModelSelectionForInstance,
  type AppModelOption,
} from "./selection";
import { getComposerProviderState } from "./provider-state";
import {
  deriveProviderInstanceEntriesForSettings,
  resolveProviderDriverKindForInstanceSelection,
  sortProviderInstanceEntries,
  type ProviderInstanceEntry,
} from "./provider-instances";
import { getDefaultServerModel } from "./provider-models";

interface ChatModelDraft {
  readonly activeProvider: ProviderInstanceId | null;
  readonly modelSelectionByProvider: Partial<Record<ProviderInstanceId, ModelSelection>>;
}

type ProviderOptionSelectionsByProvider = Partial<
  Record<string, ReadonlyArray<ProviderOptionSelection>>
>;

interface EffectiveChatModelState {
  selectedModel: string;
  modelOptions: ProviderOptionSelectionsByProvider | null;
}

interface ChatModelSelectionInput {
  draft: ChatModelDraft | null | undefined;
  providers: ReadonlyArray<ServerProvider>;
  settings: UnifiedSettings;
  sessionProviderInstanceId: ProviderInstanceId | null | undefined;
  threadModelSelection: ModelSelection | null | undefined;
  projectModelSelection: ModelSelection | null | undefined;
}

interface ChatModelSelectionResolution {
  providerInstanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  selectedProvider: ProviderDriverKind;
  selectedInstanceId: ProviderInstanceId;
  selectedModel: string;
  selectedProviderEntry: ProviderInstanceEntry | undefined;
  selectedProviderModels: ReadonlyArray<ServerProviderModel>;
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<AppModelOption>>;
  modelOptionsByProvider: EffectiveChatModelState["modelOptions"];
  modelSelection: ModelSelection;
}

function providerSelectionsFromModelSelection(
  modelSelection: ModelSelection | null | undefined,
): ProviderOptionSelectionsByProvider | null {
  if (!modelSelection) {
    return null;
  }
  const options = modelSelection.options;
  if (!options || options.length === 0) {
    return null;
  }
  return { [modelSelection.instanceId]: options };
}

function modelSelectionByProviderToOptions(
  map: Partial<Record<string, ModelSelection>> | null | undefined,
): ProviderOptionSelectionsByProvider | null {
  if (!map) return null;
  const result: ProviderOptionSelectionsByProvider = {};
  for (const [provider, selection] of Object.entries(map)) {
    if (selection?.options && selection.options.length > 0) {
      result[provider] = selection.options;
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

function deriveEffectiveChatModelState(input: {
  draft: ChatModelDraft | null | undefined;
  providers: ReadonlyArray<ServerProvider>;
  selectedProvider: ProviderDriverKind;
  selectedInstanceId?: ProviderInstanceId | null | undefined;
  threadModelSelection: ModelSelection | null | undefined;
  defaultModelSelection: ModelSelection | null | undefined;
  projectModelSelection: ModelSelection | null | undefined;
  settings: UnifiedSettings;
}): EffectiveChatModelState {
  const baseModelCandidate =
    input.threadModelSelection?.model ??
    input.defaultModelSelection?.model ??
    input.projectModelSelection?.model ??
    null;
  const baseModel =
    (input.selectedInstanceId
      ? resolveAppModelSelectionForInstance(
          input.selectedInstanceId,
          input.settings,
          input.providers,
          baseModelCandidate,
        )
      : null) ??
    resolveAppModelSelection(
      input.selectedProvider,
      input.settings,
      input.providers,
      baseModelCandidate,
    ) ??
    normalizeModelSlug(baseModelCandidate, input.selectedProvider) ??
    getDefaultServerModel(input.providers, input.selectedProvider);
  const activeSelectionInstanceId =
    input.selectedInstanceId ?? ProviderInstanceId.make(input.selectedProvider);
  const activeSelection = input.draft?.modelSelectionByProvider?.[activeSelectionInstanceId];
  const selectedModel = activeSelection?.model
    ? (resolveAppModelSelectionForInstance(
        activeSelectionInstanceId,
        input.settings,
        input.providers,
        activeSelection.model,
      ) ??
      resolveAppModelSelection(
        input.selectedProvider,
        input.settings,
        input.providers,
        activeSelection.model,
      ))
    : baseModel;
  const modelOptions =
    modelSelectionByProviderToOptions(input.draft?.modelSelectionByProvider) ??
    providerSelectionsFromModelSelection(input.threadModelSelection) ??
    providerSelectionsFromModelSelection(input.defaultModelSelection) ??
    providerSelectionsFromModelSelection(input.projectModelSelection) ??
    null;

  return {
    selectedModel,
    modelOptions,
  };
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

export function resolveChatModelSelection(
  input: ChatModelSelectionInput,
): ChatModelSelectionResolution {
  const providerInstanceEntries = sortProviderInstanceEntries(
    deriveProviderInstanceEntriesForSettings(input.settings, input.providers),
  );
  const threadProvider =
    input.sessionProviderInstanceId ??
    input.threadModelSelection?.instanceId ??
    input.settings.textGenerationModelSelection.instanceId ??
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
      input.settings.textGenerationModelSelection.instanceId,
      input.projectModelSelection?.instanceId,
    ],
    explicitSelectedInstanceId,
    threadModelSelection: input.threadModelSelection,
    projectModelSelection: input.projectModelSelection,
  });
  const effectiveModelState = deriveEffectiveChatModelState({
    draft: input.draft,
    providers: input.providers,
    selectedProvider,
    selectedInstanceId,
    threadModelSelection: input.threadModelSelection,
    defaultModelSelection: input.settings.textGenerationModelSelection,
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
    modelOptionsByProvider: effectiveModelState.modelOptions,
    modelSelection: createModelSelection(
      selectedInstanceId,
      selectedModel,
      composerProviderState.modelOptionsForDispatch,
    ),
  };
}
