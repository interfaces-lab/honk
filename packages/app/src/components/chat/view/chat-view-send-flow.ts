import type { MessageId, ProviderInteractionMode, RuntimeMode } from "@multi/contracts";

import type {
  QueuedComposerItem,
  QueuedComposerPlanFollowUp,
} from "../../../stores/chat-send-queue";
import type { ComposerSubmitContext } from "../composer-submit";

export function createQueuedComposerItem(input: {
  threadKey: string;
  sendContext: ComposerSubmitContext;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
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
    runtimeMode: input.runtimeMode,
    interactionMode: input.interactionMode,
    planFollowUp: input.planFollowUp,
    createdAt: input.createdAt,
  };
}
