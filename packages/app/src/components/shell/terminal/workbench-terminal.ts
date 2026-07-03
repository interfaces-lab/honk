import type { EnvironmentApi } from "@honk/contracts";
import type { EnvironmentId } from "@honk/shared/environment";

import { readEnvironmentApiWithFallback } from "~/environment-api";

type WorkbenchTerminalApi = EnvironmentApi["terminal"];

export function workbenchTerminalThreadId(workspaceKey: string): string {
  return `workbench:${workspaceKey}`;
}

export function readWorkbenchTerminalApi(
  environmentId: EnvironmentId | null | undefined,
): WorkbenchTerminalApi | null {
  return (
    readEnvironmentApiWithFallback(environmentId, {
      allowPrimaryEnvironmentFallback: true,
    })?.terminal ?? null
  );
}
