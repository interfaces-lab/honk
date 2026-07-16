import * as stylex from "@stylexjs/stylex";
import {
  openCodeSessionKey,
  type OpenCodeClient,
  type OpenCodeServerKey,
  type OpenCodeSessionRef,
  type OpenCodeVcsFileDiff,
  type OpenCodeVcsFileStatus,
} from "@honk/opencode";
import { Button, Icon, IconButton, Menu, Spinner, Text } from "@honk/ui";
import {
  IconArrowRotateClockwise,
  IconBranch,
  IconCheckmark1,
  IconDotGrid1x3Horizontal,
  IconEyeOpen,
} from "@honk/ui/icons";
import { colorVars, controlVars, fontVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as React from "react";

import { errorMessage } from "./error-message";
import { useGitViewedState } from "./lib/use-git-viewed-state";
import { useResolvedTheme } from "./lib/use-resolved-theme";
import { WorkbenchChangesCard } from "./workbench-changes-card";
import { WorkbenchChangesFileTree } from "./workbench-changes-file-tree";
import { getOpenCodeClient } from "./watch-registry";

const CHANGES_RESOURCE_GRACE_MS = 30_000;
const CHANGES_TREE_BASIS = "30%";
const CHANGES_TREE_MAX = "40%";
const HAIRLINE_WIDTH = "1px";
// Sub-token intrinsic: tightest token is --honk-control-gap (6px); the add/del counts sit tighter.
const META_GAP = "4px";
const DIFF_STYLE_STORAGE_KEY = "honk:git-diff-style";

type DiffStyle = "unified" | "split";

const styles = stylex.create({
  root: {
    flexGrow: 1,
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
  },
  toolbar: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    padding: spaceVars["--honk-space-gutter"],
  },
  branch: {
    minWidth: 0,
    flexGrow: 1,
    display: "inline-flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    overflow: "hidden",
    color: colorVars["--honk-color-text-muted"],
  },
  branchLabel: {
    minWidth: 0,
    overflow: "hidden",
    fontFamily: fontVars["--honk-font-family-mono"],
    fontSize: fontVars["--honk-font-size-detail"],
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  meta: {
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    gap: META_GAP,
    color: colorVars["--honk-color-text-faint"],
    fontSize: fontVars["--honk-font-size-caption"],
    fontVariantNumeric: "tabular-nums",
  },
  body: {
    flexGrow: 1,
    minWidth: 0,
    minHeight: 0,
    display: "flex",
  },
  treeColumn: {
    flexBasis: CHANGES_TREE_BASIS,
    maxWidth: CHANGES_TREE_MAX,
    minWidth: 0,
    minHeight: 0,
    overflowY: "auto",
    borderInlineEndWidth: HAIRLINE_WIDTH,
    borderInlineEndStyle: "solid",
    borderInlineEndColor: colorVars["--honk-color-border-muted"],
  },
  cardList: {
    flexGrow: 1,
    minWidth: 0,
    minHeight: 0,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
  },
  cardWrap: {
    minWidth: 0,
  },
  menuCheck: {
    display: "inline-flex",
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
    width: "1em",
    color: colorVars["--honk-color-accent"],
  },
  menuLabel: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  center: {
    flexGrow: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: spaceVars["--honk-space-gutter"],
    padding: spaceVars["--honk-space-panel-pad"],
    textAlign: "center",
  },
});

type ChangesReady = {
  readonly branch: string | null;
  readonly files: readonly OpenCodeVcsFileStatus[];
  readonly diffs: ReadonlyMap<string, OpenCodeVcsFileDiff>;
  // The file list paints from info+status immediately; patches stream in after. While true,
  // an absent patch means "still loading" rather than "binary/oversized".
  readonly diffsPending: boolean;
};

type ChangesSnapshot =
  | { readonly phase: "loading" }
  | { readonly phase: "error"; readonly message: string }
  | ({ readonly phase: "ready" } & ChangesReady);

type ChangesResource = {
  readonly getSnapshot: () => ChangesSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly refresh: () => void;
  readonly observeThreadRunning: (isRunning: boolean) => void;
};

type ChangesClient = Pick<OpenCodeClient, "vcs">;
type ChangesClientResolver = (server: OpenCodeServerKey) => ChangesClient | null;

const changesResources = new Map<string, ChangesResource>();
const INITIAL_CHANGES_SNAPSHOT: ChangesSnapshot = Object.freeze({ phase: "loading" });
const EMPTY_FILES: readonly OpenCodeVcsFileStatus[] = Object.freeze([]);

function createChangesResource(
  sessionRef: OpenCodeSessionRef,
  directory: string,
  resolveClient: ChangesClientResolver = getOpenCodeClient,
): ChangesResource {
  let snapshot = INITIAL_CHANGES_SNAPSHOT;
  let requested = false;
  let inFlight = false;
  let refreshQueued = false;
  let sequence = 0;
  let lastThreadRunning: boolean | undefined;
  let releaseTimer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();
  const key = `${openCodeSessionKey(sessionRef)}:${directory}`;

  const publish = (next: ChangesSnapshot): void => {
    snapshot = Object.freeze(next);
    for (const listener of listeners) listener();
  };

  const refresh = (): void => {
    requested = true;
    if (inFlight) {
      refreshQueued = true;
      return;
    }
    const client = resolveClient(sessionRef.server);
    if (client === null) {
      publish({ phase: "error", message: "Honk is not connected to OpenCode." });
      return;
    }

    inFlight = true;
    const currentSequence = ++sequence;
    // Paint the file list as soon as info+status resolve; the heavy per-file `diff` call
    // (every patch) streams in after, so first paint no longer waits on the whole tree.
    void Promise.all([client.vcs.info({ directory }), client.vcs.status({ directory })])
      .then(([info, files]) => {
        if (sequence !== currentSequence) return;
        publish({
          phase: "ready",
          branch: info.branch ?? null,
          files: Object.freeze([...files]),
          diffs: new Map(),
          diffsPending: true,
        });
        return client.vcs.diff({ directory, mode: "git" });
      })
      .then((diffs) => {
        if (diffs === undefined || sequence !== currentSequence) return;
        if (snapshot.phase !== "ready") return;
        publish({
          ...snapshot,
          diffs: new Map(diffs.map((diff) => [diff.file, Object.freeze(diff)])),
          diffsPending: false,
        });
      })
      .catch((error: unknown) => {
        if (sequence !== currentSequence) return;
        publish({ phase: "error", message: errorMessage(error) });
      })
      .finally(() => {
        if (sequence !== currentSequence) return;
        inFlight = false;
        if (refreshQueued) {
          refreshQueued = false;
          refresh();
        }
      });
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (releaseTimer !== null) {
        clearTimeout(releaseTimer);
        releaseTimer = null;
      }
      listeners.add(listener);
      if (!requested) refresh();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          releaseTimer = setTimeout(() => {
            if (listeners.size === 0) changesResources.delete(key);
          }, CHANGES_RESOURCE_GRACE_MS);
        }
      };
    },
    refresh,
    observeThreadRunning(isRunning) {
      if (lastThreadRunning === true && !isRunning) refresh();
      lastThreadRunning = isRunning;
    },
  };
}

function changesResourceFor(sessionRef: OpenCodeSessionRef, directory: string): ChangesResource {
  const key = `${openCodeSessionKey(sessionRef)}:${directory}`;
  const existing = changesResources.get(key);
  if (existing !== undefined) return existing;
  const created = createChangesResource(sessionRef, directory);
  changesResources.set(key, created);
  return created;
}

function useWorkbenchChangesSnapshot(
  sessionRef: OpenCodeSessionRef,
  directory: string,
  isThreadRunning: boolean,
): ChangesSnapshot {
  const resource = changesResourceFor(sessionRef, directory);
  const snapshot = React.useSyncExternalStore(
    resource.subscribe,
    resource.getSnapshot,
    resource.getSnapshot,
  );
  React.useEffect(() => {
    resource.observeThreadRunning(isThreadRunning);
  }, [isThreadRunning, resource]);
  return snapshot;
}

function fileStatusGlyph(status: OpenCodeVcsFileStatus["status"]): "A" | "D" | "M" {
  switch (status) {
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "modified":
      return "M";
  }
}

function readDiffStyle(): DiffStyle {
  if (typeof window === "undefined") return "unified";
  try {
    return window.localStorage.getItem(DIFF_STYLE_STORAGE_KEY) === "split" ? "split" : "unified";
  } catch {
    return "unified";
  }
}

function WorkbenchChanges({
  sessionRef,
  directory,
  isThreadRunning,
  variant = "compact",
}: {
  readonly sessionRef: OpenCodeSessionRef;
  readonly directory: string;
  readonly isThreadRunning: boolean;
  readonly variant?: "compact" | "full";
}): React.ReactElement {
  const { server, sessionID } = sessionRef;
  const resource = changesResourceFor({ server, sessionID }, directory);
  const snapshot = useWorkbenchChangesSnapshot({ server, sessionID }, directory, isThreadRunning);
  const theme = useResolvedTheme();

  const files = snapshot.phase === "ready" ? snapshot.files : EMPTY_FILES;
  const diffsPending = snapshot.phase === "ready" ? snapshot.diffsPending : false;
  const filePaths = files.map((file) => file.file);
  const filePathsKey = filePaths.join("\n");

  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(() => new Set());
  const [diffStyle, setDiffStyleState] = React.useState<DiffStyle>(readDiffStyle);
  const viewed = useGitViewedState(directory, filePaths);

  const cardRefs = React.useRef(new Map<string, HTMLDivElement>());
  const seededKeyRef = React.useRef<string | null>(null);

  // Seed expand-first once per distinct file set: on first render with files and
  // whenever the change set changes, open the first card for immediacy without
  // clobbering later user expand/collapse actions on the same set.
  const firstFile = files[0]?.file;
  React.useEffect(() => {
    if (firstFile === undefined) return;
    if (seededKeyRef.current === filePathsKey) return;
    seededKeyRef.current = filePathsKey;
    setExpanded(new Set([firstFile]));
  }, [filePathsKey, firstFile]);

  const setDiffStyle = (next: DiffStyle): void => {
    setDiffStyleState(next);
    try {
      window.localStorage.setItem(DIFF_STYLE_STORAGE_KEY, next);
    } catch {
      // Persistence is best-effort; a rejected write must not break layout toggling.
    }
  };

  const toggleExpand = (path: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const selectFile = (path: string): void => {
    setSelectedPath(path);
    setExpanded((prev) => {
      if (prev.has(path)) return prev;
      const next = new Set(prev);
      next.add(path);
      return next;
    });
    requestAnimationFrame(() => {
      cardRefs.current.get(path)?.scrollIntoView({ block: "nearest" });
    });
  };

  const expandAll = (): void => {
    setExpanded(new Set(filePaths));
  };
  const collapseAll = (): void => {
    setExpanded(new Set());
  };

  if (snapshot.phase === "loading") {
    return (
      <div {...stylex.props(styles.center)}>
        <Spinner label="Loading changes" tone="muted" />
      </div>
    );
  }

  if (snapshot.phase === "error") {
    return (
      <div {...stylex.props(styles.center)}>
        <Text as="p" size="sm" tone="muted" weight="medium">
          Can't load changes
        </Text>
        <Text as="p" size="xs" tone="faint">
          {snapshot.message}
        </Text>
        <Button size="sm" variant="quiet" onClick={resource.refresh}>
          Try again
        </Button>
      </div>
    );
  }

  const branchLabel = snapshot.branch ?? "No branch";

  if (files.length === 0) {
    return (
      <div {...stylex.props(styles.root)}>
        <div {...stylex.props(styles.toolbar)}>
          <span {...stylex.props(styles.branch)}>
            <Icon icon={IconBranch} size="sm" tone="faint" />
            <span {...stylex.props(styles.branchLabel)}>{branchLabel}</span>
          </span>
          <Button size="sm" variant="quiet" onClick={resource.refresh}>
            Refresh
          </Button>
        </div>
        <div {...stylex.props(styles.center)}>
          <Text as="p" size="sm" tone="muted" weight="medium">
            No changes
          </Text>
          <Text as="p" size="xs" tone="faint">
            The working tree is clean.
          </Text>
        </div>
      </div>
    );
  }

  const cards = files.map((file) => (
    <div
      key={file.file}
      ref={(node) => {
        if (node === null) cardRefs.current.delete(file.file);
        else cardRefs.current.set(file.file, node);
      }}
      {...stylex.props(styles.cardWrap)}
    >
      <WorkbenchChangesCard
        file={file}
        patch={snapshot.diffs.get(file.file)?.patch}
        patchPending={diffsPending}
        diffStyle={diffStyle}
        theme={theme}
        isExpanded={expanded.has(file.file)}
        onToggleExpand={() => {
          toggleExpand(file.file);
        }}
        isViewed={viewed.isViewed(file.file)}
        onToggleViewed={() => {
          viewed.toggleViewed(file.file);
        }}
      />
    </div>
  ));

  return (
    <div {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.toolbar)}>
        <span {...stylex.props(styles.branch)}>
          <Icon icon={IconBranch} size="sm" tone="faint" />
          <span {...stylex.props(styles.branchLabel)}>{branchLabel}</span>
        </span>
        <span {...stylex.props(styles.meta)}>
          {files.length} {files.length === 1 ? "file" : "files"}
        </span>
        <span {...stylex.props(styles.meta)} title="Files marked viewed">
          <Icon icon={IconEyeOpen} size="xs" tone="faint" />
          {viewed.viewedCount}/{files.length}
        </span>
        <Menu.Root>
          <Menu.Trigger
            render={
              <IconButton type="button" aria-label="Editor options" size="sm" variant="quiet">
                <Icon icon={IconDotGrid1x3Horizontal} size="sm" />
              </IconButton>
            }
          />
          <Menu.Popup side="bottom" align="end">
            <Menu.Group>
              <Menu.GroupLabel>Layout</Menu.GroupLabel>
              <Menu.Item
                onClick={() => {
                  setDiffStyle("unified");
                }}
              >
                <span {...stylex.props(styles.menuCheck)}>
                  {diffStyle === "unified" ? <Icon icon={IconCheckmark1} size="sm" /> : null}
                </span>
                <span {...stylex.props(styles.menuLabel)}>Unified</span>
              </Menu.Item>
              <Menu.Item
                onClick={() => {
                  setDiffStyle("split");
                }}
              >
                <span {...stylex.props(styles.menuCheck)}>
                  {diffStyle === "split" ? <Icon icon={IconCheckmark1} size="sm" /> : null}
                </span>
                <span {...stylex.props(styles.menuLabel)}>Split</span>
              </Menu.Item>
            </Menu.Group>
            <Menu.Separator />
            <Menu.Item onClick={expandAll}>
              <span {...stylex.props(styles.menuCheck)} />
              <span {...stylex.props(styles.menuLabel)}>Expand all</span>
            </Menu.Item>
            <Menu.Item onClick={collapseAll}>
              <span {...stylex.props(styles.menuCheck)} />
              <span {...stylex.props(styles.menuLabel)}>Collapse all</span>
            </Menu.Item>
            <Menu.Separator />
            <Menu.Item onClick={resource.refresh}>
              <span {...stylex.props(styles.menuCheck)}>
                <Icon icon={IconArrowRotateClockwise} size="sm" tone="muted" />
              </span>
              <span {...stylex.props(styles.menuLabel)}>Refresh</span>
            </Menu.Item>
          </Menu.Popup>
        </Menu.Root>
      </div>
      {variant === "full" ? (
        <div {...stylex.props(styles.body)}>
          <div data-honk-scrollport="" {...stylex.props(styles.treeColumn)}>
            <WorkbenchChangesFileTree
              files={files}
              selectedPath={selectedPath}
              onSelect={selectFile}
            />
          </div>
          <div data-honk-scrollport="" {...stylex.props(styles.cardList)}>
            {cards}
          </div>
        </div>
      ) : (
        <div data-honk-scrollport="" {...stylex.props(styles.cardList)}>
          {cards}
        </div>
      )}
    </div>
  );
}

export { WorkbenchChanges, createChangesResource, fileStatusGlyph, useWorkbenchChangesSnapshot };
export type { ChangesResource, ChangesSnapshot };
