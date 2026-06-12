import type { EnvironmentApi, EnvironmentId } from "@honk/contracts";

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
