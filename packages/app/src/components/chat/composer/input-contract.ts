import type {
  ApprovalRequestId,
  EnvironmentId,
  ModelSelection,
  ProviderApprovalDecision,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderInteractionMode,
  ResolvedKeybindingsConfig,
  RuntimeMode,
  ScopedThreadRef,
  ServerProvider,
  ThreadId,
} from "@multi/contracts";
import type { UnifiedSettings } from "@multi/contracts/settings";
import type { MutableRefObject, ReactNode } from "react";

import type { ComposerImageAttachment, DraftId } from "../../../stores/chat-drafts";
import type { QueuedComposerItem, QueuedComposerItemId } from "../../../stores/chat-send-queue";
import type { TerminalContextDraft, TerminalContextSelection } from "../../../lib/terminal-context";
import type { PendingUserInputDraftAnswer } from "../../../pending-user-input";
import type { PendingApproval, PendingUserInput } from "../../../session-logic";
import type { SessionPhase, Thread } from "../../../types";
import type { ExpandedImagePreview } from "../message/expanded-image-preview";

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
    terminalContextIds: string[];
  };
  /** Reset composer cursor/trigger/highlight after external prompt mutations, such as send. */
  resetCursorState: (options?: {
    cursor?: number;
    prompt?: string;
    detectTrigger?: boolean;
  }) => void;
  /** Insert a terminal context from the terminal drawer. */
  addTerminalContext: (selection: TerminalContextSelection) => void;
  /** Read prompt, attachments, effort, model, and provider state for dispatch. */
  getSendContext: () => {
    prompt: string;
    images: ComposerImageAttachment[];
    terminalContexts: TerminalContextDraft[];
    selectedPromptEffort: string | null;
    selectedModelOptionsForDispatch: unknown;
    selectedModelSelection: ModelSelection;
    selectedProvider: ProviderDriverKind;
    selectedModel: string;
    selectedProviderModels: ReadonlyArray<ServerProvider["models"][number]>;
  };
}

export interface ComposerInputProps {
  variant?: "hero" | "dock" | "inline-edit";
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
  editingQueuedComposerItemId?: QueuedComposerItemId | null | undefined;

  activePendingApproval?: PendingApproval | null | undefined;
  pendingApprovals?: PendingApproval[] | undefined;
  pendingUserInputs?: PendingUserInput[] | undefined;
  activePendingProgress?: {
    questionIndex: number;
    isLastQuestion: boolean;
    canAdvance: boolean;
    customAnswer: string;
    activeQuestion: { id: string } | null;
  } | null | undefined;
  activePendingResolvedAnswers?: Record<string, unknown> | null | undefined;
  activePendingIsResponding?: boolean | undefined;
  activePendingDraftAnswers?: Record<string, PendingUserInputDraftAnswer> | undefined;
  activePendingQuestionIndex?: number | undefined;
  respondingRequestIds?: ApprovalRequestId[] | undefined;

  showPlanFollowUpPrompt?: boolean | undefined;
  activeProposedPlan?: Thread["proposedPlans"][number] | null | undefined;

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
  composerTerminalContextsRef: MutableRefObject<TerminalContextDraft[]>;

  onSend: (e?: { preventDefault: () => void }) => void;
  onInterrupt: () => void;
  footerSecondaryAction?: ReactNode | undefined;

  onRespondToApproval?: ((
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ) => Promise<void>) | undefined;
  onSelectActivePendingUserInputOption?: ((
    questionId: string,
    optionLabel: string,
    advanceAfterSelect?: boolean,
  ) => void) | undefined;
  onAdvanceActivePendingUserInput?: ((
    draftAnswersOverride?: Record<string, PendingUserInputDraftAnswer>,
  ) => void) | undefined;
  onPreviousActivePendingUserInputQuestion?: (() => void) | undefined;
  onChangeActivePendingUserInputCustomAnswer?: ((
    questionId: string,
    value: string,
    nextCursor: number,
    expandedCursor: number,
    cursorAdjacentToMention: boolean,
  ) => void) | undefined;

  onProviderModelSelect: (instanceId: ProviderInstanceId, model: string) => void;
  onBeginEditQueuedComposerItem?: ((itemId: QueuedComposerItemId) => void) | undefined;
  onCancelEditingQueuedComposerItem?: (() => void) | undefined;
  onRemoveQueuedComposerItem?: ((itemId: QueuedComposerItemId) => void) | undefined;
  onSendQueuedComposerItemNow?: ((itemId: QueuedComposerItemId) => void) | undefined;
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
