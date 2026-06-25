import { defineTool, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxToolCall, type UserMessage } from "@earendil-works/pi-ai";
import { Type } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageId, type AgentRuntimeEvent, type RuntimeIngestionRecord } from "@honk/contracts";
import {
  createRuntimeHarness,
  EMPTY_SEND_MESSAGE_OPTIONS,
  type RuntimeHarness,
  waitForEvent,
} from "./runtime-test-harness";

function canonicalModelSelection() {
  return {
    instanceId: "codex",
    model: "gpt-5.5",
  };
}

async function createRuntimeBlockedOnTool(
  harnesses: RuntimeHarness[],
  options: { readonly extensionFactories?: readonly ExtensionFactory[] } = {},
) {
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
  const harness = await createRuntimeHarness({
    customTools: [waitTool],
    tools: ["wait"],
    ...(options.extensionFactories ? { extensionFactories: options.extensionFactories } : {}),
  });
  harnesses.push(harness);

  return {
    harness,
    releaseToolExecution: () => releaseToolExecution?.(),
  };
}

function collectRuntimeEvents(runtime: RuntimeHarness["runtime"]) {
  const events: AgentRuntimeEvent[] = [];
  runtime.subscribe((event) => events.push(event));
  return events;
}

function collectRuntimeIngestionRecords(runtime: RuntimeHarness["runtime"]) {
  const records: RuntimeIngestionRecord[] = [];
  runtime.subscribeRuntimeIngestionRecords((nextRecords) => {
    records.push(...nextRecords);
  });
  return records;
}

function queuedFollowUpInput(input: {
  readonly harness: RuntimeHarness;
  readonly clientMessageId: MessageId;
  readonly text: string;
}) {
  const modelSelection = canonicalModelSelection();
  return {
    threadId: input.harness.runtime.threadId,
    cwd: input.harness.tempDir,
    input: input.text,
    interactionMode: "agent" as const,
    sourceProposedPlan: null,
    clientMessageId: input.clientMessageId,
    replacesClientMessageId: null,
    images: [],
    policy: {
      agentMode: "deep" as const,
      interactionMode: "agent" as const,
      modelSelection: { type: "pi-managed" as const },
      fast: false,
      thinkingLevel: "high" as const,
      allowedToolNames: [],
      excludedToolNames: [],
    },
    modelSelection,
    runtimeMode: "full-access" as const,
    titleSeed: input.text,
    createdAt: new Date().toISOString(),
  };
}

describe("ThreadAgentRuntime canonical queued follow-up behavior", () => {
  const harnesses: RuntimeHarness[] = [];

  afterEach(() => {
    while (harnesses.length > 0) {
      harnesses.pop()?.cleanup();
    }
  });

  it("keeps one logical turn id across Pi internal tool turns", async () => {
    const { harness, releaseToolExecution } = await createRuntimeBlockedOnTool(harnesses);
    const events = collectRuntimeEvents(harness.runtime);
    harness.setResponses([
      fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
      fauxAssistantMessage("finished after tool"),
    ]);

    const turnId = await waitForEvent(harness.runtime, "tool.started", () =>
      harness.runtime.sendMessage("start", EMPTY_SEND_MESSAGE_OPTIONS),
    );
    const finalTreeUpdated = new Promise<void>((resolve) => {
      const unsubscribe = harness.runtime.subscribe((event) => {
        if (event.type === "tree.updated" && event.turnId === turnId) {
          unsubscribe();
          resolve();
        }
      });
    });
    releaseToolExecution();
    await harness.runtime.session.agent.waitForIdle();
    await finalTreeUpdated;

    const entryTurnIds = new Set(
      harness.runtime
        .getSessionTree()
        .entries.map((entry) => entry.turnId)
        .filter((entryTurnId): entryTurnId is NonNullable<typeof entryTurnId> =>
          Boolean(entryTurnId),
        )
        .map(String),
    );
    const runtimeTurnIds = new Set(
      events
        .filter((event) => event.turnId !== undefined)
        .map((event) => String(event.turnId)),
    );

    expect(entryTurnIds).toEqual(new Set([String(turnId)]));
    expect(runtimeTurnIds).toEqual(new Set([String(turnId)]));
  });

  it("keeps Pi steer and Pi followUp semantics distinct while tool work is active", async () => {
    const { harness, releaseToolExecution } = await createRuntimeBlockedOnTool(harnesses);
    const events = collectRuntimeEvents(harness.runtime);
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
    releaseToolExecution();
    await harness.runtime.session.agent.waitForIdle();

    expect(
      harness.runtime
        .getSessionTree()
        .entries.filter((entry) => entry.role === "user")
        .map((entry) => entry.text),
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

  it("hands active send follow-ups to Pi before emitting the terminal agent completion", async () => {
    const { harness, releaseToolExecution } = await createRuntimeBlockedOnTool(harnesses);
    const events = collectRuntimeEvents(harness.runtime);
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

    releaseToolExecution();
    await harness.runtime.session.agent.waitForIdle();

    const eventTypes = events.map((event) => event.type);
    const agentCompletedIndex = eventTypes.lastIndexOf("agent.completed");
    const queuedTwoMessageIndex = events.findIndex(
      (event) => event.type === "message.completed" && event.text === "queued two",
    );
    expect(queuedTwoMessageIndex).toBeGreaterThanOrEqual(0);
    expect(agentCompletedIndex).toBeGreaterThan(queuedTwoMessageIndex);
    expect(events.filter((event) => event.type === "agent.completed")).toHaveLength(1);

    const turnStartedIds = events
      .filter((event) => event.type === "turn.started")
      .map((event) => event.turnId);
    expect(turnStartedIds).toContain(queuedOneTurnId);
    expect(turnStartedIds).toContain(queuedTwoTurnId);

    const userEntries = harness.runtime
      .getSessionTree()
      .entries.filter((entry) => entry.role === "user");
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

  it("hands queued composer follow-ups to Pi through AgentSession.followUp", async () => {
    const { harness, releaseToolExecution } = await createRuntimeBlockedOnTool(harnesses);
    const events = collectRuntimeEvents(harness.runtime);
    const piQueueUpdates: Array<{ steering: readonly string[]; followUp: readonly string[] }> = [];
    harness.runtime.session.subscribe((event) => {
      if (event.type === "queue_update") {
        piQueueUpdates.push({ steering: event.steering, followUp: event.followUp });
      }
    });
    harness.setResponses([
      fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
      fauxAssistantMessage("finished initial turn"),
      fauxAssistantMessage("handled queued composer follow-up"),
    ]);

    await waitForEvent(harness.runtime, "tool.started", () =>
      harness.runtime.sendMessage("start", EMPTY_SEND_MESSAGE_OPTIONS),
    );

    const followUpSpy = vi.spyOn(harness.runtime.session, "followUp");
    const clientMessageId = MessageId.make("message:queued-composer-follow-up");
    harness.runtime.enqueueFollowUp(
      queuedFollowUpInput({
        harness,
        clientMessageId,
        text: "queued from composer",
      }),
    );

    const agentCompleted = new Promise<AgentRuntimeEvent>((resolve) => {
      const unsubscribe = harness.runtime.subscribe((event) => {
        if (event.type === "agent.completed") {
          unsubscribe();
          resolve(event);
        }
      });
    });
    releaseToolExecution();
    await agentCompleted;

    expect(followUpSpy).toHaveBeenCalledWith("queued from composer", []);
    expect(piQueueUpdates.some((update) => update.followUp.includes("queued from composer"))).toBe(
      true,
    );
    expect(harness.runtime.getQueuedFollowUps()).toHaveLength(0);
    expect(events.filter((event) => event.type === "agent.completed")).toHaveLength(1);
    expect(
      harness.runtime
        .getSessionTree()
        .entries.filter((entry) => entry.role === "user")
        .map((entry) => entry.text),
    ).toEqual(["start", "queued from composer"]);
  });

  it("restores queued composer follow-up and completes the active run when Pi rejects handoff", async () => {
    const commandExtension: ExtensionFactory = (pi) => {
      pi.registerCommand("testcmd", {
        description: "Test command",
        handler: async () => undefined,
      });
    };
    const { harness, releaseToolExecution } = await createRuntimeBlockedOnTool(harnesses, {
      extensionFactories: [commandExtension],
    });
    const events = collectRuntimeEvents(harness.runtime);
    harness.setResponses([
      fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
      fauxAssistantMessage("finished initial turn"),
    ]);

    await waitForEvent(harness.runtime, "tool.started", () =>
      harness.runtime.sendMessage("start", EMPTY_SEND_MESSAGE_OPTIONS),
    );

    const clientMessageId = MessageId.make("message:queued-rejected-extension-command");
    harness.runtime.enqueueFollowUp(
      queuedFollowUpInput({
        harness,
        clientMessageId,
        text: "/testcmd",
      }),
    );

    const agentCompleted = new Promise<AgentRuntimeEvent>((resolve) => {
      const unsubscribe = harness.runtime.subscribe((event) => {
        if (event.type === "agent.completed") {
          unsubscribe();
          resolve(event);
        }
      });
    });
    releaseToolExecution();
    await agentCompleted;
    await harness.runtime.session.agent.waitForIdle();

    expect(harness.runtime.isBusy()).toBe(false);
    expect(harness.runtime.getQueuedFollowUps()).toEqual([
      expect.objectContaining({ clientMessageId, input: "/testcmd" }),
    ]);
    expect(events.filter((event) => event.type === "agent.completed")).toHaveLength(1);
    expect(events.find((event) => event.type === "runtime.error")?.summary).toContain(
      'Extension command "/testcmd" cannot be queued.',
    );
    expect(
      harness.runtime
        .getSessionTree()
        .entries.filter((entry) => entry.role === "user")
        .map((entry) => entry.text),
    ).toEqual(["start"]);
  });

  it("emits canonical user turn-start ingestion for an active follow-up client message", async () => {
    const { harness, releaseToolExecution } = await createRuntimeBlockedOnTool(harnesses);
    const events = collectRuntimeEvents(harness.runtime);
    const ingestionRecords = collectRuntimeIngestionRecords(harness.runtime);
    harness.setResponses([
      fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
      fauxAssistantMessage("finished initial turn"),
      fauxAssistantMessage("handled active follow-up"),
    ]);

    await waitForEvent(harness.runtime, "tool.started", () =>
      harness.runtime.sendMessage("start", EMPTY_SEND_MESSAGE_OPTIONS),
    );

    const clientMessageId = MessageId.make("message:active-follow-up");
    const modelSelection = canonicalModelSelection();
    const followUpTurnId = await harness.runtime.sendMessage("active follow-up", {
      ...EMPTY_SEND_MESSAGE_OPTIONS,
      clientMessageId,
      streamingBehavior: "followUp",
      runtimeUserTurnStart: {
        modelSelection,
        titleSeed: "active follow-up",
      },
    });

    releaseToolExecution();
    await harness.runtime.session.agent.waitForIdle();

    expect(
      events.find(
        (event) =>
          event.type === "message.completed" &&
          event.messageRole === "user" &&
          event.text === "active follow-up",
      ),
    ).toEqual(
      expect.objectContaining({
        turnId: followUpTurnId,
        data: expect.objectContaining({ clientMessageId }),
      }),
    );
    expect(
      ingestionRecords.find(
        (record) =>
          record.kind === "user.turn-start" && record.payload.messageId === clientMessageId,
      ),
    ).toEqual(
      expect.objectContaining({
        sourceEventId: `runtime-user-turn:${followUpTurnId}`,
        payload: expect.objectContaining({
          messageId: clientMessageId,
          text: "active follow-up",
          modelSelection,
          titleSeed: "active follow-up",
          interactionMode: "agent",
        }),
      }),
    );
  });

  it("force-sends the selected queued follow-up after aborting the active run", async () => {
    const { harness, releaseToolExecution } = await createRuntimeBlockedOnTool(harnesses);
    const events = collectRuntimeEvents(harness.runtime);
    const ingestionRecords = collectRuntimeIngestionRecords(harness.runtime);
    harness.setResponses([
      fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
      fauxAssistantMessage("handled forced follow-up"),
    ]);

    await waitForEvent(harness.runtime, "tool.started", () =>
      harness.runtime.sendMessage("start", EMPTY_SEND_MESSAGE_OPTIONS),
    );

    const clientMessageId = MessageId.make("message:force-follow-up");
    const modelSelection = canonicalModelSelection();
    harness.runtime.enqueueFollowUp(
      queuedFollowUpInput({
        harness,
        clientMessageId,
        text: "forced follow-up",
      }),
    );

    const forcedUserMessage = new Promise<AgentRuntimeEvent>((resolve) => {
      const unsubscribe = harness.runtime.subscribe((event) => {
        if (
          event.type === "message.completed" &&
          event.messageRole === "user" &&
          event.text === "forced follow-up"
        ) {
          unsubscribe();
          resolve(event);
        }
      });
    });
    const forcedTreeUpdated = new Promise<void>((resolve) => {
      const unsubscribe = harness.runtime.subscribe((event) => {
        if (
          event.type === "tree.updated" &&
          harness.runtime
            .getSessionTree()
            .entries.some((entry) => entry.role === "user" && entry.text === "forced follow-up")
        ) {
          unsubscribe();
          resolve();
        }
      });
    });
    const sendQueuedFollowUpNow = harness.runtime.sendQueuedFollowUpNow(clientMessageId);
    releaseToolExecution();
    await sendQueuedFollowUpNow;
    const forcedUserEvent = await forcedUserMessage;
    await forcedTreeUpdated;

    expect(events.map((event) => event.type)).toContain("turn.interrupted");
    expect(forcedUserEvent).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({ clientMessageId }),
      }),
    );
    expect(harness.runtime.getQueuedFollowUps()).toHaveLength(0);
    expect(
      harness.runtime
        .getSessionTree()
        .entries.filter((entry) => entry.role === "user")
        .map((entry) => entry.text),
    ).toEqual(["start", "forced follow-up"]);
    expect(
      ingestionRecords.find(
        (record) =>
          record.kind === "user.turn-start" && record.payload.messageId === clientMessageId,
      ),
    ).toEqual(
      expect.objectContaining({
        payload: expect.objectContaining({
          messageId: clientMessageId,
          text: "forced follow-up",
          modelSelection,
        }),
      }),
    );
  });
});
