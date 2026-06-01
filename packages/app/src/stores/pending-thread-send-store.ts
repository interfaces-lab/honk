import type { MessageId } from "@multi/contracts";
import { create } from "zustand";

import type { LocalDispatchSnapshot } from "../components/chat/view/thread-lifecycle";
import type { PendingTimelineRow } from "../types";

export const EMPTY_PENDING_TIMELINE_ROWS: readonly PendingTimelineRow[] = Object.freeze([]);

interface PendingThreadSendStoreState {
  pendingRowsByThreadKey: Record<string, PendingTimelineRow[] | undefined>;
  localDispatchByThreadKey: Record<string, LocalDispatchSnapshot | undefined>;
  appendPendingRow: (threadKey: string, row: PendingTimelineRow) => void;
  removePendingRows: (
    threadKey: string,
    clientSendKeys: ReadonlySet<MessageId>,
  ) => PendingTimelineRow[];
  clearPendingRows: (threadKey: string) => PendingTimelineRow[];
  setLocalDispatch: (threadKey: string, snapshot: LocalDispatchSnapshot) => void;
  clearLocalDispatch: (threadKey: string) => void;
  resetForTests: () => void;
}

export const usePendingThreadSendStore = create<PendingThreadSendStoreState>((set, get) => ({
  pendingRowsByThreadKey: {},
  localDispatchByThreadKey: {},

  appendPendingRow: (threadKey, row) => {
    set((state) => {
      const existing = state.pendingRowsByThreadKey[threadKey] ?? [];
      if (existing.some((existingRow) => existingRow.clientSendKey === row.clientSendKey)) {
        return state;
      }
      return {
        pendingRowsByThreadKey: {
          ...state.pendingRowsByThreadKey,
          [threadKey]: [...existing, row],
        },
      };
    });
  },

  removePendingRows: (threadKey, clientSendKeys) => {
    const existing = get().pendingRowsByThreadKey[threadKey] ?? [];
    if (existing.length === 0 || clientSendKeys.size === 0) {
      return [];
    }

    const removed = existing.filter((row) => clientSendKeys.has(row.clientSendKey));
    if (removed.length === 0) {
      return [];
    }

    const nextRows = existing.filter((row) => !clientSendKeys.has(row.clientSendKey));
    set((state) => {
      const nextByThreadKey = { ...state.pendingRowsByThreadKey };
      if (nextRows.length === 0) {
        delete nextByThreadKey[threadKey];
      } else {
        nextByThreadKey[threadKey] = nextRows;
      }
      return { pendingRowsByThreadKey: nextByThreadKey };
    });
    return removed;
  },

  clearPendingRows: (threadKey) => {
    const existing = get().pendingRowsByThreadKey[threadKey] ?? [];
    if (existing.length === 0) {
      return [];
    }
    set((state) => {
      const nextByThreadKey = { ...state.pendingRowsByThreadKey };
      delete nextByThreadKey[threadKey];
      return { pendingRowsByThreadKey: nextByThreadKey };
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

  resetForTests: () => {
    set({
      pendingRowsByThreadKey: {},
      localDispatchByThreadKey: {},
    });
  },
}));
