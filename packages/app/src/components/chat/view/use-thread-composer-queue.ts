import { useComposerQueueStore, type QueuedComposerItem } from "../../../stores/chat-send-queue";

const EMPTY_QUEUED_COMPOSER_ITEMS: QueuedComposerItem[] = [];

export interface UseThreadComposerQueueReturn {
  queuedComposerItems: QueuedComposerItem[];
  editingQueuedComposerItemId:
    | ReturnType<
        (typeof useComposerQueueStore)["getState"]
      >["editingQueueItemIdByThreadKey"][string]
    | null;
  queuedComposerItemsExpanded: boolean;
  enqueueComposerItem: ReturnType<typeof useComposerQueueStore.getState>["enqueueComposerItem"];
  removeQueuedComposerItem: ReturnType<
    typeof useComposerQueueStore.getState
  >["removeQueuedComposerItem"];
  takeQueuedComposerItem: ReturnType<
    typeof useComposerQueueStore.getState
  >["takeQueuedComposerItem"];
  reorderQueuedComposerItem: ReturnType<
    typeof useComposerQueueStore.getState
  >["reorderQueuedComposerItem"];
  setQueueExpanded: ReturnType<typeof useComposerQueueStore.getState>["setQueueExpanded"];
  beginEditingQueuedComposerItem: ReturnType<
    typeof useComposerQueueStore.getState
  >["beginEditingQueuedComposerItem"];
  cancelEditingQueuedComposerItem: ReturnType<
    typeof useComposerQueueStore.getState
  >["cancelEditingQueuedComposerItem"];
  replaceEditingQueuedComposerItem: ReturnType<
    typeof useComposerQueueStore.getState
  >["replaceEditingQueuedComposerItem"];
}

/**
 * Wraps the `useComposerQueueStore` selectors used by `ChatView`. The complex
 * queue handlers (`onSendQueuedComposerItemNow`, `onBeginEditQueuedComposerItem`)
 * stay in `ChatView` because they touch the composer ref and send flow.
 */
export function useThreadComposerQueue(routeThreadKey: string): UseThreadComposerQueueReturn {
  const queuedComposerItems = useComposerQueueStore(
    (store) => store.queueItemsByThreadKey[routeThreadKey] ?? EMPTY_QUEUED_COMPOSER_ITEMS,
  );
  const editingQueuedComposerItemId = useComposerQueueStore(
    (store) => store.editingQueueItemIdByThreadKey[routeThreadKey] ?? null,
  );
  const queuedComposerItemsExpanded = useComposerQueueStore(
    (store) => store.queueExpandedByThreadKey[routeThreadKey] ?? true,
  );
  const enqueueComposerItem = useComposerQueueStore((store) => store.enqueueComposerItem);
  const removeQueuedComposerItem = useComposerQueueStore((store) => store.removeQueuedComposerItem);
  const takeQueuedComposerItem = useComposerQueueStore((store) => store.takeQueuedComposerItem);
  const reorderQueuedComposerItem = useComposerQueueStore(
    (store) => store.reorderQueuedComposerItem,
  );
  const setQueueExpanded = useComposerQueueStore((store) => store.setQueueExpanded);
  const beginEditingQueuedComposerItem = useComposerQueueStore(
    (store) => store.beginEditingQueuedComposerItem,
  );
  const cancelEditingQueuedComposerItem = useComposerQueueStore(
    (store) => store.cancelEditingQueuedComposerItem,
  );
  const replaceEditingQueuedComposerItem = useComposerQueueStore(
    (store) => store.replaceEditingQueuedComposerItem,
  );

  return {
    queuedComposerItems,
    editingQueuedComposerItemId,
    queuedComposerItemsExpanded,
    enqueueComposerItem,
    removeQueuedComposerItem,
    takeQueuedComposerItem,
    reorderQueuedComposerItem,
    setQueueExpanded,
    beginEditingQueuedComposerItem,
    cancelEditingQueuedComposerItem,
    replaceEditingQueuedComposerItem,
  };
}
