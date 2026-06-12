import { type AppIconVariant } from "@honk/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import * as ElectronApp from "../electron/electron-app";
import * as DesktopClientSettings from "../settings/desktop-client-settings";
import * as DesktopAssets from "./desktop-assets";
import * as DesktopEnvironment from "./desktop-environment";

const COMMIT_HASH_PATTERN = /^[0-9a-f]{7,40}$/i;
const COMMIT_HASH_DISPLAY_LENGTH = 12;

const AppPackageMetadata = Schema.Struct({
  honkCommitHash: Schema.optional(Schema.String),
});
const decodeAppPackageMetadata = Schema.decodeEffect(Schema.fromJsonString(AppPackageMetadata));

export interface DesktopAppIdentityShape {
  readonly resolveUserDataPath: Effect.Effect<string>;
  readonly configure: Effect.Effect<void>;
  readonly applyAppIconVariant: (variant: AppIconVariant | undefined) => Effect.Effect<void>;
}

export class DesktopAppIdentity extends Context.Service<
  DesktopAppIdentity,
  DesktopAppIdentityShape
>()("honk/desktop/AppIdentity") {}

const normalizeCommitHash = (value: string): Option.Option<string> => {
  const trimmed = value.trim();
  return COMMIT_HASH_PATTERN.test(trimmed)
    ? Option.some(trimmed.slice(0, COMMIT_HASH_DISPLAY_LENGTH).toLowerCase())
    : Option.none();
};

const make = Effect.gen(function* () {
  const assets = yield* DesktopAssets.DesktopAssets;
  const clientSettings = yield* DesktopClientSettings.DesktopClientSettings;
  const electronApp = yield* ElectronApp.ElectronApp;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const commitHashCache = yield* Ref.make<Option.Option<Option.Option<string>>>(Option.none());

  // Until the user picks a variant the effective default is stage-aware: the blueprint
  // "dev" icon in development, the "classic" brand icon otherwise. Explicit picks resolve
  // their own artwork ("classic" is always the production brand icon, even in dev), and
  // anything unresolvable falls back to the bundle default.
  const applyAppIconVariant = Effect.fn("desktop.appIdentity.applyAppIconVariant")(function* (
    variant: AppIconVariant | undefined,
  ) {
    if (environment.platform !== "darwin") {
      return;
    }
    const effective = variant ?? (environment.isDevelopment ? "dev" : "classic");
    const variantIconPath =
      effective === "classic"
        ? yield* assets.resolveResourcePath("dock-icon.png")
        : yield* assets.resolveResourcePath(`app-icons/${effective}.png`);
    const iconPath = Option.isSome(variantIconPath)
      ? variantIconPath
      : (yield* assets.iconPaths).png;
    yield* Option.match(iconPath, {
      onNone: () => Effect.void,
      onSome: electronApp.setDockIcon,
    });
  });

  const resolveEmbeddedCommitHash = Effect.gen(function* () {
    const packageJsonPath = environment.path.join(environment.appRoot, "package.json");
    const raw = yield* fileSystem.readFileString(packageJsonPath).pipe(Effect.option);
    return yield* Option.match(raw, {
      onNone: () => Effect.succeed(Option.none<string>()),
      onSome: (value) =>
        decodeAppPackageMetadata(value).pipe(
          Effect.map((parsed) =>
            Option.fromNullishOr(parsed.honkCommitHash).pipe(Option.flatMap(normalizeCommitHash)),
          ),
          Effect.catch(() => Effect.succeed(Option.none<string>())),
        ),
    });
  });

  const resolveAboutCommitHash = Effect.gen(function* () {
    const cached = yield* Ref.get(commitHashCache);
    if (Option.isSome(cached)) {
      return cached.value;
    }

    const override = Option.flatMap(environment.commitHashOverride, normalizeCommitHash);
    if (Option.isSome(override)) {
      yield* Ref.set(commitHashCache, Option.some(override));
      return override;
    }

    if (!environment.isPackaged) {
      const empty = Option.none<string>();
      yield* Ref.set(commitHashCache, Option.some(empty));
      return empty;
    }

    const commitHash = yield* resolveEmbeddedCommitHash;
    yield* Ref.set(commitHashCache, Option.some(commitHash));
    return commitHash;
  });

  const resolveUserDataPath = Effect.succeed(
    environment.path.join(environment.appDataDirectory, environment.userDataDirName),
  ).pipe(Effect.withSpan("desktop.appIdentity.resolveUserDataPath"));

  const configure = Effect.gen(function* () {
    const commitHash = yield* resolveAboutCommitHash;
    yield* electronApp.setName(environment.displayName);
    yield* electronApp.setAboutPanelOptions({
      applicationName: environment.displayName,
      applicationVersion: environment.appVersion,
      version: Option.getOrElse(commitHash, () => "unknown"),
    });

    if (environment.platform === "win32") {
      yield* electronApp.setAppUserModelId(environment.appUserModelId);
    }

    if (environment.platform === "linux") {
      yield* electronApp.setDesktopName(environment.linuxDesktopEntryName);
    }

    if (environment.platform === "darwin") {
      const settings = yield* clientSettings.get;
      yield* applyAppIconVariant(
        Option.match(settings, {
          onNone: () => undefined,
          onSome: (value) => value.appIconVariant,
        }),
      );
    }
  }).pipe(Effect.withSpan("desktop.appIdentity.configure"));

  return DesktopAppIdentity.of({
    resolveUserDataPath,
    configure,
    applyAppIconVariant,
  });
});

export const layer = Layer.effect(DesktopAppIdentity, make);
