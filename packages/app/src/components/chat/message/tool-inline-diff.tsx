import { parsePatchFiles } from "@pierre/diffs";
import { FileDiff, type FileDiffMetadata } from "@pierre/diffs/react";
import { Data, Effect, Option } from "effect";
import { memo, useMemo } from "react";
import type { ToolDiffArtifact } from "../../../session-logic";
import { useTheme } from "../../../hooks/use-theme";
import { buildPatchCacheKey, resolveDiffThemeName } from "../../../lib/diff-rendering";
import { PIERRE_WORKBENCH_CODE_UNSAFE_CSS } from "../../../lib/pierre-workbench-code-css";
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
    };

interface InlineToolDiffProps {
  artifact: ToolDiffArtifact;
}

class InlineToolPatchParseError extends Data.TaggedError("InlineToolPatchParseError")<{
  cause: unknown;
}> {}

export const InlineToolDiff = memo(function InlineToolDiff({ artifact }: InlineToolDiffProps) {
  const { resolvedTheme } = useTheme();
  const renderablePatch = useMemo(
    () => getRenderableToolPatch(artifact.unifiedDiff),
    [artifact.unifiedDiff],
  );

  if (!renderablePatch) {
    return null;
  }

  if (renderablePatch.kind === "raw") {
    return (
      <div className="space-y-1">
        <p className="m-0 text-detail/[16px] text-multi-fg-tertiary">{renderablePatch.reason}</p>
        <pre className="m-0 max-h-[38rem] overflow-auto whitespace-pre-wrap p-0 wrap-anywhere">
          {renderablePatch.text}
        </pre>
      </div>
    );
  }

  return (
    <div className="web-component max-h-[42rem] min-w-0 overflow-auto" data-diffs-container>
      {renderablePatch.files.map((fileDiff) => (
        <div key={buildFileDiffKey(fileDiff)} className="min-w-0 first:mt-0">
          <FileDiff
            fileDiff={fileDiff}
            options={{
              theme: resolveDiffThemeName(resolvedTheme),
              themeType: resolvedTheme,
              unsafeCSS: PIERRE_WORKBENCH_CODE_UNSAFE_CSS,
              diffStyle: "unified",
              overflow: "wrap",
              disableFileHeader: renderablePatch.files.length === 1,
              disableBackground: false,
              disableLineNumbers: false,
              diffIndicators: "none",
              lineDiffType: "none",
              expandUnchanged: false,
              hunkSeparators: "simple",
              preferredHighlighter: "shiki-js",
            }}
            className={cn(renderablePatch.files.length > 1 && "mb-2 last:mb-0")}
          />
        </div>
      ))}
    </div>
  );
});

function getRenderableToolPatch(patch: string): RenderableToolPatch | null {
  const normalizedPatch = patch.trim();
  if (normalizedPatch.length === 0) {
    return null;
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
