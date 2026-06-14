import type { ContextMenuOpenContext } from "@pierre/trees";
import { describe, expect, it } from "vitest";

import { resolveFileTreeContextMenuPosition } from "./project-file-tree-context-menu-position";

type AnchorRect = ContextMenuOpenContext["anchorRect"];

function anchorRect(input: Partial<AnchorRect> & Pick<AnchorRect, "left" | "top">): AnchorRect {
  const width = input.width ?? 0;
  const height = input.height ?? 0;
  const right = input.right ?? input.left + width;
  const bottom = input.bottom ?? input.top + height;
  return {
    bottom,
    height,
    left: input.left,
    right,
    top: input.top,
    width,
    x: input.x ?? input.left,
    y: input.y ?? input.top,
  };
}

describe("resolveFileTreeContextMenuPosition", () => {
  it("keeps right-click menus at the pointer origin when there is room", () => {
    expect(
      resolveFileTreeContextMenuPosition({
        anchorRect: anchorRect({ left: 240, top: 180 }),
        menuSize: { width: 128, height: 88 },
        viewport: { width: 800, height: 600 },
      }),
    ).toEqual({ left: 240, top: 180 });
  });

  it("places row-anchored menus below the row when there is room", () => {
    expect(
      resolveFileTreeContextMenuPosition({
        anchorRect: anchorRect({ left: 32, top: 100, width: 220, height: 22 }),
        menuSize: { width: 128, height: 88 },
        viewport: { width: 800, height: 600 },
      }),
    ).toEqual({ left: 32, top: 124 });
  });

  it("clamps menus to the right viewport edge", () => {
    expect(
      resolveFileTreeContextMenuPosition({
        anchorRect: anchorRect({ left: 760, top: 180 }),
        menuSize: { width: 160, height: 88 },
        viewport: { width: 800, height: 600 },
      }),
    ).toEqual({ left: 632, top: 180 });
  });

  it("flips menus above a bottom-edge row anchor", () => {
    expect(
      resolveFileTreeContextMenuPosition({
        anchorRect: anchorRect({ left: 32, top: 560, width: 220, height: 22 }),
        menuSize: { width: 128, height: 120 },
        viewport: { width: 800, height: 600 },
      }),
    ).toEqual({ left: 32, top: 438 });
  });

  it("keeps oversized menus pinned to the safe viewport margin", () => {
    expect(
      resolveFileTreeContextMenuPosition({
        anchorRect: anchorRect({ left: 760, top: 560 }),
        menuSize: { width: 900, height: 700 },
        viewport: { width: 800, height: 600 },
      }),
    ).toEqual({ left: 8, top: 8 });
  });
});
