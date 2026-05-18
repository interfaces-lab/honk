export const PROJECT_KEY = "multi:project-cwd";
export const SHELL_LAYOUT_CHANGED_EVENT = "multi:shell-layout-changed";

export function readStoredProjectCwd(): string | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(PROJECT_KEY)?.trim();
  return raw && raw.length > 0 ? raw : null;
}

export function writeStoredProjectCwd(cwd: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PROJECT_KEY, cwd);
  window.dispatchEvent(new CustomEvent(SHELL_LAYOUT_CHANGED_EVENT));
}
