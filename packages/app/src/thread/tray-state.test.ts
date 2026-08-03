import type { Part } from "@honk/opencode";
import { describe, expect, it } from "vitest";

import { modeAgentName } from "../modes";
import type { ThreadViewState } from "../open-code-view";
import { todoSummaryLabel } from "./todo-summary-model";
import { threadTrayState } from "./tray-state";
import type { AssistantThreadMessage, UserThreadMessage } from "./transcript-model";

const dismissals = { planKey: null, debugKey: null };
const user = (id: string): UserThreadMessage =>
  ({ id, role: "user" }) as unknown as UserThreadMessage;
const assistant = (id: string, agent: string): AssistantThreadMessage =>
  ({
    id,
    role: "assistant",
    agent,
    time: { completed: 1 },
  }) as unknown as AssistantThreadMessage;
const part = (value: object): Part => value as unknown as Part;

function threadState({
  status = "idle",
  messages = [],
  parts = [],
  permissions = [],
  questions = [],
}: {
  readonly status?: ThreadViewState["summary"]["status"];
  readonly messages?: ThreadViewState["messages"];
  readonly parts?: ThreadViewState["parts"];
  readonly permissions?: ThreadViewState["permissions"];
  readonly questions?: ThreadViewState["questions"];
}): ThreadViewState {
  return {
    summary: { status },
    activity: status === "running" ? "busy" : "idle",
    messages,
    parts,
    permissions,
    questions,
  } as unknown as ThreadViewState;
}

function todoPart(
  id: string,
  todos: readonly {
    readonly id?: string;
    readonly content: string;
    readonly activeForm?: string;
    readonly status: string;
  }[],
  messageID?: string,
): Part {
  return part({
    id,
    ...(messageID === undefined ? {} : { messageID }),
    type: "tool",
    tool: "todowrite",
    state: { status: "completed", input: { todos }, metadata: {} },
  });
}

function planPart(id: string, messageID: string): Part {
  return part({
    id,
    messageID,
    type: "tool",
    tool: "plan_submit",
    state: {
      status: "completed",
      metadata: { plan: { title: "Tray plan", steps: [{ title: "Build it" }] } },
    },
  });
}

function planExecutionPart(messageID: string): Part {
  return part({
    id: "plan-execution",
    messageID,
    type: "text",
    text: "Implement the attached plan.",
    synthetic: true,
    metadata: {
      honkPlanExecution: {
        version: 1,
        planKey: "plan-1",
        planMessageID: "plan-assistant",
        assignedStepIDs: ["step-1"],
      },
    },
  });
}

describe("thread tray state", () => {
  it("keeps running TodoWrite progress out of the composer tray", () => {
    const state = threadTrayState(
      threadState({
        status: "running",
        parts: [
          todoPart("todos-1", [
            { content: "Keep", status: "in_progress" },
            { content: "Hide", status: "cancelled" },
          ]),
        ],
      }),
      dismissals,
    );

    expect(state).toBeNull();
  });

  it("keeps unfinished TodoWrite progress out of the composer tray after settling", () => {
    expect(
      threadTrayState(
        threadState({
          parts: [todoPart("todos-1", [{ content: "Still pending", status: "pending" }])],
        }),
        dismissals,
      ),
    ).toBeNull();
  });

  it("hides a settled completed list but leaves it available to the workbench", () => {
    expect(
      threadTrayState(
        threadState({
          parts: [todoPart("todos-1", [{ content: "Done", status: "completed" }])],
        }),
        dismissals,
      ),
    ).toBeNull();
  });

  it("gives a completed plan priority over stale tasks", () => {
    const state = threadTrayState(
      threadState({
        messages: [user("user-1"), assistant("assistant-1", modeAgentName("plan"))],
        parts: [
          todoPart("todos-1", [{ content: "Old task", status: "pending" }]),
          planPart("plan-1", "assistant-1"),
        ],
      }),
      dismissals,
    );

    expect(state).toMatchObject({ kind: "plan", followUp: { key: "plan-1" } });
  });

  it("opens the plan tray for an MCP plan submission carried as tool input", () => {
    expect(
      threadTrayState(
        threadState({
          messages: [user("user-1"), assistant("assistant-1", modeAgentName("plan"))],
          parts: [
            part({
              id: "plan-1",
              messageID: "assistant-1",
              type: "tool",
              tool: "honk_plan_submit",
              state: {
                status: "completed",
                input: { title: "Tray plan", steps: [{ title: "Build it" }] },
              },
            }),
          ],
        }),
        dismissals,
      ),
    ).toMatchObject({ kind: "plan", followUp: { key: "plan-1" } });
  });

  it("keeps the ready plan trigger after the composer mode changes", () => {
    expect(
      threadTrayState(
        threadState({
          messages: [user("user-1"), assistant("assistant-1", modeAgentName("plan"))],
          parts: [planPart("plan-1", "assistant-1")],
        }),
        dismissals,
      ),
    ).toMatchObject({ kind: "plan", followUp: { key: "plan-1" } });
  });

  it("keeps the active plan tracker attached to its transcript turn", () => {
    const projected = threadTrayState(
      threadState({
        status: "running",
        messages: [
          user("plan-user"),
          assistant("plan-assistant", modeAgentName("plan")),
          user("build-user"),
          assistant("build-assistant", modeAgentName("build")),
        ],
        parts: [
          planPart("plan-1", "plan-assistant"),
          planExecutionPart("build-user"),
          todoPart(
            "build-todos",
            [{ id: "step-1", content: "Build it", status: "in_progress" }],
            "build-assistant",
          ),
        ],
      }),
      dismissals,
    );

    expect(projected).toBeNull();
  });

  it("leaves stopped-plan rebuilds to the Plan surface and hides the tray once built", () => {
    const messages = [
      user("plan-user"),
      assistant("plan-assistant", modeAgentName("plan")),
      user("build-user"),
      assistant("build-assistant", modeAgentName("build")),
    ];
    const baseParts = [planPart("plan-1", "plan-assistant"), planExecutionPart("build-user")];

    expect(
      threadTrayState(
        threadState({
          messages,
          parts: [
            ...baseParts,
            todoPart(
              "pending-todos",
              [{ id: "step-1", content: "Build it", status: "pending" }],
              "build-assistant",
            ),
          ],
        }),
        dismissals,
      ),
    ).toBeNull();

    expect(
      threadTrayState(
        threadState({
          messages,
          parts: [
            ...baseParts,
            todoPart(
              "completed-todos",
              [{ id: "step-1", content: "Build it", status: "completed" }],
              "build-assistant",
            ),
          ],
        }),
        dismissals,
      ),
    ).toBeNull();
  });

  it("gives permission requests priority over a completed diagnosis", () => {
    const permission = {
      id: "permission-1",
      sessionID: "session-1",
      action: "bash",
      resources: ["pnpm test"],
    };
    const state = threadTrayState(
      threadState({
        messages: [user("user-1"), assistant("assistant-1", modeAgentName("debug"))],
        parts: [
          todoPart("todos-1", [{ content: "Old task", status: "pending" }]),
          part({
            id: "debug-1",
            messageID: "assistant-1",
            type: "tool",
            tool: "debug_submit",
            state: {
              status: "completed",
              metadata: {
                diagnosis: {
                  title: "Resize observer leak",
                  summary: "The observer survives editor transitions.",
                  rootCause: "The resize observer owns the leak.",
                  recommendedFix: "Dispose it with the editor.",
                  files: [],
                  verification: [],
                },
              },
            },
          }),
        ],
        permissions: [permission],
      }),
      dismissals,
    );

    expect(state).toEqual({
      kind: "request",
      permissions: [permission],
      questions: [],
    });
  });

  it("gives question requests priority over a completed plan", () => {
    const question = {
      id: "question-1",
      sessionID: "session-1",
      questions: [],
    };

    expect(
      threadTrayState(
        threadState({
          messages: [user("user-1"), assistant("assistant-1", modeAgentName("plan"))],
          parts: [planPart("plan-1", "assistant-1")],
          questions: [question],
        }),
        dismissals,
      ),
    ).toEqual({
      kind: "request",
      permissions: [],
      questions: [question],
    });
  });
});

describe("todo transcript summary", () => {
  it("uses Cursor's task content and completed-count ordinal while a task is working", () => {
    expect(
      todoSummaryLabel([
        { content: "Read the source", status: "completed" },
        { content: "Keep context", status: "pending" },
        {
          content: "Inspect the bundle",
          activeForm: "Inspecting the bundle",
          status: "in_progress",
        },
        { content: "Build the tray", status: "pending" },
      ]),
    ).toEqual({ label: "Inspect the bundle", position: "2/4" });
  });

  it("uses Cursor's completed To-do copy after work settles", () => {
    expect(
      todoSummaryLabel([
        { content: "Inspect", status: "completed" },
        { content: "Build", status: "pending" },
      ]),
    ).toEqual({ label: "1 of 2 To-dos Completed" });
  });

  it("uses Cursor's To-do count before any task completes", () => {
    expect(todoSummaryLabel([{ content: "Inspect", status: "pending" }])).toEqual({
      label: "1 To-dos",
    });
  });
});
