import { describe, expect, it } from "vitest";

import { taskListWindow } from "./task-list-window";
import type { ToolTodo } from "./tool-part-projection";

function tasks(statuses: readonly ToolTodo["status"][]): readonly ToolTodo[] {
  return statuses.map((status, index) => ({
    content: `Task ${String(index + 1)}`,
    id: String(index + 1),
    status,
  }));
}

describe("task list window", () => {
  it("keeps the full list through Cursor's nine-row limit", () => {
    const input = tasks(Array.from({ length: 9 }, () => "pending"));

    expect(taskListWindow(input, 9)).toEqual({ tasks: input, hiddenCount: 0 });
  });

  it("keeps one row of context before the active task", () => {
    const input = tasks([
      "completed",
      "completed",
      "completed",
      "completed",
      "completed",
      "in_progress",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
    ]);

    expect(taskListWindow(input, 9)).toEqual({
      tasks: input.slice(4, 12),
      hiddenCount: 4,
    });
  });

  it("anchors on the first pending task when nothing is active", () => {
    const input = tasks([
      "completed",
      "completed",
      "completed",
      "completed",
      "completed",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
    ]);

    expect(taskListWindow(input, 9)).toEqual({
      tasks: input.slice(2, 10),
      hiddenCount: 2,
    });
  });

  it("shows the most recent completed rows when all work is done", () => {
    const input = tasks(Array.from({ length: 12 }, () => "completed"));

    expect(taskListWindow(input, 9)).toEqual({
      tasks: input.slice(4),
      hiddenCount: 4,
    });
  });
});
