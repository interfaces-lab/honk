import {
  type ApprovalRequestId,
  type DesktopExtensionUiRequest,
  type EnvironmentId,
  type GitBranch,
  MessageId,
  type ModelSelection,
  type ProjectScript,
  type ProjectId,
  type ScopedProjectRef,
  type RuntimeApprovalDecision,
  type ScopedThreadRef,
  type ThreadId,
  type KeybindingCommand,
  type ResolvedKeybindingsConfig,
  type OrchestrationThreadActivity,
  type AgentInteractionMode,
} from "@multi/contracts";
import {
  parseScopedThreadKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "~/lib/environment-scope";
import { projectScriptRuntimeEnv } from "@multi/shared/project-scripts";
import { Debouncer } from "@tanstack/react-pacer";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@multi/multikit/alert";
import { Button } from "@multi/multikit/button";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { useShallow } from "zustand/react/shallow";
import {
  deriveLatestContextWindowSnapshot,
  type ContextWindowSnapshot,
} from "~/lib/context-window";
import { getGitStatusSnapshot, useGitStatus } from "~/lib/git-status-state";
import { readEnvironmentApi } from "../../../environment-api";
import { usePrimaryEnvironmentId } from "../../../environments/primary";
import {
  type PreparedRuntimeTurnPolicy,
  prepareRuntimeTurnPolicy,
} from "~/lib/runtime-turn-dispatch";
import { coordinateTurnSend, dispatchTurnStartFailure } from "~/lib/turn-send-coordinator";
import { isElectron } from "../../../env";
import { readLocalApi } from "../../../local-api";
import {
  collapseExpandedComposerCursor,
  isUnresolvedStandaloneComposerSlashCommand,
  parseStandaloneComposerSlashCommand,
} from "../composer/prompt-triggers";
import {
  derivePendingApprovals,
  derivePhase,
  deriveActiveWorkStartedAt,
  findLatestProposedPlan,
  deriveWorkLogEntries,
  hasActionableProposedPlan,
  isLatestTurnSettled,
  type PendingApproval,
  type ToolDisplayArtifact,
  type WorkLogEntry,
  type WorkLogSubagent,
} from "../../../session-logic";
import {
  selectEnvironmentState,
  selectProjectsAcrossEnvironments,
  selectThreadExistsByRef,
  selectThreadKeysAcrossEnvironments,
  useStore,
} from "../../../stores/thread-store";
import {
  createProjectSelectorByRef,
  createThreadSelectorByRef,
} from "../../../stores/thread-selectors";
import { useUiStateStore } from "../../../stores/ui-state-store";
import {
  selectIsRuntimeThread,
  selectPendingExtensionUiRequestsForThread,
  useAgentRuntimeStore,
} from "../../../stores/agent-runtime-store";
import {
  normalizePlanMarkdownForExport,
  resolvePlanFollowUpSubmission,
} from "~/plan/proposed-plan";
import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  MAX_TERMINALS_PER_GROUP,
  type ChatMessage,
  type ProposedPlan,
  type SessionPhase,
  type ThreadSendIntent,
  type Thread,
} from "../../../types";
import { useTheme } from "../../../hooks/use-theme";
import { buildTemporaryWorktreeBranchName } from "@multi/shared/git";
import { shortcutLabelForCommand } from "../../../keybindings";
import { cn, randomUUID } from "~/lib/utils";
import { toastManager } from "~/app/toast";
import ProjectScriptsControl, { type NewProjectScriptInput } from "../../project-scripts-control";
import {
  commandForProjectScript,
  decodeProjectScriptKeybindingRule,
  nextProjectScriptId,
} from "~/lib/project-scripts";
import { newCommandId, newMessageId, newThreadId } from "~/lib/utils";
import { useSettings } from "../../../hooks/use-settings";
import { useNewThreadHandler } from "../../../hooks/use-handle-new-thread";
import { useSelectedWorkspaceProject } from "../../../lib/selected-workspace-project";
import { readMultiRuntimeApi } from "../../../lib/multi-runtime-api";
import { openWorkspaceFolder } from "../../../lib/project-selection";
import { resolveProjectlessCwd, writeStoredProjectSelection } from "../../../lib/project-state";
import { findWorkspaceProjectForSource, resolveWorkspaceTarget } from "~/lib/workspace-target";
import { deriveLogicalProjectKey } from "../../../stores/project-identity";
import { openDraft } from "~/app/chat-navigation";
import {
  type ComposerImageAttachment,
  type DraftThreadEnvMode,
  DraftId,
  useComposerDraftStore,
  type DraftId as ComposerDraftId,
} from "../../../stores/chat-drafts";
import { type QueuedComposerItem } from "../../../stores/chat-send-queue";
import { ComposerPendingExtensionUiRequestPanel } from "../composer/pending/extension-ui-request-panel";
import { selectThreadTerminalState, useTerminalStateStore } from "../../../terminal-state-store";
import {
  readTerminalSessions,
  shellPanelsActions,
  useActiveTab,
  useIsMuted,
  useRightOpen,
} from "~/stores/shell-panels-store";
import {
  readWorkbenchTerminalApi,
  workbenchTerminalThreadId,
} from "~/components/shell/terminal/workbench-terminal";
import { ComposerInput, type ComposerInputHandle } from "../composer/input";
import { useSubagentTrayStore } from "../../../stores/subagent-tray-store";
import { ExpandedImageDialog } from "../message/expanded-image-dialog";
import { PullRequestThreadDialog } from "../../pull-request-thread-dialog";
import { MessagesTimeline, type MessagesTimelineController } from "../timeline/messages-timeline";
import { ChatHeader } from "./chat-header";
import {
  PersistentThreadTerminalDrawer,
  type TerminalLaunchContext,
} from "./persistent-thread-terminal-drawer";
import {
  InlineMessageEditComposer,
  type InlineEditSubmitInput,
} from "./inline-message-edit-composer";
import { type ExpandedImagePreview } from "../message/expanded-image-preview";
import { gitCheckoutMutationOptions } from "../../../lib/git-react-query";
import { ThreadErrorBanner } from "../message/error-banner";
import { cloneComposerImageForRetry, resolveSendEnvMode } from "../composer/send";
import { createQueuedComposerItem } from "./chat-view-send-flow";
import {
  compileComposerSubmitTurn,
  deriveComposerSendState,
  prepareComposerTurnAttachments,
} from "../composer-submit";
import { revokeUserMessagePreviewUrls } from "../message/preview-url-lifecycle";
import {
  buildLocalDraftThread,
  createLocalDispatchSnapshot,
  hasServerAcknowledgedLocalDispatch,
  isNewThreadHeroDraft,
  LAST_INVOKED_SCRIPT_BY_PROJECT_KEY,
  LastInvokedScriptByProjectSchema,
  type LocalDispatchSnapshot,
  type PullRequestDialogState,
  shouldWriteThreadErrorToCurrentServerThread,
  threadExistsBeforeSend,
  threadHasRenderableUserStart,
} from "./thread-lifecycle";
import { useLocalStorage } from "~/hooks/use-local-storage";
import { useComposerHandleContext } from "../composer/context/handle-context";
import {
  useServerAvailableEditors,
  useServerConfig,
  useServerKeybindings,
} from "~/rpc/server-state";
import {
  formatSchemaBackedTransportErrorDescription,
  sanitizeThreadErrorMessage,
} from "~/rpc/transport-error";
import { IconChevronRightMedium, IconExclamationCircle } from "central-icons";
import { useAttachmentPreviewHandoff } from "./attachment-preview-handoff";
import { WorkspaceToolbar, type WorkspaceToolbarProject } from "./workspace-toolbar";
import {
  applyLocalThreadCreated,
  applyLocalThreadTurnStartRequested,
} from "~/stores/local-orchestration-events";
import {
  type ComposerSendSnapshot,
  assertActiveThread,
  nextComposerInteractionMode,
} from "./chat-view.logic";
import {
  containsThreadEntry,
  deriveThreadBranchView,
  filterActivitiesToBranch,
  filterMessagesToBranch,
  findThreadMessageEntry,
} from "./thread-branch-view";
import { useThreadBranchWorktree } from "./use-thread-branch-worktree";
import { useThreadComposerQueue } from "./use-thread-composer-queue";
import { useThreadPendingUserInput } from "./use-thread-pending-user-input";
import {
  ActiveThreadComposerFocusSync,
  ActiveThreadUiResetSync,
  ChatViewKeyboardShortcutsSync,
  MarkSettledServerThreadVisitedSync,
  MountedTerminalThreadsSync,
  RetainServerThreadDetailSync,
  RuntimeThreadHydrationSync,
  TerminalLaunchActiveThreadSync,
  TerminalLaunchClosedSync,
  TerminalLaunchLocalSettledSync,
  TerminalLaunchStoredSettledSync,
  TerminalOpenFocusSync,
  ThreadMediaResetSync,
  ThreadSendIntentsServerAckSync,
} from "./chat-view-lifecycle-sync";
import {
  filterThreadSendIntentsToBranch,
  runtimeDisplayTimelineHasResponseItem,
  runtimeDisplayTimelineRenderableUserMessageIds,
  threadSendIntentMessages,
} from "./thread-timeline-projector";
import { useThreadTimeline } from "./use-thread-timeline";
import {
  createThreadSendIntent,
  EMPTY_THREAD_SEND_INTENTS,
  useThreadSendIntentStore,
} from "~/stores/thread-send-intent-store";

const EMPTY_ACTIVITIES: OrchestrationThreadActivity[] = [];
const EMPTY_PENDING_APPROVALS: PendingApproval[] = [];
const EMPTY_THREAD_MESSAGES: ChatMessage[] = [];
const EMPTY_TIMELINE_PROPOSED_PLANS: Thread["proposedPlans"] = [];
const EMPTY_THREAD_KEYS: readonly string[] = [];
const EMPTY_WORK_LOG_ENTRIES: WorkLogEntry[] = [];
const DOCKED_COMPOSER_TIMELINE_RESERVE_PX = 96;

type NewAgentFooterTipSegment =
  | {
      readonly kind: "text";
      readonly text: string;
    }
  | {
      readonly kind: "token";
      readonly text: string;
    };

interface NewAgentFooterTip {
  readonly segments: readonly NewAgentFooterTipSegment[];
}

function stableTipIndex(seed: string, length: number): number {
  if (length <= 1) {
    return 0;
  }
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (Math.imul(hash, 31) + seed.charCodeAt(index)) >>> 0;
  }
  return hash % length;
}

function getNewAgentFooterTip(input: {
  readonly interactionMode: AgentInteractionMode;
  readonly stableKey: string;
  readonly workspaceName: string | null;
}): NewAgentFooterTip {
  const reviewTip: NewAgentFooterTip = {
    segments: [
      { kind: "text", text: "Use " },
      { kind: "token", text: "/review" },
      {
        kind: "text",
        text: " to have Multi find bugs, regressions, security issues, and missing tests",
      },
    ],
  };
  const tips: [NewAgentFooterTip, ...NewAgentFooterTip[]] = [
    reviewTip,
    {
      segments: [
        { kind: "text", text: "Use " },
        { kind: "token", text: "/" },
        { kind: "text", text: " to find skills and commands" },
      ],
    },
    {
      segments: [
        { kind: "text", text: "Use " },
        { kind: "token", text: "@" },
        {
          kind: "text",
          text: input.workspaceName
            ? ` to add files and context from ${input.workspaceName}`
            : " to add files and context",
        },
      ],
    },
  ];

  if (input.interactionMode !== "plan") {
    tips.push({
      segments: [
        { kind: "text", text: "Use " },
        { kind: "token", text: "Plan New Idea" },
        { kind: "text", text: " to explore before building" },
      ],
    });
  }

  return tips[stableTipIndex(input.stableKey, tips.length)] ?? reviewTip;
}

function NewAgentFooterTip(props: { readonly tip: NewAgentFooterTip }) {
  return (
    <div data-new-agent-footer-tip="">
      {props.tip.segments.map((segment, index) =>
        segment.kind === "token" ? (
          <span key={index} data-new-agent-tip-token="">
            {segment.text}
          </span>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </div>
  );
}

function committedMessageIdsKey(messages: readonly ChatMessage[] | undefined): string {
  return messages?.map((message) => message.id).join("\0") ?? "";
}

function projectScriptsKey(scripts: readonly ProjectScript[] | null | undefined): string {
  return JSON.stringify(
    scripts?.map((script) => [
      script.id,
      script.name,
      script.command,
      script.icon,
      script.runOnWorktreeCreate,
    ]) ?? null,
  );
}

function keybindingsConfigKey(keybindings: ResolvedKeybindingsConfig): string {
  return JSON.stringify(keybindings);
}

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

function useLocalDispatchState(input: {
  threadKey: string;
  activeThread: Thread | undefined;
  activeLatestTurn: Thread["latestTurn"] | null;
  phase: SessionPhase;
  activePendingApproval: ApprovalRequestId | null;
  activePendingUserInput: ApprovalRequestId | null;
  threadError: string | null | undefined;
}) {
  const localDispatch = useThreadSendIntentStore(
    (store) => store.localDispatchByThreadKey[input.threadKey] ?? null,
  );
  const setStoredLocalDispatch = useThreadSendIntentStore((store) => store.setLocalDispatch);
  const clearStoredLocalDispatch = useThreadSendIntentStore((store) => store.clearLocalDispatch);

  const beginLocalDispatch = (options?: { preparingWorktree?: boolean }) => {
    const preparingWorktree = Boolean(options?.preparingWorktree);
    const currentDispatch =
      useThreadSendIntentStore.getState().localDispatchByThreadKey[input.threadKey] ?? null;
    if (currentDispatch) {
      if (currentDispatch.preparingWorktree !== preparingWorktree) {
        setStoredLocalDispatch(input.threadKey, { ...currentDispatch, preparingWorktree });
      }
      return;
    }
    setStoredLocalDispatch(
      input.threadKey,
      createLocalDispatchSnapshot(input.activeThread, options),
    );
  };

  const resetLocalDispatch = () => {
    clearStoredLocalDispatch(input.threadKey);
  };

  const serverAcknowledgedLocalDispatch = hasServerAcknowledgedLocalDispatch({
    localDispatch,
    phase: input.phase,
    latestTurn: input.activeLatestTurn,
    session: input.activeThread?.session ?? null,
    hasPendingApproval: input.activePendingApproval !== null,
    hasPendingUserInput: input.activePendingUserInput !== null,
    threadError: input.threadError,
  });

  useEffect(() => {
    if (serverAcknowledgedLocalDispatch && localDispatch !== null) {
      clearStoredLocalDispatch(input.threadKey);
    }
  }, [clearStoredLocalDispatch, input.threadKey, localDispatch, serverAcknowledgedLocalDispatch]);

  return {
    beginLocalDispatch,
    resetLocalDispatch,
    localDispatchStartedAt: localDispatch?.startedAt ?? null,
    isPreparingWorktree: localDispatch?.preparingWorktree ?? false,
    isSendBusy: localDispatch !== null && !serverAcknowledgedLocalDispatch,
  };
}

export default function ChatView(props: ChatViewProps) {
  const { environmentId, threadId, routeKind, reserveTitleBarControlInset = true } = props;
  const draftId = routeKind === "draft" ? props.draftId : null;
  const routeThreadRef = useMemo(
    () => scopeThreadRef(environmentId, threadId),
    [environmentId, threadId],
  );
  const routeThreadKey = scopedThreadKey(routeThreadRef);
  const editComposerDraftTarget = DraftId.make(`inline-message-edit:${routeThreadKey}`);
  const composerDraftTarget: ScopedThreadRef | ComposerDraftId =
    routeKind === "draft" ? props.draftId : routeThreadRef;
  const serverThreadSelector = useMemo(
    () => createThreadSelectorByRef(routeKind === "server" ? routeThreadRef : null),
    [routeKind, routeThreadRef],
  );
  const serverThread = useStore(serverThreadSelector);
  const serverThreadDetailLoaded = useStore((store) => {
    if (routeKind !== "server") {
      return true;
    }
    const environmentState = selectEnvironmentState(store, environmentId);
    return Object.prototype.hasOwnProperty.call(environmentState.messageIdsByThreadId, threadId);
  });
  const setStoreThreadError = useStore((store) => store.setError);
  const markThreadVisited = useUiStateStore((store) => store.markThreadVisited);
  const activeThreadLastVisitedAt = useUiStateStore((store) =>
    routeKind === "server" ? store.threadLastVisitedAtById[routeThreadKey] : undefined,
  );
  const settings = useSettings();
  const workspaceProjects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const {
    projectCwd: selectedProjectCwd,
    projectEnvironmentId: selectedProjectEnvironmentId,
    projectRef: selectedProjectRef,
  } = useSelectedWorkspaceProject();
  const { handleNewThread: handleWorkspaceNewThread } = useNewThreadHandler();
  const selectedWorkspaceProjectSelector = useMemo(
    () => createProjectSelectorByRef(selectedProjectRef),
    [selectedProjectRef?.environmentId, selectedProjectRef?.projectId],
  );
  const selectedWorkspaceProject = useStore(selectedWorkspaceProjectSelector);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { resolvedTheme } = useTheme();
  // Granular store selectors avoid subscribing to prompt changes.
  const composerInteractionMode = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.interactionMode ?? null,
  );
  const setComposerDraftPrompt = useComposerDraftStore((store) => store.setPrompt);
  const addComposerDraftImages = useComposerDraftStore((store) => store.addImages);
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
  const draftThread = useComposerDraftStore((store) => {
    if (routeKind === "draft" && draftId) {
      return store.getDraftSession(draftId);
    }
    return null;
  });
  const composerImagesRef = useRef<ComposerImageAttachment[]>([]);
  const localComposerRef = useRef<ComposerInputHandle | null>(null);
  const composerRef = useComposerHandleContext() ?? localComposerRef;
  const [editingUserMessageId, setEditingUserMessageId] = useState<MessageId | null>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [expandedImage, setExpandedImage] = useState<ExpandedImagePreview | null>(null);
  const threadSendIntents = useThreadSendIntentStore(
    (store) => store.sendIntentsByThreadKey[routeThreadKey] ?? EMPTY_THREAD_SEND_INTENTS,
  );
  const appendThreadSendIntent = useThreadSendIntentStore((store) => store.appendSendIntent);
  const copyThreadSendIntents = useThreadSendIntentStore((store) => store.copySendIntents);
  const copyLocalDispatch = useThreadSendIntentStore((store) => store.copyLocalDispatch);
  const clearThreadLocalDispatch = useThreadSendIntentStore((store) => store.clearLocalDispatch);
  const removeThreadSendIntents = useThreadSendIntentStore((store) => store.removeSendIntents);
  const markLocalRuntimeThread = useAgentRuntimeStore((store) => store.markLocalRuntimeThread);
  const clearLocalRuntimeThread = useAgentRuntimeStore((store) => store.clearLocalRuntimeThread);
  const revokeThreadSendIntentMessages = (intents: ReadonlyArray<ThreadSendIntent>) => {
    for (const message of threadSendIntentMessages(intents)) {
      revokeUserMessagePreviewUrls(message);
    }
  };
  const removeThreadSendIntentsByClientMessageId = (messageId: MessageId) => {
    const removedIntents = removeThreadSendIntents(routeThreadKey, new Set([messageId]));
    revokeThreadSendIntentMessages(removedIntents);
  };
  const clearUnconfirmedLocalTurnStart = (
    targetEnvironmentId: EnvironmentId,
    targetThreadId: ThreadId,
    messageId: MessageId,
  ) => {
    useStore.getState().clearUnconfirmedLocalTurnStart({
      environmentId: targetEnvironmentId,
      threadId: targetThreadId,
      messageId,
    });
  };
  const clearUnconfirmedLocalThread = (
    targetEnvironmentId: EnvironmentId,
    targetThreadId: ThreadId,
  ) => {
    useStore.getState().clearUnconfirmedLocalThread({
      environmentId: targetEnvironmentId,
      threadId: targetThreadId,
    });
  };
  const [localDraftErrorsByDraftId, setLocalDraftErrorsByDraftId] = useState<
    Record<string, string | null>
  >({});
  const setThreadError = (targetThreadId: ThreadId | null, error: string | null) => {
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
  };
  const [isConnecting, _setIsConnecting] = useState(false);
  const [respondingRequestIds, setRespondingRequestIds] = useState<ApprovalRequestId[]>([]);
  const [terminalFocusRequestId, setTerminalFocusRequestId] = useState(0);
  const [pullRequestDialogState, setPullRequestDialogState] =
    useState<PullRequestDialogState | null>(null);
  const [terminalLaunchContext, setTerminalLaunchContext] = useState<TerminalLaunchContext | null>(
    null,
  );
  const [lastInvokedScriptByProjectId, setLastInvokedScriptByProjectId] = useLocalStorage(
    LAST_INVOKED_SCRIPT_BY_PROJECT_KEY,
    {},
    LastInvokedScriptByProjectSchema,
  );
  const messagesTimelineControllerRef = useRef<MessagesTimelineController | null>(null);
  const isAtBottomRef = useRef(true);
  const sendInFlightRef = useRef(false);
  const terminalOpenByThreadRef = useRef<Record<string, boolean>>({});

  const fallbackDraftProject = draftThread
    ? findWorkspaceProjectForSource(workspaceProjects, draftThread)
    : null;
  const localDraftError =
    routeKind === "server" && serverThread
      ? null
      : ((draftId ? localDraftErrorsByDraftId[draftId] : null) ?? null);
  const localDraftThread = draftThread
    ? buildLocalDraftThread(
        threadId,
        draftThread,
        settings.textGenerationModelSelection ?? fallbackDraftProject?.defaultModelSelection,
        localDraftError,
      )
    : undefined;
  const composerUsesLocalDraftThread = routeKind === "draft";
  const isServerThread =
    routeKind === "server" && serverThread !== undefined && !composerUsesLocalDraftThread;
  const activeThread = isServerThread ? serverThread : localDraftThread;
  const interactionMode =
    composerInteractionMode ?? activeThread?.interactionMode ?? DEFAULT_INTERACTION_MODE;
  const isLocalDraftThread = !isServerThread && localDraftThread !== undefined;
  const activeThreadId = activeThread?.id ?? null;
  // Scoped to this view's thread so tray activity elsewhere never re-renders it.
  const subagentTrayPresented = useSubagentTrayStore(
    (state) => state.presented && state.focus?.activeThreadId === activeThreadId,
  );
  const closeSubagentTray = useSubagentTrayStore((state) => state.closeTray);
  const isNewThreadHero = isNewThreadHeroDraft({
    activeThread,
    isLocalDraftThread,
    pendingLocalSendCount: threadSendIntents.length,
    promotedTo: draftThread?.promotedTo,
  });
  const terminalState = useTerminalStateStore((state) =>
    selectThreadTerminalState(
      state.terminalStateByThreadKey,
      isNewThreadHero ? null : routeThreadRef,
    ),
  );
  const openTerminalThreadKeys = useTerminalStateStore(
    useShallow((state) => {
      if (isNewThreadHero) {
        return EMPTY_THREAD_KEYS;
      }
      return Object.entries(state.terminalStateByThreadKey).flatMap(
        ([nextThreadKey, nextTerminalState]) =>
          nextTerminalState.terminalOpen ? [nextThreadKey] : [],
      );
    }),
  );
  const storeSetTerminalOpen = useTerminalStateStore((s) => s.setTerminalOpen);
  const storeSplitTerminal = useTerminalStateStore((s) => s.splitTerminal);
  const storeNewTerminal = useTerminalStateStore((s) => s.newTerminal);
  const storeCloseTerminal = useTerminalStateStore((s) => s.closeTerminal);
  const serverThreadKeys = useStore(
    useShallow((store) =>
      isNewThreadHero ? EMPTY_THREAD_KEYS : selectThreadKeysAcrossEnvironments(store),
    ),
  );
  const storeServerTerminalLaunchContext = useTerminalStateStore((s) =>
    isNewThreadHero
      ? null
      : (s.terminalLaunchContextByThreadKey[scopedThreadKey(routeThreadRef)] ?? null),
  );
  const storeClearTerminalLaunchContext = useTerminalStateStore(
    (s) => s.clearTerminalLaunchContext,
  );
  const draftThreadKeys = useComposerDraftStore(
    useShallow((store) => {
      if (isNewThreadHero) {
        return EMPTY_THREAD_KEYS;
      }
      return Object.values(store.draftThreadsByThreadKey).map((draftThread) =>
        scopedThreadKey(scopeThreadRef(draftThread.environmentId, draftThread.threadId)),
      );
    }),
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
  const runtimeThreadId = isNewThreadHero ? null : activeThreadId;
  const activeRuntimeDisplayTimeline = useAgentRuntimeStore((state) =>
    runtimeThreadId
      ? (state.snapshot.displayTimelines.find(
          (timeline) => timeline.threadId === runtimeThreadId,
        ) ?? null)
      : null,
  );
  const activeThreadIsRuntimeOwned = useAgentRuntimeStore((state) =>
    selectIsRuntimeThread(state, runtimeThreadId),
  );
  const activeThreadRef = activeThread
    ? scopeThreadRef(activeThread.environmentId, activeThread.id)
    : null;
  const activeThreadKey = activeThreadRef ? scopedThreadKey(activeThreadRef) : null;
  const existingOpenTerminalThreadKeys = useMemo(() => {
    const existingThreadKeys = new Set<string>([...serverThreadKeys, ...draftThreadKeys]);
    return openTerminalThreadKeys.filter((nextThreadKey) => existingThreadKeys.has(nextThreadKey));
  }, [draftThreadKeys, openTerminalThreadKeys, serverThreadKeys]);
  const activeLatestTurn = activeThread?.latestTurn ?? null;
  const latestTurnSettled = isLatestTurnSettled(activeLatestTurn, activeThread?.session ?? null);
  const activeProject = activeThread
    ? findWorkspaceProjectForSource(workspaceProjects, activeThread)
    : null;
  const activeProjectRef = activeProject
    ? scopeProjectRef(activeProject.environmentId, activeProject.id)
    : null;
  const handleWorkspaceProjectSelect = async (
    projectRef: ScopedProjectRef,
    options?: { logicalProjectKey?: string | null },
  ) => {
    const currentWorkspaceProjects = selectProjectsAcrossEnvironments(useStore.getState());
    const selectedProject = currentWorkspaceProjects.find(
      (project) =>
        project.environmentId === projectRef.environmentId && project.id === projectRef.projectId,
    );
    if (!selectedProject) {
      return handleWorkspaceNewThread(projectRef, {
        envMode: settings.defaultThreadEnvMode,
        logicalProjectKey: options?.logicalProjectKey ?? null,
      });
    }
    writeStoredProjectSelection({
      environmentId: selectedProject.environmentId,
      projectId: selectedProject.id,
      cwd: selectedProject.cwd,
    });
    return handleWorkspaceNewThread(projectRef, {
      envMode: settings.defaultThreadEnvMode,
      logicalProjectKey: options?.logicalProjectKey ?? deriveLogicalProjectKey(selectedProject),
    });
  };
  const closePullRequestDialog = () => {
    setPullRequestDialogState(null);
  };

  const openOrReuseProjectDraftThread = async (input: {
    branch: string;
    worktreePath: string | null;
    envMode: DraftThreadEnvMode;
  }) => {
    if (!workspaceProject) {
      throw new Error("No active project is available for this pull request.");
    }
    const activeProjectRef = scopeProjectRef(workspaceProject.environmentId, workspaceProject.id);
    const logicalProjectKey = deriveLogicalProjectKey(workspaceProject);
    const storedDraftSession = getDraftSessionByLogicalProjectKey(logicalProjectKey);
    if (storedDraftSession && storedDraftSession.promotedTo == null) {
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
        await openDraft(router, storedDraftSession.draftId);
      }
      return storedDraftSession.threadId;
    }

    const activeDraftSession = routeKind === "draft" && draftId ? getDraftSession(draftId) : null;
    if (!isServerThread && activeDraftSession?.logicalProjectKey === logicalProjectKey && draftId) {
      setDraftThreadContext(draftId, input);
      setLogicalProjectDraftThreadId(logicalProjectKey, activeProjectRef, draftId, {
        threadId: activeDraftSession.threadId,
        createdAt: activeDraftSession.createdAt,
        interactionMode: activeDraftSession.interactionMode,
        ...input,
      });
      return activeDraftSession.threadId;
    }

    const nextDraftId = DraftId.make(
      `new-thread-draft:project:${activeProjectRef.environmentId}:${activeProjectRef.projectId}`,
    );
    setLogicalProjectDraftThreadId(logicalProjectKey, activeProjectRef, nextDraftId, {
      threadId: newThreadId(),
      createdAt: new Date().toISOString(),
      interactionMode: DEFAULT_INTERACTION_MODE,
      ...input,
    });
    clearComposerDraftContent(nextDraftId);
    setDraftThreadContext(nextDraftId, input);
    await openDraft(router, nextDraftId);
    const nextDraftSession = getDraftSession(nextDraftId);
    if (!nextDraftSession) {
      throw new Error("Could not open a new project draft thread.");
    }
    return nextDraftSession.threadId;
  };

  const handlePreparedPullRequestThread = async (input: {
    branch: string;
    worktreePath: string | null;
  }) => {
    await openOrReuseProjectDraftThread({
      branch: input.branch,
      worktreePath: input.worktreePath,
      envMode: input.worktreePath ? "worktree" : "local",
    });
  };

  const phase = useMemo(() => derivePhase(activeThread?.session ?? null), [activeThread?.session]);
  const threadActivities = activeThread?.activities ?? EMPTY_ACTIVITIES;
  const sharedThreadActivities = useSharedChatActivities(threadActivities);
  const activeContextWindow = useStableLatestContextWindowSnapshot(sharedThreadActivities);
  const leafId = activeThread?.leafId ?? null;
  const branchViewEntryId = containsThreadEntry(activeThread ?? null, leafId) ? leafId : null;
  const branchView = useMemo(
    () => deriveThreadBranchView(activeThread ?? null, branchViewEntryId),
    [activeThread, branchViewEntryId],
  );
  const visibleThreadActivities = useMemo(
    () => filterActivitiesToBranch(sharedThreadActivities, branchView),
    [branchView, sharedThreadActivities],
  );
  const orchestrationTurnActive =
    activeThread?.session?.orchestrationStatus === "starting" ||
    activeThread?.session?.orchestrationStatus === "running";
  const activeRunningTurnId = orchestrationTurnActive
    ? (activeThread?.session?.activeTurnId ?? activeLatestTurn?.turnId ?? null)
    : null;
  const derivedWorkLogEntries = useMemo(
    () =>
      deriveWorkLogEntries(visibleThreadActivities, undefined, {
        activeRunningTurnId,
      }),
    [activeRunningTurnId, visibleThreadActivities],
  );
  const workLogEntries = useStableCompletedWorkLogEntries(derivedWorkLogEntries);
  const pendingApprovals = useMemo(
    () =>
      latestTurnSettled
        ? EMPTY_PENDING_APPROVALS
        : derivePendingApprovals(sharedThreadActivities, activeLatestTurn?.turnId ?? null),
    [activeLatestTurn?.turnId, latestTurnSettled, sharedThreadActivities],
  );
  const {
    pendingUserInputs,
    activePendingUserInput,
    activePendingDraftAnswers,
    activePendingQuestionIndex,
    activePendingProgress,
    activePendingResolvedAnswers,
    activePendingIsResponding,
    onAdvanceActivePendingUserInput,
    onSelectActivePendingUserInputOption,
    onChangeActivePendingUserInputCustomAnswer,
    onPreviousActivePendingUserInputQuestion,
  } = useThreadPendingUserInput({
    composerRef,
    environmentId,
    activeThreadId,
    threadActivities: sharedThreadActivities,
    activeLatestTurnTurnId: activeLatestTurn?.turnId ?? null,
    latestTurnSettled,
    setThreadError,
  });
  const pendingExtensionUiRequests = useAgentRuntimeStore((state) =>
    selectPendingExtensionUiRequestsForThread(state, runtimeThreadId),
  );
  const activePendingExtensionUiRequest = pendingExtensionUiRequests[0] ?? null;
  const [respondingExtensionUiRequestIds, setRespondingExtensionUiRequestIds] = useState<string[]>(
    [],
  );
  const activeProposedPlan = useMemo(() => {
    if (!latestTurnSettled) {
      return null;
    }
    return findLatestProposedPlan(
      activeThread?.proposedPlans ?? [],
      activeLatestTurn?.turnId ?? null,
    );
  }, [activeLatestTurn?.turnId, activeThread?.proposedPlans, latestTurnSettled]);
  const activeProposedPlanSourceThreadId =
    activeProposedPlan && activeThread
      ? activeLatestTurn?.sourceProposedPlan?.planId === activeProposedPlan.id
        ? activeLatestTurn.sourceProposedPlan.threadId
        : activeThread.id
      : null;
  const showPlanFollowUpPrompt =
    pendingUserInputs.length === 0 &&
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
    threadKey: routeThreadKey,
    activeThread,
    activeLatestTurn,
    phase,
    activePendingApproval: activePendingApproval?.requestId ?? null,
    activePendingUserInput: activePendingUserInput?.requestId ?? null,
    threadError: activeThread?.error,
  });
  const runtimeTimelineHasResponse = useMemo(
    () => runtimeDisplayTimelineHasResponseItem(activeRuntimeDisplayTimeline),
    [activeRuntimeDisplayTimeline],
  );
  const waitingForRuntimeFirstResponse =
    activeThreadIsRuntimeOwned &&
    activeRuntimeDisplayTimeline !== null &&
    !latestTurnSettled &&
    !runtimeTimelineHasResponse;
  const isTurnRunning = activeRunningTurnId !== null;
  const isWorking = isTurnRunning || isSendBusy || isConnecting || waitingForRuntimeFirstResponse;
  const {
    queuedComposerItems,
    editingQueuedComposerItemId,
    queuedComposerItemsExpanded,
    enqueueComposerItem,
    removeQueuedComposerItem,
    takeQueuedComposerItem,
    reorderQueuedComposerItem,
    setQueueExpanded,
    beginEditingQueuedComposerItem,
    cancelEditingQueuedComposerItem,
    replaceEditingQueuedComposerItem,
  } = useThreadComposerQueue(routeThreadKey);
  const activeWorkStartedAt = useMemo(
    () =>
      deriveActiveWorkStartedAt(
        activeLatestTurn,
        activeThread?.session ?? null,
        localDispatchStartedAt,
      ),
    [activeLatestTurn, activeThread?.session, localDispatchStartedAt],
  );
  const threadMessages = activeThread?.messages ?? EMPTY_THREAD_MESSAGES;
  const serverMessages = useMemo(
    () => filterMessagesToBranch(threadMessages, branchView),
    [branchView, threadMessages],
  );
  const runtimeRenderableUserMessageIds = useMemo(
    () => runtimeDisplayTimelineRenderableUserMessageIds(activeRuntimeDisplayTimeline),
    [activeRuntimeDisplayTimeline],
  );
  const {
    attachmentPreviewHandoffSync,
    applyAttachmentPreviewHandoff,
    clearAttachmentPreviewHandoffs,
    handoffAttachmentPreviews,
  } = useAttachmentPreviewHandoff({ serverMessages });
  const visibleThreadSendIntents = useMemo(
    () => filterThreadSendIntentsToBranch(threadSendIntents, branchView),
    [branchView, threadSendIntents],
  );
  // A send intent lives from coordinateTurnSend until its committed message lands, so it keeps
  // the turn active across frames where a stale thread snapshot momentarily reports the session
  // idle during the local → server → runtime handoff. Without it the collapsed running
  // work-group preview unmounts for one frame and loses its animation.
  // While the runtime overlay is still projecting an unsettled turn, orchestration status can
  // briefly idle between tool bursts even though tools keep appending — keep the tail group
  // running so the collapsed preview does not flash to completed and back.
  const runtimeTimelineImpliesTurnActive =
    activeRuntimeDisplayTimeline !== null && !latestTurnSettled;
  const timelineTurnActive =
    isTurnRunning || visibleThreadSendIntents.length > 0 || runtimeTimelineImpliesTurnActive;
  const committedTimelineMessages = useMemo(
    () => applyAttachmentPreviewHandoff(serverMessages),
    [applyAttachmentPreviewHandoff, serverMessages],
  );
  const proposedPlansForTimeline = activeThread?.proposedPlans ?? EMPTY_TIMELINE_PROPOSED_PLANS;
  const timelineEntries = useThreadTimeline({
    committedMessages: committedTimelineMessages,
    proposedPlans: proposedPlansForTimeline,
    workLogEntries,
    sendIntents: visibleThreadSendIntents,
    runtimeAcknowledgedMessageIds: runtimeRenderableUserMessageIds,
    activeRuntimeDisplayTimeline,
    isWorking,
    isTurnActive: timelineTurnActive,
    activeTurnStartedAt: activeWorkStartedAt,
  });
  const editableUserMessageIds = useMemo(() => {
    if (!activeThread || activeThread.entries.length === 0) {
      return new Set<MessageId>();
    }

    const userMessageIds = new Set(
      activeThread.messages.flatMap((message) => (message.role === "user" ? [message.id] : [])),
    );
    const editableIds = new Set<MessageId>();
    for (const entry of activeThread.entries) {
      if (
        entry.kind === "message" &&
        entry.messageId !== null &&
        userMessageIds.has(entry.messageId)
      ) {
        editableIds.add(entry.messageId);
      }
    }
    return editableIds;
  }, [activeThread]);
  const activeEditingUserMessageId =
    editingUserMessageId &&
    editableUserMessageIds.has(editingUserMessageId) &&
    committedTimelineMessages.some(
      (message) => message.id === editingUserMessageId && message.role === "user",
    )
      ? editingUserMessageId
      : null;

  const onBeginEditUserMessage = useCallback(
    (messageId: MessageId) => {
      if (!isServerThread || !activeThread) {
        return;
      }
      const msg = activeThread.messages.find(
        (entry) => entry.id === messageId && entry.role === "user",
      );
      if (!msg || !findThreadMessageEntry(activeThread, messageId)) {
        setThreadError(
          activeThread.id,
          "Cannot edit this message because it is missing a thread entry.",
        );
        return;
      }

      clearComposerDraftContent(editComposerDraftTarget);
      setComposerDraftPrompt(editComposerDraftTarget, msg.text);
      setEditingUserMessageId(messageId);
    },
    [
      activeThread?.entries,
      activeThread?.id,
      activeThread?.messages,
      clearComposerDraftContent,
      editComposerDraftTarget,
      isServerThread,
      setComposerDraftPrompt,
      setThreadError,
    ],
  );
  const handleBeginEditUserMessage = useStableEvent(onBeginEditUserMessage);

  const onCancelEditUserMessage = useCallback(
    (messageId: MessageId) => {
      setEditingUserMessageId((current) => (current === messageId ? null : current));
      clearComposerDraftContent(editComposerDraftTarget);
    },
    [clearComposerDraftContent, editComposerDraftTarget],
  );

  const keybindings = useServerKeybindings();
  const availableEditors = useServerAvailableEditors();
  const serverConfig = useServerConfig();
  const projectlessCwd = resolveProjectlessCwd(serverConfig?.cwd);
  const workspaceSource = activeThread ?? draftThread ?? null;
  const workspaceTarget = resolveWorkspaceTarget({
    source: workspaceSource,
    defaultProject: selectedWorkspaceProject ?? null,
    defaultProjectCwd: selectedProjectCwd,
    defaultProjectEnvironmentId: selectedProjectEnvironmentId,
    defaultProjectRef: selectedProjectRef,
    projects: workspaceProjects,
    projectlessCwd,
    fallbackEnvironmentId: environmentId,
  });
  const workspaceProject = workspaceTarget.project;
  const activeWorkbenchTab = useActiveTab(workspaceTarget.workspaceKey);
  const rightWorkbenchOpen = useRightOpen(workspaceTarget.workspaceKey);
  const rightWorkbenchMuted = useIsMuted(workspaceTarget.workspaceKey);
  const planSurfaceOpen =
    activeWorkbenchTab === "plan" && rightWorkbenchOpen && !rightWorkbenchMuted;
  const threadCreateModelSelection: ModelSelection =
    activeThread?.modelSelection ??
    workspaceProject?.defaultModelSelection ??
    activeProject?.defaultModelSelection ??
    settings.textGenerationModelSelection;
  const activeProjectCwd = workspaceTarget.projectCwd;
  const gitCwd = workspaceTarget.cwd;
  const workspaceToolbarCwd = gitCwd ?? activeProjectCwd;
  const gitEnvironmentId = workspaceTarget.rpcEnvironmentId;
  const handleWorkspaceOpenFolder = () => {
    if (!primaryEnvironmentId) {
      toastManager.add({
        type: "error",
        title: "Unable to open folder",
        description: "No local environment is available.",
      });
      return;
    }
    if (typeof window === "undefined" || !window.desktopBridge) {
      toastManager.add({
        type: "error",
        title: "Unable to open folder",
        description: "Folder selection is only available in the desktop app.",
      });
      return;
    }
    const api = readLocalApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: "Unable to open folder",
        description: "Local desktop integration is unavailable.",
      });
      return;
    }

    const configuredBaseDirectory = settings.addProjectBaseDirectory.trim();
    const initialPath =
      activeProjectCwd ??
      gitCwd ??
      (configuredBaseDirectory.length > 0 ? configuredBaseDirectory : "~/");

    void api.dialogs
      .pickFolder({ initialPath })
      .then(async (pickedPath) => {
        if (!pickedPath) {
          return;
        }

        const selection = await openWorkspaceFolder({
          environmentId: primaryEnvironmentId,
          projects: workspaceProjects,
          rawCwd: pickedPath,
          defaultModelSelection: settings.textGenerationModelSelection,
        });
        if (!selection) {
          return;
        }

        await handleWorkspaceProjectSelect(selection.projectRef, {
          logicalProjectKey: selection.logicalProjectKey,
        });
      })
      .catch((error: unknown) => {
        toastManager.add({
          type: "error",
          title: "Failed to open folder",
          description: formatSchemaBackedTransportErrorDescription(error, "An error occurred."),
        });
      });
  };
  const checkoutBranchMutation = useMutation(
    gitCheckoutMutationOptions({ environmentId: gitEnvironmentId, cwd: gitCwd, queryClient }),
  );
  const activeThreadWorktreePath = workspaceTarget.worktreePath;
  const composerStatusGitCwd = activeThreadWorktreePath ?? workspaceToolbarCwd;
  const composerGitStatus = useGitStatus({
    environmentId: gitEnvironmentId ?? environmentId,
    cwd: composerStatusGitCwd,
  });
  const activeProjectRoot = activeThreadWorktreePath ?? activeProjectCwd ?? undefined;
  const activeTerminalLaunchContext =
    terminalLaunchContext?.threadId === activeThreadId
      ? terminalLaunchContext
      : (storeServerTerminalLaunchContext ?? null);
  const terminalShortcutLabelOptions = {
    context: {
      terminalFocus: true,
      terminalOpen: Boolean(terminalState.terminalOpen),
    },
  };
  const terminalToggleShortcutLabel = shortcutLabelForCommand(keybindings, "terminal.toggle");
  const splitTerminalShortcutLabel = shortcutLabelForCommand(
    keybindings,
    "terminal.split",
    terminalShortcutLabelOptions,
  );
  const newTerminalShortcutLabel = shortcutLabelForCommand(
    keybindings,
    "terminal.new",
    terminalShortcutLabelOptions,
  );
  const closeTerminalShortcutLabel = shortcutLabelForCommand(
    keybindings,
    "terminal.close",
    terminalShortcutLabelOptions,
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
  const focusComposer = () => {
    composerRef.current?.focusAtEnd();
  };
  const scheduleComposerFocus = () => {
    window.requestAnimationFrame(() => {
      focusComposer();
    });
  };
  const setTerminalOpen = (open: boolean) => {
    if (!activeThreadRef) return;
    storeSetTerminalOpen(activeThreadRef, open);
  };
  const toggleTerminalVisibility = () => {
    if (!activeThreadRef) return;
    setTerminalOpen(!terminalState.terminalOpen);
  };
  const splitTerminal = () => {
    if (!activeThreadRef || hasReachedSplitLimit) return;
    const terminalId = `terminal-${randomUUID()}`;
    storeSplitTerminal(activeThreadRef, terminalId);
    setTerminalFocusRequestId((value) => value + 1);
  };
  const createNewTerminal = () => {
    if (!activeThreadRef) return;
    const terminalId = `terminal-${randomUUID()}`;
    storeNewTerminal(activeThreadRef, terminalId);
    setTerminalFocusRequestId((value) => value + 1);
  };
  const closeTerminal = (terminalId: string) => {
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
          await api.terminal.clear({ threadId: activeThreadId, terminalId }).catch(() => undefined);
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
  };
  const runProjectScript = async (
    script: ProjectScript,
    options?: {
      cwd?: string;
      env?: Record<string, string>;
      worktreePath?: string | null;
      rememberAsLastInvoked?: boolean;
    },
  ) => {
    const api = readWorkbenchTerminalApi(gitEnvironmentId);
    if (!api || !activeThreadId || !workspaceProject || !activeThread) return;
    if (options?.rememberAsLastInvoked !== false) {
      setLastInvokedScriptByProjectId((current) => {
        if (current[workspaceProject.id] === script.id) return current;
        return { ...current, [workspaceProject.id]: script.id };
      });
    }
    const targetCwd = options?.cwd ?? gitCwd ?? workspaceProject.cwd;
    const terminalWorkspaceKey = workspaceTarget.workspaceKey;
    const terminalThreadId = workbenchTerminalThreadId(terminalWorkspaceKey);
    const terminalId = readTerminalSessions(terminalWorkspaceKey).activeId;
    const terminalWorktreePath = options?.worktreePath ?? workspaceTarget.worktreePath;

    const runtimeEnv = projectScriptRuntimeEnv({
      project: {
        cwd: workspaceProject.cwd,
      },
      worktreePath: terminalWorktreePath,
      ...(options?.env ? { extraEnv: options.env } : {}),
    });
    const openTerminalInput = {
      threadId: terminalThreadId,
      terminalId,
      cwd: targetCwd,
      ...(terminalWorktreePath !== null ? { worktreePath: terminalWorktreePath } : {}),
      env: runtimeEnv,
    };

    try {
      await api.open(openTerminalInput);
      shellPanelsActions.setActiveTab("terminal", terminalWorkspaceKey);
      await api.write({
        threadId: terminalThreadId,
        terminalId,
        data: `${script.command}\r`,
      });
    } catch (error) {
      setThreadError(
        activeThreadId,
        error instanceof Error ? error.message : `Failed to run script "${script.name}".`,
      );
    }
  };

  const persistProjectScripts = async (input: {
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
  };
  const saveProjectScript = async (input: NewProjectScriptInput) => {
    if (!workspaceProject) return;
    const nextId = nextProjectScriptId(
      input.name,
      workspaceProject.scripts.map((script) => script.id),
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
          ...workspaceProject.scripts.map((script) =>
            script.runOnWorktreeCreate ? { ...script, runOnWorktreeCreate: false } : script,
          ),
          nextScript,
        ]
      : [...workspaceProject.scripts, nextScript];

    await persistProjectScripts({
      projectId: workspaceProject.id,
      projectCwd: workspaceProject.cwd,
      previousScripts: workspaceProject.scripts,
      nextScripts,
      keybinding: input.keybinding,
      keybindingCommand: commandForProjectScript(nextId),
    });
  };
  const updateProjectScript = async (scriptId: string, input: NewProjectScriptInput) => {
    if (!workspaceProject) return;
    const existingScript = workspaceProject.scripts.find((script) => script.id === scriptId);
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
    const nextScripts = workspaceProject.scripts.map((script) =>
      script.id === scriptId
        ? updatedScript
        : input.runOnWorktreeCreate
          ? { ...script, runOnWorktreeCreate: false }
          : script,
    );

    await persistProjectScripts({
      projectId: workspaceProject.id,
      projectCwd: workspaceProject.cwd,
      previousScripts: workspaceProject.scripts,
      nextScripts,
      keybinding: input.keybinding,
      keybindingCommand: commandForProjectScript(scriptId),
    });
  };
  const deleteProjectScript = async (scriptId: string) => {
    if (!workspaceProject) return;
    const nextScripts = workspaceProject.scripts.filter((script) => script.id !== scriptId);

    const deletedName = workspaceProject.scripts.find((s) => s.id === scriptId)?.name;

    try {
      await persistProjectScripts({
        projectId: workspaceProject.id,
        projectCwd: workspaceProject.cwd,
        previousScripts: workspaceProject.scripts,
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
  };

  const handleInteractionModeChange = (mode: AgentInteractionMode) => {
    if (mode === interactionMode) return;
    setComposerDraftInteractionMode(composerDraftTarget, mode);
    if (isLocalDraftThread) {
      setDraftThreadContext(composerDraftTarget, { interactionMode: mode });
    }
    scheduleComposerFocus();
  };
  const toggleInteractionMode = () => {
    handleInteractionModeChange(nextComposerInteractionMode(interactionMode));
  };
  const persistThreadSettingsForNextTurn = async (input: {
    threadId: ThreadId;
    createdAt: string;
    interactionMode: AgentInteractionMode;
  }) => {
    if (!serverThread) {
      return;
    }
    const api = readEnvironmentApi(environmentId);
    if (!api) {
      return;
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
  };

  const onUpdateProposedPlan = useCallback(
    async (proposedPlan: ProposedPlan, nextMarkdown: string): Promise<boolean> => {
      if (!activeThread || !isServerThread) {
        return false;
      }
      const normalizedMarkdown = normalizePlanMarkdownForExport(nextMarkdown);
      if (normalizedMarkdown.trim().length === 0) {
        return false;
      }
      if (normalizedMarkdown === proposedPlan.planMarkdown) {
        return true;
      }

      const api = readEnvironmentApi(environmentId);
      if (!api) {
        return false;
      }

      const updatedAt = new Date().toISOString();
      try {
        await api.orchestration.dispatchCommand({
          type: "thread.proposed-plan.update",
          commandId: newCommandId(),
          threadId: activeThread.id,
          planId: proposedPlan.id,
          planMarkdown: normalizedMarkdown,
          createdAt: updatedAt,
        });
        return true;
      } catch (err) {
        setThreadError(
          activeThread.id,
          err instanceof Error ? err.message : "Failed to update proposed plan.",
        );
        return false;
      }
    },
    [activeThread?.id, environmentId, isServerThread, setThreadError],
  );

  // The messages timeline owns virtualized scroll state.
  const scrollTimelineToBottom = (animated = false) => {
    messagesTimelineControllerRef.current?.scrollToBottom({ animated });
  };

  // Debounce *showing* the scroll-to-bottom pill so it doesn't flash during
  // thread switches while the virtualizer is settling; hiding is always immediate.
  const showScrollDebouncer = useRef(
    new Debouncer(() => setShowScrollToBottom(true), { wait: 150 }),
  );
  const onIsAtBottomChange = (isAtBottom: boolean) => {
    if (isAtBottomRef.current === isAtBottom) return;
    isAtBottomRef.current = isAtBottom;
    if (isAtBottom) {
      showScrollDebouncer.current.cancel();
      setShowScrollToBottom(false);
    } else {
      showScrollDebouncer.current.maybeExecute();
    }
  };

  const closeExpandedImage = () => {
    setExpandedImage(null);
  };

  const activeWorktreePath = activeThread?.worktreePath ?? null;
  const envMode: DraftThreadEnvMode = isServerThread
    ? activeWorktreePath
      ? "worktree"
      : "local"
    : activeWorktreePath
      ? "local"
      : isLocalDraftThread && draftThread?.envMode === "worktree"
        ? "worktree"
        : "local";
  const activeThreadBranch = activeThread?.branch ?? null;
  const currentGitBranch = composerGitStatus.data?.branch ?? null;
  const composerBranchName =
    envMode === "worktree" && activeWorktreePath === null
      ? (activeThreadBranch ?? draftThread?.branch ?? currentGitBranch)
      : (currentGitBranch ?? activeThreadBranch ?? draftThread?.branch ?? null);
  const composerExecutionModeLabel =
    envMode === "worktree" ? (activeWorktreePath ? "Worktree" : "New branch") : "Local";
  const isHeroComposer = isNewThreadHero;
  const showWorkspaceToolbar =
    isLocalDraftThread && activeThreadWorktreePath === null && isHeroComposer;
  const {
    unavailableBaseBranch,
    handleStoredBranchAvailabilityChange,
    handleBranchEnvModeChange,
    handleBranchSelect,
    openPullRequestBranchDialog,
  } = useThreadBranchWorktree({
    draftId,
    isLocalDraftThread,
    activeProjectCwd,
    activeThreadBranch,
    activeThreadWorktreePath,
    envMode,
    setDraftThreadContext,
    checkoutBranchMutation,
    setPullRequestDialogState,
  });
  const workspaceTopnavActions =
    showWorkspaceToolbar || workspaceProject ? (
      <div className="flex min-w-0 items-center gap-(--multi-workbench-chrome-action-gap) overflow-hidden">
        {showWorkspaceToolbar ? (
          <WorkspaceToolbarWithGitStatus
            environmentId={gitEnvironmentId ?? environmentId}
            cwd={workspaceToolbarCwd}
            workspaceName={workspaceProject?.name ?? ""}
            workspacePath={workspaceProject ? (activeProjectCwd ?? gitCwd) : null}
            projects={workspaceProjects}
            activeProjectRef={workspaceTarget.projectRef ?? activeProjectRef}
            envMode={envMode}
            activeWorktreePath={activeWorktreePath}
            activeThreadBranch={activeThreadBranch}
            canChangeEnvMode={true}
            disabled={isConnecting || isSendBusy}
            onEnvModeChange={handleBranchEnvModeChange}
            onProjectSelect={handleWorkspaceProjectSelect}
            onOpenFolder={handleWorkspaceOpenFolder}
            onBranchSelect={handleBranchSelect}
            onCheckoutPullRequest={openPullRequestBranchDialog}
            onStoredBranchAvailabilityChange={handleStoredBranchAvailabilityChange}
          />
        ) : null}
        {workspaceProject ? (
          <div className="flex shrink-0 items-center">
            <ProjectScriptsControl
              scripts={workspaceProject.scripts}
              keybindings={keybindings}
              preferredScriptId={lastInvokedScriptByProjectId[workspaceProject.id] ?? null}
              onRunScript={runProjectScript}
              onAddScript={saveProjectScript}
              onUpdateScript={updateProjectScript}
              onDeleteScript={deleteProjectScript}
            />
          </div>
        ) : null}
      </div>
    ) : null;
  const newAgentFooterTip = useMemo(
    () =>
      getNewAgentFooterTip({
        interactionMode,
        stableKey: draftId ?? routeThreadKey,
        workspaceName: workspaceProject?.name ?? null,
      }),
    [draftId, interactionMode, routeThreadKey, workspaceProject?.name],
  );
  const heroComposerActions = isHeroComposer ? (
    <div data-new-agent-footer-actions="">
      <Button
        type="button"
        variant="outline"
        size="lg"
        data-new-agent-action-pill=""
        onClick={() => handleInteractionModeChange("plan")}
      >
        <span>Plan New Idea</span>
        <span data-new-agent-action-hint="">⇧Tab</span>
      </Button>
    </div>
  ) : null;

  const prepareRuntimePolicyForSend = (
    targetThreadId: ThreadId,
    nextInteractionMode: AgentInteractionMode,
  ): PreparedRuntimeTurnPolicy | null => {
    try {
      return prepareRuntimeTurnPolicy({ interactionMode: nextInteractionMode });
    } catch (err) {
      setThreadError(
        targetThreadId,
        err instanceof Error ? err.message : "Runtime host unavailable.",
      );
      return null;
    }
  };

  const onSubmitEditUserMessage = async (
    messageId: MessageId,
    input: InlineEditSubmitInput,
  ): Promise<boolean> => {
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

    const { images: composerImages } = input.sendContext;
    const compiledTurn = compileComposerSubmitTurn(input.sendContext);
    const { hasSendableContent } = compiledTurn;
    const originalMessage = committedTimelineMessages.find(
      (message) => message.id === messageId && message.role === "user",
    );
    const originalEntry = findThreadMessageEntry(activeThread, messageId);
    const parentEntryId = originalEntry?.parentEntryId ?? null;
    const unchanged =
      originalMessage?.text === compiledTurn.trimmedPrompt && composerImages.length === 0;
    if (!hasSendableContent || !originalMessage || unchanged) {
      return false;
    }
    if (!originalEntry) {
      setThreadError(
        activeThread.id,
        "Cannot edit this message because it is missing a thread entry.",
      );
      return false;
    }

    const threadIdForSend = activeThread.id;
    const runtimeCwd = workspaceTarget.cwd;
    if (!runtimeCwd) {
      setThreadError(threadIdForSend, "Pi runtime requires an active project before sending.");
      return false;
    }
    const preparedRuntimePolicy = prepareRuntimePolicyForSend(
      threadIdForSend,
      input.interactionMode,
    );
    if (!preparedRuntimePolicy) {
      return false;
    }
    const messageIdForSend = newMessageId();
    const messageCreatedAt = new Date().toISOString();
    const composerImagesSnapshot = [...composerImages];
    const readTurnAttachments = (() => {
      const preparedAttachments = prepareComposerTurnAttachments(composerImagesSnapshot);
      return () => preparedAttachments;
    })();
    const optimisticAttachments = compiledTurn.optimisticAttachments;
    let serverTurnStartSucceeded = false;
    let runtimeSendSucceeded = false;
    let localTurnStartAnnounced = false;
    let turnAttachmentsPromise: ReturnType<typeof readTurnAttachments> | null = null;
    const getTurnAttachments = () => {
      turnAttachmentsPromise ??= readTurnAttachments();
      return turnAttachmentsPromise;
    };

    sendInFlightRef.current = true;
    try {
      beginLocalDispatch({ preparingWorktree: false });
      isAtBottomRef.current = true;
      showScrollDebouncer.current.cancel();
      setShowScrollToBottom(false);
      messagesTimelineControllerRef.current?.scrollToBottom({ animated: false });

      markLocalRuntimeThread(threadIdForSend);
      setThreadError(threadIdForSend, null);
      applyLocalThreadTurnStartRequested({
        environmentId,
        threadId: threadIdForSend,
        message: {
          messageId: messageIdForSend,
          text: compiledTurn.outgoingMessageText,
          ...(compiledTurn.outgoingRichText !== undefined
            ? { richText: compiledTurn.outgoingRichText }
            : {}),
          attachments: optimisticAttachments,
        },
        modelSelection: activeThread.modelSelection,
        titleSeed: activeThread.title,
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: input.interactionMode,
        parentEntryId,
        createdAt: messageCreatedAt,
      });
      localTurnStartAnnounced = true;

      setEditingUserMessageId((current) => (current === messageId ? null : current));
      clearComposerDraftContent(editComposerDraftTarget);

      const turnResult = await coordinateTurnSend({
        environmentId,
        threadKey: routeThreadKey,
        threadId: threadIdForSend,
        clientMessageId: messageIdForSend,
        createdAt: messageCreatedAt,
        message: {
          text: compiledTurn.outgoingMessageText,
          ...(compiledTurn.outgoingRichText !== undefined
            ? { richText: compiledTurn.outgoingRichText }
            : {}),
          optimisticAttachments,
          getTurnAttachments,
        },
        parentEntryId,
        modelSelection: activeThread.modelSelection,
        titleSeed: activeThread.title,
        interactionMode: input.interactionMode,
        cwd: runtimeCwd,
        preparedPolicy: preparedRuntimePolicy,
        api,
        appendSendIntent: false,
        applyLocalTurnStart: false,
        startRuntimeBeforePersistence: true,
        persistBeforeDispatch: () =>
          persistThreadSettingsForNextTurn({
            threadId: threadIdForSend,
            createdAt: messageCreatedAt,
            interactionMode: input.interactionMode,
          }),
      });
      serverTurnStartSucceeded = turnResult.serverTurnStartSucceeded;
      runtimeSendSucceeded = turnResult.runtimeSendSucceeded;
      if (turnResult.serverPersistenceError) {
        const detail =
          turnResult.serverPersistenceError instanceof Error
            ? turnResult.serverPersistenceError.message
            : "Failed to save thread.";
        setThreadError(threadIdForSend, `Message sent, but failed to save thread. ${detail}`);
      }
      return true;
    } catch (err) {
      clearLocalRuntimeThread(threadIdForSend);
      const errorMessage = err instanceof Error ? err.message : "Failed to submit edited message.";
      if (serverTurnStartSucceeded) {
        await dispatchTurnStartFailure({
          api,
          threadId: threadIdForSend,
          messageId: messageIdForSend,
          detail: errorMessage,
        });
      }
      if (localTurnStartAnnounced && !serverTurnStartSucceeded) {
        clearUnconfirmedLocalTurnStart(environmentId, threadIdForSend, messageIdForSend);
      }
      setThreadError(threadIdForSend, errorMessage);
      return false;
    } finally {
      sendInFlightRef.current = false;
      if (!runtimeSendSucceeded) {
        resetLocalDispatch();
      }
    }
  };

  const submitComposerSendSnapshot = async (snapshot: ComposerSendSnapshot) => {
    const api = readEnvironmentApi(environmentId);
    if (!activeThread || isSendBusy || isConnecting || sendInFlightRef.current) return;
    const {
      sendContext: sendCtx,
      interactionMode: interactionModeForSend,
      planFollowUp,
      clearComposerOnSubmit,
    } = snapshot;
    const { prompt: promptForSend, images: composerImages } = sendCtx;
    let composerClearedForSend = false;
    const compiledTurn = compileComposerSubmitTurn(sendCtx);
    const { trimmedPrompt: trimmed, hasSendableContent } = compiledTurn;
    if (planFollowUp) {
      const followUp = resolvePlanFollowUpSubmission({
        draftText: trimmed,
        planMarkdown: planFollowUp.planMarkdown,
      });
      if (clearComposerOnSubmit) {
        composerRef.current?.clearComposer();
        composerClearedForSend = true;
      }
      await onSubmitPlanFollowUp({
        text: followUp.text,
        interactionMode: followUp.interactionMode,
        planFollowUp: {
          planId: planFollowUp.planId,
          planThreadId: planFollowUp.planThreadId,
        },
      });
      return;
    }
    const standaloneSlashCommand =
      composerImages.length === 0 ? parseStandaloneComposerSlashCommand(trimmed) : null;
    if (standaloneSlashCommand) {
      handleInteractionModeChange(standaloneSlashCommand);
      if (clearComposerOnSubmit) {
        composerRef.current?.clearComposer();
        composerClearedForSend = true;
      }
      return;
    }
    const hasUnresolvedSlashCommand =
      sendCtx.hasUnresolvedSlashCommand ??
      isUnresolvedStandaloneComposerSlashCommand(trimmed, { hasComposerCommand: false });
    if (hasUnresolvedSlashCommand) {
      return;
    }
    if (!hasSendableContent) {
      return;
    }
    const threadIdForSend = activeThread.id;
    const threadRefForSend = scopeThreadRef(environmentId, threadIdForSend);
    const threadAlreadyExistsBeforeSend = threadExistsBeforeSend({
      serverThreadExists: selectThreadExistsByRef(useStore.getState(), threadRefForSend),
      draftPromotedTo: draftThread?.promotedTo,
      targetThreadRef: threadRefForSend,
    });
    const isFirstMessage = !isServerThread || activeThread.messages.length === 0;
    const currentSendEnvMode = resolveSendEnvMode({
      requestedEnvMode: envMode,
      isGitRepo:
        getGitStatusSnapshot({
          environmentId: gitEnvironmentId,
          cwd: gitCwd,
        }).data?.isRepo ?? false,
    });
    const baseBranchForWorktree =
      workspaceProject &&
      isFirstMessage &&
      currentSendEnvMode === "worktree" &&
      !activeThread.worktreePath
        ? activeThreadBranch
        : null;

    // In worktree mode, require an explicit base branch so we don't silently
    // fall back to local execution when branch selection is missing.
    const shouldCreateWorktree =
      workspaceProject &&
      isFirstMessage &&
      currentSendEnvMode === "worktree" &&
      !activeThread.worktreePath;
    if (shouldCreateWorktree && !activeThreadBranch) {
      setThreadError(threadIdForSend, "Select a base branch before sending in New worktree mode.");
      return;
    }
    if (shouldCreateWorktree && unavailableBaseBranch) {
      setThreadError(
        threadIdForSend,
        `Base branch "${unavailableBaseBranch}" is no longer available. Choose another branch.`,
      );
      return;
    }
    if (shouldCreateWorktree && !api) {
      setThreadError(
        threadIdForSend,
        "New worktree mode requires the local project API before sending.",
      );
      return;
    }
    const initialRuntimeCwd = workspaceTarget.cwd;
    if (!initialRuntimeCwd) {
      setThreadError(threadIdForSend, "Pi runtime requires an active project before sending.");
      return;
    }
    const preparedRuntimePolicy = prepareRuntimePolicyForSend(
      threadIdForSend,
      interactionModeForSend,
    );
    if (!preparedRuntimePolicy) {
      return;
    }

    if (clearComposerOnSubmit) {
      composerRef.current?.clearComposer();
      composerClearedForSend = true;
    }

    sendInFlightRef.current = true;
    beginLocalDispatch({ preparingWorktree: Boolean(baseBranchForWorktree) });
    const composerImagesSnapshot = [...composerImages];
    const messageIdForSend = snapshot.messageId ?? newMessageId();
    const messageCreatedAt = snapshot.createdAt ?? new Date().toISOString();
    const readTurnAttachments = (() => {
      const preparedAttachments = prepareComposerTurnAttachments(composerImagesSnapshot);
      return () => preparedAttachments;
    })();
    const optimisticAttachments = compiledTurn.optimisticAttachments;
    // Scroll to the current end before adding the optimistic message so the
    // virtualizer pins to the new item when the data changes.
    isAtBottomRef.current = true;
    showScrollDebouncer.current.cancel();
    setShowScrollToBottom(false);
    messagesTimelineControllerRef.current?.scrollToBottom({ animated: false });

    markLocalRuntimeThread(threadIdForSend);
    appendThreadSendIntent(
      routeThreadKey,
      createThreadSendIntent({
        messageId: messageIdForSend,
        text: compiledTurn.outgoingMessageText,
        richText: compiledTurn.outgoingRichText,
        attachments: optimisticAttachments,
        createdAt: messageCreatedAt,
        parentEntryId: null,
      }),
    );

    setThreadError(threadIdForSend, null);

    let promotedDraftOptimistically = false;
    let promotedLocalSendThreadKey: string | null = null;
    let serverTurnStartSucceeded = false;
    let runtimeSendSucceeded = false;
    let localThreadAnnounced = false;
    let localTurnStartAnnounced = false;
    await (async () => {
      const title = compiledTurn.title;
      const threadBranch = activeThreadBranch;
      const threadWorktreePath = activeThread.worktreePath;
      const worktreeBranch = baseBranchForWorktree ? buildTemporaryWorktreeBranchName() : null;
      const shouldDispatchTurnStart = Boolean(api);
      const canStartRuntimeBeforePersistence = !baseBranchForWorktree;
      const threadProjectId = workspaceProject?.id ?? workspaceTarget.projectRef?.projectId ?? null;
      let turnAttachmentsPromise: ReturnType<typeof readTurnAttachments> | null = null;
      const getTurnAttachments = () => {
        turnAttachmentsPromise ??= readTurnAttachments();
        return turnAttachmentsPromise;
      };
      const applyLocalBootstrapThread = () => {
        if (!isLocalDraftThread || threadAlreadyExistsBeforeSend) {
          return;
        }
        applyLocalThreadCreated({
          environmentId,
          threadId: threadIdForSend,
          projectId: threadProjectId,
          title,
          modelSelection: threadCreateModelSelection,
          runtimeMode: DEFAULT_RUNTIME_MODE,
          interactionMode: interactionModeForSend,
          branch: threadBranch,
          worktreePath: threadWorktreePath,
          createdAt: activeThread.createdAt,
        });
        localThreadAnnounced = true;
      };
      const applyLocalTurnStartRequest = () => {
        applyLocalThreadTurnStartRequested({
          environmentId,
          threadId: threadIdForSend,
          message: {
            messageId: messageIdForSend,
            text: compiledTurn.outgoingMessageText,
            ...(compiledTurn.outgoingRichText !== undefined
              ? { richText: compiledTurn.outgoingRichText }
              : {}),
            attachments: optimisticAttachments,
          },
          modelSelection: activeThread.modelSelection,
          titleSeed: title,
          runtimeMode: DEFAULT_RUNTIME_MODE,
          interactionMode: interactionModeForSend,
          createdAt: messageCreatedAt,
        });
        localTurnStartAnnounced = true;
      };
      const promoteLocalDraft = () => {
        if (!isLocalDraftThread || !draftId || promotedDraftOptimistically) {
          return;
        }
        const promotedThreadRef = scopeThreadRef(environmentId, threadIdForSend);
        const promotedThreadKey = scopedThreadKey(promotedThreadRef);
        markDraftThreadPromoting(draftId, promotedThreadRef, title);
        copyThreadSendIntents(routeThreadKey, promotedThreadKey, new Set([messageIdForSend]));
        copyLocalDispatch(routeThreadKey, promotedThreadKey);
        promotedLocalSendThreadKey = promotedThreadKey;
        promotedDraftOptimistically = true;
      };
      let serverPersistenceError: unknown = null;
      const captureServerPersistenceError = (err: unknown) => {
        if (serverPersistenceError === null) {
          serverPersistenceError = err;
        }
      };
      const persistThreadMetadataForSend = async () => {
        if (api && isFirstMessage && isServerThread) {
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
            interactionMode: interactionModeForSend,
          });
        }
      };

      const buildTurnBootstrap = () => {
        if (
          !shouldDispatchTurnStart ||
          (!isLocalDraftThread && !(baseBranchForWorktree && workspaceProject && worktreeBranch))
        ) {
          return undefined;
        }
        return {
          ...(isLocalDraftThread && !threadAlreadyExistsBeforeSend
            ? {
                createThread: {
                  projectId: threadProjectId,
                  title,
                  modelSelection: threadCreateModelSelection,
                  runtimeMode: DEFAULT_RUNTIME_MODE,
                  interactionMode: interactionModeForSend,
                  branch: threadBranch,
                  worktreePath: threadWorktreePath,
                  createdAt: activeThread.createdAt,
                },
              }
            : {}),
          ...(baseBranchForWorktree && workspaceProject && worktreeBranch
            ? {
                prepareWorktree: {
                  projectCwd: workspaceProject.cwd,
                  baseBranch: baseBranchForWorktree,
                  branch: worktreeBranch,
                },
                runSetupScript: true,
              }
            : {}),
        };
      };

      if (canStartRuntimeBeforePersistence) {
        applyLocalBootstrapThread();
        applyLocalTurnStartRequest();
        promoteLocalDraft();
      }

      const metadataPersistencePromise = canStartRuntimeBeforePersistence
        ? persistThreadMetadataForSend().catch(captureServerPersistenceError)
        : null;

      const turnBootstrap = buildTurnBootstrap();
      const turnResult = await coordinateTurnSend({
        environmentId,
        threadKey: routeThreadKey,
        threadId: threadIdForSend,
        clientMessageId: messageIdForSend,
        createdAt: messageCreatedAt,
        message: {
          text: compiledTurn.outgoingMessageText,
          ...(compiledTurn.outgoingRichText !== undefined
            ? { richText: compiledTurn.outgoingRichText }
            : {}),
          optimisticAttachments,
          getTurnAttachments,
        },
        modelSelection: activeThread.modelSelection,
        titleSeed: title,
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: interactionModeForSend,
        ...(turnBootstrap ? { bootstrap: turnBootstrap } : {}),
        cwd: initialRuntimeCwd,
        preparedPolicy: preparedRuntimePolicy,
        api: shouldDispatchTurnStart ? api : undefined,
        appendSendIntent: false,
        applyLocalTurnStart: false,
        startRuntimeBeforePersistence: canStartRuntimeBeforePersistence,
        ...(canStartRuntimeBeforePersistence
          ? {}
          : { persistBeforeDispatch: persistThreadMetadataForSend }),
      });

      serverTurnStartSucceeded = turnResult.serverTurnStartSucceeded;
      runtimeSendSucceeded = turnResult.runtimeSendSucceeded;
      if (turnResult.serverPersistenceError) {
        serverPersistenceError = turnResult.serverPersistenceError;
      }

      if (
        baseBranchForWorktree &&
        turnResult.serverTurnStartSucceeded &&
        !turnResult.preparedWorktree
      ) {
        throw new Error("New worktree was created, but no prepared worktree was returned.");
      }

      if (!canStartRuntimeBeforePersistence) {
        if (isLocalDraftThread) {
          applyLocalBootstrapThread();
        }
        beginLocalDispatch({ preparingWorktree: false });
        promoteLocalDraft();
      }

      if (metadataPersistencePromise) {
        await metadataPersistencePromise;
      }

      if (serverPersistenceError) {
        const detail =
          serverPersistenceError instanceof Error
            ? serverPersistenceError.message
            : "Failed to save thread.";
        setThreadError(threadIdForSend, `Message sent, but failed to save thread. ${detail}`);
      }
    })().catch(async (err: unknown) => {
      clearLocalRuntimeThread(threadIdForSend);
      const errorMessage = err instanceof Error ? err.message : "Failed to send message.";
      if (serverTurnStartSucceeded && api) {
        await dispatchTurnStartFailure({
          api,
          threadId: threadIdForSend,
          messageId: messageIdForSend,
          detail: errorMessage,
        });
      }
      if (promotedDraftOptimistically && draftId) {
        cancelDraftThreadPromotion(draftId);
      }
      if (localTurnStartAnnounced && !serverTurnStartSucceeded) {
        clearUnconfirmedLocalTurnStart(environmentId, threadIdForSend, messageIdForSend);
      }
      if (localThreadAnnounced && !serverTurnStartSucceeded) {
        clearUnconfirmedLocalThread(environmentId, threadIdForSend);
      }
      if (
        !serverTurnStartSucceeded &&
        composerClearedForSend &&
        composerImagesRef.current.length === 0
      ) {
        if (promotedLocalSendThreadKey !== null) {
          const removedPromotedIntents = removeThreadSendIntents(
            promotedLocalSendThreadKey,
            new Set([messageIdForSend]),
          );
          revokeThreadSendIntentMessages(removedPromotedIntents);
          removeThreadSendIntents(routeThreadKey, new Set([messageIdForSend]));
          clearThreadLocalDispatch(promotedLocalSendThreadKey);
        } else {
          removeThreadSendIntentsByClientMessageId(messageIdForSend);
        }
        const retryComposerImages = composerImagesSnapshot.map(cloneComposerImageForRetry);
        composerImagesRef.current = retryComposerImages;
        addComposerDraftImages(composerDraftTarget, retryComposerImages);
        composerRef.current?.restoreComposer({
          prompt: promptForSend,
          images: retryComposerImages,
          ...(sendCtx.richText !== undefined ? { richText: sendCtx.richText } : {}),
        });
      }
      if (!serverTurnStartSucceeded && promotedLocalSendThreadKey !== null) {
        clearThreadLocalDispatch(promotedLocalSendThreadKey);
      }
      setThreadError(threadIdForSend, errorMessage);
    });
    sendInFlightRef.current = false;
    if (!runtimeSendSucceeded) {
      resetLocalDispatch();
    }
  };

  const submitQueuedComposerItem = async (item: QueuedComposerItem) => {
    await submitComposerSendSnapshot({
      sendContext: item.sendContext,
      interactionMode: item.interactionMode,
      planFollowUp: item.planFollowUp,
      clearComposerOnSubmit: false,
      messageId: item.id,
      createdAt: item.createdAt,
    });
  };

  const clearLiveComposer = () => {
    composerRef.current?.clearComposer();
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
    const currentComposerSendState = deriveComposerSendState({
      prompt: sendContext.prompt,
      imageCount: sendContext.images.length,
    });
    const hasPlanFeedbackText = sendContext.prompt.trim().length > 0;
    const hasOnlyBlankPlanFollowUp = !currentComposerSendState.hasSendableContent;
    const planFollowUp =
      showPlanFollowUpPrompt &&
      activeProposedPlan &&
      activeProposedPlanSourceThreadId &&
      activeThread &&
      (hasPlanFeedbackText || hasOnlyBlankPlanFollowUp)
        ? {
            planMarkdown: activeProposedPlan.planMarkdown,
            planId: activeProposedPlan.id,
            planThreadId: activeProposedPlanSourceThreadId,
          }
        : null;
    const hasUnresolvedSlashCommand =
      sendContext.hasUnresolvedSlashCommand ??
      isUnresolvedStandaloneComposerSlashCommand(sendContext.prompt, {
        hasComposerCommand: false,
      });
    if (hasUnresolvedSlashCommand) {
      return;
    }
    if (
      !currentComposerSendState.hasSendableContent &&
      planFollowUp === null &&
      !editingQueuedComposerItemId &&
      queuedComposerItems.length > 0 &&
      !isTurnRunning &&
      !isConnecting &&
      !isSendBusy &&
      !sendInFlightRef.current
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
      const { hasSendableContent } = currentComposerSendState;
      if (!hasSendableContent) {
        return;
      }

      const queuedItem = createQueuedComposerItem({
        threadKey: routeThreadKey,
        sendContext,
        interactionMode: existingQueuedItem?.interactionMode ?? interactionMode,
        planFollowUp: existingQueuedItem?.planFollowUp ?? null,
        itemId: editingQueuedComposerItemId,
        createdAt: existingQueuedItem?.createdAt ?? new Date().toISOString(),
      });
      replaceEditingQueuedComposerItem(routeThreadKey, queuedItem);
      clearLiveComposer();
      return;
    }

    if (
      isTurnRunning &&
      (sendWhileStreamingBehavior === "queue" || sendWhileStreamingBehavior === "stop-and-send")
    ) {
      const { hasSendableContent } = currentComposerSendState;
      if (!hasSendableContent) {
        return;
      }

      enqueueComposerItem(
        routeThreadKey,
        createQueuedComposerItem({
          threadKey: routeThreadKey,
          sendContext,
          interactionMode,
          planFollowUp,
          itemId: newMessageId(),
          createdAt: new Date().toISOString(),
        }),
      );
      clearLiveComposer();
      if (sendWhileStreamingBehavior === "stop-and-send") {
        await onInterrupt();
      }
      return;
    }

    await submitComposerSendSnapshot({
      sendContext,
      interactionMode,
      planFollowUp,
      clearComposerOnSubmit: true,
    });
  };

  const onBuildActiveProposedPlan = () => {
    if (
      !showPlanFollowUpPrompt ||
      !activeProposedPlan ||
      !activeProposedPlanSourceThreadId ||
      isConnecting ||
      isSendBusy ||
      sendInFlightRef.current
    ) {
      return;
    }

    const sendContext = composerRef.current?.getSendContext();
    if (!sendContext) {
      return;
    }

    void submitComposerSendSnapshot({
      sendContext: {
        ...sendContext,
        prompt: "",
        images: [],
      },
      interactionMode,
      planFollowUp: {
        planMarkdown: activeProposedPlan.planMarkdown,
        planId: activeProposedPlan.id,
        planThreadId: activeProposedPlanSourceThreadId,
      },
      clearComposerOnSubmit: true,
    });
  };

  const onInterrupt = async () => {
    const api = readEnvironmentApi(environmentId);
    if (!api || !activeThread) return;
    const turnId = activeRunningTurnId ?? undefined;
    await api.orchestration.dispatchCommand({
      type: "thread.turn.interrupt",
      commandId: newCommandId(),
      threadId: activeThread.id,
      ...(turnId ? { turnId } : {}),
      createdAt: new Date().toISOString(),
    });
  };

  const loadQueuedComposerItemIntoComposer = (item: QueuedComposerItem) => {
    const imagesForEdit = item.sendContext.images.map(cloneComposerImageForRetry);
    composerImagesRef.current = imagesForEdit;
    clearComposerDraftContent(composerDraftTarget);
    setComposerDraftInteractionMode(composerDraftTarget, item.interactionMode);
    addComposerDraftImages(composerDraftTarget, imagesForEdit);
    composerRef.current?.restoreComposer(item.sendContext);
    scheduleComposerFocus();
  };

  const onBeginEditQueuedComposerItem = (itemId: MessageId) => {
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

  const onRemoveQueuedComposerItem = (itemId: MessageId) => {
    if (editingQueuedComposerItemId === itemId) {
      clearLiveComposer();
    }
    removeQueuedComposerItem(routeThreadKey, itemId);
  };

  const onSendQueuedComposerItemNow = (itemId: MessageId) => {
    if (isTurnRunning || isConnecting || isSendBusy || sendInFlightRef.current) {
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

  const onReorderQueuedComposerItem = (
    itemId: MessageId,
    targetItemId: MessageId | null,
    insertAfter: boolean,
  ) => {
    reorderQueuedComposerItem(routeThreadKey, itemId, targetItemId, insertAfter);
  };

  const onQueuedComposerItemsExpandedChange = (expanded: boolean) => {
    setQueueExpanded(routeThreadKey, expanded);
  };

  const onRespondToApproval = async (
    requestId: ApprovalRequestId,
    decision: RuntimeApprovalDecision,
  ) => {
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
  };

  const onRespondToExtensionUiRequest = (request: DesktopExtensionUiRequest, value: unknown) => {
    setRespondingExtensionUiRequestIds((existing) =>
      existing.includes(request.id) ? existing : [...existing, request.id],
    );
    void readMultiRuntimeApi()
      .respondToExtensionUiRequest({
        threadId: request.threadId,
        requestId: request.id,
        value,
      })
      .catch((error: unknown) => {
        setThreadError(
          request.threadId,
          error instanceof Error ? error.message : "Failed to submit runtime response.",
        );
      })
      .finally(() => {
        setRespondingExtensionUiRequestIds((existing) =>
          existing.filter((id) => id !== request.id),
        );
      });
  };

  const onSubmitPlanFollowUp = async ({
    text,
    interactionMode: nextInteractionMode,
    planFollowUp,
  }: {
    text: string;
    interactionMode: AgentInteractionMode;
    planFollowUp: {
      planId: NonNullable<typeof activeProposedPlan>["id"];
      planThreadId: ThreadId;
    };
  }) => {
    if (!activeThread || !isServerThread || isSendBusy || isConnecting || sendInFlightRef.current) {
      return;
    }

    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }

    const threadIdForSend = activeThread.id;
    const runtimeCwd = workspaceTarget.cwd;
    if (!runtimeCwd) {
      setThreadError(threadIdForSend, "Pi runtime requires an active project before sending.");
      return;
    }
    const preparedRuntimePolicy = prepareRuntimePolicyForSend(threadIdForSend, nextInteractionMode);
    if (!preparedRuntimePolicy) {
      return;
    }
    const api = readEnvironmentApi(environmentId);
    const messageIdForSend = newMessageId();
    const messageCreatedAt = new Date().toISOString();
    const outgoingMessageText = trimmed;
    const sourceProposedPlan =
      nextInteractionMode === "agent"
        ? {
            threadId: planFollowUp.planThreadId,
            planId: planFollowUp.planId,
          }
        : null;
    let serverTurnStartSucceeded = false;
    let runtimeSendSucceeded = false;
    let localTurnStartAnnounced = false;

    sendInFlightRef.current = true;
    beginLocalDispatch({ preparingWorktree: false });
    setThreadError(threadIdForSend, null);

    // Scroll to the current end *before* adding the optimistic message.
    isAtBottomRef.current = true;
    showScrollDebouncer.current.cancel();
    setShowScrollToBottom(false);
    messagesTimelineControllerRef.current?.scrollToBottom({ animated: false });

    markLocalRuntimeThread(threadIdForSend);
    try {
      applyLocalThreadTurnStartRequested({
        environmentId,
        threadId: threadIdForSend,
        message: {
          messageId: messageIdForSend,
          text: outgoingMessageText,
          attachments: [],
        },
        modelSelection: activeThread.modelSelection,
        titleSeed: activeThread.title,
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: nextInteractionMode,
        ...(sourceProposedPlan ? { sourceProposedPlan } : {}),
        createdAt: messageCreatedAt,
      });
      localTurnStartAnnounced = true;

      // Keep the mode toggle and plan-follow-up banner in sync immediately
      // while the same-thread implementation turn is starting.
      setComposerDraftInteractionMode(
        scopeThreadRef(activeThread.environmentId, threadIdForSend),
        nextInteractionMode,
      );
      // Optimistically open the plan sidebar when implementing (not refining).
      // Agent mode here means the agent is executing the plan, which produces
      // step-tracking activities that the workbench Plan/Tasks tab will display.
      if (nextInteractionMode === "agent") {
        shellPanelsActions.activatePlanTab(workspaceTarget.workspaceKey);
      }

      const turnResult = await coordinateTurnSend({
        environmentId,
        threadKey: routeThreadKey,
        threadId: threadIdForSend,
        clientMessageId: messageIdForSend,
        createdAt: messageCreatedAt,
        message: {
          text: outgoingMessageText,
          optimisticAttachments: [],
          getTurnAttachments: async () => [],
        },
        modelSelection: activeThread.modelSelection,
        titleSeed: activeThread.title,
        interactionMode: nextInteractionMode,
        sourceProposedPlan,
        cwd: runtimeCwd,
        preparedPolicy: preparedRuntimePolicy,
        api,
        appendSendIntent: false,
        applyLocalTurnStart: false,
        startRuntimeBeforePersistence: true,
        persistBeforeDispatch: () =>
          persistThreadSettingsForNextTurn({
            threadId: threadIdForSend,
            createdAt: messageCreatedAt,
            interactionMode: nextInteractionMode,
          }),
      });
      serverTurnStartSucceeded = turnResult.serverTurnStartSucceeded;
      runtimeSendSucceeded = turnResult.runtimeSendSucceeded;
      if (turnResult.serverPersistenceError) {
        const detail =
          turnResult.serverPersistenceError instanceof Error
            ? turnResult.serverPersistenceError.message
            : "Failed to save thread.";
        setThreadError(threadIdForSend, `Message sent, but failed to save thread. ${detail}`);
      }
    } catch (err) {
      clearLocalRuntimeThread(threadIdForSend);
      if (serverTurnStartSucceeded && api) {
        await dispatchTurnStartFailure({
          api,
          threadId: threadIdForSend,
          messageId: messageIdForSend,
          detail: err instanceof Error ? err.message : "Failed to send plan follow-up.",
        });
      }
      if (localTurnStartAnnounced && !serverTurnStartSucceeded) {
        clearUnconfirmedLocalTurnStart(environmentId, threadIdForSend, messageIdForSend);
      }
      setThreadError(
        threadIdForSend,
        err instanceof Error ? err.message : "Failed to send plan follow-up.",
      );
    } finally {
      sendInFlightRef.current = false;
      if (!runtimeSendSucceeded) {
        resetLocalDispatch();
      }
    }
  };
  const handleComposerSend = useStableEvent(onSend);
  const handleComposerInterrupt = useStableEvent(onInterrupt);
  const handleBuildActiveProposedPlan = useStableEvent(onBuildActiveProposedPlan);
  const handleViewActivePlan = useStableEvent(() => {
    shellPanelsActions.activatePlanTab(workspaceTarget.workspaceKey);
  });
  const handleRespondToApproval = useStableEvent(onRespondToApproval);
  const handleBeginEditQueuedComposerItem = useStableEvent(onBeginEditQueuedComposerItem);
  const handleCancelEditingQueuedComposerItem = useStableEvent(onCancelEditingQueuedComposerItem);
  const handleRemoveQueuedComposerItem = useStableEvent(onRemoveQueuedComposerItem);
  const handleSendQueuedComposerItemNow = useStableEvent(onSendQueuedComposerItemNow);
  const handleReorderQueuedComposerItem = useStableEvent(onReorderQueuedComposerItem);
  const handleQueuedComposerItemsExpandedChange = useStableEvent(
    onQueuedComposerItemsExpandedChange,
  );
  const onExpandTimelineImage = useCallback((preview: ExpandedImagePreview) => {
    setExpandedImage(preview);
  }, []);
  const renderEditComposer = useCallback(
    (message: ChatMessage): ReactNode => {
      if (activeThreadId === null) {
        return null;
      }
      return (
        <InlineMessageEditComposer
          key={message.id}
          message={message}
          composerDraftTarget={editComposerDraftTarget}
          environmentId={environmentId}
          draftId={draftId}
          activeThreadId={activeThreadId}
          phase={phase}
          isTurnRunning={isTurnRunning}
          isConnecting={isConnecting}
          isSendBusy={isSendBusy}
          isPreparingWorktree={isPreparingWorktree}
          interactionMode={interactionMode}
          activeContextWindow={activeContextWindow}
          resolvedTheme={resolvedTheme}
          settings={settings}
          keybindings={keybindings}
          terminalOpen={Boolean(terminalState.terminalOpen)}
          gitCwd={gitCwd}
          onInterrupt={handleComposerInterrupt}
          setThreadError={setThreadError}
          onExpandImage={onExpandTimelineImage}
          onCancelEditUserMessage={onCancelEditUserMessage}
          onSubmitEditUserMessage={onSubmitEditUserMessage}
        />
      );
    },
    [
      activeThreadId,
      draftId,
      editComposerDraftTarget,
      environmentId,
      gitCwd,
      interactionMode,
      isConnecting,
      isPreparingWorktree,
      isSendBusy,
      keybindings,
      onCancelEditUserMessage,
      handleComposerInterrupt,
      onExpandTimelineImage,
      onSubmitEditUserMessage,
      phase,
      resolvedTheme,
      setThreadError,
      settings,
      terminalState.terminalOpen,
      activeContextWindow,
    ],
  );
  const activeTimelineCacheKey = activeThread?.id ?? "";
  const existingOpenTerminalThreadKeysKey = existingOpenTerminalThreadKeys.join("\0");
  const serverMessagesAcknowledgementKey = committedMessageIdsKey(activeThread?.messages);
  const storeServerTerminalLaunchContextKey = storeServerTerminalLaunchContext
    ? [
        storeServerTerminalLaunchContext.cwd,
        storeServerTerminalLaunchContext.worktreePath ?? "",
      ].join("\0")
    : "";
  const activeProjectScriptsKey = projectScriptsKey(workspaceProject?.scripts ?? null);
  const keybindingsKey = keybindingsConfigKey(keybindings);
  const serverThreadLifecycleSync =
    routeKind === "server" ? (
      <>
        <RetainServerThreadDetailSync
          key={[environmentId, routeKind, threadId].join("\0")}
          environmentId={environmentId}
          routeKind={routeKind}
          threadId={threadId}
        />
        <RuntimeThreadHydrationSync
          key={["runtime-hydration", routeKind, threadId, activeProjectCwd ?? gitCwd ?? ""].join(
            "\0",
          )}
          cwd={activeProjectCwd ?? gitCwd}
          interactionMode={interactionMode}
          routeKind={routeKind}
          threadId={threadId}
        />
        <MarkSettledServerThreadVisitedSync
          key={[
            activeLatestTurn?.completedAt ?? "",
            activeThreadLastVisitedAt ?? "",
            latestTurnSettled,
            serverThread?.environmentId ?? "",
            serverThread?.id ?? "",
          ].join("\0")}
          activeThreadLastVisitedAt={activeThreadLastVisitedAt}
          completedAt={activeLatestTurn?.completedAt}
          environmentId={serverThread?.environmentId}
          latestTurnSettled={latestTurnSettled}
          markThreadVisited={markThreadVisited}
          threadId={serverThread?.id}
        />
      </>
    ) : null;
  const activeThreadLifecycleSync = isNewThreadHero ? null : (
    <>
      {serverThreadLifecycleSync}
      <ThreadSendIntentsServerAckSync
        key={[threadSendIntents.length, routeThreadKey, serverMessagesAcknowledgementKey].join(
          "\0",
        )}
        handoffAttachmentPreviews={handoffAttachmentPreviews}
        removeThreadSendIntents={removeThreadSendIntents}
        serverMessages={activeThread?.messages}
        threadSendIntents={threadSendIntents}
        threadKey={routeThreadKey}
      />
      <TerminalLaunchActiveThreadSync
        key={[activeThreadId ?? "", routeThreadKey].join("\0")}
        activeThreadId={activeThreadId}
        routeThreadRef={routeThreadRef}
        setTerminalLaunchContext={setTerminalLaunchContext}
        storeClearTerminalLaunchContext={storeClearTerminalLaunchContext}
      />
      <TerminalLaunchLocalSettledSync
        key={[
          activeProjectCwd ?? "",
          activeThreadId ?? "",
          activeThreadKey ?? "",
          activeThreadWorktreePath ?? "",
        ].join("\0")}
        activeProjectCwd={activeProjectCwd}
        activeThreadId={activeThreadId}
        activeThreadRef={activeThreadRef}
        activeThreadWorktreePath={activeThreadWorktreePath}
        setTerminalLaunchContext={setTerminalLaunchContext}
        storeClearTerminalLaunchContext={storeClearTerminalLaunchContext}
      />
      <TerminalLaunchStoredSettledSync
        key={[
          activeProjectCwd ?? "",
          activeThreadId ?? "",
          activeThreadKey ?? "",
          activeThreadWorktreePath ?? "",
          storeServerTerminalLaunchContextKey,
        ].join("\0")}
        activeProjectCwd={activeProjectCwd}
        activeThreadId={activeThreadId}
        activeThreadRef={activeThreadRef}
        activeThreadWorktreePath={activeThreadWorktreePath}
        storeClearTerminalLaunchContext={storeClearTerminalLaunchContext}
        storeServerTerminalLaunchContext={storeServerTerminalLaunchContext}
      />
      <TerminalLaunchClosedSync
        key={[activeThreadId ?? "", activeThreadKey ?? "", terminalState.terminalOpen].join("\0")}
        activeThreadId={activeThreadId}
        activeThreadRef={activeThreadRef}
        setTerminalLaunchContext={setTerminalLaunchContext}
        storeClearTerminalLaunchContext={storeClearTerminalLaunchContext}
        terminalOpen={Boolean(terminalState.terminalOpen)}
      />
      <TerminalOpenFocusSync
        key={[activeThreadKey ?? "", terminalState.terminalOpen].join("\0")}
        activeThreadKey={activeThreadKey}
        focusComposer={focusComposer}
        setTerminalFocusRequestId={setTerminalFocusRequestId}
        terminalOpen={Boolean(terminalState.terminalOpen)}
        terminalOpenByThreadRef={terminalOpenByThreadRef}
      />
    </>
  );
  const chatViewLifecycleSync = (
    <>
      <MountedTerminalThreadsSync
        key={[
          activeThreadKey ?? "",
          existingOpenTerminalThreadKeysKey,
          terminalState.terminalOpen,
        ].join("\0")}
        activeThreadKey={activeThreadKey}
        existingOpenTerminalThreadKeys={existingOpenTerminalThreadKeys}
        setMountedTerminalThreadKeys={setMountedTerminalThreadKeys}
        terminalOpen={Boolean(terminalState.terminalOpen)}
      />
      {activeThreadLifecycleSync}
      <ActiveThreadUiResetSync
        key={activeThread?.id ?? ""}
        isAtBottomRef={isAtBottomRef}
        setPullRequestDialogState={setPullRequestDialogState}
        setShowScrollToBottom={setShowScrollToBottom}
        showScrollDebouncer={showScrollDebouncer}
      />
      <ActiveThreadComposerFocusSync
        key={[activeThread?.id ?? "", terminalState.terminalOpen].join("\0")}
        activeThreadId={activeThread?.id ?? null}
        focusComposer={focusComposer}
        terminalOpen={Boolean(terminalState.terminalOpen)}
      />
      <ThreadMediaResetSync
        key={[draftId ?? "", threadId].join("\0")}
        clearAttachmentPreviewHandoffs={clearAttachmentPreviewHandoffs}
        setExpandedImage={setExpandedImage}
      />
      <ChatViewKeyboardShortcutsSync
        key={[
          activeProjectScriptsKey,
          activeThreadId ?? "",
          keybindingsKey,
          terminalState.activeTerminalId,
          terminalState.terminalOpen,
        ].join("\0")}
        activeProjectScripts={workspaceProject?.scripts ?? null}
        activeThreadId={activeThreadId}
        closeTerminal={closeTerminal}
        createNewTerminal={createNewTerminal}
        keybindings={keybindings}
        runProjectScript={runProjectScript}
        setTerminalOpen={setTerminalOpen}
        splitTerminal={splitTerminal}
        terminalActiveTerminalId={terminalState.activeTerminalId}
        terminalOpen={Boolean(terminalState.terminalOpen)}
        toggleTerminalVisibility={toggleTerminalVisibility}
      />
    </>
  );

  assertActiveThread(activeThread, { routeKind, environmentId, threadId, draftId });

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-transparent">
      {chatViewLifecycleSync}
      {attachmentPreviewHandoffSync}
      {/* Top bar */}
      {isHeroComposer ? null : (
        <header
          className={cn(
            "agent-window-chat-header pointer-events-none box-border flex h-(--multi-workbench-chrome-row-height) select-none items-center px-(--multi-workbench-chrome-padding-inline)",
            isElectron &&
              reserveTitleBarControlInset &&
              "wco:pr-[calc(100vw-env(titlebar-area-width)-env(titlebar-area-x)+1em)]",
          )}
        >
          <ChatHeader activeThreadTitle={activeThread.title} actions={workspaceTopnavActions} />
        </header>
      )}

      {/* Error banner */}
      <ThreadErrorBanner
        error={activeThread.error}
        onDismiss={() => setThreadError(activeThread.id, null)}
      />
      {/* Main content area with optional plan sidebar */}
      <div className="flex min-h-0 min-w-0 flex-1">
        {/* Chat column */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Messages wrapper, hidden in hero mode */}
          {!isHeroComposer && (
            <div
              className="relative flex min-h-0 flex-1 flex-col"
              data-subagent-conversation-shell=""
              data-subagent-tray-open={subagentTrayPresented ? "" : undefined}
            >
              <div data-subagent-conversation-mask="">
                {branchView.status === "invalid" ? (
                  <div className="mx-auto w-full max-w-3xl px-3 pt-3">
                    <Alert variant="error">
                      <IconExclamationCircle />
                      <AlertTitle>Branch path unavailable</AlertTitle>
                      <AlertDescription>{branchView.issue}</AlertDescription>
                    </Alert>
                  </div>
                ) : null}
                <MessagesTimeline
                  key={activeTimelineCacheKey}
                  isWorking={isWorking}
                  isTurnActive={timelineTurnActive}
                  isStreaming={isTurnRunning}
                  editUserMessagesDisabled={isWorking}
                  bottomClearancePx={DOCKED_COMPOSER_TIMELINE_RESERVE_PX}
                  timelineControllerRef={messagesTimelineControllerRef}
                  timelineEntries={timelineEntries}
                  activeThreadId={activeThread.id}
                  timelineCacheKey={activeTimelineCacheKey}
                  activeThreadEnvironmentId={activeThread.environmentId}
                  editableUserMessageIds={editableUserMessageIds}
                  onImageExpand={onExpandTimelineImage}
                  markdownCwd={gitCwd ?? undefined}
                  projectRoot={activeProjectRoot}
                  isServerThread={isServerThread}
                  editingUserMessageId={activeEditingUserMessageId}
                  onBeginEditUserMessage={handleBeginEditUserMessage}
                  renderEditComposer={
                    activeEditingUserMessageId !== null ? renderEditComposer : undefined
                  }
                  onUpdateProposedPlan={onUpdateProposedPlan}
                  awaitingServerThreadDetail={isServerThread && !serverThreadDetailLoaded}
                  onIsAtBottomChange={onIsAtBottomChange}
                />

                {showScrollToBottom && (
                  <div className="pointer-events-none absolute bottom-[calc(44px_+_1.25rem)] left-1/2 z-30 flex -translate-x-1/2 justify-center py-1.5">
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      onClick={() => scrollTimelineToBottom(true)}
                      className="pointer-events-auto rounded-full bg-(--multi-composer-surface-background)! text-multi-icon-secondary hover:bg-(--multi-composer-surface-background)! data-pressed:bg-(--multi-composer-surface-background)!"
                      aria-label="Scroll to bottom"
                      title="Scroll to bottom"
                    >
                      <IconChevronRightMedium
                        className="size-3 rotate-90 text-multi-icon-secondary"
                        aria-hidden="true"
                      />
                    </Button>
                  </div>
                )}
                <div
                  aria-hidden="true"
                  data-chat-bottom-gradient-overlay=""
                  className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-32 bg-[linear-gradient(to_top,var(--multi-shell-center-surface-background)_0,color-mix(in_srgb,var(--multi-shell-center-surface-background)_82%,transparent)_52%,transparent_100%)]"
                />
              </div>
              {subagentTrayPresented ? (
                <Button
                  type="button"
                  data-subagent-tray-click-capture=""
                  aria-label="Close subagent tray"
                  variant="ghost"
                  className="border-0 bg-transparent p-0 shadow-none before:hidden hover:bg-transparent data-pressed:bg-transparent"
                  onClick={closeSubagentTray}
                />
              ) : null}
            </div>
          )}

          {/* Input bar, centered when hero and docked when a thread is active */}
          <div
            className={cn(
              "relative",
              !isHeroComposer && "px-4 pb-1",
              isHeroComposer
                ? "flex h-full flex-1 flex-col items-center outline-hidden"
                : undefined,
              isConnecting
                ? "[&_[data-chat-input-footer=true]_*]:opacity-60 **:data-[testid=composer-editor]:cursor-default **:data-[testid=composer-editor]:opacity-60"
                : undefined,
              !isHeroComposer
                ? "pointer-events-none absolute bottom-0 left-0 right-0 isolate z-30 before:pointer-events-none before:absolute before:bottom-[-12px] before:left-1/2 before:top-1/2 before:z-0 before:ml-[-50vw] before:w-screen before:bg-(--multi-shell-center-surface-background) *:pointer-events-auto *:relative *:z-1"
                : undefined,
            )}
            data-new-agent-empty-state={isHeroComposer ? "" : undefined}
            {...(isConnecting ? { "data-disabled": "true" } : {})}
            {...(showScrollToBottom ? {} : { "data-scrolled-to-bottom": "" })}
          >
            <ComposerPendingExtensionUiRequestPanel
              request={activePendingExtensionUiRequest}
              pendingCount={pendingExtensionUiRequests.length}
              isResponding={
                activePendingExtensionUiRequest
                  ? respondingExtensionUiRequestIds.includes(activePendingExtensionUiRequest.id)
                  : false
              }
              onRespond={onRespondToExtensionUiRequest}
            />
            {isHeroComposer && workspaceTopnavActions ? (
              <div
                className="@container/header-actions pointer-events-auto flex items-center gap-(--multi-workbench-chrome-action-gap) overflow-hidden"
                data-new-agent-env-row=""
              >
                {workspaceTopnavActions}
              </div>
            ) : null}
            <ComposerInput
              ref={composerRef}
              variant={isHeroComposer ? "expanded" : "compact"}
              layout={isHeroComposer ? "new-agent" : "thread"}
              composerDraftTarget={composerDraftTarget}
              environmentId={environmentId}
              draftId={draftId}
              activeThreadId={activeThreadId}
              phase={phase}
              isTurnRunning={isTurnRunning}
              isConnecting={isConnecting}
              isSendBusy={isSendBusy}
              isPreparingWorktree={isPreparingWorktree}
              queuedComposerItems={queuedComposerItems}
              editingQueuedComposerItemId={editingQueuedComposerItemId}
              queuedComposerItemsExpanded={queuedComposerItemsExpanded}
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
              planSurfaceOpen={planSurfaceOpen}
              interactionMode={interactionMode}
              activeContextWindow={activeContextWindow}
              resolvedTheme={resolvedTheme}
              settings={settings}
              keybindings={keybindings}
              terminalOpen={terminalState.terminalOpen}
              gitCwd={gitCwd}
              branchName={composerBranchName}
              executionModeLabel={composerExecutionModeLabel}
              composerImagesRef={composerImagesRef}
              onSend={handleComposerSend}
              onInterrupt={handleComposerInterrupt}
              onBuildPlan={handleBuildActiveProposedPlan}
              onViewPlan={handleViewActivePlan}
              onRespondToApproval={handleRespondToApproval}
              onSelectActivePendingUserInputOption={onSelectActivePendingUserInputOption}
              onAdvanceActivePendingUserInput={onAdvanceActivePendingUserInput}
              onPreviousActivePendingUserInputQuestion={onPreviousActivePendingUserInputQuestion}
              onChangeActivePendingUserInputCustomAnswer={
                onChangeActivePendingUserInputCustomAnswer
              }
              onBeginEditQueuedComposerItem={handleBeginEditQueuedComposerItem}
              onCancelEditingQueuedComposerItem={handleCancelEditingQueuedComposerItem}
              onRemoveQueuedComposerItem={handleRemoveQueuedComposerItem}
              onSendQueuedComposerItemNow={handleSendQueuedComposerItemNow}
              onReorderQueuedComposerItem={handleReorderQueuedComposerItem}
              onQueuedComposerItemsExpandedChange={handleQueuedComposerItemsExpandedChange}
              toggleInteractionMode={toggleInteractionMode}
              handleInteractionModeChange={handleInteractionModeChange}
              setThreadError={setThreadError}
              onExpandImage={onExpandTimelineImage}
            />
            {heroComposerActions}
            {isHeroComposer ? <NewAgentFooterTip tip={newAgentFooterTip} /> : null}
          </div>

          {pullRequestDialogState ? (
            <PullRequestThreadDialog
              key={pullRequestDialogState.key}
              open
              environmentId={gitEnvironmentId ?? environmentId}
              threadId={activeThread.id}
              cwd={activeProjectCwd ?? gitCwd}
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
        />
      ))}

      {expandedImage && (
        <ExpandedImageDialog
          key={`${expandedImage.index}:${expandedImage.images.map((image) => image.src).join("\n")}`}
          preview={expandedImage}
          onClose={closeExpandedImage}
        />
      )}
    </div>
  );
}

function useStableLatestContextWindowSnapshot(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ContextWindowSnapshot | null {
  const nextSnapshot = useMemo(() => deriveLatestContextWindowSnapshot(activities), [activities]);
  const previousSnapshotRef = useRef<ContextWindowSnapshot | null>(null);

  if (!areSameContextWindowSnapshot(previousSnapshotRef.current, nextSnapshot)) {
    previousSnapshotRef.current = nextSnapshot;
  }

  return previousSnapshotRef.current;
}

function useSharedChatActivities(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ReadonlyArray<OrchestrationThreadActivity> {
  const previousRef = useRef<ReadonlyArray<OrchestrationThreadActivity>>(EMPTY_ACTIVITIES);

  return useMemo(() => {
    const filtered = omitSubagentActivitiesFromSharedChat(activities);
    if (areSameActivityReferences(previousRef.current, filtered)) {
      return previousRef.current;
    }
    previousRef.current = filtered;
    return filtered;
  }, [activities]);
}

function omitSubagentActivitiesFromSharedChat(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ReadonlyArray<OrchestrationThreadActivity> {
  let sharedActivities: OrchestrationThreadActivity[] | null = null;
  for (let index = 0; index < activities.length; index += 1) {
    const activity = activities[index];
    if (!activity) {
      continue;
    }
    if (activity.kind.startsWith("subagent.")) {
      sharedActivities ??= activities.slice(0, index);
      continue;
    }
    sharedActivities?.push(activity);
  }
  return sharedActivities ?? activities;
}

function areSameActivityReferences(
  previous: ReadonlyArray<OrchestrationThreadActivity>,
  next: ReadonlyArray<OrchestrationThreadActivity>,
): boolean {
  if (previous === next) {
    return true;
  }
  if (previous.length !== next.length) {
    return false;
  }
  for (let index = 0; index < previous.length; index += 1) {
    if (previous[index] !== next[index]) {
      return false;
    }
  }
  return true;
}

function areSameContextWindowSnapshot(
  left: ContextWindowSnapshot | null,
  right: ContextWindowSnapshot | null,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }

  return (
    left.usedTokens === right.usedTokens &&
    left.totalProcessedTokens === right.totalProcessedTokens &&
    left.maxTokens === right.maxTokens &&
    areSameContextWindowCategories(left.categories, right.categories) &&
    left.remainingTokens === right.remainingTokens &&
    left.usedPercentage === right.usedPercentage &&
    left.remainingPercentage === right.remainingPercentage &&
    left.inputTokens === right.inputTokens &&
    left.cachedInputTokens === right.cachedInputTokens &&
    left.outputTokens === right.outputTokens &&
    left.reasoningOutputTokens === right.reasoningOutputTokens &&
    left.lastUsedTokens === right.lastUsedTokens &&
    left.lastInputTokens === right.lastInputTokens &&
    left.lastCachedInputTokens === right.lastCachedInputTokens &&
    left.lastOutputTokens === right.lastOutputTokens &&
    left.lastReasoningOutputTokens === right.lastReasoningOutputTokens &&
    left.toolUses === right.toolUses &&
    left.durationMs === right.durationMs &&
    left.compactsAutomatically === right.compactsAutomatically &&
    left.updatedAt === right.updatedAt
  );
}

function areSameContextWindowCategories(
  left: ContextWindowSnapshot["categories"],
  right: ContextWindowSnapshot["categories"],
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right || left.length !== right.length) {
    return false;
  }
  return left.every((leftCategory, index) => {
    const rightCategory = right[index];
    return (
      rightCategory !== undefined &&
      leftCategory.id === rightCategory.id &&
      leftCategory.label === rightCategory.label &&
      leftCategory.tokens === rightCategory.tokens
    );
  });
}

interface StableWorkLogEntryState {
  byId: Map<string, WorkLogEntry>;
  result: WorkLogEntry[];
}

function useStableCompletedWorkLogEntries(entries: ReadonlyArray<WorkLogEntry>): WorkLogEntry[] {
  const stateRef = useRef<StableWorkLogEntryState>({
    byId: new Map(),
    result: [],
  });

  return useMemo(() => {
    const previous = stateRef.current;
    const nextById = new Map<string, WorkLogEntry>();
    let changed = entries.length !== previous.result.length;

    const result = entries.map((entry, index) => {
      if (entry.status === "running") {
        changed = true;
        return entry;
      }

      const previousEntry = previous.byId.get(entry.id);
      const stableEntry =
        previousEntry && canReuseCompletedWorkLogEntry(previousEntry, entry)
          ? previousEntry
          : entry;
      nextById.set(entry.id, stableEntry);

      if (!changed && previous.result[index] !== stableEntry) {
        changed = true;
      }

      return stableEntry;
    });

    const nextState = changed ? { byId: nextById, result } : previous;
    if (!changed) {
      return previous.result;
    }

    stateRef.current = nextState;
    return result;
  }, [entries]);
}

function canReuseCompletedWorkLogEntry(previous: WorkLogEntry, next: WorkLogEntry): boolean {
  return (
    previous.status !== "running" &&
    next.status !== "running" &&
    previous.id === next.id &&
    previous.createdAt === next.createdAt &&
    previous.completedAt === next.completedAt &&
    previous.label === next.label &&
    previous.detail === next.detail &&
    previous.output === next.output &&
    previous.command === next.command &&
    previous.rawCommand === next.rawCommand &&
    previous.tone === next.tone &&
    previous.status === next.status &&
    previous.toolCallId === next.toolCallId &&
    previous.toolTitle === next.toolTitle &&
    previous.itemType === next.itemType &&
    previous.requestKind === next.requestKind &&
    previous.extensionUiRequestId === next.extensionUiRequestId &&
    previous.extensionUiRequestKind === next.extensionUiRequestKind &&
    previous.taskId === next.taskId &&
    previous.isToolSummary === next.isToolSummary &&
    areSameStringArray(previous.changedFiles, next.changedFiles) &&
    areSameStringArray(previous.precedingToolUseIds, next.precedingToolUseIds) &&
    areSameToolDisplayArtifacts(previous.artifacts, next.artifacts) &&
    areSameSubagentSummaries(previous.subagents, next.subagents) &&
    areSameSubagentAction(previous.subagentAction, next.subagentAction)
  );
}

function areSameStringArray(
  previous: ReadonlyArray<string> | undefined,
  next: ReadonlyArray<string> | undefined,
): boolean {
  if (previous === next) {
    return true;
  }
  if (!previous || !next || previous.length !== next.length) {
    return false;
  }
  for (let index = 0; index < previous.length; index += 1) {
    if (previous[index] !== next[index]) {
      return false;
    }
  }
  return true;
}

function areSameToolDisplayArtifacts(
  previous: ReadonlyArray<ToolDisplayArtifact> | undefined,
  next: ReadonlyArray<ToolDisplayArtifact> | undefined,
): boolean {
  if (previous === next) {
    return true;
  }
  if (!previous || !next || previous.length !== next.length) {
    return false;
  }
  for (let index = 0; index < previous.length; index += 1) {
    const previousArtifact = previous[index];
    const nextArtifact = next[index];
    if (
      !previousArtifact ||
      !nextArtifact ||
      !areSameToolDisplayArtifact(previousArtifact, nextArtifact)
    ) {
      return false;
    }
  }
  return true;
}

function areSameToolDisplayArtifact(
  previous: ToolDisplayArtifact,
  next: ToolDisplayArtifact,
): boolean {
  if (previous.type !== next.type) {
    return false;
  }

  switch (previous.type) {
    case "command":
      return (
        next.type === "command" &&
        previous.command === next.command &&
        previous.output === next.output &&
        previous.exitCode === next.exitCode &&
        previous.durationMs === next.durationMs &&
        previous.truncated === next.truncated &&
        previous.fullOutputPath === next.fullOutputPath &&
        previous.isPartial === next.isPartial
      );
    case "diff":
      return (
        next.type === "diff" &&
        previous.source === next.source &&
        previous.title === next.title &&
        previous.summary === next.summary &&
        previous.unifiedDiff === next.unifiedDiff &&
        previous.isPreview === next.isPreview &&
        areSameToolDiffFiles(previous.files, next.files)
      );
    case "read":
      return (
        next.type === "read" &&
        previous.path === next.path &&
        previous.output === next.output &&
        previous.truncated === next.truncated &&
        previous.isPartial === next.isPartial
      );
    case "search":
      return (
        next.type === "search" &&
        previous.query === next.query &&
        previous.output === next.output &&
        previous.truncated === next.truncated &&
        previous.isPartial === next.isPartial &&
        areSameStringArray(previous.matchedFiles, next.matchedFiles)
      );
    case "diagnostic":
      return (
        next.type === "diagnostic" &&
        previous.severity === next.severity &&
        previous.message === next.message
      );
    case "raw":
      return next.type === "raw" && previous.text === next.text;
  }
}

function areSameToolDiffFiles(
  previous: Extract<ToolDisplayArtifact, { type: "diff" }>["files"],
  next: Extract<ToolDisplayArtifact, { type: "diff" }>["files"],
): boolean {
  if (previous === next) {
    return true;
  }
  if (previous.length !== next.length) {
    return false;
  }
  for (let index = 0; index < previous.length; index += 1) {
    const previousFile = previous[index];
    const nextFile = next[index];
    if (
      !previousFile ||
      !nextFile ||
      previousFile.path !== nextFile.path ||
      previousFile.additions !== nextFile.additions ||
      previousFile.deletions !== nextFile.deletions
    ) {
      return false;
    }
  }
  return true;
}

function areSameSubagentSummaries(
  previous: ReadonlyArray<WorkLogSubagent> | undefined,
  next: ReadonlyArray<WorkLogSubagent> | undefined,
): boolean {
  if (previous === next) {
    return true;
  }
  if (!previous || !next || previous.length !== next.length) {
    return false;
  }
  for (let index = 0; index < previous.length; index += 1) {
    const previousSubagent = previous[index];
    const nextSubagent = next[index];
    if (
      !previousSubagent ||
      !nextSubagent ||
      previousSubagent.threadId !== nextSubagent.threadId ||
      previousSubagent.subagentThreadId !== nextSubagent.subagentThreadId ||
      previousSubagent.title !== nextSubagent.title ||
      previousSubagent.nickname !== nextSubagent.nickname ||
      previousSubagent.role !== nextSubagent.role ||
      previousSubagent.rawStatus !== nextSubagent.rawStatus ||
      previousSubagent.latestUpdate !== nextSubagent.latestUpdate ||
      previousSubagent.statusLabel !== nextSubagent.statusLabel ||
      previousSubagent.isActive !== nextSubagent.isActive ||
      previousSubagent.usedTokens !== nextSubagent.usedTokens ||
      previousSubagent.maxTokens !== nextSubagent.maxTokens ||
      previousSubagent.usedPercentage !== nextSubagent.usedPercentage ||
      previousSubagent.hasDetails !== nextSubagent.hasDetails ||
      previousSubagent.logs?.length !== nextSubagent.logs?.length ||
      previousSubagent.transcriptItems?.length !== nextSubagent.transcriptItems?.length
    ) {
      return false;
    }
  }
  return true;
}

function areSameSubagentAction(
  previous: WorkLogEntry["subagentAction"],
  next: WorkLogEntry["subagentAction"],
): boolean {
  if (previous === next) {
    return true;
  }
  if (!previous || !next) {
    return false;
  }
  return (
    previous.tool === next.tool &&
    previous.status === next.status &&
    previous.summaryText === next.summaryText &&
    previous.model === next.model &&
    previous.prompt === next.prompt
  );
}

function useStableEvent<TArgs extends unknown[], TResult>(
  handler: (...args: TArgs) => TResult,
): (...args: TArgs) => TResult {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  return useCallback((...args: TArgs) => handlerRef.current(...args), []);
}

function WorkspaceToolbarWithGitStatus({
  environmentId,
  cwd,
  workspaceName,
  workspacePath,
  projects,
  activeProjectRef,
  envMode,
  activeWorktreePath,
  activeThreadBranch,
  canChangeEnvMode,
  disabled,
  onEnvModeChange,
  onProjectSelect,
  onOpenFolder,
  onBranchSelect,
  onCheckoutPullRequest,
  onStoredBranchAvailabilityChange,
}: {
  environmentId: EnvironmentId;
  cwd: string | null;
  workspaceName: string;
  workspacePath: string | null;
  projects: ReadonlyArray<WorkspaceToolbarProject>;
  activeProjectRef: ScopedProjectRef | null;
  envMode: DraftThreadEnvMode;
  activeWorktreePath: string | null;
  activeThreadBranch: string | null;
  canChangeEnvMode: boolean;
  disabled: boolean;
  onEnvModeChange: (mode: DraftThreadEnvMode, branch: string | null) => void;
  onProjectSelect: (projectRef: ScopedProjectRef) => Promise<void> | void;
  onOpenFolder: () => void;
  onBranchSelect: (branch: GitBranch) => Promise<void> | void;
  onCheckoutPullRequest: (reference: string) => void;
  onStoredBranchAvailabilityChange: (missingBranch: string | null) => void;
}) {
  const gitStatusQuery = useGitStatus({ environmentId, cwd });

  return (
    <WorkspaceToolbar
      environmentId={environmentId}
      cwd={cwd}
      workspaceName={workspaceName}
      workspacePath={workspacePath}
      projects={projects}
      activeProjectRef={activeProjectRef}
      envMode={envMode}
      activeWorktreePath={activeWorktreePath}
      activeThreadBranch={activeThreadBranch}
      currentGitBranch={gitStatusQuery.data?.branch ?? null}
      hasLocalChanges={gitStatusQuery.data?.hasWorkingTreeChanges ?? false}
      isGitRepo={gitStatusQuery.data?.isRepo ?? false}
      canChangeEnvMode={canChangeEnvMode}
      disabled={disabled}
      onEnvModeChange={onEnvModeChange}
      onProjectSelect={onProjectSelect}
      onOpenFolder={onOpenFolder}
      onBranchSelect={onBranchSelect}
      onCheckoutPullRequest={onCheckoutPullRequest}
      onStoredBranchAvailabilityChange={onStoredBranchAvailabilityChange}
    />
  );
}
