import * as stylex from "@stylexjs/stylex";
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
import { colorVars, motionVars, radiusVars, shellVars, sidebarVars } from "@honk/ui/tokens.stylex";
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
import * as React from "react";

import { useAppSettings } from "../app-settings-store";
import { canPickFolder, pickFolder } from "../desktop-bridge";
import { DevChannelChip } from "../dev-channel-chip";
import { OpenTabContextMenu, WorkspaceContextMenu } from "../tab-context-menu";
import { actions as tabActions } from "../tab-store";
import { TitleBarTrailing } from "../update-pill";
import { defineHonkDesktopExtension, type HonkDesktopCell, type HonkDesktopTabs } from "./sdk";

const SIDEBAR_DEFAULT_SIZE = 232;
const SIDEBAR_MIN_SIZE = 184;
const SIDEBAR_MAX_SIZE = 360;
const DRAG_ACTIVATION_DISTANCE = 4;
const DRAGGING_OPACITY = 0.45;
const DROP_INDICATOR_SIZE = "2px";
const DROP_INDICATOR_OFFSET = "-1px";
const CHEVRON_OPEN_TRANSFORM = "rotate(90deg)";
const WORKSPACE_FOLDER_CLOSED_TRANSFORM = "scale(0.95)";
const MATRIX_FIT_SCALE = 0.8;
const SIDEBAR_LIST_GAP = "1px";
const HOVER_ACTION_SIZE = "20px";
// Matches ListRow sm inline pad so absolute hover actions sit inside the row highlight.
const HOVER_ACTION_INLINE_END = sidebarVars["--honk-sidebar-row-padding-inline"];

const STATUS_FILTER_OPTIONS = [
  { value: "working", label: "Working" },
  { value: "needs-you", label: "Needs you" },
  { value: "idle", label: "Idle" },
  { value: "done", label: "Done" },
  { value: "failed", label: "Failed" },
  { value: "draft", label: "Draft" },
] as const satisfies readonly {
  readonly value: TabDescriptor["status"];
  readonly label: string;
}[];

type StatusFilter = (typeof STATUS_FILTER_OPTIONS)[number]["value"];

const TITLE_PRIMARY = { color: colorVars["--honk-color-text-primary"] } as const;
const TITLE_MUTED = { color: colorVars["--honk-color-text-muted"] } as const;
const TITLE_FAINT = { color: colorVars["--honk-color-text-faint"] } as const;

const styles = stylex.create({
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
  collectionActions: {
    position: "absolute",
    insetBlock: 0,
    insetInlineEnd: HOVER_ACTION_INLINE_END,
    display: "inline-flex",
    alignItems: "center",
    gap: sidebarVars["--honk-sidebar-item-gap"],
    opacity: "var(--_collection-action-opacity, 0)",
    pointerEvents: "var(--_collection-action-pointer-events, none)",
    transitionProperty: "opacity",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-hover"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
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
    transitionProperty: "opacity, transform",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-hover"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
  },
  workspaceFolderClosed: {
    transform: WORKSPACE_FOLDER_CLOSED_TRANSFORM,
  },
  workspaceChevron: {
    position: "absolute",
    opacity: "var(--_workspace-chevron-opacity, 0)",
    transitionProperty: "opacity, transform",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-hover"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
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
    transitionProperty: "opacity",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-hover"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
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
    transitionProperty: "opacity, transform",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-hover"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
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
    touchAction: "pan-y",
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
    transitionProperty: "opacity",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-hover"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
  },
  dragging: {
    opacity: DRAGGING_OPACITY,
  },
  dropIndicator: {
    "::before": {
      position: "absolute",
      insetInline: 0,
      zIndex: 1,
      height: DROP_INDICATOR_SIZE,
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
  matrixFit: { transform: `scale(${MATRIX_FIT_SCALE})` },
} as const;

type DragSession = {
  readonly pointerId: number;
  readonly sourceKey: string;
  readonly workspaceKey: string;
  readonly fromIndex: number;
  readonly originY: number;
  readonly element: HTMLButtonElement;
  isDragging: boolean;
  targetIndex: number | null;
  targetKey: string | null;
  dropAfter: boolean;
};

type DragVisual = {
  readonly sourceKey: string;
  readonly targetKey: string | null;
  readonly dropAfter: boolean;
};

type SidebarTab = Exclude<TabDescriptor, { readonly kind: "home" }>;

type IndexedSidebarTab = {
  readonly tab: SidebarTab;
  readonly index: number;
};

type WorkspaceTabGroup = {
  readonly key: string;
  readonly label: string;
  readonly path?: string;
  readonly serverLabel?: string;
  readonly tabs: IndexedSidebarTab[];
};

function workspaceLabel(tab: SidebarTab): string {
  if (tab.repository.state === "ready") {
    return tab.repository.label;
  }
  return tab.repository.state === "loading" ? "Loading workspace" : "Workspace unavailable";
}

function workspaceKey(tab: SidebarTab): string {
  const server = tab.server === undefined ? "default" : `${tab.server.kind}:${tab.server.label}`;
  const repository = tab.path ?? `${tab.repository.state}:${tab.key}`;
  return `${server}\u0000${repository}`;
}

function groupWorkspaceTabs(tabs: readonly TabDescriptor[]): readonly WorkspaceTabGroup[] {
  const groups = new Map<string, WorkspaceTabGroup>();
  tabs.forEach((tab, index) => {
    if (tab.kind === "home") {
      return;
    }
    const key = workspaceKey(tab);
    const existing = groups.get(key);
    if (existing !== undefined) {
      existing.tabs.push({ tab, index });
      return;
    }
    groups.set(key, {
      key,
      label: workspaceLabel(tab),
      ...(tab.path === undefined ? {} : { path: tab.path }),
      ...(tab.server === undefined ? {} : { serverLabel: tab.server.label }),
      tabs: [{ tab, index }],
    });
  });
  return [...groups.values()];
}

function tabMatchesFilters(tab: SidebarTab, filters: readonly StatusFilter[]): boolean {
  if (filters.length === 0) {
    return true;
  }
  return filters.includes(tab.status);
}

function VerticalSidebar(props: {
  readonly tabs: HonkDesktopTabs;
  readonly collapsedGroups: HonkDesktopCell<readonly string[]>;
  readonly workspacesOpen: HonkDesktopCell<boolean>;
  readonly threadFilters: HonkDesktopCell<readonly StatusFilter[]>;
}): React.ReactElement {
  const snapshot = React.useSyncExternalStore(
    (listener) => props.tabs.subscribe(listener),
    () => props.tabs.getSnapshot(),
    () => props.tabs.getSnapshot(),
  );
  const dragSession = React.useRef<DragSession | null>(null);
  const suppressActivationKey = React.useRef<string | null>(null);
  const [drag, setDrag] = React.useState<DragVisual | null>(null);
  const collapsedGroupKeys = React.useSyncExternalStore(
    (listener) => props.collapsedGroups.subscribe(listener),
    () => props.collapsedGroups.get(),
    () => props.collapsedGroups.get(),
  );
  const isWorkspaceCollectionOpen = React.useSyncExternalStore(
    (listener) => props.workspacesOpen.subscribe(listener),
    () => props.workspacesOpen.get(),
    () => props.workspacesOpen.get(),
  );
  const threadFilters = React.useSyncExternalStore(
    (listener) => props.threadFilters.subscribe(listener),
    () => props.threadFilters.get(),
    () => props.threadFilters.get(),
  );
  const appSettings = useAppSettings();
  const workspaceCollectionID = React.useId();
  const collapsedGroups = new Set(collapsedGroupKeys);
  const homeTab = snapshot.tabs.find((tab) => tab.kind === "home");
  const filtersActive = threadFilters.length > 0;
  const groups = groupWorkspaceTabs(snapshot.tabs)
    .map((group) => ({
      ...group,
      tabs: group.tabs.filter(({ tab }) => tabMatchesFilters(tab, threadFilters)),
    }))
    .filter((group) => !filtersActive || group.tabs.length > 0);
  const canOpenWorkspace = canPickFolder();
  const collectionActionCount = canOpenWorkspace ? 2 : 1;

  const stopDrag = (event: React.PointerEvent<HTMLButtonElement>, isCancelled: boolean): void => {
    const session = dragSession.current;
    if (session === null || session.pointerId !== event.pointerId) {
      return;
    }
    if (!isCancelled && session.isDragging) {
      if (session.targetIndex !== null) {
        const toIndex = reorderTargetIndex(
          session.fromIndex,
          session.targetIndex,
          session.dropAfter,
        );
        if (toIndex !== session.fromIndex) {
          props.tabs.reorder(session.fromIndex, toIndex);
        }
      }
      suppressActivationKey.current = session.sourceKey;
    }
    if (session.element.hasPointerCapture(session.pointerId)) {
      session.element.releasePointerCapture(session.pointerId);
    }
    dragSession.current = null;
    setDrag(null);
  };

  const startDrag = (
    event: React.PointerEvent<HTMLButtonElement>,
    tab: SidebarTab,
    index: number,
    sourceWorkspaceKey: string,
  ): void => {
    if (event.button !== 0 || event.pointerType === "touch") {
      return;
    }
    dragSession.current = {
      pointerId: event.pointerId,
      sourceKey: tab.key,
      workspaceKey: sourceWorkspaceKey,
      fromIndex: index,
      originY: event.clientY,
      element: event.currentTarget,
      isDragging: false,
      targetIndex: null,
      targetKey: null,
      dropAfter: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const session = dragSession.current;
    if (session === null || session.pointerId !== event.pointerId) {
      return;
    }
    if (
      !session.isDragging &&
      Math.abs(event.clientY - session.originY) < DRAG_ACTIVATION_DISTANCE
    ) {
      return;
    }
    session.isDragging = true;
    event.preventDefault();
    const target =
      document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-honk-desktop-tab-key]") ?? null;
    const targetKey = target?.dataset.honkDesktopTabKey ?? null;
    const targetIndex =
      targetKey === null ? -1 : snapshot.tabs.findIndex((candidate) => candidate.key === targetKey);
    const targetTab = targetIndex < 0 ? undefined : snapshot.tabs[targetIndex];
    if (
      target === null ||
      targetIndex <= 0 ||
      targetKey === session.sourceKey ||
      targetTab === undefined ||
      targetTab.kind === "home" ||
      workspaceKey(targetTab) !== session.workspaceKey
    ) {
      session.targetIndex = null;
      session.targetKey = null;
      setDrag({ sourceKey: session.sourceKey, targetKey: null, dropAfter: false });
      return;
    }
    const bounds = target.getBoundingClientRect();
    session.targetIndex = targetIndex;
    session.targetKey = targetKey;
    session.dropAfter = event.clientY > bounds.top + bounds.height / 2;
    setDrag({
      sourceKey: session.sourceKey,
      targetKey,
      dropAfter: session.dropAfter,
    });
  };

  const activateTab = (tab: TabDescriptor): void => {
    if (suppressActivationKey.current === tab.key) {
      suppressActivationKey.current = null;
      return;
    }
    props.tabs.activate(tab.key);
  };

  const toggleGroup = (key: string): void => {
    props.collapsedGroups.set((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return Object.freeze([...next]);
    });
  };

  const toggleFilter = (value: StatusFilter): void => {
    props.threadFilters.set((current) => {
      if (current.includes(value)) {
        return Object.freeze(current.filter((filter) => filter !== value));
      }
      return Object.freeze([...current, value]);
    });
  };

  const openWorkspace = (): void => {
    void pickFolder(appSettings.defaultProjectDirectory).then((path) => {
      if (path === null) {
        return;
      }
      tabActions.openDraft({ directory: path });
    });
  };

  return (
    <SessionTabPreviewProvider>
      <aside aria-label="Open tabs" {...stylex.props(styles.root)}>
        <div data-shell-drag-region="" {...stylex.props(styles.topBar)}>
          <TitleBarTrailing>{import.meta.env.DEV ? <DevChannelChip /> : null}</TitleBarTrailing>
        </div>
        <nav aria-label="Open tabs" data-honk-scrollport {...stylex.props(styles.navigation)}>
          {homeTab === undefined ? null : (
            <div {...stylex.props(styles.home)}>
              <OpenTabContextMenu tab={homeTab}>
                <ListRow
                  size="sm"
                  aria-current={snapshot.activeKey === homeTab.key ? "page" : undefined}
                  isSelected={snapshot.activeKey === homeTab.key}
                  onClick={() => {
                    activateTab(homeTab);
                  }}
                >
                  <ListRow.Slot>
                    <TabGlyph tab={homeTab} />
                  </ListRow.Slot>
                  <ListRow.Title
                    style={snapshot.activeKey === homeTab.key ? TITLE_PRIMARY : TITLE_MUTED}
                  >
                    {homeTab.title}
                  </ListRow.Title>
                </ListRow>
              </OpenTabContextMenu>
            </div>
          )}

          <section aria-label="Workspace tabs" {...stylex.props(styles.workspaceCollection)}>
            <div {...stylex.props(styles.collectionHeader)}>
              <ListRow
                size="sm"
                aria-expanded={isWorkspaceCollectionOpen}
                aria-controls={isWorkspaceCollectionOpen ? workspaceCollectionID : undefined}
                onClick={() => {
                  props.workspacesOpen.set((current) => !current);
                }}
              >
                <ListRow.Title style={TITLE_FAINT}>Workspaces</ListRow.Title>
                <ListRow.Meta>
                  <span
                    {...stylex.props(
                      styles.chevron,
                      isWorkspaceCollectionOpen && styles.chevronOpen,
                    )}
                  >
                    <Icon icon={IconChevronRightMedium} size="xs" tone="faint" />
                  </span>
                  {Array.from({ length: collectionActionCount }, (_, index) => (
                    <span key={index} aria-hidden {...stylex.props(styles.actionSpacer)} />
                  ))}
                </ListRow.Meta>
              </ListRow>
              <div
                {...stylex.props(
                  styles.collectionActions,
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
                        checked={threadFilters.includes(option.value)}
                        onCheckedChange={() => {
                          toggleFilter(option.value);
                        }}
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
                    onClick={openWorkspace}
                  >
                    <Icon icon={IconFolderAddRight} size="sm" />
                  </ListRow.Action>
                ) : null}
              </div>
            </div>

            {isWorkspaceCollectionOpen ? (
              <div id={workspaceCollectionID} {...stylex.props(styles.workspaceList)}>
                {groups.length === 0 ? (
                  <div {...stylex.props(styles.empty)}>
                    {filtersActive ? "No matching workspace tabs" : "No open workspace tabs"}
                  </div>
                ) : (
                  groups.map((group, groupIndex) => {
                    const isOpen = !collapsedGroups.has(group.key);
                    const hasActiveTab = group.tabs.some(
                      ({ tab }) => tab.key === snapshot.activeKey,
                    );
                    const panelID = `${workspaceCollectionID}-${groupIndex}`;
                    const seedTab = group.tabs[0]?.tab;
                    const accessibleLabel = [
                      group.label,
                      group.serverLabel,
                      `${group.tabs.length} open ${group.tabs.length === 1 ? "tab" : "tabs"}`,
                    ]
                      .filter((value): value is string => value !== undefined)
                      .join(", ");
                    if (seedTab === undefined) {
                      return null;
                    }
                    const workspaceHeader = (
                      <div {...stylex.props(styles.workspaceRow)}>
                        <ListRow
                          size="sm"
                          aria-label={accessibleLabel}
                          aria-expanded={isOpen}
                          aria-controls={isOpen ? panelID : undefined}
                          title={group.path ?? group.label}
                          onClick={() => {
                            toggleGroup(group.key);
                          }}
                        >
                          <ListRow.Slot>
                            <span {...stylex.props(styles.workspaceGlyph)}>
                              <span
                                {...stylex.props(
                                  styles.workspaceFolder,
                                  !isOpen && styles.workspaceFolderClosed,
                                )}
                              >
                                <Icon
                                  icon={isOpen ? IconFolderOpen : IconFolder1}
                                  size="sm"
                                  tone="faint"
                                />
                              </span>
                              <span
                                {...stylex.props(
                                  styles.workspaceChevron,
                                  isOpen && styles.workspaceChevronOpen,
                                )}
                              >
                                <Icon icon={IconChevronRightMedium} size="sm" tone="faint" />
                              </span>
                            </span>
                          </ListRow.Slot>
                          <ListRow.Content>
                            <ListRow.Title style={hasActiveTab ? TITLE_PRIMARY : TITLE_MUTED}>
                              {group.label}
                            </ListRow.Title>
                          </ListRow.Content>
                          <ListRow.Meta>
                            <span aria-hidden {...stylex.props(styles.actionSpacer)} />
                          </ListRow.Meta>
                        </ListRow>
                        <span {...stylex.props(styles.workspaceAction)}>
                          <ListRow.Action
                            aria-label={`New thread in ${group.label}`}
                            title={`New thread in ${group.label}`}
                            onClick={() => {
                              props.tabs.create(seedTab.key);
                            }}
                          >
                            <Icon icon={IconPlusSmall} size="xs" />
                          </ListRow.Action>
                        </span>
                      </div>
                    );
                    return (
                      <section
                        key={group.key}
                        aria-label={`${group.label} tabs`}
                        {...stylex.props(styles.group)}
                      >
                        <WorkspaceContextMenu
                          tabKey={seedTab.key}
                          {...(group.path === undefined ? {} : { path: group.path })}
                        >
                          {workspaceHeader}
                        </WorkspaceContextMenu>

                        {isOpen ? (
                          <div
                            id={panelID}
                            role="group"
                            aria-label={`${group.label} open tabs`}
                            {...stylex.props(styles.groupTabs)}
                          >
                            {group.tabs.map(({ tab, index }) => {
                              const isActive = snapshot.activeKey === tab.key;
                              const isDragging = drag?.sourceKey === tab.key;
                              const isDropTarget = drag?.targetKey === tab.key;
                              const tabAccessibleLabel =
                                tab.server === undefined
                                  ? tab.title
                                  : `${tab.title}, ${tab.server.label}`;
                              const row = (
                                <div
                                  data-honk-desktop-tab-key={tab.key}
                                  {...stylex.props(
                                    styles.row,
                                    isActive && styles.rowActive,
                                    isDragging && styles.dragging,
                                    isDropTarget && styles.dropIndicator,
                                    isDropTarget &&
                                      (drag?.dropAfter === true
                                        ? styles.dropAfter
                                        : styles.dropBefore),
                                  )}
                                >
                                  <ListRow
                                    size="sm"
                                    aria-label={tabAccessibleLabel}
                                    aria-current={isActive ? "page" : undefined}
                                    title={tab.title}
                                    isSelected={isActive}
                                    onClick={() => {
                                      activateTab(tab);
                                    }}
                                    onPointerDown={(event) => {
                                      startDrag(event, tab, index, group.key);
                                    }}
                                    onPointerMove={moveDrag}
                                    onPointerUp={(event) => {
                                      stopDrag(event, false);
                                    }}
                                    onPointerCancel={(event) => {
                                      stopDrag(event, true);
                                    }}
                                  >
                                    <ListRow.Slot>
                                      <TabGlyph tab={tab} />
                                    </ListRow.Slot>
                                    <ListRow.Content>
                                      <ListRow.Title style={isActive ? TITLE_PRIMARY : TITLE_MUTED}>
                                        {tab.title}
                                      </ListRow.Title>
                                    </ListRow.Content>
                                    <ListRow.Meta>
                                      <span aria-hidden {...stylex.props(styles.closeSpacer)} />
                                    </ListRow.Meta>
                                  </ListRow>
                                  <span {...stylex.props(styles.close)}>
                                    <ListRow.Action
                                      aria-label={`Close ${tab.title}`}
                                      onClick={() => {
                                        props.tabs.close(tab.key);
                                      }}
                                    >
                                      <Icon icon={IconCrossSmall} size="xs" />
                                    </ListRow.Action>
                                  </span>
                                </div>
                              );
                              const withContextMenu = (
                                <OpenTabContextMenu key={tab.key} tab={tab}>
                                  {row}
                                </OpenTabContextMenu>
                              );
                              if (tab.kind !== "thread") {
                                return withContextMenu;
                              }
                              return (
                                <SessionTabPreviewTooltip
                                  key={tab.key}
                                  tab={tab}
                                  disabled={isDragging}
                                >
                                  {withContextMenu}
                                </SessionTabPreviewTooltip>
                              );
                            })}
                          </div>
                        ) : null}
                      </section>
                    );
                  })
                )}
              </div>
            ) : null}
          </section>
        </nav>

        <div {...stylex.props(styles.footer)}>
          <ListRow
            size="sm"
            onClick={() => {
              props.tabs.create();
            }}
          >
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

function TabGlyph({ tab }: { readonly tab: TabDescriptor }): React.ReactElement {
  if (tab.kind === "home" && tab.status === "idle") {
    return <Icon icon={IconHomeRoofDoor} size="sm" tone="muted" />;
  }
  if (tab.kind === "utility") {
    return (
      <Icon icon={tab.utility === "browser" ? IconGlobe : IconChanges} size="sm" tone="muted" />
    );
  }
  if (tab.status === "needs-you") {
    return <Matrix grid={5} variant="attention" isActive style={forward.matrixFit} />;
  }
  if (tab.status === "working" || (tab.kind === "thread" && tab.repository.state === "loading")) {
    return <Matrix grid={5} isActive style={forward.matrixFit} />;
  }
  return <StatusDot tone={statusTone(tab.status)} label={statusLabel(tab.status)} />;
}

function statusTone(status: TabDescriptor["status"]): "ok" | "warn" | "err" | "neutral" | "draft" {
  switch (status) {
    case "done":
      return "ok";
    case "needs-you":
      return "warn";
    case "failed":
      return "err";
    case "draft":
      return "draft";
    case "idle":
    case "working":
      return "neutral";
  }
}

function statusLabel(status: TabDescriptor["status"]): string {
  switch (status) {
    case "needs-you":
      return "Needs you";
    case "working":
      return "Working";
    case "done":
      return "Done";
    case "failed":
      return "Failed";
    case "draft":
      return "Draft";
    case "idle":
      return "Idle";
  }
}

function reorderTargetIndex(fromIndex: number, targetIndex: number, after: boolean): number {
  const insertionIndex = targetIndex + (after ? 1 : 0);
  return fromIndex < insertionIndex ? insertionIndex - 1 : insertionIndex;
}

export const verticalSidebarExtension = defineHonkDesktopExtension({
  id: "honk.vertical-sidebar",
  name: "Honk vertical sidebar",
  version: "1.0.0",
  activate(honk) {
    const enabled = honk.state.boolean("enabled", false);
    const size = honk.state.number("size", SIDEBAR_DEFAULT_SIZE, {
      min: SIDEBAR_MIN_SIZE,
      max: SIDEBAR_MAX_SIZE,
    });
    const collapsedGroups = honk.state.value<readonly string[]>("collapsed-groups", {
      default: Object.freeze([]),
      decode: decodeStringList,
    });
    const workspacesOpen = honk.state.boolean("workspaces-open", true);
    const threadFilters = honk.state.value<readonly StatusFilter[]>("thread-filters", {
      default: Object.freeze([]),
      decode: decodeStatusFilters,
    });

    honk.desktop.titlebar.tabStrip({ id: "default-tabs", hidden: enabled });
    honk.desktop.panes.add({
      id: "tabs",
      side: "left",
      open: enabled,
      size,
      minSize: SIDEBAR_MIN_SIZE,
      maxSize: SIDEBAR_MAX_SIZE,
      render: () => (
        <VerticalSidebar
          tabs={honk.desktop.tabs}
          collapsedGroups={collapsedGroups}
          workspacesOpen={workspacesOpen}
          threadFilters={threadFilters}
        />
      ),
    });
    honk.desktop.settings.toggle({
      id: "enabled",
      title: "Tab style",
      description: "Choose where open tabs are shown.",
      value: enabled,
      presentation: {
        kind: "tab-style",
        offLabel: "San Francisco",
        onLabel: "New York",
      },
    });
  },
});

function decodeStringList(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return undefined;
  }
  return Object.freeze([...new Set(value)]);
}

function decodeStatusFilters(value: unknown): readonly StatusFilter[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const allowed = new Set<string>(STATUS_FILTER_OPTIONS.map((option) => option.value));
  const next = value.filter(
    (item): item is StatusFilter => typeof item === "string" && allowed.has(item),
  );
  return Object.freeze([...new Set(next)]);
}
