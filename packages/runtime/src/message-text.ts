type TextPart = {
  readonly type: "text";
  readonly text: string;
};

type ThinkingPart = {
  readonly type: "thinking";
  readonly thinking: string;
};

function isTextPart(value: unknown): value is TextPart {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "text" &&
    "text" in value &&
    typeof value.text === "string"
  );
}

function isThinkingPart(value: unknown): value is ThinkingPart {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "thinking" &&
    "thinking" in value &&
    typeof value.thinking === "string"
  );
}

function messageContent(message: unknown): unknown {
  if (typeof message === "string") {
    return message;
  }
  if (typeof message !== "object" || message === null || !("content" in message)) {
    return undefined;
  }
  return message.content;
}

function messageErrorMessage(message: unknown): string {
  if (typeof message !== "object" || message === null || !("errorMessage" in message)) {
    return "";
  }
  return typeof message.errorMessage === "string" ? message.errorMessage.trim() : "";
}

export function extractMessageText(message: unknown): string {
  const content = messageContent(message);
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .filter(isTextPart)
    .map((part) => part.text)
    .join("\n");
}

export function extractMessageErrorText(message: unknown): string {
  const errorMessage = messageErrorMessage(message);
  return errorMessage ? `Provider error: ${errorMessage}` : "";
}

export function extractMessageThinking(message: unknown): string {
  const content = messageContent(message);
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .filter(isThinkingPart)
    .map((part) => part.thinking)
    .join("\n");
}

export function toUnknownRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return { ...value };
  }
  return { value };
}
