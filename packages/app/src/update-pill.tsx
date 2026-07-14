// Desktop update pill (WP7). Store binds the preload bridge's update IPC; the
// compact control lives in the titlebar trailing slot (sidebar footer is gone).
// Quiet chrome: at rest the pill is hidden — only actionable update states show.
// Web build (no bridge) is a permanent no-op.

import * as stylex from "@stylexjs/stylex";
import { Button } from "@honk/ui";
import { colorVars, controlVars, radiusVars } from "@honk/ui/tokens.stylex";
import * as React from "react";
import { useSyncExternalStore } from "react";

import { actions as toastActions } from "./toast-store";
import {
  getWorkspaceWatchSnapshot,
  subscribeWorkspaceWatch,
} from "./watch-registry";

// ── Local bridge surface (same pattern as desktop-bridge.ts — no shared dep) ─

type DesktopUpdateStatus =
  | "disabled"
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "error";

type DesktopUpdateState = {
  readonly enabled: boolean;
  readonly status: DesktopUpdateStatus;
  readonly currentVersion: string;
  readonly availableVersion: string | null;
  readonly downloadedVersion: string | null;
  readonly downloadPercent: number | null;
  readonly message: string | null;
  readonly errorContext: "check" | "download" | "install" | null;
  readonly canRetry: boolean;
};

type DesktopUpdateActionResult = {
  readonly accepted: boolean;
  readonly completed: boolean;
  readonly state: DesktopUpdateState;
};

type UpdateBridgeSurface = {
  readonly getUpdateState: () => Promise<DesktopUpdateState>;
  readonly downloadUpdate: () => Promise<DesktopUpdateActionResult>;
  readonly installUpdate: () => Promise<DesktopUpdateActionResult>;
  readonly onUpdateState: (listener: (state: DesktopUpdateState) => void) => () => void;
};

type UpdatePillSnapshot = {
  readonly state: DesktopUpdateState | null;
  readonly dismissed: boolean;
  readonly bridgePresent: boolean;
};

type UpdateButtonAction = "download" | "install" | "none";

const DEFAULT_SNAPSHOT: UpdatePillSnapshot = Object.freeze({
  state: null,
  dismissed: false,
  bridgePresent: false,
});

const listeners = new Set<() => void>();

let snapshot: UpdatePillSnapshot = DEFAULT_SNAPSHOT;
let unsubscribeBridge: (() => void) | null = null;
let installed = false;

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

function publish(partial: Partial<UpdatePillSnapshot>): void {
  snapshot = Object.freeze({ ...snapshot, ...partial });
  notify();
}

function readUpdateBridge(): UpdateBridgeSurface | null {
  const bridge = window.desktopBridge;
  if (bridge === undefined) {
    return null;
  }
  if (
    typeof bridge.getUpdateState !== "function" ||
    typeof bridge.onUpdateState !== "function" ||
    typeof bridge.downloadUpdate !== "function" ||
    typeof bridge.installUpdate !== "function"
  ) {
    return null;
  }
  return bridge as UpdateBridgeSurface;
}

function formatVersion(version: string): string {
  return version.startsWith("v") ? version : `v${version}`;
}

function resolveAction(state: DesktopUpdateState): UpdateButtonAction {
  if (state.status === "installing") {
    return "none";
  }
  if (state.downloadedVersion) {
    return "install";
  }
  if (state.status === "available") {
    return "download";
  }
  if (state.status === "error" && state.errorContext === "download" && state.availableVersion) {
    return "download";
  }
  return "none";
}

function shouldShowAction(state: DesktopUpdateState | null, dismissed: boolean): boolean {
  if (!state || !state.enabled || dismissed) {
    return false;
  }
  if (state.status === "downloading" || state.status === "installing") {
    return true;
  }
  return resolveAction(state) !== "none";
}

function chipLabel(state: DesktopUpdateState, action: UpdateButtonAction): string {
  const target = formatVersion(
    state.downloadedVersion ?? state.availableVersion ?? state.currentVersion,
  );
  if (action === "install") {
    return state.errorContext === "install" && typeof state.message === "string"
      ? `Retry · ${target}`
      : `Restart · ${target}`;
  }
  if (state.status === "installing") {
    return `Installing · ${target}`;
  }
  if (state.status === "downloading") {
    const progress =
      typeof state.downloadPercent === "number" ? ` ${Math.floor(state.downloadPercent)}%` : "";
    return `Downloading${progress}`;
  }
  if (state.status === "error" && state.errorContext === "download") {
    return `Retry · ${target}`;
  }
  return `Update · ${target}`;
}

function chipTooltip(state: DesktopUpdateState): string {
  if (state.status === "available") {
    return `Update ${state.availableVersion ?? "available"} ready to download`;
  }
  if (state.status === "downloading") {
    const progress =
      typeof state.downloadPercent === "number" ? ` (${Math.floor(state.downloadPercent)}%)` : "";
    return `Downloading update${progress}`;
  }
  if (state.status === "downloaded") {
    return `Update ${state.downloadedVersion ?? "ready"} downloaded. Click to restart and install.`;
  }
  if (state.status === "installing") {
    return `Installing update ${state.downloadedVersion ?? ""}`.trim();
  }
  if (state.status === "error") {
    return state.message ?? "Update failed";
  }
  return "Update available";
}

function countRunningThreads(): { count: number; titles: readonly string[] } {
  const { state } = getWorkspaceWatchSnapshot();
  if (state === null) {
    return { count: 0, titles: [] };
  }
  const running = state.threads.filter((thread) => thread.status === "running");
  return {
    count: running.length,
    titles: running.map((thread) => thread.title),
  };
}

function installConfirmMessage(
  state: DesktopUpdateState,
  titles: readonly string[],
): string {
  const version = state.downloadedVersion ?? state.availableVersion;
  const threadList =
    titles.length > 0 ? `\n\n${titles.map((title) => `• ${title}`).join("\n")}` : "";
  return `Install update${version ? ` ${version}` : ""} and restart Honk?\n\nAny running tasks will be interrupted.${threadList}\n\nMake sure you're ready before continuing.`;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): UpdatePillSnapshot {
  return snapshot;
}

export function getServerSnapshot(): UpdatePillSnapshot {
  return DEFAULT_SNAPSHOT;
}

export function useUpdatePill(): UpdatePillSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export const updatePillActions = {
  dismiss(): void {
    publish({ dismissed: true });
  },

  setState(state: DesktopUpdateState): void {
    // A new available/downloaded version clears a prior double-click dismiss.
    const prev = snapshot.state;
    const versionChanged =
      prev !== null &&
      (prev.availableVersion !== state.availableVersion ||
        prev.downloadedVersion !== state.downloadedVersion);
    publish({
      state,
      ...(versionChanged ? { dismissed: false } : {}),
    });
  },
} as const;

/**
 * Bind the desktop update IPC. Idempotent no-op when the bridge is absent.
 * Call from main.tsx alongside installDesktopBridge().
 */
export function installUpdatePill(): void {
  if (installed) {
    return;
  }
  installed = true;

  const bridge = readUpdateBridge();
  if (bridge === null) {
    publish({ bridgePresent: false, state: null });
    return;
  }

  publish({ bridgePresent: true });

  void bridge.getUpdateState().then((state) => {
    updatePillActions.setState(state);
  });

  unsubscribeBridge = bridge.onUpdateState((state) => {
    updatePillActions.setState(state);
  });
}

async function runDownload(bridge: UpdateBridgeSurface): Promise<void> {
  const result = await bridge.downloadUpdate();
  updatePillActions.setState(result.state);
  if (result.completed) {
    toastActions.add({
      type: "success",
      title: "Update downloaded",
      description: "Restart the app to install it.",
    });
    return;
  }
  if (!result.accepted && typeof result.state.message === "string") {
    toastActions.add({
      type: "error",
      title: "Update download failed",
      description: result.state.message,
      copyableError: result.state.message,
    });
  }
}

async function runInstall(bridge: UpdateBridgeSurface, state: DesktopUpdateState): Promise<void> {
  const { count, titles } = countRunningThreads();
  if (count > 0 && !window.confirm(installConfirmMessage(state, titles))) {
    return;
  }
  const result = await bridge.installUpdate();
  updatePillActions.setState(result.state);
  if (!result.accepted && typeof result.state.message === "string") {
    toastActions.add({
      type: "error",
      title: "Update install failed",
      description: result.state.message,
      copyableError: result.state.message,
    });
  }
}

// ── Anatomy ──────────────────────────────────────────────────────────────────────────────────
const PILL_DOT = "6px";
// Compact chip max width so a long version string truncates in the titlebar.
const PILL_MAX_WIDTH = "180px";

const styles = stylex.create({
  trailing: {
    display: "inline-flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
  },
  pill: {
    // Compact actionable chip — Button owns interaction; this only tightens the label row.
    maxWidth: PILL_MAX_WIDTH,
  },
  label: {
    display: "inline-flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    minWidth: 0,
  },
  dot: {
    width: PILL_DOT,
    height: PILL_DOT,
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: colorVars["--honk-color-accent"],
    flexShrink: 0,
  },
});

function UpdatePillControl(): React.ReactElement | null {
  const { state, dismissed, bridgePresent } = useUpdatePill();
  // Keep a live subscription so install-confirm sees running threads without an effect.
  useSyncExternalStore(
    subscribeWorkspaceWatch,
    getWorkspaceWatchSnapshot,
    getWorkspaceWatchSnapshot,
  );

  if (!bridgePresent || state === null) {
    return null;
  }

  if (!shouldShowAction(state, dismissed)) {
    // Quiet chrome: hide the at-rest version label (board §0 — no ambient chrome noise).
    return null;
  }

  const action = resolveAction(state);
  const disabled = state.status === "downloading" || state.status === "installing";
  const label = chipLabel(state, action);

  return (
    <span data-shell-no-drag="" {...stylex.props(styles.pill)}>
      <Button
        size="sm"
        variant="secondary"
        disabled={disabled}
        title={chipTooltip(state)}
        aria-label={label}
        onClick={() => {
          const bridge = readUpdateBridge();
          if (bridge === null || disabled || action === "none") {
            return;
          }
          if (action === "download") {
            void runDownload(bridge);
            return;
          }
          if (action === "install") {
            void runInstall(bridge, state);
          }
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          updatePillActions.dismiss();
        }}
      >
        <span {...stylex.props(styles.label)}>
          <span {...stylex.props(styles.dot)} aria-hidden />
          <span>{label}</span>
        </span>
      </Button>
    </span>
  );
}

/** Titlebar trailing cluster: update pill (when actionable) + optional sibling (DEV chip). */
function TitleBarTrailing(props: { children?: React.ReactNode }): React.ReactElement {
  return (
    <span {...stylex.props(styles.trailing)}>
      <UpdatePillControl />
      {props.children}
    </span>
  );
}

export { UpdatePillControl, TitleBarTrailing };
