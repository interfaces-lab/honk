import * as stylex from "@stylexjs/stylex";
import { openCodeSessionRef, type OpenCodeSessionRef } from "@honk/opencode";
import { Icon, IconButton, Tooltip } from "@honk/ui";
import { IconSidebarSimpleRightWide, IconWindowSquare } from "@honk/ui/icons";
import { controlVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as React from "react";
import { useParams } from "@tanstack/react-router";

import { removeBrowserResource } from "./browser-store";
import {
  openCodeSideChatHref,
  openCodeWorkbenchClosedHref,
  openCodeWorkbenchTabHref,
  type OpenCodeWorkbenchToolKind,
} from "./opencode/tab-route";
import { actions as tabActions } from "./tab-store";
import type { SubmittedPlan } from "./thread/follow-up";
import { useWorkspaceWatchSelector } from "./use-sdk-watch";
import { useWorkbenchChangesSnapshot } from "./workbench-changes";
import { useWorkbench, workbenchActions, type WorkbenchTab } from "./workbench-controller";
import { workbenchLayout } from "./workbench-layout.stylex";
import { WorkbenchPanelColumn } from "./workbench-panel-column";
import { workbenchPresentation } from "./workbench-presentation";
import { WorkbenchRail, type ChangeBadge } from "./workbench-rail";
import { useWorkbenchSideChatCreation } from "./workbench-side-chat-creation";
import { useWorkbenchSizing } from "./workbench-sizing";
import {
  useWorkbenchTabs,
  workbenchTabActions,
  type WorkbenchSideChatTab,
  type WorkbenchTab as ManagedWorkbenchTab,
} from "./workbench-tab-store";
import type { ToolTodo } from "./tool-part-projection";

const styles = stylex.create({
  column: {
    position: "relative",
    flexShrink: 0,
    height: "100%",
    minHeight: 0,
    display: "flex",
    flexDirection: "row",
    boxSizing: "border-box",
  },
  chromeToggle: {
    position: "absolute",
    insetInlineEnd: spaceVars["--honk-space-panel-pad"],
    insetBlockStart: `calc((${workbenchLayout.headerHeight} - ${controlVars["--honk-control-h-sm"]}) / 2)`,
    zIndex: 2,
  },
});

type WorkbenchProps = {
  readonly workspaceKey: string;
  readonly routeRef: OpenCodeSessionRef;
  readonly isRouteReady: boolean;
  readonly surfaceSessionRef: OpenCodeSessionRef;
  readonly directory: string;
  readonly isThreadRunning: boolean;
  readonly plan: SubmittedPlan | null;
  readonly tasks: readonly ToolTodo[];
};

function Workbench({
  workspaceKey,
  routeRef,
  isRouteReady,
  surfaceSessionRef,
  directory,
  isThreadRunning,
  plan,
  tasks,
}: WorkbenchProps): React.ReactElement {
  // Read the deep link from this route's own matched params, never the global location:
  // during a navigation the location already points at the next route while this tree
  // renders its final frame, so any cross-check against it misfires on every transition.
  const workbenchParams = useParams({
    from: "/server/$serverKey/session/$sessionId/workbench/$workbenchTab",
    shouldThrow: false,
  });
  const sideChatParams = useParams({
    from: "/server/$serverKey/session/$sessionId/side-chat/$sideChatId",
    shouldThrow: false,
  });
  const routeTabID = workbenchParams?.workbenchTab ?? null;
  const routeSideChatID = sideChatParams?.sideChatId ?? null;
  const routeServer = routeRef.server;
  const routeSessionID = routeRef.sessionID;
  const surfaceServer = surfaceSessionRef.server;
  const surfaceSessionID = surfaceSessionRef.sessionID;
  const workbenchState = useWorkbench((current) => current);
  const { isRailMinimized, width } = workbenchState;
  const workspaceTabs = useWorkbenchTabs(workspaceKey);
  const changesSnapshot = useWorkbenchChangesSnapshot(
    surfaceSessionRef,
    directory,
    isThreadRunning,
  );
  const { createSideChat, isCreatingSideChat } = useWorkbenchSideChatCreation({
    isRouteReady,
    parentRef: routeRef,
    workspaceKey,
    onOpen: (tab) => {
      activateTab(tab);
    },
  });
  const {
    attachColumn,
    availablePanelWidth,
    handleSashKeyDown,
    handleSashPointerDown,
    handleSashPointerEnd,
    handleSashPointerMove,
    isResizing,
    isResponsiveCompact,
    panelWidth,
  } = useWorkbenchSizing(width);
  const managedTabs = workspaceTabs.tabs;
  const sideChatTabs = workspaceTabs.sideChats;
  const childSessions = useWorkspaceWatchSelector(
    (snapshot) => snapshot.state?.childSessions ?? [],
  );
  const presentation = workbenchPresentation({
    activeTabID: workspaceTabs.activeTabID,
    childSessions,
    expanded: workspaceTabs.expanded,
    isCreatingSideChat,
    managedTabs,
    planPresent: plan !== null,
    sideChatTabs,
    tasks,
  });
  const {
    activeTab,
    headerMenuItems,
    headerTabs,
    isOpen,
    openTabs,
    sideChatLabels,
    tabLabels,
    taskProgress,
    terminalCount,
    toolTabs,
    visibleTabs,
  } = presentation;
  const isCompact = isResponsiveCompact || isRailMinimized;
  const changeBadge =
    changesSnapshot.phase === "ready"
      ? changesSnapshot.files.reduce<ChangeBadge>(
          (totals, file) => ({
            additions: totals.additions + file.additions,
            deletions: totals.deletions + file.deletions,
          }),
          { additions: 0, deletions: 0 },
        )
      : undefined;
  React.useLayoutEffect(() => {
    if (plan === null) return;
    workbenchTabActions.ensureTool(
      workspaceKey,
      "tasks",
      openCodeSessionRef(surfaceServer, surfaceSessionID),
    );
  }, [plan, surfaceServer, surfaceSessionID, workspaceKey]);

  React.useLayoutEffect(() => {
    if (!isRouteReady) return;
    const target =
      routeTabID !== null
        ? ({ type: "tab", tabID: routeTabID } as const)
        : routeSideChatID !== null
          ? ({ type: "side-chat", sessionID: routeSideChatID } as const)
          : null;
    if (target === null) return;
    const owner = openCodeSessionRef(routeServer, routeSessionID);
    const tab = workbenchTabActions.ensureRoute(workspaceKey, target, owner);
    if (target.type === "tab" && tab.id !== target.tabID) {
      tabActions.openSessionRoute(owner, openCodeWorkbenchTabHref(owner, tab.id), {
        replace: true,
      });
    }
  }, [isRouteReady, routeServer, routeSessionID, routeSideChatID, routeTabID, workspaceKey]);

  const activateTab = (tab: ManagedWorkbenchTab): void => {
    if (!isRouteReady) return;
    workbenchTabActions.activate(workspaceKey, tab.id);
    if (tab.kind !== "side-chat") {
      workbenchActions.rememberTab(tab.kind);
    }
    const ref = tab.kind === "side-chat" ? tab.parent : routeRef;
    const href =
      tab.kind === "side-chat"
        ? openCodeSideChatHref(ref, tab.child.sessionID)
        : openCodeWorkbenchTabHref(ref, tab.id);
    tabActions.openSessionRoute(ref, href);
  };

  const openTool = (kind: OpenCodeWorkbenchToolKind, newInstance = false): void => {
    if (!isRouteReady) return;
    const tab = workbenchTabActions.openTool(workspaceKey, kind, routeRef, { newInstance });
    activateTab(tab);
  };

  const collapseWorkbench = (): void => {
    if (!isRouteReady) return;
    workbenchTabActions.setExpanded(workspaceKey, false);
    tabActions.openSessionRoute(routeRef, openCodeWorkbenchClosedHref(routeRef));
  };

  const expandWorkbench = (): void => {
    if (!isRouteReady) return;
    if (activeTab !== null) {
      activateTab(activeTab);
      return;
    }
    openTool(workbenchState.lastTab);
  };

  const closeTab = (tab: ManagedWorkbenchTab): void => {
    if (!isRouteReady) return;
    const wasActive = activeTab?.id === tab.id;
    const result = workbenchTabActions.close(workspaceKey, tab.id);
    if (tab.kind === "browser") removeBrowserResource(tab.owner, tab.browserID);
    if (!wasActive) return;
    const fallback = managedTabs.find((candidate) => candidate.id === result.activeTabID);
    if (fallback === undefined) {
      tabActions.openSessionRoute(routeRef, openCodeWorkbenchClosedHref(routeRef));
      return;
    }
    activateTab(fallback);
  };

  const reopenSideChat = (tab: WorkbenchSideChatTab): void => {
    if (!isRouteReady) return;
    const opened = workbenchTabActions.openSideChat(workspaceKey, tab.parent, tab.child, tab.label);
    activateTab(opened);
  };

  const openRailItems = openTabs.map(({ tab, entry }) => ({
    id: `open:${tab.id}`,
    label: tabLabels.get(tab.id) ?? tab.kind,
    icon: entry.icon,
    onOpen: () => {
      activateTab(tab);
    },
  }));
  const toolRailItems = visibleTabs.map((entry) => {
    const label =
      entry.id === "terminal" && terminalCount > 0
        ? `${String(terminalCount)} ${terminalCount === 1 ? "Terminal" : "Terminals"}`
        : entry.label;
    return {
      id: `tool:${entry.id}`,
      label,
      ...(entry.id === "tasks" && plan === null
        ? { compactLabel: `${entry.label}, ${taskProgress} complete`, detail: taskProgress }
        : {}),
      icon: entry.icon,
      ...(entry.id === "changes" && changeBadge !== undefined ? { badge: changeBadge } : {}),
      onOpen: () => {
        openTool(entry.id);
      },
    };
  });
  const sideChatRailItems = sideChatTabs.map((tab) => ({
    id: `side-chat:${tab.id}`,
    label: sideChatLabels.get(tab.id) ?? tab.label,
    icon: IconWindowSquare,
    onOpen: () => {
      reopenSideChat(tab);
    },
  }));

  return (
    <aside
      ref={attachColumn}
      aria-busy={!isRouteReady}
      aria-label="Workbench"
      inert={!isRouteReady}
      {...stylex.props(styles.column)}
    >
      <WorkbenchPanelColumn
        activeTabID={activeTab?.id ?? null}
        availablePanelWidth={availablePanelWidth}
        directory={directory}
        headerMenuItems={headerMenuItems}
        headerTabs={headerTabs}
        isOpen={isOpen}
        isResizing={isResizing}
        isThreadRunning={isThreadRunning}
        managedTabs={managedTabs}
        panelWidth={panelWidth}
        plan={plan}
        tasks={tasks}
        onActivateTab={(id) => {
          const tab = managedTabs.find((candidate) => candidate.id === id);
          if (tab !== undefined) activateTab(tab);
        }}
        onCloseTab={(id) => {
          const tab = managedTabs.find((candidate) => candidate.id === id);
          if (tab !== undefined) closeTab(tab);
        }}
        onCreateItem={(id) => {
          if (id === "side-chat:new") {
            void createSideChat();
            return;
          }
          const entry = toolTabs.find((candidate) => `tool:${candidate.id}` === id);
          if (entry !== undefined) {
            openTool(entry.id, entry.id === "terminal" || entry.id === "browser");
          }
        }}
        onOpenChanges={() => {
          openTool("changes");
        }}
        onOpenTasks={() => {
          openTool("tasks");
        }}
        onSashKeyDown={handleSashKeyDown}
        onSashPointerDown={handleSashPointerDown}
        onSashPointerEnd={handleSashPointerEnd}
        onSashPointerMove={handleSashPointerMove}
      />
      <div {...stylex.props(styles.chromeToggle)}>
        <Tooltip label={isOpen ? "Collapse workbench" : "Open workbench"}>
          <IconButton
            type="button"
            aria-label={isOpen ? "Collapse workbench" : "Open workbench"}
            aria-pressed={isOpen}
            size="sm"
            variant="quiet"
            onClick={isOpen ? collapseWorkbench : expandWorkbench}
          >
            <Icon icon={IconSidebarSimpleRightWide} size="sm" />
          </IconButton>
        </Tooltip>
      </div>
      {!isOpen ? (
        <WorkbenchRail
          compact={isCompact}
          minimized={isRailMinimized}
          responsiveCompact={isResponsiveCompact}
          directory={directory}
          openItems={openRailItems}
          toolItems={toolRailItems}
          sideChatItems={sideChatRailItems}
          isCreatingSideChat={isCreatingSideChat}
          onCreateSideChat={() => {
            void createSideChat();
          }}
          onMinimizedChange={workbenchActions.setRailMinimized}
        />
      ) : null}
    </aside>
  );
}

export { Workbench };
export type { WorkbenchTab };
