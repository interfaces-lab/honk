import type { MessageId } from "@multi/contracts";
import { create } from "zustand";

import type { LocalDispatchSnapshot } from "../components/chat/view/thread-lifecycle";
import type { PendingTimelineRow } from "../types";

export const EMPTY_PENDING_TIMELINE_ROWS: readonly PendingTimelineRow[] = Object.freeze([]);

interface PendingThreadSendStoreState {
  pendingRowsByThreadKey: Record<string, PendingTimelineRow[] | undefined>;
  localDispatchByThreadKey: Record<string, LocalDispatchSnapshot | undefined>;
  appendPendingRow: (threadKey: string, row: PendingTimelineRow) => void;
  copyPendingRows: (
    sourceThreadKey: string,
    targetThreadKey: string,
    clientSendKeys?: ReadonlySet<MessageId>,
  ) => void;
  copyLocalDispatch: (sourceThreadKey: string, targetThreadKey: string) => void;
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

  copyPendingRows: (sourceThreadKey, targetThreadKey, clientSendKeys) => {
    if (sourceThreadKey === targetThreadKey) {
      return;
    }
    set((state) => {
      const sourceRows = state.pendingRowsByThreadKey[sourceThreadKey] ?? [];
      if (sourceRows.length === 0) {
        return state;
      }

      const rowsToTransfer = clientSendKeys
        ? sourceRows.filter((row) => clientSendKeys.has(row.clientSendKey))
        : sourceRows;
      if (rowsToTransfer.length === 0) {
        return state;
      }

      const targetRows = state.pendingRowsByThreadKey[targetThreadKey] ?? [];
      const targetClientSendKeys = new Set(targetRows.map((row) => row.clientSendKey));
      const rowsToAppend = rowsToTransfer.filter(
        (row) => !targetClientSendKeys.has(row.clientSendKey),
      );
      if (rowsToAppend.length === 0) {
        return state;
      }
      return {
        pendingRowsByThreadKey: {
          ...state.pendingRowsByThreadKey,
          [targetThreadKey]: [...targetRows, ...rowsToAppend],
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
