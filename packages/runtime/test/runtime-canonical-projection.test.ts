import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { MessageId, threadEntryIdForMessageId } from "@honk/contracts";
import { afterEach, describe, expect, it } from "vitest";

import {
  canonicalThreadSessionTree,
  isRuntimeCanonicalTurnActive,
} from "../src/runtime-canonical-projection";
import {
  createRuntimeHarness,
  EMPTY_SEND_MESSAGE_OPTIONS,
  type RuntimeHarness,
  waitForEvent,
} from "./runtime-test-harness";

describe("runtime canonical projection", () => {
  const harnesses: RuntimeHarness[] = [];

  afterEach(() => {
    while (harnesses.length > 0) {
      harnesses.pop()?.cleanup();
    }
  });

  it("projects reloaded Pi JSONL sidecars into canonical entries and bridge facts", async () => {
    const firstHarness = await createRuntimeHarness({ removeTempDirOnCleanup: false });
    harnesses.push(firstHarness);
    firstHarness.setResponses([fauxAssistantMessage("persisted response")]);

    const clientMessageId = MessageId.make("client:canonical-persisted");
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

    const canonical = reloadedHarness.runtime.getCanonicalThread();
    const userEntry = canonical.entries.find(
      (entry) => entry.role === "user" && entry.text === "persisted prompt",
    );
    const assistantEntry = canonical.entries.find(
      (entry) => entry.role === "assistant" && entry.text === "persisted response",
    );

    expect(userEntry?.clientMessageId).toBe(clientMessageId);
    expect(userEntry?.threadEntryId).toBe(threadEntryIdForMessageId(clientMessageId));
    expect(assistantEntry?.turnId).toBe(userEntry?.turnId);
    expect(canonical.nodes.find((node) => node.entryId === userEntry?.id)).toBeDefined();
    expect(canonicalThreadSessionTree(canonical).entries).toEqual(canonical.entries);
    expect(isRuntimeCanonicalTurnActive(canonical.turnState)).toBe(false);
    expect(canonical.bridgeFacts).toEqual([
      expect.objectContaining({
        id: expect.stringContaining("runtime-assistant:"),
        kind: "assistant.completion",
        record: expect.objectContaining({
          kind: "assistant.completion",
          recordId: expect.stringContaining("runtime-assistant:"),
          payload: expect.objectContaining({
            text: "persisted response",
            parentEntryId: threadEntryIdForMessageId(clientMessageId),
          }),
        }),
      }),
    ]);
  });
});
