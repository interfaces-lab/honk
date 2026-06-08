import { DEFAULT_TERMINAL_ID } from "@multi/contracts";
import { Option, Schema } from "effect";
import { create } from "zustand";
import { WORKBENCH_TABS, type WorkbenchTab } from "~/lib/workbench-tabs";

const STORAGE_KEY = "multi.shell.panels.v3";
const RIGHT_WORKBENCH_STORAGE_KEY = "multi.shell.rightWorkbench.v1";
const SECONDARY_RAIL_STORAGE_KEY = "multi.shell.secondaryRail.v1";
const TERMINAL_SESSIONS_STORAGE_KEY = "multi.shell.terminalSessions.v1";
const DEFAULT_CWD_KEY = "default";

/** Persisted width limits for the chat/settings thread rail (`LeftAside`). */
export const SHELL_LEFT_PANEL_WIDTH_LIMITS = { min: 180, max: 560 } as const;
const SHELL_LEFT_PANEL_DEFAULT_WIDTH = 260;
const PREVIOUS_SHELL_LEFT_PANEL_DEFAULT_WIDTH = 180;

/** Cursor/VS Code auxiliary workbench width floor. Cursor's bundled part uses minimumWidth 300. */
export const RIGHT_WORKBENCH_WIDTH_LIMITS = { min: 300, max: 600 } as const;

export const SECONDARY_RAIL_LIMITS = { min: 160, max: 320 } as const;
const SECONDARY_RAIL_DEFAULT_WIDTH = 220;

interface LeftPanelState {
  leftOpen: boolean;
  leftW: number;
}

interface WorkbenchPanelState {
  rightOpen: boolean;
  rightW: number;
  activeTab: WorkbenchTab;
  muted: boolean;
}

/** Per-project, per-tool secondary rail state. */
export interface SecondaryRailState {
  open: boolean;
  width: number;
}

/** Per-project terminal session tracking. */
export interface TerminalSessionEntry {
  id: string;
  label: string;
}

export interface TerminalSessionsState {
  activeId: string;
  sessions: TerminalSessionEntry[];
}

interface ShellPanelsStoreState {
  leftOpen: boolean;
  leftW: number;
  rightOpen: boolean;
  rightW: number;
  activeTab: WorkbenchTab;
  muted: boolean;
  rightWorkbenchByWorkspaceKey: Record<string, WorkbenchPanelState>;
  railByWorkspaceKeyAndTab: Record<string, SecondaryRailState>;
  terminalByWorkspaceKey: Record<string, TerminalSessionsState>;
  setLeftOpen: (open: boolean) => void;
  setRightOpen: (open: boolean, workspaceKey?: string | null) => void;
  setLeftWidth: (width: number) => void;
  setRightWidth: (width: number) => void;
  setActiveTab: (tab: WorkbenchTab, workspaceKey?: string | null) => void;
  setMuted: (muted: boolean, workspaceKey?: string | null) => void;
  setSecondaryRailOpen: (workspaceKey: string | null, tab: WorkbenchTab, open: boolean) => void;
  setSecondaryRailWidth: (workspaceKey: string | null, tab: WorkbenchTab, width: number) => void;
  setActiveTerminal: (workspaceKey: string | null, terminalId: string) => void;
  addTerminalSession: (workspaceKey: string | null, session: TerminalSessionEntry) => void;
  removeTerminalSession: (workspaceKey: string | null, terminalId: string) => void;
}

interface PersistedShellPanelsState {
  leftOpen?: boolean;
  leftW?: number;
  rightOpen?: boolean;
  rightW?: number;
  activeTab?: WorkbenchTab;
  muted?: boolean;
}

const WorkbenchTabSchema = Schema.Literals(WORKBENCH_TABS);
const PersistedShellPanelsStateSchema = Schema.Struct({
  leftOpen: Schema.optionalKey(Schema.Boolean),
  leftW: Schema.optionalKey(Schema.Number),
  rightOpen: Schema.optionalKey(Schema.Boolean),
  rightW: Schema.optionalKey(Schema.Number),
  activeTab: Schema.optionalKey(WorkbenchTabSchema),
  muted: Schema.optionalKey(Schema.Boolean),
});
const PersistedSecondaryRailStateSchema = Schema.Struct({
  open: Schema.optionalKey(Schema.Boolean),
  width: Schema.optionalKey(Schema.Number),
});
const PersistedWorkbenchPanelStateSchema = Schema.Struct({
  rightOpen: Schema.optionalKey(Schema.Boolean),
  rightW: Schema.optionalKey(Schema.Number),
  activeTab: Schema.optionalKey(WorkbenchTabSchema),
  muted: Schema.optionalKey(Schema.Boolean),
});
const PersistedTerminalSessionEntrySchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
});
const PersistedTerminalSessionsStateSchema = Schema.Struct({
  activeId: Schema.String,
  sessions: Schema.Array(PersistedTerminalSessionEntrySchema),
});
const decodePersistedShellPanelsStateOption = Schema.decodeUnknownOption(
  PersistedShellPanelsStateSchema,
);
const decodePersistedSecondaryRailStateOption = Schema.decodeUnknownOption(
  PersistedSecondaryRailStateSchema,
);
const decodePersistedWorkbenchPanelStateOption = Schema.decodeUnknownOption(
  PersistedWorkbenchPanelStateSchema,
);
const decodePersistedTerminalSessionsStateOption = Schema.decodeUnknownOption(
  PersistedTerminalSessionsStateSchema,
);

const DEFAULT_LEFT_PANEL_STATE: LeftPanelState = Object.freeze({
  leftOpen: true,
  leftW: SHELL_LEFT_PANEL_DEFAULT_WIDTH,
});

const DEFAULT_WORKBENCH_PANEL_STATE: WorkbenchPanelState = Object.freeze({
  rightOpen: false,
  rightW: 400,
  activeTab: "files",
  muted: true,
});

const DEFAULT_SECONDARY_RAIL: SecondaryRailState = Object.freeze({
  open: false,
  width: SECONDARY_RAIL_DEFAULT_WIDTH,
});

const DEFAULT_TERMINAL_SESSION_ID = DEFAULT_TERMINAL_ID;

const DEFAULT_TERMINAL_SESSIONS: TerminalSessionsState = Object.freeze({
  activeId: DEFAULT_TERMINAL_SESSION_ID,
  sessions: [{ id: DEFAULT_TERMINAL_SESSION_ID, label: "Terminal" }],
});

function clampWidth(width: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(width) ? width : min));
}

function normalizePersistedLeftWidth(width: unknown): number {
  if (typeof width !== "number") return DEFAULT_LEFT_PANEL_STATE.leftW;
  const clamped = clampWidth(
    width,
    SHELL_LEFT_PANEL_WIDTH_LIMITS.min,
    SHELL_LEFT_PANEL_WIDTH_LIMITS.max,
  );
  return clamped === PREVIOUS_SHELL_LEFT_PANEL_DEFAULT_WIDTH
    ? SHELL_LEFT_PANEL_DEFAULT_WIDTH
    : clamped;
}

function resolveWorkspacePanelKey(workspaceKey: string | null): string {
  const trimmed = workspaceKey?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_CWD_KEY;
}

function readPersistedPanels(): {
  leftOpen: boolean;
  leftW: number;
  rightOpen: boolean;
  rightW: number;
  activeTab: WorkbenchTab;
  muted: boolean;
} {
  if (typeof window === "undefined") {
    return { ...DEFAULT_LEFT_PANEL_STATE, ...DEFAULT_WORKBENCH_PANEL_STATE };
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return { ...DEFAULT_LEFT_PANEL_STATE, ...DEFAULT_WORKBENCH_PANEL_STATE };
  }

  try {
    const parsed = Option.getOrElse(
      decodePersistedShellPanelsStateOption(JSON.parse(raw)),
      () => null,
    ) satisfies PersistedShellPanelsState | null;
    if (!parsed || typeof parsed !== "object") {
      return { ...DEFAULT_LEFT_PANEL_STATE, ...DEFAULT_WORKBENCH_PANEL_STATE };
    }

    return {
      leftOpen:
        typeof parsed.leftOpen === "boolean" ? parsed.leftOpen : DEFAULT_LEFT_PANEL_STATE.leftOpen,
      leftW: normalizePersistedLeftWidth(parsed.leftW),
      rightOpen: DEFAULT_WORKBENCH_PANEL_STATE.rightOpen,
      rightW: clampWidth(
        typeof parsed.rightW === "number" ? parsed.rightW : DEFAULT_WORKBENCH_PANEL_STATE.rightW,
        RIGHT_WORKBENCH_WIDTH_LIMITS.min,
        RIGHT_WORKBENCH_WIDTH_LIMITS.max,
      ),
      activeTab: parsed.activeTab ?? DEFAULT_WORKBENCH_PANEL_STATE.activeTab,
      muted: DEFAULT_WORKBENCH_PANEL_STATE.muted,
    };
  } catch {
    return { ...DEFAULT_LEFT_PANEL_STATE, ...DEFAULT_WORKBENCH_PANEL_STATE };
  }
}

function persistPanels(input: {
  leftOpen: boolean;
  leftW: number;
  rightOpen: boolean;
  rightW: number;
  activeTab: WorkbenchTab;
  muted: boolean;
}): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(input));
}

function railKey(workspaceKey: string | null, tab: WorkbenchTab): string {
  return `${resolveWorkspacePanelKey(workspaceKey)}::${tab}`;
}

function readWorkbenchState(
  states: Record<string, WorkbenchPanelState>,
  workspaceKey: string | null,
): WorkbenchPanelState {
  return states[resolveWorkspacePanelKey(workspaceKey)] ?? DEFAULT_WORKBENCH_PANEL_STATE;
}

function readPersistedRightWorkbenches(
  fallback: WorkbenchPanelState,
): Record<string, WorkbenchPanelState> {
  const defaults = { [DEFAULT_CWD_KEY]: fallback };
  if (typeof window === "undefined") return defaults;
  const raw = window.localStorage.getItem(RIGHT_WORKBENCH_STORAGE_KEY);
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") return defaults;
    const result: Record<string, WorkbenchPanelState> = { ...defaults };
    for (const [key, value] of Object.entries(parsed)) {
      const decoded = Option.getOrElse(
        decodePersistedWorkbenchPanelStateOption(value),
        () => null,
      );
      if (!decoded) continue;
      result[key] = {
        rightOpen: decoded.rightOpen ?? DEFAULT_WORKBENCH_PANEL_STATE.rightOpen,
        rightW: clampWidth(
          decoded.rightW ?? DEFAULT_WORKBENCH_PANEL_STATE.rightW,
          RIGHT_WORKBENCH_WIDTH_LIMITS.min,
          RIGHT_WORKBENCH_WIDTH_LIMITS.max,
        ),
        activeTab: decoded.activeTab ?? DEFAULT_WORKBENCH_PANEL_STATE.activeTab,
        muted: decoded.muted ?? DEFAULT_WORKBENCH_PANEL_STATE.muted,
      };
    }
    return result;
  } catch {
    return defaults;
  }
}

function persistRightWorkbenches(data: Record<string, WorkbenchPanelState>): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(RIGHT_WORKBENCH_STORAGE_KEY, JSON.stringify(data));
}

function readPersistedSecondaryRails(): Record<string, SecondaryRailState> {
  if (typeof window === "undefined") return {};
  const raw = window.localStorage.getItem(SECONDARY_RAIL_STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") return {};
    const result: Record<string, SecondaryRailState> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const decoded = Option.getOrElse(decodePersistedSecondaryRailStateOption(value), () => null);
      if (!decoded) continue;
      result[key] = {
        open: decoded.open ?? DEFAULT_SECONDARY_RAIL.open,
        width: clampWidth(
          decoded.width ?? DEFAULT_SECONDARY_RAIL.width,
          SECONDARY_RAIL_LIMITS.min,
          SECONDARY_RAIL_LIMITS.max,
        ),
      };
    }
    return result;
  } catch {
    return {};
  }
}

function persistSecondaryRails(data: Record<string, SecondaryRailState>): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SECONDARY_RAIL_STORAGE_KEY, JSON.stringify(data));
}

function cloneTerminalSessionEntry(session: TerminalSessionEntry): TerminalSessionEntry {
  return {
    id: session.id,
    label: session.label,
  };
}

function readPersistedTerminalSessions(): Record<string, TerminalSessionsState> {
  if (typeof window === "undefined") return {};
  const raw = window.localStorage.getItem(TERMINAL_SESSIONS_STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") return {};
    const result: Record<string, TerminalSessionsState> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const decoded = Option.getOrElse(
        decodePersistedTerminalSessionsStateOption(value),
        () => null,
      );
      if (!decoded?.activeId || decoded.sessions.length === 0) {
        continue;
      }
      result[key] = {
        activeId: decoded.activeId,
        sessions: decoded.sessions.map(cloneTerminalSessionEntry),
      };
    }
    return result;
  } catch {
    return {};
  }
}

function persistTerminalSessions(data: Record<string, TerminalSessionsState>): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TERMINAL_SESSIONS_STORAGE_KEY, JSON.stringify(data));
}

function arePanelStatesEqual(left: WorkbenchPanelState, right: WorkbenchPanelState): boolean {
  return (
    left.rightOpen === right.rightOpen &&
    left.rightW === right.rightW &&
    left.activeTab === right.activeTab &&
    left.muted === right.muted
  );
}

const INITIAL_PANELS = readPersistedPanels();
const INITIAL_RIGHT_WORKBENCHES = readPersistedRightWorkbenches({
  rightOpen: INITIAL_PANELS.rightOpen,
  rightW: INITIAL_PANELS.rightW,
  activeTab: INITIAL_PANELS.activeTab,
  muted: INITIAL_PANELS.muted,
});
const INITIAL_RAILS = readPersistedSecondaryRails();
const INITIAL_TERMINAL_SESSIONS = readPersistedTerminalSessions();

export const useShellPanelsStore = create<ShellPanelsStoreState>()((set) => ({
  leftOpen: INITIAL_PANELS.leftOpen,
  leftW: INITIAL_PANELS.leftW,
  rightOpen: INITIAL_PANELS.rightOpen,
  rightW: INITIAL_PANELS.rightW,
  activeTab: INITIAL_PANELS.activeTab,
  muted: INITIAL_PANELS.muted,
  rightWorkbenchByWorkspaceKey: INITIAL_RIGHT_WORKBENCHES,
  railByWorkspaceKeyAndTab: INITIAL_RAILS,
  terminalByWorkspaceKey: INITIAL_TERMINAL_SESSIONS,
  setLeftOpen: (leftOpen) => {
    set((state) => {
      if (state.leftOpen === leftOpen) {
        return state;
      }

      persistPanels({
        leftOpen,
        leftW: state.leftW,
        rightOpen: state.rightOpen,
        rightW: state.rightW,
        activeTab: state.activeTab,
        muted: state.muted,
      });
      return { leftOpen };
    });
  },
  setRightOpen: (rightOpen, workspaceKey = null) => {
    set((state) => {
      const key = resolveWorkspacePanelKey(workspaceKey);
      const current = readWorkbenchState(state.rightWorkbenchByWorkspaceKey, workspaceKey);
      const next = current.rightOpen === rightOpen ? current : { ...current, rightOpen };
      if (arePanelStatesEqual(current, next)) {
        return state;
      }

      const rightWorkbenchByWorkspaceKey = {
        ...state.rightWorkbenchByWorkspaceKey,
        [key]: next,
      };
      persistRightWorkbenches(rightWorkbenchByWorkspaceKey);
      persistPanels({ leftOpen: state.leftOpen, leftW: state.leftW, ...next });
      return { rightOpen, rightWorkbenchByWorkspaceKey };
    });
  },
  setLeftWidth: (width) => {
    set((state) => {
      const nextWidth = clampWidth(
        width,
        SHELL_LEFT_PANEL_WIDTH_LIMITS.min,
        SHELL_LEFT_PANEL_WIDTH_LIMITS.max,
      );
      if (state.leftW === nextWidth) {
        return state;
      }

      persistPanels({
        leftOpen: state.leftOpen,
        leftW: nextWidth,
        rightOpen: state.rightOpen,
        rightW: state.rightW,
        activeTab: state.activeTab,
        muted: state.muted,
      });
      return { leftW: nextWidth };
    });
  },
  setRightWidth: (width) => {
    set((state) => {
      const current = {
        rightOpen: state.rightOpen,
        rightW: state.rightW,
        activeTab: state.activeTab,
        muted: state.muted,
      };
      const nextWidth = clampWidth(
        width,
        RIGHT_WORKBENCH_WIDTH_LIMITS.min,
        RIGHT_WORKBENCH_WIDTH_LIMITS.max,
      );
      const next = current.rightW === nextWidth ? current : { ...current, rightW: nextWidth };
      if (arePanelStatesEqual(current, next)) {
        return state;
      }

      persistPanels({ leftOpen: state.leftOpen, leftW: state.leftW, ...next });
      return { rightW: nextWidth };
    });
  },
  setActiveTab: (activeTab, workspaceKey = null) => {
    set((state) => {
      const key = resolveWorkspacePanelKey(workspaceKey);
      const current = readWorkbenchState(state.rightWorkbenchByWorkspaceKey, workspaceKey);
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

      const rightWorkbenchByWorkspaceKey = {
        ...state.rightWorkbenchByWorkspaceKey,
        [key]: next,
      };
      persistRightWorkbenches(rightWorkbenchByWorkspaceKey);
      persistPanels({ leftOpen: state.leftOpen, leftW: state.leftW, ...next });
      return { activeTab, rightOpen: next.rightOpen, rightWorkbenchByWorkspaceKey };
    });
  },
  setMuted: (muted, workspaceKey = null) => {
    set((state) => {
      const key = resolveWorkspacePanelKey(workspaceKey);
      const current = readWorkbenchState(state.rightWorkbenchByWorkspaceKey, workspaceKey);
      const next = current.muted === muted ? current : { ...current, muted };
      if (arePanelStatesEqual(current, next)) {
        return state;
      }

      const rightWorkbenchByWorkspaceKey = {
        ...state.rightWorkbenchByWorkspaceKey,
        [key]: next,
      };
      persistRightWorkbenches(rightWorkbenchByWorkspaceKey);
      persistPanels({ leftOpen: state.leftOpen, leftW: state.leftW, ...next });
      return { muted, rightWorkbenchByWorkspaceKey };
    });
  },
  setSecondaryRailOpen: (workspaceKey, tab, open) => {
    set((state) => {
      const key = railKey(workspaceKey, tab);
      const current = state.railByWorkspaceKeyAndTab[key] ?? DEFAULT_SECONDARY_RAIL;
      if (current.open === open) return state;
      const railByWorkspaceKeyAndTab = {
        ...state.railByWorkspaceKeyAndTab,
        [key]: { ...current, open },
      };
      persistSecondaryRails(railByWorkspaceKeyAndTab);
      return { railByWorkspaceKeyAndTab };
    });
  },
  setSecondaryRailWidth: (workspaceKey, tab, width) => {
    set((state) => {
      const key = railKey(workspaceKey, tab);
      const current = state.railByWorkspaceKeyAndTab[key] ?? DEFAULT_SECONDARY_RAIL;
      const clamped = clampWidth(width, SECONDARY_RAIL_LIMITS.min, SECONDARY_RAIL_LIMITS.max);
      if (current.width === clamped) return state;
      const railByWorkspaceKeyAndTab = {
        ...state.railByWorkspaceKeyAndTab,
        [key]: { ...current, width: clamped },
      };
      persistSecondaryRails(railByWorkspaceKeyAndTab);
      return { railByWorkspaceKeyAndTab };
    });
  },
  setActiveTerminal: (workspaceKey, terminalId) => {
    set((state) => {
      const key = resolveWorkspacePanelKey(workspaceKey);
      const current = state.terminalByWorkspaceKey[key] ?? DEFAULT_TERMINAL_SESSIONS;
      if (current.activeId === terminalId) return state;
      if (!current.sessions.some((s) => s.id === terminalId)) return state;
      const terminalByWorkspaceKey = {
        ...state.terminalByWorkspaceKey,
        [key]: { ...current, activeId: terminalId },
      };
      persistTerminalSessions(terminalByWorkspaceKey);
      return { terminalByWorkspaceKey };
    });
  },
  addTerminalSession: (workspaceKey, session) => {
    set((state) => {
      const key = resolveWorkspacePanelKey(workspaceKey);
      const current = state.terminalByWorkspaceKey[key] ?? DEFAULT_TERMINAL_SESSIONS;
      if (current.sessions.some((s) => s.id === session.id)) return state;
      const next: TerminalSessionsState = {
        activeId: session.id,
        sessions: [...current.sessions, session],
      };
      const terminalByWorkspaceKey = { ...state.terminalByWorkspaceKey, [key]: next };
      persistTerminalSessions(terminalByWorkspaceKey);
      return { terminalByWorkspaceKey };
    });
  },
  removeTerminalSession: (workspaceKey, terminalId) => {
    set((state) => {
      const key = resolveWorkspacePanelKey(workspaceKey);
      const current = state.terminalByWorkspaceKey[key] ?? DEFAULT_TERMINAL_SESSIONS;
      const remaining = current.sessions.filter((s) => s.id !== terminalId);
      if (remaining.length === current.sessions.length) return state;
      if (remaining.length === 0) return state;
      const activeId =
        current.activeId === terminalId
          ? (remaining[Math.max(0, current.sessions.findIndex((s) => s.id === terminalId) - 1)]
              ?.id ?? remaining[0]!.id)
          : current.activeId;
      const next: TerminalSessionsState = { activeId, sessions: remaining };
      const terminalByWorkspaceKey = { ...state.terminalByWorkspaceKey, [key]: next };
      persistTerminalSessions(terminalByWorkspaceKey);
      return { terminalByWorkspaceKey };
    });
  },
}));

export function useLeftOpen(): boolean {
  return useShellPanelsStore((state) => state.leftOpen);
}

export function useRightOpen(workspaceKey?: string | null): boolean {
  return useShellPanelsStore((state) =>
    workspaceKey === undefined
      ? state.rightOpen
      : readWorkbenchState(state.rightWorkbenchByWorkspaceKey, workspaceKey).rightOpen,
  );
}

export function useLeftWidth(): number {
  return useShellPanelsStore((state) => state.leftW);
}

export function useRightWidth(): number {
  return useShellPanelsStore((state) => state.rightW);
}

export function useActiveTab(workspaceKey?: string | null): WorkbenchTab {
  return useShellPanelsStore((state) =>
    workspaceKey === undefined
      ? state.activeTab
      : readWorkbenchState(state.rightWorkbenchByWorkspaceKey, workspaceKey).activeTab,
  );
}

export function useIsMuted(workspaceKey?: string | null): boolean {
  return useShellPanelsStore((state) =>
    workspaceKey === undefined
      ? state.muted
      : readWorkbenchState(state.rightWorkbenchByWorkspaceKey, workspaceKey).muted,
  );
}

export function useSecondaryRail(workspaceKey: string | null, tab: WorkbenchTab): SecondaryRailState {
  return useShellPanelsStore(
    (state) => state.railByWorkspaceKeyAndTab[railKey(workspaceKey, tab)] ?? DEFAULT_SECONDARY_RAIL,
  );
}

export function useHasSecondaryRailState(workspaceKey: string | null, tab: WorkbenchTab): boolean {
  return useShellPanelsStore((state) => railKey(workspaceKey, tab) in state.railByWorkspaceKeyAndTab);
}

export function useTerminalSessions(workspaceKey: string | null): TerminalSessionsState {
  return useShellPanelsStore(
    (state) =>
      state.terminalByWorkspaceKey[resolveWorkspacePanelKey(workspaceKey)] ??
      DEFAULT_TERMINAL_SESSIONS,
  );
}

export function readTerminalSessions(workspaceKey: string | null): TerminalSessionsState {
  return (
    useShellPanelsStore.getState().terminalByWorkspaceKey[
      resolveWorkspacePanelKey(workspaceKey)
    ] ?? DEFAULT_TERMINAL_SESSIONS
  );
}

export const shellPanelsActions = {
  setLeftOpen: (open: boolean) => useShellPanelsStore.getState().setLeftOpen(open),
  setRightOpen: (open: boolean, workspaceKey?: string | null) =>
    useShellPanelsStore.getState().setRightOpen(open, workspaceKey),
  setLeftWidth: (width: number) => useShellPanelsStore.getState().setLeftWidth(width),
  setRightWidth: (width: number) => useShellPanelsStore.getState().setRightWidth(width),
  setActiveTab: (tab: WorkbenchTab, workspaceKey?: string | null) =>
    useShellPanelsStore.getState().setActiveTab(tab, workspaceKey),
  setMuted: (muted: boolean, workspaceKey?: string | null) =>
    useShellPanelsStore.getState().setMuted(muted, workspaceKey),
  activatePlanTab: (workspaceKey?: string | null) => {
    useShellPanelsStore.getState().setActiveTab("plan", workspaceKey);
    useShellPanelsStore.getState().setMuted(false, workspaceKey);
  },
  toggleLeft: () => {
    const current = useShellPanelsStore.getState().leftOpen;
    useShellPanelsStore.getState().setLeftOpen(!current);
  },
  toggleRight: (workspaceKey?: string | null) => {
    const state = useShellPanelsStore.getState();
    const current =
      workspaceKey === undefined
        ? state.rightOpen
        : readWorkbenchState(state.rightWorkbenchByWorkspaceKey, workspaceKey).rightOpen;
    state.setRightOpen(!current, workspaceKey);
  },
  setSecondaryRailOpen: (workspaceKey: string | null, tab: WorkbenchTab, open: boolean) =>
    useShellPanelsStore.getState().setSecondaryRailOpen(workspaceKey, tab, open),
  setSecondaryRailWidth: (workspaceKey: string | null, tab: WorkbenchTab, width: number) =>
    useShellPanelsStore.getState().setSecondaryRailWidth(workspaceKey, tab, width),
  toggleSecondaryRail: (workspaceKey: string | null, tab: WorkbenchTab) => {
    const key = railKey(workspaceKey, tab);
    const current =
      useShellPanelsStore.getState().railByWorkspaceKeyAndTab[key] ?? DEFAULT_SECONDARY_RAIL;
    useShellPanelsStore.getState().setSecondaryRailOpen(workspaceKey, tab, !current.open);
  },
  setActiveTerminal: (workspaceKey: string | null, terminalId: string) =>
    useShellPanelsStore.getState().setActiveTerminal(workspaceKey, terminalId),
  addTerminalSession: (workspaceKey: string | null, session: TerminalSessionEntry) =>
    useShellPanelsStore.getState().addTerminalSession(workspaceKey, session),
  removeTerminalSession: (workspaceKey: string | null, terminalId: string) =>
    useShellPanelsStore.getState().removeTerminalSession(workspaceKey, terminalId),
};
