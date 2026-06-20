import {
  MessageId,
  type AgentRuntimeEvent,
  type OrchestrationLatestTurn,
  type OrchestrationThreadActivity,
} from "@honk/contracts";
import { providerFailureFromAssistantMessageText } from "@honk/runtime/provider-error";
import { useRef } from "react";

import type { ChatMessage } from "../types";

const TURN_FAILURE_ACTIVITY_KINDS = new Set<OrchestrationThreadActivity["kind"]>([
  "runtime.turn.provider.failed",
  "runtime.turn.start.failed",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return null;
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
