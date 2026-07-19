import * as stylex from "@stylexjs/stylex";
import {
  openCodeLocationRef,
  openCodeSessionKey,
  openCodeSessionRef,
  type OpenCodeServerKey,
} from "@honk/opencode";
import { basename } from "@honk/shared/paths";
import { Icon, ListRow, Matrix, Spinner, StatusDot, Text } from "@honk/ui";
import { colorVars, controlVars, fontVars, radiusVars, spaceVars } from "@honk/ui/tokens.stylex";
import { IconFolderAddRight, IconSettingsGear2 } from "@honk/ui/icons";
import * as React from "react";

import { useAppSettings } from "./app-settings-store";
import { HomeComposer } from "./composer/home-composer";
import { pickFolder } from "./desktop-bridge";
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
const CONTENT_COLUMN = "minmax(0, 720px)";
const LG_MEDIA = "@media (min-width: 1024px)";
const HOME_GAP = "16px";
const HOME_GAP_LARGE = "32px";
const HOME_PAD_LARGE = "24px";
// Fixed lane so multiline composer growth moves up without resizing the browser columns.
const COMPOSER_LANE_HEIGHT = "256px";
const NAV_MOBILE_MAX_HEIGHT = "240px";
const HOME_FINE_GAP = "4px";
const HAIRLINE = "1px";
const SCROLL_PAD_BOTTOM = "64px";
const NEGATIVE_PANEL_PAD = "-12px";
const PROJECT_ALL_KEY = "all";
// OpenCode Home deliberately keeps the default inventory bounded while search owns deep history.
const HOME_SESSION_LIMIT = 64;
// Project avatar footprint; leading slots on the Add/Settings rows match it so titles line up.
const AVATAR_SIZE = "20px";
const LEADING_SLOT_STYLE = {
  width: AVATAR_SIZE,
  height: AVATAR_SIZE,
} satisfies React.CSSProperties;
// Thread status badge: corner nudge past the avatar edge, and the base-surface ring around the dot.
const AVATAR_BADGE_OFFSET = "-3px";
const AVATAR_BADGE_RING = "1.5px";
// Progressive edge blur over scrollable sections: a gradient-masked backdrop blur at each edge,
// faded by scroll-driven animations so the top blur appears only once content has scrolled under
// it and the bottom blur clears at the end. A non-scrollable section leaves the scroll timeline
// inactive, which keeps both overlays at their base opacity of 0.
const EDGE_SCROLL_TIMELINE = "--edge-scroll";
const EDGE_BLUR_EXTENT = "48px";
const EDGE_BLUR_FILTER = "blur(8px)";
// Scroll distance over which an edge blur fades in/out.
const EDGE_FADE_DISTANCE = "24px";

const edgeFadeIn = stylex.keyframes({
  from: { opacity: 0 },
  to: { opacity: 1 },
});
const edgeFadeOut = stylex.keyframes({
  from: { opacity: 1 },
  to: { opacity: 0 },
});

const styles = stylex.create({
  grid: {
    boxSizing: "border-box",
    height: "100%",
    width: "100%",
    maxWidth: "1080px",
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
    maxWidth: "720px",
    height: COMPOSER_LANE_HEIGHT,
    marginInline: "auto",
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-end",
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
    scrollTimelineName: EDGE_SCROLL_TIMELINE,
  },
  navSpacer: {
    flexGrow: 1,
    minHeight: 0,
  },
  navFooter: {
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    // oxlint-disable-next-line honk/design-no-raw-values -- 4px footer row gap; spaceVars owns no 4px (sidebar-item-gap belongs to the app sidebar surface)
    gap: HOME_FINE_GAP,
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
    scrollTimelineName: EDGE_SCROLL_TIMELINE,
  },
  // Positioning context + timeline scope so the edge-blur overlays can track their
  // sibling scroller's scroll timeline.
  scrollEdgeWrap: {
    position: "relative",
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    timelineScope: EDGE_SCROLL_TIMELINE,
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
    opacity: 0,
    backdropFilter: EDGE_BLUR_FILTER,
    animationDuration: "auto",
    animationTimingFunction: "linear",
    animationFillMode: "both",
    animationTimeline: EDGE_SCROLL_TIMELINE,
  },
  edgeBlurTop: {
    top: 0,
    maskImage: "linear-gradient(to bottom, black, transparent)",
    animationName: edgeFadeIn,
    animationRangeStart: "0px",
    animationRangeEnd: EDGE_FADE_DISTANCE,
  },
  edgeBlurBottom: {
    bottom: 0,
    maskImage: "linear-gradient(to top, black, transparent)",
    animationName: edgeFadeOut,
    animationRangeStart: `calc(100% - ${EDGE_FADE_DISTANCE})`,
    animationRangeEnd: "100%",
  },
  scrollContent: {
    display: "flex",
    flexDirection: "column",
    paddingRight: spaceVars["--honk-space-panel-pad"],
    // oxlint-disable-next-line honk/design-no-raw-values -- 64px scroll end-padding is a fixed intrinsic, no spacing token owns it
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
  },
  groupTitle: {
    color: colorVars["--honk-color-text-muted"],
  },
  count: {
    color: colorVars["--honk-color-text-faint"],
    fontVariantNumeric: "tabular-nums",
  },
  chip: {
    display: "inline-block",
    maxWidth: "160px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    boxSizing: "border-box",
    borderRadius: radiusVars["--honk-radius-pill"],
    paddingInline: controlVars["--honk-control-gap"],
    backgroundColor: colorVars["--honk-color-layer-02"],
    color: colorVars["--honk-color-text-muted"],
    fontSize: fontVars["--honk-font-size-caption"],
    lineHeight: fontVars["--honk-leading-detail"],
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

function HomePage(): React.ReactElement {
  const watch = useSessionInventoryWatch();
  const appSettings = useAppSettings();
  const threads = activeThreads(watch.state?.rootSessions ?? EMPTY_THREADS);
  const [projectKey, setProjectKey] = React.useState(PROJECT_ALL_KEY);
  // Explicit folder pick beats the nav selection until a project row is clicked again.
  const [pickedDirectory, setPickedDirectory] = React.useState<string | null>(null);
  const projectFilters = buildProjectFilters(threads);
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

  if (isConnecting) {
    return (
      <div {...stylex.props(styles.center)}>
        <Spinner label="Connecting to workspace" tone="muted" />
      </div>
    );
  }

  return (
    <div {...stylex.props(styles.grid)}>
      <div {...stylex.props(styles.composerLane)}>
        <HomeComposer
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
          selectedKey={selectedProjectKey}
          onSelect={selectProject}
          onAddProject={addProject}
        />

        <section {...stylex.props(styles.content)} aria-label="Threads">
          {isDisconnected ? (
            <div {...stylex.props(styles.notice)}>
              <Text as="p" size="sm" tone="faint">
                {watch.status === "unauthorized"
                  ? "Workspace watch unauthorized."
                  : "Workspace watch closed."}
              </Text>
            </div>
          ) : null}

          {threads.length === 0 ? (
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
              <div {...stylex.props(styles.scroll)}>
                <div {...stylex.props(styles.scrollContent)}>
                  <ThreadGroup label="Needs you" threads={groupedThreads.needsYou} />
                  <ThreadGroup label="Working" threads={groupedThreads.working} />
                  <ThreadGroup label="Recent" threads={groupedThreads.recent} />
                </div>
              </div>
              <ScrollEdgeBlur />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// Progressive blur overlays for a sibling scroller inside a scrollEdgeWrap; visibility is
// driven entirely by the scroller's scroll timeline (see EDGE_SCROLL_TIMELINE).
function ScrollEdgeBlur(): React.ReactElement {
  return (
    <>
      <div {...stylex.props(styles.edgeBlur, styles.edgeBlurTop)} aria-hidden />
      <div {...stylex.props(styles.edgeBlur, styles.edgeBlurBottom)} aria-hidden />
    </>
  );
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

function ProjectNav({
  projects,
  selectedKey,
  onSelect,
  onAddProject,
}: {
  readonly projects: readonly ProjectFilter[];
  readonly selectedKey: string;
  readonly onSelect: (key: string) => void;
  readonly onAddProject: () => void;
}): React.ReactElement {
  return (
    <aside {...stylex.props(styles.nav)} aria-label="Projects">
      <div {...stylex.props(styles.navHead)}>Projects</div>
      <div {...stylex.props(styles.scrollEdgeWrap)}>
        <div {...stylex.props(styles.navRows)}>
          {projects.map((project) => (
            <ListRow
              key={project.key}
              isSelected={project.key === selectedKey}
              aria-current={project.key === selectedKey ? "page" : undefined}
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
          ))}
          <ListRow onClick={onAddProject}>
            <ListRow.Slot style={LEADING_SLOT_STYLE}>
              <Icon icon={IconFolderAddRight} size="sm" tone="muted" />
            </ListRow.Slot>
            <ListRow.Title>Add project</ListRow.Title>
          </ListRow>
        </div>
        <ScrollEdgeBlur />
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
          <span {...stylex.props(styles.chip)}>{branch}</span>
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
