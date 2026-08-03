import { describe, expect, it } from "vitest";

import type { ThreadViewState } from "../open-code-view";
import type { ToolTodo } from "../tool-part-projection";
import type { SubmittedPlanRecord } from "./follow-up";
import {
  planExecutionMetadata,
  planExecutionProjection,
  remainingPlanStepIDs,
} from "./plan-execution";
import type { AssistantThreadMessage, ThreadPart, UserThreadMessage } from "./transcript-model";

const plan: SubmittedPlanRecord = {
  key: "plan-part",
  messageID: "plan-assistant",
  plan: {
    title: "Tracker parity",
    steps: [
      { id: "step-1", title: "Inspect the source" },
      { id: "step-2", title: "Wire the tracker" },
      { id: "step-3", title: "Verify the result" },
    ],
  },
};

const user = (id: string): UserThreadMessage =>
  ({ id, role: "user" }) as unknown as UserThreadMessage;
const assistant = (id: string, completed = true, error?: object): AssistantThreadMessage =>
  ({
    id,
    role: "assistant",
    agent: "honk-build",
    time: completed ? { completed: 1 } : {},
    ...(error === undefined ? {} : { error }),
  }) as unknown as AssistantThreadMessage;
const part = (value: object): ThreadPart => value as unknown as ThreadPart;

function executionPart(
  id: string,
  messageID: string,
  assignedStepIDs: readonly string[],
): ThreadPart {
  return part({
    id,
    messageID,
    type: "text",
    text: "Implement the attached plan.",
    synthetic: true,
    metadata: planExecutionMetadata(plan, assignedStepIDs),
  });
}

function todoPart(id: string, messageID: string, todos: readonly ToolTodo[]): ThreadPart {
  return part({
    id,
    messageID,
    type: "tool",
    tool: "todowrite",
    state: { status: "completed", input: { todos }, metadata: {} },
  });
}

function state(
  messages: ThreadViewState["messages"],
  parts: ThreadViewState["parts"],
  status: ThreadViewState["summary"]["status"] = "idle",
): ThreadViewState {
  return {
    summary: { status },
    activity: status === "running" ? "busy" : "idle",
    messages,
    parts,
  } as unknown as ThreadViewState;
}

describe("plan execution projection", () => {
  it("persists the assigned IDs and titles needed to tag native TodoWrite results", () => {
    expect(planExecutionMetadata(plan, ["step-2"])).toEqual({
      honkPlanExecution: {
        version: 1,
        planKey: "plan-part",
        planMessageID: "plan-assistant",
        planTitle: "Tracker parity",
        assignedStepIDs: ["step-2"],
        assignedSteps: [{ id: "step-2", title: "Wire the tracker" }],
      },
    });
  });

  it("starts ready with the submitted plan steps as pending tracker rows", () => {
    expect(planExecutionProjection(state([], []), plan)).toMatchObject({
      status: "ready",
      attemptCount: 0,
      tasks: [
        { id: "step-1", content: "Inspect the source", status: "pending" },
        { id: "step-2", content: "Wire the tracker", status: "pending" },
        { id: "step-3", content: "Verify the result", status: "pending" },
      ],
    });
  });

  it("starts tracker projection at the marked root execution turn", () => {
    const projection = planExecutionProjection(
      state(
        [
          user("old-user"),
          assistant("old-assistant"),
          user("build-user"),
          assistant("builder", false),
        ],
        [
          todoPart("old-todos", "old-assistant", [
            { id: "step-1", content: "Inspect the source", status: "completed" },
          ]),
          executionPart("execution-1", "build-user", ["step-1", "step-2", "step-3"]),
          todoPart("build-todos", "builder", [
            { id: "step-1", content: "Inspect the source", status: "completed" },
            { id: "step-2", content: "Wire the tracker", status: "in_progress" },
            { id: "step-3", content: "Verify the result", status: "pending" },
          ]),
        ],
        "running",
      ),
      plan,
    );

    expect(projection.status).toBe("active");
    expect(projection.tasks.map((task) => task.status)).toEqual([
      "completed",
      "in_progress",
      "pending",
    ]);
  });

  it("applies TodoWrite updates delivered by a later synthetic worker-completion turn", () => {
    const projection = planExecutionProjection(
      state(
        [
          user("build-user"),
          assistant("builder"),
          user("worker-completion"),
          assistant("completion-handler"),
        ],
        [
          executionPart("execution-1", "build-user", ["step-1", "step-2", "step-3"]),
          todoPart("initial-todos", "builder", [
            { id: "step-1", content: "Inspect the source", status: "in_progress" },
            { id: "step-2", content: "Wire the tracker", status: "in_progress" },
            { id: "step-3", content: "Verify the result", status: "pending" },
          ]),
          part({
            id: "completion-notice",
            messageID: "worker-completion",
            type: "text",
            text: '<task state="completed">',
            synthetic: true,
          }),
          todoPart("completion-todos", "completion-handler", [
            { id: "step-1", content: "Inspect the source", status: "completed" },
            { id: "step-2", content: "Wire the tracker", status: "completed" },
            { id: "step-3", content: "Verify the result", status: "completed" },
          ]),
        ],
      ),
      plan,
    );

    expect(projection).toMatchObject({
      status: "complete",
      tasks: [
        { id: "step-1", status: "completed" },
        { id: "step-2", status: "completed" },
        { id: "step-3", status: "completed" },
      ],
    });
  });

  it("keeps the marked tracker when a later visible turn writes unrelated todos", () => {
    const projection = planExecutionProjection(
      state(
        [
          user("build-user"),
          assistant("builder"),
          user("later-user"),
          assistant("later-assistant"),
        ],
        [
          executionPart("execution-1", "build-user", ["step-1", "step-2", "step-3"]),
          todoPart("plan-todos", "builder", [
            { id: "step-1", content: "Inspect the source", status: "completed" },
            { id: "step-2", content: "Wire the tracker", status: "in_progress" },
            { id: "step-3", content: "Verify the result", status: "pending" },
          ]),
          part({
            id: "later-text",
            messageID: "later-user",
            type: "text",
            text: "Unrelated follow-up",
          }),
          todoPart("later-todos", "later-assistant", [
            { content: "Answer the follow-up", status: "in_progress" },
          ]),
        ],
      ),
      plan,
    );

    expect(projection.status).toBe("incomplete");
    expect(projection.tasks).toEqual([
      { id: "step-1", content: "Inspect the source", status: "completed" },
      { id: "step-2", content: "Wire the tracker", status: "in_progress" },
      { id: "step-3", content: "Verify the result", status: "pending" },
    ]);
  });

  it("does not mark the root plan active only because a child session is running", () => {
    const projection = planExecutionProjection(
      {
        ...state(
          [user("build-user"), assistant("builder")],
          [executionPart("execution-1", "build-user", ["step-1", "step-2", "step-3"])],
          "running",
        ),
        activity: "idle",
      },
      plan,
    );

    expect(projection.status).toBe("incomplete");
  });

  it("joins duplicate titles by stable IDs", () => {
    const duplicatePlan: SubmittedPlanRecord = {
      ...plan,
      plan: {
        ...plan.plan,
        steps: [
          { id: "step-a", title: "Review" },
          { id: "step-b", title: "Review" },
        ],
      },
    };
    const projection = planExecutionProjection(
      state(
        [user("build-user"), assistant("builder")],
        [
          part({
            ...executionPart("execution-1", "build-user", ["step-a", "step-b"]),
            metadata: planExecutionMetadata(duplicatePlan, ["step-a", "step-b"]),
          }),
          todoPart("todos", "builder", [
            { id: "step-b", content: "Review", status: "completed" },
            { id: "step-a", content: "Review", status: "cancelled" },
          ]),
        ],
      ),
      duplicatePlan,
    );

    expect(projection.status).toBe("complete");
    expect(projection.tasks).toEqual([
      { id: "step-a", content: "Review", status: "cancelled" },
      { id: "step-b", content: "Review", status: "completed" },
    ]);
  });

  it("keeps unrelated todos as extras instead of assigning by position", () => {
    const projection = planExecutionProjection(
      state(
        [user("build-user"), assistant("builder")],
        [
          executionPart("execution-1", "build-user", ["step-1", "step-2", "step-3"]),
          todoPart("todos", "builder", [
            { content: "Prepare workspace", status: "in_progress" },
            { content: "Inspect the source", status: "pending" },
            { content: "Wire the tracker", status: "pending" },
            { content: "Verify the result", status: "pending" },
          ]),
        ],
      ),
      plan,
    );

    expect(projection.tasks).toEqual([
      { id: "step-1", content: "Inspect the source", status: "pending" },
      { id: "step-2", content: "Wire the tracker", status: "pending" },
      { id: "step-3", content: "Verify the result", status: "pending" },
      { content: "Prepare workspace", status: "in_progress" },
    ]);
    expect(projection.status).toBe("incomplete");
  });

  it("treats completed and cancelled assigned steps as terminal", () => {
    const projection = planExecutionProjection(
      state(
        [user("build-user"), assistant("builder")],
        [
          executionPart("execution-1", "build-user", ["step-1", "step-2", "step-3"]),
          todoPart("todos", "builder", [
            { content: "Inspect the source", status: "completed" },
            { content: "Wire the tracker", status: "cancelled" },
            { content: "Verify the result", status: "completed" },
          ]),
        ],
      ),
      plan,
    );

    expect(projection.status).toBe("complete");
    expect(remainingPlanStepIDs(plan, projection)).toEqual([]);
  });

  it("preserves completed work across a rebuild and assigns only remaining steps", () => {
    const projection = planExecutionProjection(
      state(
        [
          user("build-user-1"),
          assistant("builder-1"),
          user("build-user-2"),
          assistant("builder-2"),
        ],
        [
          executionPart("execution-1", "build-user-1", ["step-1", "step-2", "step-3"]),
          todoPart("todos-1", "builder-1", [
            { content: "Inspect the source", status: "completed" },
            { content: "Wire the tracker", status: "in_progress" },
            { content: "Verify the result", status: "pending" },
          ]),
          executionPart("execution-2", "build-user-2", ["step-2", "step-3"]),
          todoPart("todos-2", "builder-2", [
            { content: "Wire the tracker", status: "completed" },
            { content: "Verify the result", status: "pending" },
          ]),
        ],
      ),
      plan,
    );

    expect(projection.status).toBe("incomplete");
    expect(projection.tasks.map((task) => task.status)).toEqual([
      "completed",
      "completed",
      "pending",
    ]);
    expect(remainingPlanStepIDs(plan, projection)).toEqual(["step-3"]);
  });

  it("reports a failed latest execution without losing its tracker state", () => {
    const projection = planExecutionProjection(
      state(
        [
          user("build-user"),
          assistant("builder", true, {
            name: "ProviderError",
            data: { message: "Model stopped" },
          }),
        ],
        [
          executionPart("execution-1", "build-user", ["step-1", "step-2", "step-3"]),
          todoPart("todos", "builder", [
            { content: "Inspect the source", status: "completed" },
            { content: "Wire the tracker", status: "pending" },
            { content: "Verify the result", status: "pending" },
          ]),
        ],
        "failed",
      ),
      plan,
    );

    expect(projection.status).toBe("failed");
    expect(remainingPlanStepIDs(plan, projection)).toEqual(["step-2", "step-3"]);
  });
});
