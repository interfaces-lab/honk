import {
  ClaudeSettings,
  CodexSettings,
  CursorSdkSettings,
  CursorSettings,
  DEFAULT_SERVER_SETTINGS,
  OpenCodeSettings,
  type ProviderInstanceEnvironment,
  ProviderDriverKind,
  type ProviderInstanceConfig,
  type ProviderInstanceId,
  type ServerSettings,
  defaultInstanceIdForDriver,
} from "@multi/contracts";
import { Predicate, Schema } from "effect";

const CODEX_PROVIDER = ProviderDriverKind.make("codex");
const CLAUDE_AGENT_PROVIDER = ProviderDriverKind.make("claudeAgent");
const CURSOR_PROVIDER = ProviderDriverKind.make("cursor");
const CURSOR_SDK_PROVIDER = ProviderDriverKind.make("cursorSdk");
const OPENCODE_PROVIDER = ProviderDriverKind.make("opencode");
const decodeCodexSettings = Schema.decodeUnknownSync(CodexSettings);
const decodeClaudeSettings = Schema.decodeUnknownSync(ClaudeSettings);
const decodeCursorSettings = Schema.decodeUnknownSync(CursorSettings);
const decodeCursorSdkSettings = Schema.decodeUnknownSync(CursorSdkSettings);
const decodeOpenCodeSettings = Schema.decodeUnknownSync(OpenCodeSettings);
const DEFAULT_CURSOR_SETTINGS = decodeCursorSettings({});
const DEFAULT_CURSOR_SDK_SETTINGS = decodeCursorSdkSettings({});

export const CANONICAL_PROVIDER_DRIVER_ORDER = [
  CODEX_PROVIDER,
  CLAUDE_AGENT_PROVIDER,
  OPENCODE_PROVIDER,
  CURSOR_PROVIDER,
  CURSOR_SDK_PROVIDER,
] as const satisfies ReadonlyArray<ProviderDriverKind>;

export type ResolvedOpenCodeSettings = typeof OpenCodeSettings.Type & {
  readonly environment: ProviderInstanceEnvironment;
};

export type ResolvedCursorSdkSettings = typeof CursorSdkSettings.Type & {
  readonly environment: ProviderInstanceEnvironment;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Predicate.isObject(value);
}

function resolveProviderInstanceConfig(input: {
  readonly settings: ServerSettings;
  readonly driver: ProviderDriverKind;
  readonly instanceId: ProviderInstanceId;
}): ProviderInstanceConfig | undefined {
  const instance = input.settings.providerInstances[input.instanceId];
  if (instance?.driver !== input.driver) {
    return undefined;
  }
  return instance;
}

function resolveSettingsRecord(input: {
  readonly fallback: unknown;
  readonly instance: ProviderInstanceConfig | undefined;
}): Record<string, unknown> {
  const fallback = isRecord(input.fallback) ? input.fallback : {};
  if (!input.instance) {
    return { ...fallback };
  }

  return {
    ...fallback,
    ...(isRecord(input.instance.config) ? input.instance.config : {}),
    enabled: input.instance.enabled ?? true,
  };
}

function isDefaultProviderInstance(
  driver: ProviderDriverKind,
  instanceId: ProviderInstanceId,
): boolean {
  return instanceId === defaultInstanceIdForDriver(driver);
}

function fallbackCodexSettings(settings: ServerSettings, instanceId: ProviderInstanceId) {
  return isDefaultProviderInstance(CODEX_PROVIDER, instanceId)
    ? settings.providers.codex
    : DEFAULT_SERVER_SETTINGS.providers.codex;
}

function fallbackClaudeSettings(settings: ServerSettings, instanceId: ProviderInstanceId) {
  return isDefaultProviderInstance(CLAUDE_AGENT_PROVIDER, instanceId)
    ? settings.providers.claudeAgent
    : DEFAULT_SERVER_SETTINGS.providers.claudeAgent;
}

function fallbackCursorSettings(settings: ServerSettings, instanceId: ProviderInstanceId) {
  return isDefaultProviderInstance(CURSOR_PROVIDER, instanceId)
    ? settings.providers.cursor
    : DEFAULT_CURSOR_SETTINGS;
}

function fallbackCursorSdkSettings(settings: ServerSettings, instanceId: ProviderInstanceId) {
  return isDefaultProviderInstance(CURSOR_SDK_PROVIDER, instanceId)
    ? settings.providers.cursorSdk
    : DEFAULT_CURSOR_SDK_SETTINGS;
}

function fallbackOpenCodeSettings(settings: ServerSettings, instanceId: ProviderInstanceId) {
  return isDefaultProviderInstance(OPENCODE_PROVIDER, instanceId)
    ? settings.providers.opencode
    : DEFAULT_SERVER_SETTINGS.providers.opencode;
}

export function resolveCodexSettings(
  settings: ServerSettings,
  instanceId: ProviderInstanceId = defaultInstanceIdForDriver(CODEX_PROVIDER),
): typeof CodexSettings.Type {
  return decodeCodexSettings(
    resolveSettingsRecord({
      fallback: fallbackCodexSettings(settings, instanceId),
      instance: resolveProviderInstanceConfig({
        settings,
        driver: CODEX_PROVIDER,
        instanceId,
      }),
    }),
  );
}

export function resolveClaudeSettings(
  settings: ServerSettings,
  instanceId: ProviderInstanceId = defaultInstanceIdForDriver(CLAUDE_AGENT_PROVIDER),
): typeof ClaudeSettings.Type {
  return decodeClaudeSettings(
    resolveSettingsRecord({
      fallback: fallbackClaudeSettings(settings, instanceId),
      instance: resolveProviderInstanceConfig({
        settings,
        driver: CLAUDE_AGENT_PROVIDER,
        instanceId,
      }),
    }),
  );
}

export function resolveCursorSettings(
  settings: ServerSettings,
  instanceId: ProviderInstanceId = defaultInstanceIdForDriver(CURSOR_PROVIDER),
): typeof CursorSettings.Type {
  return decodeCursorSettings(
    resolveSettingsRecord({
      fallback: fallbackCursorSettings(settings, instanceId),
      instance: resolveProviderInstanceConfig({
        settings,
        driver: CURSOR_PROVIDER,
        instanceId,
      }),
    }),
  );
}

export function resolveCursorSdkSettings(
  settings: ServerSettings,
  instanceId: ProviderInstanceId = defaultInstanceIdForDriver(CURSOR_SDK_PROVIDER),
): ResolvedCursorSdkSettings {
  const instance = resolveProviderInstanceConfig({
    settings,
    driver: CURSOR_SDK_PROVIDER,
    instanceId,
  });
  const resolved = decodeCursorSdkSettings(
    resolveSettingsRecord({
      fallback: fallbackCursorSdkSettings(settings, instanceId),
      instance,
    }),
  );
  return {
    ...resolved,
    environment: instance?.environment ?? [],
  };
}

export function resolveOpenCodeSettings(
  settings: ServerSettings,
  instanceId: ProviderInstanceId = defaultInstanceIdForDriver(OPENCODE_PROVIDER),
): ResolvedOpenCodeSettings {
  const instance = resolveProviderInstanceConfig({
    settings,
    driver: OPENCODE_PROVIDER,
    instanceId,
  });
  const resolved = decodeOpenCodeSettings(
    resolveSettingsRecord({
      fallback: fallbackOpenCodeSettings(settings, instanceId),
      instance,
    }),
  );
  return {
    ...resolved,
    environment: instance?.environment ?? [],
  };
}

export function resolveProviderEnabled(input: {
  readonly settings: ServerSettings;
  readonly driver: ProviderDriverKind;
  readonly instanceId?: ProviderInstanceId | undefined;
}): boolean {
  const instanceId = input.instanceId ?? defaultInstanceIdForDriver(input.driver);
  switch (input.driver) {
    case CODEX_PROVIDER:
      return resolveCodexSettings(input.settings, instanceId).enabled;
    case CLAUDE_AGENT_PROVIDER:
      return resolveClaudeSettings(input.settings, instanceId).enabled;
    case OPENCODE_PROVIDER:
      return resolveOpenCodeSettings(input.settings, instanceId).enabled;
    case CURSOR_PROVIDER:
      return resolveCursorSettings(input.settings, instanceId).enabled;
    case CURSOR_SDK_PROVIDER:
      return resolveCursorSdkSettings(input.settings, instanceId).enabled;
    default:
      return input.settings.providerInstances[instanceId]?.enabled ?? true;
  }
}
