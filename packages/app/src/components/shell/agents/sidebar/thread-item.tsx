import { DESKTOP_RUNTIME_ENVIRONMENT_ID, scopedThreadKey } from "~/lib/environment-scope";
import type { ScopedThreadRef } from "@honk/shared/environment";
import { SidebarButton, SidebarItem } from "@honk/honkkit/sidebar";
import { IconArchive1, IconCrossMedium, IconPin, IconUnpin } from "central-icons";
import {
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { resolveThreadCopyId } from "~/routes/-thread-route-targets";
import { useComposerDraftStore } from "~/stores/chat-drafts";
import { useUiStateStore } from "~/stores/ui-state-store";
import { ThreadContextMenu } from "./context-menu";
import { SIDEBAR_CHAT_DRAG_MIME_TYPE, type SidebarChatDragPayload } from "./drag-and-drop";
import { SidebarIconButton, SidebarItemTime, SidebarItemTitle } from "./item-parts";
import { StatusSlot } from "./status";
import type { SidebarChatItem } from "./types";
import { composerDraftHasVisibleContent } from "./use-agent-sidebar-model";
import { deriveSidebarDraftTitle } from "./view-model";

type DraftSidebarChatItem = Extract<SidebarChatItem, { kind: "draft" }>;
type ThreadSidebarChatItem = Extract<SidebarChatItem, { kind: "thread" }>;
type CommitThreadRename = (
  target: ScopedThreadRef,
  nextTitle: string,
  originalTitle: string,
) => Promise<void>;
type ArchiveThread = (target: ScopedThreadRef) => Promise<void>;
type CloneThread = (target: ScopedThreadRef, cwd: string) => Promise<void>;

function useDraftSidebarTitle(item: DraftSidebarChatItem): string {
  return useComposerDraftStore((store) => {
    const draft = store.draftsByThreadKey[item.id];
    if (!draft) return item.title;
    if (!composerDraftHasVisibleContent(draft) && item.title.trim().length > 0) {
      return item.title;
    }
    const firstAttachment = draft.images[0];
    return deriveSidebarDraftTitle({
      text: draft.prompt,
      attachmentCount: draft.images.length,
      firstAttachmentName: firstAttachment?.name ?? null,
    });
  });
}

function sidebarChatDragPayload(item: SidebarChatItem): SidebarChatDragPayload {
  return item.kind === "thread"
    ? {
        environmentId: item.environmentId,
        kind: "thread",
        threadId: item.id,
      }
    : {
        draftId: item.id,
        kind: "draft",
      };
}

function attachSidebarChatDragPreview(event: DragEvent<HTMLElement>): void {
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

function writeSidebarChatDragPayload(event: DragEvent<HTMLElement>, item: SidebarChatItem): void {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest("[data-no-drag]")) {
    event.preventDefault();
    return;
  }
  const payload = sidebarChatDragPayload(item);
  event.stopPropagation();
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData(SIDEBAR_CHAT_DRAG_MIME_TYPE, JSON.stringify(payload));
  event.dataTransfer.setData("text/plain", item.title);
  attachSidebarChatDragPreview(event);
}

function AgentSidebarDraftItem(props: {
  item: DraftSidebarChatItem;
  selected: boolean;
  onSelectAgent: (id: string) => void;
  onClearDraft: (id: string) => void;
}) {
  const title = useDraftSidebarTitle(props.item);
  const selectThread = () => {
    props.onSelectAgent(props.item.id);
  };
  const clearDraft = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    props.onClearDraft(props.item.id);
  };

  return (
    <SidebarItem
      render={<div />}
      selected={props.selected}
      draggable
      className="group/sidebar-item data-[selected=true]:focus-within:bg-honk-bg-tertiary [-webkit-user-drag:element]"
      data-agent-sidebar-cell=""
      data-agent-sidebar-row-shell=""
      onDragStart={(event) => writeSidebarChatDragPayload(event, props.item)}
      onClick={selectThread}
      tabIndex={-1}
    >
      <StatusSlot item={props.item} />
      <SidebarButton variant="inset" data-chat-item="">
        <SidebarItemTitle title={title} selected={props.selected} />
      </SidebarButton>
      <div className="group-focus-within/sidebar-item:hidden [@media(hover:hover)]:group-hover/sidebar-item:hidden">
        <SidebarItemTime ago={props.item.ago} selected={props.selected} />
      </div>
      <div className="hidden shrink-0 items-center group-focus-within/sidebar-item:flex [@media(hover:hover)]:group-hover/sidebar-item:flex">
        <SidebarItemTime ago={props.item.ago} compact selected={props.selected} />
        <span className="size-5 shrink-0" aria-hidden />
        <SidebarIconButton
          label="Clear draft"
          onClick={clearDraft}
          data-agent-sidebar-clear-draft-action=""
          data-no-drag=""
        >
          <IconCrossMedium className="size-4 shrink-0" aria-hidden />
        </SidebarIconButton>
      </div>
    </SidebarItem>
  );
}

export function AgentSidebarThreadItem(props: {
  item: SidebarChatItem;
  selected: boolean;
  archiveThread: ArchiveThread;
  unarchiveThread: ArchiveThread;
  cloneThread: CloneThread;
  commitRename: CommitThreadRename;
  onSelectAgent: (id: string) => void;
  onClearDraft: (id: string) => void;
}) {
  if (props.item.kind === "draft") {
    return (
      <AgentSidebarDraftItem
        item={props.item}
        selected={props.selected}
        onSelectAgent={props.onSelectAgent}
        onClearDraft={props.onClearDraft}
      />
    );
  }

  return (
    <AgentSidebarServerThreadItem
      item={props.item}
      selected={props.selected}
      archiveThread={props.archiveThread}
      unarchiveThread={props.unarchiveThread}
      cloneThread={props.cloneThread}
      commitRename={props.commitRename}
      onSelectAgent={props.onSelectAgent}
    />
  );
}

function AgentSidebarServerThreadItem(props: {
  item: ThreadSidebarChatItem;
  selected: boolean;
  archiveThread: ArchiveThread;
  unarchiveThread: ArchiveThread;
  cloneThread: CloneThread;
  commitRename: CommitThreadRename;
  onSelectAgent: (id: string) => void;
}) {
  const { item, onSelectAgent } = props;
  const targetThreadRef = props.item.threadRef;
  const markThreadUnread = useUiStateStore((store) => store.markThreadUnread);
  const setThreadPinned = useUiStateStore((store) => store.setThreadPinned);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const committedRef = useRef(false);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const renameStartTimerRef = useRef<number | null>(null);

  const selectThread = () => {
    onSelectAgent(item.id);
  };

  useEffect(() => {
    if (!renaming) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const input = renameInputRef.current;
      input?.focus();
      input?.select();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [renaming]);

  useEffect(() => {
    return () => {
      if (renameStartTimerRef.current !== null) {
        window.clearTimeout(renameStartTimerRef.current);
      }
    };
  }, []);

  const finishRename = () => {
    setRenaming(false);
    committedRef.current = false;
  };

  const applyRename = async () => {
    const next = renameValue.trim();
    if (next.length === 0) {
      toast.warning("Thread title cannot be empty");
      finishRename();
      return;
    }
    if (next === props.item.title) {
      finishRename();
      return;
    }
    try {
      await props.commitRename(targetThreadRef, next, props.item.title);
    } catch (error) {
      toast.error("Failed to rename thread", {
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    } finally {
      finishRename();
    }
  };

  const onBlur = () => {
    if (committedRef.current) {
      committedRef.current = false;
      return;
    }
    void applyRename();
  };

  const onRenameKeyDown = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      committedRef.current = true;
      void applyRename();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      committedRef.current = true;
      finishRename();
    }
  };

  const threadItem = props.item;
  const toggleArchiveThread = () => {
    if (threadItem.archived) {
      void props.unarchiveThread(targetThreadRef).catch((error) => {
        toast.error("Failed to unarchive thread", {
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      });
      return;
    }
    void props.archiveThread(targetThreadRef).catch((error) => {
      toast.error("Failed to archive thread", {
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    });
  };
  const archiveCurrentThread = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    toggleArchiveThread();
  };
  const toggleThreadPinned = () => {
    setThreadPinned(scopedThreadKey(targetThreadRef), !threadItem.pinned);
  };
  const forkChat = () => {
    void props.cloneThread(targetThreadRef, threadItem.cwd).catch((error) => {
      toast.error("Failed to fork chat", {
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    });
  };
  const togglePinnedThread = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    toggleThreadPinned();
  };
  const startRename = () => {
    const title = threadItem.title;
    if (renameStartTimerRef.current !== null) {
      window.clearTimeout(renameStartTimerRef.current);
    }
    renameStartTimerRef.current = window.setTimeout(() => {
      renameStartTimerRef.current = null;
      setRenameValue(title);
      setRenaming(true);
    }, 0);
  };

  if (renaming) {
    return (
      <SidebarItem
        interactive={false}
        className="cursor-(--honk-button-cursor) border-honk-stroke-primary bg-honk-bg-tertiary"
        data-agent-sidebar-cell=""
        data-renaming="true"
      >
        <StatusSlot item={props.item} />
        <input
          ref={renameInputRef}
          type="text"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={onRenameKeyDown}
          onBlur={onBlur}
          onClick={(e) => e.stopPropagation()}
          className="min-w-0 flex-1 select-text bg-transparent text-foreground outline-hidden ring-0"
          aria-label="Rename thread"
        />
        <SidebarItemTime ago={props.item.ago} selected={props.selected} />
      </SidebarItem>
    );
  }

  return (
    <ThreadContextMenu
      threadId={resolveThreadCopyId(targetThreadRef)}
      onRename={startRename}
      onMarkUnread={() => {
        markThreadUnread(scopedThreadKey(targetThreadRef), threadItem.latestReadableAt);
      }}
      archived={threadItem.archived}
      pinned={threadItem.pinned}
      canForkChat={targetThreadRef.environmentId === DESKTOP_RUNTIME_ENVIRONMENT_ID}
      onTogglePinned={toggleThreadPinned}
      onForkChat={forkChat}
      onArchive={toggleArchiveThread}
    >
      <SidebarItem
        render={<div />}
        selected={props.selected}
        draggable
        className="group/sidebar-item data-popup-open:bg-honk-bg-quaternary data-[selected=true]:focus-within:bg-honk-bg-tertiary data-[selected=true]:data-popup-open:bg-honk-bg-tertiary [-webkit-user-drag:element]"
        data-agent-sidebar-cell=""
        data-agent-sidebar-row-shell=""
        onDragStart={(event) => writeSidebarChatDragPayload(event, props.item)}
        onClick={selectThread}
        tabIndex={-1}
      >
        <StatusSlot item={props.item} />
        <SidebarButton variant="inset" data-chat-item="">
          <SidebarItemTitle
            title={props.item.title}
            selected={props.selected}
            muted={threadItem.archived}
          />
        </SidebarButton>
        <div className="hidden shrink-0 items-center group-focus-within/sidebar-item:flex group-data-[popup-open]/sidebar-item:flex [@media(hover:hover)]:group-hover/sidebar-item:flex">
          <SidebarItemTime ago={props.item.ago} compact selected={props.selected} />
          <SidebarIconButton
            label={threadItem.pinned ? "Unpin" : "Pin"}
            onClick={togglePinnedThread}
            data-agent-sidebar-pin-action=""
            data-no-drag=""
          >
            {threadItem.pinned ? (
              <IconUnpin className="size-4 shrink-0" aria-hidden />
            ) : (
              <IconPin className="size-4 shrink-0" aria-hidden />
            )}
          </SidebarIconButton>
          <SidebarIconButton
            label={threadItem.archived ? "Unarchive" : "Archive"}
            onClick={archiveCurrentThread}
            data-agent-sidebar-archive-action=""
            data-no-drag=""
          >
            <IconArchive1 className="size-4 shrink-0" aria-hidden />
          </SidebarIconButton>
        </div>
      </SidebarItem>
    </ThreadContextMenu>
  );
}
