import type { EnvironmentId } from "@multi/contracts";
import type { FileContents } from "@pierre/diffs";
import { File, type FileOptions } from "@pierre/diffs/react";
import { useQuery } from "@tanstack/react-query";

import { WORKBENCH_CODE_UNSAFE_CSS, resolveDiffThemeName } from "~/lib/diff-rendering";
import { formatProjectErrorDescription } from "~/lib/project-error-description";
import { projectReadFileQueryOptions } from "~/lib/project-react-query";
import { useTheme } from "~/hooks/use-theme";
import { EmptyFilePreview } from "./empty-file-preview";

export function SourcePreview(props: {
  cwd: string | null;
  environmentId: EnvironmentId | null;
  selectedPath: string | null;
  wordWrap: boolean;
  active: boolean;
}) {
  const { resolvedTheme } = useTheme();
  const fileQuery = useQuery(
    projectReadFileQueryOptions({
      cwd: props.cwd,
      environmentId: props.environmentId,
      relativePath: props.selectedPath,
      enabled: props.active && Boolean(props.cwd && props.environmentId && props.selectedPath),
    }),
  );
  const fileOptions: FileOptions<undefined> = {
    disableFileHeader: true,
    enableLineSelection: true,
    overflow: props.wordWrap ? "wrap" : "scroll",
    preferredHighlighter: "shiki-js",
    theme: resolveDiffThemeName(resolvedTheme),
    themeType: resolvedTheme,
    unsafeCSS: WORKBENCH_CODE_UNSAFE_CSS,
  };
  const fileContents: FileContents | undefined = fileQuery.data
    ? {
        name: fileQuery.data.relativePath,
        contents: fileQuery.data.contents,
        lang: fileQuery.data.syntax.languageId,
        cacheKey: `${fileQuery.data.relativePath}:${fileQuery.data.sizeBytes}:${fileQuery.data.contents.length}`,
      }
    : undefined;

  if (!props.selectedPath) {
    return <EmptyFilePreview onOpenFile={() => undefined} />;
  }

  if (fileQuery.isPending) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="space-y-2 bg-(--multi-workbench-editor-surface-background) p-3">
          <div className="h-3 w-11/12 animate-pulse rounded bg-muted-foreground/10" />
          <div className="h-3 w-7/12 animate-pulse rounded bg-muted-foreground/10" />
          <div className="h-3 w-10/12 animate-pulse rounded bg-muted-foreground/10" />
        </div>
      </div>
    );
  }

  if (fileQuery.isError || !fileQuery.data) {
    const errorDescription = formatProjectErrorDescription(
      fileQuery.error,
      "The file could not be read.",
    );
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-1 px-4 py-8 text-center">
        <div className="text-body font-medium text-destructive/85">Unable to preview file</div>
        <div className="max-w-72 whitespace-pre-wrap text-detail text-muted-foreground/55">
          {errorDescription}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {fileQuery.data.truncated ? (
        <div className="shrink-0 border-b border-multi-border/30 px-3 py-1.5 text-detail text-muted-foreground/60">
          Showing the first 1 MB of this file.
        </div>
      ) : null}
      {fileContents ? (
        <div
          className="project-file-preview web-component min-h-0 min-w-0 flex-1 overflow-hidden bg-(--multi-workbench-editor-surface-background) text-foreground"
          data-diffs-container
        >
          <File
            key={`${fileQuery.data.relativePath}:${props.wordWrap ? "wrap" : "scroll"}:${resolvedTheme}`}
            file={fileContents}
            options={fileOptions}
            className="project-file-preview-code h-full min-h-0 min-w-0 overflow-auto"
          />
        </div>
      ) : null}
    </div>
  );
}
