import type { EnvironmentId, ScopedThreadRef } from "@honk/shared/environment";
import type { ThreadId } from "@honk/shared/base-schemas";
import type { CSSProperties } from "react";

import type { DraftId } from "~/stores/chat-drafts";

export type ChatPaneDropZone = "left" | "right" | "top" | "bottom" | "center";
export type ChatPaneSplitDirection = "horizontal" | "vertical";

export type ChatPaneTarget =
  | {
      readonly environmentId: EnvironmentId;
      readonly routeKind: "server";
      readonly threadId: ThreadId;
    }
  | {
      readonly draftId: DraftId;
      readonly environmentId: EnvironmentId;
      readonly routeKind: "draft";
      readonly threadId: ThreadId;
    };

export type ChatPanePanelData =
  | {
      readonly agentId: string;
      readonly kind: "agent";
      readonly target: ChatPaneTarget;
    }
  | {
      readonly draftId: string;
      readonly kind: "empty";
    }
  | {
      readonly agentId: string;
      readonly kind: "loading";
    };

export interface ChatPanePanel {
  readonly data: ChatPanePanelData;
  readonly panelId: string;
}

export type ChatPaneLayoutNode =
  | {
      readonly kind: "leaf";
      readonly panelId: string;
    }
  | {
      readonly children: readonly [ChatPaneLayoutNode, ChatPaneLayoutNode];
      readonly direction: ChatPaneSplitDirection;
      readonly kind: "split";
    };

export interface ChatPaneTileset {
  readonly expandedPanelId: string | null;
  readonly focusedPanelId: string;
  readonly layout: ChatPaneLayoutNode;
  readonly managerId: string;
  readonly panels: Readonly<Record<string, ChatPanePanel>>;
  readonly tilesetId: string;
}

export interface ChatPanePanelDragPayload {
  readonly kind: "panel";
  readonly managerId: string;
  readonly panelId: string;
}

export interface ChatPanePlacementOptions {
  readonly allowDuplicateTargetAgent?: boolean;
}

function targetAgentId(target: ChatPaneTarget): string {
  return target.routeKind === "server"
    ? `server:${target.environmentId}:${target.threadId}`
    : `draft:${target.draftId}`;
}

export function createAgentPanelData(target: ChatPaneTarget): ChatPanePanelData {
  return {
    agentId: targetAgentId(target),
    kind: "agent",
    target,
  };
}

export function createChatPaneTileset(input: {
  readonly data: ChatPanePanelData;
  readonly panelId: string;
  readonly tilesetId: string;
}): ChatPaneTileset {
  return {
    expandedPanelId: null,
    focusedPanelId: input.panelId,
    layout: { kind: "leaf", panelId: input.panelId },
    managerId: input.tilesetId,
    panels: {
      [input.panelId]: {
        data: input.data,
        panelId: input.panelId,
      },
    },
    tilesetId: input.tilesetId,
  };
}

export function flattenPanelIds(layout: ChatPaneLayoutNode): readonly string[] {
  if (layout.kind === "leaf") {
    return [layout.panelId];
  }
  return [...flattenPanelIds(layout.children[0]), ...flattenPanelIds(layout.children[1])];
}

export function nextPanelIdForTileset(tileset: ChatPaneTileset): string {
  const maxPanelIndex = Object.keys(tileset.panels).reduce((max, panelId) => {
    const match = /^panel-(\d+)$/.exec(panelId);
    if (!match) return max;
    const parsed = Number.parseInt(match[1]!, 10);
    return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
  }, 0);
  return `panel-${maxPanelIndex + 1}`;
}

function splitPositionForZone(zone: ChatPaneDropZone): {
  readonly direction: ChatPaneSplitDirection;
  readonly insertBefore: boolean;
} {
  if (zone === "left") return { direction: "horizontal", insertBefore: true };
  if (zone === "right") return { direction: "horizontal", insertBefore: false };
  if (zone === "top") return { direction: "vertical", insertBefore: true };
  if (zone === "bottom") return { direction: "vertical", insertBefore: false };
  return { direction: "horizontal", insertBefore: false };
}

function splitLayoutAt(
  layout: ChatPaneLayoutNode,
  targetPanelId: string,
  direction: ChatPaneSplitDirection,
  insertBefore: boolean,
  insertedLeaf: ChatPaneLayoutNode,
): ChatPaneLayoutNode {
  if (layout.kind === "leaf") {
    if (layout.panelId !== targetPanelId) {
      return layout;
    }
    return {
      children: insertBefore ? [insertedLeaf, layout] : [layout, insertedLeaf],
      direction,
      kind: "split",
    };
  }
  return {
    ...layout,
    children: [
      splitLayoutAt(layout.children[0], targetPanelId, direction, insertBefore, insertedLeaf),
      splitLayoutAt(layout.children[1], targetPanelId, direction, insertBefore, insertedLeaf),
    ],
  };
}

function removePanelFromLayout(
  layout: ChatPaneLayoutNode,
  panelId: string,
): ChatPaneLayoutNode | null {
  if (layout.kind === "leaf") {
    return layout.panelId === panelId ? null : layout;
  }
  const first = removePanelFromLayout(layout.children[0], panelId);
  const second = removePanelFromLayout(layout.children[1], panelId);
  if (first && second) {
    return { ...layout, children: [first, second] };
  }
  return first ?? second;
}

function directSiblingPosition(
  layout: ChatPaneLayoutNode,
  sourcePanelId: string,
  targetPanelId: string,
): { readonly direction: ChatPaneSplitDirection; readonly sourceBeforeTarget: boolean } | null {
  if (layout.kind === "leaf") {
    return null;
  }
  const [first, second] = layout.children;
  if (first.kind === "leaf" && second.kind === "leaf") {
    if (first.panelId === sourcePanelId && second.panelId === targetPanelId) {
      return { direction: layout.direction, sourceBeforeTarget: true };
    }
    if (first.panelId === targetPanelId && second.panelId === sourcePanelId) {
      return { direction: layout.direction, sourceBeforeTarget: false };
    }
  }
  return (
    directSiblingPosition(first, sourcePanelId, targetPanelId) ??
    directSiblingPosition(second, sourcePanelId, targetPanelId)
  );
}

function firstPanelId(layout: ChatPaneLayoutNode): string {
  return flattenPanelIds(layout)[0] ?? "";
}

export function setFocusedPanel(tileset: ChatPaneTileset, panelId: string): ChatPaneTileset {
  return tileset.panels[panelId] ? { ...tileset, focusedPanelId: panelId } : tileset;
}

export function getDisallowedDropZones(
  tileset: ChatPaneTileset,
  sourcePanelId: string,
  targetPanelId: string,
): ReadonlySet<ChatPaneDropZone> {
  if (sourcePanelId === targetPanelId) {
    return new Set(["left", "right", "top", "bottom", "center"]);
  }
  const siblingPosition = directSiblingPosition(tileset.layout, sourcePanelId, targetPanelId);
  if (!siblingPosition) {
    return new Set();
  }
  if (siblingPosition.direction === "horizontal") {
    return new Set([siblingPosition.sourceBeforeTarget ? "left" : "right"]);
  }
  return new Set([siblingPosition.sourceBeforeTarget ? "top" : "bottom"]);
}

export function splitTile(
  tileset: ChatPaneTileset,
  panelId: string,
  direction: ChatPaneSplitDirection,
  data: ChatPanePanelData,
  nextPanelId: string,
): ChatPaneTileset {
  if (!tileset.panels[panelId] || tileset.panels[nextPanelId]) {
    return tileset;
  }
  const nextPanel: ChatPanePanel = { data, panelId: nextPanelId };
  return {
    ...tileset,
    focusedPanelId: nextPanelId,
    layout: splitLayoutAt(tileset.layout, panelId, direction, false, {
      kind: "leaf",
      panelId: nextPanelId,
    }),
    panels: {
      ...tileset.panels,
      [nextPanelId]: nextPanel,
    },
  };
}

export function splitActiveTile(
  tileset: ChatPaneTileset,
  direction: ChatPaneSplitDirection,
  data: ChatPanePanelData,
  nextPanelId: string,
): ChatPaneTileset {
  return splitTile(tileset, tileset.focusedPanelId, direction, data, nextPanelId);
}

export function closeTile(tileset: ChatPaneTileset, panelId: string): ChatPaneTileset {
  if (!tileset.panels[panelId] || Object.keys(tileset.panels).length <= 1) {
    return tileset;
  }
  const layout = removePanelFromLayout(tileset.layout, panelId);
  if (!layout) {
    return tileset;
  }
  const { [panelId]: _removed, ...panels } = tileset.panels;
  const focusedPanelId =
    tileset.focusedPanelId === panelId ? firstPanelId(layout) : tileset.focusedPanelId;
  return {
    ...tileset,
    expandedPanelId: tileset.expandedPanelId === panelId ? null : tileset.expandedPanelId,
    focusedPanelId,
    layout,
    panels,
  };
}

export function closeFocusedTile(tileset: ChatPaneTileset): ChatPaneTileset {
  return closeTile(tileset, tileset.focusedPanelId);
}

export function dropAgentOnPanel(
  tileset: ChatPaneTileset,
  targetPanelId: string,
  payload: ChatPanePanelDragPayload,
  zone: ChatPaneDropZone,
): ChatPaneTileset {
  if (payload.managerId !== tileset.managerId || payload.panelId === targetPanelId) {
    return tileset;
  }
  const sourcePanel = tileset.panels[payload.panelId];
  const targetPanel = tileset.panels[targetPanelId];
  if (!sourcePanel || !targetPanel) {
    return tileset;
  }
  const layoutWithoutSource = removePanelFromLayout(tileset.layout, payload.panelId);
  if (!layoutWithoutSource) {
    return tileset;
  }
  const panelsWithoutSource = { ...tileset.panels };
  delete panelsWithoutSource[payload.panelId];

  if (zone === "center") {
    return {
      ...tileset,
      focusedPanelId: targetPanelId,
      layout: layoutWithoutSource,
      panels: {
        ...panelsWithoutSource,
        [targetPanelId]: {
          ...targetPanel,
          data: sourcePanel.data,
        },
      },
    };
  }

  const splitPosition = splitPositionForZone(zone);
  return {
    ...tileset,
    focusedPanelId: payload.panelId,
    layout: splitLayoutAt(
      layoutWithoutSource,
      targetPanelId,
      splitPosition.direction,
      splitPosition.insertBefore,
      { kind: "leaf", panelId: payload.panelId },
    ),
    panels: {
      ...panelsWithoutSource,
      [payload.panelId]: sourcePanel,
    },
  };
}

export function placeAgentOnPanel(
  tileset: ChatPaneTileset,
  targetPanelId: string,
  data: ChatPanePanelData,
  zone: ChatPaneDropZone,
  nextPanelId: string,
  _options: ChatPanePlacementOptions = {},
): ChatPaneTileset {
  const targetPanel = tileset.panels[targetPanelId];
  if (!targetPanel || tileset.panels[nextPanelId]) {
    return tileset;
  }

  if (data.kind === "agent") {
    const existingPanel = Object.values(tileset.panels).find(
      (panel) => panel.data.kind === "agent" && panel.data.agentId === data.agentId,
    );
    const allowDuplicate = false;
    if (existingPanel && !allowDuplicate) {
      return dropAgentOnPanel(
        tileset,
        targetPanelId,
        {
          kind: "panel",
          managerId: tileset.managerId,
          panelId: existingPanel.panelId,
        },
        zone,
      );
    }
  }

  if (zone === "center") {
    return {
      ...tileset,
      focusedPanelId: targetPanelId,
      panels: {
        ...tileset.panels,
        [targetPanelId]: {
          ...targetPanel,
          data,
        },
      },
    };
  }

  const splitPosition = splitPositionForZone(zone);
  return {
    ...tileset,
    focusedPanelId: nextPanelId,
    layout: splitLayoutAt(
      tileset.layout,
      targetPanelId,
      splitPosition.direction,
      splitPosition.insertBefore,
      { kind: "leaf", panelId: nextPanelId },
    ),
    panels: {
      ...tileset.panels,
      [nextPanelId]: {
        data,
        panelId: nextPanelId,
      },
    },
  };
}

export function dropAgentOnSelectedAgent(
  tileset: ChatPaneTileset,
  payload: ChatPanePanelDragPayload,
  zone: ChatPaneDropZone,
): ChatPaneTileset;
export function dropAgentOnSelectedAgent(
  tileset: ChatPaneTileset,
  data: ChatPanePanelData,
  zone: ChatPaneDropZone,
  nextPanelId: string,
  options?: ChatPanePlacementOptions,
): ChatPaneTileset;
export function dropAgentOnSelectedAgent(
  tileset: ChatPaneTileset,
  dropped: ChatPanePanelData | ChatPanePanelDragPayload,
  zone: ChatPaneDropZone,
  nextPanelId?: string,
  options?: ChatPanePlacementOptions,
): ChatPaneTileset {
  return dropped.kind === "panel"
    ? dropAgentOnPanel(tileset, tileset.focusedPanelId, dropped, zone)
    : placeAgentOnPanel(tileset, tileset.focusedPanelId, dropped, zone, nextPanelId ?? "", options);
}

export function focusAdjacentTile(tileset: ChatPaneTileset, delta: -1 | 1): ChatPaneTileset {
  const panelIds = flattenPanelIds(tileset.layout);
  const currentIndex = panelIds.indexOf(tileset.focusedPanelId);
  if (currentIndex < 0 || panelIds.length === 0) {
    return tileset;
  }
  const nextIndex = (currentIndex + delta + panelIds.length) % panelIds.length;
  return {
    ...tileset,
    focusedPanelId: panelIds[nextIndex] ?? tileset.focusedPanelId,
  };
}

export function navigateToAgent(tileset: ChatPaneTileset, agentId: string): ChatPaneTileset {
  const panel = Object.values(tileset.panels).find(
    (candidate) => candidate.data.kind === "agent" && candidate.data.agentId === agentId,
  );
  return panel ? { ...tileset, focusedPanelId: panel.panelId } : tileset;
}

export function retargetDraftPanelsToServer(
  tileset: ChatPaneTileset,
  draftId: DraftId,
  threadRef: ScopedThreadRef,
): ChatPaneTileset {
  let changed = false;
  const panels: Record<string, ChatPanePanel> = {};
  for (const [panelId, panel] of Object.entries(tileset.panels)) {
    if (
      panel.data.kind === "agent" &&
      panel.data.target.routeKind === "draft" &&
      panel.data.target.draftId === draftId
    ) {
      changed = true;
      panels[panelId] = {
        ...panel,
        data: createAgentPanelData({
          environmentId: threadRef.environmentId,
          routeKind: "server",
          threadId: threadRef.threadId,
        }),
      };
    } else {
      panels[panelId] = panel;
    }
  }
  return changed ? { ...tileset, panels } : tileset;
}

export function expandAgent(tileset: ChatPaneTileset, panelId: string): ChatPaneTileset {
  if (!tileset.panels[panelId]) {
    return tileset;
  }
  return {
    ...tileset,
    expandedPanelId: tileset.expandedPanelId === panelId ? null : panelId,
    focusedPanelId: panelId,
  };
}

export function calculateDropZone(input: {
  readonly clientX: number;
  readonly clientY: number;
  readonly disallowedZones?: ReadonlySet<ChatPaneDropZone> | undefined;
  readonly edgeThreshold?: number | undefined;
  readonly rect: DOMRect;
}): ChatPaneDropZone | null {
  const edgeThreshold = input.edgeThreshold ?? 0.375;
  const x = (input.clientX - input.rect.left) / Math.max(1, input.rect.width);
  const y = (input.clientY - input.rect.top) / Math.max(1, input.rect.height);
  const candidates: Array<readonly [ChatPaneDropZone, number]> = [
    ["bottom", 1 - y],
    ["top", y],
    ["left", x],
    ["right", 1 - x],
  ];
  const [zone, distance] = candidates.reduce((best, candidate) =>
    candidate[1] < best[1] ? candidate : best,
  );
  const resolvedZone = distance <= edgeThreshold ? zone : "center";
  return input.disallowedZones?.has(resolvedZone) ? null : resolvedZone;
}

export function getDropOverlayBounds(zone: ChatPaneDropZone): CSSProperties {
  if (zone === "left") return { inset: "0 auto 0 0", width: "50%" };
  if (zone === "right") return { inset: "0 0 0 auto", width: "50%" };
  if (zone === "top") return { inset: "0 0 auto 0", height: "50%" };
  if (zone === "bottom") return { inset: "auto 0 0 0", height: "50%" };
  return { inset: 0 };
}
