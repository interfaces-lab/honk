import { defineTool } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentRuntimeEvent } from "@multi/contracts";
import { createRuntimeHarness, type RuntimeHarness } from "./runtime-test-harness";

function waitForEvent(events: readonly AgentRuntimeEvent[], type: AgentRuntimeEvent["type"]): Promise<void> {
  if (events.some((event) => event.type === type)) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (events.some((event) => event.type === type)) {
        clearInterval(timer);
        resolve();
      }
    }, 5);
  });
}

describe("ThreadAgentRuntime queue behavior", () => {
  const harnesses: RuntimeHarness[] = [];

  afterEach(() => {
    while (harnesses.length > 0) {
      harnesses.pop()?.cleanup();
    }
  });

  it("delivers steering before follow-up while a tool is running", async () => {
    let releaseToolExecution: (() => void) | undefined;
    const toolRelease = new Promise<void>((resolve) => {
      releaseToolExecution = resolve;
    });
    const waitTool = defineTool({
      name: "wait",
      label: "Wait",
      description: "Wait for release",
      parameters: Type.Object({}),
      execute: async () => {
        await toolRelease;
        return {
          content: [{ type: "text", text: "released" }],
          details: {},
        };
      },
    });
    const harness = await createRuntimeHarness({ customTools: [waitTool], tools: ["wait"] });
    harnesses.push(harness);
    const events: AgentRuntimeEvent[] = [];
    harness.runtime.subscribe((event) => events.push(event));
    harness.setResponses([
      fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
      fauxAssistantMessage("handled steer"),
      fauxAssistantMessage("handled follow-up"),
    ]);

    const promptPromise = harness.runtime.sendMessage("start");
    await waitForEvent(events, "tool.started");
    await harness.runtime.steer("steer now");
    await harness.runtime.followUp("after current turn");
    releaseToolExecution?.();
    await promptPromise;

    const tree = harness.runtime.getSessionTree();
    expect(tree.entries.filter((entry) => entry.role === "user").map((entry) => entry.text)).toEqual([
      "start",
      "steer now",
      "after current turn",
    ]);
    expect(events.map((event) => event.type)).toContain("queue.updated");
  });
});
