import { IconConsole } from "central-icons";

import { Tooltip, TooltipPopup, TooltipTrigger } from "@honk/multikit/tooltip";
import { cn } from "~/lib/utils";

interface TerminalContextInlineChipProps {
  label: string;
  tooltipText: string;
  expired?: boolean;
}

export function TerminalContextInlineChip(props: TerminalContextInlineChipProps) {
  const { label, tooltipText, expired = false } = props;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              "inline-flex max-w-full select-none items-center gap-1 rounded-sm border px-1.5 py-px font-honk text-body font-medium align-middle",
              expired
                ? "border-destructive/35 bg-destructive/8 text-destructive"
                : "border-honk-stroke-tertiary bg-honk-bg-quaternary text-honk-fg-primary",
            )}
            data-terminal-context-expired={expired ? "true" : undefined}
          >
            <span className={cn("size-3.5 shrink-0 opacity-85", expired && "opacity-100")}>
              <IconConsole className="size-3.5" />
            </span>
            <span className="truncate select-none text-body">{label}</span>
          </span>
        }
      />
      <TooltipPopup side="top" className="max-w-80 whitespace-pre-wrap text-xs/4">
        {tooltipText}
      </TooltipPopup>
    </Tooltip>
  );
}
