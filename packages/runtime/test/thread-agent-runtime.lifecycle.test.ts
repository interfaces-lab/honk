import { fauxAssistantMessage, fauxText, fauxThinking } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentRuntimeEvent } from "@multi/contracts";
import {
  createRuntimeHarness,
  EMPTY_SEND_MESSAGE_OPTIONS,
  type RuntimeHarness,
  waitForEvent,
} from "./runtime-test-harness";

describe("ThreadAgentRuntime lifecycle", () => {
  const harnesses: RuntimeHarness[] = [];

  afterEach(() => {
    while (harnesses.length > 0) {
      harnesses.pop()?.cleanup();
    }
  });

  it("projects Pi prompt lifecycle events into runtime events", async () => {
    const harness = await createRuntimeHarness();
    harnesses.push(harness);
    const events: AgentRuntimeEvent[] = [];
    harness.runtime.subscribe((event) => events.push(event));
    harness.setResponses([
      fauxAssistantMessage([fauxThinking("checking the prompt"), fauxText("hello from pi")]),
    ]);

    const turnId = await waitForEvent(harness.runtime, "tree.updated", () =>
      harness.runtime.sendMessage("hello", EMPTY_SEND_MESSAGE_OPTIONS),
    );
    const eventTypes = events.map((event) => event.type);
    const agentStartedIndex = eventTypes.indexOf("agent.started");
    const turnStartedIndex = eventTypes.indexOf("turn.started");
    const turnCompletedIndex = eventTypes.indexOf("turn.completed");
    const agentCompletedIndex = eventTypes.indexOf("agent.completed");

    expect(eventTypes).toContain("agent.started");
    expect(eventTypes).toContain("turn.started");
    expect(eventTypes).toContain("message.completed");
    expect(eventTypes).toContain("turn.completed");
    expect(eventTypes).toContain("agent.completed");
    expect(eventTypes).toContain("tree.updated");
    expect(agentStartedIndex).toBeGreaterThanOrEqual(0);
    expect(turnStartedIndex).toBeGreaterThan(agentStartedIndex);
    expect(turnCompletedIndex).toBeGreaterThan(turnStartedIndex);
    expect(agentCompletedIndex).toBeGreaterThan(turnCompletedIndex);
    expect(events.find((event) => event.type === "turn.started")?.turnId).toBe(turnId);
    expect(events.find((event) => event.type === "agent.completed")?.turnId).toBeUndefined();
    expect(events.some((event) => event.turnId === turnId)).toBe(true);
    expect(events.some((event) => event.text === "hello from pi")).toBe(true);
    expect(events.some((event) => event.thinking === "checking the prompt")).toBe(true);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ messageRole: "user", text: "hello" }),
        expect.objectContaining({ messageRole: "assistant", text: "hello from pi" }),
      ]),
    );
    expect(
      events.some((event) => event.messageRole === "assistant" && event.text === "hello"),
    ).toBe(false);
    expect(harness.runtime.identity).toMatchObject({
      agentRuntime: "pi",
      threadId: harness.runtime.threadId,
      runtimeSessionId: harness.runtime.runtimeSessionId,
    });
  });
});
