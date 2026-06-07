"use client";

import type { GitFilePatchResult, GitNonTextFileType } from "@multi/contracts";
import {
  IconArchive1,
  IconFileBend,
  IconImages1,
  IconMultiMedia,
  IconPageText,
  IconTextSize,
  IconVideo,
  IconWarningSign,
} from "central-icons";
import type { ComponentType } from "react";

import { cn } from "~/lib/utils";

type GitFileDisplayType = GitNonTextFileType | "large";
type GitFileTypeIcon = ComponentType<{ className?: string | undefined }>;

export interface GitFileTypeDescriptor {
  readonly type: GitFileDisplayType;
  readonly label: string;
  readonly symbol: string;
  readonly Icon: GitFileTypeIcon;
  readonly className: string;
}

const IMAGE_FILE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "heic",
  "heif",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "tif",
  "tiff",
  "webp",
]);
const VIDEO_FILE_EXTENSIONS = new Set(["avi", "m4v", "mkv", "mov", "mp4", "mpeg", "mpg", "webm"]);
const AUDIO_FILE_EXTENSIONS = new Set(["aac", "aiff", "flac", "m4a", "mp3", "ogg", "wav"]);
const ARCHIVE_FILE_EXTENSIONS = new Set([
  "7z",
  "br",
  "bz2",
  "dmg",
  "gz",
  "rar",
  "tar",
  "tgz",
  "xz",
  "zip",
]);
const DOCUMENT_FILE_EXTENSIONS = new Set([
  "doc",
  "docx",
  "key",
  "numbers",
  "pages",
  "pdf",
  "ppt",
  "pptx",
  "xls",
  "xlsx",
]);
const FONT_FILE_EXTENSIONS = new Set(["eot", "otf", "ttc", "ttf", "woff", "woff2"]);

const BASE_DESCRIPTORS: Record<GitFileDisplayType, GitFileTypeDescriptor> = {
  image: {
    type: "image",
    label: "Image",
    symbol: "IMG",
    Icon: IconImages1,
    className: "text-multi-fg-secondary",
  },
  video: {
    type: "video",
    label: "Video",
    symbol: "VID",
    Icon: IconVideo,
    className: "text-multi-fg-secondary",
  },
  audio: {
    type: "audio",
    label: "Audio",
    symbol: "AUD",
    Icon: IconMultiMedia,
    className: "text-multi-fg-secondary",
  },
  archive: {
    type: "archive",
    label: "Archive",
    symbol: "ZIP",
    Icon: IconArchive1,
    className: "text-multi-fg-secondary",
  },
  document: {
    type: "document",
    label: "Document",
    symbol: "DOC",
    Icon: IconPageText,
    className: "text-multi-fg-secondary",
  },
  font: {
    type: "font",
    label: "Font",
    symbol: "FONT",
    Icon: IconTextSize,
    className: "text-multi-fg-secondary",
  },
  binary: {
    type: "binary",
    label: "Binary",
    symbol: "BIN",
    Icon: IconFileBend,
    className: "text-multi-fg-secondary",
  },
  large: {
    type: "large",
    label: "Large",
    symbol: "BIG",
    Icon: IconWarningSign,
    className: "text-multi-fg-secondary",
  },
};

function fileExtension(path: string | null | undefined): string {
  if (!path) return "";
  const fileName = path.split(/[\\/]/).pop() ?? path;
  const extensionStart = fileName.lastIndexOf(".");
  if (extensionStart <= 0 || extensionStart === fileName.length - 1) {
    return "";
  }
  return fileName.slice(extensionStart + 1).toLowerCase();
}

function resolvePathFileType(extension: string): GitNonTextFileType | null {
  if (IMAGE_FILE_EXTENSIONS.has(extension)) return "image";
  if (VIDEO_FILE_EXTENSIONS.has(extension)) return "video";
  if (AUDIO_FILE_EXTENSIONS.has(extension)) return "audio";
  if (ARCHIVE_FILE_EXTENSIONS.has(extension)) return "archive";
  if (DOCUMENT_FILE_EXTENSIONS.has(extension)) return "document";
  if (FONT_FILE_EXTENSIONS.has(extension)) return "font";
  return null;
}

function extensionSymbol(extension: string, fallback: string): string {
  if (extension.length > 0 && extension.length <= 4) {
    return extension.toUpperCase();
  }
  return fallback;
}

function descriptorFor(type: GitFileDisplayType, extension: string): GitFileTypeDescriptor {
  const descriptor = BASE_DESCRIPTORS[type];
  if (type === "large" || type === "binary") {
    return descriptor;
  }
  return {
    ...descriptor,
    symbol: extensionSymbol(extension, descriptor.symbol),
  };
}

export function getGitFileTypeDescriptor(input: {
  readonly path?: string | null | undefined;
  readonly patch?: GitFilePatchResult | null | undefined;
}): GitFileTypeDescriptor | null {
  const extension = fileExtension(input.path);
  if (input.patch?.kind === "large") {
    return descriptorFor("large", extension);
  }
  if (input.patch?.kind === "non_text") {
    return descriptorFor(input.patch.fileType, extension);
  }
  const pathType = resolvePathFileType(extension);
  return pathType === null ? null : descriptorFor(pathType, extension);
}

export function GitFileTypeSymbol(props: {
  readonly descriptor: GitFileTypeDescriptor;
  readonly className?: string | undefined;
}) {
  return (
    <span
      aria-label={`${props.descriptor.label} file`}
      className={cn(
        "inline-flex h-4 min-w-6 shrink-0 items-center justify-center rounded-[3px] border border-multi-workbench-panel-border-muted px-1 text-[9px]/[14px] font-medium tabular-nums",
        props.descriptor.className,
        props.className,
      )}
      title={`${props.descriptor.label} file`}
    >
      {props.descriptor.symbol}
    </span>
  );
}

export function GitFileTypeIcon(props: {
  readonly descriptor: GitFileTypeDescriptor;
  readonly className?: string | undefined;
}) {
  const Icon = props.descriptor.Icon;
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-[6px] border border-multi-workbench-panel-border-muted bg-multi-bg-tertiary text-multi-icon-secondary",
        props.className,
      )}
    >
      <Icon className="size-4" />
    </span>
  );
}
