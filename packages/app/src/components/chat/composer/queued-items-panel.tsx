import {
  IconChevronDownMedium,
  IconChevronRightMedium,
  IconCrossMediumDefault,
  IconPencilLine,
} from "central-icons";
import type { MessageId } from "@multi/contracts";
import { memo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@multi/ui/popover";

import type { QueuedComposerItem } from "../../../stores/chat-send-queue";
import { cn } from "~/lib/utils";

function formatQueuedComposerItemPreview(item: QueuedComposerItem): string {
  const prompt = item.sendContext.prompt.trim().replace(/\s+/g, " ");
  if (prompt.length > 0) {
    return prompt;
  }
  const imageCount = item.sendContext.images.length;
  if (imageCount > 0) {
    return imageCount === 1
      ? (item.sendContext.images[0]?.name ?? "Image")
      : `${imageCount} images`;
  }
  return "Queued message";
}

function formatQueuedComposerItemMeta(item: QueuedComposerItem, index: number): string {
  const parts = [`#${index + 1}`];
  if (item.sendContext.images.length > 0) {
    parts.push(`${item.sendContext.images.length} img`);
  }
  return parts.join(" / ");
}

const QUEUE_HEADER_LABEL = "Queued";
const QUEUE_EDIT_ACTION_LABEL = "Edit queued message";
const QUEUE_SEND_NOW_ACTION_LABEL = "Send now";
const QUEUE_REMOVE_ACTION_LABEL = "Remove from queue";

type QueuedComposerItemActionsProps = {
  items: readonly QueuedComposerItem[];
  editingItemId: MessageId | null;
  isBusy: boolean;
  onBeginEdit: (itemId: MessageId) => void;
  onCancelEdit: () => void;
  onRemove: (itemId: MessageId) => void;
  onSendNow: (itemId: MessageId) => void;
};

const QueuedComposerItemRow = memo(function QueuedComposerItemRow(props: {
  item: QueuedComposerItem;
  index: number;
  isEditing: boolean;
  isBusy: boolean;
  onBeginEdit: (itemId: MessageId) => void;
  onRemove: (itemId: MessageId) => void;
  onSendNow: (itemId: MessageId) => void;
}) {
  const { item, index, isEditing, isBusy, onBeginEdit, onRemove, onSendNow } = props;

  return (
    <div
      data-queued-composer-item={String(item.id)}
      className={cn(
        "flex min-h-9 items-center gap-2 rounded-md border px-2 py-1.5",
        isEditing
          ? "border-multi-stroke-secondary bg-(--multi-chat-bubble-background)"
          : "border-multi-stroke-tertiary bg-transparent",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-body text-foreground">
          {formatQueuedComposerItemPreview(item)}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-caption text-muted-foreground">
          <span>{formatQueuedComposerItemMeta(item, index)}</span>
          {isEditing ? <span>Editing</span> : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:ring-1 focus-visible:ring-multi-stroke-focused focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
          onClick={() => onBeginEdit(item.id)}
          disabled={isEditing}
          aria-label={QUEUE_EDIT_ACTION_LABEL}
          title={QUEUE_EDIT_ACTION_LABEL}
        >
          <IconPencilLine className="size-3.5" />
        </button>
        <button
          type="button"
          className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:ring-1 focus-visible:ring-multi-stroke-focused focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
          onClick={() => onSendNow(item.id)}
          disabled={isBusy || isEditing}
          aria-label={QUEUE_SEND_NOW_ACTION_LABEL}
          title={QUEUE_SEND_NOW_ACTION_LABEL}
        >
          <IconChevronRightMedium className="size-3.5 -rotate-90" />
        </button>
        <button
          type="button"
          className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:ring-1 focus-visible:ring-multi-stroke-focused focus-visible:outline-none"
          onClick={() => onRemove(item.id)}
          aria-label={QUEUE_REMOVE_ACTION_LABEL}
          title={QUEUE_REMOVE_ACTION_LABEL}
        >
          <IconCrossMediumDefault className="size-3" />
        </button>
      </div>
    </div>
  );
});

const QueuedComposerItemsList = memo(function QueuedComposerItemsList(
  props: Omit<QueuedComposerItemActionsProps, "onCancelEdit"> & { className?: string },
) {
  return (
    <div className={cn("flex max-h-60 flex-col gap-1 overflow-y-auto", props.className)}>
      {props.items.map((item, index) => (
        <QueuedComposerItemRow
          key={item.id}
          item={item}
          index={index}
          isEditing={props.editingItemId === item.id}
          isBusy={props.isBusy}
          onBeginEdit={props.onBeginEdit}
          onRemove={props.onRemove}
          onSendNow={props.onSendNow}
        />
      ))}
    </div>
  );
});

export const QueuedComposerItemsBadge = memo(function QueuedComposerItemsBadge(
  props: QueuedComposerItemActionsProps & { compact?: boolean },
) {
  const [open, setOpen] = useState(false);

  if (props.items.length === 0) {
    return null;
  }

  const editingActive = props.editingItemId !== null;
  const triggerLabel = `${props.items.length} ${QUEUE_HEADER_LABEL}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            data-queued-composer-badge=""
            data-queue-count={props.items.length}
            data-queue-editing={editingActive ? "" : undefined}
            data-queue-open={open ? "" : undefined}
            className={cn(
              "inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-full border border-multi-stroke-tertiary bg-(--multi-chat-bubble-background) px-2 text-detail font-medium text-multi-fg-secondary transition-[background-color,color,border-color] duration-150 hover:border-multi-stroke-secondary hover:text-multi-fg-primary focus-visible:ring-1 focus-visible:ring-multi-stroke-focused focus-visible:outline-none data-queue-editing:border-multi-stroke-secondary data-queue-editing:text-multi-fg-primary",
              props.compact ? "px-1.5" : "",
            )}
            aria-label={
              editingActive ? `${triggerLabel} (editing)` : `${triggerLabel} (open queue)`
            }
            title={triggerLabel}
          >
            <IconChevronDownMedium
              className={cn(
                "size-3 shrink-0 transition-transform duration-150",
                open ? "rotate-180" : "",
              )}
              aria-hidden="true"
            />
            <span className="tabular-nums">{props.items.length}</span>
            {props.compact ? null : <span>{QUEUE_HEADER_LABEL}</span>}
          </button>
        }
      />
      <PopoverContent align="start" sideOffset={8} className="w-[min(360px,calc(100vw-32px))] p-2">
        <div className="flex items-center justify-between gap-2 px-1 pb-1.5">
          <span className="text-detail font-medium text-foreground">{triggerLabel}</span>
          {editingActive ? (
            <button
              type="button"
              className="rounded-multi-control px-1.5 py-0.5 text-detail text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-multi-stroke-focused focus-visible:outline-none"
              onClick={props.onCancelEdit}
            >
              Cancel
            </button>
          ) : null}
        </div>
        <QueuedComposerItemsList
          items={props.items}
          editingItemId={props.editingItemId}
          isBusy={props.isBusy}
          onBeginEdit={(id) => {
            props.onBeginEdit(id);
            setOpen(false);
          }}
          onRemove={props.onRemove}
          onSendNow={(id) => {
            props.onSendNow(id);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
});

export const QueuedComposerEditBanner = memo(function QueuedComposerEditBanner(props: {
  onCancelEdit: () => void;
}) {
  return (
    <div
      className="flex items-center justify-between gap-2 border-b border-multi-stroke-tertiary bg-(--multi-chat-bubble-background) px-3 py-1.5 text-detail"
      data-queued-composer-edit-banner=""
    >
      <span className="font-medium text-multi-fg-secondary">Editing queued message</span>
      <button
        type="button"
        className="rounded-multi-control px-1.5 py-0.5 text-detail text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-multi-stroke-focused focus-visible:outline-none"
        onClick={props.onCancelEdit}
      >
        Cancel
      </button>
    </div>
  );
});
