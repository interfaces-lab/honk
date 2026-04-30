import { cn } from "~/lib/utils";
import { OpenPicker } from "~/components/shell/pickers/open";

export function HeroComposerFooter(props: { onPlanMode: () => void; planActive?: boolean }) {
  return (
    <div className="flex w-full min-w-0 flex-wrap items-center justify-start gap-2">
      {!props.planActive ? (
        <div
          className={cn(
            "group relative flex min-w-0 items-center",
            "before:pointer-events-none before:absolute before:inset-0 before:z-20 before:rounded-full",
            "before:ring-2 before:ring-transparent before:ring-offset-0 before:ring-offset-background",
            "group-focus-within:before:ring-ring",
          )}
        >
          <button
            type="button"
            className={cn(
              "font-multi relative inline-flex min-h-7 items-center gap-1.5 rounded-full border border-multi-stroke bg-multi-bubble px-2.5 text-detail/[17px] text-muted-foreground shadow-multi-card outline-none backdrop-blur-md transition-colors",
              "pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11",
              "hover:border-multi-stroke-strong hover:bg-multi-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-0 disabled:pointer-events-none disabled:opacity-50",
            )}
            onClick={() => props.onPlanMode()}
            aria-pressed={false}
            aria-label="Turn on plan mode"
            title="Plan mode off (⇧Tab)"
          >
            <span className="max-w-[16rem] truncate">Plan mode</span>
            <kbd className="pointer-events-none hidden shrink-0 rounded border border-multi-stroke/60 bg-multi-hover/40 px-1 py-px font-sans text-[10px] text-muted-foreground/80 sm:inline">
              ⇧Tab
            </kbd>
          </button>
        </div>
      ) : null}
      <div className="flex min-w-0 shrink-0 items-center justify-start">
        <OpenPicker variant="hero" />
      </div>
    </div>
  );
}
