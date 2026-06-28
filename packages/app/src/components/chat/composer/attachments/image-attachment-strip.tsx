import {
  Attachment,
  AttachmentAction,
  AttachmentFallback,
  AttachmentGroup,
  AttachmentImage,
  AttachmentPreviewTrigger,
} from "@honk/honkkit/attachment";
import { IconCrossMediumDefault } from "central-icons";
import type { ComposerImageAttachment } from "../../../../stores/chat-drafts";
import {
  buildExpandedImagePreviewByIndex,
  type ExpandedImagePreview,
} from "../../message/expanded-image-preview";

export function ComposerImageAttachmentStrip(props: {
  images: readonly ComposerImageAttachment[];
  onExpandImage: (preview: ExpandedImagePreview) => void;
  onRemoveImage: (imageId: string) => void;
}) {
  if (props.images.length === 0) {
    return null;
  }

  return (
    <AttachmentGroup className="mb-2 px-3 pt-2">
      {props.images.map((image, index) => (
        <Attachment key={image.id}>
          {image.previewUrl ? (
            <AttachmentPreviewTrigger
              aria-label={`Preview ${image.name}`}
              onClick={() => {
                const preview = buildExpandedImagePreviewByIndex(props.images, index);
                if (!preview) return;
                props.onExpandImage(preview);
              }}
            >
              <AttachmentImage src={image.previewUrl} alt={image.name} />
            </AttachmentPreviewTrigger>
          ) : (
            <AttachmentFallback>{image.name}</AttachmentFallback>
          )}
          <AttachmentAction
            onClick={() => props.onRemoveImage(image.id)}
            aria-label={`Remove ${image.name}`}
          >
            <IconCrossMediumDefault />
          </AttachmentAction>
        </Attachment>
      ))}
    </AttachmentGroup>
  );
}
