import type { MessageId, ThreadEntryId } from "@multi/contracts";
import { create } from "zustand";

import type { LocalDispatchSnapshot } from "../components/chat/view/thread-lifecycle";
import type { ChatMessage } from "../types";
import type { ThreadSendIntent } from "../types";

export const EMPTY_THREAD_SEND_INTENTS: readonly ThreadSendIntent[] = Object.freeze([]);

export function createThreadSendIntent(input: {
  messageId: MessageId;
  text: string;
  richText?: ChatMessage["richText"] | undefined;
  attachments?: ChatMessage["attachments"] | undefined;
  createdAt: string;
  parentEntryId: ThreadEntryId | null;
}): ThreadSendIntent {
  return {
    clientMessageId: input.messageId,
    parentEntryId: input.parentEntryId,
    text: input.text,
    ...(input.richText !== undefined ? { richText: input.richText } : {}),
    ...(input.attachments !== undefined && input.attachments.length > 0
      ? { attachments: input.attachments }
      : {}),
    createdAt: input.createdAt,
  };
}

interface ThreadSendIntentStoreState {
  sendIntentsByThreadKey: Record<string, ThreadSendIntent[] | undefined>;
  localDispatchByThreadKey: Record<string, LocalDispatchSnapshot | undefined>;
  appendSendIntent: (threadKey: string, intent: ThreadSendIntent) => void;
  copySendIntents: (
    sourceThreadKey: string,
    targetThreadKey: string,
    clientSendKeys?: ReadonlySet<MessageId>,
  ) => void;
  copyLocalDispatch: (sourceThreadKey: string, targetThreadKey: string) => void;
  removeSendIntents: (
    threadKey: string,
    clientSendKeys: ReadonlySet<MessageId>,
  ) => ThreadSendIntent[];
  clearSendIntents: (threadKey: string) => ThreadSendIntent[];
  setLocalDispatch: (threadKey: string, snapshot: LocalDispatchSnapshot) => void;
  clearLocalDispatch: (threadKey: string) => void;
  clearLocalSendArtifactsForThread: (threadKey: string) => ThreadSendIntent[];
  resetForTests: () => void;
}

export const useThreadSendIntentStore = create<ThreadSendIntentStoreState>((set, get) => ({
  sendIntentsByThreadKey: {},
  localDispatchByThreadKey: {},

  appendSendIntent: (threadKey, intent) => {
    set((state) => {
      const existing = state.sendIntentsByThreadKey[threadKey] ?? [];
      if (
        existing.some(
          (existingIntent) => existingIntent.clientMessageId === intent.clientMessageId,
        )
      ) {
        return state;
      }
      return {
        sendIntentsByThreadKey: {
          ...state.sendIntentsByThreadKey,
          [threadKey]: [...existing, intent],
        },
      };
    });
  },

  copySendIntents: (sourceThreadKey, targetThreadKey, clientSendKeys) => {
    if (sourceThreadKey === targetThreadKey) {
      return;
    }
    set((state) => {
      const sourceIntents = state.sendIntentsByThreadKey[sourceThreadKey] ?? [];
      if (sourceIntents.length === 0) {
        return state;
      }

      const intentsToTransfer = clientSendKeys
        ? sourceIntents.filter((intent) => clientSendKeys.has(intent.clientMessageId))
        : sourceIntents;
      if (intentsToTransfer.length === 0) {
        return state;
      }

      const targetIntents = state.sendIntentsByThreadKey[targetThreadKey] ?? [];
      const targetClientSendKeys = new Set(
        targetIntents.map((intent) => intent.clientMessageId),
      );
      const intentsToAppend = intentsToTransfer.filter(
        (intent) => !targetClientSendKeys.has(intent.clientMessageId),
      );
      if (intentsToAppend.length === 0) {
        return state;
      }
      return {
        sendIntentsByThreadKey: {
          ...state.sendIntentsByThreadKey,
          [targetThreadKey]: [...targetIntents, ...intentsToAppend],
        },
      };
    });
  },

  copyLocalDispatch: (sourceThreadKey, targetThreadKey) => {
    if (sourceThreadKey === targetThreadKey) {
      return;
    }
    set((state) => {
      const dispatch = state.localDispatchByThreadKey[sourceThreadKey];
      if (!dispatch) {
        return state;
      }
      return {
        localDispatchByThreadKey: {
          ...state.localDispatchByThreadKey,
          [targetThreadKey]: dispatch,
        },
      };
    });
  },

  removeSendIntents: (threadKey, clientSendKeys) => {
    const existing = get().sendIntentsByThreadKey[threadKey] ?? [];
    if (existing.length === 0 || clientSendKeys.size === 0) {
      return [];
    }

    const removed = existing.filter((intent) => clientSendKeys.has(intent.clientMessageId));
    if (removed.length === 0) {
      return [];
    }

    const nextIntents = existing.filter((intent) => !clientSendKeys.has(intent.clientMessageId));
    set((state) => {
      const nextByThreadKey = { ...state.sendIntentsByThreadKey };
      if (nextIntents.length === 0) {
        delete nextByThreadKey[threadKey];
      } else {
        nextByThreadKey[threadKey] = nextIntents;
      }
      return { sendIntentsByThreadKey: nextByThreadKey };
    });
    return removed;
  },

  clearSendIntents: (threadKey) => {
    const existing = get().sendIntentsByThreadKey[threadKey] ?? [];
    if (existing.length === 0) {
      return [];
    }
    set((state) => {
      const nextByThreadKey = { ...state.sendIntentsByThreadKey };
      delete nextByThreadKey[threadKey];
      return { sendIntentsByThreadKey: nextByThreadKey };
    });
    return existing;
  },

  setLocalDispatch: (threadKey, snapshot) => {
    set((state) => ({
      localDispatchByThreadKey: {
        ...state.localDispatchByThreadKey,
        [threadKey]: snapshot,
      },
    }));
  },

  clearLocalDispatch: (threadKey) => {
    if (!get().localDispatchByThreadKey[threadKey]) {
      return;
    }
    set((state) => {
      const nextByThreadKey = { ...state.localDispatchByThreadKey };
      delete nextByThreadKey[threadKey];
      return { localDispatchByThreadKey: nextByThreadKey };
    });
  },

  clearLocalSendArtifactsForThread: (threadKey) => {
    const removedIntents = get().clearSendIntents(threadKey);
    get().clearLocalDispatch(threadKey);
    return removedIntents;
  },

  resetForTests: () => {
    set({
      sendIntentsByThreadKey: {},
      localDispatchByThreadKey: {},
    });
  },
}));
