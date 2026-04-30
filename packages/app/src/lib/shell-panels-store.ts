import { create } from "zustand";

const STORAGE_KEY = "multi.shell.panels.v1";
const DEFAULT_CWD_KEY = "default";

const LEFT_MIN = 180;
const LEFT_MAX = 400;
const RIGHT_MIN = 340;
const RIGHT_MAX = 600;

export type WorkbenchTab = "files" | "git" | "terminal" | "browser";

interface ShellPanelState {
  leftOpen: boolean;
  rightOpen: boolean;
  leftW: number;
  rightW: number;
  activeTab: WorkbenchTab;
  muted: boolean;
}

interface ShellPanelsStoreState {
  byCwd: Record<string, ShellPanelState>;
  setLeftOpen: (cwd: string | null, open: boolean) => void;
  setRightOpen: (cwd: string | null, open: boolean) => void;
  setLeftWidth: (cwd: string | null, width: number) => void;
  setRightWidth: (cwd: string | null, width: number) => void;
  setActiveTab: (cwd: string | null, tab: WorkbenchTab) => void;
  setMuted: (cwd: string | null, muted: boolean) => void;
}

interface PersistedShellPanelState {
  leftOpen?: boolean;
  rightOpen?: boolean;
  leftW?: number;
  rightW?: number;
  activeTab?: WorkbenchTab;
  muted?: boolean;
}

const DEFAULT_PANEL_STATE: ShellPanelState = Object.freeze({
  leftOpen: true,
  rightOpen: true,
  leftW: 256,
  rightW: 400,
  activeTab: "files",
  muted: false,
});

function clampWidth(width: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(width) ? width : min));
}

function resolveCwdKey(cwd: string | null): string {
  const trimmed = cwd?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_CWD_KEY;
}

function readPersistedPanels(): Record<string, ShellPanelState> {
  if (typeof window === "undefined") {
    return {};
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, PersistedShellPanelState> | null;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    const result: Record<string, ShellPanelState> = {};
    for (const [cwd, value] of Object.entries(parsed)) {
      const activeTab =
        value?.activeTab === "files" ||
        value?.activeTab === "git" ||
        value?.activeTab === "terminal" ||
        value?.activeTab === "browser"
          ? value.activeTab
          : DEFAULT_PANEL_STATE.activeTab;
      const normalized: ShellPanelState = {
        leftOpen:
          typeof value?.leftOpen === "boolean" ? value.leftOpen : DEFAULT_PANEL_STATE.leftOpen,
        rightOpen:
          typeof value?.rightOpen === "boolean" ? value.rightOpen : DEFAULT_PANEL_STATE.rightOpen,
        leftW: clampWidth(
          typeof value?.leftW === "number" ? value.leftW : DEFAULT_PANEL_STATE.leftW,
          LEFT_MIN,
          LEFT_MAX,
        ),
        rightW: clampWidth(
          typeof value?.rightW === "number" ? value.rightW : DEFAULT_PANEL_STATE.rightW,
          RIGHT_MIN,
          RIGHT_MAX,
        ),
        activeTab,
        muted: typeof value?.muted === "boolean" ? value.muted : DEFAULT_PANEL_STATE.muted,
      };
      result[cwd && cwd !== DEFAULT_CWD_KEY ? cwd : DEFAULT_CWD_KEY] = normalized;
    }
    return result;
  } catch {
    return {};
  }
}

function persistPanels(byCwd: Record<string, ShellPanelState>): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(byCwd));
}

function getPanelState(
  byCwd: Record<string, ShellPanelState>,
  cwd: string | null,
): ShellPanelState {
  return byCwd[resolveCwdKey(cwd)] ?? DEFAULT_PANEL_STATE;
}

function arePanelStatesEqual(left: ShellPanelState, right: ShellPanelState): boolean {
  return (
    left.leftOpen === right.leftOpen &&
    left.rightOpen === right.rightOpen &&
    left.leftW === right.leftW &&
    left.rightW === right.rightW &&
    left.activeTab === right.activeTab &&
    left.muted === right.muted
  );
}

const INITIAL_BY_CWD = readPersistedPanels();

export const useShellPanelsStore = create<ShellPanelsStoreState>()((set) => ({
  byCwd: INITIAL_BY_CWD,
  setLeftOpen: (cwd, leftOpen) => {
    set((state) => {
      const key = resolveCwdKey(cwd);
      const current = getPanelState(state.byCwd, cwd);
      const next = current.leftOpen === leftOpen ? current : { ...current, leftOpen };
      if (arePanelStatesEqual(current, next)) {
        return state;
      }

      const byCwd = { ...state.byCwd, [key]: next };
      persistPanels(byCwd);
      return { byCwd };
    });
  },
  setRightOpen: (cwd, rightOpen) => {
    set((state) => {
      const key = resolveCwdKey(cwd);
      const current = getPanelState(state.byCwd, cwd);
      const next = current.rightOpen === rightOpen ? current : { ...current, rightOpen };
      if (arePanelStatesEqual(current, next)) {
        return state;
      }

      const byCwd = { ...state.byCwd, [key]: next };
      persistPanels(byCwd);
      return { byCwd };
    });
  },
  setLeftWidth: (cwd, width) => {
    set((state) => {
      const key = resolveCwdKey(cwd);
      const current = getPanelState(state.byCwd, cwd);
      const nextWidth = clampWidth(width, LEFT_MIN, LEFT_MAX);
      const next = current.leftW === nextWidth ? current : { ...current, leftW: nextWidth };
      if (arePanelStatesEqual(current, next)) {
        return state;
      }

      const byCwd = { ...state.byCwd, [key]: next };
      persistPanels(byCwd);
      return { byCwd };
    });
  },
  setRightWidth: (cwd, width) => {
    set((state) => {
      const key = resolveCwdKey(cwd);
      const current = getPanelState(state.byCwd, cwd);
      const nextWidth = clampWidth(width, RIGHT_MIN, RIGHT_MAX);
      const next = current.rightW === nextWidth ? current : { ...current, rightW: nextWidth };
      if (arePanelStatesEqual(current, next)) {
        return state;
      }

      const byCwd = { ...state.byCwd, [key]: next };
      persistPanels(byCwd);
      return { byCwd };
    });
  },
  setActiveTab: (cwd, activeTab) => {
    set((state) => {
      const key = resolveCwdKey(cwd);
      const current = getPanelState(state.byCwd, cwd);
      const next =
        current.activeTab === activeTab && current.rightOpen
          ? current
          : {
              ...current,
              activeTab,
              rightOpen: true,
            };
      if (arePanelStatesEqual(current, next)) {
        return state;
      }

      const byCwd = { ...state.byCwd, [key]: next };
      persistPanels(byCwd);
      return { byCwd };
    });
  },
  setMuted: (cwd, muted) => {
    set((state) => {
      const key = resolveCwdKey(cwd);
      const current = getPanelState(state.byCwd, cwd);
      const next = current.muted === muted ? current : { ...current, muted };
      if (arePanelStatesEqual(current, next)) {
        return state;
      }

      const byCwd = { ...state.byCwd, [key]: next };
      persistPanels(byCwd);
      return { byCwd };
    });
  },
}));

function selectPanelState(state: ShellPanelsStoreState, cwd: string | null): ShellPanelState {
  return state.byCwd[resolveCwdKey(cwd)] ?? DEFAULT_PANEL_STATE;
}

export function useLeftOpen(cwd: string | null): boolean {
  return useShellPanelsStore((state) => selectPanelState(state, cwd).leftOpen);
}

export function useRightOpen(cwd: string | null): boolean {
  return useShellPanelsStore((state) => selectPanelState(state, cwd).rightOpen);
}

export function useLeftWidth(cwd: string | null): number {
  return useShellPanelsStore((state) => selectPanelState(state, cwd).leftW);
}

export function useRightWidth(cwd: string | null): number {
  return useShellPanelsStore((state) => selectPanelState(state, cwd).rightW);
}

export function useActiveTab(cwd: string | null): WorkbenchTab {
  return useShellPanelsStore((state) => selectPanelState(state, cwd).activeTab);
}

export function useIsMuted(cwd: string | null): boolean {
  return useShellPanelsStore((state) => selectPanelState(state, cwd).muted);
}

export const shellPanelsActions = {
  setLeftOpen: (cwd: string | null, open: boolean) =>
    useShellPanelsStore.getState().setLeftOpen(cwd, open),
  setRightOpen: (cwd: string | null, open: boolean) =>
    useShellPanelsStore.getState().setRightOpen(cwd, open),
  setLeftWidth: (cwd: string | null, width: number) =>
    useShellPanelsStore.getState().setLeftWidth(cwd, width),
  setRightWidth: (cwd: string | null, width: number) =>
    useShellPanelsStore.getState().setRightWidth(cwd, width),
  setActiveTab: (cwd: string | null, tab: WorkbenchTab) =>
    useShellPanelsStore.getState().setActiveTab(cwd, tab),
  setMuted: (cwd: string | null, muted: boolean) =>
    useShellPanelsStore.getState().setMuted(cwd, muted),
  toggleLeft: (cwd: string | null) => {
    const current = getPanelState(useShellPanelsStore.getState().byCwd, cwd);
    useShellPanelsStore.getState().setLeftOpen(cwd, !current.leftOpen);
  },
  toggleRight: (cwd: string | null) => {
    const current = getPanelState(useShellPanelsStore.getState().byCwd, cwd);
    useShellPanelsStore.getState().setRightOpen(cwd, !current.rightOpen);
  },
};
