"use client";

import type { GitFileImageResult, GitFilePatchResult } from "@multi/contracts";
import { useEffect, useMemo, useState } from "react";

import { cn } from "~/lib/utils";

import { GitFileTypeIcon, getGitFileTypeDescriptor } from "./git-file-type";

function formatBytes(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"] as const;
  let value = sizeBytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const digits = unitIndex === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function GitImagePlaceholder(props: {
  readonly path: string;
  readonly patch: GitFilePatchResult | null;
  readonly title: string;
  readonly message: string;
  readonly className?: string | undefined;
}) {
  const descriptor = getGitFileTypeDescriptor({ path: props.path, patch: props.patch });

  return (
    <div
      className={cn(
        "flex min-h-32 min-w-0 flex-col items-center justify-center gap-2 px-4 py-8 text-center",
        props.className,
      )}
    >
      {descriptor ? <GitFileTypeIcon descriptor={descriptor} /> : null}
      <div className="flex max-w-md flex-col items-center gap-1">
        <p className="text-body font-medium text-foreground/82">{props.title}</p>
        <p className="text-detail text-muted-foreground/68">{props.message}</p>
      </div>
    </div>
  );
}

export function GitImageView(props: {
  readonly path: string;
  readonly patch: GitFilePatchResult | null;
  readonly image: GitFileImageResult | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly className?: string | undefined;
}) {
  const image = props.image;
  const imageSrc = useMemo(() => {
    if (image?.kind !== "image") {
      return null;
    }
    return `data:${image.mediaType};base64,${image.dataBase64}`;
  }, [image]);
  const [decodeFailed, setDecodeFailed] = useState(false);

  useEffect(() => {
    setDecodeFailed(false);
  }, [imageSrc]);

  if (props.loading && image === null) {
    return (
      <div className={cn("flex min-h-32 flex-col gap-2 px-4 py-5", props.className)}>
        <div className="h-3 w-full max-w-56 animate-pulse rounded bg-muted/35" />
        <div className="h-32 w-full max-w-xl animate-pulse rounded-[6px] bg-muted/24" />
      </div>
    );
  }

  if (props.error !== null) {
    return (
      <GitImagePlaceholder
        path={props.path}
        patch={props.patch}
        title="Could not load image"
        message={props.error}
        className={props.className}
      />
    );
  }

  if (image === null) {
    return (
      <GitImagePlaceholder
        path={props.path}
        patch={props.patch}
        title="Image unavailable"
        message="No image preview has loaded for this file."
        className={props.className}
      />
    );
  }

  switch (image.kind) {
    case "missing":
      return (
        <GitImagePlaceholder
          path={props.path}
          patch={props.patch}
          title="Image missing"
          message="The image file is not present in the working tree."
          className={props.className}
        />
      );
    case "too_large":
      return (
        <GitImagePlaceholder
          path={props.path}
          patch={props.patch}
          title="Image too large"
          message={`Preview is disabled for this ${formatBytes(image.sizeBytes)} image.`}
          className={props.className}
        />
      );
    case "unsupported":
      return (
        <GitImagePlaceholder
          path={props.path}
          patch={props.patch}
          title="Unsupported image"
          message="This image format cannot be previewed."
          className={props.className}
        />
      );
    case "image":
      if (imageSrc === null || decodeFailed) {
        return (
          <GitImagePlaceholder
            path={props.path}
            patch={props.patch}
            title="Could not decode image"
            message="The browser could not render this image preview."
            className={props.className}
          />
        );
      }

      return (
        <div className={cn("flex min-w-0 flex-col gap-2 px-4 py-4", props.className)}>
          <div className="flex max-h-[70vh] min-h-32 min-w-0 items-center justify-center overflow-auto rounded-[6px] border border-multi-workbench-panel-border-muted bg-multi-bg-primary p-3">
            <img
              src={imageSrc}
              alt={props.path}
              className="max-h-[calc(70vh-2rem)] max-w-full object-contain"
              onError={() => setDecodeFailed(true)}
            />
          </div>
          <div className="flex min-w-0 items-center justify-between gap-3 text-caption text-multi-fg-tertiary">
            <span className="min-w-0 truncate">{props.path}</span>
            <span className="shrink-0 tabular-nums">{formatBytes(image.sizeBytes)}</span>
          </div>
        </div>
      );
    default: {
      const _exhaustive: never = image;
      return _exhaustive;
    }
  }
}
