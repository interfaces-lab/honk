import {
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type ScopedThreadRef,
  type ThreadId,
} from "@multi/contracts";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type MutableRefObject,
} from "react";

import {
  type ComposerImageAttachment,
  type DraftId,
  type PersistedComposerImageAttachment,
  useComposerDraftStore,
} from "../../../stores/chat-drafts";
import { randomUUID } from "~/lib/utils";
import { toastManager } from "~/app/toast";
import { readFileAsDataUrl } from "./send";

const IMAGE_SIZE_LIMIT_LABEL = `${Math.round(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES / (1024 * 1024))}MB`;

export function useComposerImageAttachments(input: {
  composerDraftTarget: ScopedThreadRef | DraftId;
  activeThreadId: ThreadId | null;
  pendingUserInputCount: number;
  composerImages: ComposerImageAttachment[];
  nonPersistedComposerImageIds: string[];
  composerImagesRef: MutableRefObject<ComposerImageAttachment[]>;
  focusComposer: () => void;
  setThreadError: (threadId: ThreadId | null, error: string | null) => void;
}) {
  const {
    composerDraftTarget,
    activeThreadId,
    pendingUserInputCount,
    composerImages,
    nonPersistedComposerImageIds,
    composerImagesRef,
    focusComposer,
    setThreadError,
  } = input;
  const [isDragOverComposer, setIsDragOverComposer] = useState(false);
  const composerImageInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const addComposerDraftImage = useComposerDraftStore((store) => store.addImage);
  const addComposerDraftImages = useComposerDraftStore((store) => store.addImages);
  const removeComposerDraftImage = useComposerDraftStore((store) => store.removeImage);
  const clearComposerDraftPersistedAttachments = useComposerDraftStore(
    (store) => store.clearPersistedAttachments,
  );
  const syncComposerDraftPersistedAttachments = useComposerDraftStore(
    (store) => store.syncPersistedAttachments,
  );
  const getComposerDraft = useComposerDraftStore((store) => store.getComposerDraft);

  const nonPersistedComposerImageIdSet = useMemo(
    () => new Set(nonPersistedComposerImageIds),
    [nonPersistedComposerImageIds],
  );

  useEffect(() => {
    dragDepthRef.current = 0;
    setIsDragOverComposer(false);
  }, [activeThreadId, composerDraftTarget]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (composerImages.length === 0) {
        clearComposerDraftPersistedAttachments(composerDraftTarget);
        return;
      }
      const getPersistedAttachmentsForThread = () =>
        getComposerDraft(composerDraftTarget)?.persistedAttachments ?? [];
      try {
        const currentPersistedAttachments = getPersistedAttachmentsForThread();
        const existingPersistedById = new Map(
          currentPersistedAttachments.map((attachment) => [attachment.id, attachment]),
        );
        const stagedAttachmentById = new Map<string, PersistedComposerImageAttachment>();
        await Promise.all(
          composerImages.map(async (image) => {
            try {
              const dataUrl = await readFileAsDataUrl(image.file);
              stagedAttachmentById.set(image.id, {
                id: image.id,
                name: image.name,
                mimeType: image.mimeType,
                sizeBytes: image.sizeBytes,
                dataUrl,
              });
            } catch {
              const existingPersisted = existingPersistedById.get(image.id);
              if (existingPersisted) {
                stagedAttachmentById.set(image.id, existingPersisted);
              }
            }
          }),
        );
        const serialized = Array.from(stagedAttachmentById.values());
        if (cancelled) return;
        syncComposerDraftPersistedAttachments(composerDraftTarget, serialized);
      } catch {
        const currentImageIds = new Set(composerImages.map((image) => image.id));
        const fallbackPersistedAttachments = getPersistedAttachmentsForThread();
        const fallbackPersistedIds = fallbackPersistedAttachments
          .map((attachment) => attachment.id)
          .filter((id) => currentImageIds.has(id));
        const fallbackPersistedIdSet = new Set(fallbackPersistedIds);
        const fallbackAttachments = fallbackPersistedAttachments.filter((attachment) =>
          fallbackPersistedIdSet.has(attachment.id),
        );
        if (cancelled) return;
        syncComposerDraftPersistedAttachments(composerDraftTarget, fallbackAttachments);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    clearComposerDraftPersistedAttachments,
    composerDraftTarget,
    composerImages,
    getComposerDraft,
    syncComposerDraftPersistedAttachments,
  ]);

  const addComposerImages = useCallback(
    (files: File[]) => {
      if (!activeThreadId || files.length === 0) return;
      if (pendingUserInputCount > 0) {
        toastManager.add({
          type: "error",
          title: "Attach images after answering plan questions.",
        });
        return;
      }
      const nextImages: ComposerImageAttachment[] = [];
      let nextImageCount = composerImagesRef.current.length;
      let error: string | null = null;
      for (const file of files) {
        if (!file.type.startsWith("image/")) {
          error = `Unsupported file type for '${file.name}'. Please attach image files only.`;
          continue;
        }
        if (file.size > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
          error = `'${file.name}' exceeds the ${IMAGE_SIZE_LIMIT_LABEL} attachment limit.`;
          continue;
        }
        if (nextImageCount >= PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
          error = `You can attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} images per message.`;
          break;
        }
        const previewUrl = URL.createObjectURL(file);
        nextImages.push({
          type: "image",
          id: randomUUID(),
          name: file.name || "image",
          mimeType: file.type,
          sizeBytes: file.size,
          previewUrl,
          file,
        });
        nextImageCount += 1;
      }
      if (nextImages.length === 1 && nextImages[0]) {
        addComposerDraftImage(composerDraftTarget, nextImages[0]);
      } else if (nextImages.length > 1) {
        addComposerDraftImages(composerDraftTarget, nextImages);
      }
      setThreadError(activeThreadId, error);
    },
    [
      activeThreadId,
      addComposerDraftImage,
      addComposerDraftImages,
      composerDraftTarget,
      composerImagesRef,
      pendingUserInputCount,
      setThreadError,
    ],
  );

  const removeComposerImage = useCallback(
    (imageId: string) => {
      removeComposerDraftImage(composerDraftTarget, imageId);
    },
    [composerDraftTarget, removeComposerDraftImage],
  );

  const onComposerPaste = useCallback(
    (event: ClipboardEvent<HTMLElement>) => {
      const files = Array.from(event.clipboardData.files);
      if (files.length === 0) return;
      const imageFiles = files.filter((file) => file.type.startsWith("image/"));
      if (imageFiles.length === 0) return;
      event.preventDefault();
      addComposerImages(imageFiles);
    },
    [addComposerImages],
  );

  const onComposerDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragOverComposer(true);
  }, []);

  const onComposerDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDragOverComposer(true);
  }, []);

  const onComposerDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragOverComposer(false);
    }
  }, []);

  const onComposerDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      dragDepthRef.current = 0;
      setIsDragOverComposer(false);
      const files = Array.from(event.dataTransfer.files);
      addComposerImages(files);
      focusComposer();
    },
    [addComposerImages, focusComposer],
  );

  const onComposerImageInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.currentTarget.files ?? []);
      event.currentTarget.value = "";
      if (files.length === 0) return;
      addComposerImages(files);
      focusComposer();
    },
    [addComposerImages, focusComposer],
  );

  return {
    composerImageInputRef,
    isDragOverComposer,
    nonPersistedComposerImageIdSet,
    onComposerPaste,
    onComposerDragEnter,
    onComposerDragOver,
    onComposerDragLeave,
    onComposerDrop,
    onComposerImageInputChange,
    removeComposerImage,
  };
}
