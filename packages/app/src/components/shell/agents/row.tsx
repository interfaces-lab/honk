import { StatusDot as UiStatusDot } from "@multi/ui/status-dot";
import { scopedThreadKey } from "@multi/client-runtime";
import { IconArchive1, IconPin, IconUnpin } from "central-icons";
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

function ThreadStatusActionSlot(props: {
  item: SidebarChatItem;
  pinned: boolean;
  onTogglePinned: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <span
      className="relative flex size-5 shrink-0 items-center justify-center text-multi-icon-secondary"
      data-agent-sidebar-status=""
      data-agent-sidebar-pin-slot=""
    >
      <span className="flex size-3.5 items-center justify-center group-hover/agent-row-shell:opacity-0 group-focus-within/agent-row-shell:opacity-0">
        <StatusDot item={props.item} />
      </span>
      <button
        type="button"
        aria-label={props.pinned ? "Unpin" : "Pin"}
        title={props.pinned ? "Unpin" : "Pin"}
        onClick={props.onTogglePinned}
        onMouseDown={stopActionPointerDown}
        className={cn(
          hoverActionButtonClass,
          "pointer-events-none absolute inset-0 opacity-0 group-hover/agent-row-shell:pointer-events-auto group-hover/agent-row-shell:opacity-100 group-focus-within/agent-row-shell:pointer-events-auto group-focus-within/agent-row-shell:opacity-100",
        )}
        data-agent-sidebar-pin-action=""
      >
        {props.pinned ? (
          <IconUnpin className="size-3.5" aria-hidden />
        ) : (
          <IconPin className="size-3.5" aria-hidden />
        )}
      </button>
    </span>
  );
}

const hoverActionButtonClass = cn(
  "flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-multi-control border border-transparent bg-transparent p-0 text-multi-fg-tertiary outline-none",
  "hover:bg-multi-bg-quaternary hover:text-multi-fg-primary",
  "focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0",
);

function stopActionPointerDown(event: MouseEvent<HTMLButtonElement>) {
  event.preventDefault();
  event.stopPropagation();
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
    const setThreadPinned = useUiStateStore((store) => store.setThreadPinned);
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
    const togglePinnedThread = (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (!targetThreadRef) {
        return;
      }
      setThreadPinned(scopedThreadKey(targetThreadRef), !threadItem.pinned);
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
          <div
            className="group/agent-row-shell flex min-w-0 items-center gap-1 rounded-multi-control px-1.5 hover:bg-multi-bg-quaternary focus-within:bg-multi-bg-quaternary data-[selected=true]:bg-multi-bg-tertiary data-[selected=true]:hover:bg-multi-bg-tertiary data-[selected=true]:focus-within:bg-multi-bg-tertiary"
            data-selected={props.selected}
            data-agent-sidebar-cell=""
            data-agent-sidebar-row-shell=""
          >
            <ThreadStatusActionSlot
              item={props.item}
              pinned={threadItem.pinned}
              onTogglePinned={togglePinnedThread}
            />
            <RowButton
              variant="agent"
              className="min-w-0 flex-1 gap-1.5 px-0 pr-1 transition-none hover:!bg-transparent data-pressed:!bg-transparent data-[highlighted=true]:!bg-transparent data-[selected=true]:!bg-transparent"
              data-selected={props.selected}
              data-chat-item=""
              onFocus={() => props.onPrefetchAgent?.(props.item.id)}
              onPointerEnter={() => props.onPrefetchAgent?.(props.item.id)}
              onClick={() => props.onSelectAgent(props.item.id)}
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden">
                <span
                  className="min-w-0 truncate text-(length:--multi-sidebar-label-size) font-normal leading-(--multi-sidebar-label-leading) text-multi-fg-secondary group-data-[selected=true]/agent-row:text-multi-fg-primary"
                  data-agent-sidebar-title=""
                  title={props.item.title}
                >
                  {props.item.title}
                </span>
              </span>
              <span
                className={cn(
                  "max-w-14 min-w-8 shrink-0 overflow-hidden text-ellipsis whitespace-nowrap text-right text-(length:--multi-text-detail) leading-(--multi-leading-detail) opacity-0 tabular-nums group-hover/agent-row-shell:opacity-100 group-focus-within/agent-row-shell:opacity-100",
                  props.selected ? "text-multi-fg-secondary" : "text-multi-fg-tertiary",
                )}
                data-agent-sidebar-subtitle=""
                data-agent-sidebar-trailing-content=""
              >
                {props.item.ago}
              </span>
            </RowButton>
            <span
              className="flex max-w-0 shrink-0 overflow-hidden opacity-0 group-hover/agent-row-shell:max-w-5 group-hover/agent-row-shell:opacity-100 group-focus-within/agent-row-shell:max-w-5 group-focus-within/agent-row-shell:opacity-100"
              data-agent-sidebar-actions=""
              data-agent-sidebar-archive-slot=""
            >
              <button
                type="button"
                aria-label="Archive"
                title="Archive"
                onClick={archiveCurrentThread}
                onMouseDown={stopActionPointerDown}
                className={hoverActionButtonClass}
                data-agent-sidebar-archive-action=""
              >
                <IconArchive1 className="size-3.5" aria-hidden />
              </button>
            </span>
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
