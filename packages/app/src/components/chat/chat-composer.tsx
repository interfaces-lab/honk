import type {
  ApprovalRequestId,
  EnvironmentId,
  ModelSelection,
  ProjectEntry,
  ProviderApprovalDecision,
  ProviderInteractionMode,
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
import { createModelSelection, normalizeModelSlug } from "@multi/shared/model";
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
} from "react";
import { useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { projectSearchEntriesQueryOptions } from "~/lib/project-react-query";
import {
  clampCollapsedComposerCursor,
  type ComposerTrigger,
  collapseExpandedComposerCursor,
  detectComposerTrigger,
  expandCollapsedComposerCursor,
  replaceTextRange,
} from "../../composer-logic";
import { deriveComposerSendState, readFileAsDataUrl } from "../chat-view.logic";
import {
  type ComposerImageAttachment,
  type DraftId,
  type PersistedComposerImageAttachment,
  useComposerDraftStore,
  useComposerThreadDraft,
  useEffectiveComposerModelState,
} from "../../composer-draft-store";
import {
  type TerminalContextDraft,
  type TerminalContextSelection,
  insertInlineTerminalContextPlaceholder,
  removeInlineTerminalContextPlaceholder,
} from "../../lib/terminal-context";
import type { ComposerPromptDoc } from "../../composer-prompt-doc";
import {
  shouldUseCompactComposerPrimaryActions,
  shouldUseCompactComposerFooter,
} from "../composer-footer-layout";
import { type ComposerPromptEditorHandle, ComposerPromptEditor } from "./composer-prompt-editor";
import { ProviderModelPicker } from "./provider-model-picker";
import { type ComposerCommandItem, ComposerCommandMenu } from "./composer-command-menu";
import {
  PromptInputRoot,
  PromptInputToolbar,
  PromptInputToolbarLeft,
  PromptInputToolbarRight,
} from "./prompt-input";
import { ComposerPendingApprovalActions } from "./composer-pending-approval-actions";
import { CompactComposerControlsMenu } from "./compact-composer-controls-menu";
import { ComposerPrimaryActions } from "./composer-primary-actions";
import { ComposerPendingApprovalPanel } from "./composer-pending-approval-panel";
import { ComposerPendingUserInputPanel } from "./composer-pending-user-input-panel";
import { ComposerPlanFollowUpBanner } from "./composer-plan-follow-up-banner";
import { resolveComposerMenuActiveItemId } from "./composer-menu-highlight";
import { searchSlashCommandItems } from "./composer-slash-command-search";
import {
  getComposerProviderState,
  renderProviderTraitsMenuContent,
  renderProviderTraitsPicker,
} from "./composer-provider-registry";
import { ContextWindowMeter } from "./context-window-meter";
import { buildExpandedImagePreview, type ExpandedImagePreview } from "./expanded-image-preview";
import { basenameOfPath } from "../../vscode-icons";
import { cn, randomUUID } from "~/lib/utils";
import { Separator } from "@multi/ui/separator";
import { Button } from "@multi/ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@multi/ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@multi/ui/tooltip";
import { toastManager } from "~/app/toast";
import {
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
import { proposedPlanTitle } from "../../proposed-plan";
import { getProviderInteractionModeToggle } from "../../provider-models";
import {
  deriveProviderInstanceEntries,
  resolveProviderDriverKindForInstanceSelection,
  sortProviderInstanceEntries,
  type ProviderInstanceEntry,
} from "../../provider-instances";
import { type AppModelOption, getAppModelOptionsForInstance } from "../../model-selection";
import type { UnifiedSettings } from "@multi/contracts/settings";
import type { SessionPhase, Thread } from "../../types";
import type { PendingUserInputDraftAnswer } from "../../pending-user-input";
import type { PendingApproval, PendingUserInput } from "../../session-logic";
import { deriveLatestContextWindowSnapshot } from "../../lib/context-window";
import { formatProviderSkillDisplayName } from "../../provider-skill-presentation";
import { searchProviderSkills } from "../../provider-skill-search";

const IMAGE_SIZE_LIMIT_LABEL = `${Math.round(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES / (1024 * 1024))}MB`;

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
        onPreviousPendingQuestion={props.onPreviousPendingQuestion}
        onInterrupt={props.onInterrupt}
        onImplementPlanInNewThread={props.onImplementPlanInNewThread}
      />
    </>
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
  lockedProvider: ProviderDriverKind | null;
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
      lockedProvider,
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
      toggleInteractionMode,
      handleRuntimeModeChange,
      handleInteractionModeChange,
      togglePlanSidebar,
      focusComposer,
      scheduleComposerFocus,
      setThreadError,
      onExpandImage,
    } = props;
    const composerVariant = variant === "hero" ? "expanded" : "compact";
    const modelPickerPlacement = "top-start";

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
    // Instance-aware projection of the wire provider list. One entry per
    // configured instance (default built-in + any custom `providerInstances.*`),
    // sorted default-first per driver kind for a stable picker order.
    const providerInstanceEntries = useMemo<ReadonlyArray<ProviderInstanceEntry>>(
      () => sortProviderInstanceEntries(deriveProviderInstanceEntries(providerStatuses)),
      [providerStatuses],
    );
    const selectedProviderByThreadId = composerDraft.activeProvider ?? null;
    const threadProvider =
      activeThread?.session?.providerInstanceId ??
      activeThreadModelSelection?.instanceId ??
      activeProjectDefaultModelSelection?.instanceId ??
      null;
    const explicitSelectedInstanceId = selectedProviderByThreadId ?? threadProvider;

    const unlockedSelectedProvider =
      resolveProviderDriverKindForInstanceSelection(
        providerInstanceEntries,
        providerStatuses,
        explicitSelectedInstanceId,
      ) ?? ProviderDriverKind.make("codex");
    const selectedProvider: ProviderDriverKind = lockedProvider ?? unlockedSelectedProvider;
    const lockedContinuationGroupKey = useMemo((): string | null => {
      if (!lockedProvider || !activeThread) return null;
      const lockedInstanceId =
        activeThread.session?.providerInstanceId ?? activeThreadModelSelection?.instanceId;
      if (!lockedInstanceId) return null;
      return (
        providerInstanceEntries.find((entry) => entry.instanceId === lockedInstanceId)
          ?.continuationGroupKey ?? null
      );
    }, [
      activeThread,
      activeThreadModelSelection?.instanceId,
      lockedProvider,
      providerInstanceEntries,
    ]);

    // Resolve which configured instance the composer is currently targeting.
    // Priority:
    //   1. The composer draft's `activeProvider` — the user's unsaved pick
    //      from the model picker (must win, otherwise the UI appears to
    //      ignore picker selections).
    //   2. Thread's persisted instance id (server-side saved selection).
    //   3. Project default's instance id.
    //   4. First enabled entry matching the current driver kind.
    //   5. First enabled entry overall / default instance for the kind.
    //
    const selectedInstanceId = useMemo<ProviderInstanceId>(() => {
      const candidates: Array<string | null | undefined> = [
        composerDraft.activeProvider,
        activeThread?.session?.providerInstanceId,
        activeThreadModelSelection?.instanceId,
        activeProjectDefaultModelSelection?.instanceId,
      ];
      for (const candidate of candidates) {
        if (!candidate) continue;
        const match = providerInstanceEntries.find(
          (entry) => entry.instanceId === candidate && entry.enabled,
        );
        if (match) {
          // When locked to a specific driver kind, ignore persisted instance
          // ids from a different kind or continuation group.
          if (lockedProvider && match.driverKind !== lockedProvider) continue;
          if (
            lockedContinuationGroupKey &&
            match.continuationGroupKey !== lockedContinuationGroupKey
          ) {
            continue;
          }
          return match.instanceId;
        }
      }
      if (explicitSelectedInstanceId) {
        return ProviderInstanceId.make(explicitSelectedInstanceId);
      }
      const byKind = providerInstanceEntries.find(
        (entry) =>
          entry.enabled &&
          entry.driverKind === selectedProvider &&
          (!lockedContinuationGroupKey ||
            entry.continuationGroupKey === lockedContinuationGroupKey),
      );
      if (byKind) return byKind.instanceId;
      const anyEnabled = providerInstanceEntries.find((entry) => entry.enabled);
      return (
        anyEnabled?.instanceId ??
        providerInstanceEntries[0]?.instanceId ??
        activeThreadModelSelection?.instanceId ??
        activeProjectDefaultModelSelection?.instanceId ??
        ProviderInstanceId.make("codex")
      );
    }, [
      activeProjectDefaultModelSelection?.instanceId,
      activeThread?.session?.providerInstanceId,
      activeThreadModelSelection?.instanceId,
      composerDraft.activeProvider,
      explicitSelectedInstanceId,
      lockedContinuationGroupKey,
      lockedProvider,
      providerInstanceEntries,
      selectedProvider,
    ]);

    const { modelOptions: composerModelOptions, selectedModel: derivedComposerModel } =
      useEffectiveComposerModelState({
        threadRef: composerDraftTarget,
        providers: providerStatuses,
        selectedProvider,
        selectedInstanceId,
        threadModelSelection: activeThreadModelSelection,
        projectModelSelection: activeProjectDefaultModelSelection,
        settings,
      });

    // Instance-keyed option list so the picker can show each configured
    // instance (built-in + custom) as a first-class sidebar entry. The
    // options are server-reported models plus that exact instance's
    // configured custom models; selected slugs are not injected into lists.
    const modelOptionsByInstance = useMemo<
      ReadonlyMap<ProviderInstanceId, ReadonlyArray<AppModelOption>>
    >(() => {
      const out = new Map<ProviderInstanceId, ReadonlyArray<AppModelOption>>();
      for (const entry of providerInstanceEntries) {
        out.set(entry.instanceId, getAppModelOptionsForInstance(settings, entry));
      }
      return out;
    }, [providerInstanceEntries, settings]);

    const instanceCoherentSelectedModel = useMemo(() => {
      const currentOptions = modelOptionsByInstance.get(selectedInstanceId) ?? [];
      const slugSet = new Set(currentOptions.map((option) => option.slug));
      if (slugSet.has(derivedComposerModel)) {
        return derivedComposerModel;
      }
      const normalized = normalizeModelSlug(derivedComposerModel, selectedProvider);
      if (normalized && slugSet.has(normalized)) {
        return normalized;
      }
      return currentOptions[0]?.slug ?? derivedComposerModel;
    }, [derivedComposerModel, modelOptionsByInstance, selectedInstanceId, selectedProvider]);

    // Resolve the active instance's snapshot by `instanceId` so a custom
    // instance gets its own slash commands, skills, and model list — not
    // the first snapshot for the same driver kind.
    const selectedProviderEntry = useMemo(
      () => providerInstanceEntries.find((entry) => entry.instanceId === selectedInstanceId),
      [providerInstanceEntries, selectedInstanceId],
    );
    const selectedProviderStatus = useMemo(
      () => selectedProviderEntry?.snapshot ?? null,
      [selectedProviderEntry],
    );
    const selectedProviderModels = useMemo<ReadonlyArray<ServerProvider["models"][number]>>(
      () => selectedProviderEntry?.models ?? [],
      [selectedProviderEntry],
    );

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
    const selectedModelSelection = useMemo<ModelSelection>(
      () =>
        createModelSelection(
          selectedInstanceId,
          instanceCoherentSelectedModel,
          selectedModelOptionsForDispatch,
        ),
      [selectedInstanceId, instanceCoherentSelectedModel, selectedModelOptionsForDispatch],
    );

    // ------------------------------------------------------------------
    // Context window
    // ------------------------------------------------------------------
    const activeContextWindow = useMemo(
      () => deriveLatestContextWindowSnapshot(activeThreadActivities ?? []),
      [activeThreadActivities],
    );

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
    const [modelPickerOpenSearchSeed, setModelPickerOpenSearchSeed] = useState<string | undefined>(
      undefined,
    );

    // ------------------------------------------------------------------
    // Refs
    // ------------------------------------------------------------------
    const composerEditorRef = useRef<ComposerPromptEditorHandle>(null);
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
        const query = composerTrigger.query.trim().toLowerCase();
        const slashCommandItems = [...builtInSlashCommandItems, ...providerSlashCommandItems];
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

    const nonPersistedComposerImageIdSet = useMemo(
      () => new Set(nonPersistedComposerImageIds),
      [nonPersistedComposerImageIds],
    );

    const isComposerApprovalState = activePendingApproval !== null;
    const activePendingUserInput = pendingUserInputs[0] ?? null;
    const hasComposerHeader =
      isComposerApprovalState ||
      pendingUserInputs.length > 0 ||
      (showPlanFollowUpPrompt && activeProposedPlan !== null);

    const isDockComposerExpanded =
      composerVariant === "compact" &&
      (hasComposerHeader || composerImages.length > 0 || activePendingProgress !== null);

    const composerFooterHasWideActions = showPlanFollowUpPrompt || activePendingProgress !== null;
    const showPlanSidebarToggle = Boolean(activePlan || sidebarProposedPlan || planSidebarOpen);
    const composerFooterActionLayoutKey = useMemo(() => {
      if (activePendingProgress) {
        return `pending:${activePendingProgress.questionIndex}:${activePendingProgress.isLastQuestion}:${activePendingIsResponding}`;
      }
      if (phase === "running") {
        return "running";
      }
      if (showPlanFollowUpPrompt) {
        return prompt.trim().length > 0 ? "plan:refine" : "plan:implement";
      }
      return `idle:${composerSendState.hasSendableContent}:${isSendBusy}:${isConnecting}:${isPreparingWorktree}`;
    }, [
      activePendingIsResponding,
      activePendingProgress,
      composerSendState.hasSendableContent,
      isConnecting,
      isPreparingWorktree,
      isSendBusy,
      phase,
      prompt,
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

    // Render
    // ------------------------------------------------------------------
    return (
      <form
        ref={composerFormRef}
        onSubmit={onSend}
        className="mx-auto w-full min-w-0 max-w-(--composer-max-width)"
        data-variant={composerVariant}
        data-chat-composer-form="true"
      >
        <PromptInputRoot
          className="agent-prompt-input-root w-full min-w-0"
          containerClassName={cn(
            "group chat-composer-shell w-full max-w-full min-w-0 overflow-hidden transition-[border-color,background-color] duration-200",
            composerMenuOpen && "overflow-visible!",
            composerProviderState.ultrathinkActive &&
              "animate-[ultrathink-rainbow_10s_linear_infinite] bg-[linear-gradient(120deg,oklch(0.712_0.181_22.839)_0%,oklch(0.769_0.165_70.08)_18%,oklch(0.723_0.192_149.579)_36%,oklch(0.704_0.123_182.503)_54%,oklch(0.623_0.188_259.815)_72%,oklch(0.656_0.212_354.308)_90%,oklch(0.712_0.181_22.839)_100%)] bg-[length:220%_220%]",
          )}
          containerProps={{
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
                          <div className="flex h-full w-full items-center justify-center px-1 text-center text-[10px] text-muted-foreground/70">
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
                onChange={onPromptChange}
                onCommandKeyDown={onComposerCommandKey}
                onPaste={onComposerPaste}
                placeholder={
                  isComposerApprovalState
                    ? (activePendingApproval?.detail ?? "Resolve this approval request to continue")
                    : activePendingProgress
                      ? "Type your own answer, or leave this blank to use the selected option"
                      : showPlanFollowUpPrompt && activeProposedPlan
                        ? "Add feedback to refine the plan, or leave this blank to implement it"
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
                    : "[--composer-menu-width:300px]",
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
                  groupSlashCommandSections={
                    composerTrigger?.kind === "slash-command" &&
                    composerTrigger.query.trim().length === 0
                  }
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
                <PromptInputToolbarLeft className="-m-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <span
                    className={cn(
                      "inline-flex min-w-0 max-w-(--agent-prompt-model-picker-max-width) overflow-hidden [--agent-prompt-model-picker-max-width:240px]",
                      isComposerFooterCompact && "[--agent-prompt-model-picker-max-width:200px]",
                    )}
                    data-compact-visible=""
                  >
                    <ProviderModelPicker
                      compact={isComposerFooterCompact}
                      {...(isComposerFooterCompact ? { triggerClassName: "mr-1" } : {})}
                      activeInstanceId={selectedInstanceId}
                      model={instanceCoherentSelectedModel}
                      lockedProvider={lockedProvider}
                      lockedContinuationGroupKey={lockedContinuationGroupKey}
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
                    activeContextWindow={activeContextWindow}
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
                    hasSendableContent={composerSendState.hasSendableContent}
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
