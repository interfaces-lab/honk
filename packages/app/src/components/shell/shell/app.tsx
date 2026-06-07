"use client";

import { IconSidebar, IconSidebarHiddenLeftWide, IconSidebarHiddenRightWide } from "central-icons";
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
import { syncAppearanceVibrancy } from "~/lib/appearance-settings";
import { useMountEffect } from "~/hooks/use-mount-effect";
import { useSettings } from "~/hooks/use-settings";
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
import { useColumnResize } from "./use-column-resize";

const LEFT_LIMITS = SHELL_LEFT_PANEL_WIDTH_LIMITS;
const RIGHT_LIMITS = RIGHT_WORKBENCH_WIDTH_LIMITS;
const FALLBACK_WORKBENCH_TAB = "git" satisfies WorkbenchTab;

const workbenchPanelSlotVariants = cva(
  "absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden",
  {
    variants: {
      active: {
        false: "pointer-events-none invisible opacity-0",
        // No explicit `visible`: the active panel inherits visibility from the
        // aside so it stays hidden when the workbench collapses
        // (`.agent-window__workbench[data-state="collapsed"]`). Forcing
        // `visibility: visible` here would escape that collapse and leave the
        // panel's (opaque) background painted as a frozen layer.
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

const SHOW_RIGHT_WORKBENCH_LABEL = "Show project panel — files, Git changes, terminal.";

function LeftAside(props: { children: ReactNode }) {
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
      aria-hidden={!leftOpen ? true : undefined}
      inert={!leftOpen}
      ref={asideRef}
    >
      <div
        aria-hidden={!leftOpen}
        className={cn(
          "flex h-full min-h-0 w-full flex-col transition-opacity duration-150 ease-out motion-reduce:transition-none",
          leftOpen ? "opacity-100" : "opacity-0",
        )}
      >
        {props.children}
      </div>
      {leftOpen ? (
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
  const rightWidth = useRightWidth();
  const storedActiveTab = useActiveTab(props.workspaceKey);
  const searchActiveTab = useSearch({
    from: "/_chat",
    shouldThrow: false,
    select: (search) => search.panel,
  });
  const navigate = useNavigate();
  const activeTab = storedActiveTab;
  const muted = useIsMuted(props.workspaceKey);
  const visibleTabs = useMemo(() => new Set(props.right.tabs.map((tab) => tab.id)), [props.right.tabs]);
  const effectiveActiveTab = visibleTabs.has(activeTab) ? activeTab : FALLBACK_WORKBENCH_TAB;
  const rightOpen = resolveEffectiveRightOpen({
    storedRightOpen,
    routeThreadId: props.routeThreadId,
    gitFocusId: props.gitFocusId,
    muted,
  });
  const [snapTransition, setSnapTransition] = useState(false);
  const previousRightOpenRef = useRef(rightOpen);

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
    onCommit: (nextWidth) => shellPanelsActions.setRightWidth(nextWidth),
  });

  useEffect(() => {
    if (previousRightOpenRef.current === rightOpen) {
      return undefined;
    }
    previousRightOpenRef.current = rightOpen;
    setSnapTransition(true);
    const frame = window.requestAnimationFrame(() => {
      setSnapTransition(false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [rightOpen]);

  const runtimeValue: RightWorkbenchPanelRuntime = {
    activeTab: effectiveActiveTab,
    open: rightOpen,
  };

  return (
    <aside
      className={cn(
        "agent-window__workbench editor-panel-container multi-shell-surface relative flex min-w-0 shrink-0 flex-col overflow-hidden border-l border-multi-workbench-panel-border-faint",
        resize.dragging || snapTransition
          ? "transition-none"
          : "transition-[width] duration-100 ease-[cubic-bezier(0.19,1,0.22,1)] motion-reduce:transition-none",
      )}
      data-agent-window-workbench=""
      data-shell-panel="right"
      data-side="right"
      data-state={rightOpen ? "expanded" : "collapsed"}
      data-resizing={resize.dragging ? "true" : "false"}
      data-transition-snap={snapTransition ? "true" : "false"}
      ref={asideRef}
      aria-hidden={!rightOpen ? true : undefined}
      inert={!rightOpen}
    >
      <RightWorkbenchPanelRuntimeContext.Provider
        // oxlint-disable-next-line react/jsx-no-constructed-context-values -- React Compiler memoizes context values
        value={runtimeValue}
      >
        <>
          <TabsRoot
            value={effectiveActiveTab}
            onValueChange={handleWorkbenchTabChange}
            className={cn(
              "relative z-10 flex h-full min-h-0 w-full flex-col bg-(--multi-workbench-editor-surface-background)",
              rightOpen ? "opacity-100" : "pointer-events-none opacity-0",
            )}
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
        </>
      </RightWorkbenchPanelRuntimeContext.Provider>
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
  const rightOpen = resolveEffectiveRightOpen({
    storedRightOpen,
    routeThreadId: props.routeThreadId,
    gitFocusId: props.gitFocusId,
    muted,
  });

  const rightPanelLabel = rightOpen ? "Hide project panel" : SHOW_RIGHT_WORKBENCH_LABEL;

  return (
    <div className="multi-shell-titlebar-controls pointer-events-none absolute top-0 right-0 left-0 z-50 box-border flex h-(--multi-header-height) min-w-0 items-center">
      <div className="multi-shell-titlebar-left-controls pointer-events-auto no-drag absolute flex h-(--multi-titlebar-control-height) shrink-0 items-center gap-0.5">
        <button
          type="button"
          onClick={() => shellPanelsActions.toggleLeft()}
          className="flex h-(--multi-titlebar-control-height) w-(--multi-titlebar-control-height) shrink-0 items-center justify-center rounded-multi-control bg-transparent p-0 leading-none text-multi-fg-secondary transition-[background-color,color,transform] hover:bg-multi-bg-quaternary hover:text-multi-fg-primary active:scale-[0.96] [&_svg]:block"
          aria-label={leftOpen ? "Collapse chats" : "Expand chats"}
        >
          {leftOpen ? (
            <IconSidebarHiddenLeftWide className="size-4 shrink-0" />
          ) : (
            <IconSidebar className="size-4 shrink-0" />
          )}
        </button>
      </div>
      {props.showRight ? (
        <div className="multi-shell-titlebar-right-toggle pointer-events-auto no-drag absolute z-40 flex h-(--multi-titlebar-control-height) shrink-0 items-center">
          <button
            type="button"
            onClick={() => setRightPanelOpen(!rightOpen, props.workspaceKey)}
            className="flex h-(--multi-titlebar-control-height) w-(--multi-titlebar-control-height) shrink-0 items-center justify-center rounded-multi-control bg-transparent p-0 leading-none text-multi-fg-secondary transition-[background-color,color,transform] hover:bg-multi-bg-quaternary hover:text-multi-fg-primary active:scale-[0.96] [&_svg]:block"
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
  const leftOpen = useLeftOpen();
  const leftWidth = useLeftWidth();
  const storedRightOpen = useRightOpen(props.workspaceKey ?? null);
  const rightWidth = useRightWidth();
  const muted = useIsMuted(props.workspaceKey ?? null);
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
      data-shell-right-panel={showRight ? "true" : "false"}
      data-shell-right-open={shellRightOpen ? "true" : "false"}
      data-shell-center-surface={props.centerSurface ?? "chat"}
      data-shell-platform={electron ? "electron" : "web"}
      data-shell-chrome="surface"
      data-agent-window-font-smoothing={
        agentWindowFontSmoothingAntialiased ? "antialiased" : "subpixel"
      }
      style={shellStyle}
    >
      <LeftAside>{props.left}</LeftAside>

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
              workspaceKey={props.workspaceKey ?? null}
              right={props.right}
              routeThreadId={props.routeThreadId ?? null}
              gitFocusId={props.gitFocusId ?? null}
            />
          ) : null}
        </div>
      </div>

      <ShellHeaderControls
        showRight={showRight}
        workspaceKey={props.workspaceKey ?? null}
        routeThreadId={props.routeThreadId ?? null}
        gitFocusId={props.gitFocusId ?? null}
      />
    </div>
  );
}
