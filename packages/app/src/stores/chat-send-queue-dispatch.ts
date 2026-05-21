import type { EnvironmentId, ThreadId } from "@multi/contracts";
import { scopedThreadKey, scopeThreadRef } from "@multi/client-runtime";

import { readEnvironmentApi } from "../environment-api";
import { newCommandId } from "../lib/utils";
import { useComposerQueueStore } from "./chat-send-queue";
import { selectThreadByRef, useStore } from "./thread-store";
import {
  compileComposerSubmitTurn,
  prepareComposerTurnAttachments,
} from "../components/chat/composer-submit";

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
    const compiledTurn = compileComposerSubmitTurn(item.sendContext);
    if (!compiledTurn.hasSendableContent) {
      useComposerQueueStore.getState().restoreQueuedComposerItem(threadKey, item, 0);
      return;
    }

    const attachments = await prepareComposerTurnAttachments(item.sendContext.images);

    await api.orchestration.dispatchCommand({
      type: "thread.turn.start",
      commandId: newCommandId(),
      threadId,
      message: {
        messageId: item.id,
        role: "user",
        text: compiledTurn.outgoingMessageText,
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
