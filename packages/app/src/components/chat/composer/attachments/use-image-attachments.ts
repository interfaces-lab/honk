import {
  RUNTIME_SEND_TURN_MAX_ATTACHMENTS,
  RUNTIME_SEND_TURN_MAX_IMAGE_BYTES,
  type ScopedThreadRef,
  type ThreadId,
} from "@honk/contracts";
import {
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type RefObject,
} from "react";

import {
  type ComposerImageAttachment,
  type DraftId,
  useComposerDraftStore,
} from "../../../../stores/chat-drafts";
import { randomUUID } from "~/lib/utils";
import { toastManager } from "~/app/toast";

const IMAGE_SIZE_LIMIT_LABEL = `${Math.round(RUNTIME_SEND_TURN_MAX_IMAGE_BYTES / (1024 * 1024))}MB`;

interface ComposerImageDragState {
  readonly composerDraftTarget: ScopedThreadRef | DraftId;
  readonly activeThreadId: ThreadId | null;
  readonly depth: number;
  readonly isOver: boolean;
}

function createComposerImageDragState(input: {
  composerDraftTarget: ScopedThreadRef | DraftId;
  activeThreadId: ThreadId | null;
}): ComposerImageDragState {
  return {
    composerDraftTarget: input.composerDraftTarget,
    activeThreadId: input.activeThreadId,
    depth: 0,
    isOver: false,
  };
}

function isCurrentComposerImageDragState(
  state: ComposerImageDragState,
  input: {
    composerDraftTarget: ScopedThreadRef | DraftId;
    activeThreadId: ThreadId | null;
  },
): boolean {
  return (
    state.composerDraftTarget === input.composerDraftTarget &&
    state.activeThreadId === input.activeThreadId
  );
}

export function useComposerImageAttachments(input: {
  composerDraftTarget: ScopedThreadRef | DraftId;
  activeThreadId: ThreadId | null;
  pendingUserInputCount: number;
  composerImages: ComposerImageAttachment[];
  nonPersistedComposerImageIds: string[];
  composerImagesRef: RefObject<ComposerImageAttachment[]>;
  focusComposer: () => void;
  setThreadError: (threadId: ThreadId | null, error: string | null) => void;
}) {
  const {
    composerDraftTarget,
    activeThreadId,
    pendingUserInputCount,
    nonPersistedComposerImageIds,
    composerImagesRef,
    focusComposer,
    setThreadError,
  } = input;
  const composerImageInputRef = useRef<HTMLInputElement>(null);
  const [dragState, setDragState] = useState<ComposerImageDragState>(() =>
    createComposerImageDragState({ composerDraftTarget, activeThreadId }),
  );
  const activeDragState = isCurrentComposerImageDragState(dragState, {
    composerDraftTarget,
    activeThreadId,
  })
    ? dragState
    : createComposerImageDragState({ composerDraftTarget, activeThreadId });
  if (activeDragState !== dragState) {
    setDragState(activeDragState);
  }
  const isDragOverComposer = activeDragState.isOver;
  const addComposerDraftImage = useComposerDraftStore((store) => store.addImage);
  const addComposerDraftImages = useComposerDraftStore((store) => store.addImages);
  const removeComposerDraftImage = useComposerDraftStore((store) => store.removeImage);

  const nonPersistedComposerImageIdSet = new Set(nonPersistedComposerImageIds);
  // Image blobs stay in memory until send. Persisting them as base64 in localStorage
  // blocks the renderer on paste and scales with every attached image.
  const composerImageAttachmentPersistenceSync = null;

  const addComposerImages = (files: File[]) => {
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
      if (file.size > RUNTIME_SEND_TURN_MAX_IMAGE_BYTES) {
        error = `'${file.name}' exceeds the ${IMAGE_SIZE_LIMIT_LABEL} attachment limit.`;
        continue;
      }
      if (nextImageCount >= RUNTIME_SEND_TURN_MAX_ATTACHMENTS) {
        error = `You can attach up to ${RUNTIME_SEND_TURN_MAX_ATTACHMENTS} images per message.`;
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
  };

  const removeComposerImage = (imageId: string) => {
    removeComposerDraftImage(composerDraftTarget, imageId);
  };

  const onComposerPaste = (event: ClipboardEvent<HTMLElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (files.length === 0) return;
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) return;
    event.preventDefault();
    addComposerImages(imageFiles);
  };

  const onComposerDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    setDragState((current) => {
      const base = isCurrentComposerImageDragState(current, {
        composerDraftTarget,
        activeThreadId,
      })
        ? current
        : createComposerImageDragState({ composerDraftTarget, activeThreadId });
      return {
        ...base,
        depth: base.depth + 1,
        isOver: true,
      };
    });
  };

  const onComposerDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragState((current) => {
      const base = isCurrentComposerImageDragState(current, {
        composerDraftTarget,
        activeThreadId,
      })
        ? current
        : createComposerImageDragState({ composerDraftTarget, activeThreadId });
      return base.isOver ? base : { ...base, isOver: true };
    });
  };

  const onComposerDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setDragState((current) => {
      const base = isCurrentComposerImageDragState(current, {
        composerDraftTarget,
        activeThreadId,
      })
        ? current
        : createComposerImageDragState({ composerDraftTarget, activeThreadId });
      const depth = Math.max(0, base.depth - 1);
      return {
        ...base,
        depth,
        isOver: depth > 0,
      };
    });
  };

  const onComposerDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    setDragState(createComposerImageDragState({ composerDraftTarget, activeThreadId }));
    const files = Array.from(event.dataTransfer.files);
    addComposerImages(files);
    focusComposer();
  };

  const onComposerImageInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (files.length === 0) return;
    addComposerImages(files);
    focusComposer();
  };

  return {
    composerImageInputRef,
    composerImageAttachmentPersistenceSync,
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
