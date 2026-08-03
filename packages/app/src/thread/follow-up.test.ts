import { describe, expect, it } from "vitest";

import { modeAgentName } from "../modes";
import type { ThreadViewState } from "../open-code-view";
import {
  claimStrandedFollowUp,
  debugBuildPrompt,
  latestSubmittedPlan,
  pendingDebugFollowUp,
  pendingPlanFollowUp,
  strandedFollowUp,
  threadQueueCanDrain,
} from "./follow-up";
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

const debugPart = (id: string, messageID: string): ThreadPart =>
  part({
    id,
    messageID,
    type: "tool",
    tool: "debug_submit",
    state: {
      status: "completed",
      metadata: {
        diagnosis: {
          title: "Resize observer leak",
          summary: "The observer survives the editor transition.",
          rootCause: "The resize observer remains subscribed after unmount.",
          recommendedFix: "Dispose it in the editor cleanup.",
          files: ["packages/app/src/thread/composer.tsx"],
          verification: ["Run the focused composer test."],
        },
      },
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
    activity: status === "running" ? "busy" : "idle",
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
      plan: {
        title: "Fix tray behavior",
        steps: [{ id: "step-1", title: "Project the result" }],
      },
    });
  });

  it("reads an MCP plan submission from the tool input when no metadata is attached", () => {
    const state = threadState({
      messages: [user("u1"), assistant("a1", modeAgentName("plan"))],
      parts: [
        part({
          id: "plan-1",
          messageID: "a1",
          type: "tool",
          tool: "honk_plan_submit",
          state: {
            status: "completed",
            input: {
              title: "Fix tray behavior",
              summary: "Drive the tray from completed output.",
              steps: [{ title: "Project the result", detail: "Ignore the selected input mode." }],
              files: ["packages/app/src/thread/trays.tsx"],
            },
          },
        }),
      ],
    });

    expect(pendingPlanFollowUp(state)).toMatchObject({
      key: "plan-1",
      messageID: "a1",
      plan: {
        title: "Fix tray behavior",
        summary: "Drive the tray from completed output.",
        steps: [{ id: "step-1", title: "Project the result" }],
        files: ["packages/app/src/thread/trays.tsx"],
      },
    });
  });

  it("reads an MCP diagnosis from the tool input when no metadata is attached", () => {
    const state = threadState({
      messages: [user("u1"), assistant("a1", modeAgentName("debug"))],
      parts: [
        part({
          id: "debug-1",
          messageID: "a1",
          type: "tool",
          tool: "honk_debug_submit",
          state: {
            status: "completed",
            input: {
              title: "Resize observer leak",
              summary: "The observer survives the editor transition.",
              rootCause: "The resize observer remains subscribed after unmount.",
              recommendedFix: "Dispose it in the editor cleanup.",
              files: ["packages/app/src/thread/composer.tsx"],
              verification: ["Run the focused composer test."],
            },
          },
        }),
      ],
    });

    expect(pendingDebugFollowUp(state)).toMatchObject({
      key: "debug-1",
      messageID: "a1",
      diagnosis: {
        title: "Resize observer leak",
        rootCause: "The resize observer remains subscribed after unmount.",
        recommendedFix: "Dispose it in the editor cleanup.",
        files: ["packages/app/src/thread/composer.tsx"],
        verification: ["Run the focused composer test."],
      },
    });
  });

  it("still reads legacy plugin submissions from hook metadata", () => {
    expect(latestSubmittedPlan([planPart("plan-1", "a1")])).toMatchObject({
      key: "plan-1",
      plan: { title: "Fix tray behavior", steps: [{ id: "step-1" }] },
    });
    expect(
      pendingDebugFollowUp(
        threadState({
          messages: [user("u1"), assistant("a1", modeAgentName("debug"))],
          parts: [debugPart("debug-1", "a1")],
        }),
      ),
    ).toMatchObject({ key: "debug-1", diagnosis: { title: "Resize observer leak" } });
  });

  it("preserves submitted step IDs and gives older artifacts deterministic IDs", () => {
    const legacy = latestSubmittedPlan([planPart("plan-1", "a1")]);
    const identified = latestSubmittedPlan([
      part({
        id: "plan-2",
        messageID: "a2",
        type: "tool",
        tool: "plan_submit",
        state: {
          status: "completed",
          metadata: {
            plan: {
              title: "Stable plan",
              steps: [{ id: "todo-keep", title: "Keep this identity" }],
            },
          },
        },
      }),
    ]);

    expect(legacy?.plan.steps[0]?.id).toBe("step-1");
    expect(identified?.plan.steps[0]?.id).toBe("todo-keep");
  });

  it("does not infer a plan from plan-mode text without a submitted artifact", () => {
    const state = threadState({
      messages: [user("u1"), assistant("a1", modeAgentName("plan"))],
      parts: [part({ id: "text-1", messageID: "a1", type: "text", text: "A prose plan" })],
    });

    expect(pendingPlanFollowUp(state)).toBeNull();
  });

  it("does not trigger from a plan artifact attached to a non-plan assistant", () => {
    const state = threadState({
      messages: [user("u1"), assistant("a1", modeAgentName("build"))],
      parts: [planPart("plan-1", "a1")],
    });

    expect(pendingPlanFollowUp(state)).toBeNull();
  });

  it("waits for the latest plan assistant message itself to complete", () => {
    const state = threadState({
      messages: [
        user("u1"),
        assistant("a1", modeAgentName("plan")),
        assistant("a2", modeAgentName("plan"), false),
      ],
      parts: [planPart("plan-1", "a1")],
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

  it("does not hide a settled root plan only because a child session is running", () => {
    const base = threadState({
      messages: [user("u1"), assistant("a1", modeAgentName("plan"))],
      parts: [planPart("plan-1", "a1")],
    });
    const state: ThreadViewState = {
      ...base,
      summary: { ...base.summary, status: "running" },
      activity: "idle" as const,
    };

    expect(pendingPlanFollowUp(state)).toMatchObject({ key: "plan-1" });
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

  it("shows debug actions only for a recorded diagnosis on the latest debug assistant", () => {
    const state = threadState({
      messages: [user("u1"), assistant("a1", modeAgentName("debug"))],
      parts: [debugPart("debug-1", "a1")],
    });

    expect(pendingDebugFollowUp(state)).toMatchObject({
      key: "debug-1",
      messageID: "a1",
      diagnosis: { title: "Resize observer leak" },
    });
  });

  it("does not treat unstructured debug prose as an approved fix", () => {
    const state = threadState({
      messages: [user("u1"), assistant("a1", modeAgentName("debug"))],
      parts: [part({ id: "debug-1", messageID: "a1", type: "text", text: "Root cause found." })],
    });

    expect(pendingDebugFollowUp(state)).toBeNull();
  });

  it("does not show stale debug actions after a later build assistant", () => {
    const state = threadState({
      messages: [
        user("u1"),
        assistant("a1", modeAgentName("debug")),
        assistant("a2", modeAgentName("build")),
      ],
      parts: [debugPart("debug-1", "a1")],
    });

    expect(pendingDebugFollowUp(state)).toBeNull();
  });

  it("hands the accepted diagnosis to Build with its verification context", () => {
    expect(
      debugBuildPrompt({
        title: "Resize observer leak",
        summary: "The observer survives the editor transition.",
        rootCause: "The resize observer remains subscribed after unmount.",
        recommendedFix: "Dispose it in the editor cleanup.",
        files: ["packages/app/src/thread/composer.tsx"],
        verification: ["Run the focused composer test."],
      }),
    ).toContain("Required verification: Run the focused composer test.");
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

describe("stranded follow-up redelivery", () => {
  it("waits for both the run and its pending request to settle", () => {
    expect(threadQueueCanDrain({ activity: "busy", needsAttention: false })).toBe(false);
    expect(threadQueueCanDrain({ activity: "idle", needsAttention: true })).toBe(false);
    expect(threadQueueCanDrain({ activity: "idle", needsAttention: false })).toBe(true);
  });

  it("redelivers the trailing unanswered user message once the session is idle", () => {
    const state = threadState({
      messages: [user("u1"), assistant("a1", modeAgentName("build")), user("u2")],
      parts: [
        part({ id: "t2", messageID: "u2", type: "text", text: "use the tray" }),
        part({
          id: "f2",
          messageID: "u2",
          type: "file",
          mime: "image/png",
          filename: "shot.png",
          url: "data:image/png;base64,AA",
        }),
      ],
    });

    expect(strandedFollowUp(state)).toEqual({
      messageID: "u2",
      text: "use the tray",
      files: [{ uri: "data:image/png;base64,AA", description: "image/png", name: "shot.png" }],
    });
  });

  it("keeps quiet while the run is live or the trailing turn is answered", () => {
    const answered = threadState({
      messages: [user("u1"), assistant("a1", modeAgentName("build"))],
      parts: [part({ id: "t1", messageID: "u1", type: "text", text: "hi" })],
    });
    const running = threadState({
      status: "running",
      messages: [user("u1"), assistant("a1", modeAgentName("build"), false), user("u2")],
      parts: [part({ id: "t2", messageID: "u2", type: "text", text: "steer" })],
    });

    expect(strandedFollowUp(answered)).toBeNull();
    expect(strandedFollowUp(running)).toBeNull();
  });

  it("does not race a pending question or permission dialog", () => {
    const state = threadState({
      messages: [user("u1"), assistant("a1", modeAgentName("build")), user("u2")],
      parts: [part({ id: "t2", messageID: "u2", type: "text", text: "steer" })],
      questions: [{} as ThreadViewState["questions"][number]],
    });

    expect(strandedFollowUp(state)).toBeNull();
  });

  it("skips an admission receipt whose parts have not arrived", () => {
    const state = threadState({
      messages: [user("u1"), assistant("a1", modeAgentName("build")), user("u2")],
      parts: [],
    });

    expect(strandedFollowUp(state)).toBeNull();
  });

  it("preserves the synthetic flag and metadata of a batched submission", () => {
    const state = threadState({
      messages: [user("u1"), assistant("a1", modeAgentName("build")), user("u2")],
      parts: [
        part({
          id: "t2",
          messageID: "u2",
          type: "text",
          text: "run all",
          synthetic: true,
          metadata: { queuedTasks: true },
        }),
      ],
    });

    expect(strandedFollowUp(state)).toEqual({
      messageID: "u2",
      text: "run all",
      files: [],
      synthetic: true,
      metadata: { queuedTasks: true },
    });
  });

  it("claims only one automatic redelivery attempt per message ID", () => {
    const claimedMessageIDs = new Set<string>();
    const first = threadState({
      messages: [user("u1"), assistant("a1", modeAgentName("build")), user("u2")],
      parts: [part({ id: "t2", messageID: "u2", type: "text", text: "steer once" })],
    });
    const next = threadState({
      messages: [
        user("u1"),
        assistant("a1", modeAgentName("build")),
        user("u2"),
        assistant("a2", modeAgentName("build")),
        user("u3"),
      ],
      parts: [
        part({ id: "t2", messageID: "u2", type: "text", text: "steer once" }),
        part({ id: "t3", messageID: "u3", type: "text", text: "new follow-up" }),
      ],
    });

    expect(claimStrandedFollowUp(first, claimedMessageIDs)?.messageID).toBe("u2");
    expect(claimStrandedFollowUp(first, claimedMessageIDs)).toBeNull();
    expect(claimStrandedFollowUp(next, claimedMessageIDs)?.messageID).toBe("u3");
  });
});
