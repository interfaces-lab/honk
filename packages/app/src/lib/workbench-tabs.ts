export const WORKBENCH_TABS = ["plan", "dev", "git", "terminal", "files", "browser"] as const;

export type WorkbenchTab = (typeof WORKBENCH_TABS)[number];

export function isWorkbenchTab(value: unknown): value is WorkbenchTab {
  return (
    value === "plan" ||
    value === "dev" ||
    value === "git" ||
    value === "terminal" ||
    value === "files" ||
    value === "browser"
  );
}
