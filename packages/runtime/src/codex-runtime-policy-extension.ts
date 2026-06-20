import type { AgentModelPolicy } from "@honk/contracts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { clampThinkingLevel } from "@earendil-works/pi-ai";
import type { Api, Context, Model } from "@earendil-works/pi-ai";
import {
  convertToLlm,
  type CompactionEntry,
  type CompactionResult,
  type ExtensionContext,
  type ExtensionFactory,
  type SessionBeforeCompactEvent,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";

const CODEX_TOOL_USE_NUDGE = [
  "Codex tool-use note: use the available shell, stdin, apply_patch, image, and web tools directly when they fit.",
  "Inspect files with shell commands and edit text files with apply_patch patches instead of ad hoc shell rewrites.",
  "When the latest user message starts with `Goal:`, treat the remainder as the active durable objective: keep working until it is complete or genuinely blocked, and make final completion or blocker status explicit.",
].join(" ");

const OPENAI_COMPACT_PATH = "responses/compact";
const CODEX_COMPACT_PATH = "codex/responses/compact";
const RESPONSES_API_IDS = ["openai-responses", "openai-codex-responses"] as const;
const OPENAI_PROVIDER_IDS: ReadonlySet<string> = new Set(["openai", "openai-codex"]);
const RESPONSES_APIS: ReadonlySet<string> = new Set(RESPONSES_API_IDS);
const TOOL_CALL_PROVIDER_IDS: ReadonlySet<string> = new Set(["openai", "openai-codex", "opencode"]);
const OPENAI_COMPACT_STRATEGY = "openai-compact-v1";
const OPENAI_COMPACT_DISPLAY_PLACEHOLDER = "[OpenAI compact checkpoint]";
const OPENAI_COMPACT_OUTPUT_ITEM_TYPES = new Set([
  "compaction",
  "compaction_summary",
  "context_compaction",
]);
const OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH = 64;

type SupportedResponsesApi = (typeof RESPONSES_API_IDS)[number];
type LlmMessage = Context["messages"][number];
type AssistantMessage = Extract<LlmMessage, { readonly role: "assistant" }>;
type UserMessage = Extract<LlmMessage, { readonly role: "user" }>;
type ToolResultMessage = Extract<LlmMessage, { readonly role: "toolResult" }>;
type MessageContentItem = Exclude<UserMessage["content"], string>[number];
type TextContent = Extract<MessageContentItem, { readonly type: "text" }>;
type ImageContent = Extract<MessageContentItem, { readonly type: "image" }>;
type ToolCallContent = Extract<AssistantMessage["content"][number], { readonly type: "toolCall" }>;

type ResponsesInputContentItem =
  | ReturnType<typeof createResponsesInputText>
  | ReturnType<typeof createResponsesInputImage>
  | ReturnType<typeof createResponsesEncryptedContent>;

type ResponsesInputMessageItem = {
  readonly role: "user" | "developer" | "system";
  readonly content: readonly ResponsesInputContentItem[] | string;
};

type ResponsesInputItem = ResponsesInputMessageItem | Record<string, unknown>;
type OpenAICompactRequestInfo = {
  readonly tokensBefore?: number;
  readonly previousSummaryPresent?: boolean;
};

type OpenAICompactDetails = ReturnType<typeof createOpenAICompactDetails>;

type OpenAICompactEntry = CompactionEntry<OpenAICompactDetails> & {
  readonly details: OpenAICompactDetails;
};

type OpenAIResponsesRequestPayload = {
  readonly model: string;
  readonly input: readonly unknown[];
  readonly instructions?: unknown;
  readonly [key: string]: unknown;
};

type PromptEnvelope = {
  readonly instructions?: string;
  readonly leadingInput: readonly ResponsesInputMessageItem[];
  readonly trailingInput: readonly ResponsesInputMessageItem[];
};

type SerializedPiMessages = {
  readonly input: readonly ResponsesInputItem[];
};

type PiCompactPlaceholderMatch = {
  readonly piKeptMessages: SerializedPiMessages;
  readonly extraPostCompactionTail: readonly ResponsesInputItem[];
};

type TextSignature = {
  readonly id: string;
  readonly phase?: "commentary" | "final_answer";
};

export function createCodexRuntimePolicyExtension(policy: AgentModelPolicy): ExtensionFactory {
  return (pi) => {
    pi.on("before_agent_start", (event) => {
      if (!isCodexAgentMode(policy.agentMode) || !isOpenAIPolicyModel(policy.modelSelection)) {
        return undefined;
      }
      return {
        systemPrompt: `${event.systemPrompt}\n\n${CODEX_TOOL_USE_NUDGE}`,
      };
    });

    pi.on("session_before_compact", (event, ctx) =>
      handleOpenAICompactBeforePiCompact({ event, ctx, policy }),
    );

    pi.on("before_provider_request", async (event, ctx) => {
      let nextPayload = event.payload;
      let changed = false;

      const replacementPayload = await replacePiCompactSummaryWithOpenAICompactItems(
        nextPayload,
        ctx,
        policy,
      );
      if (replacementPayload !== undefined) {
        nextPayload = replacementPayload;
        changed = true;
      }

      if (policy.fast && isOpenAIPolicyModel(policy.modelSelection) && isRecord(nextPayload)) {
        nextPayload = {
          ...nextPayload,
          service_tier: "priority",
        };
        changed = true;
      }

      return changed ? nextPayload : undefined;
    });
  };
}

async function handleOpenAICompactBeforePiCompact(input: {
  readonly event: SessionBeforeCompactEvent;
  readonly ctx: ExtensionContext;
  readonly policy: AgentModelPolicy;
}): Promise<{ readonly cancel?: boolean; readonly compaction?: CompactionResult } | undefined> {
  if (!shouldUseOpenAICompact(input.policy)) {
    return undefined;
  }
  if (input.event.signal.aborted) {
    return { cancel: true };
  }

  const target = await getOpenAICompactTarget(input.ctx);
  if (!target) {
    return undefined;
  }

  const request = createOpenAICompactRequest({
    event: input.event,
    ctx: input.ctx,
    target,
    policy: input.policy,
  });
  if (request.input.length === 0) {
    return undefined;
  }

  const compactResult = await callOpenAICompactEndpoint({
    target,
    request,
    signal: input.event.signal,
  });
  if (!compactResult.ok) {
    if (compactResult.reason !== "aborted") {
      input.ctx.ui.notify(formatOpenAICompactFailureMessage(compactResult), "error");
    }
    return compactResult.reason === "aborted" ? { cancel: true } : undefined;
  }

  const openAICompactItems = sanitizeOpenAICompactItems(compactResult.openAICompactItems);
  if (openAICompactItems.length === 0 || !hasOpenAICompactOutputItem(openAICompactItems)) {
    input.ctx.ui.notify("OpenAI compact returned no installable compact context.", "error");
    return undefined;
  }

  const encryptedSummary = extractOpenAICompactSummaryText(openAICompactItems);
  if (!encryptedSummary) {
    input.ctx.ui.notify(
      "OpenAI compact returned compact context without a displayable summary.",
      "error",
    );
    return undefined;
  }

  return {
    compaction: {
      summary: OPENAI_COMPACT_DISPLAY_PLACEHOLDER,
      firstKeptEntryId: input.event.preparation.firstKeptEntryId,
      tokensBefore: input.event.preparation.tokensBefore,
      details: createOpenAICompactDetails({
        provider: target.provider,
        api: target.api,
        model: target.model,
        baseUrl: target.baseUrl,
        openAICompactItems,
        ...(compactResult.compactResponseId
          ? { compactResponseId: compactResult.compactResponseId }
          : {}),
        ...(compactResult.createdAt ? { createdAt: compactResult.createdAt } : {}),
        requestInfo: {
          tokensBefore: input.event.preparation.tokensBefore,
          previousSummaryPresent: Boolean(input.event.preparation.previousSummary),
        },
      }),
    },
  };
}

async function replacePiCompactSummaryWithOpenAICompactItems(
  payload: unknown,
  ctx: ExtensionContext,
  policy: AgentModelPolicy,
): Promise<OpenAIResponsesRequestPayload | undefined> {
  if (!shouldUseOpenAICompact(policy)) {
    return undefined;
  }
  const target = await getOpenAICompactTarget(ctx, payload);
  if (!target?.payload) {
    return undefined;
  }

  const branchEntries = ctx.sessionManager.getBranch();
  const compactionEntry = findLatestOpenAICompactEntry(branchEntries, target);
  if (!compactionEntry) {
    return undefined;
  }

  const rewrite = replacePiCompactPlaceholderInResponsesPayload({
    model: target.currentModel,
    payload: target.payload,
    branchEntries,
    compactionEntry,
  });
  if (rewrite.ok) {
    return rewrite.rewrittenPayload;
  }

  const detail = rewrite.inputDiff?.mismatches.slice(0, 3).join("; ");
  const message = `OpenAI compact payload replacement failed (${rewrite.reason})${
    detail ? `: ${detail}` : ""
  }; request was not sent with placeholder compaction context.`;
  ctx.ui.notify(message, "error");
  throw new Error(message);
}

function shouldUseOpenAICompact(policy: AgentModelPolicy): boolean {
  return policy.agentMode === "deep" && isOpenAIPolicyModel(policy.modelSelection);
}

function isCodexAgentMode(agentMode: AgentModelPolicy["agentMode"]): boolean {
  return agentMode === "deep" || agentMode === "rush";
}

function isOpenAIPolicyModel(modelSelection: AgentModelPolicy["modelSelection"]): boolean {
  if (modelSelection.type !== "explicit") {
    return false;
  }
  const provider = String(modelSelection.authProviderId);
  return OPENAI_PROVIDER_IDS.has(provider);
}

async function getOpenAICompactTarget(ctx: ExtensionContext, payload?: unknown) {
  const currentModel = ctx.model as Model<Api> | undefined;
  if (!currentModel || !OPENAI_PROVIDER_IDS.has(currentModel.provider)) {
    return undefined;
  }
  if (!isSupportedResponsesApi(currentModel.api)) {
    return undefined;
  }
  const baseUrl = normalizeBaseUrl(currentModel.baseUrl);
  if (!baseUrl) {
    return undefined;
  }

  let requestPayload: OpenAIResponsesRequestPayload | undefined;
  if (payload !== undefined) {
    if (!isResponsesCompatiblePayload(payload) || payload.model !== currentModel.id) {
      return undefined;
    }
    requestPayload = payload;
  }

  const { apiKey, headers } = await getModelRequestAuth(ctx, currentModel);
  const hasAuthorizationHeader = Object.entries(headers ?? {}).some(
    ([key, value]) => key.toLowerCase() === "authorization" && value.trim().length > 0,
  );
  if (!apiKey && !hasAuthorizationHeader) {
    return undefined;
  }

  return {
    provider: currentModel.provider,
    api: currentModel.api,
    model: currentModel.id,
    baseUrl,
    ...(apiKey ? { apiKey } : {}),
    ...(headers ? { headers } : {}),
    compactUrl: buildCompactUrl(baseUrl, currentModel.api),
    ...(requestPayload ? { payload: requestPayload } : {}),
    currentModel,
  };
}

type OpenAICompactTarget = NonNullable<Awaited<ReturnType<typeof getOpenAICompactTarget>>>;

async function getModelRequestAuth(
  ctx: ExtensionContext,
  model: Model<Api>,
): Promise<{ readonly apiKey?: string; readonly headers?: Record<string, string> }> {
  type RegistryWithAuth = {
    readonly getApiKeyAndHeaders?: (
      currentModel: Model<Api>,
    ) => Promise<
      | { readonly ok: true; readonly apiKey?: string; readonly headers?: Record<string, string> }
      | { readonly ok: false; readonly error: string }
    >;
  };
  const modelRegistry = ctx.modelRegistry as unknown as RegistryWithAuth;
  if (typeof modelRegistry.getApiKeyAndHeaders !== "function") {
    return {};
  }
  const auth = await modelRegistry.getApiKeyAndHeaders(model);
  return auth.ok
    ? {
        ...(auth.apiKey ? { apiKey: auth.apiKey } : {}),
        ...(auth.headers ? { headers: auth.headers } : {}),
      }
    : {};
}

function createOpenAICompactRequest(input: {
  readonly event: SessionBeforeCompactEvent;
  readonly ctx: ExtensionContext;
  readonly target: OpenAICompactTarget;
  readonly policy: AgentModelPolicy;
}) {
  return {
    model: input.target.model,
    input: serializePiCompactMessagesForOpenAI(input.target.currentModel, input.event),
    instructions: buildCompactionInstructions(
      input.ctx.getSystemPrompt(),
      input.event.customInstructions,
    ),
    parallel_tool_calls: true,
    prompt_cache_key: clampOpenAIPromptCacheKey(input.ctx.sessionManager.getSessionId()),
    ...(input.policy.fast ? { service_tier: "priority" } : {}),
    text: { verbosity: "low" },
    ...buildCompactionReasoning(input.target.currentModel, input.policy),
  };
}

function buildCompactionInstructions(systemPrompt: string, customInstructions?: string): string {
  const guidance = customInstructions?.trim();
  return guidance
    ? `${systemPrompt}\n\nAdditional user guidance for this manual /compact request:\n${guidance}`
    : systemPrompt;
}

function buildCompactionReasoning(
  model: Model<Api>,
  policy: AgentModelPolicy,
): { readonly reasoning?: { readonly effort: string; readonly summary: "auto" } } {
  if (!model.reasoning || !policy.thinkingLevel || policy.thinkingLevel === "off") {
    return {};
  }
  const clampedLevel = clampThinkingLevel(model, policy.thinkingLevel);
  if (clampedLevel === "off") {
    return {};
  }
  const effort = model.thinkingLevelMap?.[clampedLevel] ?? clampedLevel;
  return typeof effort === "string" ? { reasoning: { effort, summary: "auto" } } : {};
}

function serializePiCompactMessagesForOpenAI(
  model: Model<Api>,
  event: SessionBeforeCompactEvent,
): ResponsesInputItem[] {
  const previousSummary = event.preparation.previousSummary?.trim();
  const previousSummaryMessages: AgentMessage[] = previousSummary
    ? [
        {
          role: "user",
          content: `Previous compaction summary:\n${previousSummary}`,
          timestamp: Date.now(),
        } as AgentMessage,
      ]
    : [];
  return serializeMessagesToResponsesInput(model, [
    ...previousSummaryMessages,
    ...event.preparation.messagesToSummarize,
    ...event.preparation.turnPrefixMessages,
  ]);
}

function serializeMessagesToResponsesInput(
  model: Model<Api>,
  messages: readonly AgentMessage[],
  options: {
    readonly instructions?: string;
    readonly includeInstructionsInInput?: boolean;
  } = {},
): ResponsesInputItem[] {
  const llmMessages = convertToLlm([...messages]);
  return convertResponsesMessages(
    model,
    {
      messages: llmMessages,
      ...(options.includeInstructionsInInput && options.instructions
        ? { systemPrompt: options.instructions }
        : {}),
    },
    TOOL_CALL_PROVIDER_IDS,
    { includeSystemPrompt: options.includeInstructionsInInput ?? false },
  );
}

function convertResponsesMessages(
  model: Model<Api>,
  context: Context,
  allowedToolCallProviders: ReadonlySet<string>,
  options?: { readonly includeSystemPrompt?: boolean },
): ResponsesInputItem[] {
  const messages: ResponsesInputItem[] = [];
  const normalizeIdPart = (part: string): string => {
    const sanitized = part.replace(/[^a-zA-Z0-9_-]/g, "_");
    const normalized = sanitized.length > 64 ? sanitized.slice(0, 64) : sanitized;
    return normalized.replace(/_+$/, "");
  };
  const buildForeignResponsesItemId = (itemId: string): string => {
    const normalized = `fc_${shortHash(itemId)}`;
    return normalized.length > 64 ? normalized.slice(0, 64) : normalized;
  };
  const normalizeToolCallId = (id: string, _targetModel: Model<Api>, source: AssistantMessage) => {
    if (!allowedToolCallProviders.has(model.provider)) {
      return normalizeIdPart(id);
    }
    if (!id.includes("|")) {
      return normalizeIdPart(id);
    }
    const [callId = "", itemId = ""] = id.split("|");
    const normalizedCallId = normalizeIdPart(callId);
    const isForeignToolCall = source.provider !== model.provider || source.api !== model.api;
    let normalizedItemId = isForeignToolCall
      ? buildForeignResponsesItemId(itemId)
      : normalizeIdPart(itemId);
    if (!normalizedItemId.startsWith("fc_")) {
      normalizedItemId = normalizeIdPart(`fc_${normalizedItemId}`);
    }
    return `${normalizedCallId}|${normalizedItemId}`;
  };

  const transformedMessages = transformMessagesForResponses(
    context.messages,
    model,
    normalizeToolCallId,
  );
  const includeSystemPrompt = options?.includeSystemPrompt ?? true;
  if (includeSystemPrompt && context.systemPrompt) {
    const role =
      model.reasoning && getSupportsDeveloperRole(model.compat) !== false ? "developer" : "system";
    messages.push({
      role,
      content: sanitizeSurrogates(context.systemPrompt),
    });
  }

  let messageIndex = 0;
  for (const message of transformedMessages) {
    if (message.role === "user") {
      const userInput = convertUserMessage(message);
      if (userInput) {
        messages.push(userInput);
      }
    } else if (message.role === "assistant") {
      messages.push(...convertAssistantMessage(model, message, messageIndex));
    } else if (message.role === "toolResult") {
      messages.push(convertToolResultMessage(model, message));
    }
    messageIndex += 1;
  }
  return messages;
}

function createResponsesInputText(text: string) {
  return { type: "input_text", text } as const;
}

function createResponsesInputImage(item: ImageContent) {
  return {
    type: "input_image",
    detail: "auto",
    image_url: `data:${item.mimeType};base64,${item.data}`,
  } as const;
}

function createResponsesEncryptedContent(encryptedContent: string) {
  return { type: "encrypted_content", encrypted_content: encryptedContent } as const;
}

function convertUserMessage(message: UserMessage): ResponsesInputMessageItem | undefined {
  if (typeof message.content === "string") {
    return {
      role: "user",
      content: [createResponsesInputText(sanitizeSurrogates(message.content))],
    };
  }
  const content = message.content.map((item): ResponsesInputContentItem => {
    if (item.type === "text") {
      return createResponsesInputText(sanitizeSurrogates(item.text));
    }
    return createResponsesInputImage(item);
  });
  return content.length === 0 ? undefined : { role: "user", content };
}

function convertAssistantMessage(
  model: Model<Api>,
  message: AssistantMessage,
  messageIndex: number,
): ResponsesInputItem[] {
  const output: ResponsesInputItem[] = [];
  const isDifferentModel =
    message.model !== model.id && message.provider === model.provider && message.api === model.api;
  let textBlockIndex = 0;

  for (const block of message.content) {
    if (block.type === "thinking") {
      if (block.thinkingSignature) {
        const reasoningItem = parseJsonRecord(block.thinkingSignature);
        if (reasoningItem) {
          output.push(reasoningItem);
        }
      }
      continue;
    }

    if (block.type === "text") {
      const parsedSignature = parseTextSignature(block.textSignature);
      const fallbackMessageId =
        textBlockIndex === 0
          ? `msg_pi_${messageIndex}`
          : `msg_pi_${messageIndex}_${textBlockIndex}`;
      textBlockIndex += 1;
      let messageId = parsedSignature?.id ?? fallbackMessageId;
      if (messageId.length > 64) {
        messageId = `msg_${shortHash(messageId)}`;
      }
      output.push({
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: sanitizeSurrogates(block.text),
            annotations: [],
          },
        ],
        status: "completed",
        id: messageId,
        ...(parsedSignature?.phase ? { phase: parsedSignature.phase } : {}),
      });
      continue;
    }

    if (block.type === "toolCall") {
      const [callId = block.id, itemIdRaw] = block.id.split("|");
      const itemId = isDifferentModel && itemIdRaw?.startsWith("fc_") ? undefined : itemIdRaw;
      output.push({
        type: "function_call",
        ...(itemId ? { id: itemId } : {}),
        call_id: callId,
        name: block.name,
        arguments: JSON.stringify(block.arguments),
      });
    }
  }

  return output;
}

function convertToolResultMessage(
  model: Model<Api>,
  message: ToolResultMessage,
): ResponsesInputItem {
  const textResult = message.content
    .filter((content): content is TextContent => content.type === "text")
    .map((content) => content.text)
    .join("\n");
  const hasImages = message.content.some(
    (content): content is ImageContent => content.type === "image",
  );
  const hasText = textResult.length > 0;
  const [callId = message.toolCallId] = message.toolCallId.split("|");
  if (hasImages && model.input.includes("image")) {
    const contentParts: ResponsesInputContentItem[] = [];
    if (hasText) {
      contentParts.push(createResponsesInputText(sanitizeSurrogates(textResult)));
    }
    for (const block of message.content) {
      if (block.type === "image") {
        contentParts.push(createResponsesInputImage(block));
      }
    }
    return {
      type: "function_call_output",
      call_id: callId,
      output: contentParts,
    };
  }
  return {
    type: "function_call_output",
    call_id: callId,
    output: sanitizeSurrogates(hasText ? textResult : "(see attached image)"),
  };
}

function transformMessagesForResponses(
  messages: readonly LlmMessage[],
  model: Model<Api>,
  normalizeToolCallId?: (id: string, model: Model<Api>, source: AssistantMessage) => string,
): LlmMessage[] {
  const toolCallIdMap = new Map<string, string>();
  const imageAwareMessages = downgradeUnsupportedImages(messages, model);
  const transformed = imageAwareMessages.map((message): LlmMessage => {
    if (message.role === "user") {
      return message;
    }
    if (message.role === "toolResult") {
      const normalizedId = toolCallIdMap.get(message.toolCallId);
      return normalizedId && normalizedId !== message.toolCallId
        ? { ...message, toolCallId: normalizedId }
        : message;
    }

    const isSameModel =
      message.provider === model.provider &&
      message.api === model.api &&
      message.model === model.id;
    const transformedContent: AssistantMessage["content"] = [];
    for (const block of message.content) {
      if (block.type === "thinking") {
        if (block.redacted) {
          if (isSameModel) {
            transformedContent.push(block);
          }
          continue;
        }
        if (isSameModel && block.thinkingSignature) {
          transformedContent.push(block);
          continue;
        }
        if (!block.thinking || block.thinking.trim() === "") {
          continue;
        }
        if (isSameModel) {
          transformedContent.push(block);
        } else {
          transformedContent.push({ type: "text", text: block.thinking });
        }
        continue;
      }
      if (block.type === "text") {
        transformedContent.push(isSameModel ? block : { type: "text", text: block.text });
        continue;
      }
      if (block.type === "toolCall") {
        let normalizedToolCall = block;
        if (!isSameModel && block.thoughtSignature) {
          const { thoughtSignature: _thoughtSignature, ...rest } = normalizedToolCall;
          normalizedToolCall = rest;
        }
        if (!isSameModel && normalizeToolCallId) {
          const normalizedId = normalizeToolCallId(block.id, model, message);
          if (normalizedId !== block.id) {
            toolCallIdMap.set(block.id, normalizedId);
            normalizedToolCall = { ...normalizedToolCall, id: normalizedId };
          }
        }
        transformedContent.push(normalizedToolCall);
        continue;
      }
      transformedContent.push(block);
    }
    return {
      ...message,
      content: transformedContent,
    };
  });

  const result: LlmMessage[] = [];
  let pendingToolCalls: ToolCallContent[] = [];
  let existingToolResultIds = new Set<string>();
  const insertSyntheticToolResults = () => {
    if (pendingToolCalls.length === 0) {
      return;
    }
    for (const toolCall of pendingToolCalls) {
      if (!existingToolResultIds.has(toolCall.id)) {
        result.push({
          role: "toolResult",
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          content: [{ type: "text", text: "No result provided" }],
          isError: true,
          timestamp: Date.now(),
        });
      }
    }
    pendingToolCalls = [];
    existingToolResultIds = new Set();
  };

  for (const message of transformed) {
    if (message.role === "assistant") {
      insertSyntheticToolResults();
      if (message.stopReason === "error" || message.stopReason === "aborted") {
        continue;
      }
      const toolCalls = message.content.filter(
        (block): block is ToolCallContent => block.type === "toolCall",
      );
      if (toolCalls.length > 0) {
        pendingToolCalls = toolCalls;
        existingToolResultIds = new Set();
      }
      result.push(message);
      continue;
    }
    if (message.role === "toolResult") {
      existingToolResultIds.add(message.toolCallId);
      result.push(message);
      continue;
    }
    insertSyntheticToolResults();
    result.push(message);
  }
  insertSyntheticToolResults();
  return result;
}

function downgradeUnsupportedImages(
  messages: readonly LlmMessage[],
  model: Model<Api>,
): LlmMessage[] {
  if (model.input.includes("image")) {
    return [...messages];
  }
  return messages.map((message): LlmMessage => {
    if (message.role === "user" && Array.isArray(message.content)) {
      return {
        ...message,
        content: replaceImagesWithPlaceholder(
          message.content,
          "(image omitted: model does not support images)",
        ),
      };
    }
    if (message.role === "toolResult") {
      return {
        ...message,
        content: replaceImagesWithPlaceholder(
          message.content,
          "(tool image omitted: model does not support images)",
        ),
      };
    }
    return message;
  });
}

function replaceImagesWithPlaceholder(
  content: readonly (TextContent | ImageContent)[],
  placeholder: string,
): (TextContent | ImageContent)[] {
  const result: (TextContent | ImageContent)[] = [];
  let previousWasPlaceholder = false;
  for (const block of content) {
    if (block.type === "image") {
      if (!previousWasPlaceholder) {
        result.push({ type: "text", text: placeholder });
      }
      previousWasPlaceholder = true;
      continue;
    }
    result.push(block);
    previousWasPlaceholder = block.text === placeholder;
  }
  return result;
}

function replacePiCompactPlaceholderInResponsesPayload(input: {
  readonly model: Model<Api>;
  readonly payload: OpenAIResponsesRequestPayload;
  readonly branchEntries: readonly SessionEntry[];
  readonly compactionEntry: OpenAICompactEntry;
}) {
  const boundaryIndex = input.branchEntries.findIndex(
    (entry) => entry.id === input.compactionEntry.id,
  );
  if (boundaryIndex < 0) {
    return { ok: false, reason: "compaction-boundary-not-found" };
  }

  const firstKeptEntryIndex = input.branchEntries.findIndex(
    (entry, index) => index < boundaryIndex && entry.id === input.compactionEntry.firstKeptEntryId,
  );
  if (firstKeptEntryIndex < 0) {
    return { ok: false, reason: "first-kept-entry-not-found" };
  }

  const promptEnvelope = extractPromptEnvelope(input.payload);
  if (!promptEnvelope) {
    return { ok: false, reason: "unsupported-instructions" };
  }

  const openAICompactItems = cloneOpenAICompactItems(
    input.compactionEntry.details.openAICompactItems,
  );
  if (!openAICompactItems) {
    return { ok: false, reason: "invalid-openai-compact-items" };
  }

  const preCompactionEntries = input.branchEntries.slice(firstKeptEntryIndex, boundaryIndex);
  const postCompactionEntries = input.branchEntries.slice(boundaryIndex + 1);
  const compactionSummaryMessage = createPiCompactSummaryMessage(input.compactionEntry);
  const placeholderMatch = findPiCompactPlaceholderMatch({
    model: input.model,
    payloadInput: input.payload.input,
    promptEnvelope,
    compactionSummaryMessage,
    preCompactionEntries,
    postCompactionEntries,
  });

  if (!placeholderMatch) {
    const compactionSummaryInput = serializeMessagesToResponsesInput(input.model, [
      compactionSummaryMessage,
    ]);
    const fallbackReplacement = buildFallbackOpenAICompactReplacementPayload({
      payload: input.payload,
      promptEnvelope,
      openAICompactItems,
      compactionSummaryInput,
    });
    if (fallbackReplacement) {
      return {
        ok: true,
        rewrittenPayload: {
          ...input.payload,
          ...(promptEnvelope.instructions !== undefined
            ? { instructions: promptEnvelope.instructions }
            : {}),
          input: fallbackReplacement.input,
        },
      };
    }

    const expectedInput = [
      ...promptEnvelope.leadingInput,
      ...compactionSummaryInput,
      ...serializeMessagesToResponsesInput(
        input.model,
        collectSessionMessages(preCompactionEntries),
      ),
      ...serializeMessagesToResponsesInput(
        input.model,
        collectSessionMessages(postCompactionEntries),
      ),
      ...promptEnvelope.trailingInput,
    ];
    const inputDiff = compareResponsesInputShape(input.payload.input, expectedInput);
    return {
      ok: false,
      reason: "pi-payload-shape-mismatch",
      inputDiff: {
        mismatches: inputDiff.mismatches,
      },
    };
  }

  const promptEnvelopeCount = promptEnvelope.leadingInput.length;
  const compactionSummaryCount = serializeMessagesToResponsesInput(input.model, [
    compactionSummaryMessage,
  ]).length;
  const piKeptMessageCount = placeholderMatch.piKeptMessages.input.length;
  const actualPiSummaryPlaceholder = cloneResponsesInputSlice(
    input.payload.input.slice(promptEnvelopeCount, promptEnvelopeCount + compactionSummaryCount),
  );
  const actualPiKeptMessages = cloneResponsesInputSlice(
    input.payload.input.slice(
      promptEnvelopeCount + compactionSummaryCount,
      promptEnvelopeCount + compactionSummaryCount + piKeptMessageCount,
    ),
  );
  if (!actualPiSummaryPlaceholder || !actualPiKeptMessages) {
    return { ok: false, reason: "pi-payload-shape-mismatch" };
  }

  const contextPostCompactionTail = [
    ...serializeMessagesToResponsesInput(
      input.model,
      collectSessionMessages(postCompactionEntries),
    ),
    ...placeholderMatch.extraPostCompactionTail,
  ];
  return {
    ok: true,
    rewrittenPayload: {
      ...input.payload,
      ...(promptEnvelope.instructions !== undefined
        ? { instructions: promptEnvelope.instructions }
        : {}),
      input: [
        ...promptEnvelope.leadingInput,
        ...openAICompactItems,
        ...contextPostCompactionTail,
        ...promptEnvelope.trailingInput,
      ],
    },
  };
}

function findPiCompactPlaceholderMatch(input: {
  readonly model: Model<Api>;
  readonly payloadInput: readonly unknown[];
  readonly promptEnvelope: PromptEnvelope;
  readonly compactionSummaryMessage: AgentMessage;
  readonly preCompactionEntries: readonly SessionEntry[];
  readonly postCompactionEntries: readonly SessionEntry[];
}): PiCompactPlaceholderMatch | undefined {
  const compactionSummaryInput = serializeMessagesToResponsesInput(input.model, [
    input.compactionSummaryMessage,
  ]);
  const preCompactionVariants = [
    ...createSerializedHistoryVariants({ model: input.model, entries: input.preCompactionEntries }),
    createSerializedPiMessages(input.model, []),
  ];
  const postCompactionVariants = createSerializedHistoryVariants({
    model: input.model,
    entries: input.postCompactionEntries,
  });

  for (const piKeptMessages of preCompactionVariants) {
    for (const postCompactionTail of postCompactionVariants) {
      const expectedBeforeTrailing: ResponsesInputItem[] = [
        ...input.promptEnvelope.leadingInput,
        ...compactionSummaryInput,
        ...piKeptMessages.input,
        ...postCompactionTail.input,
      ];
      const tailEndIndex = input.payloadInput.length - input.promptEnvelope.trailingInput.length;
      const prefixMatches = areEquivalentValues(
        input.payloadInput.slice(0, expectedBeforeTrailing.length),
        expectedBeforeTrailing,
      );
      const trailingMatches = areEquivalentValues(
        input.payloadInput.slice(tailEndIndex),
        input.promptEnvelope.trailingInput,
      );
      if (!prefixMatches || !trailingMatches || tailEndIndex < expectedBeforeTrailing.length) {
        continue;
      }

      const actualPostCompactionTail = cloneResponsesInputSlice(
        input.payloadInput.slice(
          input.promptEnvelope.leadingInput.length +
            compactionSummaryInput.length +
            piKeptMessages.input.length,
          tailEndIndex,
        ),
      );
      const extraPostCompactionTail = cloneResponsesInputSlice(
        input.payloadInput.slice(expectedBeforeTrailing.length, tailEndIndex),
      );
      if (!actualPostCompactionTail || !extraPostCompactionTail) {
        return undefined;
      }
      return {
        piKeptMessages,
        extraPostCompactionTail,
      };
    }
  }

  return undefined;
}

function createSerializedHistoryVariants(input: {
  readonly model: Model<Api>;
  readonly entries: readonly SessionEntry[];
}): SerializedPiMessages[] {
  return [createSerializedPiMessages(input.model, collectSessionMessages(input.entries))];
}

function createSerializedPiMessages(
  model: Model<Api>,
  messages: readonly AgentMessage[],
): SerializedPiMessages {
  return {
    input: serializeMessagesToResponsesInput(model, messages),
  };
}

function collectSessionMessages(entries: readonly SessionEntry[]): AgentMessage[] {
  const messages: AgentMessage[] = [];
  for (const entry of entries) {
    const message = toSessionAgentMessage(entry);
    if (message) {
      messages.push(message);
    }
  }
  return messages;
}

function toSessionAgentMessage(entry: SessionEntry): AgentMessage | undefined {
  if (entry.type === "message") {
    return entry.message;
  }
  if (entry.type === "custom_message") {
    return toCustomAgentMessage(entry);
  }
  if (entry.type === "branch_summary") {
    return {
      role: "branchSummary",
      summary: entry.summary,
      fromId: entry.fromId,
      timestamp: new Date(entry.timestamp).getTime(),
    } as AgentMessage;
  }
  return undefined;
}

function toCustomAgentMessage(
  entry: Extract<SessionEntry, { readonly type: "custom_message" }>,
): AgentMessage {
  return {
    role: "custom",
    customType: entry.customType,
    content: entry.content,
    display: entry.display,
    details: entry.details,
    timestamp: new Date(entry.timestamp).getTime(),
  } as AgentMessage;
}

function createPiCompactSummaryMessage(entry: OpenAICompactEntry): AgentMessage {
  return {
    role: "compactionSummary",
    summary: entry.summary,
    tokensBefore: entry.tokensBefore,
    timestamp: new Date(entry.timestamp).getTime(),
  } as AgentMessage;
}

function buildFallbackOpenAICompactReplacementPayload(input: {
  readonly payload: OpenAIResponsesRequestPayload;
  readonly promptEnvelope: PromptEnvelope;
  readonly openAICompactItems: readonly unknown[];
  readonly compactionSummaryInput: readonly ResponsesInputItem[];
}):
  | {
      readonly input: readonly unknown[];
      readonly conversationInput: readonly ResponsesInputItem[];
    }
  | undefined {
  const conversationInput = clonePayloadConversationInput({
    payloadInput: input.payload.input,
    promptEnvelope: input.promptEnvelope,
  });
  if (!conversationInput) {
    return undefined;
  }
  const conversationAfterPlaceholder = stripLeadingCompactionSummaryPlaceholder({
    conversationInput,
    compactionSummaryInput: input.compactionSummaryInput,
  });
  return {
    conversationInput: conversationAfterPlaceholder,
    input: [
      ...input.promptEnvelope.leadingInput,
      ...input.openAICompactItems,
      ...conversationAfterPlaceholder,
      ...input.promptEnvelope.trailingInput,
    ],
  };
}

function clonePayloadConversationInput(input: {
  readonly payloadInput: readonly unknown[];
  readonly promptEnvelope: PromptEnvelope;
}): ResponsesInputItem[] | undefined {
  const tailEndIndex = input.payloadInput.length - input.promptEnvelope.trailingInput.length;
  if (tailEndIndex < input.promptEnvelope.leadingInput.length) {
    return undefined;
  }
  return cloneResponsesInputSlice(
    input.payloadInput.slice(input.promptEnvelope.leadingInput.length, tailEndIndex),
  );
}

function stripLeadingCompactionSummaryPlaceholder(input: {
  readonly conversationInput: readonly ResponsesInputItem[];
  readonly compactionSummaryInput: readonly ResponsesInputItem[];
}): ResponsesInputItem[] {
  if (input.compactionSummaryInput.length === 0) {
    return [...input.conversationInput];
  }
  if (
    !areEquivalentValues(
      input.conversationInput.slice(0, input.compactionSummaryInput.length),
      input.compactionSummaryInput,
    )
  ) {
    return [...input.conversationInput];
  }
  return [...input.conversationInput.slice(input.compactionSummaryInput.length)];
}

function extractPromptEnvelope(payload: OpenAIResponsesRequestPayload): PromptEnvelope | undefined {
  if (payload.instructions !== undefined && typeof payload.instructions !== "string") {
    return undefined;
  }

  let leadingBoundary = 0;
  while (
    leadingBoundary < payload.input.length &&
    isPromptEnvelopeItem(payload.input[leadingBoundary])
  ) {
    leadingBoundary += 1;
  }

  let trailingBoundary = payload.input.length;
  while (
    trailingBoundary > leadingBoundary &&
    isPromptEnvelopeItem(payload.input[trailingBoundary - 1])
  ) {
    trailingBoundary -= 1;
  }

  for (let index = leadingBoundary; index < trailingBoundary; index += 1) {
    if (isPromptEnvelopeItem(payload.input[index])) {
      return undefined;
    }
  }

  return {
    ...(typeof payload.instructions === "string" ? { instructions: payload.instructions } : {}),
    leadingInput: payload.input
      .slice(0, leadingBoundary)
      .map((item) => cloneResponsesInputMessageItem(item as ResponsesInputMessageItem)),
    trailingInput: payload.input
      .slice(trailingBoundary)
      .map((item) => cloneResponsesInputMessageItem(item as ResponsesInputMessageItem)),
  };
}

async function callOpenAICompactEndpoint(input: {
  readonly target: OpenAICompactTarget;
  readonly request: ReturnType<typeof createOpenAICompactRequest>;
  readonly signal?: AbortSignal;
}) {
  if (input.signal?.aborted) {
    return { ok: false, reason: "aborted" } as const;
  }

  try {
    const response = await fetch(input.target.compactUrl, {
      method: "POST",
      headers: buildOpenAICompactHeaders(input.target),
      body: JSON.stringify(input.request),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const responseText = await response.text();
    if (!response.ok) {
      const failure = {
        ok: false,
        reason: "non-2xx",
        status: response.status,
        ...(responseText ? { responseText } : {}),
      } as const;
      return failure;
    }
    if (!responseText.trim()) {
      return {
        ok: false,
        reason: "empty-body",
        status: response.status,
      } as const;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(responseText);
    } catch (error) {
      return {
        ok: false,
        reason: "invalid-json",
        status: response.status,
        errorMessage: error instanceof Error ? error.message : String(error),
        responseText,
      } as const;
    }

    if (!isCompactResponseEnvelope(parsed)) {
      return {
        ok: false,
        reason: "malformed-response",
        status: response.status,
      } as const;
    }
    if (parsed.output.length === 0) {
      return {
        ok: false,
        reason: "empty-output",
        status: response.status,
      } as const;
    }

    return {
      ok: true,
      status: response.status,
      openAICompactItems: [...parsed.output],
      ...(typeof parsed.id === "string" && parsed.id.trim()
        ? { compactResponseId: parsed.id.trim() }
        : {}),
      ...optionalCreatedAt(parsed.created_at),
    } as const;
  } catch (error) {
    return isAbortError(error)
      ? ({ ok: false, reason: "aborted" } as const)
      : ({
          ok: false,
          reason: "network-error",
          errorMessage: error instanceof Error ? error.message : String(error),
        } as const);
  }
}

function buildOpenAICompactHeaders(target: OpenAICompactTarget): Record<string, string> {
  const headers = new Headers(target.currentModel.headers ?? {});
  for (const [key, value] of Object.entries(target.headers ?? {})) {
    headers.set(key, value);
  }
  headers.set("accept", "application/json");
  headers.set("content-type", "application/json");
  if (target.apiKey) {
    headers.set("authorization", `Bearer ${target.apiKey}`);
  }

  if (target.provider === "openai-codex") {
    const accountId = extractCodexAccountId(target.apiKey ?? extractBearerToken(headers) ?? "");
    if (accountId) {
      headers.set("chatgpt-account-id", accountId);
    }
    headers.set("originator", "pi");
    headers.set("user-agent", buildCodexUserAgent());
    headers.set("openai-beta", "responses=experimental");
  }

  return Object.fromEntries(headers.entries());
}

function formatOpenAICompactFailureMessage(
  result: Extract<Awaited<ReturnType<typeof callOpenAICompactEndpoint>>, { readonly ok: false }>,
) {
  const status = result.status ? ` HTTP ${result.status}` : "";
  const response = result.responseText?.trim();
  const errorMessage = "errorMessage" in result ? result.errorMessage : undefined;
  const detail = response ? `: ${response.slice(0, 500)}` : errorMessage ? `: ${errorMessage}` : "";
  return `OpenAI compact failed (${result.reason}${status})${detail}; Pi compaction will run.`;
}

function findLatestOpenAICompactEntry(
  entries: readonly SessionEntry[],
  target: OpenAICompactTarget,
): OpenAICompactEntry | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!isOpenAICompactEntry(entry)) {
      continue;
    }
    if (
      entry.details.provider === target.provider &&
      entry.details.api === target.api &&
      entry.details.baseUrl === target.baseUrl
    ) {
      return entry;
    }
  }
  return undefined;
}

function createOpenAICompactDetails(input: {
  readonly provider: string;
  readonly api: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly openAICompactItems: readonly unknown[];
  readonly compactResponseId?: string;
  readonly createdAt?: string;
  readonly requestInfo?: OpenAICompactRequestInfo;
}) {
  return {
    strategy: OPENAI_COMPACT_STRATEGY,
    provider: input.provider.trim(),
    api: input.api.trim(),
    model: input.model.trim(),
    baseUrl: input.baseUrl.trim(),
    openAICompactItems: input.openAICompactItems.map((item) => cloneStructuredValue(item)),
    ...(input.compactResponseId && input.compactResponseId.trim()
      ? { compactResponseId: input.compactResponseId.trim() }
      : {}),
    createdAt:
      input.createdAt && input.createdAt.trim() ? input.createdAt.trim() : new Date().toISOString(),
    ...(input.requestInfo ? { requestInfo: input.requestInfo } : {}),
  };
}

function isOpenAICompactEntry(value: unknown): value is OpenAICompactEntry {
  return isRecord(value) && value.type === "compaction" && isOpenAICompactDetails(value.details);
}

function isOpenAICompactDetails(value: unknown): value is OpenAICompactDetails {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.strategy === OPENAI_COMPACT_STRATEGY &&
    isNonEmptyString(value.provider) &&
    isNonEmptyString(value.api) &&
    isNonEmptyString(value.model) &&
    isNonEmptyString(value.baseUrl) &&
    Array.isArray(value.openAICompactItems) &&
    value.openAICompactItems.every(
      (item) => isRecord(item) && Object.values(item).every(isStructuredValue),
    ) &&
    isNonEmptyString(value.createdAt)
  );
}

function sanitizeOpenAICompactItems(output: readonly unknown[]): Record<string, unknown>[] {
  const sanitized: Record<string, unknown>[] = [];
  for (const item of output) {
    if (!isRecord(item) || typeof item.type !== "string") {
      continue;
    }
    try {
      sanitized.push(cloneStructuredValue(item) as Record<string, unknown>);
    } catch {
      // Ignore output items that cannot be stored in the session JSONL.
    }
  }
  return sanitized;
}

function extractOpenAICompactSummaryText(
  openAICompactItems: readonly unknown[],
): string | undefined {
  for (const item of openAICompactItems) {
    if (
      !isRecord(item) ||
      typeof item.type !== "string" ||
      !OPENAI_COMPACT_OUTPUT_ITEM_TYPES.has(item.type)
    ) {
      continue;
    }
    if (typeof item.encrypted_content === "string" && item.encrypted_content.trim().length > 0) {
      return item.encrypted_content.trim();
    }
  }
  return undefined;
}

function hasOpenAICompactOutputItem(openAICompactItems: readonly unknown[]): boolean {
  return openAICompactItems.some(
    (item) =>
      isRecord(item) &&
      typeof item.type === "string" &&
      OPENAI_COMPACT_OUTPUT_ITEM_TYPES.has(item.type),
  );
}

function compareResponsesInputShape(
  actual: readonly unknown[],
  expected: readonly unknown[],
): { readonly mismatches: readonly string[] } {
  const actualSignature = actual.map(describeResponsesInputItem);
  const expectedSignature = expected.map(describeResponsesInputItem);
  const maxLength = Math.max(actualSignature.length, expectedSignature.length);
  const mismatches: string[] = [];
  for (let index = 0; index < maxLength; index += 1) {
    const actualValue = actualSignature[index];
    const expectedValue = expectedSignature[index];
    if (actualValue !== expectedValue) {
      mismatches.push(
        `index ${index}: expected ${expectedValue ?? "<missing>"}, got ${actualValue ?? "<missing>"}`,
      );
    }
  }
  return { mismatches };
}

function describeResponsesInputItem(item: unknown): string {
  if (!isRecord(item)) {
    return typeof item;
  }
  if (item.type === "message") {
    const phase =
      item.phase === "commentary" || item.phase === "final_answer" ? `:${item.phase}` : "";
    return `message:${typeof item.role === "string" ? item.role : "unknown"}${phase}`;
  }
  if (item.type === "function_call") {
    return `function_call:${typeof item.name === "string" ? item.name : "unknown"}`;
  }
  if (item.type === "function_call_output") {
    return "function_call_output";
  }
  if (item.type === "reasoning") {
    return "reasoning";
  }
  if (typeof item.role === "string") {
    const content = Array.isArray(item.content) ? `[${item.content.length}]` : "";
    return `input:${item.role}${content}`;
  }
  return typeof item.type === "string" ? `item:${item.type}` : "object";
}

function isPromptEnvelopeItem(item: unknown): item is ResponsesInputMessageItem {
  return isResponsesInputMessageItem(item) && (item.role === "developer" || item.role === "system");
}

function isResponsesInputMessageItem(value: unknown): value is ResponsesInputMessageItem {
  if (!isRecord(value) || !isResponsesInputMessageRole(value.role)) {
    return false;
  }
  const { content } = value;
  return (
    typeof content === "string" ||
    (Array.isArray(content) && content.every(isResponsesInputContentItem))
  );
}

function isResponsesInputMessageRole(value: unknown): value is ResponsesInputMessageItem["role"] {
  return value === "user" || value === "developer" || value === "system";
}

function isResponsesInputContentItem(value: unknown): value is ResponsesInputContentItem {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }
  if (value.type === "input_text") {
    return typeof value.text === "string";
  }
  if (value.type === "input_image") {
    return value.detail === "auto" && typeof value.image_url === "string";
  }
  if (value.type === "encrypted_content") {
    return typeof value.encrypted_content === "string";
  }
  return false;
}

function cloneResponsesInputMessageItem(
  item: ResponsesInputMessageItem,
): ResponsesInputMessageItem {
  return {
    role: item.role,
    content:
      typeof item.content === "string"
        ? item.content
        : item.content.map(cloneResponsesInputContentItem),
  };
}

function cloneResponsesInputContentItem(
  item: ResponsesInputContentItem,
): ResponsesInputContentItem {
  if (item.type === "input_text") {
    return createResponsesInputText(item.text);
  }
  if (item.type === "encrypted_content") {
    return createResponsesEncryptedContent(item.encrypted_content);
  }
  return { type: "input_image", detail: item.detail, image_url: item.image_url };
}

function cloneOpenAICompactItems(openAICompactItems: readonly unknown[]): unknown[] | undefined {
  const cloned: unknown[] = [];
  for (const item of openAICompactItems) {
    if (!isRecord(item)) {
      return undefined;
    }
    try {
      cloned.push(cloneStructuredValue(item));
    } catch {
      return undefined;
    }
  }
  return cloned;
}

function cloneResponsesInputSlice(items: readonly unknown[]): ResponsesInputItem[] | undefined {
  const cloned: ResponsesInputItem[] = [];
  for (const item of items) {
    try {
      cloned.push(cloneStructuredValue(item) as ResponsesInputItem);
    } catch {
      return undefined;
    }
  }
  return cloned;
}

function cloneStructuredValue(value: unknown): unknown {
  if (
    value === undefined ||
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(cloneStructuredValue);
  }
  if (isRecord(value)) {
    const clone: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      clone[key] = cloneStructuredValue(nested);
    }
    return clone;
  }
  throw new Error(`Unsupported structured value: ${typeof value}`);
}

function isStructuredValue(value: unknown): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isStructuredValue);
  }
  if (isRecord(value)) {
    return Object.values(value).every(isStructuredValue);
  }
  return false;
}

function areEquivalentValues(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => areEquivalentValues(value, right[index]));
  }
  if (isRecord(left) || isRecord(right)) {
    if (!isRecord(left) || !isRecord(right)) {
      return false;
    }
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    if (!areEquivalentValues(leftKeys, rightKeys)) {
      return false;
    }
    return leftKeys.every((key) => areEquivalentValues(left[key], right[key]));
  }
  return false;
}

function parseTextSignature(signature: string | undefined): TextSignature | undefined {
  if (!signature) {
    return undefined;
  }
  if (signature.startsWith("{")) {
    const parsed = parseJsonRecord(signature);
    if (parsed?.v === 1 && typeof parsed.id === "string") {
      if (parsed.phase === "commentary" || parsed.phase === "final_answer") {
        return { id: parsed.id, phase: parsed.phase };
      }
      return { id: parsed.id };
    }
  }
  return { id: signature };
}

function parseJsonRecord(text: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isResponsesCompatiblePayload(payload: unknown): payload is OpenAIResponsesRequestPayload {
  return isRecord(payload) && typeof payload.model === "string" && Array.isArray(payload.input);
}

function isSupportedResponsesApi(api: string): api is SupportedResponsesApi {
  return RESPONSES_APIS.has(api);
}

function normalizeBaseUrl(baseUrl: string | undefined | null): string | undefined {
  const normalized = baseUrl?.trim().replace(/\/+$/, "");
  return normalized ? normalized : undefined;
}

function buildCompactUrl(baseUrl: string, api: SupportedResponsesApi): string {
  if (api === "openai-codex-responses") {
    if (baseUrl.endsWith("/codex/responses")) {
      return `${baseUrl}/compact`;
    }
    if (baseUrl.endsWith("/codex")) {
      return `${baseUrl}/responses/compact`;
    }
    return `${baseUrl}/${CODEX_COMPACT_PATH}`;
  }
  if (baseUrl.endsWith("/responses")) {
    return `${baseUrl}/compact`;
  }
  return `${baseUrl}/${OPENAI_COMPACT_PATH}`;
}

function clampOpenAIPromptCacheKey(key: string): string {
  const chars = Array.from(key);
  return chars.length <= OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH
    ? key
    : chars.slice(0, OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH).join("");
}

function normalizeResponseTimestamp(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value > 1_000_000_000_000 ? value : value * 1000;
    return new Date(milliseconds).toISOString();
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? trimmed : new Date(parsed).toISOString();
}

function optionalCreatedAt(value: unknown): { readonly createdAt?: string } {
  const createdAt = normalizeResponseTimestamp(value);
  return createdAt ? { createdAt } : {};
}

function getSupportsDeveloperRole(compat: unknown): boolean | undefined {
  return isRecord(compat) && typeof compat.supportsDeveloperRole === "boolean"
    ? compat.supportsDeveloperRole
    : undefined;
}

function isCompactResponseEnvelope(value: unknown): value is {
  readonly id?: string;
  readonly created_at?: unknown;
  readonly output: readonly unknown[];
} {
  return isRecord(value) && Array.isArray(value.output) && value.output.every(isRecord);
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && (error.name === "AbortError" || error.name === "ABORT_ERR"))
  );
}

function extractBearerToken(headers: Headers): string | undefined {
  const authorization = headers.get("authorization")?.trim();
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
}

function extractCodexAccountId(token: string): string | undefined {
  const payload = decodeJwtPayload(token);
  const authClaims = payload?.["https://api.openai.com/auth"];
  if (!isRecord(authClaims)) {
    return undefined;
  }
  const accountId = authClaims.chatgpt_account_id;
  return typeof accountId === "string" && accountId.trim().length > 0
    ? accountId.trim()
    : undefined;
}

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return undefined;
  }
  try {
    const payloadText = Buffer.from(parts[1] ?? "", "base64url").toString("utf8");
    const payload = JSON.parse(payloadText) as unknown;
    return isRecord(payload) ? payload : undefined;
  } catch {
    return undefined;
  }
}

function buildCodexUserAgent(): string {
  const platform = typeof process !== "undefined" ? process.platform : "unknown";
  const arch = typeof process !== "undefined" ? process.arch : "unknown";
  return `pi (${platform}; ${arch})`;
}

function shortHash(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < str.length; index += 1) {
    const ch = str.charCodeAt(index);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}

function sanitizeSurrogates(text: string): string {
  return text.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    "",
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
