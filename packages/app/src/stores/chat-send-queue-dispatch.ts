import type {
  EnvironmentId,
  AgentInteractionMode,
  SourceProposedPlanReference,
  ThreadId,
} from "@multi/contracts";
import { scopedThreadKey, scopeThreadRef } from "~/lib/environment-scope";

import { readEnvironmentApi } from "../environment-api";
import {
  compileComposerSubmitTurn,
  prepareComposerTurnAttachments,
} from "../components/chat/composer-submit";
import { prepareRuntimeTurnPolicy } from "../lib/runtime-turn-dispatch";
import { coordinateTurnSend, dispatchTurnStartFailure } from "../lib/turn-send-coordinator";
import { resolvePlanFollowUpSubmission } from "../plan/proposed-plan";
import { DEFAULT_RUNTIME_MODE } from "../types";
import { useComposerQueueStore, type QueuedComposerItem } from "./chat-send-queue";
import { selectEnvironmentState, selectThreadByRef, useStore } from "./thread-store";

const dispatchingThreadKeys = new Set<string>();

type PreparedQueuedTurn = {
  messageText: string;
  interactionMode: AgentInteractionMode;
  sourceProposedPlan: SourceProposedPlanReference | null;
  optimisticAttachments: ReturnType<typeof compileComposerSubmitTurn>["optimisticAttachments"];
  richText: ReturnType<typeof compileComposerSubmitTurn>["outgoingRichText"];
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
      optimisticAttachments: compiledTurn.optimisticAttachments,
      richText: compiledTurn.outgoingRichText,
    };
  }

  if (!compiledTurn.hasSendableContent) {
    return null;
  }

  return {
    messageText: compiledTurn.outgoingMessageText,
    interactionMode: item.interactionMode,
    sourceProposedPlan: null,
    optimisticAttachments: compiledTurn.optimisticAttachments,
    richText: compiledTurn.outgoingRichText,
  };
}

async function sendQueuedTurn(input: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  item: QueuedComposerItem;
  prepared: PreparedQueuedTurn;
}): Promise<void> {
  const state = useStore.getState();
  const threadRef = scopeThreadRef(input.environmentId, input.threadId);
  const threadKey = scopedThreadKey(threadRef);
  const thread = selectThreadByRef(state, threadRef);
  const environmentState = selectEnvironmentState(state, input.environmentId);
  const project = thread?.projectId ? environmentState.projectById[thread.projectId] : null;
  const cwd = thread?.worktreePath ?? project?.cwd ?? null;
  if (!cwd) {
    throw new Error("Pi runtime requires an active project before sending.");
  }
  if (!thread) {
    throw new Error("Cannot send queued message because the thread is no longer available.");
  }

  const api = readEnvironmentApi(input.environmentId);
  const preparedPolicy = prepareRuntimeTurnPolicy({
    interactionMode: input.prepared.interactionMode,
  });

  const result = await coordinateTurnSend({
    environmentId: input.environmentId,
    threadKey,
    threadId: input.threadId,
    clientMessageId: input.item.id,
    createdAt: input.item.createdAt,
    message: {
      text: input.prepared.messageText,
      ...(input.prepared.richText !== undefined ? { richText: input.prepared.richText } : {}),
      optimisticAttachments: input.prepared.optimisticAttachments,
      getTurnAttachments: () => prepareComposerTurnAttachments(input.item.sendContext.images),
    },
    modelSelection: thread.modelSelection,
    titleSeed: thread.title,
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: input.prepared.interactionMode,
    sourceProposedPlan: input.prepared.sourceProposedPlan,
    cwd,
    preparedPolicy,
    api,
    startRuntimeBeforePersistence: true,
  });

  if (result.serverPersistenceError) {
    throw result.serverPersistenceError;
  }

  if (!result.runtimeSendSucceeded && result.serverTurnStartSucceeded) {
    await dispatchTurnStartFailure({
      api,
      threadId: input.threadId,
      messageId: input.item.id,
      detail: "Failed to send queued message.",
    });
    throw new Error("Failed to send queued message.");
  }
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

    await sendQueuedTurn({
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
