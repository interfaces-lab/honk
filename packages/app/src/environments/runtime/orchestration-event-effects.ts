import type { OrchestrationEvent } from "@honk/contracts";
import type { ThreadId } from "@honk/shared/base-schemas";

export interface OrchestrationBatchEffects {
  promoteDraftThreadIds: ThreadId[];
  clearDeletedThreadIds: ThreadId[];
  gitRefreshThreadIds: ThreadId[];
}

const GIT_REFRESH_ACTIVITY_ITEM_TYPE = "file_change";
const GIT_REFRESH_ACTIVITY_KINDS = new Set(["tool.updated", "tool.completed"]);

function readActivityItemType(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || !("itemType" in payload)) {
    return null;
  }

  const itemType = payload.itemType;
  return typeof itemType === "string" ? itemType : null;
}

export function deriveOrchestrationBatchEffects(
  events: readonly OrchestrationEvent[],
): OrchestrationBatchEffects {
  const threadLifecycleEffects = new Map<
    ThreadId,
    {
      clearPromotedDraft: boolean;
      clearDeletedThread: boolean;
    }
  >();
  const gitRefreshThreadIds = new Set<ThreadId>();

  for (const event of events) {
    switch (event.type) {
      case "thread.created": {
        threadLifecycleEffects.set(event.payload.threadId, {
          clearPromotedDraft: true,
          clearDeletedThread: false,
        });
        break;
      }

      case "thread.deleted": {
        threadLifecycleEffects.set(event.payload.threadId, {
          clearPromotedDraft: false,
          clearDeletedThread: true,
        });
        break;
      }

      case "thread.archived": {
        threadLifecycleEffects.set(event.payload.threadId, {
          clearPromotedDraft: false,
          clearDeletedThread: false,
        });
        break;
      }

      case "thread.unarchived": {
        threadLifecycleEffects.set(event.payload.threadId, {
          clearPromotedDraft: false,
          clearDeletedThread: false,
        });
        break;
      }

      case "thread.activity-appended": {
        const activity = event.payload.activity;
        const itemType = readActivityItemType(activity.payload);
        if (
          itemType === GIT_REFRESH_ACTIVITY_ITEM_TYPE &&
          GIT_REFRESH_ACTIVITY_KINDS.has(activity.kind)
        ) {
          gitRefreshThreadIds.add(event.payload.threadId);
        }
        break;
      }

      default: {
        break;
      }
    }
  }

  const promoteDraftThreadIds: ThreadId[] = [];
  const clearDeletedThreadIds: ThreadId[] = [];
  for (const [threadId, effect] of threadLifecycleEffects) {
    if (effect.clearPromotedDraft) {
      promoteDraftThreadIds.push(threadId);
    }
    if (effect.clearDeletedThread) {
      clearDeletedThreadIds.push(threadId);
    }
  }

  return {
    promoteDraftThreadIds,
    clearDeletedThreadIds,
    gitRefreshThreadIds: [...gitRefreshThreadIds],
  };
}
