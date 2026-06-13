import { normalizePathSeparators } from "@honk/shared/paths";

/**
 * Cursor parity: the staircase shows at most the last 4 ancestor directories
 * plus the leaf; anything deeper collapses into a single dim header row.
 */
const PREVIEW_STAIRCASE_MAX_ANCESTORS = 4;

export type PathStaircase = {
  /**
   * Joined directories dropped from the staircase (the dim header row text),
   * or null when nothing was collapsed.
   */
  collapsedPrefix: string | null;
  /**
   * Tree input path: at most the last 4 ancestor directories plus the leaf.
   * Directory leaves use pierre's canonical trailing-slash form (`a/b/c/`)
   * so the tree renders them as directories, not files.
   */
  suffixPath: string;
  /** Rendered staircase rows (kept ancestors + leaf); 0 for separator-only input. */
  rowCount: number;
};

/**
 * Splits a cwd-relative path into the preview-panel staircase shape.
 * Input separators are normalized (`\` to `/`) and empty segments dropped.
 */
export function splitPathStaircase(
  relativePath: string,
  kind: "file" | "directory",
): PathStaircase {
  const segments = splitPreviewPathSegments(relativePath);
  const leaf = segments.at(-1);
  if (leaf === undefined) {
    return { collapsedPrefix: null, suffixPath: "", rowCount: 0 };
  }

  const ancestors = segments.slice(0, -1);
  const keptAncestors = ancestors.slice(-PREVIEW_STAIRCASE_MAX_ANCESTORS);
  const droppedAncestors = ancestors.slice(0, ancestors.length - keptAncestors.length);
  const joinedSuffix = [...keptAncestors, leaf].join("/");

  return {
    collapsedPrefix: droppedAncestors.length > 0 ? droppedAncestors.join("/") : null,
    suffixPath: kind === "directory" ? `${joinedSuffix}/` : joinedSuffix,
    rowCount: keptAncestors.length + 1,
  };
}

/**
 * Full ancestor-directory chain of the leaf (`a/b/c` for `a/b/c/d.txt`),
 * or null when the leaf has no parent. Used as the header row tooltip.
 */
export function previewPathFullDirectory(relativePath: string): string | null {
  const segments = splitPreviewPathSegments(relativePath);
  return segments.length > 1 ? segments.slice(0, -1).join("/") : null;
}

function splitPreviewPathSegments(relativePath: string): string[] {
  return normalizePathSeparators(relativePath)
    .split("/")
    .filter((segment) => segment.length > 0);
}
