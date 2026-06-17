import process from "node:process";
import {
  Agent,
  type InteractionUpdate,
  type ModelSelection as CursorModelSelection,
  type Run,
  type SDKImage,
  type SDKUserMessage,
} from "@cursor/sdk";
import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  createAssistantMessageEventStream,
  type ImageContent,
  type Message,
  type Model,
  type SimpleStreamOptions,
  type TextContent,
  type ThinkingContent,
  type ToolCall,
  type Usage,
} from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import {
  CURSOR_COMPOSER_FAST_OPTION_ID,
  CURSOR_COMPOSER_MODEL_ID,
  CURSOR_COMPOSER_MODEL_NAME,
  CURSOR_PROVIDER_ID,
} from "@honk/shared/cursor-composer";

const CURSOR_API = "cursor-sdk";
const CURSOR_API_KEY_ENV_VAR = "CURSOR_API_KEY";
const CURSOR_MODEL_CONTEXT_WINDOW = 128_000;
const CURSOR_MODEL_MAX_TOKENS = 16_384;
const CURSOR_APPROX_CHARS_PER_TOKEN = 4;
const CURSOR_IMAGE_TOKEN_ESTIMATE = 1_200;
const CURSOR_SYNTHETIC_TOOL_EVENT_ARG = "__honkCursorSyntheticToolEvent";
const CURSOR_SYNTHETIC_TOOL_RESULT_ARG = "__honkCursorResult";

interface CursorComposerProviderOptions {
  readonly cwd: string;
  readonly fastEnabled?: boolean;
}

interface CursorToolEventState {
  readonly contentIndexByCallId: Map<string, number>;
  readonly completedCallIds: Set<string>;
  readonly completedFingerprints: Set<string>;
}

type AssistantContent = AssistantMessage["content"][number];

class CursorComposerAbortError extends Error {
  constructor() {
    super("Cursor Composer request was aborted.");
  }
}

export function registerCursorComposerProvider(
  modelRegistry: Pick<ModelRegistry, "registerProvider">,
  options: CursorComposerProviderOptions,
): void {
  modelRegistry.registerProvider(CURSOR_PROVIDER_ID, {
    name: "Cursor",
    baseUrl: "https://cursor.com",
    apiKey: `$${CURSOR_API_KEY_ENV_VAR}`,
    api: CURSOR_API,
    streamSimple: (model, context, streamOptions) =>
      streamCursorComposer(model, context, streamOptions, {
        cwd: options.cwd,
        fastEnabled: options.fastEnabled ?? false,
      }),
    models: [
      {
        id: CURSOR_COMPOSER_MODEL_ID,
        name: CURSOR_COMPOSER_MODEL_NAME,
        api: CURSOR_API,
        reasoning: false,
        input: ["text", "image"],
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        contextWindow: CURSOR_MODEL_CONTEXT_WINDOW,
        maxTokens: CURSOR_MODEL_MAX_TOKENS,
      },
    ],
  });
}

function streamCursorComposer(
  model: Model<Api>,
  context: Context,
  options: SimpleStreamOptions | undefined,
  providerOptions: Required<CursorComposerProviderOptions>,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const message = createInitialAssistantMessage(model);
  stream.push({ type: "start", partial: message });

  void runCursorComposerStream({
    model,
    context,
    options,
    providerOptions,
    stream,
    message,
  });

  return stream;
}

async function runCursorComposerStream(input: {
  readonly model: Model<Api>;
  readonly context: Context;
  readonly options: SimpleStreamOptions | undefined;
  readonly providerOptions: Required<CursorComposerProviderOptions>;
  readonly stream: AssistantMessageEventStream;
  readonly message: AssistantMessage;
}): Promise<void> {
  const apiKey = resolveCursorApiKey(input.options?.apiKey);
  if (!apiKey) {
    pushError(
      input.stream,
      input.message,
      "Cursor Composer requires a Cursor API key. Add a Cursor API key in Settings > Accounts or set CURSOR_API_KEY. Cursor Desktop, Cursor Agent CLI, and Cursor OAuth login state are not reused by the Cursor SDK.",
      "error",
    );
    return;
  }

  let run: Run | null = null;
  let agent: Awaited<ReturnType<typeof Agent.create>> | null = null;
  const toolEventState = createCursorToolEventState();
  const abortRun = () => {
    void run?.cancel().catch(() => undefined);
  };
  input.options?.signal?.addEventListener("abort", abortRun, { once: true });

  try {
    throwIfAborted(input.options);
    const modelSelection = buildCursorModelSelection(input.providerOptions.fastEnabled);
    agent = await Agent.create({
      apiKey,
      mode: "agent",
      model: modelSelection,
      local: {
        cwd: input.providerOptions.cwd,
        settingSources: ["project", "user"],
      },
    });
    throwIfAborted(input.options);
    const cursorPrompt = buildCursorUserMessage(input.context);
    const promptInputTokens = estimateCursorPromptTokens(cursorPrompt);
    run = await agent.send(cursorPrompt, {
      mode: "agent",
      model: modelSelection,
      onDelta: async ({ update }) => {
        applyCursorInteractionUpdate(input.stream, input.message, update, toolEventState);
      },
      onStep: async ({ step }) => {
        applyCursorInteractionStep(input.stream, input.message, step, toolEventState);
      },
    });
    const result = await run.wait();
    throwIfAborted(input.options);
    if (result.status === "cancelled") {
      throw new CursorComposerAbortError();
    }
    if (result.status === "error") {
      pushError(
        input.stream,
        input.message,
        scrubApiKey(result.result ?? "Cursor Composer request failed.", apiKey),
        "error",
      );
      return;
    }
    appendFinalTextIfNeeded(input.stream, input.message, result.result);
    endOpenContent(input.stream, input.message);
    stripSyntheticCursorToolContent(input.message);
    applyCursorApproximateUsage(input.message, promptInputTokens);
    input.message.stopReason = "stop";
    input.stream.push({
      type: "done",
      reason: "stop",
      message: input.message,
    });
  } catch (error) {
    const aborted = error instanceof CursorComposerAbortError || input.options?.signal?.aborted;
    pushError(
      input.stream,
      input.message,
      aborted
        ? "Cursor Composer request was aborted."
        : scrubApiKey(error instanceof Error ? error.message : String(error), apiKey),
      aborted ? "aborted" : "error",
    );
  } finally {
    input.options?.signal?.removeEventListener("abort", abortRun);
    agent?.close();
  }
}

function createInitialAssistantMessage(model: Model<Api>): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: CURSOR_API,
    provider: model.provider,
    model: model.id,
    usage: createUsage(),
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function createUsage(input = 0, output = 0, cacheRead = 0, cacheWrite = 0): Usage {
  const totalTokens = input + output + cacheRead + cacheWrite;
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

function estimateTextTokens(text: string): number {
  return text.length > 0 ? Math.ceil(text.length / CURSOR_APPROX_CHARS_PER_TOKEN) : 0;
}

function estimateCursorPromptTokens(prompt: SDKUserMessage): number {
  return (
    estimateTextTokens(prompt.text) + (prompt.images?.length ?? 0) * CURSOR_IMAGE_TOKEN_ESTIMATE
  );
}

function stringifyUsageValue(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}

function estimateCursorAssistantOutputTokens(message: AssistantMessage): number {
  const text = message.content
    .map((block) => {
      switch (block.type) {
        case "text":
          return block.text;
        case "thinking":
          return block.thinking;
        case "toolCall":
          return `Tool call (${block.name}, call ${block.id}): ${stringifyUsageValue(block.arguments)}`;
      }
    })
    .filter((part) => part.length > 0)
    .join("\n");
  return estimateTextTokens(text);
}

function applyCursorApproximateUsage(message: AssistantMessage, promptInputTokens: number): void {
  message.usage = createUsage(
    Math.max(0, Math.round(promptInputTokens)),
    estimateCursorAssistantOutputTokens(message),
    0,
    0,
  );
}

function resolveCursorApiKey(rawApiKey: string | undefined): string | undefined {
  const trimmed = rawApiKey?.trim();
  if (trimmed) {
    return trimmed;
  }
  return process.env[CURSOR_API_KEY_ENV_VAR]?.trim() || undefined;
}

function buildCursorModelSelection(fastEnabled: boolean): CursorModelSelection {
  return {
    id: CURSOR_COMPOSER_MODEL_ID,
    params: [
      {
        id: CURSOR_COMPOSER_FAST_OPTION_ID,
        value: fastEnabled ? "true" : "false",
      },
    ],
  };
}

function buildCursorUserMessage(context: Context): SDKUserMessage {
  const text = buildTranscriptText(context);
  const images = latestUserImages(context);
  return images.length > 0 ? { text, images } : { text };
}

function buildTranscriptText(context: Context): string {
  const sections: string[] = [];
  const systemPrompt = context.systemPrompt?.trim();
  if (systemPrompt) {
    sections.push(`System:\n${systemPrompt}`);
  }
  for (const message of context.messages) {
    const rendered = renderMessageForTranscript(message);
    if (rendered) {
      sections.push(rendered);
    }
  }
  return sections.join("\n\n").trim();
}

function renderMessageForTranscript(message: Message): string | null {
  switch (message.role) {
    case "user": {
      const text = renderUserContent(message.content);
      return text ? `User:\n${text}` : null;
    }
    case "assistant": {
      const text = renderAssistantContent(message.content);
      return text ? `Assistant:\n${text}` : null;
    }
    case "toolResult": {
      const text = renderTextAndImageContent(message.content);
      return text ? `Tool result (${message.toolName}):\n${text}` : null;
    }
  }
}

function renderUserContent(content: MessageForRole<"user">["content"]): string {
  return typeof content === "string" ? content.trim() : renderTextAndImageContent(content);
}

function renderTextAndImageContent(content: readonly (TextContent | ImageContent)[]): string {
  return content
    .map((item) => {
      if (item.type === "text") {
        return item.text.trim();
      }
      return `[image: ${item.mimeType}]`;
    })
    .filter((item) => item.length > 0)
    .join("\n");
}

function renderAssistantContent(content: readonly AssistantMessage["content"][number][]): string {
  return content
    .map((item) => {
      switch (item.type) {
        case "text":
          return item.text.trim();
        case "thinking":
          return "";
        case "toolCall":
          return `[tool call: ${item.name}]`;
      }
    })
    .filter((item) => item.length > 0)
    .join("\n");
}

type MessageForRole<TRole extends Message["role"]> = Extract<Message, { role: TRole }>;

function latestUserImages(context: Context): SDKImage[] {
  for (let index = context.messages.length - 1; index >= 0; index -= 1) {
    const message = context.messages[index];
    if (message?.role !== "user" || typeof message.content === "string") {
      continue;
    }
    return message.content
      .filter((item): item is ImageContent => item.type === "image")
      .map((item) => ({
        data: item.data,
        mimeType: item.mimeType,
      }));
  }
  return [];
}

function applyCursorInteractionUpdate(
  stream: AssistantMessageEventStream,
  message: AssistantMessage,
  update: InteractionUpdate,
  toolEventState: CursorToolEventState,
): void {
  switch (update.type) {
    case "text-delta":
      appendTextDelta(stream, message, update.text);
      break;
    case "thinking-delta":
      appendThinkingDelta(stream, message, update.text);
      break;
    case "turn-ended":
      break;
    case "tool-call-started":
      appendCursorToolStarted(stream, message, update.callId, update.toolCall, toolEventState);
      break;
    case "tool-call-completed":
      appendCursorToolCompleted(stream, message, update.callId, update.toolCall, toolEventState);
      break;
    default:
      break;
  }
}

function applyCursorInteractionStep(
  stream: AssistantMessageEventStream,
  message: AssistantMessage,
  stepEnvelope: unknown,
  toolEventState: CursorToolEventState,
): void {
  const step = toRecord(stepEnvelope);
  if (!step || step.type !== "toolCall") {
    return;
  }
  const rawToolCall = step.message;
  const toolRecord = toRecord(rawToolCall);
  const stepId =
    stringField(step, "id") ??
    (toolRecord ? (stringField(toolRecord, "id") ?? stringField(toolRecord, "callId")) : undefined);
  if (!rawToolCall) {
    return;
  }
  const callId = stepId ?? `cursor-step:${cursorToolFingerprint(rawToolCall)}`;
  appendCursorToolCompleted(stream, message, callId, rawToolCall, toolEventState);
}

function createCursorToolEventState(): CursorToolEventState {
  return {
    contentIndexByCallId: new Map<string, number>(),
    completedCallIds: new Set<string>(),
    completedFingerprints: new Set<string>(),
  };
}

function appendCursorToolStarted(
  stream: AssistantMessageEventStream,
  message: AssistantMessage,
  callId: string,
  rawToolCall: unknown,
  state: CursorToolEventState,
): void {
  if (state.contentIndexByCallId.has(callId)) {
    return;
  }
  const toolCall = cursorSyntheticToolCall(callId, rawToolCall);
  if (!toolCall) {
    return;
  }
  const contentIndex = message.content.length;
  message.content.push(toolCall);
  stream.push({
    type: "toolcall_start",
    contentIndex,
    partial: message,
  });
  state.contentIndexByCallId.set(callId, contentIndex);
}

function appendCursorToolCompleted(
  stream: AssistantMessageEventStream,
  message: AssistantMessage,
  callId: string,
  rawToolCall: unknown,
  state: CursorToolEventState,
): void {
  const fingerprint = cursorToolFingerprint(rawToolCall);
  if (state.completedCallIds.has(callId) || state.completedFingerprints.has(fingerprint)) {
    return;
  }
  const toolCall = cursorSyntheticToolCall(callId, rawToolCall);
  if (!toolCall) {
    return;
  }
  let contentIndex = state.contentIndexByCallId.get(callId);
  if (contentIndex === undefined) {
    contentIndex = message.content.length;
    message.content.push(toolCall);
    stream.push({
      type: "toolcall_start",
      contentIndex,
      partial: message,
    });
    state.contentIndexByCallId.set(callId, contentIndex);
  } else {
    message.content[contentIndex] = toolCall;
  }
  stream.push({
    type: "toolcall_end",
    contentIndex,
    toolCall,
    partial: message,
  });
  state.completedCallIds.add(callId);
  state.completedFingerprints.add(fingerprint);
}

function cursorSyntheticToolCall(callId: string, rawToolCall: unknown): ToolCall | null {
  const record = toRecord(rawToolCall);
  if (!record) {
    return null;
  }
  const rawName =
    stringField(record, "name") ?? stringField(record, "type") ?? stringField(record, "toolName");
  if (!rawName) {
    return null;
  }
  return {
    type: "toolCall",
    id: callId,
    name: piToolNameForCursorTool(rawName),
    arguments: {
      ...cursorToolArguments(record),
      [CURSOR_SYNTHETIC_TOOL_EVENT_ARG]: true,
      ...(record.result !== undefined ? { [CURSOR_SYNTHETIC_TOOL_RESULT_ARG]: record.result } : {}),
    },
  };
}

function cursorToolFingerprint(rawToolCall: unknown): string {
  const record = toRecord(rawToolCall);
  if (!record) {
    return stringifyUsageValue(rawToolCall);
  }
  const name =
    stringField(record, "name") ??
    stringField(record, "type") ??
    stringField(record, "toolName") ??
    "";
  return [
    name,
    stringifyUsageValue(record.args),
    stringifyUsageValue(record.input),
    stringifyUsageValue(record.result),
  ].join("\n");
}

function piToolNameForCursorTool(toolName: string): string {
  return toolName === "shell" ? "bash" : toolName;
}

function cursorToolArguments(toolCall: Record<string, unknown>): Record<string, unknown> {
  return recordField(toolCall, "args") ?? recordField(toolCall, "input") ?? {};
}

function isSyntheticCursorToolContent(content: AssistantContent): boolean {
  return (
    content.type === "toolCall" && content.arguments[CURSOR_SYNTHETIC_TOOL_EVENT_ARG] === true
  );
}

function stripSyntheticCursorToolContent(message: AssistantMessage): void {
  message.content = message.content.filter((content) => !isSyntheticCursorToolContent(content));
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function recordField(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  return toRecord(record[key]) ?? undefined;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function appendTextDelta(
  stream: AssistantMessageEventStream,
  message: AssistantMessage,
  delta: string,
): void {
  if (!delta) {
    return;
  }
  const contentIndex = ensureTextContent(stream, message);
  const content = requireTextContent(message, contentIndex);
  content.text += delta;
  stream.push({ type: "text_delta", contentIndex, delta, partial: message });
}

function appendThinkingDelta(
  stream: AssistantMessageEventStream,
  message: AssistantMessage,
  delta: string,
): void {
  if (!delta) {
    return;
  }
  const contentIndex = ensureThinkingContent(stream, message);
  const content = requireThinkingContent(message, contentIndex);
  content.thinking += delta;
  stream.push({ type: "thinking_delta", contentIndex, delta, partial: message });
}

function appendFinalTextIfNeeded(
  stream: AssistantMessageEventStream,
  message: AssistantMessage,
  result: string | undefined,
): void {
  const text = result?.trim();
  if (!text || hasTextContent(message)) {
    return;
  }
  appendTextDelta(stream, message, text);
}

function ensureTextContent(stream: AssistantMessageEventStream, message: AssistantMessage): number {
  const existingIndex = message.content.findIndex((item) => item.type === "text");
  if (existingIndex !== -1) {
    return existingIndex;
  }
  const contentIndex = message.content.length;
  message.content.push({ type: "text", text: "" });
  stream.push({ type: "text_start", contentIndex, partial: message });
  return contentIndex;
}

function ensureThinkingContent(
  stream: AssistantMessageEventStream,
  message: AssistantMessage,
): number {
  const existingIndex = message.content.findIndex((item) => item.type === "thinking");
  if (existingIndex !== -1) {
    return existingIndex;
  }
  const contentIndex = message.content.length;
  message.content.push({ type: "thinking", thinking: "" });
  stream.push({ type: "thinking_start", contentIndex, partial: message });
  return contentIndex;
}

function requireTextContent(message: AssistantMessage, contentIndex: number): TextContent {
  const content = message.content[contentIndex];
  if (!content || content.type !== "text") {
    throw new Error("Cursor Composer stream attempted to update a non-text content block.");
  }
  return content;
}

function requireThinkingContent(message: AssistantMessage, contentIndex: number): ThinkingContent {
  const content = message.content[contentIndex];
  if (!content || content.type !== "thinking") {
    throw new Error("Cursor Composer stream attempted to update a non-thinking content block.");
  }
  return content;
}

function hasTextContent(message: AssistantMessage): boolean {
  return message.content.some((item) => item.type === "text" && item.text.trim().length > 0);
}

function endOpenContent(stream: AssistantMessageEventStream, message: AssistantMessage): void {
  for (const [contentIndex, content] of message.content.entries()) {
    if (content.type === "text") {
      stream.push({
        type: "text_end",
        contentIndex,
        content: content.text,
        partial: message,
      });
    }
    if (content.type === "thinking") {
      stream.push({
        type: "thinking_end",
        contentIndex,
        content: content.thinking,
        partial: message,
      });
    }
  }
}

function pushError(
  stream: AssistantMessageEventStream,
  message: AssistantMessage,
  errorMessage: string,
  reason: "error" | "aborted",
): void {
  endOpenContent(stream, message);
  stripSyntheticCursorToolContent(message);
  message.stopReason = reason;
  message.errorMessage = errorMessage;
  stream.push({ type: "error", reason, error: message });
}

function throwIfAborted(options: SimpleStreamOptions | undefined): void {
  if (options?.signal?.aborted) {
    throw new CursorComposerAbortError();
  }
}

function scrubApiKey(message: string, apiKey: string): string {
  return message.split(apiKey).join("[redacted]");
}
