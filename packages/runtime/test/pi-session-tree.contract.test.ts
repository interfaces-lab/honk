import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createRuntimeHarness, type RuntimeHarness } from "./runtime-test-harness";

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
    harness.setResponses([fauxAssistantMessage("first response"), fauxAssistantMessage("second response")]);

    await harness.runtime.sendMessage("first");
    await harness.runtime.sendMessage("second");

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
    expect(tree.nodes.at(-1)?.isActiveLeaf).toBe(true);
    expect(tree.nodes.every((node) => node.threadEntryId.startsWith("runtime:"))).toBe(true);
  });
});
