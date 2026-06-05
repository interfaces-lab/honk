import type { EnvironmentApi, EnvironmentId } from "@multi/contracts";

import { readNativeEnvironmentApi, readNativeRuntimeApi } from "~/lib/native-runtime-api";

type WorkbenchTerminalApi = EnvironmentApi["terminal"];

export function workbenchTerminalThreadId(workspaceKey: string): string {
  return `workbench:${workspaceKey}`;
}

export function readWorkbenchTerminalApi(
  environmentId: EnvironmentId | null | undefined,
): WorkbenchTerminalApi | null {
  return (
    readNativeRuntimeApi(environmentId, {
      allowPrimaryEnvironmentFallback: true,
    })?.terminal ??
    readNativeEnvironmentApi(environmentId, {
      allowPrimaryEnvironmentFallback: true,
    })?.terminal ?? null
  );
}
