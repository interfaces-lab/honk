import { Badge } from "@honk/ui";
import * as React from "react";

function DevChannelChip(): React.ReactElement {
  return (
    <span data-shell-no-drag="">
      <Badge tone="warn" size="sm">
        DEV
      </Badge>
    </span>
  );
}

export { DevChannelChip };
