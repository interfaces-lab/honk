import { Tooltip, TooltipTrigger } from "@honk/honkkit/tooltip";
import { Button } from "@honk/honkkit/button";

function TestTooltip() {
  return (
    <Tooltip>
      <TooltipTrigger>
        <Button size="default">Click</Button>
      </TooltipTrigger>
    </Tooltip>
  );
}
