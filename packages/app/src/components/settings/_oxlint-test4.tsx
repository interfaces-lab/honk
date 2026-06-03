import { Tooltip, TooltipTrigger } from "@multi/ui/tooltip";
import { Button } from "@multi/ui/button";

function TestTooltip() {
  return (
    <Tooltip>
      <TooltipTrigger>
        <Button size="default">Click</Button>
      </TooltipTrigger>
    </Tooltip>
  );
}
