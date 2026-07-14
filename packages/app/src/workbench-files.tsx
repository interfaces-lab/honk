// The Files panel — the old project-files panel's read half on the sidecar seams: a lazy
// directory tree from client.file.list and a read-only mono viewer from client.file.read.
// Read-only by design this round: opencode exposes no generic write endpoint, so Save/dirty
// state waits for a desktop fs seam (same round as the terminal's PTY bridge).
//
// Tree model: one flat Map path→listing, fetched on first expand and kept for the panel's
// lifetime (Refresh clears it). Expansion state is a Set of paths. Everything renders from
// those two structures — no per-node components holding fetch state.

import * as stylex from "@stylexjs/stylex";
import { Button, Icon, Spinner, Text } from "@honk/ui";
import { IconChevronRightMedium } from "@honk/ui/icons";
import { colorVars, controlVars, fontVars, radiusVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as React from "react";

import type { SidecarFileNode } from "./sidecar";
import { getBoundHonkClient } from "./watch-registry";

const ROW_HEIGHT = "24px";
const INDENT_PX = 14;
const LINE_HEIGHT = "18px";
const ROOT_PATH = ".";
// A viewer, not an editor — cap what one render swallows.
const VIEWER_MAX_CHARS = 200_000;

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
  openPath: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: colorVars["--honk-color-text-muted"],
    fontFamily: fontVars["--honk-font-family-mono"],
    fontSize: fontVars["--honk-font-size-caption"],
  },
  spacer: { flexGrow: 1 },
  tree: {
    flexShrink: 0,
    maxHeight: "45%",
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
    boxSizing: "border-box",
  },
  rowSelected: {
    backgroundColor: {
      default: colorVars["--honk-color-control"],
      ":hover": colorVars["--honk-color-control"],
    },
    color: colorVars["--honk-color-text-primary"],
  },
  rowIgnored: {
    opacity: 0.55,
  },
  rowName: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  chevron: {
    flexShrink: 0,
    display: "inline-flex",
    width: "12px",
    color: colorVars["--honk-color-icon-tertiary"],
    transitionProperty: "transform",
    transitionDuration: "100ms",
  },
  chevronOpen: {
    transform: "rotate(90deg)",
  },
  chevronSpacer: {
    flexShrink: 0,
    width: "12px",
  },
  viewer: {
    flexGrow: 1,
    minHeight: 0,
    overflow: "auto",
    borderBlockStartWidth: "1px",
    borderBlockStartStyle: "solid",
    borderBlockStartColor: colorVars["--honk-color-border-muted"],
  },
  code: {
    margin: 0,
    padding: spaceVars["--honk-space-gutter"],
    fontFamily: fontVars["--honk-font-family-mono"],
    fontSize: fontVars["--honk-font-size-detail"],
    lineHeight: LINE_HEIGHT,
    color: colorVars["--honk-color-fg-secondary"],
    whiteSpace: "pre",
    tabSize: 2,
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

const dynamic = stylex.create({
  indent: (depth: number) => ({ paddingInlineStart: `${4 + depth * INDENT_PX}px` }),
});

type Listing =
  | { readonly phase: "loading" }
  | { readonly phase: "error"; readonly message: string }
  | { readonly phase: "ready"; readonly nodes: readonly SidecarFileNode[] };

type ViewerState =
  | { readonly phase: "idle" }
  | { readonly phase: "loading"; readonly path: string }
  | { readonly phase: "error"; readonly path: string; readonly message: string }
  | { readonly phase: "ready"; readonly path: string; readonly content: string; readonly isBinary: boolean };

function WorkbenchFiles({ directory }: { readonly directory: string }): React.ReactElement {
  const [listings, setListings] = React.useState<ReadonlyMap<string, Listing>>(new Map());
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(new Set([ROOT_PATH]));
  const [viewer, setViewer] = React.useState<ViewerState>({ phase: "idle" });
  const viewerSeqRef = React.useRef(0);
  const requestedRef = React.useRef<Set<string>>(new Set());

  const fetchListing = React.useCallback(
    (path: string): void => {
      const client = getBoundHonkClient();
      if (client === null) {
        return;
      }
      setListings((current) => new Map(current).set(path, { phase: "loading" }));
      void client
        .listFiles(path, directory)
        .then((nodes) => {
          const sorted = [...nodes].sort(
            (a, b) =>
              Number(b.type === "directory") - Number(a.type === "directory") ||
              a.name.localeCompare(b.name),
          );
          setListings((current) => new Map(current).set(path, { phase: "ready", nodes: sorted }));
        })
        .catch((error: unknown) => {
          setListings((current) =>
            new Map(current).set(path, {
              phase: "error",
              message: error instanceof Error ? error.message : String(error),
            }),
          );
        });
    },
    [directory],
  );

  // First render seeds the root listing (render-time, guarded — no effect).
  if (!requestedRef.current.has(ROOT_PATH)) {
    requestedRef.current.add(ROOT_PATH);
    fetchListing(ROOT_PATH);
  }

  const toggleDirectory = (path: string): void => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
        if (!requestedRef.current.has(path)) {
          requestedRef.current.add(path);
          fetchListing(path);
        }
      }
      return next;
    });
  };

  const openFile = (path: string): void => {
    const client = getBoundHonkClient();
    if (client === null) {
      return;
    }
    const seq = ++viewerSeqRef.current;
    setViewer({ phase: "loading", path });
    void client
      .readFile(path, directory)
      .then((file) => {
        if (viewerSeqRef.current !== seq) {
          return;
        }
        setViewer({
          phase: "ready",
          path,
          content:
            file.content.length > VIEWER_MAX_CHARS
              ? `${file.content.slice(0, VIEWER_MAX_CHARS)}\n… (truncated)`
              : file.content,
          isBinary: file.type === "binary",
        });
      })
      .catch((error: unknown) => {
        if (viewerSeqRef.current !== seq) {
          return;
        }
        setViewer({
          phase: "error",
          path,
          message: error instanceof Error ? error.message : String(error),
        });
      });
  };

  const refresh = (): void => {
    requestedRef.current = new Set([ROOT_PATH]);
    setListings(new Map());
    // Collapse to the root: keeping expansion would strand children on "Loading…" forever,
    // since their listings were dropped but no refetch is scheduled for them.
    setExpanded(new Set([ROOT_PATH]));
    fetchListing(ROOT_PATH);
  };

  // Flatten the visible tree from the two structures.
  const rows: React.ReactNode[] = [];
  const appendListing = (path: string, depth: number): void => {
    const listing = listings.get(path);
    if (listing === undefined || listing.phase === "loading") {
      rows.push(
        <div key={`${path}:loading`} {...stylex.props(styles.row, dynamic.indent(depth))}>
          <span {...stylex.props(styles.chevronSpacer)} />
          <Text as="span" size="xs" tone="faint">
            Loading…
          </Text>
        </div>,
      );
      return;
    }
    if (listing.phase === "error") {
      rows.push(
        <div key={`${path}:error`} {...stylex.props(styles.row, dynamic.indent(depth))}>
          <span {...stylex.props(styles.chevronSpacer)} />
          <Text as="span" size="xs" tone="faint">
            {listing.message}
          </Text>
        </div>,
      );
      return;
    }
    for (const node of listing.nodes) {
      const isOpen = node.type === "directory" && expanded.has(node.path);
      rows.push(
        <button
          key={node.path}
          type="button"
          title={node.path}
          {...stylex.props(
            styles.row,
            dynamic.indent(depth),
            node.ignored && styles.rowIgnored,
            viewer.phase !== "idle" && "path" in viewer && viewer.path === node.path && styles.rowSelected,
          )}
          onClick={() => {
            if (node.type === "directory") {
              toggleDirectory(node.path);
            } else {
              openFile(node.path);
            }
          }}
        >
          {node.type === "directory" ? (
            <span {...stylex.props(styles.chevron, isOpen && styles.chevronOpen)}>
              <Icon icon={IconChevronRightMedium} size="xs" />
            </span>
          ) : (
            <span {...stylex.props(styles.chevronSpacer)} />
          )}
          <span {...stylex.props(styles.rowName)}>{node.name}</span>
        </button>,
      );
      if (isOpen) {
        appendListing(node.path, depth + 1);
      }
    }
  };
  appendListing(ROOT_PATH, 0);

  return (
    <div {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.toolbar)}>
        <span {...stylex.props(styles.openPath)}>
          {viewer.phase === "ready" || viewer.phase === "loading" ? viewer.path : ""}
        </span>
        <div {...stylex.props(styles.spacer)} />
        <Button size="sm" variant="ghost" onClick={refresh}>
          Refresh
        </Button>
      </div>
      <div {...stylex.props(styles.tree)}>{rows}</div>
      <div {...stylex.props(styles.viewer)}>
        {viewer.phase === "idle" ? (
          <div {...stylex.props(styles.center)}>
            <Text as="p" size="xs" tone="faint">
              Select a file to view it.
            </Text>
          </div>
        ) : viewer.phase === "loading" ? (
          <div {...stylex.props(styles.center)}>
            <Spinner label="Reading file" tone="muted" />
          </div>
        ) : viewer.phase === "error" ? (
          <div {...stylex.props(styles.center)}>
            <Text as="p" size="sm" tone="muted">
              {viewer.message}
            </Text>
          </div>
        ) : viewer.isBinary ? (
          <div {...stylex.props(styles.center)}>
            <Text as="p" size="sm" tone="muted">
              Binary file
            </Text>
          </div>
        ) : (
          <pre {...stylex.props(styles.code)}>{viewer.content}</pre>
        )}
      </div>
    </div>
  );
}

export { WorkbenchFiles };
