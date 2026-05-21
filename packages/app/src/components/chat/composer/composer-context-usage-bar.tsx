import { cn } from "~/lib/utils";
import { formatContextUsageSummary, type ContextWindowSnapshot } from "~/lib/context-window";
import { Popover, PopoverPopup, PopoverTrigger } from "@multi/ui/popover";
import { ContextWindowRing, ContextWindowUsageDetails } from "./context-window-meter";

export function ComposerContextUsageBar(props: { usage: ContextWindowSnapshot }) {
  const { usage } = props;
  const summary = formatContextUsageSummary(usage);

  return (
    <div
      data-composer-context-usage-bar=""
      className="box-border flex w-full justify-end px-1 pb-1 pt-0.5"
    >
      <Popover data-composer-context-meter="">
        <PopoverTrigger
          delay={150}
          closeDelay={0}
          render={
            <button
              type="button"
              data-clickable=""
              className={cn(
                "inline-flex h-5 max-w-full select-none items-center gap-1 rounded px-1",
                "text-xs text-muted-foreground opacity-65 transition-opacity duration-150",
                "hover:text-foreground hover:opacity-100",
              )}
              aria-label={`Context window: ${summary}`}
            >
              <ContextWindowRing usage={usage} size="sm" />
              <span className="truncate tabular-nums">{summary}</span>
            </button>
          }
        />
        <PopoverPopup tooltipStyle side="top" align="end" className="w-max max-w-none px-3 py-2">
          <ContextWindowUsageDetails usage={usage} />
        </PopoverPopup>
      </Popover>
    </div>
  );
}
