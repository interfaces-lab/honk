import { scopeThreadRef } from "@multi/client-runtime";
import type { ThreadId } from "@multi/contracts";
import { IconBell, IconFormCircle } from "central-icons";
import { type KeyboardEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ThreadContextMenu } from "~/components/shell/sidebar/thread-context-menu";
import { RowButton } from "~/components/shell/shared/row-button";
import { useThreadActions } from "~/hooks/use-thread-actions";
import type { SidebarChatItem } from "~/lib/sidebar-chat-view-model";
import { useThreadUnreadStore } from "~/lib/thread-unread-store";
import { cn } from "~/lib/utils";
import { selectThreadsAcrossEnvironments, useStore } from "~/store";

function StatusDot(props: { item: SidebarChatItem }) {
  if (props.item.kind === "draft") {
    return <IconFormCircle className="size-3 shrink-0 text-muted-foreground/50" aria-hidden />;
  }
  if (props.item.state === "running") {
    return (
      <span className="relative flex size-[5.5px] shrink-0 items-center justify-center">
        <span className="absolute size-[11px] animate-ping rounded-full bg-emerald-500/35" />
        <span className="size-[5.5px] rounded-full bg-emerald-500" />
      </span>
    );
  }
  if (props.item.state === "error") {
    return <span className="size-[5.5px] shrink-0 rounded-full bg-destructive/85" aria-hidden />;
  }
  if (props.item.kind === "thread" && props.item.unread) {
    return <IconBell className="size-3 shrink-0 text-muted-foreground/55" aria-hidden />;
  }
  return <span className="size-[5.5px] shrink-0 rounded-full bg-muted-foreground/50" aria-hidden />;
}

export const AgentRow = memo(
  function AgentRow(props: {
    item: SidebarChatItem;
    selected: boolean;
    onSelectAgent: (id: string) => void;
    onPrefetchAgent?: (id: string) => void;
  }) {
    const { commitRename, archiveThread } = useThreadActions();
    const environmentId = useStore((state) =>
      props.item.kind === "thread"
        ? (selectThreadsAcrossEnvironments(state).find((item) => item.id === props.item.id)
            ?.environmentId ?? null)
        : null,
    );
    const targetThreadRef = useMemo(
      () =>
        environmentId && props.item.kind === "thread"
          ? scopeThreadRef(environmentId, props.item.id as ThreadId)
          : null,
      [environmentId, props.item.kind, props.item.id],
    );
    const mark = useThreadUnreadStore((s) => s.mark);
    const [renaming, setRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState("");
    const inputRef = useRef<HTMLInputElement | null>(null);
    const committedRef = useRef(false);

    useEffect(() => {
      if (!renaming) return;
      const node = inputRef.current;
      if (!node) return;
      node.focus();
      node.select();
    }, [renaming]);

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
        <RowButton
          variant="agent"
          data-selected={props.selected}
          data-chat-item=""
          data-agent-sidebar-cell=""
          onFocus={() => props.onPrefetchAgent?.(props.item.id)}
          onPointerEnter={() => props.onPrefetchAgent?.(props.item.id)}
          onClick={() => props.onSelectAgent(props.item.id)}
        >
          <StatusDot item={props.item} />
          <span className="agent-sidebar-cell-text min-w-0 flex-1 truncate">
            {props.item.title}
          </span>
          <span className="agent-sidebar-cell-subtitle shrink-0 text-detail text-muted-foreground/50">
            {props.item.ago}
          </span>
        </RowButton>
      );
    }

    return (
      <ThreadContextMenu
        threadId={props.item.id}
        onRename={() => {
          setRenaming(true);
          setRenameValue(props.item.title);
        }}
        onMarkUnread={() => {
          mark(props.item.id);
        }}
        onArchive={() => {
          if (!targetThreadRef) {
            return;
          }
          void archiveThread(targetThreadRef).catch((error) => {
            toast.error("Failed to archive thread", {
              description: error instanceof Error ? error.message : "An error occurred.",
            });
          });
        }}
      >
        {renaming ? (
          <div
            className={cn(
              "agent-sidebar-cell font-multi flex min-h-7.5 w-full min-w-0 items-center gap-2 rounded-multi-control border border-transparent px-2 py-1 text-left text-body/[18px]",
              "border-multi-stroke-strong bg-multi-active",
            )}
            data-agent-sidebar-cell=""
            data-renaming="true"
          >
            <StatusDot item={props.item} />
            <input
              ref={inputRef}
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={onRenameKeyDown}
              onBlur={onBlur}
              onClick={(e) => e.stopPropagation()}
              className="min-w-0 flex-1 bg-transparent text-body/[18px] text-foreground outline-none ring-0"
              aria-label="Rename thread"
            />
            <span className="agent-sidebar-cell-subtitle shrink-0 text-detail text-muted-foreground/50">
              {props.item.ago}
            </span>
          </div>
        ) : (
          <RowButton
            variant="agent"
            data-selected={props.selected}
            data-chat-item=""
            data-agent-sidebar-cell=""
            onFocus={() => props.onPrefetchAgent?.(props.item.id)}
            onPointerEnter={() => props.onPrefetchAgent?.(props.item.id)}
            onClick={() => props.onSelectAgent(props.item.id)}
          >
            <StatusDot item={props.item} />
            <span className="agent-sidebar-cell-text min-w-0 flex-1 truncate">
              {props.item.title}
            </span>
            <span className="agent-sidebar-cell-subtitle shrink-0 text-detail text-muted-foreground/50">
              {props.item.ago}
            </span>
          </RowButton>
        )}
      </ThreadContextMenu>
    );
  },
  (left, right) =>
    left.item === right.item &&
    left.selected === right.selected &&
    left.onSelectAgent === right.onSelectAgent &&
    left.onPrefetchAgent === right.onPrefetchAgent,
);
