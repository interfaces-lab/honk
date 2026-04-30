import { IconChevronDownSmall, IconFolder1 } from "central-icons";

import { useCommandPaletteStore } from "~/command-palette-store";
import { useShellState } from "~/hooks/use-shell-cwd";
import { shortWorkspacePathLabel } from "~/lib/path-label";
import { cn } from "~/lib/utils";

export function WorkspacePicker(props: { className?: string; variant?: "rail" | "composer" }) {
  const shell = useShellState();
  const openWorkspace = useCommandPaletteStore((store) => store.openWorkspace);
  const rail = props.variant !== "composer";
  const label = shell.cwd ? shortWorkspacePathLabel(shell.cwd, shell.home) : "Open workspace";

  return (
    <button
      type="button"
      onClick={openWorkspace}
      className={cn(
        "font-multi group/workspace flex min-w-0 items-center text-left transition-colors",
        rail
          ? "min-h-7 w-full justify-start gap-2 rounded-multi-control px-2 py-1 text-[12px]/[16px] text-muted-foreground/72 hover:bg-multi-hover hover:text-foreground"
          : "h-6 max-w-[min(100%,15rem)] justify-start gap-1.5 rounded-multi-control px-1.5 text-[12px]/[16px] text-muted-foreground/82 hover:bg-multi-hover/80 hover:text-foreground",
        props.className,
      )}
      title={shell.cwd ?? "Open workspace"}
    >
      <span className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-multi-hover/50 text-muted-foreground/70 group-hover/workspace:text-foreground">
        <IconFolder1 className="size-3.5 shrink-0" />
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <IconChevronDownSmall className="size-3.5 shrink-0 opacity-45" aria-hidden />
    </button>
  );
}
