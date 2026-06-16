import {
  ContextMenu,
  ContextMenuTrigger,
  WorkbenchContextMenuItem,
  WorkbenchContextMenuPopup,
  WorkbenchContextMenuSeparator,
} from "@honk/honkkit/context-menu";
import {
  IconArchive1,
  IconBell,
  IconBranch,
  IconCheckmark1Small,
  IconClipboard,
  IconCode,
  IconEditSmall1,
  IconPin,
  IconTrashCan,
  IconUnpin,
} from "central-icons";
import { useRef, type ReactElement } from "react";

function useContextMenuTriggerFocus() {
  const triggerRef = useRef<HTMLDivElement | null>(null);

  const setTriggerRef = (element: HTMLDivElement | null) => {
    triggerRef.current = element;
  };

  const handleOpenChange = (open: boolean) => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    if (!open) {
      const active = document.activeElement;
      if (active instanceof HTMLElement && trigger.contains(active)) {
        active.blur();
      }
      return;
    }

    const focusTarget =
      trigger.tabIndex >= 0
        ? trigger
        : (trigger.querySelector<HTMLElement>("[tabindex]:not([tabindex='-1'])") ??
          trigger.querySelector<HTMLElement>("[tabindex]"));
    focusTarget?.focus({ preventScroll: true });
  };

  return { handleOpenChange, setTriggerRef };
}

export function ThreadContextMenu(props: {
  children: ReactElement;
  threadId: string;
  archived: boolean;
  pinned: boolean;
  canForkChat: boolean;
  onRename: () => void;
  onMarkUnread: () => void;
  onTogglePinned: () => void;
  onForkChat: () => void;
  onArchive: () => void;
}) {
  const { handleOpenChange, setTriggerRef } = useContextMenuTriggerFocus();

  return (
    <ContextMenu data-slot="context-menu-root" onOpenChange={handleOpenChange}>
      <ContextMenuTrigger ref={setTriggerRef} render={props.children} />
      <WorkbenchContextMenuPopup positionerClassName="z-(--z-index-sidebar-context-menu)">
        <WorkbenchContextMenuItem
          label={props.pinned ? "Unpin" : "Pin"}
          onClick={props.onTogglePinned}
          icon={
            props.pinned ? <IconUnpin aria-hidden /> : <IconPin aria-hidden />
          }
        >
          {props.pinned ? "Unpin" : "Pin"}
        </WorkbenchContextMenuItem>
        <WorkbenchContextMenuItem
          label="Rename"
          onClick={props.onRename}
          icon={<IconEditSmall1 aria-hidden />}
        >
          Rename
        </WorkbenchContextMenuItem>
        <WorkbenchContextMenuItem
          label="Mark as unread"
          onClick={props.onMarkUnread}
          icon={<IconBell aria-hidden />}
        >
          Mark as unread
        </WorkbenchContextMenuItem>
        {props.canForkChat ? (
          <>
            <WorkbenchContextMenuSeparator />
            <WorkbenchContextMenuItem
              label="Fork Chat"
              onClick={props.onForkChat}
              icon={<IconBranch aria-hidden />}
            >
              Fork Chat
            </WorkbenchContextMenuItem>
          </>
        ) : null}
        <WorkbenchContextMenuItem
          label="Copy Thread ID"
          onClick={() => void navigator.clipboard.writeText(props.threadId)}
          icon={<IconClipboard aria-hidden />}
        >
          Copy Thread ID
        </WorkbenchContextMenuItem>
        <WorkbenchContextMenuSeparator />
        <WorkbenchContextMenuItem
          label={props.archived ? "Unarchive" : "Archive"}
          onClick={props.onArchive}
          icon={<IconArchive1 aria-hidden />}
        >
          {props.archived ? "Unarchive" : "Archive"}
        </WorkbenchContextMenuItem>
      </WorkbenchContextMenuPopup>
    </ContextMenu>
  );
}

export function SidebarSectionContextMenu(props: {
  children: ReactElement;
  hasThreads: boolean;
  canOpenInEditor: boolean;
  canRemoveProject: boolean;
  onOpenInEditor: () => void;
  onMarkAllRead: () => void;
  onArchiveAll: () => void;
  onRemoveFromSidebar: () => void;
}) {
  const { handleOpenChange, setTriggerRef } = useContextMenuTriggerFocus();

  return (
    <ContextMenu data-slot="context-menu-root" onOpenChange={handleOpenChange}>
      <ContextMenuTrigger ref={setTriggerRef} render={props.children} />
      <WorkbenchContextMenuPopup positionerClassName="z-(--z-index-sidebar-context-menu)">
        {props.canOpenInEditor ? (
          <WorkbenchContextMenuItem
            label="Open in Editor Window"
            onClick={props.onOpenInEditor}
            icon={<IconCode aria-hidden />}
          >
            Open in Editor Window
          </WorkbenchContextMenuItem>
        ) : null}
        <WorkbenchContextMenuItem
          label="Mark All as Read"
          onClick={props.onMarkAllRead}
          disabled={!props.hasThreads}
          icon={<IconCheckmark1Small aria-hidden />}
        >
          Mark All as Read
        </WorkbenchContextMenuItem>
        <WorkbenchContextMenuItem
          label="Archive All"
          onClick={props.onArchiveAll}
          disabled={!props.hasThreads}
          icon={<IconArchive1 aria-hidden />}
        >
          Archive All
        </WorkbenchContextMenuItem>
        {props.canRemoveProject ? (
          <>
            <WorkbenchContextMenuSeparator />
            <WorkbenchContextMenuItem
              label="Remove from Sidebar"
              onClick={props.onRemoveFromSidebar}
              icon={<IconTrashCan aria-hidden />}
            >
              Remove from Sidebar
            </WorkbenchContextMenuItem>
          </>
        ) : null}
      </WorkbenchContextMenuPopup>
    </ContextMenu>
  );
}
