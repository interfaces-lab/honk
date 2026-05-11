import {
  DEFAULT_GIT_TEXT_GENERATION_MODEL,
  DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER,
  defaultInstanceIdForDriver,
  type ModelSelection,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@multi/contracts";
import {
  createModelSelection,
  normalizeModelSlug,
  resolveSelectableModel,
} from "@multi/shared/model";
import { UnifiedSettings } from "@multi/contracts/settings";

import { getComposerProviderState } from "./components/chat/composer/provider-registry";
import { ModelEsque } from "./components/chat/picker/icon-utils";
import { sortModelsForProviderInstance } from "./model-ordering";
import {
  type ProviderInstanceEntry,
  deriveProviderInstanceEntries,
  deriveProviderInstanceEntriesForSettings,
} from "./provider-instances";
import {
  getDefaultServerModel,
  getProviderModels,
  resolveSelectableProvider,
} from "./provider-models";

const MAX_CUSTOM_MODEL_COUNT = 32;
export const MAX_CUSTOM_MODEL_LENGTH = 256;
const DEFAULT_TEXT_GENERATION_INSTANCE_ID = ProviderInstanceId.make("codex");

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
  const defaultProviderConfigs = settings.providers as Record<
    string,
    { readonly customModels: ReadonlyArray<string> } | undefined
  >;
  return defaultProviderConfigs[driverKind]?.customModels ?? [];
}

export interface AppModelOption {
  slug: string;
  name: string;
  shortName?: string;
  subProvider?: string;
  isCustom: boolean;
}

function toAppModelOption(model: ServerProvider["models"][number]): AppModelOption {
  const option: AppModelOption = {
    slug: model.slug,
    name: model.name,
    isCustom: model.isCustom,
  };
  if (model.shortName) option.shortName = model.shortName;
  if (model.subProvider) option.subProvider = model.subProvider;
  return option;
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

export function normalizeCustomModelSlugs(
  models: Iterable<string | null | undefined>,
  builtInModelSlugs: ReadonlySet<string>,
  provider: ProviderDriverKind = ProviderDriverKind.make("codex"),
): string[] {
  const normalizedModels: string[] = [];
  const seen = new Set<string>();

  for (const candidate of models) {
    const normalized = normalizeModelSlug(candidate, provider);
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

export function getAppModelOptions(
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
  provider: ProviderDriverKind,
  _selectedModel?: string | null,
): AppModelOption[] {
  const options: AppModelOption[] = getProviderModels(providers, provider).map(toAppModelOption);
  const seen = new Set(options.map((option) => option.slug));
  const builtInModelSlugs = new Set(
    getProviderModels(providers, provider)
      .filter((model) => !model.isCustom)
      .map((model) => model.slug),
  );

  const defaultInstanceId = defaultInstanceIdForDriver(provider);
  const customModels = readInstanceCustomModels(settings, defaultInstanceId, provider);
  for (const slug of normalizeCustomModelSlugs(customModels, builtInModelSlugs, provider)) {
    if (seen.has(slug)) {
      continue;
    }

    seen.add(slug);
    options.push({
      slug,
      name: slug,
      isCustom: true,
    });
  }

  return applyInstanceModelPreferences(
    options,
    readInstanceModelPreferences(settings, defaultInstanceId),
  );
}

export function getAppModelOptionsForInstance(
  settings: UnifiedSettings,
  entry: ProviderInstanceEntry,
): AppModelOption[] {
  const options: AppModelOption[] = entry.models.map(toAppModelOption);
  const seen = new Set(options.map((option) => option.slug));
  const builtInModelSlugs = new Set(
    entry.models.filter((model) => !model.isCustom).map((model) => model.slug),
  );

  const customModels = readInstanceCustomModels(settings, entry.instanceId, entry.driverKind);
  for (const slug of normalizeCustomModelSlugs(customModels, builtInModelSlugs, entry.driverKind)) {
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

export function resolveAppModelSelection(
  provider: ProviderDriverKind,
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
  selectedModel: string | null | undefined,
): string {
  const resolvedProvider = resolveSelectableProvider(providers, provider);
  const options = getAppModelOptions(settings, providers, resolvedProvider, selectedModel);
  return (
    resolveSelectableModel(resolvedProvider, selectedModel, options) ??
    getDefaultServerModel(providers, resolvedProvider)
  );
}

export function resolveAppModelSelectionForInstance(
  instanceId: ProviderInstanceId,
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
  selectedModel: string | null | undefined,
): string | null {
  const entry = deriveProviderInstanceEntries(providers).find(
    (candidate) => candidate.instanceId === instanceId,
  );
  if (!entry) return null;
  const options = getAppModelOptionsForInstance(settings, entry);
  return (
    resolveSelectableModel(entry.driverKind, selectedModel, options) ??
    options[0]?.slug ??
    entry.models[0]?.slug ??
    null
  );
}

export function getCustomModelOptionsByInstance(
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
  _selectedInstanceId?: ProviderInstanceId | null,
  _selectedModel?: string | null,
): ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>> {
  const out = new Map<ProviderInstanceId, ReadonlyArray<ModelEsque>>();
  for (const entry of deriveProviderInstanceEntriesForSettings(settings, providers)) {
    out.set(entry.instanceId, getAppModelOptionsForInstance(settings, entry));
  }
  return out;
}

function isProviderInstanceSelectable(settings: UnifiedSettings, entry: ProviderInstanceEntry) {
  return entry.enabled && entry.isAvailable;
}

export function resolveAppModelSelectionState(
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
): ModelSelection {
  const selection = settings.textGenerationModelSelection ?? {
    instanceId: DEFAULT_TEXT_GENERATION_INSTANCE_ID,
    model: DEFAULT_GIT_TEXT_GENERATION_MODEL,
  };
  const entries = deriveProviderInstanceEntriesForSettings(settings, providers);
  const selectedEntry = entries.find(
    (entry) =>
      entry.instanceId === selection.instanceId && isProviderInstanceSelectable(settings, entry),
  );
  const entry =
    selectedEntry ?? entries.find((candidate) => isProviderInstanceSelectable(settings, candidate));
  if (entry) {
    const selectedModel = selectedEntry ? selection.model : null;
    const model =
      resolveAppModelSelectionForInstance(entry.instanceId, settings, providers, selectedModel) ??
      entry.models[0]?.slug ??
      DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER[entry.driverKind];
    if (!model) {
      return createModelSelection(entry.instanceId, "", []);
    }
    const provider = entry.driverKind;
    const { modelOptionsForDispatch } = getComposerProviderState({
      provider,
      model,
      models: entry.models,
      prompt: "",
      modelOptions: selectedEntry ? selection.options : undefined,
    });

    return createModelSelection(entry.instanceId, model, modelOptionsForDispatch);
  }

  const provider = resolveSelectableProvider(providers, null);
  const model = resolveAppModelSelection(provider, settings, providers, null);
  const { modelOptionsForDispatch } = getComposerProviderState({
    provider,
    model,
    models: getProviderModels(providers, provider),
    prompt: "",
    modelOptions: undefined,
  });

  return createModelSelection(defaultInstanceIdForDriver(provider), model, modelOptionsForDispatch);
}
