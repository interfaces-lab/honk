import { IconChevronRightMedium, IconCrossMediumDefault, IconPencilLine } from "central-icons";
import { memo } from "react";

import type { QueuedComposerItem, QueuedComposerItemId } from "../../../stores/chat-send-queue";
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
  const terminalContextCount = item.sendContext.terminalContexts.length;
  if (terminalContextCount > 0) {
    return terminalContextCount === 1
      ? "Terminal context"
      : `${terminalContextCount} terminal contexts`;
  }
  return "Queued message";
}

function formatQueuedComposerItemMeta(item: QueuedComposerItem, index: number): string {
  const parts = [`#${index + 1}`];
  if (item.sendContext.images.length > 0) {
    parts.push(`${item.sendContext.images.length} img`);
  }
  if (item.sendContext.terminalContexts.length > 0) {
    parts.push(`${item.sendContext.terminalContexts.length} ctx`);
  }
  return parts.join(" / ");
}

export const QueuedComposerItemsPanel = memo(function QueuedComposerItemsPanel(props: {
  items: readonly QueuedComposerItem[];
  editingItemId: QueuedComposerItemId | null;
  isBusy: boolean;
  onBeginEdit: (itemId: QueuedComposerItemId) => void;
  onCancelEdit: () => void;
  onRemove: (itemId: QueuedComposerItemId) => void;
  onSendNow: (itemId: QueuedComposerItemId) => void;
}) {
  if (props.items.length === 0) {
    return null;
  }

  return (
    <div className="border-b border-border/60 px-2.5 py-2 sm:px-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-detail font-medium text-muted-foreground">
          Queued ({props.items.length})
        </span>
        {props.editingItemId ? (
          <button
            type="button"
            className="rounded-multi-control px-1.5 py-0.5 text-detail text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-multi-stroke-focused focus-visible:outline-none"
            onClick={props.onCancelEdit}
          >
            Cancel edit
          </button>
        ) : null}
      </div>
      <div className="flex max-h-36 flex-col gap-1 overflow-y-auto pr-1">
        {props.items.map((item, index) => {
          const isEditing = props.editingItemId === item.id;
          return (
            <div
              key={item.id}
              className={cn(
                "flex min-h-9 items-center gap-2 rounded-md border px-2 py-1.5",
                isEditing ? "border-primary/50 bg-primary/10" : "border-border/70 bg-muted/25",
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
                  onClick={() => props.onBeginEdit(item.id)}
                  disabled={isEditing}
                  aria-label="Edit queued message"
                  title="Edit queued message"
                >
                  <IconPencilLine className="size-3.5" />
                </button>
                <button
                  type="button"
                  className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:ring-1 focus-visible:ring-multi-stroke-focused focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
                  onClick={() => props.onSendNow(item.id)}
                  disabled={props.isBusy || isEditing}
                  aria-label="Send queued message now"
                  title="Send queued message now"
                >
                  <IconChevronRightMedium className="size-3.5 -rotate-90" />
                </button>
                <button
                  type="button"
                  className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:ring-1 focus-visible:ring-multi-stroke-focused focus-visible:outline-none"
                  onClick={() => props.onRemove(item.id)}
                  aria-label="Remove queued message"
                  title="Remove queued message"
                >
                  <IconCrossMediumDefault className="size-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
