import { parsePatchFiles, trimPatchContext, type FileDiffMetadata } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import * as stylex from "@stylexjs/stylex";
import {
  colorVars,
  conversationVars,
  fontVars,
  radiusVars,
  spaceVars,
} from "@honk/ui/tokens.stylex";
import * as React from "react";

import { useAppearanceTheme } from "./appearance-store";
import type { ToolArtifact, ToolSourceArtifact } from "./tool-artifact-normalizer";
import vendorStyles from "./tool-artifact.module.css";
import { TOOL_DIFF_THEME_NAMES } from "./tool-artifact-theme";

type RenderableToolPatch =
  | { readonly kind: "files"; readonly files: readonly FileDiffMetadata[] }
  | { readonly kind: "raw"; readonly text: string; readonly reason: string };

// Cursor's collapsed edit card reveals roughly four code rows before disclosure.
const COLLAPSED_ARTIFACT_MAX_HEIGHT = "80px";
const EXPANDED_ARTIFACT_MAX_HEIGHT = "min(60vh, 480px)";
const COLLAPSED_DIFF_PREVIEW_LINES = 4;
const COLLAPSED_DIFF_CONTEXT_LINES = 1;
const EXPANDED_DIFF_CONTEXT_LINES = 3;
const ARTIFACT_RING_WIDTH = "1px";
const ARTIFACT_RING = `inset 0 0 0 ${ARTIFACT_RING_WIDTH} ${colorVars["--honk-color-border-muted"]}`;

const PIERRE_UNSAFE_CSS = `
  :host {
    min-width: 0;
    max-width: 100%;
    font-family: var(--honk-font-family-mono);
    font-size: var(--honk-font-size-code);
  }

  [data-file],
  [data-diff] {
    min-width: 0;
    max-width: 100%;
  }

  [data-code],
  [data-content],
  [data-gutter] {
    min-width: 0;
  }

  [data-code],
  [data-line] {
    line-height: var(--honk-leading-code);
  }
`;

const styles = stylex.create({
  inset: {
    minWidth: 0,
    maxWidth: "100%",
    paddingInline: conversationVars["--honk-conversation-inset"],
    paddingBlockStart: conversationVars["--honk-conversation-row-gap"],
  },
  frame: {
    minWidth: 0,
    maxWidth: "100%",
    overflow: "auto",
    overscrollBehavior: "contain",
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: colorVars["--honk-color-bg-base"],
    boxShadow: ARTIFACT_RING,
    fontFamily: fontVars["--honk-font-family-mono"],
    fontSize: fontVars["--honk-font-size-code"],
    lineHeight: fontVars["--honk-leading-code"],
  },
  collapsed: {
    maxHeight: COLLAPSED_ARTIFACT_MAX_HEIGHT,
    overflow: "hidden",
  },
  expanded: {
    maxHeight: EXPANDED_ARTIFACT_MAX_HEIGHT,
  },
  raw: {
    margin: 0,
    padding: spaceVars["--honk-space-panel-pad"],
    color: colorVars["--honk-color-fg-tertiary"],
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    userSelect: "text",
  },
  placeholder: {
    padding: spaceVars["--honk-space-panel-pad"],
    color: colorVars["--honk-color-fg-secondary"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-text-detail"],
    lineHeight: fontVars["--honk-leading-detail"],
  },
});

function ToolArtifactPreview({
  artifact,
  isExpanded,
}: {
  readonly artifact: ToolArtifact;
  readonly isExpanded: boolean;
}): React.ReactElement | null {
  return (
    <div
      data-tool-artifact={artifact.kind}
      data-tool-artifact-expanded={isExpanded ? "true" : "false"}
      {...stylex.props(styles.inset)}
    >
      <div {...stylex.props(styles.frame, isExpanded ? styles.expanded : styles.collapsed)}>
        <ToolDiff artifact={artifact} isExpanded={isExpanded} />
      </div>
    </div>
  );
}

function ToolDiff({
  artifact,
  isExpanded,
}: {
  readonly artifact: ToolArtifact;
  readonly isExpanded: boolean;
}): React.ReactElement | null {
  const appearance = useAppearanceTheme();
  const patch =
    artifact.kind === "source" ? sourceArtifactPatch(artifact, isExpanded) : artifact.patch;
  const renderable = getRenderableToolPatch(
    patch,
    artifact.kind === "source"
      ? undefined
      : isExpanded
        ? EXPANDED_DIFF_CONTEXT_LINES
        : COLLAPSED_DIFF_CONTEXT_LINES,
  );
  if (renderable === null) {
    return null;
  }
  if (renderable.kind === "raw") {
    return (
      <div>
        <ArtifactPlaceholder title={renderable.reason} />
        <pre {...stylex.props(styles.raw)}>{renderable.text}</pre>
      </div>
    );
  }
  return (
    <div
      {...(artifact.kind === "source"
        ? { "data-pierre-tool-source": "" }
        : { "data-pierre-tool-diff": "" })}
    >
      {renderable.files.map((file) => (
        <FileDiff
          key={fileDiffKey(file)}
          fileDiff={file}
          options={{
            theme: TOOL_DIFF_THEME_NAMES,
            themeType: appearance,
            unsafeCSS: PIERRE_UNSAFE_CSS,
            diffStyle: "unified",
            overflow: "wrap",
            disableFileHeader: true,
            disableBackground: false,
            disableLineNumbers: false,
            diffIndicators: "none",
            lineDiffType: "none",
            expandUnchanged: false,
            hunkSeparators: "simple",
            preferredHighlighter: "shiki-js",
          }}
          className={vendorStyles.pierre ?? ""}
        />
      ))}
    </div>
  );
}

function ArtifactPlaceholder({ title }: { readonly title: string }): React.ReactElement {
  return <div {...stylex.props(styles.placeholder)}>{title}</div>;
}

function getRenderableToolPatch(patch: string, contextLines?: number): RenderableToolPatch | null {
  const normalized = patch.trim();
  if (normalized.length === 0) {
    return null;
  }
  const prepared =
    contextLines === undefined ? normalized : trimPatchContext(normalized, contextLines);
  const cacheKey = patchCacheKey(prepared);

  try {
    const files = parsePatchFiles(prepared, cacheKey, true).flatMap((parsed) => parsed.files);
    return files.length > 0
      ? { kind: "files", files }
      : {
          kind: "raw",
          text: normalized,
          reason: "Unsupported diff format. Showing raw patch.",
        };
  } catch {
    return { kind: "raw", text: normalized, reason: "Failed to parse diff. Showing raw patch." };
  }
}

function toolArtifactCanExpand(artifact: ToolArtifact): boolean {
  if (artifact.kind === "source") {
    return artifact.contents.split("\n").length > COLLAPSED_DIFF_PREVIEW_LINES;
  }
  const renderable = getRenderableToolPatch(artifact.patch, EXPANDED_DIFF_CONTEXT_LINES);
  if (renderable === null) return false;
  if (renderable.kind === "raw") {
    return renderable.text.split("\n").length > COLLAPSED_DIFF_PREVIEW_LINES;
  }
  const visibleLines = renderable.files.reduce(
    (fileTotal, file) =>
      fileTotal + file.hunks.reduce((hunkTotal, hunk) => hunkTotal + hunk.unifiedLineCount, 0),
    0,
  );
  return visibleLines > COLLAPSED_DIFF_PREVIEW_LINES;
}

function sourceArtifactPatch(artifact: ToolSourceArtifact, isExpanded: boolean): string {
  const lines = artifact.contents.split("\n");
  const visible = isExpanded ? lines : lines.slice(0, COLLAPSED_DIFF_PREVIEW_LINES);
  const count = visible.length;
  return [
    `--- a/${artifact.path}`,
    `+++ b/${artifact.path}`,
    `@@ -${String(artifact.lineStart)},${String(count)} +${String(artifact.lineStart)},${String(count)} @@`,
    ...visible.map((line) => ` ${line}`),
  ].join("\n");
}

function fileDiffKey(file: FileDiffMetadata): string {
  return `${file.prevName ?? ""}:${file.name}:${String(file.unifiedLineCount)}:${String(file.splitLineCount)}`;
}

function patchCacheKey(patch: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < patch.length; index += 1) {
    hash ^= patch.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `tool-artifact:${String(patch.length)}:${hash.toString(36)}`;
}

export { getRenderableToolPatch, sourceArtifactPatch, toolArtifactCanExpand, ToolArtifactPreview };
export type { RenderableToolPatch };
