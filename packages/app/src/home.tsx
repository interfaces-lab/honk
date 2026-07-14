// Home — one centered composer lane above a two-column browser: projects on the left, grouped
// threads on the right. The composer spans the grid so it is visually centered in the sheet
// instead of inheriting the thread-list column's offset.
// Honest watch states: Spinner while connecting with no snapshot; empty copy when zero
// threads; quiet notice on closed/unauthorized (reconnect UX is another WP).

import * as stylex from "@stylexjs/stylex";
import { Icon, ListRow, Matrix, Spinner, StatusDot, Text } from "@honk/ui";
import { colorVars, controlVars, fontVars, radiusVars, spaceVars } from "@honk/ui/tokens.stylex";
import { IconFolderAddRight, IconSettingsGear2 } from "@honk/ui/icons";
import { useNavigate } from "@tanstack/react-router";
import * as React from "react";

import { useAppSettings } from "./app-settings-store";
import { Composer } from "./composer";
import { pickFolder } from "./desktop-bridge";
import {
  statusDotPulse,
  statusDotTone,
  tabStatusFromSummary,
  type CommandMenuThread,
} from "./command-menu-model";
import { DEFAULT_SETTINGS_SECTION } from "./settings";
import { actions as tabActions, type TabStatus } from "./tab-store";
import { useWorkspaceWatch } from "./use-sdk-watch";

// ── Anatomy (opencode home.tsx, v2) ──────────────────────────────────────────────────────────
// The sheet interior grid: max-w-[1080px], lg:grid-cols-[280px_minmax(0,720px)] lg:gap-8
// lg:px-6; below lg it stacks (auto/1fr) at gap-4 px-3.
const HOME_MAX_WIDTH = "1080px";
const NAV_COLUMN = "280px";
const CONTENT_COLUMN = "minmax(0, 720px)";
const COMPOSER_MAX_WIDTH = "720px";
// opencode's lg breakpoint (Tailwind 1024px) — the two-column threshold.
const LG_MEDIA = "@media (min-width: 1024px)";
// Home's responsive grid geometry is page anatomy, not reusable design vocabulary.
const HOME_GAP = "16px";
const HOME_GAP_LARGE = "32px";
const HOME_PAD_LARGE = "24px";
const COMPOSER_PAD_TOP = "24px";
const COMPOSER_PAD_TOP_LARGE = "48px";
const NAV_MOBILE_MAX_HEIGHT = "240px";
const HOME_FINE_GAP = "4px";
const HAIRLINE = "1px";
const SCROLL_PAD_BOTTOM = "64px";
const NEGATIVE_PANEL_PAD = "-12px";
// Nav rows share @honk/ui ListRow's control-scale recipe — 28px tall, control radius, control
// inline pad (10px), control gap — so the left project rows and the right thread rows read as one
// row system. hover/selected draw an inset 0.5px ring instead of a border.
const NAV_ROW_RING = `inset 0 0 0 0.5px ${colorVars["--honk-color-border-muted"]}`;
// Branch pills stay a glance, not a column — cap before they starve the row title.
const BRANCH_CHIP_MAX_WIDTH = "160px";
const PROJECT_ALL_KEY = "all";

const styles = stylex.create({
  grid: {
    boxSizing: "border-box",
    height: "100%",
    width: "100%",
    maxWidth: HOME_MAX_WIDTH,
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
    width: "100%",
    maxWidth: COMPOSER_MAX_WIDTH,
    marginInline: "auto",
    flexShrink: 0,
    paddingTop: {
      default: COMPOSER_PAD_TOP,
      [LG_MEDIA]: COMPOSER_PAD_TOP_LARGE,
    },
    paddingBottom: HOME_GAP,
  },
  columns: {
    flexGrow: 1,
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
      default: HOME_GAP,
      [LG_MEDIA]: HOME_GAP_LARGE,
    },
  },

  // ── Left column: the project nav (opencode HomeProjectColumn) ────────────────────────────
  nav: {
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
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
    fontWeight: fontVars["--honk-font-weight-medium"],
  },
  navRows: {
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    gap: HAIRLINE,
    overflowY: "auto",
    scrollbarWidth: "none",
    paddingRight: spaceVars["--honk-space-panel-pad"],
  },
  navRow: {
    position: "relative",
    flexShrink: 0,
    height: controlVars["--honk-control-h-md"],
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    boxSizing: "border-box",
    paddingInline: controlVars["--honk-control-pad-md"],
    borderRadius: radiusVars["--honk-radius-control"],
    borderStyle: "none",
    textAlign: "left",
    cursor: "default",
    fontFamily: "inherit",
    fontSize: fontVars["--honk-font-size-body"],
    fontWeight: fontVars["--honk-font-weight-book"],
    color: {
      default: colorVars["--honk-color-text-muted"],
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-text-primary"] },
    },
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-layer-01"] },
    },
    boxShadow: {
      default: "none",
      ":hover": { "@media (hover: hover)": NAV_ROW_RING },
    },
  },
  navRowSelected: {
    color: {
      default: colorVars["--honk-color-text-primary"],
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-text-primary"] },
    },
    backgroundColor: {
      default: colorVars["--honk-color-accent-subtle"],
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-accent-subtle"] },
    },
    boxShadow: {
      default: NAV_ROW_RING,
      ":hover": { "@media (hover: hover)": NAV_ROW_RING },
    },
  },
  navRowLabel: {
    minWidth: 0,
    flexGrow: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  navRowMeta: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    color: colorVars["--honk-color-text-faint"],
    fontVariantNumeric: "tabular-nums",
    fontSize: fontVars["--honk-font-size-detail"],
  },
  navSpacer: {
    flexGrow: 1,
    minHeight: 0,
  },
  // v2 HomeUtilityNav: mb-8 mt-4 — the Settings/help cluster seated off the sheet corner.
  navFooter: {
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    gap: HOME_FINE_GAP,
    marginTop: HOME_GAP,
    marginBottom: HOME_GAP_LARGE,
    paddingRight: spaceVars["--honk-space-panel-pad"],
  },
  navFooterRow: {
    color: colorVars["--honk-color-text-faint"],
  },

  // ── Right column: grouped thread list ────────────────────────────────────────────────────
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
    marginTop: spaceVars["--honk-space-panel-pad"],
    // v2: -mr-3 + pr-3 content — the scrollbar rides the gutter, rows keep their inset.
    marginRight: NEGATIVE_PANEL_PAD,
    display: "flex",
    flexDirection: "column",
    overflowY: "auto",
    overflowAnchor: "none",
  },
  scrollContent: {
    display: "flex",
    flexDirection: "column",
    paddingTop: spaceVars["--honk-space-panel-pad"],
    paddingRight: spaceVars["--honk-space-panel-pad"],
    paddingBottom: SCROLL_PAD_BOTTOM,
  },
  groupHead: {
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    paddingBlock: controlVars["--honk-control-gap"],
    paddingInline: spaceVars["--honk-space-control-pad-x"],
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
    // The branch name is secondary — it never wins the space contest against the
    // thread title, so the pill caps and ellipsizes.
    maxWidth: BRANCH_CHIP_MAX_WIDTH,
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
  const watch = useWorkspaceWatch();
  const appSettings = useAppSettings();
  const threads = activeThreads(watch.state?.threads ?? EMPTY_THREADS);
  const [projectKey, setProjectKey] = React.useState(PROJECT_ALL_KEY);
  // A folder aimed at directly (Add project / the composer's location chip) — it wins over
  // the nav selection until a project row is clicked again.
  const [pickedDirectory, setPickedDirectory] = React.useState<string | null>(null);
  const projectFilters = buildProjectFilters(threads);
  const selectedProjectKey = projectFilters.some((project) => project.key === projectKey)
    ? projectKey
    : PROJECT_ALL_KEY;
  const visibleThreads = filterThreadsByProject(threads, selectedProjectKey);
  const groupedThreads = groupHomeThreads(visibleThreads);
  const isConnecting = watch.status === "connecting" && watch.state === null;
  const isDisconnected = watch.status === "closed" || watch.status === "unauthorized";

  // Where a new thread lands: an explicitly picked folder > the selected project's worktree >
  // the settings default > the sidecar's own default (undefined).
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
        <Composer
          {...(targetDirectory !== undefined ? { directory: targetDirectory } : {})}
          {...(targetLabel !== undefined ? { directoryLabel: targetLabel } : {})}
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
              <Text as="p" size="sm" tone="muted" weight="medium">
                No threads yet
              </Text>
              <Text as="p" size="xs" tone="faint">
                Type above and press Enter to start a new chat.
              </Text>
            </div>
          ) : visibleThreads.length === 0 ? (
            <div {...stylex.props(styles.center)}>
              <Text as="p" size="sm" tone="muted" weight="medium">
                No threads in this project
              </Text>
              <Text as="p" size="xs" tone="faint">
                Pick another project or start a new chat above.
              </Text>
            </div>
          ) : (
            <div {...stylex.props(styles.scroll)}>
              <div {...stylex.props(styles.scrollContent)}>
                <ThreadGroup label="Needs you" threads={groupedThreads.needsYou} />
                <ThreadGroup label="Working" threads={groupedThreads.working} />
                <ThreadGroup label="Recent" threads={groupedThreads.recent} />
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// ── Left column ──────────────────────────────────────────────────────────────────────────────

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
  const navigate = useNavigate();

  return (
    <aside {...stylex.props(styles.nav)} aria-label="Projects">
      <div {...stylex.props(styles.navHead)}>Projects</div>
      <div {...stylex.props(styles.navRows)}>
        {projects.map((project) => (
          <NavRow
            key={project.key}
            isSelected={project.key === selectedKey}
            onClick={() => {
              onSelect(project.key);
            }}
          >
            <span {...stylex.props(styles.navRowLabel)}>{project.label}</span>
            <span {...stylex.props(styles.navRowMeta)}>
              {project.statuses[0] !== undefined && (
                <HomeStatusGlyph status={project.statuses[0]} />
              )}
              {project.count}
            </span>
          </NavRow>
        ))}
        {/* Aim a new thread at any folder — the picked path lands on the composer's location
            chip; the folder becomes a real project row once its first thread exists. */}
        <NavRow xstyle={styles.navFooterRow} onClick={onAddProject}>
          <Icon icon={IconFolderAddRight} size="sm" tone="muted" />
          <span {...stylex.props(styles.navRowLabel)}>Add project</span>
        </NavRow>
      </div>
      <div {...stylex.props(styles.navSpacer)} />
      {/* The utility footer — the old rail's settings gear lives here now (v2 HomeUtilityNav). */}
      <div {...stylex.props(styles.navFooter)}>
        <NavRow
          xstyle={styles.navFooterRow}
          onClick={() => {
            void navigate({ to: "/settings", search: { section: DEFAULT_SETTINGS_SECTION } });
          }}
        >
          <Icon icon={IconSettingsGear2} size="sm" tone="muted" />
          <span {...stylex.props(styles.navRowLabel)}>Settings</span>
        </NavRow>
      </div>
    </aside>
  );
}

function NavRow({
  isSelected = false,
  onClick,
  children,
  xstyle,
}: {
  readonly isSelected?: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
  readonly xstyle?: stylex.StyleXStyles;
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-pressed={isSelected}
      {...stylex.props(styles.navRow, isSelected && styles.navRowSelected, xstyle)}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const EMPTY_THREADS: readonly CommandMenuThread[] = Object.freeze([]);
const EMPTY_DIRECTORIES: readonly string[] = Object.freeze([]);

function activeThreads(threads: readonly CommandMenuThread[]): readonly CommandMenuThread[] {
  return threads
    .filter((t) => t.archivedAt === null)
    .slice()
    .sort((a, b) => {
      const byUpdated = b.updatedAt.localeCompare(a.updatedAt);
      return byUpdated === 0 ? String(a.id).localeCompare(String(b.id)) : byUpdated;
    });
}

type ProjectFilter = {
  readonly key: string;
  readonly label: string;
  // The project's worktree path — the composer's target when this row is selected.
  readonly directory: string | null;
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
    { label: string; directory: string | null; threads: CommandMenuThread[] }
  >();

  for (const thread of threads) {
    const key = projectKey(thread);
    const existing = byProject.get(key);
    if (existing === undefined) {
      byProject.set(key, {
        label: projectLabel(thread),
        directory: thread.worktree?.path ?? null,
        threads: [thread],
      });
    } else {
      existing.threads.push(thread);
      if (existing.directory === null && thread.worktree?.path != null) {
        existing.directory = thread.worktree.path;
      }
    }
  }

  const projects = [...byProject.entries()]
    .map(([key, value]) => ({
      key,
      label: value.label,
      directory: value.directory,
      count: value.threads.length,
      statuses: statusRoll(value.threads),
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return Object.freeze([
    {
      key: PROJECT_ALL_KEY,
      label: "All",
      directory: null,
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
    return `project:${String(thread.projectId)}`;
  }
  const worktreePath = thread.worktree?.path;
  if (worktreePath !== undefined && worktreePath !== null) {
    return `cwd:${worktreePath}`;
  }
  return "anywhere";
}

function projectLabel(thread: CommandMenuThread): string {
  if (thread.worktree?.path !== undefined && thread.worktree.path !== null) {
    return basename(thread.worktree.path);
  }
  if (thread.projectId !== null) {
    return String(thread.projectId);
  }
  return "Anywhere";
}

function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const [last = trimmed] = trimmed.split(/[\\/]/).slice(-1);
  return last.length > 0 ? last : path;
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
        <HomeThreadRow key={String(thread.id)} thread={thread} />
      ))}
    </>
  );
}

function HomeThreadRow({ thread }: { thread: CommandMenuThread }): React.ReactElement {
  const status = tabStatusFromSummary(thread);
  const subtitle = `${projectLabel(thread)} · ${threadStatusLabel(thread)}`;
  const branch = thread.worktree?.branch;

  return (
    <ListRow
      onClick={() => {
        tabActions.open({
          key: String(thread.id),
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
      <ListRow.Slot>
        <HomeStatusGlyph status={status} />
      </ListRow.Slot>
      <ListRow.Title>{thread.title}</ListRow.Title>
      <ListRow.Subtitle>{subtitle}</ListRow.Subtitle>
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
  return <StatusDot tone={statusDotTone(status)} pulse={statusDotPulse(status)} />;
}

function threadStatusLabel(thread: CommandMenuThread): string {
  if (thread.needsAttention) {
    return "needs input";
  }
  switch (thread.status) {
    case "running":
      return "working";
    case "failed":
      return "failed";
    case "idle":
      return "idle";
    default: {
      const _exhaustive: never = thread.status;
      return _exhaustive;
    }
  }
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
