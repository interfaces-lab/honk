import { describe, expect, it } from "vitest";
import {
  IconPlanning,
  IconProgress25,
  IconProgress50,
  IconProgress75,
  IconProgress100,
  IconTasks,
} from "@honk/ui/icons";

import { visibleWorkbenchToolTabs, workbenchToolTabs } from "./workbench-tool-tabs";

describe("workbench tool tabs", () => {
  it("labels the tasks surface as Plan when a submitted plan is detected", () => {
    expect(workbenchToolTabs(true).find((entry) => entry.id === "tasks")).toMatchObject({
      label: "Plan",
      icon: IconPlanning,
    });
  });

  it("keeps the tasks label when there is no submitted plan", () => {
    expect(workbenchToolTabs(false).find((entry) => entry.id === "tasks")).toMatchObject({
      label: "Tasks",
      icon: IconTasks,
    });
  });

  it.each([
    [1, IconProgress25],
    [2, IconProgress50],
    [3, IconProgress75],
    [4, IconProgress100],
  ])("shows aggregate todo progress at %s of 4 complete", (completed, icon) => {
    const tasks = Array.from({ length: 4 }, (_, index) => ({
      content: `Task ${String(index + 1)}`,
      status: index < completed ? ("completed" as const) : ("pending" as const),
    }));

    expect(workbenchToolTabs(false, tasks).find((entry) => entry.id === "tasks")?.icon).toBe(icon);
  });

  it("does not change workbench route identities", () => {
    expect(workbenchToolTabs(true).map((entry) => entry.id)).toEqual(
      workbenchToolTabs(false).map((entry) => entry.id),
    );
  });

  it("makes the Plan surface visible when a plan is detected without task state", () => {
    expect(
      visibleWorkbenchToolTabs({ hasPlan: true, hasTasksPanel: false, tasks: [] }).find(
        (entry) => entry.id === "tasks",
      )?.label,
    ).toBe("Plan");
  });

  it("hides the empty Tasks surface when there is no plan or task state", () => {
    expect(
      visibleWorkbenchToolTabs({ hasPlan: false, hasTasksPanel: false, tasks: [] }).some(
        (entry) => entry.id === "tasks",
      ),
    ).toBe(false);
  });
});
