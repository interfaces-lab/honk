"use client";

import {
  IconArrowLeft,
  IconArrowRight,
  IconArrowRotateClockwise,
  IconBrowserTabs,
  IconGlobe,
} from "central-icons";
import type { FormEvent, MouseEventHandler, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizePathSeparators } from "@honk/shared/paths";

import { WorkbenchIconButton } from "@honk/honkkit/workbench-button";
import {
  WorkbenchChromeActionGroup,
  WorkbenchChromeRow,
} from "@honk/honkkit/workbench-chrome-row";

import { resolveShortcutCommand, type ShortcutEventLike } from "~/keybindings";
import { useServerKeybindings } from "~/rpc/server-state";
import {
  shellPanelsActions,
  useBrowserWorkbenchState,
  type BrowserWorkbenchState,
} from "~/stores/shell-panels-store";
import { cn } from "~/lib/utils";
import { useRightWorkbenchPanelRuntime } from "../shell/app";
import { WorkbenchPanel } from "../shell/workbench-panel";
import { normalizeBrowserNavigationInput } from "./browser-url";

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
  3000,
  3001,
  3002,
  4000,
  4173,
  4321,
  5000,
  5173,
  5174,
  6006,
  7000,
  8000,
  8080,
  8787,
  8888,
] as const;

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
  return useMemo(() => {
    if (typeof window === "undefined") return undefined;
    return browserWebviewPreloadPathToUrl(
      window.desktopBridge?.getBrowserWebviewPreloadPath?.() ?? null,
    );
  }, []);
}

function toDetectedLocalhostServers(ports: readonly number[]): DetectedLocalhostServer[] {
  return ports
    .filter((port) => Number.isInteger(port) && port > 0 && port <= 65535)
    .map((port) => ({
      port,
      url: `http://localhost:${port}`,
    }));
}

function BrowserToolbarIconButton(props: {
  "aria-label": string;
  children: ReactNode;
  className?: string | undefined;
  disabled?: boolean | undefined;
  onClick?: MouseEventHandler<HTMLButtonElement> | undefined;
}) {
  return (
    <WorkbenchIconButton
      aria-label={props["aria-label"]}
      chrome="panel"
      className={cn(
        "border border-honk-workbench-panel-border-muted bg-honk-bg-quinary text-honk-icon-primary shadow-xs hover:border-honk-stroke-secondary hover:bg-honk-bg-tertiary disabled:border-transparent disabled:bg-transparent disabled:text-honk-fg-quaternary/45 disabled:hover:border-transparent disabled:hover:bg-transparent",
        props.className,
      )}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </WorkbenchIconButton>
  );
}

export function BrowserWorkbenchPanel(props: { workspaceKey: string }) {
  const runtime = useRightWorkbenchPanelRuntime();
  const browserActive = runtime.open && runtime.activeTab === "browser";
  const browserState = useBrowserWorkbenchState(props.workspaceKey);
  const keybindings = useServerKeybindings();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const webviewRef = useRef<HTMLWebViewElement | null>(null);
  const initialWebviewSrcRef = useRef(browserState.committedUrl || "about:blank");
  const [webviewElement, setWebviewElement] = useState<HTMLWebViewElement | null>(null);
  const [detectedLocalhostServers, setDetectedLocalhostServers] = useState<
    readonly DetectedLocalhostServer[]
  >([]);
  const [localhostScanState, setLocalhostScanState] = useState<"idle" | "scanning" | "complete">(
    "idle",
  );
  const preloadUrl = useBrowserWebviewPreloadUrl();

  const updateBrowserState = useCallback(
    (patch: Partial<BrowserWorkbenchState>) => {
      shellPanelsActions.setBrowserWorkbenchState(props.workspaceKey, patch);
    },
    [props.workspaceKey],
  );

  const focusLocationBar = useCallback(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const matchesFocusLocationBarShortcut = useCallback(
    (event: ShortcutEventLike) =>
      resolveShortcutCommand(event, keybindings, {
        context: {
          browserActive,
          terminalFocus: false,
        },
      }) === "browser.focusLocationBar",
    [browserActive, keybindings],
  );

  const navigateToUrl = useCallback(
    async (url: string) => {
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
    },
    [updateBrowserState],
  );

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const url = normalizeBrowserNavigationInput(browserState.inputValue);
    if (!url) return;
    void navigateToUrl(url);
  };

  useEffect(() => {
    if (!browserActive || browserState.committedUrl) return undefined;

    const detectLocalhostPorts =
      typeof window !== "undefined" ? window.desktopBridge?.detectLocalhostPorts : undefined;

    if (!detectLocalhostPorts) {
      setDetectedLocalhostServers([]);
      setLocalhostScanState("complete");
      return undefined;
    }

    let cancelled = false;
    let scanInFlight = false;
    setLocalhostScanState("scanning");

    const scan = () => {
      if (scanInFlight) return;
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
        });
    };

    scan();
    const intervalId = window.setInterval(scan, 5_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [browserActive, browserState.committedUrl]);

  const syncLoadedWebviewState = useCallback(() => {
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

    const url = readWebviewUrl(webview, browserState.committedUrl);
    updateBrowserState({
      ...readWebviewNavigationState(webview),
      committedUrl: url,
      inputValue: url,
      isLoading: false,
      loadError: null,
      pendingUrl: null,
    });
  }, [browserState.committedUrl, updateBrowserState]);

  const syncWebviewNavigationState = useCallback(() => {
    const webview = webviewRef.current;
    if (!webview) return;
    updateBrowserState(readWebviewNavigationState(webview));
  }, [updateBrowserState]);

  const handleWebviewRef = useCallback((element: HTMLElement | null) => {
    const webview = element as HTMLWebViewElement | null;
    webviewRef.current = webview;
    setWebviewElement(webview);
  }, []);

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
      if (navigationEvent.url === "about:blank" || !navigationEvent.url) return;
      updateBrowserState({
        ...readWebviewNavigationState(webviewElement),
        committedUrl: navigationEvent.url,
        inputValue: navigationEvent.url,
        loadError: null,
      });
    };
    const handleFailLoad = (event: Event) => {
      const failEvent = event as BrowserWebviewNavigationEvent;
      if (failEvent.isMainFrame === false) return;
      if (failEvent.errorCode === -3) return;
      const failedUrl =
        failEvent.validatedURL && failEvent.validatedURL !== "about:blank"
          ? failEvent.validatedURL
          : browserState.pendingUrl || browserState.committedUrl;
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
    browserState.committedUrl,
    browserState.pendingUrl,
    focusLocationBar,
    matchesFocusLocationBarShortcut,
    syncLoadedWebviewState,
    updateBrowserState,
    webviewElement,
  ]);

  const goBack = useCallback(() => {
    const webview = webviewRef.current;
    if (!webview || !browserState.canGoBack) return;
    webview.goBack();
    syncWebviewNavigationState();
    window.setTimeout(syncWebviewNavigationState, 120);
  }, [browserState.canGoBack, syncWebviewNavigationState]);

  const goForward = useCallback(() => {
    const webview = webviewRef.current;
    if (!webview || !browserState.canGoForward) return;
    webview.goForward();
    syncWebviewNavigationState();
    window.setTimeout(syncWebviewNavigationState, 120);
  }, [browserState.canGoForward, syncWebviewNavigationState]);

  const reload = useCallback(() => {
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
  }, [browserState.committedUrl, navigateToUrl, updateBrowserState]);

  const reloadIcon = (
    <IconArrowRotateClockwise
      className={cn("size-4 shrink-0", browserState.isLoading && "opacity-0")}
      aria-hidden
    />
  );

  const reloadSpinner = browserState.isLoading ? (
    <span
      className="pointer-events-none absolute inset-0 flex items-center justify-center"
      aria-hidden
    >
      <span className="size-3.5 animate-spin rounded-full border border-honk-stroke-tertiary border-t-honk-icon-primary" />
    </span>
  ) : null;

  return (
    <WorkbenchPanel className="bg-honk-bg-secondary">
      <WorkbenchChromeRow variant="panel">
        <WorkbenchChromeActionGroup>
          <BrowserToolbarIconButton
            aria-label="Back"
            disabled={!browserState.canGoBack}
            onClick={goBack}
          >
            <IconArrowLeft className="size-4 shrink-0" aria-hidden />
          </BrowserToolbarIconButton>
          <BrowserToolbarIconButton
            aria-label="Forward"
            disabled={!browserState.canGoForward}
            onClick={goForward}
          >
            <IconArrowRight className="size-4 shrink-0" aria-hidden />
          </BrowserToolbarIconButton>
          <div
            className="relative flex size-(--honk-workbench-action-size) shrink-0 items-center justify-center"
            data-loading={browserState.isLoading ? "true" : undefined}
          >
            <BrowserToolbarIconButton
              aria-label="Reload"
              disabled={!browserState.committedUrl}
              onClick={reload}
            >
              {reloadIcon}
            </BrowserToolbarIconButton>
            {reloadSpinner}
          </div>
        </WorkbenchChromeActionGroup>

        <form
          className="no-drag flex h-(--honk-workbench-action-size) min-w-0 flex-1 items-center gap-(--honk-workbench-text-control-gap) rounded-honk-control border border-honk-workbench-panel-border-muted bg-honk-bg-quinary px-(--honk-workbench-text-control-padding-inline) text-body text-honk-fg-primary focus-within:border-honk-stroke-focused focus-within:ring-1 focus-within:ring-honk-stroke-focused focus-within:ring-inset"
          onSubmit={handleSubmit}
        >
          <IconGlobe className="size-4 shrink-0 text-honk-icon-primary" aria-hidden />
          <input
            ref={inputRef}
            aria-label="Browser location"
            className="min-w-0 flex-1 bg-transparent p-0 text-body text-honk-fg-primary outline-hidden placeholder:text-honk-fg-quaternary"
            onChange={(event) => updateBrowserState({ inputValue: event.currentTarget.value })}
            placeholder={detectedLocalhostServers[0]?.url ?? "Search or enter URL"}
            spellCheck={false}
            value={browserState.inputValue}
          />
        </form>
      </WorkbenchChromeRow>

      <div
        className={cn(
          "h-0.5 shrink-0 transition-colors",
          browserState.isLoading ? "bg-honk-icon-accent-primary" : "bg-transparent",
        )}
      />

      {browserState.loadError ? (
        <div className="shrink-0 border-b border-honk-workbench-panel-border-muted px-3 py-1.5 text-detail text-honk-fg-red-primary">
          {browserState.loadError}
        </div>
      ) : null}

      <div className="relative flex min-h-0 min-w-0 flex-1 bg-honk-bg-secondary">
        <webview
          ref={handleWebviewRef}
          allowpopups
          className={cn(
            "min-h-0 min-w-0 flex-1 bg-(--honk-bg-primary)",
            !browserState.committedUrl && "pointer-events-none opacity-0",
          )}
          partition="persist:honk-browser"
          preload={preloadUrl}
          src={initialWebviewSrcRef.current}
          webpreferences="contextIsolation=yes, nodeIntegration=no, sandbox=yes"
        />

        {!browserState.committedUrl ? (
          <div className="pointer-events-auto absolute inset-0 z-10 flex min-h-0 min-w-0 flex-col items-center justify-center px-4 py-8 text-center text-honk-fg-primary">
            <div className="flex w-full max-w-xs flex-col items-center gap-4">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-honk-control border border-honk-stroke-tertiary bg-honk-bg-quinary text-honk-icon-primary shadow-xs">
                <IconBrowserTabs className="size-6 shrink-0" aria-hidden />
              </div>
              <div className="flex max-w-2xs flex-col items-center gap-1">
                <div className="text-body font-medium text-honk-fg-primary">
                  Open a local preview
                </div>
                <div className="text-detail text-honk-fg-secondary">
                  Enter a URL or choose a detected localhost server.
                </div>
              </div>

              <div className="flex w-full flex-col gap-1.5">
                {detectedLocalhostServers.length > 0 ? (
                  <>
                    <div className="px-1 text-left text-caption font-medium text-honk-fg-tertiary">
                      Detected localhost
                    </div>
                    {detectedLocalhostServers.map((server) => (
                      <button
                        key={server.port}
                        type="button"
                        className="no-drag flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-honk-control border border-honk-stroke-tertiary bg-honk-bg-quinary px-2 text-left text-detail text-honk-fg-primary shadow-xs outline-hidden transition-colors hover:border-honk-stroke-secondary hover:bg-honk-bg-tertiary focus-visible:ring-1 focus-visible:ring-honk-stroke-focused focus-visible:ring-inset"
                        onClick={() => void navigateToUrl(server.url)}
                      >
                        <span className="min-w-0 truncate font-honk-mono">{server.url}</span>
                        <span className="shrink-0 text-honk-fg-secondary">Open</span>
                      </button>
                    ))}
                  </>
                ) : (
                  <div className="rounded-honk-control border border-honk-workbench-panel-border-muted bg-honk-bg-tertiary px-2.5 py-2 text-detail text-honk-fg-secondary">
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
    </WorkbenchPanel>
  );
}
