import {
  type ApprovalRequestId,
  type DesktopExtensionUiRequest,
  type EnvironmentId,
  type MessageId,
  type ModelSelection,
  type ProjectScript,
  type ProjectId,
  type ScopedProjectRef,
  type RuntimeApprovalDecision,
  type ScopedThreadRef,
  type ThreadId,
  type KeybindingCommand,
  type ResolvedKeybindingsConfig,
  OrchestrationThreadActivity,
  AgentInteractionMode,
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
import { Alert, AlertDescription, AlertTitle } from "@multi/ui/alert";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useShallow } from "zustand/react/shallow";
import { useGitStatus } from "~/lib/git-status-state";
import { readEnvironmentApi } from "../../../environment-api";
import { usePrimaryEnvironmentId } from "../../../environments/primary";
import { sendRuntimeTurn } from "~/lib/runtime-turn-dispatch";
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
} from "../../../session-logic";
import {
  selectEnvironmentState,
  selectProjectsAcrossEnvironments,
  selectSidebarThreadsAcrossEnvironments,
  useStore,
} from "../../../stores/thread-store";
import {
  createProjectSelectorByRef,
  createThreadSelectorByRef,
} from "../../../stores/thread-selectors";
import { useUiStateStore } from "../../../stores/ui-state-store";
import {
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
import { newCommandId, newDraftId, newMessageId, newThreadId } from "~/lib/utils";
import { useSettings } from "../../../hooks/use-settings";
import { useHandleNewThread } from "../../../hooks/use-handle-new-thread";
import { readMultiRuntimeApi } from "../../../lib/multi-runtime-api";
import { openWorkspaceFolder } from "../../../lib/project-selection";
import { resolveProjectlessCwd, writeStoredProjectSelection } from "../../../lib/project-state";
import {
  findWorkspaceProjectForSource,
  getLatestWorkspaceThreadForProject,
  resolveWorkspaceTarget,
} from "~/lib/workspace-target";
import { deriveLogicalProjectKey } from "../../../stores/project-identity";
import { openDraft, openThread } from "~/app/chat-navigation";
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
import {
  EMPTY_PENDING_TIMELINE_ROWS,
  usePendingThreadSendStore,
} from "../../../stores/pending-thread-send-store";
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
  LAST_INVOKED_SCRIPT_BY_PROJECT_KEY,
  LastInvokedScriptByProjectSchema,
  type LocalDispatchSnapshot,
  type PullRequestDialogState,
  shouldWriteThreadErrorToCurrentServerThread,
  threadHasStarted,
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
import { useGitAgentActionHandoff } from "~/lib/git-agent-action-handoff";
import { IconChevronRightMedium, IconExclamationCircle } from "central-icons";
import { useAttachmentPreviewHandoff } from "./attachment-preview-handoff";
import { WorkspaceToolbar } from "./workspace-toolbar";
import { applyLocalThreadCreated } from "~/stores/local-orchestration-events";
import {
  type ComposerSendSnapshot,
  assertActiveThread,
  nextComposerInteractionMode,
  workLogEntrySubagents,
} from "./chat-view.logic";
import {
  containsThreadEntry,
  deriveThreadBranchView,
  filterActivitiesToBranch,
  filterChatTimelineRowsToBranch,
  filterMessagesToBranch,
  findThreadMessageEntry,
  materializeTimelineEntriesFromChatTimelineRows,
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
  PendingTimelineRowsServerAckSync,
  RetainServerThreadDetailSync,
  TerminalLaunchActiveThreadSync,
  TerminalLaunchClosedSync,
  TerminalLaunchLocalSettledSync,
  TerminalLaunchStoredSettledSync,
  TerminalOpenFocusSync,
  ThreadMediaResetSync,
} from "./chat-view-lifecycle-sync";
import {
  appendPendingTimelineRowsToMessages,
  appendTransientTimelineEntries,
  createPendingTimelineRow,
  createPendingTimelineRowFromMessage,
  filterPendingTimelineRowsToBranch,
  pendingTimelineRowMessages,
  unacknowledgedPendingTimelineRows,
} from "./pending-timeline-rows";

const EMPTY_ACTIVITIES: OrchestrationThreadActivity[] = [];
const EMPTY_CHAT_TIMELINE_ROWS: NonNullable<Thread["chatTimelineRows"]> = [];
const EMPTY_PENDING_APPROVALS: PendingApproval[] = [];
const EMPTY_THREAD_MESSAGES: ChatMessage[] = [];
const EMPTY_TIMELINE_PROPOSED_PLANS: Thread["proposedPlans"] = [];
const DOCKED_COMPOSER_TIMELINE_RESERVE_PX = 88;

function messagesAcknowledgementKey(messages: readonly ChatMessage[] | undefined): string {
  return JSON.stringify(messages?.map((message) => [message.id, message.role, message.text]) ?? []);
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
  activeThread: Thread | undefined;
  activeLatestTurn: Thread["latestTurn"] | null;
  phase: SessionPhase;
  activePendingApproval: ApprovalRequestId | null;
  activePendingUserInput: ApprovalRequestId | null;
  threadError: string | null | undefined;
}) {
  const [localDispatch, setLocalDispatch] = useState<LocalDispatchSnapshot | null>(null);

  const beginLocalDispatch = (options?: { preparingWorktree?: boolean }) => {
    const preparingWorktree = Boolean(options?.preparingWorktree);
    setLocalDispatch((current) => {
      if (current) {
        return current.preparingWorktree === preparingWorktree
          ? current
          : { ...current, preparingWorktree };
      }
      return createLocalDispatchSnapshot(input.activeThread, options);
    });
  };

  const resetLocalDispatch = () => {
    setLocalDispatch(null);
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
      setLocalDispatch(null);
    }
  }, [localDispatch, serverAcknowledgedLocalDispatch]);

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
    routeKind === "server" ? routeThreadRef : props.draftId;
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
    defaultProjectCwd,
    defaultProjectEnvironmentId,
    defaultProjectRef,
    handleNewThread: handleWorkspaceNewThread,
  } = useHandleNewThread();
  const defaultWorkspaceProject = useStore(createProjectSelectorByRef(defaultProjectRef));
  const navigate = useNavigate();
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
  const gitAgentActionHandoff = useGitAgentActionHandoff();
  const subagentTrayPresented = useSubagentTrayStore((state) => state.presented);
  const focusedSubagentTrayKey = useSubagentTrayStore((state) => state.focus?.key ?? null);
  const closeSubagentTray = useSubagentTrayStore((state) => state.closeTray);
  const updateFocusedSubagentTray = useSubagentTrayStore((state) => state.updateTraySubagent);
  const draftThread = useComposerDraftStore((store) =>
    routeKind === "server"
      ? store.getDraftSessionByRef(routeThreadRef)
      : draftId
        ? store.getDraftSession(draftId)
        : null,
  );
  const promptRef = useRef("");
  const composerImagesRef = useRef<ComposerImageAttachment[]>([]);
  const localComposerRef = useRef<ComposerInputHandle | null>(null);
  const composerRef = useComposerHandleContext() ?? localComposerRef;
  const [editingUserMessageId, setEditingUserMessageId] = useState<MessageId | null>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [expandedImage, setExpandedImage] = useState<ExpandedImagePreview | null>(null);
  const pendingTimelineRows = usePendingThreadSendStore(
    (store) => store.pendingRowsByThreadKey[routeThreadKey] ?? EMPTY_PENDING_TIMELINE_ROWS,
  );
  const appendPendingTimelineRow = usePendingThreadSendStore((store) => store.appendPendingRow);
  const removePendingTimelineRows = usePendingThreadSendStore((store) => store.removePendingRows);
  const removePendingTimelineRowsByClientSendKey = (messageId: MessageId) => {
    const removedRows = removePendingTimelineRows(routeThreadKey, new Set([messageId]));
    for (const message of pendingTimelineRowMessages(removedRows)) {
      revokeUserMessagePreviewUrls(message);
    }
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
  const storeCloseTerminal = useTerminalStateStore((s) => s.closeTerminal);
  const sidebarThreads = useStore(useShallow(selectSidebarThreadsAcrossEnvironments));
  const serverThreadKeys = sidebarThreads.map((thread) =>
    scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
  );
  const storeServerTerminalLaunchContext = useTerminalStateStore(
    (s) => s.terminalLaunchContextByThreadKey[scopedThreadKey(routeThreadRef)] ?? null,
  );
  const storeClearTerminalLaunchContext = useTerminalStateStore(
    (s) => s.clearTerminalLaunchContext,
  );
  const draftThreadsByThreadKey = useComposerDraftStore((store) => store.draftThreadsByThreadKey);
  const draftThreadKeys = Object.values(draftThreadsByThreadKey).map((draftThread) =>
    scopedThreadKey(scopeThreadRef(draftThread.environmentId, draftThread.threadId)),
  );
  const [mountedTerminalThreadKeys, setMountedTerminalThreadKeys] = useState<string[]>([]);
  const mountedTerminalThreadRefs = mountedTerminalThreadKeys.flatMap((mountedThreadKey) => {
    const mountedThreadRef = parseScopedThreadKey(mountedThreadKey);
    return mountedThreadRef ? [{ key: mountedThreadKey, threadRef: mountedThreadRef }] : [];
  });

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
  const isServerThread = routeKind === "server" && serverThread !== undefined;
  const activeThread = isServerThread ? serverThread : localDraftThread;
  const interactionMode =
    composerInteractionMode ?? activeThread?.interactionMode ?? DEFAULT_INTERACTION_MODE;
  const isLocalDraftThread = !isServerThread && localDraftThread !== undefined;
  const activeThreadId = activeThread?.id ?? null;
  const activeThreadRef = activeThread
    ? scopeThreadRef(activeThread.environmentId, activeThread.id)
    : null;
  const activeThreadKey = activeThreadRef ? scopedThreadKey(activeThreadRef) : null;
  const existingOpenTerminalThreadKeys = (() => {
    const existingThreadKeys = new Set<string>([...serverThreadKeys, ...draftThreadKeys]);
    return openTerminalThreadKeys.filter((nextThreadKey) => existingThreadKeys.has(nextThreadKey));
  })();
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
    console.log("[workspace.toolbar.select.start]", {
      requestedEnvironmentId: projectRef.environmentId,
      requestedProjectId: projectRef.projectId,
      routeKind,
      routeEnvironmentId: environmentId,
      routeThreadId: threadId,
      draftId: draftId ?? null,
      workspaceProjectCount: workspaceProjects.length,
      activeThreadEnvironmentId: activeThread?.environmentId ?? null,
      activeThreadId: activeThread?.id ?? null,
      activeThreadProjectId: activeThread?.projectId ?? null,
      currentWorkspaceEnvironmentId: workspaceProject?.environmentId ?? null,
      currentWorkspaceProjectId: workspaceProject?.id ?? null,
      currentWorkspaceCwd: workspaceTarget.cwd,
    });
    const currentWorkspaceProjects = selectProjectsAcrossEnvironments(useStore.getState());
    const selectedProject = currentWorkspaceProjects.find(
      (project) =>
        project.environmentId === projectRef.environmentId && project.id === projectRef.projectId,
    );
    if (!selectedProject) {
      console.log("[workspace.toolbar.select.missing-project-in-render-snapshot]", {
        requestedEnvironmentId: projectRef.environmentId,
        requestedProjectId: projectRef.projectId,
        workspaceProjectCount: workspaceProjects.length,
        currentWorkspaceProjectCount: currentWorkspaceProjects.length,
      });
      return handleWorkspaceNewThread(projectRef, {
        envMode: settings.defaultThreadEnvMode,
        logicalProjectKey: options?.logicalProjectKey ?? null,
      });
    }
    console.log("[workspace.toolbar.select.project-found]", {
      selectedEnvironmentId: selectedProject.environmentId,
      selectedProjectId: selectedProject.id,
      selectedCwd: selectedProject.cwd,
    });
    writeStoredProjectSelection({
      environmentId: selectedProject.environmentId,
      projectId: selectedProject.id,
      cwd: selectedProject.cwd,
    });
    const currentSidebarThreads = selectSidebarThreadsAcrossEnvironments(useStore.getState());
    const latestThread = getLatestWorkspaceThreadForProject({
      project: selectedProject,
      projects: currentWorkspaceProjects,
      threads: currentSidebarThreads,
      sortOrder: settings.sidebarThreadSortOrder,
    });
    if (latestThread) {
      console.log("[workspace.toolbar.select.open-thread]", {
        selectedEnvironmentId: selectedProject.environmentId,
        selectedProjectId: selectedProject.id,
        selectedCwd: selectedProject.cwd,
        threadEnvironmentId: latestThread.environmentId,
        threadId: latestThread.id,
        threadProjectId: latestThread.projectId,
      });
      await openThread(navigate, scopeThreadRef(latestThread.environmentId, latestThread.id));
      return;
    }
    console.log("[workspace.toolbar.select.new-thread]", {
      selectedEnvironmentId: selectedProject.environmentId,
      selectedProjectId: selectedProject.id,
      selectedCwd: selectedProject.cwd,
      envMode: settings.defaultThreadEnvMode,
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
        await openDraft(navigate, storedDraftSession.draftId);
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

    const nextDraftId = newDraftId();
    const nextThreadId = newThreadId();
    setLogicalProjectDraftThreadId(logicalProjectKey, activeProjectRef, nextDraftId, {
      threadId: nextThreadId,
      createdAt: new Date().toISOString(),
      interactionMode: DEFAULT_INTERACTION_MODE,
      ...input,
    });
    await openDraft(navigate, nextDraftId);
    return nextThreadId;
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

  const phase = derivePhase(activeThread?.session ?? null);
  const threadActivities = activeThread?.activities ?? EMPTY_ACTIVITIES;
  const chatTimelineRows = activeThread?.chatTimelineRows ?? EMPTY_CHAT_TIMELINE_ROWS;
  const leafId = activeThread?.leafId ?? null;
  const branchViewEntryId = containsThreadEntry(activeThread ?? null, leafId) ? leafId : null;
  const branchView = deriveThreadBranchView(activeThread ?? null, branchViewEntryId);
  const visibleThreadActivities = filterActivitiesToBranch(threadActivities, branchView);
  const visibleChatTimelineRows = filterChatTimelineRowsToBranch(chatTimelineRows, branchView);
  const activeRunningTurnId =
    activeThread?.session?.orchestrationStatus === "running"
      ? (activeThread.session.activeTurnId ?? activeLatestTurn?.turnId ?? null)
      : null;
  const workLogEntries = deriveWorkLogEntries(visibleThreadActivities, undefined, {
    activeRunningTurnId,
  });
  useEffect(() => {
    if (focusedSubagentTrayKey === null) {
      return;
    }

    for (const subagent of workLogEntries.flatMap(workLogEntrySubagents)) {
      updateFocusedSubagentTray(subagent);
    }
  }, [focusedSubagentTrayKey, updateFocusedSubagentTray, workLogEntries]);
  const pendingApprovals = latestTurnSettled
    ? EMPTY_PENDING_APPROVALS
    : derivePendingApprovals(threadActivities, activeLatestTurn?.turnId ?? null);
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
    promptRef,
    environmentId,
    activeThreadId,
    threadActivities,
    activeLatestTurnTurnId: activeLatestTurn?.turnId ?? null,
    latestTurnSettled,
    setThreadError,
  });
  const pendingExtensionUiRequests = useAgentRuntimeStore((state) =>
    selectPendingExtensionUiRequestsForThread(state, activeThreadId),
  );
  const activePendingExtensionUiRequest = pendingExtensionUiRequests[0] ?? null;
  const [respondingExtensionUiRequestIds, setRespondingExtensionUiRequestIds] = useState<string[]>(
    [],
  );
  const activeProposedPlan = (() => {
    if (!latestTurnSettled) {
      return null;
    }
    return findLatestProposedPlan(
      activeThread?.proposedPlans ?? [],
      activeLatestTurn?.turnId ?? null,
    );
  })();
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
    activeThread,
    activeLatestTurn,
    phase,
    activePendingApproval: activePendingApproval?.requestId ?? null,
    activePendingUserInput: activePendingUserInput?.requestId ?? null,
    threadError: activeThread?.error,
  });
  const isWorking = phase === "running" || isSendBusy || isConnecting;
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
  const activeWorkStartedAt = deriveActiveWorkStartedAt(
    activeLatestTurn,
    activeThread?.session ?? null,
    localDispatchStartedAt,
  );
  const threadMessages = activeThread?.messages ?? EMPTY_THREAD_MESSAGES;
  const serverMessages = filterMessagesToBranch(threadMessages, branchView);
  const {
    attachmentPreviewHandoffSync,
    applyAttachmentPreviewHandoff,
    clearAttachmentPreviewHandoffs,
    handoffAttachmentPreviews,
  } = useAttachmentPreviewHandoff({ serverMessages });
  const localPendingTimelineRows = (() => {
    const pendingGitAgentMessage =
      gitAgentActionHandoff?.target.environmentId === environmentId &&
      gitAgentActionHandoff.target.threadId === threadId
        ? gitAgentActionHandoff.optimisticMessage
        : null;
    const pendingGitAgentUserMessage =
      pendingGitAgentMessage?.role === "user"
        ? ({ ...pendingGitAgentMessage, role: "user" } satisfies ChatMessage & { role: "user" })
        : null;
    const pendingGitAgentRow =
      pendingGitAgentUserMessage !== null
        ? createPendingTimelineRowFromMessage({
            message: pendingGitAgentUserMessage,
            parentEntryId: branchView.entryId,
          })
        : null;
    return pendingGitAgentRow === null
      ? pendingTimelineRows
      : [...pendingTimelineRows, pendingGitAgentRow];
  })();
  const visiblePendingTimelineRows = filterPendingTimelineRowsToBranch(
    localPendingTimelineRows,
    branchView,
  );
  const renderPendingTimelineRows = unacknowledgedPendingTimelineRows({
    pendingRows: visiblePendingTimelineRows,
    committedMessages: serverMessages,
  });
  const timelineMessages = (() => {
    const serverMessagesWithPreviewHandoff = applyAttachmentPreviewHandoff(serverMessages);
    return appendPendingTimelineRowsToMessages(
      serverMessagesWithPreviewHandoff,
      renderPendingTimelineRows,
    );
  })();
  const liveTimelineMessages = timelineMessages.filter((message) => message.streaming);
  const timelineEntries = (() => {
    const committedEntries = materializeTimelineEntriesFromChatTimelineRows({
      rows: visibleChatTimelineRows,
      messages: timelineMessages,
      proposedPlans: activeThread?.proposedPlans ?? EMPTY_TIMELINE_PROPOSED_PLANS,
      activities: threadActivities,
      workLogOptions: { activeRunningTurnId },
    });
    return appendTransientTimelineEntries({
      entries: committedEntries,
      liveMessages: liveTimelineMessages,
      pendingRows: renderPendingTimelineRows,
    });
  })();
  const editableUserMessageIds = (() => {
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
  })();
  const activeEditingUserMessageId =
    editingUserMessageId &&
    editableUserMessageIds.has(editingUserMessageId) &&
    timelineMessages.some(
      (message) => message.id === editingUserMessageId && message.role === "user",
    )
      ? editingUserMessageId
      : null;

  const onBeginEditUserMessage = (messageId: MessageId) => {
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
  };

  const onCancelEditUserMessage = (messageId: MessageId) => {
    setEditingUserMessageId((current) => (current === messageId ? null : current));
    clearComposerDraftContent(editComposerDraftTarget);
  };

  const keybindings = useServerKeybindings();
  const availableEditors = useServerAvailableEditors();
  const serverConfig = useServerConfig();
  const projectlessCwd = resolveProjectlessCwd(serverConfig?.cwd);
  const workspaceSource = activeThread ?? draftThread ?? null;
  const workspaceTarget = resolveWorkspaceTarget({
    source: workspaceSource,
    defaultProject: defaultWorkspaceProject ?? null,
    defaultProjectCwd,
    defaultProjectEnvironmentId,
    defaultProjectRef,
    projects: workspaceProjects,
    projectlessCwd,
    fallbackEnvironmentId: environmentId,
  });
  useEffect(() => {
    const sourceProjectIdMatchCount = workspaceSource?.projectId
      ? workspaceProjects.filter((project) => project.id === workspaceSource.projectId).length
      : 0;
    const sourceExactProjectMatchCount = workspaceSource?.projectId
      ? workspaceProjects.filter(
          (project) =>
            project.environmentId === workspaceSource.environmentId &&
            project.id === workspaceSource.projectId,
        ).length
      : 0;
    const targetDebugPayload = {
      routeKind,
      routeEnvironmentId: environmentId,
      routeThreadId: threadId,
      draftId: draftId ?? null,
      projectCount: workspaceProjects.length,
      sourceProjectIdMatchCount,
      sourceExactProjectMatchCount,
      sourceEnvironmentId: workspaceSource?.environmentId ?? null,
      sourceProjectId: workspaceSource?.projectId ?? null,
      sourceWorktreePath: workspaceSource?.worktreePath ?? null,
      defaultProjectEnvironmentId: defaultWorkspaceProject?.environmentId ?? null,
      defaultProjectId: defaultWorkspaceProject?.id ?? null,
      defaultProjectCwd: defaultWorkspaceProject?.cwd ?? null,
      targetEnvironmentId: workspaceTarget.environmentId,
      targetRpcEnvironmentId: workspaceTarget.rpcEnvironmentId,
      targetProjectEnvironmentId: workspaceTarget.project?.environmentId ?? null,
      targetProjectId: workspaceTarget.project?.id ?? null,
      targetProjectCwd: workspaceTarget.projectCwd,
      targetCwd: workspaceTarget.cwd,
      targetWorktreePath: workspaceTarget.worktreePath,
      workspaceKey: workspaceTarget.workspaceKey,
    };
    console.log("[workspace.target.chat-view]", targetDebugPayload);
  }, [
    defaultWorkspaceProject?.cwd,
    defaultWorkspaceProject?.environmentId,
    defaultWorkspaceProject?.id,
    draftId,
    environmentId,
    routeKind,
    threadId,
    workspaceSource?.environmentId,
    workspaceSource?.projectId,
    workspaceSource?.worktreePath,
    workspaceProjects,
    workspaceTarget.cwd,
    workspaceTarget.environmentId,
    workspaceTarget.project?.environmentId,
    workspaceTarget.project?.id,
    workspaceTarget.projectCwd,
    workspaceTarget.rpcEnvironmentId,
    workspaceTarget.worktreePath,
    workspaceTarget.workspaceKey,
  ]);
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
  const gitStatusQuery = useGitStatus({ environmentId: gitEnvironmentId, cwd: gitCwd });
  const handleWorkspaceOpenFolder = () => {
    if (!primaryEnvironmentId) {
      console.log("[workspace.toolbar.pick-folder.blocked]", {
        reason: "missing-primary-environment",
      });
      toastManager.add({
        type: "error",
        title: "Unable to open folder",
        description: "No local environment is available.",
      });
      return;
    }
    if (typeof window === "undefined" || !window.desktopBridge) {
      console.log("[workspace.toolbar.pick-folder.blocked]", {
        reason: "missing-desktop-bridge",
        hasWindow: typeof window !== "undefined",
      });
      toastManager.add({
        type: "error",
        title: "Unable to open folder",
        description: "Folder selection is only available in the desktop app.",
      });
      return;
    }
    const api = readLocalApi();
    if (!api) {
      console.log("[workspace.toolbar.pick-folder.blocked]", {
        reason: "missing-local-api",
      });
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
    console.log("[workspace.toolbar.pick-folder.start]", {
      initialPath,
      primaryEnvironmentId,
      routeKind,
      routeEnvironmentId: environmentId,
      routeThreadId: threadId,
      draftId: draftId ?? null,
      currentWorkspaceEnvironmentId: workspaceProject?.environmentId ?? null,
      currentWorkspaceProjectId: workspaceProject?.id ?? null,
      currentWorkspaceCwd: workspaceTarget.cwd,
      workspaceProjectCount: workspaceProjects.length,
    });

    void api.dialogs
      .pickFolder({ initialPath })
      .then(async (pickedPath) => {
        console.log("[workspace.toolbar.pick-folder.result]", {
          pickedPath: pickedPath ?? null,
          primaryEnvironmentId,
        });
        if (!pickedPath) {
          console.log("[workspace.toolbar.pick-folder.cancelled]");
          return;
        }

        const selection = await openWorkspaceFolder({
          environmentId: primaryEnvironmentId,
          projects: workspaceProjects,
          rawCwd: pickedPath,
          defaultModelSelection: settings.textGenerationModelSelection,
        });
        if (!selection) {
          console.log("[workspace.toolbar.pick-folder.no-selection]", {
            pickedPath,
          });
          return;
        }

        console.log("[workspace.toolbar.pick-folder.selection]", {
          pickedPath,
          selectedEnvironmentId: selection.projectRef.environmentId,
          selectedProjectId: selection.projectRef.projectId,
          selectedCwd: selection.cwd,
          created: selection.created,
          projectAvailable: selection.project !== null,
        });
        await handleWorkspaceProjectSelect(selection.projectRef, {
          logicalProjectKey: selection.logicalProjectKey,
        });
      })
      .catch((error: unknown) => {
        console.log("[workspace.toolbar.pick-folder.error]", {
          error: error instanceof Error ? error.message : String(error),
        });
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
  const activeProjectRoot = activeThreadWorktreePath ?? activeProjectCwd ?? undefined;
  const activeTerminalLaunchContext =
    terminalLaunchContext?.threadId === activeThreadId
      ? terminalLaunchContext
      : (storeServerTerminalLaunchContext ?? null);
  const isGitRepo = gitStatusQuery.data?.isRepo ?? false;
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

  const onUpdateProposedPlan = async (
    proposedPlan: ProposedPlan,
    nextMarkdown: string,
  ): Promise<boolean> => {
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
  };

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
  const currentGitBranch = gitStatusQuery.data?.branch ?? null;
  const sendEnvMode = resolveSendEnvMode({
    requestedEnvMode: envMode,
    isGitRepo,
  });
  const showWorkspaceToolbar = isLocalDraftThread && activeThreadWorktreePath === null;
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
      <div className="flex min-w-0 items-center gap-1 overflow-hidden">
        {showWorkspaceToolbar ? (
          <WorkspaceToolbar
            environmentId={gitEnvironmentId ?? environmentId}
            cwd={workspaceToolbarCwd}
            workspaceName={workspaceProject?.name ?? ""}
            workspacePath={workspaceProject ? (activeProjectCwd ?? gitCwd) : null}
            projects={workspaceProjects}
            activeProjectRef={workspaceTarget.projectRef ?? activeProjectRef}
            envMode={envMode}
            activeWorktreePath={activeWorktreePath}
            activeThreadBranch={activeThreadBranch}
            currentGitBranch={currentGitBranch}
            hasLocalChanges={gitStatusQuery.data?.hasWorkingTreeChanges ?? false}
            isGitRepo={isGitRepo}
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
    const originalMessage = timelineMessages.find(
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
    const messageIdForSend = newMessageId();
    const messageCreatedAt = new Date().toISOString();
    const composerImagesSnapshot = [...composerImages];
    const readTurnAttachments = (() => {
      const preparedAttachments = prepareComposerTurnAttachments(composerImagesSnapshot);
      return () => preparedAttachments;
    })();
    const optimisticAttachments = compiledTurn.optimisticAttachments;
    let turnStartSucceeded = false;
    let optimisticMessageAdded = false;

    sendInFlightRef.current = true;
    try {
      beginLocalDispatch({ preparingWorktree: false });
      isAtBottomRef.current = true;
      showScrollDebouncer.current.cancel();
      setShowScrollToBottom(false);
      await messagesTimelineControllerRef.current?.scrollToBottom({ animated: false });

      appendPendingTimelineRow(
        routeThreadKey,
        createPendingTimelineRow({
          messageId: messageIdForSend,
          text: compiledTurn.outgoingMessageText,
          richText: compiledTurn.outgoingRichText,
          attachments: optimisticAttachments,
          createdAt: messageCreatedAt,
          parentEntryId,
        }),
      );
      optimisticMessageAdded = true;
      setThreadError(threadIdForSend, null);

      await persistThreadSettingsForNextTurn({
        threadId: threadIdForSend,
        createdAt: messageCreatedAt,
        interactionMode: input.interactionMode,
      });

      const turnAttachments = await readTurnAttachments();
      await api.orchestration.dispatchCommand({
        type: "thread.turn.start",
        commandId: newCommandId(),
        threadId: threadIdForSend,
        message: {
          messageId: messageIdForSend,
          role: "user",
          text: compiledTurn.outgoingMessageText,
          ...(compiledTurn.outgoingRichText !== undefined
            ? { richText: compiledTurn.outgoingRichText }
            : {}),
          attachments: turnAttachments,
        },
        modelSelection: activeThread.modelSelection,
        titleSeed: activeThread.title,
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: input.interactionMode,
        parentEntryId,
        createdAt: messageCreatedAt,
      });
      turnStartSucceeded = true;
      setEditingUserMessageId((current) => (current === messageId ? null : current));
      clearComposerDraftContent(editComposerDraftTarget);
      return true;
    } catch (err) {
      if (optimisticMessageAdded) {
        removePendingTimelineRowsByClientSendKey(messageIdForSend);
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
    const compiledTurn = compileComposerSubmitTurn(sendCtx);
    const { trimmedPrompt: trimmed, hasSendableContent } = compiledTurn;
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
        promptRef.current = "";
        clearComposerDraftContent(composerDraftTarget);
        composerRef.current?.resetCursorState();
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
    const isFirstMessage = !isServerThread || activeThread.messages.length === 0;
    const baseBranchForWorktree =
      workspaceProject && isFirstMessage && sendEnvMode === "worktree" && !activeThread.worktreePath
        ? activeThreadBranch
        : null;

    // In worktree mode, require an explicit base branch so we don't silently
    // fall back to local execution when branch selection is missing.
    const shouldCreateWorktree =
      workspaceProject && isFirstMessage && sendEnvMode === "worktree" && !activeThread.worktreePath;
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
    await messagesTimelineControllerRef.current?.scrollToBottom({ animated: false });

    appendPendingTimelineRow(
      routeThreadKey,
      createPendingTimelineRow({
        messageId: messageIdForSend,
        text: compiledTurn.outgoingMessageText,
        richText: compiledTurn.outgoingRichText,
        attachments: optimisticAttachments,
        createdAt: messageCreatedAt,
        parentEntryId: branchView.entryId,
      }),
    );

    setThreadError(threadIdForSend, null);
    if (clearComposerOnSubmit) {
      promptRef.current = "";
      clearComposerDraftContent(composerDraftTarget);
      composerRef.current?.resetCursorState();
    }

    let promotedDraftOptimistically = false;
    let navigatedOptimistically = false;
    let turnStartSucceeded = false;
    await (async () => {
      const title = compiledTurn.title;
      let runtimeCwd = initialRuntimeCwd;
      let threadBranch = activeThreadBranch;
      let threadWorktreePath = activeThread.worktreePath;
      const worktreeBranch = baseBranchForWorktree ? buildTemporaryWorktreeBranchName() : null;
      const shouldDispatchBootstrapTurnStart = Boolean(
        api && (isLocalDraftThread || baseBranchForWorktree),
      );

      // Auto-title from first message
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

      const turnAttachments = await readTurnAttachments();
      const threadProjectId = workspaceProject?.id ?? workspaceTarget.projectRef?.projectId ?? null;
      if (shouldDispatchBootstrapTurnStart && api) {
        const dispatchResult = await api.orchestration.dispatchCommand({
          type: "thread.turn.start",
          commandId: newCommandId(),
          threadId: threadIdForSend,
          message: {
            messageId: messageIdForSend,
            role: "user",
            text: compiledTurn.outgoingMessageText,
            ...(compiledTurn.outgoingRichText !== undefined
              ? { richText: compiledTurn.outgoingRichText }
              : {}),
            attachments: turnAttachments,
          },
          modelSelection: activeThread.modelSelection,
          titleSeed: title,
          runtimeMode: DEFAULT_RUNTIME_MODE,
          interactionMode: interactionModeForSend,
          parentEntryId: branchView.entryId,
          bootstrap: {
            ...(isLocalDraftThread
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
          },
          createdAt: messageCreatedAt,
        });
        turnStartSucceeded = true;

        if (baseBranchForWorktree) {
          if (!dispatchResult.preparedWorktree) {
            throw new Error("New worktree was created, but no prepared worktree was returned.");
          }
          runtimeCwd = dispatchResult.preparedWorktree.worktreePath;
          threadBranch = dispatchResult.preparedWorktree.branch;
          threadWorktreePath = dispatchResult.preparedWorktree.worktreePath;
        }
      } else if (isLocalDraftThread) {
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
      }

      beginLocalDispatch({ preparingWorktree: false });
      if (isLocalDraftThread && draftId) {
        const promotedThreadRef = scopeThreadRef(environmentId, threadIdForSend);
        markDraftThreadPromoting(draftId, promotedThreadRef);
        promotedDraftOptimistically = true;
        await openThread(navigate, promotedThreadRef, { replace: true });
        navigatedOptimistically = true;
      }
      await sendRuntimeTurn({
        threadId: threadIdForSend,
        cwd: runtimeCwd,
        text: compiledTurn.outgoingMessageText,
        interactionMode: interactionModeForSend,
        sourceProposedPlan: null,
        clientMessageId: messageIdForSend,
        images: turnAttachments,
      });
      turnStartSucceeded = true;
    })().catch(async (err: unknown) => {
      if (promotedDraftOptimistically && draftId) {
        cancelDraftThreadPromotion(draftId);
      }
      if (navigatedOptimistically && draftId) {
        await openDraft(navigate, draftId, { replace: true });
      }
      if (
        !turnStartSucceeded &&
        promptRef.current.length === 0 &&
        composerImagesRef.current.length === 0
      ) {
        removePendingTimelineRowsByClientSendKey(messageIdForSend);
        promptRef.current = promptForSend;
        const retryComposerImages = composerImagesSnapshot.map(cloneComposerImageForRetry);
        composerImagesRef.current = retryComposerImages;
        setComposerDraftPrompt(composerDraftTarget, promptForSend);
        addComposerDraftImages(composerDraftTarget, retryComposerImages);
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
      phase !== "running" &&
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
      phase === "running" &&
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
    promptRef.current = item.sendContext.prompt;
    composerImagesRef.current = imagesForEdit;
    clearComposerDraftContent(composerDraftTarget);
    setComposerDraftPrompt(composerDraftTarget, item.sendContext.prompt);
    addComposerDraftImages(composerDraftTarget, imagesForEdit);
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
    if (phase === "running" || isConnecting || isSendBusy || sendInFlightRef.current) {
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
    if (!workspaceTarget.cwd) {
      setThreadError(threadIdForSend, "Pi runtime requires an active project before sending.");
      return;
    }
    const messageIdForSend = newMessageId();
    const messageCreatedAt = new Date().toISOString();
    const outgoingMessageText = trimmed;

    sendInFlightRef.current = true;
    beginLocalDispatch({ preparingWorktree: false });
    setThreadError(threadIdForSend, null);

    // Scroll to the current end *before* adding the optimistic message.
    isAtBottomRef.current = true;
    showScrollDebouncer.current.cancel();
    setShowScrollToBottom(false);
    await messagesTimelineControllerRef.current?.scrollToBottom({ animated: false });

    appendPendingTimelineRow(
      routeThreadKey,
      createPendingTimelineRow({
        messageId: messageIdForSend,
        text: outgoingMessageText,
        createdAt: messageCreatedAt,
        parentEntryId: branchView.entryId,
      }),
    );

    try {
      await persistThreadSettingsForNextTurn({
        threadId: threadIdForSend,
        createdAt: messageCreatedAt,
        interactionMode: nextInteractionMode,
      });

      // Keep the mode toggle and plan-follow-up banner in sync immediately
      // while the same-thread implementation turn is starting.
      setComposerDraftInteractionMode(
        scopeThreadRef(activeThread.environmentId, threadIdForSend),
        nextInteractionMode,
      );

      await sendRuntimeTurn({
        threadId: threadIdForSend,
        cwd: workspaceTarget.cwd,
        text: outgoingMessageText,
        interactionMode: nextInteractionMode,
        sourceProposedPlan:
          nextInteractionMode === "agent"
            ? {
                threadId: planFollowUp.planThreadId,
                planId: planFollowUp.planId,
              }
            : null,
        clientMessageId: messageIdForSend,
        images: [],
      });
      // Optimistically open the plan sidebar when implementing (not refining).
      // Agent mode here means the agent is executing the plan, which produces
      // step-tracking activities that the workbench Plan/Tasks tab will display.
      if (nextInteractionMode === "agent") {
        shellPanelsActions.activatePlanTab(workspaceTarget.workspaceKey);
      }
      sendInFlightRef.current = false;
    } catch (err) {
      removePendingTimelineRowsByClientSendKey(messageIdForSend);
      setThreadError(
        threadIdForSend,
        err instanceof Error ? err.message : "Failed to send plan follow-up.",
      );
      sendInFlightRef.current = false;
      resetLocalDispatch();
    }
  };
  const onExpandTimelineImage = (preview: ExpandedImagePreview) => {
    setExpandedImage(preview);
  };
  const renderEditComposer = (message: ChatMessage): ReactNode => {
    if (!activeThread) {
      return null;
    }
    return (
      <InlineMessageEditComposer
        key={message.id}
        message={message}
        composerDraftTarget={editComposerDraftTarget}
        environmentId={environmentId}
        draftId={draftId}
        activeThreadId={activeThread.id}
        phase={phase}
        isConnecting={isConnecting}
        isSendBusy={isSendBusy}
        isPreparingWorktree={isPreparingWorktree}
        interactionMode={interactionMode}
        activeThreadActivities={threadActivities}
        resolvedTheme={resolvedTheme}
        settings={settings}
        keybindings={keybindings}
        terminalOpen={Boolean(terminalState.terminalOpen)}
        gitCwd={gitCwd}
        onInterrupt={onInterrupt}
        setThreadError={setThreadError}
        onExpandImage={onExpandTimelineImage}
        onCancelEditUserMessage={onCancelEditUserMessage}
        onSubmitEditUserMessage={onSubmitEditUserMessage}
      />
    );
  };
  const localThreadHasStarted =
    pendingTimelineRows.length > 0 || isSendBusy || Boolean(draftThread?.promotedTo);
  const isHeroComposer = activeThread
    ? isLocalDraftThread && !threadHasStarted(activeThread) && !localThreadHasStarted
    : false;

  const activeTimelineCacheKey = activeThread
    ? `${activeThread.id}:${branchView.entryId ?? "linear"}`
    : "";
  const existingOpenTerminalThreadKeysKey = existingOpenTerminalThreadKeys.join("\0");
  const serverMessagesAcknowledgementKey = messagesAcknowledgementKey(activeThread?.messages);
  const storeServerTerminalLaunchContextKey = storeServerTerminalLaunchContext
    ? [
        storeServerTerminalLaunchContext.cwd,
        storeServerTerminalLaunchContext.worktreePath ?? "",
      ].join("\0")
    : "";
  const activeProjectScriptsKey = projectScriptsKey(workspaceProject?.scripts ?? null);
  const keybindingsKey = keybindingsConfigKey(keybindings);
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
      <RetainServerThreadDetailSync
        key={[environmentId, routeKind, threadId].join("\0")}
        environmentId={environmentId}
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
      <PendingTimelineRowsServerAckSync
        key={[pendingTimelineRows.length, routeThreadKey, serverMessagesAcknowledgementKey].join(
          "\0",
        )}
        handoffAttachmentPreviews={handoffAttachmentPreviews}
        pendingTimelineRows={pendingTimelineRows}
        removePendingTimelineRows={removePendingTimelineRows}
        serverMessages={activeThread?.messages}
        threadKey={routeThreadKey}
      />
      <ThreadMediaResetSync
        key={[draftId ?? "", threadId].join("\0")}
        clearAttachmentPreviewHandoffs={clearAttachmentPreviewHandoffs}
        setExpandedImage={setExpandedImage}
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
                  editUserMessagesDisabled={isWorking}
                  activeTurnStartedAt={activeWorkStartedAt}
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
                  onBeginEditUserMessage={onBeginEditUserMessage}
                  renderEditComposer={renderEditComposer}
                  onUpdateProposedPlan={onUpdateProposedPlan}
                  awaitingServerThreadDetail={isServerThread && !serverThreadDetailLoaded}
                  onIsAtBottomChange={onIsAtBottomChange}
                />

                {showScrollToBottom && (
                  <div className="pointer-events-none absolute bottom-[calc(44px_+_1.25rem)] left-1/2 z-30 flex -translate-x-1/2 justify-center py-1.5">
                    <button
                      type="button"
                      onClick={() => scrollTimelineToBottom(true)}
                      className="pointer-events-auto inline-flex size-7 min-h-7 min-w-7 shrink-0 cursor-(--multi-button-cursor) appearance-none items-center justify-center rounded-full border border-multi-stroke-tertiary bg-(--multi-composer-surface-background)! p-0 text-multi-icon-secondary shadow-none transition-[background-color,border-color] duration-150 ease-out hover:border-multi-stroke-secondary hover:bg-(--multi-composer-surface-background)! active:border-multi-stroke-secondary active:bg-(--multi-composer-surface-background)! focus-visible:border-multi-stroke-secondary focus-visible:bg-(--multi-composer-surface-background)!"
                      aria-label="Scroll to bottom"
                      title="Scroll to bottom"
                    >
                      <IconChevronRightMedium
                        className="size-3 rotate-90 text-multi-icon-secondary"
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                )}
              </div>
              {subagentTrayPresented ? (
                <button
                  type="button"
                  data-subagent-tray-click-capture=""
                  aria-label="Close subagent tray"
                  onClick={closeSubagentTray}
                />
              ) : null}
            </div>
          )}

          {/* Input bar, centered when hero and docked when a thread is active */}
          <div
            className={cn(
              "relative px-4 pb-4",
              isHeroComposer
                ? "flex h-full flex-1 flex-col items-center outline-none data-[layout=wide]:justify-center data-[layout=wide]:px-6 data-[layout=wide]:py-12 data-[layout=wide]:*:w-full data-[layout=wide]:*:max-w-agent-chat"
                : undefined,
              isConnecting
                ? "[&_[data-chat-input-footer=true]_*]:opacity-60 **:data-[testid=composer-editor]:cursor-default **:data-[testid=composer-editor]:opacity-60"
                : undefined,
              !isHeroComposer
                ? "pointer-events-none absolute bottom-0 left-0 right-0 isolate z-30 before:pointer-events-none before:absolute before:bottom-[-12px] before:left-1/2 before:top-1/2 before:z-0 before:ml-[-50vw] before:w-screen before:bg-(--multi-shell-center-surface-background) after:pointer-events-none after:absolute after:bottom-1/2 after:left-1/2 after:z-0 after:ml-[-50vw] after:h-6 after:w-screen after:bg-[linear-gradient(to_top,var(--multi-shell-center-surface-background),transparent)] *:pointer-events-auto *:relative *:z-1"
                : undefined,
            )}
            data-layout={isHeroComposer ? "wide" : undefined}
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
              <div className="@container/header-actions pointer-events-auto mb-2 flex w-full max-w-agent-chat items-center gap-1 overflow-hidden px-1">
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
              activeThreadActivities={activeThread?.activities}
              resolvedTheme={resolvedTheme}
              settings={settings}
              keybindings={keybindings}
              terminalOpen={terminalState.terminalOpen}
              gitCwd={gitCwd}
              promptRef={promptRef}
              composerImagesRef={composerImagesRef}
              onSend={onSend}
              onInterrupt={onInterrupt}
              onBuildPlan={onBuildActiveProposedPlan}
              onViewPlan={() => shellPanelsActions.activatePlanTab(workspaceTarget.workspaceKey)}
              onRespondToApproval={onRespondToApproval}
              onSelectActivePendingUserInputOption={onSelectActivePendingUserInputOption}
              onAdvanceActivePendingUserInput={onAdvanceActivePendingUserInput}
              onPreviousActivePendingUserInputQuestion={onPreviousActivePendingUserInputQuestion}
              onChangeActivePendingUserInputCustomAnswer={
                onChangeActivePendingUserInputCustomAnswer
              }
              onBeginEditQueuedComposerItem={onBeginEditQueuedComposerItem}
              onCancelEditingQueuedComposerItem={onCancelEditingQueuedComposerItem}
              onRemoveQueuedComposerItem={onRemoveQueuedComposerItem}
              onSendQueuedComposerItemNow={onSendQueuedComposerItemNow}
              onReorderQueuedComposerItem={onReorderQueuedComposerItem}
              onQueuedComposerItemsExpandedChange={onQueuedComposerItemsExpandedChange}
              toggleInteractionMode={toggleInteractionMode}
              handleInteractionModeChange={handleInteractionModeChange}
              setThreadError={setThreadError}
              onExpandImage={onExpandTimelineImage}
            />
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
