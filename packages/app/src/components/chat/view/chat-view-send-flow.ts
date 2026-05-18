import type { ProviderInteractionMode, RuntimeMode } from "@multi/contracts";

import type { ComposerImageAttachment } from "../../../stores/chat-drafts";
import type { QueuedComposerItem, QueuedComposerItemId } from "../../../stores/chat-send-queue";
import type { TerminalContextDraft } from "../../../lib/terminal-context";
import { formatTerminalContextLabel } from "../../../lib/terminal-context";
import { readFileAsDataUrl } from "../composer/send";
import type { ComposerInputHandle } from "../composer/input";

export type ComposerInputSendContext = ReturnType<ComposerInputHandle["getSendContext"]>;

export function createQueuedComposerItem(input: {
  threadKey: string;
  sendContext: ComposerInputSendContext;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  planFollowUp: { planMarkdown: string } | null;
  itemId: QueuedComposerItemId;
  createdAt: string;
}): QueuedComposerItem {
  return {
    id: input.itemId,
    threadKey: input.threadKey,
    sendContext: {
      ...input.sendContext,
      images: [...input.sendContext.images],
      terminalContexts: [...input.sendContext.terminalContexts],
    },
    runtimeMode: input.runtimeMode,
    interactionMode: input.interactionMode,
    planFollowUp: input.planFollowUp,
    createdAt: input.createdAt,
  };
}

export function buildOptimisticImageAttachments(images: readonly ComposerImageAttachment[]) {
  return images.map((image) => ({
    type: "image" as const,
    id: image.id,
    name: image.name,
    mimeType: image.mimeType,
    sizeBytes: image.sizeBytes,
    previewUrl: image.previewUrl,
  }));
}

export function readComposerImageAttachmentsForTurn(images: readonly ComposerImageAttachment[]) {
  return Promise.all(
    images.map(async (image) => ({
      type: "image" as const,
      name: image.name,
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes,
      dataUrl: await readFileAsDataUrl(image.file),
    })),
  );
}

export function resolveComposerThreadTitleSeed(input: {
  trimmedPrompt: string;
  composerImages: readonly ComposerImageAttachment[];
  terminalContexts: readonly TerminalContextDraft[];
}): string {
  if (input.trimmedPrompt) {
    return input.trimmedPrompt;
  }

  const firstComposerImage = input.composerImages[0];
  if (firstComposerImage) {
    return `Image: ${firstComposerImage.name}`;
  }

  const firstTerminalContext = input.terminalContexts[0];
  if (firstTerminalContext) {
    return formatTerminalContextLabel(firstTerminalContext);
  }

  return "New thread";
}
