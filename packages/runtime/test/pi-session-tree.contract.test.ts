import {
  fauxAssistantMessage,
  fauxText,
  fauxThinking,
  fauxToolCall,
  type AssistantMessage,
  type UserMessage,
} from "@earendil-works/pi-ai";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { MessageId, threadEntryIdForMessageId } from "@honk/contracts";
import { projectRuntimeDisplayTimeline } from "../src/display-timeline-projection";
import { projectRuntimeSessionEntry } from "../src/session-tree-projection";
import {
  createRuntimeHarness,
  EMPTY_SEND_MESSAGE_OPTIONS,
  type RuntimeHarness,
  waitForEvent,
} from "./runtime-test-harness";

const failedAssistantMessage: AssistantMessage = {
  role: "assistant",
  content: [],
  api: "anthropic-messages",
  provider: "anthropic",
  model: "claude-opus-4-8",
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  },
  stopReason: "error",
  timestamp: 1781226634337,
  errorMessage: "400 usage limit reached",
};

describe("Pi session tree contract", () => {
  const harnesses: RuntimeHarness[] = [];

  afterEach(() => {
    while (harnesses.length > 0) {
      harnesses.pop()?.cleanup();
    }
  });

  it("projects Pi JSONL entries into Honk session tree entries", async () => {
    const harness = await createRuntimeHarness();
    harnesses.push(harness);
    harness.setResponses([
      fauxAssistantMessage([fauxThinking("thinking through first"), fauxText("first response")]),
      fauxAssistantMessage("second response"),
    ]);

    const firstClientMessageId = MessageId.make("client:first");
    await waitForEvent(harness.runtime, "tree.updated", () =>
      harness.runtime.sendMessage("first", {
        ...EMPTY_SEND_MESSAGE_OPTIONS,
        clientMessageId: firstClientMessageId,
      }),
    );
    await waitForEvent(harness.runtime, "tree.updated", () =>
      harness.runtime.sendMessage("second", EMPTY_SEND_MESSAGE_OPTIONS),
    );

    const tree = harness.runtime.getSessionTree();
    expect(tree.threadId).toBe(harness.runtime.threadId);
    expect(tree.runtimeSessionId).toBe(harness.runtime.runtimeSessionId);
    expect(tree.entries.map((entry) => entry.kind)).toEqual([
      "model-change",
      "thinking-level-change",
      "message",
      "message",
      "message",
      "message",
    ]);
    expect(
      tree.entries.filter((entry) => entry.role === "user").map((entry) => entry.text),
    ).toEqual(["first", "second"]);
    expect(tree.entries.find((entry) => entry.text === "first response")?.thinking).toBe(
      "thinking through first",
    );
    expect(tree.entries.find((entry) => entry.text === "first response")?.turnId).toBeDefined();
    expect(tree.entries.find((entry) => entry.text === "first")?.clientMessageId).toBe(
      firstClientMessageId,
    );
    expect(tree.entries.find((entry) => entry.text === "first")?.threadEntryId).toBe(
      threadEntryIdForMessageId(firstClientMessageId),
    );
    expect(tree.nodes.at(-1)?.isActiveLeaf).toBe(true);
    expect(
      tree.nodes.find(
        (node) => node.threadEntryId === threadEntryIdForMessageId(firstClientMessageId),
      ),
    ).toEqual(expect.objectContaining({ childCount: 1 }));
  });

  it("projects provider error messages as visible session tree text", () => {
    const entry = {
      type: "message",
      id: "assistant-error",
      parentId: "user",
      timestamp: "2026-06-12T01:10:34.992Z",
      message: failedAssistantMessage,
    } satisfies SessionEntry;

    expect(projectRuntimeSessionEntry(entry)).toMatchObject({
      role: "assistant",
      text: "Provider error: 400 usage limit reached",
    });
  });

  it("branches edited prompts from the replaced user message parent", async () => {
    const harness = await createRuntimeHarness();
    harnesses.push(harness);
    harness.setResponses([
      fauxAssistantMessage("old response"),
      fauxAssistantMessage("new response"),
    ]);

    const firstClientMessageId = MessageId.make("client:edit-original");
    const revisedClientMessageId = MessageId.make("client:edit-revised");
    await waitForEvent(harness.runtime, "tree.updated", () =>
      harness.runtime.sendMessage("old prompt", {
        ...EMPTY_SEND_MESSAGE_OPTIONS,
        clientMessageId: firstClientMessageId,
      }),
    );
    const originalTree = harness.runtime.getSessionTree();
    const originalUserEntry = originalTree.entries.find(
      (entry) => entry.role === "user" && entry.clientMessageId === firstClientMessageId,
    );
    expect(originalUserEntry).toBeDefined();

    await waitForEvent(harness.runtime, "tree.updated", () =>
      harness.runtime.sendMessage("new prompt", {
        ...EMPTY_SEND_MESSAGE_OPTIONS,
        clientMessageId: revisedClientMessageId,
        replacesClientMessageId: firstClientMessageId,
      }),
    );

    const tree = harness.runtime.getSessionTree();
    const oldUserEntry = tree.entries.find(
      (entry) => entry.role === "user" && entry.clientMessageId === firstClientMessageId,
    );
    const oldAssistantEntry = tree.entries.find(
      (entry) => entry.role === "assistant" && entry.text === "old response",
    );
    const newUserEntry = tree.entries.find(
      (entry) => entry.role === "user" && entry.clientMessageId === revisedClientMessageId,
    );
    const newAssistantEntry = tree.entries.find(
      (entry) => entry.role === "assistant" && entry.text === "new response",
    );

    expect(oldUserEntry).toBeDefined();
    expect(oldAssistantEntry).toBeDefined();
    expect(newUserEntry).toBeDefined();
    expect(newAssistantEntry).toBeDefined();
    expect(newUserEntry?.parentId).toBe(oldUserEntry?.parentId);
    expect(newUserEntry?.parentThreadEntryId).toBe(oldUserEntry?.parentThreadEntryId);

    const newUserNode = tree.nodes.find((node) => node.entryId === newUserEntry?.id);
    const oldUserNode = tree.nodes.find((node) => node.entryId === oldUserEntry?.id);
    expect(tree.leafEntryId).toBe(newAssistantEntry?.id);
    expect(newUserNode?.isActivePath).toBe(true);
    expect(oldUserNode?.isActivePath).toBe(false);

    const timeline = projectRuntimeDisplayTimeline({
      threadId: harness.runtime.threadId,
      runtimeSessionId: harness.runtime.runtimeSessionId,
      sessionTree: tree,
    });
    expect(timeline.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: "new prompt" })]),
    );
    expect(timeline.items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ text: "old prompt" })]),
    );
    expect(timeline.items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ text: "old response" })]),
    );
    expect(
      harness.runtime.session.messages
        .filter((message): message is UserMessage => message.role === "user")
        .map((message) => message.content),
    ).toEqual([[{ type: "text", text: "new prompt" }]]);
  });

  it("rejects revision when the replaced client message id cannot be resolved", async () => {
    const harness = await createRuntimeHarness();
    harnesses.push(harness);

    await expect(
      harness.runtime.sendMessage("new prompt", {
        ...EMPTY_SEND_MESSAGE_OPTIONS,
        replacesClientMessageId: MessageId.make("client:missing"),
      }),
    ).rejects.toThrow("Cannot revise message client:missing");

    expect(harness.runtime.getSessionTree().entries.map((entry) => entry.text)).not.toContain(
      "new prompt",
    );
  });

  it("rejects revision while a runtime turn is in progress", async () => {
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
    harness.setResponses([
      fauxAssistantMessage("original response"),
      fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
      fauxAssistantMessage("done"),
    ]);

    const firstClientMessageId = MessageId.make("client:active-original");
    await waitForEvent(harness.runtime, "tree.updated", () =>
      harness.runtime.sendMessage("original prompt", {
        ...EMPTY_SEND_MESSAGE_OPTIONS,
        clientMessageId: firstClientMessageId,
      }),
    );
    await waitForEvent(harness.runtime, "tool.started", () =>
      harness.runtime.sendMessage("active prompt", EMPTY_SEND_MESSAGE_OPTIONS),
    );

    await expect(
      harness.runtime.sendMessage("revised prompt", {
        ...EMPTY_SEND_MESSAGE_OPTIONS,
        replacesClientMessageId: firstClientMessageId,
      }),
    ).rejects.toThrow("Cannot revise a message while a runtime turn is in progress.");

    releaseToolExecution?.();
    await harness.runtime.session.agent.waitForIdle();
    expect(harness.runtime.getSessionTree().entries.map((entry) => entry.text)).not.toContain(
      "revised prompt",
    );
  });

  it("projects the client message id before turn-completed tree publication", async () => {
    const harness = await createRuntimeHarness();
    harnesses.push(harness);
    harness.setResponses([fauxAssistantMessage("live response")]);

    const clientMessageId = MessageId.make("client:live-turn");
    let turnCompletedUserClientMessageId: MessageId | undefined;
    const unsubscribe = harness.runtime.subscribe((event) => {
      if (event.type !== "turn.completed") {
        return;
      }
      const tree = harness.runtime.getSessionTree();
      turnCompletedUserClientMessageId = tree.entries.find(
        (entry) => entry.role === "user" && entry.text === "live prompt",
      )?.clientMessageId;
    });

    await waitForEvent(harness.runtime, "tree.updated", () =>
      harness.runtime.sendMessage("live prompt", {
        ...EMPTY_SEND_MESSAGE_OPTIONS,
        clientMessageId,
      }),
    );
    unsubscribe();

    expect(turnCompletedUserClientMessageId).toBe(clientMessageId);
  });

  it("hydrates client message ids from Pi JSONL sidecars after reload", async () => {
    const firstHarness = await createRuntimeHarness({ removeTempDirOnCleanup: false });
    harnesses.push(firstHarness);
    firstHarness.setResponses([fauxAssistantMessage("persisted response")]);

    const clientMessageId = MessageId.make("client:persisted-turn");
    await waitForEvent(firstHarness.runtime, "tree.updated", () =>
      firstHarness.runtime.sendMessage("persisted prompt", {
        ...EMPTY_SEND_MESSAGE_OPTIONS,
        clientMessageId,
      }),
    );
    firstHarness.runtime.dispose();

    const reloadedHarness = await createRuntimeHarness({
      tempDir: firstHarness.tempDir,
      threadId: firstHarness.runtime.threadId,
    });
    harnesses.push(reloadedHarness);

    const tree = reloadedHarness.runtime.getSessionTree();
    const userEntry = tree.entries.find(
      (entry) => entry.role === "user" && entry.text === "persisted prompt",
    );
    expect(userEntry?.clientMessageId).toBe(clientMessageId);
    expect(userEntry?.threadEntryId).toBe(threadEntryIdForMessageId(clientMessageId));
    expect(tree.entries).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "custom" })]),
    );
    expect(
      tree.nodes.find((node) => node.threadEntryId === threadEntryIdForMessageId(clientMessageId)),
    ).toBeDefined();
  });

  it("converts runtime data URL images into Pi image content", async () => {
    const harness = await createRuntimeHarness();
    harnesses.push(harness);
    harness.setResponses([fauxAssistantMessage("image response")]);

    await waitForEvent(harness.runtime, "tree.updated", () =>
      harness.runtime.sendMessage("describe this", {
        ...EMPTY_SEND_MESSAGE_OPTIONS,
        images: [
          {
            type: "image",
            name: "sample.png",
            mimeType: "image/png",
            sizeBytes: 4,
            dataUrl: "data:image/png;base64,YWJjZA==",
          },
        ],
      }),
    );

    const userMessage = harness.runtime.session.messages.find(
      (message): message is UserMessage => message.role === "user",
    );
    expect(userMessage?.content).toEqual([
      { type: "text", text: "describe this" },
      { type: "image", mimeType: "image/png", data: "YWJjZA==" },
    ]);
  });
});
