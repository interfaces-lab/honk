import { Tooltip, TooltipTrigger } from "@multi/multikit/tooltip";
import { Button } from "@multi/multikit/button";

function TestTooltip() {
  return (
    <Tooltip>
      <TooltipTrigger>
        <Button size="default">Click</Button>
      </TooltipTrigger>
    </Tooltip>
  );
}
