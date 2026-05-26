"use client";

import { IconSidebar, IconSidebarHiddenLeftWide, IconSidebarHiddenRightWide } from "central-icons";
import { TabsPanel, TabsRoot } from "@multi/ui/tabs";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { cva } from "class-variance-authority";
import { type CSSProperties, type ReactNode, useCallback, useMemo, useRef } from "react";

import { isElectron, isElectronHost } from "~/env";
import { syncAppearanceVibrancy } from "~/lib/appearance-settings";
import { useMountEffect } from "~/hooks/use-mount-effect";
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
} from "~/stores/shell-panels-store";
import { cn } from "~/lib/utils";
import { RightWorkbenchHeader, type WorkbenchTabMeta } from "./right-workbench-header";
import { useColumnResize } from "./use-column-resize";

const chatLayoutRouteApi = getRouteApi("/_chat");

const LEFT_LIMITS = SHELL_LEFT_PANEL_WIDTH_LIMITS;
const RIGHT_LIMITS = RIGHT_WORKBENCH_WIDTH_LIMITS;
const FALLBACK_WORKBENCH_TAB = "git" satisfies WorkbenchTab;

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
  return value === "plan" || value === "git" || value === "terminal" || value === "files";
}

export interface RightWorkbenchDefinition {
  tabs: readonly WorkbenchTabMeta[];
  panels: Partial<Record<WorkbenchTab, ReactNode>>;
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
        "agent-window__sidebar multi-shell-sidebar relative flex h-full shrink-0 select-none flex-col overflow-hidden border-r border-multi-stroke-quaternary",
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
  cwd: string | null;
  activeTab: WorkbenchTab;
  tabs: readonly WorkbenchTabMeta[];
}) {
  const terminalState = useTerminalSessions(props.cwd);

  return (
    <RightWorkbenchHeader
      tabs={props.tabs}
      activeTab={props.activeTab}
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
  right: RightWorkbenchDefinition;
  routeThreadId: string | null;
  gitFocusId: string | null;
}) {
  const storedRightOpen = useRightOpen();
  const rightWidth = useRightWidth();
  const activeTab = useActiveTab();
  const muted = useIsMuted();
  const search = chatLayoutRouteApi.useSearch();
  const navigate = useNavigate();
  const visibleTabs = props.right.tabs.map((tab) => tab.id);
  const effectiveActiveTab = visibleTabs.includes(activeTab) ? activeTab : FALLBACK_WORKBENCH_TAB;
  const rightOpen = resolveEffectiveRightOpen({
    storedRightOpen,
    routeThreadId: props.routeThreadId,
    gitFocusId: props.gitFocusId,
    muted,
  });

  const handleWorkbenchTabChange = useCallback(
    (value: unknown) => {
      if (!isWorkbenchTab(value)) {
        return;
      }
      if (!visibleTabs.includes(value)) {
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
    [navigate, search, visibleTabs],
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
      <RightAsideRouteSearchSync
        key={`${search.diff ?? ""}:${search.workbench ?? ""}:${activeTab}:${muted}`}
        activeTab={activeTab}
        muted={muted}
        searchDiff={search.diff}
        searchWorkbench={search.workbench}
      />
      {rightOpen ? (
        <>
          <TabsRoot
            value={effectiveActiveTab}
            onValueChange={handleWorkbenchTabChange}
            className="relative z-10 flex h-full min-h-0 w-full flex-col bg-(--multi-workbench-editor-surface-background) opacity-100"
          >
            <RightAsideHeader
              cwd={props.cwd}
              activeTab={effectiveActiveTab}
              tabs={props.right.tabs}
            />
            <RightAsidePanels activeTab={effectiveActiveTab} right={props.right} />
          </TabsRoot>
          <div
            aria-label="Resize project panel width"
            aria-orientation="vertical"
            className="pointer-events-auto absolute inset-y-0 left-0 z-30 w-3 cursor-col-resize touch-none select-none outline-hidden [-webkit-app-region:no-drag] after:absolute after:inset-y-0 after:left-0 after:w-(--multi-shell-sash-stripe-width) after:rounded-px after:bg-transparent after:transition-[background-color,box-shadow] after:duration-100 after:ease-out hover:after:bg-(--multi-shell-sash-hover-shade) focus-visible:after:bg-(--multi-shell-sash-hover-shade) data-[active=true]:after:bg-(--multi-shell-sash-hover-shade) motion-reduce:after:transition-none"
            data-active={resize.dragging ? "true" : undefined}
            {...resize.sashProps}
            role="separator"
          />
        </>
      ) : null}
    </aside>
  );
}

function RightAsideRouteSearchSync(props: {
  readonly activeTab: WorkbenchTab;
  readonly muted: boolean;
  readonly searchDiff: string | undefined;
  readonly searchWorkbench: WorkbenchTab | undefined;
}) {
  useMountEffect(() => {
    if (!isElectronHost()) {
      return;
    }
    if (props.searchDiff === "1") {
      if (props.activeTab !== "git") {
        shellPanelsActions.setActiveTab("git");
      }
      if (props.muted) {
        shellPanelsActions.setMuted(false);
      }
      return;
    }
    if (props.searchWorkbench === undefined) {
      return;
    }
    if (props.searchWorkbench !== props.activeTab) {
      shellPanelsActions.setActiveTab(props.searchWorkbench);
    }
  });

  return null;
}

function RightAsidePanels(props: { activeTab: WorkbenchTab; right: RightWorkbenchDefinition }) {
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
      {props.right.tabs.map((tab) => {
        const panel = tab.id === props.activeTab ? (props.right.panels[tab.id] ?? null) : null;
        return (
          <TabsPanel
            key={tab.id}
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
            onClick={() => setRightPanelOpen(!rightOpen)}
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
  left: ReactNode;
  center: ReactNode;
  right: RightWorkbenchDefinition | null;
  routeThreadId?: string | null;
  gitFocusId?: string | null;
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
      "--agent-window-chat-max-width": `${agentWindowChatMaxWidth}px`,
    }),
    [leftWidth, rightWidth, agentWindowChatMaxWidth],
  );

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
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-(--multi-chat-surface-background,var(--multi-color-chat)) outline-hidden"
            data-component="chat-panel"
          >
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden outline-hidden">
              {props.center}
            </div>
          </main>

          {showRight && props.right ? (
            <RightAside
              cwd={props.cwd}
              right={props.right}
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
      />
    </div>
  );
}
