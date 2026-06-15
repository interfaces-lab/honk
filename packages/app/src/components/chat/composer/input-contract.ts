import type {
  ApprovalRequestId,
  EnvironmentId,
  MessageId,
  RuntimeApprovalDecision,
  AgentInteractionMode,
  ModelSelection,
  ResolvedKeybindingsConfig,
  ScopedThreadRef,
  ThreadId,
} from "@honk/contracts";
import type { UnifiedSettings } from "@honk/contracts/settings";
import type { RefObject, ReactNode } from "react";

import type { ComposerImageAttachment, DraftId } from "../../../stores/chat-drafts";
import type { ComposerMentionPayload } from "./prompt-editor/types";
import type { QueuedComposerItem } from "../../../stores/chat-send-queue";
import type { PendingUserInputDraftAnswer } from "./pending/user-input";
import type { ContextWindowSnapshot } from "../../../lib/context-window";
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
  focus: () => void;
  focusAtEnd: () => void;
  focusAt: (cursor: number) => void;
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
  /** Clear composer text, store draft, and Lexical editor (Cursor-style imperative clear). */
  clearComposer: (options?: { focus?: boolean }) => void;
  /** Restore composer after failed send or queue edit load. */
  restoreComposer: (snapshot: ComposerSubmitContext) => void;
  /** Read prompt and attachments for dispatch. */
  getSendContext: () => ComposerSubmitContext;
  /** Insert an existing composer mention token without replacing typed text. */
  insertMention: (payload: ComposerMentionPayload) => void;
}

export type ComposerInputVariant = "expanded" | "compact";

export type ComposerInputLayout = "new-agent" | "thread" | "inline-edit";

export type ComposerInteractionModeFocusMode = "end" | "preserve";

export interface ComposerInputProps {
  variant?: ComposerInputVariant;
  layout?: ComposerInputLayout;
  composerDraftTarget: ScopedThreadRef | DraftId;
  environmentId: EnvironmentId;
  draftId: DraftId | null;

  activeThreadId: ThreadId | null;

  phase: SessionPhase;
  isTurnRunning: boolean;
  isConnecting: boolean;
  isSendBusy: boolean;
  isPreparingWorktree: boolean;
  submitDisabled?: boolean | undefined;
  queuedComposerItems?: QueuedComposerItem[] | undefined;
  editingQueuedComposerItemId?: MessageId | null | undefined;
  queuedComposerItemsExpanded?: boolean | undefined;

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

  interactionMode: AgentInteractionMode;
  modelSelection: ModelSelection;

  activeContextWindow: ContextWindowSnapshot | null | undefined;

  resolvedTheme: "light" | "dark";
  settings: UnifiedSettings;
  keybindings: ResolvedKeybindingsConfig;
  terminalOpen: boolean;
  gitCwd: string | null;
  branchName?: string | null | undefined;
  executionModeLabel?: string | null | undefined;

  promptRef?: RefObject<string> | undefined;
  composerImagesRef: RefObject<ComposerImageAttachment[]>;

  onSend: (e?: { preventDefault: () => void }) => void;
  onCompactContext?: (() => void) | undefined;
  onInterrupt: () => void;
  onBuildPlan?: (() => void) | undefined;
  onViewPlan?: (() => void) | undefined;
  footerSecondaryAction?: ReactNode | undefined;

  onRespondToApproval?:
    | ((requestId: ApprovalRequestId, decision: RuntimeApprovalDecision) => Promise<void>)
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

  onBeginEditQueuedComposerItem?: ((itemId: MessageId) => void) | undefined;
  onCancelEditingQueuedComposerItem?: (() => void) | undefined;
  onRemoveQueuedComposerItem?: ((itemId: MessageId) => void) | undefined;
  onSendQueuedComposerItemNow?: ((itemId: MessageId) => void) | undefined;
  onReorderQueuedComposerItem?:
    | ((itemId: MessageId, targetItemId: MessageId | null, insertAfter: boolean) => void)
    | undefined;
  onQueuedComposerItemsExpandedChange?: ((expanded: boolean) => void) | undefined;
  handleInteractionModeChange: (
    mode: AgentInteractionMode,
    focusMode?: ComposerInteractionModeFocusMode,
  ) => void;

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
