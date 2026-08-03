import * as stylex from "@stylexjs/stylex";
import { Button, Dialog, Icon, IconButton } from "@honk/ui";
import { IconCrossMedium, IconCrossSmall } from "@honk/ui/icons";
import {
  borderVars,
  colorVars,
  controlVars,
  motionVars,
  radiusVars,
  spaceVars,
} from "@honk/ui/tokens.stylex";
import * as React from "react";

import { chipStyles, FileChipIcon } from "./chip";

export type Attachment = {
  readonly key: string;
  readonly label: string;
  readonly path: string;
  readonly mime?: string;
};

const EXTENSION_MIME: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  pdf: "application/pdf",
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
  aac: "audio/aac",
  flac: "audio/flac",
};

export function mimeFromPath(path: string): string | undefined {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? undefined : EXTENSION_MIME[path.slice(dot + 1).toLowerCase()];
}
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

export async function attachmentFromFile(file: File): Promise<Attachment> {
  const path = await readAsDataUrl(file);
  const label =
    file.name.length > 0
      ? file.name
      : `pasted.${(file.type.split("/")[1] ?? "bin").split("+")[0] ?? "bin"}`;
  const mime = file.type.length > 0 ? file.type : mimeFromPath(label);
  return {
    key: `${label}:${String(file.size)}:${String(file.lastModified)}`,
    label,
    path,
    ...(mime === undefined ? {} : { mime }),
  };
}

type AttachmentKind = "image" | "video" | "audio" | "file";
function attachmentKind(attachment: Attachment): AttachmentKind {
  const mime = attachment.mime ?? "";
  if (mime.startsWith("image/") || attachment.path.startsWith("data:image/")) return "image";
  if (mime.startsWith("video/") || attachment.path.startsWith("data:video/")) return "video";
  if (mime.startsWith("audio/") || attachment.path.startsWith("data:audio/")) return "audio";
  return "file";
}
function previewUrl(attachment: Attachment): string | null {
  return attachment.path.startsWith("data:") ||
    attachment.path.startsWith("blob:") ||
    attachment.path.startsWith("file:")
    ? attachment.path
    : null;
}
// Cursor's composer image-grid geometry: 64px thumbnails with a 16px corner remove
// chip, in a single fixed-height strip above the prompt text.
const THUMBNAIL_SIZE = "64px";
const REMOVE_SIZE = "16px";
const REMOVE_INSET = "2px";
// Chip row height: the 22px pill that Cursor uses above the prompt, tall enough to hold the same
// 16px remove control as a thumbnail corner without adding a second strip row.
const CHIP_HEIGHT = "22px";
// The image preview preserves a 24px viewport gutter while allowing more room than a text dialog.
const IMAGE_PREVIEW_DIALOG_WIDTH = "calc(100% - 48px)";
const IMAGE_PREVIEW_DIALOG_MAX_WIDTH = "920px";
const IMAGE_PREVIEW_DIALOG_MAX_HEIGHT = "calc(100dvh - 48px)";
// Attachment filenames stay bounded within the composer strip.
const ATTACHMENT_CHIP_MAX_WIDTH = "240px";
// The preview image reserves room for the dialog header and outer insets.
const IMAGE_PREVIEW_MAX_HEIGHT = "calc(100dvh - 112px)";
const IMAGE_PREVIEW_DIALOG_STYLE: React.CSSProperties = {
  width: IMAGE_PREVIEW_DIALOG_WIDTH,
  maxWidth: IMAGE_PREVIEW_DIALOG_MAX_WIDTH,
  maxHeight: IMAGE_PREVIEW_DIALOG_MAX_HEIGHT,
};
// minWidth/minHeight are zeroed so the canonical Button's intrinsic min-size cannot
// override the explicit thumbnail dimensions and inflate the media past its 64px box. The
// single-cell grid area stacks it over the monogram layer without leaving the tile's clip.
const ATTACHMENT_PREVIEW_BUTTON_STYLE: React.CSSProperties = {
  gridArea: "1 / 1",
  width: "100%",
  height: "100%",
  minWidth: 0,
  minHeight: 0,
  padding: 0,
};
const REMOVE_BUTTON_STYLE: React.CSSProperties = {
  width: REMOVE_SIZE,
  height: REMOVE_SIZE,
  // Zero the canonical IconButton min-size (24px) so the corner chip holds its 16px geometry.
  minWidth: 0,
  minHeight: 0,
  borderRadius: radiusVars["--honk-radius-avatar"],
};

const styles = stylex.create({
  // One strip above the prompt text holding thumbnails and chips together; overflow scrolls
  // horizontally so the composer grows by exactly one row and no more. flexShrink:0 keeps the
  // column from crushing the strip when the prompt is a single short line, which would
  // otherwise let the fixed-height thumbnails spill down over the text.
  strip: {
    display: "flex",
    flexShrink: 0,
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    // oxlint-disable-next-line honk/design-no-raw-values -- 16px aligns the attachment strip with the editor's inline text inset; no spacing token owns that editor inset
    paddingInline: "16px",
    paddingBlockStart: spaceVars["--honk-space-gutter"],
    overflowX: "auto",
    overflowY: "hidden",
    scrollbarWidth: "thin",
  },
  // Cursor holds the remove control back until the item is hovered or takes focus, so a resting
  // strip reads as content rather than a row of dismiss buttons. StyleX 0.19 has no descendant
  // selectors, so each item publishes the reveal through private `--_` vars its button reads.
  // Pointers without hover never reach either state, so they get the control permanently.
  item: {
    "--_remove-opacity": {
      default: "0",
      ":hover": { "@media (hover: hover)": "1" },
      ":focus-within": "1",
      "@media (hover: none)": "1",
    },
    // Opacity alone leaves an invisible button hit-testable; pointer-events tracks the reveal.
    "--_remove-pointer-events": {
      default: "none",
      ":hover": { "@media (hover: hover)": "auto" },
      ":focus-within": "auto",
      "@media (hover: none)": "auto",
    },
  },
  // Single-cell grid: the monogram layer, the media, and the corner control stack in one 64px
  // box that clips everything, so nothing an attachment carries can paint outside the tile.
  thumbnail: {
    position: "relative",
    display: "grid",
    flexShrink: 0,
    width: THUMBNAIL_SIZE,
    height: THUMBNAIL_SIZE,
    overflow: "hidden",
    borderRadius: radiusVars["--honk-radius-avatar"],
    backgroundColor: colorVars["--honk-color-control"],
    // oxlint-disable-next-line honk/design-no-raw-values -- inset shadow syntax draws the thumbnail border ring; its width uses the hairline token and no elevation token owns this ring
    boxShadow: `inset 0 0 0 ${borderVars["--honk-border-hairline"]} ${colorVars["--honk-color-border-base"]}`,
  },
  // Bounded stand-in behind the media: media that never decodes uncovers the file glyph instead of
  // an unclamped label.
  thumbnailBadge: {
    gridArea: "1 / 1",
    display: "grid",
    placeItems: "center",
    minWidth: 0,
    minHeight: 0,
  },
  media: { gridArea: "1 / 1", width: "100%", height: "100%", objectFit: "cover" },
  // Physical files remain in the attachment strip. Their removable container keeps neutral pill
  // chrome; sourced @ references use the separate transparent text anatomy in chip.tsx.
  chip: {
    display: "inline-flex",
    alignItems: "center",
    flexShrink: 0,
    maxWidth: ATTACHMENT_CHIP_MAX_WIDTH,
    minWidth: 0,
    height: CHIP_HEIGHT,
    paddingInline: controlVars["--honk-control-gap"],
    borderRadius: radiusVars["--honk-radius-pill"],
    backgroundColor: colorVars["--honk-color-control"],
    color: colorVars["--honk-color-text-primary"],
    whiteSpace: "nowrap",
  },
  // paddingInlineEnd:0 lets the remove button own the pill's end; a read-only chip keeps its padding.
  chipWithRemove: { paddingInlineEnd: 0 },
  previewHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spaceVars["--honk-space-panel-pad"],
  },
  previewTitle: { minWidth: 0, overflowWrap: "anywhere" },
  previewBody: { minHeight: 0, display: "grid", placeItems: "center" },
  previewImage: {
    display: "block",
    maxWidth: "100%",
    maxHeight: IMAGE_PREVIEW_MAX_HEIGHT,
    objectFit: "contain",
  },
  remove: {
    display: "flex",
    opacity: "var(--_remove-opacity, 0)",
    pointerEvents: "var(--_remove-pointer-events, none)",
    transitionProperty: "opacity",
    transitionDuration: motionVars["--honk-motion-duration-hover"],
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
  },
  removeInChip: { marginInlineStart: controlVars["--honk-control-gap"] },
  removeCorner: {
    position: "absolute",
    insetBlockStart: REMOVE_INSET,
    insetInlineEnd: REMOVE_INSET,
  },
});

export function AttachmentList(props: {
  readonly attachments: readonly Attachment[];
  readonly onRemove?: ((key: string) => void) | undefined;
  readonly style?: stylex.StyleXStyles | undefined;
}): React.ReactElement | null {
  const onRemove = props.onRemove;
  if (props.attachments.length === 0) return null;
  return (
    <div {...stylex.props(styles.strip, props.style)}>
      {props.attachments.map((attachment) => {
        const kind = attachmentKind(attachment);
        const url = previewUrl(attachment);
        const icon = <FileChipIcon path={attachment.label} />;
        const remove =
          onRemove === undefined ? null : (
            <AttachmentRemoveButton
              label={attachment.label}
              onRemove={() => onRemove(attachment.key)}
            />
          );
        // Only a still image or a video can fill a thumbnail. Everything else — files, attached
        // chats, audio, and media the renderer cannot address — is a chip, so nothing but real
        // media can widen the strip past one thumbnail row.
        if (url !== null && (kind === "image" || kind === "video")) {
          return (
            <div key={attachment.key} {...stylex.props(styles.item, styles.thumbnail)}>
              <span {...stylex.props(styles.thumbnailBadge)}>{icon}</span>
              {kind === "image" ? (
                <ImageAttachmentPreview attachment={attachment} url={url} />
              ) : (
                <video src={url} muted {...stylex.props(styles.media)} />
              )}
              {remove !== null && (
                <span {...stylex.props(styles.remove, styles.removeCorner)}>{remove}</span>
              )}
            </div>
          );
        }
        return (
          <span
            key={attachment.key}
            title={attachment.label}
            {...stylex.props(styles.item, styles.chip, remove !== null && styles.chipWithRemove)}
          >
            {icon}
            <span {...stylex.props(chipStyles.label)}>{attachment.label}</span>
            {remove !== null && (
              <span {...stylex.props(styles.remove, styles.removeInChip)}>{remove}</span>
            )}
          </span>
        );
      })}
    </div>
  );
}

// oxlint-disable honk/design-no-canonical-control-overrides -- The shared IconButton keeps its interaction chrome; it is only sized down to Cursor's 16px corner-chip geometry because the smallest canonical size (24px) would cover a quarter of the 64px thumbnail.
function AttachmentRemoveButton(props: {
  readonly label: string;
  readonly onRemove: () => void;
}): React.ReactElement {
  return (
    <IconButton
      size="sm"
      variant="neutral"
      aria-label={`Remove ${props.label}`}
      style={REMOVE_BUTTON_STYLE}
      onClick={props.onRemove}
    >
      <Icon icon={IconCrossSmall} size="xs" />
    </IconButton>
  );
}
// oxlint-enable honk/design-no-canonical-control-overrides

// oxlint-disable honk/design-no-canonical-control-overrides -- The shared Button keeps its interaction chrome; only its layout is sized to the media thumbnail.
function ImageAttachmentPreview(props: {
  readonly attachment: Attachment;
  readonly url: string;
}): React.ReactElement {
  return (
    <Dialog.Root>
      <Dialog.Trigger
        render={
          <Button
            block
            size="sm"
            variant="quiet"
            aria-label={`Preview ${props.attachment.label}`}
            style={ATTACHMENT_PREVIEW_BUTTON_STYLE}
          />
        }
      >
        <img src={props.url} alt="" {...stylex.props(styles.media)} />
      </Dialog.Trigger>
      <Dialog.Popup style={IMAGE_PREVIEW_DIALOG_STYLE}>
        <div {...stylex.props(styles.previewHeader)}>
          <div {...stylex.props(styles.previewTitle)}>
            <Dialog.Title>{props.attachment.label}</Dialog.Title>
          </div>
          <Dialog.Close
            render={
              <IconButton size="md" variant="quiet" aria-label="Close image preview">
                <Icon icon={IconCrossMedium} size="md" />
              </IconButton>
            }
          />
        </div>
        <div {...stylex.props(styles.previewBody)}>
          <img
            src={props.url}
            alt={props.attachment.label}
            {...stylex.props(styles.previewImage)}
          />
        </div>
      </Dialog.Popup>
    </Dialog.Root>
  );
}
// oxlint-enable honk/design-no-canonical-control-overrides
