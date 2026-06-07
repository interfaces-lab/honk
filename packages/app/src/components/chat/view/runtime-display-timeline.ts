import {
  MessageId,
  OrchestrationProposedPlanId,
  type RuntimeDisplayTimelineItem,
  type RuntimeDisplayTimelineProjection,
} from "@multi/contracts";

import type { TimelineEntry } from "../../../session-logic";
import type { ChatMessage, ProposedPlan } from "../../../types";
import { timelineMessageEntryId } from "./timeline-entry-ids";

export function materializeTimelineEntriesFromRuntimeDisplayTimeline(input: {
  readonly timeline: RuntimeDisplayTimelineProjection;
  readonly messages: ReadonlyArray<ChatMessage>;
  readonly proposedPlans: ReadonlyArray<ProposedPlan>;
}): TimelineEntry[] {
  const messagesById = new Map(input.messages.map((message) => [message.id, message] as const));
  const proposedPlansById = new Map(
    input.proposedPlans.map((proposedPlan) => [proposedPlan.id, proposedPlan] as const),
  );
  const entries: TimelineEntry[] = [];

  for (const item of input.timeline.items) {
    entries.push(
      ...runtimeDisplayTimelineItemToTimelineEntries(item, messagesById, proposedPlansById),
    );
  }

  return entries;
}

export function runtimeDisplayTimelineHasResponseItem(
  timeline: RuntimeDisplayTimelineProjection | null | undefined,
): boolean {
  if (!timeline) {
    return false;
  }
  return timeline.items.some((item) => {
    if (item.kind !== "message") {
      return true;
    }
    if (item.role === "user") {
      return false;
    }
    return (
      (item.text?.trim().length ?? 0) > 0 ||
      (item.thinking?.trim().length ?? 0) > 0
    );
  });
}

export function runtimeDisplayTimelineRenderableUserMessageIds(
  timeline: RuntimeDisplayTimelineProjection | null | undefined,
): ReadonlySet<MessageId> {
  const messageIds = new Set<MessageId>();
  if (!timeline) {
    return messageIds;
  }
  for (const item of timeline.items) {
    if (item.kind !== "message" || item.role !== "user") {
      continue;
    }
    if ((item.text?.trim().length ?? 0) === 0) {
      continue;
    }
    messageIds.add(item.clientMessageId ?? MessageId.make(item.threadEntryId ?? item.id));
  }
  return messageIds;
}

export function shouldUseRuntimeDisplayTimelineEntries(input: {
  readonly runtimeEntries: ReadonlyArray<TimelineEntry>;
  readonly committedEntries: ReadonlyArray<TimelineEntry>;
}): boolean {
  if (input.runtimeEntries.length === 0) {
    return false;
  }
  if (
    input.committedEntries.length > 0 &&
    !input.runtimeEntries.some(
      (entry) => entry.kind !== "message" || entry.message.role !== "user",
    )
  ) {
    return false;
  }
  return true;
}

function runtimeDisplayTimelineItemToTimelineEntries(
  item: RuntimeDisplayTimelineItem,
  messagesById: ReadonlyMap<MessageId, ChatMessage>,
  proposedPlansById: ReadonlyMap<OrchestrationProposedPlanId, ProposedPlan>,
): TimelineEntry[] {
  switch (item.kind) {
    case "message": {
      const entries: TimelineEntry[] = [];
      const messageId =
        item.clientMessageId ?? MessageId.make(item.threadEntryId ?? item.id);
      const existingMessage = messagesById.get(messageId);
      const role = runtimeDisplayMessageRole(item.role);
      if (!role) {
        return [];
      }
      if (item.thinking && item.thinking.trim().length > 0) {
        entries.push({
          id: `${item.id}:thinking`,
          kind: "runtime-thinking",
          createdAt: item.createdAt,
          message: item,
        });
      }
      if (!shouldMaterializeRuntimeMessageText(item, existingMessage)) {
        return entries;
      }
      entries.push({
        id: timelineMessageEntryId(messageId),
        kind: "message",
        createdAt: item.createdAt,
        message:
          existingMessage ??
          ({
            id: messageId,
            role,
            text: item.text ?? "",
            turnId: item.turnId ?? null,
            createdAt: item.createdAt,
            completedAt: item.streaming ? undefined : item.createdAt,
            streaming: item.streaming ?? false,
          } satisfies ChatMessage),
      });
      return entries;
    }
    case "custom-message":
      return [{
        id: item.id,
        kind: "custom-message",
        createdAt: item.createdAt,
        customMessage: item,
      }];
    case "tool":
      return [{
        id: item.id,
        kind: "runtime-tool",
        createdAt: item.createdAt,
        tool: item,
      }];
    case "extension-ui-request":
      return [{
        id: item.id,
        kind: "runtime-extension-ui-request",
        createdAt: item.createdAt,
        request: item,
      }];
    case "proposed-plan": {
      const planId = OrchestrationProposedPlanId.make(item.planId);
      return [{
        id: item.id,
        kind: "proposed-plan",
        createdAt: item.createdAt,
        proposedPlan:
          proposedPlansById.get(planId) ??
          ({
            id: planId,
            turnId: item.turnId ?? null,
            planMarkdown: item.planMarkdown,
            implementedAt: null,
            implementationThreadId: null,
            createdAt: item.createdAt,
            updatedAt: item.createdAt,
          } satisfies ProposedPlan),
      }];
    }
  }
}

function shouldMaterializeRuntimeMessageText(
  item: Extract<RuntimeDisplayTimelineItem, { kind: "message" }>,
  existingMessage: ChatMessage | undefined,
): boolean {
  if (existingMessage && existingMessage.text.trim().length > 0) {
    return true;
  }
  if (existingMessage?.richText !== undefined || (existingMessage?.attachments?.length ?? 0) > 0) {
    return true;
  }
  if ((item.text?.trim().length ?? 0) > 0) {
    return true;
  }
  return false;
}

function runtimeDisplayMessageRole(role: string): ChatMessage["role"] | null {
  switch (role) {
    case "user":
    case "assistant":
    case "system":
      return role;
    default:
      return null;
  }
}
