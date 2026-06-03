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

export function formatGitActionErrorDescription(
  error: unknown,
  fallback = "Git action failed.",
): string {
  const message =
    readNonEmptyStringField(error, "message") ??
    (error instanceof Error && error.message.trim().length > 0 ? error.message.trim() : null);
  const detail = readNonEmptyStringField(error, "detail");
  const command = readNonEmptyStringField(error, "command");
  const cwd = readNonEmptyStringField(error, "cwd");
  const operation = readNonEmptyStringField(error, "operation");
  const lines = [detail ?? message ?? fallback];

  if (command) {
    lines.push(`Command: ${command}`);
  }
  if (cwd) {
    lines.push(`Project: ${cwd}`);
  }
  if (operation) {
    lines.push(`Operation: ${operation}`);
  }

  return lines.join("\n");
}
