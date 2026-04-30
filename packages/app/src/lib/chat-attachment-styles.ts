/**
 * User attachment surfaces.
 * Chat transcript (sent message): bubble cards.
 * Composer (pending): image grid + attachment strip (`ui-prompt-input-image-grid` + `prompt-attachment` ref).
 */

/** Human message thread — image tile (matches sent-message card weight). */
export const userAttachmentImageCard =
  "w-full overflow-hidden rounded-2xl border border-multi-border/45 bg-multi-bubble/70 shadow-multi-card backdrop-blur-sm sm:w-52";

/** Human message thread — file row. */
export const userAttachmentFileRow =
  "flex min-w-44 max-w-full items-start gap-2 rounded-2xl border border-multi-border/45 bg-multi-bubble/70 px-3 py-2 text-left shadow-multi-card backdrop-blur-sm sm:max-w-72";

/**
 * Composer attachment strip — holds image grid + file chips.
 * Ref: `prompt-attachment { display:flex; gap:4px }`.
 */
export const composerAttachmentStrip = "flex flex-wrap items-start justify-start gap-1";

/**
 * Composer image grid — `ui-prompt-input-image-grid` reference.
 * Grid of thumbnails, wrapping.
 */
export const composerImageGrid = "flex flex-wrap items-start gap-1";

/**
 * Composer image thumbnail — 48×48px (design-system 4px grid).
 * Reference layout `ui-prompt-input-image-preview` is 64px; Glass uses tighter spacing.
 */
export const composerImageThumbnail =
  "size-12 shrink-0 overflow-hidden rounded-multi-card border border-multi-border/30 bg-multi-hover/10 transition-[border-color,box-shadow] duration-150 hover:border-multi-stroke-strong/40 hover:shadow-[0_2px_8px_oklch(0_0_0_/_0.15)] dark:hover:shadow-[0_2px_8px_oklch(0_0_0_/_0.35)]";

/** Composer pending file chip — `rounded` (4px per design-system control). */
export const composerAttachmentChip =
  "flex min-w-0 max-w-full items-center gap-2 rounded bg-multi-hover/18 px-2 py-1";
