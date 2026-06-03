import { ServerSettings, type ServerSettingsPatch } from "@multi/contracts";
import { Result, Schema } from "effect";
import { deepMerge } from "./Struct";
import { fromLenientJson } from "./schema-json";
import { createModelSelection } from "./model";

const ServerSettingsJson = fromLenientJson(ServerSettings);
const decodeServerSettingsJsonSync = Schema.decodeUnknownSync(ServerSettingsJson);

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
  const decoded = Result.try(() => decodeServerSettingsJsonSync(raw));
  return Result.isSuccess(decoded)
    ? extractPersistedServerObservabilitySettings(decoded.success)
    : { otlpTracesUrl: undefined, otlpMetricsUrl: undefined };
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

/**
 * Applies a server settings patch while treating textGenerationModelSelection as
 * replace-on-instance/model updates. This prevents stale nested options from
 * surviving a reset patch that intentionally omits options.
 */
export function applyServerSettingsPatch(
  current: ServerSettings,
  patch: ServerSettingsPatch,
): ServerSettings {
  const selectionPatch = patch.textGenerationModelSelection;
  const next = deepMerge(current, patch);
  if (!selectionPatch) {
    return next;
  }

  const instanceId = selectionPatch.instanceId ?? current.textGenerationModelSelection.instanceId;
  const model = selectionPatch.model ?? current.textGenerationModelSelection.model;
  const options =
    selectionPatch.instanceId !== undefined || selectionPatch.model !== undefined
      ? selectionPatch.options
      : mergeModelSelectionOptionsById({
          current: current.textGenerationModelSelection.options,
          patch: selectionPatch.options,
        });

  return {
    ...next,
    textGenerationModelSelection: createModelSelection(instanceId, model, options),
  };
}
