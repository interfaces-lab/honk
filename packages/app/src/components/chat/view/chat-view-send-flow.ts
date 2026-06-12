import type { MessageId, AgentInteractionMode } from "@honk/contracts";

import type {
  QueuedComposerItem,
  QueuedComposerPlanFollowUp,
} from "../../../stores/chat-send-queue";
import type { ComposerSubmitContext } from "../composer-submit";

export function createQueuedComposerItem(input: {
  threadKey: string;
  sendContext: ComposerSubmitContext;
  interactionMode: AgentInteractionMode;
  planFollowUp: QueuedComposerPlanFollowUp | null;
  itemId: MessageId;
  createdAt: string;
}): QueuedComposerItem {
  return {
    id: input.itemId,
    threadKey: input.threadKey,
    sendContext: {
      ...input.sendContext,
      images: [...input.sendContext.images],
    },
    interactionMode: input.interactionMode,
    planFollowUp: input.planFollowUp,
    createdAt: input.createdAt,
  };
}
