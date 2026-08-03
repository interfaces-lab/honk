import type {
  Message,
  OpenCodePermissionRequest,
  OpenCodeQuestionRequest,
  Part,
} from "@honk/opencode";

export type ConversationItem =
  | {
      readonly id: string;
      readonly type: "message";
      readonly message: Message;
      readonly parts: readonly Part[];
    }
  | {
      readonly id: string;
      readonly type: "question";
      readonly request: OpenCodeQuestionRequest;
    }
  | {
      readonly id: string;
      readonly type: "permission";
      readonly request: OpenCodePermissionRequest;
    };

export function buildConversationItems({
  messages,
  parts,
  permissions,
  questions,
}: {
  readonly messages: readonly Message[];
  readonly parts: readonly Part[];
  readonly permissions: readonly OpenCodePermissionRequest[];
  readonly questions: readonly OpenCodeQuestionRequest[];
}): readonly ConversationItem[] {
  const partsByMessage = new Map<string, Part[]>();
  for (const part of parts) {
    const grouped = partsByMessage.get(part.messageID) ?? [];
    grouped.push(part);
    partsByMessage.set(part.messageID, grouped);
  }
  return [
    ...messages.map(
      (message): ConversationItem => ({
        id: message.id,
        type: "message",
        message,
        parts: partsByMessage.get(message.id) ?? [],
      }),
    ),
    ...questions.map(
      (request): ConversationItem => ({
        id: `question:${request.id}`,
        type: "question",
        request,
      }),
    ),
    ...permissions.map(
      (request): ConversationItem => ({
        id: `permission:${request.id}`,
        type: "permission",
        request,
      }),
    ),
  ];
}
