import { describe, expect, it } from "vitest";

import { modeAgentName } from "../modes";
import type { ThreadViewState } from "../open-code-view";
import { latestSubmittedPlan, pendingDebugFollowUp, pendingPlanFollowUp } from "./follow-up";
import type { AssistantThreadMessage, ThreadPart, UserThreadMessage } from "./transcript-model";

const user = (id: string): UserThreadMessage =>
  ({ id, role: "user" }) as unknown as UserThreadMessage;
const assistant = (id: string, agent: string, completed = true): AssistantThreadMessage =>
  ({
    id,
    role: "assistant",
    agent,
    time: completed ? { completed: 1 } : {},
  }) as unknown as AssistantThreadMessage;
const part = (value: object): ThreadPart => value as unknown as ThreadPart;
const planPart = (id: string, messageID: string): ThreadPart =>
  part({
    id,
    messageID,
    type: "tool",
    tool: "plan_submit",
    state: {
      status: "completed",
      metadata: {
        plan: {
          title: "Fix tray behavior",
          summary: "Drive the tray from completed output.",
          steps: [{ title: "Project the result", detail: "Ignore the selected input mode." }],
          files: ["packages/app/src/thread/trays.tsx"],
        },
      },
    },
  });

const invalidPlanPart = (id: string, messageID: string): ThreadPart =>
  part({
    id,
    messageID,
    type: "tool",
    tool: "plan_submit",
    state: {
      status: "completed",
      metadata: { plan: { title: "", steps: [], files: [] } },
    },
  });

function threadState({
  messages,
  parts,
  status = "idle",
  permissions = [],
  questions = [],
}: {
  readonly messages: ThreadViewState["messages"];
  readonly parts: ThreadViewState["parts"];
  readonly status?: ThreadViewState["summary"]["status"];
  readonly permissions?: ThreadViewState["permissions"];
  readonly questions?: ThreadViewState["questions"];
}): ThreadViewState {
  return {
    summary: { status },
    messages,
    parts,
    permissions,
    questions,
  } as unknown as ThreadViewState;
}

describe("follow-up projection", () => {
  it("shows a plan follow-up only for the latest settled plan result", () => {
    const state = threadState({
      messages: [user("u1"), assistant("a1", modeAgentName("plan"))],
      parts: [planPart("plan-1", "a1")],
    });

    expect(pendingPlanFollowUp(state)).toMatchObject({
      key: "plan-1",
      messageID: "a1",
      plan: { title: "Fix tray behavior" },
    });
  });

  it("does not infer a plan from plan-mode text without a submitted artifact", () => {
    const state = threadState({
      messages: [user("u1"), assistant("a1", modeAgentName("plan"))],
      parts: [part({ id: "text-1", messageID: "a1", type: "text", text: "A prose plan" })],
    });

    expect(pendingPlanFollowUp(state)).toBeNull();
  });

  it("does not open the tray for an empty plan artifact", () => {
    const state = threadState({
      messages: [user("u1"), assistant("a1", modeAgentName("plan"))],
      parts: [invalidPlanPart("plan-1", "a1")],
    });

    expect(pendingPlanFollowUp(state)).toBeNull();
  });

  it("does not show a stale plan when the latest assistant is in another mode", () => {
    const state = threadState({
      messages: [
        user("u1"),
        assistant("a1", modeAgentName("plan")),
        assistant("a2", modeAgentName("build")),
      ],
      parts: [planPart("plan-1", "a1")],
    });

    expect(pendingPlanFollowUp(state)).toBeNull();
  });

  it("waits for a running plan turn to settle", () => {
    const state = threadState({
      status: "running",
      messages: [user("u1"), assistant("a1", modeAgentName("plan"), false)],
      parts: [planPart("plan-1", "a1")],
    });

    expect(pendingPlanFollowUp(state)).toBeNull();
  });

  it("does not reopen a plan follow-up after a later user turn", () => {
    const state = threadState({
      messages: [
        user("u1"),
        assistant("a1", modeAgentName("plan")),
        user("u2"),
        assistant("a2", modeAgentName("build")),
      ],
      parts: [planPart("plan-1", "a1")],
    });

    expect(pendingPlanFollowUp(state)).toBeNull();
  });

  it("does not compete with pending user input", () => {
    const state = threadState({
      messages: [user("u1"), assistant("a1", modeAgentName("plan"))],
      parts: [planPart("plan-1", "a1")],
      questions: [{} as ThreadViewState["questions"][number]],
    });

    expect(pendingPlanFollowUp(state)).toBeNull();
  });

  it("shows debug actions only for the latest completed debug assistant", () => {
    const state = threadState({
      messages: [user("u1"), assistant("a1", modeAgentName("debug"))],
      parts: [
        part({ id: "debug-1", messageID: "a1", type: "text", text: "Root cause found." }),
        part({
          id: "debug-2",
          messageID: "a1",
          type: "text",
          text: "hidden",
          synthetic: true,
        }),
      ],
    });

    expect(pendingDebugFollowUp(state)).toEqual({ key: "a1", hint: "Root cause found." });
  });

  it("does not show stale debug actions after a later build assistant", () => {
    const state = threadState({
      messages: [
        user("u1"),
        assistant("a1", modeAgentName("debug")),
        assistant("a2", modeAgentName("build")),
      ],
      parts: [part({ id: "debug-1", messageID: "a1", type: "text", text: "Old diagnosis" })],
    });

    expect(pendingDebugFollowUp(state)).toBeNull();
  });

  it("keeps the latest submitted plan available to the workbench after later turns", () => {
    const parts = [
      planPart("plan-1", "a1"),
      part({ id: "text-2", messageID: "a2", type: "text", text: "Implementation started" }),
    ];

    expect(latestSubmittedPlan(parts)).toMatchObject({
      key: "plan-1",
      plan: { title: "Fix tray behavior" },
    });
  });
});
