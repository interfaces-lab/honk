import type { Run, RunResult, SDKAgent, SDKUserMessage, SendOptions } from "@cursor/sdk";
import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  Context,
  Model,
} from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { CURSOR_PROVIDER_ID } from "@honk/shared/cursor-composer";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { registerCursorComposerProvider } from "../src/cursor-composer-provider";

const cursorSdk = vi.hoisted(() => ({
  createAgent: vi.fn(),
}));

vi.mock("@cursor/sdk", () => ({
  Agent: {
    create: cursorSdk.createAgent,
  },
}));

interface RegisteredCursorProvider {
  readonly config: RegisteredProviderConfig;
  readonly model: Model<Api>;
}

type RegisteredProviderConfig = Parameters<ModelRegistry["registerProvider"]>[1];

function createRun(result: RunResult): Run {
  return {
    id: result.id,
    agentId: "agent:test",
    supports: () => true,
    unsupportedReason: () => undefined,
    stream: async function* () {},
    conversation: async () => [],
    wait: async () => result,
    cancel: async () => undefined,
    status: result.status,
    onDidChangeStatus: () => () => undefined,
    ...(result.requestId !== undefined ? { requestId: result.requestId } : {}),
    ...(result.result !== undefined ? { result: result.result } : {}),
    ...(result.model !== undefined ? { model: result.model } : {}),
    ...(result.durationMs !== undefined ? { durationMs: result.durationMs } : {}),
    ...(result.git !== undefined ? { git: result.git } : {}),
    createdAt: Date.now(),
  };
}

function createAgent(send: SDKAgent["send"]): SDKAgent {
  return {
    agentId: "agent:test",
    model: undefined,
    send,
    close: vi.fn(),
    reload: async () => undefined,
    [Symbol.asyncDispose]: async () => undefined,
    listArtifacts: async () => [],
    downloadArtifact: async () => Buffer.from(""),
  };
}

function registerProviderForTest(): RegisteredCursorProvider {
  let config: RegisteredProviderConfig | undefined;
  const modelRegistry: Pick<ModelRegistry, "registerProvider"> = {
    registerProvider: (_providerName, providerConfig) => {
      config = providerConfig;
    },
  };

  registerCursorComposerProvider(modelRegistry, { cwd: "/tmp/honk-cursor-test" });

  if (!config?.streamSimple || !config.models?.[0]) {
    throw new Error("Cursor provider did not register a streamable model.");
  }

  const registeredModel = config.models[0];
  return {
    config,
    model: {
      id: registeredModel.id,
      name: registeredModel.name,
      api: registeredModel.api ?? "cursor-sdk",
      provider: CURSOR_PROVIDER_ID,
      baseUrl: config.baseUrl ?? "",
      reasoning: registeredModel.reasoning,
      input: registeredModel.input,
      cost: registeredModel.cost,
      contextWindow: registeredModel.contextWindow,
      maxTokens: registeredModel.maxTokens,
    },
  };
}

async function collectEvents(
  stream: AssistantMessageEventStream,
): Promise<AssistantMessageEvent[]> {
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

function contextWithUserText(text: string): Context {
  return {
    messages: [
      {
        role: "user",
        content: text,
        timestamp: Date.now(),
      },
    ],
  };
}

describe("Cursor Composer provider", () => {
  beforeEach(() => {
    cursorSdk.createAgent.mockReset();
  });

  it("streams step-only Cursor shell tool calls into Pi tool events", async () => {
    const send: SDKAgent["send"] = async (_message, options) => {
      await options?.onStep?.({
        step: {
          type: "toolCall",
          message: {
            type: "shell",
            args: {
              command: "git status --short",
            },
            result: {
              status: "success",
              value: {
                exitCode: 0,
                signal: "",
                stdout: "M packages/runtime/src/cursor-composer-provider.ts\n",
                stderr: "",
                executionTime: 12,
              },
            },
          },
        },
      });
      await options?.onDelta?.({
        update: {
          type: "turn-ended",
          usage: {
            inputTokens: 177_783,
            outputTokens: 2_274,
            cacheReadTokens: 151_653,
            cacheWriteTokens: 0,
          },
        },
      });
      return createRun({ id: "run:test", status: "finished", result: "Done" });
    };
    cursorSdk.createAgent.mockResolvedValue(createAgent(send));
    const { config, model } = registerProviderForTest();

    const stream = config.streamSimple?.(model, contextWithUserText("show status"), {
      apiKey: "cursor-key",
    });
    if (!stream) {
      throw new Error("Cursor provider stream was not registered.");
    }

    const [events, finalMessage] = await Promise.all([collectEvents(stream), stream.result()]);
    const toolStartEvents = events.filter((event) => event.type === "toolcall_start");
    const toolEndEvents = events.filter((event) => event.type === "toolcall_end");
    const toolCalls = finalMessage.content.filter((content) => content.type === "toolCall");

    expect(toolStartEvents).toHaveLength(1);
    expect(toolEndEvents).toHaveLength(1);
    expect(toolCalls).toHaveLength(0);
    const completedToolCall = toolEndEvents[0]?.toolCall;
    expect(completedToolCall).toMatchObject({
      name: "bash",
      arguments: {
        command: "git status --short",
        __honkCursorSyntheticToolEvent: true,
      },
    });
    expect(finalMessage.usage.totalTokens).toBeLessThan(1_000);
  });

  it("uses local Pi usage estimates instead of Cursor raw usage", async () => {
    const sentMessages: SDKUserMessage[] = [];
    const send: SDKAgent["send"] = async (message, options) => {
      if (typeof message !== "string") {
        sentMessages.push(message);
      }
      await options?.onDelta?.({ update: { type: "text-delta", text: "Short answer." } });
      await options?.onDelta?.({
        update: {
          type: "turn-ended",
          usage: {
            inputTokens: 177_783,
            outputTokens: 2_274,
            cacheReadTokens: 151_653,
            cacheWriteTokens: 0,
          },
        },
      });
      return createRun({ id: "run:test", status: "finished", result: "Short answer." });
    };
    cursorSdk.createAgent.mockResolvedValue(createAgent(send));
    const { config, model } = registerProviderForTest();

    const stream = config.streamSimple?.(model, contextWithUserText("hello"), {
      apiKey: "cursor-key",
    });
    if (!stream) {
      throw new Error("Cursor provider stream was not registered.");
    }

    await collectEvents(stream);
    const finalMessage = await stream.result();

    expect(sentMessages[0]?.text).toContain("User:\nhello");
    expect(finalMessage.usage.input).toBeGreaterThan(0);
    expect(finalMessage.usage.output).toBeGreaterThan(0);
    expect(finalMessage.usage.cacheRead).toBe(0);
    expect(finalMessage.usage.totalTokens).toBeLessThan(100);
  });
});
