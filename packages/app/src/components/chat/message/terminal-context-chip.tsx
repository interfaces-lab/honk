import { IconConsole } from "central-icons";

import {
  ComposerInlineChip,
  ComposerInlineChipIcon,
  ComposerInlineChipLabel,
} from "../../composer-inline-chip";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@multi/ui/tooltip";

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
          <ComposerInlineChip
            tone={expired ? "danger" : "default"}
            data-terminal-context-expired={expired ? "true" : undefined}
          >
            <ComposerInlineChipIcon className={expired ? "opacity-100" : undefined}>
              <IconConsole className="size-3.5" />
            </ComposerInlineChipIcon>
            <ComposerInlineChipLabel>{label}</ComposerInlineChipLabel>
          </ComposerInlineChip>
        }
      />
      <TooltipPopup side="top" className="max-w-80 whitespace-pre-wrap text-xs/4">
        {tooltipText}
      </TooltipPopup>
    </Tooltip>
  );
}
