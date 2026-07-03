import { EnvironmentId } from "@honk/shared/environment";
import { ThreadId } from "@honk/shared/base-schemas";
import { describe, expect, it } from "vitest";

import { DraftId } from "~/stores/chat-drafts";

import {
  createAgentPanelData,
  createChatPaneTileset,
  nextPanelIdForTileset,
  splitTile,
} from "./chat-pane-tiling";
import {
  chatPaneTilesetIdForRouteKey,
  chatPaneTilingActions,
  chatPaneTilingRouteKeyForTarget,
  getChatPaneTileset,
} from "./chat-pane-tiling-store";

const target = {
  environmentId: EnvironmentId.make("env:tiling-store"),
  routeKind: "server",
  threadId: ThreadId.make("thread:tiling-store"),
} as const;

describe("chat pane tiling store", () => {
  it("stores tilesets by route key", () => {
    const routeKey = chatPaneTilingRouteKeyForTarget(target);
    chatPaneTilingActions.clearRouteTileset(routeKey);

    const initial = createChatPaneTileset({
      data: createAgentPanelData(target),
      panelId: "panel-1",
      tilesetId: chatPaneTilesetIdForRouteKey(routeKey),
    });
    chatPaneTilingActions.setRouteTileset(routeKey, initial);

    expect(getChatPaneTileset(routeKey)?.tilesetId).toBe(chatPaneTilesetIdForRouteKey(routeKey));

    chatPaneTilingActions.clearRouteTileset(routeKey);
    expect(getChatPaneTileset(routeKey)).toBeNull();
  });

  it("allocates the next panel id from current persisted ids", () => {
    const initial = createChatPaneTileset({
      data: createAgentPanelData(target),
      panelId: "panel-1",
      tilesetId: "tileset:test",
    });
    const split = splitTile(
      initial,
      "panel-1",
      "horizontal",
      { draftId: "draft", kind: "empty" },
      "panel-4",
    );

    expect(nextPanelIdForTileset(split)).toBe("panel-5");
  });

  it("promotes draft route tilesets to the server route", () => {
    const draftTarget = {
      draftId: DraftId.make("draft:route"),
      environmentId: EnvironmentId.make("env:tiling-store"),
      routeKind: "draft",
      threadId: ThreadId.make("thread:draft"),
    } as const;
    const draftRouteKey = chatPaneTilingRouteKeyForTarget(draftTarget);
    const serverRouteKey = chatPaneTilingRouteKeyForTarget(target);
    chatPaneTilingActions.clearRouteTileset(draftRouteKey);
    chatPaneTilingActions.clearRouteTileset(serverRouteKey);

    const draftTileset = createChatPaneTileset({
      data: createAgentPanelData(draftTarget),
      panelId: "panel-1",
      tilesetId: chatPaneTilesetIdForRouteKey(draftRouteKey),
    });
    chatPaneTilingActions.setRouteTileset(draftRouteKey, draftTileset);
    chatPaneTilingActions.promoteDraftTilesets(draftTarget.draftId, {
      environmentId: target.environmentId,
      threadId: target.threadId,
    });

    expect(getChatPaneTileset(draftRouteKey)).toBeNull();
    expect(getChatPaneTileset(serverRouteKey)?.panels["panel-1"]?.data).toEqual(
      createAgentPanelData(target),
    );

    chatPaneTilingActions.clearRouteTileset(serverRouteKey);
  });
});
