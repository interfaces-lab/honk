import {
  DESKTOP_REMOTE_NAME_MAX_LENGTH,
  DesktopThemeSchema,
  type DesktopServerExposureConfiguration,
  type DesktopServerExposureMode,
  type DesktopTheme,
} from "@honk/shared/desktop-api";
import { fromLenientJson } from "@honk/shared/schema-json";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { Path } from "effect";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import * as SynchronizedRef from "effect/SynchronizedRef";

import * as DesktopEnvironment from "../app/desktop-environment";

export interface DesktopSettings {
  readonly serverExposureMode: DesktopServerExposureMode;
  readonly serverPublicUrl: string | null;
  readonly remoteHostName: string | null;
  readonly themeSource: DesktopTheme;
  readonly hasCompletedOnboarding: boolean;
  readonly lastBackendPort?: number;
}

export interface DesktopSettingsChange {
  readonly settings: DesktopSettings;
  readonly changed: boolean;
}

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  serverExposureMode: "local-only",
  serverPublicUrl: null,
  remoteHostName: null,
  themeSource: "system",
  hasCompletedOnboarding: false,
};

const DesktopSettingsDocument = Schema.Struct({
  // Decoded permissively because the file on disk may have been written by another build. A mode
  // this build does not know must degrade to local-only below, not fail the whole document and
  // reset every unrelated setting. The IPC contract keeps the strict literal union.
  serverExposureMode: Schema.optionalKey(Schema.String),
  serverPublicUrl: Schema.optionalKey(Schema.NullOr(Schema.String)),
  remoteHostName: Schema.optionalKey(Schema.NullOr(Schema.String)),
  themeSource: Schema.optionalKey(DesktopThemeSchema),
  hasCompletedOnboarding: Schema.optionalKey(Schema.Boolean),
  lastBackendPort: Schema.optionalKey(Schema.Number),
});

type DesktopSettingsDocument = typeof DesktopSettingsDocument.Type;
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const DesktopSettingsJson = fromLenientJson(DesktopSettingsDocument);
const decodeDesktopSettingsJson = Schema.decodeEffect(DesktopSettingsJson);
const encodeDesktopSettingsJson = Schema.encodeEffect(DesktopSettingsJson);

const settingsChange = (settings: DesktopSettings, changed: boolean): DesktopSettingsChange => ({
  settings,
  changed,
});

export class DesktopSettingsWriteError extends Data.TaggedError("DesktopSettingsWriteError")<{
  readonly cause: PlatformError.PlatformError | Schema.SchemaError;
}> {
  override get message() {
    return "Honk could not save desktop settings.";
  }
}

export interface DesktopAppSettingsShape {
  readonly load: Effect.Effect<DesktopSettings>;
  readonly get: Effect.Effect<DesktopSettings>;
  readonly setServerExposure: (
    input: DesktopServerExposureConfiguration,
  ) => Effect.Effect<DesktopSettingsChange, DesktopSettingsWriteError>;
  readonly setRemoteHostName: (
    name: string | null,
  ) => Effect.Effect<DesktopSettingsChange, DesktopSettingsWriteError>;
  readonly setThemeSource: (
    theme: DesktopTheme,
  ) => Effect.Effect<DesktopSettingsChange, DesktopSettingsWriteError>;
  readonly setLastBackendPort: (
    port: number,
  ) => Effect.Effect<DesktopSettingsChange, DesktopSettingsWriteError>;
  readonly completeOnboarding: Effect.Effect<DesktopSettingsChange, DesktopSettingsWriteError>;
}

export class DesktopAppSettings extends Context.Service<
  DesktopAppSettings,
  DesktopAppSettingsShape
>()("honk/desktop/AppSettings") {}

export function resolveDefaultDesktopSettings(_appVersion: string): DesktopSettings {
  return DEFAULT_DESKTOP_SETTINGS;
}

export function normalizeDesktopSettingsDocument(
  parsed: DesktopSettingsDocument,
  _appVersion: string,
): DesktopSettings {
  const lastBackendPort = parsed.lastBackendPort;
  return {
    serverExposureMode:
      parsed.serverExposureMode === "network-accessible" ||
      parsed.serverExposureMode === "tailscale" ||
      parsed.serverExposureMode === "tunnel"
        ? parsed.serverExposureMode
        : "local-only",
    serverPublicUrl:
      typeof parsed.serverPublicUrl === "string" && parsed.serverPublicUrl.trim().length > 0
        ? parsed.serverPublicUrl.trim()
        : null,
    remoteHostName: normalizeDesktopRemoteHostName(parsed.remoteHostName),
    themeSource: parsed.themeSource ?? "system",
    hasCompletedOnboarding: parsed.hasCompletedOnboarding === true,
    ...(typeof lastBackendPort === "number" &&
    Number.isInteger(lastBackendPort) &&
    lastBackendPort >= 1 &&
    lastBackendPort <= 65_535
      ? { lastBackendPort }
      : {}),
  };
}

export function normalizeDesktopRemoteHostName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= DESKTOP_REMOTE_NAME_MAX_LENGTH
    ? normalized
    : null;
}

function toDesktopSettingsDocument(
  settings: DesktopSettings,
  defaults: DesktopSettings,
): DesktopSettingsDocument {
  const document: Mutable<DesktopSettingsDocument> = {};

  if (settings.serverExposureMode !== defaults.serverExposureMode) {
    document.serverExposureMode = settings.serverExposureMode;
  }
  if (settings.serverPublicUrl !== defaults.serverPublicUrl) {
    document.serverPublicUrl = settings.serverPublicUrl;
  }
  if (settings.remoteHostName !== defaults.remoteHostName) {
    document.remoteHostName = settings.remoteHostName;
  }
  if (settings.themeSource !== defaults.themeSource) {
    document.themeSource = settings.themeSource;
  }
  if (settings.hasCompletedOnboarding !== defaults.hasCompletedOnboarding) {
    document.hasCompletedOnboarding = settings.hasCompletedOnboarding;
  }
  if (
    settings.lastBackendPort !== undefined &&
    settings.lastBackendPort !== defaults.lastBackendPort
  ) {
    document.lastBackendPort = settings.lastBackendPort;
  }
  return document;
}

function setServerExposure(
  settings: DesktopSettings,
  input: DesktopServerExposureConfiguration,
): DesktopSettings {
  // Modes other than network-accessible ignore the custom address; keep it so switching back
  // does not make the user retype it.
  const serverPublicUrl =
    input.mode === "network-accessible" ? input.publicUrl : settings.serverPublicUrl;
  return settings.serverExposureMode === input.mode && settings.serverPublicUrl === serverPublicUrl
    ? settings
    : { ...settings, serverExposureMode: input.mode, serverPublicUrl };
}

function setRemoteHostName(settings: DesktopSettings, name: string | null): DesktopSettings {
  return settings.remoteHostName === name ? settings : { ...settings, remoteHostName: name };
}

function setThemeSource(settings: DesktopSettings, requestedTheme: DesktopTheme): DesktopSettings {
  return settings.themeSource === requestedTheme
    ? settings
    : {
        ...settings,
        themeSource: requestedTheme,
      };
}

function setLastBackendPort(settings: DesktopSettings, requestedPort: number): DesktopSettings {
  return settings.lastBackendPort === requestedPort
    ? settings
    : {
        ...settings,
        lastBackendPort: requestedPort,
      };
}

function completeOnboarding(settings: DesktopSettings): DesktopSettings {
  return settings.hasCompletedOnboarding
    ? settings
    : {
        ...settings,
        hasCompletedOnboarding: true,
      };
}

function readSettings(
  fileSystem: FileSystem.FileSystem,
  settingsPath: string,
  appVersion: string,
): Effect.Effect<DesktopSettings> {
  const defaultSettings = resolveDefaultDesktopSettings(appVersion);

  return fileSystem.readFileString(settingsPath).pipe(
    Effect.option,
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeed(defaultSettings),
        onSome: (raw) =>
          decodeDesktopSettingsJson(raw).pipe(
            Effect.map((parsed) => normalizeDesktopSettingsDocument(parsed, appVersion)),
            Effect.catch(() => Effect.succeed(defaultSettings)),
          ),
      }),
    ),
  );
}

const writeSettings = Effect.fn("desktop.settings.writeSettings")(function* (input: {
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly settingsPath: string;
  readonly settings: DesktopSettings;
  readonly defaultSettings: DesktopSettings;
}): Effect.fn.Return<void, PlatformError.PlatformError | Schema.SchemaError> {
  const directory = input.path.dirname(input.settingsPath);
  const suffix = crypto.randomUUID().replace(/-/g, "");
  const tempPath = `${input.settingsPath}.${process.pid}.${suffix}.tmp`;
  const encoded = yield* encodeDesktopSettingsJson(
    toDesktopSettingsDocument(input.settings, input.defaultSettings),
  );
  yield* input.fileSystem.makeDirectory(directory, { recursive: true });
  yield* input.fileSystem.writeFileString(tempPath, `${encoded}\n`);
  yield* input.fileSystem.rename(tempPath, input.settingsPath);
});

export const layer = Layer.effect(
  DesktopAppSettings,
  Effect.gen(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const settingsRef = yield* SynchronizedRef.make(environment.defaultDesktopSettings);

    const persist = (
      update: (settings: DesktopSettings) => DesktopSettings,
    ): Effect.Effect<DesktopSettingsChange, DesktopSettingsWriteError> =>
      SynchronizedRef.modifyEffect(settingsRef, (settings) => {
        const nextSettings = update(settings);
        if (nextSettings === settings) {
          return Effect.succeed([settingsChange(settings, false), settings] as const);
        }

        return writeSettings({
          fileSystem,
          path,
          settingsPath: environment.desktopSettingsPath,
          settings: nextSettings,
          defaultSettings: environment.defaultDesktopSettings,
        }).pipe(
          Effect.mapError((cause) => new DesktopSettingsWriteError({ cause })),
          Effect.as([settingsChange(nextSettings, true), nextSettings] as const),
        );
      });

    return DesktopAppSettings.of({
      get: SynchronizedRef.get(settingsRef),
      load: Effect.gen(function* () {
        const settings = yield* readSettings(
          fileSystem,
          environment.desktopSettingsPath,
          environment.appVersion,
        );
        return yield* SynchronizedRef.setAndGet(settingsRef, settings);
      }).pipe(Effect.withSpan("desktop.settings.load")),
      setServerExposure: (input) =>
        persist((settings) => setServerExposure(settings, input)).pipe(
          Effect.withSpan("desktop.settings.setServerExposure", {
            attributes: { mode: input.mode },
          }),
        ),
      setRemoteHostName: (name) =>
        persist((settings) => setRemoteHostName(settings, name)).pipe(
          Effect.withSpan("desktop.settings.setRemoteHostName"),
        ),
      setThemeSource: (theme) =>
        persist((settings) => setThemeSource(settings, theme)).pipe(
          Effect.withSpan("desktop.settings.setThemeSource", { attributes: { theme } }),
        ),
      setLastBackendPort: (port) =>
        persist((settings) => setLastBackendPort(settings, port)).pipe(
          Effect.withSpan("desktop.settings.setLastBackendPort", { attributes: { port } }),
        ),
      completeOnboarding: persist(completeOnboarding).pipe(
        Effect.withSpan("desktop.settings.completeOnboarding"),
      ),
    });
  }),
);

export const layerTest = (initialSettings: DesktopSettings = DEFAULT_DESKTOP_SETTINGS) =>
  Layer.effect(
    DesktopAppSettings,
    Effect.gen(function* () {
      const settingsRef = yield* SynchronizedRef.make(initialSettings);
      const update = (f: (settings: DesktopSettings) => DesktopSettings) =>
        SynchronizedRef.modify(settingsRef, (settings) => {
          const nextSettings = f(settings);
          return [
            {
              settings: nextSettings,
              changed: nextSettings !== settings,
            },
            nextSettings,
          ] as const;
        });

      return DesktopAppSettings.of({
        get: SynchronizedRef.get(settingsRef),
        load: SynchronizedRef.get(settingsRef),
        setServerExposure: (input) => update((settings) => setServerExposure(settings, input)),
        setRemoteHostName: (name) => update((settings) => setRemoteHostName(settings, name)),
        setThemeSource: (theme) => update((settings) => setThemeSource(settings, theme)),
        setLastBackendPort: (port) => update((settings) => setLastBackendPort(settings, port)),
        completeOnboarding: update(completeOnboarding),
      });
    }),
  );
