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

function readProjectErrorField(error: unknown, cause: unknown, key: string): string | null {
  return readNonEmptyStringField(error, key) ?? readNonEmptyStringField(cause, key);
}

export function formatProjectErrorDescription(
  error: unknown,
  fallback = "Project action failed.",
): string {
  const cause = readRecordField(error, "cause");
  const message =
    readNonEmptyStringField(error, "message") ??
    (error instanceof Error && error.message.trim().length > 0 ? error.message.trim() : null);
  const causeMessage =
    readNonEmptyStringField(cause, "message") ??
    (cause instanceof Error && cause.message.trim().length > 0 ? cause.message.trim() : null);
  const detail = readProjectErrorField(error, cause, "detail");
  const operation = readProjectErrorField(error, cause, "operation");
  const cwd = readProjectErrorField(error, cause, "cwd");
  const projectRoot = readProjectErrorField(error, cause, "projectRoot");
  const relativePath = readProjectErrorField(error, cause, "relativePath");
  const lines = [message ?? fallback];

  pushDistinct(lines, detail);
  pushDistinct(lines, causeMessage);
  if (operation) {
    lines.push(`Operation: ${operation}`);
  }
  if (cwd) {
    lines.push(`Project: ${cwd}`);
  } else if (projectRoot) {
    lines.push(`Project: ${projectRoot}`);
  }
  if (relativePath) {
    lines.push(`Path: ${relativePath}`);
  }

  return lines.join("\n");
}
