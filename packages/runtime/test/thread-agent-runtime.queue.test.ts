import { defineTool } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxToolCall, type UserMessage } from "@earendil-works/pi-ai";
import { Type } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentRuntimeEvent } from "@multi/contracts";
import {
  createRuntimeHarness,
  EMPTY_SEND_MESSAGE_OPTIONS,
  type RuntimeHarness,
  waitForEvent,
} from "./runtime-test-harness";

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

    await waitForEvent(harness.runtime, "tool.started", () =>
      harness.runtime.sendMessage("start", EMPTY_SEND_MESSAGE_OPTIONS),
    );
    await harness.runtime.steer("steer now", [
      {
        type: "image",
        name: "steer.png",
        mimeType: "image/png",
        sizeBytes: 5,
        dataUrl: "data:image/png;base64,c3RlZXI=",
      },
    ]);
    await harness.runtime.followUp("after current turn", [
      {
        type: "image",
        name: "follow-up.png",
        mimeType: "image/png",
        sizeBytes: 8,
        dataUrl: "data:image/png;base64,Zm9sbG93",
      },
    ]);
    releaseToolExecution?.();
    await harness.runtime.session.agent.waitForIdle();

    const tree = harness.runtime.getSessionTree();
    expect(
      tree.entries.filter((entry) => entry.role === "user").map((entry) => entry.text),
    ).toEqual(["start", "steer now", "after current turn"]);
    expect(
      harness.runtime.session.messages
        .filter((message): message is UserMessage => message.role === "user")
        .map((message) => message.content),
    ).toEqual([
      [{ type: "text", text: "start" }],
      [
        { type: "text", text: "steer now" },
        { type: "image", mimeType: "image/png", data: "c3RlZXI=" },
      ],
      [
        { type: "text", text: "after current turn" },
        { type: "image", mimeType: "image/png", data: "Zm9sbG93" },
      ],
    ]);
    expect(events.map((event) => event.type)).toContain("queue.updated");
  });
});
