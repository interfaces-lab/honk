import type { ProviderApprovalDecision } from "@multi/contracts";
import type * as EffectAcpSchema from "effect-acp/schema";

import {
  makeAcpToolCallState,
  normalizeAcpToolKind,
  type AcpToolCallState,
} from "./AcpTool.ts";

export interface AcpPermissionRequest {
  readonly kind: string | "unknown";
  readonly detail?: string;
  readonly toolCall?: AcpToolCallState;
}

export const DEFAULT_ACP_PERMISSION_OPTIONS: ReadonlyArray<EffectAcpSchema.PermissionOption> = [
  { optionId: "allow-once", kind: "allow_once", name: "Allow once" },
  { optionId: "allow-always", kind: "allow_always", name: "Always allow" },
  { optionId: "reject-once", kind: "reject_once", name: "Reject" },
];

export function parsePermissionRequest(
  params: EffectAcpSchema.RequestPermissionRequest,
): AcpPermissionRequest {
  const toolCall = makeAcpToolCallState(
    {
      toolCallId: params.toolCall.toolCallId,
      title: params.toolCall.title,
      kind: params.toolCall.kind,
      status: params.toolCall.status,
      rawInput: params.toolCall.rawInput,
      rawOutput: params.toolCall.rawOutput,
      content: params.toolCall.content,
      locations: params.toolCall.locations,
    },
    { fallbackStatus: "pending" },
  );
  const kind = normalizeAcpToolKind(params.toolCall.kind) ?? "unknown";
  const detail =
    toolCall?.command ??
    toolCall?.title ??
    toolCall?.detail ??
    (typeof params.sessionId === "string" ? `Session ${params.sessionId}` : undefined);
  return {
    kind,
    ...(detail ? { detail } : {}),
    ...(toolCall ? { toolCall } : {}),
  };
}

export function acpPermissionOutcome(decision: ProviderApprovalDecision): string {
  switch (decision) {
    case "acceptForSession":
      return "allow-always";
    case "accept":
      return "allow-once";
    case "decline":
    default:
      return "reject-once";
  }
}
