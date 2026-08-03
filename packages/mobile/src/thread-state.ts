import type {
  Message,
  OpenCodeEvent,
  OpenCodePermissionRequest,
  OpenCodeQuestionRequest,
  OpenCodeSessionInfo,
  Part,
} from "@honk/opencode";

import type { ComposerImage } from "./chat-composer";

export interface SessionViewState {
  readonly info: OpenCodeSessionInfo;
  readonly messages: readonly Message[];
  readonly parts: readonly Part[];
  readonly running: boolean;
  readonly questions: readonly OpenCodeQuestionRequest[];
  readonly permissions: readonly OpenCodePermissionRequest[];
}

export function eventSessionID(event: OpenCodeEvent): string | undefined {
  if (typeof event.data !== "object" || event.data === null || Array.isArray(event.data)) {
    return undefined;
  }
  const sessionID = Reflect.get(event.data, "sessionID");
  return typeof sessionID === "string" ? sessionID : undefined;
}

export function applySessionEvent(state: SessionViewState, event: OpenCodeEvent): SessionViewState {
  switch (event.type) {
    case "message.updated": {
      const index = state.messages.findIndex((message) => message.id === event.data.info.id);
      return {
        ...state,
        messages:
          index === -1
            ? [...state.messages, event.data.info]
            : state.messages.map((message, messageIndex) =>
                messageIndex === index ? event.data.info : message,
              ),
      };
    }
    case "message.removed":
      return {
        ...state,
        messages: state.messages.filter((message) => message.id !== event.data.messageID),
        parts: state.parts.filter((part) => part.messageID !== event.data.messageID),
      };
    case "message.part.updated": {
      const index = state.parts.findIndex((part) => part.id === event.data.part.id);
      return {
        ...state,
        parts:
          index === -1
            ? [...state.parts, event.data.part]
            : state.parts.map((part, partIndex) =>
                partIndex === index ? mergePart(part, event.data.part) : part,
              ),
      };
    }
    case "message.part.removed":
      return {
        ...state,
        parts: state.parts.filter((part) => part.id !== event.data.partID),
      };
    case "session.status":
      return { ...state, running: event.data.status.type !== "idle" };
    case "session.idle":
      return { ...state, running: false };
    default:
      return state;
  }
}

export function optimisticTurn(
  info: OpenCodeSessionInfo,
  messageID: string,
  text: string,
  attachments: readonly ComposerImage[],
): { readonly message: Message; readonly parts: readonly Part[] } {
  const created = Date.now();
  const model = info.model ?? { id: "unknown", providerID: "unknown" };
  return {
    message: {
      id: messageID,
      sessionID: info.id,
      role: "user",
      time: { created },
      agent: info.agent ?? "build",
      model: {
        providerID: model.providerID,
        modelID: model.id,
        ...(model.variant === undefined ? {} : { variant: model.variant }),
      },
    },
    parts: [
      ...(text === ""
        ? []
        : [
            {
              id: `${messageID}:text`,
              sessionID: info.id,
              messageID,
              type: "text" as const,
              text,
              time: { start: created, end: created },
            },
          ]),
      ...attachments.map((attachment, index) => ({
        id: `${messageID}:file:${String(index)}`,
        sessionID: info.id,
        messageID,
        type: "file" as const,
        mime: attachment.file.uri.match(/^data:([^;,]+)/)?.[1] ?? "image/jpeg",
        ...(attachment.file.name === undefined ? {} : { filename: attachment.file.name }),
        url: attachment.file.uri,
      })),
    ],
  };
}

function mergePart(existing: Part | undefined, incoming: Part): Part {
  if (
    existing?.type === "text" &&
    incoming.type === "text" &&
    existing.text.length > incoming.text.length
  ) {
    return { ...incoming, text: existing.text };
  }
  if (
    existing?.type === "reasoning" &&
    incoming.type === "reasoning" &&
    existing.text.length > incoming.text.length
  ) {
    return { ...incoming, text: existing.text };
  }
  return incoming;
}
