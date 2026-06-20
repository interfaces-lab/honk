const PERSISTED_PROVIDER_FAILURE_ASSISTANT_PREFIX = "Provider error:";
const CODEX_ERROR_PREFIX = "Codex error:";

const KNOWN_ERROR_COPY: Readonly<Record<string, string>> = {
  usage_limit_reached: "The usage limit has been reached",
  overloaded_error: "The model is temporarily overloaded. Try again shortly.",
  rate_limit_error: "Rate limit reached. Try again shortly.",
  authentication_error: "Authentication failed. Check your provider credentials.",
  invalid_request_error: "The provider rejected this request.",
};

interface ParsedProviderErrorPayload {
  readonly message: string | null;
  readonly type: string | null;
  readonly resetsAt: number | null;
  readonly resetsInSeconds: number | null;
}

function stripKnownErrorPrefixes(raw: string): string {
  let value = raw.trim();
  if (value.startsWith(PERSISTED_PROVIDER_FAILURE_ASSISTANT_PREFIX)) {
    value = value.slice(PERSISTED_PROVIDER_FAILURE_ASSISTANT_PREFIX.length).trim();
  }
  if (value.startsWith(CODEX_ERROR_PREFIX)) {
    value = value.slice(CODEX_ERROR_PREFIX.length).trim();
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return null;
}

function readTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseEmbeddedProviderErrorJson(raw: string): ParsedProviderErrorPayload | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const record = asRecord(parsed);
    if (!record) {
      return null;
    }
    const nestedError = asRecord(record.error);
    const message =
      readTrimmedString(nestedError?.message) ??
      readTrimmedString(record.message) ??
      readTrimmedString(nestedError?.detail);
    const type = readTrimmedString(nestedError?.type) ?? readTrimmedString(record.type) ?? null;
    const resetsAt = readFiniteNumber(nestedError?.resets_at) ?? readFiniteNumber(record.resets_at);
    const resetsInSeconds =
      readFiniteNumber(nestedError?.resets_in_seconds) ??
      readFiniteNumber(record.resets_in_seconds);
    return { message, type, resetsAt, resetsInSeconds };
  } catch {
    return null;
  }
}

function formatResetHint(input: {
  readonly resetsInSeconds: number | null;
  readonly resetsAt: number | null;
}): string | null {
  if (input.resetsInSeconds !== null && input.resetsInSeconds > 0) {
    const minutes = Math.max(1, Math.round(input.resetsInSeconds / 60));
    return minutes === 1 ? "Resets in about 1 minute." : `Resets in about ${minutes} minutes.`;
  }
  if (input.resetsAt !== null && input.resetsAt > 0) {
    const resetDate = new Date(input.resetsAt * 1000);
    if (!Number.isNaN(resetDate.getTime())) {
      return `Resets at ${resetDate.toLocaleString()}.`;
    }
  }
  return null;
}

function messageForKnownProviderErrorType(type: string | null): string | null {
  if (!type) {
    return null;
  }
  return KNOWN_ERROR_COPY[type] ?? null;
}

export function formatTurnFailureMessage(raw: string): string {
  const stripped = stripKnownErrorPrefixes(raw);
  if (stripped.length === 0) {
    return "The request failed.";
  }

  const parsed = parseEmbeddedProviderErrorJson(stripped);
  if (parsed) {
    const knownCopy = messageForKnownProviderErrorType(parsed.type);
    const baseMessage = knownCopy ?? parsed.message ?? stripped;
    const resetHint = formatResetHint(parsed);
    return resetHint ? `${baseMessage} ${resetHint}` : baseMessage;
  }

  return stripped;
}

export function isProviderFailureAssistantMessageText(text: string): boolean {
  return text.startsWith(PERSISTED_PROVIDER_FAILURE_ASSISTANT_PREFIX);
}

export function providerFailureFromAssistantMessageText(text: string): string | null {
  if (!isProviderFailureAssistantMessageText(text)) {
    return null;
  }
  const raw = text.slice(PERSISTED_PROVIDER_FAILURE_ASSISTANT_PREFIX.length).trim();
  if (raw.length === 0) {
    return null;
  }
  return formatTurnFailureMessage(raw);
}
