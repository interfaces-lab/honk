import type { GitFilePatchResult } from "@multi/contracts";
import type { GitFileState } from "~/lib/ui-session-types";
import { PatchDiff } from "@pierre/diffs/react";
import { type ReactNode, useMemo } from "react";

import { resolveDiffThemeName, WORKBENCH_CODE_UNSAFE_CSS } from "~/lib/diff-rendering";
import { cn } from "~/lib/utils";
import { useTheme } from "~/hooks/use-theme";
import {
  GitFileTypeIcon,
  getGitFileTypeDescriptor,
  type GitFileTypeDescriptor,
} from "./git-file-type";

interface Props {
  filePatch?: GitFilePatchResult | null;
  path?: string;
  state?: GitFileState;
  prevPath?: string | null;
  diffStyle?: "unified" | "split";
  className?: string;
  renderCustomHeader?: (() => ReactNode) | undefined;
}

export function DiffViewer(props: Props) {
  const { resolvedTheme } = useTheme();
  const theme = resolveDiffThemeName(resolvedTheme);
  const diffStyle = props.diffStyle ?? "unified";
  const hasCustomHeader = props.renderCustomHeader !== undefined;
  const fileType = getGitFileTypeDescriptor({ path: props.path, patch: props.filePatch });
  const options = useMemo(
    () => ({
      theme,
      themeType: resolvedTheme,
      unsafeCSS: WORKBENCH_CODE_UNSAFE_CSS,
      diffStyle,
      overflow: "wrap" as const,
      disableFileHeader: !hasCustomHeader,
      disableBackground: false,
      disableLineNumbers: false,
      diffIndicators: "none" as const,
      lineDiffType: "none" as const,
      expandUnchanged: false,
      hunkSeparators: "simple" as const,
      preferredHighlighter: "shiki-js" as const,
    }),
    [diffStyle, hasCustomHeader, resolvedTheme, theme],
  );
  const patch =
    props.filePatch?.kind === "patch" || props.filePatch?.kind === "untracked"
      ? props.filePatch.patch.trim()
      : "";
  const renderCustomHeader = props.renderCustomHeader;

  if (patch.length > 0) {
    const patchDiff = renderCustomHeader ? (
      <PatchDiff patch={patch} options={options} renderCustomHeader={() => renderCustomHeader()} />
    ) : (
      <PatchDiff patch={patch} options={options} />
    );

    return (
      <div className={cn("web-component min-w-0 w-full", props.className)} data-diffs-container>
        {patchDiff}
      </div>
    );
  }

  if ((props.filePatch?.kind === "rename_only" || props.state === "renamed") && props.prevPath) {
    return (
      <div
        className={cn(
          "flex h-full flex-col items-center justify-center gap-1 px-4",
          props.className,
        )}
      >
        <p className="text-body font-medium text-foreground/82">Rename only</p>
        <p className="max-w-md text-center text-detail text-muted-foreground/68">
          <span className="font-mono text-foreground/78">{props.prevPath}</span>
          <span className="px-1.5 text-muted-foreground/48">→</span>
          <span className="font-mono text-foreground/78">{props.path ?? "renamed file"}</span>
        </p>
      </div>
    );
  }

  if (props.filePatch?.kind === "non_text") {
    return (
      <GitDiffPlaceholder
        className={props.className}
        descriptor={fileType}
        title={`${fileType?.label ?? "Binary"} file`}
        message={props.filePatch.message}
      />
    );
  }

  if (props.filePatch?.kind === "large") {
    return (
      <GitDiffPlaceholder
        className={props.className}
        descriptor={fileType}
        title="Large diff"
        message={props.filePatch.message}
      />
    );
  }

  if (props.filePatch?.kind === "empty") {
    return (
      <GitDiffPlaceholder
        className={props.className}
        descriptor={fileType}
        title="No patch available"
        message={props.filePatch.message}
      />
    );
  }

  return (
    <GitDiffPlaceholder
      className={props.className}
      descriptor={fileType}
      title="No patch available"
      message="Git did not return a renderable diff for this file."
    />
  );
}

function GitDiffPlaceholder(props: {
  readonly descriptor: GitFileTypeDescriptor | null;
  readonly title: string;
  readonly message: string;
  readonly className?: string | undefined;
}) {
  return (
    <div
      className={cn(
        "flex min-h-28 flex-col items-center justify-center gap-2 px-4 py-8 text-center",
        props.className,
      )}
    >
      {props.descriptor ? <GitFileTypeIcon descriptor={props.descriptor} /> : null}
      <div className="flex max-w-md flex-col items-center gap-1">
        <p className="text-body font-medium text-foreground/82">{props.title}</p>
        <p className="text-detail text-muted-foreground/68">{props.message}</p>
      </div>
    </div>
  );
}
