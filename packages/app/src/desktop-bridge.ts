// Electron preload seam. No-op in the Vite web build. Await installDesktopBridge()
// before startConnection(). The sidecar {url, password} arrive over GET_OPENCODE_SIDECAR
// once the supervisor reports healthy.

import type { BrowserAutomationOpenRequest } from "@honk/shared/browser-automation";
import type {
  DesktopBrowserViewCommandInput,
  DesktopBrowserViewDetachInput,
  DesktopBrowserViewDestroyInput,
  DesktopBrowserViewState,
  DesktopBrowserViewSyncInput,
  DesktopPtyBridge,
  DesktopRemoteHostState,
  DesktopRemotePairingLink,
  DesktopServerExposureMode,
  DesktopServerExposureState,
} from "@honk/shared/desktop-api";

import {
  setBootstrapCredentialProvider,
  setBootstrapOriginProvider,
  type BootstrapCredential,
} from "./connection-store";

type DesktopOpencodeSidecarEndpoint = {
  readonly status: "idle" | "starting" | "ready" | "restarting" | "stopped" | "error";
  readonly url: string | null;
  readonly password: string | null;
};

type DesktopWindowChromeState = {
  readonly fullscreen: boolean;
};

export type { DesktopPtyBridge } from "@honk/shared/desktop-api";

type DesktopBridgeSurface = {
  readonly getWindowID: () => string;
  readonly getWindowChromeState: () => DesktopWindowChromeState;
  readonly onWindowChromeState: (listener: (state: DesktopWindowChromeState) => void) => () => void;
  readonly getOpencodeSidecar: () => Promise<DesktopOpencodeSidecarEndpoint>;
  readonly protectRemoteCredential?: (credential: string) => Promise<string>;
  readonly revealRemoteCredential?: (protectedCredential: string) => Promise<string>;
  readonly getServerExposureState?: () => Promise<DesktopServerExposureState>;
  readonly setServerExposureMode?: (
    mode: DesktopServerExposureMode,
  ) => Promise<DesktopServerExposureState>;
  readonly setServerExposurePublicUrl?: (
    publicUrl: string | null,
  ) => Promise<DesktopServerExposureState>;
  readonly getRemoteHostState?: () => Promise<DesktopRemoteHostState>;
  readonly issueRemotePairing?: (label: string | null) => Promise<DesktopRemotePairingLink>;
  readonly revokeRemoteDevice?: (deviceID: string) => Promise<DesktopRemoteHostState>;
  // Optional. Absent on web and older preloads. null means cancel.
  readonly pickFolder?: (options?: {
    readonly initialPath?: string | null;
  }) => Promise<string | null>;
  readonly openExternal?: (url: string) => Promise<boolean>;
  readonly completeOnboarding: () => Promise<void>;
  readonly finishOnboarding: () => Promise<void>;
  readonly dismissOnboarding: () => Promise<void>;
  readonly replayOnboarding: () => Promise<void>;
  readonly onOnboardingWindowShown: (listener: () => void) => () => void;
  readonly setTheme?: (theme: "system" | "light" | "dark") => Promise<void>;
  readonly syncBrowserView: (
    input: DesktopBrowserViewSyncInput,
  ) => Promise<DesktopBrowserViewState>;
  readonly detachBrowserView: (input: DesktopBrowserViewDetachInput) => Promise<void>;
  readonly commandBrowserView: (
    input: DesktopBrowserViewCommandInput,
  ) => Promise<DesktopBrowserViewState>;
  readonly destroyBrowserView: (input: DesktopBrowserViewDestroyInput) => Promise<void>;
  readonly onBrowserViewState: (listener: (state: DesktopBrowserViewState) => void) => () => void;
  readonly onBrowserAutomationOpen: (
    listener: (input: BrowserAutomationOpenRequest) => void,
  ) => () => void;
  readonly getUpdateState?: () => Promise<unknown>;
  readonly downloadUpdate?: () => Promise<unknown>;
  readonly installUpdate?: () => Promise<unknown>;
  readonly onUpdateState?: (listener: (state: unknown) => void) => () => void;
  // Optional. Absent on web and older preloads.
  readonly pty?: DesktopPtyBridge;
};

declare global {
  interface Window {
    readonly desktopBridge?: DesktopBridgeSurface;
  }
}

// Ceiling for sidecar process or configuration failures.
const SIDECAR_WAIT_CEILING_MS = 120_000;
const SIDECAR_POLL_INTERVAL_MS = 300;

// Written once by install. null means unresolved (web build or sidecar error).
let sidecarEndpoint: { readonly url: string; readonly password: string | null } | null = null;
let onboardingWindowShown = false;
const onboardingWindowShownListeners = new Set<() => void>();

function readDesktopBridge(): DesktopBridgeSurface | null {
  const bridge = window.desktopBridge;
  if (bridge === undefined) {
    return null;
  }
  return bridge;
}

export type DesktopBrowserBridge = Pick<
  DesktopBridgeSurface,
  | "syncBrowserView"
  | "detachBrowserView"
  | "commandBrowserView"
  | "destroyBrowserView"
  | "onBrowserViewState"
  | "onBrowserAutomationOpen"
>;

export type DesktopBrowserAvailability =
  | { readonly status: "web" }
  | { readonly status: "restart-required" }
  | { readonly status: "ready"; readonly bridge: DesktopBrowserBridge };

export function readDesktopBrowserAvailability(): DesktopBrowserAvailability {
  const bridge = readDesktopBridge();
  if (bridge === null) return { status: "web" };
  if (
    typeof bridge.syncBrowserView !== "function" ||
    typeof bridge.detachBrowserView !== "function" ||
    typeof bridge.commandBrowserView !== "function" ||
    typeof bridge.destroyBrowserView !== "function" ||
    typeof bridge.onBrowserViewState !== "function" ||
    typeof bridge.onBrowserAutomationOpen !== "function"
  ) {
    return { status: "restart-required" };
  }
  return { status: "ready", bridge };
}

export function readShellWindowID(): string {
  const windowID = readDesktopBridge()?.getWindowID().trim() ?? "";
  return windowID.length > 0 ? windowID : "browser";
}

export function shouldUseDesktopGlass(): boolean {
  return readDesktopBridge() !== null && /^Mac/.test(navigator.platform);
}

function readBootstrapCredential(): BootstrapCredential | null {
  if (sidecarEndpoint !== null) {
    return sidecarEndpoint.password === null
      ? null
      : { kind: "bearer", credential: sidecarEndpoint.password };
  }
  return null;
}

function readBootstrapOrigin(): string | null {
  if (sidecarEndpoint !== null) {
    return sidecarEndpoint.url;
  }
  return null;
}

// Poll until ready, error, stopped, or the ceiling. Leaving null lets connection-store
// report unreachable. Retry re-reads the providers and can pick up a later recovery.
async function waitForSidecarEndpoint(bridge: DesktopBridgeSurface): Promise<void> {
  const getSidecar = bridge.getOpencodeSidecar;
  const deadline = Date.now() + SIDECAR_WAIT_CEILING_MS;
  while (Date.now() < deadline) {
    let snapshot: DesktopOpencodeSidecarEndpoint;
    try {
      snapshot = await getSidecar();
    } catch {
      return;
    }
    if (snapshot.status === "ready" && snapshot.url !== null && snapshot.url.length > 0) {
      sidecarEndpoint = { url: snapshot.url, password: snapshot.password };
      return;
    }
    if (snapshot.status === "error" || snapshot.status === "stopped") {
      return;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, SIDECAR_POLL_INTERVAL_MS));
  }
}

// null means cancel or no picker. Callers treat both the same.
export function canPickFolder(): boolean {
  return window.desktopBridge?.pickFolder !== undefined;
}

export async function pickFolder(initialPath?: string | null): Promise<string | null> {
  const picker = window.desktopBridge?.pickFolder;
  if (picker === undefined) {
    return null;
  }
  try {
    return await picker({ initialPath: initialPath ?? null });
  } catch {
    return null;
  }
}

export type DesktopOnboardingWindowContext = {
  readonly replay: boolean;
};

export function readDesktopOnboardingWindowContext(): DesktopOnboardingWindowContext | null {
  if (readDesktopBridge() === null) {
    return null;
  }
  const search = new URLSearchParams(window.location.search);
  if (search.get("window") !== "onboarding") {
    return null;
  }
  return { replay: search.get("replay") === "1" };
}

export function canReplayDesktopOnboarding(): boolean {
  return import.meta.env.DEV && readDesktopBridge() !== null;
}

export async function completeDesktopOnboarding(): Promise<void> {
  const bridge = readDesktopBridge();
  if (bridge === null) {
    throw new Error("Desktop onboarding requires the Electron bridge.");
  }
  await bridge.completeOnboarding();
}

export async function finishDesktopOnboarding(): Promise<void> {
  const bridge = readDesktopBridge();
  if (bridge === null) {
    throw new Error("Desktop onboarding requires the Electron bridge.");
  }
  await bridge.finishOnboarding();
}

export async function dismissDesktopOnboarding(): Promise<void> {
  const bridge = readDesktopBridge();
  if (bridge === null) {
    return;
  }
  await bridge.dismissOnboarding();
}

export async function replayDesktopOnboarding(): Promise<void> {
  const bridge = readDesktopBridge();
  if (bridge === null || !import.meta.env.DEV) {
    return;
  }
  await bridge.replayOnboarding();
}

export function subscribeOnboardingWindowShown(listener: () => void): () => void {
  onboardingWindowShownListeners.add(listener);
  return () => {
    onboardingWindowShownListeners.delete(listener);
  };
}

export function getOnboardingWindowShownSnapshot(): boolean {
  return onboardingWindowShown;
}

function markOnboardingWindowShown(): void {
  if (onboardingWindowShown) {
    return;
  }
  onboardingWindowShown = true;
  for (const listener of onboardingWindowShownListeners) {
    listener();
  }
}

/** PTY bridge, or null off-desktop. */
export function getPtyBridge(): DesktopPtyBridge | null {
  return window.desktopBridge?.pty ?? null;
}

export function canPersistRemoteCredential(): boolean {
  const bridge = readDesktopBridge();
  return (
    bridge?.protectRemoteCredential !== undefined && bridge.revealRemoteCredential !== undefined
  );
}

export function canManageDesktopRemoteHost(): boolean {
  const bridge = readDesktopBridge();
  return (
    bridge?.getServerExposureState !== undefined &&
    bridge.setServerExposureMode !== undefined &&
    bridge.setServerExposurePublicUrl !== undefined &&
    bridge.getRemoteHostState !== undefined &&
    bridge.issueRemotePairing !== undefined &&
    bridge.revokeRemoteDevice !== undefined
  );
}

export async function protectRemoteCredential(credential: string): Promise<string | null> {
  const protect = readDesktopBridge()?.protectRemoteCredential;
  return protect === undefined ? null : protect(credential);
}

export async function revealRemoteCredential(protectedCredential: string): Promise<string | null> {
  const reveal = readDesktopBridge()?.revealRemoteCredential;
  return reveal === undefined ? null : reveal(protectedCredential);
}

export async function getDesktopServerExposureState(): Promise<DesktopServerExposureState | null> {
  return readDesktopBridge()?.getServerExposureState?.() ?? null;
}

export async function setDesktopServerExposureMode(
  mode: DesktopServerExposureMode,
): Promise<DesktopServerExposureState | null> {
  return readDesktopBridge()?.setServerExposureMode?.(mode) ?? null;
}

export async function setDesktopServerExposurePublicUrl(
  publicUrl: string | null,
): Promise<DesktopServerExposureState | null> {
  return readDesktopBridge()?.setServerExposurePublicUrl?.(publicUrl) ?? null;
}

export async function getDesktopRemoteHostState(): Promise<DesktopRemoteHostState | null> {
  return readDesktopBridge()?.getRemoteHostState?.() ?? null;
}

export async function issueDesktopRemotePairing(
  label: string | null,
): Promise<DesktopRemotePairingLink | null> {
  return readDesktopBridge()?.issueRemotePairing?.(label) ?? null;
}

export async function revokeDesktopRemoteDevice(
  deviceID: string,
): Promise<DesktopRemoteHostState | null> {
  return readDesktopBridge()?.revokeRemoteDevice?.(deviceID) ?? null;
}

/** Register sidecar bootstrap. Await before startConnection(). No-op without a bridge. */
export async function installDesktopBridge(): Promise<void> {
  const bridge = readDesktopBridge();
  if (bridge === null) {
    return;
  }

  // Set before paint. Avoids coupling the host load URL to CSS via a query param.
  document.documentElement.setAttribute("data-shell-platform", "electron");

  bridge.onOnboardingWindowShown(markOnboardingWindowShown);

  setBootstrapOriginProvider(readBootstrapOrigin);
  setBootstrapCredentialProvider(readBootstrapCredential);

  // Touch the sync seed so the chrome IPC surface is reachable under the next shell.
  void bridge.getWindowChromeState();

  await waitForSidecarEndpoint(bridge);
}
