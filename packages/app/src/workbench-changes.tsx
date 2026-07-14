// The Changes panel — the old git panel's core, rebuilt on the sidecar seams: the change list
// from client.file.status, the branch label from client.vcs.get, per-file unified diffs from
// client.file.read's patch hunks. Read-only by design: discard/stage/commit were old-Core verbs
// with no opencode equivalent — the agent does those through chat.
//
// Refresh model: there is no filesystem event on the sidecar stream, so the panel refetches
// when it mounts, when the thread stops running (the agent just finished touching files), and
// on the explicit refresh affordance. Fetches are seq-guarded; a stale response never lands.

import * as stylex from "@stylexjs/stylex";
import { Button, Spinner, Text } from "@honk/ui";
import { colorVars, controlVars, fontVars, radiusVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as React from "react";

import type { SidecarChange, SidecarDiffHunk } from "./sidecar";
import { getBoundHonkClient } from "./watch-registry";

const ROW_HEIGHT = "26px";
const DIFF_LINE_HEIGHT = "18px";

const styles = stylex.create({
  root: {
    flexGrow: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
  },
  toolbar: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    paddingInline: spaceVars["--honk-space-gutter"],
    paddingBlock: controlVars["--honk-control-gap"],
    minWidth: 0,
  },
  branch: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: colorVars["--honk-color-text-muted"],
    fontFamily: fontVars["--honk-font-family-mono"],
    fontSize: fontVars["--honk-font-size-detail"],
  },
  spacer: { flexGrow: 1 },
  list: {
    flexShrink: 0,
    maxHeight: "40%",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    paddingInline: controlVars["--honk-control-gap"],
    paddingBlockEnd: controlVars["--honk-control-gap"],
  },
  row: {
    flexShrink: 0,
    height: ROW_HEIGHT,
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    paddingInline: controlVars["--honk-control-gap"],
    borderWidth: 0,
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: {
      default: "transparent",
      ":hover": colorVars["--honk-color-state-hover"],
    },
    color: colorVars["--honk-color-text-muted"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-detail"],
    textAlign: "left",
    cursor: "default",
    minWidth: 0,
  },
  rowSelected: {
    backgroundColor: {
      default: colorVars["--honk-color-control"],
      ":hover": colorVars["--honk-color-control"],
    },
    color: colorVars["--honk-color-text-primary"],
  },
  rowPath: {
    minWidth: 0,
    flexGrow: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    direction: "rtl", // tail-truncate: the filename end matters more than the root dirs
    textAlign: "left",
    fontFamily: fontVars["--honk-font-family-mono"],
  },
  kind: {
    flexShrink: 0,
    width: "12px",
    textAlign: "center",
    fontFamily: fontVars["--honk-font-family-mono"],
    fontWeight: fontVars["--honk-font-weight-semibold"],
  },
  kindAdded: { color: colorVars["--honk-color-diff-addition"] },
  kindDeleted: { color: colorVars["--honk-color-diff-deletion"] },
  kindModified: { color: colorVars["--honk-color-warn-fg"] },
  stats: {
    flexShrink: 0,
    display: "inline-flex",
    gap: controlVars["--honk-control-gap"],
    fontVariantNumeric: "tabular-nums",
    fontFamily: fontVars["--honk-font-family-mono"],
    fontSize: fontVars["--honk-font-size-caption"],
  },
  added: { color: colorVars["--honk-color-diff-addition"] },
  removed: { color: colorVars["--honk-color-diff-deletion"] },
  diff: {
    flexGrow: 1,
    minHeight: 0,
    overflow: "auto",
    borderBlockStartWidth: "1px",
    borderBlockStartStyle: "solid",
    borderBlockStartColor: colorVars["--honk-color-border-muted"],
    paddingBlock: controlVars["--honk-control-gap"],
  },
  hunkHeader: {
    paddingInline: spaceVars["--honk-space-gutter"],
    paddingBlock: "2px",
    color: colorVars["--honk-color-text-faint"],
    fontFamily: fontVars["--honk-font-family-mono"],
    fontSize: fontVars["--honk-font-size-caption"],
    backgroundColor: colorVars["--honk-color-layer-01"],
  },
  diffLine: {
    display: "block",
    paddingInline: spaceVars["--honk-space-gutter"],
    margin: 0,
    fontFamily: fontVars["--honk-font-family-mono"],
    fontSize: fontVars["--honk-font-size-detail"],
    lineHeight: DIFF_LINE_HEIGHT,
    whiteSpace: "pre",
    color: colorVars["--honk-color-fg-secondary"],
  },
  lineAdded: {
    color: colorVars["--honk-color-diff-addition"],
    backgroundColor: colorVars["--honk-color-ok-bg"],
  },
  lineRemoved: {
    color: colorVars["--honk-color-diff-deletion"],
    backgroundColor: colorVars["--honk-color-err-bg"],
  },
  center: {
    flexGrow: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: controlVars["--honk-control-gap"],
    padding: spaceVars["--honk-space-panel-pad"],
    textAlign: "center",
  },
});

type ChangesFetch =
  | { readonly phase: "loading" }
  | { readonly phase: "error"; readonly message: string }
  | {
      readonly phase: "ready";
      readonly branch: string | null;
      readonly changes: readonly SidecarChange[];
    };

type ChangesResource = {
  readonly getSnapshot: () => ChangesFetch;
  readonly subscribe: (listener: () => void) => () => void;
  readonly ensureRequested: () => void;
  readonly observeThreadRunning: (isRunning: boolean) => void;
  readonly refresh: () => void;
};

const changesResources = new Map<string, ChangesResource>();

function createChangesResource(directory: string): ChangesResource {
  let snapshot: ChangesFetch = { phase: "loading" };
  let requested = false;
  let inFlight = false;
  let refreshQueued = false;
  let sequence = 0;
  let lastThreadRunning: boolean | undefined;
  const listeners = new Set<() => void>();

  const publish = (next: ChangesFetch): void => {
    snapshot = next;
    for (const listener of listeners) {
      listener();
    }
  };

  const refresh = (): void => {
    requested = true;
    if (inFlight) {
      refreshQueued = true;
      return;
    }

    const client = getBoundHonkClient();
    if (client === null) {
      publish({ phase: "error", message: "Not connected." });
      return;
    }

    inFlight = true;
    const currentSequence = ++sequence;
    void Promise.all([client.fileStatus(directory), client.vcsBranch(directory)])
      .then(([changes, branch]) => {
        if (sequence !== currentSequence) {
          return;
        }
        publish({ phase: "ready", branch, changes });
      })
      .catch((error: unknown) => {
        if (sequence !== currentSequence) {
          return;
        }
        publish({
          phase: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        if (sequence === currentSequence) {
          inFlight = false;
          if (refreshQueued) {
            refreshQueued = false;
            refresh();
          }
        }
      });
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    ensureRequested: () => {
      if (!requested) {
        refresh();
      }
    },
    observeThreadRunning: (isRunning) => {
      if (lastThreadRunning === true && !isRunning) {
        refresh();
      }
      lastThreadRunning = isRunning;
    },
    refresh,
  };
}

function changesResourceFor(directory: string): ChangesResource {
  const existing = changesResources.get(directory);
  if (existing !== undefined) {
    return existing;
  }
  const resource = createChangesResource(directory);
  changesResources.set(directory, resource);
  return resource;
}

function useWorkbenchChangesSnapshot(directory: string, isThreadRunning: boolean): ChangesFetch {
  const resource = changesResourceFor(directory);
  const snapshot = React.useSyncExternalStore(
    resource.subscribe,
    resource.getSnapshot,
    resource.getSnapshot,
  );
  resource.ensureRequested();
  resource.observeThreadRunning(isThreadRunning);
  return snapshot;
}

function refreshWorkbenchChanges(directory: string): void {
  changesResourceFor(directory).refresh();
}

type DiffFetch =
  | { readonly phase: "idle" }
  | { readonly phase: "loading"; readonly path: string }
  | { readonly phase: "error"; readonly path: string; readonly message: string }
  | {
      readonly phase: "ready";
      readonly path: string;
      readonly hunks: readonly SidecarDiffHunk[] | null;
      readonly content: string;
      readonly isBinary: boolean;
    };

function WorkbenchChanges({
  directory,
  isThreadRunning,
}: {
  readonly directory: string;
  readonly isThreadRunning: boolean;
}): React.ReactElement {
  const fetch = useWorkbenchChangesSnapshot(directory, isThreadRunning);
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const [diff, setDiff] = React.useState<DiffFetch>({ phase: "idle" });
  const diffSeqRef = React.useRef(0);
  const refresh = (): void => {
    refreshWorkbenchChanges(directory);
  };

  const openDiff = (path: string): void => {
    setSelectedPath(path);
    const client = getBoundHonkClient();
    if (client === null) {
      return;
    }
    const seq = ++diffSeqRef.current;
    setDiff({ phase: "loading", path });
    void client
      .readFile(path, directory)
      .then((file) => {
        if (diffSeqRef.current !== seq) {
          return;
        }
        setDiff({
          phase: "ready",
          path,
          hunks: file.hunks,
          content: file.content,
          isBinary: file.type === "binary",
        });
      })
      .catch((error: unknown) => {
        if (diffSeqRef.current !== seq) {
          return;
        }
        setDiff({
          phase: "error",
          path,
          message: error instanceof Error ? error.message : String(error),
        });
      });
  };

  if (fetch.phase === "loading") {
    return (
      <div {...stylex.props(styles.center)}>
        <Spinner label="Reading changes" tone="muted" />
      </div>
    );
  }

  if (fetch.phase === "error") {
    return (
      <div {...stylex.props(styles.center)}>
        <Text as="p" size="sm" tone="muted">
          {fetch.message}
        </Text>
        <Button size="sm" onClick={refresh}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.toolbar)}>
        {fetch.branch !== null && <span {...stylex.props(styles.branch)}>{fetch.branch}</span>}
        <div {...stylex.props(styles.spacer)} />
        <Button size="sm" variant="ghost" onClick={refresh}>
          Refresh
        </Button>
      </div>
      {fetch.changes.length === 0 ? (
        <div {...stylex.props(styles.center)}>
          <Text as="p" size="sm" tone="muted" weight="medium">
            Working tree clean
          </Text>
        </div>
      ) : (
        <>
          <div {...stylex.props(styles.list)}>
            {fetch.changes.map((change) => (
              <ChangeRow
                key={change.path}
                change={change}
                isSelected={change.path === selectedPath}
                onOpen={openDiff}
              />
            ))}
          </div>
          <DiffView diff={diff} />
        </>
      )}
    </div>
  );
}

function ChangeRow({
  change,
  isSelected,
  onOpen,
}: {
  readonly change: SidecarChange;
  readonly isSelected: boolean;
  readonly onOpen: (path: string) => void;
}): React.ReactElement {
  const kind = change.status === "added" ? "A" : change.status === "deleted" ? "D" : "M";
  const kindStyle =
    change.status === "added"
      ? styles.kindAdded
      : change.status === "deleted"
        ? styles.kindDeleted
        : styles.kindModified;

  return (
    <button
      type="button"
      title={change.path}
      {...stylex.props(styles.row, isSelected && styles.rowSelected)}
      onClick={() => {
        onOpen(change.path);
      }}
    >
      <span {...stylex.props(styles.kind, kindStyle)}>{kind}</span>
      {/* rtl tail-truncation needs the bidi isolate so the path itself still reads ltr */}
      <span {...stylex.props(styles.rowPath)}>&lrm;{change.path}</span>
      <span {...stylex.props(styles.stats)}>
        {change.added > 0 && <span {...stylex.props(styles.added)}>+{change.added}</span>}
        {change.removed > 0 && <span {...stylex.props(styles.removed)}>-{change.removed}</span>}
      </span>
    </button>
  );
}

function DiffView({ diff }: { readonly diff: DiffFetch }): React.ReactElement {
  if (diff.phase === "idle") {
    return (
      <div {...stylex.props(styles.center)}>
        <Text as="p" size="xs" tone="faint">
          Select a file to see its diff.
        </Text>
      </div>
    );
  }
  if (diff.phase === "loading") {
    return (
      <div {...stylex.props(styles.center)}>
        <Spinner label="Reading diff" tone="muted" />
      </div>
    );
  }
  if (diff.phase === "error") {
    return (
      <div {...stylex.props(styles.center)}>
        <Text as="p" size="sm" tone="muted">
          {diff.message}
        </Text>
      </div>
    );
  }
  if (diff.isBinary) {
    return (
      <div {...stylex.props(styles.center)}>
        <Text as="p" size="sm" tone="muted">
          Binary file
        </Text>
      </div>
    );
  }

  // A patch when the working tree has one (modified files); the raw content for added files.
  if (diff.hunks !== null && diff.hunks.length > 0) {
    return (
      <div {...stylex.props(styles.diff)}>
        {diff.hunks.map((hunk) => (
          <React.Fragment
            key={`${String(hunk.oldStart)}:${String(hunk.oldLines)}:${String(hunk.newStart)}:${String(hunk.newLines)}`}
          >
            <div {...stylex.props(styles.hunkHeader)}>
              {`@@ -${String(hunk.oldStart)},${String(hunk.oldLines)} +${String(hunk.newStart)},${String(hunk.newLines)} @@`}
            </div>
            {hunk.lines.map((line, lineIndex) => (
              <span
                key={lineIndex}
                {...stylex.props(
                  styles.diffLine,
                  line.startsWith("+") && styles.lineAdded,
                  line.startsWith("-") && styles.lineRemoved,
                )}
              >
                {line.length > 0 ? line : " "}
              </span>
            ))}
          </React.Fragment>
        ))}
      </div>
    );
  }

  return (
    <div {...stylex.props(styles.diff)}>
      {diff.content.split("\n").map((line, index) => (
        <span key={index} {...stylex.props(styles.diffLine, styles.lineAdded)}>
          {line.length > 0 ? `+${line}` : "+"}
        </span>
      ))}
    </div>
  );
}

export { WorkbenchChanges, useWorkbenchChangesSnapshot };
export type { ChangesFetch };
