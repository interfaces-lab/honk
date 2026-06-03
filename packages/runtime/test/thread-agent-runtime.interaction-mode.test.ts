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
    instruction: "Answer the user directly.",
  },
  {
    mode: "plan",
    heading: "Multi Interaction Mode: Plan",
    instruction: "Produce a concrete implementation plan.",
  },
  {
    mode: "debug",
    heading: "Multi Interaction Mode: Debug",
    instruction: "Diagnose the issue first",
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
    async ({ mode, heading, instruction }) => {
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
      expect(observedSystemPrompts[0]).toContain(instruction);
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
    expect(startedEvent?.data).toEqual({
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
});
