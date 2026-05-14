import type {
  ApprovalRequestId,
  EnvironmentId,
  ModelSelection,
  ProjectEntry,
  ProviderApprovalDecision,
  ProviderInteractionMode,
  KeybindingShortcut,
  ResolvedKeybindingsConfig,
  RuntimeMode,
  ScopedThreadRef,
  ServerProvider,
  ThreadId,
  TurnId,
} from "@multi/contracts";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
} from "@multi/contracts";
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { projectSearchEntriesQueryOptions } from "~/lib/project-react-query";
import {
  clampCollapsedComposerCursor,
  type ComposerTrigger,
  collapseExpandedComposerCursor,
  detectComposerTrigger,
  expandCollapsedComposerCursor,
  replaceTextRange,
} from "../../../composer-logic";
import { deriveComposerSendState, readFileAsDataUrl } from "../view/chat-view.logic";
import {
  type ComposerImageAttachment,
  type DraftId,
  type PersistedComposerImageAttachment,
  useComposerDraftStore,
  useComposerThreadDraft,
} from "../../../composer-draft-store";
import { resolveComposerModelSelection } from "../../../composer-model-selection";
import {
  type TerminalContextDraft,
  type TerminalContextSelection,
  insertInlineTerminalContextPlaceholder,
  removeInlineTerminalContextPlaceholder,
} from "../../../lib/terminal-context";
import type { ComposerPromptDoc } from "../../../composer-prompt-doc";
import {
  shouldUseCompactComposerPrimaryActions,
  shouldUseCompactComposerFooter,
} from "../../composer-footer-layout";
import { type ComposerPromptEditorHandle, ComposerPromptEditor } from "./prompt-editor";
import { ProviderModelPicker } from "../picker/model-picker";
import { type ComposerCommandItem, ComposerCommandMenu } from "./command-menu";
import {
  type PromptInputMenuPlacement,
  PromptInputRoot,
  PromptInputToolbar,
  PromptInputToolbarLeft,
  PromptInputToolbarRight,
} from "./prompt-input";
import { ComposerPendingApprovalActions } from "./pending-approval-actions";
import { CompactComposerControlsMenu } from "./compact-composer-controls-menu";
import { ComposerPrimaryActions } from "./primary-actions";
import { ComposerPendingApprovalPanel } from "./pending-approval-panel";
import { ComposerPendingUserInputPanel } from "./pending-user-input-panel";
import { ComposerPlanFollowUpBanner } from "./plan-follow-up-banner";
import { resolveComposerMenuActiveItemId } from "./menu-highlight";
import { searchSlashCommandItems } from "./slash-command-search";
import {
  getComposerProviderState,
  renderProviderTraitsMenuContent,
  renderProviderTraitsPicker,
} from "./provider-registry";
import { ContextWindowMeter } from "./context-window-meter";
import {
  buildExpandedImagePreview,
  type ExpandedImagePreview,
} from "../message/expanded-image-preview";
import { basenameOfPath } from "../../../vscode-icons";
import { cn, randomUUID } from "~/lib/utils";
import { shortcutForCommand } from "../../../keybindings";
import { Separator } from "@multi/ui/separator";
import { Button } from "@multi/ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@multi/ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@multi/ui/tooltip";
import { toastManager } from "~/app/toast";
import {
  IconChevronRightMedium,
  IconExclamationCircle,
  IconLock,
  IconPencilLine,
  IconRobot,
  IconSquareChecklist,
  IconUnlocked,
  IconCrossMediumDefault,
  type CentralIconBaseProps,
} from "central-icons";
type CentralIconComponent = React.ComponentType<CentralIconBaseProps>;
import { proposedPlanTitle } from "../../../proposed-plan";
import { getProviderInteractionModeToggle } from "../../../provider-models";
import type { QueuedComposerItem, QueuedComposerItemId } from "../../../composer-queue-store";
import type { UnifiedSettings } from "@multi/contracts/settings";
import type { SessionPhase, Thread } from "../../../types";
import type { PendingUserInputDraftAnswer } from "../../../pending-user-input";
import type { PendingApproval, PendingUserInput } from "../../../session-logic";
import { deriveLatestContextWindowSnapshot } from "../../../lib/context-window";
import { formatProviderSkillDisplayName } from "../../../provider-skill-presentation";
import { searchProviderSkills } from "../../../provider-skill-search";

const IMAGE_SIZE_LIMIT_LABEL = `${Math.round(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES / (1024 * 1024))}MB`;
const EMPTY_QUEUED_COMPOSER_ITEMS: QueuedComposerItem[] = [];
Object.freeze(EMPTY_QUEUED_COMPOSER_ITEMS);

const ignoreQueuedComposerItem = (_itemId: QueuedComposerItemId): void => undefined;
const ignoreQueuedComposerEditCancel = (): void => undefined;

const runtimeModeConfig: Record<
  RuntimeMode,
  { label: string; description: string; icon: CentralIconComponent }
> = {
  "approval-required": {
    label: "Supervised",
    description: "Ask before commands and file changes.",
    icon: IconLock,
  },
  "auto-accept-edits": {
    label: "Auto-accept edits",
    description: "Auto-approve edits, ask before other actions.",
    icon: IconPencilLine,
  },
  "full-access": {
    label: "Full access",
    description: "Allow commands and edits without prompts.",
    icon: IconUnlocked,
  },
};

const runtimeModeOptions = Object.keys(runtimeModeConfig) as RuntimeMode[];
const COMPOSER_PATH_QUERY_DEBOUNCE_MS = 120;
const EMPTY_PROJECT_ENTRIES: ProjectEntry[] = [];
const DISABLED_COMPOSER_CYCLE_HOTKEY = { key: "Tab", shift: true } as const;

function keybindingShortcutKeyForHotkey(shortcut: KeybindingShortcut): string {
  if (shortcut.key === " ") return "Space";
  if (shortcut.key === "escape") return "Escape";
  if (shortcut.key === "tab") return "Tab";
  if (shortcut.key === "enter") return "Enter";
  if (shortcut.key === "arrowup") return "ArrowUp";
  if (shortcut.key === "arrowdown") return "ArrowDown";
  if (shortcut.key === "arrowleft") return "ArrowLeft";
  if (shortcut.key === "arrowright") return "ArrowRight";
  if (shortcut.key.length === 1) return shortcut.key.toUpperCase();
  return shortcut.key;
}

function keybindingShortcutToHotkey(shortcut: KeybindingShortcut): Parameters<typeof useHotkey>[0] {
  return {
    key: keybindingShortcutKeyForHotkey(shortcut),
    mod: shortcut.modKey,
    ctrl: shortcut.ctrlKey,
    shift: shortcut.shiftKey,
    alt: shortcut.altKey,
    meta: shortcut.metaKey,
  };
}

const extendReplacementRangeForTrailingSpace = (
  text: string,
  rangeEnd: number,
  replacement: string,
): number => {
  if (!replacement.endsWith(" ")) {
    return rangeEnd;
  }
  return text[rangeEnd] === " " ? rangeEnd + 1 : rangeEnd;
};

const syncTerminalContextsByIds = (
  contexts: ReadonlyArray<TerminalContextDraft>,
  ids: ReadonlyArray<string>,
): TerminalContextDraft[] => {
  const contextsById = new Map(contexts.map((context) => [context.id, context]));
  return ids.flatMap((id) => {
    const context = contextsById.get(id);
    return context ? [context] : [];
  });
};

const terminalContextIdListsEqual = (
  contexts: ReadonlyArray<TerminalContextDraft>,
  ids: ReadonlyArray<string>,
): boolean =>
  contexts.length === ids.length && contexts.every((context, index) => context.id === ids[index]);

const ComposerFooterModeControls = memo(function ComposerFooterModeControls(props: {
  showInteractionModeToggle: boolean;
  interactionMode: ProviderInteractionMode;
  runtimeMode: RuntimeMode;
  showPlanToggle: boolean;
  planSidebarLabel: string;
  planSidebarOpen: boolean;
  onToggleInteractionMode: () => void;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
  onTogglePlanSidebar: () => void;
}) {
  const runtimeModeOption = runtimeModeConfig[props.runtimeMode];
  const RuntimeModeIcon = runtimeModeOption.icon;

  return (
    <>
      <Separator orientation="vertical" className="mx-0.5 hidden h-4 sm:block" />

      {props.showInteractionModeToggle ? (
        <>
          <Button
            variant="ghost"
            className="composer-unified-dropdown shrink-0 select-none whitespace-nowrap px-2.5 text-muted-foreground/70 hover:text-foreground/80 sm:px-3"
            data-mode={props.interactionMode === "plan" ? "plan" : "chat"}
            size="sm"
            type="button"
            onClick={props.onToggleInteractionMode}
            title={
              props.interactionMode === "plan"
                ? "Plan mode — click to return to normal build mode"
                : "Default mode — click to enter plan mode"
            }
          >
            <IconRobot />
            <span className="sr-only sm:not-sr-only">
              {props.interactionMode === "plan" ? "Plan" : "Build"}
            </span>
          </Button>

          <Separator orientation="vertical" className="mx-0.5 hidden h-4 sm:block" />
        </>
      ) : null}

      <Select
        value={props.runtimeMode}
        onValueChange={(value) => props.onRuntimeModeChange(value!)}
      >
        <SelectTrigger
          variant="ghost"
          size="sm"
          className="select-none font-medium"
          aria-label="Runtime mode"
          title={runtimeModeOption.description}
        >
          <RuntimeModeIcon className="size-4" />
          <SelectValue>{runtimeModeOption.label}</SelectValue>
        </SelectTrigger>
        <SelectPopup alignItemWithTrigger={false}>
          {runtimeModeOptions.map((mode) => {
            const option = runtimeModeConfig[mode];
            const OptionIcon = option.icon;
            return (
              <SelectItem key={mode} value={mode} className="min-w-64 py-2">
                <div className="grid min-w-0 gap-0.5">
                  <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                    <OptionIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    {option.label}
                  </span>
                  <span className="text-muted-foreground text-xs leading-4">
                    {option.description}
                  </span>
                </div>
              </SelectItem>
            );
          })}
        </SelectPopup>
      </Select>

      {props.showPlanToggle ? (
        <>
          <Separator orientation="vertical" className="mx-0.5 hidden h-4 sm:block" />
          <Button
            variant="ghost"
            className={cn(
              "shrink-0 select-none whitespace-nowrap px-2.5 sm:px-3",
              props.planSidebarOpen
                ? "text-blue-400 hover:text-blue-300"
                : "text-muted-foreground/70 hover:text-foreground/80",
            )}
            size="sm"
            type="button"
            onClick={props.onTogglePlanSidebar}
            title={
              props.planSidebarOpen
                ? `Hide ${props.planSidebarLabel.toLowerCase()} sidebar`
                : `Show ${props.planSidebarLabel.toLowerCase()} sidebar`
            }
          >
            <IconSquareChecklist />
            <span className="sr-only sm:not-sr-only">{props.planSidebarLabel}</span>
          </Button>
        </>
      ) : null}
    </>
  );
});

const ComposerFooterPrimaryActions = memo(function ComposerFooterPrimaryActions(props: {
  compact: boolean;
  dockSingleRow: boolean;
  activeContextWindow: ReturnType<typeof deriveLatestContextWindowSnapshot>;
  isPreparingWorktree: boolean;
  pendingAction: {
    questionIndex: number;
    isLastQuestion: boolean;
    canAdvance: boolean;
    isResponding: boolean;
    isComplete: boolean;
  } | null;
  isRunning: boolean;
  showPlanFollowUpPrompt: boolean;
  promptHasText: boolean;
  isSendBusy: boolean;
  isConnecting: boolean;
  submitDisabled: boolean;
  hasSendableContent: boolean;
  sendWhileStreamingBehavior: UnifiedSettings["agentWindowSendWhileStreamingBehavior"];
  submitActionLabel?: string | undefined;
  onPreviousPendingQuestion: () => void;
  onInterrupt: () => void;
  onImplementPlanInNewThread: () => void;
}) {
  return (
    <>
      {props.activeContextWindow ? <ContextWindowMeter usage={props.activeContextWindow} /> : null}
      {props.isPreparingWorktree ? (
        <span className="select-none text-muted-foreground/70 text-xs">Preparing worktree...</span>
      ) : null}
      <ComposerPrimaryActions
        compact={props.compact}
        dockSingleRow={props.dockSingleRow}
        pendingAction={props.pendingAction}
        isRunning={props.isRunning}
        showPlanFollowUpPrompt={props.showPlanFollowUpPrompt}
        promptHasText={props.promptHasText}
        isSendBusy={props.isSendBusy}
        isConnecting={props.isConnecting}
        isPreparingWorktree={props.isPreparingWorktree}
        hasSendableContent={props.hasSendableContent && !props.submitDisabled}
        sendWhileStreamingBehavior={props.sendWhileStreamingBehavior}
        submitActionLabel={props.submitActionLabel}
        onPreviousPendingQuestion={props.onPreviousPendingQuestion}
        onInterrupt={props.onInterrupt}
        onImplementPlanInNewThread={props.onImplementPlanInNewThread}
      />
    </>
  );
});

function formatQueuedComposerItemPreview(item: QueuedComposerItem): string {
  const prompt = item.sendContext.prompt.trim().replace(/\s+/g, " ");
  if (prompt.length > 0) {
    return prompt;
  }
  const imageCount = item.sendContext.images.length;
  if (imageCount > 0) {
    return imageCount === 1
      ? (item.sendContext.images[0]?.name ?? "Image")
      : `${imageCount} images`;
  }
  const terminalContextCount = item.sendContext.terminalContexts.length;
  if (terminalContextCount > 0) {
    return terminalContextCount === 1
      ? "Terminal context"
      : `${terminalContextCount} terminal contexts`;
  }
  return "Queued message";
}

function formatQueuedComposerItemMeta(item: QueuedComposerItem, index: number): string {
  const parts = [`#${index + 1}`];
  if (item.sendContext.images.length > 0) {
    parts.push(`${item.sendContext.images.length} img`);
  }
  if (item.sendContext.terminalContexts.length > 0) {
    parts.push(`${item.sendContext.terminalContexts.length} ctx`);
  }
  return parts.join(" / ");
}

const QueuedComposerItemsPanel = memo(function QueuedComposerItemsPanel(props: {
  items: readonly QueuedComposerItem[];
  editingItemId: QueuedComposerItemId | null;
  isBusy: boolean;
  onBeginEdit: (itemId: QueuedComposerItemId) => void;
  onCancelEdit: () => void;
  onRemove: (itemId: QueuedComposerItemId) => void;
  onSendNow: (itemId: QueuedComposerItemId) => void;
}) {
  if (props.items.length === 0) {
    return null;
  }

  return (
    <div className="border-b border-border/60 px-2.5 py-2 sm:px-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-detail font-medium text-muted-foreground">
          Queued ({props.items.length})
        </span>
        {props.editingItemId ? (
          <button
            type="button"
            className="rounded-multi-control px-1.5 py-0.5 text-detail text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-multi-stroke-focused focus-visible:outline-none"
            onClick={props.onCancelEdit}
          >
            Cancel edit
          </button>
        ) : null}
      </div>
      <div className="flex max-h-36 flex-col gap-1 overflow-y-auto pr-1">
        {props.items.map((item, index) => {
          const isEditing = props.editingItemId === item.id;
          return (
            <div
              key={item.id}
              className={cn(
                "flex min-h-9 items-center gap-2 rounded-md border px-2 py-1.5",
                isEditing ? "border-primary/50 bg-primary/10" : "border-border/70 bg-muted/25",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-body text-foreground">
                  {formatQueuedComposerItemPreview(item)}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-caption text-muted-foreground">
                  <span>{formatQueuedComposerItemMeta(item, index)}</span>
                  {isEditing ? <span>Editing</span> : null}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:ring-1 focus-visible:ring-multi-stroke-focused focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
                  onClick={() => props.onBeginEdit(item.id)}
                  disabled={isEditing}
                  aria-label="Edit queued message"
                  title="Edit queued message"
                >
                  <IconPencilLine className="size-3.5" />
                </button>
                <button
                  type="button"
                  className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:ring-1 focus-visible:ring-multi-stroke-focused focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
                  onClick={() => props.onSendNow(item.id)}
                  disabled={props.isBusy || isEditing}
                  aria-label="Send queued message now"
                  title="Send queued message now"
                >
                  <IconChevronRightMedium className="size-3.5 -rotate-90" />
                </button>
                <button
                  type="button"
                  className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:ring-1 focus-visible:ring-multi-stroke-focused focus-visible:outline-none"
                  onClick={() => props.onRemove(item.id)}
                  aria-label="Remove queued message"
                  title="Remove queued message"
                >
                  <IconCrossMediumDefault className="size-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

// --------------------------------------------------------------------------
// Handle exposed to ChatView
// --------------------------------------------------------------------------

export interface ChatComposerHandle {
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
  /** Reset composer cursor/trigger/highlight after external prompt mutations (e.g. onSend). */
  resetCursorState: (options?: {
    cursor?: number;
    prompt?: string;
    detectTrigger?: boolean;
  }) => void;
  /** Insert a terminal context from the terminal drawer. */
  addTerminalContext: (selection: TerminalContextSelection) => void;
  /** Get the current prompt/effort/model state for use in send. */
  getSendContext: () => {
    prompt: string;
    promptDoc: ComposerPromptDoc | null;
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

// --------------------------------------------------------------------------
// Props
// --------------------------------------------------------------------------

export interface ChatComposerProps {
  variant?: "hero" | "dock";
  modelPickerPlacement?: PromptInputMenuPlacement;
  composerDraftTarget: ScopedThreadRef | DraftId;
  environmentId: EnvironmentId;
  routeKind: "server" | "draft";
  routeThreadRef: ScopedThreadRef;
  draftId: DraftId | null;

  // Thread context
  activeThreadId: ThreadId | null;
  activeThreadEnvironmentId: EnvironmentId | undefined;
  activeThread: Thread | undefined;
  isServerThread: boolean;
  isLocalDraftThread: boolean;

  // Session phase
  phase: SessionPhase;
  isConnecting: boolean;
  isSendBusy: boolean;
  isPreparingWorktree: boolean;
  submitDisabled?: boolean | undefined;
  queuedComposerItems?: QueuedComposerItem[] | undefined;
  editingQueuedComposerItemId?: QueuedComposerItemId | null | undefined;

  // Pending approvals / inputs
  activePendingApproval: PendingApproval | null;
  pendingApprovals: PendingApproval[];
  pendingUserInputs: PendingUserInput[];
  activePendingProgress: {
    questionIndex: number;
    isLastQuestion: boolean;
    canAdvance: boolean;
    customAnswer: string;
    activeQuestion: { id: string } | null;
  } | null;
  activePendingResolvedAnswers: Record<string, unknown> | null;
  activePendingIsResponding: boolean;
  activePendingDraftAnswers: Record<string, PendingUserInputDraftAnswer>;
  activePendingQuestionIndex: number;
  respondingRequestIds: ApprovalRequestId[];

  // Plan
  showPlanFollowUpPrompt: boolean;
  activeProposedPlan: Thread["proposedPlans"][number] | null;
  activePlan: { turnId?: TurnId | null } | null;
  sidebarProposedPlan: { turnId?: TurnId | null } | null;
  planSidebarLabel: string;
  planSidebarOpen: boolean;

  // Mode
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;

  // Provider / model
  providerStatuses: ReadonlyArray<ServerProvider>;
  activeProjectDefaultModelSelection: ModelSelection | null | undefined;
  activeThreadModelSelection: ModelSelection | null | undefined;

  // Context window
  activeThreadActivities: Thread["activities"] | undefined;

  // Misc
  resolvedTheme: "light" | "dark";
  settings: UnifiedSettings;
  keybindings: ResolvedKeybindingsConfig;
  terminalOpen: boolean;
  gitCwd: string | null;

  // Refs the parent needs kept in sync
  promptRef: React.MutableRefObject<string>;
  composerImagesRef: React.MutableRefObject<ComposerImageAttachment[]>;
  composerTerminalContextsRef: React.MutableRefObject<TerminalContextDraft[]>;

  // Scroll
  shouldAutoScrollRef: React.MutableRefObject<boolean>;
  scheduleStickToBottom: () => void;

  // Callbacks
  onSend: (e?: { preventDefault: () => void }) => void;
  onInterrupt: () => void;
  onImplementPlanInNewThread: () => void;
  onRespondToApproval: (
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ) => Promise<void>;
  onSelectActivePendingUserInputOption: (questionId: string, optionLabel: string) => void;
  onAdvanceActivePendingUserInput: () => void;
  onPreviousActivePendingUserInputQuestion: () => void;
  onChangeActivePendingUserInputCustomAnswer: (
    questionId: string,
    value: string,
    nextCursor: number,
    expandedCursor: number,
    cursorAdjacentToMention: boolean,
  ) => void;

  onProviderModelSelect: (instanceId: ProviderInstanceId, model: string) => void;
  onBeginEditQueuedComposerItem?: ((itemId: QueuedComposerItemId) => void) | undefined;
  onCancelEditingQueuedComposerItem?: (() => void) | undefined;
  onRemoveQueuedComposerItem?: ((itemId: QueuedComposerItemId) => void) | undefined;
  onSendQueuedComposerItemNow?: ((itemId: QueuedComposerItemId) => void) | undefined;
  toggleInteractionMode: () => void;
  handleRuntimeModeChange: (mode: RuntimeMode) => void;
  handleInteractionModeChange: (mode: ProviderInteractionMode) => void;
  togglePlanSidebar: () => void;

  focusComposer: () => void;
  scheduleComposerFocus: () => void;
  setThreadError: (threadId: ThreadId | null, error: string | null) => void;
  onExpandImage: (preview: ExpandedImagePreview) => void;
}

// --------------------------------------------------------------------------
// Component
// --------------------------------------------------------------------------

export const ChatComposer = memo(
  forwardRef<ChatComposerHandle, ChatComposerProps>(function ChatComposer(props, ref) {
    const {
      variant = "dock",
      modelPickerPlacement: modelPickerPlacementProp,
      composerDraftTarget,
      environmentId,
      routeKind,
      routeThreadRef,
      draftId,
      activeThreadId,
      activeThreadEnvironmentId: _activeThreadEnvironmentId,
      activeThread,
      isServerThread: _isServerThread,
      isLocalDraftThread: _isLocalDraftThread,
      phase,
      isConnecting,
      isSendBusy,
      isPreparingWorktree,
      submitDisabled = false,
      queuedComposerItems = EMPTY_QUEUED_COMPOSER_ITEMS,
      editingQueuedComposerItemId = null,
      activePendingApproval,
      pendingApprovals,
      pendingUserInputs,
      activePendingProgress,
      activePendingResolvedAnswers,
      activePendingIsResponding,
      activePendingDraftAnswers,
      activePendingQuestionIndex,
      respondingRequestIds,
      showPlanFollowUpPrompt,
      activeProposedPlan,
      activePlan,
      sidebarProposedPlan,
      planSidebarLabel,
      planSidebarOpen,
      runtimeMode,
      interactionMode,
      providerStatuses,
      activeProjectDefaultModelSelection,
      activeThreadModelSelection,
      activeThreadActivities,
      resolvedTheme,
      settings,
      keybindings,
      terminalOpen,
      gitCwd,
      promptRef,
      composerImagesRef,
      composerTerminalContextsRef,
      shouldAutoScrollRef,
      scheduleStickToBottom,
      onSend,
      onInterrupt,
      onImplementPlanInNewThread,
      onRespondToApproval,
      onSelectActivePendingUserInputOption,
      onAdvanceActivePendingUserInput,
      onPreviousActivePendingUserInputQuestion,
      onChangeActivePendingUserInputCustomAnswer,
      onProviderModelSelect,
      onBeginEditQueuedComposerItem,
      onCancelEditingQueuedComposerItem,
      onRemoveQueuedComposerItem,
      onSendQueuedComposerItemNow,
      toggleInteractionMode,
      handleRuntimeModeChange,
      handleInteractionModeChange,
      togglePlanSidebar,
      focusComposer,
      scheduleComposerFocus,
      setThreadError,
      onExpandImage,
    } = props;
    const handleBeginEditQueuedComposerItem =
      onBeginEditQueuedComposerItem ?? ignoreQueuedComposerItem;
    const handleCancelEditingQueuedComposerItem =
      onCancelEditingQueuedComposerItem ?? ignoreQueuedComposerEditCancel;
    const handleRemoveQueuedComposerItem = onRemoveQueuedComposerItem ?? ignoreQueuedComposerItem;
    const handleSendQueuedComposerItemNow = onSendQueuedComposerItemNow ?? ignoreQueuedComposerItem;
    const composerVariant = variant === "hero" ? "expanded" : "compact";
    const modelPickerPlacement =
      modelPickerPlacementProp ?? (composerVariant === "compact" ? "top-start" : "bottom-start");

    // ------------------------------------------------------------------
    // Store subscriptions (prompt / images / terminal contexts)
    // ------------------------------------------------------------------
    const composerDraft = useComposerThreadDraft(composerDraftTarget);
    const prompt = composerDraft.prompt;
    const composerPromptDoc = composerDraft.promptDoc;
    const composerImages = composerDraft.images;
    const composerTerminalContexts = composerDraft.terminalContexts;
    const nonPersistedComposerImageIds = composerDraft.nonPersistedImageIds;

    const setComposerDraftPrompt = useComposerDraftStore((store) => store.setPrompt);
    const addComposerDraftImage = useComposerDraftStore((store) => store.addImage);
    const addComposerDraftImages = useComposerDraftStore((store) => store.addImages);
    const removeComposerDraftImage = useComposerDraftStore((store) => store.removeImage);
    const insertComposerDraftTerminalContext = useComposerDraftStore(
      (store) => store.insertTerminalContext,
    );
    const removeComposerDraftTerminalContext = useComposerDraftStore(
      (store) => store.removeTerminalContext,
    );
    const setComposerDraftTerminalContexts = useComposerDraftStore(
      (store) => store.setTerminalContexts,
    );
    const clearComposerDraftPersistedAttachments = useComposerDraftStore(
      (store) => store.clearPersistedAttachments,
    );
    const syncComposerDraftPersistedAttachments = useComposerDraftStore(
      (store) => store.syncPersistedAttachments,
    );
    const getComposerDraft = useComposerDraftStore((store) => store.getComposerDraft);

    // ------------------------------------------------------------------
    // Model state
    // ------------------------------------------------------------------
    const composerModelSelection = useMemo(
      () =>
        resolveComposerModelSelection({
          draft: {
            activeProvider: composerDraft.activeProvider,
            modelSelectionByProvider: composerDraft.modelSelectionByProvider,
          },
          providers: providerStatuses,
          settings,
          sessionProviderInstanceId: activeThread?.session?.providerInstanceId,
          threadModelSelection: activeThreadModelSelection,
          projectModelSelection: activeProjectDefaultModelSelection,
        }),
      [
        activeProjectDefaultModelSelection,
        activeThread?.session?.providerInstanceId,
        activeThreadModelSelection,
        composerDraft.activeProvider,
        composerDraft.modelSelectionByProvider,
        providerStatuses,
        settings,
      ],
    );
    const providerInstanceEntries = composerModelSelection.providerInstanceEntries;
    const selectedProvider = composerModelSelection.selectedProvider;
    const selectedInstanceId = composerModelSelection.selectedInstanceId;
    const composerModelOptions = composerModelSelection.composerModelOptions;
    const modelOptionsByInstance = composerModelSelection.modelOptionsByInstance;
    const instanceCoherentSelectedModel = composerModelSelection.selectedModel;
    const selectedProviderStatus = composerModelSelection.selectedProviderEntry?.snapshot ?? null;
    const selectedProviderModels = composerModelSelection.selectedProviderModels;

    const composerProviderState = useMemo(
      () =>
        getComposerProviderState({
          provider: selectedProvider,
          model: instanceCoherentSelectedModel,
          models: selectedProviderModels,
          prompt,
          modelOptions: composerModelOptions?.[selectedProvider],
        }),
      [
        composerModelOptions,
        instanceCoherentSelectedModel,
        prompt,
        selectedProvider,
        selectedProviderModels,
      ],
    );

    const selectedPromptEffort = composerProviderState.promptEffort;
    const selectedModelOptionsForDispatch = composerProviderState.modelOptionsForDispatch;
    const composerProviderControls = useMemo(
      () => ({
        showInteractionModeToggle: getProviderInteractionModeToggle(
          providerStatuses,
          selectedProvider,
        ),
      }),
      [providerStatuses, selectedProvider],
    );
    const selectedModelSelection = composerModelSelection.modelSelection;

    // ------------------------------------------------------------------
    // Context window
    // ------------------------------------------------------------------
    const activeContextWindow = useMemo(
      () => deriveLatestContextWindowSnapshot(activeThreadActivities ?? []),
      [activeThreadActivities],
    );
    const visibleContextWindow = useMemo(() => {
      if (!activeContextWindow || settings.agentWindowUsageSummaryDisplay === "never") {
        return null;
      }
      if (settings.agentWindowUsageSummaryDisplay === "always") {
        return activeContextWindow;
      }
      return activeContextWindow.usedPercentage !== null && activeContextWindow.usedPercentage >= 50
        ? activeContextWindow
        : null;
    }, [activeContextWindow, settings.agentWindowUsageSummaryDisplay]);

    // ------------------------------------------------------------------
    // Composer-local state
    // ------------------------------------------------------------------
    const [composerCursor, setComposerCursor] = useState(() =>
      collapseExpandedComposerCursor(prompt, prompt.length),
    );
    const [composerTrigger, setComposerTrigger] = useState<ComposerTrigger | null>(null);
    const [composerHighlightedItemId, setComposerHighlightedItemId] = useState<string | null>(null);
    const [composerHighlightedSearchKey, setComposerHighlightedSearchKey] = useState<string | null>(
      null,
    );
    const [isDragOverComposer, setIsDragOverComposer] = useState(false);
    const [isComposerFooterCompact, setIsComposerFooterCompact] = useState(false);
    const [isComposerPrimaryActionsCompact, setIsComposerPrimaryActionsCompact] = useState(false);
    const [isComposerModelPickerOpen, setIsComposerModelPickerOpen] = useState(false);
    const [isComposerEditorMultiline, setIsComposerEditorMultiline] = useState(false);
    const [modelPickerOpenSearchSeed, setModelPickerOpenSearchSeed] = useState<string | undefined>(
      undefined,
    );

    // ------------------------------------------------------------------
    // Refs
    // ------------------------------------------------------------------
    const composerEditorRef = useRef<ComposerPromptEditorHandle>(null);
    const composerEditorHotkeyRef = useRef<HTMLDivElement>(null);
    const composerFormRef = useRef<HTMLFormElement>(null);
    const composerImageInputRef = useRef<HTMLInputElement>(null);
    const composerFormHeightRef = useRef(0);
    const isComposerModelPickerOpenRef = useRef(isComposerModelPickerOpen);
    const composerSelectLockRef = useRef(false);
    const composerMenuOpenRef = useRef(false);
    const composerMenuItemsRef = useRef<ComposerCommandItem[]>([]);
    const activeComposerMenuItemRef = useRef<ComposerCommandItem | null>(null);
    const suppressInitialComposerTriggerDetectionRef = useRef(true);
    const initialComposerTriggerSuppressionPromptRef = useRef(prompt);
    const dismissedComposerTriggerKeyRef = useRef<string | null>(null);
    const dragDepthRef = useRef(0);
    isComposerModelPickerOpenRef.current = isComposerModelPickerOpen;

    const cycleInteractionModeHotkey = useMemo(() => {
      const shortcut = shortcutForCommand(keybindings, "composer.cycleInteractionMode", {
        context: { terminalOpen },
      });
      return shortcut ? keybindingShortcutToHotkey(shortcut) : null;
    }, [keybindings, terminalOpen]);

    useHotkey(
      cycleInteractionModeHotkey ?? DISABLED_COMPOSER_CYCLE_HOTKEY,
      () => {
        toggleInteractionMode();
      },
      {
        conflictBehavior: "allow",
        enabled: cycleInteractionModeHotkey !== null,
        ignoreInputs: false,
        target: composerEditorHotkeyRef,
      },
    );

    const composerTriggerDismissKey = useCallback(
      (trigger: ComposerTrigger) =>
        `${trigger.kind}:${trigger.rangeStart}:${trigger.rangeEnd}:${trigger.query}`,
      [],
    );

    const resolveComposerTrigger = useCallback(
      (text: string, expandedCursor: number): ComposerTrigger | null => {
        if (suppressInitialComposerTriggerDetectionRef.current) {
          if (text === initialComposerTriggerSuppressionPromptRef.current) {
            return null;
          }
          suppressInitialComposerTriggerDetectionRef.current = false;
        }
        const nextTrigger = detectComposerTrigger(text, expandedCursor);
        if (!nextTrigger) {
          dismissedComposerTriggerKeyRef.current = null;
          return null;
        }
        return composerTriggerDismissKey(nextTrigger) === dismissedComposerTriggerKeyRef.current
          ? null
          : nextTrigger;
      },
      [composerTriggerDismissKey],
    );

    // ------------------------------------------------------------------
    // Derived: composer send state
    // ------------------------------------------------------------------
    const composerSendState = useMemo(
      () =>
        deriveComposerSendState({
          prompt,
          imageCount: composerImages.length,
          terminalContexts: composerTerminalContexts,
        }),
      [composerImages.length, composerTerminalContexts, prompt],
    );

    // ------------------------------------------------------------------
    // Derived: composer trigger / menu
    // ------------------------------------------------------------------
    const composerTriggerKind = composerTrigger?.kind ?? null;
    const pathTriggerQuery = composerTrigger?.kind === "path" ? composerTrigger.query : "";
    const isPathTrigger = composerTriggerKind === "path";
    const [debouncedPathQuery, composerPathQueryDebouncer] = useDebouncedValue(
      pathTriggerQuery,
      { wait: COMPOSER_PATH_QUERY_DEBOUNCE_MS },
      (debouncerState) => ({ isPending: debouncerState.isPending }),
    );
    const effectivePathQuery = pathTriggerQuery.length > 0 ? debouncedPathQuery : "";
    const projectEntriesQuery = useQuery(
      projectSearchEntriesQueryOptions({
        environmentId,
        cwd: gitCwd,
        query: effectivePathQuery,
        enabled: isPathTrigger,
        limit: 80,
      }),
    );
    const projectEntries = projectEntriesQuery.data?.entries ?? EMPTY_PROJECT_ENTRIES;

    const composerMenuItems = useMemo<ComposerCommandItem[]>(() => {
      if (!composerTrigger) return [];
      if (composerTrigger.kind === "path") {
        return projectEntries.map((entry) => ({
          id: `path:${entry.kind}:${entry.path}`,
          type: "path",
          path: entry.path,
          pathKind: entry.kind,
          label: basenameOfPath(entry.path),
          description: entry.parentPath ?? "",
        }));
      }
      if (composerTrigger.kind === "slash-command") {
        const builtInSlashCommandItems = [
          {
            id: "slash:model",
            type: "slash-command",
            command: "model",
            label: "/model",
            description: "Switch response model for this thread",
          },
          {
            id: "slash:plan",
            type: "slash-command",
            command: "plan",
            label: "/plan",
            description: "Switch this thread into plan mode",
          },
          {
            id: "slash:default",
            type: "slash-command",
            command: "default",
            label: "/default",
            description: "Switch this thread back to normal build mode",
          },
        ] satisfies ReadonlyArray<Extract<ComposerCommandItem, { type: "slash-command" }>>;
        const providerSlashCommandItems = (selectedProviderStatus?.slashCommands ?? []).map(
          (command) => ({
            id: `provider-slash-command:${selectedProvider}:${command.name}`,
            type: "provider-slash-command" as const,
            provider: selectedProvider,
            command,
            label: `/${command.name}`,
            description: command.description ?? command.input?.hint ?? "Run provider command",
          }),
        );
        const providerSkillItems = searchProviderSkills(
          selectedProviderStatus?.skills ?? [],
          "",
        ).map((skill) => ({
          id: `skill:${selectedProvider}:${skill.name}`,
          type: "skill" as const,
          provider: selectedProvider,
          skill,
          label: formatProviderSkillDisplayName(skill),
          description:
            skill.shortDescription ??
            skill.description ??
            (skill.scope ? `${skill.scope} skill` : "Run provider skill"),
        }));
        const query = composerTrigger.query.trim().toLowerCase();
        const slashCommandItems = [
          ...providerSkillItems,
          ...providerSlashCommandItems,
          ...builtInSlashCommandItems,
        ];
        if (!query) {
          return slashCommandItems;
        }
        return searchSlashCommandItems(slashCommandItems, query);
      }
      const activeComposerTrigger = composerTrigger;
      if (activeComposerTrigger.kind === "skill") {
        return searchProviderSkills(
          selectedProviderStatus?.skills ?? [],
          activeComposerTrigger.query,
        ).map((skill) => ({
          id: `skill:${selectedProvider}:${skill.name}`,
          type: "skill" as const,
          provider: selectedProvider,
          skill,
          label: formatProviderSkillDisplayName(skill),
          description:
            skill.shortDescription ??
            skill.description ??
            (skill.scope ? `${skill.scope} skill` : "Run provider skill"),
        }));
      }
      return [];
    }, [composerTrigger, selectedProvider, selectedProviderStatus, projectEntries]);

    const composerMenuOpen = composerTrigger ? composerTrigger.kind !== "slash-model" : false;
    const composerMenuSearchKey = composerTrigger
      ? `${composerTrigger.kind}:${composerTrigger.query.trim().toLowerCase()}`
      : null;
    const activeComposerMenuItem = useMemo(() => {
      const activeItemId = resolveComposerMenuActiveItemId({
        items: composerMenuItems,
        highlightedItemId: composerHighlightedItemId,
        currentSearchKey: composerMenuSearchKey,
        highlightedSearchKey: composerHighlightedSearchKey,
      });
      return composerMenuItems.find((item) => item.id === activeItemId) ?? null;
    }, [
      composerHighlightedItemId,
      composerHighlightedSearchKey,
      composerMenuItems,
      composerMenuSearchKey,
    ]);

    composerMenuOpenRef.current = composerMenuOpen;
    composerMenuItemsRef.current = composerMenuItems;
    activeComposerMenuItemRef.current = activeComposerMenuItem;

    const handleComposerContainerClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
      if (composerMenuOpenRef.current) return;
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (
        target.closest(
          '.ProseMirror, button, input, select, textarea, a, [role="button"], [role="menuitem"]',
        )
      ) {
        return;
      }
      composerEditorRef.current?.focusAtEnd();
    }, []);

    const nonPersistedComposerImageIdSet = useMemo(
      () => new Set(nonPersistedComposerImageIds),
      [nonPersistedComposerImageIds],
    );

    const isComposerApprovalState = activePendingApproval !== null;
    const activePendingUserInput = pendingUserInputs[0] ?? null;
    const hasQueuedComposerItems = queuedComposerItems.length > 0;
    const isEditingQueuedComposerItem = editingQueuedComposerItemId !== null;
    const canSubmitQueuedComposerItem = hasQueuedComposerItems && !isEditingQueuedComposerItem;
    const hasComposerHeader =
      isComposerApprovalState ||
      pendingUserInputs.length > 0 ||
      (showPlanFollowUpPrompt && activeProposedPlan !== null);

    const isDockComposerExpanded =
      composerVariant === "compact" &&
      (hasComposerHeader ||
        hasQueuedComposerItems ||
        composerImages.length > 0 ||
        activePendingProgress !== null ||
        isComposerEditorMultiline);

    const composerFooterHasWideActions = showPlanFollowUpPrompt || activePendingProgress !== null;
    const showPlanSidebarToggle = Boolean(activePlan || sidebarProposedPlan || planSidebarOpen);
    const composerFooterActionLayoutKey = useMemo(() => {
      if (activePendingProgress) {
        return `pending:${activePendingProgress.questionIndex}:${activePendingProgress.isLastQuestion}:${activePendingIsResponding}`;
      }
      if (phase === "running") {
        return `running:${settings.agentWindowSendWhileStreamingBehavior}:${composerSendState.hasSendableContent}:${canSubmitQueuedComposerItem}`;
      }
      if (showPlanFollowUpPrompt) {
        return prompt.trim().length > 0 ? "plan:refine" : "plan:implement";
      }
      return `idle:${composerSendState.hasSendableContent}:${isSendBusy}:${isConnecting}:${isPreparingWorktree}`;
    }, [
      activePendingIsResponding,
      activePendingProgress,
      composerSendState.hasSendableContent,
      canSubmitQueuedComposerItem,
      isConnecting,
      isPreparingWorktree,
      isSendBusy,
      phase,
      prompt,
      settings.agentWindowSendWhileStreamingBehavior,
      showPlanFollowUpPrompt,
    ]);

    const isComposerMenuLoading =
      composerTriggerKind === "path" &&
      ((pathTriggerQuery.length > 0 && composerPathQueryDebouncer.state.isPending) ||
        projectEntriesQuery.isLoading ||
        projectEntriesQuery.isFetching);
    const composerMenuEmptyState = useMemo(() => {
      if (composerTriggerKind === "skill") {
        return "No skills found. Try / to browse provider commands.";
      }
      if (composerTriggerKind === "path") {
        return "No results found";
      }
      return "No matching command.";
    }, [composerTriggerKind]);
    const composerMenuAriaLabel =
      composerTriggerKind === "slash-command" ? "Slash commands" : "Mentions";
    const composerMenuKind = composerTriggerKind === "slash-command" ? "slash" : "mentions";

    // ------------------------------------------------------------------
    // Provider traits UI
    // ------------------------------------------------------------------
    const setPromptFromTraits = useCallback(
      (nextPrompt: string) => {
        if (nextPrompt === promptRef.current) {
          scheduleComposerFocus();
          return;
        }
        promptRef.current = nextPrompt;
        setComposerDraftPrompt(composerDraftTarget, nextPrompt);
        const nextCursor = collapseExpandedComposerCursor(nextPrompt, nextPrompt.length);
        setComposerCursor(nextCursor);
        setComposerTrigger(resolveComposerTrigger(nextPrompt, nextPrompt.length));
        scheduleComposerFocus();
      },
      [
        composerDraftTarget,
        promptRef,
        resolveComposerTrigger,
        scheduleComposerFocus,
        setComposerDraftPrompt,
      ],
    );

    const traitsDockMenuInputBase = {
      provider: selectedProvider,
      ...(routeKind === "server" ? { threadRef: routeThreadRef } : {}),
      ...(routeKind === "draft" && draftId ? { draftId } : {}),
      model: instanceCoherentSelectedModel,
      models: selectedProviderModels,
      modelOptions: composerModelOptions?.[selectedProvider],
      prompt,
      onPromptChange: setPromptFromTraits,
    };

    const dockTraitsMenuFastSlot = renderProviderTraitsMenuContent({
      ...traitsDockMenuInputBase,
      traitsScope: "fast-only",
    });
    const dockTraitsMenuRestSlot = renderProviderTraitsMenuContent({
      ...traitsDockMenuInputBase,
      traitsScope: "except-fast",
    });
    const providerTraitsPicker = renderProviderTraitsPicker({
      provider: selectedProvider,
      ...(routeKind === "server" ? { threadRef: routeThreadRef } : {}),
      ...(routeKind === "draft" && draftId ? { draftId } : {}),
      model: instanceCoherentSelectedModel,
      models: selectedProviderModels,
      modelOptions: composerModelOptions?.[selectedProvider],
      prompt,
      onPromptChange: setPromptFromTraits,
    });
    const pendingPrimaryAction = useMemo(
      () =>
        activePendingProgress
          ? {
              questionIndex: activePendingProgress.questionIndex,
              isLastQuestion: activePendingProgress.isLastQuestion,
              canAdvance: activePendingProgress.canAdvance,
              isResponding: activePendingIsResponding,
              isComplete: Boolean(activePendingResolvedAnswers),
            }
          : null,
      [activePendingIsResponding, activePendingProgress, activePendingResolvedAnswers],
    );

    // ------------------------------------------------------------------
    // Prompt helpers
    // ------------------------------------------------------------------
    const setPrompt = useCallback(
      (nextPrompt: string, nextPromptDoc: ComposerPromptDoc | null = null) => {
        setComposerDraftPrompt(composerDraftTarget, nextPrompt, nextPromptDoc);
      },
      [composerDraftTarget, setComposerDraftPrompt],
    );

    const addComposerImage = useCallback(
      (image: ComposerImageAttachment) => {
        addComposerDraftImage(composerDraftTarget, image);
      },
      [composerDraftTarget, addComposerDraftImage],
    );

    const addComposerImagesToDraft = useCallback(
      (images: ComposerImageAttachment[]) => {
        addComposerDraftImages(composerDraftTarget, images);
      },
      [composerDraftTarget, addComposerDraftImages],
    );

    const removeComposerImageFromDraft = useCallback(
      (imageId: string) => {
        removeComposerDraftImage(composerDraftTarget, imageId);
      },
      [composerDraftTarget, removeComposerDraftImage],
    );

    const removeComposerTerminalContextFromDraft = useCallback(
      (contextId: string) => {
        const contextIndex = composerTerminalContexts.findIndex(
          (context) => context.id === contextId,
        );
        if (contextIndex < 0) return;
        const removal = removeInlineTerminalContextPlaceholder(promptRef.current, contextIndex);
        promptRef.current = removal.prompt;
        setPrompt(removal.prompt);
        removeComposerDraftTerminalContext(composerDraftTarget, contextId);
        const nextCursor = collapseExpandedComposerCursor(removal.prompt, removal.cursor);
        setComposerCursor(nextCursor);
        setComposerTrigger(resolveComposerTrigger(removal.prompt, removal.cursor));
      },
      [
        composerDraftTarget,
        composerTerminalContexts,
        promptRef,
        resolveComposerTrigger,
        removeComposerDraftTerminalContext,
        setPrompt,
      ],
    );

    // ------------------------------------------------------------------
    // Sync refs back to parent
    // ------------------------------------------------------------------
    useEffect(() => {
      promptRef.current = prompt;
      setComposerCursor((existing) => clampCollapsedComposerCursor(prompt, existing));
    }, [prompt, promptRef]);

    useEffect(() => {
      composerImagesRef.current = composerImages;
    }, [composerImages, composerImagesRef]);

    useEffect(() => {
      composerTerminalContextsRef.current = composerTerminalContexts;
    }, [composerTerminalContexts, composerTerminalContextsRef]);

    // ------------------------------------------------------------------
    // Composer menu highlight sync
    // ------------------------------------------------------------------
    useEffect(() => {
      if (!composerMenuOpen) {
        setComposerHighlightedItemId(null);
        setComposerHighlightedSearchKey(null);
        return;
      }
      const nextActiveItemId = resolveComposerMenuActiveItemId({
        items: composerMenuItems,
        highlightedItemId: composerHighlightedItemId,
        currentSearchKey: composerMenuSearchKey,
        highlightedSearchKey: composerHighlightedSearchKey,
      });
      setComposerHighlightedItemId((existing) =>
        existing === nextActiveItemId ? existing : nextActiveItemId,
      );
      setComposerHighlightedSearchKey((existing) =>
        existing === composerMenuSearchKey ? existing : composerMenuSearchKey,
      );
    }, [
      composerHighlightedItemId,
      composerHighlightedSearchKey,
      composerMenuItems,
      composerMenuOpen,
      composerMenuSearchKey,
    ]);

    const lastSyncedPendingInputRef = useRef<{
      requestId: string | null;
      questionId: string | null;
    } | null>(null);

    useEffect(() => {
      const nextCustomAnswer = activePendingProgress?.customAnswer;
      if (typeof nextCustomAnswer !== "string") {
        lastSyncedPendingInputRef.current = null;
        return;
      }

      const nextRequestId = activePendingUserInput?.requestId ?? null;
      const nextQuestionId = activePendingProgress?.activeQuestion?.id ?? null;
      const questionChanged =
        lastSyncedPendingInputRef.current?.requestId !== nextRequestId ||
        lastSyncedPendingInputRef.current?.questionId !== nextQuestionId;
      const textChangedExternally = promptRef.current !== nextCustomAnswer;

      lastSyncedPendingInputRef.current = {
        requestId: nextRequestId,
        questionId: nextQuestionId,
      };

      if (!questionChanged && !textChangedExternally) {
        return;
      }

      promptRef.current = nextCustomAnswer;
      const nextCursor = collapseExpandedComposerCursor(nextCustomAnswer, nextCustomAnswer.length);
      setComposerCursor(nextCursor);
      setComposerTrigger(
        resolveComposerTrigger(
          nextCustomAnswer,
          expandCollapsedComposerCursor(nextCustomAnswer, nextCursor),
        ),
      );
      setComposerHighlightedItemId(null);
    }, [
      activePendingProgress?.customAnswer,
      activePendingProgress?.activeQuestion?.id,
      activePendingUserInput?.requestId,
      promptRef,
      resolveComposerTrigger,
    ]);

    // ------------------------------------------------------------------
    // Reset compositor state on thread/draft change
    // ------------------------------------------------------------------
    useEffect(() => {
      setComposerHighlightedItemId(null);
      setComposerCursor(
        collapseExpandedComposerCursor(promptRef.current, promptRef.current.length),
      );
      suppressInitialComposerTriggerDetectionRef.current = true;
      initialComposerTriggerSuppressionPromptRef.current = promptRef.current;
      dismissedComposerTriggerKeyRef.current = null;
      setComposerTrigger(null);
      dragDepthRef.current = 0;
      setIsDragOverComposer(false);
    }, [draftId, activeThreadId, promptRef]);

    // ------------------------------------------------------------------
    // Footer compact layout observation
    // ------------------------------------------------------------------
    useLayoutEffect(() => {
      const composerForm = composerFormRef.current;
      if (!composerForm) return;
      const measureComposerFormWidth = () => composerForm.clientWidth;
      const measureFooterCompactness = () => {
        const composerFormWidth = measureComposerFormWidth();
        const footerCompact = shouldUseCompactComposerFooter(composerFormWidth, {
          hasWideActions: composerFooterHasWideActions,
        });
        const primaryActionsCompact =
          footerCompact &&
          shouldUseCompactComposerPrimaryActions(composerFormWidth, {
            hasWideActions: composerFooterHasWideActions,
          });
        return {
          primaryActionsCompact,
          footerCompact,
        };
      };

      composerFormHeightRef.current = composerForm.getBoundingClientRect().height;
      const initialCompactness = measureFooterCompactness();
      setIsComposerPrimaryActionsCompact(initialCompactness.primaryActionsCompact);
      setIsComposerFooterCompact(initialCompactness.footerCompact);
      if (typeof ResizeObserver === "undefined") return;

      const observer = new ResizeObserver((entries) => {
        const [entry] = entries;
        if (!entry) return;
        const nextCompactness = measureFooterCompactness();
        setIsComposerPrimaryActionsCompact((previous) =>
          previous === nextCompactness.primaryActionsCompact
            ? previous
            : nextCompactness.primaryActionsCompact,
        );
        setIsComposerFooterCompact((previous) =>
          previous === nextCompactness.footerCompact ? previous : nextCompactness.footerCompact,
        );
        const nextHeight = entry.contentRect.height;
        const previousHeight = composerFormHeightRef.current;
        composerFormHeightRef.current = nextHeight;
        if (previousHeight > 0 && Math.abs(nextHeight - previousHeight) < 0.5) return;
        // The model picker owns a portalled popover whose opening can resize the footer.
        // Keep the timeline stationary while Base UI is anchoring that popup.
        if (isComposerModelPickerOpenRef.current) return;
        if (!shouldAutoScrollRef.current) return;
        scheduleStickToBottom();
      });

      observer.observe(composerForm);
      return () => {
        observer.disconnect();
      };
    }, [
      activeThreadId,
      composerFooterActionLayoutKey,
      composerFooterHasWideActions,
      scheduleStickToBottom,
      shouldAutoScrollRef,
    ]);

    // ------------------------------------------------------------------
    // Image persist effect
    // ------------------------------------------------------------------
    useEffect(() => {
      let cancelled = false;
      void (async () => {
        if (composerImages.length === 0) {
          clearComposerDraftPersistedAttachments(composerDraftTarget);
          return;
        }
        const getPersistedAttachmentsForThread = () =>
          getComposerDraft(composerDraftTarget)?.persistedAttachments ?? [];
        try {
          const currentPersistedAttachments = getPersistedAttachmentsForThread();
          const existingPersistedById = new Map(
            currentPersistedAttachments.map((attachment) => [attachment.id, attachment]),
          );
          const stagedAttachmentById = new Map<string, PersistedComposerImageAttachment>();
          await Promise.all(
            composerImages.map(async (image) => {
              try {
                const dataUrl = await readFileAsDataUrl(image.file);
                stagedAttachmentById.set(image.id, {
                  id: image.id,
                  name: image.name,
                  mimeType: image.mimeType,
                  sizeBytes: image.sizeBytes,
                  dataUrl,
                });
              } catch {
                const existingPersisted = existingPersistedById.get(image.id);
                if (existingPersisted) {
                  stagedAttachmentById.set(image.id, existingPersisted);
                }
              }
            }),
          );
          const serialized = Array.from(stagedAttachmentById.values());
          if (cancelled) return;
          syncComposerDraftPersistedAttachments(composerDraftTarget, serialized);
        } catch {
          const currentImageIds = new Set(composerImages.map((image) => image.id));
          const fallbackPersistedAttachments = getPersistedAttachmentsForThread();
          const fallbackPersistedIds = fallbackPersistedAttachments
            .map((attachment) => attachment.id)
            .filter((id) => currentImageIds.has(id));
          const fallbackPersistedIdSet = new Set(fallbackPersistedIds);
          const fallbackAttachments = fallbackPersistedAttachments.filter((attachment) =>
            fallbackPersistedIdSet.has(attachment.id),
          );
          if (cancelled) return;
          syncComposerDraftPersistedAttachments(composerDraftTarget, fallbackAttachments);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [
      composerDraftTarget,
      clearComposerDraftPersistedAttachments,
      composerImages,
      getComposerDraft,
      syncComposerDraftPersistedAttachments,
    ]);

    // ------------------------------------------------------------------
    // Callbacks: prompt change
    // ------------------------------------------------------------------
    const onPromptChange = useCallback(
      (
        nextPrompt: string,
        nextCursor: number,
        expandedCursor: number,
        cursorAdjacentToMention: boolean,
        terminalContextIds: string[],
        nextPromptDoc: ComposerPromptDoc,
      ) => {
        if (activePendingProgress?.activeQuestion && pendingUserInputs.length > 0) {
          setComposerCursor(nextCursor);
          setComposerTrigger(
            cursorAdjacentToMention ? null : resolveComposerTrigger(nextPrompt, expandedCursor),
          );
          onChangeActivePendingUserInputCustomAnswer(
            activePendingProgress.activeQuestion.id,
            nextPrompt,
            nextCursor,
            expandedCursor,
            cursorAdjacentToMention,
          );
          return;
        }
        promptRef.current = nextPrompt;
        setPrompt(nextPrompt, nextPromptDoc);
        if (!terminalContextIdListsEqual(composerTerminalContexts, terminalContextIds)) {
          setComposerDraftTerminalContexts(
            composerDraftTarget,
            syncTerminalContextsByIds(composerTerminalContexts, terminalContextIds),
          );
        }
        setComposerCursor(nextCursor);
        setComposerTrigger(
          cursorAdjacentToMention ? null : resolveComposerTrigger(nextPrompt, expandedCursor),
        );
      },
      [
        activePendingProgress?.activeQuestion,
        pendingUserInputs.length,
        onChangeActivePendingUserInputCustomAnswer,
        promptRef,
        setPrompt,
        composerDraftTarget,
        composerTerminalContexts,
        resolveComposerTrigger,
        setComposerDraftTerminalContexts,
      ],
    );

    // ------------------------------------------------------------------
    // Callbacks: prompt replacement / menu
    // ------------------------------------------------------------------
    const applyPromptReplacement = useCallback(
      (
        rangeStart: number,
        rangeEnd: number,
        replacement: string,
        options?: { expectedText?: string; focusEditorAfterReplace?: boolean },
      ): boolean => {
        const currentText = promptRef.current;
        const safeStart = Math.max(0, Math.min(currentText.length, rangeStart));
        const safeEnd = Math.max(safeStart, Math.min(currentText.length, rangeEnd));
        if (
          options?.expectedText !== undefined &&
          currentText.slice(safeStart, safeEnd) !== options.expectedText
        ) {
          return false;
        }
        const next = replaceTextRange(promptRef.current, rangeStart, rangeEnd, replacement);
        const nextCursor = collapseExpandedComposerCursor(next.text, next.cursor);
        const nextExpandedCursor = expandCollapsedComposerCursor(next.text, nextCursor);
        promptRef.current = next.text;
        const activePendingQuestion = activePendingProgress?.activeQuestion;
        if (activePendingQuestion && activePendingUserInput) {
          onChangeActivePendingUserInputCustomAnswer(
            activePendingQuestion.id,
            next.text,
            nextCursor,
            nextExpandedCursor,
            false,
          );
        } else {
          setPrompt(next.text);
        }
        setComposerCursor(nextCursor);
        setComposerTrigger(resolveComposerTrigger(next.text, nextExpandedCursor));
        if (options?.focusEditorAfterReplace !== false) {
          window.requestAnimationFrame(() => {
            composerEditorRef.current?.focusAt(nextCursor);
          });
        }
        return true;
      },
      [
        activePendingProgress?.activeQuestion,
        activePendingUserInput,
        onChangeActivePendingUserInputCustomAnswer,
        promptRef,
        resolveComposerTrigger,
        setPrompt,
      ],
    );

    const applyPromptReplacementRef = useRef(applyPromptReplacement);
    applyPromptReplacementRef.current = applyPromptReplacement;

    useLayoutEffect(() => {
      if (isComposerApprovalState) return;
      if (composerTrigger?.kind !== "slash-model") return;
      const t = composerTrigger;
      const currentText = promptRef.current;
      const expectedSlice = currentText.slice(t.rangeStart, t.rangeEnd);
      const applied = applyPromptReplacementRef.current(t.rangeStart, t.rangeEnd, "", {
        expectedText: expectedSlice,
        focusEditorAfterReplace: true,
      });
      if (!applied) return;
      setComposerHighlightedItemId(null);
      setModelPickerOpenSearchSeed(t.query.trim());
      setIsComposerModelPickerOpen(true);
    }, [composerTrigger, isComposerApprovalState, promptRef]);

    const readComposerSnapshot = useCallback((): {
      value: string;
      cursor: number;
      expandedCursor: number;
      terminalContextIds: string[];
    } => {
      const editorSnapshot = composerEditorRef.current?.readSnapshot();
      if (editorSnapshot) {
        return editorSnapshot;
      }
      return {
        value: promptRef.current,
        cursor: composerCursor,
        expandedCursor: expandCollapsedComposerCursor(promptRef.current, composerCursor),
        terminalContextIds: composerTerminalContexts.map((context) => context.id),
      };
    }, [composerCursor, composerTerminalContexts, promptRef]);

    const resolveActiveComposerTrigger = useCallback((): {
      snapshot: { value: string; cursor: number; expandedCursor: number };
      trigger: ComposerTrigger | null;
    } => {
      const snapshot = readComposerSnapshot();
      return {
        snapshot,
        trigger: resolveComposerTrigger(snapshot.value, snapshot.expandedCursor),
      };
    }, [readComposerSnapshot, resolveComposerTrigger]);

    const dismissComposerCommandMenu = useCallback(() => {
      const snapshot = readComposerSnapshot();
      const trigger = detectComposerTrigger(snapshot.value, snapshot.expandedCursor);
      if (trigger) {
        dismissedComposerTriggerKeyRef.current = composerTriggerDismissKey(trigger);
      }
      setComposerTrigger(null);
      setComposerHighlightedItemId(null);
      setComposerHighlightedSearchKey(null);
    }, [composerTriggerDismissKey, readComposerSnapshot]);

    useEffect(() => {
      if (!composerMenuOpen) return;

      const onPointerDown = (event: PointerEvent) => {
        const form = composerFormRef.current;
        if (!form) return;
        if (event.target instanceof Node && form.contains(event.target)) return;
        dismissComposerCommandMenu();
      };

      document.addEventListener("pointerdown", onPointerDown, true);
      return () => {
        document.removeEventListener("pointerdown", onPointerDown, true);
      };
    }, [composerMenuOpen, dismissComposerCommandMenu]);

    const onSelectComposerItem = useCallback(
      (item: ComposerCommandItem) => {
        if (composerSelectLockRef.current) return;
        composerSelectLockRef.current = true;
        window.requestAnimationFrame(() => {
          composerSelectLockRef.current = false;
        });
        const { snapshot, trigger } = resolveActiveComposerTrigger();
        if (!trigger) return;
        if (item.type === "path") {
          const replacement = `@${item.path} `;
          const replacementRangeEnd = extendReplacementRangeForTrailingSpace(
            snapshot.value,
            trigger.rangeEnd,
            replacement,
          );
          const applied = applyPromptReplacement(
            trigger.rangeStart,
            replacementRangeEnd,
            replacement,
            { expectedText: snapshot.value.slice(trigger.rangeStart, replacementRangeEnd) },
          );
          if (applied) {
            setComposerHighlightedItemId(null);
          }
          return;
        }
        if (item.type === "slash-command") {
          if (item.command === "model") {
            const applied = applyPromptReplacement(trigger.rangeStart, trigger.rangeEnd, "", {
              expectedText: snapshot.value.slice(trigger.rangeStart, trigger.rangeEnd),
              focusEditorAfterReplace: false,
            });
            if (applied) {
              setComposerHighlightedItemId(null);
              setModelPickerOpenSearchSeed(undefined);
              setIsComposerModelPickerOpen(true);
            }
            return;
          }
          void handleInteractionModeChange(item.command === "plan" ? "plan" : "default");
          const applied = applyPromptReplacement(trigger.rangeStart, trigger.rangeEnd, "", {
            expectedText: snapshot.value.slice(trigger.rangeStart, trigger.rangeEnd),
          });
          if (applied) {
            setComposerHighlightedItemId(null);
          }
          return;
        }
        if (item.type === "provider-slash-command") {
          const replacement = `/${item.command.name} `;
          const replacementRangeEnd = extendReplacementRangeForTrailingSpace(
            snapshot.value,
            trigger.rangeEnd,
            replacement,
          );
          const applied =
            composerEditorRef.current?.replaceRangeWithCommand(
              trigger.rangeStart,
              replacementRangeEnd,
              {
                id: `provider-slash-command:${item.provider}:${item.command.name}`,
                name: item.command.name,
                content: item.command.description ?? item.command.input?.hint ?? null,
                type: "provider-slash-command",
              },
            ) ?? false;
          if (applied) {
            setComposerHighlightedItemId(null);
          }
          return;
        }
        if (item.type === "skill") {
          const replacement = `$${item.skill.name} `;
          const replacementRangeEnd = extendReplacementRangeForTrailingSpace(
            snapshot.value,
            trigger.rangeEnd,
            replacement,
          );
          const applied = applyPromptReplacement(
            trigger.rangeStart,
            replacementRangeEnd,
            replacement,
            { expectedText: snapshot.value.slice(trigger.rangeStart, replacementRangeEnd) },
          );
          if (applied) {
            setComposerHighlightedItemId(null);
          }
          return;
        }
      },
      [applyPromptReplacement, handleInteractionModeChange, resolveActiveComposerTrigger],
    );

    const onComposerMenuItemHighlighted = useCallback(
      (itemId: string | null) => {
        setComposerHighlightedItemId(itemId);
        setComposerHighlightedSearchKey(composerMenuSearchKey);
      },
      [composerMenuSearchKey],
    );

    const nudgeComposerMenuHighlight = useCallback(
      (key: "ArrowDown" | "ArrowUp") => {
        if (composerMenuItems.length === 0) return;
        const highlightedIndex = composerMenuItems.findIndex(
          (item) => item.id === composerHighlightedItemId,
        );
        const normalizedIndex =
          highlightedIndex >= 0 ? highlightedIndex : key === "ArrowDown" ? -1 : 0;
        const offset = key === "ArrowDown" ? 1 : -1;
        const nextIndex =
          (normalizedIndex + offset + composerMenuItems.length) % composerMenuItems.length;
        const nextItem = composerMenuItems[nextIndex];
        setComposerHighlightedItemId(nextItem?.id ?? null);
      },
      [composerHighlightedItemId, composerMenuItems],
    );

    // ------------------------------------------------------------------
    // Callbacks: command key
    // ------------------------------------------------------------------
    const onComposerCommandKey = (
      key: "ArrowDown" | "ArrowUp" | "Enter" | "Escape" | "Tab",
      event: KeyboardEvent,
    ) => {
      if (key === "Escape") {
        dismissComposerCommandMenu();
        return true;
      }

      const { trigger } = resolveActiveComposerTrigger();
      const menuIsActive = composerMenuOpenRef.current || trigger !== null;
      if (menuIsActive) {
        const currentItems = composerMenuItemsRef.current;
        const selectedItem = activeComposerMenuItemRef.current ?? currentItems[0];
        if (key === "ArrowDown" && currentItems.length > 0) {
          nudgeComposerMenuHighlight("ArrowDown");
          return true;
        }
        if (key === "ArrowUp" && currentItems.length > 0) {
          nudgeComposerMenuHighlight("ArrowUp");
          return true;
        }
        if ((key === "Enter" || (key === "Tab" && !event.shiftKey)) && selectedItem) {
          onSelectComposerItem(selectedItem);
          return true;
        }
      }
      if (key === "Enter" && !event.shiftKey) {
        void onSend();
        return true;
      }
      return false;
    };

    // ------------------------------------------------------------------
    // Callbacks: images
    // ------------------------------------------------------------------
    const addComposerImages = (files: File[]) => {
      if (!activeThreadId || files.length === 0) return;
      if (pendingUserInputs.length > 0) {
        toastManager.add({
          type: "error",
          title: "Attach images after answering plan questions.",
        });
        return;
      }
      const nextImages: ComposerImageAttachment[] = [];
      let nextImageCount = composerImagesRef.current.length;
      let error: string | null = null;
      for (const file of files) {
        if (!file.type.startsWith("image/")) {
          error = `Unsupported file type for '${file.name}'. Please attach image files only.`;
          continue;
        }
        if (file.size > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
          error = `'${file.name}' exceeds the ${IMAGE_SIZE_LIMIT_LABEL} attachment limit.`;
          continue;
        }
        if (nextImageCount >= PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
          error = `You can attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} images per message.`;
          break;
        }
        const previewUrl = URL.createObjectURL(file);
        nextImages.push({
          type: "image",
          id: randomUUID(),
          name: file.name || "image",
          mimeType: file.type,
          sizeBytes: file.size,
          previewUrl,
          file,
        });
        nextImageCount += 1;
      }
      if (nextImages.length === 1 && nextImages[0]) {
        addComposerImage(nextImages[0]);
      } else if (nextImages.length > 1) {
        addComposerImagesToDraft(nextImages);
      }
      setThreadError(activeThreadId, error);
    };

    const removeComposerImage = (imageId: string) => {
      removeComposerImageFromDraft(imageId);
    };

    // ------------------------------------------------------------------
    // Callbacks: paste / drag
    // ------------------------------------------------------------------
    const onComposerPaste = (event: React.ClipboardEvent<HTMLElement>) => {
      const files = Array.from(event.clipboardData.files);
      if (files.length === 0) return;
      const imageFiles = files.filter((file) => file.type.startsWith("image/"));
      if (imageFiles.length === 0) return;
      event.preventDefault();
      addComposerImages(imageFiles);
    };

    const onComposerDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      dragDepthRef.current += 1;
      setIsDragOverComposer(true);
    };

    const onComposerDragOver = (event: React.DragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setIsDragOverComposer(true);
    };

    const onComposerDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) {
        setIsDragOverComposer(false);
      }
    };

    const onComposerDrop = (event: React.DragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      dragDepthRef.current = 0;
      setIsDragOverComposer(false);
      const files = Array.from(event.dataTransfer.files);
      addComposerImages(files);
      focusComposer();
    };
    const onComposerImageInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.currentTarget.files ?? []);
      event.currentTarget.value = "";
      if (files.length === 0) return;
      addComposerImages(files);
      focusComposer();
    };
    const handleInterruptPrimaryAction = useCallback(() => {
      void onInterrupt();
    }, [onInterrupt]);
    const handleImplementPlanInNewThreadPrimaryAction = useCallback(() => {
      void onImplementPlanInNewThread();
    }, [onImplementPlanInNewThread]);

    // ------------------------------------------------------------------
    // Imperative handle
    // ------------------------------------------------------------------
    useImperativeHandle(
      ref,
      () => ({
        focusAtEnd: () => {
          composerEditorRef.current?.focusAtEnd();
        },
        focusAt: (cursor: number) => {
          composerEditorRef.current?.focusAt(cursor);
        },
        openModelPicker: () => {
          setModelPickerOpenSearchSeed(undefined);
          setIsComposerModelPickerOpen(true);
        },
        toggleModelPicker: () => {
          setModelPickerOpenSearchSeed(undefined);
          setIsComposerModelPickerOpen((open) => !open);
        },
        isModelPickerOpen: () => isComposerModelPickerOpen,
        readSnapshot: () => {
          return readComposerSnapshot();
        },
        resetCursorState: (options?: {
          cursor?: number;
          prompt?: string;
          detectTrigger?: boolean;
        }) => {
          const promptForState = options?.prompt ?? promptRef.current;
          const cursor = clampCollapsedComposerCursor(promptForState, options?.cursor ?? 0);
          setComposerHighlightedItemId(null);
          setComposerCursor(cursor);
          setComposerTrigger(
            options?.detectTrigger
              ? resolveComposerTrigger(
                  promptForState,
                  expandCollapsedComposerCursor(promptForState, cursor),
                )
              : null,
          );
        },
        addTerminalContext: (selection: TerminalContextSelection) => {
          if (!activeThread) return;
          const snapshot = composerEditorRef.current?.readSnapshot() ?? {
            value: promptRef.current,
            cursor: composerCursor,
            expandedCursor: expandCollapsedComposerCursor(promptRef.current, composerCursor),
            terminalContextIds: composerTerminalContexts.map((context) => context.id),
          };
          const insertion = insertInlineTerminalContextPlaceholder(
            snapshot.value,
            snapshot.expandedCursor,
          );
          const nextCollapsedCursor = collapseExpandedComposerCursor(
            insertion.prompt,
            insertion.cursor,
          );
          const inserted = insertComposerDraftTerminalContext(
            composerDraftTarget,
            insertion.prompt,
            {
              id: randomUUID(),
              threadId: activeThread.id,
              createdAt: new Date().toISOString(),
              ...selection,
            },
            insertion.contextIndex,
          );
          if (!inserted) return;
          promptRef.current = insertion.prompt;
          setComposerCursor(nextCollapsedCursor);
          setComposerTrigger(resolveComposerTrigger(insertion.prompt, insertion.cursor));
          window.requestAnimationFrame(() => {
            composerEditorRef.current?.focusAt(nextCollapsedCursor);
          });
        },
        getSendContext: () => {
          const submitData = composerEditorRef.current?.getSubmitData();
          return {
            prompt: submitData?.text ?? promptRef.current,
            promptDoc: submitData?.doc ?? composerPromptDoc,
            images: composerImagesRef.current,
            terminalContexts: composerTerminalContextsRef.current,
            selectedPromptEffort,
            selectedModelOptionsForDispatch,
            selectedModelSelection,
            selectedProvider,
            selectedModel: instanceCoherentSelectedModel,
            selectedProviderModels,
          };
        },
      }),
      [
        activeThread,
        composerDraftTarget,
        composerCursor,
        composerPromptDoc,
        composerTerminalContexts,
        insertComposerDraftTerminalContext,
        promptRef,
        composerImagesRef,
        composerTerminalContextsRef,
        isComposerModelPickerOpen,
        readComposerSnapshot,
        resolveComposerTrigger,
        instanceCoherentSelectedModel,
        selectedModelOptionsForDispatch,
        selectedModelSelection,
        selectedPromptEffort,
        selectedProvider,
        selectedProviderModels,
      ],
    );

    const promptInputHeaderContent = activePendingApproval ? (
      <ComposerPendingApprovalPanel
        approval={activePendingApproval}
        pendingCount={pendingApprovals.length}
      />
    ) : pendingUserInputs.length > 0 ? (
      <ComposerPendingUserInputPanel
        pendingUserInputs={pendingUserInputs}
        respondingRequestIds={respondingRequestIds}
        answers={activePendingDraftAnswers}
        questionIndex={activePendingQuestionIndex}
        onToggleOption={onSelectActivePendingUserInputOption}
        onAdvance={onAdvanceActivePendingUserInput}
      />
    ) : showPlanFollowUpPrompt && activeProposedPlan ? (
      <ComposerPlanFollowUpBanner
        key={activeProposedPlan.id}
        planTitle={proposedPlanTitle(activeProposedPlan.planMarkdown) ?? null}
      />
    ) : null;
    const showQueuedComposerItems =
      hasQueuedComposerItems && !isComposerApprovalState && pendingUserInputs.length === 0;

    // Render
    // ------------------------------------------------------------------
    return (
      <form
        ref={composerFormRef}
        onSubmit={onSend}
        className="mx-auto w-full min-w-0 max-w-composer"
        data-variant={composerVariant}
        data-chat-composer-form="true"
      >
        <PromptInputRoot
          className="agent-prompt-input-root mx-auto w-full min-w-0 max-w-composer"
          containerClassName={cn(
            "group chat-composer-shell w-full max-w-full min-w-0 overflow-hidden transition-[border-color,background-color] duration-200",
            composerMenuOpen && "overflow-visible!",
            composerProviderState.ultrathinkActive &&
              "animate-[ultrathink-rainbow_10s_linear_infinite] bg-[linear-gradient(120deg,oklch(0.712_0.181_22.839)_0%,oklch(0.769_0.165_70.08)_18%,oklch(0.723_0.192_149.579)_36%,oklch(0.704_0.123_182.503)_54%,oklch(0.623_0.188_259.815)_72%,oklch(0.656_0.212_354.308)_90%,oklch(0.712_0.181_22.839)_100%)] bg-[length:220%_220%]",
          )}
          containerProps={{
            onClick: handleComposerContainerClick,
            onDragEnter: onComposerDragEnter,
            onDragOver: onComposerDragOver,
            onDragLeave: onComposerDragLeave,
            onDrop: onComposerDrop,
          }}
          hasContent={composerSendState.hasSendableContent}
          hasImages={composerImages.length > 0}
          headerClassName="chat-composer-header"
          headerContent={promptInputHeaderContent}
          headerContentVisible={hasComposerHeader}
          isDragging={isDragOverComposer}
          isExpanded={isDockComposerExpanded}
          isMenuOpen={composerMenuOpen}
          isRunning={phase === "running"}
          modelPickerPlacement={modelPickerPlacement}
          plusMenuPlacement="bottom-start"
          slashMenuAnchor="cursor"
          slashMenuPlacement="top-start"
          slashMenuVariant="glass"
          submitOnCmdEnter={false}
          variant={composerVariant}
          onStop={handleInterruptPrimaryAction}
          onSubmit={() => {
            onSend();
          }}
        >
          <div
            className={cn(
              "chat-composer-surface relative min-w-0 overflow-visible transition-[background-color,box-shadow] duration-200",
              isDragOverComposer ? "bg-accent/30 ring-2 ring-primary/60 ring-offset-0" : "",
              composerProviderState.ultrathinkActive &&
                "shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset]",
            )}
          >
            {composerVariant === "compact" &&
            !isDockComposerExpanded &&
            !isComposerApprovalState ? (
              <>
                <input
                  ref={composerImageInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="sr-only"
                  tabIndex={-1}
                  onChange={onComposerImageInputChange}
                />
                <button
                  type="button"
                  className="ui-prompt-input-attachment-button flex h-(--multi-composer-compact-control-size) w-(--multi-composer-compact-control-size) shrink-0 items-center justify-center rounded-full text-multi-icon-tertiary transition-colors duration-150 hover:bg-multi-bg-tertiary hover:text-multi-icon-secondary disabled:pointer-events-none disabled:opacity-35"
                  aria-label="Attach images"
                  disabled={pendingUserInputs.length > 0 || isConnecting}
                  onClick={() => composerImageInputRef.current?.click()}
                >
                  <span className="relative size-3.5" aria-hidden="true">
                    <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 rounded bg-current" />
                    <span className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 rounded bg-current" />
                  </span>
                </button>
              </>
            ) : null}
            {showQueuedComposerItems ? (
              <QueuedComposerItemsPanel
                items={queuedComposerItems}
                editingItemId={editingQueuedComposerItemId}
                isBusy={isConnecting || isSendBusy}
                onBeginEdit={handleBeginEditQueuedComposerItem}
                onCancelEdit={handleCancelEditingQueuedComposerItem}
                onRemove={handleRemoveQueuedComposerItem}
                onSendNow={handleSendQueuedComposerItemNow}
              />
            ) : null}
            <div
              className={cn(
                "ui-prompt-input-editor relative select-text",
                composerVariant === "compact" && !isDockComposerExpanded
                  ? "min-h-0"
                  : "min-h-(--prompt-input-editor-min-height)",
              )}
              data-expanded={isDockComposerExpanded ? "" : undefined}
              data-variant={composerVariant}
            >
              {!isComposerApprovalState &&
                pendingUserInputs.length === 0 &&
                composerImages.length > 0 && (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {composerImages.map((image) => (
                      <div
                        key={image.id}
                        className="relative h-16 w-16 overflow-hidden rounded-lg border border-border/80 bg-background"
                      >
                        {image.previewUrl ? (
                          <button
                            type="button"
                            className="h-full w-full cursor-zoom-in"
                            aria-label={`Preview ${image.name}`}
                            onClick={() => {
                              const preview = buildExpandedImagePreview(composerImages, image.id);
                              if (!preview) return;
                              onExpandImage(preview);
                            }}
                          >
                            <img
                              src={image.previewUrl}
                              alt={image.name}
                              className="h-full w-full object-cover"
                            />
                          </button>
                        ) : (
                          <div className="flex h-full w-full items-center justify-center px-1 text-center text-caption text-muted-foreground/70">
                            {image.name}
                          </div>
                        )}
                        {nonPersistedComposerImageIdSet.has(image.id) && (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <span
                                  role="img"
                                  aria-label="Draft attachment may not persist"
                                  className="absolute left-1 top-1 inline-flex items-center justify-center rounded bg-background/85 p-0.5 text-amber-600"
                                >
                                  <IconExclamationCircle className="size-3" />
                                </span>
                              }
                            />
                            <TooltipPopup
                              side="top"
                              className="max-w-64 whitespace-normal leading-tight"
                            >
                              Draft attachment could not be saved locally and may be lost on
                              navigation.
                            </TooltipPopup>
                          </Tooltip>
                        )}
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="absolute right-1 top-1 bg-background/80 hover:bg-background/90"
                          onClick={() => removeComposerImage(image.id)}
                          aria-label={`Remove ${image.name}`}
                        >
                          <IconCrossMediumDefault />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

              <ComposerPromptEditor
                ref={composerEditorRef}
                value={
                  isComposerApprovalState
                    ? ""
                    : activePendingProgress
                      ? activePendingProgress.customAnswer
                      : prompt
                }
                cursor={composerCursor}
                terminalContexts={
                  !isComposerApprovalState && pendingUserInputs.length === 0
                    ? composerTerminalContexts
                    : []
                }
                doc={!isComposerApprovalState && !activePendingProgress ? composerPromptDoc : null}
                skills={selectedProviderStatus?.skills ?? []}
                onRemoveTerminalContext={removeComposerTerminalContextFromDraft}
                onMeasuredMultilineChange={setIsComposerEditorMultiline}
                onChange={onPromptChange}
                onCommandKeyDown={onComposerCommandKey}
                hotkeyTargetRef={composerEditorHotkeyRef}
                onPaste={onComposerPaste}
                placeholder={
                  isComposerApprovalState
                    ? (activePendingApproval?.detail ?? "Resolve this approval request to continue")
                    : activePendingProgress
                      ? "Type your own answer, or leave this blank to use the selected option"
                      : showPlanFollowUpPrompt && activeProposedPlan
                        ? "Add feedback to refine the plan, or leave this blank to implement it"
                        : isEditingQueuedComposerItem
                          ? "Editing queued message..."
                          : phase === "disconnected"
                            ? "Ask for follow-up changes or attach images"
                            : composerVariant === "compact"
                              ? "Send follow-up"
                              : "Ask anything, @tag files/folders, or use / to show available commands"
                }
                disabled={isConnecting || isComposerApprovalState}
              />
            </div>
            {composerMenuOpen && !isComposerApprovalState && (
              <div
                className={cn(
                  "ui-prompt-input__menu-popover absolute bottom-[calc(100%+var(--prompt-input-section-gap,8px))] left-0 z-[60] w-[min(var(--composer-menu-width),calc(100vw-32px))]",
                  composerMenuKind === "mentions"
                    ? "[--composer-menu-width:250px]"
                    : "[--composer-menu-width:320px]",
                )}
                data-menu-kind={composerMenuKind}
              >
                <ComposerCommandMenu
                  items={composerMenuItems}
                  resolvedTheme={resolvedTheme}
                  isLoading={isComposerMenuLoading}
                  ariaLabel={composerMenuAriaLabel}
                  menuKind={composerMenuKind}
                  triggerKind={composerTriggerKind}
                  groupSlashCommandSections={composerTrigger?.kind === "slash-command"}
                  emptyStateText={composerMenuEmptyState}
                  activeItemId={activeComposerMenuItem?.id ?? null}
                  onHighlightedItemChange={onComposerMenuItemHighlighted}
                  onSelect={onSelectComposerItem}
                />
              </div>
            )}
            <span className="ui-prompt-input__slash-menu-anchor" aria-hidden="true" />

            {/* Bottom toolbar */}
            {activePendingApproval ? (
              <PromptInputToolbar className="flex items-center justify-end gap-2 px-2.5 pb-2.5 sm:px-3 sm:pb-3">
                <ComposerPendingApprovalActions
                  requestId={activePendingApproval.requestId}
                  isResponding={respondingRequestIds.includes(activePendingApproval.requestId)}
                  onRespondToApproval={onRespondToApproval}
                />
              </PromptInputToolbar>
            ) : (
              <PromptInputToolbar
                data-chat-composer-footer="true"
                data-chat-composer-footer-compact={isComposerFooterCompact ? "true" : "false"}
                className={cn(
                  "flex min-w-0 flex-nowrap items-center justify-between gap-2 overflow-visible px-2.5 pb-2.5 sm:px-3 sm:pb-3",
                  isComposerFooterCompact ? "gap-1.5" : "gap-2 sm:gap-0",
                )}
              >
                <PromptInputToolbarLeft className="-m-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto p-1 scrollbar-none [&::-webkit-scrollbar]:hidden">
                  <span
                    className={cn(
                      "glass-model-picker-wrapper inline-flex min-w-0 max-w-(--agent-prompt-model-picker-max-width) overflow-hidden [--agent-prompt-model-picker-max-width:240px]",
                      isComposerFooterCompact && "[--agent-prompt-model-picker-max-width:200px]",
                    )}
                    data-compact-visible=""
                  >
                    <ProviderModelPicker
                      compact={isComposerFooterCompact}
                      {...(isComposerFooterCompact ? { triggerClassName: "mr-1" } : {})}
                      activeInstanceId={selectedInstanceId}
                      model={instanceCoherentSelectedModel}
                      instanceEntries={providerInstanceEntries}
                      keybindings={keybindings}
                      modelOptionsByInstance={modelOptionsByInstance}
                      terminalOpen={terminalOpen}
                      open={isComposerModelPickerOpen}
                      openSearchSeed={modelPickerOpenSearchSeed}
                      popoverPlacement={modelPickerPlacement}
                      {...(composerProviderState.ultrathinkActive
                        ? {
                            activeProviderIconClassName:
                              "animate-[ultrathink-chroma-shift_10s_linear_infinite]",
                          }
                        : {})}
                      onOpenChange={(open) => {
                        setIsComposerModelPickerOpen(open);
                        if (!open) {
                          setModelPickerOpenSearchSeed(undefined);
                        }
                      }}
                      onInstanceModelChange={onProviderModelSelect}
                    />
                  </span>

                  {isComposerFooterCompact ? (
                    <span className="inline-flex shrink-0" data-compact-visible="">
                      <CompactComposerControlsMenu
                        activePlan={showPlanSidebarToggle}
                        interactionMode={interactionMode}
                        planSidebarLabel={planSidebarLabel}
                        planSidebarOpen={planSidebarOpen}
                        runtimeMode={runtimeMode}
                        showInteractionModeToggle={
                          composerProviderControls.showInteractionModeToggle
                        }
                        traitsFastMenuContent={dockTraitsMenuFastSlot}
                        traitsRestMenuContent={dockTraitsMenuRestSlot}
                        onToggleInteractionMode={toggleInteractionMode}
                        onTogglePlanSidebar={togglePlanSidebar}
                        onRuntimeModeChange={handleRuntimeModeChange}
                      />
                    </span>
                  ) : (
                    <>
                      {providerTraitsPicker ? (
                        <>
                          <Separator
                            orientation="vertical"
                            className="mx-0.5 hidden h-4 sm:block"
                          />
                          {providerTraitsPicker}
                        </>
                      ) : null}
                      <ComposerFooterModeControls
                        showInteractionModeToggle={
                          composerProviderControls.showInteractionModeToggle
                        }
                        interactionMode={interactionMode}
                        runtimeMode={runtimeMode}
                        showPlanToggle={showPlanSidebarToggle}
                        planSidebarLabel={planSidebarLabel}
                        planSidebarOpen={planSidebarOpen}
                        onToggleInteractionMode={toggleInteractionMode}
                        onRuntimeModeChange={handleRuntimeModeChange}
                        onTogglePlanSidebar={togglePlanSidebar}
                      />
                    </>
                  )}
                </PromptInputToolbarLeft>

                {/* Right side: send / stop button */}
                <PromptInputToolbarRight
                  data-chat-composer-actions="right"
                  data-chat-composer-primary-actions-compact={
                    isComposerPrimaryActionsCompact ? "true" : "false"
                  }
                  className="flex shrink-0 flex-nowrap items-center justify-end gap-2"
                >
                  <ComposerFooterPrimaryActions
                    compact={isComposerPrimaryActionsCompact}
                    dockSingleRow={composerVariant === "compact" && !isDockComposerExpanded}
                    activeContextWindow={visibleContextWindow}
                    pendingAction={pendingPrimaryAction}
                    isRunning={phase === "running"}
                    showPlanFollowUpPrompt={
                      pendingUserInputs.length === 0 && showPlanFollowUpPrompt
                    }
                    promptHasText={prompt.trim().length > 0}
                    isSendBusy={isSendBusy}
                    isConnecting={isConnecting}
                    isPreparingWorktree={isPreparingWorktree}
                    submitDisabled={submitDisabled}
                    hasSendableContent={
                      composerSendState.hasSendableContent || canSubmitQueuedComposerItem
                    }
                    sendWhileStreamingBehavior={settings.agentWindowSendWhileStreamingBehavior}
                    submitActionLabel={
                      isEditingQueuedComposerItem ? "Save queued message" : undefined
                    }
                    onPreviousPendingQuestion={onPreviousActivePendingUserInputQuestion}
                    onInterrupt={handleInterruptPrimaryAction}
                    onImplementPlanInNewThread={handleImplementPlanInNewThreadPrimaryAction}
                  />
                </PromptInputToolbarRight>
              </PromptInputToolbar>
            )}
          </div>
        </PromptInputRoot>
      </form>
    );
  }),
);
