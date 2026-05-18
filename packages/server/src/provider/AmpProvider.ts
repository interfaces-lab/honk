import type { AmpSettings, ModelCapabilities, ServerProviderModel } from "@multi/contracts";
import { ProviderDriverKind } from "@multi/contracts";
import { Cause, Effect, Equal, Exit, Layer, Option, Schema, Stream } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import * as EffectAcpErrors from "effect-acp/errors";

import { createModelCapabilities } from "@multi/shared/model";

import { ServerConfig } from "../config.ts";
import { ServerSettingsService } from "../server-settings.ts";
import { makeAmpAcpRuntime } from "./acp/AmpAcpSupport.ts";
import { AmpProvider } from "./AmpProvider.service.ts";
import { makeManagedServerProvider } from "./make-managed-server-provider.ts";
import { AUTH_PROBE_TIMEOUT_MS, buildServerProvider } from "./provider-snapshot.ts";
import { resolveAmpSettings, type ResolvedAmpSettings } from "./provider-settings.ts";

const PROVIDER = ProviderDriverKind.make("amp");
const AMP_PRESENTATION = {
  displayName: "Amp",
  showInteractionModeToggle: false,
} as const;

const AMP_MODEL_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});

const AMP_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "amp",
    name: "Amp",
    selectable: true,
    isCustom: false,
    capabilities: AMP_MODEL_CAPABILITIES,
  },
];

const isAcpSpawnError = Schema.is(EffectAcpErrors.AcpSpawnError);
const isAcpRequestError = Schema.is(EffectAcpErrors.AcpRequestError);

function makeAmpProviderSnapshot(input: {
  readonly settings: Pick<AmpSettings, "enabled">;
  readonly checkedAt: string;
  readonly installed: boolean;
  readonly version: string | null;
  readonly status: Exclude<ReturnType<typeof buildServerProvider>["status"], "disabled">;
  readonly authStatus: ReturnType<typeof buildServerProvider>["auth"]["status"];
  readonly message?: string | undefined;
}) {
  return buildServerProvider({
    driver: PROVIDER,
    presentation: AMP_PRESENTATION,
    enabled: input.settings.enabled,
    checkedAt: input.checkedAt,
    models: AMP_MODELS,
    slashCommands: [
      {
        name: "init",
        description: "Generate an AGENTS.md file for the project",
      },
    ],
    probe: {
      installed: input.installed,
      version: input.version,
      status: input.status,
      auth: {
        status: input.authStatus,
        type: "amp",
      },
      ...(input.message ? { message: input.message } : {}),
    },
  });
}

function makeInitialAmpProvider(settings: AmpSettings) {
  const checkedAt = new Date().toISOString();
  if (!settings.enabled) {
    return makeAmpProviderSnapshot({
      settings,
      checkedAt,
      installed: false,
      version: null,
      status: "warning",
      authStatus: "unknown",
      message: "Amp is disabled in Multi settings.",
    });
  }
  return makeAmpProviderSnapshot({
    settings,
    checkedAt,
    installed: true,
    version: null,
    status: "warning",
    authStatus: "unknown",
    message: "Amp provider status has not been checked in this session yet.",
  });
}

function ampProbeFailureMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim().length > 0) {
    return cause.message.trim();
  }
  return String(cause);
}

export const AmpProviderLive = Layer.effect(
  AmpProvider,
  Effect.gen(function* () {
    const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const serverConfig = yield* ServerConfig;
    const serverSettings = yield* ServerSettingsService;

    const checkAmpProviderStatus = Effect.fn("checkAmpProviderStatus")(function* (
      settings: ResolvedAmpSettings,
    ) {
      const checkedAt = new Date().toISOString();
      if (!settings.enabled) {
        return makeAmpProviderSnapshot({
          settings,
          checkedAt,
          installed: false,
          version: null,
          status: "warning",
          authStatus: "unknown",
          message: "Amp is disabled in Multi settings.",
        });
      }

      const probeExit = yield* Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* makeAmpAcpRuntime({
            ampSettings: settings,
            childProcessSpawner,
            cwd: serverConfig.cwd,
            clientInfo: { name: "multi-provider-probe", version: "0.0.0" },
          });
          return yield* runtime.start();
        }),
      ).pipe(Effect.timeoutOption(AUTH_PROBE_TIMEOUT_MS), Effect.exit);

      if (Exit.isSuccess(probeExit)) {
        if (Option.isSome(probeExit.value)) {
          const version = probeExit.value.value.initializeResult.agentInfo?.version ?? null;
          return makeAmpProviderSnapshot({
            settings,
            checkedAt,
            installed: true,
            version,
            status: "ready",
            authStatus: "authenticated",
            message: "Amp ACP is ready.",
          });
        }
        return makeAmpProviderSnapshot({
          settings,
          checkedAt,
          installed: true,
          version: null,
          status: "error",
          authStatus: "unknown",
          message: "Timed out while starting amp-acp.",
        });
      }

      const cause = Cause.squash(probeExit.cause);
      if (isAcpSpawnError(cause)) {
        return makeAmpProviderSnapshot({
          settings,
          checkedAt,
          installed: false,
          version: null,
          status: "error",
          authStatus: "unknown",
          message: "amp-acp is not installed or not on PATH.",
        });
      }
      if (isAcpRequestError(cause) && cause.code === -32000) {
        return makeAmpProviderSnapshot({
          settings,
          checkedAt,
          installed: true,
          version: null,
          status: "warning",
          authStatus: "unauthenticated",
          message:
            "Amp requires authentication. Set AMP_API_KEY, use the provider API key setting, or run `amp-acp --setup`.",
        });
      }
      return makeAmpProviderSnapshot({
        settings,
        checkedAt,
        installed: true,
        version: null,
        status: "error",
        authStatus: "unknown",
        message: `Failed to start amp-acp: ${ampProbeFailureMessage(cause)}`,
      });
    });

    const getProviderSettings = serverSettings.getSettings.pipe(Effect.map(resolveAmpSettings));

    return yield* makeManagedServerProvider<ResolvedAmpSettings>({
      getSettings: getProviderSettings.pipe(Effect.orDie),
      streamSettings: serverSettings.streamChanges.pipe(Stream.map((settings) => resolveAmpSettings(settings))),
      haveSettingsChanged: (previous, next) => !Equal.equals(previous, next),
      initialSnapshot: makeInitialAmpProvider,
      checkProvider: getProviderSettings.pipe(Effect.flatMap(checkAmpProviderStatus)),
    });
  }),
);
