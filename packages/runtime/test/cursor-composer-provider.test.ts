import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type {
  Api,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  Context,
  Model,
} from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { CURSOR_PROVIDER_ID } from "@honk/shared/cursor-composer";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { registerCursorComposerProvider } from "../src/cursor-composer-provider";

const childProcess = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: childProcess.spawn,
}));

interface RegisteredCursorProvider {
  readonly config: RegisteredProviderConfig;
  readonly model: Model<Api>;
}

type RegisteredProviderConfig = Parameters<ModelRegistry["registerProvider"]>[1];
type JsonRpcId = string | number;

interface MockAcpRequest {
  readonly id: JsonRpcId;
  readonly method: string;
  readonly params: unknown;
}

interface MockAcpScript {
  readonly onPrompt?: (request: MockAcpRequest, agent: MockAcpAgent) => void | Promise<void>;
}

class MockAcpAgent extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly requests: MockAcpRequest[] = [];
  private inputBuffer = "";

  constructor(private readonly script: MockAcpScript = {}) {
    super();
    this.stdin.on("data", (chunk: Buffer | string) => {
      this.inputBuffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      this.drainInput();
    });
  }

  kill(): boolean {
    this.emit("exit", 0, null);
    return true;
  }

  sendSessionUpdate(update: Record<string, unknown>): void {
    this.writeMessage({
      jsonrpc: "2.0",
      method: "session/update",
      params: { update },
    });
  }

  private drainInput(): void {
    for (;;) {
      const newlineIndex = this.inputBuffer.indexOf("\n");
      if (newlineIndex === -1) {
        return;
      }
      const line = this.inputBuffer.slice(0, newlineIndex);
      this.inputBuffer = this.inputBuffer.slice(newlineIndex + 1);
      if (line.trim()) {
        void this.handleLine(line);
      }
    }
  }

  private async handleLine(line: string): Promise<void> {
    const parsed = JSON.parse(line) as unknown;
    const message = toRecord(parsed);
    if (!message) {
      return;
    }
    const id = jsonRpcIdField(message, "id");
    const method = stringField(message, "method");
    if (id === undefined || !method) {
      return;
    }
    const request = { id, method, params: message.params } satisfies MockAcpRequest;
    this.requests.push(request);

    switch (method) {
      case "initialize":
        this.respond(id, { protocolVersion: 1 });
        return;
      case "authenticate":
        this.respond(id, {});
        return;
      case "session/new":
        this.respond(id, {
          sessionId: "session:test",
          configOptions: [
            {
              id: "fast",
              name: "Fast mode",
              category: "model_config",
              type: "select",
              currentValue: "false",
              options: [
                { value: "true", name: "On" },
                { value: "false", name: "Off" },
              ],
            },
          ],
        });
        return;
      case "session/set_config_option":
        this.respond(id, { configOptions: [] });
        return;
      case "session/prompt":
        await this.script.onPrompt?.(request, this);
        this.respond(id, { stopReason: "end_turn" });
        return;
      default:
        this.respond(id, {});
    }
  }

  private respond(id: JsonRpcId, result: unknown): void {
    this.writeMessage({ jsonrpc: "2.0", id, result });
  }

  private writeMessage(message: Record<string, unknown>): void {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }
}

function installMockAcpAgent(script: MockAcpScript = {}): MockAcpAgent {
  const agent = new MockAcpAgent(script);
  childProcess.spawn.mockReturnValue(agent);
  return agent;
}

function registerProviderForTest(options?: { fastEnabled?: boolean }): RegisteredCursorProvider {
  let config: RegisteredProviderConfig | undefined;
  const modelRegistry: Pick<ModelRegistry, "registerProvider"> = {
    registerProvider: (_providerName, providerConfig) => {
      config = providerConfig;
    },
  };

  registerCursorComposerProvider(modelRegistry, {
    cwd: "/tmp/honk-cursor-test",
    fastEnabled: options?.fastEnabled ?? false,
  });

  if (!config?.streamSimple || !config.models?.[0]) {
    throw new Error("Cursor provider did not register a streamable model.");
  }

  const registeredModel = config.models[0];
  return {
    config,
    model: {
      id: registeredModel.id,
      name: registeredModel.name,
      api: registeredModel.api ?? "cursor-acp",
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

function toRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function jsonRpcIdField(record: Record<string, unknown>, key: string): JsonRpcId | undefined {
  const value = record[key];
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

describe("Cursor Composer provider", () => {
  beforeEach(() => {
    childProcess.spawn.mockReset();
    delete process.env.CURSOR_AGENT_BIN;
    delete process.env.CURSOR_API_KEY;
  });

  it("streams ACP command tool calls into Pi tool events", async () => {
    installMockAcpAgent({
      onPrompt: (_request, agent) => {
        agent.sendSessionUpdate({
          sessionUpdate: "tool_call",
          toolCallId: "cursor-call-1",
          kind: "execute",
          title: "Run `git status --short`",
          status: "pending",
          rawInput: { command: "git status --short" },
        });
        agent.sendSessionUpdate({
          sessionUpdate: "tool_call_update",
          toolCallId: "cursor-call-1",
          kind: "execute",
          title: "Run `git status --short`",
          status: "completed",
          rawInput: { command: "git status --short" },
          rawOutput: { stdout: "M packages/runtime/src/cursor-composer-provider.ts\n" },
        });
        agent.sendSessionUpdate({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Done" },
        });
      },
    });
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
    expect(childProcess.spawn).toHaveBeenCalledWith(
      "agent",
      ["--model", "composer-2.5", "acp"],
      expect.objectContaining({
        cwd: "/tmp/honk-cursor-test",
        env: expect.objectContaining({ CURSOR_API_KEY: "cursor-key" }),
      }),
    );
  });

  it("uses local Pi usage estimates and sends the transcript as ACP prompt text", async () => {
    const agent = installMockAcpAgent({
      onPrompt: (_request, mockAgent) => {
        mockAgent.sendSessionUpdate({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Short answer." },
        });
      },
    });
    const { config, model } = registerProviderForTest({ fastEnabled: true });

    const stream = config.streamSimple?.(model, contextWithUserText("hello"));
    if (!stream) {
      throw new Error("Cursor provider stream was not registered.");
    }

    await collectEvents(stream);
    const finalMessage = await stream.result();
    const promptRequest = agent.requests.find((request) => request.method === "session/prompt");
    const promptBlocks = toRecord(promptRequest?.params)?.prompt;
    const promptText = Array.isArray(promptBlocks) ? toRecord(promptBlocks[0])?.text : undefined;
    const fastRequest = agent.requests.find(
      (request) => request.method === "session/set_config_option",
    );

    expect(promptText).toContain("User:\nhello");
    expect(fastRequest?.params).toMatchObject({ configId: "fast", value: "true" });
    expect(finalMessage.usage.input).toBeGreaterThan(0);
    expect(finalMessage.usage.output).toBeGreaterThan(0);
    expect(finalMessage.usage.cacheRead).toBe(0);
    expect(finalMessage.usage.totalTokens).toBeLessThan(100);
  });
});
