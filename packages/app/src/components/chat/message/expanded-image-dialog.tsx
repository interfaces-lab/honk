import { type KeyboardEvent, useState } from "react";
import {
  IconChevronLeftMedium,
  IconChevronRightMedium,
  IconCrossMediumDefault,
} from "central-icons";
import { Button } from "@multi/multikit/button";
import type { ExpandedImagePreview } from "./expanded-image-preview";

interface ExpandedImageDialogProps {
  preview: ExpandedImagePreview;
  onClose: () => void;
}

export function ExpandedImageDialog({
  preview,
  onClose,
}: ExpandedImageDialogProps) {
  const [index, setIndex] = useState(() => preview.index);

  const navigateImage = (direction: -1 | 1) => {
    setIndex((existingIndex) => {
      if (preview.images.length <= 1) return existingIndex;
      const nextIndex = (existingIndex + direction + preview.images.length) % preview.images.length;
      return nextIndex === existingIndex ? existingIndex : nextIndex;
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (preview.images.length <= 1) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      event.stopPropagation();
      navigateImage(-1);
      return;
    }
    if (event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    navigateImage(1);
  };

  const item = preview.images[index];
  if (!item) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 py-6 [-webkit-app-region:no-drag]"
      role="dialog"
      aria-modal="true"
      aria-label="Expanded image preview"
      onKeyDown={handleKeyDown}
    >
      <Button
        type="button"
        variant="ghost"
        className="absolute inset-0 z-0 cursor-zoom-out rounded-none border-0 bg-transparent p-0 shadow-none before:hidden hover:bg-transparent data-pressed:bg-transparent"
        aria-label="Close image preview"
        onClick={onClose}
      />
      {preview.images.length > 1 && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="absolute left-2 top-1/2 z-20 -translate-y-1/2 text-white/90 hover:bg-white/10 hover:text-white sm:left-6"
          aria-label="Previous image"
          onClick={() => navigateImage(-1)}
        >
          <IconChevronLeftMedium className="size-5" />
        </Button>
      )}
      <div className="relative isolate z-10 max-h-[92vh] max-w-full">
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="absolute right-2 top-2"
          onClick={onClose}
          aria-label="Close image preview"
        >
          <IconCrossMediumDefault />
        </Button>
        <img
          src={item.src}
          alt={item.name}
          className="max-h-[86vh] max-w-full select-none rounded-lg border border-border/70 bg-background object-contain shadow-2xl"
          draggable={false}
        />
        <p className="mt-2 max-w-full truncate text-center text-xs text-muted-foreground/80">
          {item.name}
          {preview.images.length > 1 ? ` (${index + 1}/${preview.images.length})` : ""}
        </p>
      </div>
      {preview.images.length > 1 && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="absolute right-2 top-1/2 z-20 -translate-y-1/2 text-white/90 hover:bg-white/10 hover:text-white sm:right-6"
          aria-label="Next image"
          onClick={() => navigateImage(1)}
        >
          <IconChevronRightMedium className="size-5" />
        </Button>
      )}
    </div>
  );
}
