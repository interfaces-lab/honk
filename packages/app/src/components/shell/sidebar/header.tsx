import { IconCollaborationPointerRight, IconFolderAddRight } from "central-icons";
import type { DragEvent } from "react";

import { SidebarButton } from "@honk/honkkit/sidebar";

import { SIDEBAR_CHAT_DRAG_MIME_TYPE } from "../agents/sidebar/drag-and-drop";

function attachNewAgentDragPreview(event: DragEvent<HTMLElement>): void {
  const source = event.currentTarget;
  source.dataset.dragging = "true";

  const clearDragging = () => {
    delete source.dataset.dragging;
    window.removeEventListener("dragend", clearDragging, true);
    window.removeEventListener("drop", clearDragging, true);
  };
  window.addEventListener("dragend", clearDragging, true);
  window.addEventListener("drop", clearDragging, true);

  const preview = source.cloneNode(true);
  if (!(preview instanceof HTMLElement)) return;

  preview.classList.add("glass-sidebar-agent-drag-preview");
  preview.dataset.dragPreview = "true";
  preview.style.left = "0";
  preview.style.position = "fixed";
  preview.style.top = "-1000px";
  preview.style.width = `${source.getBoundingClientRect().width}px`;
  document.body.append(preview);
  event.dataTransfer.setDragImage(preview, 12, 12);
  window.setTimeout(() => preview.remove(), 0);
}

function writeNewAgentDragPayload(event: DragEvent<HTMLElement>): void {
  event.stopPropagation();
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData(SIDEBAR_CHAT_DRAG_MIME_TYPE, JSON.stringify({ kind: "new-agent" }));
  event.dataTransfer.setData("text/plain", "New Agent");
  attachNewAgentDragPreview(event);
}

export function ShellSidebarHeader(props: { onNewChat: () => void; onAddProject?: () => void }) {
  return (
    <div className="relative z-30 flex shrink-0 select-none flex-col gap-1 px-2 pt-2 pb-1.5">
      <div className="flex min-h-[22px] min-w-0 items-center gap-0.5">
        <SidebarButton
          variant="chrome"
          draggable
          onClick={props.onNewChat}
          onDragStart={writeNewAgentDragPayload}
          className="flex-1 text-honk-fg-secondary hover:bg-honk-bg-quaternary hover:text-honk-fg-primary [-webkit-user-drag:element]"
          data-agent-sidebar-cell=""
          data-testid="new-thread-button"
        >
          <IconCollaborationPointerRight className="size-4 shrink-0 opacity-65" />
          <span className="min-w-0 flex-1 truncate">New Agent</span>
          <span className="shrink-0 text-right text-caption text-honk-fg-quaternary">⌘N</span>
        </SidebarButton>
      </div>
      {props.onAddProject ? (
        <div className="flex min-h-[22px] min-w-0 w-full items-center gap-0.5">
          <SidebarButton
            variant="chrome"
            onClick={props.onAddProject}
            className="w-full flex-1 text-honk-fg-secondary hover:bg-honk-bg-quaternary hover:text-honk-fg-primary"
            aria-label="Open workspace"
            data-testid="sidebar-add-project-trigger"
          >
            <IconFolderAddRight className="size-4 shrink-0 opacity-65" />
            <span className="min-w-0 flex-1 truncate">Open Workspace</span>
          </SidebarButton>
        </div>
      ) : null}
    </div>
  );
}
