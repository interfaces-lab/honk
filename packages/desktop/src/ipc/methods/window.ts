import {
  ContextMenuItemSchema,
  DesktopActiveWorkStateSchema,
  DesktopAppBrandingSchema,
  DesktopThemeSchema,
  DesktopWindowChromeStateSchema,
  PickFolderOptionsSchema,
} from "@honk/shared/desktop-api";
import { OpenInEditorInput } from "@honk/shared/editor";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as Electron from "electron";

import * as DesktopActiveWork from "../../app/desktop-active-work";
import * as DesktopEnvironment from "../../app/desktop-environment";
import * as DesktopAppSettings from "../../settings/desktop-app-settings";
import * as DesktopWindow from "../../window/desktop-window";
import * as ElectronDialog from "../../electron/electron-dialog";
import * as ElectronMenu from "../../electron/electron-menu";
import * as ElectronShell from "../../electron/electron-shell";
import * as ElectronTheme from "../../electron/electron-theme";
import * as ElectronWindow from "../../electron/electron-window";
import { desktopGlassBackground, desktopWindowBackground } from "../../window/desktop-theme";
import * as IpcChannels from "../channels";
import { makeIpcMethod, makeSyncIpcMethod } from "../desktop-ipc";

const ContextMenuPosition = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
});

const ContextMenuInput = Schema.Struct({
  items: Schema.Array(ContextMenuItemSchema),
  position: Schema.optionalKey(ContextMenuPosition),
});

const windowBackgroundColorByWindow = new WeakMap<Electron.BrowserWindow, string>();
const windowDisplayZoomByWindow = new WeakMap<Electron.BrowserWindow, number>();
const windowVibrancyByWindow = new WeakMap<Electron.BrowserWindow, boolean>();

function setWindowBackgroundColorIfChanged(window: Electron.BrowserWindow, color: string): void {
  if (windowBackgroundColorByWindow.get(window) === color) {
    return;
  }

  window.setBackgroundColor(color);
  windowBackgroundColorByWindow.set(window, color);
}

function setWindowDisplayZoomIfChanged(window: Electron.BrowserWindow, factor: number): void {
  if (windowDisplayZoomByWindow.get(window) === factor) {
    return;
  }

  window.webContents.setZoomFactor(factor);
  windowDisplayZoomByWindow.set(window, factor);
}

function setWindowVibrancyIfChanged(window: Electron.BrowserWindow, enabled: boolean): void {
  if (windowVibrancyByWindow.get(window) === enabled) {
    return;
  }

  window.setVibrancy(enabled ? "sidebar" : null);
  windowVibrancyByWindow.set(window, enabled);
}

export const getAppBranding = makeSyncIpcMethod({
  channel: IpcChannels.GET_APP_BRANDING_CHANNEL,
  result: Schema.NullOr(DesktopAppBrandingSchema),
  handler: Effect.fn("desktop.ipc.window.getAppBranding")(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    return environment.branding;
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
  trace: false,
  handler: Effect.fnUntraced(function* (state) {
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
  trace: false,
  handler: Effect.fnUntraced(function* (color) {
    const electronWindow = yield* ElectronWindow.ElectronWindow;
    const window = yield* electronWindow.currentMainOrFirst;
    if (Option.isNone(window) || window.value.isDestroyed()) {
      return;
    }

    setWindowBackgroundColorIfChanged(window.value, color);
  }),
});

function getMacWindowBackgroundColor(shouldUseDarkColors: boolean): string {
  return desktopWindowBackground(shouldUseDarkColors);
}

function getMacGlassWindowBackgroundColor(shouldUseDarkColors: boolean): string {
  return desktopGlassBackground(shouldUseDarkColors);
}

const DISPLAY_ZOOM_FACTOR_MIN = 0.84;
const DISPLAY_ZOOM_FACTOR_MAX = 1.24;

export const setDisplayZoom = makeIpcMethod({
  channel: IpcChannels.SET_DISPLAY_ZOOM_CHANNEL,
  payload: Schema.Number,
  result: Schema.Void,
  trace: false,
  handler: Effect.fnUntraced(function* (factor) {
    const electronWindow = yield* ElectronWindow.ElectronWindow;
    const window = yield* electronWindow.currentMainOrFirst;
    if (Option.isNone(window) || window.value.isDestroyed()) {
      return;
    }

    const clamped = Math.min(DISPLAY_ZOOM_FACTOR_MAX, Math.max(DISPLAY_ZOOM_FACTOR_MIN, factor));
    setWindowDisplayZoomIfChanged(window.value, clamped);
  }),
});

export const expandWindowWidth = makeIpcMethod({
  channel: IpcChannels.EXPAND_WINDOW_WIDTH_CHANNEL,
  payload: Schema.Number,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.window.expandWindowWidth")(function* (additionalWidth) {
    const electronWindow = yield* ElectronWindow.ElectronWindow;
    const window = yield* electronWindow.focusedMainOrFirst;
    if (
      Option.isNone(window) ||
      window.value.isDestroyed() ||
      window.value.isFullScreen() ||
      window.value.isMaximized() ||
      !Number.isFinite(additionalWidth) ||
      additionalWidth <= 0
    ) {
      return;
    }

    const target = window.value;
    // The renderer measures in CSS px; window bounds are DIP, which differ by
    // the webContents zoom factor.
    const additionalDip = Math.round(additionalWidth * target.webContents.getZoomFactor());
    const bounds = target.getBounds();
    const workArea = Electron.screen.getDisplayMatching(bounds).workArea;
    const width = Math.min(bounds.width + additionalDip, workArea.width);
    const x = Math.max(workArea.x, Math.min(bounds.x, workArea.x + workArea.width - width));
    target.setBounds({ x, y: bounds.y, width, height: bounds.height }, true);
  }),
});

export const setVibrancy = makeIpcMethod({
  channel: IpcChannels.SET_VIBRANCY_CHANNEL,
  payload: Schema.Boolean,
  result: Schema.Void,
  trace: false,
  handler: Effect.fnUntraced(function* (enabled) {
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
    if (enabled) {
      setWindowBackgroundColorIfChanged(
        window.value,
        getMacGlassWindowBackgroundColor(shouldUseDarkColors),
      );
      setWindowVibrancyIfChanged(window.value, true);
      return;
    }

    setWindowVibrancyIfChanged(window.value, false);
    setWindowBackgroundColorIfChanged(
      window.value,
      getMacWindowBackgroundColor(shouldUseDarkColors),
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

export const openInEditor = makeIpcMethod({
  channel: IpcChannels.OPEN_IN_EDITOR_CHANNEL,
  payload: OpenInEditorInput,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.window.openInEditor")(function* (input) {
    const shell = yield* ElectronShell.ElectronShell;
    return yield* shell.openInEditor(input);
  }),
});

export const showItemInFolder = makeIpcMethod({
  channel: IpcChannels.SHOW_ITEM_IN_FOLDER_CHANNEL,
  payload: Schema.String,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.window.showItemInFolder")(function* (path) {
    const shell = yield* ElectronShell.ElectronShell;
    return yield* shell.showItemInFolder(path);
  }),
});
