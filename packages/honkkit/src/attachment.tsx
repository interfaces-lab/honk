"use client";

import { type ComponentProps } from "react";

import { Button } from "./button";
import { cn } from "./utils";

type AttachmentGroupProps = ComponentProps<"div">;
type AttachmentProps = ComponentProps<"div">;
type AttachmentImageProps = ComponentProps<"img">;
type AttachmentFallbackProps = ComponentProps<"div">;
type AttachmentPreviewTriggerProps = Omit<ComponentProps<typeof Button>, "size" | "variant">;
type AttachmentActionProps = Omit<ComponentProps<typeof Button>, "size" | "variant">;

function AttachmentGroup({ className, ...props }: AttachmentGroupProps) {
  return (
    <div
      className={cn("flex max-w-full flex-wrap gap-2", className)}
      data-slot="attachment-group"
      {...props}
    />
  );
}

function Attachment({ className, ...props }: AttachmentProps) {
  return (
    <div
      className={cn(
        "relative size-14 shrink-0 overflow-hidden rounded-honk-control border border-honk-stroke-secondary bg-honk-bubble",
        className,
      )}
      data-slot="attachment"
      {...props}
    />
  );
}

function AttachmentPreviewTrigger({
  className,
  type = "button",
  ...props
}: AttachmentPreviewTriggerProps) {
  return (
    <Button
      type={type}
      variant="ghost"
      className={cn(
        "block size-full cursor-zoom-in rounded-none border-0 bg-transparent p-0 shadow-none before:hidden hover:bg-transparent data-pressed:bg-transparent",
        className,
      )}
      data-slot="attachment-preview-trigger"
      {...props}
    />
  );
}

function AttachmentImage({ className, ...props }: AttachmentImageProps) {
  return (
    <img
      className={cn("block size-full object-cover", className)}
      data-slot="attachment-image"
      {...props}
    />
  );
}

function AttachmentFallback({ children, className, ...props }: AttachmentFallbackProps) {
  return (
    <div
      className={cn(
        "flex size-full items-center justify-center px-1 text-center text-caption text-honk-fg-tertiary",
        className,
      )}
      data-slot="attachment-fallback"
      {...props}
    >
      <span className="min-w-0 max-w-full truncate">{children}</span>
    </div>
  );
}

function AttachmentAction({ className, type = "button", ...props }: AttachmentActionProps) {
  return (
    <Button
      type={type}
      variant="ghost"
      size="icon-xs"
      className={cn("absolute right-1 top-1 bg-background/80 hover:bg-background/90", className)}
      data-slot="attachment-action"
      {...props}
    />
  );
}

export {
  Attachment,
  AttachmentAction,
  AttachmentFallback,
  AttachmentGroup,
  AttachmentImage,
  AttachmentPreviewTrigger,
};
