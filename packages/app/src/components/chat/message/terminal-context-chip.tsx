import { IconConsole } from "central-icons";

import { InlineChip, InlineChipIcon, InlineChipLabel } from "@honk/honkkit/inline-chip";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@honk/honkkit/tooltip";

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
          <InlineChip
            tone={expired ? "destructive" : "default"}
            data-terminal-context-expired={expired ? "true" : undefined}
          >
            <InlineChipIcon className={expired ? "opacity-100" : undefined}>
              <IconConsole className="size-3.5" />
            </InlineChipIcon>
            <InlineChipLabel>{label}</InlineChipLabel>
          </InlineChip>
        }
      />
      <TooltipPopup side="top" className="max-w-80 whitespace-pre-wrap text-xs/4">
        {tooltipText}
      </TooltipPopup>
    </Tooltip>
  );
}
