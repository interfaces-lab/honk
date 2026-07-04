import { MessageId } from "@honk/shared/base-schemas";
import type { AgentRuntimeEvent } from "@honk/shared/runtime";
import type {
  OrchestrationLatestTurn,
  OrchestrationThreadActivity,
} from "@honk/shared/orchestration";
import { useRef } from "react";

import type { ChatMessage } from "../types";

const TURN_FAILURE_ACTIVITY_KINDS = new Set<OrchestrationThreadActivity["kind"]>([
  "runtime.turn.provider.failed",
  "runtime.turn.start.failed",
]);
const PERSISTED_PROVIDER_FAILURE_ASSISTANT_PREFIX = "Provider error:";
const CODEX_ERROR_PREFIX = "Codex error:";
const KNOWN_ERROR_COPY: Readonly<Record<string, string>> = {
  usage_limit_reached: "The usage limit has been reached",
  overloaded_error: "The model is temporarily overloaded. Try again shortly.",
  rate_limit_error: "Rate limit reached. Try again shortly.",
  authentication_error: "Authentication failed. Check your provider credentials.",
  invalid_request_error: "The provider rejected this request.",
};

interface ParsedProviderErrorPayload {
  readonly message: string | null;
  readonly type: string | null;
  readonly resetsAt: number | null;
  readonly resetsInSeconds: number | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return null;
}

function readTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stripKnownErrorPrefixes(raw: string): string {
  let value = raw.trim();
  if (value.startsWith(PERSISTED_PROVIDER_FAILURE_ASSISTANT_PREFIX)) {
    value = value.slice(PERSISTED_PROVIDER_FAILURE_ASSISTANT_PREFIX.length).trim();
  }
  if (value.startsWith(CODEX_ERROR_PREFIX)) {
    value = value.slice(CODEX_ERROR_PREFIX.length).trim();
  }
  return value;
}

function parseEmbeddedProviderErrorJson(raw: string): ParsedProviderErrorPayload | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }
  try {
    const record = asRecord(JSON.parse(trimmed) as unknown);
    if (!record) {
      return null;
    }
    const nestedError = asRecord(record.error);
    const message =
      readTrimmedString(nestedError?.message) ??
      readTrimmedString(record.message) ??
      readTrimmedString(nestedError?.detail);
    const type = readTrimmedString(nestedError?.type) ?? readTrimmedString(record.type);
    const resetsAt = readFiniteNumber(nestedError?.resets_at) ?? readFiniteNumber(record.resets_at);
    const resetsInSeconds =
      readFiniteNumber(nestedError?.resets_in_seconds) ??
      readFiniteNumber(record.resets_in_seconds);
    return { message, type, resetsAt, resetsInSeconds };
  } catch {
    return null;
  }
}

function formatResetHint(input: {
  readonly resetsInSeconds: number | null;
  readonly resetsAt: number | null;
}): string | null {
  if (input.resetsInSeconds !== null && input.resetsInSeconds > 0) {
    const minutes = Math.max(1, Math.round(input.resetsInSeconds / 60));
    return minutes === 1 ? "Resets in about 1 minute." : `Resets in about ${minutes} minutes.`;
  }
  if (input.resetsAt !== null && input.resetsAt > 0) {
    const resetDate = new Date(input.resetsAt * 1000);
    if (!Number.isNaN(resetDate.getTime())) {
      return `Resets at ${resetDate.toLocaleString()}.`;
    }
  }
  return null;
}

function formatTurnFailureMessage(raw: string): string {
  const stripped = stripKnownErrorPrefixes(raw);
  if (stripped.length === 0) {
    return "The request failed.";
  }
  const parsed = parseEmbeddedProviderErrorJson(stripped);
  if (!parsed) {
    return stripped;
  }
  const baseMessage = (parsed.type ? KNOWN_ERROR_COPY[parsed.type] : null) ?? parsed.message ?? stripped;
  const resetHint = formatResetHint(parsed);
  return resetHint ? `${baseMessage} ${resetHint}` : baseMessage;
}

function providerFailureFromAssistantMessageText(text: string): string | null {
  if (!text.startsWith(PERSISTED_PROVIDER_FAILURE_ASSISTANT_PREFIX)) {
    return null;
  }
  const raw = text.slice(PERSISTED_PROVIDER_FAILURE_ASSISTANT_PREFIX.length).trim();
  return raw.length === 0 ? null : formatTurnFailureMessage(raw);
}

function readProviderFailureFromRuntimeEvent(event: AgentRuntimeEvent): string | null {
  if (event.type !== "message.completed") {
    return null;
  }
  const data = asRecord(event.data);
  const providerFailure = data?.providerFailure;
  return typeof providerFailure === "string" && providerFailure.trim().length > 0
    ? providerFailure.trim()
    : null;
}

function userMessageIdForTurn(
  messages: ReadonlyArray<ChatMessage>,
  turnId: string,
): MessageId | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user" && message.turnId === turnId) {
      return message.id;
    }
  }
  return null;
}

function stampFailure(
  failures: Map<MessageId, string>,
  messageId: MessageId | null | undefined,
  detail: string,
): void {
  if (!messageId || detail.trim().length === 0 || failures.has(messageId)) {
    return;
  }
  failures.set(messageId, detail.trim());
}

export function buildTurnFailuresByUserMessageId(input: {
  readonly messages: ReadonlyArray<ChatMessage>;
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
  readonly runtimeEvents?: ReadonlyArray<AgentRuntimeEvent> | undefined;
  readonly latestTurn: OrchestrationLatestTurn | null;
  readonly threadError: string | null;
}): ReadonlyMap<MessageId, string> {
  const failures = new Map<MessageId, string>();

  for (const activity of input.activities) {
    if (!TURN_FAILURE_ACTIVITY_KINDS.has(activity.kind)) {
      continue;
    }
    const payload = asRecord(activity.payload);
    const detail = typeof payload?.detail === "string" ? payload.detail.trim() : "";
    const messageId =
      typeof payload?.messageId === "string" ? MessageId.make(payload.messageId) : null;
    stampFailure(failures, messageId, detail);
  }

  for (const event of input.runtimeEvents ?? []) {
    const providerFailure = readProviderFailureFromRuntimeEvent(event);
    if (!providerFailure || !event.turnId) {
      continue;
    }
    const messageId = userMessageIdForTurn(input.messages, event.turnId);
    stampFailure(failures, messageId, providerFailure);
  }

  for (const message of input.messages) {
    if (message.role !== "assistant" || !message.turnId) {
      continue;
    }
    const providerFailure = providerFailureFromAssistantMessageText(message.text);
    if (!providerFailure) {
      continue;
    }
    const userMessageId = userMessageIdForTurn(input.messages, message.turnId);
    stampFailure(failures, userMessageId, providerFailure);
  }

  if (input.threadError && input.latestTurn?.state === "error") {
    const messageId = userMessageIdForTurn(input.messages, input.latestTurn.turnId);
    stampFailure(failures, messageId, input.threadError);
  }

  return failures;
}

export function areSameTurnFailuresByUserMessageId(
  left: ReadonlyMap<MessageId, string>,
  right: ReadonlyMap<MessageId, string>,
): boolean {
  if (left === right) {
    return true;
  }
  if (left.size !== right.size) {
    return false;
  }
  for (const [messageId, detail] of left) {
    if (right.get(messageId) !== detail) {
      return false;
    }
  }
  return true;
}

export function useTurnFailuresByUserMessageId(input: {
  readonly messages: ReadonlyArray<ChatMessage>;
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
  readonly runtimeEvents?: ReadonlyArray<AgentRuntimeEvent> | undefined;
  readonly latestTurn: OrchestrationLatestTurn | null;
  readonly threadError: string | null;
}): ReadonlyMap<MessageId, string> {
  const nextFailures = buildTurnFailuresByUserMessageId(input);
  const stableFailuresRef = useRef<ReadonlyMap<MessageId, string>>(nextFailures);

  if (!areSameTurnFailuresByUserMessageId(stableFailuresRef.current, nextFailures)) {
    stableFailuresRef.current = nextFailures;
  }

  return stableFailuresRef.current;
}

export function shouldSuppressProviderFailureAssistantRow(
  message: ChatMessage,
  messages: ReadonlyArray<ChatMessage>,
  turnFailuresByUserMessageId: ReadonlyMap<MessageId, string>,
): boolean {
  if (message.role !== "assistant") {
    return false;
  }
  if (providerFailureFromAssistantMessageText(message.text)) {
    return true;
  }
  if ((message.text?.trim().length ?? 0) > 0) {
    return false;
  }
  if (!message.turnId) {
    return false;
  }
  const userMessageId = userMessageIdForTurn(messages, message.turnId);
  return userMessageId !== null && turnFailuresByUserMessageId.has(userMessageId);
}

export function threadErrorShownOnUserMessage(input: {
  readonly threadError: string | null;
  readonly turnFailuresByUserMessageId: ReadonlyMap<MessageId, string>;
  readonly latestTurn: OrchestrationLatestTurn | null;
  readonly messages: ReadonlyArray<ChatMessage>;
}): boolean {
  if (!input.threadError || input.latestTurn?.state !== "error") {
    return false;
  }
  const userMessageId = userMessageIdForTurn(input.messages, input.latestTurn.turnId);
  if (!userMessageId) {
    return false;
  }
  const failure = input.turnFailuresByUserMessageId.get(userMessageId);
  return failure === input.threadError;
}
