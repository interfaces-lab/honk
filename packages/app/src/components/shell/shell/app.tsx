"use client";

import {
  IconMagnifyingGlass,
  IconSidebar,
  IconSidebarHiddenLeftWide,
  IconSidebarHiddenRightWide,
} from "central-icons";
import { TabsPanel, TabsRoot } from "@multi/multikit/tabs";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { cva } from "class-variance-authority";
import {
  createContext,
  type CSSProperties,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { isElectronHost } from "~/env";
import { COMMAND_PALETTE_FALLBACK_KEYBINDINGS, shortcutLabelForCommand } from "~/keybindings";
import { syncAppearanceVibrancy } from "~/lib/appearance-settings";
import { useMountEffect } from "~/hooks/use-mount-effect";
import { useSettings } from "~/hooks/use-settings";
import { useServerKeybindings } from "~/rpc/server-state";
import { useCommandPaletteStore } from "~/stores/ui/command-palette-store";
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

  return (
    <aside
      className={cn(
        "agent-window__sidebar multi-shell-sidebar relative flex h-full shrink-0 select-none flex-col overflow-hidden border-r border-multi-stroke-tertiary",
        resize.dragging
          ? "transition-none"
          : "transition-[width] duration-150 ease-out motion-reduce:transition-none",
      )}
      data-agent-window-sidebar=""
      data-shell-left-expanded={leftOpen ? "true" : "false"}
      data-shell-panel="left"
      data-side="left"
      data-state={leftOpen ? "expanded" : "collapsed"}
      data-resizing={resize.dragging ? "true" : "false"}
      data-transition-snap={snapTransition ? "true" : "false"}
      aria-hidden={!leftOpen ? true : undefined}
      inert={!leftOpen}
      ref={asideRef}
    >
      {/* Width pinned to the panel width (not w-full) so the open/close width
          animation clips like a curtain instead of rewrapping content every
          frame; w-full only while drag-resizing (inline width tracks live)
          and in overlay mode (the drawer already has its real width). */}
      <div
        aria-hidden={!leftOpen}
        className={cn(
          "flex h-full min-h-0 w-[min(var(--multi-shell-left-width),100cqw)] flex-col transition-opacity duration-150 ease-out in-data-[resizing=true]:w-full in-data-[shell-left-mode=overlay]:w-full motion-reduce:transition-none",
          leftOpen ? "opacity-100" : "opacity-0",
        )}
      >
        {props.children}
      </div>
      {presentation === "inline-expanded" ? (
        <div
          aria-label="Resize thread sidebar"
          aria-orientation="vertical"
          className="pointer-events-auto absolute inset-y-0 right-0 z-30 w-3 cursor-col-resize touch-none select-none outline-hidden [-webkit-app-region:no-drag] after:absolute after:inset-y-0 after:right-0 after:w-(--multi-shell-sash-stripe-width) after:rounded-px after:bg-transparent after:transition-[background-color,box-shadow] after:duration-100 after:ease-out hover:after:bg-(--multi-shell-sash-hover-shade) focus-visible:after:bg-(--multi-shell-sash-hover-shade) data-[active=true]:after:bg-(--multi-shell-sash-hover-shade) motion-reduce:after:transition-none"
          data-active={resize.dragging ? "true" : undefined}
          {...resize.sashProps}
          role="separator"
        />
      ) : null}
    </aside>
  );
}

function RightAsideHeader(props: {
  workspaceKey: string | null;
  activeTab: WorkbenchTab;
  tabs: readonly WorkbenchTabMeta[];
}) {
  const terminalState = useTerminalSessions(props.workspaceKey);

  return (
    <RightWorkbenchHeader
      tabs={props.tabs}
      activeTab={props.activeTab}
      terminalSessions={terminalState.sessions}
      activeTerminalId={terminalState.activeId}
      onTerminalTab={(id) => shellPanelsActions.setActiveTerminal(props.workspaceKey, id)}
      onCloseTab={(tab) => {
        if (tab === "dev") {
          shellPanelsActions.closeDevTab(props.workspaceKey);
        }
      }}
      onNewTerminal={() => {
        const id = `term-${Date.now()}`;
        shellPanelsActions.addTerminalSession(props.workspaceKey, {
          id,
          label: `Terminal ${terminalState.sessions.length + 1}`,
        });
      }}
      onCloseTerminal={(id) => shellPanelsActions.removeTerminalSession(props.workspaceKey, id)}
    />
  );
}

function RightAside(props: {
  cwd: string | null;
  workspaceKey: string | null;
  right: RightWorkbenchDefinition;
  routeThreadId: string | null;
  gitFocusId: string | null;
}) {
  const storedRightOpen = useRightOpen(props.workspaceKey);
  const rightWidth = useRightWidth(props.workspaceKey);
  const storedActiveTab = useActiveTab(props.workspaceKey);
  const searchActiveTab = useSearch({
    from: "/_chat",
    shouldThrow: false,
    select: (search) => search.panel,
  });
  const navigate = useNavigate();
  const activeTab = storedActiveTab;
  const muted = useIsMuted(props.workspaceKey);
  const visibleTabs = useMemo(
    () => new Set(props.right.tabs.map((tab) => tab.id)),
    [props.right.tabs],
  );
  const effectiveActiveTab = visibleTabs.has(activeTab) ? activeTab : FALLBACK_WORKBENCH_TAB;
  const rightOpen = resolveEffectiveRightOpen({
    storedRightOpen,
    routeThreadId: props.routeThreadId,
    gitFocusId: props.gitFocusId,
    muted,
  });
  // Mount the workbench on first open, then keep it: remount churn on toggle
  // costs more than an offscreen tree, but users who never open it pay nothing.
  const [hasOpened, setHasOpened] = useState(rightOpen);
  if (rightOpen && !hasOpened) {
    setHasOpened(true);
  }

  const handleWorkbenchTabChange = (value: unknown) => {
    if (!isWorkbenchTab(value)) {
      return;
    }
    if (!visibleTabs.has(value)) {
      return;
    }
    if (activeTab === value && !muted) {
      return;
    }
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

  const asideRef = useRef<HTMLElement | null>(null);
  const resize = useColumnResize({
    width: rightWidth,
    limits: RIGHT_LIMITS,
    elementRef: asideRef,
    direction: "left",
    onCommit: (nextWidth) => shellPanelsActions.setRightWidth(nextWidth, props.workspaceKey),
  });

  // `open` is sticky: collapsing must not disable panel queries, or every
  // expand refetches and replays its loading skeleton mid-animation.
  const runtimeValue: RightWorkbenchPanelRuntime = {
    activeTab: effectiveActiveTab,
    open: hasOpened,
  };

  return (
    <aside
      className={cn(
        "agent-window__workbench editor-panel-container multi-shell-surface relative flex min-w-0 shrink-0 flex-col overflow-hidden border-l border-multi-workbench-panel-border-faint",
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
      {hasOpened ? (
        <RightWorkbenchPanelRuntimeContext.Provider value={runtimeValue}>
          {/* Width pinned like the sidebar body: the open/close width
              animation clips instead of reflowing the panel content. */}
          <TabsRoot
            value={effectiveActiveTab}
            onValueChange={handleWorkbenchTabChange}
            className="relative z-10 flex h-full min-h-0 w-[min(var(--multi-shell-right-workbench-width),100cqw)] flex-col bg-(--multi-workbench-editor-surface-background) opacity-100 in-data-[resizing=true]:w-full"
          >
            <RightAsideHeader
              workspaceKey={props.workspaceKey}
              activeTab={effectiveActiveTab}
              tabs={props.right.tabs}
            />
            <RightAsidePanels
              key={props.workspaceKey ?? "none"}
              activeTab={effectiveActiveTab}
              right={props.right}
              workspaceKey={props.workspaceKey ?? "none"}
            />
          </TabsRoot>
          {rightOpen ? (
            <div
              aria-label="Resize project panel width"
              aria-orientation="vertical"
              className="pointer-events-auto absolute inset-y-0 left-0 z-30 w-3 cursor-col-resize touch-none select-none outline-hidden [-webkit-app-region:no-drag] after:absolute after:inset-y-0 after:left-0 after:w-(--multi-shell-sash-stripe-width) after:rounded-px after:bg-transparent after:transition-[background-color,box-shadow] after:duration-100 after:ease-out hover:after:bg-(--multi-shell-sash-hover-shade) focus-visible:after:bg-(--multi-shell-sash-hover-shade) data-[active=true]:after:bg-(--multi-shell-sash-hover-shade) motion-reduce:after:transition-none"
              data-active={resize.dragging ? "true" : undefined}
              {...resize.sashProps}
              role="separator"
            />
          ) : null}
        </RightWorkbenchPanelRuntimeContext.Provider>
      ) : null}
    </aside>
  );
}

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
    <div className="multi-shell-titlebar-controls pointer-events-none absolute top-0 right-0 left-0 z-(--z-index-shell-titlebar-controls) box-border flex h-(--multi-header-height) min-w-0 items-center">
      <div className="multi-shell-titlebar-left-controls pointer-events-auto no-drag absolute flex h-(--multi-titlebar-control-height) shrink-0 items-center gap-0.5">
        <button
          type="button"
          onClick={() => shellPanelsActions.toggleLeft()}
          className="flex h-(--multi-titlebar-control-height) w-(--multi-titlebar-control-height) shrink-0 items-center justify-center rounded-multi-control bg-transparent p-0 text-multi-fg-secondary transition-[background-color,color,transform] hover:bg-multi-bg-quaternary hover:text-multi-fg-primary active:scale-[0.96] [&_svg]:block"
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
          className="flex h-(--multi-titlebar-control-height) w-(--multi-titlebar-control-height) shrink-0 items-center justify-center rounded-multi-control bg-transparent p-0 text-multi-fg-secondary transition-[background-color,color,transform] hover:bg-multi-bg-quaternary hover:text-multi-fg-primary active:scale-[0.94] [&_svg]:block"
          aria-label="Search"
          title={commandPaletteTitle}
        >
          <IconMagnifyingGlass className="size-3.5 shrink-0" />
        </button>
      </div>
      {props.showRight ? (
        <div className="multi-shell-titlebar-right-toggle pointer-events-auto no-drag absolute z-40 flex h-(--multi-titlebar-control-height) shrink-0 items-center">
          <button
            type="button"
            onClick={() => setRightPanelOpen(!rightOpen, props.workspaceKey)}
            className="flex h-(--multi-titlebar-control-height) w-(--multi-titlebar-control-height) shrink-0 items-center justify-center rounded-multi-control bg-transparent p-0 text-multi-fg-secondary transition-[background-color,color,transform] hover:bg-multi-bg-quaternary hover:text-multi-fg-primary active:scale-[0.96] [&_svg]:block"
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
  const agentWindowRef = useRef<HTMLDivElement | null>(null);
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
    "--multi-shell-left-width": `${leftWidth}px`,
    "--multi-shell-left-collapsed-width": "0px",
    "--multi-shell-left-min-width": `${LEFT_LIMITS.min}px`,
    "--multi-shell-left-max-width": `${LEFT_LIMITS.max}px`,
    "--multi-shell-right-workbench-width": `${rightWidth}px`,
    "--multi-shell-right-workbench-collapsed-width": "0px",
    "--multi-shell-right-workbench-min-width": `${RIGHT_LIMITS.min}px`,
    "--multi-shell-right-workbench-max-width": `${RIGHT_LIMITS.max}px`,
    "--multi-shell-titlebar-control-size": "var(--multi-titlebar-control-height)",
    "--multi-shell-titlebar-control-y": "var(--multi-titlebar-control-row-top)",
    "--multi-shell-titlebar-gutter": "8px",
  };

  useMountEffect(() => {
    const previousValue = document.body.getAttribute("data-multi-glass-mode");
    document.body.setAttribute("data-multi-glass-mode", "true");
    syncAppearanceVibrancy();
    return () => {
      if (previousValue === null) {
        document.body.removeAttribute("data-multi-glass-mode");
      } else {
        document.body.setAttribute("data-multi-glass-mode", previousValue);
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
      <LeftAside mode={modes.left}>{props.left}</LeftAside>

      <div className="flex h-full min-h-0 min-w-0 w-full flex-1 flex-col">
        <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-row">
          <main
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-(--multi-shell-center-surface-background) outline-hidden"
            data-component="chat-panel"
          >
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden outline-hidden">
              {props.center}
            </div>
          </main>

          {showRight && props.right ? (
            <RightAside
              cwd={props.cwd}
              workspaceKey={workspaceKey}
              right={props.right}
              routeThreadId={props.routeThreadId ?? null}
              gitFocusId={props.gitFocusId ?? null}
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
