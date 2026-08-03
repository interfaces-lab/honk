import type { ToolTodo } from "./tool-part-projection";

function taskListWindow(tasks: readonly ToolTodo[], maxRows: number | undefined) {
  if (maxRows === undefined || tasks.length <= maxRows) {
    return { tasks, hiddenCount: 0 };
  }

  const visibleSlots = Math.max(0, maxRows - 1);
  const allCompleted = tasks.every((task) => task.status === "completed");
  const activeIndex = tasks.findIndex((task) => task.status === "in_progress");
  const pendingIndex = tasks.findIndex((task) => task.status === "pending");
  const focusIndex = activeIndex >= 0 ? activeIndex : Math.max(0, pendingIndex);
  const start = allCompleted
    ? Math.max(0, tasks.length - visibleSlots)
    : Math.max(0, Math.min(tasks.length - visibleSlots, focusIndex - 1));
  const visibleTasks = tasks.slice(start, start + visibleSlots);
  return { tasks: visibleTasks, hiddenCount: tasks.length - visibleTasks.length };
}

export { taskListWindow };
