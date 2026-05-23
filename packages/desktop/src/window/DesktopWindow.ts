import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import type * as Electron from "electron";

import * as DesktopAssets from "../app/DesktopAssets";
import * as DesktopEnvironment from "../app/DesktopEnvironment";
import * as DesktopObservability from "../app/DesktopObservability";
import * as DesktopState from "../app/DesktopState";
import * as ElectronShell from "../electron/ElectronShell";
import * as ElectronTheme from "../electron/ElectronTheme";
import * as ElectronWindow from "../electron/ElectronWindow";
import * as IpcChannels from "../ipc/channels";
import * as DesktopServerExposure from "../backend/DesktopServerExposure";

const TITLEBAR_HEIGHT = 40;
const MACOS_TITLEBAR_BAND_HEIGHT_PX = 34;
const MACOS_TRAFFIC_LIGHT_CLUSTER_HEIGHT_PX = 16;
/** Keep in sync with MACOS_TRAFFIC_LIGHTS.y in packages/app/src/lib/desktop-chrome.ts */
const MACOS_TRAFFIC_LIGHT_Y_PX =
  (MACOS_TITLEBAR_BAND_HEIGHT_PX - MACOS_TRAFFIC_LIGHT_CLUSTER_HEIGHT_PX) / 2;
const TITLEBAR_COLOR = "#01000000"; // #00000000 does not work correctly on Linux
const TITLEBAR_LIGHT_SYMBOL_COLOR = "#1f2937";
const TITLEBAR_DARK_SYMBOL_COLOR = "#f8fafc";
const DEFAULT_WINDOW_WIDTH = 1280;
const DEFAULT_WINDOW_HEIGHT = 800;
const TRUSTED_RENDERER_PERMISSIONS = new Set(["clipboard-sanitized-write", "notifications"]);

type WindowTitleBarOptions = Pick<
  Electron.BrowserWindowConstructorOptions,
  "titleBarOverlay" | "titleBarStyle" | "trafficLightPosition"
>;

type DesktopWindowRuntimeServices =
  | DesktopEnvironment.DesktopEnvironment
  | DesktopAssets.DesktopAssets
  | DesktopServerExposure.DesktopServerExposure
  | DesktopState.DesktopState
  | ElectronShell.ElectronShell
  | ElectronTheme.ElectronTheme
  | ElectronWindow.ElectronWindow;

export class DesktopWindowDevServerUrlMissingError extends Data.TaggedError(
  "DesktopWindowDevServerUrlMissingError",
)<{}> {
  override get message() {
    return "VITE_DEV_SERVER_URL is required in desktop development.";
  }
}

export type DesktopWindowError =
  | DesktopWindowDevServerUrlMissingError
  | ElectronWindow.ElectronWindowCreateError;

export interface DesktopWindowShape {
  readonly createMain: Effect.Effect<Electron.BrowserWindow, DesktopWindowError>;
  readonly ensureMain: Effect.Effect<Electron.BrowserWindow, DesktopWindowError>;
  readonly revealOrCreateMain: Effect.Effect<Electron.BrowserWindow, DesktopWindowError>;
  readonly activate: Effect.Effect<void, DesktopWindowError>;
  readonly createMainIfBackendReady: Effect.Effect<void, DesktopWindowError>;
  readonly handleBackendReady: Effect.Effect<void, DesktopWindowError>;
  readonly dispatchMenuAction: (action: string) => Effect.Effect<void, DesktopWindowError>;
  readonly syncAppearance: Effect.Effect<void>;
}

export class DesktopWindow extends Context.Service<DesktopWindow, DesktopWindowShape>()(
  "multi/desktop/Window",
) {}

const { logInfo: logWindowInfo, logWarning: logWindowWarning } =
  DesktopObservability.makeComponentLogger("desktop-window");

function resolveDesktopDevServerUrl(
  environment: DesktopEnvironment.DesktopEnvironmentShape,
): Effect.Effect<string, DesktopWindowDevServerUrlMissingError> {
  return Option.match(environment.devServerUrl, {
    onNone: () => Effect.fail(new DesktopWindowDevServerUrlMissingError()),
    onSome: (url) => Effect.succeed(url.href),
  });
}

function getIconOption(
  iconPaths: DesktopAssets.DesktopIconPaths,
): { icon: string } | Record<string, never> {
  if (process.platform === "darwin") return {}; // macOS uses .icns from app bundle
  const ext = process.platform === "win32" ? "ico" : "png";
  return Option.match(iconPaths[ext], {
    onNone: () => ({}),
    onSome: (icon) => ({ icon }),
  });
}

function getInitialWindowBackgroundColor(shouldUseDarkColors: boolean): string {
  return shouldUseDarkColors ? "#161616" : "#ffffff";
}

function getMacOSTrafficLightPosition(): { x: number; y: number } {
  return { x: 14, y: MACOS_TRAFFIC_LIGHT_Y_PX };
}

function syncMacOSTrafficLightPosition(window: Electron.BrowserWindow): void {
  if (process.platform !== "darwin" || window.isDestroyed()) {
    return;
  }

  window.setWindowButtonPosition(getMacOSTrafficLightPosition());
}

function getWindowTitleBarOptions(shouldUseDarkColors: boolean): WindowTitleBarOptions {
  if (process.platform === "darwin") {
    return {
      titleBarStyle: "hiddenInset",
      trafficLightPosition: getMacOSTrafficLightPosition(),
    };
  }

  return {
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: TITLEBAR_COLOR,
      height: TITLEBAR_HEIGHT,
      symbolColor: shouldUseDarkColors ? TITLEBAR_DARK_SYMBOL_COLOR : TITLEBAR_LIGHT_SYMBOL_COLOR,
    },
  };
}

function sendWindowChromeState(window: Electron.BrowserWindow): void {
  if (window.isDestroyed()) {
    return;
  }
  syncMacOSTrafficLightPosition(window);
  window.webContents.send(IpcChannels.WINDOW_CHROME_STATE_CHANNEL, {
    fullscreen: window.isFullScreen(),
  });
}

function isTrustedRendererUrl(rawUrl: string | undefined, trustedOrigin: string): boolean {
  if (!rawUrl) {
    return false;
  }
  try {
    return new URL(rawUrl).origin === trustedOrigin;
  } catch {
    return false;
  }
}

function restrictRendererPermissions(window: Electron.BrowserWindow, trustedOrigin: string): void {
  window.webContents.session.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      callback(
        TRUSTED_RENDERER_PERMISSIONS.has(permission) &&
          webContents.id === window.webContents.id &&
          isTrustedRendererUrl(details.requestingUrl, trustedOrigin),
      );
    },
  );
  window.webContents.session.setPermissionCheckHandler(
    (webContents, permission, requestingOrigin, details) => {
      if (!TRUSTED_RENDERER_PERMISSIONS.has(permission)) {
        return false;
      }
      if (webContents !== null && webContents.id !== window.webContents.id) {
        return false;
      }
      return (
        isTrustedRendererUrl(details.requestingUrl, trustedOrigin) ||
        isTrustedRendererUrl(requestingOrigin, trustedOrigin)
      );
    },
  );
}

function preventUntrustedMainFrameNavigation(
  window: Electron.BrowserWindow,
  trustedOrigin: string,
  logBlockedNavigation: (url: string) => void,
): void {
  window.webContents.on("will-navigate", (event, url) => {
    if (isTrustedRendererUrl(url, trustedOrigin)) {
      return;
    }
    event.preventDefault();
    logBlockedNavigation(url);
  });
}

function syncWindowAppearance(
  window: Electron.BrowserWindow,
  shouldUseDarkColors: boolean,
): Effect.Effect<void> {
  return Effect.sync(() => {
    if (window.isDestroyed()) {
      return;
    }

    window.setBackgroundColor(getInitialWindowBackgroundColor(shouldUseDarkColors));
    const { titleBarOverlay } = getWindowTitleBarOptions(shouldUseDarkColors);
    if (typeof titleBarOverlay === "object") {
      window.setTitleBarOverlay(titleBarOverlay);
    }
    syncMacOSTrafficLightPosition(window);
  });
}

type RevealSubscription = (listener: () => void) => void;

function bindFirstRevealTrigger(
  subscribers: readonly RevealSubscription[],
  reveal: () => void,
): void {
  let revealed = false;
  const fire = () => {
    if (revealed) return;
    revealed = true;
    reveal();
  };
  for (const subscribe of subscribers) {
    subscribe(fire);
  }
}

const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const assets = yield* DesktopAssets.DesktopAssets;
  const electronShell = yield* ElectronShell.ElectronShell;
  const electronTheme = yield* ElectronTheme.ElectronTheme;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const serverExposure = yield* DesktopServerExposure.DesktopServerExposure;
  const state = yield* DesktopState.DesktopState;
  const context = yield* Effect.context<DesktopWindowRuntimeServices>();
  const runPromise = Effect.runPromiseWith(context);

  const createWindow = Effect.fn("desktop.window.createWindow")(function* (
    backendHttpUrl: URL,
  ): Effect.fn.Return<Electron.BrowserWindow, DesktopWindowError> {
    const iconPaths = yield* assets.iconPaths;
    const iconOption = getIconOption(iconPaths);
    const shouldUseDarkColors = yield* electronTheme.shouldUseDarkColors;
    const appUrl = environment.isDevelopment
      ? new URL(yield* resolveDesktopDevServerUrl(environment))
      : backendHttpUrl;
    const window = yield* electronWindow.create({
      width: DEFAULT_WINDOW_WIDTH,
      height: DEFAULT_WINDOW_HEIGHT,
      center: true,
      minWidth: 840,
      minHeight: 620,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: getInitialWindowBackgroundColor(shouldUseDarkColors),
      ...iconOption,
      title: environment.displayName,
      ...getWindowTitleBarOptions(shouldUseDarkColors),
      webPreferences: {
        preload: environment.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    const trustedOrigin = appUrl.origin;
    restrictRendererPermissions(window, trustedOrigin);
    preventUntrustedMainFrameNavigation(window, trustedOrigin, (url) => {
      void runPromise(
        logWindowWarning("blocked untrusted main-frame navigation", {
          url,
        }),
      );
    });


    window.webContents.setWindowOpenHandler(({ url }) => {
      if (Option.isSome(ElectronShell.parseSafeExternalUrl(url))) {
        void runPromise(electronShell.openExternal(url));
      }
      return { action: "deny" };
    });

    window.on("page-title-updated", (event) => {
      event.preventDefault();
      window.setTitle(environment.displayName);
    });
    window.webContents.on("did-finish-load", () => {
      window.setTitle(environment.displayName);
      sendWindowChromeState(window);
    });
    window.webContents.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame) {
          return;
        }
        void runPromise(
          logWindowWarning("main window failed to load", {
            errorCode,
            errorDescription,
            url: validatedURL,
          }),
        );
      },
    );
    window.webContents.on("render-process-gone", (_event, details) => {
      void runPromise(
        logWindowWarning("main window render process gone", {
          reason: details.reason,
          exitCode: details.exitCode,
        }),
      );
    });
    window.on("enter-full-screen", () => {
      sendWindowChromeState(window);
    });
    window.on("leave-full-screen", () => {
      sendWindowChromeState(window);
    });
    window.once("ready-to-show", () => {
      sendWindowChromeState(window);
    });

    const revealSubscribers: RevealSubscription[] = [(fire) => window.once("ready-to-show", fire)];
    if (process.platform === "linux") {
      revealSubscribers.push((fire) => window.webContents.once("did-finish-load", fire));
    }
    bindFirstRevealTrigger(revealSubscribers, () => {
      void runPromise(electronWindow.reveal(window));
    });

    if (environment.isDevelopment) {
      void window.loadURL(appUrl.href);
      window.webContents.openDevTools({ mode: "detach" });
    } else {
      void window.loadURL(appUrl.href);
    }

    window.on("closed", () => {
      void runPromise(electronWindow.clearMain(Option.some(window)));
    });

    return window;
  });

  const createMain = Effect.gen(function* () {
    const backendConfig = yield* serverExposure.backendConfig;
    const window = yield* createWindow(backendConfig.httpBaseUrl);
    yield* electronWindow.setMain(window);
    yield* logWindowInfo("main window created");
    return window;
  }).pipe(Effect.withSpan("desktop.window.createMain"));

  const ensureMain = Effect.gen(function* () {
    const existingWindow = yield* electronWindow.currentMainOrFirst;
    if (Option.isSome(existingWindow)) {
      return existingWindow.value;
    }
    return yield* createMain;
  }).pipe(Effect.withSpan("desktop.window.ensureMain"));

  const revealOrCreateMain = Effect.gen(function* () {
    const window = yield* ensureMain;
    yield* electronWindow.reveal(window);
    return window;
  }).pipe(Effect.withSpan("desktop.window.revealOrCreateMain"));

  const createMainIfBackendReady = Effect.gen(function* () {
    const backendReady = yield* Ref.get(state.backendReady);
    if (!backendReady) return;
    const existingWindow = yield* electronWindow.currentMainOrFirst;
    if (Option.isSome(existingWindow)) return;
    yield* createMain;
  }).pipe(Effect.withSpan("desktop.window.createMainIfBackendReady"));

  return DesktopWindow.of({
    createMain,
    ensureMain,
    revealOrCreateMain,
    activate: Effect.gen(function* () {
      const existingWindow = yield* electronWindow.currentMainOrFirst;
      if (Option.isSome(existingWindow)) {
        yield* electronWindow.reveal(existingWindow.value);
      } else {
        yield* createMainIfBackendReady;
      }
    }).pipe(Effect.withSpan("desktop.window.activate")),
    createMainIfBackendReady,
    handleBackendReady: Effect.gen(function* () {
      yield* Ref.set(state.backendReady, true);
      yield* logWindowInfo("backend ready", { source: "http" });
      yield* createMainIfBackendReady;
    }).pipe(Effect.withSpan("desktop.window.handleBackendReady")),
    dispatchMenuAction: Effect.fn("desktop.window.dispatchMenuAction")(function* (action) {
      yield* Effect.annotateCurrentSpan({ action });
      const existingWindow = yield* electronWindow.focusedMainOrFirst;
      const targetWindow = Option.isSome(existingWindow) ? existingWindow.value : yield* createMain;

      const send = () => {
        if (targetWindow.isDestroyed()) return;
        targetWindow.webContents.send(IpcChannels.MENU_ACTION_CHANNEL, action);
        void runPromise(electronWindow.reveal(targetWindow));
      };

      if (targetWindow.webContents.isLoadingMainFrame()) {
        targetWindow.webContents.once("did-finish-load", send);
        return;
      }

      send();
    }),
    syncAppearance: Effect.gen(function* () {
      const shouldUseDarkColors = yield* electronTheme.shouldUseDarkColors;
      yield* electronWindow.syncAllAppearance((window) =>
        syncWindowAppearance(window, shouldUseDarkColors),
      );
    }).pipe(Effect.withSpan("desktop.window.syncAppearance")),
  });
});

export const layer = Layer.effect(DesktopWindow, make);
