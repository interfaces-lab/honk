import { useSyncExternalStore } from "react";

import {
  openCodeWorkbenchToolHref,
  parseOpenCodeTabHref,
  type OpenCodeWorkbenchToolKind,
} from "./opencode/tab-route";
import { actions as tabActions } from "./tab-store";
import { WORKBENCH_TOOL_TABS } from "./workbench-tool-tabs";

const WORKBENCH_WIDTH_DEFAULT = 400;
const WORKBENCH_WIDTH_MIN = 300;
const WORKBENCH_WIDTH_MAX = 720;
const STORAGE_KEY = "honk:app:workbench:v1";

type WorkbenchTab = OpenCodeWorkbenchToolKind;

type WorkbenchState = {
  readonly isRailMinimized: boolean;
  readonly width: number;
  readonly lastTab: WorkbenchTab;
};

function clampWorkbenchWidth(width: number): number {
  return Math.min(WORKBENCH_WIDTH_MAX, Math.max(WORKBENCH_WIDTH_MIN, width));
}

function readPersisted(): WorkbenchState {
  const fallback: WorkbenchState = {
    isRailMinimized: false,
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
  setWidth(width: number): void {
    setState({ ...state, width: clampWorkbenchWidth(width) });
  },
  setRailMinimized(isRailMinimized: boolean): void {
    setState({ ...state, isRailMinimized });
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
