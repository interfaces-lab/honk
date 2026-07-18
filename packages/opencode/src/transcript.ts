import type {
  FilePart,
  Message,
  Part,
  ReasoningPart,
  SessionMessage as OpenCodeSessionMessage,
  SessionV2Info as OpenCodeSessionInfo,
  TextPart,
  ToolPart,
  ToolState,
} from "@opencode-ai/sdk/v2/client";

type OpenCodePersistedMessage = {
  readonly info: Message;
  readonly parts: readonly Part[];
};

type OpenCodeSessionTranscriptSources = {
  readonly persistedMessages: number;
  readonly projectedMessages: number;
};

type OpenCodeSessionTranscript = {
  readonly info: OpenCodeSessionInfo;
  readonly messages: readonly Message[];
  readonly parts: readonly Part[];
  readonly sources: OpenCodeSessionTranscriptSources;
};

type OpenCodeTranscriptMessageProjection = {
  readonly messages: readonly Message[];
  readonly parts: readonly Part[];
};

function projectOpenCodeTranscriptMessage(
  info: OpenCodeSessionInfo,
  message: OpenCodeSessionMessage,
  parentID: string,
): OpenCodeTranscriptMessageProjection {
  const projected = projectMessages(info, [message], parentID);
  return Object.freeze({
    messages: Object.freeze(projected.messages),
    parts: Object.freeze(projected.parts),
  });
}

function projectOpenCodeTranscript(
  info: OpenCodeSessionInfo,
  persisted: readonly OpenCodePersistedMessage[],
  projected: readonly OpenCodeSessionMessage[],
): OpenCodeSessionTranscript {
  const projectedTranscript = projectMessages(
    info,
    projected,
    findLastPersistedUserMessageID(persisted),
  );
  const messages = new Map<string, Message>();
  const parts = new Map<string, Part>();

  for (const entry of persisted) {
    reconcileMessageInto(messages, entry.info);
    for (const part of entry.parts) reconcilePartInto(parts, part);
  }
  for (const message of projectedTranscript.messages) {
    reconcileMessageInto(messages, message);
  }
  for (const part of projectedTranscript.parts) {
    reconcilePartInto(parts, part);
  }

  const orderedMessages = [...messages.values()].sort(compareMessages);
  const messageOrder = new Map(orderedMessages.map((message, index) => [message.id, index]));
  const orderedParts = [...parts.values()].sort((left, right) => {
    return (
      (messageOrder.get(left.messageID) ?? Number.MAX_SAFE_INTEGER) -
      (messageOrder.get(right.messageID) ?? Number.MAX_SAFE_INTEGER)
    );
  });

  return Object.freeze({
    info,
    messages: Object.freeze(orderedMessages),
    parts: Object.freeze(orderedParts),
    sources: Object.freeze({
      persistedMessages: persisted.length,
      projectedMessages: projected.length,
    }),
  });
}

function reconcileMessageInto(messages: Map<string, Message>, incoming: Message): void {
  const existing = messages.get(incoming.id);
  messages.set(
    incoming.id,
    existing === undefined ? incoming : reconcileMessage(existing, incoming),
  );
}

function reconcileMessage(existing: Message, incoming: Message): Message {
  if (existing.role !== incoming.role) return incoming;
  if (existing.role !== "assistant" || incoming.role !== "assistant") return existing;

  const existingEnd = existing.time.completed;
  const incomingEnd = incoming.time.completed;
  if (incomingEnd !== undefined && (existingEnd === undefined || incomingEnd > existingEnd)) {
    return incoming;
  }
  return existing;
}

function reconcilePartInto(parts: Map<string, Part>, incoming: Part): void {
  const existing = parts.get(incoming.id);
  parts.set(incoming.id, existing === undefined ? incoming : reconcilePart(existing, incoming));
}

function reconcilePart(existing: Part, incoming: Part): Part {
  if (existing.type !== incoming.type) return incoming;
  switch (incoming.type) {
    case "text":
      return existing.type === "text" ? reconcileTextPart(existing, incoming) : incoming;
    case "reasoning":
      return existing.type === "reasoning" ? reconcileReasoningPart(existing, incoming) : incoming;
    case "tool":
      return existing.type === "tool" ? reconcileToolPart(existing, incoming) : incoming;
    case "file":
      return existing.type === "file" ? { ...existing, ...incoming } : incoming;
    default:
      return incoming;
  }
}

function reconcileTextPart(existing: TextPart, incoming: TextPart): TextPart {
  const preferred = preferTextPart(existing, incoming);
  const secondary = preferred === incoming ? existing : incoming;
  const metadata = mergeMetadata(secondary.metadata, preferred.metadata);
  const time =
    existing.time === undefined
      ? incoming.time
      : incoming.time === undefined
        ? existing.time
        : mergePartTime(existing.time, incoming.time);
  return {
    ...secondary,
    ...preferred,
    text: richerText(existing.text, incoming.text, preferred.text),
    ...(metadata === undefined ? {} : { metadata }),
    ...(time === undefined ? {} : { time }),
  };
}

function reconcileReasoningPart(existing: ReasoningPart, incoming: ReasoningPart): ReasoningPart {
  const preferred = preferTextPart(existing, incoming);
  const secondary = preferred === incoming ? existing : incoming;
  const metadata = mergeMetadata(secondary.metadata, preferred.metadata);
  return {
    ...secondary,
    ...preferred,
    text: richerText(existing.text, incoming.text, preferred.text),
    time: mergePartTime(existing.time, incoming.time),
    ...(metadata === undefined ? {} : { metadata }),
  };
}

function preferTextPart<PartType extends TextPart | ReasoningPart>(
  existing: PartType,
  incoming: PartType,
): PartType {
  const existingEnd = existing.time?.end;
  const incomingEnd = incoming.time?.end;
  if (incomingEnd !== undefined && existingEnd === undefined) return incoming;
  if (existingEnd !== undefined && incomingEnd === undefined) return existing;
  if (existingEnd !== undefined && incomingEnd !== undefined) {
    if (incomingEnd > existingEnd) return incoming;
    if (existingEnd > incomingEnd) return existing;
  }
  return incoming.text.length >= existing.text.length ? incoming : existing;
}

function mergePartTime(
  existing: { readonly start: number; readonly end?: number },
  incoming: { readonly start: number; readonly end?: number },
): { readonly start: number; readonly end?: number } {
  const end =
    existing.end === undefined
      ? incoming.end
      : incoming.end === undefined
        ? existing.end
        : Math.max(existing.end, incoming.end);
  return {
    start: Math.min(existing.start, incoming.start),
    ...(end === undefined ? {} : { end }),
  };
}

function reconcileToolPart(existing: ToolPart, incoming: ToolPart): ToolPart {
  const preferred = preferToolPart(existing, incoming);
  const secondary = preferred === incoming ? existing : incoming;
  const metadata = mergeMetadata(secondary.metadata, preferred.metadata);
  return {
    ...secondary,
    ...preferred,
    state: reconcileToolState(secondary.state, preferred.state),
    ...(metadata === undefined ? {} : { metadata }),
  };
}

function preferToolPart(existing: ToolPart, incoming: ToolPart): ToolPart {
  const existingRank = toolStateRank(existing.state);
  const incomingRank = toolStateRank(incoming.state);
  if (incomingRank > existingRank) return incoming;
  if (existingRank > incomingRank) return existing;

  const existingEnd = terminalEnd(existing.state);
  const incomingEnd = terminalEnd(incoming.state);
  if (existingEnd !== undefined && incomingEnd !== undefined && existingEnd > incomingEnd) {
    return existing;
  }
  return incoming;
}

function toolStateRank(state: ToolState): number {
  if (state.status === "pending") return 0;
  if (state.status === "running") return 1;
  return 2;
}

function terminalEnd(state: ToolState): number | undefined {
  return state.status === "completed" || state.status === "error" ? state.time.end : undefined;
}

function reconcileToolState(secondary: ToolState, preferred: ToolState): ToolState {
  const input = { ...secondary.input, ...preferred.input };
  if (preferred.status === "pending") {
    return {
      ...preferred,
      input,
      raw:
        secondary.status === "pending"
          ? richerText(secondary.raw, preferred.raw, preferred.raw)
          : preferred.raw,
    };
  }

  const previousStart =
    secondary.status === "pending" ? preferred.time.start : secondary.time.start;
  const start = Math.min(previousStart, preferred.time.start);
  const metadata = mergeMetadata(toolStateMetadata(secondary), preferred.metadata);
  if (preferred.status === "running") {
    const title = preferred.title ?? (secondary.status === "running" ? secondary.title : undefined);
    return {
      ...preferred,
      input,
      ...(title === undefined ? {} : { title }),
      ...(metadata === undefined ? {} : { metadata }),
      time: { start },
    };
  }
  if (preferred.status === "error") {
    return {
      ...preferred,
      input,
      ...(metadata === undefined ? {} : { metadata }),
      time: { start, end: preferred.time.end },
    };
  }

  const previous = secondary.status === "completed" ? secondary : undefined;
  const attachments = mergeAttachments(previous?.attachments, preferred.attachments);
  const compacted =
    previous?.time.compacted === undefined
      ? preferred.time.compacted
      : preferred.time.compacted === undefined
        ? previous.time.compacted
        : Math.max(previous.time.compacted, preferred.time.compacted);
  return {
    ...preferred,
    input,
    output: richerText(previous?.output ?? "", preferred.output, preferred.output),
    title: preferred.title || previous?.title || "",
    metadata: metadata ?? {},
    time: {
      start,
      end: preferred.time.end,
      ...(compacted === undefined ? {} : { compacted }),
    },
    ...(attachments === undefined ? {} : { attachments }),
  };
}

function toolStateMetadata(state: ToolState): Readonly<Record<string, unknown>> | undefined {
  return state.status === "pending" ? undefined : state.metadata;
}

function mergeAttachments(
  existing: readonly FilePart[] | undefined,
  incoming: readonly FilePart[] | undefined,
): FilePart[] | undefined {
  if (existing === undefined && incoming === undefined) return undefined;
  const result = new Map<string, FilePart>();
  for (const file of existing ?? []) result.set(file.id, file);
  for (const file of incoming ?? []) {
    result.set(file.id, { ...result.get(file.id), ...file });
  }
  return [...result.values()];
}

function mergeMetadata(
  existing: Readonly<Record<string, unknown>> | undefined,
  incoming: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> | undefined {
  if (existing === undefined && incoming === undefined) return undefined;
  return { ...existing, ...incoming };
}

function richerText(existing: string, incoming: string, fallback: string): string {
  if (existing.length > incoming.length) return existing;
  if (incoming.length > existing.length) return incoming;
  return fallback;
}

function findLastPersistedUserMessageID(persisted: readonly OpenCodePersistedMessage[]): string {
  let result = "";
  for (const entry of persisted) {
    if (entry.info.role === "user") result = entry.info.id;
  }
  return result;
}

function compareMessages(left: Message, right: Message): number {
  const timeComparison = left.time.created - right.time.created;
  return timeComparison === 0 ? left.id.localeCompare(right.id) : timeComparison;
}

function projectMessages(
  info: OpenCodeSessionInfo,
  source: readonly OpenCodeSessionMessage[],
  initialParentID: string,
): {
  readonly messages: Message[];
  readonly parts: Part[];
} {
  const messages: Message[] = [];
  const parts: Part[] = [];
  let parentID = initialParentID;

  for (const message of source) {
    if (message.type === "user") {
      const model = info.model ?? { id: "unknown", providerID: "unknown" };
      messages.push({
        id: message.id,
        sessionID: info.id,
        role: "user",
        time: message.time,
        agent: info.agent ?? "build",
        model: {
          providerID: model.providerID,
          modelID: model.id,
          ...(model.variant !== undefined ? { variant: model.variant } : {}),
        },
      });
      parts.push({
        id: `${message.id}:text`,
        sessionID: info.id,
        messageID: message.id,
        type: "text",
        text: message.text,
        time: { start: message.time.created, end: message.time.created },
      });
      for (const [index, file] of (message.files ?? []).entries()) {
        parts.push({
          id: `${message.id}:file:${String(index)}`,
          sessionID: info.id,
          messageID: message.id,
          type: "file",
          mime: file.mime,
          ...(file.name !== undefined ? { filename: file.name } : {}),
          url: file.uri,
        });
      }
      parentID = message.id;
      continue;
    }

    if (message.type === "assistant") {
      messages.push({
        id: message.id,
        sessionID: info.id,
        role: "assistant",
        time: message.time,
        ...(message.error !== undefined
          ? {
              error: {
                name: "UnknownError" as const,
                data: { message: message.error.message },
              },
            }
          : {}),
        parentID,
        modelID: message.model.id,
        providerID: message.model.providerID,
        mode: message.agent,
        agent: message.agent,
        path: {
          cwd: info.location.directory,
          root: info.location.directory,
        },
        cost: message.cost ?? 0,
        tokens: message.tokens ?? emptyTokens(),
        ...(message.model.variant !== undefined ? { variant: message.model.variant } : {}),
        ...(message.finish !== undefined ? { finish: message.finish } : {}),
      });
      for (const content of message.content) {
        if (content.type === "text") {
          parts.push({
            id: content.id,
            sessionID: info.id,
            messageID: message.id,
            type: "text",
            text: content.text,
            time: {
              start: message.time.created,
              ...(message.time.completed !== undefined ? { end: message.time.completed } : {}),
            },
          });
          continue;
        }
        if (content.type === "reasoning") {
          parts.push({
            id: content.id,
            sessionID: info.id,
            messageID: message.id,
            type: "reasoning",
            text: content.text,
            ...(content.providerMetadata === undefined
              ? {}
              : { metadata: content.providerMetadata }),
            time: {
              start: content.time?.created ?? message.time.created,
              ...(content.time?.completed !== undefined ? { end: content.time.completed } : {}),
            },
          });
          continue;
        }
        parts.push(projectToolPart(info.id, message.id, content));
      }
      continue;
    }

    if (message.type === "compaction") {
      const model = info.model ?? { id: "unknown", providerID: "unknown" };
      messages.push({
        id: message.id,
        sessionID: info.id,
        role: "assistant",
        time: message.time,
        parentID,
        modelID: model.id,
        providerID: model.providerID,
        mode: info.agent ?? "build",
        agent: info.agent ?? "build",
        path: {
          cwd: info.location.directory,
          root: info.location.directory,
        },
        cost: 0,
        tokens: emptyTokens(),
      });
      parts.push({
        id: `${message.id}:compaction`,
        sessionID: info.id,
        messageID: message.id,
        type: "compaction",
        auto: message.reason === "auto",
      });
    }
  }

  return { messages, parts };
}

function projectToolPart(
  sessionID: string,
  messageID: string,
  content: Extract<
    Extract<OpenCodeSessionMessage, { readonly type: "assistant" }>["content"][number],
    { readonly type: "tool" }
  >,
): Extract<Part, { readonly type: "tool" }> {
  const common = {
    id: content.id,
    sessionID,
    messageID,
    type: "tool" as const,
    callID: content.id,
    tool: content.name,
  };

  switch (content.state.status) {
    case "pending":
      return {
        ...common,
        state: {
          status: "pending",
          input: parseInput(content.state.input),
          raw: content.state.input,
        },
      };
    case "running":
      return {
        ...common,
        state: {
          status: "running",
          input: content.state.input,
          metadata: content.state.structured,
          time: { start: content.time.ran ?? content.time.created },
        },
      };
    case "completed":
      return {
        ...common,
        state: {
          status: "completed",
          input: content.state.input,
          output: contentText(content.state.content),
          title: content.name,
          metadata: content.state.structured,
          time: {
            start: content.time.ran ?? content.time.created,
            end: content.time.completed ?? content.time.ran ?? content.time.created,
          },
          ...(content.state.attachments !== undefined
            ? {
                attachments: content.state.attachments.map((file, index) => ({
                  id: `${content.id}:attachment:${String(index)}`,
                  sessionID,
                  messageID,
                  type: "file" as const,
                  mime: file.mime,
                  ...(file.name !== undefined ? { filename: file.name } : {}),
                  url: file.uri,
                })),
              }
            : {}),
        },
      };
    case "error":
      return {
        ...common,
        state: {
          status: "error",
          input: content.state.input,
          error: content.state.error.message,
          metadata: content.state.structured,
          time: {
            start: content.time.ran ?? content.time.created,
            end: content.time.completed ?? content.time.ran ?? content.time.created,
          },
        },
      };
  }
}

function parseInput(value: string): Readonly<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? Object.fromEntries(Object.entries(parsed))
      : {};
  } catch {
    return {};
  }
}

function contentText(
  content: readonly (
    | { readonly type: "text"; readonly text: string }
    | { readonly type: "file"; readonly uri: string }
  )[],
): string {
  return content
    .map((item) => (item.type === "text" ? item.text : item.uri))
    .filter((value) => value.length > 0)
    .join("\n");
}

function emptyTokens(): {
  readonly input: number;
  readonly output: number;
  readonly reasoning: number;
  readonly cache: { readonly read: number; readonly write: number };
} {
  return {
    input: 0,
    output: 0,
    reasoning: 0,
    cache: { read: 0, write: 0 },
  };
}

export { projectOpenCodeTranscript, projectOpenCodeTranscriptMessage };
export type {
  OpenCodePersistedMessage,
  OpenCodeSessionTranscript,
  OpenCodeSessionTranscriptSources,
  OpenCodeTranscriptMessageProjection,
};
