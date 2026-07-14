// Electron host seam for the rebuilt client (WP8 / ADR 0025 §5).
//
// Runs only when `window.desktopBridge` is present (Electron preload). The Vite
// web build never sees the bridge, so this module is a no-op there. Await
// `installDesktopBridge()` before `startConnection()`: in the sidecar world the
// renderer's server is the opencode process the desktop supervisor spawns, and
// its {url, password} arrive over the async GET_OPENCODE_SIDECAR bridge method
// once the supervisor reports ready (first boot includes the plugin warm-up, so
// readiness can take a while).

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

/** The desktop PTY seam (packages/desktop main + preload) — the terminal panel's transport. */
export type DesktopPtyBridge = {
  readonly open: (options: {
    readonly cwd: string;
    readonly cols: number;
    readonly rows: number;
  }) => Promise<{ readonly id: string }>;
  readonly write: (id: string, data: string) => void;
  readonly resize: (id: string, cols: number, rows: number) => void;
  readonly close: (id: string) => void;
  readonly onData: (id: string, listener: (data: string) => void) => () => void;
  readonly onExit: (id: string, listener: (code: number) => void) => () => void;
};

type DesktopBridgeSurface = {
  readonly getWindowChromeState: () => DesktopWindowChromeState;
  readonly onWindowChromeState: (listener: (state: DesktopWindowChromeState) => void) => () => void;
  readonly getOpencodeSidecar: () => Promise<DesktopOpencodeSidecarEndpoint>;
  // Native folder-picker dialog (async IPC → Electron showOpenDialog openDirectory). Resolves the
  // chosen absolute path, or null if the user cancelled. Optional: the web build has no bridge and
  // older preloads may lack it. `initialPath` seeds the dialog's starting directory.
  readonly pickFolder?: (options?: { readonly initialPath?: string | null }) => Promise<string | null>;
  // Update IPC (WP7 pill) — optional on the typed surface; web build has no bridge.
  readonly getUpdateState?: () => Promise<unknown>;
  readonly downloadUpdate?: () => Promise<unknown>;
  readonly installUpdate?: () => Promise<unknown>;
  readonly onUpdateState?: (listener: (state: unknown) => void) => () => void;
  // Real shells for the workbench terminal (async IPC → node-pty). Optional: web build and
  // older preloads lack it — the terminal panel shows its honest placeholder then.
  readonly pty?: DesktopPtyBridge;
};

declare global {
  interface Window {
    readonly desktopBridge?: DesktopBridgeSurface;
  }
}

// First boot pays the sidecar's plugin warm-up (up to ~90s) before ready.
const SIDECAR_WAIT_CEILING_MS = 120_000;
const SIDECAR_POLL_INTERVAL_MS = 300;

// The resolved sidecar endpoint the providers read. Written once by the install
// wait; null means "not resolved" (web build or sidecar error).
let sidecarEndpoint: { readonly url: string; readonly password: string | null } | null = null;

function readDesktopBridge(): DesktopBridgeSurface | null {
  const bridge = window.desktopBridge;
  if (bridge === undefined) {
    return null;
  }
  return bridge;
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

// Poll the sidecar bridge method until the supervisor lands somewhere terminal.
// "ready" resolves the endpoint; "error"/"stopped" (or the ceiling) leave it
// null so connection-store reports unreachable honestly and its retry action —
// which re-reads the providers — can pick up a later recovery.
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

/**
 * Open the OS folder picker via the preload bridge. Resolves null when the user
 * cancels — or when no bridge/picker exists (web build, old preload), so callers
 * treat "can't pick" and "didn't pick" the same way.
 */
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

/** The PTY bridge, or null off-desktop (web build / old preload). */
export function getPtyBridge(): DesktopPtyBridge | null {
  return window.desktopBridge?.pty ?? null;
}

/**
 * Mark the document as the Electron shell and register the sidecar endpoint
 * as the connection-store bootstrap. Await it
 * before `startConnection()`; resolves immediately when no bridge is present.
 */
export async function installDesktopBridge(): Promise<void> {
  const bridge = readDesktopBridge();
  if (bridge === null) {
    return;
  }

  // Renderer-owned platform marker (parity: `[data-shell-platform=electron]`).
  // Prefer this over a query param so the attribute is present before paint
  // without coupling the host load URL to CSS contracts.
  document.documentElement.setAttribute("data-shell-platform", "electron");

  setBootstrapOriginProvider(readBootstrapOrigin);
  setBootstrapCredentialProvider(readBootstrapCredential);

  // Seed + push already live on the preload bridge (`getWindowChromeState` /
  // `onWindowChromeState`). A later shell pass will subscribe; touching the
  // sync seed here confirms the IPC surface is reachable under the next shell.
  void bridge.getWindowChromeState();

  await waitForSidecarEndpoint(bridge);
}
