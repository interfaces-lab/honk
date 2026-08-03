import type { ToolTodo } from "../tool-part-projection";

type TodoSummaryLabel = {
  readonly label: string;
  readonly position?: string;
};

function todoSummaryLabel(tasks: readonly ToolTodo[]): TodoSummaryLabel {
  const completed = tasks.filter((task) => task.status === "completed").length;
  const active = tasks.findLast((task) => task.status === "in_progress");
  if (active !== undefined) {
    return {
      label: active.content,
      position: `${String(completed + 1)}/${String(tasks.length)}`,
    };
  }

  if (completed === 0) return { label: `${String(tasks.length)} To-dos` };
  return {
    label: `${String(completed)} of ${String(tasks.length)} To-dos Completed`,
  };
}

export { todoSummaryLabel };
