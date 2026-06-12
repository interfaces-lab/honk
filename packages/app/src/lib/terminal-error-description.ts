function readRecordField(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  return Reflect.get(value, key);
}

function readNonEmptyStringField(value: unknown, key: string): string | null {
  const field = readRecordField(value, key);
  return typeof field === "string" && field.trim().length > 0 ? field.trim() : null;
}

function pushDistinct(lines: string[], value: string | null): void {
  if (!value || lines.includes(value)) {
    return;
  }
  lines.push(value);
}

function readTerminalErrorField(error: unknown, cause: unknown, key: string): string | null {
  return readNonEmptyStringField(error, key) ?? readNonEmptyStringField(cause, key);
}

export function formatTerminalErrorDescription(error: unknown, fallback: string): string {
  const cause = readRecordField(error, "cause");
  const message =
    readNonEmptyStringField(error, "message") ??
    (error instanceof Error && error.message.trim().length > 0 ? error.message.trim() : null);
  const causeMessage =
    readNonEmptyStringField(cause, "message") ??
    (cause instanceof Error && cause.message.trim().length > 0 ? cause.message.trim() : null);
  const operation = readTerminalErrorField(error, cause, "operation");
  const cwd = readTerminalErrorField(error, cause, "cwd");
  const reason = readTerminalErrorField(error, cause, "reason");
  const threadId = readTerminalErrorField(error, cause, "threadId");
  const terminalId = readTerminalErrorField(error, cause, "terminalId");
  const lines = [message ?? fallback];

  pushDistinct(lines, causeMessage);
  if (operation) {
    lines.push(`Operation: ${operation}`);
  }
  if (cwd) {
    lines.push(`Directory: ${cwd}`);
  }
  if (reason) {
    lines.push(`Reason: ${reason}`);
  }
  if (threadId) {
    lines.push(`Thread: ${threadId}`);
  }
  if (terminalId) {
    lines.push(`Terminal: ${terminalId}`);
  }

  return lines.join("\n");
}
