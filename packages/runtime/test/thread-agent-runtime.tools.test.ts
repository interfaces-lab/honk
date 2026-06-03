import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentRuntimeEvent } from "@multi/contracts";
import { createDesktopAgentExtensionFactories } from "../src/desktop-agent-extensions";
import {
  createDesktopExtensionUi,
  type DesktopExtensionUiController,
  type DesktopExtensionUiRequest,
} from "../src/extension-ui";
import {
  createRuntimeHarness,
  EMPTY_SEND_MESSAGE_OPTIONS,
  type RuntimeHarness,
  waitForEvent,
} from "./runtime-test-harness";

function expectRecord(value: unknown): Record<string, unknown> {
  expect(typeof value).toBe("object");
  expect(value).not.toBeNull();
  if (typeof value !== "object" || value === null) {
    throw new Error("Expected record value");
  }
  return Object.fromEntries(Object.entries(value));
}

function waitForPendingExtensionUiRequest(
  ui: DesktopExtensionUiController,
): Promise<DesktopExtensionUiRequest> {
  const request = ui.pendingRequests[0];
  if (request) {
    return Promise.resolve(request);
  }
  return new Promise((resolve) => {
    const unsubscribe = ui.onPendingRequestsChanged(() => {
      const request = ui.pendingRequests[0];
      if (request) {
        unsubscribe();
        resolve(request);
      }
    });
  });
}

describe("ThreadAgentRuntime tools", () => {
  const harnesses: RuntimeHarness[] = [];
  const tempDirs: string[] = [];

  afterEach(() => {
    while (harnesses.length > 0) {
      harnesses.pop()?.cleanup();
    }
    while (tempDirs.length > 0) {
      const tempDir = tempDirs.pop();
      if (tempDir && existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    }
  });

  function createAgentDir(): string {
    const tempDir = join(
      tmpdir(),
      `multi-runtime-agent-dir-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    const agentDir = join(tempDir, "pi-agent");
    mkdirSync(agentDir, { recursive: true });
    tempDirs.push(tempDir);
    return agentDir;
  }

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

    const firstTurnId = await waitForEvent(harness.runtime, "tool.completed", () =>
      harness.runtime.sendMessage("run echo", EMPTY_SEND_MESSAGE_OPTIONS),
    );
    await harness.runtime.session.agent.waitForIdle();

    expect(toolRuns).toEqual(["hello"]);
    const turnStartedEvents = events.filter((event) => event.type === "turn.started");
    const turnCompletedEvents = events.filter((event) => event.type === "turn.completed");
    const finalMessageEvent = events.find(
      (event) => event.type === "message.completed" && event.text === "done",
    );
    expect(events.filter((event) => event.type === "agent.started")).toHaveLength(1);
    expect(events.filter((event) => event.type === "agent.completed")).toHaveLength(1);
    expect(turnStartedEvents).toHaveLength(2);
    expect(turnCompletedEvents).toHaveLength(2);
    expect(turnStartedEvents[0]?.turnId).toBe(firstTurnId);
    expect(turnStartedEvents[1]?.turnId).not.toBe(firstTurnId);
    expect(finalMessageEvent?.turnId).toBe(turnStartedEvents[1]?.turnId);
    expect(events.map((event) => event.type)).toContain("tool.started");
    expect(events.map((event) => event.type)).toContain("tool.completed");
    const startedEvent = events.find((event) => event.type === "tool.started");
    const completedEvent = events.find((event) => event.type === "tool.completed");
    expect(startedEvent?.turnId).toBe(firstTurnId);
    expect(completedEvent?.turnId).toBe(firstTurnId);
    expect(startedEvent?.summary).toBe("Started echo");
    expect(expectRecord(startedEvent?.data).toolName).toBe("echo");
    expect(expectRecord(startedEvent?.data).args).toEqual({ text: "hello" });
    expect(completedEvent?.summary).toBe("Completed echo");
    expect(expectRecord(completedEvent?.data).toolName).toBe("echo");
    expect(expectRecord(completedEvent?.data).isError).toBe(false);
    expect(harness.runtime.policy.allowedToolNames).toEqual(["echo"]);
  });

  it("runs the first-party ask_user extension through desktop UI", async () => {
    const harness = await createRuntimeHarness({
      extensionFactories: createDesktopAgentExtensionFactories({ agentDir: createAgentDir() }),
      tools: ["ask_user"],
    });
    harnesses.push(harness);
    const ui = createDesktopExtensionUi();
    const events: AgentRuntimeEvent[] = [];

    await harness.runtime.bindExtensions(ui);
    harness.runtime.subscribe((event) => events.push(event));
    harness.setResponses([
      fauxAssistantMessage(
        fauxToolCall("ask_user", {
          prompt: "What should I use?",
          kind: "input",
          options: [],
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("done"),
    ]);

    await waitForEvent(harness.runtime, "tool.started", () =>
      harness.runtime.sendMessage("ask", EMPTY_SEND_MESSAGE_OPTIONS),
    );
    const request = await waitForPendingExtensionUiRequest(ui);

    expect(request).toMatchObject({
      kind: "input",
      title: "What should I use?",
      placeholder: "Type your answer",
    });
    ui.resolveRequest(request.id, "the sqlite branch");
    await harness.runtime.session.agent.waitForIdle();

    expect(ui.pendingRequests).toHaveLength(0);
    const completedEvent = events.find(
      (event) =>
        event.type === "tool.completed" && expectRecord(event.data).toolName === "ask_user",
    );
    expect(completedEvent?.summary).toBe("Completed ask_user");
    expect(expectRecord(completedEvent?.data).isError).toBe(false);
  });

  it("runs the first-party subagent extension as an embedded child session from a prompt", async () => {
    const harness = await createRuntimeHarness({
      extensionFactories: createDesktopAgentExtensionFactories({ agentDir: createAgentDir() }),
      tools: ["subagent"],
    });
    harnesses.push(harness);
    const events: AgentRuntimeEvent[] = [];

    harness.runtime.subscribe((event) => events.push(event));
    harness.setResponses([
      fauxAssistantMessage(
        fauxToolCall("subagent", {
          description: "Find important detail",
          prompt: "Find the important detail.",
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("child found sqlite"),
      fauxAssistantMessage("parent done"),
    ]);

    await waitForEvent(harness.runtime, "tool.completed", () =>
      harness.runtime.sendMessage("delegate", EMPTY_SEND_MESSAGE_OPTIONS),
    );
    await harness.runtime.session.agent.waitForIdle();

    const completedEvent = events.find(
      (event) =>
        event.type === "tool.completed" && expectRecord(event.data).toolName === "subagent",
    );
    const result = expectRecord(expectRecord(completedEvent?.data).result);
    const details = expectRecord(result.details);
    const runs = details.runs;
    const activities = details.activities;

    expect(Array.isArray(runs) ? runs[0] : undefined).toMatchObject({
      subagentThreadId: expect.stringContaining(":subagent:"),
      agentId: expect.stringContaining(":subagent:"),
      nickname: "Find important detail",
      role: "general-purpose",
      prompt: "Find the important detail.",
      state: "completed",
      finalText: "child found sqlite",
    });
    expect(Array.isArray(activities) ? activities[0] : undefined).toMatchObject({
      payload: {
        subagentThreadId: expect.stringContaining(":subagent:"),
      },
    });
    const activityKinds = Array.isArray(activities)
      ? activities.map((activity) => expectRecord(activity).kind)
      : [];
    expect(activityKinds).toEqual(
      expect.arrayContaining([
        "subagent.thread.started",
        "subagent.item.completed",
        "subagent.thread.state.changed",
      ]),
    );
    expect(
      harness.runtime
        .getSessionTree()
        .entries.filter((entry) => entry.role === "assistant")
        .map((entry) => entry.text),
    ).toContain("parent done");
  });
});
