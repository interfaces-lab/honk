import {
  type ApprovalRequestId,
  DEFAULT_MODEL,
  defaultInstanceIdForDriver,
  type EnvironmentId,
  type MessageId,
  type ModelSelection,
  type ProjectScript,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProjectId,
  type ProviderApprovalDecision,
  type ServerProvider,
  type ScopedThreadRef,
  type ThreadId,
  type TurnId,
  type KeybindingCommand,
  OrchestrationThreadActivity,
  ProviderInteractionMode,
  RuntimeMode,
  TerminalOpenInput,
} from "@multi/contracts";
import {
  parseScopedThreadKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@multi/client-runtime";
import { projectScriptCwd, projectScriptRuntimeEnv } from "@multi/shared/project-scripts";
import { truncate } from "@multi/shared/String";
import { Debouncer } from "@tanstack/react-pacer";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useShallow } from "zustand/react/shallow";
import { useGitStatus } from "~/lib/git-status-state";
import { usePrimaryEnvironmentId } from "../../../environments/primary";
import { readEnvironmentApi } from "../../../environment-api";
import { isElectron } from "../../../env";
import { readLocalApi } from "../../../local-api";
import { parseDiffRouteSearch, stripDiffSearchParams } from "../../../diff-route-search";
import {
  collapseExpandedComposerCursor,
  parseStandaloneComposerSlashCommand,
} from "../../../composer-logic";
import {
  deriveCompletionDividerBeforeEntryId,
  derivePendingApprovals,
  derivePendingUserInputs,
  derivePhase,
  deriveTimelineEntries,
  deriveActiveWorkStartedAt,
  deriveActivePlanState,
  findSidebarProposedPlan,
  findLatestProposedPlan,
  deriveWorkLogEntries,
  hasActionableProposedPlan,
  hasToolActivityForTurn,
  isLatestTurnSettled,
  formatElapsed,
} from "../../../session-logic";
import {
  buildPendingUserInputAnswers,
  derivePendingUserInputProgress,
  setPendingUserInputCustomAnswer,
  togglePendingUserInputOptionSelection,
  type PendingUserInputDraftAnswer,
} from "../../../pending-user-input";
import { selectEnvironmentState, selectSidebarThreadsAcrossEnvironments, useStore } from "../../../store";
import { createProjectSelectorByRef, createThreadSelectorByRef } from "../../../store-selectors";
import { useUiStateStore } from "../../../ui-state-store";
import {
  buildPlanImplementationThreadTitle,
  buildPlanImplementationPrompt,
  resolvePlanFollowUpSubmission,
} from "../../../proposed-plan";
import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  DEFAULT_THREAD_TERMINAL_ID,
  MAX_TERMINALS_PER_GROUP,
  type ChatMessage,
  type SessionPhase,
  type Thread,
  type TurnDiffSummary,
} from "../../../types";
import { useTheme } from "../../../hooks/use-theme";
import { useTurnDiffSummaries } from "../../../hooks/use-turn-diff-summaries";
import { useCommandPaletteStore } from "../../../command-palette-store";
import { buildTemporaryWorktreeBranchName } from "@multi/shared/git";
import { resolveShortcutCommand, shortcutLabelForCommand } from "../../../keybindings";
import PlanSidebar from "../../plan-sidebar";
import ThreadTerminalDrawer from "../../thread-terminal-drawer";
import { cn, randomUUID } from "~/lib/utils";
import { toastManager } from "~/app/toast";
import { decodeProjectScriptKeybindingRule } from "~/lib/project-script-keybindings";
import { type NewProjectScriptInput } from "../../project-scripts-control";
import {
  commandForProjectScript,
  nextProjectScriptId,
  projectScriptIdFromCommand,
} from "~/project-scripts";
import { newCommandId, newDraftId, newMessageId, newThreadId } from "~/lib/utils";
import { resolveSelectableProvider } from "../../../provider-models";
import { useSettings } from "../../../hooks/use-settings";
import { resolveAppModelSelectionForInstance } from "../../../model-selection";
import { isTerminalFocused } from "../../../lib/terminal-focus";
import { deriveLogicalProjectKey } from "../../../logical-project";
import { useSavedEnvironmentRuntimeStore } from "../../../environments/runtime";
import { buildDraftThreadRouteParams, buildThreadRouteParams } from "../../../thread-routes";
import {
  type ComposerImageAttachment,
  type DraftThreadEnvMode,
  DraftId,
  useComposerDraftStore,
  useComposerThreadDraft,
  type DraftId as ComposerDraftId,
} from "../../../composer-draft-store";
import {
  useComposerQueueStore,
  type QueuedComposerItem,
  type QueuedComposerItemId,
} from "../../../composer-queue-store";
import {
  appendTerminalContextsToPrompt,
  formatTerminalContextLabel,
  type TerminalContextDraft,
  type TerminalContextSelection,
} from "../../../lib/terminal-context";
import { selectThreadTerminalState, useTerminalStateStore } from "../../../terminal-state-store";
import { shellPanelsActions } from "~/lib/shell-panels-store";
import {
  ChatComposer,
  type ChatComposerHandle,
  type ChatComposerProps,
} from "../composer/chat-composer";
import { ExpandedImageDialog } from "../message/expanded-image-dialog";
import { PullRequestThreadDialog } from "../../pull-request-thread-dialog";
import { MessagesTimeline, type MessagesTimelineController } from "../timeline/messages-timeline";
import { ChatHeader } from "./chat-header";
import { type ExpandedImagePreview } from "../message/expanded-image-preview";
import { resolveEffectiveEnvMode } from "../../../lib/branch-toolbar-logic";
import { ProviderStatusBanner } from "../picker/status-banner";
import { ThreadErrorBanner } from "../message/error-banner";
import {
  MAX_HIDDEN_MOUNTED_TERMINAL_THREADS,
  buildExpiredTerminalContextToastCopy,
  buildLocalDraftThread,
  collectUserMessageBlobPreviewUrls,
  createLocalDispatchSnapshot,
  deriveComposerSendState,
  formatOutgoingPrompt,
  hasServerAcknowledgedLocalDispatch,
  IMAGE_ONLY_BOOTSTRAP_PROMPT,
  LAST_INVOKED_SCRIPT_BY_PROJECT_KEY,
  LastInvokedScriptByProjectSchema,
  type LocalDispatchSnapshot,
  PullRequestDialogState,
  cloneComposerImageForRetry,
  readFileAsDataUrl,
  reconcileMountedTerminalThreadIds,
  resolveSendEnvMode,
  revokeBlobPreviewUrl,
  revokeUserMessagePreviewUrls,
  shouldWriteThreadErrorToCurrentServerThread,
  threadHasStarted,
  waitForStartedServerThread,
} from "./chat-view.logic";
import { useLocalStorage } from "~/hooks/use-local-storage";
import { useComposerHandleContext } from "../../../composer-handle-context";
import {
  useServerAvailableEditors,
  useServerConfig,
  useServerKeybindings,
} from "~/rpc/server-state";
import { sanitizeThreadErrorMessage } from "~/rpc/transport-error";
import { retainThreadDetailSubscription } from "../../../environments/runtime/service";
import { traceBrowserEvent } from "~/observability/browserDebug";
import {
  IconChevronDownSmall,
  IconChevronRight,
  IconFolderAddRight,
  IconFolderOpen,
  IconSettingsGear2,
  type CentralIconBaseProps,
} from "central-icons";
type CentralIconComponent = React.ComponentType<CentralIconBaseProps>;

const EMPTY_ACTIVITIES: OrchestrationThreadActivity[] = [];
const EMPTY_PROPOSED_PLANS: Thread["proposedPlans"] = [];
const EMPTY_PROVIDERS: ServerProvider[] = [];
const EMPTY_PENDING_APPROVALS: ChatComposerProps["pendingApprovals"] = [];
const EMPTY_PENDING_USER_INPUTS: ChatComposerProps["pendingUserInputs"] = [];
const EMPTY_PENDING_USER_INPUT_ANSWERS: Record<string, PendingUserInputDraftAnswer> = {};
const EMPTY_RESPONDING_REQUEST_IDS: ApprovalRequestId[] = [];
const EMPTY_QUEUED_COMPOSER_ITEMS: QueuedComposerItem[] = [];
const DOCKED_COMPOSER_TIMELINE_RESERVE_PX = 88;

type ChatComposerSendContext = ReturnType<ChatComposerHandle["getSendContext"]>;
type ComposerSendSnapshot = {
  sendContext: ChatComposerSendContext;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  planFollowUp: { planMarkdown: string } | null;
  clearComposerOnSubmit: boolean;
  messageId?: MessageId;
  createdAt?: string;
};
type InlineEditSubmitInput = {
  sendContext: ChatComposerSendContext;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
};

type HeroActionTone = "accent" | "blue" | "green";

const HERO_ICON_TONE_CLASS: Record<HeroActionTone, string> = {
  accent: "text-[var(--primary)]",
  blue: "text-[var(--multi-action)]",
  green: "text-[var(--success)]",
};

interface HeroComposerActionCardProps {
  title: string;
  detail: string;
  icon: CentralIconComponent;
  tone: HeroActionTone;
  onClick: () => void;
}

function HeroComposerActionCard(props: HeroComposerActionCardProps) {
  const Icon = props.icon;

  return (
    <button
      type="button"
      onClick={props.onClick}
      className="group flex h-20 min-h-20 select-none flex-col justify-between rounded-[8px] border border-multi-stroke-tertiary bg-multi-bg-elevated p-3 text-left text-multi-fg-primary shadow-none transition-colors hover:border-multi-stroke-secondary hover:bg-multi-bg-quaternary focus-visible:ring-1 focus-visible:ring-multi-stroke-focused focus-visible:outline-none"
    >
      <span className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-[7px] border border-multi-stroke-tertiary bg-multi-bg-tertiary",
            HERO_ICON_TONE_CLASS[props.tone],
          )}
        >
          <Icon className="size-3.5" />
        </span>
        <IconChevronRight className="size-4 shrink-0 text-multi-fg-tertiary transition-colors group-hover:text-multi-fg-primary" />
      </span>
      <span className="grid gap-0.5">
        <span className="truncate text-body/[1.25] font-medium">{props.title}</span>
        <span className="truncate text-detail/[1.3] text-multi-fg-secondary">{props.detail}</span>
      </span>
    </button>
  );
}

function HeroComposerActions(props: {
  activeProjectName: string | null;
  onAddProject: () => void;
  onOpenAppearance: () => void;
  onOpenProjects: () => void;
}) {
  return (
    <div className="mt-3 grid w-full select-none gap-2.5 sm:grid-cols-3">
      <HeroComposerActionCard
        title="Projects"
        detail={props.activeProjectName ?? "Browse projects"}
        icon={IconFolderOpen}
        tone="blue"
        onClick={props.onOpenProjects}
      />
      <HeroComposerActionCard
        title="Add project"
        detail="Choose a folder"
        icon={IconFolderAddRight}
        tone="green"
        onClick={props.onAddProject}
      />
      <HeroComposerActionCard
        title="Appearance"
        detail="Theme and accent"
        icon={IconSettingsGear2}
        tone="accent"
        onClick={props.onOpenAppearance}
      />
    </div>
  );
}

type ThreadPlanCatalogEntry = Pick<Thread, "id" | "proposedPlans">;

function useThreadPlanCatalog(threadIds: readonly ThreadId[]): ThreadPlanCatalogEntry[] {
  return useStore(
    useMemo(() => {
      let previousThreadIds: readonly ThreadId[] = [];
      let previousResult: ThreadPlanCatalogEntry[] = [];
      let previousEntries = new Map<
        ThreadId,
        {
          shell: object | null;
          proposedPlanIds: readonly string[] | undefined;
          proposedPlansById: Record<string, Thread["proposedPlans"][number]> | undefined;
          entry: ThreadPlanCatalogEntry;
        }
      >();

      return (state) => {
        const sameThreadIds =
          previousThreadIds.length === threadIds.length &&
          previousThreadIds.every((id, index) => id === threadIds[index]);
        const nextEntries = new Map<
          ThreadId,
          {
            shell: object | null;
            proposedPlanIds: readonly string[] | undefined;
            proposedPlansById: Record<string, Thread["proposedPlans"][number]> | undefined;
            entry: ThreadPlanCatalogEntry;
          }
        >();
        const nextResult: ThreadPlanCatalogEntry[] = [];
        let changed = !sameThreadIds;

        for (const threadId of threadIds) {
          let shell: object | undefined;
          let proposedPlanIds: readonly string[] | undefined;
          let proposedPlansById: Record<string, Thread["proposedPlans"][number]> | undefined;

          for (const environmentState of Object.values(state.environmentStateById)) {
            const matchedShell = environmentState.threadShellById[threadId];
            if (!matchedShell) {
              continue;
            }
            shell = matchedShell;
            proposedPlanIds = environmentState.proposedPlanIdsByThreadId[threadId];
            proposedPlansById = environmentState.proposedPlanByThreadId[threadId] as
              | Record<string, Thread["proposedPlans"][number]>
              | undefined;
            break;
          }

          if (!shell) {
            const previous = previousEntries.get(threadId);
            if (
              previous &&
              previous.shell === null &&
              previous.proposedPlanIds === undefined &&
              previous.proposedPlansById === undefined
            ) {
              nextEntries.set(threadId, previous);
              continue;
            }
            changed = true;
            nextEntries.set(threadId, {
              shell: null,
              proposedPlanIds: undefined,
              proposedPlansById: undefined,
              entry: { id: threadId, proposedPlans: EMPTY_PROPOSED_PLANS },
            });
            continue;
          }

          const previous = previousEntries.get(threadId);
          if (
            previous &&
            previous.shell === shell &&
            previous.proposedPlanIds === proposedPlanIds &&
            previous.proposedPlansById === proposedPlansById
          ) {
            nextEntries.set(threadId, previous);
            nextResult.push(previous.entry);
            continue;
          }

          changed = true;
          const proposedPlans =
            proposedPlanIds && proposedPlanIds.length > 0 && proposedPlansById
              ? proposedPlanIds.flatMap((planId) => {
                  const proposedPlan = proposedPlansById?.[planId];
                  return proposedPlan ? [proposedPlan] : [];
                })
              : EMPTY_PROPOSED_PLANS;
          const entry = { id: threadId, proposedPlans };
          nextEntries.set(threadId, {
            shell,
            proposedPlanIds,
            proposedPlansById,
            entry,
          });
          nextResult.push(entry);
        }

        if (!changed && previousResult.length === nextResult.length) {
          return previousResult;
        }

        previousThreadIds = threadIds;
        previousEntries = nextEntries;
        previousResult = nextResult;
        return nextResult;
      };
    }, [threadIds]),
  );
}

const SCRIPT_TERMINAL_COLS = 120;
const SCRIPT_TERMINAL_ROWS = 30;

type ChatViewProps =
  | {
      environmentId: EnvironmentId;
      threadId: ThreadId;
      reserveTitleBarControlInset?: boolean;
      routeKind: "server";
      draftId?: never;
    }
  | {
      environmentId: EnvironmentId;
      threadId: ThreadId;
      reserveTitleBarControlInset?: boolean;
      routeKind: "draft";
      draftId: ComposerDraftId;
    };

interface TerminalLaunchContext {
  threadId: ThreadId;
  cwd: string;
  worktreePath: string | null;
}

type PersistentTerminalLaunchContext = Pick<TerminalLaunchContext, "cwd" | "worktreePath">;

function useLocalDispatchState(input: {
  activeThread: Thread | undefined;
  activeLatestTurn: Thread["latestTurn"] | null;
  phase: SessionPhase;
  activePendingApproval: ApprovalRequestId | null;
  activePendingUserInput: ApprovalRequestId | null;
  threadError: string | null | undefined;
}) {
  const [localDispatch, setLocalDispatch] = useState<LocalDispatchSnapshot | null>(null);

  const beginLocalDispatch = useCallback(
    (options?: { preparingWorktree?: boolean }) => {
      const preparingWorktree = Boolean(options?.preparingWorktree);
      setLocalDispatch((current) => {
        if (current) {
          return current.preparingWorktree === preparingWorktree
            ? current
            : { ...current, preparingWorktree };
        }
        return createLocalDispatchSnapshot(input.activeThread, options);
      });
    },
    [input.activeThread],
  );

  const resetLocalDispatch = useCallback(() => {
    setLocalDispatch(null);
  }, []);

  const serverAcknowledgedLocalDispatch = useMemo(
    () =>
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: input.phase,
        latestTurn: input.activeLatestTurn,
        session: input.activeThread?.session ?? null,
        hasPendingApproval: input.activePendingApproval !== null,
        hasPendingUserInput: input.activePendingUserInput !== null,
        threadError: input.threadError,
      }),
    [
      input.activeLatestTurn,
      input.activePendingApproval,
      input.activePendingUserInput,
      input.activeThread?.session,
      input.phase,
      input.threadError,
      localDispatch,
    ],
  );

  useEffect(() => {
    if (!serverAcknowledgedLocalDispatch) {
      return;
    }
    resetLocalDispatch();
  }, [resetLocalDispatch, serverAcknowledgedLocalDispatch]);

  return {
    beginLocalDispatch,
    resetLocalDispatch,
    localDispatchStartedAt: localDispatch?.startedAt ?? null,
    isPreparingWorktree: localDispatch?.preparingWorktree ?? false,
    isSendBusy: localDispatch !== null && !serverAcknowledgedLocalDispatch,
  };
}

interface PersistentThreadTerminalDrawerProps {
  threadRef: { environmentId: EnvironmentId; threadId: ThreadId };
  threadId: ThreadId;
  visible: boolean;
  launchContext: PersistentTerminalLaunchContext | null;
  focusRequestId: number;
  splitShortcutLabel: string | undefined;
  newShortcutLabel: string | undefined;
  closeShortcutLabel: string | undefined;
  onAddTerminalContext: (selection: TerminalContextSelection) => void;
}

const PersistentThreadTerminalDrawer = memo(function PersistentThreadTerminalDrawer({
  threadRef,
  threadId,
  visible,
  launchContext,
  focusRequestId,
  splitShortcutLabel,
  newShortcutLabel,
  closeShortcutLabel,
  onAddTerminalContext,
}: PersistentThreadTerminalDrawerProps) {
  const serverThread = useStore(useMemo(() => createThreadSelectorByRef(threadRef), [threadRef]));
  const draftThread = useComposerDraftStore((store) => store.getDraftThreadByRef(threadRef));
  const projectRef = serverThread
    ? serverThread.projectId === null
      ? null
      : scopeProjectRef(serverThread.environmentId, serverThread.projectId)
    : draftThread
      ? draftThread.projectId === null
        ? null
        : scopeProjectRef(draftThread.environmentId, draftThread.projectId)
      : null;
  const project = useStore(useMemo(() => createProjectSelectorByRef(projectRef), [projectRef]));
  const terminalState = useTerminalStateStore((state) =>
    selectThreadTerminalState(state.terminalStateByThreadKey, threadRef),
  );
  const storeSetTerminalHeight = useTerminalStateStore((state) => state.setTerminalHeight);
  const storeSplitTerminal = useTerminalStateStore((state) => state.splitTerminal);
  const storeNewTerminal = useTerminalStateStore((state) => state.newTerminal);
  const storeSetActiveTerminal = useTerminalStateStore((state) => state.setActiveTerminal);
  const storeCloseTerminal = useTerminalStateStore((state) => state.closeTerminal);
  const [localFocusRequestId, setLocalFocusRequestId] = useState(0);
  const worktreePath = serverThread?.worktreePath ?? draftThread?.worktreePath ?? null;
  const effectiveWorktreePath = useMemo(() => {
    if (launchContext !== null) {
      return launchContext.worktreePath;
    }
    return worktreePath;
  }, [launchContext, worktreePath]);
  const cwd = useMemo(
    () =>
      launchContext?.cwd ??
      (project
        ? projectScriptCwd({
            project: { cwd: project.cwd },
            worktreePath: effectiveWorktreePath,
          })
        : null),
    [effectiveWorktreePath, launchContext?.cwd, project],
  );
  const runtimeEnv = useMemo(
    () =>
      project
        ? projectScriptRuntimeEnv({
            project: { cwd: project.cwd },
            worktreePath: effectiveWorktreePath,
          })
        : {},
    [effectiveWorktreePath, project],
  );

  const bumpFocusRequestId = useCallback(() => {
    if (!visible) {
      return;
    }
    setLocalFocusRequestId((value) => value + 1);
  }, [visible]);

  const setTerminalHeight = useCallback(
    (height: number) => {
      storeSetTerminalHeight(threadRef, height);
    },
    [storeSetTerminalHeight, threadRef],
  );

  const splitTerminal = useCallback(() => {
    storeSplitTerminal(threadRef, `terminal-${randomUUID()}`);
    bumpFocusRequestId();
  }, [bumpFocusRequestId, storeSplitTerminal, threadRef]);

  const createNewTerminal = useCallback(() => {
    storeNewTerminal(threadRef, `terminal-${randomUUID()}`);
    bumpFocusRequestId();
  }, [bumpFocusRequestId, storeNewTerminal, threadRef]);

  const activateTerminal = useCallback(
    (terminalId: string) => {
      storeSetActiveTerminal(threadRef, terminalId);
      bumpFocusRequestId();
    },
    [bumpFocusRequestId, storeSetActiveTerminal, threadRef],
  );

  const closeTerminal = useCallback(
    (terminalId: string) => {
      const api = readEnvironmentApi(threadRef.environmentId);
      if (!api) return;
      const isFinalTerminal = terminalState.terminalIds.length <= 1;
      const fallbackExitWrite = () =>
        api.terminal.write({ threadId, terminalId, data: "exit\n" }).catch(() => undefined);

      if ("close" in api.terminal && typeof api.terminal.close === "function") {
        void (async () => {
          if (isFinalTerminal) {
            await api.terminal.clear({ threadId, terminalId }).catch(() => undefined);
          }
          await api.terminal.close({
            threadId,
            terminalId,
            deleteHistory: true,
          });
        })().catch(() => fallbackExitWrite());
      } else {
        void fallbackExitWrite();
      }

      storeCloseTerminal(threadRef, terminalId);
      bumpFocusRequestId();
    },
    [bumpFocusRequestId, storeCloseTerminal, terminalState.terminalIds.length, threadId, threadRef],
  );

  const handleAddTerminalContext = useCallback(
    (selection: TerminalContextSelection) => {
      if (!visible) {
        return;
      }
      onAddTerminalContext(selection);
    },
    [onAddTerminalContext, visible],
  );

  if (!project || !terminalState.terminalOpen || !cwd) {
    return null;
  }

  return (
    <div className={visible ? undefined : "hidden"}>
      <ThreadTerminalDrawer
        threadRef={threadRef}
        threadId={threadId}
        cwd={cwd}
        worktreePath={effectiveWorktreePath}
        runtimeEnv={runtimeEnv}
        visible={visible}
        height={terminalState.terminalHeight}
        terminalIds={terminalState.terminalIds}
        activeTerminalId={terminalState.activeTerminalId}
        terminalGroups={terminalState.terminalGroups}
        activeTerminalGroupId={terminalState.activeTerminalGroupId}
        focusRequestId={focusRequestId + localFocusRequestId + (visible ? 1 : 0)}
        onSplitTerminal={splitTerminal}
        onNewTerminal={createNewTerminal}
        splitShortcutLabel={visible ? splitShortcutLabel : undefined}
        newShortcutLabel={visible ? newShortcutLabel : undefined}
        closeShortcutLabel={visible ? closeShortcutLabel : undefined}
        onActiveTerminalChange={activateTerminal}
        onCloseTerminal={closeTerminal}
        onHeightChange={setTerminalHeight}
        onAddTerminalContext={handleAddTerminalContext}
      />
    </div>
  );
});

type InlineMessageEditComposerProps = Pick<
  ChatComposerProps,
  | "environmentId"
  | "routeKind"
  | "routeThreadRef"
  | "draftId"
  | "activeThreadId"
  | "activeThreadEnvironmentId"
  | "activeThread"
  | "isServerThread"
  | "isLocalDraftThread"
  | "phase"
  | "isConnecting"
  | "isSendBusy"
  | "isPreparingWorktree"
  | "runtimeMode"
  | "interactionMode"
  | "providerStatuses"
  | "activeProjectDefaultModelSelection"
  | "activeThreadModelSelection"
  | "activeThreadActivities"
  | "resolvedTheme"
  | "settings"
  | "keybindings"
  | "terminalOpen"
  | "gitCwd"
  | "activePlan"
  | "sidebarProposedPlan"
  | "planSidebarLabel"
  | "planSidebarOpen"
  | "onInterrupt"
  | "onImplementPlanInNewThread"
  | "togglePlanSidebar"
  | "setThreadError"
  | "onExpandImage"
> & {
  composerDraftTarget: ComposerDraftId;
  message: ChatMessage;
  onCancelEditUserMessage: (messageId: MessageId) => void;
  onSubmitEditUserMessage: (messageId: MessageId, input: InlineEditSubmitInput) => Promise<boolean>;
};

const InlineMessageEditComposer = memo(function InlineMessageEditComposer({
  composerDraftTarget,
  message,
  onCancelEditUserMessage,
  onSubmitEditUserMessage,
  runtimeMode,
  interactionMode,
  providerStatuses,
  settings,
  ...composerProps
}: InlineMessageEditComposerProps) {
  const composerRef = useRef<ChatComposerHandle | null>(null);
  const editDraft = useComposerThreadDraft(composerDraftTarget);
  const promptRef = useRef(editDraft.prompt || message.text);
  const composerImagesRef = useRef<ComposerImageAttachment[]>(editDraft.images);
  const composerTerminalContextsRef = useRef<TerminalContextDraft[]>(editDraft.terminalContexts);
  const shouldAutoScrollRef = useRef(false);
  const setComposerDraftModelSelection = useComposerDraftStore((store) => store.setModelSelection);
  const setStickyComposerModelSelection = useComposerDraftStore(
    (store) => store.setStickyModelSelection,
  );
  const setComposerDraftRuntimeMode = useComposerDraftStore((store) => store.setRuntimeMode);
  const setComposerDraftInteractionMode = useComposerDraftStore(
    (store) => store.setInteractionMode,
  );
  const inlineRuntimeMode = editDraft.runtimeMode ?? runtimeMode;
  const inlineInteractionMode = editDraft.interactionMode ?? interactionMode;
  const submitState = deriveComposerSendState({
    prompt: editDraft.prompt,
    imageCount: editDraft.images.length,
    terminalContexts: editDraft.terminalContexts,
  });
  const submitDisabled =
    (editDraft.prompt === message.text &&
      editDraft.images.length === 0 &&
      submitState.sendableTerminalContexts.length === 0) ||
    !submitState.hasSendableContent;

  const focusComposer = useCallback(() => {
    composerRef.current?.focusAtEnd();
  }, []);

  const scheduleComposerFocus = useCallback(() => {
    window.requestAnimationFrame(() => {
      composerRef.current?.focusAtEnd();
    });
  }, []);

  const setInlineComposerRef = useCallback((composer: ChatComposerHandle | null) => {
    composerRef.current = composer;
    if (!composer) return;
    window.setTimeout(() => {
      composer.focusAtEnd();
    }, 0);
  }, []);

  const ignoreScheduleStickToBottom = useCallback(() => {}, []);
  const ignoreRespondToApproval = useCallback<
    ChatComposerProps["onRespondToApproval"]
  >(async () => {}, []);
  const ignoreSelectPendingUserInputOption = useCallback<
    ChatComposerProps["onSelectActivePendingUserInputOption"]
  >(() => {}, []);
  const ignoreAdvancePendingUserInput = useCallback<
    ChatComposerProps["onAdvanceActivePendingUserInput"]
  >(() => {}, []);
  const ignorePreviousPendingUserInput = useCallback<
    ChatComposerProps["onPreviousActivePendingUserInputQuestion"]
  >(() => {}, []);
  const ignoreChangePendingUserInputCustomAnswer = useCallback<
    ChatComposerProps["onChangeActivePendingUserInputCustomAnswer"]
  >(() => {}, []);

  const handleProviderModelSelect = useCallback(
    (instanceId: ProviderInstanceId, model: string) => {
      const resolvedModel = resolveAppModelSelectionForInstance(
        instanceId,
        settings,
        providerStatuses,
        model,
      );
      if (resolvedModel === null) {
        scheduleComposerFocus();
        return;
      }
      const nextModelSelection: ModelSelection = {
        instanceId,
        model: resolvedModel,
      };
      setComposerDraftModelSelection(composerDraftTarget, nextModelSelection);
      setStickyComposerModelSelection(nextModelSelection);
      scheduleComposerFocus();
    },
    [
      composerDraftTarget,
      providerStatuses,
      scheduleComposerFocus,
      setComposerDraftModelSelection,
      setStickyComposerModelSelection,
      settings,
    ],
  );

  const handleRuntimeModeChange = useCallback(
    (mode: RuntimeMode) => {
      if (mode === inlineRuntimeMode) return;
      setComposerDraftRuntimeMode(composerDraftTarget, mode);
      scheduleComposerFocus();
    },
    [composerDraftTarget, inlineRuntimeMode, scheduleComposerFocus, setComposerDraftRuntimeMode],
  );

  const handleInteractionModeChange = useCallback(
    (mode: ProviderInteractionMode) => {
      if (mode === inlineInteractionMode) return;
      setComposerDraftInteractionMode(composerDraftTarget, mode);
      scheduleComposerFocus();
    },
    [
      composerDraftTarget,
      inlineInteractionMode,
      scheduleComposerFocus,
      setComposerDraftInteractionMode,
    ],
  );

  const toggleInteractionMode = useCallback(() => {
    handleInteractionModeChange(inlineInteractionMode === "plan" ? "default" : "plan");
  }, [handleInteractionModeChange, inlineInteractionMode]);

  const handleCancel = useCallback(() => {
    onCancelEditUserMessage(message.id);
  }, [message.id, onCancelEditUserMessage]);

  const handleSend = useCallback<ChatComposerProps["onSend"]>(
    (event) => {
      event?.preventDefault();
      if (submitDisabled) {
        return;
      }
      const sendContext = composerRef.current?.getSendContext();
      if (!sendContext) {
        return;
      }
      void onSubmitEditUserMessage(message.id, {
        sendContext,
        runtimeMode: inlineRuntimeMode,
        interactionMode: inlineInteractionMode,
      });
    },
    [inlineInteractionMode, inlineRuntimeMode, message.id, onSubmitEditUserMessage, submitDisabled],
  );

  return (
    <div className="box-border w-full min-w-0 rounded-xl border border-multi-stroke-focused bg-multi-bubble p-2 shadow-xs">
      <ChatComposer
        {...composerProps}
        ref={setInlineComposerRef}
        variant="dock"
        modelPickerPlacement="bottom-start"
        composerDraftTarget={composerDraftTarget}
        runtimeMode={inlineRuntimeMode}
        interactionMode={inlineInteractionMode}
        providerStatuses={providerStatuses}
        settings={settings}
        activePendingApproval={null}
        pendingApprovals={EMPTY_PENDING_APPROVALS}
        pendingUserInputs={EMPTY_PENDING_USER_INPUTS}
        activePendingProgress={null}
        activePendingResolvedAnswers={null}
        activePendingIsResponding={false}
        activePendingDraftAnswers={EMPTY_PENDING_USER_INPUT_ANSWERS}
        activePendingQuestionIndex={0}
        respondingRequestIds={EMPTY_RESPONDING_REQUEST_IDS}
        showPlanFollowUpPrompt={false}
        activeProposedPlan={null}
        promptRef={promptRef}
        composerImagesRef={composerImagesRef}
        composerTerminalContextsRef={composerTerminalContextsRef}
        shouldAutoScrollRef={shouldAutoScrollRef}
        scheduleStickToBottom={ignoreScheduleStickToBottom}
        onSend={handleSend}
        onRespondToApproval={ignoreRespondToApproval}
        onSelectActivePendingUserInputOption={ignoreSelectPendingUserInputOption}
        onAdvanceActivePendingUserInput={ignoreAdvancePendingUserInput}
        onPreviousActivePendingUserInputQuestion={ignorePreviousPendingUserInput}
        onChangeActivePendingUserInputCustomAnswer={ignoreChangePendingUserInputCustomAnswer}
        onProviderModelSelect={handleProviderModelSelect}
        toggleInteractionMode={toggleInteractionMode}
        handleRuntimeModeChange={handleRuntimeModeChange}
        handleInteractionModeChange={handleInteractionModeChange}
        focusComposer={focusComposer}
        scheduleComposerFocus={scheduleComposerFocus}
        submitDisabled={submitDisabled}
      />
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          className="rounded-multi-control px-2 py-1 text-[12px]/[16px] text-multi-fg-secondary transition-colors hover:bg-multi-bg-quaternary hover:text-multi-fg-primary focus-visible:ring-1 focus-visible:ring-multi-stroke-focused focus-visible:outline-none"
          onClick={handleCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
});

export default function ChatView(props: ChatViewProps) {
  const { environmentId, threadId, routeKind, reserveTitleBarControlInset = true } = props;
  const draftId = routeKind === "draft" ? props.draftId : null;
  const routeThreadRef = useMemo(
    () => scopeThreadRef(environmentId, threadId),
    [environmentId, threadId],
  );
  const routeThreadKey = useMemo(() => scopedThreadKey(routeThreadRef), [routeThreadRef]);
  const editComposerDraftTarget = useMemo(
    () => DraftId.make(`inline-message-edit:${routeThreadKey}`),
    [routeThreadKey],
  );
  const composerDraftTarget: ScopedThreadRef | ComposerDraftId =
    routeKind === "server" ? routeThreadRef : props.draftId;
  const serverThread = useStore(
    useMemo(
      () => createThreadSelectorByRef(routeKind === "server" ? routeThreadRef : null),
      [routeKind, routeThreadRef],
    ),
  );
  const serverThreadDetailLoaded = useStore(
    useMemo(
      () => (store) => {
        if (routeKind !== "server") {
          return true;
        }
        const environmentState = selectEnvironmentState(store, environmentId);
        return Object.prototype.hasOwnProperty.call(
          environmentState.messageIdsByThreadId,
          threadId,
        );
      },
      [environmentId, routeKind, threadId],
    ),
  );
  const setStoreThreadError = useStore((store) => store.setError);
  const markThreadVisited = useUiStateStore((store) => store.markThreadVisited);
  const activeThreadLastVisitedAt = useUiStateStore((store) =>
    routeKind === "server" ? store.threadLastVisitedAtById[routeThreadKey] : undefined,
  );
  const settings = useSettings();
  const setStickyComposerModelSelection = useComposerDraftStore(
    (store) => store.setStickyModelSelection,
  );
  const timestampFormat = settings.timestampFormat;
  const navigate = useNavigate();
  const openAddProject = useCommandPaletteStore((store) => store.openAddProject);
  const openProject = useCommandPaletteStore((store) => store.openProject);
  const rawSearch = useSearch({
    strict: false,
    select: (params) => parseDiffRouteSearch(params),
  });
  const { resolvedTheme } = useTheme();
  // Granular store selectors — avoid subscribing to prompt changes.
  const composerRuntimeMode = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.runtimeMode ?? null,
  );
  const composerInteractionMode = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.interactionMode ?? null,
  );
  const composerActiveProvider = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.activeProvider ?? null,
  );
  const setComposerDraftPrompt = useComposerDraftStore((store) => store.setPrompt);
  const addComposerDraftImages = useComposerDraftStore((store) => store.addImages);
  const setComposerDraftTerminalContexts = useComposerDraftStore(
    (store) => store.setTerminalContexts,
  );
  const setComposerDraftModelSelection = useComposerDraftStore((store) => store.setModelSelection);
  const setComposerDraftRuntimeMode = useComposerDraftStore((store) => store.setRuntimeMode);
  const setComposerDraftInteractionMode = useComposerDraftStore(
    (store) => store.setInteractionMode,
  );
  const clearComposerDraftContent = useComposerDraftStore((store) => store.clearComposerContent);
  const markDraftThreadPromoting = useComposerDraftStore((store) => store.markDraftThreadPromoting);
  const cancelDraftThreadPromotion = useComposerDraftStore(
    (store) => store.cancelDraftThreadPromotion,
  );
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  const getDraftSessionByLogicalProjectKey = useComposerDraftStore(
    (store) => store.getDraftSessionByLogicalProjectKey,
  );
  const getDraftSession = useComposerDraftStore((store) => store.getDraftSession);
  const setLogicalProjectDraftThreadId = useComposerDraftStore(
    (store) => store.setLogicalProjectDraftThreadId,
  );
  const draftThread = useComposerDraftStore((store) =>
    routeKind === "server"
      ? store.getDraftSessionByRef(routeThreadRef)
      : draftId
        ? store.getDraftSession(draftId)
        : null,
  );
  const promptRef = useRef("");
  const composerImagesRef = useRef<ComposerImageAttachment[]>([]);
  const composerTerminalContextsRef = useRef<TerminalContextDraft[]>([]);
  const localComposerRef = useRef<ChatComposerHandle | null>(null);
  const composerRef = useComposerHandleContext() ?? localComposerRef;
  const [editingUserMessageId, setEditingUserMessageId] = useState<MessageId | null>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [expandedImage, setExpandedImage] = useState<ExpandedImagePreview | null>(null);
  const [optimisticUserMessages, setOptimisticUserMessages] = useState<ChatMessage[]>([]);
  const optimisticUserMessagesRef = useRef(optimisticUserMessages);
  optimisticUserMessagesRef.current = optimisticUserMessages;
  const [localDraftErrorsByDraftId, setLocalDraftErrorsByDraftId] = useState<
    Record<string, string | null>
  >({});
  const [isConnecting, _setIsConnecting] = useState(false);
  const [isRevertingCheckpoint, setIsRevertingCheckpoint] = useState(false);
  const [respondingRequestIds, setRespondingRequestIds] = useState<ApprovalRequestId[]>([]);
  const [respondingUserInputRequestIds, setRespondingUserInputRequestIds] = useState<
    ApprovalRequestId[]
  >([]);
  const [pendingUserInputAnswersByRequestId, setPendingUserInputAnswersByRequestId] = useState<
    Record<string, Record<string, PendingUserInputDraftAnswer>>
  >({});
  const [pendingUserInputQuestionIndexByRequestId, setPendingUserInputQuestionIndexByRequestId] =
    useState<Record<string, number>>({});
  const [planSidebarOpen, setPlanSidebarOpen] = useState(false);
  // Tracks whether the user explicitly dismissed the sidebar for the active turn.
  const planSidebarDismissedForTurnRef = useRef<string | null>(null);
  // When set, the thread-change reset effect will open the sidebar instead of closing it.
  // Used by "Implement in a new thread" to carry the sidebar-open intent across navigation.
  const planSidebarOpenOnNextThreadRef = useRef(false);
  const [terminalFocusRequestId, setTerminalFocusRequestId] = useState(0);
  const [pullRequestDialogState, setPullRequestDialogState] =
    useState<PullRequestDialogState | null>(null);
  const [terminalLaunchContext, setTerminalLaunchContext] = useState<TerminalLaunchContext | null>(
    null,
  );
  const [attachmentPreviewHandoffByMessageId, setAttachmentPreviewHandoffByMessageId] = useState<
    Record<string, string[]>
  >({});
  const [pendingServerThreadEnvMode, setPendingServerThreadEnvMode] =
    useState<DraftThreadEnvMode | null>(null);
  const [pendingServerThreadBranch, setPendingServerThreadBranch] = useState<string | null>();
  const [lastInvokedScriptByProjectId, setLastInvokedScriptByProjectId] = useLocalStorage(
    LAST_INVOKED_SCRIPT_BY_PROJECT_KEY,
    {},
    LastInvokedScriptByProjectSchema,
  );
  const messagesTimelineControllerRef = useRef<MessagesTimelineController | null>(null);
  const isAtBottomRef = useRef(true);
  const attachmentPreviewHandoffByMessageIdRef = useRef<Record<string, string[]>>({});
  const attachmentPreviewPromotionInFlightByMessageIdRef = useRef<Record<string, true>>({});
  const sendInFlightRef = useRef(false);
  const terminalOpenByThreadRef = useRef<Record<string, boolean>>({});

  const terminalState = useTerminalStateStore((state) =>
    selectThreadTerminalState(state.terminalStateByThreadKey, routeThreadRef),
  );
  const openTerminalThreadKeys = useTerminalStateStore(
    useShallow((state) =>
      Object.entries(state.terminalStateByThreadKey).flatMap(([nextThreadKey, nextTerminalState]) =>
        nextTerminalState.terminalOpen ? [nextThreadKey] : [],
      ),
    ),
  );
  const storeSetTerminalOpen = useTerminalStateStore((s) => s.setTerminalOpen);
  const storeSplitTerminal = useTerminalStateStore((s) => s.splitTerminal);
  const storeNewTerminal = useTerminalStateStore((s) => s.newTerminal);
  const storeSetActiveTerminal = useTerminalStateStore((s) => s.setActiveTerminal);
  const storeCloseTerminal = useTerminalStateStore((s) => s.closeTerminal);
  const serverThreadKeys = useStore(
    useShallow((state) =>
      selectSidebarThreadsAcrossEnvironments(state).map((thread) =>
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      ),
    ),
  );
  const storeServerTerminalLaunchContext = useTerminalStateStore(
    (s) => s.terminalLaunchContextByThreadKey[scopedThreadKey(routeThreadRef)] ?? null,
  );
  const storeClearTerminalLaunchContext = useTerminalStateStore(
    (s) => s.clearTerminalLaunchContext,
  );
  const draftThreadsByThreadKey = useComposerDraftStore((store) => store.draftThreadsByThreadKey);
  const draftThreadKeys = useMemo(
    () =>
      Object.values(draftThreadsByThreadKey).map((draftThread) =>
        scopedThreadKey(scopeThreadRef(draftThread.environmentId, draftThread.threadId)),
      ),
    [draftThreadsByThreadKey],
  );
  const [mountedTerminalThreadKeys, setMountedTerminalThreadKeys] = useState<string[]>([]);
  const mountedTerminalThreadRefs = useMemo(
    () =>
      mountedTerminalThreadKeys.flatMap((mountedThreadKey) => {
        const mountedThreadRef = parseScopedThreadKey(mountedThreadKey);
        return mountedThreadRef ? [{ key: mountedThreadKey, threadRef: mountedThreadRef }] : [];
      }),
    [mountedTerminalThreadKeys],
  );

  const fallbackDraftProjectRef = draftThread
    ? draftThread.projectId === null
      ? null
      : scopeProjectRef(draftThread.environmentId, draftThread.projectId)
    : null;
  const fallbackDraftProject = useStore(
    useMemo(() => createProjectSelectorByRef(fallbackDraftProjectRef), [fallbackDraftProjectRef]),
  );
  const localDraftError =
    routeKind === "server" && serverThread
      ? null
      : ((draftId ? localDraftErrorsByDraftId[draftId] : null) ?? null);
  const localDraftThread = useMemo(
    () =>
      draftThread
        ? buildLocalDraftThread(
            threadId,
            draftThread,
            fallbackDraftProject?.defaultModelSelection ?? {
              instanceId: defaultInstanceIdForDriver(ProviderDriverKind.make("codex")),
              model: DEFAULT_MODEL,
            },
            localDraftError,
          )
        : undefined,
    [draftThread, fallbackDraftProject?.defaultModelSelection, localDraftError, threadId],
  );
  const isServerThread = routeKind === "server" && serverThread !== undefined;
  const activeThread = isServerThread ? serverThread : localDraftThread;
  const showTimelineEmptyState = !isServerThread || serverThreadDetailLoaded;
  const runtimeMode = composerRuntimeMode ?? activeThread?.runtimeMode ?? DEFAULT_RUNTIME_MODE;
  const interactionMode =
    composerInteractionMode ?? activeThread?.interactionMode ?? DEFAULT_INTERACTION_MODE;
  const isLocalDraftThread = !isServerThread && localDraftThread !== undefined;
  const diffOpen = rawSearch.diff === "1";
  const activeThreadId = activeThread?.id ?? null;
  const activeThreadRef = useMemo(
    () => (activeThread ? scopeThreadRef(activeThread.environmentId, activeThread.id) : null),
    [activeThread],
  );
  const activeThreadKey = activeThreadRef ? scopedThreadKey(activeThreadRef) : null;
  const existingOpenTerminalThreadKeys = useMemo(() => {
    const existingThreadKeys = new Set<string>([...serverThreadKeys, ...draftThreadKeys]);
    return openTerminalThreadKeys.filter((nextThreadKey) => existingThreadKeys.has(nextThreadKey));
  }, [draftThreadKeys, openTerminalThreadKeys, serverThreadKeys]);
  const activeLatestTurn = activeThread?.latestTurn ?? null;
  const threadPlanCatalog = useThreadPlanCatalog(
    useMemo(() => {
      const threadIds: ThreadId[] = [];
      if (activeThread?.id) {
        threadIds.push(activeThread.id);
      }
      const sourceThreadId = activeLatestTurn?.sourceProposedPlan?.threadId;
      if (sourceThreadId && sourceThreadId !== activeThread?.id) {
        threadIds.push(sourceThreadId);
      }
      return threadIds;
    }, [activeLatestTurn?.sourceProposedPlan?.threadId, activeThread?.id]),
  );
  useEffect(() => {
    setMountedTerminalThreadKeys((currentThreadIds) => {
      const nextThreadIds = reconcileMountedTerminalThreadIds({
        currentThreadIds,
        openThreadIds: existingOpenTerminalThreadKeys,
        activeThreadId: activeThreadKey,
        activeThreadTerminalOpen: Boolean(activeThreadKey && terminalState.terminalOpen),
        maxHiddenThreadCount: MAX_HIDDEN_MOUNTED_TERMINAL_THREADS,
      });
      return currentThreadIds.length === nextThreadIds.length &&
        currentThreadIds.every((nextThreadId, index) => nextThreadId === nextThreadIds[index])
        ? currentThreadIds
        : nextThreadIds;
    });
  }, [activeThreadKey, existingOpenTerminalThreadKeys, terminalState.terminalOpen]);
  const latestTurnSettled = isLatestTurnSettled(activeLatestTurn, activeThread?.session ?? null);
  const activeProjectRef = activeThread
    ? activeThread.projectId === null
      ? null
      : scopeProjectRef(activeThread.environmentId, activeThread.projectId)
    : null;
  const activeProject = useStore(
    useMemo(() => createProjectSelectorByRef(activeProjectRef), [activeProjectRef]),
  );
  const openAppearanceSettings = useCallback(() => {
    void navigate({ to: "/settings/appearance" });
  }, [navigate]);

  useEffect(() => {
    if (routeKind !== "server") {
      return;
    }
    return retainThreadDetailSubscription(environmentId, threadId);
  }, [environmentId, routeKind, threadId]);

  const primaryEnvironmentId = usePrimaryEnvironmentId();

  const closePullRequestDialog = useCallback(() => {
    setPullRequestDialogState(null);
  }, []);

  const openOrReuseProjectDraftThread = useCallback(
    async (input: { branch: string; worktreePath: string | null; envMode: DraftThreadEnvMode }) => {
      if (!activeProject) {
        throw new Error("No active project is available for this pull request.");
      }
      const activeProjectRef = scopeProjectRef(activeProject.environmentId, activeProject.id);
      const logicalProjectKey = deriveLogicalProjectKey(activeProject);
      const storedDraftSession = getDraftSessionByLogicalProjectKey(logicalProjectKey);
      if (storedDraftSession) {
        setDraftThreadContext(storedDraftSession.draftId, input);
        setLogicalProjectDraftThreadId(
          logicalProjectKey,
          activeProjectRef,
          storedDraftSession.draftId,
          {
            threadId: storedDraftSession.threadId,
            ...input,
          },
        );
        if (routeKind !== "draft" || draftId !== storedDraftSession.draftId) {
          await navigate({
            to: "/draft/$draftId",
            params: buildDraftThreadRouteParams(storedDraftSession.draftId),
          });
        }
        return storedDraftSession.threadId;
      }

      const activeDraftSession = routeKind === "draft" && draftId ? getDraftSession(draftId) : null;
      if (
        !isServerThread &&
        activeDraftSession?.logicalProjectKey === logicalProjectKey &&
        draftId
      ) {
        setDraftThreadContext(draftId, input);
        setLogicalProjectDraftThreadId(logicalProjectKey, activeProjectRef, draftId, {
          threadId: activeDraftSession.threadId,
          createdAt: activeDraftSession.createdAt,
          runtimeMode: activeDraftSession.runtimeMode,
          interactionMode: activeDraftSession.interactionMode,
          ...input,
        });
        return activeDraftSession.threadId;
      }

      const nextDraftId = newDraftId();
      const nextThreadId = newThreadId();
      setLogicalProjectDraftThreadId(logicalProjectKey, activeProjectRef, nextDraftId, {
        threadId: nextThreadId,
        createdAt: new Date().toISOString(),
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_INTERACTION_MODE,
        ...input,
      });
      await navigate({
        to: "/draft/$draftId",
        params: buildDraftThreadRouteParams(nextDraftId),
      });
      return nextThreadId;
    },
    [
      activeProject,
      draftId,
      getDraftSession,
      getDraftSessionByLogicalProjectKey,
      isServerThread,
      navigate,
      routeKind,
      setDraftThreadContext,
      setLogicalProjectDraftThreadId,
    ],
  );

  const handlePreparedPullRequestThread = useCallback(
    async (input: { branch: string; worktreePath: string | null }) => {
      await openOrReuseProjectDraftThread({
        branch: input.branch,
        worktreePath: input.worktreePath,
        envMode: input.worktreePath ? "worktree" : "local",
      });
    },
    [openOrReuseProjectDraftThread],
  );

  useEffect(() => {
    if (!serverThread?.id) return;
    if (!latestTurnSettled) return;
    if (!activeLatestTurn?.completedAt) return;
    const turnCompletedAt = Date.parse(activeLatestTurn.completedAt);
    if (Number.isNaN(turnCompletedAt)) return;
    const lastVisitedAt = activeThreadLastVisitedAt ? Date.parse(activeThreadLastVisitedAt) : NaN;
    if (!Number.isNaN(lastVisitedAt) && lastVisitedAt >= turnCompletedAt) return;

    markThreadVisited(scopedThreadKey(scopeThreadRef(serverThread.environmentId, serverThread.id)));
  }, [
    activeLatestTurn?.completedAt,
    activeThreadLastVisitedAt,
    latestTurnSettled,
    markThreadVisited,
    serverThread?.environmentId,
    serverThread?.id,
  ]);

  const selectedProviderByThreadId = composerActiveProvider ?? null;
  const threadProvider =
    activeThread?.modelSelection.instanceId ??
    activeProject?.defaultModelSelection?.instanceId ??
    null;
  const primaryServerConfig = useServerConfig();
  const providerConfigEnvironmentId =
    routeKind === "server" ? environmentId : (draftThread?.environmentId ?? environmentId);
  const activeEnvRuntimeState = useSavedEnvironmentRuntimeStore((s) =>
    providerConfigEnvironmentId ? s.byId[providerConfigEnvironmentId] : null,
  );
  // Use the server config for the thread's environment.  For the primary
  // environment fall back to the global atom; for remote environments use
  // the runtime state stored by the environment manager.
  const serverConfig =
    primaryEnvironmentId && providerConfigEnvironmentId === primaryEnvironmentId
      ? primaryServerConfig
      : (activeEnvRuntimeState?.serverConfig ?? primaryServerConfig);
  const providerStatuses = serverConfig?.providers ?? EMPTY_PROVIDERS;
  const selectedProvider = resolveSelectableProvider(
    providerStatuses,
    selectedProviderByThreadId ?? threadProvider ?? ProviderInstanceId.make("codex"),
  );
  const phase = derivePhase(activeThread?.session ?? null);
  const threadActivities = activeThread?.activities ?? EMPTY_ACTIVITIES;
  const activeRunningTurnId =
    activeThread?.session?.orchestrationStatus === "running"
      ? (activeThread.session.activeTurnId ?? activeLatestTurn?.turnId ?? null)
      : null;
  const workLogEntries = useMemo(
    () =>
      deriveWorkLogEntries(threadActivities, undefined, {
        activeRunningTurnId,
      }),
    [activeRunningTurnId, threadActivities],
  );
  const latestTurnHasToolActivity = useMemo(
    () => hasToolActivityForTurn(threadActivities, activeLatestTurn?.turnId),
    [activeLatestTurn?.turnId, threadActivities],
  );
  const pendingApprovals = useMemo(
    () => derivePendingApprovals(threadActivities),
    [threadActivities],
  );
  const pendingUserInputs = useMemo(
    () => derivePendingUserInputs(threadActivities),
    [threadActivities],
  );
  const activePendingUserInput = pendingUserInputs[0] ?? null;
  const activePendingDraftAnswers = useMemo(
    () =>
      activePendingUserInput
        ? (pendingUserInputAnswersByRequestId[activePendingUserInput.requestId] ??
          EMPTY_PENDING_USER_INPUT_ANSWERS)
        : EMPTY_PENDING_USER_INPUT_ANSWERS,
    [activePendingUserInput, pendingUserInputAnswersByRequestId],
  );
  const activePendingQuestionIndex = activePendingUserInput
    ? (pendingUserInputQuestionIndexByRequestId[activePendingUserInput.requestId] ?? 0)
    : 0;
  const activePendingProgress = useMemo(
    () =>
      activePendingUserInput
        ? derivePendingUserInputProgress(
            activePendingUserInput.questions,
            activePendingDraftAnswers,
            activePendingQuestionIndex,
          )
        : null,
    [activePendingDraftAnswers, activePendingQuestionIndex, activePendingUserInput],
  );
  const activePendingResolvedAnswers = useMemo(
    () =>
      activePendingUserInput
        ? buildPendingUserInputAnswers(activePendingUserInput.questions, activePendingDraftAnswers)
        : null,
    [activePendingDraftAnswers, activePendingUserInput],
  );
  const activePendingIsResponding = activePendingUserInput
    ? respondingUserInputRequestIds.includes(activePendingUserInput.requestId)
    : false;
  const activeProposedPlan = useMemo(() => {
    if (!latestTurnSettled) {
      return null;
    }
    return findLatestProposedPlan(
      activeThread?.proposedPlans ?? [],
      activeLatestTurn?.turnId ?? null,
    );
  }, [activeLatestTurn?.turnId, activeThread?.proposedPlans, latestTurnSettled]);
  const sidebarProposedPlan = useMemo(
    () =>
      findSidebarProposedPlan({
        threads: threadPlanCatalog,
        latestTurn: activeLatestTurn,
        latestTurnSettled,
        threadId: activeThread?.id ?? null,
      }),
    [activeLatestTurn, activeThread?.id, latestTurnSettled, threadPlanCatalog],
  );
  const activePlan = useMemo(
    () => deriveActivePlanState(threadActivities, activeLatestTurn?.turnId ?? undefined),
    [activeLatestTurn?.turnId, threadActivities],
  );
  const planSidebarLabel = sidebarProposedPlan || interactionMode === "plan" ? "Plan" : "Tasks";
  const showPlanFollowUpPrompt =
    pendingUserInputs.length === 0 &&
    interactionMode === "plan" &&
    latestTurnSettled &&
    hasActionableProposedPlan(activeProposedPlan);
  const activePendingApproval = pendingApprovals[0] ?? null;
  const {
    beginLocalDispatch,
    resetLocalDispatch,
    localDispatchStartedAt,
    isPreparingWorktree,
    isSendBusy,
  } = useLocalDispatchState({
    activeThread,
    activeLatestTurn,
    phase,
    activePendingApproval: activePendingApproval?.requestId ?? null,
    activePendingUserInput: activePendingUserInput?.requestId ?? null,
    threadError: activeThread?.error,
  });
  const isWorking = phase === "running" || isSendBusy || isConnecting || isRevertingCheckpoint;
  const queuedComposerItems = useComposerQueueStore(
    (store) => store.queueItemsByThreadKey[routeThreadKey] ?? EMPTY_QUEUED_COMPOSER_ITEMS,
  );
  const editingQueuedComposerItemId = useComposerQueueStore(
    (store) => store.editingQueueItemIdByThreadKey[routeThreadKey] ?? null,
  );
  const enqueueComposerItem = useComposerQueueStore((store) => store.enqueueComposerItem);
  const removeQueuedComposerItem = useComposerQueueStore((store) => store.removeQueuedComposerItem);
  const takeQueuedComposerItem = useComposerQueueStore((store) => store.takeQueuedComposerItem);
  const beginEditingQueuedComposerItem = useComposerQueueStore(
    (store) => store.beginEditingQueuedComposerItem,
  );
  const cancelEditingQueuedComposerItem = useComposerQueueStore(
    (store) => store.cancelEditingQueuedComposerItem,
  );
  const replaceEditingQueuedComposerItem = useComposerQueueStore(
    (store) => store.replaceEditingQueuedComposerItem,
  );
  const activeWorkStartedAt = deriveActiveWorkStartedAt(
    activeLatestTurn,
    activeThread?.session ?? null,
    localDispatchStartedAt,
  );
  useEffect(() => {
    attachmentPreviewHandoffByMessageIdRef.current = attachmentPreviewHandoffByMessageId;
  }, [attachmentPreviewHandoffByMessageId]);
  const clearAttachmentPreviewHandoff = useCallback(
    (messageId: MessageId, previewUrls?: ReadonlyArray<string>) => {
      delete attachmentPreviewPromotionInFlightByMessageIdRef.current[messageId];
      const currentPreviewUrls =
        previewUrls ?? attachmentPreviewHandoffByMessageIdRef.current[messageId] ?? [];
      setAttachmentPreviewHandoffByMessageId((existing) => {
        if (!(messageId in existing)) {
          return existing;
        }
        const next = { ...existing };
        delete next[messageId];
        attachmentPreviewHandoffByMessageIdRef.current = next;
        return next;
      });
      for (const previewUrl of currentPreviewUrls) {
        revokeBlobPreviewUrl(previewUrl);
      }
    },
    [],
  );
  const clearAttachmentPreviewHandoffs = useCallback(() => {
    attachmentPreviewPromotionInFlightByMessageIdRef.current = {};
    for (const previewUrls of Object.values(attachmentPreviewHandoffByMessageIdRef.current)) {
      for (const previewUrl of previewUrls) {
        revokeBlobPreviewUrl(previewUrl);
      }
    }
    attachmentPreviewHandoffByMessageIdRef.current = {};
    setAttachmentPreviewHandoffByMessageId({});
  }, []);
  useEffect(() => {
    return () => {
      clearAttachmentPreviewHandoffs();
      for (const message of optimisticUserMessagesRef.current) {
        revokeUserMessagePreviewUrls(message);
      }
    };
  }, [clearAttachmentPreviewHandoffs]);
  const handoffAttachmentPreviews = useCallback((messageId: MessageId, previewUrls: string[]) => {
    if (previewUrls.length === 0) return;

    const previousPreviewUrls = attachmentPreviewHandoffByMessageIdRef.current[messageId] ?? [];
    for (const previewUrl of previousPreviewUrls) {
      if (!previewUrls.includes(previewUrl)) {
        revokeBlobPreviewUrl(previewUrl);
      }
    }
    setAttachmentPreviewHandoffByMessageId((existing) => {
      const next = {
        ...existing,
        [messageId]: previewUrls,
      };
      attachmentPreviewHandoffByMessageIdRef.current = next;
      return next;
    });
  }, []);
  const serverMessages = activeThread?.messages;
  useEffect(() => {
    if (typeof Image === "undefined" || !serverMessages || serverMessages.length === 0) {
      return;
    }

    const cleanups: Array<() => void> = [];

    for (const [messageId, handoffPreviewUrls] of Object.entries(
      attachmentPreviewHandoffByMessageId,
    )) {
      if (attachmentPreviewPromotionInFlightByMessageIdRef.current[messageId]) {
        continue;
      }

      const serverMessage = serverMessages.find(
        (message) => message.id === messageId && message.role === "user",
      );
      if (!serverMessage?.attachments || serverMessage.attachments.length === 0) {
        continue;
      }

      const serverPreviewUrls = serverMessage.attachments.flatMap((attachment) =>
        attachment.type === "image" && attachment.previewUrl ? [attachment.previewUrl] : [],
      );
      if (
        serverPreviewUrls.length === 0 ||
        serverPreviewUrls.length !== handoffPreviewUrls.length ||
        serverPreviewUrls.some((previewUrl) => previewUrl.startsWith("blob:"))
      ) {
        continue;
      }

      attachmentPreviewPromotionInFlightByMessageIdRef.current[messageId] = true;

      let cancelled = false;
      const imageInstances: HTMLImageElement[] = [];

      const preloadServerPreviews = Promise.all(
        serverPreviewUrls.map(
          (previewUrl) =>
            new Promise<void>((resolve, reject) => {
              const image = new Image();
              imageInstances.push(image);
              const handleLoad = () => resolve();
              const handleError = () =>
                reject(new Error(`Failed to load server preview for ${messageId}.`));
              image.addEventListener("load", handleLoad, { once: true });
              image.addEventListener("error", handleError, { once: true });
              image.src = previewUrl;
            }),
        ),
      );

      void preloadServerPreviews
        .then(() => {
          if (cancelled) {
            return;
          }
          clearAttachmentPreviewHandoff(messageId as MessageId, handoffPreviewUrls);
        })
        .catch(() => {
          if (!cancelled) {
            delete attachmentPreviewPromotionInFlightByMessageIdRef.current[messageId];
          }
        });

      cleanups.push(() => {
        cancelled = true;
        delete attachmentPreviewPromotionInFlightByMessageIdRef.current[messageId];
        for (const image of imageInstances) {
          image.src = "";
        }
      });
    }

    return () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  }, [attachmentPreviewHandoffByMessageId, clearAttachmentPreviewHandoff, serverMessages]);
  const timelineMessages = useMemo(() => {
    const messages = serverMessages ?? [];
    const serverMessagesWithPreviewHandoff =
      Object.keys(attachmentPreviewHandoffByMessageId).length === 0
        ? messages
        : // Spread only fires for the few messages that actually changed;
          // unchanged ones early-return their original reference.
          // In-place mutation would break React's immutable state contract.
          // oxlint-disable-next-line no-map-spread
          messages.map((message) => {
            if (
              message.role !== "user" ||
              !message.attachments ||
              message.attachments.length === 0
            ) {
              return message;
            }
            const handoffPreviewUrls = attachmentPreviewHandoffByMessageId[message.id];
            if (!handoffPreviewUrls || handoffPreviewUrls.length === 0) {
              return message;
            }

            let changed = false;
            let imageIndex = 0;
            const attachments = message.attachments.map((attachment) => {
              if (attachment.type !== "image") {
                return attachment;
              }
              const handoffPreviewUrl = handoffPreviewUrls[imageIndex];
              imageIndex += 1;
              if (!handoffPreviewUrl || attachment.previewUrl === handoffPreviewUrl) {
                return attachment;
              }
              changed = true;
              return {
                ...attachment,
                previewUrl: handoffPreviewUrl,
              };
            });

            return changed ? { ...message, attachments } : message;
          });

    if (optimisticUserMessages.length === 0) {
      return serverMessagesWithPreviewHandoff;
    }
    const serverIds = new Set(serverMessagesWithPreviewHandoff.map((message) => message.id));
    const pendingMessages = optimisticUserMessages.filter((message) => !serverIds.has(message.id));
    if (pendingMessages.length === 0) {
      return serverMessagesWithPreviewHandoff;
    }
    return [...serverMessagesWithPreviewHandoff, ...pendingMessages];
  }, [serverMessages, attachmentPreviewHandoffByMessageId, optimisticUserMessages]);
  const activeEditingUserMessageId =
    editingUserMessageId &&
    timelineMessages.some(
      (message) => message.id === editingUserMessageId && message.role === "user",
    )
      ? editingUserMessageId
      : null;
  const timelineEntries = useMemo(
    () =>
      deriveTimelineEntries(timelineMessages, activeThread?.proposedPlans ?? [], workLogEntries),
    [activeThread?.proposedPlans, timelineMessages, workLogEntries],
  );
  const { turnDiffSummaries, inferredCheckpointTurnCountByTurnId } =
    useTurnDiffSummaries(activeThread);
  const turnDiffSummaryByAssistantMessageId = useMemo(() => {
    const byMessageId = new Map<MessageId, TurnDiffSummary>();
    for (const summary of turnDiffSummaries) {
      if (!summary.assistantMessageId) continue;
      byMessageId.set(summary.assistantMessageId, summary);
    }
    return byMessageId;
  }, [turnDiffSummaries]);
  const revertTurnCountByUserMessageId = useMemo(() => {
    const byUserMessageId = new Map<MessageId, number>();
    for (let index = 0; index < timelineEntries.length; index += 1) {
      const entry = timelineEntries[index];
      if (!entry || entry.kind !== "message" || entry.message.role !== "user") {
        continue;
      }

      for (let nextIndex = index + 1; nextIndex < timelineEntries.length; nextIndex += 1) {
        const nextEntry = timelineEntries[nextIndex];
        if (!nextEntry || nextEntry.kind !== "message") {
          continue;
        }
        if (nextEntry.message.role === "user") {
          break;
        }
        const summary = turnDiffSummaryByAssistantMessageId.get(nextEntry.message.id);
        if (!summary) {
          continue;
        }
        const turnCount =
          summary.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[summary.turnId];
        if (typeof turnCount !== "number") {
          break;
        }
        byUserMessageId.set(entry.message.id, Math.max(0, turnCount - 1));
        break;
      }
    }

    return byUserMessageId;
  }, [inferredCheckpointTurnCountByTurnId, timelineEntries, turnDiffSummaryByAssistantMessageId]);

  const onBeginEditUserMessage = useCallback(
    (messageId: MessageId) => {
      if (!isServerThread) {
        return;
      }
      const msg = timelineMessages.find((entry) => entry.id === messageId && entry.role === "user");
      if (!msg) {
        return;
      }

      clearComposerDraftContent(editComposerDraftTarget);
      setComposerDraftPrompt(editComposerDraftTarget, msg.text, null);
      setEditingUserMessageId(messageId);
    },
    [
      clearComposerDraftContent,
      editComposerDraftTarget,
      isServerThread,
      setComposerDraftPrompt,
      timelineMessages,
    ],
  );

  const onCancelEditUserMessage = useCallback(
    (messageId: MessageId) => {
      setEditingUserMessageId((current) => (current === messageId ? null : current));
      clearComposerDraftContent(editComposerDraftTarget);
    },
    [clearComposerDraftContent, editComposerDraftTarget],
  );

  const completionSummary = useMemo(() => {
    if (!latestTurnSettled) return null;
    if (!activeLatestTurn?.startedAt) return null;
    if (!activeLatestTurn.completedAt) return null;
    if (!latestTurnHasToolActivity) return null;

    const elapsed = formatElapsed(activeLatestTurn.startedAt, activeLatestTurn.completedAt);
    return elapsed ? `Worked for ${elapsed}` : null;
  }, [
    activeLatestTurn?.completedAt,
    activeLatestTurn?.startedAt,
    latestTurnHasToolActivity,
    latestTurnSettled,
  ]);
  const completionDividerBeforeEntryId = useMemo(() => {
    if (!latestTurnSettled) return null;
    if (!completionSummary) return null;
    return deriveCompletionDividerBeforeEntryId(timelineEntries, activeLatestTurn);
  }, [activeLatestTurn, completionSummary, latestTurnSettled, timelineEntries]);
  const gitCwd = activeProject
    ? projectScriptCwd({
        project: { cwd: activeProject.cwd },
        worktreePath: activeThread?.worktreePath ?? null,
      })
    : null;
  const gitStatusQuery = useGitStatus({ environmentId, cwd: gitCwd });
  const keybindings = useServerKeybindings();
  const availableEditors = useServerAvailableEditors();
  const activeProviderStatus = useMemo(
    () => providerStatuses.find((status) => status.driver === selectedProvider) ?? null,
    [selectedProvider, providerStatuses],
  );
  const activeProjectCwd = activeProject?.cwd ?? null;
  const activeThreadWorktreePath = activeThread?.worktreePath ?? null;
  const activeProjectRoot = activeThreadWorktreePath ?? activeProjectCwd ?? undefined;
  const activeTerminalLaunchContext =
    terminalLaunchContext?.threadId === activeThreadId
      ? terminalLaunchContext
      : (storeServerTerminalLaunchContext ?? null);
  // Default true while loading to avoid toolbar flicker.
  const isGitRepo = gitStatusQuery.data?.isRepo ?? true;
  const terminalShortcutLabelOptions = useMemo(
    () => ({
      context: {
        terminalFocus: true,
        terminalOpen: Boolean(terminalState.terminalOpen),
      },
    }),
    [terminalState.terminalOpen],
  );
  const nonTerminalShortcutLabelOptions = useMemo(
    () => ({
      context: {
        terminalFocus: false,
        terminalOpen: Boolean(terminalState.terminalOpen),
      },
    }),
    [terminalState.terminalOpen],
  );
  const terminalToggleShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "terminal.toggle"),
    [keybindings],
  );
  const splitTerminalShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "terminal.split", terminalShortcutLabelOptions),
    [keybindings, terminalShortcutLabelOptions],
  );
  const newTerminalShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "terminal.new", terminalShortcutLabelOptions),
    [keybindings, terminalShortcutLabelOptions],
  );
  const closeTerminalShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "terminal.close", terminalShortcutLabelOptions),
    [keybindings, terminalShortcutLabelOptions],
  );
  const diffPanelShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "diff.toggle", nonTerminalShortcutLabelOptions),
    [keybindings, nonTerminalShortcutLabelOptions],
  );
  const openGitWorkbench = useCallback(() => {
    if (!isElectron) {
      return;
    }
    shellPanelsActions.setActiveTab("git");
    shellPanelsActions.setMuted(false);
  }, []);
  const onToggleDiff = useCallback(() => {
    if (!isServerThread) {
      return;
    }
    if (!diffOpen) {
      openGitWorkbench();
    }
    void navigate({
      to: "/$environmentId/$threadId",
      params: {
        environmentId,
        threadId,
      },
      replace: true,
      search: (previous) => {
        const rest = stripDiffSearchParams(previous);
        return diffOpen ? { ...rest, diff: undefined } : { ...rest, diff: "1", workbench: "git" };
      },
    });
  }, [diffOpen, environmentId, isServerThread, navigate, openGitWorkbench, threadId]);

  const envLocked = Boolean(
    activeThread &&
    (activeThread.messages.length > 0 ||
      (activeThread.session !== null && activeThread.session.status !== "closed")),
  );

  const activeTerminalGroup =
    terminalState.terminalGroups.find(
      (group) => group.id === terminalState.activeTerminalGroupId,
    ) ??
    terminalState.terminalGroups.find((group) =>
      group.terminalIds.includes(terminalState.activeTerminalId),
    ) ??
    null;
  const hasReachedSplitLimit =
    (activeTerminalGroup?.terminalIds.length ?? 0) >= MAX_TERMINALS_PER_GROUP;
  const setThreadError = useCallback(
    (targetThreadId: ThreadId | null, error: string | null) => {
      if (!targetThreadId) return;
      const nextError = sanitizeThreadErrorMessage(error);
      const isCurrentServerThread = shouldWriteThreadErrorToCurrentServerThread({
        serverThread,
        routeThreadRef,
        targetThreadId,
      });
      if (isCurrentServerThread) {
        setStoreThreadError(targetThreadId, nextError);
        return;
      }
      const localDraftErrorKey = draftId ?? targetThreadId;
      setLocalDraftErrorsByDraftId((existing) => {
        if ((existing[localDraftErrorKey] ?? null) === nextError) {
          return existing;
        }
        return {
          ...existing,
          [localDraftErrorKey]: nextError,
        };
      });
    },
    [draftId, routeThreadRef, serverThread, setStoreThreadError],
  );

  const focusComposer = useCallback(() => {
    composerRef.current?.focusAtEnd();
  }, [composerRef]);
  const scheduleComposerFocus = useCallback(() => {
    window.requestAnimationFrame(() => {
      focusComposer();
    });
  }, [focusComposer]);
  const addTerminalContextToDraft = useCallback(
    (selection: TerminalContextSelection) => {
      composerRef.current?.addTerminalContext(selection);
    },
    [composerRef],
  );
  const setTerminalOpen = useCallback(
    (open: boolean) => {
      if (!activeThreadRef) return;
      storeSetTerminalOpen(activeThreadRef, open);
    },
    [activeThreadRef, storeSetTerminalOpen],
  );
  const toggleTerminalVisibility = useCallback(() => {
    if (!activeThreadRef) return;
    setTerminalOpen(!terminalState.terminalOpen);
  }, [activeThreadRef, setTerminalOpen, terminalState.terminalOpen]);
  const splitTerminal = useCallback(() => {
    if (!activeThreadRef || hasReachedSplitLimit) return;
    const terminalId = `terminal-${randomUUID()}`;
    storeSplitTerminal(activeThreadRef, terminalId);
    setTerminalFocusRequestId((value) => value + 1);
  }, [activeThreadRef, hasReachedSplitLimit, storeSplitTerminal]);
  const createNewTerminal = useCallback(() => {
    if (!activeThreadRef) return;
    const terminalId = `terminal-${randomUUID()}`;
    storeNewTerminal(activeThreadRef, terminalId);
    setTerminalFocusRequestId((value) => value + 1);
  }, [activeThreadRef, storeNewTerminal]);
  const closeTerminal = useCallback(
    (terminalId: string) => {
      const api = readEnvironmentApi(environmentId);
      if (!activeThreadId || !api) return;
      const isFinalTerminal = terminalState.terminalIds.length <= 1;
      const fallbackExitWrite = () =>
        api.terminal
          .write({ threadId: activeThreadId, terminalId, data: "exit\n" })
          .catch(() => undefined);
      if ("close" in api.terminal && typeof api.terminal.close === "function") {
        void (async () => {
          if (isFinalTerminal) {
            await api.terminal
              .clear({ threadId: activeThreadId, terminalId })
              .catch(() => undefined);
          }
          await api.terminal.close({
            threadId: activeThreadId,
            terminalId,
            deleteHistory: true,
          });
        })().catch(() => fallbackExitWrite());
      } else {
        void fallbackExitWrite();
      }
      if (activeThreadRef) {
        storeCloseTerminal(activeThreadRef, terminalId);
      }
      setTerminalFocusRequestId((value) => value + 1);
    },
    [
      activeThreadId,
      activeThreadRef,
      environmentId,
      storeCloseTerminal,
      terminalState.terminalIds.length,
    ],
  );
  const runProjectScript = useCallback(
    async (
      script: ProjectScript,
      options?: {
        cwd?: string;
        env?: Record<string, string>;
        worktreePath?: string | null;
        preferNewTerminal?: boolean;
        rememberAsLastInvoked?: boolean;
      },
    ) => {
      const api = readEnvironmentApi(environmentId);
      if (!api || !activeThreadId || !activeProject || !activeThread) return;
      if (options?.rememberAsLastInvoked !== false) {
        setLastInvokedScriptByProjectId((current) => {
          if (current[activeProject.id] === script.id) return current;
          return { ...current, [activeProject.id]: script.id };
        });
      }
      const targetCwd = options?.cwd ?? gitCwd ?? activeProject.cwd;
      const baseTerminalId =
        terminalState.activeTerminalId ||
        terminalState.terminalIds[0] ||
        DEFAULT_THREAD_TERMINAL_ID;
      const isBaseTerminalBusy = terminalState.runningTerminalIds.includes(baseTerminalId);
      const wantsNewTerminal = Boolean(options?.preferNewTerminal) || isBaseTerminalBusy;
      const shouldCreateNewTerminal = wantsNewTerminal;
      const targetTerminalId = shouldCreateNewTerminal
        ? `terminal-${randomUUID()}`
        : baseTerminalId;
      const targetWorktreePath = options?.worktreePath ?? activeThread.worktreePath ?? null;

      setTerminalLaunchContext({
        threadId: activeThreadId,
        cwd: targetCwd,
        worktreePath: targetWorktreePath,
      });
      setTerminalOpen(true);
      if (!activeThreadRef) {
        return;
      }
      if (shouldCreateNewTerminal) {
        storeNewTerminal(activeThreadRef, targetTerminalId);
      } else {
        storeSetActiveTerminal(activeThreadRef, targetTerminalId);
      }
      setTerminalFocusRequestId((value) => value + 1);

      const runtimeEnv = projectScriptRuntimeEnv({
        project: {
          cwd: activeProject.cwd,
        },
        worktreePath: targetWorktreePath,
        ...(options?.env ? { extraEnv: options.env } : {}),
      });
      const openTerminalInput: TerminalOpenInput = shouldCreateNewTerminal
        ? {
            threadId: activeThreadId,
            terminalId: targetTerminalId,
            cwd: targetCwd,
            ...(targetWorktreePath !== null ? { worktreePath: targetWorktreePath } : {}),
            env: runtimeEnv,
            cols: SCRIPT_TERMINAL_COLS,
            rows: SCRIPT_TERMINAL_ROWS,
          }
        : {
            threadId: activeThreadId,
            terminalId: targetTerminalId,
            cwd: targetCwd,
            ...(targetWorktreePath !== null ? { worktreePath: targetWorktreePath } : {}),
            env: runtimeEnv,
          };

      try {
        await api.terminal.open(openTerminalInput);
        await api.terminal.write({
          threadId: activeThreadId,
          terminalId: targetTerminalId,
          data: `${script.command}\r`,
        });
      } catch (error) {
        setThreadError(
          activeThreadId,
          error instanceof Error ? error.message : `Failed to run script "${script.name}".`,
        );
      }
    },
    [
      activeProject,
      activeThread,
      activeThreadId,
      activeThreadRef,
      gitCwd,
      setTerminalOpen,
      setThreadError,
      storeNewTerminal,
      storeSetActiveTerminal,
      setLastInvokedScriptByProjectId,
      environmentId,
      terminalState.activeTerminalId,
      terminalState.runningTerminalIds,
      terminalState.terminalIds,
    ],
  );

  const persistProjectScripts = useCallback(
    async (input: {
      projectId: ProjectId;
      projectCwd: string;
      previousScripts: ProjectScript[];
      nextScripts: ProjectScript[];
      keybinding?: string | null;
      keybindingCommand: KeybindingCommand;
    }) => {
      const api = readEnvironmentApi(environmentId);
      if (!api) return;

      await api.orchestration.dispatchCommand({
        type: "project.meta.update",
        commandId: newCommandId(),
        projectId: input.projectId,
        scripts: input.nextScripts,
      });

      const keybindingRule = decodeProjectScriptKeybindingRule({
        keybinding: input.keybinding,
        command: input.keybindingCommand,
      });

      if (isElectron && keybindingRule) {
        const localApi = readLocalApi();
        if (!localApi) {
          throw new Error("Local API unavailable.");
        }
        await localApi.server.upsertKeybinding(keybindingRule);
      }
    },
    [environmentId],
  );
  const saveProjectScript = useCallback(
    async (input: NewProjectScriptInput) => {
      if (!activeProject) return;
      const nextId = nextProjectScriptId(
        input.name,
        activeProject.scripts.map((script) => script.id),
      );
      const nextScript: ProjectScript = {
        id: nextId,
        name: input.name,
        command: input.command,
        icon: input.icon,
        runOnWorktreeCreate: input.runOnWorktreeCreate,
      };
      const nextScripts = input.runOnWorktreeCreate
        ? [
            ...activeProject.scripts.map((script) =>
              script.runOnWorktreeCreate ? { ...script, runOnWorktreeCreate: false } : script,
            ),
            nextScript,
          ]
        : [...activeProject.scripts, nextScript];

      await persistProjectScripts({
        projectId: activeProject.id,
        projectCwd: activeProject.cwd,
        previousScripts: activeProject.scripts,
        nextScripts,
        keybinding: input.keybinding,
        keybindingCommand: commandForProjectScript(nextId),
      });
    },
    [activeProject, persistProjectScripts],
  );
  const updateProjectScript = useCallback(
    async (scriptId: string, input: NewProjectScriptInput) => {
      if (!activeProject) return;
      const existingScript = activeProject.scripts.find((script) => script.id === scriptId);
      if (!existingScript) {
        throw new Error("Script not found.");
      }

      const updatedScript: ProjectScript = {
        ...existingScript,
        name: input.name,
        command: input.command,
        icon: input.icon,
        runOnWorktreeCreate: input.runOnWorktreeCreate,
      };
      const nextScripts = activeProject.scripts.map((script) =>
        script.id === scriptId
          ? updatedScript
          : input.runOnWorktreeCreate
            ? { ...script, runOnWorktreeCreate: false }
            : script,
      );

      await persistProjectScripts({
        projectId: activeProject.id,
        projectCwd: activeProject.cwd,
        previousScripts: activeProject.scripts,
        nextScripts,
        keybinding: input.keybinding,
        keybindingCommand: commandForProjectScript(scriptId),
      });
    },
    [activeProject, persistProjectScripts],
  );
  const deleteProjectScript = useCallback(
    async (scriptId: string) => {
      if (!activeProject) return;
      const nextScripts = activeProject.scripts.filter((script) => script.id !== scriptId);

      const deletedName = activeProject.scripts.find((s) => s.id === scriptId)?.name;

      try {
        await persistProjectScripts({
          projectId: activeProject.id,
          projectCwd: activeProject.cwd,
          previousScripts: activeProject.scripts,
          nextScripts,
          keybinding: null,
          keybindingCommand: commandForProjectScript(scriptId),
        });
        toastManager.add({
          type: "success",
          title: `Deleted action "${deletedName ?? "Unknown"}"`,
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Could not delete action",
          description: error instanceof Error ? error.message : "An unexpected error occurred.",
        });
      }
    },
    [activeProject, persistProjectScripts],
  );

  const handleRuntimeModeChange = useCallback(
    (mode: RuntimeMode) => {
      if (mode === runtimeMode) return;
      setComposerDraftRuntimeMode(composerDraftTarget, mode);
      if (isLocalDraftThread) {
        setDraftThreadContext(composerDraftTarget, { runtimeMode: mode });
      }
      scheduleComposerFocus();
    },
    [
      isLocalDraftThread,
      runtimeMode,
      scheduleComposerFocus,
      composerDraftTarget,
      setComposerDraftRuntimeMode,
      setDraftThreadContext,
    ],
  );

  const handleInteractionModeChange = useCallback(
    (mode: ProviderInteractionMode) => {
      if (mode === interactionMode) return;
      setComposerDraftInteractionMode(composerDraftTarget, mode);
      if (isLocalDraftThread) {
        setDraftThreadContext(composerDraftTarget, { interactionMode: mode });
      }
      scheduleComposerFocus();
    },
    [
      interactionMode,
      isLocalDraftThread,
      scheduleComposerFocus,
      composerDraftTarget,
      setComposerDraftInteractionMode,
      setDraftThreadContext,
    ],
  );
  const toggleInteractionMode = useCallback(() => {
    handleInteractionModeChange(interactionMode === "plan" ? "default" : "plan");
  }, [handleInteractionModeChange, interactionMode]);
  const togglePlanSidebar = useCallback(() => {
    setPlanSidebarOpen((open) => {
      if (open) {
        planSidebarDismissedForTurnRef.current =
          activePlan?.turnId ?? sidebarProposedPlan?.turnId ?? "__dismissed__";
      } else {
        planSidebarDismissedForTurnRef.current = null;
      }
      return !open;
    });
  }, [activePlan?.turnId, sidebarProposedPlan?.turnId]);

  const persistThreadSettingsForNextTurn = useCallback(
    async (input: {
      threadId: ThreadId;
      createdAt: string;
      modelSelection?: ModelSelection;
      runtimeMode: RuntimeMode;
      interactionMode: ProviderInteractionMode;
    }) => {
      if (!serverThread) {
        return;
      }
      const api = readEnvironmentApi(environmentId);
      if (!api) {
        return;
      }

      if (
        input.modelSelection !== undefined &&
        (input.modelSelection.model !== serverThread.modelSelection.model ||
          input.modelSelection.instanceId !== serverThread.modelSelection.instanceId ||
          JSON.stringify(input.modelSelection.options ?? null) !==
            JSON.stringify(serverThread.modelSelection.options ?? null))
      ) {
        await api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId: input.threadId,
          modelSelection: input.modelSelection,
        });
      }

      if (input.runtimeMode !== serverThread.runtimeMode) {
        await api.orchestration.dispatchCommand({
          type: "thread.runtime-mode.set",
          commandId: newCommandId(),
          threadId: input.threadId,
          runtimeMode: input.runtimeMode,
          createdAt: input.createdAt,
        });
      }

      if (input.interactionMode !== serverThread.interactionMode) {
        await api.orchestration.dispatchCommand({
          type: "thread.interaction-mode.set",
          commandId: newCommandId(),
          threadId: input.threadId,
          interactionMode: input.interactionMode,
          createdAt: input.createdAt,
        });
      }
    },
    [environmentId, serverThread],
  );

  // Scroll helpers — the messages timeline owns virtualized scroll state.
  const scrollTimelineToBottom = useCallback((animated = false) => {
    messagesTimelineControllerRef.current?.scrollToBottom({ animated });
  }, []);

  // Debounce *showing* the scroll-to-bottom pill so it doesn't flash during
  // thread switches while the virtualizer is settling; hiding is always immediate.
  const showScrollDebouncer = useRef(
    new Debouncer(() => setShowScrollToBottom(true), { wait: 150 }),
  );
  const onIsAtBottomChange = useCallback((isAtBottom: boolean) => {
    if (isAtBottomRef.current === isAtBottom) return;
    isAtBottomRef.current = isAtBottom;
    if (isAtBottom) {
      showScrollDebouncer.current.cancel();
      setShowScrollToBottom(false);
    } else {
      showScrollDebouncer.current.maybeExecute();
    }
  }, []);

  useEffect(() => {
    setPullRequestDialogState(null);
    isAtBottomRef.current = true;
    showScrollDebouncer.current.cancel();
    setShowScrollToBottom(false);
    if (planSidebarOpenOnNextThreadRef.current) {
      planSidebarOpenOnNextThreadRef.current = false;
      setPlanSidebarOpen(true);
    } else {
      setPlanSidebarOpen(false);
    }
    planSidebarDismissedForTurnRef.current = null;
  }, [activeThread?.id]);

  // Auto-open the plan sidebar when plan/todo steps arrive for the current turn.
  // Don't auto-open for plans carried over from a previous turn (the user can open manually).
  useEffect(() => {
    if (!activePlan) return;
    if (planSidebarOpen) return;
    const latestTurnId = activeLatestTurn?.turnId ?? null;
    if (latestTurnId && activePlan.turnId !== latestTurnId) return;
    const turnKey = activePlan.turnId ?? sidebarProposedPlan?.turnId ?? "__dismissed__";
    if (planSidebarDismissedForTurnRef.current === turnKey) return;
    setPlanSidebarOpen(true);
  }, [activePlan, activeLatestTurn?.turnId, planSidebarOpen, sidebarProposedPlan?.turnId]);

  useEffect(() => {
    setIsRevertingCheckpoint(false);
  }, [activeThread?.id]);

  useEffect(() => {
    if (!activeThread?.id || terminalState.terminalOpen) return;
    const frame = window.requestAnimationFrame(() => {
      focusComposer();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [activeThread?.id, focusComposer, terminalState.terminalOpen]);

  useEffect(() => {
    if (!activeThread?.id) return;
    if (activeThread.messages.length === 0) {
      return;
    }
    const serverIds = new Set(activeThread.messages.map((message) => message.id));
    const removedMessages = optimisticUserMessages.filter((message) => serverIds.has(message.id));
    if (removedMessages.length === 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      setOptimisticUserMessages((existing) =>
        existing.filter((message) => !serverIds.has(message.id)),
      );
    }, 0);
    for (const removedMessage of removedMessages) {
      const previewUrls = collectUserMessageBlobPreviewUrls(removedMessage);
      if (previewUrls.length > 0) {
        handoffAttachmentPreviews(removedMessage.id, previewUrls);
        continue;
      }
      revokeUserMessagePreviewUrls(removedMessage);
    }
    return () => {
      window.clearTimeout(timer);
    };
  }, [activeThread?.id, activeThread?.messages, handoffAttachmentPreviews, optimisticUserMessages]);

  useEffect(() => {
    setOptimisticUserMessages((existing) => {
      for (const message of existing) {
        revokeUserMessagePreviewUrls(message);
      }
      return [];
    });
    resetLocalDispatch();
    setExpandedImage(null);
  }, [draftId, resetLocalDispatch, threadId]);

  const closeExpandedImage = useCallback(() => {
    setExpandedImage(null);
  }, []);

  const activeWorktreePath = activeThread?.worktreePath ?? null;
  const derivedEnvMode: DraftThreadEnvMode = resolveEffectiveEnvMode({
    activeWorktreePath,
    hasServerThread: isServerThread,
    draftThreadEnvMode: isLocalDraftThread ? draftThread?.envMode : undefined,
  });
  const canOverrideServerThreadEnvMode = Boolean(
    isServerThread &&
    activeThread &&
    activeThread.messages.length === 0 &&
    activeThread.worktreePath === null &&
    !envLocked,
  );
  const envMode: DraftThreadEnvMode = canOverrideServerThreadEnvMode
    ? (pendingServerThreadEnvMode ?? draftThread?.envMode ?? derivedEnvMode)
    : derivedEnvMode;
  const activeThreadBranch =
    canOverrideServerThreadEnvMode && pendingServerThreadBranch !== undefined
      ? pendingServerThreadBranch
      : (activeThread?.branch ?? null);
  const sendEnvMode = resolveSendEnvMode({
    requestedEnvMode: envMode,
    isGitRepo,
  });

  useEffect(() => {
    setPendingServerThreadEnvMode(null);
    setPendingServerThreadBranch(undefined);
  }, [activeThread?.id]);

  useEffect(() => {
    if (canOverrideServerThreadEnvMode) {
      return;
    }
    setPendingServerThreadEnvMode(null);
    setPendingServerThreadBranch(undefined);
  }, [canOverrideServerThreadEnvMode]);

  useEffect(() => {
    if (!activeThreadId) {
      setTerminalLaunchContext(null);
      storeClearTerminalLaunchContext(routeThreadRef);
      return;
    }
    setTerminalLaunchContext((current) => {
      if (!current) return current;
      if (current.threadId === activeThreadId) return current;
      return null;
    });
  }, [activeThreadId, routeThreadRef, storeClearTerminalLaunchContext]);

  useEffect(() => {
    if (!activeThreadId || !activeProjectCwd) {
      return;
    }
    setTerminalLaunchContext((current) => {
      if (!current || current.threadId !== activeThreadId) {
        return current;
      }
      const settledCwd = projectScriptCwd({
        project: { cwd: activeProjectCwd },
        worktreePath: activeThreadWorktreePath,
      });
      if (
        settledCwd === current.cwd &&
        (activeThreadWorktreePath ?? null) === current.worktreePath
      ) {
        if (activeThreadRef) {
          storeClearTerminalLaunchContext(activeThreadRef);
        }
        return null;
      }
      return current;
    });
  }, [
    activeProjectCwd,
    activeThreadId,
    activeThreadRef,
    activeThreadWorktreePath,
    storeClearTerminalLaunchContext,
  ]);

  useEffect(() => {
    if (!activeThreadId || !activeProjectCwd || !storeServerTerminalLaunchContext) {
      return;
    }
    const settledCwd = projectScriptCwd({
      project: { cwd: activeProjectCwd },
      worktreePath: activeThreadWorktreePath,
    });
    if (
      settledCwd === storeServerTerminalLaunchContext.cwd &&
      (activeThreadWorktreePath ?? null) === storeServerTerminalLaunchContext.worktreePath
    ) {
      if (activeThreadRef) {
        storeClearTerminalLaunchContext(activeThreadRef);
      }
    }
  }, [
    activeProjectCwd,
    activeThreadId,
    activeThreadRef,
    activeThreadWorktreePath,
    storeClearTerminalLaunchContext,
    storeServerTerminalLaunchContext,
  ]);

  useEffect(() => {
    if (terminalState.terminalOpen) {
      return;
    }
    if (activeThreadRef) {
      storeClearTerminalLaunchContext(activeThreadRef);
    }
    setTerminalLaunchContext((current) => (current?.threadId === activeThreadId ? null : current));
  }, [
    activeThreadId,
    activeThreadRef,
    storeClearTerminalLaunchContext,
    terminalState.terminalOpen,
  ]);

  useEffect(() => {
    if (!activeThreadKey) return;
    const previous = terminalOpenByThreadRef.current[activeThreadKey] ?? false;
    const current = Boolean(terminalState.terminalOpen);

    if (!previous && current) {
      terminalOpenByThreadRef.current[activeThreadKey] = current;
      setTerminalFocusRequestId((value) => value + 1);
      return;
    } else if (previous && !current) {
      terminalOpenByThreadRef.current[activeThreadKey] = current;
      const frame = window.requestAnimationFrame(() => {
        focusComposer();
      });
      return () => {
        window.cancelAnimationFrame(frame);
      };
    }

    terminalOpenByThreadRef.current[activeThreadKey] = current;
  }, [activeThreadKey, focusComposer, terminalState.terminalOpen]);

  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => {
      if (!activeThreadId || useCommandPaletteStore.getState().open || event.defaultPrevented) {
        return;
      }
      const shortcutContext = {
        terminalFocus: isTerminalFocused(),
        terminalOpen: Boolean(terminalState.terminalOpen),
      };

      const command = resolveShortcutCommand(event, keybindings, {
        context: shortcutContext,
      });
      if (!command) return;

      if (command === "terminal.toggle") {
        event.preventDefault();
        event.stopPropagation();
        toggleTerminalVisibility();
        return;
      }

      if (command === "terminal.split") {
        event.preventDefault();
        event.stopPropagation();
        if (!terminalState.terminalOpen) {
          setTerminalOpen(true);
        }
        splitTerminal();
        return;
      }

      if (command === "terminal.close") {
        event.preventDefault();
        event.stopPropagation();
        if (!terminalState.terminalOpen) return;
        closeTerminal(terminalState.activeTerminalId);
        return;
      }

      if (command === "terminal.new") {
        event.preventDefault();
        event.stopPropagation();
        if (!terminalState.terminalOpen) {
          setTerminalOpen(true);
        }
        createNewTerminal();
        return;
      }

      if (command === "diff.toggle") {
        event.preventDefault();
        event.stopPropagation();
        onToggleDiff();
        return;
      }

      const scriptId = projectScriptIdFromCommand(command);
      if (!scriptId || !activeProject) return;
      const script = activeProject.scripts.find((entry) => entry.id === scriptId);
      if (!script) return;
      event.preventDefault();
      event.stopPropagation();
      void runProjectScript(script);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    activeProject,
    terminalState.terminalOpen,
    terminalState.activeTerminalId,
    activeThreadId,
    closeTerminal,
    createNewTerminal,
    setTerminalOpen,
    runProjectScript,
    splitTerminal,
    keybindings,
    onToggleDiff,
    toggleTerminalVisibility,
  ]);

  const revertThreadToTurnCountSilent = useCallback(
    async (turnCount: number): Promise<boolean> => {
      const api = readEnvironmentApi(environmentId);
      if (!api || !activeThread || isRevertingCheckpoint) {
        return false;
      }
      if (phase === "running" || isSendBusy || isConnecting) {
        setThreadError(
          activeThread.id,
          "Interrupt the current turn before editing earlier messages.",
        );
        return false;
      }
      setIsRevertingCheckpoint(true);
      setThreadError(activeThread.id, null);
      try {
        await api.orchestration.dispatchCommand({
          type: "thread.checkpoint.revert",
          commandId: newCommandId(),
          threadId: activeThread.id,
          turnCount,
          createdAt: new Date().toISOString(),
        });
        return true;
      } catch (err) {
        setThreadError(
          activeThread.id,
          err instanceof Error ? err.message : "Failed to revert thread state.",
        );
        return false;
      } finally {
        setIsRevertingCheckpoint(false);
      }
    },
    [
      activeThread,
      environmentId,
      isConnecting,
      isRevertingCheckpoint,
      isSendBusy,
      phase,
      setThreadError,
    ],
  );

  const onSubmitEditUserMessage = useCallback(
    async (messageId: MessageId, input: InlineEditSubmitInput): Promise<boolean> => {
      const api = readEnvironmentApi(environmentId);
      if (
        !api ||
        !activeThread ||
        !isServerThread ||
        isSendBusy ||
        isConnecting ||
        sendInFlightRef.current ||
        activePendingProgress
      ) {
        return false;
      }

      const {
        prompt: promptForSend,
        images: composerImages,
        terminalContexts: composerTerminalContexts,
        selectedProvider: ctxSelectedProvider,
        selectedModel: ctxSelectedModel,
        selectedProviderModels: ctxSelectedProviderModels,
        selectedPromptEffort: ctxSelectedPromptEffort,
        selectedModelSelection: ctxSelectedModelSelection,
      } = input.sendContext;
      const {
        sendableTerminalContexts: sendableComposerTerminalContexts,
        expiredTerminalContextCount,
        hasSendableContent,
      } = deriveComposerSendState({
        prompt: promptForSend,
        imageCount: composerImages.length,
        terminalContexts: composerTerminalContexts,
      });
      const originalMessage = timelineMessages.find(
        (message) => message.id === messageId && message.role === "user",
      );
      const unchanged =
        originalMessage?.text === promptForSend &&
        composerImages.length === 0 &&
        sendableComposerTerminalContexts.length === 0;
      if (!hasSendableContent || !originalMessage || unchanged) {
        return false;
      }

      const revertTurn = revertTurnCountByUserMessageId.get(messageId);
      if (typeof revertTurn !== "number") {
        setThreadError(
          activeThread.id,
          "Cannot edit this message because no checkpoint is available.",
        );
        return false;
      }

      const threadIdForSend = activeThread.id;
      const messageIdForSend = newMessageId();
      const messageCreatedAt = new Date().toISOString();
      const composerImagesSnapshot = [...composerImages];
      const composerTerminalContextsSnapshot = [...sendableComposerTerminalContexts];
      const messageTextForSend = appendTerminalContextsToPrompt(
        promptForSend,
        composerTerminalContextsSnapshot,
      );
      const outgoingMessageText = formatOutgoingPrompt({
        provider: ctxSelectedProvider,
        model: ctxSelectedModel,
        models: ctxSelectedProviderModels,
        effort: ctxSelectedPromptEffort,
        text: messageTextForSend || IMAGE_ONLY_BOOTSTRAP_PROMPT,
      });
      const turnAttachmentsPromise = Promise.all(
        composerImagesSnapshot.map(async (image) => ({
          type: "image" as const,
          name: image.name,
          mimeType: image.mimeType,
          sizeBytes: image.sizeBytes,
          dataUrl: await readFileAsDataUrl(image.file),
        })),
      );
      const optimisticAttachments = composerImagesSnapshot.map((image) => ({
        type: "image" as const,
        id: image.id,
        name: image.name,
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes,
        previewUrl: image.previewUrl,
      }));
      let turnStartSucceeded = false;
      let optimisticMessageAdded = false;

      sendInFlightRef.current = true;
      try {
        const reverted = await revertThreadToTurnCountSilent(revertTurn);
        if (!reverted) {
          return false;
        }

        beginLocalDispatch({ preparingWorktree: false });
        isAtBottomRef.current = true;
        showScrollDebouncer.current.cancel();
        setShowScrollToBottom(false);
        await messagesTimelineControllerRef.current?.scrollToBottom({ animated: false });

        setOptimisticUserMessages((existing) => [
          ...existing,
          {
            id: messageIdForSend,
            role: "user",
            text: outgoingMessageText,
            ...(optimisticAttachments.length > 0 ? { attachments: optimisticAttachments } : {}),
            createdAt: messageCreatedAt,
            streaming: false,
          },
        ]);
        optimisticMessageAdded = true;
        setThreadError(threadIdForSend, null);
        if (expiredTerminalContextCount > 0) {
          const toastCopy = buildExpiredTerminalContextToastCopy(
            expiredTerminalContextCount,
            "omitted",
          );
          toastManager.add({
            type: "warning",
            title: toastCopy.title,
            description: toastCopy.description,
          });
        }

        await persistThreadSettingsForNextTurn({
          threadId: threadIdForSend,
          createdAt: messageCreatedAt,
          ...(ctxSelectedModel ? { modelSelection: ctxSelectedModelSelection } : {}),
          runtimeMode: input.runtimeMode,
          interactionMode: input.interactionMode,
        });

        const turnAttachments = await turnAttachmentsPromise;
        await api.orchestration.dispatchCommand({
          type: "thread.turn.start",
          commandId: newCommandId(),
          threadId: threadIdForSend,
          message: {
            messageId: messageIdForSend,
            role: "user",
            text: outgoingMessageText,
            attachments: turnAttachments,
          },
          modelSelection: ctxSelectedModelSelection,
          titleSeed: activeThread.title,
          runtimeMode: input.runtimeMode,
          interactionMode: input.interactionMode,
          createdAt: messageCreatedAt,
        });
        turnStartSucceeded = true;
        setEditingUserMessageId((current) => (current === messageId ? null : current));
        clearComposerDraftContent(editComposerDraftTarget);
        return true;
      } catch (err) {
        if (optimisticMessageAdded) {
          setOptimisticUserMessages((existing) => {
            const removed = existing.filter((message) => message.id === messageIdForSend);
            for (const message of removed) {
              revokeUserMessagePreviewUrls(message);
            }
            return existing.filter((message) => message.id !== messageIdForSend);
          });
        }
        setThreadError(
          threadIdForSend,
          err instanceof Error ? err.message : "Failed to submit edited message.",
        );
        return false;
      } finally {
        sendInFlightRef.current = false;
        if (!turnStartSucceeded) {
          resetLocalDispatch();
        }
      }
    },
    [
      activePendingProgress,
      activeThread,
      beginLocalDispatch,
      clearComposerDraftContent,
      editComposerDraftTarget,
      environmentId,
      isConnecting,
      isSendBusy,
      isServerThread,
      persistThreadSettingsForNextTurn,
      resetLocalDispatch,
      revertThreadToTurnCountSilent,
      revertTurnCountByUserMessageId,
      setThreadError,
      timelineMessages,
    ],
  );

  const submitComposerSendSnapshot = async (snapshot: ComposerSendSnapshot) => {
    const api = readEnvironmentApi(environmentId);
    if (!api || !activeThread || isSendBusy || isConnecting || sendInFlightRef.current) return;
    const {
      sendContext: sendCtx,
      runtimeMode: runtimeModeForSend,
      interactionMode: interactionModeForSend,
      planFollowUp,
      clearComposerOnSubmit,
    } = snapshot;
    const {
      prompt: promptForSend,
      promptDoc: promptDocForSend,
      images: composerImages,
      terminalContexts: composerTerminalContexts,
      selectedProvider: ctxSelectedProvider,
      selectedModel: ctxSelectedModel,
      selectedProviderModels: ctxSelectedProviderModels,
      selectedPromptEffort: ctxSelectedPromptEffort,
      selectedModelSelection: ctxSelectedModelSelection,
    } = sendCtx;
    const {
      trimmedPrompt: trimmed,
      sendableTerminalContexts: sendableComposerTerminalContexts,
      expiredTerminalContextCount,
      hasSendableContent,
    } = deriveComposerSendState({
      prompt: promptForSend,
      imageCount: composerImages.length,
      terminalContexts: composerTerminalContexts,
    });
    if (planFollowUp) {
      const followUp = resolvePlanFollowUpSubmission({
        draftText: trimmed,
        planMarkdown: planFollowUp.planMarkdown,
      });
      if (clearComposerOnSubmit) {
        promptRef.current = "";
        clearComposerDraftContent(composerDraftTarget);
        composerRef.current?.resetCursorState();
      }
      await onSubmitPlanFollowUp({
        text: followUp.text,
        interactionMode: followUp.interactionMode,
      });
      return;
    }
    const standaloneSlashCommand =
      composerImages.length === 0 && sendableComposerTerminalContexts.length === 0
        ? parseStandaloneComposerSlashCommand(trimmed)
        : null;
    if (standaloneSlashCommand) {
      handleInteractionModeChange(standaloneSlashCommand);
      if (clearComposerOnSubmit) {
        promptRef.current = "";
        clearComposerDraftContent(composerDraftTarget);
        composerRef.current?.resetCursorState();
      }
      return;
    }
    if (!hasSendableContent) {
      if (expiredTerminalContextCount > 0) {
        const toastCopy = buildExpiredTerminalContextToastCopy(
          expiredTerminalContextCount,
          "empty",
        );
        toastManager.add({
          type: "warning",
          title: toastCopy.title,
          description: toastCopy.description,
        });
      }
      return;
    }
    const threadIdForSend = activeThread.id;
    const isFirstMessage = !isServerThread || activeThread.messages.length === 0;
    const baseBranchForWorktree =
      activeProject && isFirstMessage && sendEnvMode === "worktree" && !activeThread.worktreePath
        ? activeThreadBranch
        : null;

    // In worktree mode, require an explicit base branch so we don't silently
    // fall back to local execution when branch selection is missing.
    const shouldCreateWorktree =
      activeProject && isFirstMessage && sendEnvMode === "worktree" && !activeThread.worktreePath;
    if (shouldCreateWorktree && !activeThreadBranch) {
      setThreadError(threadIdForSend, "Select a base branch before sending in New worktree mode.");
      return;
    }

    sendInFlightRef.current = true;
    beginLocalDispatch({ preparingWorktree: Boolean(baseBranchForWorktree) });

    const composerImagesSnapshot = [...composerImages];
    const composerTerminalContextsSnapshot = [...sendableComposerTerminalContexts];
    const messageTextForSend = appendTerminalContextsToPrompt(
      promptForSend,
      composerTerminalContextsSnapshot,
    );
    const messageIdForSend = snapshot.messageId ?? newMessageId();
    const messageCreatedAt = snapshot.createdAt ?? new Date().toISOString();
    const outgoingMessageText = formatOutgoingPrompt({
      provider: ctxSelectedProvider,
      model: ctxSelectedModel,
      models: ctxSelectedProviderModels,
      effort: ctxSelectedPromptEffort,
      text: messageTextForSend || IMAGE_ONLY_BOOTSTRAP_PROMPT,
    });
    const turnAttachmentsPromise = Promise.all(
      composerImagesSnapshot.map(async (image) => ({
        type: "image" as const,
        name: image.name,
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes,
        dataUrl: await readFileAsDataUrl(image.file),
      })),
    );
    const optimisticAttachments = composerImagesSnapshot.map((image) => ({
      type: "image" as const,
      id: image.id,
      name: image.name,
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes,
      previewUrl: image.previewUrl,
    }));
    // Scroll to the current end before adding the optimistic message so the
    // virtualizer pins to the new item when the data changes.
    isAtBottomRef.current = true;
    showScrollDebouncer.current.cancel();
    setShowScrollToBottom(false);
    await messagesTimelineControllerRef.current?.scrollToBottom({ animated: false });

    setOptimisticUserMessages((existing) => [
      ...existing,
      {
        id: messageIdForSend,
        role: "user",
        text: outgoingMessageText,
        ...(optimisticAttachments.length > 0 ? { attachments: optimisticAttachments } : {}),
        createdAt: messageCreatedAt,
        streaming: false,
      },
    ]);

    setThreadError(threadIdForSend, null);
    if (expiredTerminalContextCount > 0) {
      const toastCopy = buildExpiredTerminalContextToastCopy(
        expiredTerminalContextCount,
        "omitted",
      );
      toastManager.add({
        type: "warning",
        title: toastCopy.title,
        description: toastCopy.description,
      });
    }
    if (clearComposerOnSubmit) {
      promptRef.current = "";
      clearComposerDraftContent(composerDraftTarget);
      composerRef.current?.resetCursorState();
    }

    let navigatedOptimistically = false;

    let turnStartSucceeded = false;
    await (async () => {
      let firstComposerImageName: string | null = null;
      if (composerImagesSnapshot.length > 0) {
        const firstComposerImage = composerImagesSnapshot[0];
        if (firstComposerImage) {
          firstComposerImageName = firstComposerImage.name;
        }
      }
      let titleSeed = trimmed;
      if (!titleSeed) {
        if (firstComposerImageName) {
          titleSeed = `Image: ${firstComposerImageName}`;
        } else if (composerTerminalContextsSnapshot.length > 0) {
          titleSeed = formatTerminalContextLabel(composerTerminalContextsSnapshot[0]!);
        } else {
          titleSeed = "New thread";
        }
      }
      const title = truncate(titleSeed);
      const threadCreateModelSelection: ModelSelection = {
        instanceId: ctxSelectedModelSelection.instanceId,
        model: ctxSelectedModel || activeProject?.defaultModelSelection?.model || DEFAULT_MODEL,
        ...(ctxSelectedModelSelection.options
          ? { options: ctxSelectedModelSelection.options }
          : {}),
      };

      // Auto-title from first message
      if (isFirstMessage && isServerThread) {
        await api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId: threadIdForSend,
          title,
        });
      }

      if (isServerThread) {
        await persistThreadSettingsForNextTurn({
          threadId: threadIdForSend,
          createdAt: messageCreatedAt,
          ...(ctxSelectedModel ? { modelSelection: ctxSelectedModelSelection } : {}),
          runtimeMode: runtimeModeForSend,
          interactionMode: interactionModeForSend,
        });
      }

      const turnAttachments = await turnAttachmentsPromise;
      const bootstrap =
        isLocalDraftThread || baseBranchForWorktree
          ? {
              ...(isLocalDraftThread
                ? {
                    createThread: {
                      projectId: activeProject?.id ?? null,
                      title,
                      modelSelection: threadCreateModelSelection,
                      runtimeMode: runtimeModeForSend,
                      interactionMode: interactionModeForSend,
                      branch: activeThreadBranch,
                      worktreePath: activeThread.worktreePath,
                      createdAt: activeThread.createdAt,
                    },
                  }
                : {}),
              ...(baseBranchForWorktree
                ? {
                    prepareWorktree: {
                      projectCwd: activeProject!.cwd,
                      baseBranch: baseBranchForWorktree,
                      branch: buildTemporaryWorktreeBranchName(),
                    },
                    runSetupScript: true,
                  }
                : {}),
            }
          : undefined;
      beginLocalDispatch({ preparingWorktree: false });
      if (isLocalDraftThread && draftId) {
        await navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(scopeThreadRef(environmentId, threadIdForSend)),
          replace: true,
        });
        navigatedOptimistically = true;
        markDraftThreadPromoting(draftId, scopeThreadRef(environmentId, threadIdForSend));
      }
      await api.orchestration.dispatchCommand({
        type: "thread.turn.start",
        commandId: newCommandId(),
        threadId: threadIdForSend,
        message: {
          messageId: messageIdForSend,
          role: "user",
          text: outgoingMessageText,
          attachments: turnAttachments,
        },
        modelSelection: ctxSelectedModelSelection,
        titleSeed: title,
        runtimeMode: runtimeModeForSend,
        interactionMode: interactionModeForSend,
        ...(bootstrap ? { bootstrap } : {}),
        createdAt: messageCreatedAt,
      });
      turnStartSucceeded = true;
    })().catch(async (err: unknown) => {
      if (navigatedOptimistically && draftId) {
        cancelDraftThreadPromotion(draftId);
        await navigate({
          to: "/draft/$draftId",
          params: buildDraftThreadRouteParams(draftId),
          replace: true,
        });
      }
      if (
        !turnStartSucceeded &&
        promptRef.current.length === 0 &&
        composerImagesRef.current.length === 0 &&
        composerTerminalContextsRef.current.length === 0
      ) {
        setOptimisticUserMessages((existing) => {
          const removed = existing.filter((message) => message.id === messageIdForSend);
          for (const message of removed) {
            revokeUserMessagePreviewUrls(message);
          }
          const next = existing.filter((message) => message.id !== messageIdForSend);
          return next.length === existing.length ? existing : next;
        });
        promptRef.current = promptForSend;
        const retryComposerImages = composerImagesSnapshot.map(cloneComposerImageForRetry);
        composerImagesRef.current = retryComposerImages;
        composerTerminalContextsRef.current = composerTerminalContextsSnapshot;
        setComposerDraftPrompt(composerDraftTarget, promptForSend, promptDocForSend);
        addComposerDraftImages(composerDraftTarget, retryComposerImages);
        setComposerDraftTerminalContexts(composerDraftTarget, composerTerminalContextsSnapshot);
        composerRef.current?.resetCursorState({
          cursor: collapseExpandedComposerCursor(promptForSend, promptForSend.length),
          prompt: promptForSend,
          detectTrigger: true,
        });
      }
      setThreadError(
        threadIdForSend,
        err instanceof Error ? err.message : "Failed to send message.",
      );
    });
    sendInFlightRef.current = false;
    if (!turnStartSucceeded) {
      resetLocalDispatch();
    }
  };

  const createQueuedComposerItem = (
    sendContext: ChatComposerSendContext,
    runtimeModeForItem: RuntimeMode,
    interactionModeForItem: ProviderInteractionMode,
    planFollowUp: { planMarkdown: string } | null,
    itemId: QueuedComposerItemId = newMessageId(),
    createdAt: string = new Date().toISOString(),
  ): QueuedComposerItem => ({
    id: itemId,
    threadKey: routeThreadKey,
    sendContext: {
      ...sendContext,
      images: [...sendContext.images],
      terminalContexts: [...sendContext.terminalContexts],
    },
    runtimeMode: runtimeModeForItem,
    interactionMode: interactionModeForItem,
    planFollowUp,
    createdAt,
  });

  const submitQueuedComposerItem = async (item: QueuedComposerItem) => {
    await submitComposerSendSnapshot({
      sendContext: item.sendContext,
      runtimeMode: item.runtimeMode,
      interactionMode: item.interactionMode,
      planFollowUp: item.planFollowUp,
      clearComposerOnSubmit: false,
      messageId: item.id,
      createdAt: item.createdAt,
    });
  };

  const clearLiveComposer = () => {
    promptRef.current = "";
    clearComposerDraftContent(composerDraftTarget);
    composerRef.current?.resetCursorState();
  };

  const onSend = async (e?: { preventDefault: () => void }) => {
    e?.preventDefault();
    if (activePendingProgress) {
      onAdvanceActivePendingUserInput();
      return;
    }
    const sendContext = composerRef.current?.getSendContext();
    if (!sendContext) return;

    const sendWhileStreamingBehavior = settings.agentWindowSendWhileStreamingBehavior;
    const planFollowUp =
      showPlanFollowUpPrompt && activeProposedPlan
        ? { planMarkdown: activeProposedPlan.planMarkdown }
        : null;
    const currentComposerSendState = deriveComposerSendState({
      prompt: sendContext.prompt,
      imageCount: sendContext.images.length,
      terminalContexts: sendContext.terminalContexts,
    });
    if (
      !currentComposerSendState.hasSendableContent &&
      currentComposerSendState.expiredTerminalContextCount === 0 &&
      planFollowUp === null &&
      !editingQueuedComposerItemId &&
      queuedComposerItems.length > 0
    ) {
      const firstQueuedItem = queuedComposerItems[0];
      if (!firstQueuedItem) {
        return;
      }
      const nextQueuedItem = takeQueuedComposerItem(routeThreadKey, firstQueuedItem.id);
      if (nextQueuedItem) {
        await submitQueuedComposerItem(nextQueuedItem);
      }
      return;
    }

    if (editingQueuedComposerItemId) {
      const existingQueuedItem =
        queuedComposerItems.find((item) => item.id === editingQueuedComposerItemId) ?? null;
      const { expiredTerminalContextCount, hasSendableContent } = currentComposerSendState;
      if (!hasSendableContent) {
        if (expiredTerminalContextCount > 0) {
          const toastCopy = buildExpiredTerminalContextToastCopy(
            expiredTerminalContextCount,
            "empty",
          );
          toastManager.add({
            type: "warning",
            title: toastCopy.title,
            description: toastCopy.description,
          });
        }
        return;
      }

      const queuedItem = createQueuedComposerItem(
        sendContext,
        runtimeMode,
        interactionMode,
        planFollowUp,
        editingQueuedComposerItemId,
        existingQueuedItem?.createdAt,
      );
      replaceEditingQueuedComposerItem(routeThreadKey, queuedItem);
      clearLiveComposer();
      return;
    }

    if (
      phase === "running" &&
      (sendWhileStreamingBehavior === "queue" || sendWhileStreamingBehavior === "stop-and-send")
    ) {
      const { expiredTerminalContextCount, hasSendableContent } = currentComposerSendState;
      if (!hasSendableContent) {
        if (expiredTerminalContextCount > 0) {
          const toastCopy = buildExpiredTerminalContextToastCopy(
            expiredTerminalContextCount,
            "empty",
          );
          toastManager.add({
            type: "warning",
            title: toastCopy.title,
            description: toastCopy.description,
          });
        }
        return;
      }

      enqueueComposerItem(
        routeThreadKey,
        createQueuedComposerItem(sendContext, runtimeMode, interactionMode, planFollowUp),
      );
      clearLiveComposer();
      if (sendWhileStreamingBehavior === "stop-and-send") {
        await onInterrupt();
      }
      return;
    }

    await submitComposerSendSnapshot({
      sendContext,
      runtimeMode,
      interactionMode,
      planFollowUp,
      clearComposerOnSubmit: true,
    });
  };

  const onInterrupt = useCallback(async () => {
    const api = readEnvironmentApi(environmentId);
    if (!api || !activeThread) return;
    const activeTurnId =
      activeThread.session?.activeTurnId ?? activeThread.latestTurn?.turnId ?? undefined;
    await api.orchestration.dispatchCommand({
      type: "thread.turn.interrupt",
      commandId: newCommandId(),
      threadId: activeThread.id,
      ...(activeTurnId !== undefined ? { turnId: activeTurnId } : {}),
      createdAt: new Date().toISOString(),
    });
  }, [activeThread, environmentId]);

  const loadQueuedComposerItemIntoComposer = (item: QueuedComposerItem) => {
    const imagesForEdit = item.sendContext.images.map(cloneComposerImageForRetry);
    promptRef.current = item.sendContext.prompt;
    composerImagesRef.current = imagesForEdit;
    composerTerminalContextsRef.current = item.sendContext.terminalContexts;
    clearComposerDraftContent(composerDraftTarget);
    setComposerDraftPrompt(
      composerDraftTarget,
      item.sendContext.prompt,
      item.sendContext.promptDoc,
    );
    addComposerDraftImages(composerDraftTarget, imagesForEdit);
    setComposerDraftTerminalContexts(composerDraftTarget, item.sendContext.terminalContexts);
    setComposerDraftModelSelection(composerDraftTarget, item.sendContext.selectedModelSelection);
    setComposerDraftRuntimeMode(composerDraftTarget, item.runtimeMode);
    setComposerDraftInteractionMode(composerDraftTarget, item.interactionMode);
    composerRef.current?.resetCursorState({
      cursor: collapseExpandedComposerCursor(
        item.sendContext.prompt,
        item.sendContext.prompt.length,
      ),
      prompt: item.sendContext.prompt,
      detectTrigger: true,
    });
    scheduleComposerFocus();
  };

  const onBeginEditQueuedComposerItem = (itemId: QueuedComposerItemId) => {
    const item = queuedComposerItems.find((entry) => entry.id === itemId);
    if (!item) {
      return;
    }
    beginEditingQueuedComposerItem(routeThreadKey, itemId);
    loadQueuedComposerItemIntoComposer(item);
  };

  const onCancelEditingQueuedComposerItem = () => {
    cancelEditingQueuedComposerItem(routeThreadKey);
    clearLiveComposer();
  };

  const onRemoveQueuedComposerItem = (itemId: QueuedComposerItemId) => {
    if (editingQueuedComposerItemId === itemId) {
      clearLiveComposer();
    }
    removeQueuedComposerItem(routeThreadKey, itemId);
  };

  const onSendQueuedComposerItemNow = (itemId: QueuedComposerItemId) => {
    if (isConnecting || isSendBusy || sendInFlightRef.current) {
      return;
    }
    const item = takeQueuedComposerItem(routeThreadKey, itemId);
    if (!item) {
      return;
    }
    if (editingQueuedComposerItemId === itemId) {
      clearLiveComposer();
    }
    void submitQueuedComposerItem(item);
  };

  const onRespondToApproval = useCallback(
    async (requestId: ApprovalRequestId, decision: ProviderApprovalDecision) => {
      const api = readEnvironmentApi(environmentId);
      if (!api || !activeThreadId) return;

      setRespondingRequestIds((existing) =>
        existing.includes(requestId) ? existing : [...existing, requestId],
      );
      await api.orchestration
        .dispatchCommand({
          type: "thread.approval.respond",
          commandId: newCommandId(),
          threadId: activeThreadId,
          requestId,
          decision,
          createdAt: new Date().toISOString(),
        })
        .catch((err: unknown) => {
          setThreadError(
            activeThreadId,
            err instanceof Error ? err.message : "Failed to submit approval decision.",
          );
        });
      setRespondingRequestIds((existing) => existing.filter((id) => id !== requestId));
    },
    [activeThreadId, environmentId, setThreadError],
  );

  const onRespondToUserInput = useCallback(
    async (requestId: ApprovalRequestId, answers: Record<string, unknown>) => {
      const api = readEnvironmentApi(environmentId);
      if (!api || !activeThreadId) return;

      setRespondingUserInputRequestIds((existing) =>
        existing.includes(requestId) ? existing : [...existing, requestId],
      );
      await api.orchestration
        .dispatchCommand({
          type: "thread.user-input.respond",
          commandId: newCommandId(),
          threadId: activeThreadId,
          requestId,
          answers,
          createdAt: new Date().toISOString(),
        })
        .catch((err: unknown) => {
          setThreadError(
            activeThreadId,
            err instanceof Error ? err.message : "Failed to submit user input.",
          );
        });
      setRespondingUserInputRequestIds((existing) => existing.filter((id) => id !== requestId));
    },
    [activeThreadId, environmentId, setThreadError],
  );

  const setActivePendingUserInputQuestionIndex = useCallback(
    (nextQuestionIndex: number) => {
      if (!activePendingUserInput) {
        return;
      }
      setPendingUserInputQuestionIndexByRequestId((existing) => ({
        ...existing,
        [activePendingUserInput.requestId]: nextQuestionIndex,
      }));
    },
    [activePendingUserInput],
  );

  const onSelectActivePendingUserInputOption = useCallback(
    (questionId: string, optionLabel: string) => {
      if (!activePendingUserInput) {
        return;
      }
      setPendingUserInputAnswersByRequestId((existing) => {
        const question =
          (activePendingProgress?.activeQuestion?.id === questionId
            ? activePendingProgress.activeQuestion
            : undefined) ??
          activePendingUserInput.questions.find((entry) => entry.id === questionId);
        if (!question) {
          return existing;
        }

        return {
          ...existing,
          [activePendingUserInput.requestId]: {
            ...existing[activePendingUserInput.requestId],
            [questionId]: togglePendingUserInputOptionSelection(
              question,
              existing[activePendingUserInput.requestId]?.[questionId],
              optionLabel,
            ),
          },
        };
      });
      promptRef.current = "";
      composerRef.current?.resetCursorState({ cursor: 0 });
    },
    [activePendingProgress?.activeQuestion, activePendingUserInput, composerRef],
  );

  const onChangeActivePendingUserInputCustomAnswer = useCallback(
    (
      questionId: string,
      value: string,
      nextCursor: number,
      expandedCursor: number,
      _cursorAdjacentToMention: boolean,
    ) => {
      if (!activePendingUserInput) {
        return;
      }
      promptRef.current = value;
      setPendingUserInputAnswersByRequestId((existing) => ({
        ...existing,
        [activePendingUserInput.requestId]: {
          ...existing[activePendingUserInput.requestId],
          [questionId]: setPendingUserInputCustomAnswer(
            existing[activePendingUserInput.requestId]?.[questionId],
            value,
          ),
        },
      }));
      const snapshot = composerRef.current?.readSnapshot();
      if (
        snapshot?.value !== value ||
        snapshot.cursor !== nextCursor ||
        snapshot.expandedCursor !== expandedCursor
      ) {
        composerRef.current?.focusAt(nextCursor);
      }
    },
    [activePendingUserInput, composerRef],
  );

  const onAdvanceActivePendingUserInput = useCallback(() => {
    if (!activePendingUserInput || !activePendingProgress) {
      return;
    }
    if (activePendingProgress.isLastQuestion) {
      if (activePendingResolvedAnswers) {
        void onRespondToUserInput(activePendingUserInput.requestId, activePendingResolvedAnswers);
      }
      return;
    }
    setActivePendingUserInputQuestionIndex(activePendingProgress.questionIndex + 1);
  }, [
    activePendingProgress,
    activePendingResolvedAnswers,
    activePendingUserInput,
    onRespondToUserInput,
    setActivePendingUserInputQuestionIndex,
  ]);

  const onPreviousActivePendingUserInputQuestion = useCallback(() => {
    if (!activePendingProgress) {
      return;
    }
    setActivePendingUserInputQuestionIndex(Math.max(activePendingProgress.questionIndex - 1, 0));
  }, [activePendingProgress, setActivePendingUserInputQuestionIndex]);

  const onSubmitPlanFollowUp = useCallback(
    async ({
      text,
      interactionMode: nextInteractionMode,
    }: {
      text: string;
      interactionMode: "default" | "plan";
    }) => {
      const api = readEnvironmentApi(environmentId);
      if (
        !api ||
        !activeThread ||
        !isServerThread ||
        isSendBusy ||
        isConnecting ||
        sendInFlightRef.current
      ) {
        return;
      }

      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }

      const sendCtx = composerRef.current?.getSendContext();
      if (!sendCtx) {
        return;
      }
      const {
        selectedProvider: ctxSelectedProvider,
        selectedModel: ctxSelectedModel,
        selectedProviderModels: ctxSelectedProviderModels,
        selectedPromptEffort: ctxSelectedPromptEffort,
        selectedModelSelection: ctxSelectedModelSelection,
      } = sendCtx;

      const threadIdForSend = activeThread.id;
      const messageIdForSend = newMessageId();
      const messageCreatedAt = new Date().toISOString();
      const outgoingMessageText = formatOutgoingPrompt({
        provider: ctxSelectedProvider,
        model: ctxSelectedModel,
        models: ctxSelectedProviderModels,
        effort: ctxSelectedPromptEffort,
        text: trimmed,
      });

      sendInFlightRef.current = true;
      beginLocalDispatch({ preparingWorktree: false });
      setThreadError(threadIdForSend, null);

      // Scroll to the current end *before* adding the optimistic message.
      isAtBottomRef.current = true;
      showScrollDebouncer.current.cancel();
      setShowScrollToBottom(false);
      await messagesTimelineControllerRef.current?.scrollToBottom({ animated: false });

      setOptimisticUserMessages((existing) => [
        ...existing,
        {
          id: messageIdForSend,
          role: "user",
          text: outgoingMessageText,
          createdAt: messageCreatedAt,
          streaming: false,
        },
      ]);

      try {
        await persistThreadSettingsForNextTurn({
          threadId: threadIdForSend,
          createdAt: messageCreatedAt,
          modelSelection: ctxSelectedModelSelection,
          runtimeMode,
          interactionMode: nextInteractionMode,
        });

        // Keep the mode toggle and plan-follow-up banner in sync immediately
        // while the same-thread implementation turn is starting.
        setComposerDraftInteractionMode(
          scopeThreadRef(activeThread.environmentId, threadIdForSend),
          nextInteractionMode,
        );

        await api.orchestration.dispatchCommand({
          type: "thread.turn.start",
          commandId: newCommandId(),
          threadId: threadIdForSend,
          message: {
            messageId: messageIdForSend,
            role: "user",
            text: outgoingMessageText,
            attachments: [],
          },
          modelSelection: ctxSelectedModelSelection,
          titleSeed: activeThread.title,
          runtimeMode,
          interactionMode: nextInteractionMode,
          ...(nextInteractionMode === "default" && activeProposedPlan
            ? {
                sourceProposedPlan: {
                  threadId: activeThread.id,
                  planId: activeProposedPlan.id,
                },
              }
            : {}),
          createdAt: messageCreatedAt,
        });
        // Optimistically open the plan sidebar when implementing (not refining).
        // "default" mode here means the agent is executing the plan, which produces
        // step-tracking activities that the sidebar will display.
        if (nextInteractionMode === "default") {
          planSidebarDismissedForTurnRef.current = null;
          setPlanSidebarOpen(true);
        }
        sendInFlightRef.current = false;
      } catch (err) {
        setOptimisticUserMessages((existing) =>
          existing.filter((message) => message.id !== messageIdForSend),
        );
        setThreadError(
          threadIdForSend,
          err instanceof Error ? err.message : "Failed to send plan follow-up.",
        );
        sendInFlightRef.current = false;
        resetLocalDispatch();
      }
    },
    [
      activeThread,
      activeProposedPlan,
      beginLocalDispatch,
      composerRef,
      isConnecting,
      isSendBusy,
      isServerThread,
      persistThreadSettingsForNextTurn,
      resetLocalDispatch,
      runtimeMode,
      setComposerDraftInteractionMode,
      setThreadError,
      environmentId,
    ],
  );

  const onImplementPlanInNewThread = useCallback(async () => {
    const api = readEnvironmentApi(environmentId);
    if (
      !api ||
      !activeThread ||
      !activeProject ||
      !activeProposedPlan ||
      !isServerThread ||
      isSendBusy ||
      isConnecting ||
      sendInFlightRef.current
    ) {
      return;
    }

    const sendCtx = composerRef.current?.getSendContext();
    if (!sendCtx) {
      return;
    }
    const {
      selectedProvider: ctxSelectedProvider,
      selectedModel: ctxSelectedModel,
      selectedProviderModels: ctxSelectedProviderModels,
      selectedPromptEffort: ctxSelectedPromptEffort,
      selectedModelSelection: ctxSelectedModelSelection,
    } = sendCtx;

    const createdAt = new Date().toISOString();
    const nextThreadId = newThreadId();
    const planMarkdown = activeProposedPlan.planMarkdown;
    const implementationPrompt = buildPlanImplementationPrompt(planMarkdown);
    const outgoingImplementationPrompt = formatOutgoingPrompt({
      provider: ctxSelectedProvider,
      model: ctxSelectedModel,
      models: ctxSelectedProviderModels,
      effort: ctxSelectedPromptEffort,
      text: implementationPrompt,
    });
    const nextThreadTitle = truncate(buildPlanImplementationThreadTitle(planMarkdown));
    const nextThreadModelSelection: ModelSelection = ctxSelectedModelSelection;

    sendInFlightRef.current = true;
    beginLocalDispatch({ preparingWorktree: false });
    const finish = () => {
      sendInFlightRef.current = false;
      resetLocalDispatch();
    };

    await api.orchestration
      .dispatchCommand({
        type: "thread.create",
        commandId: newCommandId(),
        threadId: nextThreadId,
        projectId: activeProject.id,
        title: nextThreadTitle,
        modelSelection: nextThreadModelSelection,
        runtimeMode,
        interactionMode: "default",
        branch: activeThreadBranch,
        worktreePath: activeThread.worktreePath,
        createdAt,
      })
      .then(() => {
        return api.orchestration.dispatchCommand({
          type: "thread.turn.start",
          commandId: newCommandId(),
          threadId: nextThreadId,
          message: {
            messageId: newMessageId(),
            role: "user",
            text: outgoingImplementationPrompt,
            attachments: [],
          },
          modelSelection: ctxSelectedModelSelection,
          titleSeed: nextThreadTitle,
          runtimeMode,
          interactionMode: "default",
          sourceProposedPlan: {
            threadId: activeThread.id,
            planId: activeProposedPlan.id,
          },
          createdAt,
        });
      })
      .then(() => {
        return waitForStartedServerThread(scopeThreadRef(activeThread.environmentId, nextThreadId));
      })
      .then(() => {
        // Signal that the plan sidebar should open on the new thread.
        planSidebarOpenOnNextThreadRef.current = true;
        return navigate({
          to: "/$environmentId/$threadId",
          params: {
            environmentId: activeThread.environmentId,
            threadId: nextThreadId,
          },
        });
      })
      .catch(async (err: unknown) => {
        await api.orchestration
          .dispatchCommand({
            type: "thread.delete",
            commandId: newCommandId(),
            threadId: nextThreadId,
          })
          .catch(() => undefined);
        toastManager.add({
          type: "error",
          title: "Could not start implementation thread",
          description:
            err instanceof Error ? err.message : "An error occurred while creating the new thread.",
        });
      })
      .then(finish, finish);
  }, [
    activeProject,
    activeProposedPlan,
    activeThreadBranch,
    activeThread,
    beginLocalDispatch,
    composerRef,
    isConnecting,
    isSendBusy,
    isServerThread,
    navigate,
    resetLocalDispatch,
    runtimeMode,
    environmentId,
  ]);

  const onProviderModelSelect = useCallback(
    (instanceId: ProviderInstanceId, model: string) => {
      if (!activeThread && routeKind !== "draft") return;
      const resolvedModel = resolveAppModelSelectionForInstance(
        instanceId,
        settings,
        providerStatuses,
        model,
      );
      if (resolvedModel === null) {
        scheduleComposerFocus();
        return;
      }
      const nextModelSelection: ModelSelection = {
        instanceId,
        model: resolvedModel,
      };
      setComposerDraftModelSelection(composerDraftTarget, nextModelSelection);
      setStickyComposerModelSelection(nextModelSelection);
      scheduleComposerFocus();
    },
    [
      composerDraftTarget,
      routeKind,
      scheduleComposerFocus,
      setComposerDraftModelSelection,
      setStickyComposerModelSelection,
      providerStatuses,
      settings,
      activeThread,
    ],
  );
  const onExpandTimelineImage = useCallback((preview: ExpandedImagePreview) => {
    setExpandedImage(preview);
  }, []);
  const renderEditComposer = useCallback(
    (message: ChatMessage): ReactNode => {
      if (!activeThread) {
        return null;
      }
      return (
        <InlineMessageEditComposer
          key={message.id}
          message={message}
          composerDraftTarget={editComposerDraftTarget}
          environmentId={environmentId}
          routeKind={routeKind}
          routeThreadRef={routeThreadRef}
          draftId={draftId}
          activeThreadId={activeThread.id}
          activeThreadEnvironmentId={activeThread.environmentId}
          activeThread={activeThread}
          isServerThread={isServerThread}
          isLocalDraftThread={isLocalDraftThread}
          phase={phase}
          isConnecting={isConnecting}
          isSendBusy={isSendBusy}
          isPreparingWorktree={isPreparingWorktree}
          runtimeMode={runtimeMode}
          interactionMode={interactionMode}
          providerStatuses={providerStatuses}
          activeProjectDefaultModelSelection={activeProject?.defaultModelSelection}
          activeThreadModelSelection={activeThread.modelSelection}
          activeThreadActivities={threadActivities}
          resolvedTheme={resolvedTheme}
          settings={settings}
          keybindings={keybindings}
          terminalOpen={Boolean(terminalState.terminalOpen)}
          gitCwd={gitCwd}
          activePlan={activePlan}
          sidebarProposedPlan={sidebarProposedPlan}
          planSidebarLabel={planSidebarLabel}
          planSidebarOpen={planSidebarOpen}
          onInterrupt={onInterrupt}
          onImplementPlanInNewThread={onImplementPlanInNewThread}
          togglePlanSidebar={togglePlanSidebar}
          setThreadError={setThreadError}
          onExpandImage={onExpandTimelineImage}
          onCancelEditUserMessage={onCancelEditUserMessage}
          onSubmitEditUserMessage={onSubmitEditUserMessage}
        />
      );
    },
    [
      activePlan,
      activeProject?.defaultModelSelection,
      activeThread,
      draftId,
      editComposerDraftTarget,
      environmentId,
      gitCwd,
      interactionMode,
      isConnecting,
      isLocalDraftThread,
      isSendBusy,
      isPreparingWorktree,
      isServerThread,
      keybindings,
      onCancelEditUserMessage,
      onExpandTimelineImage,
      onImplementPlanInNewThread,
      onInterrupt,
      onSubmitEditUserMessage,
      phase,
      planSidebarLabel,
      planSidebarOpen,
      providerStatuses,
      resolvedTheme,
      routeKind,
      routeThreadRef,
      runtimeMode,
      settings,
      setThreadError,
      sidebarProposedPlan,
      terminalState.terminalOpen,
      threadActivities,
      togglePlanSidebar,
    ],
  );
  const onOpenTurnDiff = useCallback(
    (turnId: TurnId, filePath?: string) => {
      if (!isServerThread) {
        return;
      }
      openGitWorkbench();
      void navigate({
        to: "/$environmentId/$threadId",
        params: {
          environmentId,
          threadId,
        },
        search: (previous) => {
          const rest = stripDiffSearchParams(previous);
          return filePath
            ? { ...rest, diff: "1", diffTurnId: turnId, diffFilePath: filePath, workbench: "git" }
            : { ...rest, diff: "1", diffTurnId: turnId, workbench: "git" };
        },
      });
    },
    [environmentId, isServerThread, navigate, openGitWorkbench, threadId],
  );

  const isHeroComposer = activeThread
    ? isLocalDraftThread && !threadHasStarted(activeThread)
    : false;

  if (!activeThread) {
    traceBrowserEvent(
      "chat-view.blank-fallback.no-active-thread",
      {
        routeKind,
        environmentId,
        threadId,
        draftId,
        hasRouteThreadRef: Boolean(routeThreadRef),
      },
      "warn",
    );
    return null;
  }

  if (isHeroComposer) {
    traceBrowserEvent("chat-view.render.hero-composer", {
      routeKind,
      environmentId,
      threadId,
      draftId,
      activeThreadId: activeThread.id,
      projectId: activeThread.projectId,
    });
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
      {/* Top bar */}
      <header
        className={cn(
          "agent-window-chat-header drag-region box-border flex h-(--multi-workbench-chrome-row-height) select-none items-start px-3 pt-(--multi-titlebar-control-row-top)",
          isElectron &&
            cn(
              reserveTitleBarControlInset &&
                "wco:pr-[calc(100vw-env(titlebar-area-width)-env(titlebar-area-x)+1em)]",
            ),
        )}
      >
        <ChatHeader
          activeThreadTitle={activeThread.title}
          activeProjectName={activeProject?.name}
          isGitRepo={isGitRepo}
          activeProjectScripts={activeProject?.scripts}
          preferredScriptId={
            activeProject ? (lastInvokedScriptByProjectId[activeProject.id] ?? null) : null
          }
          keybindings={keybindings}
          availableEditors={availableEditors}
          terminalAvailable={activeProject !== undefined}
          terminalOpen={terminalState.terminalOpen}
          terminalToggleShortcutLabel={terminalToggleShortcutLabel}
          diffToggleShortcutLabel={diffPanelShortcutLabel}
          diffOpen={diffOpen}
          onRunProjectScript={runProjectScript}
          onAddProjectScript={saveProjectScript}
          onUpdateProjectScript={updateProjectScript}
          onDeleteProjectScript={deleteProjectScript}
          onToggleTerminal={toggleTerminalVisibility}
          onToggleDiff={onToggleDiff}
        />
      </header>

      {/* Error banner */}
      <ProviderStatusBanner status={activeProviderStatus} />
      <ThreadErrorBanner
        error={activeThread.error}
        onDismiss={() => setThreadError(activeThread.id, null)}
      />
      {/* Main content area with optional plan sidebar */}
      <div className="flex min-h-0 min-w-0 flex-1">
        {/* Chat column */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Messages Wrapper — hidden in hero mode */}
          {!isHeroComposer && (
            <div className="relative flex min-h-0 flex-1 flex-col">
              <MessagesTimeline
                key={activeThread.id}
                isWorking={isWorking}
                activeTurnInProgress={isWorking || !latestTurnSettled}
                activeTurnId={activeLatestTurn?.turnId ?? null}
                activeTurnStartedAt={activeWorkStartedAt}
                bottomClearancePx={DOCKED_COMPOSER_TIMELINE_RESERVE_PX}
                timelineControllerRef={messagesTimelineControllerRef}
                timelineEntries={timelineEntries}
                completionDividerBeforeEntryId={completionDividerBeforeEntryId}
                completionSummary={completionSummary}
                turnDiffSummaryByAssistantMessageId={turnDiffSummaryByAssistantMessageId}
                activeThreadEnvironmentId={activeThread.environmentId}
                routeThreadKey={routeThreadKey}
                onOpenTurnDiff={onOpenTurnDiff}
                revertTurnCountByUserMessageId={revertTurnCountByUserMessageId}
                isRevertingCheckpoint={isRevertingCheckpoint}
                onImageExpand={onExpandTimelineImage}
                markdownCwd={gitCwd ?? undefined}
                resolvedTheme={resolvedTheme}
                projectRoot={activeProjectRoot}
                isServerThread={isServerThread}
                editingUserMessageId={activeEditingUserMessageId}
                onBeginEditUserMessage={onBeginEditUserMessage}
                renderEditComposer={renderEditComposer}
                showEmptyState={showTimelineEmptyState}
                awaitingServerThreadDetail={isServerThread && !serverThreadDetailLoaded}
                onIsAtBottomChange={onIsAtBottomChange}
              />

              {showScrollToBottom && (
                <div className="pointer-events-none absolute bottom-[calc(var(--multi-composer-compact-row-min-height)+var(--multi-composer-overlay-height)+var(--multi-composer-followup-padding-block-end)+8px)] left-1/2 z-30 flex -translate-x-1/2 justify-center py-1.5">
                  <button
                    type="button"
                    onClick={() => scrollTimelineToBottom(true)}
                    className="agent-panel-scroll-to-bottom-button pointer-events-auto"
                    aria-label="Scroll to bottom"
                    title="Scroll to bottom"
                  >
                    <IconChevronDownSmall className="ui-icon size-3" aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Input bar — centered when hero, docked when active thread */}
          <div
            className={cn(
              "agent-panel-followup-input",
              isHeroComposer ? "agent-panel-empty-state-shell" : undefined,
              isConnecting ? "agent-panel-followup-input--disabled" : undefined,
              !isHeroComposer ? "agent-panel-followup-input--conversation-overlay" : undefined,
            )}
            data-layout={isHeroComposer ? "wide" : undefined}
            {...(isConnecting ? { "data-disabled": "true" } : {})}
            {...(showScrollToBottom ? {} : { "data-scrolled-to-bottom": "" })}
          >
            <ChatComposer
              ref={composerRef}
              variant={isHeroComposer ? "hero" : "dock"}
              composerDraftTarget={composerDraftTarget}
              environmentId={environmentId}
              routeKind={routeKind}
              routeThreadRef={routeThreadRef}
              draftId={draftId}
              activeThreadId={activeThreadId}
              activeThreadEnvironmentId={activeThread?.environmentId}
              activeThread={activeThread}
              isServerThread={isServerThread}
              isLocalDraftThread={isLocalDraftThread}
              phase={phase}
              isConnecting={isConnecting}
              isSendBusy={isSendBusy}
              isPreparingWorktree={isPreparingWorktree}
              queuedComposerItems={queuedComposerItems}
              editingQueuedComposerItemId={editingQueuedComposerItemId}
              activePendingApproval={activePendingApproval}
              pendingApprovals={pendingApprovals}
              pendingUserInputs={pendingUserInputs}
              activePendingProgress={activePendingProgress}
              activePendingResolvedAnswers={activePendingResolvedAnswers}
              activePendingIsResponding={activePendingIsResponding}
              activePendingDraftAnswers={activePendingDraftAnswers}
              activePendingQuestionIndex={activePendingQuestionIndex}
              respondingRequestIds={respondingRequestIds}
              showPlanFollowUpPrompt={showPlanFollowUpPrompt}
              activeProposedPlan={activeProposedPlan}
              activePlan={activePlan}
              sidebarProposedPlan={sidebarProposedPlan}
              planSidebarLabel={planSidebarLabel}
              planSidebarOpen={planSidebarOpen}
              runtimeMode={runtimeMode}
              interactionMode={interactionMode}
              providerStatuses={providerStatuses}
              activeProjectDefaultModelSelection={activeProject?.defaultModelSelection}
              activeThreadModelSelection={activeThread?.modelSelection}
              activeThreadActivities={activeThread?.activities}
              resolvedTheme={resolvedTheme}
              settings={settings}
              keybindings={keybindings}
              terminalOpen={terminalState.terminalOpen}
              gitCwd={gitCwd}
              promptRef={promptRef}
              composerImagesRef={composerImagesRef}
              composerTerminalContextsRef={composerTerminalContextsRef}
              shouldAutoScrollRef={isAtBottomRef}
              scheduleStickToBottom={scrollTimelineToBottom}
              onSend={onSend}
              onInterrupt={onInterrupt}
              onImplementPlanInNewThread={onImplementPlanInNewThread}
              onRespondToApproval={onRespondToApproval}
              onSelectActivePendingUserInputOption={onSelectActivePendingUserInputOption}
              onAdvanceActivePendingUserInput={onAdvanceActivePendingUserInput}
              onPreviousActivePendingUserInputQuestion={onPreviousActivePendingUserInputQuestion}
              onChangeActivePendingUserInputCustomAnswer={
                onChangeActivePendingUserInputCustomAnswer
              }
              onProviderModelSelect={onProviderModelSelect}
              onBeginEditQueuedComposerItem={onBeginEditQueuedComposerItem}
              onCancelEditingQueuedComposerItem={onCancelEditingQueuedComposerItem}
              onRemoveQueuedComposerItem={onRemoveQueuedComposerItem}
              onSendQueuedComposerItemNow={onSendQueuedComposerItemNow}
              toggleInteractionMode={toggleInteractionMode}
              handleRuntimeModeChange={handleRuntimeModeChange}
              handleInteractionModeChange={handleInteractionModeChange}
              togglePlanSidebar={togglePlanSidebar}
              focusComposer={focusComposer}
              scheduleComposerFocus={scheduleComposerFocus}
              setThreadError={setThreadError}
              onExpandImage={onExpandTimelineImage}
            />
            {isHeroComposer ? (
              <HeroComposerActions
                activeProjectName={activeProject?.name ?? null}
                onAddProject={openAddProject}
                onOpenAppearance={openAppearanceSettings}
                onOpenProjects={openProject}
              />
            ) : null}
          </div>

          {pullRequestDialogState ? (
            <PullRequestThreadDialog
              key={pullRequestDialogState.key}
              open
              environmentId={activeThread.environmentId}
              threadId={activeThread.id}
              cwd={activeProject?.cwd ?? null}
              initialReference={pullRequestDialogState.initialReference}
              onOpenChange={(open) => {
                if (!open) {
                  closePullRequestDialog();
                }
              }}
              onPrepared={handlePreparedPullRequestThread}
            />
          ) : null}
        </div>
        {/* end chat column */}

        {/* Plan sidebar */}
        {planSidebarOpen ? (
          <PlanSidebar
            activePlan={activePlan}
            activeProposedPlan={sidebarProposedPlan}
            label={planSidebarLabel}
            environmentId={environmentId}
            markdownCwd={gitCwd ?? undefined}
            projectRoot={activeProjectRoot}
            timestampFormat={timestampFormat}
            onClose={() => {
              setPlanSidebarOpen(false);
              // Track that the user explicitly dismissed for this turn so auto-open won't fight them.
              planSidebarDismissedForTurnRef.current =
                activePlan?.turnId ?? sidebarProposedPlan?.turnId ?? "__dismissed__";
            }}
          />
        ) : null}
      </div>
      {/* end horizontal flex container */}

      {mountedTerminalThreadRefs.map(({ key: mountedThreadKey, threadRef: mountedThreadRef }) => (
        <PersistentThreadTerminalDrawer
          key={mountedThreadKey}
          threadRef={mountedThreadRef}
          threadId={mountedThreadRef.threadId}
          visible={mountedThreadKey === activeThreadKey && terminalState.terminalOpen}
          launchContext={
            mountedThreadKey === activeThreadKey ? (activeTerminalLaunchContext ?? null) : null
          }
          focusRequestId={mountedThreadKey === activeThreadKey ? terminalFocusRequestId : 0}
          splitShortcutLabel={splitTerminalShortcutLabel ?? undefined}
          newShortcutLabel={newTerminalShortcutLabel ?? undefined}
          closeShortcutLabel={closeTerminalShortcutLabel ?? undefined}
          onAddTerminalContext={addTerminalContextToDraft}
        />
      ))}

      {expandedImage && (
        <ExpandedImageDialog preview={expandedImage} onClose={closeExpandedImage} />
      )}
    </div>
  );
}
