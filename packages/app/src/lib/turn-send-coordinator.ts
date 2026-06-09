import {
  type AgentInteractionMode,
  type ChatAttachment,
  type ClientOrchestrationCommand,
  type EnvironmentApi,
  type EnvironmentId,
  type MessageId,
  type ModelSelection,
  type OrchestrationMessageRichText,
  type RuntimeMode,
  type SourceProposedPlanReference,
  type ThreadAgentRuntimeImageAttachment,
  type ThreadEntryId,
  type ThreadId,
  type ThreadTurnStartBootstrap,
  type UploadChatAttachment,
} from "@multi/contracts";

import { applyLocalThreadTurnStartRequested } from "~/stores/local-orchestration-events";
import {
  createThreadSendIntent,
  useThreadSendIntentStore,
} from "~/stores/thread-send-intent-store";
import { useStore } from "~/stores/thread-store";
import { DEFAULT_RUNTIME_MODE } from "~/types";
import { newCommandId } from "~/lib/utils";
import {
  type PreparedRuntimeTurnPolicy,
  sendRuntimeTurnWithPreparedPolicy,
} from "./runtime-turn-dispatch";

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
  readonly parentEntryId: ThreadEntryId | null;
  readonly modelSelection: ModelSelection;
  readonly titleSeed: string;
  readonly runtimeMode?: RuntimeMode;
  readonly interactionMode: AgentInteractionMode;
  readonly sourceProposedPlan?: SourceProposedPlanReference | null;
  readonly bootstrap?: ThreadTurnStartBootstrap;
  readonly cwd: string;
  readonly preparedPolicy: PreparedRuntimeTurnPolicy;
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
  readonly serverPersistenceError: unknown | null;
  readonly preparedWorktree:
    | {
        readonly worktreePath: string;
        readonly branch: string;
      }
    | null;
}

export async function coordinateTurnSend(
  input: CoordinateTurnSendInput,
): Promise<CoordinateTurnSendResult> {
  if (input.appendSendIntent !== false) {
    useThreadSendIntentStore.getState().appendSendIntent(
      input.threadKey,
      createThreadSendIntent({
        messageId: input.clientMessageId,
        text: input.message.text,
        ...(input.message.richText !== undefined ? { richText: input.message.richText } : {}),
        attachments: [...input.message.optimisticAttachments],
        createdAt: input.createdAt,
        parentEntryId: input.parentEntryId,
      }),
    );
  }

  if (input.applyLocalTurnStart !== false) {
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
      parentEntryId: input.parentEntryId,
      ...(input.sourceProposedPlan ? { sourceProposedPlan: input.sourceProposedPlan } : {}),
      createdAt: input.createdAt,
    });
  }

  let runtimeCwd = input.cwd;
  let serverTurnStartSucceeded = false;
  let runtimeSendSucceeded = false;
  let serverPersistenceError: unknown = null;
  let preparedWorktree: CoordinateTurnSendResult["preparedWorktree"] = null;

  const captureServerPersistenceError = (error: unknown) => {
    if (serverPersistenceError === null) {
      serverPersistenceError = error;
    }
  };

  const startRuntimeBeforePersistence = input.startRuntimeBeforePersistence ?? true;
  let runtimeSendPromise: Promise<void> | null = null;
  const startRuntimeTurn = () => {
    input.onBeforeRuntimeSend?.();
    runtimeSendPromise ??= input.message.getTurnAttachments().then((turnAttachments) =>
      sendRuntimeTurnWithPreparedPolicy({
        threadId: input.threadId,
        cwd: runtimeCwd,
        text: input.message.text,
        interactionMode: input.interactionMode,
        sourceProposedPlan: input.sourceProposedPlan ?? null,
        clientMessageId: input.clientMessageId,
        images: turnAttachments as ThreadAgentRuntimeImageAttachment[],
        preparedPolicy: input.preparedPolicy,
      }).then(() => {
        runtimeSendSucceeded = true;
      }),
    );
    void runtimeSendPromise.catch(() => undefined);
    return runtimeSendPromise;
  };

  if (startRuntimeBeforePersistence) {
    void startRuntimeTurn();
  }

  if (input.persistBeforeDispatch) {
    await input.persistBeforeDispatch().catch(captureServerPersistenceError);
  }

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
      parentEntryId: input.parentEntryId,
      sourceProposedPlan: input.sourceProposedPlan ?? null,
      ...(input.bootstrap ? { bootstrap: input.bootstrap } : {}),
    });

    try {
      const dispatchResult = await input.api.orchestration.dispatchCommand(turnStartCommand);
      serverTurnStartSucceeded = true;
      if (dispatchResult && "preparedWorktree" in dispatchResult && dispatchResult.preparedWorktree) {
        preparedWorktree = {
          worktreePath: dispatchResult.preparedWorktree.worktreePath,
          branch: dispatchResult.preparedWorktree.branch,
        };
        runtimeCwd = preparedWorktree.worktreePath;
      }
    } catch (error) {
      if (!startRuntimeBeforePersistence) {
        throw error;
      }
      captureServerPersistenceError(error);
    }
  }

  if (!startRuntimeBeforePersistence) {
    await startRuntimeTurn();
  } else if (runtimeSendPromise) {
    await runtimeSendPromise;
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
  readonly parentEntryId: ThreadEntryId | null;
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
    parentEntryId: input.parentEntryId,
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
