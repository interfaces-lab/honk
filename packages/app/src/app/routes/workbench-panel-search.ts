import { isWorkbenchTab, type WorkbenchTab } from "~/lib/workbench-tabs";

export interface WorkbenchPanelSearch {
  readonly panel?: WorkbenchTab;
}

export function parseWorkbenchPanelSearch(search: Record<string, unknown>): WorkbenchPanelSearch {
  return isWorkbenchTab(search.panel) ? { panel: search.panel } : {};
}
