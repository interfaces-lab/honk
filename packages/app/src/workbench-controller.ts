import { useSyncExternalStore } from "react";

import {
  openCodeWorkbenchTabHref,
  openCodeWorkbenchToolHref,
  parseOpenCodeTabHref,
  type OpenCodeWorkbenchToolKind,
} from "./opencode/tab-route";
import { actions as tabActions } from "./tab-store";
import { fileTabID } from "./workbench-tab-store";
import { WORKBENCH_TOOL_TABS } from "./workbench-tool-tabs";

// The Changes panel composes diff cards + a 220px tree rail (Cursor's model); 400
// starved both columns. Wider default and ceiling let the panel showcase content.
const WORKBENCH_WIDTH_DEFAULT = 560;
const WORKBENCH_WIDTH_MIN = 300;
const WORKBENCH_WIDTH_MAX = 960;
const STORAGE_KEY = "honk:app:workbench:v1";

type WorkbenchTab = OpenCodeWorkbenchToolKind;

type WorkbenchState = {
  readonly isRailMinimized: boolean;
  readonly isMaximized: boolean;
  readonly width: number;
  readonly lastTab: WorkbenchTab;
};

function clampWorkbenchWidth(width: number): number {
  return Math.min(WORKBENCH_WIDTH_MAX, Math.max(WORKBENCH_WIDTH_MIN, width));
}

// The snapshot is read field by field with a per-field fallback, so the key never needs a version
// bump: a pre-`isMaximized` blob loads with the rest of its fields intact and maximized off. Adding
// a `:v2` key instead would silently reset every user's stored width and last tab.
function readPersisted(): WorkbenchState {
  const fallback: WorkbenchState = {
    isRailMinimized: false,
    isMaximized: false,
    width: WORKBENCH_WIDTH_DEFAULT,
    lastTab: "changes",
  };
  if (typeof window === "undefined") return fallback;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw) as Partial<WorkbenchState>;
    return {
      isRailMinimized: parsed.isRailMinimized === true,
      isMaximized: parsed.isMaximized === true,
      width:
        typeof parsed.width === "number"
          ? clampWorkbenchWidth(parsed.width)
          : WORKBENCH_WIDTH_DEFAULT,
      lastTab: WORKBENCH_TOOL_TABS.some((entry) => entry.id === parsed.lastTab)
        ? (parsed.lastTab as WorkbenchTab)
        : "changes",
    };
  } catch {
    return fallback;
  }
}

let state: WorkbenchState = readPersisted();
const listeners = new Set<() => void>();

function setState(next: WorkbenchState): void {
  state = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage failure must not clear the in-memory session state.
  }
  for (const listener of listeners) listener();
}

function currentWorkbenchRoute() {
  if (typeof window === "undefined") return null;
  const route = parseOpenCodeTabHref(`${window.location.pathname}${window.location.search}`);
  return route?.type === "session" ? route : null;
}

function isCurrentWorkbenchSession(ref: {
  readonly server: string;
  readonly sessionID: string;
}): boolean {
  const route = currentWorkbenchRoute();
  return route !== null && route.ref.server === ref.server && route.ref.sessionID === ref.sessionID;
}

const workbenchActions = {
  rememberTab(tab: WorkbenchTab): void {
    setState({ ...state, lastTab: tab });
  },
  setTab(tab: WorkbenchTab): void {
    setState({ ...state, lastTab: tab });
    const route = currentWorkbenchRoute();
    if (route === null) return;
    tabActions.openSessionRoute(route.ref, openCodeWorkbenchToolHref(route.ref, tab));
  },
  openFile(path: string): void {
    const route = currentWorkbenchRoute();
    if (route === null) return;
    tabActions.openSessionRoute(route.ref, openCodeWorkbenchTabHref(route.ref, fileTabID(path)));
  },
  setWidth(width: number): void {
    setState({ ...state, width: clampWorkbenchWidth(width) });
  },
  setRailMinimized(isRailMinimized: boolean): void {
    setState({ ...state, isRailMinimized });
  },
  setMaximized(isMaximized: boolean): void {
    if (state.isMaximized === isMaximized) return;
    setState({ ...state, isMaximized });
  },
  toggleMaximized(): void {
    // Away from a session the chord has nothing to maximize; flipping a persisted preference with
    // no visible outcome is worse than ignoring the key.
    const route = currentWorkbenchRoute();
    if (route === null) return;
    // The deep link is the panel's open state: collapsing drops the workbench segment and every
    // reopen restores one. Toggling against what is on screen keeps a stale stored `true` from
    // turning the first chord press into a no-op exit.
    const isPanelOpen = route.workbench !== undefined;
    if (state.isMaximized && isPanelOpen) {
      setState({ ...state, isMaximized: false });
      return;
    }
    setState({ ...state, isMaximized: true });
    // Maximizing a closed panel would show nothing, so open it on the last tool first.
    if (isPanelOpen) return;
    tabActions.openSessionRoute(route.ref, openCodeWorkbenchToolHref(route.ref, state.lastTab));
  },
};

function useWorkbench<T>(selector: (current: WorkbenchState) => T): T {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => selector(state),
    () => selector(state),
  );
}

export {
  WORKBENCH_WIDTH_MAX,
  WORKBENCH_WIDTH_MIN,
  isCurrentWorkbenchSession,
  useWorkbench,
  workbenchActions,
};
export type { WorkbenchState, WorkbenchTab };
