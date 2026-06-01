type TextPart = {
  readonly type: "text";
  readonly text: string;
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

export function extractMessageText(message: unknown): string {
  if (typeof message === "string") {
    return message;
  }
  if (typeof message !== "object" || message === null || !("content" in message)) {
    return "";
  }

  const content = message.content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }

  return content.filter(isTextPart).map((part) => part.text).join("\n");
}

export function toUnknownRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return { ...value };
  }
  return { value };
}
