"use client";

import { IconBrowserTabs } from "central-icons";
import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { normalizePathSeparators } from "@honk/shared/paths";
import type { EnvironmentId, ThreadId } from "@honk/contracts";

import { useCopyToClipboard } from "~/hooks/use-copy-to-clipboard";
import { resolveShortcutCommand, type ShortcutEventLike } from "~/keybindings";
import { useServerKeybindings } from "~/rpc/server-state";
import {
  shellPanelsActions,
  useBrowserWorkbenchState,
  type BrowserWorkbenchState,
} from "~/stores/shell-panels-store";
import { workbenchTabPersistenceActions } from "~/stores/workbench-tab-store";
import { cn } from "~/lib/utils";
import { useRightWorkbenchPanelRuntime } from "../shell/app";
import { BrowserWorkbenchSubChrome } from "./browser-subchrome";
import { normalizeBrowserNavigationInput } from "./browser-url";
import {
  browserWebviewCapturePage,
  browserWebviewClearHistory,
  browserWebviewHardReload,
  browserWebviewOpenDevTools,
  copyBrowserScreenshotDataUrl,
} from "./browser-webview";

type BrowserWebviewNavigationEvent = Event & {
  errorCode?: number;
  errorDescription?: string;
  isMainFrame?: boolean;
  url?: string;
  validatedURL?: string;
};

type BrowserWebviewIpcMessageEvent = Event & {
  args?: unknown[];
  channel?: string;
};

const BROWSER_LOCALHOST_PORT_CANDIDATES = [
  3000, 3001, 3002, 4000, 4173, 4321, 5000, 5173, 5174, 6006, 7000, 8000, 8080, 8787, 8888,
] as const;
const BROWSER_LOCALHOST_RESCAN_INTERVAL_MS = 120_000;

interface DetectedLocalhostServer {
  port: number;
  url: string;
}

function browserWebviewPreloadPathToUrl(path: string | null): string | undefined {
  if (!path) return undefined;
  if (path.startsWith("file://")) return path;
  const normalized = normalizePathSeparators(path);
  const prefix = normalized.startsWith("/") ? "file://" : "file:///";
  return `${prefix}${normalized
    .split("/")
    .map((part, index) => (index === 0 && part.endsWith(":") ? part : encodeURIComponent(part)))
    .join("/")}`;
}

function readWebviewUrl(webview: HTMLWebViewElement, fallback: string): string {
  try {
    const url = webview.getURL();
    return url && url !== "about:blank" ? url : fallback;
  } catch {
    return fallback;
  }
}

function readWebviewTitle(webview: HTMLWebViewElement): string | undefined {
  try {
    const title = webview.getTitle?.().trim();
    return title || undefined;
  } catch {
    return undefined;
  }
}

function readWebviewNavigationState(
  webview: HTMLWebViewElement,
): Pick<BrowserWorkbenchState, "canGoBack" | "canGoForward"> {
  try {
    return {
      canGoBack: webview.canGoBack(),
      canGoForward: webview.canGoForward(),
    };
  } catch {
    return {
      canGoBack: false,
      canGoForward: false,
    };
  }
}

function readWebviewWebContentsId(webview: HTMLWebViewElement): number | null {
  try {
    return webview.getWebContentsId?.() ?? null;
  } catch {
    return null;
  }
}

function isShortcutEventLike(value: unknown): value is ShortcutEventLike {
  if (typeof value !== "object" || value === null) return false;
  return (
    typeof Reflect.get(value, "key") === "string" &&
    typeof Reflect.get(value, "metaKey") === "boolean" &&
    typeof Reflect.get(value, "ctrlKey") === "boolean" &&
    typeof Reflect.get(value, "shiftKey") === "boolean" &&
    typeof Reflect.get(value, "altKey") === "boolean"
  );
}

function useBrowserWebviewPreloadUrl(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return browserWebviewPreloadPathToUrl(
    window.desktopBridge?.getBrowserWebviewPreloadPath?.() ?? null,
  );
}

function toDetectedLocalhostServers(ports: readonly number[]): DetectedLocalhostServer[] {
  return ports
    .filter((port) => Number.isInteger(port) && port > 0 && port <= 65535)
    .map((port) => ({
      port,
      url: `http://localhost:${port}`,
    }));
}

interface BrowserPanelProps {
  workspaceKey: string;
  tabId?: string | undefined;
  browserId?: string | undefined;
  threadId?: ThreadId | null | undefined;
  environmentId?: EnvironmentId | null | undefined;
  active?: boolean | undefined;
}

export function BrowserPanel(props: BrowserPanelProps) {
  const runtime = useRightWorkbenchPanelRuntime();
  const browserActive =
    props.active ?? (runtime.open && runtime.activeTabId === (props.tabId ?? "browser"));
  const browserState = useBrowserWorkbenchState(props.workspaceKey, props.browserId);
  const keybindings = useServerKeybindings();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const webviewRef = useRef<HTMLWebViewElement | null>(null);
  const [webviewElement, setWebviewElement] = useState<HTMLWebViewElement | null>(null);
  const [detectedLocalhostServers, setDetectedLocalhostServers] = useState<
    readonly DetectedLocalhostServer[]
  >([]);
  const [localhostScanState, setLocalhostScanState] = useState<"idle" | "scanning" | "complete">(
    "idle",
  );
  const [browserAutomationAttached, setBrowserAutomationAttached] = useState(false);
  const preloadUrl = useBrowserWebviewPreloadUrl();
  const { copyToClipboard } = useCopyToClipboard();
  const browserCommittedUrl = browserState.committedUrl;
  const browserPendingUrl = browserState.pendingUrl;
  const browserIsEmpty = !browserCommittedUrl && !browserPendingUrl;
  const webviewInstanceKey = `${props.browserId ?? "default"}:${browserIsEmpty ? "empty" : "loaded"}`;

  const updateBrowserState = (patch: Partial<BrowserWorkbenchState>) => {
    shellPanelsActions.setBrowserWorkbenchState(props.workspaceKey, patch, props.browserId);
  };

  const focusLocationBar = () => {
    inputRef.current?.focus();
    inputRef.current?.select();
  };

  const matchesFocusLocationBarShortcut = (event: ShortcutEventLike) =>
    resolveShortcutCommand(event, keybindings, {
      context: {
        browserActive,
        terminalFocus: false,
      },
    }) === "browser.focusLocationBar";

  const navigateToUrl = async (url: string) => {
    updateBrowserState({
      committedUrl: url,
      inputValue: url,
      isLoading: true,
      loadError: null,
      pendingUrl: url,
    });

    const webview = webviewRef.current;
    if (!webview) {
      updateBrowserState({
        isLoading: false,
        pendingUrl: null,
      });
      return;
    }

    try {
      await webview.loadURL(url);
    } catch (error) {
      updateBrowserState({
        isLoading: false,
        loadError: error instanceof Error ? error.message : "Failed to load page.",
        pendingUrl: null,
      });
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const url = normalizeBrowserNavigationInput(browserState.inputValue);
    if (!url) return;
    void navigateToUrl(url);
  };

  useEffect(() => {
    if (!browserActive || !browserIsEmpty) return undefined;

    const detectLocalhostPorts =
      typeof window !== "undefined" ? window.desktopBridge?.detectLocalhostPorts : undefined;

    if (!detectLocalhostPorts) {
      setDetectedLocalhostServers([]);
      setLocalhostScanState("complete");
      return undefined;
    }

    let cancelled = false;
    let scanInFlight = false;
    let rescanTimeoutId: number | null = null;
    setLocalhostScanState("scanning");

    const clearScheduledScan = () => {
      if (rescanTimeoutId === null) return;
      window.clearTimeout(rescanTimeoutId);
      rescanTimeoutId = null;
    };

    const scheduleRescan = () => {
      if (cancelled || document.visibilityState === "hidden") return;
      clearScheduledScan();
      rescanTimeoutId = window.setTimeout(scan, BROWSER_LOCALHOST_RESCAN_INTERVAL_MS);
    };

    const scan = () => {
      if (scanInFlight) return;
      if (document.visibilityState === "hidden") return;
      clearScheduledScan();
      scanInFlight = true;

      void detectLocalhostPorts(BROWSER_LOCALHOST_PORT_CANDIDATES)
        .then((ports) => {
          if (cancelled) return;
          setDetectedLocalhostServers(toDetectedLocalhostServers(ports));
        })
        .catch(() => {
          if (cancelled) return;
          setDetectedLocalhostServers([]);
        })
        .finally(() => {
          scanInFlight = false;
          if (cancelled) return;
          setLocalhostScanState("complete");
          scheduleRescan();
        });
    };

    const scanVisibleWindow = () => {
      if (document.visibilityState !== "hidden") {
        scan();
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        clearScheduledScan();
        return;
      }
      scan();
    };

    scan();
    window.addEventListener("focus", scanVisibleWindow);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      clearScheduledScan();
      window.removeEventListener("focus", scanVisibleWindow);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [browserActive, browserIsEmpty]);

  const syncLoadedWebviewState = () => {
    const webview = webviewRef.current;
    if (!webview) {
      updateBrowserState({
        canGoBack: false,
        canGoForward: false,
        isLoading: false,
        pendingUrl: null,
      });
      return;
    }

    const url = readWebviewUrl(webview, browserCommittedUrl);
    if (url === "about:blank") {
      updateBrowserState({
        ...readWebviewNavigationState(webview),
        committedUrl: "",
        isLoading: false,
        loadError: null,
        pendingUrl: null,
      });
      return;
    }
    if (browserIsEmpty) return;
    updateBrowserState({
      ...readWebviewNavigationState(webview),
      committedUrl: url,
      inputValue: url,
      isLoading: false,
      loadError: null,
      pendingUrl: null,
    });
    if (props.tabId) {
      workbenchTabPersistenceActions.setBrowserTabMetadata(props.workspaceKey, props.tabId, {
        url,
        title: readWebviewTitle(webview),
      });
    }
  };

  const syncWebviewNavigationState = () => {
    const webview = webviewRef.current;
    if (!webview) return;
    updateBrowserState(readWebviewNavigationState(webview));
  };

  const handleWebviewRef = (element: HTMLElement | null) => {
    const webview = element as HTMLWebViewElement | null;
    webview?.setAttribute("allowpopups", "true");
    webviewRef.current = webview;
    setWebviewElement(webview);
  };

  useEffect(() => {
    setBrowserAutomationAttached(false);
    if (!webviewElement || !props.threadId) return undefined;
    const threadId = props.threadId;
    const register = window.desktopBridge?.registerBrowserAutomationHost;
    const unregister = window.desktopBridge?.unregisterBrowserAutomationHost;
    if (!register || !unregister) return undefined;

    let disposed = false;
    let registeredWebContentsId: number | null = null;

    const registerWebview = () => {
      if (disposed) return;
      const webContentsId = readWebviewWebContentsId(webviewElement);
      if (!webContentsId) return;

      if (registeredWebContentsId !== null && registeredWebContentsId !== webContentsId) {
        void unregister({ webContentsId: registeredWebContentsId });
      }
      registeredWebContentsId = webContentsId;

      void register({
        webContentsId,
        workspaceKey: props.workspaceKey,
        browserId: props.browserId ?? "default",
        tabId: props.tabId ?? "browser",
        threadId,
        ...(props.environmentId ? { environmentId: props.environmentId } : {}),
        active: browserActive,
        visible: browserActive,
      }).then(() => {
        if (!disposed) setBrowserAutomationAttached(true);
      });
    };

    const retryTimeoutId = window.setTimeout(registerWebview, 0);
    webviewElement.addEventListener("dom-ready", registerWebview);
    webviewElement.addEventListener("did-attach", registerWebview);
    registerWebview();

    return () => {
      disposed = true;
      window.clearTimeout(retryTimeoutId);
      webviewElement.removeEventListener("dom-ready", registerWebview);
      webviewElement.removeEventListener("did-attach", registerWebview);
      setBrowserAutomationAttached(false);
      if (registeredWebContentsId !== null) {
        void unregister({ webContentsId: registeredWebContentsId });
      }
    };
  }, [
    browserActive,
    props.browserId,
    props.environmentId,
    props.tabId,
    props.threadId,
    props.workspaceKey,
    webviewElement,
  ]);

  useEffect(() => {
    if (!browserActive) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!matchesFocusLocationBarShortcut(event)) return;
      event.preventDefault();
      event.stopPropagation();
      focusLocationBar();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [browserActive, focusLocationBar, matchesFocusLocationBarShortcut]);

  useEffect(() => {
    if (!webviewElement) return undefined;

    const handleStartLoading = () => {
      updateBrowserState({
        isLoading: true,
        loadError: null,
      });
    };
    const handleStopLoading = () => {
      updateBrowserState({
        ...readWebviewNavigationState(webviewElement),
        isLoading: false,
        pendingUrl: null,
      });
    };
    const handleFinishLoad = () => syncLoadedWebviewState();
    const handleNavigate = (event: Event) => {
      const navigationEvent = event as BrowserWebviewNavigationEvent;
      if (navigationEvent.url === "about:blank" || !navigationEvent.url) {
        if (browserIsEmpty) {
          updateBrowserState({
            ...readWebviewNavigationState(webviewElement),
            committedUrl: "",
            isLoading: false,
            pendingUrl: null,
          });
        }
        return;
      }
      if (browserIsEmpty) return;
      updateBrowserState({
        ...readWebviewNavigationState(webviewElement),
        committedUrl: navigationEvent.url,
        inputValue: navigationEvent.url,
        loadError: null,
      });
      if (props.tabId) {
        workbenchTabPersistenceActions.setBrowserTabMetadata(props.workspaceKey, props.tabId, {
          url: navigationEvent.url,
        });
      }
    };
    const handleFailLoad = (event: Event) => {
      const failEvent = event as BrowserWebviewNavigationEvent;
      if (failEvent.isMainFrame === false) return;
      if (failEvent.errorCode === -3) return;
      const failedUrl =
        failEvent.validatedURL && failEvent.validatedURL !== "about:blank"
          ? failEvent.validatedURL
          : browserPendingUrl || browserCommittedUrl;
      updateBrowserState({
        ...(failedUrl ? { committedUrl: failedUrl, inputValue: failedUrl } : {}),
        isLoading: false,
        loadError: failEvent.errorDescription || "Failed to load page.",
        pendingUrl: null,
      });
    };
    const handleIpcMessage = (event: Event) => {
      const ipcEvent = event as BrowserWebviewIpcMessageEvent;
      if (ipcEvent.channel !== "browser-keydown") return;
      const keyboardEvent = ipcEvent.args?.[0];
      if (!isShortcutEventLike(keyboardEvent)) return;
      if (!matchesFocusLocationBarShortcut(keyboardEvent)) return;
      focusLocationBar();
    };

    webviewElement.addEventListener("did-start-loading", handleStartLoading);
    webviewElement.addEventListener("did-stop-loading", handleStopLoading);
    webviewElement.addEventListener("did-finish-load", handleFinishLoad);
    webviewElement.addEventListener("did-navigate", handleNavigate);
    webviewElement.addEventListener("did-navigate-in-page", handleNavigate);
    webviewElement.addEventListener("did-fail-load", handleFailLoad);
    webviewElement.addEventListener("ipc-message", handleIpcMessage);

    return () => {
      webviewElement.removeEventListener("did-start-loading", handleStartLoading);
      webviewElement.removeEventListener("did-stop-loading", handleStopLoading);
      webviewElement.removeEventListener("did-finish-load", handleFinishLoad);
      webviewElement.removeEventListener("did-navigate", handleNavigate);
      webviewElement.removeEventListener("did-navigate-in-page", handleNavigate);
      webviewElement.removeEventListener("did-fail-load", handleFailLoad);
      webviewElement.removeEventListener("ipc-message", handleIpcMessage);
    };
  }, [
    browserCommittedUrl,
    browserIsEmpty,
    browserPendingUrl,
    focusLocationBar,
    matchesFocusLocationBarShortcut,
    props.tabId,
    props.workspaceKey,
    syncLoadedWebviewState,
    updateBrowserState,
    webviewElement,
  ]);

  const goBack = () => {
    const webview = webviewRef.current;
    if (!webview || !browserState.canGoBack) return;
    webview.goBack();
    syncWebviewNavigationState();
    window.setTimeout(syncWebviewNavigationState, 120);
  };

  const goForward = () => {
    const webview = webviewRef.current;
    if (!webview || !browserState.canGoForward) return;
    webview.goForward();
    syncWebviewNavigationState();
    window.setTimeout(syncWebviewNavigationState, 120);
  };

  const reload = () => {
    const targetUrl = browserState.committedUrl;
    if (!targetUrl) return;
    updateBrowserState({
      isLoading: true,
      loadError: null,
    });

    const webview = webviewRef.current;
    if (!webview) {
      void navigateToUrl(targetUrl);
      return;
    }
    webview.reload();
  };

  const hardReload = () => {
    const targetUrl = browserState.committedUrl;
    if (!targetUrl) return;
    updateBrowserState({
      isLoading: true,
      loadError: null,
    });

    const webview = webviewRef.current;
    if (!webview) {
      void navigateToUrl(targetUrl);
      return;
    }
    browserWebviewHardReload(webview);
  };

  const openDevTools = () => {
    const webview = webviewRef.current;
    if (!webview) return;
    browserWebviewOpenDevTools(webview);
  };

  const copyCurrentUrl = () => {
    const url = browserState.committedUrl;
    if (!url) return;
    copyToClipboard(url, undefined);
  };

  const takeScreenshot = () => {
    const webview = webviewRef.current;
    if (!webview) return;
    void browserWebviewCapturePage(webview).then((dataUrl) => {
      if (!dataUrl) return;
      void copyBrowserScreenshotDataUrl(dataUrl);
    });
  };

  const clearBrowserPartitionStorage = async (
    storages: readonly (
      | "cachestorage"
      | "cookies"
      | "filesystem"
      | "indexdb"
      | "localstorage"
      | "serviceworkers"
      | "shadercache"
      | "websql"
    )[],
  ) => {
    const clearStorage = window.desktopBridge?.clearBrowserPartitionStorage;
    if (!clearStorage) return;
    await clearStorage({ storages });
  };

  const clearBrowsingHistory = () => {
    const webview = webviewRef.current;
    if (webview) {
      browserWebviewClearHistory(webview);
    }
    updateBrowserState({
      canGoBack: false,
      canGoForward: false,
    });
  };

  const clearCookies = () => {
    void clearBrowserPartitionStorage(["cookies"]);
  };

  const clearCache = () => {
    void clearBrowserPartitionStorage([
      "cachestorage",
      "filesystem",
      "shadercache",
      "serviceworkers",
    ]);
  };

  const locationPlaceholder = detectedLocalhostServers[0]?.url ?? "Search or enter URL";

  return (
    <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden">
      <BrowserWorkbenchSubChrome
        canGoBack={browserState.canGoBack}
        canGoForward={browserState.canGoForward}
        committedUrl={browserState.committedUrl}
        inputRef={inputRef}
        inputValue={browserState.inputValue}
        isLoading={browserState.isLoading}
        locationPlaceholder={locationPlaceholder}
        onBack={goBack}
        onClearBrowsingHistory={clearBrowsingHistory}
        onClearCache={clearCache}
        onClearCookies={clearCookies}
        onCopyUrl={copyCurrentUrl}
        onForward={goForward}
        onHardReload={hardReload}
        onInputChange={(value) => updateBrowserState({ inputValue: value })}
        onOpenDevTools={openDevTools}
        onReload={reload}
        onSubmit={handleSubmit}
        onTakeScreenshot={takeScreenshot}
      />

      {browserState.loadError ? (
        <div className="shrink-0 border-b border-honk-stroke-tertiary px-3 py-1.5 text-honk-chrome text-honk-fg-red-primary">
          {browserState.loadError}
        </div>
      ) : null}

      <div className="honk-shell-workbench-preview relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <webview
          key={webviewInstanceKey}
          ref={handleWebviewRef}
          className={cn(
            "min-h-0 min-w-0 flex-1 bg-(--honk-workbench-editor-surface-background)",
            !browserState.committedUrl && "pointer-events-none opacity-0",
          )}
          partition="persist:honk-browser"
          preload={preloadUrl}
          src={browserCommittedUrl || "about:blank"}
          webpreferences="contextIsolation=yes, nodeIntegration=no, sandbox=yes"
        />

        {browserAutomationAttached && browserState.committedUrl ? (
          <div className="pointer-events-none absolute top-2 right-2 z-10 rounded-honk-control border border-honk-stroke-tertiary bg-honk-bg-quinary px-2 py-1 text-honk-caption font-medium text-honk-fg-secondary shadow-honk-flat-ring">
            Agent connected
          </div>
        ) : null}

        {!browserState.committedUrl ? (
          <div className="pointer-events-auto absolute inset-0 z-10 flex min-h-0 min-w-0 flex-col items-center justify-center px-4 py-8 text-center text-honk-fg-primary">
            <div className="flex w-full max-w-xs flex-col items-center gap-4">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-honk-control border border-honk-stroke-tertiary bg-honk-bg-quinary text-honk-icon-primary shadow-honk-flat-ring">
                <IconBrowserTabs className="size-6 shrink-0" aria-hidden />
              </div>
              <div className="flex max-w-2xs flex-col items-center gap-1">
                <div className="text-honk-chrome font-medium text-honk-fg-primary">
                  Open a local preview
                </div>
                <div className="text-honk-chrome text-honk-fg-secondary">
                  Enter a URL or choose a detected localhost server.
                </div>
              </div>

              <div className="flex w-full flex-col gap-1.5">
                {detectedLocalhostServers.length > 0 ? (
                  <>
                    <div className="px-1 text-left text-honk-tab font-medium text-honk-fg-tertiary">
                      Detected localhost
                    </div>
                    {detectedLocalhostServers.map((server) => (
                      <button
                        key={server.port}
                        type="button"
                        className="no-drag flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-honk-control border border-honk-stroke-tertiary bg-honk-bg-quinary px-2 text-left text-honk-chrome text-honk-fg-primary shadow-honk-flat-ring outline-hidden transition-colors hover:border-honk-stroke-secondary hover:bg-honk-bg-tertiary focus-visible:ring-1 focus-visible:ring-honk-stroke-focused focus-visible:ring-inset"
                        onClick={() => void navigateToUrl(server.url)}
                      >
                        <span className="min-w-0 truncate font-honk-mono">{server.url}</span>
                        <span className="shrink-0 text-honk-fg-secondary">Open</span>
                      </button>
                    ))}
                  </>
                ) : (
                  <div className="rounded-honk-control border border-honk-stroke-tertiary bg-honk-bg-tertiary px-2.5 py-2 text-honk-chrome text-honk-fg-secondary">
                    {localhostScanState === "scanning"
                      ? "Looking for localhost servers..."
                      : "No localhost server detected."}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
