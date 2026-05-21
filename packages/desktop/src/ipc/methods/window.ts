import {
  ContextMenuItemSchema,
  DesktopActiveWorkStateSchema,
  DesktopAppBrandingSchema,
  DesktopEnvironmentBootstrapSchema,
  DesktopThemeSchema,
  DesktopWindowChromeStateSchema,
  PickFolderOptionsSchema,
} from "@multi/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as DesktopBackendManager from "../../backend/DesktopBackendManager";
import * as DesktopActiveWork from "../../app/DesktopActiveWork";
import * as DesktopEnvironment from "../../app/DesktopEnvironment";
import * as DesktopAppSettings from "../../settings/DesktopAppSettings";
import * as DesktopWindow from "../../window/DesktopWindow";
import * as ElectronDialog from "../../electron/ElectronDialog";
import * as ElectronMenu from "../../electron/ElectronMenu";
import * as ElectronShell from "../../electron/ElectronShell";
import * as ElectronTheme from "../../electron/ElectronTheme";
import * as ElectronWindow from "../../electron/ElectronWindow";
import * as IpcChannels from "../channels";
import { makeIpcMethod, makeSyncIpcMethod } from "../DesktopIpc";

const ContextMenuPosition = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
});

const ContextMenuInput = Schema.Struct({
  items: Schema.Array(ContextMenuItemSchema),
  position: Schema.optionalKey(ContextMenuPosition),
});

function toWebSocketBaseUrl(httpBaseUrl: URL): string {
  const url = new URL(httpBaseUrl.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}

export const getAppBranding = makeSyncIpcMethod({
  channel: IpcChannels.GET_APP_BRANDING_CHANNEL,
  result: Schema.NullOr(DesktopAppBrandingSchema),
  handler: Effect.fn("desktop.ipc.window.getAppBranding")(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    return environment.branding;
  }),
});

export const getLocalEnvironmentBootstrap = makeSyncIpcMethod({
  channel: IpcChannels.GET_LOCAL_ENVIRONMENT_BOOTSTRAP_CHANNEL,
  result: Schema.NullOr(DesktopEnvironmentBootstrapSchema),
  handler: Effect.fn("desktop.ipc.window.getLocalEnvironmentBootstrap")(function* () {
    const backendManager = yield* DesktopBackendManager.DesktopBackendManager;
    const config = yield* backendManager.currentConfig;
    return Option.match(config, {
      onNone: () => null,
      onSome: ({ bootstrap, httpBaseUrl }) => ({
        label: "Local environment",
        httpBaseUrl: httpBaseUrl.href,
        wsBaseUrl: toWebSocketBaseUrl(httpBaseUrl),
        ...(bootstrap.desktopBootstrapToken
          ? { bootstrapToken: bootstrap.desktopBootstrapToken }
          : {}),
      }),
    });
  }),
});

export const getWindowChromeState = makeSyncIpcMethod({
  channel: IpcChannels.GET_WINDOW_CHROME_STATE_CHANNEL,
  result: DesktopWindowChromeStateSchema,
  handler: Effect.fn("desktop.ipc.window.getWindowChromeState")(function* () {
    const electronWindow = yield* ElectronWindow.ElectronWindow;
    const window = yield* electronWindow.currentMainOrFirst;
    return {
      fullscreen: Option.match(window, {
        onNone: () => false,
        onSome: (value) => value.isFullScreen(),
      }),
    };
  }),
});

export const setActiveWorkState = makeIpcMethod({
  channel: IpcChannels.SET_ACTIVE_WORK_STATE_CHANNEL,
  payload: DesktopActiveWorkStateSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.window.setActiveWorkState")(function* (state) {
    const activeWork = yield* DesktopActiveWork.DesktopActiveWork;
    yield* activeWork.set(state);
  }),
});

export const pickFolder = makeIpcMethod({
  channel: IpcChannels.PICK_FOLDER_CHANNEL,
  payload: Schema.UndefinedOr(PickFolderOptionsSchema),
  result: Schema.NullOr(Schema.String),
  handler: Effect.fn("desktop.ipc.window.pickFolder")(function* (options) {
    const dialog = yield* ElectronDialog.ElectronDialog;
    const electronWindow = yield* ElectronWindow.ElectronWindow;
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const selectedPath = yield* dialog.pickFolder({
      owner: yield* electronWindow.focusedMainOrFirst,
      defaultPath: environment.resolvePickFolderDefaultPath(options),
    });
    return Option.getOrNull(selectedPath);
  }),
});

export const confirm = makeIpcMethod({
  channel: IpcChannels.CONFIRM_CHANNEL,
  payload: Schema.String,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.window.confirm")(function* (message) {
    const dialog = yield* ElectronDialog.ElectronDialog;
    const electronWindow = yield* ElectronWindow.ElectronWindow;
    return yield* electronWindow.focusedMainOrFirst.pipe(
      Effect.flatMap((owner) => dialog.confirm({ owner, message })),
    );
  }),
});

export const setTheme = makeIpcMethod({
  channel: IpcChannels.SET_THEME_CHANNEL,
  payload: DesktopThemeSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.window.setTheme")(function* (theme) {
    const desktopSettings = yield* DesktopAppSettings.DesktopAppSettings;
    const desktopWindow = yield* DesktopWindow.DesktopWindow;
    const electronTheme = yield* ElectronTheme.ElectronTheme;
    yield* desktopSettings.setThemeSource(theme);
    yield* electronTheme.setSource(theme);
    yield* desktopWindow.syncAppearance;
  }),
});

export const setBackgroundColor = makeIpcMethod({
  channel: IpcChannels.SET_BACKGROUND_COLOR_CHANNEL,
  payload: Schema.String,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.window.setBackgroundColor")(function* (color) {
    const electronWindow = yield* ElectronWindow.ElectronWindow;
    const window = yield* electronWindow.currentMainOrFirst;
    if (Option.isNone(window) || window.value.isDestroyed()) {
      return;
    }

    window.value.setBackgroundColor(color);
  }),
});

function getMacWindowBackgroundColor(shouldUseDarkColors: boolean): string {
  return shouldUseDarkColors ? "#161616" : "#ffffff";
}

export const setVibrancy = makeIpcMethod({
  channel: IpcChannels.SET_VIBRANCY_CHANNEL,
  payload: Schema.Boolean,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.window.setVibrancy")(function* (enabled) {
    if (process.platform !== "darwin") {
      return;
    }

    const electronWindow = yield* ElectronWindow.ElectronWindow;
    const electronTheme = yield* ElectronTheme.ElectronTheme;
    const window = yield* electronWindow.currentMainOrFirst;
    if (Option.isNone(window) || window.value.isDestroyed()) {
      return;
    }

    const shouldUseDarkColors = yield* electronTheme.shouldUseDarkColors;
    window.value.setVibrancy(enabled ? "sidebar" : null);
    window.value.setBackgroundColor(
      enabled ? "#00000000" : getMacWindowBackgroundColor(shouldUseDarkColors),
    );
  }),
});

export const showContextMenu = makeIpcMethod({
  channel: IpcChannels.CONTEXT_MENU_CHANNEL,
  payload: ContextMenuInput,
  result: Schema.NullOr(Schema.String),
  handler: Effect.fn("desktop.ipc.window.showContextMenu")(function* (input) {
    const electronMenu = yield* ElectronMenu.ElectronMenu;
    const electronWindow = yield* ElectronWindow.ElectronWindow;
    const window = yield* electronWindow.focusedMainOrFirst;
    if (Option.isNone(window)) {
      return null;
    }

    const selectedItemId = yield* electronMenu.showContextMenu({
      window: window.value,
      items: input.items,
      position: Option.fromNullishOr(input.position),
    });
    return Option.getOrNull(selectedItemId);
  }),
});

export const openExternal = makeIpcMethod({
  channel: IpcChannels.OPEN_EXTERNAL_CHANNEL,
  payload: Schema.String,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.window.openExternal")(function* (url) {
    const shell = yield* ElectronShell.ElectronShell;
    return yield* shell.openExternal(url);
  }),
});
