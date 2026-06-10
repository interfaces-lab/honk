import { useEffect, useState } from "react";

import { createAuthenticatedRequestInit } from "~/environments/primary/auth";

export function shouldFetchAuthenticatedImagePreview(src: string): boolean {
  try {
    const url = new URL(src);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export async function preloadAuthenticatedImagePreview(src: string): Promise<void> {
  if (!shouldFetchAuthenticatedImagePreview(src)) {
    await loadImage(src);
    return;
  }

  const response = await fetch(src, createAuthenticatedRequestInit());
  if (!response.ok) {
    throw new Error(`Failed to load authenticated image preview (${response.status}).`);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    await loadImage(objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function useAuthenticatedImagePreviewSrc(src: string | undefined): string | undefined {
  const [loadedPreview, setLoadedPreview] = useState<{
    source: string;
    previewUrl: string;
  } | null>(null);

  useEffect(() => {
    if (!src || !shouldFetchAuthenticatedImagePreview(src)) {
      setLoadedPreview(null);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;

    const load = async () => {
      try {
        const response = await fetch(src, createAuthenticatedRequestInit());
        if (!response.ok) {
          throw new Error(`Failed to load authenticated image preview (${response.status}).`);
        }

        const blob = await response.blob();
        if (cancelled) {
          return;
        }

        objectUrl = URL.createObjectURL(blob);
        setLoadedPreview({ source: src, previewUrl: objectUrl });
      } catch {
        if (!cancelled) {
          setLoadedPreview(null);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [src]);

  if (!src) {
    return undefined;
  }

  if (!shouldFetchAuthenticatedImagePreview(src)) {
    return src;
  }

  return loadedPreview?.source === src ? loadedPreview.previewUrl : undefined;
}

function loadImage(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const handleLoad = () => resolve();
    const handleError = () => reject(new Error("Failed to decode image preview."));
    image.addEventListener("load", handleLoad, { once: true });
    image.addEventListener("error", handleError, { once: true });
    image.src = src;
  });
}
