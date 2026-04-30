import { SHELL_LAYOUT_CHANGED_EVENT } from "./shell-runtime-constants";

export const WORKSPACE_KEY = "multi:workspace-cwd";

export function readStoredWorkspaceCwd(): string | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(WORKSPACE_KEY)?.trim();
  return raw && raw.length > 0 ? raw : null;
}

export function writeStoredWorkspaceCwd(cwd: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(WORKSPACE_KEY, cwd);
  window.dispatchEvent(new CustomEvent(SHELL_LAYOUT_CHANGED_EVENT));
}
