import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import type * as Electron from "electron";

import * as EffectLogger from "@honk/shared/effect-logger";
import * as ElectronApp from "../electron/electron-app";
import * as ElectronDialog from "../electron/electron-dialog";
import * as ElectronMenu from "../electron/electron-menu";
import * as DesktopEnvironment from "../app/desktop-environment";
import * as DesktopUpdates from "../updates/desktop-updates";
import * as DesktopWindow from "./desktop-window";

export interface DesktopApplicationMenuShape {
  readonly configure: Effect.Effect<void>;
}

export class DesktopApplicationMenu extends Context.Service<
  DesktopApplicationMenu,
  DesktopApplicationMenuShape
>()("honk/desktop/ApplicationMenu") {}

type DesktopApplicationMenuRuntimeServices =
  | DesktopUpdates.DesktopUpdates
  | DesktopWindow.DesktopWindow
  | ElectronDialog.ElectronDialog;

const updaterLog = EffectLogger.create({ service: "desktop-updater" });
const menuLog = EffectLogger.create({ service: "desktop-menu" });

const dispatchMenuAction = Effect.fn("desktop.menu.dispatchMenuAction")(function* (
  action: string,
): Effect.fn.Return<void, DesktopWindow.DesktopWindowError, DesktopWindow.DesktopWindow> {
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  yield* desktopWindow.dispatchMenuAction(action);
});

const checkForUpdatesFromMenu: Effect.Effect<
  void,
  never,
  DesktopUpdates.DesktopUpdates | ElectronDialog.ElectronDialog
> = Effect.gen(function* () {
  const updates = yield* DesktopUpdates.DesktopUpdates;
  const electronDialog = yield* ElectronDialog.ElectronDialog;
  const result = yield* updates.check("menu");
  const updateState = result.state;

  if (updateState.status === "up-to-date") {
    yield* electronDialog.showMessageBox({
      type: "info",
      title: "You're up to date!",
      message: `Honk ${updateState.currentVersion} is currently the newest version available.`,
      buttons: ["OK"],
    });
  } else if (updateState.status === "error") {
    yield* electronDialog.showMessageBox({
      type: "warning",
      title: "Update check failed",
      message: "Could not check for updates.",
      detail: updateState.message ?? "An unknown error occurred. Please try again later.",
      buttons: ["OK"],
    });
  }
}).pipe(Effect.withSpan("desktop.menu.checkForUpdates"));

const handleCheckForUpdatesMenuClick: Effect.Effect<
  void,
  DesktopWindow.DesktopWindowError,
  DesktopUpdates.DesktopUpdates | ElectronDialog.ElectronDialog | DesktopWindow.DesktopWindow
> = Effect.gen(function* () {
  const updates = yield* DesktopUpdates.DesktopUpdates;
  const electronDialog = yield* ElectronDialog.ElectronDialog;
  const disabledReason = yield* updates.disabledReason;
  if (Option.isSome(disabledReason)) {
    yield* updaterLog.info("manual update check requested, but updates are disabled", {
      disabledReason: disabledReason.value,
    });
    yield* electronDialog.showMessageBox({
      type: "info",
      title: "Updates unavailable",
      message: "Automatic updates are not available right now.",
      detail: disabledReason.value,
      buttons: ["OK"],
    });
    return;
  }

  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  yield* desktopWindow.ensureMain;
  yield* checkForUpdatesFromMenu;
}).pipe(Effect.withSpan("desktop.menu.handleCheckForUpdatesClick"));

const make = Effect.gen(function* () {
  const electronApp = yield* ElectronApp.ElectronApp;
  const electronMenu = yield* ElectronMenu.ElectronMenu;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const appName = yield* electronApp.name;
  const context = yield* Effect.context<DesktopApplicationMenuRuntimeServices>();
  const runPromise = Effect.runPromiseWith(context);

  const runMenuEffect = <E>(
    action: string,
    effect: Effect.Effect<void, E, DesktopApplicationMenuRuntimeServices>,
  ) => {
    void runPromise(
      effect.pipe(
        Effect.annotateLogs({ action }),
        Effect.withSpan("desktop.menu.action"),
        Effect.catchCause((cause) =>
          menuLog.error("desktop menu action failed", {
            action,
            cause: Cause.pretty(cause),
          }),
        ),
      ),
    );
  };

  const configure = Effect.gen(function* () {
    const checkForUpdatesClick = () => {
      runMenuEffect("check-for-updates", handleCheckForUpdatesMenuClick);
    };
    const settingsClick = () => {
      runMenuEffect("open-settings", dispatchMenuAction("open-settings"));
    };
    const template: Electron.MenuItemConstructorOptions[] = [];

    if (environment.platform === "darwin") {
      template.push({
        label: appName,
        submenu: [
          { role: "about" },
          {
            label: "Check for Updates...",
            click: checkForUpdatesClick,
          },
          { type: "separator" },
          {
            label: "Settings...",
            accelerator: "CmdOrCtrl+,",
            click: settingsClick,
          },
          { type: "separator" },
          { role: "services" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      });
    }

    template.push(
      {
        label: "File",
        submenu: [
          ...(environment.platform === "darwin"
            ? []
            : [
                {
                  label: "Settings...",
                  accelerator: "CmdOrCtrl+,",
                  click: settingsClick,
                },
                { type: "separator" as const },
              ]),
          { role: environment.platform === "darwin" ? "close" : "quit" },
        ],
      },
      { role: "editMenu" },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "forceReload" },
          { role: "toggleDevTools" },
          { type: "separator" },
          { role: "resetZoom" },
          { role: "zoomIn", accelerator: "CmdOrCtrl+=" },
          { role: "zoomIn", accelerator: "CmdOrCtrl+Plus", visible: false },
          { role: "zoomOut" },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
      { role: "windowMenu" },
      {
        role: "help",
        submenu: [
          {
            label: "Check for Updates...",
            click: checkForUpdatesClick,
          },
        ],
      },
    );

    yield* electronMenu.setApplicationMenu(template);
  }).pipe(Effect.withSpan("desktop.menu.configure"));

  return DesktopApplicationMenu.of({
    configure,
  });
});

export const layer = Layer.effect(DesktopApplicationMenu, make);
