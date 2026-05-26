import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

import {
  Agent,
  type InteractionUpdate,
  type ModelSelection as CursorModelSelection,
  type Run,
  type RunResult,
  type SDKAgent,
  type SDKMessage,
  type SDKToolUseMessage,
  type SDKUserMessage,
  type SettingSource,
} from "@cursor/sdk";
import {
  defaultInstanceIdForDriver,
  EventId,
  ProviderDriverKind,
  RuntimeItemId,
  ThreadId,
  TurnId,
  type ApprovalRequestId,
  type CanonicalItemType,
  type ProviderApprovalDecision,
  type ProviderRuntimeEvent,
  type ProviderRuntimeTurnStatus,
  type ProviderSendTurnInput,
  type ProviderSession,
  type ProviderThreadSnapshotItem,
  type ProviderUserInputAnswers,
  type RuntimeItemStatus,
  type ToolLifecycleItemType,
} from "@multi/contracts";
import { Cause, Effect, Exit, FileSystem, Layer, Queue, Stream } from "effect";

import { resolveAttachmentPath } from "../attachment-store.ts";
import { ServerConfig } from "../config.ts";
import { ServerSettingsService } from "../server-settings.ts";
import { CursorSdkAdapter, type CursorSdkAdapterShape } from "./CursorSdkAdapter.service.ts";
import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "./Errors.ts";
import { type EventNdjsonLogger, makeEventNdjsonLogger } from "./EventNdjsonLogger.ts";
import { formatProviderTurnInputText } from "./ProviderConversationContext.ts";
import { resolveCursorSdkSettings, type ResolvedCursorSdkSettings } from "./provider-settings.ts";

const PROVIDER = ProviderDriverKind.make("cursorSdk");
const PROVIDER_INSTANCE_ID = defaultInstanceIdForDriver(PROVIDER);
const CURSOR_API_KEY_ENV_VAR = "CURSOR_API_KEY";
const DEFAULT_CURSOR_SDK_MODEL = "composer-2.5";
const CURSOR_SETTING_SOURCES = new Set<SettingSource>([
  "project",
  "user",
  "team",
  "mdm",
  "plugins",
  "all",
]);

interface CursorSdkAdapterLiveOptions {
  readonly nativeEventLogPath?: string;
  readonly nativeEventLogger?: EventNdjsonLogger;
}

interface CursorSdkTurnSnapshot {
  readonly id: TurnId;
  readonly items: Array<ProviderThreadSnapshotItem>;
}

interface CursorSdkSessionContext {
  session: ProviderSession;
  agent: SDKAgent | undefined;
  activeRun: Run | undefined;
  activeTurn: CursorSdkTurnState | undefined;
  resumeAgentId: string | undefined;
  apiKey: string | undefined;
  readonly turns: Array<CursorSdkTurnSnapshot>;
  stopped: boolean;
}

interface CursorSdkResumeState {
  readonly agentId?: string;
  readonly model?: CursorModelSelection;
}

interface CursorSdkTurnState {
  readonly turnId: TurnId;
  readonly assistantItemId: RuntimeItemId;
  readonly items: Array<ProviderThreadSnapshotItem>;
  readonly assistantTextDeltas: Array<string>;
  readonly startedToolCallIds: Set<string>;
  readonly emittedTaskSummaryKeys: Set<string>;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizeInteractionUpdateType(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();
}

function cursorSdkInteractionUpdateType(record: Record<string, unknown>): string | undefined {
  const message = asRecord(record.message);
  return normalizeInteractionUpdateType(
    asTrimmedString(record.type) ?? asTrimmedString(message?.case) ?? asTrimmedString(record.case),
  );
}

function cursorSdkInteractionUpdateValue(record: Record<string, unknown>): Record<string, unknown> {
  const message = asRecord(record.message);
  return asRecord(message?.value) ?? record;
}

function readCursorSdkModelSelection(value: unknown): CursorModelSelection | undefined {
  const record = asRecord(value);
  const id = asTrimmedString(record?.id);
  if (!id) return undefined;

  const params = Array.isArray(record?.params)
    ? record.params.flatMap((param) => {
        const paramRecord = asRecord(param);
        const paramId = asTrimmedString(paramRecord?.id);
        const paramValue = asTrimmedString(paramRecord?.value);
        return paramId && paramValue ? [{ id: paramId, value: paramValue }] : [];
      })
    : [];
  return params.length > 0 ? { id, params } : { id };
}

function readCursorSdkResumeState(resumeCursor: unknown): CursorSdkResumeState | undefined {
  const record = asRecord(resumeCursor);
  if (!record) return undefined;

  const agentId = asTrimmedString(record.agentId);
  const model = readCursorSdkModelSelection(record.model);
  if (!agentId && !model) return undefined;
  return {
    ...(agentId ? { agentId } : {}),
    ...(model ? { model } : {}),
  };
}

function stringifyDetail(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (value === undefined || value === null) return undefined;
  try {
    const text = JSON.stringify(value);
    return text.length > 0 ? text : undefined;
  } catch {
    return String(value);
  }
}

function scrubCursorSdkError(error: unknown, apiKey: string | undefined): string {
  const raw = error instanceof Error ? error.message : String(error);
  const scrubbed = apiKey ? raw.replaceAll(apiKey, "[redacted]") : raw;
  return scrubbed.trim() || "Cursor SDK request failed.";
}

function resolveCursorSdkApiKey(settings: ResolvedCursorSdkSettings): string | undefined {
  for (const variable of settings.environment) {
    if (variable.valueRedacted === true || variable.name !== CURSOR_API_KEY_ENV_VAR) continue;
    const value = variable.value.trim();
    if (value.length > 0) return value;
  }

  const envValue = process.env.CURSOR_API_KEY?.trim();
  return envValue && envValue.length > 0 ? envValue : undefined;
}

function resolveSettingSources(raw: string): SettingSource[] | undefined {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "none") return [];

  const sources: SettingSource[] = [];
  for (const part of normalized.split(",")) {
    const source = part.trim();
    if (!source) continue;
    if (CURSOR_SETTING_SOURCES.has(source as SettingSource)) {
      sources.push(source as SettingSource);
    }
  }
  return sources.length > 0 ? sources : undefined;
}

function toCursorModelSelection(
  modelSelection: ProviderSendTurnInput["modelSelection"] | undefined,
  fallbackModel: string | undefined,
): CursorModelSelection {
  const model = modelSelection?.model?.trim() || fallbackModel || DEFAULT_CURSOR_SDK_MODEL;
  const params = (modelSelection?.options ?? [])
    .map((selection) => ({
      id: selection.id,
      value: typeof selection.value === "boolean" ? String(selection.value) : selection.value,
    }))
    .filter((selection) => selection.id.trim().length > 0 && selection.value.trim().length > 0);
  return params.length > 0 ? { id: model, params } : { id: model };
}

function cursorSdkToolItemType(toolName: string): ToolLifecycleItemType {
  const normalized = toolName
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  switch (normalized) {
    case "shell":
    case "bash":
    case "terminal":
    case "run_terminal_cmd":
      return "command_execution";
    case "git":
    case "set_active_branch":
    case "setactivebranch":
    case "pr_management":
    case "prmanagement":
    case "edit_pr_labels":
    case "editprlabels":
      return "dynamic_tool_call";
    case "read":
    case "read_file":
      return "file_read";
    case "ls":
    case "grep":
    case "glob":
    case "find":
    case "sem_search":
      return "file_search";
    case "edit":
    case "write":
    case "delete":
      return "file_change";
    case "web_search":
      return "web_search";
    case "web_fetch":
      return "web_fetch";
    case "mcp":
      return "mcp_tool_call";
    case "task":
      return "collab_agent_tool_call";
    default:
      return "dynamic_tool_call";
  }
}

function cursorSdkToolStatus(status: SDKToolUseMessage["status"]): RuntimeItemStatus {
  switch (status) {
    case "completed":
      return "completed";
    case "error":
      return "failed";
    case "running":
      return "inProgress";
  }
}

function cursorSdkToolTitle(message: SDKToolUseMessage): string {
  const name = message.name.trim() || "tool";
  switch (message.status) {
    case "completed":
      return `${name} completed`;
    case "error":
      return `${name} failed`;
    case "running":
      return `${name} running`;
  }
}

function cursorSdkToolDetail(message: SDKToolUseMessage): string | undefined {
  const result = stringifyDetail(message.result);
  if (result) return result;
  return stringifyDetail(message.args);
}

function cursorSdkToolTruncated(
  value: unknown,
): NonNullable<SDKToolUseMessage["truncated"]> | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const truncated: NonNullable<SDKToolUseMessage["truncated"]> = {};
  if (typeof record.args === "boolean") {
    truncated.args = record.args;
  }
  if (typeof record.result === "boolean") {
    truncated.result = record.result;
  }
  return truncated.args !== undefined || truncated.result !== undefined ? truncated : undefined;
}

function cursorSdkToolMessageFromUpdate(
  update: Record<string, unknown>,
  status: SDKToolUseMessage["status"],
): SDKToolUseMessage | undefined {
  const toolCall = asRecord(update.toolCall) ?? asRecord(update.tool_call);
  const callId =
    asTrimmedString(update.callId) ??
    asTrimmedString(update.call_id) ??
    asTrimmedString(update.toolCallId) ??
    asTrimmedString(update.tool_call_id) ??
    asTrimmedString(toolCall?.callId) ??
    asTrimmedString(toolCall?.call_id) ??
    asTrimmedString(toolCall?.id);
  const name =
    asTrimmedString(toolCall?.type) ??
    asTrimmedString(toolCall?.name) ??
    asTrimmedString(toolCall?.toolName) ??
    asTrimmedString(toolCall?.tool_name) ??
    asTrimmedString(update.name) ??
    "tool";
  if (!callId) return undefined;
  const truncated = cursorSdkToolTruncated(toolCall?.truncated);
  return {
    type: "tool_call",
    agent_id: "cursor-sdk-local",
    run_id: "cursor-sdk-local",
    call_id: callId,
    name,
    status,
    ...(toolCall?.args !== undefined ? { args: toolCall.args } : {}),
    ...(toolCall?.input !== undefined ? { args: toolCall.input } : {}),
    ...(toolCall?.arguments !== undefined ? { args: toolCall.arguments } : {}),
    ...(toolCall?.result !== undefined ? { result: toolCall.result } : {}),
    ...(toolCall?.output !== undefined ? { result: toolCall.output } : {}),
    ...(truncated ? { truncated } : {}),
  };
}

function cursorSdkShellOutputDeltaFromUpdate(
  update: Record<string, unknown>,
): { readonly callId: string; readonly delta: string } | undefined {
  const event = asRecord(update.event) ?? update;
  const callId =
    asTrimmedString(update.callId) ??
    asTrimmedString(update.call_id) ??
    asTrimmedString(update.toolCallId) ??
    asTrimmedString(update.tool_call_id) ??
    asTrimmedString(event.callId) ??
    asTrimmedString(event.call_id) ??
    asTrimmedString(event.toolCallId) ??
    asTrimmedString(event.tool_call_id) ??
    asTrimmedString(event.id);
  if (!callId) return undefined;
  const delta =
    asNonEmptyString(event.delta) ??
    asNonEmptyString(event.text) ??
    asNonEmptyString(event.output) ??
    [asNonEmptyString(event.stdout), asNonEmptyString(event.stderr)]
      .filter((part): part is string => part !== undefined)
      .join("");
  return delta.length > 0 ? { callId, delta } : undefined;
}

function cursorSdkToolSnapshotItem(message: SDKToolUseMessage): ProviderThreadSnapshotItem {
  const detail = cursorSdkToolDetail(message);
  return {
    id: message.call_id,
    itemType: cursorSdkToolItemType(message.name),
    role: "tool",
    title: cursorSdkToolTitle(message),
    ...(detail ? { detail } : {}),
    data: message,
  };
}

function upsertCursorSdkTurnItem(turn: CursorSdkTurnState, item: ProviderThreadSnapshotItem): void {
  const existingIndex = item.id
    ? turn.items.findIndex((candidate) => candidate.id === item.id)
    : -1;
  if (existingIndex >= 0) {
    turn.items[existingIndex] = {
      ...turn.items[existingIndex],
      ...item,
    };
    return;
  }
  turn.items.push(item);
}

function cursorSdkUserSnapshotItem(
  text: string,
  attachments: ProviderSendTurnInput["attachments"],
): ProviderThreadSnapshotItem {
  return {
    itemType: "user_message",
    role: "user",
    title: "User message",
    ...(text.length > 0 ? { detail: text } : {}),
    data: {
      text,
      attachmentCount: attachments?.length ?? 0,
    },
  };
}

function cursorSdkAssistantSnapshotItem(input: {
  readonly itemId: RuntimeItemId;
  readonly text: string;
  readonly result: RunResult | undefined;
}): ProviderThreadSnapshotItem {
  return {
    id: input.itemId,
    itemType: "assistant_message",
    role: "assistant",
    title: "Assistant message",
    ...(input.text.length > 0 ? { detail: input.text } : {}),
    ...(input.result ? { data: input.result } : {}),
  };
}

function cursorSdkGitDetail(git: RunResult["git"] | undefined): string | undefined {
  const branches = git?.branches ?? [];
  if (branches.length === 0) return undefined;
  if (branches.length > 1) return `${branches.length} branches updated`;

  const branch = branches[0];
  if (!branch) return undefined;
  return [branch.branch, branch.prUrl, branch.repoUrl]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" - ");
}

function cursorSdkTaskSummary(message: SDKMessage): string | undefined {
  if (message.type !== "task") return undefined;
  return asTrimmedString(message.text);
}

function makeEventBase(
  context: CursorSdkSessionContext,
  turnId: TurnId | undefined,
  options?: {
    readonly itemId?: RuntimeItemId | undefined;
    readonly messageType?: string | undefined;
    readonly method?: string | undefined;
    readonly payload?: unknown;
    readonly source?: "cursor.sdk.message" | "cursor.sdk.delta";
  },
) {
  return {
    eventId: EventId.make(randomUUID()),
    provider: PROVIDER,
    providerInstanceId: context.session.providerInstanceId,
    threadId: context.session.threadId,
    createdAt: new Date().toISOString(),
    ...(turnId !== undefined ? { turnId } : {}),
    ...(options?.itemId !== undefined ? { itemId: options.itemId } : {}),
    ...(options?.payload !== undefined
      ? {
          raw: {
            source: options.source ?? "cursor.sdk.message",
            ...(options.method ? { method: options.method } : {}),
            ...(options.messageType ? { messageType: options.messageType } : {}),
            payload: options.payload,
          },
        }
      : {}),
  };
}

function mapRunStatusToTurnState(status: RunResult["status"]): ProviderRuntimeTurnStatus {
  switch (status) {
    case "finished":
      return "completed";
    case "cancelled":
      return "cancelled";
    case "error":
      return "failed";
  }
}

function makeCursorSdkAdapter(options?: CursorSdkAdapterLiveOptions) {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const serverConfig = yield* ServerConfig;
    const serverSettings = yield* ServerSettingsService;
    const nativeEventLogger =
      options?.nativeEventLogger ??
      (options?.nativeEventLogPath !== undefined
        ? yield* makeEventNdjsonLogger(options.nativeEventLogPath, { stream: "native" })
        : undefined);
    const managedNativeEventLogger =
      options?.nativeEventLogger === undefined ? nativeEventLogger : undefined;
    const runtimeEvents = yield* Queue.unbounded<ProviderRuntimeEvent>();
    const sessions = new Map<ThreadId, CursorSdkSessionContext>();
    const runtimeContext = yield* Effect.context<never>();
    const runPromise = Effect.runPromiseWith(runtimeContext);

    const offerRuntimeEvent = (
      event: Omit<ProviderRuntimeEvent, "providerInstanceId"> & {
        readonly providerInstanceId?: ProviderRuntimeEvent["providerInstanceId"];
      },
    ) =>
      Queue.offer(runtimeEvents, {
        ...event,
        providerInstanceId: event.providerInstanceId ?? PROVIDER_INSTANCE_ID,
      } as ProviderRuntimeEvent).pipe(Effect.asVoid);

    const logNative = (
      context: CursorSdkSessionContext,
      method: string,
      payload: unknown,
      messageType?: string,
    ) =>
      Effect.gen(function* () {
        if (!nativeEventLogger) return;
        const observedAt = new Date().toISOString();
        yield* nativeEventLogger.write(
          {
            observedAt,
            event: {
              id: randomUUID(),
              kind: "notification",
              provider: PROVIDER,
              providerInstanceId: context.session.providerInstanceId,
              createdAt: observedAt,
              method,
              ...(messageType ? { messageType } : {}),
              threadId: context.session.threadId,
              ...(context.activeTurn ? { turnId: context.activeTurn.turnId } : {}),
              payload,
            },
          },
          context.session.threadId,
        );
      });

    const requireSession = (threadId: ThreadId) =>
      Effect.gen(function* () {
        const context = sessions.get(threadId);
        if (!context) {
          return yield* new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId });
        }
        if (context.stopped) {
          return yield* new ProviderAdapterSessionClosedError({ provider: PROVIDER, threadId });
        }
        return context;
      });

    const loadCursorSdkSettings = (instanceId = PROVIDER_INSTANCE_ID) =>
      serverSettings.getSettings.pipe(
        Effect.map((settings) => resolveCursorSdkSettings(settings, instanceId)),
      );

    const ensureAgent = Effect.fn("ensureCursorSdkAgent")(function* (
      context: CursorSdkSessionContext,
      modelSelection: CursorModelSelection,
    ) {
      if (context.agent) return context.agent;

      const settings = yield* loadCursorSdkSettings(context.session.providerInstanceId).pipe(
        Effect.mapError(
          (error) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "settings.read",
              detail: error.message,
              cause: error,
            }),
        ),
      );
      const apiKey = resolveCursorSdkApiKey(settings);
      if (!apiKey) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue:
            "Cursor SDK requires CURSOR_API_KEY in the provider instance environment or process environment.",
        });
      }

      const settingSources = resolveSettingSources(settings.settingSources);
      const cwd = context.session.cwd ?? serverConfig.cwd;
      const resumeAgentId = context.resumeAgentId;
      const agentOptions = {
        apiKey,
        model: modelSelection,
        name: `Multi ${context.session.threadId}`,
        local: {
          cwd,
          ...(settingSources !== undefined ? { settingSources } : {}),
        },
      };
      const agent = yield* Effect.tryPromise({
        try: () =>
          resumeAgentId ? Agent.resume(resumeAgentId, agentOptions) : Agent.create(agentOptions),
        catch: (error) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: resumeAgentId ? "Agent.resume" : "Agent.create",
            detail: scrubCursorSdkError(error, apiKey),
            cause: error,
          }),
      });

      context.agent = agent;
      context.resumeAgentId = undefined;
      context.apiKey = apiKey;
      return agent;
    });

    const buildSdkUserMessage = Effect.fn("buildCursorSdkUserMessage")(function* (
      input: ProviderSendTurnInput,
    ): Effect.fn.Return<
      SDKUserMessage,
      ProviderAdapterRequestError | ProviderAdapterValidationError
    > {
      const text = formatProviderTurnInputText(input) ?? "";
      const images: NonNullable<SDKUserMessage["images"]> = [];

      for (const attachment of input.attachments ?? []) {
        const attachmentPath = resolveAttachmentPath({
          attachmentsDir: serverConfig.attachmentsDir,
          attachment,
        });
        if (!attachmentPath) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "Agent.send",
            detail: `Invalid attachment id '${attachment.id}'.`,
          });
        }
        const bytes = yield* fileSystem.readFile(attachmentPath).pipe(
          Effect.mapError(
            (cause) =>
              new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "Agent.send",
                detail: cause.message,
                cause,
              }),
          ),
        );
        images.push({
          data: Buffer.from(bytes).toString("base64"),
          mimeType: attachment.mimeType,
        });
      }

      if (text.trim().length === 0 && images.length === 0) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue: "Turn requires non-empty text or attachments.",
        });
      }

      return {
        text,
        ...(images.length > 0 ? { images } : {}),
      };
    });

    const emitAssistantDelta = Effect.fn("emitCursorSdkAssistantDelta")(function* (
      context: CursorSdkSessionContext,
      turn: CursorSdkTurnState,
      delta: string,
      rawPayload: unknown,
    ) {
      if (delta.length === 0) return;
      turn.assistantTextDeltas.push(delta);
      yield* offerRuntimeEvent({
        ...makeEventBase(context, turn.turnId, {
          itemId: turn.assistantItemId,
          source: "cursor.sdk.delta",
          method: "onDelta",
          messageType: "text-delta",
          payload: rawPayload,
        }),
        type: "content.delta",
        payload: {
          streamKind: "assistant_text",
          delta,
        },
      });
    });

    const emitReasoningDelta = Effect.fn("emitCursorSdkReasoningDelta")(function* (
      context: CursorSdkSessionContext,
      turn: CursorSdkTurnState,
      delta: string,
      rawPayload: unknown,
    ) {
      if (delta.length === 0) return;
      yield* offerRuntimeEvent({
        ...makeEventBase(context, turn.turnId, {
          source: "cursor.sdk.delta",
          method: "onDelta",
          messageType: "thinking-delta",
          payload: rawPayload,
        }),
        type: "content.delta",
        payload: {
          streamKind: "reasoning_text",
          delta,
        },
      });
    });

    const emitTaskSummary = Effect.fn("emitCursorSdkTaskSummary")(function* (
      context: CursorSdkSessionContext,
      turn: CursorSdkTurnState,
      summary: string,
      rawPayload: unknown,
      source: "cursor.sdk.message" | "cursor.sdk.delta",
      method: string,
      messageType: string,
    ) {
      const summaryKey = summary.trim();
      if (!summaryKey || turn.emittedTaskSummaryKeys.has(summaryKey)) {
        return;
      }
      turn.emittedTaskSummaryKeys.add(summaryKey);
      yield* offerRuntimeEvent({
        ...makeEventBase(context, turn.turnId, {
          source,
          method,
          messageType,
          payload: rawPayload,
        }),
        type: "tool.summary",
        payload: { summary: summaryKey },
      });
    });

    const emitToolMessage = Effect.fn("emitCursorSdkToolMessage")(function* (
      context: CursorSdkSessionContext,
      turn: CursorSdkTurnState,
      message: SDKToolUseMessage,
    ) {
      const itemId = RuntimeItemId.make(message.call_id || randomUUID());
      const itemType = cursorSdkToolItemType(message.name);
      const payload = {
        itemType,
        status: cursorSdkToolStatus(message.status),
        title: cursorSdkToolTitle(message),
        ...(cursorSdkToolDetail(message) ? { detail: cursorSdkToolDetail(message) } : {}),
        data: message,
      };
      const eventType =
        message.status === "running" && !turn.startedToolCallIds.has(message.call_id)
          ? "item.started"
          : message.status === "running"
            ? "item.updated"
            : "item.completed";
      turn.startedToolCallIds.add(message.call_id);
      upsertCursorSdkTurnItem(turn, cursorSdkToolSnapshotItem(message));
      yield* offerRuntimeEvent({
        ...makeEventBase(context, turn.turnId, {
          itemId,
          method: "run.stream",
          messageType: message.type,
          payload: message,
        }),
        type: eventType,
        payload,
      });
    });

    const handleInteractionUpdate = Effect.fn("handleCursorSdkInteractionUpdate")(function* (
      context: CursorSdkSessionContext,
      update: InteractionUpdate,
    ) {
      const turn = context.activeTurn;
      if (!turn) return;
      const record = asRecord(update);
      if (!record) return;
      const updateType = cursorSdkInteractionUpdateType(record);
      const updateValue = cursorSdkInteractionUpdateValue(record);
      yield* logNative(context, "onDelta", update, updateType);
      switch (updateType) {
        case "text-delta":
          yield* emitAssistantDelta(
            context,
            turn,
            asNonEmptyString(updateValue.text) ?? "",
            update,
          );
          return;
        case "thinking-delta":
          yield* emitReasoningDelta(
            context,
            turn,
            asNonEmptyString(updateValue.text) ?? "",
            update,
          );
          return;
        case "partial-tool-call":
        case "tool-call-delta":
        case "tool-call-started": {
          const message = cursorSdkToolMessageFromUpdate(updateValue, "running");
          if (message) yield* emitToolMessage(context, turn, message);
          return;
        }
        case "tool-call-completed": {
          const message = cursorSdkToolMessageFromUpdate(updateValue, "completed");
          if (message) yield* emitToolMessage(context, turn, message);
          return;
        }
        case "shell-output-delta": {
          const output = cursorSdkShellOutputDeltaFromUpdate(updateValue);
          if (!output) return;
          yield* offerRuntimeEvent({
            ...makeEventBase(context, turn.turnId, {
              itemId: RuntimeItemId.make(output.callId),
              source: "cursor.sdk.delta",
              method: "onDelta",
              messageType: updateType,
              payload: update,
            }),
            type: "content.delta",
            payload: {
              streamKind: "command_output",
              delta: output.delta,
            },
          });
          return;
        }
        case "summary": {
          const summary = asTrimmedString(updateValue.summary);
          if (!summary) return;
          yield* emitTaskSummary(
            context,
            turn,
            summary,
            update,
            "cursor.sdk.delta",
            "onDelta",
            updateType,
          );
          return;
        }
        case "summary-started":
        case "summary-completed":
        case "turn-ended":
        case "thinking-completed":
        case "token-delta":
        case "user-message-appended":
        case "step-started":
        case "step-completed":
          return;
        default:
          return;
      }
    });

    const handleSdkMessage = Effect.fn("handleCursorSdkMessage")(function* (
      context: CursorSdkSessionContext,
      turn: CursorSdkTurnState,
      message: SDKMessage,
    ) {
      yield* logNative(context, "run.stream", message, message.type);
      const summary = cursorSdkTaskSummary(message);
      if (!summary) return;
      yield* emitTaskSummary(
        context,
        turn,
        summary,
        message,
        "cursor.sdk.message",
        "run.stream",
        message.type,
      );
    });

    const consumeRunTaskMessages = Effect.fn("consumeCursorSdkRunTaskMessages")(function* (
      context: CursorSdkSessionContext,
      turn: CursorSdkTurnState,
      run: Run,
    ) {
      if (!run.supports("stream")) {
        return;
      }
      yield* Stream.fromAsyncIterable(
        run.stream(),
        (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "Run.stream",
            detail: scrubCursorSdkError(cause, context.apiKey),
            cause,
          }),
      ).pipe(
        Stream.takeWhile(() => context.activeTurn === turn),
        Stream.runForEach((message) => handleSdkMessage(context, turn, message)),
      );
    });

    const emitRunGitResult = Effect.fn("emitCursorSdkRunGitResult")(function* (
      context: CursorSdkSessionContext,
      turn: CursorSdkTurnState,
      result: RunResult,
    ) {
      if (!result.git || result.git.branches.length === 0) {
        return;
      }
      const itemId = RuntimeItemId.make(`cursor-sdk-git-${turn.turnId}`);
      const detail = cursorSdkGitDetail(result.git);
      const item: ProviderThreadSnapshotItem = {
        id: itemId,
        itemType: "dynamic_tool_call",
        role: "tool",
        title: "Git updated",
        ...(detail ? { detail } : {}),
        data: {
          toolName: "cursor.run.git",
          git: result.git,
        },
      };
      upsertCursorSdkTurnItem(turn, item);
      yield* offerRuntimeEvent({
        ...makeEventBase(context, turn.turnId, {
          itemId,
          method: "Run.wait",
          messageType: "git",
          payload: result.git,
        }),
        type: "item.completed",
        payload: {
          itemType: "dynamic_tool_call",
          status: "completed",
          title: "Git updated",
          ...(detail ? { detail } : {}),
          data: {
            toolName: "cursor.run.git",
            git: result.git,
          },
        },
      });
    });

    const completeAssistantItem = Effect.fn("completeCursorSdkAssistantItem")(function* (
      context: CursorSdkSessionContext,
      turn: CursorSdkTurnState,
      result: RunResult | undefined,
    ) {
      const streamedText = turn.assistantTextDeltas.join("");
      const fallbackText = result?.result?.trim() ?? "";
      const text = streamedText.length > 0 ? streamedText : fallbackText;
      if (streamedText.length === 0 && fallbackText.length > 0) {
        yield* emitAssistantDelta(context, turn, fallbackText, result);
      }
      if (text.length > 0 || result !== undefined) {
        upsertCursorSdkTurnItem(
          turn,
          cursorSdkAssistantSnapshotItem({
            itemId: turn.assistantItemId,
            text,
            result,
          }),
        );
        yield* offerRuntimeEvent({
          ...makeEventBase(context, turn.turnId, {
            itemId: turn.assistantItemId,
            method: "Run.wait",
            messageType: "assistant-completed",
            payload: result,
          }),
          type: "item.completed",
          payload: {
            itemType: "assistant_message" satisfies CanonicalItemType,
            status: "completed",
            title: "Assistant message",
            ...(text.length > 0 ? { detail: text } : {}),
          },
        });
      }
    });

    const stopSessionInternal = Effect.fn("stopCursorSdkSessionInternal")(function* (
      context: CursorSdkSessionContext,
    ) {
      context.stopped = true;
      const run = context.activeRun;
      context.activeRun = undefined;
      if (run && run.status === "running") {
        yield* Effect.promise(() => run.cancel()).pipe(Effect.ignore);
      }
      context.agent?.close();
      context.agent = undefined;
      context.session = {
        ...context.session,
        status: "closed",
        activeTurnId: undefined,
        updatedAt: new Date().toISOString(),
      };
      yield* offerRuntimeEvent({
        ...makeEventBase(context, undefined),
        type: "session.exited",
        payload: { reason: "Session stopped", exitKind: "graceful" },
      });
    });

    const startSession: CursorSdkAdapterShape["startSession"] = Effect.fn("startSession")(
      function* (input) {
        if (input.provider !== undefined && input.provider !== PROVIDER) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startSession",
            issue: `Cursor SDK adapter cannot start provider '${input.provider}'.`,
          });
        }

        const now = new Date().toISOString();
        const cwd = input.cwd ?? serverConfig.cwd;
        const resumeState = readCursorSdkResumeState(input.resumeCursor);
        const model = input.modelSelection?.model ?? resumeState?.model?.id;
        const session: ProviderSession = {
          provider: PROVIDER,
          providerInstanceId: input.providerInstanceId,
          status: "ready",
          runtimeMode: input.runtimeMode,
          cwd,
          ...(model ? { model } : {}),
          ...(input.resumeCursor !== undefined ? { resumeCursor: input.resumeCursor } : {}),
          threadId: input.threadId,
          createdAt: now,
          updatedAt: now,
        };
        const context: CursorSdkSessionContext = {
          session,
          agent: undefined,
          activeRun: undefined,
          activeTurn: undefined,
          resumeAgentId: resumeState?.agentId,
          apiKey: undefined,
          turns: [],
          stopped: false,
        };
        sessions.set(input.threadId, context);

        yield* offerRuntimeEvent({
          ...makeEventBase(context, undefined),
          type: "session.started",
          payload: { message: "Cursor SDK session ready" },
        });
        yield* offerRuntimeEvent({
          ...makeEventBase(context, undefined),
          type: "session.state.changed",
          payload: { state: "ready", reason: "Cursor SDK session ready" },
        });
        yield* offerRuntimeEvent({
          ...makeEventBase(context, undefined),
          type: "thread.started",
          payload: { providerThreadId: resumeState?.agentId ?? input.threadId },
        });
        return session;
      },
    );

    const sendTurn: CursorSdkAdapterShape["sendTurn"] = Effect.fn("sendTurn")(function* (input) {
      const context = yield* requireSession(input.threadId);
      if (context.activeRun?.status === "running") {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue: "A Cursor SDK run is already active for this thread.",
        });
      }

      const modelSelection = toCursorModelSelection(input.modelSelection, context.session.model);
      const agent = yield* ensureAgent(context, modelSelection);
      const message = yield* buildSdkUserMessage(input);
      const turnId = TurnId.make(randomUUID());
      const assistantItemId = RuntimeItemId.make(`cursor-sdk-assistant-${turnId}`);
      const turnSnapshot: CursorSdkTurnSnapshot = {
        id: turnId,
        items: [cursorSdkUserSnapshotItem(message.text, input.attachments)],
      };
      const turnState: CursorSdkTurnState = {
        turnId,
        assistantItemId,
        items: turnSnapshot.items,
        assistantTextDeltas: [],
        startedToolCallIds: new Set(),
        emittedTaskSummaryKeys: new Set(),
      };
      context.turns.push(turnSnapshot);
      context.activeTurn = turnState;
      context.session = {
        ...context.session,
        activeTurnId: turnId,
        status: "running",
        model: modelSelection.id,
        updatedAt: new Date().toISOString(),
      };

      yield* offerRuntimeEvent({
        ...makeEventBase(context, turnId),
        type: "turn.started",
        payload: { model: modelSelection.id },
      });

      const run = yield* Effect.tryPromise({
        try: () =>
          agent.send(message, {
            model: modelSelection,
            onDelta: (args) => runPromise(handleInteractionUpdate(context, args.update)),
          }),
        catch: (error) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "Agent.send",
            detail: scrubCursorSdkError(error, context.apiKey),
            cause: error,
          }),
      });
      context.activeRun = run;
      const taskStreamPromise = run.supports("stream")
        ? runPromise(consumeRunTaskMessages(context, turnState, run).pipe(Effect.ignore))
        : Promise.resolve();
      const resultExit = yield* Effect.tryPromise({
        try: () => run.wait(),
        catch: (error) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "Run.wait",
            detail: scrubCursorSdkError(error, context.apiKey),
            cause: error,
          }),
      }).pipe(Effect.exit);
      yield* Effect.promise(() => taskStreamPromise).pipe(Effect.ignore);

      context.activeRun = undefined;
      context.activeTurn = undefined;
      if (Exit.isFailure(resultExit)) {
        const detail = scrubCursorSdkError(Cause.squash(resultExit.cause), context.apiKey);
        context.session = {
          ...context.session,
          activeTurnId: undefined,
          status: "error",
          lastError: detail,
          updatedAt: new Date().toISOString(),
        };
        yield* offerRuntimeEvent({
          ...makeEventBase(context, turnId),
          type: "turn.completed",
          payload: {
            state: "failed",
            errorMessage: detail,
          },
        });
        return yield* Effect.failCause(resultExit.cause);
      }

      const result = resultExit.value;
      yield* emitRunGitResult(context, turnState, result);
      yield* completeAssistantItem(context, turnState, result);
      context.session = {
        ...context.session,
        activeTurnId: undefined,
        status: result.status === "error" ? "error" : "ready",
        ...(result.status === "error" && result.result ? { lastError: result.result } : {}),
        model: result.model?.id ?? modelSelection.id,
        updatedAt: new Date().toISOString(),
      };
      yield* offerRuntimeEvent({
        ...makeEventBase(context, turnId),
        type: "turn.completed",
        payload: {
          state: mapRunStatusToTurnState(result.status),
          stopReason: result.status,
          ...(result.result && result.status === "error" ? { errorMessage: result.result } : {}),
          ...(typeof result.durationMs === "number"
            ? { usage: { durationMs: result.durationMs } }
            : {}),
        },
      });

      return {
        threadId: input.threadId,
        turnId,
        resumeCursor: {
          agentId: agent.agentId,
          runId: run.id,
          model: result.model ?? modelSelection,
        },
      };
    });

    const interruptTurn: CursorSdkAdapterShape["interruptTurn"] = (threadId, turnId) =>
      Effect.gen(function* () {
        const context = yield* requireSession(threadId);
        const activeTurnId = context.activeTurn?.turnId ?? turnId;
        const run = context.activeRun;
        if (run && run.status === "running") {
          yield* Effect.promise(() => run.cancel()).pipe(Effect.ignore);
        }
        context.activeRun = undefined;
        context.activeTurn = undefined;
        context.session = {
          ...context.session,
          activeTurnId: undefined,
          status: "ready",
          updatedAt: new Date().toISOString(),
        };
        if (activeTurnId !== undefined) {
          yield* offerRuntimeEvent({
            ...makeEventBase(context, activeTurnId),
            type: "turn.aborted",
            payload: { reason: "Interrupted by user." },
          });
        }
      });

    const respondToRequest: CursorSdkAdapterShape["respondToRequest"] = (
      _threadId: ThreadId,
      requestId: ApprovalRequestId,
      _decision: ProviderApprovalDecision,
    ) =>
      Effect.fail(
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "Cursor SDK request",
          detail: `Cursor SDK request responses are not supported by the public SDK: ${requestId}`,
        }),
      );

    const respondToUserInput: CursorSdkAdapterShape["respondToUserInput"] = (
      _threadId: ThreadId,
      requestId: ApprovalRequestId,
      _answers: ProviderUserInputAnswers,
    ) =>
      Effect.fail(
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "Cursor SDK user input",
          detail: `Cursor SDK user input responses are not supported by the public SDK: ${requestId}`,
        }),
      );

    const stopSession: CursorSdkAdapterShape["stopSession"] = (threadId) =>
      Effect.gen(function* () {
        const context = yield* requireSession(threadId);
        yield* stopSessionInternal(context);
      });

    const listSessions: CursorSdkAdapterShape["listSessions"] = () =>
      Effect.sync(() => Array.from(sessions.values(), (context) => ({ ...context.session })));

    const hasSession: CursorSdkAdapterShape["hasSession"] = (threadId) =>
      Effect.sync(() => {
        const context = sessions.get(threadId);
        return context !== undefined && !context.stopped;
      });

    const readThread: CursorSdkAdapterShape["readThread"] = (input) =>
      Effect.gen(function* () {
        const context = yield* requireSession(input.threadId);
        return {
          threadId: input.threadId,
          providerThreadId: context.agent?.agentId,
          turns: context.turns.map((turn) => ({
            id: turn.id,
            items: [...turn.items],
          })),
        };
      });

    const rollbackThread: CursorSdkAdapterShape["rollbackThread"] = (threadId, numTurns) =>
      Effect.gen(function* () {
        const context = yield* requireSession(threadId);
        if (!Number.isInteger(numTurns) || numTurns < 1) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "rollbackThread",
            issue: "numTurns must be an integer >= 1.",
          });
        }
        const nextLength = Math.max(0, context.turns.length - numTurns);
        context.turns.splice(nextLength);
        if (numTurns > 0 && context.agent) {
          context.agent.close();
          context.agent = undefined;
          context.resumeAgentId = undefined;
        }
        return {
          threadId,
          providerThreadId: context.agent?.agentId,
          turns: context.turns.map((turn) => ({
            id: turn.id,
            items: [...turn.items],
          })),
        };
      });

    const stopAll: CursorSdkAdapterShape["stopAll"] = () =>
      Effect.forEach(sessions.values(), stopSessionInternal, { discard: true });

    yield* Effect.addFinalizer(() =>
      Effect.forEach(sessions.values(), stopSessionInternal, { discard: true }).pipe(
        Effect.tap(() => Queue.shutdown(runtimeEvents)),
        Effect.tap(() => managedNativeEventLogger?.close() ?? Effect.void),
      ),
    );

    return {
      provider: PROVIDER,
      capabilities: { sessionModelSwitch: "in-session" },
      startSession,
      sendTurn,
      interruptTurn,
      respondToRequest,
      respondToUserInput,
      stopSession,
      listSessions,
      hasSession,
      readThread,
      rollbackThread,
      stopAll,
      streamEvents: Stream.fromQueue(runtimeEvents),
    } satisfies CursorSdkAdapterShape;
  });
}

export const CursorSdkAdapterLive = Layer.effect(CursorSdkAdapter, makeCursorSdkAdapter());

export function makeCursorSdkAdapterLive(options?: CursorSdkAdapterLiveOptions) {
  return Layer.effect(CursorSdkAdapter, makeCursorSdkAdapter(options));
}
