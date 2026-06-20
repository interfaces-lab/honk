import type { ThreadAgentRuntimeQueuedFollowUp, ThreadId } from "@honk/contracts";

import { useAgentRuntimeStore } from "../../../stores/agent-runtime-store";
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
  setQueueExpanded: ReturnType<typeof useComposerQueueStore.getState>["setQueueExpanded"];
  beginEditingQueuedComposerItem: ReturnType<
    typeof useComposerQueueStore.getState
  >["beginEditingQueuedComposerItem"];
  cancelEditingQueuedComposerItem: ReturnType<
    typeof useComposerQueueStore.getState
  >["cancelEditingQueuedComposerItem"];
}

export function useThreadComposerQueue(
  routeThreadKey: string,
  threadId: ThreadId | null,
): UseThreadComposerQueueReturn {
  const runtimeQueuedFollowUps = useAgentRuntimeStore((store) => store.snapshot.queuedFollowUps);
  let queuedComposerItems: QueuedComposerItem[];
  if (!threadId) {
    queuedComposerItems = EMPTY_QUEUED_COMPOSER_ITEMS;
  } else {
    const items: QueuedComposerItem[] = [];
    for (const item of runtimeQueuedFollowUps) {
      if (item.threadId === threadId) {
        items.push(queuedFollowUpToComposerItem(routeThreadKey, item));
      }
    }
    queuedComposerItems = items.length > 0 ? items : EMPTY_QUEUED_COMPOSER_ITEMS;
  }
  const editingQueuedComposerItemId = useComposerQueueStore(
    (store) => store.editingQueueItemIdByThreadKey[routeThreadKey] ?? null,
  );
  const queuedComposerItemsExpanded = useComposerQueueStore(
    (store) => store.queueExpandedByThreadKey[routeThreadKey] ?? true,
  );
  const setQueueExpanded = useComposerQueueStore((store) => store.setQueueExpanded);
  const beginEditingQueuedComposerItem = useComposerQueueStore(
    (store) => store.beginEditingQueuedComposerItem,
  );
  const cancelEditingQueuedComposerItem = useComposerQueueStore(
    (store) => store.cancelEditingQueuedComposerItem,
  );

  return {
    queuedComposerItems,
    editingQueuedComposerItemId,
    queuedComposerItemsExpanded,
    setQueueExpanded,
    beginEditingQueuedComposerItem,
    cancelEditingQueuedComposerItem,
  };
}

function queuedFollowUpToComposerItem(
  threadKey: string,
  item: ThreadAgentRuntimeQueuedFollowUp,
): QueuedComposerItem {
  return {
    id: item.clientMessageId,
    threadKey,
    sendContext: {
      prompt: item.input,
      images: item.images.map((image, index) => ({
        type: "image",
        id: `${item.clientMessageId}-${index}`,
        name: image.name,
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes,
        previewUrl: image.dataUrl,
        file: fileFromDataUrl(image.dataUrl, image.name, image.mimeType),
      })),
      hasUnresolvedSlashCommand: false,
    },
    interactionMode: item.interactionMode,
    planFollowUp: null,
    createdAt: item.createdAt,
  };
}

function fileFromDataUrl(dataUrl: string, name: string, mimeType: string): File {
  const commaIndex = dataUrl.indexOf(",");
  const base64 = commaIndex === -1 ? "" : dataUrl.slice(commaIndex + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], name, { type: mimeType });
}
