export type SidebarDropPosition = "before" | "after";

export type SidebarDragPayload = {
  sectionId: string;
  projectOrderKeys: readonly string[];
};

export type SidebarDropTarget = SidebarDragPayload & {
  position: SidebarDropPosition;
};
