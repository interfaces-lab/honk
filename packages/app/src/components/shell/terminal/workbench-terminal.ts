import type { EnvironmentId } from "@honk/shared/environment";

import type { EnvironmentApi } from "~/desktop-bridge";
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
