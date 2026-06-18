import { defineTool } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxToolCall, type UserMessage } from "@earendil-works/pi-ai";
import { Type } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { MessageId, type AgentRuntimeEvent } from "@honk/contracts";
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

  it("queues active sendMessage follow-ups in the Pi session before agent completion", async () => {
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
      fauxAssistantMessage("finished initial turn"),
      fauxAssistantMessage("handled queued one"),
      fauxAssistantMessage("handled queued two"),
    ]);

    await waitForEvent(harness.runtime, "tool.started", () =>
      harness.runtime.sendMessage("start", EMPTY_SEND_MESSAGE_OPTIONS),
    );

    const queuedOneMessageId = MessageId.make("message:queued-follow-up-one");
    const queuedTwoMessageId = MessageId.make("message:queued-follow-up-two");
    const queuedOneTurnId = await harness.runtime.sendMessage("queued one", {
      ...EMPTY_SEND_MESSAGE_OPTIONS,
      clientMessageId: queuedOneMessageId,
      streamingBehavior: "followUp",
    });
    const queuedTwoTurnId = await harness.runtime.sendMessage("queued two", {
      ...EMPTY_SEND_MESSAGE_OPTIONS,
      clientMessageId: queuedTwoMessageId,
      streamingBehavior: "followUp",
    });

    releaseToolExecution?.();
    await harness.runtime.session.agent.waitForIdle();

    const eventTypes = events.map((event) => event.type);
    const agentCompletedIndex = eventTypes.lastIndexOf("agent.completed");
    const queuedTwoMessageIndex = events.findIndex(
      (event) => event.type === "message.completed" && event.text === "queued two",
    );
    expect(queuedTwoMessageIndex).toBeGreaterThanOrEqual(0);
    expect(agentCompletedIndex).toBeGreaterThan(queuedTwoMessageIndex);
    expect(eventTypes).toContain("queue.updated");
    expect(events.filter((event) => event.type === "agent.completed")).toHaveLength(1);

    const turnStartedIds = events
      .filter((event) => event.type === "turn.started")
      .map((event) => event.turnId);
    expect(turnStartedIds).toContain(queuedOneTurnId);
    expect(turnStartedIds).toContain(queuedTwoTurnId);

    const tree = harness.runtime.getSessionTree();
    const userEntries = tree.entries.filter((entry) => entry.role === "user");
    expect(userEntries.map((entry) => entry.text)).toEqual(["start", "queued one", "queued two"]);
    expect(userEntries.find((entry) => entry.text === "queued one")).toEqual(
      expect.objectContaining({
        clientMessageId: queuedOneMessageId,
        turnId: queuedOneTurnId,
      }),
    );
    expect(userEntries.find((entry) => entry.text === "queued two")).toEqual(
      expect.objectContaining({
        clientMessageId: queuedTwoMessageId,
        turnId: queuedTwoTurnId,
      }),
    );
  });
});
