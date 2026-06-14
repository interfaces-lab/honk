"use client";

import {
  IconExpandSimple,
  IconMagnifyingGlass,
  IconSidebar,
  IconSidebarHiddenLeftWide,
  IconSidebarHiddenRightWide,
} from "central-icons";
import { WorkbenchIconButton } from "@honk/honkkit/workbench-button";
import { TabsPanel, TabsRoot } from "@honk/honkkit/tabs";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { cva } from "class-variance-authority";
import {
  createContext,
  type CSSProperties,
  memo,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { isElectronHost } from "~/env";
import {
  COMMAND_PALETTE_FALLBACK_KEYBINDINGS,
  resolveShortcutCommand,
  shortcutLabelForCommand,
} from "~/keybindings";
import { syncAppearanceVibrancy } from "~/lib/appearance-settings";
import { useLayoutSyncEffect } from "~/hooks/use-layout-sync-effect";
import { useMountEffect } from "~/hooks/use-mount-effect";
import { useSettings } from "~/hooks/use-settings";
import { useServerKeybindings } from "~/rpc/server-state";
import { useCommandPaletteStore } from "~/stores/ui/command-palette-store";
import { isTerminalFocused } from "~/lib/terminal-focus";
import {
  RIGHT_WORKBENCH_WIDTH_LIMITS,
  SHELL_LEFT_PANEL_WIDTH_LIMITS,
  shellPanelsActions,
  useActiveTab,
  useIsMuted,
  useLeftOpen,
  useLeftWidth,
  useRightOpen,
  useRightWidth,
  useTerminalSessions,
} from "~/stores/shell-panels-store";
import {
  getWorkspaceFullscreenTarget,
  useWorkspaceFullscreenTarget,
  workspaceEditorActions,
} from "~/stores/workspace-editor-store";
import { isWorkbenchTab, type WorkbenchTab } from "~/lib/workbench-tabs";
import { cn } from "~/lib/utils";
import { RightWorkbenchHeader, type WorkbenchTabMeta } from "./right-workbench-header";
import {
  panelPresentation,
  resolveShellPanelModes,
  SHELL_CENTER_MIN_WIDTH,
  type ShellPanelMode,
} from "./shell-layout";
import { useColumnResize } from "./use-column-resize";
import { useShellPanelModes } from "./use-shell-layout";

const LEFT_LIMITS = SHELL_LEFT_PANEL_WIDTH_LIMITS;
const RIGHT_LIMITS = RIGHT_WORKBENCH_WIDTH_LIMITS;
const FALLBACK_WORKBENCH_TAB = "git" satisfies WorkbenchTab;

const workbenchPanelSlotVariants = cva(
  "absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden",
  {
    variants: {
      active: {
        false: "pointer-events-none invisible opacity-0",
        true: "opacity-100",
      },
    },
  },
);

export function addVisitedWorkbenchTab(
  current: ReadonlySet<WorkbenchTab>,
  activeTab: WorkbenchTab,
): ReadonlySet<WorkbenchTab> {
  if (current.has(activeTab)) {
    return current;
  }
  return new Set([...current, activeTab]);
}

export interface RightWorkbenchDefinition {
  tabs: readonly WorkbenchTabMeta[];
  panels: Partial<Record<WorkbenchTab, ReactNode>>;
}

interface RightWorkbenchPanelRuntime {
  activeTab: WorkbenchTab;
  open: boolean;
}

const RightWorkbenchPanelRuntimeContext = createContext<RightWorkbenchPanelRuntime>({
  activeTab: FALLBACK_WORKBENCH_TAB,
  open: false,
});

export function useRightWorkbenchPanelRuntime(): RightWorkbenchPanelRuntime {
  return useContext(RightWorkbenchPanelRuntimeContext);
}

type ShellRootStyle = CSSProperties & Record<`--${string}`, string>;

export interface AppShellPanels {
  leftOpen: boolean;
  rightOpen: boolean;
  setLeftOpen: (open: boolean) => void;
  setRightOpen: (open: boolean) => void;
  leftW: number;
  rightW: number;
  toggleLeft: () => void;
  toggleRight: () => void;
  setLeftWidth: (n: number) => void;
  setRightWidth: (n: number) => void;
  activeTab: WorkbenchTab;
  setActiveTab: (tab: WorkbenchTab) => void;
}

function resolveEffectiveRightOpen(input: {
  storedRightOpen: boolean;
  routeThreadId: string | null;
  gitFocusId: string | null;
  muted: boolean;
}): boolean {
  return input.storedRightOpen || Boolean(input.routeThreadId && input.gitFocusId && !input.muted);
}

function setRightPanelOpen(open: boolean, workspaceKey: string | null): void {
  shellPanelsActions.setRightOpen(open, workspaceKey);
  shellPanelsActions.setMuted(!open, workspaceKey);
}

const SHOW_RIGHT_WORKBENCH_LABEL = "Show project panel: files, Git changes, terminal, browser.";

/**
 * Crossing inline<->overlay must reposition the panel without a slide: the
 * drawer transform rules in shell.css would otherwise animate the jump. The
 * snap flag is raised during render so it commits (and paints) together with
 * the mode change; only the next-frame reset needs an effect.
 */
function useModeCrossSnap(mode: ShellPanelMode): boolean {
  const [snap, setSnap] = useState(false);
  const [previousMode, setPreviousMode] = useState(mode);
  if (previousMode !== mode) {
    setPreviousMode(mode);
    setSnap(true);
  }

  useEffect(() => {
    if (!snap) {
      return undefined;
    }
    const frame = window.requestAnimationFrame(() => setSnap(false));
    return () => window.cancelAnimationFrame(frame);
  }, [snap]);

  return snap;
}

function LeftAside(props: { children: ReactNode; mode: ShellPanelMode }) {
  const leftOpen = useLeftOpen();
  const leftWidth = useLeftWidth();
  // No fullscreen subscription. The agent list stays mounted, visible, and
  // interactive when the workbench maximizes (Cursor parity: editor maximize
  // keeps the `unifiedsidebar` agent list and only yields the center
  // conversation). So this panel never re-renders on a fullscreen toggle.
  const asideRef = useRef<HTMLElement | null>(null);
  const resize = useColumnResize({
    width: leftWidth,
    limits: LEFT_LIMITS,
    elementRef: asideRef,
    direction: "right",
    onCommit: (nextWidth) => shellPanelsActions.setLeftWidth(nextWidth),
  });
  const snapTransition = useModeCrossSnap(props.mode);
  const presentation = panelPresentation(props.mode, leftOpen);
  const hidden = !leftOpen;

  return (
    <aside
      className={cn(
        "agent-window__sidebar honk-shell-sidebar relative flex h-full shrink-0 select-none flex-col overflow-hidden border-r border-honk-stroke-tertiary",
        resize.dragging
          ? "transition-none"
          : "transition-[width] duration-(--motion-duration-panel) ease-out motion-reduce:transition-none",
      )}
      data-agent-window-sidebar=""
      data-shell-left-expanded={leftOpen ? "true" : "false"}
      data-shell-panel="left"
      data-side="left"
      data-state={leftOpen ? "expanded" : "collapsed"}
      data-resizing={resize.dragging ? "true" : "false"}
      data-transition-snap={snapTransition ? "true" : "false"}
      aria-hidden={hidden ? true : undefined}
      inert={hidden}
      ref={asideRef}
    >
      {/* Width pinned to the panel width (not w-full) so the open/close width
          animation clips like a curtain instead of rewrapping content every
          frame; w-full only while drag-resizing (inline width tracks live)
          and in overlay mode (the drawer already has its real width). */}
      <div
        aria-hidden={hidden}
        className={cn(
          "flex h-full min-h-0 w-[min(var(--honk-shell-left-width),100cqw)] flex-col transition-opacity duration-(--motion-duration-panel) ease-out in-data-[resizing=true]:w-full in-data-[shell-left-mode=overlay]:w-full motion-reduce:transition-none",
          leftOpen ? "opacity-100" : "opacity-0",
        )}
      >
        {props.children}
      </div>
      {presentation === "inline-expanded" ? (
        <div
          aria-label="Resize thread sidebar"
          aria-orientation="vertical"
          className="pointer-events-auto absolute inset-y-0 right-0 z-30 w-3 cursor-col-resize touch-none select-none outline-hidden [-webkit-app-region:no-drag] after:absolute after:inset-y-0 after:right-0 after:w-(--honk-shell-sash-stripe-width) after:rounded-px after:bg-transparent after:transition-[background-color,box-shadow] after:duration-100 after:ease-out hover:after:bg-(--honk-shell-sash-hover-shade) focus-visible:after:bg-(--honk-shell-sash-hover-shade) data-[active=true]:after:bg-(--honk-shell-sash-hover-shade) motion-reduce:after:transition-none"
          data-active={resize.dragging ? "true" : undefined}
          {...resize.sashProps}
          role="separator"
        />
      ) : null}
    </aside>
  );
}

// A single fixed icon that never swaps glyph or moves on toggle (intentionally
// simpler than Cursor's CSS toggled-state swap). It owns no fullscreen
// subscription, so toggling fullscreen never re-renders it — the layout state is
// conveyed by the reflow itself, not by this button.
const RightWorkbenchFullscreenToggle = memo(function RightWorkbenchFullscreenToggle(props: {
  workspaceKey: string | null;
  keybindings: ReturnType<typeof useServerKeybindings>;
}) {
  const shortcut = shortcutLabelForCommand(props.keybindings, "editorPanel.toggleFullscreen");
  const title = shortcut
    ? `Toggle editor panel fullscreen (${shortcut})`
    : "Toggle editor panel fullscreen";
  return (
    <WorkbenchIconButton
      aria-label="Toggle editor panel fullscreen"
      chrome="tool"
      onClick={() => workspaceEditorActions.toggleFullscreen(props.workspaceKey, "right-workbench")}
      title={title}
    >
      <IconExpandSimple className="size-4 shrink-0" aria-hidden />
    </WorkbenchIconButton>
  );
});

function RightAsideHeader(props: {
  workspaceKey: string | null;
  activeTab: WorkbenchTab;
  tabs: readonly WorkbenchTabMeta[];
  keybindings: ReturnType<typeof useServerKeybindings>;
}) {
  const { workspaceKey, keybindings } = props;
  const terminalState = useTerminalSessions(workspaceKey);
  const sessionCount = terminalState.sessions.length;

  // Stable handlers + trailing so a memoized RightWorkbenchHeader skips
  // re-rendering on unrelated shell churn (width drags, fullscreen toggles).
  const onTerminalTab = useCallback(
    (id: string) => shellPanelsActions.setActiveTerminal(workspaceKey, id),
    [workspaceKey],
  );
  const onCloseTab = useCallback(
    (tab: WorkbenchTab) => {
      if (tab === "dev") {
        shellPanelsActions.closeDevTab(workspaceKey);
      }
    },
    [workspaceKey],
  );
  const onNewTerminal = useCallback(() => {
    shellPanelsActions.addTerminalSession(workspaceKey, {
      id: `term-${Date.now()}`,
      label: `Terminal ${sessionCount + 1}`,
    });
  }, [workspaceKey, sessionCount]);
  const onCloseTerminal = useCallback(
    (id: string) => shellPanelsActions.removeTerminalSession(workspaceKey, id),
    [workspaceKey],
  );

  const trailing = useMemo(
    () => <RightWorkbenchFullscreenToggle workspaceKey={workspaceKey} keybindings={keybindings} />,
    [workspaceKey, keybindings],
  );

  return (
    <RightWorkbenchHeader
      tabs={props.tabs}
      activeTab={props.activeTab}
      terminalSessions={terminalState.sessions}
      activeTerminalId={terminalState.activeId}
      onTerminalTab={onTerminalTab}
      onCloseTab={onCloseTab}
      onNewTerminal={onNewTerminal}
      onCloseTerminal={onCloseTerminal}
      trailing={trailing}
    />
  );
}

// The <aside> shell: owns visibility (rightOpen), fullscreen, the imperative
// column resize + drag state, the sash, and the sticky mount gate. It renders
// `props.children` (the content subtree) so its own re-renders — width commit,
// fullscreen toggle, drag start/end — never re-render the content.
function RightAsideFrame(props: {
  workspaceKey: string | null;
  routeThreadId: string | null;
  gitFocusId: string | null;
  children: ReactNode;
}) {
  const storedRightOpen = useRightOpen(props.workspaceKey);
  const muted = useIsMuted(props.workspaceKey);
  const rightWidth = useRightWidth(props.workspaceKey);
  // Near-constant in steady state (undefined unless a ?panel= deep-link is
  // pending); only used to mount Content on a cold deep-link so its effect can
  // run. Does not feed rightOpen / sash / data-state.
  const pendingPanel = useSearch({
    from: "/_chat",
    shouldThrow: false,
    select: (search) => search.panel,
  });

  const rightOpen = resolveEffectiveRightOpen({
    storedRightOpen,
    routeThreadId: props.routeThreadId,
    gitFocusId: props.gitFocusId,
    muted,
  });

  // Mount the workbench on first open (or on a cold ?panel= deep-link, so the
  // content effect can run and open it), then keep it: remount churn on toggle
  // costs more than an offscreen tree, but users who never open it pay nothing.
  const shouldOpen = rightOpen || Boolean(pendingPanel);
  const [hasOpened, setHasOpened] = useState(shouldOpen);
  if (shouldOpen && !hasOpened) {
    setHasOpened(true);
  }

  const asideRef = useRef<HTMLElement | null>(null);
  const resize = useColumnResize({
    width: rightWidth,
    limits: RIGHT_LIMITS,
    elementRef: asideRef,
    direction: "left",
    onCommit: (nextWidth) => shellPanelsActions.setRightWidth(nextWidth, props.workspaceKey),
  });

  return (
    <aside
      className={cn(
        "agent-window__workbench editor-panel-container honk-shell-surface relative flex min-w-0 shrink-0 flex-col overflow-hidden border-l border-honk-workbench-panel-border-faint",
        resize.dragging
          ? "transition-none"
          : "transition-[width] duration-100 ease-[cubic-bezier(0.19,1,0.22,1)] motion-reduce:transition-none",
      )}
      data-agent-window-workbench=""
      data-shell-panel="right"
      data-side="right"
      data-state={rightOpen ? "expanded" : "collapsed"}
      data-resizing={resize.dragging ? "true" : "false"}
      ref={asideRef}
      aria-hidden={!rightOpen ? true : undefined}
      inert={!rightOpen}
    >
      {hasOpened ? props.children : null}
      {rightOpen ? (
        <div
          aria-label="Resize project panel width"
          aria-orientation="vertical"
          className="honk-shell-workbench-sash pointer-events-auto absolute inset-y-0 left-0 z-30 w-3 cursor-col-resize touch-none select-none outline-hidden [-webkit-app-region:no-drag] after:absolute after:inset-y-0 after:left-0 after:w-(--honk-shell-sash-stripe-width) after:rounded-px after:bg-transparent after:transition-[background-color,box-shadow] after:duration-100 after:ease-out hover:after:bg-(--honk-shell-sash-hover-shade) focus-visible:after:bg-(--honk-shell-sash-hover-shade) data-[active=true]:after:bg-(--honk-shell-sash-hover-shade) motion-reduce:after:transition-none"
          data-active={resize.dragging ? "true" : undefined}
          {...resize.sashProps}
          role="separator"
        />
      ) : null}
    </aside>
  );
}

// The content subtree: owns the active-tab + deep-link subscriptions, the tab
// root, header, and panels. Re-renders only on activeTab / search / open-close
// changes — never on width / fullscreen / drag (those live in the Frame).
function RightWorkbenchContent(props: {
  workspaceKey: string | null;
  right: RightWorkbenchDefinition;
  keybindings: ReturnType<typeof useServerKeybindings>;
}) {
  const storedActiveTab = useActiveTab(props.workspaceKey);
  const searchActiveTab = useSearch({
    from: "/_chat",
    shouldThrow: false,
    select: (search) => search.panel,
  });
  const navigate = useNavigate();
  const activeTab = storedActiveTab;
  const visibleTabs = useMemo(
    () => new Set(props.right.tabs.map((tab) => tab.id)),
    [props.right.tabs],
  );
  const effectiveActiveTab = visibleTabs.has(activeTab) ? activeTab : FALLBACK_WORKBENCH_TAB;

  const handleWorkbenchTabChange = (value: unknown) => {
    if (!isWorkbenchTab(value)) {
      return;
    }
    if (!visibleTabs.has(value)) {
      return;
    }
    // setActiveTab / setMuted de-dupe internally (no-op when unchanged), so no
    // local muted early-out is needed.
    shellPanelsActions.setActiveTab(value, props.workspaceKey);
    shellPanelsActions.setMuted(false, props.workspaceKey);
  };

  useEffect(() => {
    if (!searchActiveTab) {
      return;
    }
    if (visibleTabs.has(searchActiveTab)) {
      shellPanelsActions.setActiveTab(searchActiveTab, props.workspaceKey);
      shellPanelsActions.setMuted(false, props.workspaceKey);
    }
    void navigate({
      replace: true,
      to: ".",
      search: ({ panel: _panel, ...search }) => search,
    });
  }, [navigate, props.workspaceKey, searchActiveTab, visibleTabs]);

  // `open` is sticky: this subtree only mounts once the Frame has opened and is
  // never unmounted on collapse, so `open` is constant `true` for its lifetime
  // (identical semantics to the former `open: hasOpened`). Collapsing must not
  // disable panel queries, or every expand refetches and replays its skeleton.
  const runtimeValue: RightWorkbenchPanelRuntime = useMemo(
    () => ({ activeTab: effectiveActiveTab, open: true }),
    [effectiveActiveTab],
  );

  return (
    <RightWorkbenchPanelRuntimeContext.Provider value={runtimeValue}>
      {/* Width pinned like the sidebar body: the open/close width
          animation clips instead of reflowing the panel content. */}
      <TabsRoot
        value={effectiveActiveTab}
        onValueChange={handleWorkbenchTabChange}
        className="agent-window__workbench-body relative z-10 flex h-full min-h-0 w-[min(var(--honk-shell-right-workbench-width),100cqw)] flex-col bg-(--honk-workbench-editor-surface-background) opacity-100 in-data-[resizing=true]:w-full"
      >
        <RightAsideHeader
          workspaceKey={props.workspaceKey}
          activeTab={effectiveActiveTab}
          tabs={props.right.tabs}
          keybindings={props.keybindings}
        />
        <RightAsidePanels
          key={props.workspaceKey ?? "none"}
          activeTab={effectiveActiveTab}
          right={props.right}
          workspaceKey={props.workspaceKey ?? "none"}
        />
      </TabsRoot>
    </RightWorkbenchPanelRuntimeContext.Provider>
  );
}

// Composition root: subscribes to NOTHING volatile. It only builds the stable
// `content` element and hands it to the Frame, which renders it as
// `props.children` — so the Frame's own re-renders (width commit, fullscreen
// toggle, drag start/end) never touch `content`'s identity and Content stays
// insulated.
//
// INVARIANT — DO NOT ADD A VOLATILE HOOK HERE. RightAside is rendered inline
// inside the churny AppShell (which re-renders on width/open/mute), so it is
// React.memo-wrapped to skip those re-renders, and `content` is useMemo'd so
// its identity survives any incidental render. Adding useRightOpen /
// useActiveTab / useSearch / useState here would rebuild `content` and collapse
// the children-stability bailout.
const RightAside = memo(function RightAside(props: {
  cwd: string | null;
  workspaceKey: string | null;
  right: RightWorkbenchDefinition;
  routeThreadId: string | null;
  gitFocusId: string | null;
  keybindings: ReturnType<typeof useServerKeybindings>;
}) {
  const content = useMemo(
    () => (
      <RightWorkbenchContent
        workspaceKey={props.workspaceKey}
        right={props.right}
        keybindings={props.keybindings}
      />
    ),
    [props.workspaceKey, props.right, props.keybindings],
  );

  return (
    <RightAsideFrame
      workspaceKey={props.workspaceKey}
      routeThreadId={props.routeThreadId}
      gitFocusId={props.gitFocusId}
    >
      {content}
    </RightAsideFrame>
  );
});

function RightAsidePanels(props: {
  activeTab: WorkbenchTab;
  right: RightWorkbenchDefinition;
  workspaceKey: string;
}) {
  const [mountedTabs, setMountedTabs] = useState<ReadonlySet<WorkbenchTab>>(
    () => new Set([props.activeTab]),
  );

  useEffect(() => {
    setMountedTabs((current) => addVisitedWorkbenchTab(current, props.activeTab));
  }, [props.activeTab]);

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
      {props.right.tabs.map((tab) => {
        const panel = mountedTabs.has(tab.id) ? (props.right.panels[tab.id] ?? null) : null;
        return (
          <TabsPanel
            key={`${tab.id}:${props.workspaceKey}`}
            value={tab.id}
            keepMounted
            className={(state) => workbenchPanelSlotVariants({ active: !state.hidden })}
            data-workbench-panel={tab.id}
            data-workbench-panel-active={tab.id === props.activeTab ? "true" : "false"}
          >
            {panel}
          </TabsPanel>
        );
      })}
    </div>
  );
}

function ShellHeaderControls(props: {
  showRight: boolean;
  workspaceKey: string | null;
  routeThreadId: string | null;
  gitFocusId: string | null;
}) {
  const leftOpen = useLeftOpen();
  const storedRightOpen = useRightOpen(props.workspaceKey);
  const muted = useIsMuted(props.workspaceKey);
  const setCommandPaletteOpen = useCommandPaletteStore((store) => store.setOpen);
  const keybindings = useServerKeybindings();
  // No fullscreen subscription here. The controls stay mounted across a
  // fullscreen toggle (Cursor never unmounts its titlebar) and are hidden
  // purely by CSS off the shell root's data-shell-fullscreen-target attribute.
  // Subscribing would re-render the whole topbar on every toggle.
  const rightOpen = resolveEffectiveRightOpen({
    storedRightOpen,
    routeThreadId: props.routeThreadId,
    gitFocusId: props.gitFocusId,
    muted,
  });

  const activeKeybindings =
    keybindings.length > 0 ? keybindings : COMMAND_PALETTE_FALLBACK_KEYBINDINGS;
  const commandPaletteShortcutLabel = shortcutLabelForCommand(
    activeKeybindings,
    "commandPalette.toggle",
  );
  const commandPaletteTitle = commandPaletteShortcutLabel
    ? `Search (${commandPaletteShortcutLabel})`
    : "Search";
  const rightPanelLabel = rightOpen ? "Hide project panel" : SHOW_RIGHT_WORKBENCH_LABEL;

  return (
    <div className="honk-shell-titlebar-controls pointer-events-none absolute top-0 right-0 left-0 z-(--z-index-shell-titlebar-controls) box-border flex h-(--honk-header-height) min-w-0 items-center">
      <div className="honk-shell-titlebar-left-controls pointer-events-auto no-drag absolute flex h-(--honk-titlebar-control-height) shrink-0 items-center gap-0.5">
        <button
          type="button"
          onClick={() => shellPanelsActions.toggleLeft()}
          className="flex h-(--honk-titlebar-control-height) w-(--honk-titlebar-control-height) shrink-0 items-center justify-center rounded-honk-control bg-transparent p-0 text-honk-fg-secondary transition-[background-color,color,transform] hover:bg-honk-bg-quaternary hover:text-honk-fg-primary active:scale-[0.96] [&_svg]:block"
          aria-label={leftOpen ? "Collapse chats" : "Expand chats"}
        >
          {leftOpen ? (
            <IconSidebarHiddenLeftWide className="size-4 shrink-0" />
          ) : (
            <IconSidebar className="size-4 shrink-0" />
          )}
        </button>
        <button
          type="button"
          onClick={() => setCommandPaletteOpen(true)}
          className="flex h-(--honk-titlebar-control-height) w-(--honk-titlebar-control-height) shrink-0 items-center justify-center rounded-honk-control bg-transparent p-0 text-honk-fg-secondary transition-[background-color,color,transform] hover:bg-honk-bg-quaternary hover:text-honk-fg-primary active:scale-[0.94] [&_svg]:block"
          aria-label="Search"
          title={commandPaletteTitle}
        >
          <IconMagnifyingGlass className="size-3.5 shrink-0" />
        </button>
      </div>
      {props.showRight ? (
        <div className="honk-shell-titlebar-right-toggle pointer-events-auto no-drag absolute z-40 flex h-(--honk-titlebar-control-height) shrink-0 items-center">
          <button
            type="button"
            onClick={() => setRightPanelOpen(!rightOpen, props.workspaceKey)}
            className="flex h-(--honk-titlebar-control-height) w-(--honk-titlebar-control-height) shrink-0 items-center justify-center rounded-honk-control bg-transparent p-0 text-honk-fg-secondary transition-[background-color,color,transform] hover:bg-honk-bg-quaternary hover:text-honk-fg-primary active:scale-[0.96] [&_svg]:block"
            aria-label={rightPanelLabel}
            aria-pressed={rightOpen}
            title={rightPanelLabel}
          >
            {rightOpen ? (
              <IconSidebarHiddenRightWide className="size-4 shrink-0" />
            ) : (
              <IconSidebar className="size-4 shrink-0" />
            )}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The chat center region. The maximized workbench reflows over it, so its
 * `inert`/`aria-hidden` are flipped imperatively by ShellFullscreenLayer (via
 * `centerRef`) rather than from a fullscreen subscription here. That way a
 * fullscreen toggle re-renders no chrome at all; only the null layer reacts.
 */
function ShellCenterRegion(props: {
  centerRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  return (
    <main
      ref={props.centerRef}
      className="agent-window__center flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-(--honk-shell-center-surface-background) outline-hidden"
      data-component="chat-panel"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden outline-hidden">
        {props.children}
      </div>
    </main>
  );
}

/**
 * Single owner of the right-workbench fullscreen transition. On toggle this is
 * the ONLY chrome that reacts: it re-renders to null and runs one
 * layout-synchronous effect that flips the root `data-shell-fullscreen-target`
 * attribute and the center's `inert`/`aria-hidden`. Every visual change then
 * follows from CSS off that attribute. This mirrors Cursor, which flips a root
 * class synchronously with the grid reflow and never re-renders its chrome.
 *
 * The write is layout-synchronous (pre-paint), not a passive effect: a passive
 * `useEffect` would set the attribute one frame late, so the CSS reflow would
 * not match for that frame and the layout would lag a frame behind the toggle.
 */
function ShellFullscreenLayer(props: {
  rootRef: RefObject<HTMLDivElement | null>;
  centerRef: RefObject<HTMLElement | null>;
  workspaceKey: string | null;
  rightOpen: boolean;
}) {
  const fullscreenTarget = useWorkspaceFullscreenTarget(props.workspaceKey);
  const active = props.rightOpen && fullscreenTarget === "right-workbench";
  useLayoutSyncEffect(() => {
    const root = props.rootRef.current;
    const center = props.centerRef.current;
    if (root) {
      root.dataset.shellFullscreenTarget = active ? "right-workbench" : "none";
    }
    if (center) {
      center.inert = active;
      if (active) {
        center.setAttribute("aria-hidden", "true");
      } else {
        center.removeAttribute("aria-hidden");
      }
    }
    return () => {
      if (root) {
        root.dataset.shellFullscreenTarget = "none";
      }
      if (center) {
        center.inert = false;
        center.removeAttribute("aria-hidden");
      }
    };
  }, [active, props.rootRef, props.centerRef]);
  return null;
}

export function AppShell(props: {
  cwd: string | null;
  workspaceKey?: string | null;
  left: ReactNode;
  center: ReactNode;
  right: RightWorkbenchDefinition | null;
  centerSurface?: "chat" | "editor";
  routeThreadId?: string | null;
  gitFocusId?: string | null;
}) {
  const electron = isElectronHost();
  const showRight = props.right !== null;
  const workspaceKey = props.workspaceKey ?? null;
  const leftOpen = useLeftOpen();
  const leftWidth = useLeftWidth();
  const storedRightOpen = useRightOpen(workspaceKey);
  const rightWidth = useRightWidth(workspaceKey);
  const muted = useIsMuted(workspaceKey);
  const keybindings = useServerKeybindings();
  const agentWindowFontSmoothingAntialiased = useSettings(
    (settings) => settings.agentWindowFontSmoothingAntialiased,
  );
  const shellRightOpen =
    showRight &&
    resolveEffectiveRightOpen({
      storedRightOpen,
      routeThreadId: props.routeThreadId ?? null,
      gitFocusId: props.gitFocusId ?? null,
      muted,
    });
  // Fullscreen is intentionally NOT read here: AppShell sits atop the shell
  // tree, so subscribing would re-render every chrome panel on each toggle.
  // Only the panels' inert flags and the null-rendering ShellFullscreenLayer
  // (which flips the root data attribute) subscribe individually. The topbar
  // controls stay mounted; the visual change is pure CSS off that attribute.
  const agentWindowRef = useRef<HTMLDivElement | null>(null);
  const centerRef = useRef<HTMLElement | null>(null);
  const modes = useShellPanelModes(agentWindowRef);
  const leftPresentation = panelPresentation(modes.left, leftOpen);
  const overlayActive = leftPresentation === "overlay-expanded";

  useEffect(() => {
    if (!overlayActive) {
      return undefined;
    }
    const closeOverlay = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) {
        return;
      }
      shellPanelsActions.setLeftOpen(false);
    };
    window.addEventListener("keydown", closeOverlay);
    return () => window.removeEventListener("keydown", closeOverlay);
  }, [overlayActive]);

  // Always-registered; reads fullscreen state at event time so AppShell never
  // subscribes (and never re-renders on a fullscreen toggle). Bubble phase (not
  // capture) so menus/dialogs inside the fullscreen panel consume Escape first
  // — they stop propagation / preventDefault, so only an otherwise-unhandled
  // Escape reaches here and exits fullscreen. `route.back` is not bound in the
  // chat shell, so there is nothing to out-race.
  useEffect(() => {
    const exitFullscreen = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || isTerminalFocused()) {
        return;
      }
      if (getWorkspaceFullscreenTarget(workspaceKey) === "none") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      workspaceEditorActions.exitFullscreen(workspaceKey);
    };
    window.addEventListener("keydown", exitFullscreen);
    return () => window.removeEventListener("keydown", exitFullscreen);
  }, [workspaceKey]);

  useEffect(() => {
    const toggleFullscreen = (event: KeyboardEvent) => {
      if (event.defaultPrevented || useCommandPaletteStore.getState().open) {
        return;
      }
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen: false,
        },
      });
      if (command !== "editorPanel.toggleFullscreen" || !shellRightOpen) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      workspaceEditorActions.toggleFullscreen(workspaceKey, "right-workbench");
    };
    window.addEventListener("keydown", toggleFullscreen);
    return () => window.removeEventListener("keydown", toggleFullscreen);
  }, [keybindings, shellRightOpen, workspaceKey]);

  // Cursor parity: a workbench that cannot fit grows the OS window by the
  // deficit so it force-expands without crushing the chat column. Fires when
  // the panel opens and once on mount when it is already open — never while
  // it stays open, so sash drags and user window-shrinks are not fought.
  const hadShellRightOpenRef = useRef(false);
  useEffect(() => {
    const wasOpen = hadShellRightOpenRef.current;
    hadShellRightOpenRef.current = shellRightOpen;
    if (!shellRightOpen || wasOpen || !electron) {
      return;
    }
    const shellWidth = agentWindowRef.current?.getBoundingClientRect().width ?? 0;
    if (shellWidth <= 0) {
      return;
    }
    // Resolve the sidebar's flow width from the live measurement: the
    // observed mode state can lag a frame behind at mount.
    const leftInline = leftOpen && resolveShellPanelModes(shellWidth).left === "inline";
    const deficit = (leftInline ? leftWidth : 0) + rightWidth + SHELL_CENTER_MIN_WIDTH - shellWidth;
    if (deficit > 0) {
      void window.desktopBridge?.expandWindowWidth?.(deficit);
    }
  }, [shellRightOpen, electron, leftOpen, leftWidth, rightWidth]);

  const shellStyle: ShellRootStyle = {
    "--honk-shell-left-width": `${leftWidth}px`,
    "--honk-shell-left-collapsed-width": "0px",
    "--honk-shell-left-min-width": `${LEFT_LIMITS.min}px`,
    "--honk-shell-left-max-width": `${LEFT_LIMITS.max}px`,
    "--honk-shell-right-workbench-width": `${rightWidth}px`,
    "--honk-shell-right-workbench-collapsed-width": "0px",
    "--honk-shell-right-workbench-min-width": `${RIGHT_LIMITS.min}px`,
    "--honk-shell-right-workbench-max-width": `${RIGHT_LIMITS.max}px`,
    "--honk-shell-titlebar-control-size": "var(--honk-titlebar-control-height)",
    "--honk-shell-titlebar-control-y": "var(--honk-titlebar-control-row-top)",
    "--honk-shell-titlebar-gutter": "8px",
  };

  useMountEffect(() => {
    const previousValue = document.body.getAttribute("data-honk-glass-mode");
    document.body.setAttribute("data-honk-glass-mode", "true");
    syncAppearanceVibrancy();
    return () => {
      if (previousValue === null) {
        document.body.removeAttribute("data-honk-glass-mode");
      } else {
        document.body.setAttribute("data-honk-glass-mode", previousValue);
      }
      syncAppearanceVibrancy();
    };
  });

  return (
    <div
      className="agent-window relative flex h-full min-h-0 w-full min-w-0 flex-1 flex-row overflow-x-clip bg-transparent"
      data-component="root"
      data-agent-window=""
      data-shell-left-intent={leftOpen ? "expanded" : "collapsed"}
      data-shell-right-intent={shellRightOpen ? "expanded" : "collapsed"}
      data-shell-left-mode={modes.left}
      data-shell-secondary-rail-mode={modes.secondaryRail}
      data-shell-left-presentation={leftPresentation}
      data-shell-right-panel={showRight ? "true" : "false"}
      data-shell-right-open={shellRightOpen ? "true" : "false"}
      data-shell-center-surface={props.centerSurface ?? "chat"}
      data-shell-platform={electron ? "electron" : "web"}
      data-shell-chrome="surface"
      data-agent-window-font-smoothing={
        agentWindowFontSmoothingAntialiased ? "antialiased" : "subpixel"
      }
      style={shellStyle}
      ref={agentWindowRef}
    >
      <ShellFullscreenLayer
        rootRef={agentWindowRef}
        centerRef={centerRef}
        workspaceKey={workspaceKey}
        rightOpen={shellRightOpen}
      />
      <LeftAside mode={modes.left}>{props.left}</LeftAside>

      <div className="flex h-full min-h-0 min-w-0 w-full flex-1 flex-col">
        <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-row">
          <ShellCenterRegion centerRef={centerRef}>{props.center}</ShellCenterRegion>

          {showRight && props.right ? (
            <RightAside
              cwd={props.cwd}
              workspaceKey={workspaceKey}
              right={props.right}
              routeThreadId={props.routeThreadId ?? null}
              gitFocusId={props.gitFocusId ?? null}
              keybindings={keybindings}
            />
          ) : null}
        </div>
      </div>

      <div
        aria-hidden
        data-shell-overlay-backdrop=""
        className={cn(
          "absolute inset-0 z-(--z-index-shell-overlay-backdrop) bg-black/32 backdrop-blur-sm transition-opacity duration-(--motion-duration-drawer) ease-out motion-reduce:transition-none",
          overlayActive ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={() => shellPanelsActions.setLeftOpen(false)}
      />

      <ShellHeaderControls
        showRight={showRight}
        workspaceKey={workspaceKey}
        routeThreadId={props.routeThreadId ?? null}
        gitFocusId={props.gitFocusId ?? null}
      />
    </div>
  );
}
