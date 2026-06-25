import {
  fauxAssistantMessage,
  fauxToolCall,
  Type,
  type Context,
  type UserMessage,
} from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { MessageId, type AgentRuntimeEvent } from "@honk/contracts";
import {
  createRuntimeHarness,
  EMPTY_SEND_MESSAGE_OPTIONS,
  type RuntimeHarness,
  waitForEvent,
} from "./runtime-test-harness";

const MODE_EXPECTATIONS = [
  {
    mode: "ask",
    heading: "Honk Interaction Mode: Ask",
    expectedGuidance: [
      "Explore the codebase and answer the user's question without making changes.",
      "=== CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS ===",
      "You are STRICTLY PROHIBITED from:",
      "Do not be eager to implement.",
      "Cite important code references with line ranges in the form startLine:endLine:filepath.",
    ],
  },
  {
    mode: "plan",
    heading: "Honk Interaction Mode: Plan",
    expectedGuidance: [
      "Produce a concrete implementation plan through Honk's built-in Pi planning surface.",
      "Research the codebase to find relevant files and review relevant docs before planning.",
      "Ask clarifying questions when requirements are ambiguous or the plan depends on missing decisions.",
      "Use the create_plan tool as the final action once the plan is ready for review.",
      "The create_plan payload should include a short name, overview, actionable todos, isProject, optional phases, and a complete Markdown plan.",
      "The Markdown plan should include diagnosis, implementation steps with file paths or code references, verification, risks, and non-goals.",
      "Stop after creating the plan so the user can review, edit, or approve it before implementation.",
      "Do not change files, run mutating shell commands, create commits, or execute the plan.",
    ],
  },
  {
    mode: "debug",
    heading: "Honk Interaction Mode: Debug",
    expectedGuidance: ["Systematically diagnose and fix bugs using runtime evidence."],
  },
  {
    mode: "multitask",
    heading: "Honk Interaction Mode: Multitask",
    expectedGuidance: [
      "Prefer delegation over doing all work yourself.",
      "your first action should be one or more subagent tool calls with runInBackground: true",
      "Do not perform broad local exploration or implementation before starting at least one background subagent.",
      "Say briefly what you delegated.",
    ],
  },
] as const;

describe("ThreadAgentRuntime interaction modes", () => {
  const harnesses: RuntimeHarness[] = [];

  afterEach(() => {
    while (harnesses.length > 0) {
      harnesses.pop()?.cleanup();
    }
  });

  it("overwrites the default Pi system identity with Honk", async () => {
    const harness = await createRuntimeHarness();
    harnesses.push(harness);
    const observedSystemPrompts: string[] = [];
    harness.setResponses([
      (context: Context) => {
        observedSystemPrompts.push(context.systemPrompt ?? "");
        return fauxAssistantMessage("ok");
      },
    ]);

    await waitForEvent(harness.runtime, "tree.updated", () =>
      harness.runtime.sendMessage("hello", EMPTY_SEND_MESSAGE_OPTIONS),
    );

    expect(observedSystemPrompts[0]).toContain("You are Honk, an AI coding assistant.");
    expect(observedSystemPrompts[0]).not.toContain("operating inside pi");
    expect(observedSystemPrompts[0]).not.toContain("a coding agent harness");
  });

  it("uses a read-only Honk identity in ask mode", async () => {
    const harness = await createRuntimeHarness();
    harnesses.push(harness);
    const observedSystemPrompts: string[] = [];
    harness.setResponses([
      (context: Context) => {
        observedSystemPrompts.push(context.systemPrompt ?? "");
        return fauxAssistantMessage("ok");
      },
    ]);

    await waitForEvent(harness.runtime, "tree.updated", () =>
      harness.runtime.sendMessage("explain", {
        ...EMPTY_SEND_MESSAGE_OPTIONS,
        interactionMode: "ask",
      }),
    );

    expect(observedSystemPrompts[0]).toContain(
      "You are Honk, an AI coding assistant. You help users understand their codebase by reading and searching.",
    );
    expect(observedSystemPrompts[0]).not.toContain(
      "You help users by reading files, executing commands, editing code, and writing new files.",
    );
  });

  it("suppresses the Codex tool-use nudge in modes with stronger tool policy", async () => {
    const harness = await createRuntimeHarness({ provider: "openai", api: "openai-responses" });
    harnesses.push(harness);
    const observedSystemPrompts: string[] = [];
    harness.setResponses([
      (context: Context) => {
        observedSystemPrompts.push(context.systemPrompt ?? "");
        return fauxAssistantMessage("ask");
      },
      (context: Context) => {
        observedSystemPrompts.push(context.systemPrompt ?? "");
        return fauxAssistantMessage("multitask");
      },
      (context: Context) => {
        observedSystemPrompts.push(context.systemPrompt ?? "");
        return fauxAssistantMessage("agent");
      },
    ]);

    await waitForEvent(harness.runtime, "tree.updated", () =>
      harness.runtime.sendMessage("explain", {
        ...EMPTY_SEND_MESSAGE_OPTIONS,
        interactionMode: "ask",
      }),
    );
    await waitForEvent(harness.runtime, "tree.updated", () =>
      harness.runtime.sendMessage("coordinate", {
        ...EMPTY_SEND_MESSAGE_OPTIONS,
        interactionMode: "multitask",
      }),
    );
    await waitForEvent(harness.runtime, "tree.updated", () =>
      harness.runtime.sendMessage("build", EMPTY_SEND_MESSAGE_OPTIONS),
    );

    expect(observedSystemPrompts[0]).not.toContain("Codex tool-use note:");
    expect(observedSystemPrompts[1]).not.toContain("Codex tool-use note:");
    expect(observedSystemPrompts[1]).toContain("Honk Interaction Mode: Multitask");
    expect(observedSystemPrompts[2]).toContain("Codex tool-use note:");
  });

  it.each(MODE_EXPECTATIONS)(
    "adds $mode guidance to the provider system prompt without changing the user message",
    async ({ mode, heading, expectedGuidance }) => {
      const harness = await createRuntimeHarness();
      harnesses.push(harness);
      const observedSystemPrompts: string[] = [];
      harness.setResponses([
        (context: Context) => {
          observedSystemPrompts.push(context.systemPrompt ?? "");
          return fauxAssistantMessage("ok");
        },
      ]);

      await waitForEvent(harness.runtime, "tree.updated", () =>
        harness.runtime.sendMessage("explain the failure", {
          ...EMPTY_SEND_MESSAGE_OPTIONS,
          interactionMode: mode,
        }),
      );

      expect(observedSystemPrompts[0]).toContain(heading);
      for (const guidance of expectedGuidance) {
        expect(observedSystemPrompts[0]).toContain(guidance);
      }
      expect(
        harness.runtime.session.messages
          .filter((message): message is UserMessage => message.role === "user")
          .map((message) => message.content),
      ).toEqual([[{ type: "text", text: "explain the failure" }]]);
      expect(
        harness.runtime
          .getSessionTree()
          .entries.filter((entry) => entry.role === "user")
          .map((entry) => entry.text),
      ).toEqual(["explain the failure"]);
    },
  );

  it.each([
    {
      mode: "ask" as const,
      includedTools: ["read"],
      excludedTools: ["bash", "edit", "write", "create_plan", "subagent"],
    },
    {
      mode: "debug" as const,
      includedTools: ["read", "bash", "edit", "write"],
      excludedTools: ["create_plan", "subagent"],
    },
  ])(
    "applies Cursor-style $mode tool profile for the turn",
    async ({ mode, includedTools, excludedTools }) => {
      const harness = await createRuntimeHarness();
      harnesses.push(harness);
      const observedTools: string[][] = [];
      harness.setResponses([
        (context: Context) => {
          observedTools.push((context.tools ?? []).map((tool) => tool.name));
          return fauxAssistantMessage("ok");
        },
        (context: Context) => {
          observedTools.push((context.tools ?? []).map((tool) => tool.name));
          return fauxAssistantMessage("restored");
        },
      ]);

      await waitForEvent(harness.runtime, "tree.updated", () =>
        harness.runtime.sendMessage("inspect", {
          ...EMPTY_SEND_MESSAGE_OPTIONS,
          interactionMode: mode,
        }),
      );
      await waitForEvent(harness.runtime, "tree.updated", () =>
        harness.runtime.sendMessage("normal", EMPTY_SEND_MESSAGE_OPTIONS),
      );

      for (const toolName of includedTools) {
        expect(observedTools[0]).toContain(toolName);
      }
      for (const toolName of excludedTools) {
        expect(observedTools[0]).not.toContain(toolName);
      }
      expect(observedTools[1]).toContain("edit");
      expect(observedTools[1]).toContain("write");
    },
  );

  it("blocks non-read-only tools for ask follow-ups queued into an active run", async () => {
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
    let mutateRuns = 0;
    const mutateTool = defineTool({
      name: "mutate",
      label: "Mutate",
      description: "Mutate state",
      parameters: Type.Object({}),
      execute: async () => {
        mutateRuns += 1;
        return {
          content: [{ type: "text", text: "mutated" }],
          details: {},
        };
      },
    });
    const harness = await createRuntimeHarness({
      customTools: [waitTool, mutateTool],
      tools: ["wait", "mutate"],
    });
    harnesses.push(harness);
    let blockedToolResultText = "";
    harness.setResponses([
      fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
      fauxAssistantMessage("initial done"),
      fauxAssistantMessage(fauxToolCall("mutate", {}), { stopReason: "toolUse" }),
      (context: Context) => {
        const toolResult = context.messages
          .filter((message) => message.role === "toolResult")
          .at(-1);
        blockedToolResultText =
          toolResult?.role === "toolResult"
            ? toolResult.content
                .filter((part): part is { type: "text"; text: string } => part.type === "text")
                .map((part) => part.text)
                .join("\n")
            : "";
        return fauxAssistantMessage(blockedToolResultText);
      },
    ]);

    await waitForEvent(harness.runtime, "tool.started", () =>
      harness.runtime.sendMessage("start", EMPTY_SEND_MESSAGE_OPTIONS),
    );
    await harness.runtime.sendMessage("can you inspect this?", {
      ...EMPTY_SEND_MESSAGE_OPTIONS,
      interactionMode: "ask",
      streamingBehavior: "followUp",
    });
    releaseToolExecution?.();
    await harness.runtime.session.agent.waitForIdle();

    expect(mutateRuns).toBe(0);
    expect(blockedToolResultText).toContain(
      "You are in ask mode and cannot run non read-only tools.",
    );
  });

  it("applies the ask tool profile to queued composer follow-ups", async () => {
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
    const observedTools: string[][] = [];
    const harness = await createRuntimeHarness({
      customTools: [waitTool],
      tools: ["read", "grep", "find", "ls", "bash", "edit", "write", "ask_question", "wait"],
    });
    harnesses.push(harness);
    harness.setResponses([
      fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
      fauxAssistantMessage("initial done"),
      (context: Context) => {
        observedTools.push((context.tools ?? []).map((tool) => tool.name));
        return fauxAssistantMessage("queued ask done");
      },
    ]);

    await waitForEvent(harness.runtime, "tool.started", () =>
      harness.runtime.sendMessage("start", EMPTY_SEND_MESSAGE_OPTIONS),
    );
    const modelSelection = {
      instanceId: "codex",
      model: "gpt-5.5",
    };
    harness.runtime.enqueueFollowUp({
      threadId: harness.runtime.threadId,
      cwd: harness.tempDir,
      input: "queued ask",
      interactionMode: "ask",
      sourceProposedPlan: null,
      clientMessageId: MessageId.make("message:queued-ask-follow-up"),
      replacesClientMessageId: null,
      images: [],
      policy: {
        agentMode: "deep",
        interactionMode: "ask",
        modelSelection: { type: "pi-managed" },
        fast: false,
        thinkingLevel: "high",
        allowedToolNames: [],
        excludedToolNames: [],
      },
      modelSelection,
      runtimeMode: "full-access",
      titleSeed: "queued ask",
      createdAt: new Date().toISOString(),
    });
    const agentCompleted = new Promise<AgentRuntimeEvent>((resolve) => {
      const unsubscribe = harness.runtime.subscribe((event) => {
        if (event.type === "agent.completed") {
          unsubscribe();
          resolve(event);
        }
      });
    });
    releaseToolExecution?.();
    await agentCompleted;
    await harness.runtime.session.agent.waitForIdle();

    expect(observedTools).toHaveLength(1);
    expect(observedTools[0]).toContain("read");
    expect(observedTools[0]).not.toContain("bash");
    expect(observedTools[0]).not.toContain("edit");
    expect(observedTools[0]).not.toContain("write");
    expect(observedTools[0]).not.toContain("wait");
  });

  it("restores default tools for queued composer agent follow-ups after ask", async () => {
    const observedTools: string[][] = [];
    const harness = await createRuntimeHarness();
    harnesses.push(harness);
    harness.setResponses([
      fauxAssistantMessage("ask done"),
      (context: Context) => {
        observedTools.push((context.tools ?? []).map((tool) => tool.name));
        return fauxAssistantMessage("agent done");
      },
    ]);

    const modelSelection = {
      instanceId: "codex",
      model: "gpt-5.5",
    };
    harness.runtime.enqueueFollowUp({
      threadId: harness.runtime.threadId,
      cwd: harness.tempDir,
      input: "queued agent",
      interactionMode: "agent",
      sourceProposedPlan: null,
      clientMessageId: MessageId.make("message:queued-agent-follow-up"),
      replacesClientMessageId: null,
      images: [],
      policy: {
        agentMode: "deep",
        interactionMode: "agent",
        modelSelection: { type: "pi-managed" },
        fast: false,
        thinkingLevel: "high",
        allowedToolNames: [],
        excludedToolNames: [],
      },
      modelSelection,
      runtimeMode: "full-access",
      titleSeed: "queued agent",
      createdAt: new Date().toISOString(),
    });

    await waitForEvent(harness.runtime, "agent.completed", () =>
      harness.runtime.sendMessage("ask first", {
        ...EMPTY_SEND_MESSAGE_OPTIONS,
        interactionMode: "ask",
      }),
    );
    await harness.runtime.session.agent.waitForIdle();

    expect(observedTools).toHaveLength(1);
    expect(observedTools[0]).toContain("edit");
    expect(observedTools[0]).toContain("write");
  });

  it("does not leak a mode prompt into the next agent turn", async () => {
    const harness = await createRuntimeHarness();
    harnesses.push(harness);
    const observedSystemPrompts: string[] = [];
    harness.setResponses([
      (context: Context) => {
        observedSystemPrompts.push(context.systemPrompt ?? "");
        return fauxAssistantMessage("planned");
      },
      (context: Context) => {
        observedSystemPrompts.push(context.systemPrompt ?? "");
        return fauxAssistantMessage("done");
      },
    ]);

    await waitForEvent(harness.runtime, "tree.updated", () =>
      harness.runtime.sendMessage("plan it", {
        ...EMPTY_SEND_MESSAGE_OPTIONS,
        interactionMode: "plan",
      }),
    );
    await waitForEvent(harness.runtime, "tree.updated", () =>
      harness.runtime.sendMessage("now do it", EMPTY_SEND_MESSAGE_OPTIONS),
    );

    expect(observedSystemPrompts[0]).toContain("Honk Interaction Mode: Plan");
    expect(observedSystemPrompts[1]).not.toContain("Honk Interaction Mode:");
  });

  it("emits a proposed plan event for completed plan-mode turns", async () => {
    const harness = await createRuntimeHarness();
    harnesses.push(harness);
    const events: AgentRuntimeEvent[] = [];
    harness.runtime.subscribe((event) => events.push(event));
    harness.setResponses([fauxAssistantMessage("# Plan\n\n1. Do the work.")]);

    await waitForEvent(harness.runtime, "tree.updated", () =>
      harness.runtime.sendMessage("make a plan", {
        ...EMPTY_SEND_MESSAGE_OPTIONS,
        interactionMode: "plan",
        sourceProposedPlan: {
          threadId: harness.runtime.threadId,
          planId: "plan:source",
        },
      }),
    );

    const startedEvent = events.find((event) => event.type === "turn.started");
    expect(startedEvent?.data).toMatchObject({
      sourceProposedPlan: {
        threadId: harness.runtime.threadId,
        planId: "plan:source",
      },
    });

    const planEvent = events.find((event) => event.type === "turn.proposed.completed");
    expect(planEvent?.data).toEqual({
      planId: `plan:${harness.runtime.threadId}:${planEvent?.turnId}`,
      planMarkdown: "# Plan\n\n1. Do the work.",
    });
  });

  it("does not capture clarifying questions as proposed plans", async () => {
    const harness = await createRuntimeHarness();
    harnesses.push(harness);
    const events: AgentRuntimeEvent[] = [];
    harness.runtime.subscribe((event) => events.push(event));
    harness.setResponses([fauxAssistantMessage("Which package should I inspect first?")]);

    await waitForEvent(harness.runtime, "tree.updated", () =>
      harness.runtime.sendMessage("make a plan", {
        ...EMPTY_SEND_MESSAGE_OPTIONS,
        interactionMode: "plan",
      }),
    );

    expect(events.filter((event) => event.type === "turn.proposed.completed")).toHaveLength(0);
  });
});
