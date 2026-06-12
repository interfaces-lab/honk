import type { MessageId, OrchestrationSessionStatus } from "@honk/contracts";

export type ThreadTreeMutationBlockReason =
  | "send-in-flight"
  | "queued-composer-items"
  | "turn-running";

export interface ThreadTreeMutationAvailability {
  canMutate: boolean;
  reason: ThreadTreeMutationBlockReason | null;
}

export function deriveThreadTreeMutationAvailability(input: {
  sendInFlight: boolean;
  queuedComposerItemCount: number;
  editingQueuedComposerItemId?: MessageId | null | undefined;
  orchestrationStatus: OrchestrationSessionStatus | null;
}): ThreadTreeMutationAvailability {
  if (input.sendInFlight) {
    return {
      canMutate: false,
      reason: "send-in-flight",
    };
  }
  if (input.queuedComposerItemCount > 0 || input.editingQueuedComposerItemId) {
    return {
      canMutate: false,
      reason: "queued-composer-items",
    };
  }
  if (input.orchestrationStatus === "starting" || input.orchestrationStatus === "running") {
    return {
      canMutate: false,
      reason: "turn-running",
    };
  }
  return {
    canMutate: true,
    reason: null,
  };
}
