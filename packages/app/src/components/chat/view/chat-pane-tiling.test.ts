import { EnvironmentId, ThreadId } from "@honk/contracts";
import { describe, expect, it } from "vitest";

import { DraftId } from "~/stores/chat-drafts";

import {
  closeFocusedTile,
  createAgentPanelData,
  createChatPaneTileset,
  dropAgentOnPanel,
  dropAgentOnSelectedAgent,
  flattenPanelIds,
  focusAdjacentTile,
  getDisallowedDropZones,
  getDropOverlayBounds,
  navigateToAgent,
  placeAgentOnPanel,
  retargetDraftPanelsToServer,
  setFocusedPanel,
  splitActiveTile,
  splitTile,
  type ChatPanePanelData,
} from "./chat-pane-tiling";

const firstTarget = {
  environmentId: EnvironmentId.make("env:test"),
  routeKind: "server",
  threadId: ThreadId.make("thread:first"),
} as const;

const secondTarget = {
  environmentId: EnvironmentId.make("env:test"),
  routeKind: "server",
  threadId: ThreadId.make("thread:second"),
} as const;

function emptyData(id: string): ChatPanePanelData {
  return { draftId: id, kind: "empty" };
}

function initialTileset() {
  return createChatPaneTileset({
    data: createAgentPanelData(firstTarget),
    panelId: "panel-1",
    tilesetId: "tileset-test",
  });
}

describe("chat pane tiling controller", () => {
  it("splitTile adds a focused panel after the target", () => {
    const tileset = splitTile(
      initialTileset(),
      "panel-1",
      "horizontal",
      emptyData("draft"),
      "panel-2",
    );

    expect(flattenPanelIds(tileset.layout)).toEqual(["panel-1", "panel-2"]);
    expect(tileset.focusedPanelId).toBe("panel-2");
    expect(tileset.panels["panel-2"]?.data.kind).toBe("empty");
  });

  it("splitActiveTile splits the focused panel", () => {
    const firstSplit = splitTile(
      initialTileset(),
      "panel-1",
      "horizontal",
      createAgentPanelData(secondTarget),
      "panel-2",
    );
    const secondSplit = splitActiveTile(firstSplit, "vertical", emptyData("draft"), "panel-3");

    expect(flattenPanelIds(secondSplit.layout)).toEqual(["panel-1", "panel-2", "panel-3"]);
    expect(secondSplit.focusedPanelId).toBe("panel-3");
  });

  it("dropAgentOnPanel moves an existing panel into the requested zone", () => {
    const tileset = splitTile(
      initialTileset(),
      "panel-1",
      "horizontal",
      createAgentPanelData(secondTarget),
      "panel-2",
    );
    const moved = dropAgentOnPanel(
      tileset,
      "panel-1",
      { kind: "panel", managerId: "tileset-test", panelId: "panel-2" },
      "left",
    );

    expect(flattenPanelIds(moved.layout)).toEqual(["panel-2", "panel-1"]);
    expect(moved.focusedPanelId).toBe("panel-2");
  });

  it("placeAgentOnPanel creates edge tiles and replaces on center", () => {
    const placed = placeAgentOnPanel(
      initialTileset(),
      "panel-1",
      createAgentPanelData(secondTarget),
      "right",
      "panel-2",
    );
    const replaced = placeAgentOnPanel(
      placed,
      "panel-1",
      emptyData("replacement"),
      "center",
      "panel-3",
    );

    expect(flattenPanelIds(placed.layout)).toEqual(["panel-1", "panel-2"]);
    expect(placed.focusedPanelId).toBe("panel-2");
    expect(replaced.panels["panel-1"]?.data).toEqual(emptyData("replacement"));
    expect(flattenPanelIds(replaced.layout)).toEqual(["panel-1", "panel-2"]);
  });

  it("dropAgentOnSelectedAgent places external agent data on the focused panel", () => {
    const tileset = dropAgentOnSelectedAgent(
      initialTileset(),
      createAgentPanelData(secondTarget),
      "right",
      "panel-2",
    );

    expect(flattenPanelIds(tileset.layout)).toEqual(["panel-1", "panel-2"]);
    expect(tileset.focusedPanelId).toBe("panel-2");
    expect(tileset.panels["panel-2"]?.data).toEqual(createAgentPanelData(secondTarget));
  });

  it("dropAgentOnSelectedAgent can duplicate the focused agent for standalone edge drops", () => {
    const tileset = dropAgentOnSelectedAgent(
      initialTileset(),
      createAgentPanelData(firstTarget),
      "right",
      "panel-2",
      { allowDuplicateTargetAgent: true },
    );

    expect(flattenPanelIds(tileset.layout)).toEqual(["panel-1", "panel-2"]);
    expect(tileset.focusedPanelId).toBe("panel-2");
    expect(tileset.panels["panel-1"]?.data).toEqual(createAgentPanelData(firstTarget));
    expect(tileset.panels["panel-2"]?.data).toEqual(createAgentPanelData(firstTarget));
  });

  it("placeAgentOnPanel refuses to duplicate a draft target even when duplication is allowed", () => {
    const draftTarget = {
      draftId: DraftId.make("draft:solo"),
      environmentId: EnvironmentId.make("env:test"),
      routeKind: "draft",
      threadId: ThreadId.make("thread:draft-solo"),
    } as const;
    const base = createChatPaneTileset({
      data: createAgentPanelData(draftTarget),
      panelId: "panel-1",
      tilesetId: "tileset-test",
    });
    const result = placeAgentOnPanel(
      base,
      "panel-1",
      createAgentPanelData(draftTarget),
      "right",
      "panel-2",
      { allowDuplicateTargetAgent: true },
    );

    expect(flattenPanelIds(result.layout)).toEqual(["panel-1"]);
    expect(result.panels["panel-2"]).toBeUndefined();
  });

  it("getDropOverlayBounds maps zones to half or full panel bounds", () => {
    expect(getDropOverlayBounds("left")).toEqual({ inset: "0 auto 0 0", width: "50%" });
    expect(getDropOverlayBounds("top")).toEqual({ height: "50%", inset: "0 0 auto 0" });
    expect(getDropOverlayBounds("center")).toEqual({ inset: 0 });
  });

  it("closeFocusedTile collapses the layout and keeps a remaining panel focused", () => {
    const tileset = splitTile(
      initialTileset(),
      "panel-1",
      "horizontal",
      emptyData("draft"),
      "panel-2",
    );
    const closed = closeFocusedTile(tileset);

    expect(flattenPanelIds(closed.layout)).toEqual(["panel-1"]);
    expect(closed.focusedPanelId).toBe("panel-1");
    expect(closed.panels["panel-2"]).toBeUndefined();
  });

  it("focusAdjacentTile and navigateToAgent focus by panel order and agent id", () => {
    const tileset = splitTile(
      initialTileset(),
      "panel-1",
      "horizontal",
      createAgentPanelData(secondTarget),
      "panel-2",
    );
    const focusedFirst = focusAdjacentTile(tileset, 1);
    const focusedSecond = navigateToAgent(focusedFirst, "server:env:test:thread:second");

    expect(focusedFirst.focusedPanelId).toBe("panel-1");
    expect(focusedSecond.focusedPanelId).toBe("panel-2");
  });

  it("setFocusedPanel updates focus and getDisallowedDropZones blocks inward drops", () => {
    const tileset = splitTile(
      initialTileset(),
      "panel-1",
      "horizontal",
      createAgentPanelData(secondTarget),
      "panel-2",
    );

    expect(setFocusedPanel(tileset, "panel-1").focusedPanelId).toBe("panel-1");
    expect(setFocusedPanel(tileset, "missing")).toBe(tileset);
    expect([...getDisallowedDropZones(tileset, "panel-1", "panel-2")]).toEqual(["left"]);
    expect([...getDisallowedDropZones(tileset, "panel-2", "panel-1")]).toEqual(["right"]);
  });

  it("retargetDraftPanelsToServer rewrites promoted draft panels", () => {
    const draftTarget = {
      draftId: DraftId.make("draft:split"),
      environmentId: EnvironmentId.make("env:test"),
      routeKind: "draft",
      threadId: ThreadId.make("thread:draft"),
    } as const;
    const tileset = splitTile(
      initialTileset(),
      "panel-1",
      "horizontal",
      createAgentPanelData(draftTarget),
      "panel-2",
    );
    const retargeted = retargetDraftPanelsToServer(tileset, draftTarget.draftId, secondTarget);

    expect(retargeted.panels["panel-2"]?.data).toEqual(createAgentPanelData(secondTarget));
    expect(retargeted.panels["panel-1"]?.data).toEqual(tileset.panels["panel-1"]?.data);
  });
});
