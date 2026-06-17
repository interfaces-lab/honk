export type SidebarDropPosition = "before" | "after";

export const SIDEBAR_CHAT_DRAG_MIME_TYPE = "application/x-honk-sidebar-chat-agent";

export function dragTransferTypes(transfer: DataTransfer): readonly string[] {
  return Array.from(transfer.types);
}

export type SidebarDragPayload = {
  sectionId: string;
  projectOrderKeys: readonly string[];
};

export type SidebarDropTarget = SidebarDragPayload & {
  position: SidebarDropPosition;
};

export type SidebarChatDragPayload =
  | {
      kind: "new-agent";
    }
  | {
      kind: "thread";
      environmentId: string;
      threadId: string;
    }
  | {
      draftId: string;
      kind: "draft";
    };
