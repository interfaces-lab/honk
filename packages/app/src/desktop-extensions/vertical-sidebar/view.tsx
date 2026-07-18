import { create, props } from "@stylexjs/stylex";
import {
  Icon,
  ListRow,
  Matrix,
  Menu,
  SessionTabPreviewProvider,
  SessionTabPreviewTooltip,
  StatusDot,
  type TabDescriptor,
} from "@honk/ui";
import {
  IconChanges,
  IconChevronRightMedium,
  IconCrossSmall,
  IconFilter2,
  IconFolder1,
  IconFolderAddRight,
  IconFolderOpen,
  IconGlobe,
  IconHomeRoofDoor,
  IconPlusSmall,
} from "@honk/ui/icons";
import { colorVars, motionVars, radiusVars, shellVars, sidebarVars } from "@honk/ui/tokens.stylex";
import {
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
} from "react";

import { useAppSettings } from "../../app-settings-store";
import { canPickFolder, pickFolder } from "../../desktop-bridge";
import { DevChannelChip } from "../../dev-channel-chip";
import { OpenTabContextMenu, WorkspaceContextMenu } from "../../tab-context-menu";
import { TitleBarTrailing } from "../../update-pill";
import type { HonkDesktopCell, HonkDesktopTabs } from "../sdk";
import {
  STATUS_FILTER_OPTIONS,
  buildWorkspaceDrop,
  filterWorkspaceGroups,
  groupWorkspaceTabs,
  isPathBackedGroup,
  mergeWorkspaceOrder,
  statusLabel,
  statusTone,
  toggleCollapsedKey,
  toggleSessionCollapsedKey,
  type StatusFilter,
  type WorkspaceTabGroup,
} from "./model";

const DRAG_ACTIVATION_DISTANCE = 4;
const WORKSPACE_ORDER_CAP = 50;
const DROP_INDICATOR_OFFSET = "-1px";
const CHEVRON_OPEN_TRANSFORM = "rotate(90deg)";
const SIDEBAR_LIST_GAP = "1px";
const HOVER_ACTION_SIZE = "20px";
// Matches ListRow sm inline pad so absolute hover actions sit inside the row highlight.
const HOVER_ACTION_INLINE_END = sidebarVars["--honk-sidebar-row-padding-inline"];

const TITLE_PRIMARY = { color: colorVars["--honk-color-text-primary"] } as const;
const TITLE_MUTED = { color: colorVars["--honk-color-text-muted"] } as const;
const TITLE_FAINT = { color: colorVars["--honk-color-text-faint"] } as const;

const styles = create({
  root: {
    width: "100%",
    height: "100%",
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    backgroundColor: "transparent",
  },
  topBar: {
    height: shellVars["--honk-shell-titlebar-h"],
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingTop: shellVars["--honk-shell-titlebar-seat"],
    // Match navigation gutter so the DEV chip shares the sidebar content inset.
    paddingInline: sidebarVars["--honk-sidebar-gutter-inline"],
  },
  navigation: {
    minHeight: 0,
    flexGrow: 1,
    display: "flex",
    flexDirection: "column",
    overflowY: "auto",
    paddingInline: sidebarVars["--honk-sidebar-gutter-inline"],
    paddingBlockStart: sidebarVars["--honk-sidebar-gutter-inline"],
    paddingBlockEnd: sidebarVars["--honk-sidebar-gutter-inline"],
    gap: SIDEBAR_LIST_GAP,
  },
  home: {
    flexShrink: 0,
  },
  workspaceCollection: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: SIDEBAR_LIST_GAP,
  },
  collectionHeader: {
    "--_collection-action-opacity": {
      default: "0",
      ":hover": { "@media (hover: hover)": "0.65" },
      ":focus-within": "0.65",
    },
    "--_collection-action-pointer-events": {
      default: "none",
      ":hover": { "@media (hover: hover)": "auto" },
      ":focus-within": "auto",
    },
    position: "relative",
    minWidth: 0,
  },
  fade: {
    transitionProperty: "opacity",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-hover"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
  },
  fadeAndMove: {
    transitionProperty: "opacity, transform",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-hover"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
  },
  collectionActions: {
    position: "absolute",
    insetBlock: 0,
    insetInlineEnd: HOVER_ACTION_INLINE_END,
    display: "inline-flex",
    alignItems: "center",
    gap: sidebarVars["--honk-sidebar-item-gap"],
    opacity: "var(--_collection-action-opacity, 0)",
    pointerEvents: "var(--_collection-action-pointer-events, none)",
  },
  collectionActionsActive: {
    opacity: 1,
    pointerEvents: "auto",
  },
  actionSpacer: {
    display: "block",
    width: HOVER_ACTION_SIZE,
    height: 0,
  },
  workspaceList: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: SIDEBAR_LIST_GAP,
  },
  group: {
    position: "relative",
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: SIDEBAR_LIST_GAP,
  },
  workspaceRow: {
    "--_workspace-folder-opacity": {
      default: "1",
      ":hover": { "@media (hover: hover)": "0" },
      ":focus-within": "0",
    },
    "--_workspace-chevron-opacity": {
      default: "0",
      ":hover": { "@media (hover: hover)": "1" },
      ":focus-within": "1",
    },
    "--_workspace-action-opacity": {
      default: "0",
      ":hover": { "@media (hover: hover)": "1" },
      ":focus-within": "1",
    },
    "--_workspace-action-pointer-events": {
      default: "none",
      ":hover": { "@media (hover: hover)": "auto" },
      ":focus-within": "auto",
    },
    position: "relative",
    minWidth: 0,
  },
  workspaceGlyph: {
    position: "relative",
    width: "100%",
    height: "100%",
    display: "grid",
    placeItems: "center",
  },
  workspaceFolder: {
    position: "absolute",
    opacity: "var(--_workspace-folder-opacity, 1)",
  },
  workspaceFolderClosed: {
    transform: "scale(0.95)",
  },
  workspaceChevron: {
    position: "absolute",
    opacity: "var(--_workspace-chevron-opacity, 0)",
  },
  workspaceChevronOpen: {
    transform: CHEVRON_OPEN_TRANSFORM,
  },
  workspaceAction: {
    position: "absolute",
    insetBlock: 0,
    insetInlineEnd: HOVER_ACTION_INLINE_END,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    opacity: "var(--_workspace-action-opacity, 0)",
    pointerEvents: "var(--_workspace-action-pointer-events, none)",
  },
  groupTabs: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: SIDEBAR_LIST_GAP,
  },
  chevron: {
    display: "flex",
    opacity: "var(--_collection-action-opacity, 0)",
  },
  chevronOpen: {
    transform: CHEVRON_OPEN_TRANSFORM,
  },
  row: {
    "--_tab-close-opacity": {
      default: "0",
      ":hover": { "@media (hover: hover)": "1" },
      ":focus-within": "1",
    },
    "--_tab-close-pointer-events": {
      default: "none",
      ":hover": { "@media (hover: hover)": "auto" },
      ":focus-within": "auto",
    },
    position: "relative",
    minWidth: 0,
  },
  rowActive: {
    "--_tab-close-opacity": "1",
    "--_tab-close-pointer-events": "auto",
  },
  closeSpacer: {
    display: "block",
    width: HOVER_ACTION_SIZE,
    height: 0,
  },
  close: {
    position: "absolute",
    insetBlock: 0,
    insetInlineEnd: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    opacity: "var(--_tab-close-opacity, 0)",
    pointerEvents: "var(--_tab-close-pointer-events, none)",
  },
  dragging: {
    opacity: 0.45,
  },
  dropIndicator: {
    "::before": {
      position: "absolute",
      insetInline: 0,
      zIndex: 1,
      height: "2px",
      borderRadius: radiusVars["--honk-radius-pill"],
      backgroundColor: colorVars["--honk-color-accent"],
      content: "",
      pointerEvents: "none",
    },
  },
  dropBefore: {
    "::before": {
      top: DROP_INDICATOR_OFFSET,
    },
  },
  dropAfter: {
    "::before": {
      bottom: DROP_INDICATOR_OFFSET,
    },
  },
  empty: {
    paddingInline: sidebarVars["--honk-sidebar-row-padding-inline"],
    paddingBlock: sidebarVars["--honk-sidebar-row-padding-block"],
    color: colorVars["--honk-color-text-faint"],
    fontSize: sidebarVars["--honk-sidebar-label-size"],
    lineHeight: sidebarVars["--honk-sidebar-label-leading"],
  },
  footer: {
    flexShrink: 0,
    paddingInline: sidebarVars["--honk-sidebar-gutter-inline"],
    paddingBlock: sidebarVars["--honk-sidebar-gutter-inline"],
  },
});

const forward = {
  matrixFit: { transform: "scale(0.8)" },
} as const;

type WorkspaceDragSession = {
  readonly pointerId: number;
  readonly sourceKey: string;
  readonly originY: number;
  readonly element: HTMLButtonElement;
  isDragging: boolean;
  anchorKey: string | null;
  dropAfter: boolean;
};

type WorkspaceDragVisual = {
  readonly sourceKey: string;
  readonly anchorKey: string | null;
  readonly dropAfter: boolean;
};

type RowMouseHandler = (event: MouseEvent<HTMLButtonElement>) => void;
type RowPointerHandler = (event: PointerEvent<HTMLButtonElement>) => void;

type TabRowHandlers = {
  readonly activate: RowMouseHandler;
  readonly close: RowMouseHandler;
  readonly create: RowMouseHandler;
};

type WorkspaceDragHandlers = {
  readonly pointerDown: RowPointerHandler;
  readonly pointerMove: RowPointerHandler;
  readonly pointerUp: RowPointerHandler;
  readonly pointerCancel: RowPointerHandler;
};

type VerticalSidebarInput = {
  readonly tabs: HonkDesktopTabs;
  readonly collapsedGroups: HonkDesktopCell<readonly string[]>;
  readonly workspaceOrder: HonkDesktopCell<readonly string[]>;
  readonly workspacesOpen: HonkDesktopCell<boolean>;
  readonly threadFilters: HonkDesktopCell<readonly StatusFilter[]>;
};

export function VerticalSidebar(input: VerticalSidebarInput): ReactElement {
  const snapshot = useTabs(input.tabs);
  const persistedCollapsedKeys = useCell(input.collapsedGroups);
  const rankedWorkspaceKeys = useCell(input.workspaceOrder);
  const isWorkspaceCollectionOpen = useCell(input.workspacesOpen);
  const threadFilters = useCell(input.threadFilters);
  const workspaceCollectionID = useId();
  const groups = groupWorkspaceTabs(snapshot.tabs);
  const orderedGroups = mergeWorkspaceOrder(groups, rankedWorkspaceKeys);
  const visibleGroups = filterWorkspaceGroups(orderedGroups, threadFilters);
  const suppressWorkspaceActivationKey = useRef<string | null>(null);
  const collapse = useWorkspaceCollapse({
    cell: input.collapsedGroups,
    groups,
    persistedKeys: persistedCollapsedKeys,
    suppressActivationKey: suppressWorkspaceActivationKey,
  });
  const workspaceDrag = useWorkspaceDrag({
    cell: input.workspaceOrder,
    groups,
    rankedKeys: rankedWorkspaceKeys,
    suppressActivationKey: suppressWorkspaceActivationKey,
  });
  const tabHandlers = createTabHandlers(input.tabs);
  const toggleCollection = (): void => {
    input.workspacesOpen.set((current) => !current);
  };

  return (
    <SessionTabPreviewProvider>
      <aside aria-label="Open tabs" {...props(styles.root)}>
        <div data-shell-drag-region="" {...props(styles.topBar)}>
          <TitleBarTrailing>{import.meta.env.DEV ? <DevChannelChip /> : null}</TitleBarTrailing>
        </div>
        <nav aria-label="Open tabs" data-honk-scrollport {...props(styles.navigation)}>
          <HomeTabRow
            tab={snapshot.tabs.find((tab) => tab.kind === "home")}
            activeKey={snapshot.activeKey}
            onActivate={tabHandlers.activate}
          />
          <WorkspaceCollection
            tabs={input.tabs}
            groups={visibleGroups}
            activeKey={snapshot.activeKey}
            collectionID={workspaceCollectionID}
            isOpen={isWorkspaceCollectionOpen}
            filters={threadFilters}
            collapsedKeys={collapse.keys}
            drag={workspaceDrag.visual}
            onToggleCollection={toggleCollection}
            onToggleWorkspace={collapse.toggle}
            dragHandlers={workspaceDrag.handlers}
            tabHandlers={tabHandlers}
            threadFilters={input.threadFilters}
          />
        </nav>
        <div {...props(styles.footer)}>
          <ListRow size="sm" onClick={tabHandlers.create}>
            <ListRow.Slot>
              <Icon icon={IconPlusSmall} size="sm" tone="muted" />
            </ListRow.Slot>
            <ListRow.Title style={TITLE_MUTED}>New thread</ListRow.Title>
          </ListRow>
        </div>
      </aside>
    </SessionTabPreviewProvider>
  );
}

function HomeTabRow(input: {
  readonly tab: TabDescriptor | undefined;
  readonly activeKey: string;
  readonly onActivate: RowMouseHandler;
}): ReactElement | null {
  if (input.tab === undefined || input.tab.kind !== "home") return null;
  const isActive = input.activeKey === input.tab.key;
  return (
    <div {...props(styles.home)}>
      <OpenTabContextMenu tab={input.tab}>
        <ListRow
          size="sm"
          data-honk-desktop-tab-key={input.tab.key}
          aria-current={isActive ? "page" : undefined}
          isSelected={isActive}
          onClick={input.onActivate}
        >
          <ListRow.Slot>
            <TabGlyph tab={input.tab} />
          </ListRow.Slot>
          <ListRow.Title style={isActive ? TITLE_PRIMARY : TITLE_MUTED}>
            {input.tab.title}
          </ListRow.Title>
        </ListRow>
      </OpenTabContextMenu>
    </div>
  );
}

function WorkspaceCollection(input: {
  readonly tabs: HonkDesktopTabs;
  readonly groups: readonly WorkspaceTabGroup[];
  readonly activeKey: string;
  readonly collectionID: string;
  readonly isOpen: boolean;
  readonly filters: readonly StatusFilter[];
  readonly collapsedKeys: ReadonlySet<string>;
  readonly drag: WorkspaceDragVisual | null;
  readonly onToggleCollection: () => void;
  readonly onToggleWorkspace: RowMouseHandler;
  readonly dragHandlers: WorkspaceDragHandlers;
  readonly tabHandlers: TabRowHandlers;
  readonly threadFilters: HonkDesktopCell<readonly StatusFilter[]>;
}): ReactElement {
  const filtersActive = input.filters.length > 0;
  const canOpenWorkspace = canPickFolder();
  const appSettings = useAppSettings();
  const openWorkspaceFolder = (): void => {
    void openWorkspace(input.tabs, appSettings.defaultProjectDirectory);
  };

  return (
    <section aria-label="Workspace tabs" {...props(styles.workspaceCollection)}>
      <div {...props(styles.collectionHeader)}>
        <ListRow
          size="sm"
          aria-expanded={input.isOpen}
          aria-controls={input.isOpen ? input.collectionID : undefined}
          onClick={input.onToggleCollection}
        >
          <ListRow.Title style={TITLE_FAINT}>Workspaces</ListRow.Title>
          <ListRow.Meta>
            <span
              {...props(styles.chevron, styles.fadeAndMove, input.isOpen && styles.chevronOpen)}
            >
              <Icon icon={IconChevronRightMedium} size="xs" tone="faint" />
            </span>
            {Array.from({ length: canOpenWorkspace ? 2 : 1 }, renderActionSpacer)}
          </ListRow.Meta>
        </ListRow>
        <div
          {...props(
            styles.collectionActions,
            styles.fade,
            filtersActive && styles.collectionActionsActive,
          )}
        >
          <Menu.Root>
            <Menu.Trigger
              render={
                <ListRow.Action
                  aria-label="Filter threads"
                  title="Filter threads"
                  isActive={filtersActive}
                />
              }
            >
              <Icon icon={IconFilter2} size="sm" />
            </Menu.Trigger>
            <Menu.Popup align="start" side="bottom">
              {STATUS_FILTER_OPTIONS.map((option) => (
                <Menu.CheckboxItem
                  key={option.value}
                  checked={input.filters.includes(option.value)}
                  onCheckedChange={() => toggleStatusFilter(input.threadFilters, option.value)}
                >
                  {option.label}
                </Menu.CheckboxItem>
              ))}
            </Menu.Popup>
          </Menu.Root>
          {canOpenWorkspace ? (
            <ListRow.Action
              aria-label="Open workspace"
              title="Open workspace"
              onClick={openWorkspaceFolder}
            >
              <Icon icon={IconFolderAddRight} size="sm" />
            </ListRow.Action>
          ) : null}
        </div>
      </div>
      {input.isOpen ? (
        <div id={input.collectionID} {...props(styles.workspaceList)}>
          {input.groups.length === 0 ? (
            <div {...props(styles.empty)}>
              {filtersActive ? "No matching workspace tabs" : "No open workspace tabs"}
            </div>
          ) : (
            input.groups.map((group, index) => (
              <WorkspaceGroup
                key={group.key}
                group={group}
                activeKey={input.activeKey}
                panelID={`${input.collectionID}-${index}`}
                isOpen={!input.collapsedKeys.has(group.key)}
                isDragging={input.drag?.sourceKey === group.key}
                dropAfter={input.drag?.anchorKey === group.key ? input.drag.dropAfter : null}
                onToggleWorkspace={input.onToggleWorkspace}
                dragHandlers={input.dragHandlers}
                tabHandlers={input.tabHandlers}
              />
            ))
          )}
        </div>
      ) : null}
    </section>
  );
}

function WorkspaceGroup(input: {
  readonly group: WorkspaceTabGroup;
  readonly activeKey: string;
  readonly panelID: string;
  readonly isOpen: boolean;
  readonly isDragging: boolean;
  readonly dropAfter: boolean | null;
  readonly onToggleWorkspace: RowMouseHandler;
  readonly dragHandlers: WorkspaceDragHandlers;
  readonly tabHandlers: TabRowHandlers;
}): ReactElement | null {
  const seedTab = input.group.tabs[0]?.tab;
  if (seedTab === undefined) return null;
  const hasActiveTab = input.group.tabs.some((entry) => entry.tab.key === input.activeKey);

  return (
    <section
      aria-label={`${input.group.label} tabs`}
      data-honk-desktop-workspace-section-key={input.group.key}
      {...props(
        styles.group,
        input.isDragging && styles.dragging,
        input.dropAfter !== null && styles.dropIndicator,
        input.dropAfter === false && styles.dropBefore,
        input.dropAfter === true && styles.dropAfter,
      )}
    >
      <WorkspaceContextMenu
        tabKey={seedTab.key}
        {...(input.group.path === undefined ? {} : { path: input.group.path })}
      >
        <WorkspaceHeader
          group={input.group}
          seedTab={seedTab}
          panelID={input.panelID}
          isOpen={input.isOpen}
          hasActiveTab={hasActiveTab}
          onToggleWorkspace={input.onToggleWorkspace}
          dragHandlers={input.dragHandlers}
          onCreateTab={input.tabHandlers.create}
        />
      </WorkspaceContextMenu>
      {input.isOpen ? (
        <div
          id={input.panelID}
          role="group"
          aria-label={`${input.group.label} open tabs`}
          {...props(styles.groupTabs)}
        >
          {input.group.tabs.map((entry) => (
            <TabRow
              key={entry.tab.key}
              tab={entry.tab}
              isActive={input.activeKey === entry.tab.key}
              onActivate={input.tabHandlers.activate}
              onClose={input.tabHandlers.close}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function WorkspaceHeader(input: {
  readonly group: WorkspaceTabGroup;
  readonly seedTab: Exclude<TabDescriptor, { readonly kind: "home" }>;
  readonly panelID: string;
  readonly isOpen: boolean;
  readonly hasActiveTab: boolean;
  readonly onToggleWorkspace: RowMouseHandler;
  readonly dragHandlers: WorkspaceDragHandlers;
  readonly onCreateTab: RowMouseHandler;
}): ReactElement {
  const accessibleLabel = [
    input.group.label,
    input.group.serverLabel,
    `${input.group.tabs.length} open ${input.group.tabs.length === 1 ? "tab" : "tabs"}`,
  ]
    .filter((value): value is string => value !== undefined)
    .join(", ");

  return (
    <div {...props(styles.workspaceRow)}>
      <ListRow
        size="sm"
        data-honk-desktop-workspace-drag-key={input.group.key}
        aria-label={accessibleLabel}
        aria-expanded={input.isOpen}
        aria-controls={input.isOpen ? input.panelID : undefined}
        title={input.group.path ?? input.group.label}
        onClick={input.onToggleWorkspace}
        onPointerDown={input.dragHandlers.pointerDown}
        onPointerMove={input.dragHandlers.pointerMove}
        onPointerUp={input.dragHandlers.pointerUp}
        onPointerCancel={input.dragHandlers.pointerCancel}
      >
        <ListRow.Slot>
          <span {...props(styles.workspaceGlyph)}>
            <span
              {...props(
                styles.workspaceFolder,
                styles.fadeAndMove,
                !input.isOpen && styles.workspaceFolderClosed,
              )}
            >
              <Icon icon={input.isOpen ? IconFolderOpen : IconFolder1} size="sm" tone="faint" />
            </span>
            <span
              {...props(
                styles.workspaceChevron,
                styles.fadeAndMove,
                input.isOpen && styles.workspaceChevronOpen,
              )}
            >
              <Icon icon={IconChevronRightMedium} size="sm" tone="faint" />
            </span>
          </span>
        </ListRow.Slot>
        <ListRow.Content>
          <ListRow.Title style={input.hasActiveTab ? TITLE_PRIMARY : TITLE_MUTED}>
            {input.group.label}
          </ListRow.Title>
        </ListRow.Content>
        <ListRow.Meta>
          <span aria-hidden {...props(styles.actionSpacer)} />
        </ListRow.Meta>
      </ListRow>
      <span {...props(styles.workspaceAction, styles.fade)}>
        <ListRow.Action
          data-honk-relative-tab-key={input.seedTab.key}
          aria-label={`New thread in ${input.group.label}`}
          title={`New thread in ${input.group.label}`}
          onClick={input.onCreateTab}
        >
          <Icon icon={IconPlusSmall} size="xs" />
        </ListRow.Action>
      </span>
    </div>
  );
}

function TabRow(input: {
  readonly tab: Exclude<TabDescriptor, { readonly kind: "home" }>;
  readonly isActive: boolean;
  readonly onActivate: RowMouseHandler;
  readonly onClose: RowMouseHandler;
}): ReactElement {
  const accessibleLabel =
    input.tab.server === undefined
      ? input.tab.title
      : `${input.tab.title}, ${input.tab.server.label}`;
  const row = (
    <div {...props(styles.row, input.isActive && styles.rowActive)}>
      <ListRow
        size="sm"
        data-honk-desktop-tab-key={input.tab.key}
        aria-label={accessibleLabel}
        aria-current={input.isActive ? "page" : undefined}
        title={input.tab.title}
        isSelected={input.isActive}
        onClick={input.onActivate}
      >
        <ListRow.Slot>
          <TabGlyph tab={input.tab} />
        </ListRow.Slot>
        <ListRow.Content>
          <ListRow.Title style={input.isActive ? TITLE_PRIMARY : TITLE_MUTED}>
            {input.tab.title}
          </ListRow.Title>
        </ListRow.Content>
        <ListRow.Meta>
          <span aria-hidden {...props(styles.closeSpacer)} />
        </ListRow.Meta>
      </ListRow>
      <span {...props(styles.close, styles.fade)}>
        <ListRow.Action
          data-honk-desktop-tab-key={input.tab.key}
          aria-label={`Close ${input.tab.title}`}
          onClick={input.onClose}
        >
          <Icon icon={IconCrossSmall} size="xs" />
        </ListRow.Action>
      </span>
    </div>
  );
  const withContextMenu = <OpenTabContextMenu tab={input.tab}>{row}</OpenTabContextMenu>;
  if (input.tab.kind !== "thread") return withContextMenu;
  return <SessionTabPreviewTooltip tab={input.tab}>{withContextMenu}</SessionTabPreviewTooltip>;
}

function TabGlyph(input: { readonly tab: TabDescriptor }): ReactElement {
  if (input.tab.kind === "home" && input.tab.status === "idle") {
    return <Icon icon={IconHomeRoofDoor} size="sm" tone="muted" />;
  }
  if (input.tab.kind === "utility") {
    return (
      <Icon
        icon={input.tab.utility === "browser" ? IconGlobe : IconChanges}
        size="sm"
        tone="muted"
      />
    );
  }
  if (input.tab.status === "needs-you") {
    return <Matrix grid={5} variant="attention" isActive style={forward.matrixFit} />;
  }
  if (
    input.tab.status === "working" ||
    (input.tab.kind === "thread" && input.tab.repository.state === "loading")
  ) {
    return <Matrix grid={5} isActive style={forward.matrixFit} />;
  }
  return <StatusDot tone={statusTone(input.tab.status)} label={statusLabel(input.tab.status)} />;
}

function useTabs(tabs: HonkDesktopTabs) {
  return useSyncExternalStore(
    (listener) => tabs.subscribe(listener),
    () => tabs.getSnapshot(),
    () => tabs.getSnapshot(),
  );
}

function useCell<T>(cell: HonkDesktopCell<T>): T {
  return useSyncExternalStore(
    (listener) => cell.subscribe(() => listener()),
    () => cell.get(),
    () => cell.get(),
  );
}

function useWorkspaceCollapse(input: {
  readonly cell: HonkDesktopCell<readonly string[]>;
  readonly groups: readonly WorkspaceTabGroup[];
  readonly persistedKeys: readonly string[];
  readonly suppressActivationKey: { current: string | null };
}): { readonly keys: ReadonlySet<string>; readonly toggle: RowMouseHandler } {
  const groupsRef = useRef(input.groups);
  groupsRef.current = input.groups;
  const [ephemeralKeys, setEphemeralKeys] = useState<readonly string[]>([]);
  const [toggle] = useState(() =>
    createCollapseToggle({
      cell: input.cell,
      groupsRef,
      setEphemeralKeys,
      suppressActivationKey: input.suppressActivationKey,
    }),
  );
  return { keys: collapsedKeySet(input.groups, input.persistedKeys, ephemeralKeys), toggle };
}

function useWorkspaceDrag(input: {
  readonly cell: HonkDesktopCell<readonly string[]>;
  readonly groups: readonly WorkspaceTabGroup[];
  readonly rankedKeys: readonly string[];
  readonly suppressActivationKey: { current: string | null };
}): { readonly visual: WorkspaceDragVisual | null; readonly handlers: WorkspaceDragHandlers } {
  const orderRef = useRef({ groups: input.groups, rankedKeys: input.rankedKeys });
  orderRef.current = { groups: input.groups, rankedKeys: input.rankedKeys };
  const [visual, setVisual] = useState<WorkspaceDragVisual | null>(null);
  const [handlers] = useState(() =>
    createWorkspaceDragHandlers({
      cell: input.cell,
      orderRef,
      setVisual,
      suppressActivationKey: input.suppressActivationKey,
    }),
  );
  return { visual, handlers };
}

function createTabHandlers(tabs: HonkDesktopTabs): TabRowHandlers {
  return {
    activate: (event) => {
      const key = event.currentTarget.dataset.honkDesktopTabKey;
      if (key !== undefined) tabs.activate(key);
    },
    close: (event) => {
      const key = event.currentTarget.dataset.honkDesktopTabKey;
      if (key !== undefined) tabs.close(key);
    },
    create: (event) => {
      tabs.create(event.currentTarget.dataset.honkRelativeTabKey);
    },
  };
}

function createCollapseToggle(input: {
  readonly cell: HonkDesktopCell<readonly string[]>;
  readonly groupsRef: { readonly current: readonly WorkspaceTabGroup[] };
  readonly setEphemeralKeys: (update: (current: readonly string[]) => readonly string[]) => void;
  readonly suppressActivationKey: { current: string | null };
}): RowMouseHandler {
  return (event) => {
    const key = event.currentTarget.dataset.honkDesktopWorkspaceDragKey;
    if (key === undefined) return;
    if (input.suppressActivationKey.current === key) {
      input.suppressActivationKey.current = null;
      return;
    }
    const group = input.groupsRef.current.find((candidate) => candidate.key === key);
    if (group === undefined) return;
    if (!isPathBackedGroup(group)) {
      input.setEphemeralKeys((current) =>
        toggleSessionCollapsedKey(current, key, input.groupsRef.current),
      );
      return;
    }
    input.cell.set((current) =>
      toggleCollapsedKey(current, key, input.groupsRef.current, WORKSPACE_ORDER_CAP),
    );
  };
}

function collapsedKeySet(
  groups: readonly WorkspaceTabGroup[],
  persistedKeys: readonly string[],
  ephemeralKeys: readonly string[],
): ReadonlySet<string> {
  const knownGroups = new Map(groups.map((group) => [group.key, isPathBackedGroup(group)]));
  return new Set([
    ...persistedKeys.filter((key) => knownGroups.get(key) === true),
    ...ephemeralKeys.filter((key) => knownGroups.get(key) === false),
  ]);
}

function createWorkspaceDragHandlers(input: {
  readonly cell: HonkDesktopCell<readonly string[]>;
  readonly orderRef: {
    readonly current: {
      readonly groups: readonly WorkspaceTabGroup[];
      readonly rankedKeys: readonly string[];
    };
  };
  readonly setVisual: (visual: WorkspaceDragVisual | null) => void;
  readonly suppressActivationKey: { current: string | null };
}): WorkspaceDragHandlers {
  let session: WorkspaceDragSession | null = null;

  const finish = (event: PointerEvent<HTMLButtonElement>, isCancelled: boolean): void => {
    if (session === null || session.pointerId !== event.pointerId) return;
    if (!isCancelled && session.isDragging) {
      if (session.anchorKey !== null) {
        input.cell.set(
          buildWorkspaceDrop({
            groups: input.orderRef.current.groups,
            rankedKeys: input.orderRef.current.rankedKeys,
            sourceKey: session.sourceKey,
            anchorKey: session.anchorKey,
            dropAfter: session.dropAfter,
            cap: WORKSPACE_ORDER_CAP,
          }),
        );
      }
      input.suppressActivationKey.current = session.sourceKey;
    }
    if (session.element.hasPointerCapture(session.pointerId)) {
      session.element.releasePointerCapture(session.pointerId);
    }
    session = null;
    input.setVisual(null);
  };

  return {
    pointerDown: (event) => {
      if (event.button !== 0 || event.pointerType === "touch") return;
      const sourceKey = event.currentTarget.dataset.honkDesktopWorkspaceDragKey;
      if (sourceKey === undefined) return;
      session = {
        pointerId: event.pointerId,
        sourceKey,
        originY: event.clientY,
        element: event.currentTarget,
        isDragging: false,
        anchorKey: null,
        dropAfter: false,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    pointerMove: (event) => {
      if (session === null || session.pointerId !== event.pointerId) return;
      if (!session.isDragging) {
        if (Math.abs(event.clientY - session.originY) < DRAG_ACTIVATION_DISTANCE) return;
        session.isDragging = true;
      }
      event.preventDefault();
      const target =
        document
          .elementFromPoint(event.clientX, event.clientY)
          ?.closest<HTMLElement>("[data-honk-desktop-workspace-section-key]") ?? null;
      const anchorKey = target?.dataset.honkDesktopWorkspaceSectionKey;
      if (target === null || anchorKey === undefined || anchorKey === session.sourceKey) {
        session.anchorKey = null;
        input.setVisual({ sourceKey: session.sourceKey, anchorKey: null, dropAfter: false });
        return;
      }
      const bounds = target.getBoundingClientRect();
      session.anchorKey = anchorKey;
      session.dropAfter = event.clientY > bounds.top + bounds.height / 2;
      input.setVisual({ sourceKey: session.sourceKey, anchorKey, dropAfter: session.dropAfter });
    },
    pointerUp: (event) => finish(event, false),
    pointerCancel: (event) => finish(event, true),
  };
}

async function openWorkspace(
  tabs: HonkDesktopTabs,
  defaultDirectory: string | null,
): Promise<void> {
  const directory = await pickFolder(defaultDirectory);
  if (directory !== null) tabs.openDraft(directory);
}

function toggleStatusFilter(
  cell: HonkDesktopCell<readonly StatusFilter[]>,
  value: StatusFilter,
): void {
  cell.set((current) =>
    Object.freeze(
      current.includes(value) ? current.filter((filter) => filter !== value) : [...current, value],
    ),
  );
}

function renderActionSpacer(_value: unknown, index: number): ReactElement {
  return <span key={index} aria-hidden {...props(styles.actionSpacer)} />;
}
