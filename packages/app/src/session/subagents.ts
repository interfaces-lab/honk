import type { SubagentRunSnapshot, SubagentToolDetails } from "@honk/contracts";

interface ParsedSubagentReceiverAgent {
  subagentThreadId: string;
  agentId?: string | undefined;
  nickname?: string | undefined;
  role?: string | undefined;
  model?: string | undefined;
  prompt?: string | undefined;
}

interface ParsedSubagentAgentState {
  subagentThreadId: string;
  agentId?: string | undefined;
  nickname?: string | undefined;
  role?: string | undefined;
  model?: string | undefined;
  prompt?: string | undefined;
  status?: string | undefined;
  message?: string | undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

const SUBAGENT_ROLE_LABELS: Record<string, string> = {
  "general-purpose": "Worker",
  librarian: "Librarian",
  oracle: "Oracle",
};

export function formatSubagentRoleLabel(role: string | undefined): string | undefined {
  const trimmed = role?.trim();
  return trimmed && trimmed.length > 0 ? (SUBAGENT_ROLE_LABELS[trimmed] ?? trimmed) : undefined;
}

function readSubagentDetails(
  item: Record<string, unknown> | null | undefined,
): Pick<SubagentToolDetails, "runs"> | null {
  const details = asRecord(item?.details);
  if (Array.isArray(details?.runs)) {
    return details as Pick<SubagentToolDetails, "runs">;
  }
  const resultDetails = asRecord(asRecord(item?.result)?.details);
  if (Array.isArray(resultDetails?.runs)) {
    return resultDetails as Pick<SubagentToolDetails, "runs">;
  }
  if (Array.isArray(item?.runs)) {
    return item as Pick<SubagentToolDetails, "runs">;
  }
  return null;
}

function readRuns(
  item: Record<string, unknown> | null | undefined,
): ReadonlyArray<Partial<SubagentRunSnapshot>> {
  return readSubagentDetails(item)?.runs ?? [];
}

function parseRun(run: Partial<SubagentRunSnapshot>): ParsedSubagentReceiverAgent | null {
  const subagentThreadId = asTrimmedString(run.subagentThreadId);
  if (!subagentThreadId) {
    return null;
  }
  const agentId = asTrimmedString(run.agentId);
  const nickname = asTrimmedString(run.nickname);
  const role = asTrimmedString(run.role);
  const model = asTrimmedString(run.model);
  const prompt = asTrimmedString(run.prompt);
  return {
    subagentThreadId,
    ...(agentId ? { agentId } : {}),
    ...(nickname ? { nickname } : {}),
    ...(role ? { role } : {}),
    ...(model ? { model } : {}),
    ...(prompt ? { prompt } : {}),
  };
}

export function decodeSubagentReceiverAgents(
  item: Record<string, unknown>,
): ReadonlyArray<ParsedSubagentReceiverAgent> {
  return readRuns(item)
    .map(parseRun)
    .filter((run): run is ParsedSubagentReceiverAgent => run !== null);
}

export function decodeSubagentAgentStates(
  item: Record<string, unknown> | null | undefined,
): Record<string, ParsedSubagentAgentState> {
  const decoded: Record<string, ParsedSubagentAgentState> = {};
  for (const run of readRuns(item)) {
    const parsed = parseRun(run);
    if (!parsed) {
      continue;
    }
    const status = asTrimmedString(run.state);
    const errorMessage = asTrimmedString(run.errorMessage);
    const finalText = asTrimmedString(run.finalText);
    decoded[parsed.subagentThreadId] = {
      ...parsed,
      ...(status ? { status } : {}),
      ...(errorMessage ? { message: errorMessage } : finalText ? { message: finalText } : {}),
    };
  }
  return decoded;
}
