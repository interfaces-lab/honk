import type {
  EnvironmentId,
  AgentInteractionMode,
  SourceProposedPlanReference,
  ThreadId,
} from "@multi/contracts";
import { scopedThreadKey, scopeThreadRef } from "~/lib/environment-scope";

import { sendRuntimeTurn } from "../lib/runtime-turn-dispatch";
import { resolvePlanFollowUpSubmission } from "../plan/proposed-plan";
import { useComposerQueueStore, type QueuedComposerItem } from "./chat-send-queue";
import { selectEnvironmentState, selectThreadByRef, useStore } from "./thread-store";
import {
  compileComposerSubmitTurn,
  prepareComposerTurnAttachments,
} from "../components/chat/composer-submit";

const dispatchingThreadKeys = new Set<string>();

type PreparedQueuedTurn = {
  messageText: string;
  interactionMode: AgentInteractionMode;
  sourceProposedPlan: SourceProposedPlanReference | null;
};

function prepareQueuedTurn(item: QueuedComposerItem): PreparedQueuedTurn | null {
  const compiledTurn = compileComposerSubmitTurn(item.sendContext);

  if (item.planFollowUp) {
    const followUp = resolvePlanFollowUpSubmission({
      draftText: compiledTurn.trimmedPrompt,
      planMarkdown: item.planFollowUp.planMarkdown,
    });
    return {
      messageText: followUp.text,
      interactionMode: followUp.interactionMode,
      sourceProposedPlan: {
        threadId: item.planFollowUp.planThreadId,
        planId: item.planFollowUp.planId,
      },
    };
  }

  if (!compiledTurn.hasSendableContent) {
    return null;
  }

  return {
    messageText: compiledTurn.outgoingMessageText,
    interactionMode: item.interactionMode,
    sourceProposedPlan: null,
  };
}

async function sendQueuedRuntimeTurn(input: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  item: QueuedComposerItem;
  prepared: PreparedQueuedTurn;
}): Promise<void> {
  const state = useStore.getState();
  const threadRef = scopeThreadRef(input.environmentId, input.threadId);
  const thread = selectThreadByRef(state, threadRef);
  const environmentState = selectEnvironmentState(state, input.environmentId);
  const project = thread?.projectId ? environmentState.projectById[thread.projectId] : null;
  const cwd = thread?.worktreePath ?? project?.cwd ?? null;
  if (!cwd) {
    throw new Error("Pi runtime requires an active project before sending.");
  }

  const runtimeImages = await prepareComposerTurnAttachments(input.item.sendContext.images);
  await sendRuntimeTurn({
    threadId: input.threadId,
    cwd,
    text: input.prepared.messageText,
    interactionMode: input.prepared.interactionMode,
    sourceProposedPlan: input.prepared.sourceProposedPlan,
    clientMessageId: input.item.id,
    images: runtimeImages,
  });
}

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

  if (!thread) {
    return;
  }

  const item = queueStore.takeQueuedComposerItem(threadKey, firstItem.id);
  if (!item) {
    return;
  }

  dispatchingThreadKeys.add(threadKey);
  try {
    const prepared = prepareQueuedTurn(item);
    if (!prepared) {
      useComposerQueueStore.getState().restoreQueuedComposerItem(threadKey, item, 0);
      return;
    }

    await sendQueuedRuntimeTurn({
      environmentId,
      threadId,
      item,
      prepared,
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
