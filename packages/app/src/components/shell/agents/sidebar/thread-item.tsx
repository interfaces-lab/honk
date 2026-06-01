import { scopedThreadKey } from "@multi/client-runtime";
import { SidebarButton, SidebarItem } from "@multi/ui/sidebar";
import { IconArchive1, IconPin, IconUnpin } from "central-icons";
import {
  type KeyboardEvent,
  type MouseEvent,
  memo,
  useCallback,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { useThreadActions } from "~/hooks/use-thread-actions";
import { useComposerDraftStore } from "~/stores/chat-drafts";
import { useUiStateStore } from "~/stores/ui-state-store";
import { ThreadContextMenu } from "./context-menu";
import { SidebarIconButton, SidebarItemTime, SidebarItemTitle } from "./item-parts";
import { StatusSlot } from "./status";
import type { SidebarChatItem } from "./types";
import { deriveSidebarDraftTitle } from "./view-model";

type DraftSidebarChatItem = Extract<SidebarChatItem, { kind: "draft" }>;

function useDraftSidebarTitle(item: DraftSidebarChatItem): string {
  return useComposerDraftStore((store) => {
    const draft = store.draftsByThreadKey[item.id];
    if (!draft) return item.title;
    const firstAttachment = draft.images[0] ?? draft.persistedAttachments[0];
    return deriveSidebarDraftTitle({
      text: draft.prompt,
      attachmentCount: draft.images.length + draft.persistedAttachments.length,
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
  const selectThread = useCallback(() => {
    props.onSelectAgent(props.item.id);
  }, [props.item.id, props.onSelectAgent]);

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

export const AgentSidebarThreadItem = memo(
  function AgentSidebarThreadItem(props: {
    item: SidebarChatItem;
    selected: boolean;
    onSelectAgent: (id: string) => void;
    onPrefetchAgent?: (id: string) => void;
  }) {
    const { commitRename, archiveThread } = useThreadActions();
    const { item, onSelectAgent } = props;
    const targetThreadRef = props.item.kind === "thread" ? props.item.threadRef : null;
    const markThreadUnread = useUiStateStore((store) => store.markThreadUnread);
    const setThreadPinned = useUiStateStore((store) => store.setThreadPinned);
    const [renaming, setRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState("");
    const committedRef = useRef(false);

    const selectThread = useCallback(() => {
      onSelectAgent(item.id);
    }, [item.id, onSelectAgent]);

    const focusRenameInput = useCallback((node: HTMLInputElement | null) => {
      if (!node) return;
      node.focus();
      node.select();
    }, []);

    const finishRename = useCallback(() => {
      setRenaming(false);
      committedRef.current = false;
    }, []);

    const applyRename = useCallback(async () => {
      if (props.item.kind !== "thread") return;
      if (!targetThreadRef) {
        finishRename();
        return;
      }
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
        await commitRename(targetThreadRef, next, props.item.title);
      } catch (error) {
        toast.error("Failed to rename thread", {
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      } finally {
        finishRename();
      }
    }, [commitRename, finishRename, props.item, renameValue, targetThreadRef]);

    const onBlur = useCallback(() => {
      if (props.item.kind !== "thread") return;
      if (committedRef.current) {
        committedRef.current = false;
        return;
      }
      void applyRename();
    }, [applyRename, props.item.kind]);

    const onRenameKeyDown = useCallback(
      (event: KeyboardEvent) => {
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
      },
      [applyRename, finishRename],
    );

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

    const threadItem = props.item;
    const archiveCurrentThread = (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (!targetThreadRef) {
        return;
      }
      void archiveThread(targetThreadRef).catch((error) => {
        toast.error("Failed to archive thread", {
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      });
    };
    const togglePinnedThread = (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (!targetThreadRef) {
        return;
      }
      setThreadPinned(scopedThreadKey(targetThreadRef), !threadItem.pinned);
    };
    if (renaming) {
      return (
        <SidebarItem
          render={<div />}
          interactive={false}
          className="cursor-(--multi-button-cursor) border-multi-stroke-primary bg-multi-bg-tertiary"
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
            className="min-w-0 flex-1 select-text bg-transparent text-foreground outline-none ring-0"
            aria-label="Rename thread"
          />
          <SidebarItemTime ago={props.item.ago} selected={props.selected} />
        </SidebarItem>
      );
    }

    return (
      <ThreadContextMenu
        threadId={threadItem.id}
        onRename={() => {
          setRenaming(true);
          setRenameValue(threadItem.title);
        }}
        onMarkUnread={() => {
          if (!targetThreadRef) {
            return;
          }
          markThreadUnread(scopedThreadKey(targetThreadRef), threadItem.latestReadableAt);
        }}
        onArchive={() => {
          if (!targetThreadRef) return;
          void archiveThread(targetThreadRef).catch((error) => {
            toast.error("Failed to archive thread", {
              description: error instanceof Error ? error.message : "An error occurred.",
            });
          });
        }}
      >
        <SidebarItem
          render={<div />}
          selected={props.selected}
          className="group/sidebar-item data-popup-open:bg-multi-bg-quaternary data-[selected=true]:focus-within:bg-multi-bg-tertiary data-[selected=true]:data-popup-open:bg-multi-bg-tertiary"
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
            <SidebarItemTitle title={props.item.title} selected={props.selected} />
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
              label="Archive"
              onClick={archiveCurrentThread}
              data-agent-sidebar-archive-action=""
            >
              <IconArchive1 className="size-4 shrink-0" aria-hidden />
            </SidebarIconButton>
          </div>
        </SidebarItem>
      </ThreadContextMenu>
    );
  },
  (left, right) =>
    left.item === right.item &&
    left.selected === right.selected &&
    left.onSelectAgent === right.onSelectAgent &&
    left.onPrefetchAgent === right.onPrefetchAgent,
);
