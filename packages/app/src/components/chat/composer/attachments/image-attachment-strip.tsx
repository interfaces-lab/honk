import { Button } from "@honk/honkkit/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@honk/honkkit/tooltip";
import { IconCrossMediumDefault, IconExclamationCircle } from "central-icons";
import type { ComposerImageAttachment } from "../../../../stores/chat-drafts";
import {
  buildExpandedImagePreview,
  type ExpandedImagePreview,
} from "../../message/expanded-image-preview";

export function ComposerImageAttachmentStrip(props: {
  images: readonly ComposerImageAttachment[];
  nonPersistedImageIds: ReadonlySet<string>;
  onExpandImage: (preview: ExpandedImagePreview) => void;
  onRemoveImage: (imageId: string) => void;
}) {
  if (props.images.length === 0) {
    return null;
  }

  return (
    <div className="mb-2 flex flex-wrap gap-2 px-3 pt-2">
      {props.images.map((image) => (
        <div
          key={image.id}
          className="relative h-14 w-14 overflow-hidden rounded-[var(--honk-radius-control,6px)] border border-border/80 bg-background"
        >
          {image.previewUrl ? (
            <Button
              type="button"
              variant="ghost"
              className="h-full w-full cursor-zoom-in rounded-none border-0 bg-transparent p-0 shadow-none before:hidden hover:bg-transparent data-pressed:bg-transparent"
              aria-label={`Preview ${image.name}`}
              onClick={() => {
                const preview = buildExpandedImagePreview(props.images, image.id);
                if (!preview) return;
                props.onExpandImage(preview);
              }}
            >
              <img src={image.previewUrl} alt={image.name} className="h-full w-full object-cover" />
            </Button>
          ) : (
            <div className="flex h-full w-full items-center justify-center px-1 text-center text-caption text-muted-foreground/70">
              {image.name}
            </div>
          )}
          {props.nonPersistedImageIds.has(image.id) ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    role="img"
                    aria-label="Draft attachment may not persist"
                    className="absolute left-1 top-1 inline-flex items-center justify-center rounded bg-background/85 p-0.5 text-amber-600"
                  >
                    <IconExclamationCircle className="size-3" />
                  </span>
                }
              />
              <TooltipPopup side="top" className="max-w-64 whitespace-normal leading-tight">
                Draft attachment could not be saved locally and may be lost on navigation.
              </TooltipPopup>
            </Tooltip>
          ) : null}
          <Button
            variant="ghost"
            size="icon-xs"
            className="absolute right-1 top-1 bg-background/80 hover:bg-background/90"
            onClick={() => props.onRemoveImage(image.id)}
            aria-label={`Remove ${image.name}`}
          >
            <IconCrossMediumDefault />
          </Button>
        </div>
      ))}
    </div>
  );
}
