import type { AgentInteractionMode } from "@honk/shared/interaction-mode";
import type { MessageId, OrchestrationProposedPlanId } from "@honk/contracts";
import type { ThreadId } from "@honk/shared/base-schemas";
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
  editingQueueItemIdByThreadKey: Record<string, MessageId | null>;
  queueExpandedByThreadKey: Record<string, boolean>;
  getEditingQueueItemId: (threadKey: string) => MessageId | null;
  getQueueExpanded: (threadKey: string) => boolean;
  setQueueExpanded: (threadKey: string, expanded: boolean) => void;
  beginEditingQueuedComposerItem: (threadKey: string, itemId: MessageId) => void;
  cancelEditingQueuedComposerItem: (threadKey: string) => void;
}

function normalizeThreadKey(threadKey: string): string | null {
  const normalized = threadKey.trim();
  return normalized.length > 0 ? normalized : null;
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
  editingQueueItemIdByThreadKey: {},
  queueExpandedByThreadKey: {},
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
  beginEditingQueuedComposerItem: (threadKey, itemId) => {
    const normalizedThreadKey = normalizeThreadKey(threadKey);
    if (!normalizedThreadKey) {
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
}));
