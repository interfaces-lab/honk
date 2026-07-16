import { describe, expect, it } from "vitest";

import { visibleWorkbenchToolTabs, workbenchToolTabs } from "./workbench-tool-tabs";

describe("workbench tool tabs", () => {
  it("labels the tasks surface as Plan when a submitted plan is detected", () => {
    expect(workbenchToolTabs(true).find((entry) => entry.id === "tasks")?.label).toBe("Plan");
  });

  it("keeps the tasks label when there is no submitted plan", () => {
    expect(workbenchToolTabs(false).find((entry) => entry.id === "tasks")?.label).toBe("Tasks");
  });

  it("does not change workbench route identities", () => {
    expect(workbenchToolTabs(true).map((entry) => entry.id)).toEqual(
      workbenchToolTabs(false).map((entry) => entry.id),
    );
  });

  it("makes the Plan surface visible when a plan is detected without task state", () => {
    expect(
      visibleWorkbenchToolTabs({ hasPlan: true, hasTasks: false, hasTasksPanel: false }).find(
        (entry) => entry.id === "tasks",
      )?.label,
    ).toBe("Plan");
  });

  it("hides the empty Tasks surface when there is no plan or task state", () => {
    expect(
      visibleWorkbenchToolTabs({ hasPlan: false, hasTasks: false, hasTasksPanel: false }).some(
        (entry) => entry.id === "tasks",
      ),
    ).toBe(false);
  });
});
