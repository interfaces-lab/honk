import { IconChevronBottom, IconToolbox } from "central-icons";

import { cn } from "~/lib/utils";

const cardShell =
  "min-w-0 rounded-multi-card border border-multi-border/45 bg-multi-bubble/55 px-2 py-0 shadow-multi-card";

export function TranscriptChromeGallery() {
  return (
    <section className="scroll-mt-[4.5rem] font-multi space-y-4" id="debug-transcript-chrome">
      <div className="space-y-1">
        <h2 className="text-[17px] leading-[22px] font-semibold text-foreground">
          Transcript card chrome
        </h2>
        <p className="text-detail/[1.45] text-muted-foreground">
          Static shells that mirror{" "}
          <code className="font-multi-mono text-detail">RuntimeRailCard</code> outer classes from{" "}
          <code className="font-multi-mono text-detail">rows.tsx</code> without importing private
          components.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className={cn(cardShell, "overflow-hidden")}>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-2 py-2 text-left text-body text-foreground/90"
          >
            <IconToolbox className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate">Read · utils.ts</span>
            <span className="text-caption text-muted-foreground">Completed</span>
            <IconChevronBottom className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          </button>
          <div className="border-t border-multi-border/30 px-2 pb-2 text-detail text-muted-foreground">
            Collapsed header row only — body would be tool output.
          </div>
        </div>

        <div className={cn(cardShell, "overflow-hidden")}>
          <div className="flex items-center gap-2 px-2 py-2 text-body text-foreground/90">
            <IconToolbox className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate">Bash · pnpm run lint</span>
            <span className="text-caption text-foreground/48">Running</span>
          </div>
          <div className="border-t border-multi-border/30 px-2 pb-2 font-multi-mono text-detail text-foreground/80">
            $ pnpm run lint
            <br />…
          </div>
        </div>
      </div>
    </section>
  );
}
