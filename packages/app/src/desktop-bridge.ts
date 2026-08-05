// Electron preload seam. No-op in the Vite web build. Await installDesktopBridge()
// before startConnection(). The sidecar {url, password} arrive over GET_OPENCODE_SIDECAR
// once the supervisor reports healthy.

import type { BrowserAutomationOpenRequest } from "@honk/shared/browser-automation";
import type { ClientSettings } from "@honk/shared/client-settings";
import type {
  DesktopBrowserViewCommandInput,
  DesktopBrowserViewDetachInput,
  DesktopBrowserViewDestroyInput,
  DesktopBrowserViewState,
  DesktopBrowserViewSyncInput,
  DesktopMcpServerInput,
  DesktopPtyBridge,
  DesktopRemoteHostState,
  DesktopRemotePairingLink,
  DesktopRemotePairingState,
  DesktopServerExposureConfiguration,
  DesktopServerExposureChange,
  DesktopServerExposureState,
  DesktopThreadNotificationInput,
  DesktopThreadNotificationTarget,
} from "@honk/shared/desktop-api";
import type { TerminalOpenRequest } from "@honk/shared/terminal";

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
  readonly reportStartupMilestone?: (
    milestone: "renderer-sidecar-ready" | "renderer-authenticated",
  ) => Promise<void>;
  // Optional. Absent on web and older preloads. Loopback Honk Core RPC
  // endpoint for the /chat surface.
  // TODO(core-migration two-core): optional only because opencode and Honk Core
  // coexist — a host that ships `getOpencodeSidecar` without a core is still a
  // valid bridge today, so every caller carries a null branch. When Honk Core
  // is the only backend this becomes required and the null branches go with it.
  readonly getHonkCoreEndpoint?: () => Promise<{ readonly baseUrl: string }>;
  readonly protectRemoteCredential?: (credential: string) => Promise<string>;
  readonly revealRemoteCredential?: (protectedCredential: string) => Promise<string>;
  readonly getServerExposureState?: () => Promise<DesktopServerExposureState>;
  readonly configureServerExposure?: (
    input: DesktopServerExposureConfiguration,
  ) => Promise<DesktopServerExposureChange>;
  readonly getRemoteHostState?: () => Promise<DesktopRemoteHostState>;
  readonly restartRemoteHost?: () => Promise<void>;
  readonly issueRemotePairing?: () => Promise<DesktopRemotePairingLink>;
  readonly getRemotePairingState?: (pairingID: string) => Promise<DesktopRemotePairingState>;
  readonly cancelRemotePairing?: (pairingID: string) => Promise<boolean>;
  readonly setRemoteHostName?: (name: string) => Promise<DesktopRemoteHostState>;
  readonly renameRemoteDevice?: (
    deviceID: string,
    label: string,
  ) => Promise<DesktopRemoteHostState>;
  readonly revokeRemoteDevice?: (deviceID: string) => Promise<DesktopRemoteHostState>;
  // Optional. Absent on web and older preloads. null means cancel.
  readonly pickFolder?: (options?: {
    readonly initialPath?: string | null;
  }) => Promise<string | null>;
  readonly showItemInFolder?: (path: string) => Promise<boolean>;
  readonly openExternal?: (url: string) => Promise<boolean>;
  readonly onMenuAction?: (listener: (action: string) => void) => () => void;
  readonly getClientSettings?: () => Promise<ClientSettings | null>;
  readonly setClientSettings?: (settings: ClientSettings) => Promise<void>;
  readonly persistMcpServer?: (input: DesktopMcpServerInput) => Promise<void>;
  // Desktop OS notifications. Absent on web and older preloads. The main process
  // owns the click, so it can reveal or recreate the window and open the thread.
  readonly showThreadNotification?: (input: DesktopThreadNotificationInput) => Promise<void>;
  readonly onThreadNotificationActivate?: (
    listener: (target: DesktopThreadNotificationTarget) => void,
  ) => () => void;
  readonly getHomeDirectory?: () => Promise<string>;
  readonly completeOnboarding: () => Promise<void>;
  readonly setTheme?: (theme: "system" | "light" | "dark") => Promise<void>;
  readonly setKeepAwake?: (enabled: boolean) => Promise<boolean>;
  // Optional. Absent on web and older preloads. Probes the local Claude Code CLI
  // credential store without touching secret values.
  readonly getClaudeAuthStatus?: () => Promise<"connected" | "disconnected" | "unknown">;
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
  // Optional. Absent on web and older preloads.
  readonly onTerminalOpen?: (listener: (input: TerminalOpenRequest) => void) => () => void;
  readonly getUpdateState?: () => Promise<unknown>;
  readonly checkForUpdate?: () => Promise<unknown>;
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

function readDesktopBridge(): DesktopBridgeSurface | null {
  const bridge = window.desktopBridge;
  if (bridge === undefined) {
    return null;
  }
  return bridge;
}

function reportDesktopStartupMilestone(
  milestone: "renderer-sidecar-ready" | "renderer-authenticated",
): Promise<void> | null {
  return readDesktopBridge()?.reportStartupMilestone?.(milestone) ?? null;
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

export function isDesktopShell(): boolean {
  return readDesktopBridge() !== null;
}

export function reportDesktopAuthenticatedPaint(): void {
  void reportDesktopStartupMilestone("renderer-authenticated");
}

export function canSetDesktopKeepAwake(): boolean {
  return readDesktopBridge()?.setKeepAwake !== undefined;
}

export async function setDesktopKeepAwake(enabled: boolean): Promise<boolean> {
  return (await readDesktopBridge()?.setKeepAwake?.(enabled)) ?? false;
}

export async function openDesktopExternal(url: string): Promise<boolean> {
  return (await readDesktopBridge()?.openExternal?.(url)) ?? false;
}

export type DesktopMcpAvailability =
  | { readonly status: "web" }
  | { readonly status: "restart-required" }
  | { readonly status: "ready" };

export function readDesktopMcpAvailability(): DesktopMcpAvailability {
  const bridge = readDesktopBridge();
  if (bridge === null) return { status: "web" };
  if (bridge.persistMcpServer === undefined) return { status: "restart-required" };
  return { status: "ready" };
}

export async function persistDesktopMcpServer(input: DesktopMcpServerInput): Promise<void> {
  const persist = readDesktopBridge()?.persistMcpServer;
  if (persist === undefined) {
    throw new Error("MCP server management is only available in the desktop app.");
  }
  await persist(input);
}

/** Subscribe to application-menu commands. No-op off-desktop and with older preloads. */
export function subscribeDesktopMenuAction(listener: (action: string) => void): () => void {
  return readDesktopBridge()?.onMenuAction?.(listener) ?? (() => {});
}

/**
 * Send a thread notification through the desktop main process so a click survives
 * the window being hidden or recreated. Returns false off-desktop, where web falls
 * back to the browser Web Notification API.
 */
export function showDesktopThreadNotification(input: DesktopThreadNotificationInput): boolean {
  const show = readDesktopBridge()?.showThreadNotification;
  if (show === undefined) {
    return false;
  }
  void show(input);
  return true;
}

/** Subscribe to desktop notification clicks. No-op off-desktop. */
export function subscribeDesktopThreadNotificationActivate(
  listener: (target: DesktopThreadNotificationTarget) => void,
): () => void {
  const subscribe = readDesktopBridge()?.onThreadNotificationActivate;
  if (subscribe === undefined) {
    return () => {};
  }
  return subscribe(listener);
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
      const report = reportDesktopStartupMilestone("renderer-sidecar-ready");
      if (report !== null) await report;
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

export function canShowItemInFolder(): boolean {
  return readDesktopBridge()?.showItemInFolder !== undefined;
}

export async function showItemInFolder(path: string): Promise<boolean> {
  return (await readDesktopBridge()?.showItemInFolder?.(path)) ?? false;
}

/** The Honk Core debug RPC endpoint, or null off-desktop and on older preloads. */
export async function getHonkCoreEndpoint(): Promise<{ readonly baseUrl: string } | null> {
  const read = readDesktopBridge()?.getHonkCoreEndpoint;
  if (read === undefined) {
    return null;
  }
  try {
    return await read();
  } catch {
    return null;
  }
}

/** The OS home directory, or null off-desktop and on preloads without the method. */
export async function getHomeDirectory(): Promise<string | null> {
  const read = readDesktopBridge()?.getHomeDirectory;
  if (read === undefined) {
    return null;
  }
  try {
    return await read();
  } catch {
    return null;
  }
}

export function canReplayDesktopSetup(): boolean {
  return readDesktopBridge() !== null;
}

/**
 * Marks first-run setup done. There is no such flag off-desktop, so on web this
 * resolves without writing anything rather than trapping the user on /setup. A
 * bridge that is present but failing still rejects — that is a real error.
 */
export async function completeDesktopOnboarding(): Promise<void> {
  await readDesktopBridge()?.completeOnboarding();
}

/** Subscribe to agent-started background terminals. No-op off-desktop. */
export function subscribeDesktopTerminalOpen(
  listener: (input: TerminalOpenRequest) => void,
): () => void {
  return readDesktopBridge()?.onTerminalOpen?.(listener) ?? (() => {});
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
    bridge.configureServerExposure !== undefined &&
    bridge.getRemoteHostState !== undefined &&
    bridge.restartRemoteHost !== undefined &&
    bridge.issueRemotePairing !== undefined &&
    bridge.getRemotePairingState !== undefined &&
    bridge.cancelRemotePairing !== undefined &&
    bridge.setRemoteHostName !== undefined &&
    bridge.renameRemoteDevice !== undefined &&
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

export async function configureDesktopServerExposure(
  input: DesktopServerExposureConfiguration,
): Promise<DesktopServerExposureChange | null> {
  return readDesktopBridge()?.configureServerExposure?.(input) ?? null;
}

export async function getDesktopRemoteHostState(): Promise<DesktopRemoteHostState | null> {
  return readDesktopBridge()?.getRemoteHostState?.() ?? null;
}

export async function restartDesktopRemoteHost(): Promise<void> {
  await readDesktopBridge()?.restartRemoteHost?.();
}

export async function issueDesktopRemotePairing(): Promise<DesktopRemotePairingLink | null> {
  return readDesktopBridge()?.issueRemotePairing?.() ?? null;
}

export async function getDesktopRemotePairingState(
  pairingID: string,
): Promise<DesktopRemotePairingState | null> {
  return readDesktopBridge()?.getRemotePairingState?.(pairingID) ?? null;
}

export async function cancelDesktopRemotePairing(pairingID: string): Promise<boolean> {
  return (await readDesktopBridge()?.cancelRemotePairing?.(pairingID)) ?? false;
}

export async function setDesktopRemoteHostName(
  name: string,
): Promise<DesktopRemoteHostState | null> {
  return readDesktopBridge()?.setRemoteHostName?.(name) ?? null;
}

export async function renameDesktopRemoteDevice(
  deviceID: string,
  label: string,
): Promise<DesktopRemoteHostState | null> {
  return readDesktopBridge()?.renameRemoteDevice?.(deviceID, label) ?? null;
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

  setBootstrapOriginProvider(readBootstrapOrigin);
  setBootstrapCredentialProvider(readBootstrapCredential);

  // Touch the sync seed so the chrome IPC surface is reachable under the next shell.
  void bridge.getWindowChromeState();

  await waitForSidecarEndpoint(bridge);
}
