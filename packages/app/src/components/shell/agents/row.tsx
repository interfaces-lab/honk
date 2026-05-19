import { StatusDot as UiStatusDot } from "@multi/ui/status-dot";
import { scopedThreadKey } from "@multi/client-runtime";
import { IconArchive } from "central-icons";
import {
  type ComponentProps,
  type KeyboardEvent,
  type MouseEvent,
  memo,
  useCallback,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { ThreadContextMenu } from "~/components/shell/sidebar/thread-context-menu";
import { RowButton } from "~/components/shell/shared/row-button";
import { useThreadActions } from "~/hooks/use-thread-actions";
import type { SidebarChatItem } from "./sidebar-chat-view-model";
import { useUiStateStore } from "~/stores/ui-state-store";
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
    <span
      className="flex size-3.5 shrink-0 items-center justify-center text-multi-icon-secondary"
      data-agent-sidebar-status=""
    >
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
    const markThreadUnread = useUiStateStore((store) => store.markThreadUnread);
    const [renaming, setRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState("");
    const committedRef = useRef(false);

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
        <RowButton
          variant="agent"
          data-selected={props.selected}
          data-chat-item=""
          data-agent-sidebar-cell=""
          onFocus={() => props.onPrefetchAgent?.(props.item.id)}
          onPointerEnter={() => props.onPrefetchAgent?.(props.item.id)}
          onClick={() => props.onSelectAgent(props.item.id)}
        >
          <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
            <StatusSlot item={props.item} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden pl-0.5">
              <span
                className="min-w-0 truncate text-(length:--multi-sidebar-label-size) font-normal leading-(--multi-sidebar-label-leading) text-multi-fg-secondary group-data-[selected=true]/agent-row:text-multi-fg-primary"
                data-agent-sidebar-title=""
                title={props.item.title}
              >
                {props.item.title}
              </span>
            </span>
          </span>
          <span
            className="max-w-14 min-w-8 shrink-0 overflow-hidden text-ellipsis whitespace-nowrap text-right text-(length:--multi-text-detail) leading-(--multi-leading-detail) text-multi-fg-tertiary tabular-nums group-data-[selected=true]/agent-row:text-multi-fg-secondary"
            data-agent-sidebar-subtitle=""
          >
            {props.item.ago}
          </span>
        </RowButton>
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
    const stopArchivePointerDown = (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
    };

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
        {renaming ? (
          <div
            className={cn(
              "font-multi relative flex h-auto w-full min-w-0 cursor-(--multi-button-cursor) items-center gap-3 rounded-multi-control border px-1.5 py-[5px] text-left text-(length:--multi-sidebar-label-size) font-normal leading-(--multi-sidebar-label-leading)",
              "border-multi-stroke-primary bg-multi-bg-tertiary",
            )}
            data-agent-sidebar-cell=""
            data-renaming="true"
          >
            <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
              <StatusSlot item={props.item} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden pl-0.5">
                <input
                  ref={focusRenameInput}
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={onRenameKeyDown}
                  onBlur={onBlur}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full min-w-0 select-text bg-transparent text-(length:--multi-sidebar-label-size) leading-(--multi-sidebar-label-leading) text-foreground outline-none ring-0"
                  aria-label="Rename thread"
                />
              </span>
            </span>
            <span
              className="max-w-14 min-w-8 shrink-0 overflow-hidden text-ellipsis whitespace-nowrap text-right text-(length:--multi-text-detail) leading-(--multi-leading-detail) text-multi-fg-secondary tabular-nums"
              data-agent-sidebar-subtitle=""
            >
              {props.item.ago}
            </span>
          </div>
        ) : (
          <div className="group/agent-row-shell relative min-w-0" data-agent-sidebar-row-shell="">
            <RowButton
              variant="agent"
              className="pr-7"
              data-selected={props.selected}
              data-chat-item=""
              data-agent-sidebar-cell=""
              onFocus={() => props.onPrefetchAgent?.(props.item.id)}
              onPointerEnter={() => props.onPrefetchAgent?.(props.item.id)}
              onClick={() => props.onSelectAgent(props.item.id)}
            >
              <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
                <StatusSlot item={props.item} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden pl-0.5">
                  <span
                    className="min-w-0 truncate text-(length:--multi-sidebar-label-size) font-normal leading-(--multi-sidebar-label-leading) text-multi-fg-secondary group-data-[selected=true]/agent-row:text-multi-fg-primary"
                    data-agent-sidebar-title=""
                    title={props.item.title}
                  >
                    {props.item.title}
                  </span>
                </span>
              </span>
              <span
                className="max-w-14 min-w-8 shrink-0 overflow-hidden text-ellipsis whitespace-nowrap text-right text-(length:--multi-text-detail) leading-(--multi-leading-detail) text-multi-fg-tertiary tabular-nums transition-opacity duration-100 group-hover/agent-row-shell:opacity-0 group-focus-within/agent-row-shell:opacity-0 group-data-[selected=true]/agent-row:text-multi-fg-secondary motion-reduce:transition-none pointer-coarse:opacity-0"
                data-agent-sidebar-subtitle=""
              >
                {props.item.ago}
              </span>
            </RowButton>
            <button
              type="button"
              aria-label="Archive"
              title="Archive"
              onClick={archiveCurrentThread}
              onMouseDown={stopArchivePointerDown}
              className="absolute top-1/2 right-1 flex size-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-multi-control border border-transparent bg-transparent p-0 text-multi-fg-tertiary opacity-0 outline-none transition-[background-color,color,opacity] duration-100 ease-out group-hover/agent-row-shell:opacity-100 group-focus-within/agent-row-shell:opacity-100 hover:bg-multi-bg-quaternary hover:text-multi-fg-primary focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0 motion-reduce:transition-none pointer-coarse:opacity-100"
            >
              <IconArchive className="size-3.5" aria-hidden />
            </button>
          </div>
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
