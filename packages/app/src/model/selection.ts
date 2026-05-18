import {
  defaultInstanceIdForDriver,
  type ModelSelection,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderOptionSelection,
  type ServerProvider,
} from "@multi/contracts";
import {
  createModelSelection,
  normalizeModelSlug,
  resolveSelectableModel,
} from "@multi/shared/model";
import { UnifiedSettings } from "@multi/contracts/settings";

import { sortModelsForProviderInstance } from "./ordering";
import {
  type ProviderInstanceEntry,
  deriveProviderInstanceEntriesForSettings,
  resolveProviderDriverKindForInstanceSelection,
  sortProviderInstanceEntries,
} from "./provider-instances";
import { getComposerProviderState } from "./provider-state";

const MAX_CUSTOM_MODEL_COUNT = 32;
export const MAX_CUSTOM_MODEL_LENGTH = 256;
const DEFAULT_TEXT_GENERATION_DRIVER_KIND = ProviderDriverKind.make("codex");

function readInstanceCustomModels(
  settings: UnifiedSettings,
  instanceId: ProviderInstanceId,
  driverKind: ProviderDriverKind,
): ReadonlyArray<string> {
  const instance = settings.providerInstances?.[instanceId];
  const config = instance?.config;
  if (config !== null && typeof config === "object") {
    const value = (config as Record<string, unknown>).customModels;
    if (Array.isArray(value)) {
      return value.filter((entry): entry is string => typeof entry === "string");
    }
  }
  const defaultInstanceId = defaultInstanceIdForDriver(driverKind);
  if (instanceId !== defaultInstanceId) {
    return [];
  }
  const providerConfig = (settings.providers as unknown as Record<string, unknown>)[driverKind];
  if (providerConfig !== null && typeof providerConfig === "object") {
    const value = (providerConfig as Record<string, unknown>).customModels;
    if (Array.isArray(value)) {
      return value.filter((entry): entry is string => typeof entry === "string");
    }
  }
  return [];
}

export interface AppModelOption {
  slug: string;
  name: string;
  shortName?: string | undefined;
  subProvider?: string | undefined;
  selectable?: boolean | undefined;
  isCustom: boolean;
}

export interface AppModelCatalogItem {
  readonly slug: string;
  readonly name: string;
  readonly shortName?: string | undefined;
  readonly subProvider?: string | undefined;
  readonly selectable?: boolean | undefined;
  readonly instanceId: ProviderInstanceId;
  readonly driverKind: ProviderDriverKind;
  readonly instanceDisplayName: string;
  readonly instanceAccentColor?: string | undefined;
  readonly continuationGroupKey?: string | undefined;
  readonly modelSelection: ModelSelection;
}

export type AppModelResolverStatus =
  | { readonly kind: "ready"; readonly message: null }
  | { readonly kind: "loading"; readonly message: string }
  | {
      readonly kind: "missing-provider";
      readonly message: string;
      readonly requestedInstanceId: ProviderInstanceId;
    }
  | {
      readonly kind: "disabled-provider";
      readonly message: string;
      readonly requestedInstanceId: ProviderInstanceId;
    }
  | {
      readonly kind: "empty-catalog";
      readonly message: string;
      readonly selectedInstanceId: ProviderInstanceId;
    }
  | {
      readonly kind: "missing-model";
      readonly message: string;
      readonly requestedModel: string;
      readonly selectedInstanceId: ProviderInstanceId;
    };

export interface AppProviderModelState {
  readonly status: AppModelResolverStatus;
  readonly providerInstanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<AppModelOption>>;
  readonly modelCatalogItems: ReadonlyArray<AppModelCatalogItem>;
  readonly selectedCatalogItem: AppModelCatalogItem | undefined;
  readonly modelOptionSelectionsByInstance: ProviderOptionSelectionsByInstance | null;
  readonly requestedInstanceId: ProviderInstanceId | null;
  readonly requestedModel: string | null;
  readonly selectedProviderEntry: ProviderInstanceEntry | undefined;
  readonly selectedProvider: ProviderDriverKind;
  readonly selectedInstanceId: ProviderInstanceId;
  readonly selectedModel: string;
  readonly selectedModelOptions: ReadonlyArray<AppModelOption>;
  readonly selectableModelOptions: ReadonlyArray<AppModelOption>;
  readonly selectedProviderModels: ProviderInstanceEntry["models"];
  readonly modelSelection: ModelSelection;
}

type AppChatModelDraft = {
  readonly activeProvider: ProviderInstanceId | null;
  readonly modelSelectionByProvider: Partial<Record<ProviderInstanceId, ModelSelection>>;
};

type ProviderOptionSelectionsByInstance = Partial<
  Record<string, ReadonlyArray<ProviderOptionSelection>>
>;

type EffectiveChatModelState = {
  readonly selectedModel: string | null;
  readonly modelOptionSelectionsByInstance: ProviderOptionSelectionsByInstance | null;
};

type AppProviderModelRequest = {
  readonly requestedInstanceId: ProviderInstanceId | null;
  readonly requestedModel: string | null;
  readonly requestedOptions: ReadonlyArray<ProviderOptionSelection> | null | undefined;
  readonly modelOptionSelectionsByInstance: ProviderOptionSelectionsByInstance | null;
};

function toAppModelOption(model: ServerProvider["models"][number]): AppModelOption {
  const option: AppModelOption = {
    slug: model.slug,
    name: model.name,
    isCustom: model.isCustom,
  };
  if (model.shortName) option.shortName = model.shortName;
  if (model.subProvider) option.subProvider = model.subProvider;
  if (model.selectable === false) option.selectable = false;
  return option;
}

function isAppModelOptionSelectable(option: Pick<AppModelOption, "selectable">): boolean {
  return option.selectable !== false;
}

function readInstanceModelPreferences(
  settings: UnifiedSettings,
  instanceId: ProviderInstanceId,
): { readonly hiddenModels: ReadonlyArray<string>; readonly modelOrder: ReadonlyArray<string> } {
  return (
    settings.providerModelPreferences?.[instanceId] ?? {
      hiddenModels: [],
      modelOrder: [],
    }
  );
}

function applyInstanceModelPreferences(
  options: ReadonlyArray<AppModelOption>,
  preferences: {
    readonly hiddenModels: ReadonlyArray<string>;
    readonly modelOrder: ReadonlyArray<string>;
  },
): AppModelOption[] {
  const hiddenModels = new Set(preferences.hiddenModels);
  return sortModelsForProviderInstance(
    options.filter((option) => option.isCustom || !hiddenModels.has(option.slug)),
    { modelOrder: preferences.modelOrder },
  );
}

function normalizeCustomModelSlugs(
  models: Iterable<string | null | undefined>,
  builtInModelSlugs: ReadonlySet<string>,
): string[] {
  const normalizedModels: string[] = [];
  const seen = new Set<string>();

  for (const candidate of models) {
    const normalized = normalizeModelSlug(candidate);
    if (
      !normalized ||
      normalized.length > MAX_CUSTOM_MODEL_LENGTH ||
      builtInModelSlugs.has(normalized) ||
      seen.has(normalized)
    ) {
      continue;
    }

    seen.add(normalized);
    normalizedModels.push(normalized);
    if (normalizedModels.length >= MAX_CUSTOM_MODEL_COUNT) {
      break;
    }
  }

  return normalizedModels;
}

function getAppModelOptionsForInstance(
  settings: UnifiedSettings,
  entry: ProviderInstanceEntry,
): AppModelOption[] {
  const options: AppModelOption[] = entry.models.map(toAppModelOption);
  const seen = new Set(options.map((option) => option.slug));
  const builtInModelSlugs = new Set(
    entry.models.filter((model) => !model.isCustom).map((model) => model.slug),
  );

  const customModels = readInstanceCustomModels(settings, entry.instanceId, entry.driverKind);
  for (const slug of normalizeCustomModelSlugs(customModels, builtInModelSlugs)) {
    if (seen.has(slug)) {
      continue;
    }

    seen.add(slug);
    options.push({ slug, name: slug, isCustom: true });
  }

  return applyInstanceModelPreferences(
    options,
    readInstanceModelPreferences(settings, entry.instanceId),
  );
}

function buildModelOptionsByInstance(
  settings: UnifiedSettings,
  entries: ReadonlyArray<ProviderInstanceEntry>,
): ReadonlyMap<ProviderInstanceId, ReadonlyArray<AppModelOption>> {
  const out = new Map<ProviderInstanceId, ReadonlyArray<AppModelOption>>();
  for (const entry of entries) {
    out.set(entry.instanceId, getAppModelOptionsForInstance(settings, entry));
  }
  return out;
}

function buildAppModelCatalogItems(input: {
  readonly providerInstanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<AppModelOption>>;
}): AppModelCatalogItem[] {
  const out: AppModelCatalogItem[] = [];
  for (const entry of input.providerInstanceEntries) {
    if (entry.status !== "ready") {
      continue;
    }

    const models = input.modelOptionsByInstance.get(entry.instanceId) ?? [];
    for (const model of models) {
      out.push({
        slug: model.slug,
        name: model.name,
        ...(model.shortName ? { shortName: model.shortName } : {}),
        ...(model.subProvider ? { subProvider: model.subProvider } : {}),
        ...(model.selectable === false ? { selectable: false } : {}),
        instanceId: entry.instanceId,
        driverKind: entry.driverKind,
        instanceDisplayName: entry.displayName,
        modelSelection: createModelSelection(entry.instanceId, model.slug),
        ...(entry.accentColor ? { instanceAccentColor: entry.accentColor } : {}),
        ...(entry.continuationGroupKey ? { continuationGroupKey: entry.continuationGroupKey } : {}),
      });
    }
  }
  return out;
}

function resolveAppModelCatalogSelection(input: {
  readonly catalogItems: ReadonlyArray<AppModelCatalogItem>;
  readonly instanceId: ProviderInstanceId;
  readonly model: string | null | undefined;
}): AppModelCatalogItem | undefined {
  const selectableItems = input.catalogItems.filter(
    (item) => item.instanceId === input.instanceId && isAppModelOptionSelectable(item),
  );
  const driverKind = selectableItems[0]?.driverKind;
  const resolvedSlug = driverKind ? resolveSelectableModel(input.model, selectableItems) : null;
  return (
    selectableItems.find((item) => item.slug === resolvedSlug) ??
    selectableItems.find((item) => item.slug === input.model) ??
    selectableItems[0]
  );
}

function selectableProviderEntry(entry: ProviderInstanceEntry): boolean {
  return entry.enabled && entry.isAvailable && entry.status === "ready";
}

function getRequestedProviderStatus(input: {
  readonly entries: ReadonlyArray<ProviderInstanceEntry>;
  readonly requestedInstanceId: ProviderInstanceId | null;
  readonly selectedEntry: ProviderInstanceEntry | undefined;
}): AppModelResolverStatus {
  if (input.entries.length === 0) {
    return {
      kind: "loading",
      message: "Provider catalog is still loading.",
    };
  }

  if (!input.requestedInstanceId) {
    return { kind: "ready", message: null };
  }

  const requestedEntry = input.entries.find(
    (entry) => entry.instanceId === input.requestedInstanceId,
  );
  if (!requestedEntry) {
    return {
      kind: "missing-provider",
      requestedInstanceId: input.requestedInstanceId,
      message: "Selected provider is no longer available.",
    };
  }

  if (!selectableProviderEntry(requestedEntry)) {
    return {
      kind: "disabled-provider",
      requestedInstanceId: input.requestedInstanceId,
      message: "Selected provider is disabled.",
    };
  }

  if (!input.selectedEntry || !selectableProviderEntry(input.selectedEntry)) {
    return {
      kind: "disabled-provider",
      requestedInstanceId: input.requestedInstanceId,
      message: "Selected provider is disabled.",
    };
  }

  return { kind: "ready", message: null };
}

function getModelStatus(input: {
  readonly providerStatus: AppModelResolverStatus;
  readonly requestedModel: string | null;
  readonly selectedInstanceId: ProviderInstanceId;
  readonly selectableModelOptions: ReadonlyArray<AppModelOption>;
  readonly resolvedRequestedModel: string | null;
}): AppModelResolverStatus {
  if (input.providerStatus.kind !== "ready") {
    return input.providerStatus;
  }

  if (input.selectableModelOptions.length === 0) {
    return {
      kind: "empty-catalog",
      selectedInstanceId: input.selectedInstanceId,
      message: "Selected provider has no selectable models.",
    };
  }

  if (input.requestedModel && !input.resolvedRequestedModel) {
    return {
      kind: "missing-model",
      requestedModel: input.requestedModel,
      selectedInstanceId: input.selectedInstanceId,
      message: "Selected model is no longer available.",
    };
  }

  return input.providerStatus;
}

function providerSelectionsFromModelSelection(
  modelSelection: ModelSelection | null | undefined,
): ProviderOptionSelectionsByInstance | null {
  if (!modelSelection) {
    return null;
  }
  const options = modelSelection.options;
  if (!options || options.length === 0) {
    return null;
  }
  return { [modelSelection.instanceId]: options };
}

function modelSelectionByProviderToInstanceOptions(
  map: Partial<Record<string, ModelSelection>> | null | undefined,
): ProviderOptionSelectionsByInstance | null {
  if (!map) return null;
  const result: ProviderOptionSelectionsByInstance = {};
  for (const [provider, selection] of Object.entries(map)) {
    if (selection?.options && selection.options.length > 0) {
      result[provider] = selection.options;
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

function deriveEffectiveChatModelState(input: {
  draft: AppChatModelDraft | null | undefined;
  selectedProvider: ProviderDriverKind;
  selectedInstanceId?: ProviderInstanceId | null | undefined;
  threadModelSelection: ModelSelection | null | undefined;
  defaultModelSelection: ModelSelection | null | undefined;
  projectModelSelection: ModelSelection | null | undefined;
}): EffectiveChatModelState {
  const baseModel =
    input.threadModelSelection?.model ??
    input.defaultModelSelection?.model ??
    input.projectModelSelection?.model ??
    null;
  const activeSelectionInstanceId =
    input.selectedInstanceId ?? ProviderInstanceId.make(input.selectedProvider);
  const activeSelection = input.draft?.modelSelectionByProvider?.[activeSelectionInstanceId];
  const selectedModel = activeSelection?.model ?? baseModel;
  const modelOptionSelectionsByInstance =
    modelSelectionByProviderToInstanceOptions(input.draft?.modelSelectionByProvider) ??
    providerSelectionsFromModelSelection(input.threadModelSelection) ??
    providerSelectionsFromModelSelection(input.defaultModelSelection) ??
    providerSelectionsFromModelSelection(input.projectModelSelection) ??
    null;

  return {
    selectedModel,
    modelOptionSelectionsByInstance,
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

function hasChatModelSelectionInput(input: {
  readonly draft?: AppChatModelDraft | null | undefined;
  readonly sessionProviderInstanceId?: ProviderInstanceId | null | undefined;
  readonly threadModelSelection?: ModelSelection | null | undefined;
  readonly projectModelSelection?: ModelSelection | null | undefined;
}): boolean {
  return (
    input.draft !== undefined ||
    input.sessionProviderInstanceId !== undefined ||
    input.threadModelSelection !== undefined ||
    input.projectModelSelection !== undefined
  );
}

function resolveAppProviderModelRequest(input: {
  readonly settings: UnifiedSettings;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly providerInstanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly requestedSelection?: ModelSelection | null | undefined;
  readonly requestedInstanceId?: ProviderInstanceId | null | undefined;
  readonly requestedModel?: string | null | undefined;
  readonly requestedOptions?: ReadonlyArray<ProviderOptionSelection> | null | undefined;
  readonly draft?: AppChatModelDraft | null | undefined;
  readonly sessionProviderInstanceId?: ProviderInstanceId | null | undefined;
  readonly threadModelSelection?: ModelSelection | null | undefined;
  readonly projectModelSelection?: ModelSelection | null | undefined;
}): AppProviderModelRequest {
  if (!hasChatModelSelectionInput(input)) {
    const requestedSelectionOptions = providerSelectionsFromModelSelection(
      input.requestedSelection,
    );
    return {
      requestedInstanceId:
        input.requestedSelection?.instanceId ?? input.requestedInstanceId ?? null,
      requestedModel: input.requestedSelection?.model ?? input.requestedModel ?? null,
      requestedOptions: input.requestedSelection?.options ?? input.requestedOptions,
      modelOptionSelectionsByInstance: requestedSelectionOptions,
    };
  }

  const threadProvider =
    input.sessionProviderInstanceId ??
    input.threadModelSelection?.instanceId ??
    input.settings.textGenerationModelSelection.instanceId ??
    input.projectModelSelection?.instanceId ??
    null;
  const explicitSelectedInstanceId = input.draft?.activeProvider ?? threadProvider;
  const selectedProvider =
    resolveProviderDriverKindForInstanceSelection(
      input.providerInstanceEntries,
      input.providers,
      explicitSelectedInstanceId,
    ) ?? DEFAULT_TEXT_GENERATION_DRIVER_KIND;
  const selectedInstanceId = resolveSelectedInstanceId({
    providerInstanceEntries: input.providerInstanceEntries,
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
    selectedProvider,
    selectedInstanceId,
    threadModelSelection: input.threadModelSelection,
    defaultModelSelection: input.settings.textGenerationModelSelection,
    projectModelSelection: input.projectModelSelection,
  });

  return {
    requestedInstanceId: selectedInstanceId,
    requestedModel: effectiveModelState.selectedModel,
    requestedOptions: effectiveModelState.modelOptionSelectionsByInstance?.[selectedInstanceId],
    modelOptionSelectionsByInstance: effectiveModelState.modelOptionSelectionsByInstance,
  };
}

export function resolveAppProviderModelState(input: {
  readonly settings: UnifiedSettings;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly requestedSelection?: ModelSelection | null | undefined;
  readonly requestedInstanceId?: ProviderInstanceId | null | undefined;
  readonly requestedModel?: string | null | undefined;
  readonly requestedOptions?: ReadonlyArray<ProviderOptionSelection> | null | undefined;
  readonly draft?: AppChatModelDraft | null | undefined;
  readonly sessionProviderInstanceId?: ProviderInstanceId | null | undefined;
  readonly threadModelSelection?: ModelSelection | null | undefined;
  readonly projectModelSelection?: ModelSelection | null | undefined;
}): AppProviderModelState {
  const providerInstanceEntries = sortProviderInstanceEntries(
    deriveProviderInstanceEntriesForSettings(input.settings, input.providers),
  );
  const request = resolveAppProviderModelRequest({
    settings: input.settings,
    providers: input.providers,
    providerInstanceEntries,
    requestedSelection: input.requestedSelection,
    requestedInstanceId: input.requestedInstanceId,
    requestedModel: input.requestedModel,
    requestedOptions: input.requestedOptions,
    draft: input.draft,
    sessionProviderInstanceId: input.sessionProviderInstanceId,
    threadModelSelection: input.threadModelSelection,
    projectModelSelection: input.projectModelSelection,
  });
  const modelOptionsByInstance = buildModelOptionsByInstance(
    input.settings,
    providerInstanceEntries,
  );
  const modelCatalogItems = buildAppModelCatalogItems({
    providerInstanceEntries,
    modelOptionsByInstance,
  });
  const requestedInstanceId = request.requestedInstanceId;
  const requestedModel = request.requestedModel;
  const requestedEntry = requestedInstanceId
    ? providerInstanceEntries.find((entry) => entry.instanceId === requestedInstanceId)
    : undefined;
  const selectedProviderEntry =
    requestedEntry && selectableProviderEntry(requestedEntry)
      ? requestedEntry
      : (providerInstanceEntries.find(selectableProviderEntry) ??
        requestedEntry ??
        providerInstanceEntries[0]);
  const selectedProvider = selectedProviderEntry?.driverKind ?? DEFAULT_TEXT_GENERATION_DRIVER_KIND;
  const selectedInstanceId =
    selectedProviderEntry?.instanceId ?? defaultInstanceIdForDriver(selectedProvider);
  const selectedProviderModels = selectedProviderEntry?.models ?? [];
  const selectedModelOptions = modelOptionsByInstance.get(selectedInstanceId) ?? [];
  const selectableModelOptions = selectedModelOptions.filter(isAppModelOptionSelectable);
  const resolvedRequestedModel = resolveSelectableModel(
    requestedModel,
    selectableModelOptions,
  );
  const selectedModel =
    resolvedRequestedModel ??
    selectableModelOptions[0]?.slug ??
    requestedModel ??
    input.settings.textGenerationModelSelection.model;
  const providerStatus = getRequestedProviderStatus({
    entries: providerInstanceEntries,
    requestedInstanceId,
    selectedEntry: selectedProviderEntry,
  });
  const status = getModelStatus({
    providerStatus,
    requestedModel,
    selectedInstanceId,
    selectableModelOptions,
    resolvedRequestedModel,
  });
  const { modelOptionsForDispatch } = getComposerProviderState({
    provider: selectedProvider,
    model: selectedModel,
    models: selectedProviderModels,
    prompt: "",
    modelOptions: request.requestedOptions,
  });

  return {
    status,
    providerInstanceEntries,
    modelOptionsByInstance,
    modelCatalogItems,
    selectedCatalogItem: resolveAppModelCatalogSelection({
      catalogItems: modelCatalogItems,
      instanceId: selectedInstanceId,
      model: selectedModel,
    }),
    modelOptionSelectionsByInstance: request.modelOptionSelectionsByInstance,
    requestedInstanceId,
    requestedModel,
    selectedProviderEntry,
    selectedProvider,
    selectedInstanceId,
    selectedModel,
    selectedModelOptions,
    selectableModelOptions,
    selectedProviderModels,
    modelSelection: createModelSelection(
      selectedInstanceId,
      selectedModel,
      modelOptionsForDispatch,
    ),
  };
}
