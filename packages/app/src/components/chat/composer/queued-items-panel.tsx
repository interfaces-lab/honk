import { IconArrowUp, IconChevronDownMedium, IconPencilLine, IconTrashCan } from "central-icons";
import type { MessageId } from "@multi/contracts";
import { memo, useState, type DragEvent, type KeyboardEvent } from "react";

import type { QueuedComposerItem } from "../../../stores/chat-send-queue";
import { SidebarButton, SidebarItem } from "~/components/shell/shared/sidebar-button";
import { cn } from "~/lib/utils";

function handleQueuedItemDragEnter(event: DragEvent<HTMLElement>) {
  event.preventDefault();
}

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

const QUEUE_ROW_THUMBNAIL_LIMIT = 3;

const QUEUE_HEADER_LABEL = "Queued";
const QUEUE_EDIT_ACTION_LABEL = "Edit";
const QUEUE_SEND_NOW_ACTION_LABEL = "Send now";
const QUEUE_REMOVE_ACTION_LABEL = "Remove";
const QUEUE_PANEL_ARIA_LABEL = "Queued messages";
const QUEUE_PANEL_EXPAND_LABEL = "Expand queue";
const QUEUE_PANEL_COLLAPSE_LABEL = "Collapse queue";
const QUEUE_EDIT_BANNER_LABEL = "Editing queued message";

function formatQueuedComposerCount(count: number): string {
  return count === 1 ? `1 ${QUEUE_HEADER_LABEL}` : `${count} ${QUEUE_HEADER_LABEL}`;
}

function isKeyboardActivation(event: KeyboardEvent<HTMLElement>): boolean {
  return event.key === "Enter" || event.key === " ";
}

type QueuedComposerItemActionsProps = {
  items: readonly QueuedComposerItem[];
  editingItemId: MessageId | null;
  isBusy: boolean;
  onBeginEdit: (itemId: MessageId) => void;
  onRemove: (itemId: MessageId) => void;
  onSendNow: (itemId: MessageId) => void;
  onReorder: (itemId: MessageId, targetItemId: MessageId | null, insertAfter: boolean) => void;
};

const QueuedComposerItemRowActions = memo(function QueuedComposerItemRowActions(props: {
  itemId: MessageId;
  isBusy: boolean;
  onBeginEdit: (itemId: MessageId) => void;
  onRemove: (itemId: MessageId) => void;
  onSendNow: (itemId: MessageId) => void;
}) {
  const actionButtonClass =
    "flex size-5 shrink-0 cursor-(--multi-button-cursor) items-center justify-center rounded-multi-control border border-transparent bg-transparent p-0 text-multi-fg-tertiary outline-none hover:bg-multi-bg-quaternary hover:text-multi-fg-primary focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:pointer-events-none disabled:opacity-35";

  return (
    <div
      className="hidden shrink-0 items-center group-focus-within/sidebar-item:flex [@media(hover:hover)]:group-hover/sidebar-item:flex"
      data-queued-composer-item-actions=""
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className={actionButtonClass}
        onClick={() => props.onBeginEdit(props.itemId)}
        aria-label={QUEUE_EDIT_ACTION_LABEL}
        title={QUEUE_EDIT_ACTION_LABEL}
        data-queue-action="edit"
      >
        <IconPencilLine className="size-4 shrink-0" aria-hidden="true" />
      </button>
      <button
        type="button"
        className={actionButtonClass}
        onClick={() => props.onSendNow(props.itemId)}
        disabled={props.isBusy}
        aria-label={QUEUE_SEND_NOW_ACTION_LABEL}
        title={QUEUE_SEND_NOW_ACTION_LABEL}
        data-queue-action="send"
      >
        <IconArrowUp className="size-4 shrink-0" aria-hidden="true" />
      </button>
      <button
        type="button"
        className={actionButtonClass}
        onClick={() => props.onRemove(props.itemId)}
        aria-label={QUEUE_REMOVE_ACTION_LABEL}
        title={QUEUE_REMOVE_ACTION_LABEL}
        data-queue-action="remove"
      >
        <IconTrashCan className="size-4 shrink-0" aria-hidden="true" />
      </button>
    </div>
  );
});

const QueuedComposerItemThumbnails = memo(function QueuedComposerItemThumbnails(props: {
  item: QueuedComposerItem;
}) {
  const visibleImages = props.item.sendContext.images.slice(0, QUEUE_ROW_THUMBNAIL_LIMIT);
  if (visibleImages.length === 0) {
    return null;
  }

  const overflowCount = props.item.sendContext.images.length - visibleImages.length;

  return (
    <span className="queue-row-thumbnails" aria-hidden="true">
      {visibleImages.map((image) => (
        <img
          key={image.id}
          src={image.previewUrl}
          alt=""
          className="queue-row-thumbnail rounded-sm"
          draggable={false}
        />
      ))}
      {overflowCount > 0 ? (
        <span className="queue-row-thumbnails__overflow">+{overflowCount}</span>
      ) : null}
    </span>
  );
});

const QueuedComposerItemRow = memo(function QueuedComposerItemRow(props: {
  item: QueuedComposerItem;
  index: number;
  itemCount: number;
  isEditing: boolean;
  isBusy: boolean;
  draggingItemId: MessageId | null;
  dropTargetItemId: MessageId | null;
  dropInsertAfter: boolean;
  onBeginEdit: (itemId: MessageId) => void;
  onRemove: (itemId: MessageId) => void;
  onSendNow: (itemId: MessageId) => void;
  onDragStart: (event: DragEvent<HTMLElement>, item: QueuedComposerItem) => void;
  onDragOver: (event: DragEvent<HTMLElement>, item: QueuedComposerItem) => void;
  onDragEnter: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}) {
  const {
    item,
    index,
    itemCount,
    isEditing,
    isBusy,
    draggingItemId,
    dropTargetItemId,
    dropInsertAfter,
    onBeginEdit,
    onRemove,
    onSendNow,
    onDragStart,
    onDragOver,
    onDragEnter,
    onDragLeave,
    onDrop,
    onDragEnd,
  } = props;
  const showDropBefore = dropTargetItemId === item.id && !dropInsertAfter;
  const showDropAfter = dropTargetItemId === item.id && dropInsertAfter;
  const isDragging = draggingItemId === item.id;
  const isDraggable = itemCount > 1 && !isEditing;
  const preview = formatQueuedComposerItemPreview(item);

  return (
    <div className="relative" role="listitem" data-queued-composer-item-wrapper="">
      {showDropBefore ? (
        <div className="pointer-events-none absolute inset-x-2 top-0 z-[2] h-0.5 rounded-sm bg-multi-stroke-focused" />
      ) : null}
      <SidebarItem
        render={<div />}
        draggable={isDraggable}
        selected={isEditing}
        data-queued-composer-item={String(item.id)}
        data-queue-row="true"
        data-queue-item-id={String(item.id)}
        data-queue-item-query={item.sendContext.prompt}
        data-editing={isEditing ? "" : undefined}
        data-dragging={isDragging ? "" : undefined}
        data-queue-position={index === 0 ? "next" : undefined}
        className="ui-tray-row queue-sortable-row group/sidebar-item h-auto data-[selected=true]:focus-within:bg-multi-bg-tertiary"
        onDoubleClick={() => {
          if (!isEditing) {
            onBeginEdit(item.id);
          }
        }}
        onDragStart={(event) => onDragStart(event, item)}
        onDragOver={(event) => onDragOver(event, item)}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
      >
        <SidebarButton
          variant="inset"
          className="ui-tray-row__content disabled:opacity-100"
          disabled={isEditing}
          onClick={() => onBeginEdit(item.id)}
          onKeyDown={(event) => {
            if (!isKeyboardActivation(event)) {
              return;
            }
            event.preventDefault();
            onBeginEdit(item.id);
          }}
          title={preview}
          data-queued-composer-item-preview=""
        >
          <QueuedComposerItemThumbnails item={item} />
          <span
            className={cn(
              "ui-tray-row__label min-w-0 flex-1 truncate text-multi-fg-secondary",
              isEditing && "text-multi-fg-primary",
            )}
          >
            {preview}
          </span>
        </SidebarButton>
        {isEditing ? (
          <span className="ui-tray-row__status min-w-8 max-w-14 shrink-0 truncate text-right text-(length:--multi-text-detail) leading-(--multi-leading-detail) text-multi-fg-secondary">
            Editing
          </span>
        ) : (
          <QueuedComposerItemRowActions
            itemId={item.id}
            isBusy={isBusy}
            onBeginEdit={onBeginEdit}
            onRemove={onRemove}
            onSendNow={onSendNow}
          />
        )}
      </SidebarItem>
      {showDropAfter ? (
        <div className="pointer-events-none absolute inset-x-2 bottom-0 z-[2] h-0.5 rounded-sm bg-multi-stroke-focused" />
      ) : null}
    </div>
  );
});

const QueuedComposerItemsList = memo(function QueuedComposerItemsList(
  props: QueuedComposerItemActionsProps,
) {
  const [draggingItemId, setDraggingItemId] = useState<MessageId | null>(null);
  const [dropTargetItemId, setDropTargetItemId] = useState<MessageId | null>(null);
  const [dropInsertAfter, setDropInsertAfter] = useState(false);
  const resetDragState = () => {
    setDraggingItemId(null);
    setDropTargetItemId(null);
    setDropInsertAfter(false);
  };

  const handleDragStart = (event: DragEvent<HTMLElement>, item: QueuedComposerItem) => {
    setDraggingItemId(item.id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", item.id);
  };

  const handleDragOver = (event: DragEvent<HTMLElement>, item: QueuedComposerItem) => {
    event.preventDefault();
    if (draggingItemId === null || draggingItemId === item.id) {
      setDropTargetItemId(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setDropTargetItemId(item.id);
    setDropInsertAfter(event.clientY >= rect.top + rect.height / 2);
    event.dataTransfer.dropEffect = "move";
  };

  const handleDragEnter = handleQueuedItemDragEnter;

  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) {
      return;
    }
    setDropTargetItemId(null);
  };

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    if (draggingItemId !== null && dropTargetItemId !== null) {
      props.onReorder(draggingItemId, dropTargetItemId, dropInsertAfter);
    }
    resetDragState();
  };

  return (
    <div
      className="agent-panel-queue-items flex max-h-[200px] flex-col gap-px overflow-y-auto px-2 pb-2 focus-visible:outline-none"
      role="list"
      aria-label={QUEUE_PANEL_ARIA_LABEL}
      data-queued-composer-items-list=""
      data-queue-count={props.items.length}
    >
      {props.items.map((item, index) => (
        <QueuedComposerItemRow
          key={item.id}
          item={item}
          index={index}
          itemCount={props.items.length}
          isEditing={props.editingItemId === item.id}
          isBusy={props.isBusy}
          draggingItemId={draggingItemId}
          dropTargetItemId={dropTargetItemId}
          dropInsertAfter={dropInsertAfter}
          onBeginEdit={props.onBeginEdit}
          onRemove={props.onRemove}
          onSendNow={props.onSendNow}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onDragEnd={resetDragState}
        />
      ))}
    </div>
  );
});

export const QueuedComposerItemsPanel = memo(function QueuedComposerItemsPanel(
  props: QueuedComposerItemActionsProps & {
    compact: boolean;
    expanded: boolean;
    onExpandedChange: (expanded: boolean) => void;
  },
) {
  if (props.items.length === 0) {
    return null;
  }

  const editingActive = props.editingItemId !== null;
  const countLabel = formatQueuedComposerCount(props.items.length);
  const expandLabel = props.expanded ? QUEUE_PANEL_COLLAPSE_LABEL : QUEUE_PANEL_EXPAND_LABEL;

  return (
    <div
      className={cn("relative w-full min-w-0", props.compact ? "mx-auto w-full" : "")}
      data-queued-composer-panel-stack=""
    >
      <div
        className="ui-tray--queued font-multi text-detail text-multi-fg-primary"
        data-queued-composer-panel=""
        data-queue-count={props.items.length}
        data-queue-expanded={props.expanded ? "" : undefined}
        data-queue-editing={editingActive ? "" : undefined}
      >
        <div
          className="ui-tray-header--queued flex min-h-9 min-w-0 items-center justify-between gap-2 px-2.5 py-1.5"
          data-queued-composer-panel-header=""
        >
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 rounded-multi-control px-1.5 py-1 text-left text-multi-fg-secondary transition-colors hover:bg-multi-bg-quaternary hover:text-multi-fg-primary focus-visible:ring-1 focus-visible:ring-multi-stroke-focused focus-visible:outline-none"
            aria-label={expandLabel}
            title={expandLabel}
            onClick={() => props.onExpandedChange(!props.expanded)}
            data-queued-composer-panel-toggle=""
          >
            <IconChevronDownMedium
              className={cn(
                "size-3.5 shrink-0 transition-transform duration-100",
                props.expanded ? "" : "-rotate-90",
              )}
              aria-hidden="true"
            />
            <span className="queue-tray__header-leading">
              <span className="queue-tray__header-count min-w-0 truncate font-medium">
                {countLabel}
              </span>
            </span>
          </button>
        </div>
        {props.expanded ? (
          <QueuedComposerItemsList
            items={props.items}
            editingItemId={props.editingItemId}
            isBusy={props.isBusy}
            onBeginEdit={props.onBeginEdit}
            onRemove={props.onRemove}
            onSendNow={props.onSendNow}
            onReorder={props.onReorder}
          />
        ) : null}
      </div>
    </div>
  );
});

export const QueuedComposerEditBanner = memo(function QueuedComposerEditBanner(props: {
  onCancelEdit: () => void;
}) {
  return (
    <div
      className="flex items-center justify-between gap-2 border border-b-0 border-multi-stroke-tertiary bg-(--multi-composer-queue-edit-banner-background) px-3 py-1.5 text-detail text-foreground"
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
