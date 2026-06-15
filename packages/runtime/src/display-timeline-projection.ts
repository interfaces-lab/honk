import {
  type AgentRuntimeEvent,
  type DesktopExtensionUiRequest,
  type DesktopExtensionUiRequestKind,
  type EventId,
  MessageId,
  type RuntimeDisplayTimelineExtensionUiRequestItem,
  type RuntimeDisplayTimelineItem,
  type RuntimeDisplayTimelineMessageItem,
  type RuntimeDisplayTimelineProjection,
  type RuntimeDisplayTimelineToolDisplay,
  type RuntimeDisplayTimelineToolItem,
  type RuntimeDisplayTimelineToolStatus,
  type RuntimeSessionId,
  type SessionMessageRole,
  type SessionTreeEntry,
  type SessionTreeProjection,
  SubagentToolDetails,
  type ThreadId,
  type TurnId,
} from "@honk/contracts";
import { Option, Schema } from "effect";

import { asRecord } from "./runtime-record";

const decodeSubagentToolDetailsOption = Schema.decodeUnknownOption(SubagentToolDetails);

export interface RuntimeDisplayTimelineProjectionInput {
  readonly threadId: ThreadId;
  readonly runtimeSessionId: RuntimeSessionId;
  readonly sessionTree?: SessionTreeProjection | null | undefined;
  readonly runtimeEvents?: ReadonlyArray<AgentRuntimeEvent> | undefined;
  readonly pendingExtensionUiRequests?: ReadonlyArray<DesktopExtensionUiRequest> | undefined;
}

export interface RuntimeDisplayTimelineEventProjectionInput {
  readonly previousTimeline?: RuntimeDisplayTimelineProjection | null | undefined;
  readonly threadId: ThreadId;
  readonly runtimeSessionId: RuntimeSessionId;
  readonly sessionTree?: SessionTreeProjection | null | undefined;
  readonly event: AgentRuntimeEvent;
  readonly pendingExtensionUiRequests?: ReadonlyArray<DesktopExtensionUiRequest> | undefined;
}

interface MutableMessageItem {
  id: string;
  orderKey: string;
  createdAt: string;
  role: "user" | "assistant" | "system";
  eventIds: EventId[];
  streaming: boolean;
  clientMessageId?: MessageId | undefined;
  turnId?: TurnId | undefined;
  text?: string | undefined;
  thinking?: string | undefined;
}

interface MutableToolItem {
  id: string;
  orderKey: string;
  createdAt: string;
  toolCallId: string;
  toolName: string;
  turnId?: TurnId | undefined;
  status: RuntimeDisplayTimelineToolStatus;
  eventIds: EventId[];
  args?: unknown;
  argsComplete?: boolean | undefined;
  executionStarted?: boolean | undefined;
  isPartial?: boolean | undefined;
  isError?: boolean | undefined;
  result?: unknown;
  details?: unknown;
  summary?: string | undefined;
  shortDescription?: string | undefined;
  display: RuntimeDisplayTimelineToolDisplay;
  command?: string | undefined;
  output?: string | undefined;
}

interface MutableExtensionUiRequestItem {
  id: string;
  orderKey: string;
  createdAt: string;
  requestId: string;
  requestKind: DesktopExtensionUiRequestKind;
  status: "pending" | "resolved";
  threadId: ThreadId;
  runtimeSessionId: RuntimeSessionId;
  eventIds: EventId[];
  title: string;
  message?: string | undefined;
  placeholder?: string | undefined;
  options?: string[] | undefined;
  value?: unknown;
  turnId?: TurnId | undefined;
}

export function projectRuntimeDisplayTimeline(
  input: RuntimeDisplayTimelineProjectionInput,
): RuntimeDisplayTimelineProjection {
  const items: RuntimeDisplayTimelineItem[] = [];
  const committedMessagesByKey = new Map<string, RuntimeDisplayTimelineMessageItem>();
  const activeEntryIds = activeSessionTreeEntryIds(input.sessionTree);
  for (const entry of input.sessionTree?.entries ?? []) {
    if (activeEntryIds && !activeEntryIds.has(entry.id)) {
      continue;
    }
    const item = projectSessionTreeEntry(entry);
    if (item) {
      items.push(item);
      if (item.kind === "message" && item.turnId) {
        committedMessagesByKey.set(messageLifecycleKey(item.turnId, item.role), item);
      }
    }
  }

  for (const item of projectLiveMessageItems(input.runtimeEvents ?? [], committedMessagesByKey)) {
    items.push(item);
  }

  const toolItems = projectToolItems(input.runtimeEvents ?? []);
  for (const item of toolItems) {
    items.push(toRuntimeDisplayTimelineToolItem(item));
  }

  const extensionUiItems = projectExtensionUiRequestItems({
    threadId: input.threadId,
    runtimeSessionId: input.runtimeSessionId,
    runtimeEvents: input.runtimeEvents ?? [],
    pendingExtensionUiRequests: input.pendingExtensionUiRequests ?? [],
  });
  for (const item of extensionUiItems) {
    items.push(toRuntimeDisplayTimelineExtensionUiRequestItem(item));
  }

  for (const event of input.runtimeEvents ?? []) {
    const planItem = projectProposedPlanEvent(event);
    if (planItem) {
      items.push(planItem);
    }
  }

  return {
    threadId: input.threadId,
    runtimeSessionId: input.runtimeSessionId,
    items: mergeRuntimeDisplayTimelineItems([], items),
  };
}

function activeSessionTreeEntryIds(
  sessionTree: SessionTreeProjection | null | undefined,
): ReadonlySet<string> | null {
  if (!sessionTree) {
    return null;
  }
  return new Set(sessionTree.nodes.filter((node) => node.isActivePath).map((node) => node.entryId));
}

export function projectRuntimeDisplayTimelineEvent(
  input: RuntimeDisplayTimelineEventProjectionInput,
): RuntimeDisplayTimelineProjection {
  const previousTimeline =
    input.previousTimeline ??
    projectRuntimeDisplayTimeline({
      threadId: input.threadId,
      runtimeSessionId: input.runtimeSessionId,
      sessionTree: input.sessionTree,
      pendingExtensionUiRequests: input.pendingExtensionUiRequests,
    });
  const eventProjection = projectRuntimeDisplayTimeline({
    threadId: input.threadId,
    runtimeSessionId: input.runtimeSessionId,
    sessionTree: input.sessionTree,
    runtimeEvents: [input.event],
  });
  const eventItems = eventProjection.items
    .filter((item) => runtimeDisplayTimelineItemCameFromEvent(item, input.event))
    .map((item) =>
      normalizeIncrementalRuntimeDisplayTimelineEventItem(previousTimeline, item, input.event),
    );
  if (eventItems.length === 0) {
    return previousTimeline;
  }
  return {
    threadId: previousTimeline.threadId,
    runtimeSessionId: previousTimeline.runtimeSessionId,
    items: mergeRuntimeDisplayTimelineItems(previousTimeline.items, eventItems),
  };
}

function normalizeIncrementalRuntimeDisplayTimelineEventItem(
  previousTimeline: RuntimeDisplayTimelineProjection,
  item: RuntimeDisplayTimelineItem,
  event: AgentRuntimeEvent,
): RuntimeDisplayTimelineItem {
  if (item.kind !== "message" || !event.turnId) {
    return item;
  }
  const roleKey = messageLifecycleKey(event.turnId, item.role);
  const itemId = incrementalMessageItemIdForEvent(previousTimeline.items, roleKey, event);
  if (itemId === item.id) {
    return item;
  }
  return {
    ...item,
    id: itemId,
    orderKey: buildOrderKey(item.createdAt, itemId),
  };
}

function incrementalMessageItemIdForEvent(
  previousItems: ReadonlyArray<RuntimeDisplayTimelineItem>,
  roleKey: string,
  event: AgentRuntimeEvent,
): string {
  const baseId = `message:${roleKey}`;
  const eventClientMessageId = liveMessageClientMessageId(event);
  const eventClientMessageItemId =
    event.messageRole === "user" && eventClientMessageId !== undefined
      ? messageItemIdForClientMessageId(eventClientMessageId)
      : null;
  const existingMessageItems = previousItems.filter(
    (item): item is RuntimeDisplayTimelineMessageItem =>
      item.kind === "message" &&
      (item.id === baseId ||
        item.id.startsWith(`${baseId}:`) ||
        (item.turnId !== undefined && messageLifecycleKey(item.turnId, item.role) === roleKey)),
  );
  const activeMessageItem = existingMessageItems.find((item) => item.streaming);
  if (event.type !== "message.started" && activeMessageItem) {
    return activeMessageItem.id;
  }
  if (event.type === "message.started" && activeMessageItem) {
    return activeMessageItem.id;
  }
  if (eventClientMessageItemId) {
    return eventClientMessageItemId;
  }
  const promptUserMessageItem = existingPromptUserMessageItemForEvent(existingMessageItems, event);
  if (promptUserMessageItem) {
    return promptUserMessageItem.id;
  }
  if (event.type !== "message.started" && existingMessageItems.length === 0) {
    return baseId;
  }
  if (event.type !== "message.started" && activeMessageItem === undefined) {
    return nextMessageLifecycleItemId(baseId, existingMessageItems);
  }
  if (activeMessageItem) {
    return activeMessageItem.id;
  }
  return nextMessageLifecycleItemId(baseId, existingMessageItems);
}

function nextMessageLifecycleItemId(
  baseId: string,
  existingItems: ReadonlyArray<RuntimeDisplayTimelineItem>,
): string {
  if (existingItems.length === 0) {
    return baseId;
  }
  let maxIndex = 1;
  for (const item of existingItems) {
    if (item.id === baseId) {
      maxIndex = Math.max(maxIndex, 1);
      continue;
    }
    const suffix = item.id.slice(baseId.length + 1);
    const parsed = Number.parseInt(suffix, 10);
    if (Number.isFinite(parsed)) {
      maxIndex = Math.max(maxIndex, parsed);
    }
  }
  return `${baseId}:${maxIndex + 1}`;
}

function runtimeDisplayTimelineItemCameFromEvent(
  item: RuntimeDisplayTimelineItem,
  event: AgentRuntimeEvent,
): boolean {
  if (item.kind === "proposed-plan") {
    return event.type === "turn.proposed.completed";
  }
  return "eventIds" in item && item.eventIds.includes(event.id);
}

function mergeRuntimeDisplayTimelineItems(
  previousItems: ReadonlyArray<RuntimeDisplayTimelineItem>,
  eventItems: ReadonlyArray<RuntimeDisplayTimelineItem>,
): RuntimeDisplayTimelineItem[] {
  const itemsById = new Map(previousItems.map((item) => [item.id, item] as const));
  for (const eventItem of eventItems) {
    const previousItem = itemsById.get(eventItem.id);
    itemsById.set(
      eventItem.id,
      previousItem ? mergeRuntimeDisplayTimelineItem(previousItem, eventItem) : eventItem,
    );
  }
  return [...itemsById.values()].toSorted((left, right) =>
    left.orderKey.localeCompare(right.orderKey),
  );
}

function mergeRuntimeDisplayTimelineItem(
  previousItem: RuntimeDisplayTimelineItem,
  eventItem: RuntimeDisplayTimelineItem,
): RuntimeDisplayTimelineItem {
  if (previousItem.kind !== eventItem.kind) {
    return eventItem;
  }
  switch (eventItem.kind) {
    case "message":
      return previousItem.kind === "message"
        ? {
            ...previousItem,
            ...eventItem,
            orderKey: previousItem.orderKey,
            createdAt: previousItem.createdAt,
            eventIds: mergeEventIds(previousItem.eventIds, eventItem.eventIds),
            text: eventItem.text ?? previousItem.text,
            thinking: eventItem.thinking ?? previousItem.thinking,
            clientMessageId: eventItem.clientMessageId ?? previousItem.clientMessageId,
          }
        : eventItem;
    case "tool":
      if (previousItem.kind !== "tool") {
        return eventItem;
      }
      return refreshRuntimeToolItemDisplay({
        ...previousItem,
        ...eventItem,
        orderKey: previousItem.orderKey,
        createdAt: previousItem.createdAt,
        status: mergeToolStatus(previousItem.status, eventItem.status),
        eventIds: mergeEventIds(previousItem.eventIds, eventItem.eventIds),
        args: eventItem.args ?? previousItem.args,
        result: eventItem.result ?? previousItem.result,
        details: eventItem.details ?? previousItem.details,
        summary: eventItem.summary ?? previousItem.summary,
        shortDescription: eventItem.shortDescription ?? previousItem.shortDescription,
        command: eventItem.command ?? previousItem.command,
        output: mergeToolOutput(
          previousItem.output,
          eventItem.output,
          eventItem.isPartial === true,
        ),
        isError: previousItem.isError === true || eventItem.isError === true,
      });
    case "extension-ui-request":
      return previousItem.kind === "extension-ui-request"
        ? {
            ...previousItem,
            ...eventItem,
            orderKey: previousItem.orderKey,
            createdAt: previousItem.createdAt,
            eventIds: mergeEventIds(previousItem.eventIds, eventItem.eventIds),
            message: eventItem.message ?? previousItem.message,
            placeholder: eventItem.placeholder ?? previousItem.placeholder,
            options: eventItem.options ?? previousItem.options,
            value: eventItem.value ?? previousItem.value,
          }
        : eventItem;
    case "proposed-plan":
      return eventItem;
  }
}

function mergeEventIds(left: ReadonlyArray<EventId>, right: ReadonlyArray<EventId>): EventId[] {
  const result = [...left];
  const seen = new Set(left);
  for (const eventId of right) {
    if (!seen.has(eventId)) {
      seen.add(eventId);
      result.push(eventId);
    }
  }
  return result;
}

function projectSessionTreeEntry(entry: SessionTreeEntry): RuntimeDisplayTimelineItem | null {
  if (entry.kind !== "message" || !entry.role) {
    return null;
  }
  const role = runtimeDisplayMessageRole(entry.role);
  if (!role) {
    return null;
  }
  const id =
    role === "user" && entry.clientMessageId
      ? messageItemIdForClientMessageId(entry.clientMessageId)
      : `message:${entry.id}`;
  return {
    id,
    kind: "message",
    source: "session-entry",
    orderKey: buildOrderKey(entry.createdAt, id),
    createdAt: entry.createdAt,
    entryId: entry.id,
    threadEntryId: entry.threadEntryId,
    parentEntryId: entry.parentId,
    parentThreadEntryId: entry.parentThreadEntryId,
    role,
    ...(entry.turnId ? { turnId: entry.turnId } : {}),
    ...(entry.clientMessageId ? { clientMessageId: entry.clientMessageId } : {}),
    eventIds: [],
    streaming: false,
    ...(entry.text !== undefined ? { text: entry.text } : {}),
    ...(entry.thinking !== undefined ? { thinking: entry.thinking } : {}),
  };
}

function projectLiveMessageItems(
  events: ReadonlyArray<AgentRuntimeEvent>,
  committedMessagesByKey: ReadonlyMap<string, RuntimeDisplayTimelineMessageItem>,
): RuntimeDisplayTimelineItem[] {
  const itemsByKey = new Map<string, MutableMessageItem>();
  const activeKeyByRole = new Map<string, string>();
  const nextIndexByRole = new Map<string, number>();
  const promptUserClientMessageIdByRole = new Map<string, MessageId>();
  for (const event of events) {
    if (
      event.type !== "message.started" &&
      event.type !== "message.updated" &&
      event.type !== "message.completed"
    ) {
      continue;
    }
    const role = runtimeDisplayMessageRole(event.messageRole);
    if (!role || !event.turnId) {
      continue;
    }
    const roleKey = messageLifecycleKey(event.turnId, role);
    const committedMessage = committedMessagesByKey.get(roleKey);
    if (committedMessage && role !== "user") {
      continue;
    }
    if (committedMessage && committedMessageCoversLiveMessageEvent(committedMessage, event)) {
      continue;
    }
    const clientMessageId = liveMessageClientMessageId(event);
    const key = liveMessageEventLifecycleKey({
      event,
      roleKey,
      clientMessageId,
      activeKeyByRole,
      nextIndexByRole,
      promptUserClientMessageIdByRole,
    });
    const text = event.text;
    const thinking = event.thinking;
    if (!text && !thinking && event.type !== "message.started") {
      continue;
    }
    const previous = itemsByKey.get(key);
    if (!previous) {
      const id =
        role === "user" && clientMessageId
          ? messageItemIdForClientMessageId(clientMessageId)
          : `message:${key}`;
      itemsByKey.set(key, {
        id,
        orderKey: buildOrderKey(event.createdAt, id),
        createdAt: event.createdAt,
        role,
        eventIds: [event.id],
        streaming: event.type !== "message.completed",
        ...(clientMessageId ? { clientMessageId } : {}),
        turnId: event.turnId,
        ...(text !== undefined ? { text } : {}),
        ...(thinking !== undefined ? { thinking } : {}),
      });
      continue;
    }
    previous.eventIds.push(event.id);
    previous.streaming = event.type !== "message.completed";
    if (text !== undefined) {
      previous.text = text;
    }
    if (clientMessageId) {
      previous.clientMessageId = clientMessageId;
    }
    if (thinking !== undefined) {
      previous.thinking = thinking;
    }
  }

  return [...itemsByKey.values()].map((item) => ({
    id: item.id,
    kind: "message",
    source: "live-event",
    orderKey: item.orderKey,
    createdAt: item.createdAt,
    role: item.role,
    ...(item.turnId ? { turnId: item.turnId } : {}),
    ...(item.clientMessageId ? { clientMessageId: item.clientMessageId } : {}),
    eventIds: item.eventIds,
    streaming: item.streaming,
    ...(item.text !== undefined ? { text: item.text } : {}),
    ...(item.thinking !== undefined ? { thinking: item.thinking } : {}),
  }));
}

function committedMessageCoversLiveMessageEvent(
  committedMessage: RuntimeDisplayTimelineMessageItem,
  event: AgentRuntimeEvent,
): boolean {
  const eventClientMessageId = liveMessageClientMessageId(event);
  if (
    event.messageRole === "user" &&
    eventClientMessageId !== undefined &&
    committedMessage.clientMessageId !== eventClientMessageId
  ) {
    return false;
  }

  const text = event.text?.trim();
  const thinking = event.thinking?.trim();
  if (text && !committedTextCoversLiveFragment(committedMessage.text, text)) {
    return false;
  }
  if (thinking && !committedTextCoversLiveFragment(committedMessage.thinking, thinking)) {
    return false;
  }
  if (!text && !thinking) {
    return Boolean(committedMessage.text?.trim() || committedMessage.thinking?.trim());
  }
  return true;
}

function committedTextCoversLiveFragment(
  committedText: string | undefined,
  liveFragment: string,
): boolean {
  const committed = committedText?.trim();
  if (!committed) {
    return false;
  }
  return committed === liveFragment || committed.startsWith(liveFragment);
}

function messageItemIdForClientMessageId(clientMessageId: MessageId): string {
  return `message:${clientMessageId}`;
}

function liveMessageEventLifecycleKey(input: {
  readonly event: AgentRuntimeEvent;
  readonly roleKey: string;
  readonly clientMessageId?: MessageId | undefined;
  readonly activeKeyByRole: Map<string, string>;
  readonly nextIndexByRole: Map<string, number>;
  readonly promptUserClientMessageIdByRole: Map<string, MessageId>;
}): string {
  const activeKey = input.activeKeyByRole.get(input.roleKey);
  if (input.event.type !== "message.started" && activeKey) {
    if (input.event.type === "message.completed") {
      input.activeKeyByRole.delete(input.roleKey);
    }
    return activeKey;
  }

  const promptUserClientMessageId = input.clientMessageId;
  if (
    input.event.type === "message.completed" &&
    input.event.messageRole === "user" &&
    promptUserClientMessageId !== undefined
  ) {
    const existingClientMessageId = input.promptUserClientMessageIdByRole.get(input.roleKey);
    if (!existingClientMessageId) {
      input.promptUserClientMessageIdByRole.set(input.roleKey, promptUserClientMessageId);
      return input.roleKey;
    }
    if (existingClientMessageId === promptUserClientMessageId) {
      return input.roleKey;
    }
    input.nextIndexByRole.set(
      input.roleKey,
      Math.max(input.nextIndexByRole.get(input.roleKey) ?? 0, 1),
    );
  }

  const messageIndex = input.nextIndexByRole.get(input.roleKey) ?? 0;
  input.nextIndexByRole.set(input.roleKey, messageIndex + 1);
  const key = messageIndex === 0 ? input.roleKey : `${input.roleKey}:${messageIndex + 1}`;
  if (input.event.type !== "message.completed") {
    input.activeKeyByRole.set(input.roleKey, key);
  }
  return key;
}

function liveMessageClientMessageId(event: AgentRuntimeEvent): MessageId | undefined {
  const data = asRecord(event.data);
  const clientMessageId = asTrimmedString(data?.clientMessageId);
  return clientMessageId ? MessageId.make(clientMessageId) : undefined;
}

function existingPromptUserMessageItemForEvent(
  items: ReadonlyArray<RuntimeDisplayTimelineMessageItem>,
  event: AgentRuntimeEvent,
): RuntimeDisplayTimelineMessageItem | undefined {
  if (event.messageRole !== "user") {
    return undefined;
  }
  const eventClientMessageId = liveMessageClientMessageId(event);
  return items.find(
    (item) =>
      item.role === "user" &&
      item.clientMessageId !== undefined &&
      (eventClientMessageId === undefined || item.clientMessageId === eventClientMessageId),
  );
}

function messageLifecycleKey(turnId: TurnId, role: SessionMessageRole): string {
  return `${turnId}:${role}`;
}

function runtimeDisplayMessageRole(
  role: SessionMessageRole | undefined,
): "user" | "assistant" | "system" | null {
  switch (role) {
    case "user":
    case "assistant":
    case "system":
      return role;
    default:
      return null;
  }
}

function projectToolItems(events: ReadonlyArray<AgentRuntimeEvent>): MutableToolItem[] {
  const itemsByKey = new Map<string, MutableToolItem>();
  for (const event of events) {
    if (
      event.type !== "tool.started" &&
      event.type !== "tool.updated" &&
      event.type !== "tool.completed"
    ) {
      continue;
    }
    const data = asRecord(event.data);
    const toolCallId = asTrimmedString(data?.toolCallId);
    const toolName = asTrimmedString(data?.toolName);
    if (!toolCallId || !toolName) {
      continue;
    }
    const key = toolKey(toolCallId);
    const nextStatus = toolStatusForEvent(event, data);
    const result = toolEventResult(data);
    const details = extractDetails(data);
    const command = extractToolCommand(data?.args, result, details, data);
    const output = extractToolOutput(result);
    const shortDescription = extractToolShortDescription(data?.args);
    const outputIsDelta =
      event.type === "tool.updated" &&
      data?.partialResult !== undefined &&
      data?.result === undefined;
    const previous = itemsByKey.get(key);
    if (!previous) {
      const item = refreshMutableToolDisplay({
        id: `tool:${toolCallId}`,
        orderKey: buildOrderKey(event.createdAt, `tool:${toolCallId}`),
        createdAt: event.createdAt,
        toolCallId,
        toolName,
        ...(event.turnId ? { turnId: event.turnId } : {}),
        status: nextStatus,
        eventIds: [event.id],
        ...(data?.args !== undefined ? { args: data.args } : {}),
        ...(result !== undefined ? { result } : {}),
        ...(details !== undefined ? { details } : {}),
        ...(event.summary !== undefined ? { summary: event.summary } : {}),
        ...(shortDescription !== undefined ? { shortDescription } : {}),
        ...(command !== undefined ? { command } : {}),
        ...(output !== undefined ? { output } : {}),
        executionStarted: true,
        argsComplete: event.type !== "tool.started",
        isPartial: event.type === "tool.updated",
        isError: data?.isError === true,
      });
      itemsByKey.set(key, item);
      continue;
    }
    previous.eventIds.push(event.id);
    previous.status = mergeToolStatus(previous.status, nextStatus);
    previous.toolName = toolName;
    if (data?.args !== undefined) {
      previous.args = data.args;
    }
    if (result !== undefined) {
      previous.result = result;
    }
    if (command !== undefined) {
      previous.command = command;
    }
    if (output !== undefined) {
      previous.output = mergeToolOutput(previous.output, output, outputIsDelta);
    }
    if (details !== undefined) {
      previous.details = details;
    }
    if (event.summary !== undefined) {
      previous.summary = event.summary;
    }
    if (data?.args !== undefined) {
      previous.shortDescription = shortDescription;
    }
    previous.executionStarted = true;
    if (event.type === "tool.updated" || event.type === "tool.completed") {
      previous.argsComplete = true;
    }
    previous.isPartial = event.type === "tool.updated";
    previous.isError = previous.isError === true || data?.isError === true;
    itemsByKey.set(key, refreshMutableToolDisplay(previous));
  }
  return [...itemsByKey.values()];
}

function toRuntimeDisplayTimelineToolItem(item: MutableToolItem): RuntimeDisplayTimelineToolItem {
  return {
    id: item.id,
    kind: "tool",
    orderKey: item.orderKey,
    createdAt: item.createdAt,
    toolCallId: item.toolCallId,
    toolName: item.toolName,
    ...(item.turnId ? { turnId: item.turnId } : {}),
    status: item.status,
    eventIds: item.eventIds,
    ...(item.args !== undefined ? { args: item.args } : {}),
    ...(item.argsComplete !== undefined ? { argsComplete: item.argsComplete } : {}),
    ...(item.executionStarted !== undefined ? { executionStarted: item.executionStarted } : {}),
    ...(item.isPartial !== undefined ? { isPartial: item.isPartial } : {}),
    ...(item.isError !== undefined ? { isError: item.isError } : {}),
    ...(item.result !== undefined ? { result: item.result } : {}),
    ...(item.details !== undefined ? { details: item.details } : {}),
    ...(item.summary !== undefined ? { summary: item.summary } : {}),
    ...(item.shortDescription !== undefined ? { shortDescription: item.shortDescription } : {}),
    display: item.display,
    ...(item.command !== undefined ? { command: item.command } : {}),
    ...(item.output !== undefined ? { output: item.output } : {}),
  };
}

function projectExtensionUiRequestItems(input: {
  readonly threadId: ThreadId;
  readonly runtimeSessionId: RuntimeSessionId;
  readonly runtimeEvents: ReadonlyArray<AgentRuntimeEvent>;
  readonly pendingExtensionUiRequests: ReadonlyArray<DesktopExtensionUiRequest>;
}): MutableExtensionUiRequestItem[] {
  const itemsByRequestId = new Map<string, MutableExtensionUiRequestItem>();
  for (const request of input.pendingExtensionUiRequests) {
    itemsByRequestId.set(request.id, {
      id: `extension-ui:${request.id}`,
      orderKey: buildOrderKey(request.createdAt, `extension-ui:${request.id}`),
      createdAt: request.createdAt,
      requestId: request.id,
      requestKind: request.kind,
      status: "pending",
      threadId: request.threadId,
      runtimeSessionId: request.runtimeSessionId,
      eventIds: [],
      title: request.title,
      ...(request.message !== undefined ? { message: request.message } : {}),
      ...(request.placeholder !== undefined ? { placeholder: request.placeholder } : {}),
      ...(request.options !== undefined ? { options: [...request.options] } : {}),
    });
  }

  for (const event of input.runtimeEvents) {
    if (event.type !== "extension-ui.requested" && event.type !== "extension-ui.resolved") {
      continue;
    }
    const data = asRecord(event.data);
    const requestId = asTrimmedString(data?.requestId);
    const requestKind = asDesktopExtensionUiRequestKind(data?.requestKind);
    const title = asTrimmedString(data?.title);
    if (!requestId || !requestKind || !title) {
      continue;
    }
    const message = asOptionalString(data?.message ?? data?.detail);
    const placeholder = asOptionalString(data?.placeholder);
    const options = asStringArray(data?.options);
    const previous = itemsByRequestId.get(requestId);
    if (!previous) {
      itemsByRequestId.set(requestId, {
        id: `extension-ui:${requestId}`,
        orderKey: buildOrderKey(event.createdAt, `extension-ui:${requestId}`),
        createdAt: event.createdAt,
        requestId,
        requestKind,
        status: event.type === "extension-ui.resolved" ? "resolved" : "pending",
        threadId: event.threadId,
        runtimeSessionId: event.runtimeSessionId,
        eventIds: [event.id],
        title,
        ...(message !== undefined ? { message } : {}),
        ...(placeholder !== undefined ? { placeholder } : {}),
        ...(options ? { options } : {}),
        ...(data?.value !== undefined ? { value: data.value } : {}),
        ...(event.turnId ? { turnId: event.turnId } : {}),
      });
      continue;
    }
    previous.eventIds.push(event.id);
    previous.requestKind = requestKind;
    previous.title = title;
    previous.status = event.type === "extension-ui.resolved" ? "resolved" : previous.status;
    if (data?.value !== undefined) {
      previous.value = data.value;
    }
    if (message !== undefined) {
      previous.message = message;
    }
    if (placeholder !== undefined) {
      previous.placeholder = placeholder;
    }
    if (options) {
      previous.options = options;
    }
    if (event.turnId) {
      previous.turnId = event.turnId;
    }
  }
  return [...itemsByRequestId.values()];
}

function toRuntimeDisplayTimelineExtensionUiRequestItem(
  item: MutableExtensionUiRequestItem,
): RuntimeDisplayTimelineExtensionUiRequestItem {
  return {
    id: item.id,
    kind: "extension-ui-request",
    orderKey: item.orderKey,
    createdAt: item.createdAt,
    requestId: item.requestId,
    requestKind: item.requestKind,
    status: item.status,
    threadId: item.threadId,
    runtimeSessionId: item.runtimeSessionId,
    eventIds: item.eventIds,
    title: item.title,
    ...(item.message !== undefined ? { message: item.message } : {}),
    ...(item.placeholder !== undefined ? { placeholder: item.placeholder } : {}),
    ...(item.options !== undefined ? { options: item.options } : {}),
    ...(item.value !== undefined ? { value: item.value } : {}),
    ...(item.turnId ? { turnId: item.turnId } : {}),
  };
}

function projectProposedPlanEvent(event: AgentRuntimeEvent): RuntimeDisplayTimelineItem | null {
  if (event.type !== "turn.proposed.completed") {
    return null;
  }
  const data = asRecord(event.data);
  const planId = asTrimmedString(data?.planId);
  const planMarkdown = typeof data?.planMarkdown === "string" ? data.planMarkdown : null;
  if (!planId || planMarkdown === null) {
    return null;
  }
  return {
    id: `proposed-plan:${planId}`,
    kind: "proposed-plan",
    orderKey: buildOrderKey(event.createdAt, `proposed-plan:${planId}`),
    createdAt: event.createdAt,
    planId,
    ...(event.turnId ? { turnId: event.turnId } : {}),
    planMarkdown,
    ...(event.summary !== undefined ? { summary: event.summary } : {}),
  };
}

function toolStatusForEvent(
  event: AgentRuntimeEvent,
  data: Record<string, unknown> | null,
): RuntimeDisplayTimelineToolStatus {
  if (event.type === "tool.completed") {
    return data?.isError === true ? "error" : "completed";
  }
  return data?.isError === true ? "error" : "running";
}

function mergeToolStatus(
  previous: RuntimeDisplayTimelineToolStatus,
  next: RuntimeDisplayTimelineToolStatus,
): RuntimeDisplayTimelineToolStatus {
  if (previous === "error" || next === "error") {
    return "error";
  }
  if (previous === "completed" || next === "completed") {
    return "completed";
  }
  return "running";
}

function toolKey(toolCallId: string): string {
  return toolCallId;
}

function refreshRuntimeToolItemDisplay(
  item: RuntimeDisplayTimelineToolItem,
): RuntimeDisplayTimelineToolItem {
  return {
    ...item,
    display: projectRuntimeToolDisplay({
      toolName: item.toolName,
      args: item.args,
      result: item.result,
      details: item.details,
      command: item.command,
      output: item.output,
    }),
  };
}

function refreshMutableToolDisplay(
  item: Omit<MutableToolItem, "display"> & {
    display?: RuntimeDisplayTimelineToolDisplay | undefined;
  },
): MutableToolItem {
  return {
    ...item,
    display: projectRuntimeToolDisplay({
      toolName: item.toolName,
      args: item.args,
      result: item.result,
      details: item.details,
      command: item.command,
      output: item.output,
    }),
  };
}

function extractDetails(data: Record<string, unknown> | null): unknown {
  const result = asRecord(toolEventResult(data));
  return result && "details" in result ? result.details : undefined;
}

function toolEventResult(data: Record<string, unknown> | null): unknown {
  if (!data) {
    return undefined;
  }
  return data.result ?? data.partialResult;
}

function extractToolCommand(
  args: unknown,
  result?: unknown,
  details?: unknown,
  eventData?: Record<string, unknown> | null,
): string | undefined {
  return (
    firstTrimmedRecordString(args, ["command", "cmd", "rawCommand", "raw_command", "input"]) ??
    firstTrimmedRecordString(eventData, ["command", "cmd", "rawCommand", "raw_command"]) ??
    firstTrimmedRecordString(details, ["command", "cmd", "rawCommand", "raw_command"]) ??
    firstTrimmedRecordString(result, ["command", "cmd", "rawCommand", "raw_command"]) ??
    firstTrimmedRecordString(asRecord(result)?.details, [
      "command",
      "cmd",
      "rawCommand",
      "raw_command",
    ])
  );
}

function extractToolOutput(value: unknown): string | undefined {
  if (typeof value === "string") {
    return asTrimmedString(value) ?? undefined;
  }
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const content = record.content;
  if (Array.isArray(content)) {
    const text = content
      .flatMap((entry) => {
        const contentRecord = asRecord(entry);
        return contentRecord?.type === "text" && typeof contentRecord.text === "string"
          ? [contentRecord.text]
          : [];
      })
      .join("\n")
      .trim();
    return text.length > 0 ? text : undefined;
  }
  return asTrimmedString(record.text) ?? undefined;
}

const MAX_TOOL_SHORT_DESCRIPTION_LENGTH = 160;

function extractToolShortDescription(args: unknown): string | undefined {
  const description = firstTrimmedRecordString(args, ["description"]);
  if (description === undefined) {
    return undefined;
  }
  const normalized = description.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) {
    return undefined;
  }
  if (normalized.length <= MAX_TOOL_SHORT_DESCRIPTION_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_TOOL_SHORT_DESCRIPTION_LENGTH - 1)}…`;
}

function projectRuntimeToolDisplay(input: {
  readonly toolName: string;
  readonly args: unknown;
  readonly result: unknown;
  readonly details: unknown;
  readonly command?: string | undefined;
  readonly output: string | undefined;
}): RuntimeDisplayTimelineToolDisplay {
  const toolName = input.toolName.trim();
  const normalizedToolName = normalizeToolName(toolName);
  const subagentDetails = extractSubagentToolDetails(input.details);
  if (subagentDetails) {
    return {
      kind: "subagent",
      mode: subagentDetails.mode,
      runs: subagentDetails.runs,
      activities: subagentDetails.activities,
    };
  }
  if (isBashToolName(normalizedToolName)) {
    const command = input.command ?? extractToolCommand(input.args, input.result, input.details);
    const exitCode = extractExitCode(input.result, input.details);
    return {
      kind: "bash",
      ...(command !== undefined ? { command } : {}),
      ...(input.output !== undefined ? { output: input.output } : {}),
      ...(exitCode !== undefined ? { exitCode } : {}),
    };
  }
  if (isReadToolName(normalizedToolName)) {
    const path = extractToolPath(input.args);
    const startLine = extractLineNumber(input.args, ["startLine", "start_line", "offset"]);
    const explicitEndLine = extractLineNumber(input.args, ["endLine", "end_line"]);
    const limit = extractLineNumber(input.args, ["limit"]);
    const endLine =
      explicitEndLine ??
      (startLine !== undefined && limit !== undefined && limit > 0
        ? startLine + limit - 1
        : undefined);
    return {
      kind: "read",
      ...(path !== undefined ? { path } : {}),
      ...(input.output !== undefined ? { output: input.output } : {}),
      ...(startLine !== undefined ? { startLine } : {}),
      ...(endLine !== undefined ? { endLine } : {}),
    };
  }
  if (isGrepToolName(normalizedToolName)) {
    const query = extractSearchQuery(input.args);
    const path = extractToolPath(input.args);
    const matchedFiles = extractMatchedFiles(input.result, input.details);
    const searchCounts = extractSearchCounts(input.result, input.details);
    return {
      kind: "grep",
      ...(query !== undefined ? { query } : {}),
      ...(path !== undefined ? { path } : {}),
      ...(input.output !== undefined ? { output: input.output } : {}),
      ...(matchedFiles !== undefined ? { matchedFiles } : {}),
      ...(searchCounts.totalMatched !== undefined
        ? { totalMatched: searchCounts.totalMatched }
        : {}),
      ...(searchCounts.totalIndexedFiles !== undefined
        ? { totalIndexedFiles: searchCounts.totalIndexedFiles }
        : {}),
    };
  }
  if (isFindToolName(normalizedToolName)) {
    const query = extractSearchQuery(input.args);
    const path = extractToolPath(input.args);
    const searchCounts = extractSearchCounts(input.result, input.details);
    return {
      kind: "find",
      ...(query !== undefined ? { query } : {}),
      ...(path !== undefined ? { path } : {}),
      ...(input.output !== undefined ? { output: input.output } : {}),
      ...(searchCounts.totalMatched !== undefined
        ? { totalMatched: searchCounts.totalMatched }
        : {}),
      ...(searchCounts.totalIndexedFiles !== undefined
        ? { totalIndexedFiles: searchCounts.totalIndexedFiles }
        : {}),
      ...(searchCounts.hasMore !== undefined ? { hasMore: searchCounts.hasMore } : {}),
    };
  }
  if (isEditToolName(normalizedToolName)) {
    const path = extractToolPath(input.args);
    const diff = extractUnifiedEditDiff(input.details);
    const diffStats = diff !== undefined ? countUnifiedDiffStats(diff) : undefined;
    const additions =
      extractNonNegativeNumber(input.details, ["additions", "added", "linesAdded"]) ??
      diffStats?.additions;
    const deletions =
      extractNonNegativeNumber(input.details, ["deletions", "deleted", "linesDeleted"]) ??
      diffStats?.deletions;
    return {
      kind: "edit",
      ...(path !== undefined ? { path } : {}),
      ...(input.output !== undefined ? { output: input.output } : {}),
      ...(additions !== undefined ? { additions } : {}),
      ...(deletions !== undefined ? { deletions } : {}),
      ...(diff !== undefined ? { diff } : {}),
    };
  }
  if (isMcpToolName(normalizedToolName, input.args, input.details)) {
    const providerIdentifier = extractProviderIdentifier(input.args, input.details);
    return {
      kind: "mcp",
      ...(providerIdentifier !== undefined ? { providerIdentifier } : {}),
    };
  }
  return {
    kind: "unknown",
    toolName,
    ...(input.output !== undefined ? { output: input.output } : {}),
  };
}

function mergeToolOutput(
  previous: string | undefined,
  next: string | undefined,
  nextIsDelta: boolean,
): string | undefined {
  if (next === undefined) {
    return previous;
  }
  if (!nextIsDelta || previous === undefined || previous.length === 0) {
    return next;
  }
  if (next.length === 0 || previous.endsWith(next) || next.startsWith(previous)) {
    return next.startsWith(previous) ? next : previous;
  }
  const separator = previous.endsWith("\n") || next.startsWith("\n") ? "" : "\n";
  return `${previous}${separator}${next}`;
}

function normalizeToolName(toolName: string): string {
  return toolName.trim().toLowerCase().replaceAll("-", "_");
}

function isBashToolName(toolName: string): boolean {
  return (
    toolName === "bash" ||
    toolName === "terminal" ||
    toolName === "exec" ||
    toolName === "command" ||
    toolName.includes("command_execution")
  );
}

function isReadToolName(toolName: string): boolean {
  return toolName === "read" || toolName === "read_file" || toolName.includes("read");
}

function isGrepToolName(toolName: string): boolean {
  return (
    toolName === "grep" ||
    toolName === "rg" ||
    toolName === "search" ||
    toolName.includes("grep") ||
    toolName.includes("search")
  );
}

function isFindToolName(toolName: string): boolean {
  return toolName === "find" || toolName === "glob" || toolName.includes("find");
}

function isEditToolName(toolName: string): boolean {
  return (
    toolName === "edit" ||
    toolName === "write" ||
    toolName === "patch" ||
    toolName.includes("edit") ||
    toolName.includes("write") ||
    toolName.includes("patch") ||
    toolName.includes("delete")
  );
}

function isMcpToolName(toolName: string, args: unknown, details: unknown): boolean {
  return (
    toolName.startsWith("mcp") ||
    toolName.includes("__") ||
    extractProviderIdentifier(args, details) !== undefined
  );
}

function extractSubagentToolDetails(value: unknown): SubagentToolDetails | undefined {
  return Option.getOrUndefined(decodeSubagentToolDetailsOption(value));
}

function extractToolPath(args: unknown): string | undefined {
  return firstTrimmedRecordString(args, [
    "path",
    "file",
    "filePath",
    "file_path",
    "targetFile",
    "target_file",
    "relativePath",
    "relative_path",
  ]);
}

function extractSearchQuery(args: unknown): string | undefined {
  return firstTrimmedRecordString(args, [
    "query",
    "pattern",
    "regex",
    "search",
    "searchTerm",
    "search_term",
  ]);
}

function extractProviderIdentifier(args: unknown, details: unknown): string | undefined {
  return (
    firstTrimmedRecordString(args, ["providerIdentifier", "provider", "server", "serverName"]) ??
    firstTrimmedRecordString(details, ["providerIdentifier", "provider", "server", "serverName"])
  );
}

// pi-agent edit results carry `details.patch` as a unified diff; `details.diff` is a
// pretty-printed numbered view in pi-agent but a unified diff in other runtimes, so it is
// only accepted when it actually parses as one.
function extractUnifiedEditDiff(details: unknown): string | undefined {
  const patch = firstTrimmedRecordString(details, ["patch", "unifiedDiff", "udiff"]);
  if (patch !== undefined && isUnifiedDiffText(patch)) {
    return patch;
  }
  const diff = firstTrimmedRecordString(details, ["diff"]);
  if (diff !== undefined && isUnifiedDiffText(diff)) {
    return diff;
  }
  return undefined;
}

function isUnifiedDiffText(text: string): boolean {
  const lines = text.split("\n");
  return (
    lines.some((line) => line.startsWith("--- ")) &&
    lines.some((line) => line.startsWith("+++ ")) &&
    lines.some((line) => line.startsWith("@@"))
  );
}

function countUnifiedDiffStats(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      additions += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      deletions += 1;
    }
  }
  return { additions, deletions };
}

function firstTrimmedRecordString(value: unknown, keys: ReadonlyArray<string>): string | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  for (const key of keys) {
    const stringValue = asTrimmedString(record[key]);
    if (stringValue) {
      return stringValue;
    }
  }
  return undefined;
}

function extractLineNumber(args: unknown, keys: ReadonlyArray<string>): number | undefined {
  return extractNonNegativeNumber(args, keys);
}

function extractExitCode(result: unknown, details: unknown): number | undefined {
  return (
    extractNonNegativeNumber(details, ["exitCode", "exit_code", "code"]) ??
    extractNonNegativeNumber(asRecord(result)?.details, ["exitCode", "exit_code", "code"])
  );
}

function extractSearchCounts(
  result: unknown,
  details: unknown,
): {
  readonly totalMatched: number | undefined;
  readonly totalIndexedFiles: number | undefined;
  readonly hasMore: boolean | undefined;
} {
  return {
    totalMatched:
      extractNonNegativeNumber(details, ["totalMatched"]) ??
      extractNonNegativeNumber(asRecord(result)?.details, ["totalMatched"]) ??
      extractNonNegativeNumber(result, ["totalMatched"]),
    totalIndexedFiles:
      extractNonNegativeNumber(details, ["totalFiles"]) ??
      extractNonNegativeNumber(asRecord(result)?.details, ["totalFiles"]) ??
      extractNonNegativeNumber(result, ["totalFiles"]),
    hasMore:
      extractBoolean(details, ["hasMore"]) ??
      extractBoolean(asRecord(result)?.details, ["hasMore"]) ??
      extractBoolean(result, ["hasMore"]),
  };
}

function extractNonNegativeNumber(value: unknown, keys: ReadonlyArray<string>): number | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  for (const key of keys) {
    const numberValue = record[key];
    if (typeof numberValue === "number" && Number.isInteger(numberValue) && numberValue >= 0) {
      return numberValue;
    }
  }
  return undefined;
}

function extractBoolean(value: unknown, keys: ReadonlyArray<string>): boolean | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  for (const key of keys) {
    const booleanValue = record[key];
    if (typeof booleanValue === "boolean") {
      return booleanValue;
    }
  }
  return undefined;
}

function extractMatchedFiles(result: unknown, details: unknown): string[] | undefined {
  const matchedFiles =
    asStringArray(asRecord(details)?.matchedFiles) ??
    asStringArray(asRecord(result)?.matchedFiles) ??
    asStringArray(asRecord(asRecord(result)?.details)?.matchedFiles);
  return matchedFiles ?? undefined;
}

function buildOrderKey(createdAt: string, tieBreaker: string): string {
  return `${createdAt}:${tieBreaker}`;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const result = value.filter((entry): entry is string => typeof entry === "string");
  return result.length > 0 ? result : null;
}

function asDesktopExtensionUiRequestKind(value: unknown): DesktopExtensionUiRequestKind | null {
  switch (value) {
    case "select":
    case "confirm":
    case "input":
    case "editor":
    case "question":
    case "custom":
      return value;
    default:
      return null;
  }
}
