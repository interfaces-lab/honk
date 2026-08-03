import { Button, type ButtonSize } from "@honk/ui";
import type { ReactElement } from "react";

import type { PlanBuildController } from "./use-plan-build";

function PlanBuildControls({
  controller,
  size = "md",
}: {
  readonly controller: PlanBuildController;
  readonly size?: ButtonSize;
}): ReactElement {
  const disabled = !controller.canBuild || controller.isStarting;

  return (
    <Button
      type="button"
      variant="primary"
      size={size}
      disabled={disabled}
      onClick={() => {
        controller.build();
      }}
    >
      {controller.isStarting ? "Building" : "Build"}
    </Button>
  );
}

export { PlanBuildControls };
