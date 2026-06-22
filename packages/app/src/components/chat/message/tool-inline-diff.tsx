import { parsePatchFiles } from "@pierre/diffs";
import { FileDiff, type FileDiffMetadata } from "@pierre/diffs/react";
import { Data, Effect, Option } from "effect";
import type { ToolDiffArtifact } from "../../../session-logic";
import { useTheme } from "../../../hooks/use-theme";
import {
  buildPatchCacheKey,
  resolveDiffThemeName,
  WORKBENCH_CODE_UNSAFE_CSS,
} from "../../../lib/diff-rendering";
import { cn } from "../../../lib/utils";

type RenderableToolPatch =
  | {
      kind: "files";
      files: FileDiffMetadata[];
    }
  | {
      kind: "raw";
      text: string;
      reason: string;
    }
  | {
      kind: "large";
      summary: string;
      metrics: ToolPatchMetrics;
    };

interface InlineToolDiffProps {
  artifact: ToolDiffArtifact;
  resolvedTheme?: "light" | "dark";
}

class InlineToolPatchParseError extends Data.TaggedError("InlineToolPatchParseError")<{
  cause: unknown;
}> {}

interface ToolPatchMetrics {
  readonly characters: number;
  readonly lines: number;
}

const INLINE_TOOL_DIFF_MAX_RENDER_CHARS = 80_000;
const INLINE_TOOL_DIFF_MAX_RENDER_LINES = 600;
const INLINE_TOOL_DIFF_MAX_HIGHLIGHT_CHARS = 40_000;
const INLINE_TOOL_DIFF_MAX_HIGHLIGHT_LINE_CHARS = 2_000;

export function InlineToolDiff({
  artifact,
  resolvedTheme: resolvedThemeOverride,
}: InlineToolDiffProps) {
  const { resolvedTheme: hookResolvedTheme } = useTheme();
  const resolvedTheme = resolvedThemeOverride ?? hookResolvedTheme;
  const diffTheme = resolveDiffThemeName(resolvedTheme);
  const renderablePatch = getRenderableToolPatch(artifact.unifiedDiff);

  if (!renderablePatch) {
    return null;
  }

  if (renderablePatch.kind === "large") {
    return <LargeToolDiffPlaceholder artifact={artifact} renderablePatch={renderablePatch} />;
  }

  if (renderablePatch.kind === "raw") {
    return (
      <div className="space-y-1">
        <p className="m-0 text-detail text-honk-fg-tertiary">{renderablePatch.reason}</p>
        <pre className="m-0 max-h-[38rem] overflow-auto whitespace-pre-wrap p-0 wrap-anywhere">
          {renderablePatch.text}
        </pre>
      </div>
    );
  }

  return (
    <div className="web-component min-w-0" data-diffs-container>
      {renderablePatch.files.map((fileDiff) => (
        <div key={`${buildFileDiffKey(fileDiff)}:${resolvedTheme}`} className="min-w-0 first:mt-0">
          <FileDiff
            fileDiff={fileDiff}
            options={{
              theme: diffTheme,
              themeType: resolvedTheme,
              unsafeCSS: WORKBENCH_CODE_UNSAFE_CSS,
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
              tokenizeMaxLength: INLINE_TOOL_DIFF_MAX_HIGHLIGHT_CHARS,
              tokenizeMaxLineLength: INLINE_TOOL_DIFF_MAX_HIGHLIGHT_LINE_CHARS,
            }}
            className={cn(renderablePatch.files.length > 1 && "mb-2 last:mb-0")}
          />
        </div>
      ))}
    </div>
  );
}

function getRenderableToolPatch(patch: string): RenderableToolPatch | null {
  const normalizedPatch = patch.trim();
  if (normalizedPatch.length === 0) {
    return null;
  }

  const metrics = measureToolPatch(normalizedPatch);
  if (
    metrics.characters > INLINE_TOOL_DIFF_MAX_RENDER_CHARS ||
    metrics.lines > INLINE_TOOL_DIFF_MAX_RENDER_LINES
  ) {
    return {
      kind: "large",
      metrics,
      summary: "Large diff hidden in chat to keep this thread responsive.",
    };
  }

  const parsedPatches = Option.getOrNull(
    Effect.runSync(
      Effect.try({
        try: () =>
          parsePatchFiles(
            normalizedPatch,
            buildPatchCacheKey(normalizedPatch, "tool-call-inline-diff"),
            true,
          ),
        catch: (cause) => new InlineToolPatchParseError({ cause }),
      }).pipe(Effect.option),
    ),
  );

  if (parsedPatches) {
    const files = parsedPatches.flatMap((parsedPatch) => parsedPatch.files);
    if (files.length > 0) {
      return { kind: "files", files };
    }
    return {
      kind: "raw",
      text: normalizedPatch,
      reason: "Unsupported diff format. Showing raw patch.",
    };
  }

  return {
    kind: "raw",
    text: normalizedPatch,
    reason: "Failed to parse patch. Showing raw patch.",
  };
}

function buildFileDiffKey(fileDiff: FileDiffMetadata): string {
  return `${fileDiff.prevName ?? ""}:${fileDiff.name}:${fileDiff.unifiedLineCount}:${fileDiff.splitLineCount}`;
}

function measureToolPatch(patch: string): ToolPatchMetrics {
  let lines = patch.length === 0 ? 0 : 1;
  for (let index = 0; index < patch.length; index += 1) {
    if (patch.charCodeAt(index) === 10) {
      lines += 1;
    }
  }
  return { characters: patch.length, lines };
}

function LargeToolDiffPlaceholder({
  artifact,
  renderablePatch,
}: {
  artifact: ToolDiffArtifact;
  renderablePatch: Extract<RenderableToolPatch, { kind: "large" }>;
}) {
  const filesLabel = formatDiffFileCount(artifact.files.length);
  const changeLabel = formatDiffChangeCount(artifact);
  const metricsLabel = `${renderablePatch.metrics.lines.toLocaleString()} lines`;

  return (
    <div className="flex min-w-0 flex-col gap-1 px-(--conversation-tool-card-padding-x) py-1.5 text-honk-fg-tertiary">
      <p className="m-0 font-sans text-conversation text-honk-fg-secondary">
        {renderablePatch.summary}
      </p>
      <p className="m-0 font-sans text-detail">
        {[filesLabel, changeLabel, metricsLabel].filter(Boolean).join(" · ")}
      </p>
    </div>
  );
}

function formatDiffFileCount(count: number): string {
  if (count <= 0) {
    return "diff artifact";
  }
  return `${count.toLocaleString()} ${count === 1 ? "file" : "files"}`;
}

function formatDiffChangeCount(artifact: ToolDiffArtifact): string | null {
  const additions = artifact.files.reduce((total, file) => total + (file.additions ?? 0), 0);
  const deletions = artifact.files.reduce((total, file) => total + (file.deletions ?? 0), 0);
  if (additions === 0 && deletions === 0) {
    return null;
  }
  const parts: string[] = [];
  if (additions > 0) {
    parts.push(`+${additions.toLocaleString()}`);
  }
  if (deletions > 0) {
    parts.push(`-${deletions.toLocaleString()}`);
  }
  return parts.join(" / ");
}
