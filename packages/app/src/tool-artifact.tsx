import {
  getFiletypeFromFileName,
  parsePatchFiles,
  preloadHighlighter,
  trimPatchContext,
  type FileDiffMetadata,
} from "@pierre/diffs";
import { File, FileDiff } from "@pierre/diffs/react";
import * as stylex from "@stylexjs/stylex";
import {
  colorVars,
  conversationVars,
  fontVars,
  radiusVars,
  spaceVars,
} from "@honk/ui/tokens.stylex";
import * as React from "react";

import { useAppSettings } from "./app-settings-store";
import { useAppearanceTheme, type ThemePreference } from "./appearance-store";
import type { ToolArtifact, ToolSourceArtifact } from "./tool-artifact-normalizer";
import vendorStyles from "./tool-artifact.module.css";
import { TOOL_DIFF_THEME_NAMES } from "./tool-artifact-theme";

type RenderableToolPatch =
  | { readonly kind: "files"; readonly files: readonly FileDiffMetadata[] }
  | { readonly kind: "raw"; readonly text: string; readonly reason: string };

type ToolArtifactHighlighterStatus = "loading" | "ready" | "failed";

type ToolArtifactHighlighterResource = {
  status: ToolArtifactHighlighterStatus;
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => ToolArtifactHighlighterStatus;
};

// Cursor's collapsed edit card reveals roughly four code rows before disclosure.
const COLLAPSED_ARTIFACT_MAX_HEIGHT = "80px";
const COLLAPSED_DIFF_PREVIEW_LINES = 4;
const COLLAPSED_DIFF_CONTEXT_LINES = 1;
const EXPANDED_DIFF_CONTEXT_LINES = 3;
const ARTIFACT_RING_WIDTH = "1px";
const ARTIFACT_RING = `inset 0 0 0 ${ARTIFACT_RING_WIDTH} ${colorVars["--honk-color-border-muted"]}`;
const toolArtifactHighlighterResources = new Map<string, ToolArtifactHighlighterResource>();

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
    overflow: "hidden",
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: colorVars["--honk-color-layer-01"],
    color: colorVars["--honk-color-fg"],
    boxShadow: ARTIFACT_RING,
    fontFamily: fontVars["--honk-font-family-mono"],
    fontSize: fontVars["--honk-font-size-code"],
    lineHeight: fontVars["--honk-leading-code"],
  },
  collapsed: {
    maxHeight: COLLAPSED_ARTIFACT_MAX_HEIGHT,
    overflow: "hidden",
  },
  raw: {
    margin: 0,
    padding: spaceVars["--honk-space-panel-pad"],
    color: colorVars["--honk-color-fg"],
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
      <div {...stylex.props(styles.frame, !isExpanded && styles.collapsed)}>
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
  const appSettings = useAppSettings();
  const appearance = useAppearanceTheme();
  if (artifact.kind === "source") {
    return (
      <HighlightedToolSource
        artifact={artifact}
        appearance={appearance}
        isExpanded={isExpanded}
        wordWrap={appSettings.diffWordWrap}
      />
    );
  }
  const renderable = getRenderableToolPatch(
    artifact.files.map((file) => file.patch),
    isExpanded ? EXPANDED_DIFF_CONTEXT_LINES : COLLAPSED_DIFF_CONTEXT_LINES,
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
    <HighlightedToolFiles
      appearance={appearance}
      files={renderable.files}
      wordWrap={appSettings.diffWordWrap}
    />
  );
}

function HighlightedToolSource({
  artifact,
  appearance,
  isExpanded,
  wordWrap,
}: {
  readonly artifact: ToolSourceArtifact;
  readonly appearance: ThemePreference;
  readonly isExpanded: boolean;
  readonly wordWrap: boolean;
}): React.ReactElement | null {
  const contents = isExpanded
    ? artifact.contents
    : artifact.contents.split("\n").slice(0, COLLAPSED_DIFF_PREVIEW_LINES).join("\n");
  const highlighterStatus = useToolArtifactHighlighter([artifact.path]);
  if (highlighterStatus === "loading") return null;

  return (
    <div data-pierre-tool-source="">
      <File
        file={{ name: artifact.path, contents, cacheKey: patchCacheKey(contents) }}
        options={{
          theme: TOOL_DIFF_THEME_NAMES,
          themeType: appearance,
          unsafeCSS: PIERRE_UNSAFE_CSS,
          overflow: wordWrap ? "wrap" : "scroll",
          disableFileHeader: true,
          disableLineNumbers: true,
          preferredHighlighter: "shiki-js",
        }}
        className={vendorStyles.pierre ?? ""}
      />
    </div>
  );
}

function HighlightedToolFiles({
  appearance,
  files,
  wordWrap,
}: {
  readonly appearance: ThemePreference;
  readonly files: readonly FileDiffMetadata[];
  readonly wordWrap: boolean;
}): React.ReactElement | null {
  // Pierre paints plaintext while a new Shiki grammar loads. Delay its mount so the first visible
  // frame already has the grammar and both appearance themes attached.
  const highlighterStatus = useToolArtifactHighlighter(
    files.flatMap((file) => [file.name, ...(file.prevName === undefined ? [] : [file.prevName])]),
  );
  if (highlighterStatus === "loading") return null;

  return (
    <div data-pierre-tool-diff="">
      {files.map((file) => (
        <FileDiff
          key={fileDiffKey(file)}
          fileDiff={file}
          options={{
            theme: TOOL_DIFF_THEME_NAMES,
            themeType: appearance,
            unsafeCSS: PIERRE_UNSAFE_CSS,
            diffStyle: "unified",
            overflow: wordWrap ? "wrap" : "scroll",
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

function useToolArtifactHighlighter(fileNames: readonly string[]): ToolArtifactHighlighterStatus {
  const languages = [
    ...new Set(fileNames.map((fileName) => getFiletypeFromFileName(fileName))),
  ].sort();
  const key = languages.join(":");
  const resource =
    typeof window === "undefined"
      ? serverHighlighterResource
      : getToolArtifactHighlighterResource(key, languages);
  return React.useSyncExternalStore(resource.subscribe, resource.getSnapshot, () => "ready");
}

const serverHighlighterResource: ToolArtifactHighlighterResource = {
  status: "ready",
  subscribe: () => () => undefined,
  getSnapshot: () => "ready",
};

function getToolArtifactHighlighterResource(
  key: string,
  languages: readonly string[],
): ToolArtifactHighlighterResource {
  const cached = toolArtifactHighlighterResources.get(key);
  if (cached !== undefined) return cached;
  const resource = createHighlighterResource(languages);
  toolArtifactHighlighterResources.set(key, resource);
  return resource;
}

function createHighlighterResource(languages: readonly string[]): ToolArtifactHighlighterResource {
  const listeners = new Set<() => void>();
  const resource: ToolArtifactHighlighterResource = {
    status: "loading",
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => resource.status,
  };
  void preloadHighlighter({
    themes: [TOOL_DIFF_THEME_NAMES.light, TOOL_DIFF_THEME_NAMES.dark],
    langs: [...languages],
    preferredHighlighter: "shiki-js",
  }).then(
    () => {
      resource.status = "ready";
      listeners.forEach((listener) => {
        listener();
      });
    },
    (error: unknown) => {
      console.error(error);
      resource.status = "failed";
      listeners.forEach((listener) => {
        listener();
      });
    },
  );
  return resource;
}

function ArtifactPlaceholder({ title }: { readonly title: string }): React.ReactElement {
  return <div {...stylex.props(styles.placeholder)}>{title}</div>;
}

function getRenderableToolPatch(
  patches: readonly string[],
  contextLines?: number,
): RenderableToolPatch | null {
  const normalized = patches.flatMap((patch) => {
    const trimmed = patch.trim();
    return trimmed.length === 0 ? [] : [trimmed];
  });
  if (normalized.length === 0) {
    return null;
  }
  const raw = normalized.join("\n");

  try {
    const files = normalized.flatMap((patch) => {
      const prepared =
        contextLines === undefined ? patch : trimPatchContext(patch, contextLines);
      return parsePatchFiles(prepared, patchCacheKey(prepared), true).flatMap(
        (parsed) => parsed.files,
      );
    });
    return files.length > 0
      ? { kind: "files", files }
      : {
          kind: "raw",
          text: raw,
          reason: "Unsupported diff format. Showing raw patch.",
        };
  } catch {
    return { kind: "raw", text: raw, reason: "Failed to parse diff. Showing raw patch." };
  }
}

function toolArtifactCanExpand(artifact: ToolArtifact): boolean {
  if (artifact.kind === "source") {
    return artifact.contents.split("\n").length > COLLAPSED_DIFF_PREVIEW_LINES;
  }
  const renderable = getRenderableToolPatch(
    artifact.files.map((file) => file.patch),
    EXPANDED_DIFF_CONTEXT_LINES,
  );
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

export { getRenderableToolPatch, toolArtifactCanExpand, ToolArtifactPreview };
export type { RenderableToolPatch };
