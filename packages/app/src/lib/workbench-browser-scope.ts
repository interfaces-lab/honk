import { ThreadId } from "@multi/contracts";

const WORKBENCH_BROWSER_DEFAULT_SCOPE = "workbench:browser:default";

export function resolveWorkbenchBrowserThreadId(cwd: string | null): ThreadId {
  const normalizedCwd = cwd?.trim();
  if (!normalizedCwd) {
    return ThreadId.make(WORKBENCH_BROWSER_DEFAULT_SCOPE);
  }

  return ThreadId.make(`workbench:browser:${normalizedCwd}`);
}
