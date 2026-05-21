import type {
  ApprovalRequestId,
  EnvironmentId,
  MessageId,
  ModelSelection,
  ProviderApprovalDecision,
  ProviderInteractionMode,
  ResolvedKeybindingsConfig,
  RuntimeMode,
  ScopedThreadRef,
  ThreadId,
  ServerProvider,
} from "@multi/contracts";
import type { UnifiedSettings } from "@multi/contracts/settings";
import type { MutableRefObject, ReactNode } from "react";

import type { ComposerImageAttachment, DraftId } from "../../../stores/chat-drafts";
import type { QueuedComposerItem } from "../../../stores/chat-send-queue";
import type { PendingUserInputDraftAnswer } from "./pending-user-input";
import type { PendingApproval, PendingUserInput } from "../../../session-logic";
import type { SessionPhase, Thread } from "../../../types";
import type { ExpandedImagePreview } from "../message/expanded-image-preview";
import type { ComposerSubmitContext } from "../composer-submit";

export type ComposerMenuPlacement =
  | "top"
  | "top-start"
  | "top-end"
  | "bottom"
  | "bottom-start"
  | "bottom-end";

export interface ComposerInputHandle {
  focusAtEnd: () => void;
  focusAt: (cursor: number) => void;
  openModelPicker: () => void;
  toggleModelPicker: () => void;
  isModelPickerOpen: () => boolean;
  readSnapshot: () => {
    value: string;
    cursor: number;
    expandedCursor: number;
  };
  /** Reset composer cursor/trigger/highlight after external prompt mutations, such as send. */
  resetCursorState: (options?: {
    cursor?: number;
    prompt?: string;
    detectTrigger?: boolean;
  }) => void;
  /** Read prompt, attachments, effort, model, and provider state for dispatch. */
  getSendContext: () => ComposerSubmitContext;
}

export type ComposerInputVariant = "expanded" | "compact";

export type ComposerInputLayout = "new-agent" | "thread" | "inline-edit";

export interface ComposerInputProps {
  variant?: ComposerInputVariant;
  layout?: ComposerInputLayout;
  modelPickerPlacement?: ComposerMenuPlacement;
  composerDraftTarget: ScopedThreadRef | DraftId;
  environmentId: EnvironmentId;
  routeKind: "server" | "draft";
  routeThreadRef: ScopedThreadRef;
  draftId: DraftId | null;

  activeThreadId: ThreadId | null;
  activeThreadEnvironmentId: EnvironmentId | undefined;
  activeThread: Thread | undefined;
  isServerThread: boolean;
  isLocalDraftThread: boolean;

  phase: SessionPhase;
  isConnecting: boolean;
  isSendBusy: boolean;
  isPreparingWorktree: boolean;
  submitDisabled?: boolean | undefined;
  queuedComposerItems?: QueuedComposerItem[] | undefined;
  editingQueuedComposerItemId?: MessageId | null | undefined;

  activePendingApproval?: PendingApproval | null | undefined;
  pendingApprovals?: PendingApproval[] | undefined;
  pendingUserInputs?: PendingUserInput[] | undefined;
  activePendingProgress?:
    | {
        questionIndex: number;
        isLastQuestion: boolean;
        canAdvance: boolean;
        customAnswer: string;
        activeQuestion: { id: string } | null;
      }
    | null
    | undefined;
  activePendingResolvedAnswers?: Record<string, unknown> | null | undefined;
  activePendingIsResponding?: boolean | undefined;
  activePendingDraftAnswers?: Record<string, PendingUserInputDraftAnswer> | undefined;
  activePendingQuestionIndex?: number | undefined;
  respondingRequestIds?: ApprovalRequestId[] | undefined;

  showPlanFollowUpPrompt?: boolean | undefined;
  activeProposedPlan?: Thread["proposedPlans"][number] | null | undefined;
  planSurfaceOpen?: boolean | undefined;

  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;

  providerStatuses: ReadonlyArray<ServerProvider>;
  activeProjectDefaultModelSelection: ModelSelection | null | undefined;
  activeThreadModelSelection: ModelSelection | null | undefined;

  activeThreadActivities: Thread["activities"] | undefined;

  resolvedTheme: "light" | "dark";
  settings: UnifiedSettings;
  keybindings: ResolvedKeybindingsConfig;
  terminalOpen: boolean;
  gitCwd: string | null;

  promptRef: MutableRefObject<string>;
  composerImagesRef: MutableRefObject<ComposerImageAttachment[]>;

  onSend: (e?: { preventDefault: () => void }) => void;
  onInterrupt: () => void;
  onBuildPlan?: (() => void) | undefined;
  onViewPlan?: (() => void) | undefined;
  footerSecondaryAction?: ReactNode | undefined;

  onRespondToApproval?:
    | ((requestId: ApprovalRequestId, decision: ProviderApprovalDecision) => Promise<void>)
    | undefined;
  onSelectActivePendingUserInputOption?:
    | ((questionId: string, optionLabel: string, advanceAfterSelect?: boolean) => void)
    | undefined;
  onAdvanceActivePendingUserInput?:
    | ((draftAnswersOverride?: Record<string, PendingUserInputDraftAnswer>) => void)
    | undefined;
  onPreviousActivePendingUserInputQuestion?: (() => void) | undefined;
  onChangeActivePendingUserInputCustomAnswer?:
    | ((
        questionId: string,
        value: string,
        nextCursor: number,
        expandedCursor: number,
        cursorAdjacentToMention: boolean,
      ) => void)
    | undefined;

  onProviderModelSelect: (selection: ModelSelection) => void;
  onBeginEditQueuedComposerItem?: ((itemId: MessageId) => void) | undefined;
  onCancelEditingQueuedComposerItem?: (() => void) | undefined;
  onRemoveQueuedComposerItem?: ((itemId: MessageId) => void) | undefined;
  onSendQueuedComposerItemNow?: ((itemId: MessageId) => void) | undefined;
  toggleInteractionMode: () => void;
  handleRuntimeModeChange: (mode: RuntimeMode) => void;
  handleInteractionModeChange: (mode: ProviderInteractionMode) => void;

  setThreadError: (threadId: ThreadId | null, error: string | null) => void;
  onExpandImage: (preview: ExpandedImagePreview) => void;
}

export type ComposerFooterPendingAction = {
  questionIndex: number;
  isLastQuestion: boolean;
  canAdvance: boolean;
  isResponding: boolean;
  isComplete: boolean;
} | null;
