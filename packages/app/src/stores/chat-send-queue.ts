import type {
  MessageId,
  OrchestrationProposedPlanId,
  AgentInteractionMode,
  ThreadId,
} from "@honk/contracts";
import { create } from "zustand";

import type { ComposerSubmitContext } from "../components/chat/composer-submit";

export interface QueuedComposerPlanFollowUp {
  planMarkdown: string;
  planId: OrchestrationProposedPlanId;
  planThreadId: ThreadId;
}

export interface QueuedComposerItem {
  id: MessageId;
  threadKey: string;
  sendContext: ComposerSubmitContext;
  interactionMode: AgentInteractionMode;
  planFollowUp: QueuedComposerPlanFollowUp | null;
  createdAt: string;
}

interface ComposerQueueStoreState {
  queueItemsByThreadKey: Record<string, QueuedComposerItem[]>;
  editingQueueItemIdByThreadKey: Record<string, MessageId | null>;
  queueExpandedByThreadKey: Record<string, boolean>;
  getQueueItems: (threadKey: string) => QueuedComposerItem[];
  getQueueItem: (threadKey: string, itemId: MessageId) => QueuedComposerItem | null;
  getEditingQueueItemId: (threadKey: string) => MessageId | null;
  getQueueExpanded: (threadKey: string) => boolean;
  setQueueExpanded: (threadKey: string, expanded: boolean) => void;
  enqueueComposerItem: (threadKey: string, item: QueuedComposerItem) => void;
  removeQueuedComposerItem: (threadKey: string, itemId: MessageId) => void;
  takeQueuedComposerItem: (threadKey: string, itemId: MessageId) => QueuedComposerItem | null;
  takeNextQueuedComposerItem: (threadKey: string) => QueuedComposerItem | null;
  restoreQueuedComposerItem: (threadKey: string, item: QueuedComposerItem, index: number) => void;
  reorderQueuedComposerItem: (
    threadKey: string,
    itemId: MessageId,
    targetItemId: MessageId | null,
    insertAfter: boolean,
  ) => void;
  beginEditingQueuedComposerItem: (threadKey: string, itemId: MessageId) => void;
  cancelEditingQueuedComposerItem: (threadKey: string) => void;
  replaceEditingQueuedComposerItem: (threadKey: string, item: QueuedComposerItem) => void;
}

const EMPTY_QUEUE_ITEMS: QueuedComposerItem[] = [];
Object.freeze(EMPTY_QUEUE_ITEMS);

function normalizeThreadKey(threadKey: string): string | null {
  const normalized = threadKey.trim();
  return normalized.length > 0 ? normalized : null;
}

function revokeObjectPreviewUrl(previewUrl: string): void {
  if (typeof URL === "undefined" || !previewUrl.startsWith("blob:")) {
    return;
  }
  URL.revokeObjectURL(previewUrl);
}

function revokeQueuedItemImagePreviews(
  item: QueuedComposerItem | undefined,
  preservePreviewUrls: ReadonlySet<string> = new Set(),
): void {
  if (!item) {
    return;
  }
  for (const image of item.sendContext.images) {
    if (preservePreviewUrls.has(image.previewUrl)) {
      continue;
    }
    revokeObjectPreviewUrl(image.previewUrl);
  }
}

function withoutEmptyThreadQueue(
  queueItemsByThreadKey: Record<string, QueuedComposerItem[]>,
  normalizedThreadKey: string,
  items: QueuedComposerItem[],
): Record<string, QueuedComposerItem[]> {
  const next = { ...queueItemsByThreadKey };
  if (items.length === 0) {
    delete next[normalizedThreadKey];
  } else {
    next[normalizedThreadKey] = items;
  }
  return next;
}

function withoutThreadEdit(
  editingQueueItemIdByThreadKey: Record<string, MessageId | null>,
  normalizedThreadKey: string,
): Record<string, MessageId | null> {
  if (!(normalizedThreadKey in editingQueueItemIdByThreadKey)) {
    return editingQueueItemIdByThreadKey;
  }
  const next = { ...editingQueueItemIdByThreadKey };
  delete next[normalizedThreadKey];
  return next;
}

export const useComposerQueueStore = create<ComposerQueueStoreState>()((set, get) => ({
  queueItemsByThreadKey: {},
  editingQueueItemIdByThreadKey: {},
  queueExpandedByThreadKey: {},
  getQueueItems: (threadKey) => {
    const normalizedThreadKey = normalizeThreadKey(threadKey);
    return normalizedThreadKey
      ? (get().queueItemsByThreadKey[normalizedThreadKey] ?? EMPTY_QUEUE_ITEMS)
      : EMPTY_QUEUE_ITEMS;
  },
  getQueueItem: (threadKey, itemId) => {
    const normalizedThreadKey = normalizeThreadKey(threadKey);
    return normalizedThreadKey
      ? ((get().queueItemsByThreadKey[normalizedThreadKey] ?? EMPTY_QUEUE_ITEMS).find(
          (item) => item.id === itemId,
        ) ?? null)
      : null;
  },
  getEditingQueueItemId: (threadKey) => {
    const normalizedThreadKey = normalizeThreadKey(threadKey);
    return normalizedThreadKey
      ? (get().editingQueueItemIdByThreadKey[normalizedThreadKey] ?? null)
      : null;
  },
  getQueueExpanded: (threadKey) => {
    const normalizedThreadKey = normalizeThreadKey(threadKey);
    return normalizedThreadKey
      ? (get().queueExpandedByThreadKey[normalizedThreadKey] ?? true)
      : true;
  },
  setQueueExpanded: (threadKey, expanded) => {
    const normalizedThreadKey = normalizeThreadKey(threadKey);
    if (!normalizedThreadKey) {
      return;
    }
    set((state) => {
      if ((state.queueExpandedByThreadKey[normalizedThreadKey] ?? true) === expanded) {
        return state;
      }
      return {
        queueExpandedByThreadKey: {
          ...state.queueExpandedByThreadKey,
          [normalizedThreadKey]: expanded,
        },
      };
    });
  },
  enqueueComposerItem: (threadKey, item) => {
    const normalizedThreadKey = normalizeThreadKey(threadKey);
    if (!normalizedThreadKey) {
      return;
    }
    set((state) => {
      const existingItems = state.queueItemsByThreadKey[normalizedThreadKey] ?? EMPTY_QUEUE_ITEMS;
      const existingItem = existingItems.find((entry) => entry.id === item.id);
      const nextItem = { ...item, threadKey: normalizedThreadKey };
      const nextItems = existingItem
        ? existingItems.map((entry) => (entry.id === item.id ? nextItem : entry))
        : [...existingItems, nextItem];
      if (existingItem) {
        const preservePreviewUrls = new Set(
          nextItem.sendContext.images.map((image) => image.previewUrl),
        );
        revokeQueuedItemImagePreviews(existingItem, preservePreviewUrls);
      }
      return {
        queueItemsByThreadKey: {
          ...state.queueItemsByThreadKey,
          [normalizedThreadKey]: nextItems,
        },
      };
    });
  },
  removeQueuedComposerItem: (threadKey, itemId) => {
    const normalizedThreadKey = normalizeThreadKey(threadKey);
    if (!normalizedThreadKey) {
      return;
    }
    set((state) => {
      const existingItems = state.queueItemsByThreadKey[normalizedThreadKey] ?? EMPTY_QUEUE_ITEMS;
      const removedItem = existingItems.find((entry) => entry.id === itemId);
      if (!removedItem) {
        return state;
      }
      revokeQueuedItemImagePreviews(removedItem);
      const nextItems = existingItems.filter((entry) => entry.id !== itemId);
      const editingQueueItemId = state.editingQueueItemIdByThreadKey[normalizedThreadKey];
      return {
        queueItemsByThreadKey: withoutEmptyThreadQueue(
          state.queueItemsByThreadKey,
          normalizedThreadKey,
          nextItems,
        ),
        editingQueueItemIdByThreadKey:
          editingQueueItemId === itemId
            ? withoutThreadEdit(state.editingQueueItemIdByThreadKey, normalizedThreadKey)
            : state.editingQueueItemIdByThreadKey,
      };
    });
  },
  takeQueuedComposerItem: (threadKey, itemId) => {
    const normalizedThreadKey = normalizeThreadKey(threadKey);
    if (!normalizedThreadKey) {
      return null;
    }
    let takenItem: QueuedComposerItem | null = null;
    set((state) => {
      const existingItems = state.queueItemsByThreadKey[normalizedThreadKey] ?? EMPTY_QUEUE_ITEMS;
      takenItem = existingItems.find((entry) => entry.id === itemId) ?? null;
      if (!takenItem) {
        return state;
      }
      const nextItems = existingItems.filter((entry) => entry.id !== itemId);
      const editingQueueItemId = state.editingQueueItemIdByThreadKey[normalizedThreadKey];
      return {
        queueItemsByThreadKey: withoutEmptyThreadQueue(
          state.queueItemsByThreadKey,
          normalizedThreadKey,
          nextItems,
        ),
        editingQueueItemIdByThreadKey:
          editingQueueItemId === itemId
            ? withoutThreadEdit(state.editingQueueItemIdByThreadKey, normalizedThreadKey)
            : state.editingQueueItemIdByThreadKey,
      };
    });
    return takenItem;
  },
  takeNextQueuedComposerItem: (threadKey) => {
    const normalizedThreadKey = normalizeThreadKey(threadKey);
    if (!normalizedThreadKey) {
      return null;
    }
    let takenItem: QueuedComposerItem | null = null;
    set((state) => {
      const existingItems = state.queueItemsByThreadKey[normalizedThreadKey] ?? EMPTY_QUEUE_ITEMS;
      takenItem = existingItems[0] ?? null;
      if (!takenItem) {
        return state;
      }
      const nextItems = existingItems.slice(1);
      const editingQueueItemId = state.editingQueueItemIdByThreadKey[normalizedThreadKey];
      return {
        queueItemsByThreadKey: withoutEmptyThreadQueue(
          state.queueItemsByThreadKey,
          normalizedThreadKey,
          nextItems,
        ),
        editingQueueItemIdByThreadKey:
          editingQueueItemId === takenItem.id
            ? withoutThreadEdit(state.editingQueueItemIdByThreadKey, normalizedThreadKey)
            : state.editingQueueItemIdByThreadKey,
      };
    });
    return takenItem;
  },
  restoreQueuedComposerItem: (threadKey, item, index) => {
    const normalizedThreadKey = normalizeThreadKey(threadKey);
    if (!normalizedThreadKey) {
      return;
    }
    set((state) => {
      const existingItems = state.queueItemsByThreadKey[normalizedThreadKey] ?? EMPTY_QUEUE_ITEMS;
      if (existingItems.some((entry) => entry.id === item.id)) {
        return state;
      }
      const nextItem = { ...item, threadKey: normalizedThreadKey };
      const nextItems = [...existingItems];
      nextItems.splice(Math.max(0, Math.min(index, nextItems.length)), 0, nextItem);
      return {
        queueItemsByThreadKey: {
          ...state.queueItemsByThreadKey,
          [normalizedThreadKey]: nextItems,
        },
      };
    });
  },
  reorderQueuedComposerItem: (threadKey, itemId, targetItemId, insertAfter) => {
    const normalizedThreadKey = normalizeThreadKey(threadKey);
    if (!normalizedThreadKey || itemId === targetItemId) {
      return;
    }
    set((state) => {
      const existingItems = state.queueItemsByThreadKey[normalizedThreadKey] ?? EMPTY_QUEUE_ITEMS;
      const movingItem = existingItems.find((entry) => entry.id === itemId);
      if (!movingItem) {
        return state;
      }
      const remainingItems = existingItems.filter((entry) => entry.id !== itemId);
      let insertionIndex = insertAfter ? remainingItems.length : 0;
      if (targetItemId !== null) {
        const targetIndex = remainingItems.findIndex((entry) => entry.id === targetItemId);
        if (targetIndex === -1) {
          return state;
        }
        insertionIndex = targetIndex + (insertAfter ? 1 : 0);
      }
      const nextItems = [...remainingItems];
      nextItems.splice(Math.max(0, Math.min(insertionIndex, nextItems.length)), 0, movingItem);
      if (nextItems.every((entry, index) => entry.id === existingItems[index]?.id)) {
        return state;
      }
      return {
        queueItemsByThreadKey: {
          ...state.queueItemsByThreadKey,
          [normalizedThreadKey]: nextItems,
        },
      };
    });
  },
  beginEditingQueuedComposerItem: (threadKey, itemId) => {
    const normalizedThreadKey = normalizeThreadKey(threadKey);
    if (
      !normalizedThreadKey ||
      !(get().queueItemsByThreadKey[normalizedThreadKey] ?? EMPTY_QUEUE_ITEMS).some(
        (item) => item.id === itemId,
      )
    ) {
      return;
    }
    set((state) => ({
      editingQueueItemIdByThreadKey: {
        ...state.editingQueueItemIdByThreadKey,
        [normalizedThreadKey]: itemId,
      },
    }));
  },
  cancelEditingQueuedComposerItem: (threadKey) => {
    const normalizedThreadKey = normalizeThreadKey(threadKey);
    if (!normalizedThreadKey) {
      return;
    }
    set((state) => ({
      editingQueueItemIdByThreadKey: withoutThreadEdit(
        state.editingQueueItemIdByThreadKey,
        normalizedThreadKey,
      ),
    }));
  },
  replaceEditingQueuedComposerItem: (threadKey, item) => {
    const normalizedThreadKey = normalizeThreadKey(threadKey);
    if (!normalizedThreadKey) {
      return;
    }
    set((state) => {
      const editingQueueItemId = state.editingQueueItemIdByThreadKey[normalizedThreadKey];
      if (!editingQueueItemId) {
        return state;
      }
      const existingItems = state.queueItemsByThreadKey[normalizedThreadKey] ?? EMPTY_QUEUE_ITEMS;
      const existingIndex = existingItems.findIndex((entry) => entry.id === editingQueueItemId);
      if (existingIndex < 0) {
        return {
          editingQueueItemIdByThreadKey: withoutThreadEdit(
            state.editingQueueItemIdByThreadKey,
            normalizedThreadKey,
          ),
        };
      }
      const nextItem = { ...item, id: editingQueueItemId, threadKey: normalizedThreadKey };
      const nextItems = existingItems.map((entry, index) =>
        index === existingIndex ? nextItem : entry,
      );
      const preservePreviewUrls = new Set(
        nextItem.sendContext.images.map((image) => image.previewUrl),
      );
      revokeQueuedItemImagePreviews(existingItems[existingIndex], preservePreviewUrls);
      return {
        queueItemsByThreadKey: {
          ...state.queueItemsByThreadKey,
          [normalizedThreadKey]: nextItems,
        },
        editingQueueItemIdByThreadKey: withoutThreadEdit(
          state.editingQueueItemIdByThreadKey,
          normalizedThreadKey,
        ),
      };
    });
  },
}));
