import * as stylex from "@stylexjs/stylex";
import type { OpenCodeVcsFileStatus } from "@honk/opencode";
import { Icon, Text } from "@honk/ui";
import { IconChevronDownMedium, IconChevronRightMedium, IconFolder1, IconFolderOpen } from "@honk/ui/icons";
import { colorVars, controlVars, fontVars, radiusVars, spaceVars } from "@honk/ui/tokens.stylex";
import { basename, normalizePathSeparators } from "@honk/shared/paths";
import * as React from "react";

// The upstream port drove @pierre/trees through a local Tree/useTreeModel wrapper
// plus Tailwind. Both are gone under the StyleX-only seam, and @pierre/trees renders
// its own preact DOM that StyleX cannot reach, so this is a first-party folder-grouped
// collapsible tree over the same OpenCodeVcsFileStatus rows.

type FileNode = {
  readonly kind: "file";
  readonly name: string;
  readonly file: OpenCodeVcsFileStatus;
};

type DirNode = {
  readonly kind: "dir";
  readonly name: string;
  readonly path: string;
  readonly dirs: Map<string, DirNode>;
  readonly files: FileNode[];
};

type TreeNode = FileNode | DirNode;

function createDir(name: string, path: string): DirNode {
  return { kind: "dir", name, path, dirs: new Map(), files: [] };
}

function buildTree(files: readonly OpenCodeVcsFileStatus[]): DirNode {
  const root = createDir("", "");
  for (const file of files) {
    const normalized = normalizePathSeparators(file.file);
    const segments = normalized.split("/").filter((segment) => segment.length > 0);
    if (segments.length === 0) continue;
    const name = segments.at(-1) ?? normalized;
    let dir = root;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index] ?? "";
      const childPath = dir.path === "" ? segment : `${dir.path}/${segment}`;
      let child = dir.dirs.get(segment);
      if (child === undefined) {
        child = createDir(segment, childPath);
        dir.dirs.set(segment, child);
      }
      dir = child;
    }
    dir.files.push({ kind: "file", name, file });
  }
  return root;
}

function sortedChildren(dir: DirNode): readonly TreeNode[] {
  const dirs = [...dir.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
  const leaves = [...dir.files].sort((a, b) => a.name.localeCompare(b.name));
  return [...dirs, ...leaves];
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

const styles = stylex.create({
  root: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
    padding: spaceVars["--honk-space-gutter"],
    fontFamily: fontVars["--honk-font-family-ui"],
  },
  row: {
    appearance: "none",
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    width: "100%",
    minWidth: 0,
    minHeight: controlVars["--honk-control-h-sm"],
    paddingInlineEnd: spaceVars["--honk-space-gutter"],
    paddingBlock: 0,
    borderStyle: "none",
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-state-hover"] },
      ":active": colorVars["--honk-color-state-press"],
    },
    textAlign: "start",
    cursor: "pointer",
    userSelect: "none",
    outlineColor: colorVars["--honk-color-accent"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: controlVars["--honk-control-focus-ring-width"],
    outlineOffset: controlVars["--honk-control-focus-ring-offset"],
  },
  rowSelected: {
    backgroundColor: {
      default: colorVars["--honk-color-control-selected"],
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-control-selected"] },
    },
  },
  indent: (depth: number) => ({
    // oxlint-disable-next-line honk/design-no-raw-values -- 14px per-depth tree indent step is fixed geometry, no spacing token owns it
    paddingInlineStart: `calc(${spaceVars["--honk-space-gutter"]} + ${depth} * 14px)`,
  }),
  disclosure: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    color: colorVars["--honk-color-text-faint"],
  },
  glyphSlot: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    minWidth: "14px",
    fontFamily: fontVars["--honk-font-family-mono"],
    fontSize: fontVars["--honk-font-size-caption"],
    lineHeight: 1,
  },
  name: {
    flexGrow: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: colorVars["--honk-color-text-primary"],
    fontSize: fontVars["--honk-font-size-detail"],
    lineHeight: fontVars["--honk-leading-detail"],
  },
  dirName: {
    color: colorVars["--honk-color-text-muted"],
    fontWeight: fontVars["--honk-font-weight-regular"],
  },
  fileName: {
    fontFamily: fontVars["--honk-font-family-mono"],
    fontSize: fontVars["--honk-font-size-caption"],
  },
  stats: {
    display: "inline-flex",
    flexShrink: 0,
    gap: spaceVars["--honk-space-gutter"],
    fontFamily: fontVars["--honk-font-family-mono"],
    fontSize: fontVars["--honk-font-size-caption"],
    fontVariantNumeric: "tabular-nums",
  },
  additions: {
    color: colorVars["--honk-color-diff-addition"],
  },
  deletions: {
    color: colorVars["--honk-color-diff-deletion"],
  },
  modified: {
    color: colorVars["--honk-color-text-faint"],
  },
});

function FileRow({
  node,
  depth,
  isSelected,
  onSelect,
}: {
  readonly node: FileNode;
  readonly depth: number;
  readonly isSelected: boolean;
  readonly onSelect: (path: string) => void;
}): React.ReactElement {
  const { file } = node;
  return (
    <button
      type="button"
      data-canonical-control-exception="Git file-tree row: custom disclosure + selection composite; no @honk/ui tree primitive exists."
      aria-current={isSelected ? "true" : undefined}
      {...stylex.props(styles.row, styles.indent(depth), isSelected && styles.rowSelected)}
      onClick={() => {
        onSelect(file.file);
      }}
    >
      <span
        aria-label={file.status}
        title={file.status}
        {...stylex.props(
          styles.glyphSlot,
          file.status === "added" && styles.additions,
          file.status === "deleted" && styles.deletions,
          file.status === "modified" && styles.modified,
        )}
      >
        {fileStatusGlyph(file.status)}
      </span>
      <span {...stylex.props(styles.name, styles.fileName)}>{basename(node.name)}</span>
      <span {...stylex.props(styles.stats)}>
        {file.additions > 0 ? (
          <span {...stylex.props(styles.additions)}>+{file.additions}</span>
        ) : null}
        {file.deletions > 0 ? (
          <span {...stylex.props(styles.deletions)}>-{file.deletions}</span>
        ) : null}
      </span>
    </button>
  );
}

function DirRow({
  node,
  depth,
  isExpanded,
  onToggle,
}: {
  readonly node: DirNode;
  readonly depth: number;
  readonly isExpanded: boolean;
  readonly onToggle: (path: string) => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      data-canonical-control-exception="Git file-tree folder row: custom disclosure composite; no @honk/ui tree primitive exists."
      aria-expanded={isExpanded}
      {...stylex.props(styles.row, styles.indent(depth))}
      onClick={() => {
        onToggle(node.path);
      }}
    >
      <span {...stylex.props(styles.disclosure)}>
        <Icon icon={isExpanded ? IconChevronDownMedium : IconChevronRightMedium} size="sm" tone="faint" />
      </span>
      <span {...stylex.props(styles.glyphSlot)}>
        <Icon icon={isExpanded ? IconFolderOpen : IconFolder1} size="sm" tone="muted" />
      </span>
      <span {...stylex.props(styles.name, styles.dirName)}>{node.name}</span>
    </button>
  );
}

function renderNodes(
  nodes: readonly TreeNode[],
  depth: number,
  collapsed: ReadonlySet<string>,
  selectedPath: string | null,
  onSelect: (path: string) => void,
  onToggle: (path: string) => void,
): readonly React.ReactElement[] {
  const rows: React.ReactElement[] = [];
  for (const node of nodes) {
    if (node.kind === "file") {
      rows.push(
        <FileRow
          key={`f:${node.file.file}`}
          node={node}
          depth={depth}
          isSelected={selectedPath === node.file.file}
          onSelect={onSelect}
        />,
      );
      continue;
    }
    const isExpanded = !collapsed.has(node.path);
    rows.push(
      <DirRow
        key={`d:${node.path}`}
        node={node}
        depth={depth}
        isExpanded={isExpanded}
        onToggle={onToggle}
      />,
    );
    if (isExpanded) {
      rows.push(
        ...renderNodes(sortedChildren(node), depth + 1, collapsed, selectedPath, onSelect, onToggle),
      );
    }
  }
  return rows;
}

function WorkbenchChangesFileTree({
  files,
  selectedPath,
  onSelect,
}: {
  readonly files: readonly OpenCodeVcsFileStatus[];
  readonly selectedPath: string | null;
  readonly onSelect: (path: string) => void;
}): React.ReactElement {
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(() => new Set());

  const toggle = (path: string): void => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const roots = sortedChildren(buildTree(files));

  return (
    <div data-honk-scrollport="" {...stylex.props(styles.root)}>
      {roots.length === 0 ? (
        <Text as="p" size="xs" tone="faint">
          No changed files.
        </Text>
      ) : (
        renderNodes(roots, 0, collapsed, selectedPath, onSelect, toggle)
      )}
    </div>
  );
}

export { WorkbenchChangesFileTree };
