import {
  type ContextWindowSnapshot,
  formatContextUsagePercentage,
  formatContextWindowTokens,
} from "~/lib/context-window";
import { Popover, PopoverPopup, PopoverTrigger } from "@multi/ui/popover";
import { ContextWindowRing } from "./context-window-ring";
import { ContextWindowUsageDetails } from "./context-window-usage-details";

export function ContextWindowMeter(props: { usage: ContextWindowSnapshot }) {
  const { usage } = props;
  const usedPercentage = formatContextUsagePercentage(usage.usedPercentage);

  return (
    <Popover data-composer-context-meter="">
      <PopoverTrigger
        openOnHover
        delay={150}
        closeDelay={0}
        render={
          <button
            type="button"
            className="group inline-flex select-none items-center justify-center rounded-full transition-opacity hover:opacity-85"
            aria-label={
              usage.maxTokens !== null && usedPercentage
                ? `Context window ${usedPercentage} used`
                : `Context window ${formatContextWindowTokens(usage.usedTokens)} tokens used`
            }
          >
            <ContextWindowRing usage={usage} size="md" />
          </button>
        }
      />
      <PopoverPopup tooltipStyle side="top" align="end" className="w-max max-w-none px-3 py-2">
        <ContextWindowUsageDetails usage={usage} />
      </PopoverPopup>
    </Popover>
  );
}

export { ContextWindowRing } from "./context-window-ring";
export { ContextWindowUsageDetails } from "./context-window-usage-details";
