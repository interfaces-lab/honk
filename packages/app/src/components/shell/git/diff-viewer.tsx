import type { GitFileState } from "~/lib/ui-session-types";
import { FileDiff, type FileDiffMetadata } from "@pierre/diffs/react";
import { memo } from "react";
import { cn } from "~/lib/utils";
import { useTheme } from "~/hooks/use-theme";

interface Props {
  fileDiff: FileDiffMetadata | null;
  filePatch?: string | null;
  path?: string;
  state?: GitFileState;
  prevPath?: string | null;
  diffStyle?: "unified" | "split";
  className?: string;
  collapsed?: boolean;
}

export const DiffViewer = memo(function DiffViewer(props: Props) {
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "dark" ? "pierre-dark" : "pierre-light";
  const patch = props.filePatch?.trim() ?? "";

  if (props.fileDiff) {
    return (
      <div className={cn("embed-diff min-h-0 min-w-0 w-full overflow-auto", props.className)}>
        <div className="web-component min-h-0 min-w-0 w-full overflow-auto" data-diffs-container>
          <FileDiff
            fileDiff={props.fileDiff}
            options={{
              theme,
              diffStyle: props.diffStyle ?? "unified",
              overflow: "wrap",
              disableFileHeader: true,
              disableBackground: false,
              disableLineNumbers: false,
              diffIndicators: "none",
              lineDiffType: "none",
              expandUnchanged: false,
              hunkSeparators: "simple",
              ...(props.collapsed !== undefined ? { collapsed: props.collapsed } : {}),
            }}
          />
        </div>
      </div>
    );
  }

  if (patch.length > 0) {
    return (
      <div className={cn("min-h-0 min-w-0 w-full overflow-auto", props.className)}>
        <pre className="min-h-full overflow-auto px-3 py-2 font-mono text-detail/[1.45] whitespace-pre-wrap text-foreground/80">
          {patch}
        </pre>
      </div>
    );
  }

  if (props.state === "renamed" && props.prevPath) {
    return (
      <div
        className={cn(
          "flex h-full flex-col items-center justify-center gap-1 px-4",
          props.className,
        )}
      >
        <p className="text-body/[1.4] font-medium text-foreground/82">Rename only</p>
        <p className="max-w-[28rem] text-center text-detail/[1.45] text-muted-foreground/68">
          <span className="font-mono text-foreground/78">{props.prevPath}</span>
          <span className="px-1.5 text-muted-foreground/48">→</span>
          <span className="font-mono text-foreground/78">{props.path ?? "renamed file"}</span>
        </p>
      </div>
    );
  }

  return (
    <div className={cn("flex h-full items-center justify-center px-4", props.className)}>
      <p className="text-body/[1.4] text-muted-foreground/60">No diff for this file</p>
    </div>
  );
});
