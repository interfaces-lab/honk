import { Tooltip, TooltipTrigger } from "@honk/multikit/tooltip";
import { Button } from "@honk/multikit/button";

function TestTooltip() {
  return (
    <Tooltip>
      <TooltipTrigger>
        <Button size="default">Click</Button>
      </TooltipTrigger>
    </Tooltip>
  );
}
