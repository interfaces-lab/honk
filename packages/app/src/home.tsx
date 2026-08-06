import * as stylex from "@stylexjs/stylex";
import {
  openCodeLocationRef,
  openCodeSessionKey,
  openCodeSessionRef,
  type OpenCodeServerKey,
} from "@honk/opencode";
import { basename } from "@honk/shared/paths";
import { Icon, ListRow, Matrix, Pill, StatusDot, Text } from "@honk/ui";
import {
  colorVars,
  controlVars,
  fontVars,
  iconVars,
  motionVars,
  radiusVars,
  sidebarVars,
  spaceVars,
} from "@honk/ui/tokens.stylex";
import { IconFolderAddRight, IconSettingsGear2 } from "@honk/ui/icons";
import * as React from "react";

import { setHomeProjectOrder, useAppSettings } from "./app-settings-store";
import { HomeComposer } from "./composer/home-composer";
import { pickFolder } from "./desktop-bridge";
import { buildHomeProjectDrop, mergeHomeProjectOrder } from "./home-project-order";
import { OPEN_CODE_HOME_TAB_KEY } from "./opencode/tab-presentation";
import {
  statusDotPulse,
  statusDotTone,
  tabStatusFromSummary,
  type CommandMenuThread,
} from "./command-menu-model";
import { actions as settingsActions } from "./settings-store";
import { actions as tabActions, type TabStatus } from "./tab-store";
import { useSessionInventoryWatch } from "./use-sdk-watch";

const NAV_COLUMN = "280px";
const HOME_CONTENT_MAX_WIDTH = "720px";
const CONTENT_COLUMN = `minmax(0, ${HOME_CONTENT_MAX_WIDTH})`;
const HOME_GRID_MAX_WIDTH = "1080px";
const LG_MEDIA = "@media (min-width: 1024px)";
const HOME_GAP = "16px";
const HOME_GAP_LARGE = "32px";
const HOME_PAD_LARGE = "24px";
// Fixed lane so multiline composer growth moves up without resizing the browser columns.
const COMPOSER_LANE_HEIGHT = "256px";
const NAV_MOBILE_MAX_HEIGHT = "240px";
const HAIRLINE = "1px";
const SCROLL_PAD_BOTTOM_PX = 64;
const SCROLL_PAD_BOTTOM = `${String(SCROLL_PAD_BOTTOM_PX)}px`;
const NEGATIVE_PANEL_PAD = "-12px";
const PROJECT_ALL_KEY = "all";
const PROJECT_ORDER_CAP = 50;
const PROJECT_DRAG_ACTIVATION_DISTANCE = 4;
const PROJECT_DRAG_AUTOSCROLL_EDGE = 0.05;
const PROJECT_DRAG_AUTOSCROLL_STEP = 8;
// Intrinsic drop-target geometry shared with the desktop workspace sidebar.
const PROJECT_DROP_INDICATOR_SIZE = "2px";
const PROJECT_DROP_INDICATOR_OFFSET = "-1px";
// OpenCode Home deliberately keeps the default inventory bounded while search owns deep history.
const HOME_SESSION_LIMIT = 64;
// Project avatar footprint; leading slots on the Add/Settings rows match it so titles line up.
const AVATAR_SIZE = "20px";
const LEADING_SLOT_STYLE = {
  width: iconVars["--honk-icon-size-xl"],
  height: iconVars["--honk-icon-size-xl"],
} satisfies React.CSSProperties;
// Thread status badge: corner nudge past the avatar edge, and the base-surface ring around the dot.
const AVATAR_BADGE_OFFSET = "-3px";
const AVATAR_BADGE_RING = "1.5px";
const EDGE_BLUR_EXTENT = "48px";
const EDGE_BLUR_FILTER = "blur(8px)";
// Fixed scroll distance for the edge affordance to reach full strength.
const EDGE_FADE_DISTANCE_PX = 24;
const GROUP_HEAD_HEIGHT = `calc(${fontVars["--honk-leading-detail"]} + (2 * ${controlVars["--honk-control-gap"]}))`;
const SCROLL_EDGE_EPSILON = 1;
// Narrower than the composer footer's branch label: this pill shares ListRow.Meta with the
// relative timestamp, so the branch gives up width the footer does not have to.
const THREAD_META_BRANCH_MAX_WIDTH = "160px";
// The placeholder widths vary like real labels while the shared ListRow owns exact row geometry.
const SKELETON_TITLE_WIDE = "64%";
const SKELETON_TITLE_MEDIUM = "48%";
const SKELETON_TITLE_NARROW = "36%";
const SKELETON_META_WIDTH = "44px";

const skeletonPulse = stylex.keyframes({
  from: { opacity: 0.45 },
  to: { opacity: 0.8 },
});

const styles = stylex.create({
  branchLabel: { maxWidth: THREAD_META_BRANCH_MAX_WIDTH },
  grid: {
    boxSizing: "border-box",
    height: "100%",
    width: "100%",
    maxWidth: HOME_GRID_MAX_WIDTH,
    marginInline: "auto",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    paddingInline: {
      default: spaceVars["--honk-space-panel-pad"],
      [LG_MEDIA]: HOME_PAD_LARGE,
    },
  },
  composerLane: {
    boxSizing: "border-box",
    width: "100%",
    maxWidth: HOME_CONTENT_MAX_WIDTH,
    height: COMPOSER_LANE_HEIGHT,
    marginInline: "auto",
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-end",
    // A fully grown composer keeps clearance from the titlebar instead of pressing against it.
    // oxlint-disable-next-line honk/design-no-raw-values -- 16px composer-lane top inset; no spaceVars token owns 16px
    paddingTop: HOME_GAP,
    // oxlint-disable-next-line honk/design-no-raw-values -- 16px composer-lane bottom inset; no spaceVars token owns 16px
    paddingBottom: HOME_GAP,
  },
  columns: {
    height: `calc(100% - ${COMPOSER_LANE_HEIGHT})`,
    flexShrink: 0,
    minHeight: 0,
    display: "grid",
    gridTemplateColumns: {
      default: "1fr",
      [LG_MEDIA]: `${NAV_COLUMN} ${CONTENT_COLUMN}`,
    },
    gridTemplateRows: {
      default: "auto minmax(0, 1fr)",
      [LG_MEDIA]: "1fr",
    },
    gap: {
      // oxlint-disable-next-line honk/design-no-raw-values -- 16px mobile column gap; no spaceVars token owns 16px
      default: HOME_GAP,
      [LG_MEDIA]: HOME_GAP_LARGE,
    },
  },

  nav: {
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    // oxlint-disable-next-line honk/design-no-raw-values -- 16px nav stack gap; no spaceVars token owns 16px
    gap: HOME_GAP,
    overflow: "hidden",
    maxHeight: {
      default: NAV_MOBILE_MAX_HEIGHT,
      [LG_MEDIA]: "none",
    },
  },
  navHead: {
    flexShrink: 0,
    height: controlVars["--honk-control-h-md"],
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    paddingInline: controlVars["--honk-control-pad-md"],
    color: colorVars["--honk-color-text-muted"],
    fontWeight: fontVars["--honk-font-weight-regular"],
  },
  avatar: {
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    boxSizing: "border-box",
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: radiusVars["--honk-radius-avatar"],
    fontSize: fontVars["--honk-font-size-caption"],
    fontWeight: fontVars["--honk-font-weight-semibold"],
    lineHeight: 1,
    textTransform: "uppercase",
    userSelect: "none",
  },
  avatarPink: {
    backgroundColor: colorVars["--honk-color-avatar-pink-bg"],
    color: colorVars["--honk-color-avatar-pink-fg"],
  },
  avatarMint: {
    backgroundColor: colorVars["--honk-color-avatar-mint-bg"],
    color: colorVars["--honk-color-avatar-mint-fg"],
  },
  avatarOrange: {
    backgroundColor: colorVars["--honk-color-avatar-orange-bg"],
    color: colorVars["--honk-color-avatar-orange-fg"],
  },
  avatarPurple: {
    backgroundColor: colorVars["--honk-color-avatar-purple-bg"],
    color: colorVars["--honk-color-avatar-purple-fg"],
  },
  avatarCyan: {
    backgroundColor: colorVars["--honk-color-avatar-cyan-bg"],
    color: colorVars["--honk-color-avatar-cyan-fg"],
  },
  avatarLime: {
    backgroundColor: colorVars["--honk-color-avatar-lime-bg"],
    color: colorVars["--honk-color-avatar-lime-fg"],
  },
  // Positioning context for a thread's status badge overlaid on its project avatar.
  avatarWrap: {
    position: "relative",
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
  },
  // Corner badge; the base-surface ring lifts the status dot off the avatar tint.
  avatarBadge: {
    position: "absolute",
    right: AVATAR_BADGE_OFFSET,
    bottom: AVATAR_BADGE_OFFSET,
    display: "grid",
    placeItems: "center",
    // oxlint-disable-next-line honk/design-no-raw-values -- 1.5px base-surface ring around the status dot is fixed geometry, no spacing token owns it
    padding: AVATAR_BADGE_RING,
    borderRadius: radiusVars["--honk-radius-pill"],
    backgroundColor: colorVars["--honk-color-bg-base"],
  },
  navRows: {
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    // oxlint-disable-next-line honk/design-no-raw-values -- 1px row separation; the border-hairline token owns border width, not gap spacing
    gap: HAIRLINE,
    overflowY: "auto",
    scrollbarWidth: "none",
    paddingRight: spaceVars["--honk-space-panel-pad"],
  },
  projectRow: {
    position: "relative",
    minWidth: 0,
  },
  projectDragging: {
    opacity: 0.45,
  },
  projectDropIndicator: {
    "::before": {
      position: "absolute",
      insetInline: 0,
      zIndex: 1,
      height: PROJECT_DROP_INDICATOR_SIZE,
      borderRadius: radiusVars["--honk-radius-pill"],
      backgroundColor: colorVars["--honk-color-accent"],
      content: "",
      pointerEvents: "none",
    },
  },
  projectDropBefore: {
    "::before": {
      top: PROJECT_DROP_INDICATOR_OFFSET,
    },
  },
  projectDropAfter: {
    "::before": {
      bottom: PROJECT_DROP_INDICATOR_OFFSET,
    },
  },
  navSpacer: {
    flexGrow: 1,
    minHeight: 0,
  },
  navFooter: {
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    gap: sidebarVars["--honk-sidebar-item-gap"],
    // oxlint-disable-next-line honk/design-no-raw-values -- 16px footer top offset; no spaceVars token owns 16px
    marginTop: HOME_GAP,
    // oxlint-disable-next-line honk/design-no-raw-values -- 32px footer bottom rhythm; no spaceVars token owns 32px
    marginBottom: HOME_GAP_LARGE,
    paddingRight: spaceVars["--honk-space-panel-pad"],
  },

  content: {
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    position: "relative",
  },
  scroll: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    minHeight: 0,
    // Scrollbar rides the gutter; rows keep their inset.
    // oxlint-disable-next-line honk/design-no-raw-values -- negative gutter pull for the scrollbar; no spacing token owns -12px
    marginRight: NEGATIVE_PANEL_PAD,
    display: "flex",
    flexDirection: "column",
    overflowY: "auto",
    overflowAnchor: "none",
  },
  scrollEdgeWrap: {
    position: "relative",
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
  },
  scrollEdgeWrapGrow: {
    flexGrow: 1,
  },
  edgeBlur: {
    position: "absolute",
    insetInline: 0,
    height: EDGE_BLUR_EXTENT,
    zIndex: 1,
    pointerEvents: "none",
    backdropFilter: EDGE_BLUR_FILTER,
  },
  edgeBlurTop: {
    top: 0,
    maskImage: "linear-gradient(to bottom, black, transparent)",
  },
  edgeBlurTopUnderHeader: {
    top: GROUP_HEAD_HEIGHT,
  },
  edgeBlurBottom: {
    bottom: 0,
    maskImage: "linear-gradient(to top, black, transparent)",
  },
  scrollContent: {
    display: "flex",
    flexDirection: "column",
    paddingRight: spaceVars["--honk-space-panel-pad"],
    paddingBottom: SCROLL_PAD_BOTTOM,
  },
  groupHead: {
    position: "sticky",
    top: 0,
    // Above rows' positioned avatarWrap (which would otherwise paint over the stuck header)
    // and above the z-1 edge-blur overlays so the stuck label stays crisp.
    zIndex: 2,
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    paddingBlock: controlVars["--honk-control-gap"],
    paddingInline: spaceVars["--honk-space-control-pad-x"],
    backgroundColor: colorVars["--honk-color-bg-base"],
    color: colorVars["--honk-color-text-faint"],
    fontSize: fontVars["--honk-font-size-detail"],
    fontWeight: fontVars["--honk-font-weight-semibold"],
    lineHeight: fontVars["--honk-leading-detail"],
  },
  groupTitle: {
    color: colorVars["--honk-color-text-muted"],
  },
  count: {
    color: colorVars["--honk-color-text-faint"],
    fontVariantNumeric: "tabular-nums",
  },
  skeletonBlock: {
    display: "block",
    height: fontVars["--honk-leading-title"],
    borderRadius: radiusVars["--honk-radius-pill"],
    backgroundColor: colorVars["--honk-color-layer-03"],
  },
  // One parent animation keeps every placeholder in phase and avoids one animation per block.
  skeletonSet: {
    opacity: 0.65,
    animationName: {
      default: skeletonPulse,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    animationDuration: {
      default: motionVars["--honk-motion-duration-shimmer"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    animationDirection: "alternate",
    animationIterationCount: "infinite",
    animationTimingFunction: motionVars["--honk-motion-ease-out"],
  },
  skeletonProjectRows: {
    display: "flex",
    flexDirection: "column",
    // oxlint-disable-next-line honk/design-no-raw-values -- matches the existing 1px project-row separation exactly
    gap: HAIRLINE,
  },
  skeletonAvatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    flexShrink: 0,
    borderRadius: radiusVars["--honk-radius-avatar"],
  },
  skeletonTitleWide: {
    width: SKELETON_TITLE_WIDE,
  },
  skeletonTitleMedium: {
    width: SKELETON_TITLE_MEDIUM,
  },
  skeletonTitleNarrow: {
    width: SKELETON_TITLE_NARROW,
  },
  skeletonMeta: {
    width: SKELETON_META_WIDTH,
    height: fontVars["--honk-leading-detail"],
  },
  skeletonGroupLabel: {
    width: SKELETON_TITLE_NARROW,
    height: fontVars["--honk-leading-detail"],
  },
  center: {
    flexGrow: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: spaceVars["--honk-space-gutter"],
    padding: spaceVars["--honk-space-panel-pad"],
  },
  notice: {
    paddingInline: spaceVars["--honk-space-gutter"],
    paddingBlock: spaceVars["--honk-space-gutter"],
  },
});

const dynamicStyles = stylex.create({
  edgeBlurOpacity: (opacity: number) => ({ opacity }),
});

function HomePage(): React.ReactElement {
  const watch = useSessionInventoryWatch();
  const appSettings = useAppSettings();
  const threadScroll = useScrollEdges(SCROLL_PAD_BOTTOM_PX);
  const threads = activeThreads(watch.state?.rootSessions ?? EMPTY_THREADS);
  const [projectKey, setProjectKey] = React.useState(PROJECT_ALL_KEY);
  // Explicit folder pick beats the nav selection until a project row is clicked again.
  const [pickedDirectory, setPickedDirectory] = React.useState<string | null>(null);
  const projectFilters = mergeHomeProjectOrder(buildProjectFilters(threads), [
    PROJECT_ALL_KEY,
    ...appSettings.homeProjectOrder,
  ]);
  const selectedProjectKey = projectFilters.some((project) => project.key === projectKey)
    ? projectKey
    : PROJECT_ALL_KEY;
  const visibleThreads = filterThreadsByProject(threads, selectedProjectKey);
  const groupedThreads = groupHomeThreads(visibleThreads);
  const isConnecting = watch.status === "connecting" && watch.state === null;
  const isDisconnected = watch.status === "closed" || watch.status === "unauthorized";

  // New-session project: picked folder, then the selected project root, then the saved default.
  const selectedProject = projectFilters.find((project) => project.key === selectedProjectKey);
  const projectDirectory =
    selectedProjectKey === PROJECT_ALL_KEY ? null : (selectedProject?.directory ?? null);
  const targetDirectory =
    pickedDirectory ?? projectDirectory ?? appSettings.defaultProjectDirectory ?? undefined;
  const targetLabel =
    pickedDirectory !== null
      ? undefined // chip prints the folder's basename
      : selectedProjectKey !== PROJECT_ALL_KEY
        ? selectedProject?.label
        : undefined;

  const selectProject = (key: string): void => {
    setProjectKey(key);
    setPickedDirectory(null);
  };

  const addProject = (): void => {
    void pickFolder(appSettings.defaultProjectDirectory).then((path) => {
      if (path !== null) {
        setPickedDirectory(path);
        setProjectKey(PROJECT_ALL_KEY);
      }
    });
  };

  return (
    <div {...stylex.props(styles.grid)}>
      <div {...stylex.props(styles.composerLane)}>
        <HomeComposer
          focusOnTypeScope="window"
          draftPersistenceKey={OPEN_CODE_HOME_TAB_KEY}
          {...(targetDirectory !== undefined
            ? { location: openCodeLocationRef({ directory: targetDirectory }) }
            : {})}
          {...(targetLabel !== undefined ? { directoryLabel: targetLabel } : {})}
          {...(selectedProject?.projectID === null || selectedProject?.projectID === undefined
            ? {}
            : { projectID: selectedProject.projectID })}
          {...(selectedProject?.directory === null || selectedProject?.directory === undefined
            ? {}
            : { projectDirectory: selectedProject.directory })}
          {...(selectedProject?.server === null || selectedProject?.server === undefined
            ? {}
            : { server: selectedProject.server })}
          recentDirectories={watch.state?.recentDirectories ?? EMPTY_DIRECTORIES}
          onDirectoryPicked={(path) => {
            setPickedDirectory(path);
            setProjectKey(PROJECT_ALL_KEY);
          }}
        />
      </div>

      <div {...stylex.props(styles.columns)}>
        <ProjectNav
          projects={projectFilters}
          projectOrder={appSettings.homeProjectOrder}
          isLoading={isConnecting}
          selectedKey={selectedProjectKey}
          onSelect={selectProject}
          onAddProject={addProject}
          onProjectOrderChange={setHomeProjectOrder}
        />

        <section {...stylex.props(styles.content)} aria-label="Threads">
          {isConnecting ? (
            <HomeThreadLoadingRows />
          ) : isDisconnected ? (
            <div {...stylex.props(styles.notice)}>
              <Text as="p" size="sm" tone="faint">
                {watch.status === "unauthorized"
                  ? "Workspace watch unauthorized."
                  : "Workspace watch closed."}
              </Text>
            </div>
          ) : null}

          {isConnecting ? null : threads.length === 0 ? (
            <div {...stylex.props(styles.center)}>
              <Text as="p" size="sm" tone="muted" weight="regular">
                No threads yet
              </Text>
              <Text as="p" size="xs" tone="faint">
                Type above and press Enter to start a new chat.
              </Text>
            </div>
          ) : visibleThreads.length === 0 ? (
            <div {...stylex.props(styles.center)}>
              <Text as="p" size="sm" tone="muted" weight="regular">
                No threads in this project
              </Text>
              <Text as="p" size="xs" tone="faint">
                Pick another project or start a new chat above.
              </Text>
            </div>
          ) : (
            <div {...stylex.props(styles.scrollEdgeWrap, styles.scrollEdgeWrapGrow)}>
              <div
                ref={threadScroll.ref}
                onScroll={threadScroll.onScroll}
                {...stylex.props(styles.scroll)}
              >
                <div {...stylex.props(styles.scrollContent)}>
                  <ThreadGroup label="Needs you" threads={groupedThreads.needsYou} />
                  <ThreadGroup label="Working" threads={groupedThreads.working} />
                  <ThreadGroup label="Recent" threads={groupedThreads.recent} />
                </div>
              </div>
              <ScrollEdgeBlur edges={threadScroll.edges} hasStickyHeader />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ScrollEdgeBlur({
  edges,
  hasStickyHeader = false,
}: {
  readonly edges: ScrollEdges;
  readonly hasStickyHeader?: boolean;
}): React.ReactElement | null {
  const topPosition = hasStickyHeader && styles.edgeBlurTopUnderHeader;
  if (edges.startOpacity === 0 && edges.endOpacity === 0) return null;

  return (
    <>
      {edges.startOpacity > 0 ? (
        <div
          {...stylex.props(
            styles.edgeBlur,
            styles.edgeBlurTop,
            topPosition,
            dynamicStyles.edgeBlurOpacity(edges.startOpacity),
          )}
          aria-hidden
        />
      ) : null}
      {edges.endOpacity > 0 ? (
        <div
          {...stylex.props(
            styles.edgeBlur,
            styles.edgeBlurBottom,
            dynamicStyles.edgeBlurOpacity(edges.endOpacity),
          )}
          aria-hidden
        />
      ) : null}
    </>
  );
}

type ScrollEdges = {
  readonly startOpacity: number;
  readonly endOpacity: number;
};

const INITIAL_SCROLL_EDGES: ScrollEdges = Object.freeze({
  startOpacity: 0,
  endOpacity: 0,
});

function useScrollEdges(endClearancePx = 0) {
  const [edges, setEdges] = React.useState(INITIAL_SCROLL_EDGES);
  const publish = (element: HTMLElement): void => {
    const maxScroll = Math.max(0, element.scrollHeight - element.clientHeight - endClearancePx);
    const hasScrollableRange = maxScroll > SCROLL_EDGE_EPSILON;
    const next = hasScrollableRange
      ? {
          startOpacity: Math.min(1, Math.max(0, element.scrollTop) / EDGE_FADE_DISTANCE_PX),
          endOpacity: Math.min(
            1,
            Math.max(0, maxScroll - element.scrollTop) / EDGE_FADE_DISTANCE_PX,
          ),
        }
      : INITIAL_SCROLL_EDGES;
    setEdges((current) =>
      current.startOpacity === next.startOpacity && current.endOpacity === next.endOpacity
        ? current
        : next,
    );
  };
  const ref = (element: HTMLDivElement | null): (() => void) | undefined => {
    if (element === null) return;
    let frame = 0;
    const schedule = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        publish(element);
      });
    };
    const resizeObserver = new ResizeObserver(schedule);
    const observeSizes = (): void => {
      resizeObserver.disconnect();
      resizeObserver.observe(element);
      Array.from(element.children).forEach((child) => {
        resizeObserver.observe(child);
      });
    };
    const mutationObserver = new MutationObserver(() => {
      observeSizes();
      schedule();
    });
    observeSizes();
    mutationObserver.observe(element, { childList: true, subtree: true });
    publish(element);
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  };
  const onScroll = (event: React.UIEvent<HTMLDivElement>): void => {
    publish(event.currentTarget);
  };

  return { edges, ref, onScroll };
}

const AVATAR_COLOR_STYLES = [
  styles.avatarPink,
  styles.avatarMint,
  styles.avatarOrange,
  styles.avatarPurple,
  styles.avatarCyan,
  styles.avatarLime,
] as const;

// Deterministic per-project tint: FNV-ish hash of the stable project key into the fixed palette.
function avatarColorIndex(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return hash % AVATAR_COLOR_STYLES.length;
}

function ProjectAvatar({
  label,
  colorKey,
}: {
  readonly label: string;
  readonly colorKey: string;
}): React.ReactElement {
  const initial = (label.trim()[0] ?? "?").toUpperCase();
  return (
    <span
      {...stylex.props(styles.avatar, AVATAR_COLOR_STYLES[avatarColorIndex(colorKey)])}
      aria-hidden
    >
      {initial}
    </span>
  );
}

// Live states earn a corner badge; idle/done/draft rows stay a clean avatar since the
// group header ("Working" / "Needs you") already carries the status.
function threadBadge(status: TabStatus): { tone: "info" | "warn" | "err"; pulse: boolean } | null {
  switch (status) {
    case "working":
      return { tone: "info", pulse: true };
    case "needs-you":
      return { tone: "warn", pulse: true };
    case "failed":
      return { tone: "err", pulse: false };
    default:
      return null;
  }
}

function ThreadAvatar({
  label,
  colorKey,
  status,
}: {
  readonly label: string;
  readonly colorKey: string;
  readonly status: TabStatus;
}): React.ReactElement {
  const badge = threadBadge(status);
  return (
    <span {...stylex.props(styles.avatarWrap)} title={label}>
      <ProjectAvatar label={label} colorKey={colorKey} />
      {badge !== null && (
        <span {...stylex.props(styles.avatarBadge)}>
          <StatusDot tone={badge.tone} pulse={badge.pulse} />
        </span>
      )}
    </span>
  );
}

const PROJECT_LOADING_ROWS = Object.freeze([
  { key: "project-loading-1", titleStyle: styles.skeletonTitleMedium },
  { key: "project-loading-2", titleStyle: styles.skeletonTitleNarrow },
]);

const THREAD_LOADING_ROWS = Object.freeze([
  { key: "thread-loading-1", titleStyle: styles.skeletonTitleWide },
  { key: "thread-loading-2", titleStyle: styles.skeletonTitleMedium },
  { key: "thread-loading-3", titleStyle: styles.skeletonTitleWide },
  { key: "thread-loading-4", titleStyle: styles.skeletonTitleNarrow },
  { key: "thread-loading-5", titleStyle: styles.skeletonTitleMedium },
]);

function SkeletonBlock({ style }: { readonly style: stylex.StyleXStyles }): React.ReactElement {
  return <span {...stylex.props(styles.skeletonBlock, style)} />;
}

function HomeProjectLoadingRows(): React.ReactElement {
  return (
    <div aria-hidden {...stylex.props(styles.skeletonSet, styles.skeletonProjectRows)}>
      {/* "All" is the one inventory-independent project row; only its count is pending. */}
      <ListRow isSelected disabled tabIndex={-1}>
        <ProjectAvatar label="All" colorKey={PROJECT_ALL_KEY} />
        <ListRow.Content>
          <ListRow.Title>All</ListRow.Title>
        </ListRow.Content>
        <ListRow.Meta>
          <SkeletonBlock style={styles.skeletonMeta} />
        </ListRow.Meta>
      </ListRow>
      {PROJECT_LOADING_ROWS.map((row) => (
        <ListRow key={row.key} disabled tabIndex={-1}>
          <SkeletonBlock style={styles.skeletonAvatar} />
          <ListRow.Content>
            <SkeletonBlock style={row.titleStyle} />
          </ListRow.Content>
          <ListRow.Meta>
            <SkeletonBlock style={styles.skeletonMeta} />
          </ListRow.Meta>
        </ListRow>
      ))}
    </div>
  );
}

function HomeThreadLoadingRows(): React.ReactElement {
  return (
    <div
      role="status"
      aria-label="Loading workspace"
      {...stylex.props(styles.scrollEdgeWrap, styles.scrollEdgeWrapGrow)}
    >
      <div {...stylex.props(styles.scroll)}>
        <div aria-hidden {...stylex.props(styles.scrollContent, styles.skeletonSet)}>
          <div {...stylex.props(styles.groupHead)}>
            <SkeletonBlock style={styles.skeletonGroupLabel} />
            <SkeletonBlock style={styles.skeletonMeta} />
          </div>
          {THREAD_LOADING_ROWS.map((row) => (
            <ListRow key={row.key} disabled tabIndex={-1}>
              <SkeletonBlock style={styles.skeletonAvatar} />
              <ListRow.Content>
                <SkeletonBlock style={row.titleStyle} />
              </ListRow.Content>
              <ListRow.Meta>
                <SkeletonBlock style={styles.skeletonMeta} />
              </ListRow.Meta>
            </ListRow>
          ))}
        </div>
      </div>
    </div>
  );
}

function ProjectNav({
  projects,
  projectOrder,
  isLoading,
  selectedKey,
  onSelect,
  onAddProject,
  onProjectOrderChange,
}: {
  readonly projects: readonly ProjectFilter[];
  readonly projectOrder: readonly string[];
  readonly isLoading: boolean;
  readonly selectedKey: string;
  readonly onSelect: (key: string) => void;
  readonly onAddProject: () => void;
  readonly onProjectOrderChange: (order: readonly string[]) => void;
}): React.ReactElement {
  const projectScroll = useScrollEdges();
  const drag = useHomeProjectDrag({
    projects: projects.filter((project) => project.key !== PROJECT_ALL_KEY),
    rankedKeys: projectOrder,
    onSelect,
    onOrderChange: onProjectOrderChange,
  });

  return (
    <aside {...stylex.props(styles.nav)} aria-label="Projects" aria-busy={isLoading}>
      <div {...stylex.props(styles.navHead)}>Projects</div>
      <div {...stylex.props(styles.scrollEdgeWrap)}>
        <div
          ref={projectScroll.ref}
          data-honk-home-project-list
          onScroll={projectScroll.onScroll}
          {...stylex.props(styles.navRows)}
        >
          {isLoading ? <HomeProjectLoadingRows /> : null}
          {isLoading
            ? null
            : projects.map((project) => {
                const canReorder = project.key !== PROJECT_ALL_KEY;
                const isDragging = drag.visual?.sourceKey === project.key;
                const dropAfter =
                  drag.visual?.anchorKey === project.key ? drag.visual.dropAfter : null;
                return (
                  <div
                    key={project.key}
                    {...(canReorder ? { "data-honk-home-project-key": project.key } : {})}
                    {...stylex.props(
                      styles.projectRow,
                      isDragging && styles.projectDragging,
                      dropAfter !== null && styles.projectDropIndicator,
                      dropAfter === false && styles.projectDropBefore,
                      dropAfter === true && styles.projectDropAfter,
                    )}
                  >
                    <ListRow
                      isSelected={project.key === selectedKey}
                      aria-current={project.key === selectedKey ? "page" : undefined}
                      {...(canReorder
                        ? {
                            "aria-keyshortcuts": "Alt+ArrowUp Alt+ArrowDown",
                            "data-honk-home-project-key": project.key,
                            onKeyDown: drag.handlers.keyDown,
                            onPointerCancel: drag.handlers.pointerCancel,
                            onPointerDown: drag.handlers.pointerDown,
                            onPointerMove: drag.handlers.pointerMove,
                            onPointerUp: drag.handlers.pointerUp,
                          }
                        : {})}
                      onClick={() => {
                        onSelect(project.key);
                      }}
                    >
                      <ProjectAvatar label={project.label} colorKey={project.key} />
                      <ListRow.Content>
                        <ListRow.Title>{project.label}</ListRow.Title>
                      </ListRow.Content>
                      <ListRow.Meta>
                        {project.statuses[0] !== undefined && (
                          <HomeStatusGlyph status={project.statuses[0]} />
                        )}
                        {project.count}
                      </ListRow.Meta>
                    </ListRow>
                  </div>
                );
              })}
          <ListRow onClick={onAddProject}>
            <ListRow.Slot style={LEADING_SLOT_STYLE}>
              <Icon icon={IconFolderAddRight} size="sm" tone="muted" />
            </ListRow.Slot>
            <ListRow.Title>Add project</ListRow.Title>
          </ListRow>
        </div>
        <ScrollEdgeBlur edges={projectScroll.edges} />
      </div>
      <div {...stylex.props(styles.navSpacer)} />
      <div {...stylex.props(styles.navFooter)}>
        <ListRow
          onClick={() => {
            settingsActions.open();
          }}
        >
          <ListRow.Slot style={LEADING_SLOT_STYLE}>
            <Icon icon={IconSettingsGear2} size="sm" tone="muted" />
          </ListRow.Slot>
          <ListRow.Title>Settings</ListRow.Title>
        </ListRow>
      </div>
    </aside>
  );
}

type HomeProjectDragSession = {
  readonly pointerID: number;
  readonly sourceKey: string;
  readonly originX: number;
  readonly originY: number;
  readonly element: HTMLButtonElement;
  isDragging: boolean;
  anchorKey: string | null;
  dropAfter: boolean;
};

type HomeProjectDragVisual = {
  readonly sourceKey: string;
  readonly anchorKey: string | null;
  readonly dropAfter: boolean;
};

type HomeProjectDragHandlers = {
  readonly keyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
  readonly pointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
  readonly pointerMove: (event: React.PointerEvent<HTMLButtonElement>) => void;
  readonly pointerUp: (event: React.PointerEvent<HTMLButtonElement>) => void;
  readonly pointerCancel: (event: React.PointerEvent<HTMLButtonElement>) => void;
};

function useHomeProjectDrag(input: {
  readonly projects: readonly ProjectFilter[];
  readonly rankedKeys: readonly string[];
  readonly onSelect: (key: string) => void;
  readonly onOrderChange: (order: readonly string[]) => void;
}): { readonly visual: HomeProjectDragVisual | null; readonly handlers: HomeProjectDragHandlers } {
  const sessionRef = React.useRef<HomeProjectDragSession | null>(null);
  const [visual, setVisual] = React.useState<HomeProjectDragVisual | null>(null);

  const finish = (event: React.PointerEvent<HTMLButtonElement>, isCancelled: boolean): void => {
    const session = sessionRef.current;
    if (session === null || session.pointerID !== event.pointerId) return;
    if (!isCancelled && session.isDragging && session.anchorKey !== null) {
      input.onOrderChange(
        buildHomeProjectDrop({
          projects: input.projects,
          rankedKeys: input.rankedKeys,
          sourceKey: session.sourceKey,
          anchorKey: session.anchorKey,
          dropAfter: session.dropAfter,
          cap: PROJECT_ORDER_CAP,
        }),
      );
    }
    if (session.element.hasPointerCapture(session.pointerID)) {
      session.element.releasePointerCapture(session.pointerID);
    }
    sessionRef.current = null;
    setVisual(null);
  };

  const handlers: HomeProjectDragHandlers = {
    keyDown(event) {
      if (
        !event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        (event.key !== "ArrowUp" && event.key !== "ArrowDown")
      ) {
        return;
      }
      const sourceKey = event.currentTarget.dataset.honkHomeProjectKey;
      const sourceIndex = input.projects.findIndex((project) => project.key === sourceKey);
      const direction = event.key === "ArrowUp" ? -1 : 1;
      const anchor = input.projects[sourceIndex + direction];
      if (sourceKey === undefined || sourceIndex < 0 || anchor === undefined) return;
      event.preventDefault();
      input.onSelect(sourceKey);
      input.onOrderChange(
        buildHomeProjectDrop({
          projects: input.projects,
          rankedKeys: input.rankedKeys,
          sourceKey,
          anchorKey: anchor.key,
          dropAfter: direction > 0,
          cap: PROJECT_ORDER_CAP,
        }),
      );
    },
    pointerDown(event) {
      if (event.button !== 0 || event.pointerType === "touch") return;
      const sourceKey = event.currentTarget.dataset.honkHomeProjectKey;
      if (sourceKey === undefined) return;
      input.onSelect(sourceKey);
      sessionRef.current = {
        pointerID: event.pointerId,
        sourceKey,
        originX: event.clientX,
        originY: event.clientY,
        element: event.currentTarget,
        isDragging: false,
        anchorKey: null,
        dropAfter: false,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    pointerMove(event) {
      const session = sessionRef.current;
      if (session === null || session.pointerID !== event.pointerId) return;
      if (!session.isDragging) {
        if (
          Math.hypot(event.clientX - session.originX, event.clientY - session.originY) <
          PROJECT_DRAG_ACTIVATION_DISTANCE
        ) {
          return;
        }
        session.isDragging = true;
      }
      event.preventDefault();
      const scrollport = session.element.closest<HTMLElement>("[data-honk-home-project-list]");
      if (scrollport !== null) {
        const bounds = scrollport.getBoundingClientRect();
        const edge = bounds.height * PROJECT_DRAG_AUTOSCROLL_EDGE;
        if (event.clientY < bounds.top + edge) scrollport.scrollTop -= PROJECT_DRAG_AUTOSCROLL_STEP;
        if (event.clientY > bounds.bottom - edge) {
          scrollport.scrollTop += PROJECT_DRAG_AUTOSCROLL_STEP;
        }
      }
      const target =
        document
          .elementFromPoint(event.clientX, event.clientY)
          ?.closest<HTMLElement>("[data-honk-home-project-key]") ?? null;
      const anchorKey = target?.dataset.honkHomeProjectKey;
      if (target === null || anchorKey === undefined || anchorKey === session.sourceKey) {
        session.anchorKey = null;
        setVisual({ sourceKey: session.sourceKey, anchorKey: null, dropAfter: false });
        return;
      }
      const bounds = target.getBoundingClientRect();
      session.anchorKey = anchorKey;
      session.dropAfter = event.clientY > bounds.top + bounds.height / 2;
      setVisual({ sourceKey: session.sourceKey, anchorKey, dropAfter: session.dropAfter });
    },
    pointerUp(event) {
      finish(event, false);
    },
    pointerCancel(event) {
      finish(event, true);
    },
  };

  return { visual, handlers };
}

const EMPTY_THREADS: readonly CommandMenuThread[] = Object.freeze([]);
const EMPTY_DIRECTORIES: readonly string[] = Object.freeze([]);

function activeThreads(threads: readonly CommandMenuThread[]): readonly CommandMenuThread[] {
  return threads
    .filter((thread) => thread.archivedAt === null && thread.parentSessionId === null)
    .slice()
    .sort((a, b) => {
      const byUpdated = b.updatedAt.localeCompare(a.updatedAt);
      return byUpdated === 0 ? String(a.id).localeCompare(String(b.id)) : byUpdated;
    })
    .slice(0, HOME_SESSION_LIMIT);
}

type ProjectFilter = {
  readonly key: string;
  readonly label: string;
  readonly projectID: string | null;
  // Worktree path used as the composer cwd when this row is selected.
  readonly directory: string | null;
  readonly server: OpenCodeServerKey | null;
  readonly count: number;
  readonly statuses: readonly TabStatus[];
};

type ThreadGroups = {
  readonly needsYou: readonly CommandMenuThread[];
  readonly working: readonly CommandMenuThread[];
  readonly recent: readonly CommandMenuThread[];
};

function buildProjectFilters(threads: readonly CommandMenuThread[]): readonly ProjectFilter[] {
  const byProject = new Map<
    string,
    {
      label: string;
      projectID: string | null;
      directory: string | null;
      server: OpenCodeServerKey;
      threads: CommandMenuThread[];
    }
  >();

  for (const thread of threads) {
    const key = projectKey(thread);
    const existing = byProject.get(key);
    if (existing === undefined) {
      byProject.set(key, {
        label: projectLabel(thread),
        projectID: thread.projectId,
        directory: thread.projectDirectory,
        server: thread.server,
        threads: [thread],
      });
    } else {
      existing.threads.push(thread);
    }
  }

  const projects = [...byProject.entries()]
    .map(([key, value]) => ({
      key,
      label: value.label,
      projectID: value.projectID,
      directory: value.directory,
      server: value.server,
      count: value.threads.length,
      statuses: statusRoll(value.threads),
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return Object.freeze([
    {
      key: PROJECT_ALL_KEY,
      label: "All",
      projectID: null,
      directory: null,
      server: null,
      count: threads.length,
      statuses: statusRoll(threads),
    },
    ...projects,
  ]);
}

function filterThreadsByProject(
  threads: readonly CommandMenuThread[],
  selectedProjectKey: string,
): readonly CommandMenuThread[] {
  if (selectedProjectKey === PROJECT_ALL_KEY) {
    return threads;
  }
  return threads.filter((thread) => projectKey(thread) === selectedProjectKey);
}

function groupHomeThreads(threads: readonly CommandMenuThread[]): ThreadGroups {
  const needsYou: CommandMenuThread[] = [];
  const working: CommandMenuThread[] = [];
  const recent: CommandMenuThread[] = [];

  for (const thread of threads) {
    const status = tabStatusFromSummary(thread);
    if (status === "needs-you") {
      needsYou.push(thread);
    } else if (status === "working") {
      working.push(thread);
    } else {
      recent.push(thread);
    }
  }

  return Object.freeze({ needsYou, working, recent });
}

function projectKey(thread: CommandMenuThread): string {
  if (thread.projectId !== null) {
    return `server:${thread.server}:project:${String(thread.projectId)}`;
  }
  const worktreePath = thread.worktree?.path;
  if (worktreePath !== undefined && worktreePath !== null) {
    return `server:${thread.server}:cwd:${worktreePath}`;
  }
  return `server:${thread.server}:anywhere`;
}

function projectLabel(thread: CommandMenuThread): string {
  if (thread.projectDirectory.length > 0) {
    return basename(thread.projectDirectory);
  }
  if (thread.projectId !== null) {
    return String(thread.projectId);
  }
  return "Anywhere";
}

const STATUS_ORDER: readonly TabStatus[] = Object.freeze([
  "needs-you",
  "failed",
  "working",
  "done",
  "draft",
  "idle",
]);

function statusRoll(threads: readonly CommandMenuThread[]): readonly TabStatus[] {
  const statuses = new Set(threads.map(tabStatusFromSummary));
  return STATUS_ORDER.filter((status) => statuses.has(status)).slice(0, 1);
}

function ThreadGroup({
  label,
  threads,
}: {
  label: string;
  threads: readonly CommandMenuThread[];
}): React.ReactElement | null {
  if (threads.length === 0) {
    return null;
  }

  return (
    <>
      <div {...stylex.props(styles.groupHead)}>
        <span {...stylex.props(styles.groupTitle)}>{label}</span>
        <span {...stylex.props(styles.count)}>{threads.length}</span>
      </div>
      {threads.map((thread) => (
        <HomeThreadRow
          key={openCodeSessionKey(openCodeSessionRef(thread.server, thread.id))}
          thread={thread}
        />
      ))}
    </>
  );
}

function HomeThreadRow({ thread }: { thread: CommandMenuThread }): React.ReactElement {
  const status = tabStatusFromSummary(thread);
  const branch = thread.worktree?.branch;

  return (
    <ListRow
      onClick={() => {
        tabActions.open({
          key: openCodeSessionKey(openCodeSessionRef(thread.server, thread.id)),
          title: thread.title,
          kind: "thread",
          status,
          repository:
            thread.worktree?.path === undefined || thread.worktree.path === null
              ? { state: "loading" }
              : { state: "ready", label: basename(thread.worktree.path) },
        });
      }}
    >
      <ThreadAvatar label={projectLabel(thread)} colorKey={projectKey(thread)} status={status} />
      <ListRow.Content>
        <ListRow.Title>{thread.title}</ListRow.Title>
      </ListRow.Content>
      <ListRow.Meta>
        {branch !== undefined && branch !== null ? (
          <Pill size="inline" tone="muted" style={styles.branchLabel}>
            {branch}
          </Pill>
        ) : null}
        {formatRelativeTime(thread.updatedAt)}
      </ListRow.Meta>
    </ListRow>
  );
}

function HomeStatusGlyph({ status }: { status: TabStatus }): React.ReactElement {
  if (status === "working") {
    return <Matrix grid={4} isActive />;
  }
  if (status === "needs-you") {
    return <Matrix grid={4} variant="attention" />;
  }
  return <StatusDot tone={statusDotTone(status)} pulse={statusDotPulse(status)} />;
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function formatRelativeTime(timestamp: string): string {
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time)) {
    return "now";
  }

  const delta = Math.max(0, Date.now() - time);
  if (delta < MINUTE_MS) {
    return "now";
  }
  if (delta < HOUR_MS) {
    return `${String(Math.floor(delta / MINUTE_MS))}m`;
  }
  if (delta < DAY_MS) {
    return `${String(Math.floor(delta / HOUR_MS))}h`;
  }
  return `${String(Math.floor(delta / DAY_MS))}d`;
}

export { HomePage };
