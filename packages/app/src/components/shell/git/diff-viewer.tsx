import type { GitFilePatchResult } from "@multi/contracts";
import type { GitFileState } from "~/lib/ui-session-types";
import { PatchDiff } from "@pierre/diffs/react";
import { memo } from "react";

import { resolveDiffThemeName, WORKBENCH_CODE_UNSAFE_CSS } from "~/lib/diff-rendering";
import { cn } from "~/lib/utils";
import { useTheme } from "~/hooks/use-theme";

interface Props {
  filePatch?: GitFilePatchResult | null;
  path?: string;
  state?: GitFileState;
  prevPath?: string | null;
  diffStyle?: "unified" | "split";
  className?: string;
  layoutKey?: string;
}

export const DiffViewer = memo(function DiffViewer(props: Props) {
  const { resolvedTheme } = useTheme();
  const theme = resolveDiffThemeName(resolvedTheme);
  const patch =
    props.filePatch?.kind === "patch" || props.filePatch?.kind === "untracked"
      ? props.filePatch.patch.trim()
      : "";

  if (patch.length > 0) {
    return (
      <div className={cn("web-component min-w-0 w-full", props.className)} data-diffs-container>
        <PatchDiff
          key={props.layoutKey}
          patch={patch}
          options={{
            theme,
            themeType: resolvedTheme,
            unsafeCSS: WORKBENCH_CODE_UNSAFE_CSS,
            diffStyle: props.diffStyle ?? "unified",
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
        />
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

  if (props.filePatch?.kind === "empty") {
    return (
      <div
        className={cn(
          "flex h-full flex-col items-center justify-center gap-1 px-4",
          props.className,
        )}
      >
        <p className="text-body font-medium text-foreground/82">No patch available</p>
        {props.filePatch.message ? (
          <p className="max-w-md text-center text-detail text-muted-foreground/68">
            {props.filePatch.message}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className={cn("flex h-full items-center justify-center px-4", props.className)}>
      <p className="text-body text-muted-foreground/60">No patch available</p>
    </div>
  );
});
