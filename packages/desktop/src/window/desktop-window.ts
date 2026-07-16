import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import * as Electron from "electron";

import * as DesktopAssets from "../app/desktop-assets";
import * as DesktopEnvironment from "../app/desktop-environment";
import * as EffectLogger from "@honk/shared/effect-logger";
import * as DesktopState from "../app/desktop-state";
import { desktopGlassBackground, desktopWindowBackground } from "./desktop-theme";
import * as ElectronShell from "../electron/electron-shell";
import * as ElectronTheme from "../electron/electron-theme";
import * as ElectronWindow from "../electron/electron-window";
import { DESKTOP_SCHEME } from "../electron/electron-protocol";
import * as IpcChannels from "../ipc/channels";
import * as DesktopAppSettings from "../settings/desktop-app-settings";

const TITLEBAR_HEIGHT = 40;
// Match OpenCode desktop traffic lights for the bottom-seated tab band.
const MACOS_TRAFFIC_LIGHT_X_PX = 14;
const MACOS_TRAFFIC_LIGHT_Y_PX = 14;
const TITLEBAR_COLOR = "#01000000"; // #00000000 breaks on Linux
const TITLEBAR_LIGHT_SYMBOL_COLOR = "#1f2937";
const TITLEBAR_DARK_SYMBOL_COLOR = "#f8fafc";
const DEFAULT_WINDOW_WIDTH = 1280;
const DEFAULT_WINDOW_HEIGHT = 800;
const ONBOARDING_WINDOW_BACKGROUND_COLOR = "#00000000";
// Delay so the invoke reply reaches the onboarding renderer before destroy.
const ONBOARDING_WINDOW_CLOSE_DELAY_MS = 120;
// Main owns cleanup if the renderer never reports finish.
const ONBOARDING_WINDOW_FINISH_FALLBACK_MS = 3_000;
const TRUSTED_RENDERER_PERMISSIONS = new Set(["clipboard-sanitized-write", "notifications"]);
const RENDERER_CONSOLE_REPEAT_LOG_WINDOW_MS = 30_000;
const RENDERER_CONSOLE_REPEAT_LOG_MAX_ENTRIES = 256;
const MAIN_WINDOW_ID = "main";
const ONBOARDING_WINDOW_ID = "onboarding";

type WindowTitleBarOptions = Pick<
  Electron.BrowserWindowConstructorOptions,
  "titleBarOverlay" | "titleBarStyle" | "trafficLightPosition"
>;

type DesktopWindowRuntimeServices =
  | DesktopEnvironment.DesktopEnvironment
  | DesktopAssets.DesktopAssets
  | DesktopAppSettings.DesktopAppSettings
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
  | ElectronWindow.ElectronWindowCreateError
  | DesktopAppSettings.DesktopSettingsWriteError;

export interface DesktopWindowShape {
  readonly createMain: Effect.Effect<Electron.BrowserWindow, DesktopWindowError>;
  readonly ensureMain: Effect.Effect<Electron.BrowserWindow, DesktopWindowError>;
  readonly revealOrCreateMain: Effect.Effect<Electron.BrowserWindow, DesktopWindowError>;
  readonly activate: Effect.Effect<void, DesktopWindowError>;
  readonly createMainIfBackendReady: Effect.Effect<void, DesktopWindowError>;
  readonly handleBackendReady: Effect.Effect<void, DesktopWindowError>;
  readonly completeOnboarding: Effect.Effect<void, DesktopWindowError>;
  readonly finishOnboarding: Effect.Effect<void>;
  readonly dismissOnboarding: Effect.Effect<void>;
  readonly replayOnboarding: Effect.Effect<void, DesktopWindowError>;
  readonly dispatchMenuAction: (action: string) => Effect.Effect<void, DesktopWindowError>;
  readonly syncAppearance: Effect.Effect<void>;
}

export class DesktopWindow extends Context.Service<DesktopWindow, DesktopWindowShape>()(
  "honk/desktop/Window",
) {}

const elog = EffectLogger.create({ service: "desktop-window" });

const DESKTOP_RENDERER_ORIGIN = `${DESKTOP_SCHEME}://desktop`;
const rendererConsoleMessageLastSeen = new Map<string, number>();
const trustedRendererWebContentsIds = new Set<number>();
const onboardingWindows = new WeakSet<Electron.BrowserWindow>();

function resolveDesktopDevServerUrl(
  environment: DesktopEnvironment.DesktopEnvironmentShape,
): Effect.Effect<string, DesktopWindowDevServerUrlMissingError> {
  return Option.match(environment.devServerUrl, {
    onNone: () => Effect.fail(new DesktopWindowDevServerUrlMissingError()),
    onSome: (url) => Effect.succeed(url.href),
  });
}

function resolveMainWindowAppUrl(
  environment: DesktopEnvironment.DesktopEnvironmentShape,
): Effect.Effect<URL, DesktopWindowDevServerUrlMissingError> {
  if (environment.isDevelopment) {
    return resolveDesktopDevServerUrl(environment).pipe(Effect.map((href) => new URL(href)));
  }

  return Effect.succeed(new URL(`${DESKTOP_RENDERER_ORIGIN}/index.html`));
}

function resolveOnboardingWindowAppUrl(
  environment: DesktopEnvironment.DesktopEnvironmentShape,
  replay: boolean,
): Effect.Effect<URL, DesktopWindowDevServerUrlMissingError> {
  return resolveMainWindowAppUrl(environment).pipe(
    Effect.map((appUrl) => {
      appUrl.searchParams.set("window", "onboarding");
      if (replay) {
        appUrl.searchParams.set("replay", "1");
      }
      return appUrl;
    }),
  );
}

function shouldLogRendererConsoleMessage(
  level: number,
  message: string,
  line: number,
  sourceId: string,
): boolean {
  const now = Date.now();
  const key = [level, sourceId, line, message].join("\0");
  const lastSeenAt = rendererConsoleMessageLastSeen.get(key);

  rendererConsoleMessageLastSeen.set(key, now);

  if (lastSeenAt !== undefined && now - lastSeenAt < RENDERER_CONSOLE_REPEAT_LOG_WINDOW_MS) {
    return false;
  }

  if (rendererConsoleMessageLastSeen.size > RENDERER_CONSOLE_REPEAT_LOG_MAX_ENTRIES) {
    const staleBefore = now - RENDERER_CONSOLE_REPEAT_LOG_WINDOW_MS;
    for (const [entryKey, entryLastSeenAt] of rendererConsoleMessageLastSeen) {
      if (
        entryLastSeenAt < staleBefore ||
        rendererConsoleMessageLastSeen.size > RENDERER_CONSOLE_REPEAT_LOG_MAX_ENTRIES
      ) {
        rendererConsoleMessageLastSeen.delete(entryKey);
      }
      if (rendererConsoleMessageLastSeen.size <= RENDERER_CONSOLE_REPEAT_LOG_MAX_ENTRIES) {
        break;
      }
    }
  }

  return true;
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
  return desktopWindowBackground(shouldUseDarkColors);
}

function getMacGlassWindowBackgroundColor(shouldUseDarkColors: boolean): string {
  return desktopGlassBackground(shouldUseDarkColors);
}

function getInitialWindowGlassOptions(
  shouldUseDarkColors: boolean,
): Electron.BrowserWindowConstructorOptions {
  if (process.platform !== "darwin") {
    return {};
  }

  return {
    backgroundColor: getMacGlassWindowBackgroundColor(shouldUseDarkColors),
    hasShadow: true,
    vibrancy: "sidebar",
    visualEffectState: "active",
  };
}

function getMacOSTrafficLightPosition(): { x: number; y: number } {
  return { x: MACOS_TRAFFIC_LIGHT_X_PX, y: MACOS_TRAFFIC_LIGHT_Y_PX };
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

function registerRendererPermissions(window: Electron.BrowserWindow, trustedOrigin: string): void {
  const webContentsId = window.webContents.id;
  trustedRendererWebContentsIds.add(webContentsId);
  window.webContents.once("destroyed", () => {
    // webContents throws after this event. Keep the numeric id from while alive.
    trustedRendererWebContentsIds.delete(webContentsId);
  });
  window.webContents.session.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      callback(
        TRUSTED_RENDERER_PERMISSIONS.has(permission) &&
          trustedRendererWebContentsIds.has(webContents.id) &&
          isTrustedRendererUrl(details.requestingUrl, trustedOrigin),
      );
    },
  );
  window.webContents.session.setPermissionCheckHandler(
    (webContents, permission, requestingOrigin, details) => {
      if (!TRUSTED_RENDERER_PERMISSIONS.has(permission)) {
        return false;
      }
      if (webContents !== null && !trustedRendererWebContentsIds.has(webContents.id)) {
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

    const { titleBarOverlay } = getWindowTitleBarOptions(shouldUseDarkColors);
    if (typeof titleBarOverlay === "object") {
      window.setTitleBarOverlay(titleBarOverlay);
    }
    window.setBackgroundColor(
      process.platform === "darwin"
        ? getMacGlassWindowBackgroundColor(shouldUseDarkColors)
        : getInitialWindowBackgroundColor(shouldUseDarkColors),
    );
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

function windowReadyPromise(window: Electron.BrowserWindow): Promise<void> {
  return new Promise((resolve) => {
    const subscribers: RevealSubscription[] = [
      (fire) => window.once("ready-to-show", fire),
      (fire) => window.once("closed", fire),
    ];
    if (process.platform === "linux") {
      subscribers.push((fire) => window.webContents.once("did-finish-load", fire));
    }
    bindFirstRevealTrigger(subscribers, resolve);
  });
}

function canSendToWindow(window: Electron.BrowserWindow): boolean {
  try {
    return !window.isDestroyed() && !window.webContents.isDestroyed();
  } catch {
    return false;
  }
}

type DesktopWindowKind = "main" | "onboarding";

interface CreatedDesktopWindow {
  readonly window: Electron.BrowserWindow;
  readonly ready: Promise<void>;
}

interface OnboardingWindowState {
  readonly window: Electron.BrowserWindow;
  readonly replay: boolean;
}

const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const assets = yield* DesktopAssets.DesktopAssets;
  const desktopSettings = yield* DesktopAppSettings.DesktopAppSettings;
  const electronShell = yield* ElectronShell.ElectronShell;
  const electronTheme = yield* ElectronTheme.ElectronTheme;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const state = yield* DesktopState.DesktopState;
  const onboardingWindowRef = yield* Ref.make<Option.Option<OnboardingWindowState>>(Option.none());
  const readyByWindow = new WeakMap<Electron.BrowserWindow, Promise<void>>();
  const scheduledOnboardingCloses = new WeakSet<Electron.BrowserWindow>();
  const context = yield* Effect.context<DesktopWindowRuntimeServices>();
  const runPromise = Effect.runPromiseWith(context);

  const liveOnboardingWindow = Ref.get(onboardingWindowRef).pipe(
    Effect.map(Option.filter((entry) => !entry.window.isDestroyed())),
  );

  const revealExistingMain = electronWindow.main.pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.void,
        onSome: (window) => electronWindow.reveal(window),
      }),
    ),
  );

  const hideExistingMain = electronWindow.main.pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.void,
        onSome: (window) =>
          Effect.sync(() => {
            if (!window.isDestroyed() && window.isVisible()) {
              window.hide();
            }
          }),
      }),
    ),
  );

  const createWindow = Effect.fn("desktop.window.createWindow")(function* (input: {
    readonly kind: DesktopWindowKind;
    readonly appUrl: URL;
    readonly title: string;
    readonly options: Electron.BrowserWindowConstructorOptions;
    readonly revealWhenReady: boolean;
    readonly openDevTools: boolean;
  }): Effect.fn.Return<CreatedDesktopWindow, DesktopWindowError> {
    const window = yield* electronWindow.create(input.options);
    const ready = windowReadyPromise(window);
    readyByWindow.set(window, ready);
    if (input.kind === "onboarding") {
      onboardingWindows.add(window);
    }

    const trustedOrigin = input.appUrl.origin;
    registerRendererPermissions(window, trustedOrigin);
    preventUntrustedMainFrameNavigation(window, trustedOrigin, (url) => {
      void runPromise(
        elog.warn("blocked untrusted main-frame navigation", {
          windowKind: input.kind,
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
      window.setTitle(input.title);
    });
    window.webContents.on("did-finish-load", () => {
      window.setTitle(input.title);
      if (input.kind === "main") {
        sendWindowChromeState(window);
      }
    });
    window.webContents.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame) {
          return;
        }
        void runPromise(
          elog.error("window failed to load", {
            windowKind: input.kind,
            errorCode,
            errorDescription,
            url: validatedURL,
          }),
        );
      },
    );
    window.webContents.on("render-process-gone", (_event, details) => {
      void runPromise(
        elog.error("window render process gone", {
          windowKind: input.kind,
          reason: details.reason,
          exitCode: details.exitCode,
        }),
      );
    });
    window.webContents.on("preload-error", (_event, preloadPath, error) => {
      void runPromise(
        elog.error("window preload error", {
          windowKind: input.kind,
          preloadPath,
          error,
        }),
      );
    });
    window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
      if (level < 2 || !shouldLogRendererConsoleMessage(level, message, line, sourceId)) {
        return;
      }
      const log = level >= 3 ? elog.error : elog.warn;
      void runPromise(
        log("renderer console message", {
          windowKind: input.kind,
          level,
          message,
          line,
          sourceId,
        }),
      );
    });

    if (input.kind === "main") {
      window.on("enter-full-screen", () => {
        sendWindowChromeState(window);
      });
      window.on("leave-full-screen", () => {
        sendWindowChromeState(window);
      });
      window.once("ready-to-show", () => {
        sendWindowChromeState(window);
      });
    }

    if (input.revealWhenReady) {
      void ready.then(() => runPromise(electronWindow.reveal(window)));
    }

    void window.loadURL(input.appUrl.href);
    if (input.openDevTools) {
      window.webContents.openDevTools({ mode: "detach" });
    }

    return { window, ready };
  });

  const createMainWindow = Effect.fn("desktop.window.createMainWindow")(function* (
    revealWhenReady: boolean,
  ): Effect.fn.Return<Electron.BrowserWindow, DesktopWindowError> {
    const iconPaths = yield* assets.iconPaths;
    const iconOption = getIconOption(iconPaths);
    const shouldUseDarkColors = yield* electronTheme.shouldUseDarkColors;
    const appUrl = yield* resolveMainWindowAppUrl(environment);
    const created = yield* createWindow({
      kind: "main",
      appUrl,
      title: environment.displayName,
      revealWhenReady,
      openDevTools: environment.isDevelopment,
      options: {
        width: DEFAULT_WINDOW_WIDTH,
        height: DEFAULT_WINDOW_HEIGHT,
        center: true,
        // Shell handles narrow widths. Match Cursor glass-window mins.
        minWidth: 400,
        minHeight: 520,
        show: false,
        autoHideMenuBar: true,
        backgroundColor: getInitialWindowBackgroundColor(shouldUseDarkColors),
        ...getInitialWindowGlassOptions(shouldUseDarkColors),
        ...iconOption,
        title: environment.displayName,
        ...getWindowTitleBarOptions(shouldUseDarkColors),
        webPreferences: {
          preload: environment.preloadPath,
          additionalArguments: [`--honk-window-id=${MAIN_WINDOW_ID}`],
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      },
    });
    yield* electronWindow.setMain(created.window);
    created.window.on("closed", () => {
      void runPromise(electronWindow.clearMain(Option.some(created.window)));
    });
    yield* elog.info("main window created", { revealWhenReady });
    return created.window;
  });

  const createMain = createMainWindow(true).pipe(Effect.withSpan("desktop.window.createMain"));

  const ensureMain = Effect.gen(function* () {
    const existingWindow = yield* electronWindow.main;
    if (Option.isSome(existingWindow)) {
      return existingWindow.value;
    }
    return yield* createMain;
  }).pipe(Effect.withSpan("desktop.window.ensureMain"));

  const ensureMainForOnboardingTransition = Effect.gen(function* () {
    const existingWindow = yield* electronWindow.main;
    if (Option.isSome(existingWindow)) {
      return existingWindow.value;
    }
    return yield* createMainWindow(false);
  }).pipe(Effect.withSpan("desktop.window.ensureMainForOnboardingTransition"));

  const createOnboardingWindow = Effect.fn("desktop.window.createOnboardingWindow")(function* (
    replay: boolean,
  ): Effect.fn.Return<Electron.BrowserWindow, DesktopWindowError> {
    const iconPaths = yield* assets.iconPaths;
    const iconOption = getIconOption(iconPaths);
    const appUrl = yield* resolveOnboardingWindowAppUrl(environment, replay);
    const created = yield* createWindow({
      kind: "onboarding",
      appUrl,
      title: `${environment.displayName} Setup`,
      revealWhenReady: false,
      openDevTools: false,
      options: {
        width: DEFAULT_WINDOW_WIDTH,
        height: DEFAULT_WINDOW_HEIGHT,
        center: true,
        show: false,
        frame: false,
        transparent: true,
        backgroundColor: ONBOARDING_WINDOW_BACKGROUND_COLOR,
        hasShadow: false,
        fullscreen: true,
        simpleFullscreen: process.platform === "darwin",
        resizable: false,
        minimizable: false,
        maximizable: false,
        closable: replay,
        autoHideMenuBar: true,
        ...iconOption,
        title: `${environment.displayName} Setup`,
        webPreferences: {
          preload: environment.preloadPath,
          additionalArguments: [`--honk-window-id=${ONBOARDING_WINDOW_ID}`],
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      },
    });
    const entry: OnboardingWindowState = { window: created.window, replay };
    yield* Ref.set(onboardingWindowRef, Option.some(entry));
    created.window.on("closed", () => {
      void runPromise(
        Effect.gen(function* () {
          yield* Ref.update(onboardingWindowRef, (current) =>
            Option.isSome(current) && current.value.window === created.window
              ? Option.none()
              : current,
          );
          if (replay) {
            yield* revealExistingMain;
          }
        }),
      );
    });
    void created.ready.then(() =>
      runPromise(
        Effect.gen(function* () {
          if (!canSendToWindow(created.window)) {
            return;
          }
          yield* hideExistingMain;
          yield* electronWindow.reveal(created.window);
          if (!canSendToWindow(created.window)) {
            return;
          }
          created.window.webContents.send(IpcChannels.ONBOARDING_WINDOW_SHOWN_CHANNEL);
        }).pipe(Effect.withSpan("desktop.window.revealOnboarding")),
      ),
    );
    yield* elog.info("onboarding window created", { replay });
    return created.window;
  });

  const ensureOnboardingWindow = Effect.fn("desktop.window.ensureOnboardingWindow")(function* (
    replay: boolean,
  ): Effect.fn.Return<Electron.BrowserWindow, DesktopWindowError> {
    const existing = yield* liveOnboardingWindow;
    if (Option.isSome(existing)) {
      yield* hideExistingMain;
      yield* electronWindow.reveal(existing.value.window);
      return existing.value.window;
    }
    return yield* createOnboardingWindow(replay);
  });

  const scheduleOnboardingClose = Effect.gen(function* () {
    const existing = yield* liveOnboardingWindow;
    if (Option.isNone(existing) || scheduledOnboardingCloses.has(existing.value.window)) {
      return;
    }

    const { window: onboardingWindow, replay } = existing.value;
    scheduledOnboardingCloses.add(onboardingWindow);
    yield* Effect.sync(() => {
      setTimeout(() => {
        void runPromise(
          Effect.gen(function* () {
            const current = yield* Ref.get(onboardingWindowRef);
            if (Option.isSome(current) && current.value.window === onboardingWindow) {
              yield* Ref.set(onboardingWindowRef, Option.none());
            }
            if (!onboardingWindow.isDestroyed()) {
              onboardingWindow.destroy();
            }
            yield* revealExistingMain;
            yield* elog.info("onboarding window destroyed", {
              replay,
              remainingWindowCount: Electron.BrowserWindow.getAllWindows().length,
            });
          }).pipe(Effect.withSpan("desktop.window.closeOnboardingAfterReply")),
        );
      }, ONBOARDING_WINDOW_CLOSE_DELAY_MS);
    });
  });

  const scheduleOnboardingCloseFallback = (
    expectedWindow: Electron.BrowserWindow,
  ): Effect.Effect<void> =>
    Effect.sync(() => {
      setTimeout(() => {
        void runPromise(
          Effect.gen(function* () {
            const current = yield* liveOnboardingWindow;
            if (Option.isNone(current) || current.value.window !== expectedWindow) {
              return;
            }
            yield* elog.warn("onboarding renderer did not finish its exit; forcing window cleanup");
            yield* scheduleOnboardingClose;
          }).pipe(Effect.withSpan("desktop.window.onboardingCloseFallback")),
        );
      }, ONBOARDING_WINDOW_FINISH_FALLBACK_MS);
    });

  const waitUntilWindowReady = (window: Electron.BrowserWindow): Effect.Effect<void> =>
    Effect.promise(() => readyByWindow.get(window) ?? Promise.resolve());

  const revealOrCreateMain = Effect.gen(function* () {
    const window = yield* ensureMain;
    yield* electronWindow.reveal(window);
    return window;
  }).pipe(Effect.withSpan("desktop.window.revealOrCreateMain"));

  const createMainIfBackendReady = Effect.gen(function* () {
    const backendReady = yield* Ref.get(state.backendReady);
    if (!backendReady) return;

    const settings = yield* desktopSettings.get;
    if (!settings.hasCompletedOnboarding) {
      yield* ensureOnboardingWindow(false);
      return;
    }

    const existingWindow = yield* electronWindow.main;
    if (Option.isNone(existingWindow)) {
      yield* createMain;
    }
  }).pipe(Effect.withSpan("desktop.window.createMainIfBackendReady"));

  const completeOnboarding = Effect.gen(function* () {
    let mainWindow = yield* ensureMainForOnboardingTransition;
    yield* waitUntilWindowReady(mainWindow);
    if (mainWindow.isDestroyed()) {
      mainWindow = yield* createMainWindow(false);
      yield* waitUntilWindowReady(mainWindow);
    }
    yield* desktopSettings.completeOnboarding;
    yield* Effect.sync(() => {
      if (mainWindow.isDestroyed()) {
        return;
      }
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      }
    });
    const onboardingWindow = yield* liveOnboardingWindow;
    if (Option.isSome(onboardingWindow) && !onboardingWindow.value.window.isDestroyed()) {
      yield* Effect.sync(() => {
        onboardingWindow.value.window.moveTop();
        onboardingWindow.value.window.focus();
      });
      yield* scheduleOnboardingCloseFallback(onboardingWindow.value.window);
    }
    yield* elog.info("onboarding handoff ready");
  }).pipe(Effect.withSpan("desktop.window.completeOnboarding"));

  const finishOnboarding = Effect.gen(function* () {
    const existing = yield* liveOnboardingWindow;
    if (Option.isNone(existing)) {
      return;
    }
    const settings = yield* desktopSettings.get;
    if (!existing.value.replay && !settings.hasCompletedOnboarding) {
      return;
    }
    yield* scheduleOnboardingClose;
    yield* elog.info("onboarding completed");
  }).pipe(Effect.withSpan("desktop.window.finishOnboarding"));

  const dismissOnboarding = Effect.gen(function* () {
    const existing = yield* liveOnboardingWindow;
    if (Option.isNone(existing) || !existing.value.replay) {
      return;
    }
    yield* scheduleOnboardingClose;
  }).pipe(Effect.withSpan("desktop.window.dismissOnboarding"));

  const replayOnboarding = Effect.gen(function* () {
    if (!environment.isDevelopment) {
      return;
    }
    yield* ensureOnboardingWindow(true);
  }).pipe(Effect.withSpan("desktop.window.replayOnboarding"));

  return DesktopWindow.of({
    createMain,
    ensureMain,
    revealOrCreateMain,
    activate: Effect.gen(function* () {
      const onboardingWindow = yield* liveOnboardingWindow;
      if (Option.isSome(onboardingWindow)) {
        yield* hideExistingMain;
        yield* electronWindow.reveal(onboardingWindow.value.window);
        return;
      }
      const mainWindow = yield* electronWindow.main;
      if (Option.isSome(mainWindow)) {
        yield* electronWindow.reveal(mainWindow.value);
        return;
      }
      yield* createMainIfBackendReady;
    }).pipe(Effect.withSpan("desktop.window.activate")),
    createMainIfBackendReady,
    handleBackendReady: Effect.gen(function* () {
      yield* Ref.set(state.backendReady, true);
      yield* elog.info("backend ready", { source: "http" });
      yield* createMainIfBackendReady;
    }).pipe(Effect.withSpan("desktop.window.handleBackendReady")),
    completeOnboarding,
    finishOnboarding,
    dismissOnboarding,
    replayOnboarding,
    dispatchMenuAction: Effect.fn("desktop.window.dispatchMenuAction")(function* (action) {
      yield* Effect.annotateCurrentSpan({ action });
      const onboardingWindow = yield* liveOnboardingWindow;
      if (Option.isSome(onboardingWindow)) {
        yield* electronWindow.reveal(onboardingWindow.value.window);
        return;
      }

      const existingWindow = yield* electronWindow.main;
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
        onboardingWindows.has(window)
          ? Effect.void
          : syncWindowAppearance(window, shouldUseDarkColors),
      );
    }).pipe(Effect.withSpan("desktop.window.syncAppearance")),
  });
});

export const layer = Layer.effect(DesktopWindow, make);
