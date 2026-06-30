/**
 * Claude Agent provider.
 *
 * Drives Claude/Anthropic models through the official
 * `@anthropic-ai/claude-agent-sdk` (the Claude Code harness) instead of pi's
 * built-in `anthropic-messages` HTTP path, while pi keeps owning the session
 * tree, persistence, branching, resume, and the UI.
 *
 * The integration mirrors {@link ./cursor-composer-provider.ts}: it registers a
 * custom `streamSimple` handler for the `anthropic-messages` API (pi installs it
 * as the global stream handler for that API, so every anthropic model routes
 * through it; the model catalog / OAuth / baseUrl are untouched). `streamSimple`
 * runs the SDK's `query()` and translates the `SDKMessage` stream into pi's
 * `AssistantMessageEventStream`. Tool activity is emitted as *synthetic*
 * tool-call content blocks (tagged and stripped before `done`, like Cursor) so
 * pi neither executes nor persists them — the SDK runs its own Claude Code
 * tools.
 *
 * v1 is stateless per turn (like Cursor): pi owns history, and each turn flattens
 * pi's `context` into a fresh `query()`. pi registers `streamSimple` into a
 * process-global, last-write-wins API registry, so per-thread session state in a
 * closure is unreliable; SDK-side session resume / prompt caching is a follow-up
 * that needs a per-thread key threaded through.
 *
 * @module claude-agent-provider
 */
import process from "node:process";

import {
  type CanUseTool,
  type Options as ClaudeQueryOptions,
  type SDKMessage,
  type SDKUserMessage,
  query,
} from "@anthropic-ai/claude-agent-sdk";
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
  type ToolCall,
  type Usage,
} from "@earendil-works/pi-ai";
import type { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";

/** Provider id whose stream handler we override. */
const CLAUDE_PROVIDER_ID = "anthropic";
/** API string the anthropic models use; registering `streamSimple` for it overrides the built-in handler. */
const CLAUDE_API = "anthropic-messages";
/**
 * Markers placed on synthetic tool-call content blocks so the projection layer
 * (`event-projection.ts`) can turn them into `tool.started`/`tool.completed`
 * events and then strip them before the message is persisted. Mirrors the
 * Cursor convention; the result is already normalized to `{content, details}`.
 */
const CLAUDE_SYNTHETIC_TOOL_EVENT_ARG = "__honkClaudeSyntheticToolEvent";
const CLAUDE_SYNTHETIC_TOOL_RESULT_ARG = "__honkClaudeResult";

const CLAUDE_ONE_MILLION_CONTEXT_WINDOW = 1_000_000;
const CLAUDE_APPROX_CHARS_PER_TOKEN = 4;
const CLAUDE_IMAGE_TOKEN_ESTIMATE = 1_200;
const CLAUDE_SETTING_SOURCES = ["user", "project", "local"] as const;

interface ClaudeAgentProviderOptions {
  readonly cwd: string;
  readonly authStorage?: AuthStorage | undefined;
}

class ClaudeAgentAbortError extends Error {
  constructor() {
    super("Claude Agent request was aborted.");
  }
}

interface ClaudeImage {
  readonly data: string;
  readonly mimeType: string;
}

interface ClaudeUserInput {
  readonly text: string;
  readonly images: readonly ClaudeImage[];
}

type AssistantContent = AssistantMessage["content"][number];

export function registerClaudeAgentProvider(
  modelRegistry: Pick<ModelRegistry, "registerProvider">,
  options: ClaudeAgentProviderOptions,
): void {
  // Register `streamSimple` for the `anthropic-messages` API. pi requires `api`
  // here and installs the handler as the override for that API; the anthropic
  // model catalog, OAuth, and baseUrl are preserved (no `models` provided).
  modelRegistry.registerProvider(CLAUDE_PROVIDER_ID, {
    api: CLAUDE_API as Api,
    streamSimple: (model, context, streamOptions) =>
      streamClaudeAgent(model, context, streamOptions, {
        cwd: options.cwd,
        authStorage: options.authStorage,
      }),
  });
}

function streamClaudeAgent(
  model: Model<Api>,
  context: Context,
  options: SimpleStreamOptions | undefined,
  providerOptions: { readonly cwd: string; readonly authStorage: AuthStorage | undefined },
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const message = createInitialAssistantMessage(model);
  stream.push({ type: "start", partial: message });

  void runClaudeAgentStream({ model, context, options, providerOptions, stream, message });

  return stream;
}

async function runClaudeAgentStream(input: {
  readonly model: Model<Api>;
  readonly context: Context;
  readonly options: SimpleStreamOptions | undefined;
  readonly providerOptions: { readonly cwd: string; readonly authStorage: AuthStorage | undefined };
  readonly stream: AssistantMessageEventStream;
  readonly message: AssistantMessage;
}): Promise<void> {
  const { stream, message, context, options, providerOptions } = input;

  const abortController = new AbortController();
  const onAbort = () => abortController.abort();
  options?.signal?.addEventListener("abort", onAbort, { once: true });

  // Tracks the assistant message's open streaming blocks (Anthropic block index
  // -> pi content index) and the synthetic tool calls awaiting their results.
  const openBlockByStreamIndex = new Map<number, { piIndex: number; kind: "text" | "thinking" }>();
  const toolIndexByUseId = new Map<string, number>();

  try {
    throwIfAborted(options);

    // pi owns history; each turn flattens the full context into one fresh query.
    const promptInput: ClaudeUserInput = {
      text: buildClaudeTranscript(context),
      images: latestClaudeImages(context),
    };
    const promptInputTokens = estimateClaudeInputTokens(promptInput);

    const apiModelId = resolveClaudeApiModelId(input.model);
    const env = await resolveClaudeAuthEnv(providerOptions.authStorage, options?.apiKey);

    const canUseTool: CanUseTool = (_toolName, toolInput) =>
      Promise.resolve({ behavior: "allow", updatedInput: toolInput });

    const queryOptions: ClaudeQueryOptions = {
      cwd: providerOptions.cwd,
      additionalDirectories: [providerOptions.cwd],
      ...(apiModelId ? { model: apiModelId } : {}),
      systemPrompt: { type: "preset", preset: "claude_code" },
      settingSources: [...CLAUDE_SETTING_SOURCES],
      includePartialMessages: true,
      permissionMode: "default",
      canUseTool,
      env,
      abortController,
    };

    const runtime = query({
      prompt: claudePromptIterable(promptInput),
      options: queryOptions,
    });

    for await (const sdkMessage of runtime) {
      throwIfAborted(options);
      const finished = handleClaudeSdkMessage({
        sdkMessage,
        stream,
        message,
        openBlockByStreamIndex,
        toolIndexByUseId,
      });
      if (finished) {
        break;
      }
    }

    finalizeClaudeMessage(stream, message, promptInputTokens);
  } catch (error) {
    const aborted = error instanceof ClaudeAgentAbortError || options?.signal?.aborted === true;
    pushClaudeError(
      stream,
      message,
      aborted ? "Claude Agent request was aborted." : formatClaudeError(error),
      aborted ? "aborted" : "error",
    );
  } finally {
    options?.signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Translate a single `SDKMessage` into pi stream events. Returns `true` when the
 * turn is finished (a `result` message), signalling the caller to finalize.
 */
function handleClaudeSdkMessage(input: {
  readonly sdkMessage: SDKMessage;
  readonly stream: AssistantMessageEventStream;
  readonly message: AssistantMessage;
  readonly openBlockByStreamIndex: Map<number, { piIndex: number; kind: "text" | "thinking" }>;
  readonly toolIndexByUseId: Map<string, number>;
}): boolean {
  const { sdkMessage, stream, message, openBlockByStreamIndex, toolIndexByUseId } = input;

  switch (sdkMessage.type) {
    case "stream_event": {
      applyClaudeStreamEvent(stream, message, sdkMessage.event, openBlockByStreamIndex);
      return false;
    }
    case "assistant": {
      applyClaudeAssistantToolUses(stream, message, sdkMessage.message, toolIndexByUseId);
      return false;
    }
    case "user": {
      applyClaudeToolResults(stream, message, sdkMessage.message, toolIndexByUseId);
      return false;
    }
    case "result": {
      applyClaudeResultUsage(message, sdkMessage);
      return true;
    }
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Stream-event (partial assistant) handling: text + thinking deltas.
// ---------------------------------------------------------------------------

function applyClaudeStreamEvent(
  stream: AssistantMessageEventStream,
  message: AssistantMessage,
  event: unknown,
  openBlockByStreamIndex: Map<number, { piIndex: number; kind: "text" | "thinking" }>,
): void {
  const record = toRecord(event);
  if (!record) {
    return;
  }
  const eventType = stringField(record, "type");
  const streamIndex = numberField(record, "index");

  if (eventType === "content_block_start" && streamIndex !== undefined) {
    const block = toRecord(record.content_block);
    const blockType = block ? stringField(block, "type") : undefined;
    if (blockType === "text") {
      openBlockByStreamIndex.set(streamIndex, {
        piIndex: openClaudeTextBlock(stream, message),
        kind: "text",
      });
    } else if (blockType === "thinking") {
      openBlockByStreamIndex.set(streamIndex, {
        piIndex: openClaudeThinkingBlock(stream, message),
        kind: "thinking",
      });
    }
    return;
  }

  if (eventType === "content_block_delta" && streamIndex !== undefined) {
    const delta = toRecord(record.delta);
    const deltaType = delta ? stringField(delta, "type") : undefined;
    const open = openBlockByStreamIndex.get(streamIndex);
    if (!open || !delta) {
      return;
    }
    if (deltaType === "text_delta" && open.kind === "text") {
      const text = typeof delta.text === "string" ? delta.text : "";
      appendClaudeTextDelta(stream, message, open.piIndex, text);
    } else if (deltaType === "thinking_delta" && open.kind === "thinking") {
      const thinking = typeof delta.thinking === "string" ? delta.thinking : "";
      appendClaudeThinkingDelta(stream, message, open.piIndex, thinking);
    }
    return;
  }

  if (eventType === "content_block_stop" && streamIndex !== undefined) {
    const open = openBlockByStreamIndex.get(streamIndex);
    if (open) {
      closeClaudeBlock(stream, message, open.piIndex, open.kind);
      openBlockByStreamIndex.delete(streamIndex);
    }
  }
}

// ---------------------------------------------------------------------------
// Tool calls (from the full assistant message) and results (from user messages)
// are surfaced as synthetic tool-call content blocks, like Cursor.
// ---------------------------------------------------------------------------

function applyClaudeAssistantToolUses(
  stream: AssistantMessageEventStream,
  message: AssistantMessage,
  assistantMessage: unknown,
  toolIndexByUseId: Map<string, number>,
): void {
  for (const rawBlock of contentBlocks(assistantMessage)) {
    const block = toRecord(rawBlock);
    if (!block || block.type !== "tool_use") {
      continue;
    }
    const id = stringField(block, "id");
    const name = stringField(block, "name");
    if (!id || !name || toolIndexByUseId.has(id)) {
      continue;
    }
    const args = toRecord(block.input) ?? {};
    const toolCall = claudeSyntheticToolCall(id, name, args, undefined, false);
    const contentIndex = message.content.length;
    message.content.push(toolCall);
    stream.push({ type: "toolcall_start", contentIndex, partial: message });
    toolIndexByUseId.set(id, contentIndex);
  }
}

function applyClaudeToolResults(
  stream: AssistantMessageEventStream,
  message: AssistantMessage,
  userMessage: unknown,
  toolIndexByUseId: Map<string, number>,
): void {
  for (const rawBlock of contentBlocks(userMessage)) {
    const block = toRecord(rawBlock);
    if (!block || block.type !== "tool_result") {
      continue;
    }
    const toolUseId = stringField(block, "tool_use_id");
    if (!toolUseId) {
      continue;
    }
    const contentIndex = toolIndexByUseId.get(toolUseId);
    if (contentIndex === undefined) {
      continue;
    }
    const existing = message.content[contentIndex];
    if (!existing || existing.type !== "toolCall") {
      continue;
    }
    const isError = block.is_error === true;
    const resultText = extractClaudeToolResultText(block.content);
    const normalizedResult = {
      content: resultText ? [{ type: "text", text: resultText }] : [],
      details: {},
    };
    const toolCall = claudeSyntheticToolCall(
      existing.id,
      existing.name,
      publicSyntheticToolArguments(existing.arguments),
      normalizedResult,
      isError,
    );
    message.content[contentIndex] = toolCall;
    stream.push({ type: "toolcall_end", contentIndex, toolCall, partial: message });
  }
}

function claudeSyntheticToolCall(
  id: string,
  name: string,
  args: Record<string, unknown>,
  result: unknown,
  isError: boolean,
): ToolCall {
  return {
    type: "toolCall",
    id,
    name,
    arguments: {
      ...args,
      [CLAUDE_SYNTHETIC_TOOL_EVENT_ARG]: true,
      ...(result !== undefined
        ? { [CLAUDE_SYNTHETIC_TOOL_RESULT_ARG]: { result, isError } }
        : {}),
    },
  };
}

function publicSyntheticToolArguments(input: Record<string, unknown>): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === CLAUDE_SYNTHETIC_TOOL_EVENT_ARG || key === CLAUDE_SYNTHETIC_TOOL_RESULT_ARG) {
      continue;
    }
    args[key] = value;
  }
  return args;
}

// ---------------------------------------------------------------------------
// Content-block helpers (mirror cursor-composer-provider.ts).
// ---------------------------------------------------------------------------

function openClaudeTextBlock(stream: AssistantMessageEventStream, message: AssistantMessage): number {
  const contentIndex = message.content.length;
  message.content.push({ type: "text", text: "" });
  stream.push({ type: "text_start", contentIndex, partial: message });
  return contentIndex;
}

function openClaudeThinkingBlock(
  stream: AssistantMessageEventStream,
  message: AssistantMessage,
): number {
  const contentIndex = message.content.length;
  message.content.push({ type: "thinking", thinking: "" });
  stream.push({ type: "thinking_start", contentIndex, partial: message });
  return contentIndex;
}

function appendClaudeTextDelta(
  stream: AssistantMessageEventStream,
  message: AssistantMessage,
  contentIndex: number,
  delta: string,
): void {
  if (!delta) {
    return;
  }
  const content = message.content[contentIndex];
  if (!content || content.type !== "text") {
    return;
  }
  content.text += delta;
  stream.push({ type: "text_delta", contentIndex, delta, partial: message });
}

function appendClaudeThinkingDelta(
  stream: AssistantMessageEventStream,
  message: AssistantMessage,
  contentIndex: number,
  delta: string,
): void {
  if (!delta) {
    return;
  }
  const content = message.content[contentIndex];
  if (!content || content.type !== "thinking") {
    return;
  }
  content.thinking += delta;
  stream.push({ type: "thinking_delta", contentIndex, delta, partial: message });
}

function closeClaudeBlock(
  stream: AssistantMessageEventStream,
  message: AssistantMessage,
  contentIndex: number,
  kind: "text" | "thinking",
): void {
  const content = message.content[contentIndex];
  if (!content) {
    return;
  }
  if (kind === "text" && content.type === "text") {
    stream.push({ type: "text_end", contentIndex, content: content.text, partial: message });
  } else if (kind === "thinking" && content.type === "thinking") {
    stream.push({ type: "thinking_end", contentIndex, content: content.thinking, partial: message });
  }
}

function endOpenClaudeContent(stream: AssistantMessageEventStream, message: AssistantMessage): void {
  for (const [contentIndex, content] of message.content.entries()) {
    if (content.type === "text") {
      stream.push({ type: "text_end", contentIndex, content: content.text, partial: message });
    } else if (content.type === "thinking") {
      stream.push({ type: "thinking_end", contentIndex, content: content.thinking, partial: message });
    }
  }
}

function finalizeClaudeMessage(
  stream: AssistantMessageEventStream,
  message: AssistantMessage,
  promptInputTokens: number,
): void {
  endOpenClaudeContent(stream, message);
  stripSyntheticClaudeToolContent(message);
  if (message.usage.totalTokens === 0) {
    applyClaudeApproximateUsage(message, promptInputTokens);
  }
  message.stopReason = "stop";
  stream.push({ type: "done", reason: "stop", message });
}

function pushClaudeError(
  stream: AssistantMessageEventStream,
  message: AssistantMessage,
  errorMessage: string,
  reason: "error" | "aborted",
): void {
  endOpenClaudeContent(stream, message);
  stripSyntheticClaudeToolContent(message);
  message.stopReason = reason;
  message.errorMessage = errorMessage;
  stream.push({ type: "error", reason, error: message });
}

function isSyntheticClaudeToolContent(content: AssistantContent): boolean {
  return content.type === "toolCall" && content.arguments[CLAUDE_SYNTHETIC_TOOL_EVENT_ARG] === true;
}

function stripSyntheticClaudeToolContent(message: AssistantMessage): void {
  message.content = message.content.filter((content) => !isSyntheticClaudeToolContent(content));
}

// ---------------------------------------------------------------------------
// Usage.
// ---------------------------------------------------------------------------

function applyClaudeResultUsage(message: AssistantMessage, result: SDKMessage): void {
  const record = toRecord(result);
  const usage = record ? toRecord(record.usage) : null;
  if (!usage) {
    return;
  }
  const input = numberField(usage, "input_tokens") ?? 0;
  const output = numberField(usage, "output_tokens") ?? 0;
  const cacheWrite = numberField(usage, "cache_creation_input_tokens") ?? 0;
  const cacheRead = numberField(usage, "cache_read_input_tokens") ?? 0;
  message.usage = createUsage(input, output, cacheRead, cacheWrite);
}

function applyClaudeApproximateUsage(message: AssistantMessage, promptInputTokens: number): void {
  message.usage = createUsage(
    Math.max(0, Math.round(promptInputTokens)),
    estimateClaudeAssistantOutputTokens(message),
    0,
    0,
  );
}

function createUsage(input = 0, output = 0, cacheRead = 0, cacheWrite = 0): Usage {
  const totalTokens = input + output + cacheRead + cacheWrite;
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

// ---------------------------------------------------------------------------
// Prompt construction.
// ---------------------------------------------------------------------------

async function* claudePromptIterable(input: ClaudeUserInput): AsyncGenerator<SDKUserMessage> {
  yield buildClaudeUserMessage(input);
}

function buildClaudeUserMessage(input: ClaudeUserInput): SDKUserMessage {
  const content: Array<Record<string, unknown>> = [];
  if (input.text) {
    content.push({ type: "text", text: input.text });
  }
  for (const image of input.images) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: image.mimeType, data: image.data },
    });
  }
  return {
    type: "user",
    message: { role: "user", content: content.length > 0 ? content : "" },
    parent_tool_use_id: null,
    session_id: "",
  } as unknown as SDKUserMessage;
}

function latestClaudeImages(context: Context): readonly ClaudeImage[] {
  for (let index = context.messages.length - 1; index >= 0; index -= 1) {
    const entry = context.messages[index];
    if (entry?.role !== "user") {
      continue;
    }
    return imagesFromUserContent(entry.content);
  }
  return [];
}

function imagesFromUserContent(content: Message["content"]): ClaudeImage[] {
  if (typeof content === "string") {
    return [];
  }
  return content
    .filter((item): item is ImageContent => item.type === "image")
    .map((item) => ({ data: item.data, mimeType: item.mimeType }));
}

function buildClaudeTranscript(context: Context): string {
  const sections: string[] = [];
  const systemPrompt = context.systemPrompt?.trim();
  if (systemPrompt) {
    sections.push(`System:\n${systemPrompt}`);
  }
  for (const message of context.messages) {
    const rendered = renderClaudeMessageForTranscript(message);
    if (rendered) {
      sections.push(rendered);
    }
  }
  return sections.join("\n\n").trim();
}

function renderClaudeMessageForTranscript(message: Message): string | null {
  switch (message.role) {
    case "user": {
      const text =
        typeof message.content === "string"
          ? message.content.trim()
          : renderTextAndImageContent(message.content);
      return text ? `User:\n${text}` : null;
    }
    case "assistant": {
      const text = renderClaudeAssistantContent(message.content);
      return text ? `Assistant:\n${text}` : null;
    }
    case "toolResult": {
      const text = renderTextAndImageContent(message.content);
      return text ? `Tool result (${message.toolName}):\n${text}` : null;
    }
  }
}

function renderTextAndImageContent(content: readonly (TextContent | ImageContent)[]): string {
  return content
    .map((item) => (item.type === "text" ? item.text.trim() : `[image: ${item.mimeType}]`))
    .filter((item) => item.length > 0)
    .join("\n");
}

function renderClaudeAssistantContent(content: AssistantMessage["content"]): string {
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

// ---------------------------------------------------------------------------
// Auth.
// ---------------------------------------------------------------------------

/**
 * Build the subprocess env so the Claude Code SDK authenticates with honk's
 * stored Anthropic credential. An explicit env var always wins; an `oauth`
 * credential is injected as `CLAUDE_CODE_OAUTH_TOKEN`, an `api_key` as
 * `ANTHROPIC_API_KEY`. When honk has no stored credential the subprocess
 * inherits `process.env` and the SDK falls back to the user's own Claude Code
 * login (`~/.claude`).
 */
async function resolveClaudeAuthEnv(
  authStorage: AuthStorage | undefined,
  fallbackApiKey: string | undefined,
): Promise<Record<string, string | undefined>> {
  const env: Record<string, string | undefined> = { ...process.env };
  if (env.ANTHROPIC_API_KEY || env.CLAUDE_CODE_OAUTH_TOKEN || env.ANTHROPIC_AUTH_TOKEN) {
    return env;
  }
  if (authStorage) {
    const credential = authStorage.get(CLAUDE_PROVIDER_ID);
    const token = await authStorage.getApiKey(CLAUDE_PROVIDER_ID).catch(() => undefined);
    if (token) {
      const providerEnv = authStorage.getProviderEnv(CLAUDE_PROVIDER_ID) ?? {};
      return credential?.type === "oauth"
        ? { ...env, ...providerEnv, CLAUDE_CODE_OAUTH_TOKEN: token }
        : { ...env, ...providerEnv, ANTHROPIC_API_KEY: token };
    }
  }
  if (fallbackApiKey && fallbackApiKey.trim().length > 0) {
    return { ...env, ANTHROPIC_API_KEY: fallbackApiKey };
  }
  return env;
}

// ---------------------------------------------------------------------------
// Misc helpers.
// ---------------------------------------------------------------------------

function resolveClaudeApiModelId(model: Model<Api>): string {
  return model.contextWindow >= CLAUDE_ONE_MILLION_CONTEXT_WINDOW ? `${model.id}[1m]` : model.id;
}

function createInitialAssistantMessage(model: Model<Api>): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: createUsage(),
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function contentBlocks(message: unknown): readonly unknown[] {
  const record = toRecord(message);
  const content = record?.content;
  return Array.isArray(content) ? content : [];
}

function extractClaudeToolResultText(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const chunks: string[] = [];
  for (const item of content) {
    const record = toRecord(item);
    if (record?.type === "text" && typeof record.text === "string") {
      const text = record.text.trim();
      if (text) {
        chunks.push(text);
      }
    }
  }
  return chunks.join("\n");
}

function estimateTextTokens(text: string): number {
  return text.length > 0 ? Math.ceil(text.length / CLAUDE_APPROX_CHARS_PER_TOKEN) : 0;
}

function estimateClaudeInputTokens(input: ClaudeUserInput): number {
  return estimateTextTokens(input.text) + input.images.length * CLAUDE_IMAGE_TOKEN_ESTIMATE;
}

function estimateClaudeAssistantOutputTokens(message: AssistantMessage): number {
  const text = message.content
    .map((block) => {
      switch (block.type) {
        case "text":
          return block.text;
        case "thinking":
          return block.thinking;
        case "toolCall":
          return `${block.name} ${stringifyValue(block.arguments)}`;
      }
    })
    .filter((part) => part.length > 0)
    .join("\n");
  return estimateTextTokens(text);
}

function formatClaudeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : stringifyValue(error);
}

function throwIfAborted(options: SimpleStreamOptions | undefined): void {
  if (options?.signal?.aborted) {
    throw new ClaudeAgentAbortError();
  }
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringifyValue(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}
