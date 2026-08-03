import type { PluginInput, PluginMessageGroup, ToolAfterHookOutput } from "./types";

const PLAN_EXECUTION_METADATA_KEY = "honkPlanExecution";

type AssignedPlanStep = {
  readonly id: string;
  readonly title: string;
};

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function records(value: unknown): readonly Record<string, unknown>[] | undefined {
  return Array.isArray(value)
    ? value.map(record).filter((item): item is Record<string, unknown> => item !== undefined)
    : undefined;
}

function assignedPlanSteps(messages: readonly PluginMessageGroup[]): readonly AssignedPlanStep[] {
  for (const message of [...messages].reverse()) {
    if (message.info.role !== "user") continue;
    for (const part of [...message.parts].reverse()) {
      const marker = record(record(part.metadata)?.[PLAN_EXECUTION_METADATA_KEY]);
      const steps = records(marker?.assignedSteps);
      if (steps === undefined) continue;
      return steps.flatMap((step) => {
        const id = step.id;
        const title = step.title;
        return typeof id === "string" && typeof title === "string" ? [{ id, title }] : [];
      });
    }
  }
  return [];
}

async function syncPlanTodoIDs(
  plugin: PluginInput,
  sessionID: string,
  args: unknown,
  output: ToolAfterHookOutput,
): Promise<void> {
  const result = await plugin.client.session
    .messages({
      path: { id: sessionID },
      query: { directory: plugin.directory },
    })
    .catch(() => undefined);
  if (result?.data === undefined) return;

  const steps = assignedPlanSteps(result.data);
  if (steps.length === 0) return;
  const metadata = record(output.metadata);
  const todos =
    records(metadata?.todos) ?? records(metadata?.newTodos) ?? records(record(args)?.todos);
  if (todos === undefined) return;

  const claimed = new Set<number>();
  const identified = todos.map((todo) => {
    const todoID = todo.id;
    const content = todo.content;
    const idIndex = steps.findIndex(
      (step, stepIndex) => !claimed.has(stepIndex) && step.id === todoID,
    );
    const contentIndex = steps.findIndex(
      (step, stepIndex) =>
        !claimed.has(stepIndex) && typeof content === "string" && step.title === content,
    );
    const matchIndex = idIndex >= 0 ? idIndex : contentIndex;
    const step = matchIndex < 0 ? undefined : steps[matchIndex];
    if (matchIndex >= 0) claimed.add(matchIndex);
    return step === undefined ? todo : { ...todo, id: step.id };
  });
  output.metadata = { ...metadata, todos: identified };
}

export { syncPlanTodoIDs };
