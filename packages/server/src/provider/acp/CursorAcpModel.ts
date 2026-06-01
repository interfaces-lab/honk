import { type ProviderOptionSelection } from "@multi/contracts";
import {
  getProviderOptionBooleanSelectionValue,
  getProviderOptionStringSelectionValue,
} from "@multi/shared/model";
import { Effect } from "effect";
import type * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";

import { configOptionCurrentValueMatches, findSessionConfigOption } from "./AcpConfigOption.ts";
import type { AcpRuntimeShape } from "./AcpRuntime.ts";

export interface CursorSessionSelectOption {
  readonly value: string;
  readonly name: string;
}

export type CursorAcpModelSelectionErrorContext =
  | {
      readonly cause: EffectAcpErrors.AcpError;
      readonly method: "session/set_model";
      readonly step: "set-model";
    }
  | {
      readonly cause: EffectAcpErrors.AcpError;
      readonly configId: string;
      readonly method: "session/set_config_option";
      readonly step: "set-config-option";
    };

interface CursorAcpModelSelectionRuntime {
  readonly getConfigOptions: AcpRuntimeShape["getConfigOptions"];
  readonly setConfigOption: (
    configId: string,
    value: string | boolean,
  ) => Effect.Effect<unknown, EffectAcpErrors.AcpError>;
  readonly setModel: (model: string) => Effect.Effect<unknown, EffectAcpErrors.AcpError>;
}

export function flattenSessionConfigSelectOptions(
  configOption: EffectAcpSchema.SessionConfigOption | undefined,
): ReadonlyArray<CursorSessionSelectOption> {
  if (!configOption || configOption.type !== "select") {
    return [];
  }
  return configOption.options.flatMap((entry) =>
    "value" in entry
      ? [{ value: entry.value.trim(), name: entry.name.trim() } satisfies CursorSessionSelectOption]
      : entry.options.map(
          (option) =>
            ({
              value: option.value.trim(),
              name: option.name.trim(),
            }) satisfies CursorSessionSelectOption,
        ),
  );
}

export function normalizeCursorReasoningValue(
  value: string | null | undefined,
): string | undefined {
  const normalized = value?.trim().toLowerCase();
  switch (normalized) {
    case "low":
    case "medium":
    case "high":
    case "max":
      return normalized;
    case "xhigh":
    case "extra-high":
    case "extra high":
      return "xhigh";
    default:
      return undefined;
  }
}

export function findCursorModelConfigOption(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>,
): EffectAcpSchema.SessionConfigOption | undefined {
  return configOptions.find((option) => option.category === "model");
}

function getCursorConfigOptionCategory(option: EffectAcpSchema.SessionConfigOption): string {
  return option.category?.trim().toLowerCase() ?? "";
}

function isCursorEffortConfigOption(option: EffectAcpSchema.SessionConfigOption): boolean {
  const id = option.id.trim().toLowerCase();
  const name = option.name.trim().toLowerCase();
  return (
    id === "effort" ||
    id === "reasoning" ||
    name === "effort" ||
    name === "reasoning" ||
    name.includes("effort") ||
    name.includes("reasoning")
  );
}

export function findCursorEffortConfigOption(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>,
): EffectAcpSchema.SessionConfigOption | undefined {
  const candidates = configOptions.filter(
    (option) => option.type === "select" && isCursorEffortConfigOption(option),
  );
  return (
    candidates.find((option) => getCursorConfigOptionCategory(option) === "model_option") ??
    candidates.find((option) => option.id.trim().toLowerCase() === "effort") ??
    candidates.find((option) => getCursorConfigOptionCategory(option) === "thought_level") ??
    candidates[0]
  );
}

export function isCursorContextConfigOption(option: EffectAcpSchema.SessionConfigOption): boolean {
  const id = option.id.trim().toLowerCase();
  const name = option.name.trim().toLowerCase();
  return id === "context" || id === "context_size" || name.includes("context");
}

export function isCursorFastConfigOption(option: EffectAcpSchema.SessionConfigOption): boolean {
  const id = option.id.trim().toLowerCase();
  const name = option.name.trim().toLowerCase();
  return id === "fast" || name === "fast" || name.includes("fast mode");
}

export function isCursorThinkingConfigOption(option: EffectAcpSchema.SessionConfigOption): boolean {
  const id = option.id.trim().toLowerCase();
  const name = option.name.trim().toLowerCase();
  return id === "thinking" || name.includes("thinking");
}

export function isBooleanLikeConfigOption(option: EffectAcpSchema.SessionConfigOption): boolean {
  if (option.type === "boolean") {
    return true;
  }
  if (option.type !== "select") {
    return false;
  }
  const values = new Set(
    flattenSessionConfigSelectOptions(option).map((entry) => entry.value.trim().toLowerCase()),
  );
  return values.has("true") && values.has("false");
}

export function getBooleanCurrentValue(
  option: EffectAcpSchema.SessionConfigOption | undefined,
): boolean | undefined {
  if (!option) {
    return undefined;
  }
  if (option.type === "boolean") {
    return option.currentValue;
  }
  if (option.type !== "select") {
    return undefined;
  }
  const normalized = option.currentValue?.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return undefined;
}

function normalizeCursorConfigOptionToken(value: string | null | undefined): string {
  return (
    value
      ?.trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, "-") ?? ""
  );
}

function findCursorSelectOptionValue(
  configOption: EffectAcpSchema.SessionConfigOption | undefined,
  matcher: (option: CursorSessionSelectOption) => boolean,
): string | undefined {
  return flattenSessionConfigSelectOptions(configOption).find(matcher)?.value;
}

function findCursorBooleanConfigValue(
  configOption: EffectAcpSchema.SessionConfigOption | undefined,
  requested: boolean,
): string | boolean | undefined {
  if (!configOption) {
    return undefined;
  }
  if (configOption.type === "boolean") {
    return requested;
  }
  return findCursorSelectOptionValue(
    configOption,
    (option) => normalizeCursorConfigOptionToken(option.value) === String(requested),
  );
}

export function resolveCursorAcpBaseModelId(model: string | null | undefined): string {
  const trimmed = model?.trim();
  const base = trimmed && trimmed.length > 0 ? trimmed : "default";
  return base.includes("[") ? base.slice(0, base.indexOf("[")) : base;
}

export function resolveCursorAgentCliModelId(
  model: string | null | undefined,
  selections: ReadonlyArray<ProviderOptionSelection> | null | undefined,
): string | undefined {
  const base = resolveCursorAcpBaseModelId(model);
  if (base === "default") {
    return undefined;
  }
  const fastMode = getProviderOptionBooleanSelectionValue(selections, "fastMode");
  if (fastMode === true && !base.endsWith("-fast")) {
    return `${base}-fast`;
  }
  return base;
}

export function resolveCursorAcpSpawnCliModelId(input: {
  readonly model?: string | null | undefined;
  readonly selections?: ReadonlyArray<ProviderOptionSelection> | null | undefined;
}): string | undefined {
  return resolveCursorAgentCliModelId(input.model ?? null, input.selections);
}

export function resolveCursorAcpConfigUpdates(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption> | null | undefined,
  selections: ReadonlyArray<ProviderOptionSelection> | null | undefined,
): ReadonlyArray<{ readonly configId: string; readonly value: string | boolean }> {
  if (!configOptions || configOptions.length === 0) {
    return [];
  }

  const updates: Array<{ readonly configId: string; readonly value: string | boolean }> = [];

  const reasoningOption = findCursorEffortConfigOption(configOptions);
  const requestedReasoning = normalizeCursorReasoningValue(
    getProviderOptionStringSelectionValue(selections, "reasoning"),
  );
  if (reasoningOption && requestedReasoning) {
    const value = findCursorSelectOptionValue(reasoningOption, (option) => {
      const normalizedValue = normalizeCursorReasoningValue(option.value);
      const normalizedName = normalizeCursorReasoningValue(option.name);
      return normalizedValue === requestedReasoning || normalizedName === requestedReasoning;
    });
    if (value) {
      updates.push({ configId: reasoningOption.id, value });
    }
  }

  const contextOption = configOptions.find(
    (option) => option.category === "model_config" && isCursorContextConfigOption(option),
  );
  const requestedContextWindow = getProviderOptionStringSelectionValue(selections, "contextWindow");
  if (contextOption && requestedContextWindow) {
    const value = findCursorSelectOptionValue(
      contextOption,
      (option) =>
        normalizeCursorConfigOptionToken(option.value) ===
          normalizeCursorConfigOptionToken(requestedContextWindow) ||
        normalizeCursorConfigOptionToken(option.name) ===
          normalizeCursorConfigOptionToken(requestedContextWindow),
    );
    if (value) {
      updates.push({ configId: contextOption.id, value });
    }
  }

  const fastOption = configOptions.find(
    (option) => option.category === "model_config" && isCursorFastConfigOption(option),
  );
  const requestedFastMode = getProviderOptionBooleanSelectionValue(selections, "fastMode");
  if (fastOption && typeof requestedFastMode === "boolean") {
    const value = findCursorBooleanConfigValue(fastOption, requestedFastMode);
    if (value !== undefined) {
      updates.push({ configId: fastOption.id, value });
    }
  }

  const thinkingOption = configOptions.find(
    (option) => option.category === "model_config" && isCursorThinkingConfigOption(option),
  );
  const requestedThinking = getProviderOptionBooleanSelectionValue(selections, "thinking");
  if (thinkingOption && typeof requestedThinking === "boolean") {
    const value = findCursorBooleanConfigValue(thinkingOption, requestedThinking);
    if (value !== undefined) {
      updates.push({ configId: thinkingOption.id, value });
    }
  }

  return updates;
}

export function applyCursorAcpModelSelection<E>(input: {
  readonly runtime: CursorAcpModelSelectionRuntime;
  readonly model: string | null | undefined;
  readonly selections: ReadonlyArray<ProviderOptionSelection> | null | undefined;
  readonly mapError: (context: CursorAcpModelSelectionErrorContext) => E;
}): Effect.Effect<void, E> {
  return Effect.gen(function* () {
    let configOptions = yield* input.runtime.getConfigOptions;
    const baseModelId = resolveCursorAcpBaseModelId(input.model);
    const modelOption = findCursorModelConfigOption(configOptions);
    const modelAlreadySelected =
      modelOption !== undefined && configOptionCurrentValueMatches(modelOption, baseModelId);
    if (!modelAlreadySelected) {
      yield* input.runtime.setModel(baseModelId).pipe(
        Effect.mapError((cause) =>
          input.mapError({
            cause,
            method: "session/set_model",
            step: "set-model",
          }),
        ),
      );
      configOptions = yield* input.runtime.getConfigOptions;
    }

    const configUpdates = resolveCursorAcpConfigUpdates(configOptions, input.selections);
    for (const update of configUpdates) {
      const configOption = findSessionConfigOption(configOptions, update.configId);
      if (
        configOption !== undefined &&
        configOptionCurrentValueMatches(configOption, update.value)
      ) {
        continue;
      }
      yield* input.runtime.setConfigOption(update.configId, update.value).pipe(
        Effect.mapError((cause) =>
          input.mapError({
            cause,
            configId: update.configId,
            method: "session/set_config_option",
            step: "set-config-option",
          }),
        ),
      );
    }
  });
}
