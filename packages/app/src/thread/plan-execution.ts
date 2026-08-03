import type { ThreadViewState } from "../open-code-view";
import { toolTodos, type ToolTodo } from "../tool-part-projection";
import type { SubmittedPlanRecord } from "./follow-up";
import {
  groupMessagesIntoTurns,
  hasVisibleUserMessage,
  messageError,
  type TextPart,
  type ThreadTurn,
} from "./transcript-model";
import { projectPlanTasks } from "./plan-todo-projection";

const PLAN_EXECUTION_METADATA_KEY = "honkPlanExecution";

type PlanExecutionMarker = {
  readonly planKey: string;
  readonly assignedStepIDs: readonly string[];
};

type PlanExecutionStatus = "ready" | "active" | "incomplete" | "complete" | "failed";

type PlanExecutionProjection = {
  readonly status: PlanExecutionStatus;
  readonly tasks: readonly ToolTodo[];
  readonly attemptCount: number;
};

type PlanExecutionState = Pick<ThreadViewState, "activity" | "messages" | "parts">;

type PlanExecutionAttempt = {
  readonly part: TextPart;
  readonly marker: PlanExecutionMarker;
  readonly turn: ThreadTurn | undefined;
};

function planExecutionMetadata(
  record: SubmittedPlanRecord,
  assignedStepIDs: readonly string[],
): Readonly<Record<string, unknown>> {
  const assigned = new Set(assignedStepIDs);
  return {
    [PLAN_EXECUTION_METADATA_KEY]: {
      version: 1,
      planKey: record.key,
      planMessageID: record.messageID,
      planTitle: record.plan.title,
      assignedStepIDs: [...assignedStepIDs],
      assignedSteps: record.plan.steps
        .filter((step) => assigned.has(step.id))
        .map((step) => ({ id: step.id, title: step.title })),
    },
  };
}

function planExecutionPrompt(
  record: SubmittedPlanRecord,
  assignedStepIDs: readonly string[],
): string {
  const assigned = new Set(assignedStepIDs);
  const steps = record.plan.steps.filter((step) => assigned.has(step.id));
  return [
    "Implement the attached plan.",
    "The implementation tracker is already defined. Before changing files, call TodoWrite with exactly the assigned steps below, in this order, using each title verbatim as the todo content.",
    "Keep the root task's TodoWrite list current while delegated work runs. Mark one item in_progress at a time, and finish every item as completed or cancelled before replying.",
    "Tracker IDs are coordination metadata only; do not include them in todo content.",
    "",
    ...steps.map(
      (step) =>
        `- [${step.id}] ${step.title}${step.detail === undefined ? "" : ` — ${step.detail}`}`,
    ),
  ].join("\n");
}

function remainingPlanStepIDs(
  record: SubmittedPlanRecord,
  execution: PlanExecutionProjection,
): readonly string[] {
  const statusByID = new Map(execution.tasks.map((task) => [task.id, task.status] as const));
  return record.plan.steps.flatMap((step) => {
    const status = statusByID.get(step.id);
    return status === "completed" || status === "cancelled" ? [] : [step.id];
  });
}

function planExecutionProjection(
  state: PlanExecutionState,
  record: SubmittedPlanRecord,
): PlanExecutionProjection {
  const turns = groupMessagesIntoTurns(state.messages);
  const turnByUserMessageID = new Map(
    turns.flatMap((turn) => (turn.user === null ? [] : [[turn.user.id, turn] as const])),
  );
  const attempts = state.parts.flatMap<PlanExecutionAttempt>((part) => {
    if (part.type !== "text") return [];
    const marker = planExecutionMarker(part.metadata);
    if (marker === null || marker.planKey !== record.key) return [];
    return [{ part, marker, turn: turnByUserMessageID.get(part.messageID) }];
  });
  const taskByStepID = new Map<string, ToolTodo>(
    record.plan.steps.map(
      (step) =>
        [step.id, { id: step.id, content: step.title, status: "pending" as const }] as const,
    ),
  );
  let latestExtras: readonly ToolTodo[] = [];
  let assignedStepIDs: readonly string[] = [];
  const attemptByTurnKey = new Map(
    attempts.flatMap((attempt) =>
      attempt.turn === undefined ? [] : [[attempt.turn.key, attempt] as const],
    ),
  );
  for (const turn of turns) {
    const attempt = attemptByTurnKey.get(turn.key);
    if (attempt === undefined && !isSyntheticTaskTurn(state, turn)) continue;
    if (attempt !== undefined) assignedStepIDs = attempt.marker.assignedStepIDs;
    if (assignedStepIDs.length === 0) continue;
    const todos = latestTurnTodos(state, turn);
    if (todos === undefined) continue;
    const assigned = new Set(assignedStepIDs);
    const assignedSteps = record.plan.steps.filter((step) => assigned.has(step.id));
    if (
      attempt === undefined &&
      !todos.some((todo) =>
        assignedSteps.some(
          (step) => todo.id === step.id || todo.content.trim() === step.title.trim(),
        ),
      )
    ) {
      continue;
    }
    const projection = projectPlanTasks(
      assignedSteps.map((step) => ({ id: step.id, content: step.title })),
      todos,
    );
    for (const task of projection.assigned) {
      if (task.id !== undefined) taskByStepID.set(task.id, task);
    }
    latestExtras = projection.extras;
  }

  const tasks = [...record.plan.steps.map((step) => taskByStepID.get(step.id)!), ...latestExtras];
  const latestAttempt = attempts.at(-1);
  if (latestAttempt === undefined) return { status: "ready", tasks, attemptCount: 0 };

  const latestTurn = turns.findLast((turn) => {
    if (turn.user === null) return false;
    const parts = state.parts.filter((part) => part.messageID === turn.user?.id);
    return (
      hasVisibleUserMessage(parts) ||
      parts.some((part) => part.type === "text" && planExecutionMarker(part.metadata) !== null)
    );
  });
  const latestAttemptIsLatestTurn =
    latestAttempt.turn !== undefined && latestAttempt.turn.key === latestTurn?.key;
  const isActive = latestAttemptIsLatestTurn && state.activity !== "idle";
  const isComplete = tasks.every(
    (task) => task.status === "completed" || task.status === "cancelled",
  );
  const isFailed =
    latestAttemptIsLatestTurn &&
    latestAttempt.turn?.assistants.some((message) => messageError(message) !== null) === true;

  return {
    status: isActive ? "active" : isComplete ? "complete" : isFailed ? "failed" : "incomplete",
    tasks,
    attemptCount: attempts.length,
  };
}

function isSyntheticTaskTurn(state: PlanExecutionState, turn: ThreadTurn): boolean {
  if (turn.user === null) return false;
  return state.parts.some(
    (part) =>
      part.messageID === turn.user?.id &&
      part.type === "text" &&
      part.synthetic === true &&
      part.text.trimStart().startsWith("<task "),
  );
}

function latestTurnTodos(
  state: PlanExecutionState,
  turn: ThreadTurn | undefined,
): readonly ToolTodo[] | undefined {
  if (turn === undefined) return undefined;
  const assistantIDs = new Set(turn.assistants.map((message) => message.id));
  for (let index = state.parts.length - 1; index >= 0; index -= 1) {
    const part = state.parts[index];
    if (part?.type !== "tool" || !assistantIDs.has(part.messageID)) continue;
    const todos = toolTodos(part);
    if (todos !== undefined) return todos;
  }
  return undefined;
}

function planExecutionMarker(
  metadata: Readonly<Record<string, unknown>> | undefined,
): PlanExecutionMarker | null {
  const value = metadata?.[PLAN_EXECUTION_METADATA_KEY];
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const planKey = Reflect.get(value, "planKey");
  const assignedStepIDs = Reflect.get(value, "assignedStepIDs");
  if (typeof planKey !== "string" || !Array.isArray(assignedStepIDs)) return null;
  return {
    planKey,
    assignedStepIDs: assignedStepIDs.filter(
      (stepID): stepID is string => typeof stepID === "string" && stepID.length > 0,
    ),
  };
}

export {
  planExecutionMetadata,
  planExecutionProjection,
  planExecutionPrompt,
  remainingPlanStepIDs,
};
export type { PlanExecutionProjection };
