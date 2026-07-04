import { EnvironmentId, type ScopedThreadRef } from "@honk/shared/environment";
import { ThreadId } from "@honk/shared/base-schemas";
import { create } from "zustand";

import { DraftId } from "~/stores/chat-drafts";

import {
  createAgentPanelData,
  flattenPanelIds,
  retargetDraftPanelsToServer,
  type ChatPaneLayoutNode,
  type ChatPanePanel,
  type ChatPanePanelData,
  type ChatPaneSplitDirection,
  type ChatPaneTarget,
  type ChatPaneTileset,
} from "./chat-pane-tiling";

const CHAT_PANE_TILING_STORAGE_KEY = "agentLayout.shared.v6";
const LEGACY_CHAT_PANE_TILING_STORAGE_KEYS = ["honk.agentLayout.shared.v1"] as const;

function duplicateAgentIdsForTileset(tileset: ChatPaneTileset): string[] {
  const seen = new Set<string>();
  const duplicateAgentIds = new Set<string>();
  for (const panelId of flattenPanelIds(tileset.layout)) {
    const data = tileset.panels[panelId]?.data;
    if (data?.kind !== "agent") {
      continue;
    }
    if (seen.has(data.agentId)) {
      duplicateAgentIds.add(data.agentId);
      continue;
    }
    seen.add(data.agentId);
  }
  return [...duplicateAgentIds];
}

function shouldPersistTileset(tileset: ChatPaneTileset): boolean {
  return (
    flattenPanelIds(tileset.layout).length > 1 && duplicateAgentIdsForTileset(tileset).length === 0
  );
}

interface ChatPaneTilingStoreState {
  readonly tilesetByRouteKey: Record<string, ChatPaneTileset>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function isSplitDirection(value: unknown): value is ChatPaneSplitDirection {
  return value === "horizontal" || value === "vertical";
}

function normalizeTarget(value: unknown): ChatPaneTarget | null {
  const record = asRecord(value);
  if (!record) return null;

  const environmentId = nonEmptyString(record.environmentId);
  const threadId = nonEmptyString(record.threadId);
  if (!environmentId || !threadId) return null;

  if (record.routeKind === "server") {
    return {
      environmentId: EnvironmentId.make(environmentId),
      routeKind: "server",
      threadId: ThreadId.make(threadId),
    };
  }

  if (record.routeKind !== "draft") return null;
  const draftId = nonEmptyString(record.draftId);
  if (!draftId) return null;
  return {
    draftId: DraftId.make(draftId),
    environmentId: EnvironmentId.make(environmentId),
    routeKind: "draft",
    threadId: ThreadId.make(threadId),
  };
}

function normalizePanelData(value: unknown): ChatPanePanelData | null {
  const record = asRecord(value);
  if (!record) return null;

  if (record.kind === "agent") {
    const target = normalizeTarget(record.target);
    return target ? createAgentPanelData(target) : null;
  }

  if (record.kind === "empty") {
    const draftId = nonEmptyString(record.draftId);
    return draftId ? { draftId, kind: "empty" } : null;
  }

  if (record.kind === "loading") {
    const agentId = nonEmptyString(record.agentId);
    return agentId ? { agentId, kind: "loading" } : null;
  }

  return null;
}

function normalizeLayout(value: unknown): ChatPaneLayoutNode | null {
  const record = asRecord(value);
  if (!record) return null;

  if (record.kind === "leaf") {
    const panelId = nonEmptyString(record.panelId);
    return panelId ? { kind: "leaf", panelId } : null;
  }

  if (record.kind !== "split" || !isSplitDirection(record.direction)) return null;
  if (!Array.isArray(record.children) || record.children.length !== 2) return null;

  const first = normalizeLayout(record.children[0]);
  const second = normalizeLayout(record.children[1]);
  return first && second
    ? {
        children: [first, second],
        direction: record.direction,
        kind: "split",
      }
    : null;
}

function normalizePanels(value: unknown): Record<string, ChatPanePanel> {
  const record = asRecord(value);
  if (!record) return {};

  const panels: Record<string, ChatPanePanel> = {};
  for (const [panelId, panelValue] of Object.entries(record)) {
    const normalizedPanelId = nonEmptyString(panelId);
    const panelRecord = asRecord(panelValue);
    if (!normalizedPanelId || !panelRecord) continue;
    const data = normalizePanelData(panelRecord.data);
    if (!data) continue;
    panels[normalizedPanelId] = {
      data,
      panelId: normalizedPanelId,
    };
  }
  return panels;
}

function normalizeTileset(value: unknown, routeKey: string): ChatPaneTileset | null {
  const record = asRecord(value);
  if (!record) return null;

  const layout = normalizeLayout(record.layout);
  if (!layout) return null;

  const persistedPanels = normalizePanels(record.panels);
  const layoutPanelIds = flattenPanelIds(layout);
  if (layoutPanelIds.length === 0) return null;

  const panels: Record<string, ChatPanePanel> = {};
  for (const panelId of layoutPanelIds) {
    const panel = persistedPanels[panelId];
    if (!panel) return null;
    panels[panelId] = panel;
  }

  const firstPanelId = layoutPanelIds[0]!;
  const tilesetId = nonEmptyString(record.tilesetId) ?? chatPaneTilesetIdForRouteKey(routeKey);
  const focusedPanelId = layoutPanelIds.includes(String(record.focusedPanelId))
    ? String(record.focusedPanelId)
    : firstPanelId;
  const expandedPanelId = layoutPanelIds.includes(String(record.expandedPanelId))
    ? String(record.expandedPanelId)
    : null;

  return {
    expandedPanelId,
    focusedPanelId,
    layout,
    managerId: nonEmptyString(record.managerId) ?? tilesetId,
    panels,
    tilesetId,
  };
}

function readPersistedTilesets(): Record<string, ChatPaneTileset> {
  if (typeof window === "undefined") return {};
  const raw =
    window.localStorage.getItem(CHAT_PANE_TILING_STORAGE_KEY) ??
    LEGACY_CHAT_PANE_TILING_STORAGE_KEYS.map((key) => window.localStorage.getItem(key)).find(
      (value) => value !== null,
    );
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as unknown;
    const record = asRecord(parsed);
    if (!record) return {};

    const tilesetByRouteKey: Record<string, ChatPaneTileset> = {};
    const rejectedRouteKeys: string[] = [];
    for (const [routeKey, value] of Object.entries(record)) {
      if (routeKey.trim().length === 0) continue;
      const tileset = normalizeTileset(value, routeKey);
      if (tileset && shouldPersistTileset(tileset)) {
        tilesetByRouteKey[routeKey] = tileset;
      } else if (tileset) {
        rejectedRouteKeys.push(routeKey);
      }
    }
    if (rejectedRouteKeys.length > 0) {
      persistTilesets(tilesetByRouteKey);
    }
    return tilesetByRouteKey;
  } catch {
    return {};
  }
}

function persistTilesets(tilesetByRouteKey: Record<string, ChatPaneTileset>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CHAT_PANE_TILING_STORAGE_KEY, JSON.stringify(tilesetByRouteKey));
  } catch {
    // Ignore storage errors; the live layout state is still valid for this session.
  }
}

const useChatPaneTilingStore = create<ChatPaneTilingStoreState>(() => ({
  tilesetByRouteKey: readPersistedTilesets(),
}));

export function chatPaneTilingRouteKeyForTarget(target: ChatPaneTarget): string {
  return target.routeKind === "server"
    ? `server:${target.environmentId}:${target.threadId}`
    : `draft:${target.draftId}`;
}

export function chatPaneTilingRouteKeyForThreadRef(threadRef: ScopedThreadRef): string {
  return `server:${threadRef.environmentId}:${threadRef.threadId}`;
}

export function chatPaneTilingRouteKeyForDraftId(draftId: DraftId): string {
  return `draft:${draftId}`;
}

export function chatPaneTilesetIdForRouteKey(routeKey: string): string {
  return `tileset:${routeKey}`;
}

export function useChatPaneTileset(routeKey: string): ChatPaneTileset | null {
  return useChatPaneTilingStore((state) => state.tilesetByRouteKey[routeKey] ?? null);
}

export function useChatPaneFocusedTarget(routeKey: string | null): ChatPaneTarget | null {
  return useChatPaneTilingStore((state) => {
    if (!routeKey) return null;
    const tileset = state.tilesetByRouteKey[routeKey] ?? null;
    const focusedData = tileset ? tileset.panels[tileset.focusedPanelId]?.data : null;
    return focusedData?.kind === "agent" ? focusedData.target : null;
  });
}

export function getChatPaneTileset(routeKey: string): ChatPaneTileset | null {
  return useChatPaneTilingStore.getState().tilesetByRouteKey[routeKey] ?? null;
}

function setRouteTileset(
  routeKey: string,
  tileset: ChatPaneTileset | null,
): ChatPaneTileset | null {
  const trimmedRouteKey = routeKey.trim();
  if (!trimmedRouteKey) return null;

  let nextTileset: ChatPaneTileset | null = tileset;
  useChatPaneTilingStore.setState((state) => {
    const current = state.tilesetByRouteKey[trimmedRouteKey] ?? null;
    if (current === tileset && (!tileset || shouldPersistTileset(tileset))) return state;

    const tilesetByRouteKey = { ...state.tilesetByRouteKey };
    const tilesetToPersist = tileset && shouldPersistTileset(tileset) ? tileset : null;
    if (tilesetToPersist) {
      tilesetByRouteKey[trimmedRouteKey] = tilesetToPersist;
    } else {
      delete tilesetByRouteKey[trimmedRouteKey];
      nextTileset = null;
    }
    persistTilesets(tilesetByRouteKey);
    return { tilesetByRouteKey };
  });
  return nextTileset;
}

export const chatPaneTilingActions = {
  clearRouteTileset: (routeKey: string): void => {
    setRouteTileset(routeKey, null);
  },
  setRouteTileset,
  updateRouteTileset: (
    routeKey: string,
    updater: (current: ChatPaneTileset | null) => ChatPaneTileset | null,
  ): ChatPaneTileset | null => {
    const current = getChatPaneTileset(routeKey);
    return setRouteTileset(routeKey, updater(current));
  },
  promoteDraftTilesets: (draftId: DraftId, promotedThreadRef: ScopedThreadRef): void => {
    const draftRouteKey = chatPaneTilingRouteKeyForDraftId(draftId);
    const serverRouteKey = chatPaneTilingRouteKeyForThreadRef(promotedThreadRef);
    useChatPaneTilingStore.setState((state) => {
      let changed = false;
      const tilesetByRouteKey: Record<string, ChatPaneTileset> = {};

      for (const [routeKey, tileset] of Object.entries(state.tilesetByRouteKey)) {
        const retargeted = retargetDraftPanelsToServer(tileset, draftId, promotedThreadRef);
        if (routeKey === draftRouteKey) {
          changed = true;
          const serverTilesetId = chatPaneTilesetIdForRouteKey(serverRouteKey);
          tilesetByRouteKey[serverRouteKey] = {
            ...retargeted,
            managerId: serverTilesetId,
            tilesetId: serverTilesetId,
          };
          continue;
        }
        if (retargeted !== tileset) {
          changed = true;
        }
        tilesetByRouteKey[routeKey] = retargeted;
      }

      if (!changed) return state;
      persistTilesets(tilesetByRouteKey);
      return { tilesetByRouteKey };
    });
  },
} as const;
