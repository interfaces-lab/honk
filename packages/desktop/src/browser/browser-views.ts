import type {
  DesktopBrowserViewCommandInput,
  DesktopBrowserViewState,
  DesktopBrowserViewSyncInput,
} from "@honk/shared/desktop-api";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { randomUUID } from "node:crypto";

import * as Electron from "electron";

import * as ElectronWindow from "../electron/electron-window";
import * as IpcChannels from "../ipc/channels";
import * as DesktopBrowserAutomation from "./browser-automation";

const PICTURE_IN_PICTURE_EXPRESSION = `(async () => {
  if (document.pictureInPictureElement) {
    await document.exitPictureInPicture();
    return false;
  }
  if (!document.pictureInPictureEnabled) {
    throw new Error("Picture in Picture is unavailable on this page.");
  }
  const videos = Array.from(document.querySelectorAll("video"));
  const video = videos.find((candidate) => !candidate.paused && candidate.readyState >= 2);
  if (!video) {
    throw new Error("Play a video before starting Picture in Picture.");
  }
  await video.requestPictureInPicture();
  return true;
})()`;

interface BrowserViewRecord {
  readonly browserId: string;
  readonly owner: Electron.BrowserWindow;
  readonly view: Electron.WebContentsView;
  readonly popups: Set<Electron.BrowserWindow>;
  surfaceId: string | null;
  workspaceKey: string;
  tabId: string;
  threadId: DesktopBrowserViewSyncInput["threadId"];
  visible: boolean;
  active: boolean;
  isLoading: boolean;
  loadError: string | null;
  canPictureInPicture: boolean;
  cleanup: () => void;
}

export class BrowserViewError extends Data.TaggedError("BrowserViewError")<{
  readonly operation: string;
  readonly cause: unknown;
}> {
  override get message() {
    return this.cause instanceof Error ? this.cause.message : String(this.cause);
  }
}

export interface DesktopBrowserViewsShape {
  readonly sync: (
    input: DesktopBrowserViewSyncInput,
  ) => Effect.Effect<DesktopBrowserViewState, BrowserViewError>;
  readonly detach: (input: {
    readonly browserId: string;
    readonly surfaceId: string;
  }) => Effect.Effect<void>;
  readonly command: (
    input: DesktopBrowserViewCommandInput,
  ) => Effect.Effect<DesktopBrowserViewState, BrowserViewError>;
  readonly destroy: (browserId: string) => Effect.Effect<void>;
}

export class DesktopBrowserViews extends Context.Service<
  DesktopBrowserViews,
  DesktopBrowserViewsShape
>()("honk/desktop/browser/Views") {}

function stateFor(record: BrowserViewRecord): DesktopBrowserViewState {
  const contents = record.view.webContents;
  const currentUrl = contents.isDestroyed() ? "" : contents.getURL();
  return {
    browserId: record.browserId,
    committedUrl: currentUrl === "about:blank" ? "" : currentUrl,
    isLoading: record.isLoading,
    loadError: record.loadError,
    canGoBack: !contents.isDestroyed() && contents.navigationHistory.canGoBack(),
    canGoForward: !contents.isDestroyed() && contents.navigationHistory.canGoForward(),
    canPictureInPicture: record.canPictureInPicture,
  };
}

function browserViewError(operation: string, cause: unknown): BrowserViewError {
  return new BrowserViewError({ operation, cause });
}

const makeDesktopBrowserViews = Effect.fn("browserViews.make")(function* () {
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const browserAutomation = yield* DesktopBrowserAutomation.DesktopBrowserAutomation;
  const records = new Map<string, BrowserViewRecord>();

  const publish = (record: BrowserViewRecord): void => {
    if (record.owner.isDestroyed() || record.owner.webContents.isDestroyed()) return;
    record.owner.webContents.send(IpcChannels.BROWSER_VIEW_STATE_CHANNEL, stateFor(record));
  };

  const register = (record: BrowserViewRecord): Effect.Effect<void> =>
    browserAutomation.register({
      webContentsId: record.view.webContents.id,
      workspaceKey: record.workspaceKey,
      browserId: record.browserId,
      tabId: record.tabId,
      threadId: record.threadId,
      active: record.active,
      visible: record.visible,
    });

  const destroy = Effect.fn("browserViews.destroy")(function* (browserId: string) {
    const record = records.get(browserId);
    if (record === undefined) return;
    records.delete(browserId);
    record.cleanup();
    record.view.setVisible(false);
    if (!record.owner.isDestroyed()) {
      record.owner.contentView.removeChildView(record.view);
    }
    for (const popup of record.popups) {
      if (!popup.isDestroyed()) popup.destroy();
    }
    record.popups.clear();
    const contents = record.view.webContents;
    const browserSession = contents.session;
    yield* browserAutomation.unregister({ webContentsId: contents.id });
    if (!contents.isDestroyed()) contents.close({ waitForBeforeUnload: false });
    yield* Effect.promise(() =>
      Promise.all([browserSession.clearStorageData(), browserSession.clearCache()]).then(
        () => undefined,
      ),
    ).pipe(Effect.ignore);
  });

  const create = Effect.fn("browserViews.create")(function* (
    owner: Electron.BrowserWindow,
    input: DesktopBrowserViewSyncInput,
  ) {
    const partition = `honk-browser:${randomUUID()}`;
    const view = yield* Effect.try({
      try: () =>
        new Electron.WebContentsView({
          webPreferences: {
            partition,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        }),
      catch: (cause) => browserViewError("create", cause),
    });
    view.setVisible(false);
    owner.contentView.addChildView(view);

    const contents = view.webContents;
    const popups = new Set<Electron.BrowserWindow>();
    const record: BrowserViewRecord = {
      browserId: input.browserId,
      owner,
      view,
      popups,
      surfaceId: null,
      workspaceKey: input.workspaceKey,
      tabId: input.tabId,
      threadId: input.threadId,
      visible: false,
      active: false,
      isLoading: false,
      loadError: null,
      canPictureInPicture: false,
      cleanup: () => undefined,
    };
    records.set(input.browserId, record);

    const onStartLoading = (): void => {
      record.isLoading = true;
      record.loadError = null;
      record.canPictureInPicture = false;
      publish(record);
    };
    const onStopLoading = (): void => {
      record.isLoading = false;
      publish(record);
    };
    const onNavigate = (): void => {
      record.loadError = null;
      publish(record);
    };
    const onNavigateInPage = (_event: Electron.Event, _url: string, isMainFrame: boolean): void => {
      if (isMainFrame) onNavigate();
    };
    const onFailLoad = (
      _event: Electron.Event,
      errorCode: number,
      errorDescription: string,
      _validatedURL: string,
      isMainFrame: boolean,
    ): void => {
      if (!isMainFrame || errorCode === -3) return;
      record.isLoading = false;
      record.loadError = errorDescription;
      publish(record);
    };
    const onMediaStarted = (): void => {
      record.canPictureInPicture = true;
      publish(record);
    };
    const onMediaPaused = (): void => {
      record.canPictureInPicture = false;
      publish(record);
    };
    const onPopup = (popup: Electron.BrowserWindow): void => {
      popups.add(popup);
      popup.once("closed", () => popups.delete(popup));
    };
    const onOwnerNavigation = (
      details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>,
    ): void => {
      if (details.isMainFrame && !details.isSameDocument) {
        Effect.runFork(destroy(record.browserId));
      }
    };
    const onOwnerReset = (): void => {
      Effect.runFork(destroy(record.browserId));
    };

    contents.setWindowOpenHandler(() => ({
      action: "allow",
      overrideBrowserWindowOptions: {
        parent: owner,
        autoHideMenuBar: true,
        webPreferences: {
          partition,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      },
    }));
    contents.on("did-start-loading", onStartLoading);
    contents.on("did-stop-loading", onStopLoading);
    contents.on("did-navigate", onNavigate);
    contents.on("did-navigate-in-page", onNavigateInPage);
    contents.on("did-fail-load", onFailLoad);
    contents.on("media-started-playing", onMediaStarted);
    contents.on("media-paused", onMediaPaused);
    contents.on("did-create-window", onPopup);
    owner.webContents.on("did-start-navigation", onOwnerNavigation);
    owner.webContents.on("render-process-gone", onOwnerReset);
    owner.once("closed", onOwnerReset);
    record.cleanup = () => {
      contents.off("did-start-loading", onStartLoading);
      contents.off("did-stop-loading", onStopLoading);
      contents.off("did-navigate", onNavigate);
      contents.off("did-navigate-in-page", onNavigateInPage);
      contents.off("did-fail-load", onFailLoad);
      contents.off("media-started-playing", onMediaStarted);
      contents.off("media-paused", onMediaPaused);
      contents.off("did-create-window", onPopup);
      owner.webContents.off("did-start-navigation", onOwnerNavigation);
      owner.webContents.off("render-process-gone", onOwnerReset);
      owner.off("closed", onOwnerReset);
    };
    return record;
  });

  const sync = Effect.fn("browserViews.sync")(function* (input: DesktopBrowserViewSyncInput) {
    let record = records.get(input.browserId);
    if (record === undefined) {
      const owner = yield* electronWindow.currentMainOrFirst;
      if (Option.isNone(owner)) {
        return yield* browserViewError("sync", new Error("No desktop window is available."));
      }
      record = yield* create(owner.value, input);
    }

    record.workspaceKey = input.workspaceKey;
    record.tabId = input.tabId;
    record.threadId = input.threadId;
    if (input.visible) {
      record.surfaceId = input.surfaceId;
      record.visible = true;
      record.active = input.active;
      const zoom = record.owner.webContents.getZoomFactor();
      record.view.setBounds({
        x: Math.round(input.bounds.x * zoom),
        y: Math.round(input.bounds.y * zoom),
        width: Math.max(0, Math.round(input.bounds.width * zoom)),
        height: Math.max(0, Math.round(input.bounds.height * zoom)),
      });
      record.view.setVisible(input.bounds.width > 0 && input.bounds.height > 0);
    } else if (record.surfaceId === input.surfaceId || record.surfaceId === null) {
      record.surfaceId = null;
      record.visible = false;
      record.active = false;
      record.view.setVisible(false);
    }
    yield* register(record);
    return stateFor(record);
  });

  const detach = Effect.fn("browserViews.detach")(function* (input: {
    readonly browserId: string;
    readonly surfaceId: string;
  }) {
    const record = records.get(input.browserId);
    if (record === undefined || record.surfaceId !== input.surfaceId) return;
    record.surfaceId = null;
    record.visible = false;
    record.active = false;
    record.view.setVisible(false);
    yield* register(record);
  });

  const command = Effect.fn("browserViews.command")(function* (
    input: DesktopBrowserViewCommandInput,
  ) {
    const record = records.get(input.browserId);
    if (record === undefined || record.view.webContents.isDestroyed()) {
      return yield* browserViewError(
        input.type,
        new Error("The browser view is no longer attached."),
      );
    }
    const contents = record.view.webContents;
    record.loadError = null;
    if (input.type === "navigate") {
      record.isLoading = true;
      record.canPictureInPicture = false;
      void contents.loadURL(input.url).catch((cause: unknown) => {
        record.isLoading = false;
        record.loadError = cause instanceof Error ? cause.message : String(cause);
        publish(record);
      });
    } else if (input.type === "back") {
      record.isLoading = true;
      contents.navigationHistory.goBack();
    } else if (input.type === "forward") {
      record.isLoading = true;
      contents.navigationHistory.goForward();
    } else if (input.type === "reload") {
      record.isLoading = true;
      contents.reload();
    } else {
      yield* Effect.tryPromise({
        try: async () => {
          const result: unknown = await contents.executeJavaScript(
            PICTURE_IN_PICTURE_EXPRESSION,
            true,
          );
          return result;
        },
        catch: (cause) => browserViewError("picture-in-picture", cause),
      });
    }
    const state = stateFor(record);
    publish(record);
    return state;
  });

  yield* Effect.addFinalizer(() => Effect.forEach([...records.keys()], destroy, { discard: true }));

  return DesktopBrowserViews.of({ sync, detach, command, destroy });
});

export const layer = Layer.effect(DesktopBrowserViews, makeDesktopBrowserViews());
