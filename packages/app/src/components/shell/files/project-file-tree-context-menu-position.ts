import type { ContextMenuOpenContext } from "@pierre/trees";

export type FileTreeContextMenuAnchorRect = ContextMenuOpenContext["anchorRect"];

export type FileTreeContextMenuSize = {
  height: number;
  width: number;
};

export type FileTreeContextMenuViewport = {
  height: number;
  width: number;
};

const FILE_TREE_CONTEXT_MENU_VIEWPORT_MARGIN = 8;
const FILE_TREE_CONTEXT_MENU_OFFSET = 2;

function preferredContextMenuTop(anchorRect: FileTreeContextMenuAnchorRect): number {
  return anchorRect.width === 0 && anchorRect.height === 0
    ? anchorRect.top
    : anchorRect.bottom + FILE_TREE_CONTEXT_MENU_OFFSET;
}

export function resolveFileTreeContextMenuPosition(input: {
  anchorRect: FileTreeContextMenuAnchorRect;
  menuSize: FileTreeContextMenuSize;
  viewport: FileTreeContextMenuViewport;
}): { left: number; top: number } {
  const margin = FILE_TREE_CONTEXT_MENU_VIEWPORT_MARGIN;
  const menuWidth = Math.max(0, input.menuSize.width);
  const menuHeight = Math.max(0, input.menuSize.height);
  const viewportWidth = Math.max(0, input.viewport.width);
  const viewportHeight = Math.max(0, input.viewport.height);
  const maxLeft = viewportWidth - menuWidth - margin;
  const preferredTop = preferredContextMenuTop(input.anchorRect);
  const maxTop = viewportHeight - menuHeight - margin;
  const top =
    preferredTop > maxTop
      ? Math.max(margin, input.anchorRect.top - menuHeight - FILE_TREE_CONTEXT_MENU_OFFSET)
      : Math.max(margin, preferredTop);

  return {
    left: Math.max(margin, Math.min(input.anchorRect.left, maxLeft)),
    top,
  };
}
