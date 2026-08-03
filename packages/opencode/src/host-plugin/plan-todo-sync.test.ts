import { describe, expect, it } from "vitest";

import { syncPlanTodoIDs } from "./plan-todo-sync";
import type { PluginInput, PluginMessageGroup, ToolAfterHookOutput } from "./types";

function plugin(messages: readonly PluginMessageGroup[]): PluginInput {
  return {
    directory: "/repo",
    client: {
      session: {
        get: async (options) => ({ data: { id: options.path.id } }),
        messages: async () => ({ data: messages }),
        abort: async () => ({ data: true }),
      },
    },
  };
}

function planExecutionMessage(
  steps: readonly { readonly id: string; readonly title: string }[],
): PluginMessageGroup {
  return {
    info: { role: "user" },
    parts: [
      {
        type: "text",
        text: "Implement the attached plan.",
        synthetic: true,
        metadata: {
          honkPlanExecution: {
            version: 1,
            planKey: "plan-1",
            assignedStepIDs: steps.map((step) => step.id),
            assignedSteps: steps,
          },
        },
      },
    ],
  };
}

describe("plan TodoWrite synchronization", () => {
  it("persists stable plan IDs onto the root todo result", async () => {
    const output: ToolAfterHookOutput = {
      title: "Update todos",
      output: "Updated",
      metadata: {},
    };
    await syncPlanTodoIDs(
      plugin([
        planExecutionMessage([
          { id: "step-1", title: "Inspect" },
          { id: "step-2", title: "Wire" },
        ]),
      ]),
      "session-1",
      {
        todos: [
          { content: "Wire", status: "in_progress", priority: "high" },
          { content: "Inspect", status: "completed", priority: "high" },
          { content: "Extra verification", status: "pending", priority: "low" },
        ],
      },
      output,
    );

    expect(output.metadata).toEqual({
      todos: [
        { id: "step-2", content: "Wire", status: "in_progress", priority: "high" },
        { id: "step-1", content: "Inspect", status: "completed", priority: "high" },
        { content: "Extra verification", status: "pending", priority: "low" },
      ],
    });
  });

  it("never gives an unrelated positional todo a plan step ID", async () => {
    const output: ToolAfterHookOutput = {
      title: "Update todos",
      output: "Updated",
      metadata: {},
    };
    await syncPlanTodoIDs(
      plugin([
        planExecutionMessage([
          { id: "step-1", title: "Inspect" },
          { id: "step-2", title: "Wire" },
        ]),
      ]),
      "session-1",
      {
        todos: [
          { content: "Prepare workspace", status: "in_progress" },
          { content: "Inspect", status: "pending" },
          { content: "Wire", status: "pending" },
        ],
      },
      output,
    );

    expect(output.metadata).toEqual({
      todos: [
        { content: "Prepare workspace", status: "in_progress" },
        { id: "step-1", content: "Inspect", status: "pending" },
        { id: "step-2", content: "Wire", status: "pending" },
      ],
    });
  });

  it("retains root plan IDs across follow-ups and synthetic worker completions", async () => {
    const output: ToolAfterHookOutput = {
      title: "Update todos",
      output: "Updated",
      metadata: {},
    };
    await syncPlanTodoIDs(
      plugin([
        planExecutionMessage([{ id: "step-1", title: "Inspect" }]),
        { info: { role: "assistant" }, parts: [] },
        {
          info: { role: "user" },
          parts: [{ type: "text", text: "Handle an unrelated follow-up." }],
        },
        { info: { role: "assistant" }, parts: [] },
        {
          info: { role: "user" },
          parts: [
            {
              type: "text",
              text: '<task id="worker-1" state="completed">Done</task>',
              synthetic: true,
            },
          ],
        },
      ]),
      "session-1",
      { todos: [{ content: "Inspect", status: "completed" }] },
      output,
    );

    expect(output.metadata).toEqual({
      todos: [{ id: "step-1", content: "Inspect", status: "completed" }],
    });
  });
});
