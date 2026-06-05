export const WORKBENCH_TABS = ["plan", "git", "terminal", "files"] as const;

export type WorkbenchTab = (typeof WORKBENCH_TABS)[number];

export function isWorkbenchTab(value: unknown): value is WorkbenchTab {
  return value === "plan" || value === "git" || value === "terminal" || value === "files";
}
