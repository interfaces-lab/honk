import { parsePersistedServerObservabilitySettings } from "@honk/shared/server-settings";
import {
  HONK_PROCESS_INSTANCE_ID_ENV,
  HONK_PROCESS_ROLE_ENV,
  HONK_RUN_ID_ENV,
} from "@honk/shared/logging";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Random from "effect/Random";
import * as Ref from "effect/Ref";

import * as DesktopBackendManager from "./desktop-backend-manager";
import * as DesktopEnvironment from "../app/desktop-environment";
import * as DesktopObservability from "../app/desktop-observability";
import * as EffectLogger from "@honk/shared/effect-logger";
import * as DesktopServerExposure from "./desktop-server-exposure";

export interface DesktopBackendConfigurationShape {
  readonly resolve: Effect.Effect<DesktopBackendManager.DesktopBackendStartConfig>;
}

export class DesktopBackendConfiguration extends Context.Service<
  DesktopBackendConfiguration,
  DesktopBackendConfigurationShape
>()("honk/desktop/BackendConfiguration") {}

interface BackendObservabilitySettings {
  readonly otlpTracesUrl: Option.Option<string>;
  readonly otlpMetricsUrl: Option.Option<string>;
}

const emptyBackendObservabilitySettings: BackendObservabilitySettings = {
  otlpTracesUrl: Option.none(),
  otlpMetricsUrl: Option.none(),
};

const DESKTOP_BACKEND_ENV_NAMES = [
  "HONK_PORT",
  "HONK_MODE",
  "HONK_NO_BROWSER",
  "HONK_HOST",
  "HONK_DESKTOP_BOOTSTRAP_TOKEN",
  "HONK_DESKTOP_WS_URL",
  "HONK_DESKTOP_LAN_ACCESS",
  "HONK_DESKTOP_LAN_HOST",
  HONK_PROCESS_INSTANCE_ID_ENV,
  HONK_PROCESS_ROLE_ENV,
] as const;

const backendChildEnvPatch = (): Record<string, string | undefined> =>
  Object.fromEntries(DESKTOP_BACKEND_ENV_NAMES.map((name) => [name, undefined]));

const elog = EffectLogger.create({ service: "desktop-backend-configuration" });

const readPersistedBackendObservabilitySettings: Effect.Effect<
  BackendObservabilitySettings,
  never,
  FileSystem.FileSystem | DesktopEnvironment.DesktopEnvironment
> = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const exists = yield* fileSystem
    .exists(environment.serverSettingsPath)
    .pipe(Effect.orElseSucceed(() => false));
  if (!exists) {
    return emptyBackendObservabilitySettings;
  }

  const raw = yield* fileSystem.readFileString(environment.serverSettingsPath).pipe(Effect.option);
  if (Option.isNone(raw)) {
    yield* elog.warn("failed to read persisted backend observability settings");
    return emptyBackendObservabilitySettings;
  }

  const parsed = parsePersistedServerObservabilitySettings(raw.value);
  return {
    otlpTracesUrl: Option.fromNullishOr(parsed.otlpTracesUrl),
    otlpMetricsUrl: Option.fromNullishOr(parsed.otlpMetricsUrl),
  };
});

const getOrCreateBootstrapToken = Effect.fn("desktop.backendConfiguration.bootstrapToken")(
  function* (tokenRef: Ref.Ref<Option.Option<string>>) {
    const configuredToken = process.env.HONK_DESKTOP_BOOTSTRAP_TOKEN?.trim();
    if (configuredToken) {
      yield* Ref.set(tokenRef, Option.some(configuredToken));
      return configuredToken;
    }

    const existing = yield* Ref.get(tokenRef);
    if (Option.isSome(existing)) {
      return existing.value;
    }

    let token = "";
    while (token.length < 48) {
      token += (yield* Random.nextUUIDv4).replace(/-/g, "");
    }
    token = token.slice(0, 48);
    yield* Ref.set(tokenRef, Option.some(token));
    return token;
  },
);

const resolveBackendStartConfig = Effect.fn("desktop.backendConfiguration.resolveStartConfig")(
  function* (input: {
    readonly bootstrapToken: string;
    readonly observabilitySettings: BackendObservabilitySettings;
  }): Effect.fn.Return<
    DesktopBackendManager.DesktopBackendStartConfig,
    never,
    DesktopEnvironment.DesktopEnvironment | DesktopServerExposure.DesktopServerExposure
  > {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const serverExposure = yield* DesktopServerExposure.DesktopServerExposure;
    const backendExposure = yield* serverExposure.backendConfig;

    return {
      executablePath: process.execPath,
      entryPath: environment.backendEntryPath,
      cwd: environment.backendCwd,
      env: {
        ...backendChildEnvPatch(),
        ELECTRON_RUN_AS_NODE: "1",
        [HONK_RUN_ID_ENV]: DesktopObservability.desktopProcessMetadata.runId,
        [HONK_PROCESS_ROLE_ENV]: "server",
        [HONK_PROCESS_INSTANCE_ID_ENV]: undefined,
      },
      bootstrap: {
        mode: "desktop",
        noBrowser: true,
        port: backendExposure.port,
        honkHome: environment.baseDir,
        host: backendExposure.bindHost,
        desktopBootstrapToken: input.bootstrapToken,
        runId: DesktopObservability.desktopProcessMetadata.runId,
        ...Option.match(input.observabilitySettings.otlpTracesUrl, {
          onNone: () => ({}),
          onSome: (otlpTracesUrl) => ({ otlpTracesUrl }),
        }),
        ...Option.match(input.observabilitySettings.otlpMetricsUrl, {
          onNone: () => ({}),
          onSome: (otlpMetricsUrl) => ({ otlpMetricsUrl }),
        }),
      },
      httpBaseUrl: backendExposure.httpBaseUrl,
      captureOutput: true,
    };
  },
);

export const layer = Layer.effect(
  DesktopBackendConfiguration,
  Effect.gen(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const fileSystem = yield* FileSystem.FileSystem;
    const serverExposure = yield* DesktopServerExposure.DesktopServerExposure;
    const tokenRef = yield* Ref.make(Option.none<string>());

    return DesktopBackendConfiguration.of({
      resolve: Effect.gen(function* () {
        const bootstrapToken = yield* getOrCreateBootstrapToken(tokenRef);
        const observabilitySettings = yield* readPersistedBackendObservabilitySettings.pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(DesktopEnvironment.DesktopEnvironment, environment),
        );
        return yield* resolveBackendStartConfig({
          bootstrapToken,
          observabilitySettings,
        }).pipe(
          Effect.provideService(DesktopEnvironment.DesktopEnvironment, environment),
          Effect.provideService(DesktopServerExposure.DesktopServerExposure, serverExposure),
        );
      }).pipe(Effect.withSpan("desktop.backendConfiguration.resolve")),
    });
  }),
);
