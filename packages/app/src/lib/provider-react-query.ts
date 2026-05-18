import {
  type EnvironmentId,
  OrchestrationGetFullThreadDiffInput,
  OrchestrationGetTurnDiffInput,
  ThreadId,
} from "@multi/contracts";
import { queryOptions } from "@tanstack/react-query";
import { Option, Schema } from "effect";
import { ensureEnvironmentApi } from "../environment-api";

interface CheckpointDiffQueryInput {
  environmentId: EnvironmentId | null;
  threadId: ThreadId | null;
  fromTurnCount: number | null;
  toTurnCount: number | null;
  cacheScope?: string | null;
  enabled?: boolean;
}

export const providerQueryKeys = {
  all: ["providers"] as const,
  checkpointDiff: (input: CheckpointDiffQueryInput) =>
    [
      "providers",
      "checkpointDiff",
      input.environmentId ?? null,
      input.threadId,
      input.fromTurnCount,
      input.toTurnCount,
      input.cacheScope ?? null,
    ] as const,
};

const decodeFullThreadDiffInputOption = Schema.decodeUnknownOption(
  OrchestrationGetFullThreadDiffInput,
);
const decodeTurnDiffInputOption = Schema.decodeUnknownOption(OrchestrationGetTurnDiffInput);

function decodeCheckpointDiffRequest(input: CheckpointDiffQueryInput) {
  if (input.fromTurnCount === 0) {
    return decodeFullThreadDiffInputOption({
      threadId: input.threadId,
      toTurnCount: input.toTurnCount,
    }).pipe(Option.map((fields) => ({ kind: "fullThreadDiff" as const, input: fields })));
  }

  return decodeTurnDiffInputOption({
    threadId: input.threadId,
    fromTurnCount: input.fromTurnCount,
    toTurnCount: input.toTurnCount,
  }).pipe(Option.map((fields) => ({ kind: "turnDiff" as const, input: fields })));
}

function asCheckpointErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "";
}

function readObjectField(input: unknown, field: string): unknown {
  if (typeof input !== "object" || input === null) {
    return undefined;
  }
  return (input as Record<string, unknown>)[field];
}

function collectCheckpointErrorMessages(error: unknown, messages: string[] = []): string[] {
  const message = asCheckpointErrorMessage(error).trim();
  if (message.length > 0) {
    messages.push(message);
  }

  const detail = readObjectField(error, "detail");
  if (typeof detail === "string" && detail.trim().length > 0) {
    messages.push(detail.trim());
  }

  const cause = error instanceof Error ? error.cause : readObjectField(error, "cause");
  if (cause !== undefined && cause !== error) {
    collectCheckpointErrorMessages(cause, messages);
  }

  return messages;
}

function isGenericCheckpointWrapperMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return (
    normalized === "failed to load full thread diff" || normalized === "failed to load turn diff"
  );
}

function isDiffOutputTooLargeMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return normalized.includes("git diff") && normalized.includes("output exceeded");
}

function normalizeCheckpointErrorMessage(error: unknown): string {
  const messages = collectCheckpointErrorMessages(error);
  const message =
    messages.find((candidate) => !isGenericCheckpointWrapperMessage(candidate)) ??
    messages[0] ??
    "";
  if (message.length === 0) {
    return "Failed to load checkpoint diff.";
  }

  const lower = message.toLowerCase();
  if (isDiffOutputTooLargeMessage(message)) {
    return "This checkpoint diff is too large to render. Select a single turn to review a smaller patch.";
  }

  if (lower.includes("not a git repository")) {
    return "Turn diffs are unavailable because this project is not a git repository.";
  }

  if (
    lower.includes("checkpoint unavailable for thread") ||
    lower.includes("checkpoint invariant violation")
  ) {
    const separatorIndex = message.indexOf(":");
    if (separatorIndex >= 0) {
      const detail = message.slice(separatorIndex + 1).trim();
      if (detail.length > 0) {
        return detail;
      }
    }
  }

  return message;
}

function isCheckpointTemporarilyUnavailable(error: unknown): boolean {
  const message = asCheckpointErrorMessage(error).toLowerCase();
  return (
    message.includes("exceeds current turn count") ||
    message.includes("checkpoint is unavailable for turn") ||
    message.includes("filesystem checkpoint is unavailable")
  );
}

export function checkpointDiffQueryOptions(input: CheckpointDiffQueryInput) {
  const decodedRequest = decodeCheckpointDiffRequest(input);

  return queryOptions({
    queryKey: providerQueryKeys.checkpointDiff(input),
    queryFn: async () => {
      if (!input.environmentId || !input.threadId || decodedRequest._tag === "None") {
        throw new Error("Checkpoint diff is unavailable.");
      }
      const api = ensureEnvironmentApi(input.environmentId);
      try {
        if (decodedRequest.value.kind === "fullThreadDiff") {
          return await api.orchestration.getFullThreadDiff(decodedRequest.value.input);
        }
        return await api.orchestration.getTurnDiff(decodedRequest.value.input);
      } catch (error) {
        throw new Error(normalizeCheckpointErrorMessage(error), { cause: error });
      }
    },
    enabled:
      (input.enabled ?? true) &&
      !!input.environmentId &&
      !!input.threadId &&
      decodedRequest._tag === "Some",
    staleTime: Infinity,
    retry: (failureCount, error) => {
      if (isCheckpointTemporarilyUnavailable(error)) {
        return failureCount < 12;
      }
      return failureCount < 3;
    },
    retryDelay: (attempt, error) =>
      isCheckpointTemporarilyUnavailable(error)
        ? Math.min(5_000, 250 * 2 ** (attempt - 1))
        : Math.min(1_000, 100 * 2 ** (attempt - 1)),
  });
}
