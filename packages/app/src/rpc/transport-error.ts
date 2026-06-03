const TRANSPORT_ERROR_PATTERNS = [
  /\bSocketCloseError\b/i,
  /\bSocketOpenError\b/i,
  /Unable to connect to the T3 server WebSocket\./i,
  /\bping timeout\b/i,
] as const;

const TRANSPORT_DETAIL_FIELDS = [
  ["detail", "Detail"],
  ["issue", "Issue"],
  ["settingsPath", "Settings"],
  ["operation", "Operation"],
  ["method", "Method"],
  ["command", "Command"],
  ["cwd", "Project"],
  ["projectRoot", "Project"],
  ["relativePath", "Path"],
  ["path", "Path"],
  ["provider", "Provider"],
  ["threadId", "Thread"],
  ["terminalId", "Terminal"],
  ["reason", "Reason"],
] as const;

export function isTransportConnectionErrorMessage(message: string | null | undefined): boolean {
  if (typeof message !== "string") {
    return false;
  }

  const normalizedMessage = message.trim();
  if (normalizedMessage.length === 0) {
    return false;
  }

  return TRANSPORT_ERROR_PATTERNS.some((pattern) => pattern.test(normalizedMessage));
}

export function sanitizeThreadErrorMessage(message: string | null | undefined): string | null {
  return isTransportConnectionErrorMessage(message) ? null : (message ?? null);
}

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

function readErrorMessage(value: unknown): string | null {
  if (value instanceof Error && value.message.trim().length > 0) {
    return value.message.trim();
  }
  return readNonEmptyStringField(value, "message");
}

function pushUnique(lines: string[], value: string | null): void {
  if (!value || lines.some((line) => line.includes(value))) {
    return;
  }
  lines.push(value);
}

function collectSchemaBackedTransportErrorDetails(
  error: unknown,
  lines: string[],
  visited = new Set<unknown>(),
): void {
  if (error === null || error === undefined || visited.has(error)) {
    return;
  }
  visited.add(error);

  const tag = readNonEmptyStringField(error, "_tag");
  if (tag) {
    pushUnique(lines, `Type: ${tag}`);
  }

  for (const [field, label] of TRANSPORT_DETAIL_FIELDS) {
    const value = readNonEmptyStringField(error, field);
    if (value) {
      pushUnique(lines, `${label}: ${value}`);
    }
  }

  const cause = error instanceof Error ? error.cause : readRecordField(error, "cause");
  if (cause !== undefined) {
    pushUnique(lines, readErrorMessage(cause));
    collectSchemaBackedTransportErrorDetails(cause, lines, visited);
  }
}

export function formatSchemaBackedTransportErrorDescription(
  error: unknown,
  fallback: string,
): string {
  const message = readErrorMessage(error);
  const lines = [message ?? fallback];

  collectSchemaBackedTransportErrorDetails(error, lines);

  return lines.join("\n");
}
