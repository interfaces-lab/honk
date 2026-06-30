import type {
  Api,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  Context,
  Message,
  Model,
} from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { registerClaudeAgentProvider } from "../src/claude-agent-provider";

const sdk = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: sdk.query,
}));

type RegisteredProviderConfig = Parameters<ModelRegistry["registerProvider"]>[1];

interface QueryCall {
  readonly prompt: unknown;
  readonly options: Record<string, unknown>;
}

const queryCalls: QueryCall[] = [];

/** Make `query()` yield the given SDK messages and record the call args. */
function mockQueryWith(messages: readonly unknown[]): void {
  sdk.query.mockImplementation((params: { prompt: unknown; options: Record<string, unknown> }) => {
    queryCalls.push({ prompt: params.prompt, options: params.options });
    return (async function* () {
      for (const message of messages) {
        yield message;
      }
    })();
  });
}

function anthropicModel(): Model<Api> {
  return {
    id: "claude-opus-4-8",
    name: "Claude Opus 4.8",
    api: "anthropic-messages" as Api,
    provider: "anthropic",
    baseUrl: "",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 16_384,
  };
}

function registerProviderForTest(): { config: RegisteredProviderConfig; model: Model<Api> } {
  let config: RegisteredProviderConfig | undefined;
  let providerName: string | undefined;
  const modelRegistry: Pick<ModelRegistry, "registerProvider"> = {
    registerProvider: (name, providerConfig) => {
      providerName = name;
      config = providerConfig;
    },
  };

  registerClaudeAgentProvider(modelRegistry, { cwd: "/tmp/honk-claude-test" });

  if (providerName !== "anthropic" || !config?.streamSimple) {
    throw new Error("Claude provider did not override the anthropic stream handler.");
  }
  return { config, model: anthropicModel() };
}

async function collectEvents(stream: AssistantMessageEventStream): Promise<AssistantMessageEvent[]> {
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

async function readPromptText(prompt: unknown): Promise<string> {
  const parts: string[] = [];
  for await (const message of prompt as AsyncIterable<{ message: { content: unknown } }>) {
    const content = message.message.content;
    if (typeof content === "string") {
      parts.push(content);
    } else if (Array.isArray(content)) {
      for (const block of content) {
        const record = block as { type?: string; text?: string };
        if (record.type === "text" && typeof record.text === "string") {
          parts.push(record.text);
        }
      }
    }
  }
  return parts.join("\n");
}

function userContext(text: string): Context {
  return { messages: [{ role: "user", content: text, timestamp: Date.now() }] };
}

function assistantTextMessage(text: string): Message {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "anthropic-messages" as Api,
    provider: "anthropic",
    model: "claude-opus-4-8",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

const INIT_MESSAGE = {
  type: "system",
  subtype: "init",
  session_id: "claude-session-1",
  model: "claude-opus-4-8",
};

const RESULT_MESSAGE = {
  type: "result",
  subtype: "success",
  usage: {
    input_tokens: 10,
    output_tokens: 5,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 2,
  },
  session_id: "claude-session-1",
};

function textStreamEvents(text: string): unknown[] {
  return [
    { type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text" } } },
    { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } } },
    { type: "stream_event", event: { type: "content_block_stop", index: 0 } },
  ];
}

describe("Claude Agent provider", () => {
  beforeEach(() => {
    sdk.query.mockReset();
    queryCalls.length = 0;
  });

  it("streams text, surfaces SDK tools as stripped synthetic events, and reports usage", async () => {
    mockQueryWith([
      INIT_MESSAGE,
      ...textStreamEvents("Hello"),
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "tool-1", name: "Bash", input: { command: "ls" } }],
        },
      },
      {
        type: "user",
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "tool-1", content: "file.txt", is_error: false },
          ],
        },
      },
      RESULT_MESSAGE,
    ]);

    const { config, model } = registerProviderForTest();
    const stream = config.streamSimple?.(model, userContext("list files"), undefined);
    if (!stream) {
      throw new Error("Claude provider stream was not registered.");
    }

    const [events, finalMessage] = await Promise.all([collectEvents(stream), stream.result()]);

    const textDelta = events.find((event) => event.type === "text_delta");
    expect(textDelta).toMatchObject({ delta: "Hello" });

    const toolStart = events.find((event) => event.type === "toolcall_start");
    const toolEnd = events.find((event) => event.type === "toolcall_end");
    expect(toolStart).toBeDefined();
    if (toolEnd?.type !== "toolcall_end") {
      throw new Error("Claude provider did not emit toolcall_end.");
    }
    expect(toolEnd.toolCall).toMatchObject({
      name: "Bash",
      arguments: {
        command: "ls",
        __honkClaudeSyntheticToolEvent: true,
        __honkClaudeResult: {
          isError: false,
          result: { content: [{ type: "text", text: "file.txt" }], details: {} },
        },
      },
    });

    // Synthetic tool blocks are stripped before the message is finalized/persisted.
    expect(finalMessage.content.some((block) => block.type === "toolCall")).toBe(false);
    expect(finalMessage.content.some((block) => block.type === "text")).toBe(true);
    expect(finalMessage.usage).toMatchObject({
      input: 10,
      output: 5,
      cacheRead: 2,
      totalTokens: 17,
    });

    const firstCall = queryCalls[0];
    expect(firstCall?.options).toMatchObject({
      cwd: "/tmp/honk-claude-test",
      model: "claude-opus-4-8",
      includePartialMessages: true,
      systemPrompt: { type: "preset", preset: "claude_code" },
    });
    expect(firstCall?.options.resume).toBeUndefined();
  });

  it("is stateless: a follow-up turn flattens the full history into a fresh query", async () => {
    mockQueryWith([...textStreamEvents("First"), RESULT_MESSAGE]);

    const { config, model } = registerProviderForTest();

    const firstStream = config.streamSimple?.(model, userContext("first question"), undefined);
    if (!firstStream) {
      throw new Error("Claude provider stream was not registered.");
    }
    await collectEvents(firstStream);

    // Second turn: pi passes the full history (user1, assistant1, user2).
    mockQueryWith([...textStreamEvents("Second"), RESULT_MESSAGE]);
    const followUpContext: Context = {
      messages: [
        { role: "user", content: "first question", timestamp: Date.now() },
        assistantTextMessage("First"),
        { role: "user", content: "second question", timestamp: Date.now() },
      ],
    };
    const secondStream = config.streamSimple?.(model, followUpContext, undefined);
    if (!secondStream) {
      throw new Error("Claude provider stream was not registered.");
    }
    await collectEvents(secondStream);

    expect(queryCalls).toHaveLength(2);
    expect(queryCalls[1]?.options.resume).toBeUndefined();
    const followUpPrompt = await readPromptText(queryCalls[1]?.prompt);
    expect(followUpPrompt).toContain("first question");
    expect(followUpPrompt).toContain("First");
    expect(followUpPrompt).toContain("second question");
  });
});
