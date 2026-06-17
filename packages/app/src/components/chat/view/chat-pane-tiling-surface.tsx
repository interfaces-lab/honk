"use client";

import { EnvironmentId, ThreadId } from "@honk/contracts";
import { IconDotGrid1x3Horizontal } from "central-icons";
import type { DragEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";

import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "@honk/honkkit/menu";
import { workbenchIconButtonVariants } from "@honk/honkkit/workbench-button";

import { scopedThreadKey } from "~/lib/environment-scope";
import {
  dragTransferTypes,
  SIDEBAR_CHAT_DRAG_MIME_TYPE,
  type SidebarChatDragPayload,
} from "~/components/shell/agents/sidebar/drag-and-drop";
import { cn, newThreadId } from "~/lib/utils";
import { deriveSidebarDraftTitle } from "~/components/shell/agents/sidebar/view-model";
import {
  DraftId,
  finalizePromotedDraftThreadByRef,
  useComposerDraftStore,
} from "~/stores/chat-drafts";
import { selectThreadRouteLifecycleSurfaceByRef } from "~/stores/thread-selectors";
import { useThreadSendIntentStore } from "~/stores/thread-send-intent-store";
import { selectEnvironmentState, useStore } from "~/stores/thread-store";
import { DEFAULT_INTERACTION_MODE } from "~/types";

import ChatView, { type ChatViewProps } from "./chat-view";
import {
  calculateDropZone,
  closeTile,
  createAgentPanelData,
  createChatPaneTileset,
  dropAgentOnPanel,
  dropAgentOnSelectedAgent,
  expandAgent,
  flattenPanelIds,
  getDisallowedDropZones,
  getDropOverlayBounds,
  nextPanelIdForTileset,
  placeAgentOnPanel,
  setFocusedPanel,
  splitTile,
  type ChatPaneSplitDirection,
  type ChatPaneDropZone,
  type ChatPaneLayoutNode,
  type ChatPanePanelData,
  type ChatPanePanelDragPayload,
  type ChatPaneTarget,
  type ChatPaneTileset,
} from "./chat-pane-tiling";
import {
  chatPaneTilesetIdForRouteKey,
  chatPaneTilingActions,
  chatPaneTilingRouteKeyForTarget,
  useChatPaneTileset,
} from "./chat-pane-tiling-store";

const TILING_PANEL_MIME_TYPE = "application/x-honk-agent-tiling-panel";
const SIDEBAR_DROP_DISALLOWED_ZONES: ReadonlySet<ChatPaneDropZone> = new Set(["center"]);

type ChatPaneTilingSurfaceProps = ChatViewProps;

function targetFromProps(props: ChatPaneTilingSurfaceProps): ChatPaneTarget {
  return props.routeKind === "server"
    ? {
        environmentId: props.environmentId,
        routeKind: "server",
        threadId: props.threadId,
      }
    : {
        draftId: props.draftId,
        environmentId: props.environmentId,
        routeKind: "draft",
        threadId: props.threadId,
      };
}

function sidebarChatDragPayloadForTarget(target: ChatPaneTarget): SidebarChatDragPayload {
  return target.routeKind === "server"
    ? {
        environmentId: String(target.environmentId),
        kind: "thread",
        threadId: String(target.threadId),
      }
    : {
        draftId: String(target.draftId),
        kind: "draft",
      };
}

function attachChatViewDragPreview(event: DragEvent<HTMLElement>, title: string): void {
  const source = event.currentTarget;
  source.dataset.dragging = "true";

  const clearDragging = () => {
    delete source.dataset.dragging;
    window.removeEventListener("dragend", clearDragging, true);
    window.removeEventListener("drop", clearDragging, true);
  };
  window.addEventListener("dragend", clearDragging, true);
  window.addEventListener("drop", clearDragging, true);

  const sourceRect = source.getBoundingClientRect();
  const preview = document.createElement("div");
  preview.className = "glass-sidebar-agent-drag-preview glass-chat-view-drag-preview";
  preview.dataset.dragPreview = "true";
  preview.textContent = title;
  preview.style.left = "0";
  preview.style.position = "fixed";
  preview.style.top = "-1000px";
  preview.style.width = `${Math.min(Math.max(sourceRect.width * 0.42, 180), 360)}px`;
  document.body.append(preview);
  event.dataTransfer.setDragImage(preview, 12, 12);
  window.setTimeout(() => preview.remove(), 0);
}

function writeChatViewDragPayload(
  event: DragEvent<HTMLElement>,
  target: ChatPaneTarget,
  title: string,
): void {
  const dragTitle = title.trim() || "Agent";
  const eventTarget = event.target instanceof Element ? event.target : null;
  if (eventTarget?.closest("[data-no-drag]")) {
    event.preventDefault();
    return;
  }
  event.stopPropagation();
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData(
    SIDEBAR_CHAT_DRAG_MIME_TYPE,
    JSON.stringify(sidebarChatDragPayloadForTarget(target)),
  );
  event.dataTransfer.setData("text/plain", dragTitle);
  attachChatViewDragPreview(event, dragTitle);
}

function resolvePanelDrop(input: {
  readonly clientX: number;
  readonly clientY: number;
  readonly rect: DOMRect;
  readonly targetPanelId: string;
  readonly tileset: ChatPaneTileset;
  readonly transfer: DataTransfer;
}): { readonly payload: ChatPanePanelDragPayload; readonly zone: ChatPaneDropZone } | null {
  const payload = readPanelDragPayloadFromTransfer(input.transfer);
  if (
    !payload ||
    payload.managerId !== input.tileset.managerId ||
    payload.panelId === input.targetPanelId ||
    !input.tileset.panels[payload.panelId] ||
    !input.tileset.panels[input.targetPanelId]
  ) {
    return null;
  }

  const zone = calculateDropZone({
    clientX: input.clientX,
    clientY: input.clientY,
    disallowedZones: getDisallowedDropZones(input.tileset, payload.panelId, input.targetPanelId),
    rect: input.rect,
  });
  return zone ? { payload, zone } : null;
}

function readPanelDragPayloadFromTransfer(transfer: DataTransfer): ChatPanePanelDragPayload | null {
  const raw = transfer.getData(TILING_PANEL_MIME_TYPE);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ChatPanePanelDragPayload>;
    return parsed.kind === "panel" &&
      typeof parsed.managerId === "string" &&
      typeof parsed.panelId === "string"
      ? {
          kind: "panel",
          managerId: parsed.managerId,
          panelId: parsed.panelId,
        }
      : null;
  } catch {
    return null;
  }
}

function readSidebarChatDragPayloadFromTransfer(
  transfer: DataTransfer,
): SidebarChatDragPayload | null {
  const raw = transfer.getData(SIDEBAR_CHAT_DRAG_MIME_TYPE);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SidebarChatDragPayload>;
    if (
      parsed.kind === "thread" &&
      typeof parsed.environmentId === "string" &&
      typeof parsed.threadId === "string"
    ) {
      return {
        environmentId: parsed.environmentId,
        kind: "thread",
        threadId: parsed.threadId,
      };
    }
    if (parsed.kind === "draft" && typeof parsed.draftId === "string") {
      return {
        draftId: parsed.draftId,
        kind: "draft",
      };
    }
    if (parsed.kind === "new-agent") {
      return {
        kind: "new-agent",
      };
    }
    return null;
  } catch {
    return null;
  }
}

function resolveSidebarChatDragOver(input: {
  readonly allowSameAgent?: boolean;
  readonly clientX: number;
  readonly clientY: number;
  readonly disallowedZones?: ReadonlySet<ChatPaneDropZone> | undefined;
  readonly rect: DOMRect;
  readonly targetData: ChatPanePanelData;
  readonly transfer: DataTransfer;
}):
  | {
      readonly data: ChatPanePanelData;
      readonly source: "payload";
      readonly zone: ChatPaneDropZone;
    }
  | {
      readonly source: "type";
      readonly zone: ChatPaneDropZone;
    }
  | null {
  const payload = readSidebarChatDragPayloadFromTransfer(input.transfer);
  if (payload) {
    const data = panelDataFromSidebarChatPayload(payload, input.targetData);
    if (
      !data ||
      (!input.allowSameAgent && agentIdForPanelData(data) === agentIdForPanelData(input.targetData))
    ) {
      return null;
    }

    const zone = calculateDropZone({
      clientX: input.clientX,
      clientY: input.clientY,
      disallowedZones: input.disallowedZones,
      rect: input.rect,
    });
    return zone ? { data, source: "payload", zone } : null;
  }

  if (!dragTransferTypes(input.transfer).includes(SIDEBAR_CHAT_DRAG_MIME_TYPE)) {
    return null;
  }
  const zone = calculateDropZone({
    clientX: input.clientX,
    clientY: input.clientY,
    disallowedZones: input.disallowedZones,
    rect: input.rect,
  });
  return zone ? { source: "type", zone } : null;
}

function environmentIdForPanelData(data: ChatPanePanelData): EnvironmentId | null {
  return data.kind === "agent" ? data.target.environmentId : null;
}

function createNewAgentPanelData(environmentId: EnvironmentId): ChatPanePanelData {
  const threadId = newThreadId();
  const draftId = DraftId.make(`chat-pane-draft:${threadId}`);
  useComposerDraftStore.getState().setProjectlessDraftThreadId(environmentId, draftId, {
    threadId,
    createdAt: new Date().toISOString(),
    interactionMode: DEFAULT_INTERACTION_MODE,
  });
  return createAgentPanelData({
    draftId,
    environmentId,
    routeKind: "draft",
    threadId,
  });
}

function panelDataFromSidebarChatPayload(
  payload: SidebarChatDragPayload,
  targetData: ChatPanePanelData,
): ChatPanePanelData | null {
  if (payload.kind === "new-agent") {
    const targetEnvironmentId = environmentIdForPanelData(targetData);
    return targetEnvironmentId ? createNewAgentPanelData(targetEnvironmentId) : null;
  }

  if (payload.kind === "thread") {
    return createAgentPanelData({
      environmentId: EnvironmentId.make(payload.environmentId),
      routeKind: "server",
      threadId: ThreadId.make(payload.threadId),
    });
  }

  const draftId = DraftId.make(payload.draftId);
  const draftSession = useComposerDraftStore.getState().getDraftSession(draftId);
  if (!draftSession) {
    return null;
  }
  return createAgentPanelData({
    draftId,
    environmentId: draftSession.environmentId,
    routeKind: "draft",
    threadId: draftSession.threadId,
  });
}

function agentIdForPanelData(data: ChatPanePanelData): string | null {
  return data.kind === "agent" ? data.agentId : null;
}

function resolveSidebarChatDrop(input: {
  readonly allowSameAgent?: boolean | undefined;
  readonly clientX: number;
  readonly clientY: number;
  readonly disallowedZones?: ReadonlySet<ChatPaneDropZone> | undefined;
  readonly rect: DOMRect;
  readonly targetData: ChatPanePanelData;
  readonly transfer: DataTransfer;
}): { readonly data: ChatPanePanelData; readonly zone: ChatPaneDropZone } | null {
  const payload = readSidebarChatDragPayloadFromTransfer(input.transfer);
  if (!payload) return null;
  const data = panelDataFromSidebarChatPayload(payload, input.targetData);
  if (
    !data ||
    (!input.allowSameAgent && agentIdForPanelData(data) === agentIdForPanelData(input.targetData))
  ) {
    return null;
  }

  const zone = calculateDropZone({
    clientX: input.clientX,
    clientY: input.clientY,
    disallowedZones: input.disallowedZones,
    rect: input.rect,
  });
  return zone ? { data, zone } : null;
}

function tileTitle(data: ChatPanePanelData, title: string | null): string {
  if (data.kind === "empty") return "New Agent";
  if (data.kind === "loading") return "Loading";
  if (title) return title;
  return data.target.routeKind === "draft" ? "New Agent" : "Agent";
}

function useTileTitle(data: ChatPanePanelData): string {
  const serverThreadTitle = useStore((store) => {
    if (data.kind !== "agent" || data.target.routeKind !== "server") {
      return null;
    }
    return (
      selectEnvironmentState(store, data.target.environmentId).threadShellById[data.target.threadId]
        ?.title ?? null
    );
  });
  const draftTitle = useComposerDraftStore((store) => {
    if (data.kind !== "agent" || data.target.routeKind !== "draft") {
      return null;
    }
    const draftSession = store.getDraftSession(data.target.draftId);
    const promotedTitle = draftSession?.promotedTitle?.trim();
    if (promotedTitle) {
      return promotedTitle;
    }
    const draft = store.getComposerDraft(data.target.draftId);
    return draft
      ? deriveSidebarDraftTitle({
          attachmentCount: draft.images.length,
          firstAttachmentName: draft.images[0]?.name ?? null,
          text: draft.prompt,
        })
      : null;
  });
  return tileTitle(data, serverThreadTitle ?? draftTitle);
}

function TilingSystemDropOverlay(props: { readonly zone: ChatPaneDropZone }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-1000" aria-hidden>
      <div
        className="ui-tiling-drop-overlay-highlight"
        data-zone={props.zone}
        style={getDropOverlayBounds(props.zone)}
      />
    </div>
  );
}

function PromotedDraftTileSync(props: { readonly target: ChatPaneTarget }) {
  const promotedThreadRef = useComposerDraftStore((store) =>
    props.target.routeKind === "draft"
      ? (store.getDraftSession(props.target.draftId)?.promotedTo ?? null)
      : null,
  );
  const hasRenderableUserStart = useStore((store) =>
    promotedThreadRef
      ? (selectThreadRouteLifecycleSurfaceByRef(store, promotedThreadRef)?.hasRenderableUserStart ??
        false)
      : false,
  );
  const draftId = props.target.routeKind === "draft" ? props.target.draftId : null;

  useEffect(() => {
    if (props.target.routeKind !== "draft" || !draftId || !promotedThreadRef || !hasRenderableUserStart) {
      return;
    }
    chatPaneTilingActions.promoteDraftTilesets(draftId, promotedThreadRef);
    const finalizedDraftRefs = finalizePromotedDraftThreadByRef(promotedThreadRef);
    const threadSendIntentStore = useThreadSendIntentStore.getState();
    for (const draftThreadRef of finalizedDraftRefs) {
      threadSendIntentStore.clearLocalSendArtifactsForThread(scopedThreadKey(draftThreadRef));
    }
  }, [draftId, hasRenderableUserStart, promotedThreadRef, props.target.routeKind]);

  return null;
}

function EmptyChatTile() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center text-body text-honk-fg-tertiary">
      New Agent
    </div>
  );
}

function StandaloneChatDropTarget(props: {
  readonly children: ReactNode;
  readonly onDropSidebarChat: (data: ChatPanePanelData, zone: ChatPaneDropZone) => void;
  readonly routeTarget: ChatPaneTarget;
}) {
  const [dropZone, setDropZone] = useState<ChatPaneDropZone | null>(null);
  const targetData = useMemo(() => createAgentPanelData(props.routeTarget), [props.routeTarget]);

  const allowSameAgent = props.routeTarget.routeKind === "server";

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const resolvedDrop = resolveSidebarChatDragOver({
      allowSameAgent,
      clientX: event.clientX,
      clientY: event.clientY,
      disallowedZones: SIDEBAR_DROP_DISALLOWED_ZONES,
      rect,
      targetData,
      transfer: event.dataTransfer,
    });
    if (!resolvedDrop) {
      setDropZone(null);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDropZone(resolvedDrop.zone);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const resolvedDrop = resolveSidebarChatDrop({
      allowSameAgent,
      clientX: event.clientX,
      clientY: event.clientY,
      disallowedZones: SIDEBAR_DROP_DISALLOWED_ZONES,
      rect,
      targetData,
      transfer: event.dataTransfer,
    });
    if (!resolvedDrop) {
      setDropZone(null);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    props.onDropSidebarChat(resolvedDrop.data, resolvedDrop.zone);
    setDropZone(null);
  };

  return (
    <div
      className="glass-agent-drop-target relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-(--honk-chat-surface-background)"
      data-drop-active={dropZone ? "true" : undefined}
      onDragLeave={(event) => {
        const nextTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
        if (nextTarget && event.currentTarget.contains(nextTarget)) return;
        setDropZone(null);
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {props.children}
      {dropZone ? <TilingSystemDropOverlay zone={dropZone} /> : null}
    </div>
  );
}

export function ChatPaneTilingSurface(props: ChatPaneTilingSurfaceProps) {
  const routeTarget = useMemo(
    () => targetFromProps(props),
    [
      props.routeKind,
      props.environmentId,
      props.threadId,
      props.routeKind === "draft" ? props.draftId : null,
    ],
  );
  const routeKey = chatPaneTilingRouteKeyForTarget(routeTarget);
  const tileset = useChatPaneTileset(routeKey);
  const routePanelData = useMemo(() => createAgentPanelData(routeTarget), [routeTarget]);
  const routeTitle = useTileTitle(routePanelData);

  const createInitialTileset = useCallback(() => {
    return createChatPaneTileset({
      data: routePanelData,
      panelId: "panel-1",
      tilesetId: chatPaneTilesetIdForRouteKey(routeKey),
    });
  }, [routeKey, routePanelData]);

  const handleCloseTile = useCallback(
    (panelId: string) => {
      chatPaneTilingActions.updateRouteTileset(routeKey, (current) => {
        if (!current) return current;
        const next = closeTile(current, panelId);
        const panelIds = flattenPanelIds(next.layout);
        const remainingPanel = panelIds.length === 1 ? next.panels[panelIds[0] ?? ""] : null;
        return remainingPanel?.data.kind === "agent" &&
          chatPaneTilingRouteKeyForTarget(remainingPanel.data.target) === routeKey
          ? null
          : next;
      });
    },
    [routeKey],
  );

  const handleFocusTile = useCallback(
    (panelId: string) => {
      chatPaneTilingActions.updateRouteTileset(routeKey, (current) =>
        current ? setFocusedPanel(current, panelId) : current,
      );
    },
    [routeKey],
  );

  const handleExpandAgent = useCallback(
    (panelId: string) => {
      chatPaneTilingActions.updateRouteTileset(routeKey, (current) =>
        current ? expandAgent(current, panelId) : current,
      );
    },
    [routeKey],
  );

  const handleSplitTile = useCallback(
    (panelId: string, direction: ChatPaneSplitDirection) => {
      chatPaneTilingActions.updateRouteTileset(routeKey, (current) => {
        if (!current) return current;
        const panel = current.panels[panelId];
        const environmentId = panel
          ? (environmentIdForPanelData(panel.data) ?? routeTarget.environmentId)
          : routeTarget.environmentId;
        return splitTile(
          current,
          panelId,
          direction,
          createNewAgentPanelData(environmentId),
          nextPanelIdForTileset(current),
        );
      });
    },
    [routeKey, routeTarget.environmentId],
  );

  const handleDropAgentOnPanel = useCallback(
    (targetPanelId: string, payload: ChatPanePanelDragPayload, zone: ChatPaneDropZone) => {
      chatPaneTilingActions.updateRouteTileset(routeKey, (current) =>
        current ? dropAgentOnPanel(current, targetPanelId, payload, zone) : current,
      );
    },
    [routeKey],
  );

  const handlePlaceAgentOnPanel = useCallback(
    (targetPanelId: string, data: ChatPanePanelData, zone: ChatPaneDropZone) => {
      chatPaneTilingActions.updateRouteTileset(routeKey, (current) =>
        current
          ? placeAgentOnPanel(current, targetPanelId, data, zone, nextPanelIdForTileset(current))
          : current,
      );
    },
    [routeKey],
  );

  const handleDropSidebarChatOnStandalone = useCallback(
    (data: ChatPanePanelData, zone: ChatPaneDropZone) => {
      chatPaneTilingActions.updateRouteTileset(routeKey, (current) => {
        const base = current ?? createInitialTileset();
        return dropAgentOnSelectedAgent(base, data, zone, nextPanelIdForTileset(base), {
          allowDuplicateTargetAgent: true,
        });
      });
    },
    [createInitialTileset, routeKey],
  );

  const handleContentPaneTopBarDragStart = useCallback(
    (event: DragEvent<HTMLElement>) => {
      writeChatViewDragPayload(event, routeTarget, routeTitle);
    },
    [routeTarget, routeTitle],
  );

  if (!tileset) {
    return (
      <StandaloneChatDropTarget
        routeTarget={routeTarget}
        onDropSidebarChat={handleDropSidebarChatOnStandalone}
      >
        <ChatView
          {...props}
          contentPaneTopBarTitle={routeTitle}
          onContentPaneTopBarDragStart={handleContentPaneTopBarDragStart}
        />
      </StandaloneChatDropTarget>
    );
  }

  const expandedPanelId = tileset.expandedPanelId;
  const layout =
    expandedPanelId && tileset.panels[expandedPanelId]
      ? ({ kind: "leaf", panelId: expandedPanelId } satisfies ChatPaneLayoutNode)
      : tileset.layout;

  return (
    <div className="glass-agent-conversation-tiling flex min-h-0 min-w-0 flex-1 overflow-hidden bg-(--honk-chat-surface-background)">
      {renderTilingNode({
        expandedPanelId: tileset.expandedPanelId,
        focusedPanelId: tileset.focusedPanelId,
        layout,
        onCloseTile: handleCloseTile,
        onDropAgentOnPanel: handleDropAgentOnPanel,
        onExpandAgent: handleExpandAgent,
        onFocusTile: handleFocusTile,
        onPlaceAgentOnPanel: handlePlaceAgentOnPanel,
        onSplitTile: handleSplitTile,
        panelCount: flattenPanelIds(tileset.layout).length,
        panels: tileset.panels,
        touchesLeftEdge: true,
        touchesRightEdge: true,
        touchesTopEdge: true,
        tileset,
      })}
    </div>
  );
}

function renderTilingNode(input: {
  readonly expandedPanelId: string | null;
  readonly focusedPanelId: string;
  readonly layout: ChatPaneLayoutNode;
  readonly onCloseTile: (panelId: string) => void;
  readonly onDropAgentOnPanel: (
    targetPanelId: string,
    payload: ChatPanePanelDragPayload,
    zone: ChatPaneDropZone,
  ) => void;
  readonly onExpandAgent: (panelId: string) => void;
  readonly onFocusTile: (panelId: string) => void;
  readonly onPlaceAgentOnPanel: (
    targetPanelId: string,
    data: ChatPanePanelData,
    zone: ChatPaneDropZone,
  ) => void;
  readonly onSplitTile: (panelId: string, direction: ChatPaneSplitDirection) => void;
  readonly panelCount: number;
  readonly panels: Readonly<Record<string, { readonly data: ChatPanePanelData }>>;
  readonly touchesLeftEdge: boolean;
  readonly touchesRightEdge: boolean;
  readonly touchesTopEdge: boolean;
  readonly tileset: ChatPaneTileset;
}): ReactNode {
  if (input.layout.kind === "split") {
    const firstChildEdges =
      input.layout.direction === "horizontal"
        ? {
            touchesLeftEdge: input.touchesLeftEdge,
            touchesRightEdge: false,
            touchesTopEdge: input.touchesTopEdge,
          }
        : {
            touchesLeftEdge: input.touchesLeftEdge,
            touchesRightEdge: input.touchesRightEdge,
            touchesTopEdge: input.touchesTopEdge,
          };
    const secondChildEdges =
      input.layout.direction === "horizontal"
        ? {
            touchesLeftEdge: false,
            touchesRightEdge: input.touchesRightEdge,
            touchesTopEdge: input.touchesTopEdge,
          }
        : {
            touchesLeftEdge: input.touchesLeftEdge,
            touchesRightEdge: input.touchesRightEdge,
            touchesTopEdge: false,
          };
    return (
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 overflow-hidden",
          input.layout.direction === "horizontal" ? "flex-row" : "flex-col",
        )}
        data-tiling-split-direction={input.layout.direction}
      >
        {renderTilingNode({ ...input, ...firstChildEdges, layout: input.layout.children[0] })}
        {renderTilingNode({ ...input, ...secondChildEdges, layout: input.layout.children[1] })}
      </div>
    );
  }

  const panel = input.panels[input.layout.panelId];
  if (!panel) return null;
  return (
    <ChatTilePanel
      key={input.layout.panelId}
      data={panel.data}
      focused={input.focusedPanelId === input.layout.panelId}
      isExpanded={input.expandedPanelId === input.layout.panelId}
      panelCount={input.panelCount}
      panelId={input.layout.panelId}
      touchesLeftEdge={input.touchesLeftEdge}
      touchesRightEdge={input.touchesRightEdge}
      touchesTopEdge={input.touchesTopEdge}
      tileset={input.tileset}
      onCloseTile={input.onCloseTile}
      onDropAgentOnPanel={input.onDropAgentOnPanel}
      onExpandAgent={input.onExpandAgent}
      onFocusTile={input.onFocusTile}
      onPlaceAgentOnPanel={input.onPlaceAgentOnPanel}
      onSplitTile={input.onSplitTile}
    />
  );
}

function ChatTileOverflowMenu(props: {
  readonly isExpanded: boolean;
  readonly onCloseTile: () => void;
  readonly onExpandAgent: () => void;
  readonly onSplitDown: () => void;
  readonly onSplitRight: () => void;
  readonly panelCount: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger
        type="button"
        aria-expanded={open}
        aria-label="Chat actions"
        className={workbenchIconButtonVariants({ active: open, chrome: "panel" })}
        data-active={open}
        data-chrome="panel"
        data-no-drag=""
        data-shell-no-drag=""
        data-slot="workbench-icon-button"
        data-tab-system={false}
        title="Chat actions"
      >
        <IconDotGrid1x3Horizontal className="size-4 shrink-0" aria-hidden />
      </MenuTrigger>
      <MenuPopup
        align="end"
        className="min-w-44"
        positionerClassName="z-(--z-index-workbench-menu)"
        sideOffset={4}
        variant="workbench"
      >
        <MenuItem onClick={props.onSplitRight} variant="workbench">
          Split right
        </MenuItem>
        <MenuItem onClick={props.onSplitDown} variant="workbench">
          Split below
        </MenuItem>
        <MenuSeparator className="my-1" variant="workbench" />
        <MenuItem
          disabled={props.panelCount <= 1}
          onClick={props.onExpandAgent}
          variant="workbench"
        >
          {props.isExpanded ? "Restore tiles" : "Maximize tile"}
        </MenuItem>
        <MenuItem disabled={props.panelCount <= 1} onClick={props.onCloseTile} variant="workbench">
          Close
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

function ChatTilePanel(props: {
  readonly data: ChatPanePanelData;
  readonly focused: boolean;
  readonly isExpanded: boolean;
  readonly onCloseTile: (panelId: string) => void;
  readonly onDropAgentOnPanel: (
    targetPanelId: string,
    payload: ChatPanePanelDragPayload,
    zone: ChatPaneDropZone,
  ) => void;
  readonly onExpandAgent: (panelId: string) => void;
  readonly onFocusTile: (panelId: string) => void;
  readonly onPlaceAgentOnPanel: (
    targetPanelId: string,
    data: ChatPanePanelData,
    zone: ChatPaneDropZone,
  ) => void;
  readonly onSplitTile: (panelId: string, direction: ChatPaneSplitDirection) => void;
  readonly panelCount: number;
  readonly panelId: string;
  readonly touchesLeftEdge: boolean;
  readonly touchesRightEdge: boolean;
  readonly touchesTopEdge: boolean;
  readonly tileset: ChatPaneTileset;
}) {
  const [dropZone, setDropZone] = useState<ChatPaneDropZone | null>(null);
  const title = useTileTitle(props.data);
  const dragPayload: ChatPanePanelDragPayload = {
    kind: "panel",
    managerId: props.tileset.managerId,
    panelId: props.panelId,
  };

  const onDragOver = (event: DragEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const resolvedPanelDrop = resolvePanelDrop({
      clientX: event.clientX,
      clientY: event.clientY,
      rect,
      targetPanelId: props.panelId,
      tileset: props.tileset,
      transfer: event.dataTransfer,
    });
    const resolvedSidebarDrop = resolvedPanelDrop
      ? null
      : resolveSidebarChatDragOver({
          clientX: event.clientX,
          clientY: event.clientY,
          rect,
          targetData: props.data,
          transfer: event.dataTransfer,
        });
    const resolvedSidebarZone = resolvedSidebarDrop?.zone ?? null;
    const resolvedZone = resolvedPanelDrop?.zone ?? resolvedSidebarZone;
    if (!resolvedZone) {
      setDropZone(null);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDropZone(resolvedZone);
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const resolvedSidebarDrop = resolveSidebarChatDrop({
      clientX: event.clientX,
      clientY: event.clientY,
      rect,
      targetData: props.data,
      transfer: event.dataTransfer,
    });
    if (resolvedSidebarDrop) {
      event.preventDefault();
      event.stopPropagation();
      props.onPlaceAgentOnPanel(props.panelId, resolvedSidebarDrop.data, resolvedSidebarDrop.zone);
      setDropZone(null);
      return;
    }

    const resolvedDrop = resolvePanelDrop({
      clientX: event.clientX,
      clientY: event.clientY,
      rect,
      targetPanelId: props.panelId,
      tileset: props.tileset,
      transfer: event.dataTransfer,
    });
    if (!resolvedDrop) {
      setDropZone(null);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    props.onDropAgentOnPanel(props.panelId, resolvedDrop.payload, resolvedDrop.zone);
    setDropZone(null);
  };

  return (
    <section
      aria-label={`Panel ${props.panelId}`}
      className="glass-agent-drop-target ui-tiling-panel relative flex min-h-0 min-w-[260px] flex-1 flex-col overflow-hidden bg-(--honk-chat-surface-background)"
      data-drop-active={dropZone ? "true" : undefined}
      data-focused={props.focused ? "true" : "false"}
      onDragLeave={(event) => {
        const nextTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
        if (nextTarget && event.currentTarget.contains(nextTarget)) return;
        setDropZone(null);
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onFocusCapture={() => {
        if (!props.focused) {
          props.onFocusTile(props.panelId);
        }
      }}
      onPointerDownCapture={(event) => {
        if (event.button !== 0) return;
        if (!props.focused) {
          flushSync(() => {
            props.onFocusTile(props.panelId);
          });
        }
      }}
      role="group"
    >
      <div
        className="glass-agent-conversation-tiling__header flex h-(--honk-workbench-chrome-row-height) shrink-0 select-none items-center gap-1 px-2 text-honk-chrome"
        data-tiling-left-edge={props.touchesLeftEdge ? "true" : "false"}
        data-tiling-right-edge={props.touchesRightEdge ? "true" : "false"}
        data-tiling-top-edge={props.touchesTopEdge ? "true" : "false"}
        draggable
        onDragStart={(event) => {
          const target = event.target instanceof Element ? event.target : null;
          if (target?.closest("[data-no-drag]")) {
            event.preventDefault();
            return;
          }
          event.stopPropagation();
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData(TILING_PANEL_MIME_TYPE, JSON.stringify(dragPayload));
          event.dataTransfer.setData("text/plain", title);
          attachChatViewDragPreview(event, title);
        }}
      >
        <div className="min-w-0 flex-1 truncate">{title}</div>
        <div className="flex shrink-0 items-center" data-no-drag="" data-shell-no-drag="">
          <ChatTileOverflowMenu
            isExpanded={props.isExpanded}
            panelCount={props.panelCount}
            onCloseTile={() => props.onCloseTile(props.panelId)}
            onExpandAgent={() => props.onExpandAgent(props.panelId)}
            onSplitDown={() => props.onSplitTile(props.panelId, "vertical")}
            onSplitRight={() => props.onSplitTile(props.panelId, "horizontal")}
          />
        </div>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {props.data.kind === "agent" ? (
          <>
            <PromotedDraftTileSync target={props.data.target} />
            <ChatView
              {...props.data.target}
              autoFocusComposer={false}
              hideContentPaneTopBar
              isActiveSurface={props.focused}
              isTiledSurface
              reserveTitleBarControlInset={false}
            />
          </>
        ) : (
          <EmptyChatTile />
        )}
      </div>
      {dropZone ? <TilingSystemDropOverlay zone={dropZone} /> : null}
    </section>
  );
}
