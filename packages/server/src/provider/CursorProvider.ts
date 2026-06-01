import * as nodeFs from "node:fs";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";

import type {
  CursorSettings,
  ModelCapabilities,
  ServerProvider,
  ServerProviderAuth,
  ServerProviderModel,
  ServerProviderState,
  ServerSettingsError,
} from "@multi/contracts";
import { ProviderDriverKind } from "@multi/contracts";
import type * as EffectAcpSchema from "effect-acp/schema";
import { Cause, Effect, Equal, Exit, Layer, Option, Result, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { createModelCapabilities } from "@multi/shared/model";

import {
  buildBooleanOptionDescriptor,
  buildSelectOptionDescriptor,
  buildServerProvider,
  collectStreamAsString,
  isCommandMissingCause,
  providerModelsFromSettings,
  type CommandResult,
} from "./provider-snapshot.ts";
import { makeManagedServerProvider } from "./make-managed-server-provider.ts";
import { CursorProvider } from "./CursorProvider.service.ts";
import { AcpRuntime, type AcpRuntimeOptions } from "./acp/AcpRuntime.ts";
import {
  findCursorEffortConfigOption,
  findCursorModelConfigOption,
  flattenSessionConfigSelectOptions,
  getBooleanCurrentValue,
  isBooleanLikeConfigOption,
  isCursorContextConfigOption,
  isCursorFastConfigOption,
  isCursorThinkingConfigOption,
  normalizeCursorReasoningValue,
} from "./acp/CursorAcpModel.ts";
import { ServerSettingsService } from "../server-settings.ts";
import { resolveCursorSettings } from "./provider-settings.ts";

const PROVIDER = ProviderDriverKind.make("cursor");
const CURSOR_PRESENTATION = {
  displayName: "Cursor",
  showInteractionModeToggle: true,
} as const;
const EMPTY_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});

const CURSOR_ACP_MODEL_DISCOVERY_TIMEOUT_MS = 15_000;
const CURSOR_ACP_MODEL_CAPABILITY_TIMEOUT = "4 seconds";
const CURSOR_ACP_MODEL_DISCOVERY_CONCURRENCY = 4;
const CURSOR_REFRESH_INTERVAL = "1 hour";
const CURSOR_PARAMETERIZED_MODEL_PICKER_MIN_VERSION_DATE = 2026_04_08;
export const CURSOR_PARAMETERIZED_MODEL_PICKER_CAPABILITIES = {
  _meta: {
    parameterizedModelPicker: true,
  },
} satisfies NonNullable<EffectAcpSchema.InitializeRequest["clientCapabilities"]>;

function buildInitialCursorProviderSnapshot(cursorSettings: CursorSettings): ServerProvider {
  const checkedAt = new Date().toISOString();
  const models = getCursorFallbackModels(cursorSettings);

  if (!cursorSettings.enabled) {
    return buildServerProvider({
      driver: PROVIDER,
      presentation: CURSOR_PRESENTATION,
      enabled: false,
      checkedAt,
      models,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Cursor is disabled in Multi settings.",
      },
    });
  }

  return buildServerProvider({
    driver: PROVIDER,
    presentation: CURSOR_PRESENTATION,
    enabled: true,
    checkedAt,
    models,
    probe: {
      installed: true,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: "Checking Cursor Agent availability...",
    },
  });
}

interface CursorAcpDiscoveredModel {
  readonly slug: string;
  readonly name: string;
  readonly capabilities: ModelCapabilities | null;
}

export function buildCursorCapabilitiesFromConfigOptions(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption> | null | undefined,
): ModelCapabilities {
  if (!configOptions || configOptions.length === 0) {
    return EMPTY_CAPABILITIES;
  }

  const reasoningConfig = findCursorEffortConfigOption(configOptions);
  const reasoningEffortLevels =
    reasoningConfig?.type === "select"
      ? flattenSessionConfigSelectOptions(reasoningConfig).flatMap((entry) => {
          const normalizedValue = normalizeCursorReasoningValue(entry.value);
          if (!normalizedValue) {
            return [];
          }
          return [
            {
              value: normalizedValue,
              label: entry.name,
              ...(normalizeCursorReasoningValue(reasoningConfig.currentValue) === normalizedValue
                ? { isDefault: true }
                : {}),
            },
          ];
        })
      : [];

  const contextOption = configOptions.find(
    (option) => option.category === "model_config" && isCursorContextConfigOption(option),
  );
  const contextWindowOptions =
    contextOption?.type === "select"
      ? flattenSessionConfigSelectOptions(contextOption).map((entry) => {
          if (contextOption.currentValue === entry.value) {
            return {
              value: entry.value,
              label: entry.name,
              isDefault: true,
            };
          }
          return {
            value: entry.value,
            label: entry.name,
          };
        })
      : [];

  const fastOption = configOptions.find(
    (option) => option.category === "model_config" && isCursorFastConfigOption(option),
  );
  const thinkingOption = configOptions.find(
    (option) => option.category === "model_config" && isCursorThinkingConfigOption(option),
  );
  const fastCurrentValue = getBooleanCurrentValue(fastOption);
  const thinkingCurrentValue = getBooleanCurrentValue(thinkingOption);
  const optionDescriptors = [
    ...(reasoningEffortLevels.length > 0
      ? [
          buildSelectOptionDescriptor({
            id: "reasoning",
            label: reasoningConfig?.name?.trim() || "Reasoning",
            options: reasoningEffortLevels,
          }),
        ]
      : []),
    ...(contextWindowOptions.length > 0
      ? [
          buildSelectOptionDescriptor({
            id: "contextWindow",
            label: contextOption?.name?.trim() || "Context Window",
            options: contextWindowOptions,
          }),
        ]
      : []),
    ...(fastOption && isBooleanLikeConfigOption(fastOption)
      ? [
          typeof fastCurrentValue === "boolean"
            ? buildBooleanOptionDescriptor({
                id: "fastMode",
                label: fastOption.name?.trim() || "Fast Mode",
                currentValue: fastCurrentValue,
              })
            : buildBooleanOptionDescriptor({
                id: "fastMode",
                label: fastOption.name?.trim() || "Fast Mode",
              }),
        ]
      : []),
    ...(thinkingOption && isBooleanLikeConfigOption(thinkingOption)
      ? [
          typeof thinkingCurrentValue === "boolean"
            ? buildBooleanOptionDescriptor({
                id: "thinking",
                label: thinkingOption.name?.trim() || "Thinking",
                currentValue: thinkingCurrentValue,
              })
            : buildBooleanOptionDescriptor({
                id: "thinking",
                label: thinkingOption.name?.trim() || "Thinking",
              }),
        ]
      : []),
  ];

  return createModelCapabilities({
    optionDescriptors,
  });
}

function buildCursorDiscoveredModels(
  discoveredModels: ReadonlyArray<CursorAcpDiscoveredModel>,
): ReadonlyArray<ServerProviderModel> {
  const seen = new Set<string>();
  return discoveredModels.flatMap((model) => {
    if (!model.slug || seen.has(model.slug)) {
      return [];
    }
    seen.add(model.slug);
    return [
      {
        slug: model.slug,
        name: model.name,
        isCustom: false,
        capabilities: model.capabilities,
      } satisfies ServerProviderModel,
    ];
  });
}

function hasKnownCursorModelCapabilities(
  model: Pick<ServerProviderModel, "capabilities">,
): boolean {
  return model.capabilities !== null;
}

export function buildCursorCapabilitiesForModelConfigResponse(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption> | null | undefined,
  expectedModel: string | null | undefined,
): ModelCapabilities {
  const expectedModelValue = expectedModel?.trim();
  if (!expectedModelValue) {
    return EMPTY_CAPABILITIES;
  }

  const modelOption = findCursorModelConfigOption(configOptions ?? []);
  const currentModelValue =
    modelOption?.type === "select" ? modelOption.currentValue?.trim() || undefined : undefined;
  if (currentModelValue !== expectedModelValue) {
    return EMPTY_CAPABILITIES;
  }

  return buildCursorCapabilitiesFromConfigOptions(configOptions);
}

export function buildCursorDiscoveredModelsFromConfigOptions(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption> | null | undefined,
): ReadonlyArray<ServerProviderModel> {
  if (!configOptions || configOptions.length === 0) {
    return [];
  }

  const modelOption = findCursorModelConfigOption(configOptions);
  const modelChoices = flattenSessionConfigSelectOptions(modelOption);
  if (!modelOption || modelChoices.length === 0) {
    return [];
  }

  const currentModelValue =
    modelOption.type === "select" ? modelOption.currentValue?.trim() || undefined : undefined;
  const currentModelCapabilities = buildCursorCapabilitiesForModelConfigResponse(
    configOptions,
    currentModelValue,
  );

  return buildCursorDiscoveredModels(
    modelChoices.map((modelChoice) => ({
      slug: modelChoice.value.trim(),
      name: modelChoice.name.trim(),
      capabilities:
        currentModelValue === modelChoice.value.trim() ? currentModelCapabilities : null,
    })),
  );
}

const makeCursorAcpProbeRuntime = (
  cursorSettings: CursorSettings,
  requestLogger?: AcpRuntimeOptions["requestLogger"],
) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const acpContext = yield* Layer.build(
      AcpRuntime.layer({
        spawn: {
          command: cursorSettings.binaryPath,
          args: [
            ...(cursorSettings.apiEndpoint ? (["-e", cursorSettings.apiEndpoint] as const) : []),
            "acp",
          ],
          cwd: process.cwd(),
        },
        cwd: process.cwd(),
        clientInfo: { name: "multi-provider-probe", version: "0.0.0" },
        authMethodId: "cursor_login",
        clientCapabilities: CURSOR_PARAMETERIZED_MODEL_PICKER_CAPABILITIES,
        ...(requestLogger ? { requestLogger } : {}),
      }).pipe(Layer.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner))),
    );
    return yield* Effect.service(AcpRuntime).pipe(Effect.provide(acpContext));
  });

const withCursorAcpProbeRuntime = <A, E, R>(
  cursorSettings: CursorSettings,
  useRuntime: (acp: AcpRuntime["Service"]) => Effect.Effect<A, E, R>,
  requestLogger?: AcpRuntimeOptions["requestLogger"],
) =>
  makeCursorAcpProbeRuntime(cursorSettings, requestLogger).pipe(
    Effect.flatMap(useRuntime),
    Effect.scoped,
  );

export const discoverCursorModelsViaAcp = (
  cursorSettings: CursorSettings,
  requestLogger?: AcpRuntimeOptions["requestLogger"],
) =>
  withCursorAcpProbeRuntime(
    cursorSettings,
    (acp) =>
      Effect.map(acp.start(), (started) =>
        buildCursorDiscoveredModelsFromConfigOptions(
          started.sessionSetupResult.configOptions ?? [],
        ),
      ),
    requestLogger,
  );

export const discoverCursorModelCapabilitiesViaAcp = (
  cursorSettings: CursorSettings,
  existingModels: ReadonlyArray<ServerProviderModel>,
) =>
  withCursorAcpProbeRuntime(cursorSettings, (acp) =>
    Effect.gen(function* () {
      const started = yield* acp.start();
      const initialConfigOptions = started.sessionSetupResult.configOptions ?? [];
      const modelOption = findCursorModelConfigOption(initialConfigOptions);
      const modelChoices = flattenSessionConfigSelectOptions(modelOption);
      if (!modelOption || modelChoices.length === 0) {
        return [];
      }

      const currentModelValue =
        modelOption.type === "select" ? modelOption.currentValue?.trim() || undefined : undefined;
      const capabilitiesBySlug = new Map(
        existingModels.flatMap((model) =>
          model.capabilities === null ? [] : ([[model.slug, model.capabilities]] as const),
        ),
      );
      if (currentModelValue) {
        capabilitiesBySlug.set(
          currentModelValue,
          buildCursorCapabilitiesForModelConfigResponse(initialConfigOptions, currentModelValue),
        );
      }

      const targetModelSlugs = new Set(
        existingModels
          .filter((model) => !model.isCustom && !hasKnownCursorModelCapabilities(model))
          .map((model) => model.slug),
      );
      if (targetModelSlugs.size === 0) {
        return buildCursorDiscoveredModels(
          modelChoices.map((modelChoice) => ({
            slug: modelChoice.value.trim(),
            name: modelChoice.name.trim(),
            capabilities: capabilitiesBySlug.get(modelChoice.value.trim()) ?? null,
          })),
        );
      }

      const probedCapabilities = yield* Effect.forEach(
        modelChoices,
        (modelChoice) => {
          const modelSlug = modelChoice.value.trim();
          if (!modelSlug || !targetModelSlugs.has(modelSlug) || capabilitiesBySlug.has(modelSlug)) {
            return Effect.void.pipe(
              Effect.as<readonly [string, ModelCapabilities] | undefined>(undefined),
            );
          }

          return withCursorAcpProbeRuntime(cursorSettings, (probeAcp) =>
            Effect.gen(function* () {
              const probeStarted = yield* probeAcp.start();
              const probeConfigOptions = probeStarted.sessionSetupResult.configOptions ?? [];
              const probeModelOption = findCursorModelConfigOption(probeConfigOptions);
              const probeCurrentModelValue =
                probeModelOption?.type === "select"
                  ? probeModelOption.currentValue?.trim() || undefined
                  : undefined;
              yield* Effect.annotateCurrentSpan({
                "cursor.acp.model.value": modelSlug,
                "cursor.acp.model.currentValue": probeCurrentModelValue,
                "cursor.acp.config_option_id": probeModelOption?.id ?? modelOption.id,
              });
              const nextConfigOptions =
                probeCurrentModelValue === modelSlug
                  ? probeConfigOptions
                  : yield* probeAcp
                      .setConfigOption(probeModelOption?.id ?? modelOption.id, modelSlug)
                      .pipe(Effect.map((response) => response.configOptions ?? probeConfigOptions));
              return [
                modelSlug,
                buildCursorCapabilitiesForModelConfigResponse(nextConfigOptions, modelSlug),
              ] as const;
            }),
          ).pipe(
            Effect.timeout(CURSOR_ACP_MODEL_CAPABILITY_TIMEOUT),
            Effect.retry({ times: 3 }),
            Effect.withSpan("cursor-acp-model-capability-probe"),
            Effect.catchCause((cause) =>
              Effect.logDebug("Cursor ACP capability probe failed", {
                modelSlug,
                cause: Cause.pretty(cause),
              }),
            ),
          );
        },
        { concurrency: CURSOR_ACP_MODEL_DISCOVERY_CONCURRENCY },
      );

      for (const entry of probedCapabilities) {
        if (!entry) {
          continue;
        }
        capabilitiesBySlug.set(entry[0], entry[1]);
      }

      return buildCursorDiscoveredModels(
        modelChoices.map((modelChoice) => ({
          slug: modelChoice.value.trim(),
          name: modelChoice.name.trim(),
          capabilities: capabilitiesBySlug.get(modelChoice.value.trim()) ?? null,
        })),
      );
    }).pipe(Effect.withSpan("cursor-acp-model-capability-discovery", {})),
  );

export function getCursorFallbackModels(
  cursorSettings: Pick<CursorSettings, "customModels">,
): ReadonlyArray<ServerProviderModel> {
  return providerModelsFromSettings([], PROVIDER, cursorSettings.customModels, EMPTY_CAPABILITIES);
}

/** Timeout for `agent about` — it's slower than a simple `--version` probe. */
const ABOUT_TIMEOUT_MS = 8_000;

/** Strip ANSI escape sequences so we can parse plain key-value lines. */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[A-Za-z]|\x1b\].*?\x07/g, "");
}

/**
 * Extract a value from `agent about` key-value output.
 * Lines look like: `CLI Version         2026.03.20-44cb435`
 */
function extractAboutField(plain: string, key: string): string | undefined {
  const regex = new RegExp(`^${key}\\s{2,}(.+)$`, "mi");
  const match = regex.exec(plain);
  return match?.[1]?.trim();
}

export interface CursorAboutResult {
  readonly version: string | null;
  readonly status: Exclude<ServerProviderState, "disabled">;
  readonly auth: ServerProviderAuth;
  readonly message?: string;
}

function cursorAcpAuthenticationFailure(
  parsed: CursorAboutResult,
  detail: string,
): CursorAboutResult {
  return {
    version: parsed.version,
    status: "error",
    auth: { status: "unauthenticated" },
    message: `Cursor Agent ACP authentication failed. Run \`agent login\` and try again. ${detail}`,
  };
}

function formatCursorAcpFailureDetail(cause: Cause.Cause<unknown>): string {
  const error = Cause.squash(cause);
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }
  return Cause.pretty(cause);
}

function joinProviderMessages(...messages: ReadonlyArray<string | undefined>): string | undefined {
  const parts = messages
    .map((message) => message?.trim())
    .filter((message): message is string => Boolean(message));
  return parts.length > 0 ? parts.join(" ") : undefined;
}

export function buildCursorProviderSnapshot(input: {
  readonly checkedAt: string;
  readonly cursorSettings: CursorSettings;
  readonly parsed: CursorAboutResult;
  readonly discoveredModels?: ReadonlyArray<ServerProviderModel>;
  readonly discoveryWarning?: string;
}): ServerProvider {
  const message = joinProviderMessages(input.parsed.message, input.discoveryWarning);
  return buildServerProvider({
    driver: PROVIDER,
    presentation: CURSOR_PRESENTATION,
    enabled: input.cursorSettings.enabled,
    checkedAt: input.checkedAt,
    models: providerModelsFromSettings(
      input.discoveredModels ?? [],
      PROVIDER,
      input.cursorSettings.customModels,
      EMPTY_CAPABILITIES,
    ),
    probe: {
      installed: true,
      version: input.parsed.version,
      status:
        input.discoveryWarning && input.parsed.status === "ready" ? "warning" : input.parsed.status,
      auth: input.parsed.auth,
      ...(message ? { message } : {}),
    },
  });
}

interface CursorAboutJsonPayload {
  readonly cliVersion?: unknown;
  readonly subscriptionTier?: unknown;
  readonly userEmail?: unknown;
}

export function parseCursorVersionDate(version: string | null | undefined): number | undefined {
  const match = version?.trim().match(/^(\d{4})\.(\d{2})\.(\d{2})(?:\b|-|$)/);
  if (!match) {
    return undefined;
  }
  const [, year, month, day] = match;
  return Number(`${year}${month}${day}`);
}

export function parseCursorCliConfigChannel(raw: string): string | undefined {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "channel" in parsed &&
      typeof parsed.channel === "string"
    ) {
      const channel = parsed.channel.trim().toLowerCase();
      return channel.length > 0 ? channel : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function toTitleCaseWords(value: string): string {
  return value
    .split(/[\s_-]+/g)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function cursorSubscriptionLabel(subscriptionType: string | undefined): string | undefined {
  const normalized = subscriptionType?.toLowerCase().replace(/[\s_-]+/g, "");
  if (!normalized) return undefined;

  switch (normalized) {
    case "team":
      return "Team";
    case "pro":
      return "Pro";
    case "free":
      return "Free";
    case "business":
      return "Business";
    case "enterprise":
      return "Enterprise";
    default:
      return toTitleCaseWords(subscriptionType!);
  }
}

function cursorAuthMetadata(
  subscriptionType: string | undefined,
): Pick<ServerProviderAuth, "label" | "type"> | undefined {
  if (!subscriptionType) {
    return undefined;
  }
  const subscriptionLabel = cursorSubscriptionLabel(subscriptionType);
  return {
    type: subscriptionType,
    label: `Cursor ${subscriptionLabel ?? toTitleCaseWords(subscriptionType)} Subscription`,
  };
}

function parseCursorAboutJsonPayload(raw: string): CursorAboutJsonPayload | undefined {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    return parsed as CursorAboutJsonPayload;
  } catch {
    return undefined;
  }
}

function hasOwn(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function isCursorAboutJsonFormatUnsupported(result: CommandResult): boolean {
  const lowerOutput = `${result.stdout}\n${result.stderr}`.toLowerCase();
  return (
    lowerOutput.includes("unknown option '--format'") ||
    lowerOutput.includes("unexpected argument '--format'") ||
    lowerOutput.includes("unrecognized option '--format'") ||
    lowerOutput.includes("unknown argument '--format'")
  );
}

function readCursorCliConfigChannel(): string | undefined {
  try {
    const configPath = nodePath.join(nodeOs.homedir(), ".cursor", "cli-config.json");
    return parseCursorCliConfigChannel(nodeFs.readFileSync(configPath, "utf8"));
  } catch {
    return undefined;
  }
}

export function getCursorParameterizedModelPickerUnsupportedMessage(input: {
  readonly version: string | null | undefined;
  readonly channel: string | null | undefined;
}): string | undefined {
  const reasons: Array<string> = [];
  const versionDate = parseCursorVersionDate(input.version);
  if (
    versionDate !== undefined &&
    versionDate < CURSOR_PARAMETERIZED_MODEL_PICKER_MIN_VERSION_DATE
  ) {
    reasons.push(
      `Cursor Agent CLI version ${input.version} is too old for Cursor ACP parameterized model picker`,
    );
  }

  const normalizedChannel = input.channel?.trim().toLowerCase();
  if (
    normalizedChannel !== undefined &&
    normalizedChannel.length > 0 &&
    normalizedChannel !== "lab"
  ) {
    reasons.push(
      `Cursor Agent CLI channel is ${JSON.stringify(input.channel)}, but parameterized model picker is only available on the lab channel`,
    );
  }

  if (reasons.length === 0) {
    return undefined;
  }

  return `${reasons.join(". ")}. Run \`agent set-channel lab && agent update\` and use Cursor Agent CLI 2026.04.08 or newer.`;
}

/**
 * Parse the output of `agent about` to extract version and authentication
 * status in a single probe.
 *
 * Example output (logged in):
 * ```
 * About Cursor CLI
 *
 * CLI Version         2026.03.20-44cb435
 * User Email          user@example.com
 * ```
 *
 * Example output (logged out):
 * ```
 * About Cursor CLI
 *
 * CLI Version         2026.03.20-44cb435
 * User Email          Not logged in
 * ```
 */
export function parseCursorAboutOutput(result: CommandResult): CursorAboutResult {
  const jsonPayload = parseCursorAboutJsonPayload(result.stdout);
  if (jsonPayload) {
    const version =
      typeof jsonPayload.cliVersion === "string" ? jsonPayload.cliVersion.trim() : null;
    const hasUserEmailField = hasOwn(jsonPayload, "userEmail");
    const userEmail =
      typeof jsonPayload.userEmail === "string" ? jsonPayload.userEmail.trim() : undefined;
    const subscriptionType =
      typeof jsonPayload.subscriptionTier === "string"
        ? jsonPayload.subscriptionTier.trim()
        : undefined;
    const authMetadata = cursorAuthMetadata(subscriptionType);

    if (hasUserEmailField && jsonPayload.userEmail == null) {
      return {
        version,
        status: "error",
        auth: { status: "unauthenticated" },
        message: "Cursor Agent is not authenticated. Run `agent login` and try again.",
      };
    }

    if (!userEmail) {
      if (result.code === 0) {
        return {
          version,
          status: "ready",
          auth: {
            status: "unknown",
            ...authMetadata,
          },
        };
      }
      return {
        version,
        status: "warning",
        auth: { status: "unknown" },
        message: "Could not verify Cursor Agent authentication status.",
      };
    }

    const lowerEmail = userEmail.toLowerCase();
    if (
      lowerEmail === "not logged in" ||
      lowerEmail.includes("login required") ||
      lowerEmail.includes("authentication required")
    ) {
      return {
        version,
        status: "error",
        auth: { status: "unauthenticated" },
        message: "Cursor Agent is not authenticated. Run `agent login` and try again.",
      };
    }

    return {
      version,
      status: "ready",
      auth: {
        status: "authenticated",
        ...authMetadata,
      },
    };
  }

  const combined = `${result.stdout}\n${result.stderr}`;
  const lowerOutput = combined.toLowerCase();

  // If the command itself isn't recognised, we're on an old CLI version.
  if (
    lowerOutput.includes("unknown command") ||
    lowerOutput.includes("unrecognized command") ||
    lowerOutput.includes("unexpected argument")
  ) {
    return {
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: "The `agent about` command is unavailable in this version of the Cursor Agent CLI.",
    };
  }

  const plain = stripAnsi(combined);
  const version = extractAboutField(plain, "CLI Version") ?? null;
  const userEmail = extractAboutField(plain, "User Email");

  // Determine auth from the User Email field.
  if (userEmail === undefined) {
    // Field missing entirely — can't determine auth.
    if (result.code === 0) {
      return { version, status: "ready", auth: { status: "unknown" } };
    }
    return {
      version,
      status: "warning",
      auth: { status: "unknown" },
      message: "Could not verify Cursor Agent authentication status.",
    };
  }

  const lowerEmail = userEmail.toLowerCase();
  if (
    lowerEmail === "not logged in" ||
    lowerEmail.includes("login required") ||
    lowerEmail.includes("authentication required")
  ) {
    return {
      version,
      status: "error",
      auth: { status: "unauthenticated" },
      message: "Cursor Agent is not authenticated. Run `agent login` and try again.",
    };
  }

  // Any non-empty email value means authenticated.
  return { version, status: "ready", auth: { status: "authenticated" } };
}

const runCursorCommand = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const cursorSettings = yield* Effect.service(ServerSettingsService).pipe(
      Effect.flatMap((service) => service.getSettings),
      Effect.map(resolveCursorSettings),
    );
    const command = ChildProcess.make(cursorSettings.binaryPath, [...args], {
      shell: process.platform === "win32",
    });

    const child = yield* spawner.spawn(command);
    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        collectStreamAsString(child.stdout),
        collectStreamAsString(child.stderr),
        child.exitCode.pipe(Effect.map(Number)),
      ],
      { concurrency: "unbounded" },
    );

    return { stdout, stderr, code: exitCode } satisfies CommandResult;
  }).pipe(Effect.scoped);

const runCursorAboutCommand = Effect.gen(function* () {
  const jsonResult = yield* runCursorCommand(["about", "--format", "json"]);
  if (!isCursorAboutJsonFormatUnsupported(jsonResult)) {
    return jsonResult;
  }
  return yield* runCursorCommand(["about"]);
});

export const checkCursorProviderStatus = Effect.fn("checkCursorProviderStatus")(
  function* (): Effect.fn.Return<
    ServerProvider,
    ServerSettingsError,
    ChildProcessSpawner.ChildProcessSpawner | ServerSettingsService
  > {
    const cursorSettings = yield* Effect.service(ServerSettingsService).pipe(
      Effect.flatMap((service) => service.getSettings),
      Effect.map(resolveCursorSettings),
    );
    const checkedAt = new Date().toISOString();
    const fallbackModels = getCursorFallbackModels(cursorSettings);

    if (!cursorSettings.enabled) {
      return buildServerProvider({
        driver: PROVIDER,
        presentation: CURSOR_PRESENTATION,
        enabled: false,
        checkedAt,
        models: fallbackModels,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Cursor is disabled in Multi settings.",
        },
      });
    }

    // Single `agent about` probe: returns version + auth status in one call.
    const aboutProbe = yield* runCursorAboutCommand.pipe(
      Effect.timeoutOption(ABOUT_TIMEOUT_MS),
      Effect.result,
    );

    if (Result.isFailure(aboutProbe)) {
      const error = aboutProbe.failure;
      return buildServerProvider({
        driver: PROVIDER,
        presentation: CURSOR_PRESENTATION,
        enabled: cursorSettings.enabled,
        checkedAt,
        models: fallbackModels,
        probe: {
          installed: !isCommandMissingCause(error),
          version: null,
          status: "error",
          auth: { status: "unknown" },
          message: isCommandMissingCause(error)
            ? "Cursor Agent CLI (`agent`) is not installed or not on PATH."
            : `Failed to execute Cursor Agent CLI health check: ${error instanceof Error ? error.message : String(error)}.`,
        },
      });
    }

    if (Option.isNone(aboutProbe.success)) {
      return buildServerProvider({
        driver: PROVIDER,
        presentation: CURSOR_PRESENTATION,
        enabled: cursorSettings.enabled,
        checkedAt,
        models: fallbackModels,
        probe: {
          installed: true,
          version: null,
          status: "error",
          auth: { status: "unknown" },
          message: "Cursor Agent CLI is installed but timed out while running `agent about`.",
        },
      });
    }

    const parsed = parseCursorAboutOutput(aboutProbe.success.value);
    const parameterizedModelPickerUnsupportedMessage =
      getCursorParameterizedModelPickerUnsupportedMessage({
        version: parsed.version,
        channel: readCursorCliConfigChannel(),
      });
    if (parameterizedModelPickerUnsupportedMessage) {
      return buildServerProvider({
        driver: PROVIDER,
        presentation: CURSOR_PRESENTATION,
        enabled: cursorSettings.enabled,
        checkedAt,
        models: fallbackModels,
        probe: {
          installed: true,
          version: parsed.version,
          status: "error",
          auth: parsed.auth,
          message:
            parsed.auth.status === "unauthenticated" && parsed.message
              ? `${parameterizedModelPickerUnsupportedMessage} ${parsed.message}`
              : parameterizedModelPickerUnsupportedMessage,
        },
      });
    }
    let discoveredModels = Option.none<ReadonlyArray<ServerProviderModel>>();
    let discoveryWarning: string | undefined;
    if (parsed.auth.status !== "unauthenticated") {
      let failedDiscoveryMethod: string | undefined;
      const discoveryExit = yield* Effect.exit(
        discoverCursorModelsViaAcp(cursorSettings, (event) =>
          event.status === "failed"
            ? Effect.sync(() => {
                failedDiscoveryMethod = event.method;
              })
            : Effect.void,
        ).pipe(Effect.timeoutOption(CURSOR_ACP_MODEL_DISCOVERY_TIMEOUT_MS)),
      );
      if (Exit.isFailure(discoveryExit)) {
        const detail = formatCursorAcpFailureDetail(discoveryExit.cause);
        yield* Effect.logWarning("Cursor ACP model discovery failed", {
          cause: Cause.pretty(discoveryExit.cause),
        });
        if (failedDiscoveryMethod === "authenticate") {
          return buildCursorProviderSnapshot({
            checkedAt,
            cursorSettings,
            parsed: cursorAcpAuthenticationFailure(parsed, detail),
            discoveredModels: [],
          });
        }
        discoveryWarning = `Cursor ACP model discovery failed: ${detail}`;
      } else if (Option.isNone(discoveryExit.value)) {
        discoveryWarning = `Cursor ACP model discovery timed out after ${CURSOR_ACP_MODEL_DISCOVERY_TIMEOUT_MS}ms.`;
      } else if (discoveryExit.value.value.length === 0) {
        discoveryWarning = "Cursor ACP model discovery returned no built-in models.";
      } else {
        discoveredModels = discoveryExit.value;
      }
    }
    return buildCursorProviderSnapshot({
      checkedAt,
      cursorSettings,
      parsed,
      discoveredModels: Option.getOrElse(
        Option.filter(discoveredModels, (models) => models.length > 0),
        () => [] as const,
      ),
      ...(discoveryWarning ? { discoveryWarning } : {}),
    });
  },
);

export const CursorProviderLive = Layer.effect(
  CursorProvider,
  Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const checkProvider = checkCursorProviderStatus().pipe(
      Effect.provideService(ServerSettingsService, serverSettings),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    );

    return yield* makeManagedServerProvider<CursorSettings>({
      getSettings: serverSettings.getSettings.pipe(Effect.map(resolveCursorSettings), Effect.orDie),
      streamSettings: serverSettings.streamChanges.pipe(
        Stream.map((settings) => resolveCursorSettings(settings)),
      ),
      haveSettingsChanged: (previous, next) => !Equal.equals(previous, next),
      initialSnapshot: buildInitialCursorProviderSnapshot,
      checkProvider,
      enrichSnapshot: ({ settings, snapshot, publishSnapshot }) => {
        if (
          !settings.enabled ||
          snapshot.auth.status === "unauthenticated" ||
          !snapshot.models.some(
            (model) => !model.isCustom && !hasKnownCursorModelCapabilities(model),
          )
        ) {
          return Effect.void;
        }

        return discoverCursorModelCapabilitiesViaAcp(settings, snapshot.models).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          Effect.flatMap((discoveredModels) => {
            if (discoveredModels.length === 0) {
              return Effect.void;
            }

            return publishSnapshot({
              ...snapshot,
              models: providerModelsFromSettings(
                discoveredModels,
                PROVIDER,
                settings.customModels,
                EMPTY_CAPABILITIES,
              ),
            });
          }),
          Effect.catchCause((cause) =>
            Effect.logWarning("Cursor ACP background capability enrichment failed", {
              models: snapshot.models.map((model) => model.slug),
              cause: Cause.pretty(cause),
            }).pipe(Effect.asVoid),
          ),
        );
      },
      refreshInterval: CURSOR_REFRESH_INTERVAL,
    });
  }),
);
