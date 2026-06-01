import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentRuntimeEvent } from "@multi/contracts";
import { createRuntimeHarness, type RuntimeHarness } from "./runtime-test-harness";

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
    harness.setResponses([fauxAssistantMessage("hello from pi")]);

    const turnId = await harness.runtime.sendMessage("hello");

    expect(events.map((event) => event.type)).toContain("turn.started");
    expect(events.map((event) => event.type)).toContain("message.completed");
    expect(events.map((event) => event.type)).toContain("turn.completed");
    expect(events.map((event) => event.type)).toContain("tree.updated");
    expect(events.some((event) => event.turnId === turnId)).toBe(true);
    expect(events.some((event) => event.text === "hello from pi")).toBe(true);
    expect(harness.runtime.identity).toMatchObject({
      agentRuntime: "pi",
      threadId: harness.runtime.threadId,
      runtimeSessionId: harness.runtime.runtimeSessionId,
    });
  });
});
