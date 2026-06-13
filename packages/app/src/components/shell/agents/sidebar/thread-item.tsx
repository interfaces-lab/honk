import { scopedThreadKey } from "~/lib/environment-scope";
import type { ScopedThreadRef } from "@honk/contracts";
import { SidebarButton, SidebarItem } from "@honk/honkkit/sidebar";
import { IconArchive1, IconPin, IconUnpin } from "central-icons";
import { type KeyboardEvent, memo, type MouseEvent, useRef, useState } from "react";
import { toast } from "sonner";

import { resolveThreadCopyId } from "~/routes/-thread-route-targets";
import { useComposerDraftStore } from "~/stores/chat-drafts";
import { useUiStateStore } from "~/stores/ui-state-store";
import { ThreadContextMenu } from "./context-menu";
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

const AgentSidebarDraftItem = memo(function AgentSidebarDraftItem(props: {
  item: DraftSidebarChatItem;
  selected: boolean;
  onSelectAgent: (id: string) => void;
  onPrefetchAgent?: (id: string) => void;
}) {
  const title = useDraftSidebarTitle(props.item);
  const selectThread = () => {
    props.onSelectAgent(props.item.id);
  };

  return (
    <SidebarButton
      variant="item"
      data-selected={props.selected}
      data-chat-item=""
      data-agent-sidebar-cell=""
      onFocus={() => props.onPrefetchAgent?.(props.item.id)}
      onPointerEnter={() => props.onPrefetchAgent?.(props.item.id)}
      onClick={selectThread}
    >
      <StatusSlot item={props.item} />
      <SidebarItemTitle title={title} selected={props.selected} />
      <SidebarItemTime ago={props.item.ago} selected={props.selected} />
    </SidebarButton>
  );
});

function focusRenameInput(node: HTMLInputElement | null) {
  if (!node) return;
  node.focus();
  node.select();
}

export const AgentSidebarThreadItem = memo(function AgentSidebarThreadItem(props: {
  item: SidebarChatItem;
  selected: boolean;
  archiveThread: ArchiveThread;
  unarchiveThread: ArchiveThread;
  commitRename: CommitThreadRename;
  onSelectAgent: (id: string) => void;
  onPrefetchAgent?: (id: string) => void;
}) {
  if (props.item.kind === "draft") {
    return (
      <AgentSidebarDraftItem
        item={props.item}
        selected={props.selected}
        onSelectAgent={props.onSelectAgent}
        {...(props.onPrefetchAgent ? { onPrefetchAgent: props.onPrefetchAgent } : {})}
      />
    );
  }

  return (
    <AgentSidebarServerThreadItem
      item={props.item}
      selected={props.selected}
      archiveThread={props.archiveThread}
      unarchiveThread={props.unarchiveThread}
      commitRename={props.commitRename}
      onSelectAgent={props.onSelectAgent}
      {...(props.onPrefetchAgent ? { onPrefetchAgent: props.onPrefetchAgent } : {})}
    />
  );
});

const AgentSidebarServerThreadItem = memo(function AgentSidebarServerThreadItem(props: {
  item: ThreadSidebarChatItem;
  selected: boolean;
  archiveThread: ArchiveThread;
  unarchiveThread: ArchiveThread;
  commitRename: CommitThreadRename;
  onSelectAgent: (id: string) => void;
  onPrefetchAgent?: (id: string) => void;
}) {
  const { item, onSelectAgent } = props;
  const targetThreadRef = props.item.threadRef;
  const markThreadUnread = useUiStateStore((store) => store.markThreadUnread);
  const setThreadPinned = useUiStateStore((store) => store.setThreadPinned);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const committedRef = useRef(false);

  const selectThread = () => {
    onSelectAgent(item.id);
  };

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
  const togglePinnedThread = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setThreadPinned(scopedThreadKey(targetThreadRef), !threadItem.pinned);
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
          ref={focusRenameInput}
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
      onRename={() => {
        setRenaming(true);
        setRenameValue(threadItem.title);
      }}
      onMarkUnread={() => {
        markThreadUnread(scopedThreadKey(targetThreadRef), threadItem.latestReadableAt);
      }}
      archived={threadItem.archived}
      onArchive={toggleArchiveThread}
    >
      <SidebarItem
        render={<div />}
        selected={props.selected}
        className="group/sidebar-item data-popup-open:bg-honk-bg-quaternary data-[selected=true]:focus-within:bg-honk-bg-tertiary data-[selected=true]:data-popup-open:bg-honk-bg-tertiary"
        data-agent-sidebar-cell=""
        data-agent-sidebar-row-shell=""
        onClick={selectThread}
        tabIndex={-1}
      >
        <StatusSlot item={props.item} />
        <SidebarButton
          variant="inset"
          data-chat-item=""
          onFocus={() => props.onPrefetchAgent?.(props.item.id)}
          onPointerEnter={() => props.onPrefetchAgent?.(props.item.id)}
        >
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
          >
            <IconArchive1 className="size-4 shrink-0" aria-hidden />
          </SidebarIconButton>
        </div>
      </SidebarItem>
    </ThreadContextMenu>
  );
});
