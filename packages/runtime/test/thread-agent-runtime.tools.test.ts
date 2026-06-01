import { defineTool } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentRuntimeEvent } from "@multi/contracts";
import { createRuntimeHarness, type RuntimeHarness } from "./runtime-test-harness";

describe("ThreadAgentRuntime tools", () => {
  const harnesses: RuntimeHarness[] = [];

  afterEach(() => {
    while (harnesses.length > 0) {
      harnesses.pop()?.cleanup();
    }
  });

  it("runs SDK custom tools and projects tool lifecycle events", async () => {
    const toolRuns: string[] = [];
    const echoTool = defineTool({
      name: "echo",
      label: "Echo",
      description: "Echo text back",
      promptSnippet: "Echoes a value.",
      parameters: Type.Object({ text: Type.String() }),
      execute: async (_toolCallId, params) => {
        toolRuns.push(params.text);
        return {
          content: [{ type: "text", text: `echo:${params.text}` }],
          details: { text: params.text },
        };
      },
    });
    const harness = await createRuntimeHarness({ customTools: [echoTool], tools: ["echo"] });
    harnesses.push(harness);
    const events: AgentRuntimeEvent[] = [];
    harness.runtime.subscribe((event) => events.push(event));
    harness.setResponses([
      fauxAssistantMessage(fauxToolCall("echo", { text: "hello" }), { stopReason: "toolUse" }),
      fauxAssistantMessage("done"),
    ]);

    await harness.runtime.sendMessage("run echo");

    expect(toolRuns).toEqual(["hello"]);
    expect(events.map((event) => event.type)).toContain("tool.started");
    expect(events.map((event) => event.type)).toContain("tool.completed");
    expect(harness.runtime.policy.allowedToolNames).toEqual(["echo"]);
  });
});
