import * as stylex from "@stylexjs/stylex";
import { Icon, IconButton } from "@honk/ui";
import { IconCrossSmall } from "@honk/ui/icons";
import { colorVars, controlVars, radiusVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as React from "react";

export type Attachment = {
  readonly key: string;
  readonly label: string;
  readonly path: string;
  readonly mime?: string;
};

const EXTENSION_MIME: Readonly<Record<string, string>> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  svg: "image/svg+xml", avif: "image/avif", pdf: "application/pdf", mp4: "video/mp4",
  m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime", mp3: "audio/mpeg",
  m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg", aac: "audio/aac", flac: "audio/flac",
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
  return attachment.path.startsWith("data:") || attachment.path.startsWith("blob:") || attachment.path.startsWith("file:") ? attachment.path : null;
}

const styles = stylex.create({
  group: { display: "flex", flexWrap: "wrap", gap: spaceVars["--honk-space-gutter"], paddingInline: "16px", paddingTop: spaceVars["--honk-space-gutter"] },
  attachment: { position: "relative", width: "56px", height: "56px", overflow: "hidden", borderRadius: radiusVars["--honk-radius-control"], backgroundColor: colorVars["--honk-color-control"], boxShadow: `inset 0 0 0 1px ${colorVars["--honk-color-border-base"]}` },
  media: { width: "100%", height: "100%", objectFit: "cover" },
  fallback: { width: "100%", height: "100%", display: "grid", placeItems: "center", padding: spaceVars["--honk-space-gutter"], overflow: "hidden", fontSize: "10px" },
  action: { position: "absolute", top: "4px", right: "4px" },
  chips: { display: "flex", flexWrap: "wrap", gap: controlVars["--honk-control-gap"], paddingInline: "16px", paddingTop: spaceVars["--honk-space-gutter"] },
  chip: { display: "inline-flex", alignItems: "center", gap: controlVars["--honk-control-gap"], maxWidth: "240px", height: "22px", paddingInlineStart: spaceVars["--honk-space-gutter"], borderRadius: radiusVars["--honk-radius-pill"], backgroundColor: colorVars["--honk-color-control"] },
  chipLabel: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
});

export function AttachmentList(props: {
  readonly attachments: readonly Attachment[];
  readonly onRemove: (key: string) => void;
}): React.ReactElement {
  const media = props.attachments.filter((attachment) => attachmentKind(attachment) !== "file");
  const files = props.attachments.filter((attachment) => attachmentKind(attachment) === "file");
  return (
    <>
      {media.length === 0 ? null : <div {...stylex.props(styles.group)}>{media.map((attachment) => {
        const kind = attachmentKind(attachment);
        const url = previewUrl(attachment);
        return <div key={attachment.key} {...stylex.props(styles.attachment)}>{kind === "image" && url !== null ? <img src={url} alt={attachment.label} {...stylex.props(styles.media)} /> : kind === "video" && url !== null ? <video src={url} muted {...stylex.props(styles.media)} /> : <span {...stylex.props(styles.fallback)}>{attachment.label}</span>}<span {...stylex.props(styles.action)}><IconButton size="sm" variant="quiet" aria-label={`Remove ${attachment.label}`} onClick={() => props.onRemove(attachment.key)}><Icon icon={IconCrossSmall} size="sm" /></IconButton></span></div>;
      })}</div>}
      {files.length === 0 ? null : <div {...stylex.props(styles.chips)}>{files.map((attachment) => <span key={attachment.key} {...stylex.props(styles.chip)} title={attachment.label}><span {...stylex.props(styles.chipLabel)}>{attachment.label}</span><IconButton size="sm" variant="quiet" aria-label={`Remove ${attachment.label}`} onClick={() => props.onRemove(attachment.key)}><Icon icon={IconCrossSmall} size="sm" /></IconButton></span>)}</div>}
    </>
  );
}
