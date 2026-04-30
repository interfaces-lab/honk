import { ContextMenu } from "@base-ui/react/context-menu";
import { IconArchive, IconBell, IconClipboard, IconEditSmall1 } from "central-icons";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

const popupSurface = cn(
  "multi-slash-menu-popup multi-composer-token-menu",
  "origin-[var(--transform-origin)]",
  "overflow-hidden rounded-multi-card border border-multi-stroke bg-multi-bubble shadow-multi-popup backdrop-blur-xl",
  "w-[min(280px,calc(100vw-2rem))] text-[12px] leading-[16px] select-none outline-none",
);

const itemClass = cn(
  "flex w-full cursor-pointer items-center gap-[6px] rounded-sm px-1 py-[3px] text-left text-foreground/82 outline-none transition-colors",
  "hover:bg-multi-hover/40 data-highlighted:bg-multi-active data-highlighted:text-foreground",
  "focus-visible:outline-none",
);

export function ThreadContextMenu(props: {
  children: ReactNode;
  threadId: string;
  onRename: () => void;
  onMarkUnread: () => void;
  onArchive: () => void;
}) {
  return (
    <ContextMenu.Root data-slot="context-menu-root">
      <ContextMenu.Trigger className="w-full min-w-0" data-slot="context-menu-trigger">
        {props.children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner className="z-50 outline-none" sideOffset={8} align="start">
          <ContextMenu.Popup
            data-slot="context-menu-popup"
            finalFocus={false}
            className={cn(popupSurface, "z-50")}
          >
            <div className="flex max-h-72 min-h-0 flex-col gap-px overflow-y-auto overscroll-contain p-1">
              <ContextMenu.Item label="Rename" onClick={props.onRename} className={itemClass}>
                <span className="inline-flex h-4 w-3 shrink-0 items-center justify-center text-muted-foreground/60">
                  <IconEditSmall1 className="size-3" aria-hidden />
                </span>
                <span className="min-w-0 flex-1 truncate">Rename</span>
              </ContextMenu.Item>
              <ContextMenu.Item
                label="Mark as unread"
                onClick={props.onMarkUnread}
                className={itemClass}
              >
                <span className="inline-flex h-4 w-3 shrink-0 items-center justify-center text-muted-foreground/60">
                  <IconBell className="size-3" aria-hidden />
                </span>
                <span className="min-w-0 flex-1 truncate">Mark as unread</span>
              </ContextMenu.Item>
              <ContextMenu.Separator className="my-0.5 h-px shrink-0 bg-multi-stroke/60" />
              <ContextMenu.Item
                label="Copy Thread ID"
                onClick={() => void navigator.clipboard.writeText(props.threadId)}
                className={itemClass}
              >
                <span className="inline-flex h-4 w-3 shrink-0 items-center justify-center text-muted-foreground/60">
                  <IconClipboard className="size-3" aria-hidden />
                </span>
                <span className="min-w-0 flex-1 truncate">Copy Thread ID</span>
              </ContextMenu.Item>
              <ContextMenu.Separator className="my-0.5 h-px shrink-0 bg-multi-stroke/60" />
              <ContextMenu.Item label="Archive" onClick={props.onArchive} className={itemClass}>
                <span className="inline-flex h-4 w-3 shrink-0 items-center justify-center text-muted-foreground/60">
                  <IconArchive className="size-3" aria-hidden />
                </span>
                <span className="min-w-0 flex-1 truncate">Archive</span>
              </ContextMenu.Item>
            </div>
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
