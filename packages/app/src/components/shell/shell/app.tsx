"use client";

import {
  IconExpand45,
  IconMinimize45,
  IconSidebar,
  IconSidebarHiddenLeftWide,
} from "central-icons";
import * as stylex from "@stylexjs/stylex";
import { WorkbenchIconButton } from "@honk/honkkit/workbench-button";
import { TabsPanel, TabsRoot } from "@honk/honkkit/tabs";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { cva } from "class-variance-authority";
import {
  createContext,
  type CSSProperties,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { isElectronHost } from "~/env";
import { buildAppearanceBaseColors } from "~/lib/appearance-colors";
import { resolveShortcutCommand } from "~/keybindings";
import { useSettings } from "~/hooks/use-settings";
import { syncBrowserChromeTheme, useTheme } from "~/hooks/use-theme";
import { useServerKeybindings } from "~/rpc/server-state";
import { useCommandPaletteStore } from "~/stores/ui/command-palette-store";
import { isTerminalFocused } from "~/lib/terminal-focus";
import {
  RIGHT_WORKBENCH_WIDTH_LIMITS,
  SHELL_LEFT_PANEL_WIDTH_LIMITS,
  shellPanelsActions,
  useLeftOpen,
  useLeftWidth,
} from "~/stores/shell-panels-store";
import {
  getWorkspaceFullscreenTarget,
  workspaceEditorActions,
} from "~/stores/workspace-editor-store";
import { type WorkbenchTab } from "~/lib/workbench-tabs";
import { cn } from "~/lib/utils";
import { surfaceThemeFor, windowGlassFor } from "~/lib/surface-theme";
import { useAppearanceSettingsSnapshot } from "~/stores/appearance-store";
import { RightWorkbenchHeader, type WorkbenchTabMeta } from "./right-workbench-header";
import {
  workbenchTabPersistenceActions,
  type WorkbenchTabSnapshot,
} from "~/stores/workbench-tab-store";
import { panelPresentation, SHELL_CENTER_MIN_WIDTH, type ShellPanelMode } from "./shell-layout";
import {
  ShellLayoutProvider,
  ShellLayoutService,
  useShellLayout,
  useShellLayoutConfig,
} from "./shell-layout-service";
import { useColumnResize } from "./use-column-resize";
import { useShellPanelModes } from "./use-shell-layout";

const LEFT_LIMITS = SHELL_LEFT_PANEL_WIDTH_LIMITS;
const RIGHT_LIMITS = RIGHT_WORKBENCH_WIDTH_LIMITS;
const FALLBACK_WORKBENCH_TAB = "git" satisfies WorkbenchTab;
type AppShellRouteKind = "draft" | "server" | "settings";

const rootStyles = stylex.create({
  surface: {
    backgroundColor: "var(--honk-surface-root)",
  },
});

function cssPixelLimit(limit: number): string {
  return Number.isFinite(limit) ? `${limit}px` : "100cqw";
}

function resolveDockedRightWorkbenchMaxWidth(input: {
  leftWidth: number;
  maxWidth: number;
  shellWidth: number;
  sidebarOverlayMode: boolean;
  sidebarVisible: boolean;
}): number {
  if (input.shellWidth <= 0) {
    return input.maxWidth;
  }

  const dockedSidebarWidth =
    input.sidebarVisible && !input.sidebarOverlayMode ? input.leftWidth : 0;
  return Math.min(
    input.maxWidth,
    Math.max(RIGHT_LIMITS.min, input.shellWidth - dockedSidebarWidth - SHELL_CENTER_MIN_WIDTH),
  );
}

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
  renderers: Partial<Record<WorkbenchTab, RightWorkbenchRenderer>>;
  snapshot: WorkbenchTabSnapshot;
  onCloseTab?: ((tab: WorkbenchTabMeta) => void) | undefined;
}

export interface RightWorkbenchRendererContext {
  tab: WorkbenchTabMeta;
  workspaceKey: string;
  active: boolean;
}

export interface RightWorkbenchRenderer {
  render: (context: RightWorkbenchRendererContext) => ReactNode;
  alwaysMounted?: boolean | undefined;
  keepMountedAfterFirstActivation?: boolean | undefined;
}

interface RightWorkbenchPanelRuntime {
  activeTab: WorkbenchTab;
  activeTabId: string;
  open: boolean;
}

const RightWorkbenchPanelRuntimeContext = createContext<RightWorkbenchPanelRuntime>({
  activeTab: FALLBACK_WORKBENCH_TAB,
  activeTabId: "changes",
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
      style={{ "--honk-shell-left-width": `${leftWidth}px` } as ShellRootStyle}
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
          className="honk-shell-column-sash"
          data-active={resize.dragging ? "true" : undefined}
          data-sash-side="right"
          {...resize.sashProps}
          role="separator"
        />
      ) : null}
    </aside>
  );
}

// Both glyphs stay mounted; ShellLayoutService flips the root attribute and
// a11y state imperatively so this button does not subscribe to fullscreen.
function RightWorkbenchFullscreenToggle(props: {
  threadId: string | null;
  workspaceKey: string | null;
}) {
  const onClick = () => {
    workspaceEditorActions.toggleFullscreen(props.workspaceKey, props.threadId, "right-workbench");
  };

  return (
    <WorkbenchIconButton
      aria-label="Toggle editor panel fullscreen"
      aria-pressed={false}
      data-shell-fullscreen-toggle=""
      title="Toggle editor panel fullscreen"
      onClick={onClick}
      active={false}
      chrome="tool"
      tabSystem={false}
    >
      <span data-fullscreen-toggle-icon="expand">
        <IconExpand45 className="size-4 shrink-0" aria-hidden />
      </span>
      <span data-fullscreen-toggle-icon="minimize">
        <IconMinimize45 className="size-4 shrink-0" aria-hidden />
      </span>
    </WorkbenchIconButton>
  );
}

function RightAsideHeader(props: {
  workspaceKey: string | null;
  routeThreadId: string | null;
  activeTabId: string;
  onCloseTab?: ((tab: WorkbenchTabMeta) => void) | undefined;
  tabs: readonly WorkbenchTabMeta[];
  threadTitle: string | null;
}) {
  const { workspaceKey } = props;

  const onActivateTab = (tabId: string) =>
    workbenchTabPersistenceActions.activateTab(workspaceKey, tabId);
  const onCloseTab = (tabId: string) => {
    const tab = props.tabs.find((candidate) => candidate.id === tabId);
    if (tab && props.onCloseTab) {
      props.onCloseTab(tab);
      return;
    }
    workbenchTabPersistenceActions.closeTab(workspaceKey, tabId);
  };
  const onMoveTab = (tabId: string, targetIndex: number) =>
    workbenchTabPersistenceActions.moveTab(workspaceKey, tabId, targetIndex);
  const onNewTerminal = () => {
    workbenchTabPersistenceActions.createTerminal(workspaceKey);
  };
  const onCreateBrowser = (url?: string) =>
    workbenchTabPersistenceActions.createBrowser(workspaceKey, { url });
  const onCreateFile = () => workbenchTabPersistenceActions.activateKind(workspaceKey, "files");
  const onActivateChanges = () => workbenchTabPersistenceActions.activateChanges(workspaceKey);
  const onHidePanel = () => setRightPanelOpen(false, workspaceKey);

  const fullscreenControl = (
    <RightWorkbenchFullscreenToggle workspaceKey={workspaceKey} threadId={props.routeThreadId} />
  );

  return (
    <RightWorkbenchHeader
      workspaceKey={workspaceKey}
      threadTitle={props.threadTitle}
      tabs={props.tabs}
      activeTabId={props.activeTabId}
      fullscreenControl={fullscreenControl}
      onActivateChanges={onActivateChanges}
      onActivateTab={onActivateTab}
      onCloseTab={onCloseTab}
      onCreateBrowser={onCreateBrowser}
      onCreateFile={onCreateFile}
      onCreateTerminal={onNewTerminal}
      onHidePanel={onHidePanel}
      onMoveTab={onMoveTab}
    />
  );
}

// The <aside> shell: owns visibility (rightOpen), fullscreen, the imperative
// column resize + drag state, the sash, and the sticky mount gate. It renders
// `props.children` (the content subtree) so its own re-renders — width commit,
// fullscreen toggle, drag start/end — never re-render the content.
function RightAsideFrame(props: { workspaceKey: string | null; children: ReactNode }) {
  const layout = useShellLayout((snapshot) => ({
    editorPanelFullscreen: snapshot.editorPanelFullscreen,
    editorPanelVisible: snapshot.editorPanelVisible,
    leftWidth: snapshot.leftWidth,
    rightWidth: snapshot.rightWidth,
    shellWidth: snapshot.shellWidth,
    sidebarOverlayMode: snapshot.sidebarOverlayMode,
    sidebarVisible: snapshot.sidebarVisible,
    suppressMotion: snapshot.suppressMotion,
  }));
  // Near-constant in steady state (undefined unless a ?panel= deep-link is
  // pending); only used to mount Content on a cold deep-link so its effect can
  // run. Does not feed rightOpen / sash / data-state.
  const pendingPanel = useSearch({
    from: "/_chat",
    shouldThrow: false,
    select: (search) => search.panel,
  });

  const rightOpen = layout.editorPanelVisible;

  // Mount the workbench on first open (or on a cold ?panel= deep-link, so the
  // content effect can run and open it), then keep it: remount churn on toggle
  // costs more than an offscreen tree, but users who never open it pay nothing.
  const shouldOpen = rightOpen || Boolean(pendingPanel);
  const [hasOpened, setHasOpened] = useState(shouldOpen);
  if (shouldOpen && !hasOpened) {
    setHasOpened(true);
  }

  const asideRef = useRef<HTMLElement | null>(null);
  const rightResizeLimits = () => ({
    min: RIGHT_LIMITS.min,
    max: resolveDockedRightWorkbenchMaxWidth({
      leftWidth: layout.leftWidth,
      maxWidth: RIGHT_LIMITS.max,
      shellWidth: layout.shellWidth,
      sidebarOverlayMode: layout.sidebarOverlayMode,
      sidebarVisible: layout.sidebarVisible,
    }),
  });
  const maxRightWidth = rightResizeLimits().max;
  const effectiveRightWidth = layout.editorPanelFullscreen
    ? layout.rightWidth
    : Math.min(Math.max(layout.rightWidth, RIGHT_LIMITS.min), maxRightWidth);
  const resize = useColumnResize({
    width: effectiveRightWidth,
    limits: rightResizeLimits,
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
      data-fullscreen-layout={layout.editorPanelFullscreen ? "true" : undefined}
      data-suppress-motion={layout.suppressMotion ? "true" : undefined}
      ref={asideRef}
      aria-hidden={!rightOpen ? true : undefined}
      inert={!rightOpen}
      style={
        {
          "--honk-shell-right-workbench-max-width": cssPixelLimit(maxRightWidth),
          "--honk-shell-right-workbench-width": `${effectiveRightWidth}px`,
        } as ShellRootStyle
      }
    >
      {hasOpened ? props.children : null}
      {rightOpen ? (
        <div
          aria-label="Resize project panel width"
          aria-orientation="vertical"
          className="honk-shell-column-sash honk-shell-workbench-sash"
          data-active={resize.dragging ? "true" : undefined}
          data-sash-side="left"
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
  routeThreadId: string | null;
  right: RightWorkbenchDefinition;
  keybindings: ReturnType<typeof useServerKeybindings>;
  threadTitle: string | null;
}) {
  const tabSnapshot = props.right.snapshot;
  const searchActiveTab = useSearch({
    from: "/_chat",
    shouldThrow: false,
    select: (search) => search.panel,
  });
  const navigate = useNavigate();
  const visibleTabIds = new Set(props.right.tabs.map((tab) => tab.id));
  const visibleTabKinds = new Set(props.right.tabs.map((tab) => tab.kind));
  const effectiveActiveTab =
    props.right.tabs.find((tab) => tab.id === tabSnapshot.activeTabId) ??
    props.right.tabs[0] ??
    tabSnapshot.activeTab;

  const handleWorkbenchTabChange = (value: string) => {
    if (!visibleTabIds.has(value)) return;
    workbenchTabPersistenceActions.activateTab(props.workspaceKey, value);
  };

  useEffect(() => {
    if (!searchActiveTab) {
      return;
    }
    if (!visibleTabKinds.has(searchActiveTab)) {
      void navigate({
        replace: true,
        to: ".",
        search: ({ panel: _panel, ...search }) => search,
      });
      return;
    }
    workbenchTabPersistenceActions.activateKind(props.workspaceKey, searchActiveTab);
    void navigate({
      replace: true,
      to: ".",
      search: ({ panel: _panel, ...search }) => search,
    });
  }, [navigate, props.workspaceKey, searchActiveTab, visibleTabKinds]);

  // `open` is sticky: this subtree only mounts once the Frame has opened and is
  // never unmounted on collapse, so `open` is constant `true` for its lifetime
  // (identical semantics to the former `open: hasOpened`). Collapsing must not
  // disable panel queries, or every expand refetches and replays its skeleton.
  const runtimeValue: RightWorkbenchPanelRuntime = {
    activeTab: effectiveActiveTab.kind,
    activeTabId: effectiveActiveTab.id,
    open: true,
  };

  return (
    <RightWorkbenchPanelRuntimeContext.Provider value={runtimeValue}>
      {/* Width pinned like the sidebar body: the open/close width
          animation clips instead of reflowing the panel content. */}
      <TabsRoot
        value={effectiveActiveTab.id}
        onValueChange={handleWorkbenchTabChange}
        className="agent-window__workbench-body relative z-10 flex h-full min-h-0 w-[min(var(--honk-shell-right-workbench-width),100cqw)] flex-col bg-(--honk-workbench-editor-surface-background) opacity-100 in-data-[resizing=true]:w-full"
      >
        <RightAsideHeader
          workspaceKey={props.workspaceKey}
          routeThreadId={props.routeThreadId}
          activeTabId={effectiveActiveTab.id}
          onCloseTab={props.right.onCloseTab}
          tabs={props.right.tabs}
          threadTitle={props.threadTitle}
        />
        <RightAsidePanels
          key={props.workspaceKey ?? "none"}
          activeTabId={effectiveActiveTab.id}
          right={props.right}
          workspaceKey={props.workspaceKey ?? "none"}
          visitedTabIds={tabSnapshot.visitedTabIds}
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
function RightAside(props: {
  cwd: string | null;
  workspaceKey: string | null;
  routeThreadId: string | null;
  right: RightWorkbenchDefinition;
  keybindings: ReturnType<typeof useServerKeybindings>;
  threadTitle: string | null;
}) {
  return (
    <RightAsideFrame workspaceKey={props.workspaceKey}>
      <RightWorkbenchContent
        workspaceKey={props.workspaceKey}
        routeThreadId={props.routeThreadId}
        right={props.right}
        keybindings={props.keybindings}
        threadTitle={props.threadTitle}
      />
    </RightAsideFrame>
  );
}

function RightAsidePanels(props: {
  activeTabId: string;
  right: RightWorkbenchDefinition;
  workspaceKey: string;
  visitedTabIds: ReadonlySet<string>;
}) {
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
      {props.right.tabs.map((tab) => {
        const renderer = props.right.renderers[tab.kind];
        const active = tab.id === props.activeTabId;
        const visited = props.visitedTabIds.has(tab.id);
        const shouldMount =
          active ||
          renderer?.alwaysMounted === true ||
          (renderer?.keepMountedAfterFirstActivation === true && visited);
        const panel =
          shouldMount && renderer
            ? renderer.render({
                tab,
                active,
                workspaceKey: props.workspaceKey,
              })
            : null;
        return (
          <TabsPanel
            key={tab.id}
            value={tab.id}
            keepMounted
            className={(state) => workbenchPanelSlotVariants({ active: !state.hidden })}
            data-workbench-panel={tab.id}
            data-workbench-panel-kind={tab.kind}
            data-workbench-panel-active={active ? "true" : "false"}
          >
            {panel}
          </TabsPanel>
        );
      })}
    </div>
  );
}

function ShellLeftToggleButton() {
  const leftOpen = useLeftOpen();
  return (
    <button
      type="button"
      onClick={() => shellPanelsActions.toggleLeft()}
      data-shell-no-drag=""
      className="flex h-(--honk-titlebar-control-height) w-(--honk-titlebar-control-height) shrink-0 items-center justify-center rounded-honk-control bg-transparent p-0 text-honk-fg-secondary transition-[background-color,color] hover:bg-honk-bg-quaternary hover:text-honk-fg-primary [&_svg]:block"
      aria-label={leftOpen ? "Collapse chats" : "Expand chats"}
      aria-pressed={leftOpen}
    >
      {leftOpen ? (
        <IconSidebarHiddenLeftWide className="size-4 shrink-0" aria-hidden />
      ) : (
        <IconSidebar className="size-4 shrink-0" aria-hidden />
      )}
    </button>
  );
}

function ShellHeaderControls(props: { showRight: boolean; workspaceKey: string | null }) {
  const rightOpen = useShellLayout((snapshot) => snapshot.editorPanelVisible);
  const rightPanelLabel = SHOW_RIGHT_WORKBENCH_LABEL;

  return (
    <>
      <div
        className="honk-shell-titlebar-left-controls pointer-events-auto no-drag absolute z-(--z-index-shell-titlebar-controls) flex h-(--honk-titlebar-control-height) shrink-0 items-center gap-0.5"
        data-shell-no-drag=""
      >
        <ShellLeftToggleButton />
      </div>
      {props.showRight && !rightOpen ? (
        <div
          className="honk-shell-titlebar-right-toggle pointer-events-auto no-drag absolute z-(--z-index-shell-titlebar-controls) flex h-(--honk-workbench-action-size) shrink-0 items-center"
          data-shell-no-drag=""
        >
          <WorkbenchIconButton
            onClick={() => setRightPanelOpen(true, props.workspaceKey)}
            aria-label={rightPanelLabel}
            aria-pressed={false}
            title={rightPanelLabel}
            chrome="tool"
          >
            <IconSidebar className="size-4 shrink-0" aria-hidden />
          </WorkbenchIconButton>
        </div>
      ) : null}
    </>
  );
}

function ShellCenterRegion(props: { children: ReactNode }) {
  return (
    <main
      className="agent-window__center flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-(--honk-shell-center-surface-background) outline-hidden"
      data-component="chat-panel"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden outline-hidden">
        {props.children}
      </div>
    </main>
  );
}

function ShellCenterBoundary(props: { children: ReactNode }) {
  const editorPanelFullscreen = useShellLayout((snapshot) => snapshot.editorPanelFullscreen);
  if (editorPanelFullscreen) {
    return null;
  }
  return <ShellCenterRegion>{props.children}</ShellCenterRegion>;
}

function RightWorkbenchWindowExpander(props: { electron: boolean }) {
  const layout = useShellLayout((snapshot) => ({
    editorPanelVisible: snapshot.editorPanelVisible,
    leftWidth: snapshot.leftWidth,
    rightWidth: snapshot.rightWidth,
    shellWidth: snapshot.shellWidth,
    sidebarOverlayMode: snapshot.sidebarOverlayMode,
    sidebarVisible: snapshot.sidebarVisible,
  }));
  const hadRightOpenRef = useRef(false);

  useEffect(() => {
    const wasOpen = hadRightOpenRef.current;
    hadRightOpenRef.current = layout.editorPanelVisible;
    if (!layout.editorPanelVisible || wasOpen || !props.electron) {
      return;
    }
    if (layout.shellWidth <= 0) {
      return;
    }
    const leftWidth = layout.sidebarVisible && !layout.sidebarOverlayMode ? layout.leftWidth : 0;
    const deficit = leftWidth + layout.rightWidth + SHELL_CENTER_MIN_WIDTH - layout.shellWidth;
    if (deficit > 0) {
      void window.desktopBridge?.expandWindowWidth?.(deficit);
    }
  }, [
    layout.editorPanelVisible,
    layout.leftWidth,
    layout.rightWidth,
    layout.shellWidth,
    layout.sidebarOverlayMode,
    layout.sidebarVisible,
    props.electron,
  ]);

  return null;
}

function ShellOverlayBackdrop() {
  const overlayActive = useShellLayout(
    (snapshot) => snapshot.leftPresentation === "overlay-expanded",
  );

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

  return (
    <div
      aria-hidden
      data-shell-overlay-backdrop=""
      className="absolute inset-0 z-(--z-index-shell-overlay-backdrop) bg-black/32 backdrop-blur-sm transition-opacity duration-(--motion-duration-drawer) ease-out motion-reduce:transition-none"
      onClick={() => shellPanelsActions.setLeftOpen(false)}
    />
  );
}

export function AppShell(props: {
  cwd: string | null;
  workspaceKey?: string | null;
  left: ReactNode;
  center: ReactNode;
  right: RightWorkbenchDefinition | null;
  centerSurface?: "chat" | "editor";
  centerRouteKind?: AppShellRouteKind | undefined;
  routeThreadId?: string | null;
  gitFocusId?: string | null;
  threadTitle?: string | null;
}) {
  const electron = isElectronHost();
  const appearance = useAppearanceSettingsSnapshot();
  const { resolvedTheme: themeMode } = useTheme();
  const osVibrancy = windowGlassFor({
    osVibrancy:
      electron &&
      typeof navigator !== "undefined" &&
      /Mac|iPhone|iPad|iPod/.test(navigator.platform),
    reduceTransparency: appearance.reduceTransparency,
    highContrast: false,
  }).vibrancy;
  const surfaceTheme = surfaceThemeFor({
    appearance: themeMode,
    osVibrancy,
    reduceTransparency: appearance.reduceTransparency,
    highContrast: false,
  });
  const baseColorVars = buildAppearanceBaseColors(themeMode, appearance.hue, appearance.saturation);
  const rootSurfaceProps = stylex.props(rootStyles.surface, surfaceTheme);
  const showRight = props.right !== null;
  const workspaceKey = props.workspaceKey ?? null;
  const routeThreadId = props.routeThreadId ?? null;
  const keybindings = useServerKeybindings();
  const agentWindowFontSmoothingAntialiased = useSettings(
    (settings) => settings.agentWindowFontSmoothingAntialiased,
  );
  const agentWindowRef = useRef<HTMLDivElement | null>(null);
  const modes = useShellPanelModes(agentWindowRef);
  const shellLayoutServiceRef = useRef<ShellLayoutService | null>(null);
  if (shellLayoutServiceRef.current === null) {
    shellLayoutServiceRef.current = new ShellLayoutService();
  }
  const shellLayoutService = shellLayoutServiceRef.current;
  useShellLayoutConfig(shellLayoutService, {
    gitFocusId: props.gitFocusId ?? null,
    leftMode: modes.left,
    rootRef: agentWindowRef,
    routeThreadId,
    showRight,
    workspaceKey,
  });

  useEffect(() => {
    syncBrowserChromeTheme();
  }, [appearance.reduceTransparency, appearance.hue, appearance.saturation, themeMode]);

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
      if (getWorkspaceFullscreenTarget(workspaceKey, routeThreadId) === "none") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      workspaceEditorActions.exitFullscreen(workspaceKey, routeThreadId);
    };
    window.addEventListener("keydown", exitFullscreen);
    return () => window.removeEventListener("keydown", exitFullscreen);
  }, [routeThreadId, workspaceKey]);

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
      if (
        command !== "editorPanel.toggleFullscreen" ||
        !shellLayoutService.getSnapshot().editorPanelVisible
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      workspaceEditorActions.toggleFullscreen(workspaceKey, routeThreadId, "right-workbench");
    };
    window.addEventListener("keydown", toggleFullscreen);
    return () => window.removeEventListener("keydown", toggleFullscreen);
  }, [keybindings, routeThreadId, shellLayoutService, workspaceKey]);

  useEffect(() => {
    const right = props.right;
    if (!right) {
      return undefined;
    }

    const handleTerminalCommand = (event: KeyboardEvent) => {
      if (event.defaultPrevented || useCommandPaletteStore.getState().open) {
        return;
      }

      const layout = shellLayoutService.getSnapshot();
      const activeTerminalOpen =
        layout.editorPanelVisible && right.snapshot.activeTab.kind === "terminal";
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen: activeTerminalOpen,
        },
      });

      if (
        command !== "terminal.toggle" &&
        command !== "terminal.split" &&
        command !== "terminal.new" &&
        command !== "terminal.close"
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (command === "terminal.toggle") {
        if (activeTerminalOpen) {
          setRightPanelOpen(false, workspaceKey);
          return;
        }
        workbenchTabPersistenceActions.activateKind(workspaceKey, "terminal");
        setRightPanelOpen(true, workspaceKey);
        return;
      }

      if (command === "terminal.new" || command === "terminal.split") {
        workbenchTabPersistenceActions.createTerminal(workspaceKey);
        setRightPanelOpen(true, workspaceKey);
        return;
      }

      const activeTerminalTab = right.tabs.find(
        (tab) => tab.id === right.snapshot.activeTabId && tab.kind === "terminal",
      );
      if (!activeTerminalTab) {
        return;
      }
      if (right.onCloseTab) {
        right.onCloseTab(activeTerminalTab);
        return;
      }
      workbenchTabPersistenceActions.closeTab(workspaceKey, activeTerminalTab.id);
    };

    window.addEventListener("keydown", handleTerminalCommand);
    return () => window.removeEventListener("keydown", handleTerminalCommand);
  }, [keybindings, props.right, shellLayoutService, workspaceKey]);

  const shellStyle: ShellRootStyle = {
    "--honk-shell-left-collapsed-width": "0px",
    "--honk-shell-left-min-width": `${LEFT_LIMITS.min}px`,
    "--honk-shell-left-max-width": `${LEFT_LIMITS.max}px`,
    "--honk-shell-right-workbench-collapsed-width": "0px",
    "--honk-shell-right-workbench-min-width": `${RIGHT_LIMITS.min}px`,
    "--honk-shell-right-workbench-max-width": cssPixelLimit(RIGHT_LIMITS.max),
    "--honk-shell-titlebar-control-size": "var(--honk-titlebar-control-height)",
    "--honk-shell-titlebar-control-y": "var(--honk-titlebar-control-row-top)",
    "--honk-shell-titlebar-gutter": "8px",
  };

  return (
    <ShellLayoutProvider service={shellLayoutService}>
      <div
        className={cn(
          "agent-window relative flex h-full min-h-0 w-full min-w-0 flex-1 flex-row overflow-x-clip bg-transparent",
          rootSurfaceProps.className,
        )}
        data-component="root"
        data-agent-window=""
        data-shell-left-mode={modes.left}
        data-shell-secondary-rail-mode={modes.secondaryRail}
        data-shell-right-panel={showRight ? "true" : "false"}
        data-shell-center-surface={props.centerSurface ?? "chat"}
        data-shell-route-kind={props.centerRouteKind}
        data-shell-platform={electron ? "electron" : "web"}
        data-shell-chrome="surface"
        data-agent-window-font-smoothing={
          agentWindowFontSmoothingAntialiased ? "antialiased" : "subpixel"
        }
        style={{ ...rootSurfaceProps.style, ...baseColorVars, ...shellStyle }}
        ref={agentWindowRef}
      >
        <RightWorkbenchWindowExpander electron={electron} />
        <LeftAside mode={modes.left}>{props.left}</LeftAside>

        <div className="flex h-full min-h-0 min-w-0 w-full flex-1 flex-col">
          <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-row">
            <ShellCenterBoundary>{props.center}</ShellCenterBoundary>

            {showRight && props.right ? (
              <RightAside
                cwd={props.cwd}
                workspaceKey={workspaceKey}
                routeThreadId={routeThreadId}
                right={props.right}
                keybindings={keybindings}
                threadTitle={props.threadTitle ?? null}
              />
            ) : null}
          </div>
        </div>

        <ShellOverlayBackdrop />

        <ShellHeaderControls showRight={showRight} workspaceKey={workspaceKey} />
      </div>
    </ShellLayoutProvider>
  );
}
