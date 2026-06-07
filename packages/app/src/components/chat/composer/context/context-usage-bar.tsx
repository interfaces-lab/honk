import { cn } from "~/lib/utils";
import { formatContextUsageSummary, type ContextWindowSnapshot } from "~/lib/context-window";
import { Button } from "@multi/multikit/button";
import { Popover, PopoverPopup, PopoverTrigger } from "@multi/multikit/popover";
import { ContextWindowRing, ContextWindowUsageDetails } from "./context-window-meter";

export function ComposerContextUsageBar(props: { usage: ContextWindowSnapshot }) {
  const { usage } = props;
  const summary = formatContextUsageSummary(usage);

  return (
    <div
      data-composer-context-usage-bar=""
      className="box-border flex max-h-6 w-full justify-end px-1 pb-1 pt-0.5"
    >
      <Popover data-composer-context-meter="">
        <PopoverTrigger
          delay={150}
          closeDelay={0}
          render={
            <Button
              data-clickable=""
              size="xs"
              variant="ghost"
              className={cn(
                "h-5 max-w-full gap-1 rounded px-1 text-caption text-muted-foreground opacity-65",
                "hover:text-foreground hover:opacity-100",
              )}
              aria-label={`Context window: ${summary}`}
            >
              <ContextWindowRing usage={usage} size="sm" />
              <span className="truncate tabular-nums">{summary}</span>
            </Button>
          }
        />
        <PopoverPopup tooltipStyle side="top" align="end" className="w-max max-w-none px-3 py-2">
          <ContextWindowUsageDetails usage={usage} />
        </PopoverPopup>
      </Popover>
    </div>
  );
}
