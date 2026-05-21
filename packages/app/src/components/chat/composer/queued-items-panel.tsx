import {
  IconArrowUp,
  IconChevronDownMedium,
  IconChevronTopMedium,
  IconPencilLine,
  IconTrashCan,
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

const QUEUE_HEADER_LABEL = "Queued";
const QUEUE_EDIT_ACTION_LABEL = "Edit";
const QUEUE_EDIT_ACTION_HINT = "Edit queued message";
const QUEUE_SEND_NOW_ACTION_LABEL = "Send now";
const QUEUE_REMOVE_ACTION_LABEL = "Remove";
const QUEUE_REMOVE_ACTION_HINT = "Remove from queue";
const QUEUE_TRAY_ARIA_LABEL = "Queued messages";
const QUEUE_TRAY_EXPAND_LABEL = "Expand queue";
const QUEUE_TRAY_COLLAPSE_LABEL = "Collapse queue";
const QUEUE_EDIT_BANNER_LABEL = "Editing queued message";

type QueuedComposerItemActionsProps = {
  items: readonly QueuedComposerItem[];
  editingItemId: MessageId | null;
  isBusy: boolean;
  onBeginEdit: (itemId: MessageId) => void;
  onCancelEdit: () => void;
  onRemove: (itemId: MessageId) => void;
  onSendNow: (itemId: MessageId) => void;
};

const QueuedComposerItemRowActions = memo(function QueuedComposerItemRowActions(props: {
  itemId: MessageId;
  isEditing: boolean;
  isBusy: boolean;
  alwaysVisible?: boolean;
  onBeginEdit: (itemId: MessageId) => void;
  onRemove: (itemId: MessageId) => void;
  onSendNow: (itemId: MessageId) => void;
}) {
  const actionButtonClass =
    "flex size-7 items-center justify-center rounded-md text-muted-foreground transition-[background-color,color,opacity] duration-100 hover:bg-background hover:text-foreground focus-visible:ring-1 focus-visible:ring-multi-stroke-focused focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40";

  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-100 group-hover/queue-row:opacity-100 group-focus-within/queue-row:opacity-100",
        props.alwaysVisible ? "opacity-100" : "",
        props.isEditing ? "opacity-100" : "",
      )}
    >
      <button
        type="button"
        className={actionButtonClass}
        onClick={() => props.onBeginEdit(props.itemId)}
        disabled={props.isEditing}
        aria-label={QUEUE_EDIT_ACTION_LABEL}
        title={QUEUE_EDIT_ACTION_HINT}
        data-queue-action="edit"
      >
        <IconPencilLine className="size-3.5" />
      </button>
      <button
        type="button"
        className={actionButtonClass}
        onClick={() => props.onSendNow(props.itemId)}
        disabled={props.isBusy || props.isEditing}
        aria-label={QUEUE_SEND_NOW_ACTION_LABEL}
        title={QUEUE_SEND_NOW_ACTION_LABEL}
        data-queue-action="send"
      >
        <IconArrowUp className="size-3.5" />
      </button>
      <button
        type="button"
        className={actionButtonClass}
        onClick={() => props.onRemove(props.itemId)}
        aria-label={QUEUE_REMOVE_ACTION_LABEL}
        title={QUEUE_REMOVE_ACTION_HINT}
        data-queue-action="remove"
      >
        <IconTrashCan className="size-3.5" />
      </button>
    </div>
  );
});

const QueuedComposerItemRow = memo(function QueuedComposerItemRow(props: {
  item: QueuedComposerItem;
  index: number;
  isEditing: boolean;
  isBusy: boolean;
  variant: "tray" | "popover";
  onBeginEdit: (itemId: MessageId) => void;
  onRemove: (itemId: MessageId) => void;
  onSendNow: (itemId: MessageId) => void;
}) {
  const { item, index, isEditing, isBusy, variant, onBeginEdit, onRemove, onSendNow } = props;

  if (variant === "tray") {
    return (
      <div
        role="option"
        aria-selected={isEditing}
        data-queued-composer-item={String(item.id)}
        data-queue-row=""
        data-queue-item-id={String(item.id)}
        data-editing={isEditing ? "" : undefined}
        className={cn(
          "group/queue-row flex min-h-8 cursor-default items-start gap-2 rounded-md py-0.5 pr-1 pl-2 transition-colors duration-100 hover:bg-muted/60",
          isEditing &&
            "bg-[color-mix(in_srgb,var(--multi-stroke-focused)_15%,transparent)] shadow-[inset_0_0_0_1px_var(--multi-stroke-secondary)]",
        )}
        onDoubleClick={() => {
          if (!isEditing) {
            onBeginEdit(item.id);
          }
        }}
      >
        <div className="min-w-0 flex-1 py-1">
          <div className="truncate text-body text-foreground">
            {formatQueuedComposerItemPreview(item)}
          </div>
          {isEditing ? (
            <span className="mt-0.5 inline-flex rounded-sm bg-muted px-1 py-px text-caption text-muted-foreground">
              Editing
            </span>
          ) : null}
        </div>
        <QueuedComposerItemRowActions
          itemId={item.id}
          isEditing={isEditing}
          isBusy={isBusy}
          onBeginEdit={onBeginEdit}
          onRemove={onRemove}
          onSendNow={onSendNow}
        />
      </div>
    );
  }

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
          <span>#{index + 1}</span>
          {isEditing ? <span>Editing</span> : null}
        </div>
      </div>
      <QueuedComposerItemRowActions
        itemId={item.id}
        isEditing={isEditing}
        isBusy={isBusy}
        alwaysVisible
        onBeginEdit={onBeginEdit}
        onRemove={onRemove}
        onSendNow={onSendNow}
      />
    </div>
  );
});

const QueuedComposerItemsList = memo(function QueuedComposerItemsList(
  props: Omit<QueuedComposerItemActionsProps, "onCancelEdit"> & {
    className?: string;
    variant: "tray" | "popover";
    role?: "listbox";
    ariaLabel?: string;
  },
) {
  return (
    <div
      className={cn("flex flex-col gap-0.5 overflow-y-auto", props.className)}
      {...(props.role ? { role: props.role } : {})}
      {...(props.ariaLabel ? { "aria-label": props.ariaLabel } : {})}
    >
      {props.items.map((item, index) => (
        <QueuedComposerItemRow
          key={item.id}
          item={item}
          index={index}
          isEditing={props.editingItemId === item.id}
          isBusy={props.isBusy}
          variant={props.variant}
          onBeginEdit={props.onBeginEdit}
          onRemove={props.onRemove}
          onSendNow={props.onSendNow}
        />
      ))}
    </div>
  );
});

export const QueuedComposerItemsTray = memo(function QueuedComposerItemsTray(
  props: QueuedComposerItemActionsProps,
) {
  const [collapsed, setCollapsed] = useState(false);

  if (props.items.length === 0) {
    return null;
  }

  const editingActive = props.editingItemId !== null;
  const headerLabel = `${props.items.length} ${QUEUE_HEADER_LABEL}`;

  return (
    <div
      className="border-b border-multi-stroke-tertiary bg-(--multi-chat-bubble-background)"
      data-queued-composer-tray=""
      data-queue-count={props.items.length}
      data-queue-collapsed={collapsed ? "" : undefined}
      data-queue-editing={editingActive ? "" : undefined}
    >
      <div
        className={cn(
          "flex items-center justify-between gap-2 px-3 py-1.5",
          collapsed ? "pb-1.5" : "",
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-detail font-medium text-foreground">{headerLabel}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {editingActive ? (
            <button
              type="button"
              className="rounded-multi-control px-1.5 py-0.5 text-detail text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-multi-stroke-focused focus-visible:outline-none"
              onClick={props.onCancelEdit}
            >
              Cancel
            </button>
          ) : null}
          <button
            type="button"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-multi-stroke-focused focus-visible:outline-none"
            aria-label={collapsed ? QUEUE_TRAY_EXPAND_LABEL : QUEUE_TRAY_COLLAPSE_LABEL}
            title={collapsed ? QUEUE_TRAY_EXPAND_LABEL : QUEUE_TRAY_COLLAPSE_LABEL}
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? (
              <IconChevronDownMedium className="size-3.5" aria-hidden="true" />
            ) : (
              <IconChevronTopMedium className="size-3.5" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>
      {collapsed ? null : (
        <QueuedComposerItemsList
          variant="tray"
          className="max-h-[var(--multi-composer-queue-max-height)] px-2 pb-2"
          role="listbox"
          ariaLabel={QUEUE_TRAY_ARIA_LABEL}
          items={props.items}
          editingItemId={props.editingItemId}
          isBusy={props.isBusy}
          onBeginEdit={props.onBeginEdit}
          onRemove={props.onRemove}
          onSendNow={props.onSendNow}
        />
      )}
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
          variant="popover"
          className="max-h-60"
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
      className="flex items-center justify-between gap-2 border border-b-0 border-multi-stroke-tertiary bg-[color-mix(in_srgb,var(--multi-chat-bubble-background)_80%,var(--multi-stroke-focused)_20%)] px-3 py-1.5 text-detail text-foreground"
      data-queued-composer-edit-banner=""
    >
      <span className="opacity-90">{QUEUE_EDIT_BANNER_LABEL}</span>
      <button
        type="button"
        className="rounded-multi-control px-1.5 py-0.5 text-detail text-primary transition-colors hover:bg-muted focus-visible:ring-1 focus-visible:ring-multi-stroke-focused focus-visible:outline-none"
        onClick={props.onCancelEdit}
      >
        Cancel
      </button>
    </div>
  );
});
