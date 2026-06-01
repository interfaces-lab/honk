import { Effect } from "effect";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";

export const DEFAULT_VARIANT_VALUE = "default";

export type ConfigOptionModel = {
  readonly id: string;
  readonly name: string;
  readonly variants?: Record<string, Record<string, unknown>>;
};

export type ConfigOptionProvider = {
  readonly id: string;
  readonly name: string;
  readonly models: Record<string, ConfigOptionModel>;
};

export type ConfigOptionMode = {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
};

export type ModelSelection = {
  readonly model: {
    readonly providerID: string;
    readonly modelID: string;
  };
  readonly variant?: string;
};

type AcpSessionSetupResponse =
  | EffectAcpSchema.LoadSessionResponse
  | EffectAcpSchema.NewSessionResponse
  | EffectAcpSchema.ResumeSessionResponse;

export function buildModelSelectOption(input: {
  readonly providers: ReadonlyArray<ConfigOptionProvider>;
  readonly currentModel: ModelSelection["model"];
  readonly currentVariant?: string;
  readonly includeVariants?: boolean;
}): EffectAcpSchema.SessionConfigOption {
  return {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: formatCurrentModelId({
      model: input.currentModel,
      variants: variantsForModel(input.providers, input.currentModel),
      includeVariant: input.includeVariants ?? false,
      ...(input.currentVariant !== undefined ? { variant: input.currentVariant } : {}),
    }),
    options: buildModelSelectOptions(input.providers, {
      includeVariants: input.includeVariants ?? false,
    }),
  };
}

export function buildEffortSelectOption(input: {
  readonly variants: ReadonlyArray<string>;
  readonly currentVariant?: string;
}): EffectAcpSchema.SessionConfigOption | undefined {
  if (input.variants.length === 0) {
    return undefined;
  }

  return {
    id: "effort",
    name: "Effort",
    description: "Available effort levels for this model",
    category: "thought_level",
    type: "select",
    currentValue: selectVariant(input.currentVariant, input.variants),
    options: input.variants.map((variant) => ({
      value: variant,
      name: formatVariantName(variant),
    })),
  };
}

export function buildModeSelectOption(input: {
  readonly modes: ReadonlyArray<ConfigOptionMode>;
  readonly currentModeId: string;
}): EffectAcpSchema.SessionConfigOption {
  return {
    id: "mode",
    name: "Session Mode",
    category: "mode",
    type: "select",
    currentValue: input.currentModeId,
    options: input.modes.map((mode) => ({
      value: mode.id,
      name: mode.name,
      ...(mode.description ? { description: mode.description } : {}),
    })),
  };
}

export function buildConfigOptions(input: {
  readonly providers: ReadonlyArray<ConfigOptionProvider>;
  readonly currentModel: ModelSelection["model"];
  readonly currentVariant?: string;
  readonly includeModelVariants?: boolean;
  readonly modes?: ReadonlyArray<ConfigOptionMode>;
  readonly currentModeId?: string;
}): EffectAcpSchema.SessionConfigOption[] {
  const variants = variantsForModel(input.providers, input.currentModel);
  const effort = buildEffortSelectOption({
    variants,
    ...(input.currentVariant !== undefined ? { currentVariant: input.currentVariant } : {}),
  });

  return [
    buildModelSelectOption({
      providers: input.providers,
      currentModel: input.currentModel,
      includeVariants: input.includeModelVariants ?? false,
      ...(input.currentVariant !== undefined ? { currentVariant: input.currentVariant } : {}),
    }),
    ...(effort ? [effort] : []),
    ...(input.modes && input.currentModeId
      ? [buildModeSelectOption({ modes: input.modes, currentModeId: input.currentModeId })]
      : []),
  ];
}

export function parseModelSelection(
  modelId: string,
  providers: ReadonlyArray<ConfigOptionProvider>,
): ModelSelection {
  const provider = providers.find((item) => modelId.startsWith(`${item.id}/`));
  if (provider) {
    const modelID = modelId.slice(provider.id.length + 1);
    if (provider.models[modelID]) {
      return { model: { providerID: provider.id, modelID } };
    }

    const separator = modelID.lastIndexOf("/");
    if (separator > -1) {
      const baseModelID = modelID.slice(0, separator);
      const variant = modelID.slice(separator + 1);
      if (provider.models[baseModelID]?.variants?.[variant]) {
        return { model: { providerID: provider.id, modelID: baseModelID }, variant };
      }
    }

    return { model: { providerID: provider.id, modelID } };
  }

  const separator = modelId.indexOf("/");
  if (separator === -1) {
    return { model: { providerID: modelId, modelID: "" } };
  }

  return {
    model: {
      providerID: modelId.slice(0, separator),
      modelID: modelId.slice(separator + 1),
    },
  };
}

export function formatCurrentModelId(input: {
  readonly model: ModelSelection["model"];
  readonly variant?: string;
  readonly variants?: ReadonlyArray<string>;
  readonly includeVariant?: boolean;
}): string {
  const base = `${input.model.providerID}/${input.model.modelID}`;
  if (!input.includeVariant || !input.variants?.length) {
    return base;
  }
  return `${base}/${selectVariant(input.variant, input.variants)}`;
}

export function formatVariantName(variant: string): string {
  return variant
    .split(/[_-]/)
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(" ");
}

export function extractModelConfigId(sessionResponse: AcpSessionSetupResponse): string | undefined {
  const configOptions = sessionResponse.configOptions;
  if (!configOptions) return undefined;
  for (const opt of configOptions) {
    if (opt.category === "model" && opt.id.trim().length > 0) {
      return opt.id.trim();
    }
  }
  return undefined;
}

export function findSessionConfigOption(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption> | null | undefined,
  configId: string,
): EffectAcpSchema.SessionConfigOption | undefined {
  if (!configOptions) {
    return undefined;
  }
  const normalizedConfigId = configId.trim();
  if (!normalizedConfigId) {
    return undefined;
  }
  return configOptions.find((option) => option.id.trim() === normalizedConfigId);
}

export function collectSessionConfigOptionValues(
  configOption: EffectAcpSchema.SessionConfigOption,
): ReadonlyArray<string> {
  if (configOption.type !== "select") {
    return [];
  }
  return configOption.options.flatMap((entry) =>
    "value" in entry ? [entry.value] : entry.options.map((option) => option.value),
  );
}

export function sessionConfigOptionsFromSetup(
  response:
    | {
        readonly configOptions?: ReadonlyArray<EffectAcpSchema.SessionConfigOption> | null;
      }
    | undefined,
): ReadonlyArray<EffectAcpSchema.SessionConfigOption> {
  return response?.configOptions ?? [];
}

export function configOptionsWithCurrentValue(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>,
  configId: string,
  value: string | boolean,
): ReadonlyArray<EffectAcpSchema.SessionConfigOption> {
  return configOptions.map((option) => {
    if (option.id !== configId) {
      return option;
    }
    if (option.type === "boolean") {
      return {
        ...option,
        currentValue: typeof value === "boolean" ? value : value === "true",
      };
    }
    return {
      ...option,
      currentValue: String(value),
    };
  });
}

export function configOptionCurrentValueMatches(
  configOption: EffectAcpSchema.SessionConfigOption,
  value: string | boolean,
): boolean {
  const currentValue = configOption.currentValue;
  if (configOption.type === "boolean") {
    return currentValue === value;
  }
  if (typeof currentValue !== "string") {
    return false;
  }
  return currentValue.trim() === String(value).trim();
}

export function validateSessionConfigOptionValue(input: {
  readonly configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>;
  readonly configId: string;
  readonly value: string | boolean;
}): Effect.Effect<void, EffectAcpErrors.AcpError> {
  return Effect.gen(function* () {
    const configOption = findSessionConfigOption(input.configOptions, input.configId);
    if (!configOption) {
      return;
    }
    if (configOption.type === "boolean") {
      if (typeof input.value === "boolean") {
        return;
      }
      return yield* new EffectAcpErrors.AcpRequestError({
        code: -32602,
        errorMessage: `Invalid value ${JSON.stringify(input.value)} for session config option "${configOption.id}": expected boolean`,
        data: {
          configId: configOption.id,
          expectedType: "boolean",
          receivedValue: input.value,
        },
      });
    }
    if (typeof input.value !== "string") {
      return yield* new EffectAcpErrors.AcpRequestError({
        code: -32602,
        errorMessage: `Invalid value ${JSON.stringify(input.value)} for session config option "${configOption.id}": expected string`,
        data: {
          configId: configOption.id,
          expectedType: "string",
          receivedValue: input.value,
        },
      });
    }
    const allowedValues = collectSessionConfigOptionValues(configOption);
    if (allowedValues.includes(input.value)) {
      return;
    }
    return yield* new EffectAcpErrors.AcpRequestError({
      code: -32602,
      errorMessage: `Invalid value ${JSON.stringify(input.value)} for session config option "${configOption.id}": expected one of ${allowedValues.join(", ")}`,
      data: {
        configId: configOption.id,
        allowedValues,
        receivedValue: input.value,
      },
    });
  });
}

function buildModelSelectOptions(
  providers: ReadonlyArray<ConfigOptionProvider>,
  options: { readonly includeVariants: boolean },
): EffectAcpSchema.SessionConfigSelectOption[] {
  return providers.flatMap((provider) =>
    Object.values(provider.models)
      .sort((a, b) => a.name.localeCompare(b.name))
      .flatMap((model) => {
        const base = {
          value: `${provider.id}/${model.id}`,
          name: `${provider.name}/${model.name}`,
        };
        if (!options.includeVariants || !model.variants) {
          return [base];
        }

        return [
          base,
          ...Object.keys(model.variants)
            .filter((variant) => variant !== DEFAULT_VARIANT_VALUE)
            .map((variant) => ({
              value: `${provider.id}/${model.id}/${variant}`,
              name: `${provider.name}/${model.name} (${formatVariantName(variant)})`,
            })),
        ];
      }),
  );
}

function variantsForModel(
  providers: ReadonlyArray<ConfigOptionProvider>,
  model: ModelSelection["model"],
): string[] {
  return Object.keys(
    providers.find((provider) => provider.id === model.providerID)?.models[model.modelID]
      ?.variants ?? {},
  );
}

function selectVariant(variant: string | undefined, variants: ReadonlyArray<string>): string {
  if (variant && variants.includes(variant)) {
    return variant;
  }
  if (variants.includes(DEFAULT_VARIANT_VALUE)) {
    return DEFAULT_VARIANT_VALUE;
  }
  return variants[0] ?? DEFAULT_VARIANT_VALUE;
}
