import { ServerSettings, type ServerSettingsPatch } from "@multi/contracts";
import { Result, Schema } from "effect";
import { deepMerge } from "./Struct";
import { fromLenientJson } from "./schema-json";
import { createModelSelection } from "./model";

const ServerSettingsJson = fromLenientJson(ServerSettings);

export interface PersistedServerObservabilitySettings {
  readonly otlpTracesUrl: string | undefined;
  readonly otlpMetricsUrl: string | undefined;
}

export function normalizePersistedServerSettingString(
  value: string | null | undefined,
): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export function extractPersistedServerObservabilitySettings(input: {
  readonly observability?: {
    readonly otlpTracesUrl?: string;
    readonly otlpMetricsUrl?: string;
  };
}): PersistedServerObservabilitySettings {
  return {
    otlpTracesUrl: normalizePersistedServerSettingString(input.observability?.otlpTracesUrl),
    otlpMetricsUrl: normalizePersistedServerSettingString(input.observability?.otlpMetricsUrl),
  };
}

export function parsePersistedServerObservabilitySettings(
  raw: string,
): PersistedServerObservabilitySettings {
  const decoded = Result.try(() => Schema.decodeUnknownSync(ServerSettingsJson)(raw));
  return Result.isSuccess(decoded)
    ? extractPersistedServerObservabilitySettings(decoded.success)
    : { otlpTracesUrl: undefined, otlpMetricsUrl: undefined };
}

function shouldReplaceModelSelection(
  patch: NonNullable<
    ServerSettingsPatch["textGenerationModelSelection"] | ServerSettingsPatch["composerModelSelection"]
  >,
): boolean {
  return patch.instanceId !== undefined || patch.model !== undefined;
}

function mergeModelSelectionOptionsById(input: {
  current: ReadonlyArray<{ readonly id: string; readonly value: string | boolean }> | undefined;
  patch: ReadonlyArray<{ readonly id: string; readonly value: string | boolean }> | undefined;
}): Array<{ id: string; value: string | boolean }> | undefined {
  if (input.patch === undefined) {
    return input.current ? [...input.current] : undefined;
  }
  if (input.patch.length === 0) {
    return undefined;
  }

  const merged = new Map((input.current ?? []).map((selection) => [selection.id, selection.value]));
  for (const selection of input.patch) {
    merged.set(selection.id, selection.value);
  }
  return [...merged.entries()].map(([id, value]) => ({ id, value }));
}

function applyModelSelectionPatch(input: {
  currentSelection: ServerSettings["textGenerationModelSelection"] | null;
  patch:
    | ServerSettingsPatch["textGenerationModelSelection"]
    | ServerSettingsPatch["composerModelSelection"]
    | undefined;
}): ServerSettings["textGenerationModelSelection"] | null | undefined {
  if (input.patch === undefined) {
    return undefined;
  }
  if (input.patch === null) {
    return null;
  }

  const instanceId = input.patch.instanceId ?? input.currentSelection?.instanceId;
  const model = input.patch.model ?? input.currentSelection?.model;
  if (!instanceId || !model) {
    return input.currentSelection;
  }

  const options = shouldReplaceModelSelection(input.patch)
    ? input.patch.options
    : mergeModelSelectionOptionsById({
        current: input.currentSelection?.options,
        patch: input.patch.options,
      });

  return createModelSelection(instanceId, model, options);
}

/**
 * Applies a server settings patch while treating model selections as
 * replace-on-instance/model updates. This prevents stale nested options from
 * surviving a reset patch that intentionally omits options.
 */
export function applyServerSettingsPatch(
  current: ServerSettings,
  patch: ServerSettingsPatch,
): ServerSettings {
  const textGenerationSelectionPatch = patch.textGenerationModelSelection;
  const composerSelectionPatch = patch.composerModelSelection;
  const { providerInstances, ...patchWithoutProviderInstances } = patch;
  const next =
    providerInstances !== undefined
      ? {
          ...deepMerge(current, patchWithoutProviderInstances),
          providerInstances,
        }
      : deepMerge(current, patch);

  const textGenerationModelSelection = applyModelSelectionPatch({
    currentSelection: current.textGenerationModelSelection,
    patch: textGenerationSelectionPatch,
  });
  const composerModelSelection = applyModelSelectionPatch({
    currentSelection: current.composerModelSelection,
    patch: composerSelectionPatch,
  });

  return {
    ...next,
    ...(textGenerationModelSelection !== undefined && textGenerationModelSelection !== null
      ? { textGenerationModelSelection }
      : {}),
    ...(composerModelSelection !== undefined ? { composerModelSelection } : {}),
  };
}
