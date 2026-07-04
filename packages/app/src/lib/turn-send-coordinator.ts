import type { AgentInteractionMode } from "@honk/shared/interaction-mode";
import type { EnvironmentApi } from "~/desktop-bridge";
import type {
  MessageId,
  ThreadEntryId,
} from "@honk/shared/base-schemas";
import { threadEntryIdForMessageId } from "@honk/shared/thread-tree";
import type {
  ChatAttachment,
  ClientOrchestrationCommand,
  OrchestrationMessageRichText,
  RuntimeMode,
  SourceProposedPlanReference,
  ThreadTurnStartBootstrap,
  UploadChatAttachment,
} from "@honk/shared/orchestration";
import type { EnvironmentId } from "@honk/shared/environment";
import type { ModelSelection } from "@honk/shared/model";
import type { ThreadId } from "@honk/shared/base-schemas";

import { applyLocalThreadTurnStartRequested } from "~/stores/local-orchestration-events";
import {
  createThreadSendIntent,
  useThreadSendIntentStore,
} from "~/stores/thread-send-intent-store";
import { selectEnvironmentState, useStore } from "~/stores/thread-store";
import { getThreadFromEnvironmentState } from "~/thread-derivation";
import { DEFAULT_RUNTIME_MODE } from "~/types";
import { newCommandId } from "~/lib/utils";

export interface TurnSendMessageContent {
  readonly text: string;
  readonly richText?: OrchestrationMessageRichText;
  readonly optimisticAttachments: readonly ChatAttachment[];
  readonly getTurnAttachments: () => Promise<readonly UploadChatAttachment[]>;
}

export interface CoordinateTurnSendInput {
  readonly environmentId: EnvironmentId;
  readonly threadKey: string;
  readonly threadId: ThreadId;
  readonly clientMessageId: MessageId;
  readonly createdAt: string;
  readonly message: TurnSendMessageContent;
  /**
   * Explicit branch point for this send. Omit for normal sends so the
   * coordinator resolves the active thread leaf once and passes that same
   * parent to orchestration and the runtime. Branching edit sends must pass
   * the edited message's parent explicitly.
   */
  readonly parentEntryId?: ThreadEntryId | null;
  /**
   * Message this runtime send revises. Omit for tip-append sends; branching edit
   * sends pass the original client message so runtime can create a sibling turn.
   */
  readonly replacesClientMessageId?: MessageId | null;
  readonly modelSelection: ModelSelection;
  readonly titleSeed: string;
  readonly runtimeMode?: RuntimeMode;
  readonly interactionMode: AgentInteractionMode;
  readonly sourceProposedPlan?: SourceProposedPlanReference | null;
  readonly bootstrap?: ThreadTurnStartBootstrap;
  readonly cwd: string;
  readonly preparedPolicy?: unknown;
  readonly api: EnvironmentApi | undefined;
  readonly appendSendIntent?: boolean;
  readonly applyLocalTurnStart?: boolean;
  readonly startRuntimeBeforePersistence?: boolean;
  readonly onBeforeRuntimeSend?: () => void;
  readonly persistBeforeDispatch?: () => Promise<void>;
}

export interface CoordinateTurnSendResult {
  readonly serverTurnStartSucceeded: boolean;
  readonly runtimeSendSucceeded: boolean;
  readonly serverPersistenceError: unknown;
  readonly preparedWorktree: {
    readonly worktreePath: string;
    readonly branch: string;
  } | null;
}

export async function coordinateTurnSend(
  input: CoordinateTurnSendInput,
): Promise<CoordinateTurnSendResult> {
  if (input.replacesClientMessageId != null && input.parentEntryId === undefined) {
    throw new Error("Branching edit sends require parentEntryId.");
  }

  const currentThread = getThreadFromEnvironmentState(
    selectEnvironmentState(useStore.getState(), input.environmentId),
    input.threadId,
  );
  const userEntryId = threadEntryIdForMessageId(input.clientMessageId);
  const existingUserEntry = currentThread?.entries.find((entry) => entry.id === userEntryId);
  const localParentEntryId =
    input.parentEntryId !== undefined
      ? input.parentEntryId
      : currentThread?.leafId === userEntryId
        ? (existingUserEntry?.parentEntryId ?? null)
        : (currentThread?.leafId ?? null);
  const serverParentEntryId = input.parentEntryId;
  const localTurnStartApplied = input.applyLocalTurnStart !== false;
  const sendIntentAppended = input.appendSendIntent !== false;

  if (sendIntentAppended) {
    useThreadSendIntentStore.getState().appendSendIntent(
      input.threadKey,
      createThreadSendIntent({
        messageId: input.clientMessageId,
        text: input.message.text,
        ...(input.message.richText !== undefined ? { richText: input.message.richText } : {}),
        attachments: [...input.message.optimisticAttachments],
        createdAt: input.createdAt,
        parentEntryId: localParentEntryId,
      }),
    );
  }

  if (localTurnStartApplied) {
    applyLocalThreadTurnStartRequested({
      environmentId: input.environmentId,
      threadId: input.threadId,
      message: {
        messageId: input.clientMessageId,
        text: input.message.text,
        ...(input.message.richText !== undefined ? { richText: input.message.richText } : {}),
        attachments: [...input.message.optimisticAttachments],
      },
      modelSelection: input.modelSelection,
      titleSeed: input.titleSeed,
      runtimeMode: input.runtimeMode ?? DEFAULT_RUNTIME_MODE,
      interactionMode: input.interactionMode,
      parentEntryId: localParentEntryId,
      ...(input.sourceProposedPlan ? { sourceProposedPlan: input.sourceProposedPlan } : {}),
      createdAt: input.createdAt,
    });
  }

  let serverTurnStartSucceeded = false;
  let runtimeSendSucceeded = false;
  let serverPersistenceError: unknown = null;
  let preparedWorktree: CoordinateTurnSendResult["preparedWorktree"] = null;

  const captureServerPersistenceError = (error: unknown) => {
    if (serverPersistenceError === null) {
      serverPersistenceError = error;
    }
  };
  const clearUnpersistedLocalArtifacts = () => {
    if (!input.api || serverTurnStartSucceeded) {
      return;
    }
    if (localTurnStartApplied) {
      useStore.getState().clearUnconfirmedLocalTurnStart({
        environmentId: input.environmentId,
        threadId: input.threadId,
        messageId: input.clientMessageId,
      });
    }
    if (sendIntentAppended) {
      useThreadSendIntentStore
        .getState()
        .removeSendIntents(input.threadKey, new Set([input.clientMessageId]));
    }
  };

  void input.cwd;
  void input.preparedPolicy;
  void input.startRuntimeBeforePersistence;
  void input.onBeforeRuntimeSend;

  if (input.persistBeforeDispatch) {
    await input.persistBeforeDispatch().catch(captureServerPersistenceError);
  }

  try {
    if (input.api) {
      const turnAttachments = await input.message.getTurnAttachments();
      const turnStartCommand = buildThreadTurnStartCommand({
        threadId: input.threadId,
        clientMessageId: input.clientMessageId,
        createdAt: input.createdAt,
        text: input.message.text,
        ...(input.message.richText !== undefined ? { richText: input.message.richText } : {}),
        attachments: turnAttachments,
        modelSelection: input.modelSelection,
        titleSeed: input.titleSeed,
        runtimeMode: input.runtimeMode ?? DEFAULT_RUNTIME_MODE,
        interactionMode: input.interactionMode,
        ...(serverParentEntryId !== undefined ? { parentEntryId: serverParentEntryId } : {}),
        sourceProposedPlan: input.sourceProposedPlan ?? null,
        ...(input.bootstrap ? { bootstrap: input.bootstrap } : {}),
      });

      try {
        const dispatchResult = await input.api.orchestration.dispatchCommand(turnStartCommand);
        serverTurnStartSucceeded = true;
        if (
          dispatchResult &&
          "preparedWorktree" in dispatchResult &&
          dispatchResult.preparedWorktree
        ) {
          preparedWorktree = {
            worktreePath: dispatchResult.preparedWorktree.worktreePath,
            branch: dispatchResult.preparedWorktree.branch,
          };
        }
      } catch (error) {
        captureServerPersistenceError(error);
        throw error;
      }
    }

    runtimeSendSucceeded = serverTurnStartSucceeded;
  } finally {
    clearUnpersistedLocalArtifacts();
  }

  return {
    serverTurnStartSucceeded,
    runtimeSendSucceeded,
    serverPersistenceError,
    preparedWorktree,
  };
}

export function buildThreadTurnStartCommand(input: {
  readonly threadId: ThreadId;
  readonly clientMessageId: MessageId;
  readonly createdAt: string;
  readonly text: string;
  readonly richText?: OrchestrationMessageRichText;
  readonly attachments: readonly UploadChatAttachment[];
  readonly modelSelection: ModelSelection;
  readonly titleSeed: string;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: AgentInteractionMode;
  /** Explicit branch point; when omitted the server appends at its own leaf. */
  readonly parentEntryId?: ThreadEntryId | null;
  readonly sourceProposedPlan: SourceProposedPlanReference | null;
  readonly bootstrap?: ThreadTurnStartBootstrap;
}): ClientOrchestrationCommand {
  return {
    type: "thread.turn.start",
    commandId: newCommandId(),
    threadId: input.threadId,
    message: {
      messageId: input.clientMessageId,
      role: "user",
      text: input.text,
      ...(input.richText !== undefined ? { richText: input.richText } : {}),
      attachments: [...input.attachments],
    },
    modelSelection: input.modelSelection,
    titleSeed: input.titleSeed,
    runtimeMode: input.runtimeMode,
    interactionMode: input.interactionMode,
    ...(input.parentEntryId !== undefined ? { parentEntryId: input.parentEntryId } : {}),
    ...(input.sourceProposedPlan ? { sourceProposedPlan: input.sourceProposedPlan } : {}),
    ...(input.bootstrap ? { bootstrap: input.bootstrap } : {}),
    createdAt: input.createdAt,
  };
}

export async function dispatchTurnStartFailure(input: {
  readonly api: EnvironmentApi | undefined;
  readonly threadId: ThreadId;
  readonly messageId: MessageId;
  readonly detail: string;
  readonly createdAt?: string;
}): Promise<void> {
  if (!input.api) {
    return;
  }
  await input.api.orchestration
    .dispatchCommand({
      type: "thread.turn.start.failed",
      commandId: newCommandId(),
      threadId: input.threadId,
      messageId: input.messageId,
      detail: input.detail.trim().length > 0 ? input.detail : "Failed to send turn.",
      createdAt: input.createdAt ?? new Date().toISOString(),
    })
    .catch(() => undefined);
}

export function reconcileTurnSendFailure(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly messageId: MessageId;
  readonly serverTurnStartSucceeded: boolean;
  readonly localTurnStartAnnounced: boolean;
}): void {
  if (input.localTurnStartAnnounced && !input.serverTurnStartSucceeded) {
    useStore.getState().clearUnconfirmedLocalTurnStart({
      environmentId: input.environmentId,
      threadId: input.threadId,
      messageId: input.messageId,
    });
  }
}
