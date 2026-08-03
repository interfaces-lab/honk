import type { ToolTodo } from "../tool-part-projection";

type PlanTodoStep = {
  readonly id: string;
  readonly content: string;
};

function projectPlanTasks(
  steps: readonly PlanTodoStep[],
  todos: readonly ToolTodo[] | undefined,
): { readonly assigned: readonly ToolTodo[]; readonly extras: readonly ToolTodo[] } {
  if (todos === undefined) {
    return {
      assigned: steps.map((step) => ({ ...step, status: "pending" })),
      extras: [],
    };
  }

  const claimed = new Set<number>();
  const assigned = steps.map((step): ToolTodo => {
    const idIndex = todos.findIndex(
      (todo, todoIndex) => !claimed.has(todoIndex) && todo.id === step.id,
    );
    const contentIndex = todos.findIndex(
      (todo, todoIndex) => !claimed.has(todoIndex) && todo.content.trim() === step.content.trim(),
    );
    const matchIndex = idIndex >= 0 ? idIndex : contentIndex;
    const todo = matchIndex < 0 ? undefined : todos[matchIndex];
    if (matchIndex >= 0) claimed.add(matchIndex);
    return {
      ...step,
      status: todo?.status ?? "pending",
      ...(todo?.activeForm === undefined ? {} : { activeForm: todo.activeForm }),
    };
  });

  return {
    assigned,
    extras: todos.filter((_todo, todoIndex) => !claimed.has(todoIndex)),
  };
}

export { projectPlanTasks };
