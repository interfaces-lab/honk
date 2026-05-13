"use client";

import {
  IconArrowLeft,
  IconSidebar,
  IconSidebarHiddenLeftWide,
  IconSidebarHiddenRightWide,
} from "central-icons";
import { TabsPanel, TabsRoot } from "@multi/ui/tabs";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { cva } from "class-variance-authority";
import { type CSSProperties, type ReactNode, useCallback, useEffect, useMemo, useRef } from "react";

import { isElectron, isElectronHost } from "~/env";
import { useSettings } from "~/hooks/use-settings";
import {
  type WorkbenchTab,
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
} from "~/lib/shell-panels-store";
import { cn } from "~/lib/utils";
import { RightWorkbenchHeader } from "./right-workbench-header";
import { useColumnResize } from "./use-column-resize";

const chatLayoutRouteApi = getRouteApi("/_chat");

const LEFT_LIMITS = SHELL_LEFT_PANEL_WIDTH_LIMITS;
const RIGHT_LIMITS = RIGHT_WORKBENCH_WIDTH_LIMITS;
const WORKBENCH_TABS = ["git", "terminal", "files"] satisfies readonly WorkbenchTab[];

const workbenchPanelSlotVariants = cva(
  "absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden",
  {
    variants: {
      active: {
        false: "pointer-events-none invisible opacity-0",
        true: "visible opacity-100",
      },
    },
  },
);

function isWorkbenchTab(value: unknown): value is WorkbenchTab {
  return value === "git" || value === "terminal" || value === "files";
}

type RightPanels = Record<WorkbenchTab, ReactNode>;
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

function setRightPanelOpen(open: boolean): void {
  shellPanelsActions.setRightOpen(open);
  shellPanelsActions.setMuted(!open);
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
        "agent-window__sidebar multi-shell-sidebar relative flex shrink-0 select-none flex-col overflow-hidden",
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
      ref={asideRef}
      style={{
        borderRightWidth: 0,
      }}
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
          className={cn(
            "multi-shell-sash-hit-area multi-shell-sash-hit-area--align-end pointer-events-auto",
            resize.dragging ? "multi-shell-sash-hit-area--active" : null,
          )}
          {...resize.sashProps}
          role="separator"
        >
          <div aria-hidden className="multi-shell-sash-hit-feedback" />
        </div>
      ) : null}
    </aside>
  );
}

function RightAsideHeader(props: {
  cwd: string | null;
  changesCount: number;
  activeTab: WorkbenchTab;
}) {
  const terminalState = useTerminalSessions(props.cwd);

  return (
    <RightWorkbenchHeader
      activeTab={props.activeTab}
      gitCount={props.changesCount}
      terminalSessions={terminalState.sessions}
      activeTerminalId={terminalState.activeId}
      onTerminalTab={(id) => shellPanelsActions.setActiveTerminal(props.cwd, id)}
      onNewTerminal={() => {
        const id = `term-${Date.now()}`;
        shellPanelsActions.addTerminalSession(props.cwd, {
          id,
          label: `Terminal ${terminalState.sessions.length + 1}`,
        });
      }}
      onCloseTerminal={(id) => shellPanelsActions.removeTerminalSession(props.cwd, id)}
    />
  );
}

function RightAside(props: {
  cwd: string | null;
  changesCount: number;
  rightPanels: RightPanels;
  routeThreadId: string | null;
  gitFocusId: string | null;
}) {
  const storedRightOpen = useRightOpen();
  const rightWidth = useRightWidth();
  const activeTab = useActiveTab();
  const muted = useIsMuted();
  const search = chatLayoutRouteApi.useSearch();
  const navigate = useNavigate();
  const rightOpen = resolveEffectiveRightOpen({
    storedRightOpen,
    routeThreadId: props.routeThreadId,
    gitFocusId: props.gitFocusId,
    muted,
  });

  useEffect(() => {
    if (!isElectronHost()) {
      return;
    }
    if (search.diff === "1") {
      if (activeTab !== "git") {
        shellPanelsActions.setActiveTab("git");
      }
      if (muted) {
        shellPanelsActions.setMuted(false);
      }
      return;
    }
    const w = search.workbench;
    if (w === undefined) {
      return;
    }
    if (w !== activeTab) {
      shellPanelsActions.setActiveTab(w);
    }
  }, [search.diff, search.workbench, activeTab, muted]);

  const handleWorkbenchTabChange = useCallback(
    (value: unknown) => {
      if (!isWorkbenchTab(value)) {
        return;
      }
      shellPanelsActions.setActiveTab(value);
      shellPanelsActions.setMuted(false);
      if (isElectron) {
        navigate({
          to: ".",
          search: {
            ...search,
            workbench: value,
          },
          replace: true,
        });
      }
    },
    [navigate, search],
  );

  const asideRef = useRef<HTMLElement | null>(null);
  const resize = useColumnResize({
    width: rightWidth,
    limits: RIGHT_LIMITS,
    elementRef: asideRef,
    direction: "left",
    onCommit: (nextWidth) => shellPanelsActions.setRightWidth(nextWidth),
  });

  return (
    <aside
      className={cn(
        "agent-window__workbench editor-panel-container multi-shell-surface relative flex min-w-0 shrink-0 flex-col overflow-hidden",
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
      style={{
        borderLeftWidth: 0,
      }}
      aria-hidden={!rightOpen ? true : undefined}
    >
      {rightOpen ? (
        <>
          <TabsRoot
            value={activeTab}
            onValueChange={handleWorkbenchTabChange}
            className="editor-panel-inner relative z-10 flex h-full min-h-0 w-full flex-col border-l border-multi-workbench-panel-border-faint bg-(--glass-editor-surface-background) opacity-100"
          >
            <RightAsideHeader
              cwd={props.cwd}
              changesCount={props.changesCount}
              activeTab={activeTab}
            />
            <RightAsidePanels activeTab={activeTab} rightPanels={props.rightPanels} />
          </TabsRoot>
          <div
            aria-label="Resize project panel width"
            aria-orientation="vertical"
            className={cn(
              "multi-shell-sash-hit-area multi-shell-sash-hit-area--align-start pointer-events-auto",
              resize.dragging ? "multi-shell-sash-hit-area--active" : null,
            )}
            {...resize.sashProps}
            role="separator"
          >
            <div aria-hidden className="multi-shell-sash-hit-feedback" />
          </div>
        </>
      ) : null}
    </aside>
  );
}

function RightAsidePanels(props: { activeTab: WorkbenchTab; rightPanels: RightPanels }) {
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
      {WORKBENCH_TABS.map((tab) => {
        return (
          <TabsPanel
            key={tab}
            value={tab}
            keepMounted
            className={(state) => workbenchPanelSlotVariants({ active: !state.hidden })}
            data-workbench-panel={tab}
            data-workbench-panel-active={tab === props.activeTab ? "true" : "false"}
          >
            {props.rightPanels[tab]}
          </TabsPanel>
        );
      })}
    </div>
  );
}

function ShellHeaderControls(props: {
  showRight: boolean;
  onBack?: () => void;
  routeThreadId: string | null;
  gitFocusId: string | null;
}) {
  const leftOpen = useLeftOpen();
  const storedRightOpen = useRightOpen();
  const muted = useIsMuted();
  const rightOpen = resolveEffectiveRightOpen({
    storedRightOpen,
    routeThreadId: props.routeThreadId,
    gitFocusId: props.gitFocusId,
    muted,
  });

  const rightPanelLabel = rightOpen ? "Hide project panel" : SHOW_RIGHT_WORKBENCH_LABEL;

  return (
    <div className="pointer-events-none absolute top-0 right-0 left-0 box-border flex h-(--multi-header-height) min-w-0 items-start">
      <div className="multi-shell-titlebar-left-controls pointer-events-auto no-drag absolute flex shrink-0 items-center gap-1 self-start">
        {props.onBack ? (
          <button
            type="button"
            onClick={() => props.onBack?.()}
            className="flex h-(--multi-titlebar-control-height) w-(--multi-titlebar-control-height) shrink-0 items-center justify-center rounded-multi-control bg-transparent p-0 leading-none text-muted-foreground [&_svg]:block hover:bg-multi-hover hover:text-foreground active:scale-[0.96] transition-transform"
            aria-label="Back to chat"
          >
            <IconArrowLeft className="size-4 shrink-0" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => shellPanelsActions.toggleLeft()}
          className="flex h-(--multi-titlebar-control-height) w-(--multi-titlebar-control-height) shrink-0 items-center justify-center rounded-multi-control bg-transparent p-0 leading-none text-muted-foreground [&_svg]:block hover:bg-multi-hover hover:text-foreground active:scale-[0.96] transition-transform"
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
        <div className="multi-shell-titlebar-right-toggle pointer-events-auto no-drag absolute z-40 flex shrink-0 items-center self-start">
          <button
            type="button"
            onClick={() => setRightPanelOpen(!rightOpen)}
            className="flex h-(--multi-titlebar-control-height) w-(--multi-titlebar-control-height) shrink-0 items-center justify-center rounded-multi-control bg-transparent p-0 leading-none text-muted-foreground [&_svg]:block hover:bg-multi-hover hover:text-foreground active:scale-[0.96] transition-transform"
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
  left: ReactNode;
  center: ReactNode;
  right: RightPanels | null;
  changesCount: number;
  routeThreadId?: string | null;
  gitFocusId?: string | null;
  onBack?: () => void;
}) {
  const electron = isElectronHost();
  const showRight = props.right !== null;
  const leftOpen = useLeftOpen();
  const leftWidth = useLeftWidth();
  const storedRightOpen = useRightOpen();
  const rightWidth = useRightWidth();
  const muted = useIsMuted();
  const agentWindowChatMaxWidth = useSettings((settings) => settings.agentWindowChatMaxWidth);
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
  const shellStyle = useMemo<ShellRootStyle>(
    () => ({
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
      "--multi-composer-max-width": `${agentWindowChatMaxWidth}px`,
    }),
    [leftWidth, rightWidth, agentWindowChatMaxWidth],
  );

  useEffect(() => {
    const previousValue = document.body.getAttribute("data-cursor-glass-mode");
    document.body.setAttribute("data-cursor-glass-mode", "true");
    return () => {
      if (previousValue === null) {
        document.body.removeAttribute("data-cursor-glass-mode");
      } else {
        document.body.setAttribute("data-cursor-glass-mode", previousValue);
      }
    };
  }, []);

  return (
    <div
      className="agent-window relative flex h-full min-w-0 flex-1 flex-row bg-transparent"
      data-component="root"
      data-agent-window=""
      data-shell-left-intent={leftOpen ? "expanded" : "collapsed"}
      data-shell-right-intent={shellRightOpen ? "expanded" : "collapsed"}
      data-shell-right-panel={showRight ? "true" : "false"}
      data-shell-right-open={shellRightOpen ? "true" : "false"}
      data-shell-platform={electron ? "electron" : "web"}
      data-shell-chrome="glass"
      data-agent-window-font-smoothing={
        agentWindowFontSmoothingAntialiased ? "antialiased" : "subpixel"
      }
      style={shellStyle}
    >
      <LeftAside>{props.left}</LeftAside>

      <div className="agent-window__body flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="relative flex min-h-0 flex-1 flex-row">
          <main
            className="agent-panel agent-window__agent-panel flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-multi-chat outline-hidden"
            data-component="agent-panel"
          >
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden outline-hidden">
              {props.center}
            </div>
          </main>

          {showRight && props.right ? (
            <RightAside
              cwd={props.cwd}
              changesCount={props.changesCount}
              rightPanels={props.right}
              routeThreadId={props.routeThreadId ?? null}
              gitFocusId={props.gitFocusId ?? null}
            />
          ) : null}
        </div>
      </div>

      <ShellHeaderControls
        showRight={showRight}
        routeThreadId={props.routeThreadId ?? null}
        gitFocusId={props.gitFocusId ?? null}
        {...(props.onBack ? { onBack: props.onBack } : {})}
      />
    </div>
  );
}
