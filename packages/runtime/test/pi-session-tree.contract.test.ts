import { fauxAssistantMessage, fauxText, fauxThinking, type UserMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { MessageId } from "@multi/contracts";
import {
  createRuntimeHarness,
  EMPTY_SEND_MESSAGE_OPTIONS,
  type RuntimeHarness,
  waitForEvent,
} from "./runtime-test-harness";

describe("Pi session tree contract", () => {
  const harnesses: RuntimeHarness[] = [];

  afterEach(() => {
    while (harnesses.length > 0) {
      harnesses.pop()?.cleanup();
    }
  });

  it("projects Pi JSONL entries into Multi session tree entries", async () => {
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
    expect(tree.entries.filter((entry) => entry.role === "user").map((entry) => entry.text)).toEqual([
      "first",
      "second",
    ]);
    expect(tree.entries.find((entry) => entry.text === "first response")?.thinking).toBe(
      "thinking through first",
    );
    expect(tree.entries.find((entry) => entry.text === "first response")?.turnId).toBeDefined();
    expect(tree.entries.find((entry) => entry.text === "first")?.clientMessageId).toBe(
      firstClientMessageId,
    );
    expect(tree.nodes.at(-1)?.isActiveLeaf).toBe(true);
    expect(tree.nodes.every((node) => node.threadEntryId.startsWith("runtime:"))).toBe(true);
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
