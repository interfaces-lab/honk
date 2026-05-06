import { StatusDot as UiStatusDot } from "@multi/ui/status-dot";
import {
  type ComponentProps,
  type KeyboardEvent,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { ThreadContextMenu } from "~/components/shell/sidebar/thread-context-menu";
import { RowButton } from "~/components/shell/shared/row-button";
import { useThreadActions } from "~/hooks/use-thread-actions";
import type { SidebarChatItem } from "~/lib/sidebar-chat-view-model";
import { useThreadUnreadStore } from "~/lib/thread-unread-store";
import { cn } from "~/lib/utils";

type UiStatusDotState = NonNullable<ComponentProps<typeof UiStatusDot>["state"]>;

function SidebarDot(props: { state: UiStatusDotState; className?: string }) {
  return (
    <UiStatusDot
      state={props.state}
      className={cn("size-3.5", props.className)}
      role="presentation"
      aria-hidden
    />
  );
}

function StatusDot(props: { item: SidebarChatItem }) {
  if (props.item.kind === "draft") {
    return <SidebarDot state="draft" />;
  }
  if (props.item.state === "running") {
    return (
      <span className="relative flex size-3.5 shrink-0 items-center justify-center">
        <span className="absolute size-[11px] animate-ping rounded-full bg-emerald-500/35" />
        <SidebarDot state="running" className="after:bg-emerald-500" />
      </span>
    );
  }
  if (props.item.state === "error") {
    return <SidebarDot state="critical" />;
  }
  if (props.item.state === "needs_attention") {
    return <SidebarDot state="needsAttention" />;
  }
  return <SidebarDot state={props.item.unread ? "doneUnseen" : "doneSeen"} />;
}

function StatusSlot(props: { item: SidebarChatItem }) {
  return (
    <span className="multi-agent-sidebar-cell-leading-icon agent-sidebar-cell-status flex size-3.5 shrink-0 items-center justify-center">
      <StatusDot item={props.item} />
    </span>
  );
}

export const AgentRow = memo(
  function AgentRow(props: {
    item: SidebarChatItem;
    selected: boolean;
    onSelectAgent: (id: string) => void;
    onPrefetchAgent?: (id: string) => void;
  }) {
    const { commitRename, archiveThread } = useThreadActions();
    const targetThreadRef = props.item.kind === "thread" ? props.item.threadRef : null;
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
          <span className="multi-agent-sidebar-cell-leading agent-sidebar-cell-leading">
            <StatusSlot item={props.item} />
            <span className="multi-agent-sidebar-cell-content-wrapper">
              <span className="multi-agent-sidebar-cell-text agent-sidebar-cell-text min-w-0 truncate">
                {props.item.title}
              </span>
            </span>
          </span>
          <span className="multi-agent-sidebar-cell-subtitle agent-sidebar-cell-subtitle shrink-0 tabular-nums">
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
              "agent-sidebar-cell font-multi flex h-auto w-full min-w-0 items-center gap-3 rounded-[6px] border border-transparent px-[5px] py-[5px] text-left text-[12px]/[16px] font-normal leading-4",
              "border-multi-stroke-strong bg-multi-active",
            )}
            data-agent-sidebar-cell=""
            data-renaming="true"
          >
            <span className="multi-agent-sidebar-cell-leading agent-sidebar-cell-leading min-w-0 flex-1">
              <StatusSlot item={props.item} />
              <span className="multi-agent-sidebar-cell-content-wrapper min-w-0">
                <input
                  ref={inputRef}
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={onRenameKeyDown}
                  onBlur={onBlur}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full min-w-0 select-text bg-transparent text-[12px]/[16px] text-foreground outline-none ring-0"
                  aria-label="Rename thread"
                />
              </span>
            </span>
            <span className="multi-agent-sidebar-cell-subtitle agent-sidebar-cell-subtitle shrink-0 tabular-nums">
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
            <span className="multi-agent-sidebar-cell-leading agent-sidebar-cell-leading">
              <StatusSlot item={props.item} />
              <span className="multi-agent-sidebar-cell-content-wrapper">
                <span className="multi-agent-sidebar-cell-text agent-sidebar-cell-text min-w-0 truncate">
                  {props.item.title}
                </span>
              </span>
            </span>
            <span className="multi-agent-sidebar-cell-subtitle agent-sidebar-cell-subtitle shrink-0 tabular-nums">
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
