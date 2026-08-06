import type { OpenCodeClient, OpenCodeServerKey } from "@honk/opencode";
import * as React from "react";

import { errorMessage } from "./error-message";
import { getOpenCodeClient } from "./watch-registry";

const IMAGE_MEDIA_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = Object.freeze({
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  ico: "image/x-icon",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  webp: "image/webp",
});

type ImagePreviewState =
  | { readonly phase: "loading" }
  | {
      readonly phase: "ready";
      readonly src: string;
      readonly sizeBytes: number;
    }
  | { readonly phase: "unavailable"; readonly message: string }
  | { readonly phase: "error"; readonly message: string };

type ImagePreviewResource = {
  readonly getSnapshot: () => ImagePreviewState;
  readonly subscribe: (listener: () => void) => () => void;
};

type ImagePreviewClient = Pick<OpenCodeClient, "files">;
type ImagePreviewClientResolver = () => ImagePreviewClient | null;

const INITIAL_IMAGE_PREVIEW_STATE: ImagePreviewState = Object.freeze({ phase: "loading" });
const imagePreviewResources = new Map<string, ImagePreviewResource>();

function imageExtension(path: string): string {
  const leaf = path.replaceAll("\\", "/").split("/").at(-1) ?? "";
  const dot = leaf.lastIndexOf(".");
  return dot < 0 ? "" : leaf.slice(dot + 1).toLowerCase();
}

function isImagePreviewPath(path: string): boolean {
  return IMAGE_MEDIA_TYPE_BY_EXTENSION[imageExtension(path)] !== undefined;
}

function imageMediaType(path: string, reported: string | undefined): string | null {
  if (reported?.toLowerCase().startsWith("image/") === true) return reported;
  return IMAGE_MEDIA_TYPE_BY_EXTENSION[imageExtension(path)] ?? null;
}

function base64ByteLength(base64: string): number {
  const normalized = base64.replaceAll(/\s/g, "");
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

async function loadImagePreview(
  client: ImagePreviewClient,
  directory: string,
  path: string,
): Promise<ImagePreviewState> {
  const content = await client.files.read(path, { directory });
  const mediaType = imageMediaType(path, content.kind === "binary" ? content.mimeType : undefined);
  if (mediaType === null) {
    return { phase: "unavailable", message: "This file is not a supported image." };
  }
  if (content.kind === "text") {
    if (mediaType !== "image/svg+xml") {
      return { phase: "unavailable", message: "No image preview is available for this file." };
    }
    return {
      phase: "ready",
      src: `data:${mediaType};charset=utf-8,${encodeURIComponent(content.text)}`,
      sizeBytes: new TextEncoder().encode(content.text).byteLength,
    };
  }
  return {
    phase: "ready",
    src: `data:${mediaType};base64,${content.base64}`,
    sizeBytes: base64ByteLength(content.base64),
  };
}

function createImagePreviewResource(
  directory: string,
  path: string,
  resolveClient: ImagePreviewClientResolver,
  onRelease?: () => void,
): ImagePreviewResource {
  let snapshot = INITIAL_IMAGE_PREVIEW_STATE;
  let requested = false;
  let releaseTimer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();

  const publish = (next: ImagePreviewState): void => {
    snapshot = Object.freeze(next);
    for (const listener of listeners) listener();
  };

  const load = (): void => {
    if (requested) return;
    requested = true;
    const client = resolveClient();
    if (client === null) {
      publish({ phase: "error", message: "Honk is not connected to OpenCode." });
      return;
    }
    void loadImagePreview(client, directory, path).then(publish, (error: unknown) => {
      publish({ phase: "error", message: errorMessage(error) });
    });
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (releaseTimer !== null) {
        clearTimeout(releaseTimer);
        releaseTimer = null;
      }
      listeners.add(listener);
      load();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          // One task lets React Strict Mode resubscribe without a duplicate read, then releases the
          // base64 payload as soon as the expanded body is truly gone.
          releaseTimer = setTimeout(() => {
            if (listeners.size === 0) onRelease?.();
          }, 0);
        }
      };
    },
  };
}

function imagePreviewResourceFor(
  server: OpenCodeServerKey,
  directory: string,
  path: string,
): ImagePreviewResource {
  const key = `${server}:${directory}:${path}`;
  const existing = imagePreviewResources.get(key);
  if (existing !== undefined) return existing;
  const created = createImagePreviewResource(
    directory,
    path,
    () => getOpenCodeClient(server),
    () => {
      imagePreviewResources.delete(key);
    },
  );
  imagePreviewResources.set(key, created);
  return created;
}

function useImagePreview(
  server: OpenCodeServerKey,
  directory: string,
  path: string,
): ImagePreviewState {
  const resource = imagePreviewResourceFor(server, directory, path);
  return React.useSyncExternalStore(resource.subscribe, resource.getSnapshot, resource.getSnapshot);
}

export {
  base64ByteLength,
  createImagePreviewResource,
  isImagePreviewPath,
  loadImagePreview,
  useImagePreview,
};
export type { ImagePreviewResource, ImagePreviewState };
