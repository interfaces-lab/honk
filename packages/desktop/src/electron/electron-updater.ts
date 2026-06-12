import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";

import electronUpdaterPackage from "electron-updater";

const getAutoUpdater = () => electronUpdaterPackage.autoUpdater;

type AutoUpdater = ReturnType<typeof getAutoUpdater>;

export type ElectronUpdaterFeedUrl = Parameters<AutoUpdater["setFeedURL"]>[0];

export class ElectronUpdaterCheckForUpdatesError extends Data.TaggedError(
  "ElectronUpdaterCheckForUpdatesError",
)<{
  readonly cause: unknown;
}> {
  override get message() {
    return "Electron updater failed to check for updates.";
  }
}

export class ElectronUpdaterDownloadUpdateError extends Data.TaggedError(
  "ElectronUpdaterDownloadUpdateError",
)<{
  readonly cause: unknown;
}> {
  override get message() {
    return "Electron updater failed to download the update.";
  }
}

export class ElectronUpdaterQuitAndInstallError extends Data.TaggedError(
  "ElectronUpdaterQuitAndInstallError",
)<{
  readonly cause: unknown;
}> {
  override get message() {
    return "Electron updater failed to quit and install the update.";
  }
}

export type ElectronUpdaterError =
  | ElectronUpdaterCheckForUpdatesError
  | ElectronUpdaterDownloadUpdateError
  | ElectronUpdaterQuitAndInstallError;

export interface ElectronUpdaterShape {
  readonly setFeedURL: (options: ElectronUpdaterFeedUrl) => Effect.Effect<void>;
  readonly setAutoDownload: (value: boolean) => Effect.Effect<void>;
  readonly setAutoInstallOnAppQuit: (value: boolean) => Effect.Effect<void>;
  readonly setAllowPrerelease: (value: boolean) => Effect.Effect<void>;
  readonly allowDowngrade: Effect.Effect<boolean>;
  readonly setAllowDowngrade: (value: boolean) => Effect.Effect<void>;
  readonly setDisableDifferentialDownload: (value: boolean) => Effect.Effect<void>;
  readonly checkForUpdates: Effect.Effect<void, ElectronUpdaterCheckForUpdatesError>;
  readonly downloadUpdate: Effect.Effect<void, ElectronUpdaterDownloadUpdateError>;
  readonly quitAndInstall: (options: {
    readonly isSilent: boolean;
    readonly isForceRunAfter: boolean;
  }) => Effect.Effect<void, ElectronUpdaterQuitAndInstallError>;
  readonly on: (
    eventName: string,
    listener: (...args: readonly unknown[]) => void,
  ) => Effect.Effect<void, never, Scope.Scope>;
}

export class ElectronUpdater extends Context.Service<ElectronUpdater, ElectronUpdaterShape>()(
  "honk/desktop/electron/Updater",
) {}

export const layer = Layer.succeed(ElectronUpdater, {
  setFeedURL: (options) =>
    Effect.suspend(() => {
      const autoUpdater = getAutoUpdater();
      autoUpdater.setFeedURL(options);
      return Effect.void;
    }),
  setAutoDownload: (value) =>
    Effect.suspend(() => {
      const autoUpdater = getAutoUpdater();
      autoUpdater.autoDownload = value;
      return Effect.void;
    }),
  setAutoInstallOnAppQuit: (value) =>
    Effect.suspend(() => {
      const autoUpdater = getAutoUpdater();
      autoUpdater.autoInstallOnAppQuit = value;
      return Effect.void;
    }),
  setAllowPrerelease: (value) =>
    Effect.suspend(() => {
      const autoUpdater = getAutoUpdater();
      autoUpdater.allowPrerelease = value;
      return Effect.void;
    }),
  allowDowngrade: Effect.sync(() => getAutoUpdater().allowDowngrade),
  setAllowDowngrade: (value) =>
    Effect.suspend(() => {
      const autoUpdater = getAutoUpdater();
      autoUpdater.allowDowngrade = value;
      return Effect.void;
    }),
  setDisableDifferentialDownload: (value) =>
    Effect.suspend(() => {
      const autoUpdater = getAutoUpdater();
      autoUpdater.disableDifferentialDownload = value;
      return Effect.void;
    }),
  checkForUpdates: Effect.tryPromise({
    try: () => getAutoUpdater().checkForUpdates(),
    catch: (cause) => new ElectronUpdaterCheckForUpdatesError({ cause }),
  }).pipe(Effect.asVoid),
  downloadUpdate: Effect.tryPromise({
    try: () => getAutoUpdater().downloadUpdate(),
    catch: (cause) => new ElectronUpdaterDownloadUpdateError({ cause }),
  }).pipe(Effect.asVoid),
  quitAndInstall: ({ isSilent, isForceRunAfter }) =>
    Effect.try({
      try: () => getAutoUpdater().quitAndInstall(isSilent, isForceRunAfter),
      catch: (cause) => new ElectronUpdaterQuitAndInstallError({ cause }),
    }),
  on: (eventName, listener) => {
    type AutoUpdaterListener = (...args: readonly unknown[]) => void;
    const autoUpdater = getAutoUpdater();
    return Effect.acquireRelease(
      Effect.sync(() => {
        autoUpdater.on(
          eventName as Parameters<AutoUpdater["on"]>[0],
          listener as AutoUpdaterListener,
        );
      }),
      () =>
        Effect.sync(() => {
          autoUpdater.removeListener(
            eventName as Parameters<AutoUpdater["removeListener"]>[0],
            listener as AutoUpdaterListener,
          );
        }),
    ).pipe(Effect.asVoid);
  },
} satisfies ElectronUpdaterShape);
