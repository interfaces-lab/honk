import { fauxAssistantMessage, type Context, type UserMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentRuntimeEvent } from "@multi/contracts";
import {
  createRuntimeHarness,
  EMPTY_SEND_MESSAGE_OPTIONS,
  type RuntimeHarness,
  waitForEvent,
} from "./runtime-test-harness";

const MODE_EXPECTATIONS = [
  {
    mode: "ask",
    heading: "Multi Interaction Mode: Ask",
    expectedGuidance: ["Answer the user directly."],
  },
  {
    mode: "plan",
    heading: "Multi Interaction Mode: Plan",
    expectedGuidance: [
      "Produce a concrete implementation plan through Multi's built-in Pi planning surface.",
      "Research the codebase to find relevant files and review relevant docs before planning.",
      "Ask clarifying questions when requirements are ambiguous or the plan depends on missing decisions.",
      "Use the create_plan tool as the final action once the plan is ready for review.",
      "The create_plan payload should include a short name, overview, actionable todos, isProject, optional phases, and a complete Markdown plan.",
      "The Markdown plan should include diagnosis, implementation steps with file paths or code references, verification, risks, and non-goals.",
      "Stop after creating the plan so the user can review, edit, or approve it before implementation.",
      "Do not change files, run mutating shell commands, create commits, or execute the plan.",
    ],
  },
  {
    mode: "debug",
    heading: "Multi Interaction Mode: Debug",
    expectedGuidance: ["Diagnose the issue first"],
  },
] as const;

describe("ThreadAgentRuntime interaction modes", () => {
  const harnesses: RuntimeHarness[] = [];

  afterEach(() => {
    while (harnesses.length > 0) {
      harnesses.pop()?.cleanup();
    }
  });

  it.each(MODE_EXPECTATIONS)(
    "adds $mode guidance to the provider system prompt without changing the user message",
    async ({ mode, heading, expectedGuidance }) => {
      const harness = await createRuntimeHarness();
      harnesses.push(harness);
      const observedSystemPrompts: string[] = [];
      harness.setResponses([
        (context: Context) => {
          observedSystemPrompts.push(context.systemPrompt ?? "");
          return fauxAssistantMessage("ok");
        },
      ]);

      await waitForEvent(harness.runtime, "tree.updated", () =>
        harness.runtime.sendMessage("explain the failure", {
          ...EMPTY_SEND_MESSAGE_OPTIONS,
          interactionMode: mode,
        }),
      );

      expect(observedSystemPrompts[0]).toContain(heading);
      for (const guidance of expectedGuidance) {
        expect(observedSystemPrompts[0]).toContain(guidance);
      }
      expect(
        harness.runtime.session.messages
          .filter((message): message is UserMessage => message.role === "user")
          .map((message) => message.content),
      ).toEqual([[{ type: "text", text: "explain the failure" }]]);
      expect(
        harness.runtime
          .getSessionTree()
          .entries.filter((entry) => entry.role === "user")
          .map((entry) => entry.text),
      ).toEqual(["explain the failure"]);
    },
  );

  it("does not leak a mode prompt into the next agent turn", async () => {
    const harness = await createRuntimeHarness();
    harnesses.push(harness);
    const observedSystemPrompts: string[] = [];
    harness.setResponses([
      (context: Context) => {
        observedSystemPrompts.push(context.systemPrompt ?? "");
        return fauxAssistantMessage("planned");
      },
      (context: Context) => {
        observedSystemPrompts.push(context.systemPrompt ?? "");
        return fauxAssistantMessage("done");
      },
    ]);

    await waitForEvent(harness.runtime, "tree.updated", () =>
      harness.runtime.sendMessage("plan it", {
        ...EMPTY_SEND_MESSAGE_OPTIONS,
        interactionMode: "plan",
      }),
    );
    await waitForEvent(harness.runtime, "tree.updated", () =>
      harness.runtime.sendMessage("now do it", EMPTY_SEND_MESSAGE_OPTIONS),
    );

    expect(observedSystemPrompts[0]).toContain("Multi Interaction Mode: Plan");
    expect(observedSystemPrompts[1]).not.toContain("Multi Interaction Mode:");
  });

  it("emits a proposed plan event for completed plan-mode turns", async () => {
    const harness = await createRuntimeHarness();
    harnesses.push(harness);
    const events: AgentRuntimeEvent[] = [];
    harness.runtime.subscribe((event) => events.push(event));
    harness.setResponses([fauxAssistantMessage("# Plan\n\n1. Do the work.")]);

    await waitForEvent(harness.runtime, "tree.updated", () =>
      harness.runtime.sendMessage("make a plan", {
        ...EMPTY_SEND_MESSAGE_OPTIONS,
        interactionMode: "plan",
        sourceProposedPlan: {
          threadId: harness.runtime.threadId,
          planId: "plan:source",
        },
      }),
    );

    const startedEvent = events.find((event) => event.type === "turn.started");
    expect(startedEvent?.data).toMatchObject({
      sourceProposedPlan: {
        threadId: harness.runtime.threadId,
        planId: "plan:source",
      },
    });

    const planEvent = events.find((event) => event.type === "turn.proposed.completed");
    expect(planEvent?.data).toEqual({
      planId: `plan:${harness.runtime.threadId}:${planEvent?.turnId}`,
      planMarkdown: "# Plan\n\n1. Do the work.",
    });
  });

  it("does not capture clarifying questions as proposed plans", async () => {
    const harness = await createRuntimeHarness();
    harnesses.push(harness);
    const events: AgentRuntimeEvent[] = [];
    harness.runtime.subscribe((event) => events.push(event));
    harness.setResponses([fauxAssistantMessage("Which package should I inspect first?")]);

    await waitForEvent(harness.runtime, "tree.updated", () =>
      harness.runtime.sendMessage("make a plan", {
        ...EMPTY_SEND_MESSAGE_OPTIONS,
        interactionMode: "plan",
      }),
    );

    expect(events.filter((event) => event.type === "turn.proposed.completed")).toHaveLength(0);
  });
});
