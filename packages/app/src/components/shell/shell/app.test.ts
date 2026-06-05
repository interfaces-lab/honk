import { describe, expect, it } from "vitest";

import { addVisitedWorkbenchTab } from "./app";
import type { WorkbenchTab } from "~/lib/workbench-tabs";

function tabList(tabs: ReadonlySet<WorkbenchTab>): WorkbenchTab[] {
  return [...tabs];
}

describe("right workbench panel mounting", () => {
  it("keeps previously visited tabs mounted after switching", () => {
    const initial = new Set<WorkbenchTab>(["git"]);
    const withFiles = addVisitedWorkbenchTab(initial, "files");
    const withTerminal = addVisitedWorkbenchTab(withFiles, "terminal");

    expect(tabList(withTerminal)).toEqual(["git", "files", "terminal"]);
  });

  it("preserves set identity when the active tab was already visited", () => {
    const initial = new Set<WorkbenchTab>(["git", "files"]);

    expect(addVisitedWorkbenchTab(initial, "files")).toBe(initial);
  });

  it("starts a new visited set when the workspace remounts the panel host", () => {
    const firstWorkspaceTabs = addVisitedWorkbenchTab(new Set<WorkbenchTab>(["git"]), "files");
    const nextWorkspaceTabs = new Set<WorkbenchTab>(["terminal"]);

    expect(tabList(firstWorkspaceTabs)).toEqual(["git", "files"]);
    expect(tabList(nextWorkspaceTabs)).toEqual(["terminal"]);
  });
});
