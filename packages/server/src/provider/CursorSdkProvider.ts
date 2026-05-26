import { Cursor, type ModelListItem, type ModelParameterDefinition } from "@cursor/sdk";
import type {
  ModelCapabilities,
  ServerProvider,
  ServerProviderModel,
} from "@multi/contracts";
import { ProviderDriverKind } from "@multi/contracts";
import { createModelCapabilities } from "@multi/shared/model";
import { Cause, Data, Effect, Equal, Exit, Layer, Stream } from "effect";

import { makeManagedServerProvider } from "./make-managed-server-provider.ts";
import {
  buildSelectOptionDescriptor,
  buildServerProvider,
  providerModelsFromSettings,
} from "./provider-snapshot.ts";
import { CursorSdkProvider } from "./CursorSdkProvider.service.ts";
import { ServerSettingsService } from "../server-settings.ts";
import {
  resolveCursorSdkSettings,
  type ResolvedCursorSdkSettings,
} from "./provider-settings.ts";

const PROVIDER = ProviderDriverKind.make("cursorSdk");
const CURSOR_API_KEY_ENV_VAR = "CURSOR_API_KEY";
const CURSOR_SDK_REFRESH_INTERVAL = "1 hour";
const EMPTY_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});
const CURSOR_SDK_PRESENTATION = {
  displayName: "Cursor SDK",
  badgeLabel: "SDK",
  showInteractionModeToggle: true,
} as const;

function resolveCursorSdkApiKey(settings: ResolvedCursorSdkSettings): string | undefined {
  for (const variable of settings.environment) {
    if (variable.valueRedacted === true || variable.name !== CURSOR_API_KEY_ENV_VAR) {
      continue;
    }
    const value = variable.value.trim();
    if (value.length > 0) {
      return value;
    }
  }

  const envValue = process.env.CURSOR_API_KEY?.trim();
  return envValue && envValue.length > 0 ? envValue : undefined;
}

class CursorSdkProviderProbeError extends Data.TaggedError("CursorSdkProviderProbeError")<{
  readonly cause: unknown;
  readonly detail: string;
}> {}

function scrubCursorSdkError(error: unknown, apiKey: string | undefined): string {
  const raw =
    error instanceof CursorSdkProviderProbeError
      ? error.detail
      : error instanceof Error
        ? error.message
        : String(error);
  const scrubbed = apiKey ? raw.replaceAll(apiKey, "[redacted]") : raw;
  return scrubbed.trim() || "Cursor SDK request failed.";
}

function getDefaultParameterValue(
  item: ModelListItem,
  parameter: ModelParameterDefinition,
): string | undefined {
  for (const variant of item.variants ?? []) {
    if (variant.isDefault !== true) {
      continue;
    }
    const value = variant.params.find((param) => param.id === parameter.id)?.value;
    if (value) {
      return value;
    }
  }

  return item.variants?.[0]?.params.find((param) => param.id === parameter.id)?.value;
}

function cursorSdkModelCapabilities(item: ModelListItem): ModelCapabilities {
  return createModelCapabilities({
    optionDescriptors: (item.parameters ?? [])
      .filter((parameter) => parameter.values.length > 0)
      .map((parameter) =>
        buildSelectOptionDescriptor({
          id: parameter.id,
          label: parameter.displayName ?? parameter.id,
          options: parameter.values.map((value) => ({
            value: value.value,
            label: value.displayName ?? value.value,
            isDefault: getDefaultParameterValue(item, parameter) === value.value,
          })),
          ...(item.description ? { description: item.description } : {}),
        }),
      ),
  });
}

function cursorSdkProviderModel(item: ModelListItem): ServerProviderModel {
  return {
    slug: item.id,
    name: item.displayName || item.id,
    isCustom: false,
    capabilities: cursorSdkModelCapabilities(item),
  };
}

function cursorSdkModelsFromItems(
  items: ReadonlyArray<ModelListItem>,
  settings: ResolvedCursorSdkSettings,
): ReadonlyArray<ServerProviderModel> {
  return providerModelsFromSettings(
    items.map(cursorSdkProviderModel),
    PROVIDER,
    settings.customModels,
    EMPTY_CAPABILITIES,
  );
}

function buildInitialCursorSdkProviderSnapshot(settings: ResolvedCursorSdkSettings): ServerProvider {
  const checkedAt = new Date().toISOString();
  const models = providerModelsFromSettings([], PROVIDER, settings.customModels, EMPTY_CAPABILITIES);

  if (!settings.enabled) {
    return buildServerProvider({
      driver: PROVIDER,
      presentation: CURSOR_SDK_PRESENTATION,
      enabled: false,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Cursor SDK is disabled in Multi settings.",
      },
    });
  }

  return buildServerProvider({
    driver: PROVIDER,
    presentation: CURSOR_SDK_PRESENTATION,
    enabled: true,
    checkedAt,
    models,
    probe: {
      installed: true,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: "Checking Cursor SDK availability...",
    },
  });
}

const checkCursorSdkProviderStatus = Effect.fn("checkCursorSdkProviderStatus")(function* (
  settings: ResolvedCursorSdkSettings,
) {
  const checkedAt = new Date().toISOString();
  const apiKey = resolveCursorSdkApiKey(settings);

  if (!settings.enabled) {
    return buildInitialCursorSdkProviderSnapshot(settings);
  }

  if (!apiKey) {
    return buildServerProvider({
      driver: PROVIDER,
      presentation: CURSOR_SDK_PRESENTATION,
      enabled: true,
      checkedAt,
      models: providerModelsFromSettings([], PROVIDER, settings.customModels, EMPTY_CAPABILITIES),
      probe: {
        installed: true,
        version: null,
        status: "warning",
        auth: { status: "unauthenticated" },
        message:
          "Cursor SDK requires CURSOR_API_KEY. Add it to this provider instance environment or the Multi process environment.",
      },
    });
  }

  const userExit = yield* Effect.tryPromise({
    try: () => Cursor.me({ apiKey }),
    catch: (error) =>
      new CursorSdkProviderProbeError({
        cause: error,
        detail: error instanceof Error ? error.message : String(error),
      }),
  }).pipe(Effect.exit);

  if (Exit.isFailure(userExit)) {
    return buildServerProvider({
      driver: PROVIDER,
      presentation: CURSOR_SDK_PRESENTATION,
      enabled: true,
      checkedAt,
      models: providerModelsFromSettings([], PROVIDER, settings.customModels, EMPTY_CAPABILITIES),
      probe: {
        installed: true,
        version: null,
        status: "warning",
        auth: { status: "unauthenticated" },
        message: scrubCursorSdkError(Cause.squash(userExit.cause), apiKey),
      },
    });
  }

  const modelExit = yield* Effect.tryPromise({
    try: () => Cursor.models.list({ apiKey }),
    catch: (error) =>
      new CursorSdkProviderProbeError({
        cause: error,
        detail: error instanceof Error ? error.message : String(error),
      }),
  }).pipe(Effect.exit);

  if (Exit.isFailure(modelExit)) {
    return buildServerProvider({
      driver: PROVIDER,
      presentation: CURSOR_SDK_PRESENTATION,
      enabled: true,
      checkedAt,
      models: providerModelsFromSettings([], PROVIDER, settings.customModels, EMPTY_CAPABILITIES),
      probe: {
        installed: true,
        version: null,
        status: "warning",
        auth: { status: "authenticated", label: userExit.value.apiKeyName },
        message: scrubCursorSdkError(Cause.squash(modelExit.cause), apiKey),
      },
    });
  }

  return buildServerProvider({
    driver: PROVIDER,
    presentation: CURSOR_SDK_PRESENTATION,
    enabled: true,
    checkedAt,
    models: cursorSdkModelsFromItems(modelExit.value, settings),
    probe: {
      installed: true,
      version: null,
      status: "ready",
      auth: { status: "authenticated", label: userExit.value.apiKeyName },
      message: `Cursor SDK authenticated as ${userExit.value.apiKeyName}.`,
    },
  });
});

export const CursorSdkProviderLive = Layer.effect(
  CursorSdkProvider,
  Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService;
    const getProviderSettings = serverSettings.getSettings.pipe(
      Effect.map((settings) => resolveCursorSdkSettings(settings)),
    );

    return yield* makeManagedServerProvider<ResolvedCursorSdkSettings>({
      getSettings: getProviderSettings.pipe(Effect.orDie),
      streamSettings: serverSettings.streamChanges.pipe(
        Stream.map((settings) => resolveCursorSdkSettings(settings)),
      ),
      haveSettingsChanged: (previous, next) => !Equal.equals(previous, next),
      initialSnapshot: buildInitialCursorSdkProviderSnapshot,
      checkProvider: getProviderSettings.pipe(
        Effect.orDie,
        Effect.flatMap((settings) => checkCursorSdkProviderStatus(settings)),
      ),
      refreshInterval: CURSOR_SDK_REFRESH_INTERVAL,
    });
  }),
);
