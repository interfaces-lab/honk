import type { EnvironmentId, ThreadId } from "@multi/contracts";
import { scopedThreadKey, scopeThreadRef } from "@multi/client-runtime";

import { readEnvironmentApi } from "./environment-api";
import { newCommandId } from "./lib/utils";
import { appendTerminalContextsToPrompt } from "./lib/terminal-context";
import { useComposerQueueStore } from "./composer-queue-store";
import { selectThreadByRef, useStore } from "./store";
import {
  deriveComposerSendState,
  formatOutgoingPrompt,
  IMAGE_ONLY_BOOTSTRAP_PROMPT,
  readFileAsDataUrl,
} from "./components/chat/view/chat-view.logic";

const dispatchingThreadKeys = new Set<string>();

export async function dispatchNextQueuedComposerItemForThread(
  environmentId: EnvironmentId,
  threadId: ThreadId,
): Promise<void> {
  const threadRef = scopeThreadRef(environmentId, threadId);
  const threadKey = scopedThreadKey(threadRef);
  if (dispatchingThreadKeys.has(threadKey)) {
    return;
  }

  const queueStore = useComposerQueueStore.getState();
  const firstItem = queueStore.getQueueItems(threadKey)[0] ?? null;
  const editingItemId = queueStore.getEditingQueueItemId(threadKey);
  const thread = selectThreadByRef(useStore.getState(), threadRef);
  const isThreadRunning =
    thread?.session?.status === "running" || thread?.session?.status === "connecting";

  if (!firstItem || isThreadRunning || editingItemId === firstItem.id) {
    return;
  }

  const api = readEnvironmentApi(environmentId);
  if (!api || !thread) {
    return;
  }

  const item = queueStore.takeQueuedComposerItem(threadKey, firstItem.id);
  if (!item) {
    return;
  }

  dispatchingThreadKeys.add(threadKey);
  try {
    const { sendableTerminalContexts, hasSendableContent } = deriveComposerSendState({
      prompt: item.sendContext.prompt,
      imageCount: item.sendContext.images.length,
      terminalContexts: item.sendContext.terminalContexts,
    });
    if (!hasSendableContent) {
      useComposerQueueStore.getState().restoreQueuedComposerItem(threadKey, item, 0);
      return;
    }

    const messageTextForSend = appendTerminalContextsToPrompt(
      item.sendContext.prompt,
      sendableTerminalContexts,
    );
    const outgoingMessageText = formatOutgoingPrompt({
      provider: item.sendContext.selectedProvider,
      model: item.sendContext.selectedModel,
      models: item.sendContext.selectedProviderModels,
      effort: item.sendContext.selectedPromptEffort,
      text: messageTextForSend || IMAGE_ONLY_BOOTSTRAP_PROMPT,
    });
    const attachments = await Promise.all(
      item.sendContext.images.map(async (image) => ({
        type: "image" as const,
        name: image.name,
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes,
        dataUrl: await readFileAsDataUrl(image.file),
      })),
    );

    await api.orchestration.dispatchCommand({
      type: "thread.turn.start",
      commandId: newCommandId(),
      threadId,
      message: {
        messageId: item.id,
        role: "user",
        text: outgoingMessageText,
        attachments,
      },
      modelSelection: item.sendContext.selectedModelSelection,
      titleSeed: thread.title,
      runtimeMode: item.runtimeMode,
      interactionMode: item.interactionMode,
      createdAt: item.createdAt,
    });
  } catch (err) {
    useComposerQueueStore.getState().restoreQueuedComposerItem(threadKey, item, 0);
    useStore
      .getState()
      .setError(threadId, err instanceof Error ? err.message : "Failed to send queued message.");
  } finally {
    dispatchingThreadKeys.delete(threadKey);
  }
}
