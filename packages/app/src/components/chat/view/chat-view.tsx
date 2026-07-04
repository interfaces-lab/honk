import { type ApprovalRequestId, MessageId } from "@honk/shared/base-schemas";
import type {
  DesktopExtensionUiRequest,
  ThreadAgentRuntimeImageAttachment,
  ThreadAgentRuntimeQueuedFollowUp,
  AgentRuntimeModelDescriptor,
} from "@honk/shared/runtime";
import type {
  RuntimeApprovalDecision,
  OrchestrationThreadActivity,
  SourceProposedPlanReference,
} from "@honk/shared/orchestration";
import type { EnvironmentId, ScopedProjectRef, ScopedThreadRef } from "@honk/shared/environment";
import type { GitBranch } from "@honk/shared/git";
import type { ModelSelection } from "@honk/shared/model";
import type { ProjectScript } from "@honk/shared/project-scripts";
import type { ProjectId, ThreadId } from "@honk/shared/base-schemas";
import type { KeybindingCommand, ResolvedKeybindingsConfig } from "@honk/shared/keybindings";
import type { AgentInteractionMode } from "@honk/shared/interaction-mode";
import type { AgentPreferences } from "@honk/shared/agent-model-policy";
import { DEFAULT_PROJECTLESS_CWD } from "@honk/shared/project";
import { scopedThreadKey, scopeProjectRef, scopeThreadRef } from "~/lib/environment-scope";
import { projectScriptRuntimeEnv } from "@honk/shared/project-scripts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@honk/honkkit/alert";
import { Button } from "@honk/honkkit/button";
import { type ConversationScrollerController } from "@honk/honkkit/conversation-scroller";
import { Spinner } from "@honk/honkkit/spinner";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { useShallow } from "zustand/react/shallow";
import {
  deriveLatestContextWindowSnapshot,
  formatContextUsagePercentage,
  formatContextWindowTokens,
  type ContextWindowSnapshot,
} from "~/lib/context-window";
import { getGitStatusSnapshot, useGitStatus } from "~/lib/git-status-state";
import { readEnvironmentApi } from "../../../environment-api";
import { usePrimaryEnvironmentId } from "../../../environments/primary";
import {
  compactRuntimeThread,
  type PreparedRuntimeTurnPolicy,
  prepareRuntimeTurnPolicy,
  sendRuntimeTurnWithPreparedPolicy,
} from "~/lib/runtime-turn-dispatch";
import {
  AGENT_THINKING_LEVEL_LABELS,
  agentModeSupportsThinkingLevelSelection,
  deriveAgentModeAvailability,
  unavailableModelSelectionReason,
} from "~/lib/agent-mode-options";
import { coreAuthSnapshotQueryOptions } from "~/lib/core-auth-react-query";
import { coordinateTurnSend, dispatchTurnStartFailure } from "~/lib/turn-send-coordinator";
import { isElectron } from "../../../env";
import {
  cursorComposerFastEnabled,
  cursorComposerModelSelection,
} from "@honk/shared/cursor-composer";
import { resolveAgentModeForModelSelection } from "@honk/shared/agent-model-policy";
import { readLocalApi } from "../../../local-api";
import {
  isComposerModeSlashCommand,
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
  selectProjectsAcrossEnvironments,
  selectThreadExistsByRef,
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
  selectRuntimeEventsForThread,
  selectRuntimeThreadActivity,
  useAgentRuntimeStore,
} from "../../../stores/agent-runtime-store";
import { useLocalFeatureFlagsStore } from "~/stores/local-feature-flags";
import {
  normalizePlanMarkdownForExport,
  resolvePlanFollowUpSubmission,
} from "~/plan/proposed-plan";
import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type ChatMessage,
  type ProposedPlan,
  type Project,
  type SessionPhase,
  type ThreadSendIntent,
  type Thread,
} from "../../../types";
import { useTheme } from "../../../hooks/use-theme";
import { buildTemporaryWorktreeBranchName } from "@honk/shared/git";
import { cn } from "~/lib/utils";
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
import { readHonkRuntimeApi } from "../../../lib/honk-runtime-api";
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
import {
  readTerminalSessions,
  useActiveTab,
  useIsMuted,
  useRightOpen,
} from "~/stores/shell-panels-store";
import { workbenchTabPersistenceActions } from "~/stores/workbench-tab-store";
import {
  readWorkbenchTerminalApi,
  workbenchTerminalThreadId,
} from "~/components/shell/terminal/workbench-terminal";
import {
  proposedPlanLifecycleKey,
  useProposedPlanLifecycleStore,
} from "~/stores/proposed-plan-lifecycle-store";
import {
  ComposerInput,
  type ComposerInputHandle,
  type ComposerInteractionModeFocusMode,
} from "../composer/input";
import { useSubagentTrayStore } from "../../../stores/subagent-tray-store";
import { ExpandedImageDialog } from "../message/expanded-image-dialog";
import { PullRequestThreadDialog } from "../../pull-request-thread-dialog";
import { MessagesTimeline } from "../timeline/messages-timeline";
import { ChatHeader, type ChatHeaderTooltipDetails } from "./chat-header";
import {
  InlineMessageEditComposer,
  type InlineEditSubmitInput,
} from "./inline-message-edit-composer";
import { type ExpandedImagePreview } from "../message/expanded-image-preview";
import { gitCheckoutMutationOptions } from "../../../lib/git-react-query";
import { ThreadErrorBanner } from "../message/error-banner";
import { cloneComposerImageForRetry, resolveSendEnvMode } from "../composer/send";
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
  type PullRequestDialogState,
  shouldWriteThreadErrorToCurrentServerThread,
  threadExistsBeforeSend,
} from "./thread-lifecycle";
import { useLocalStorage } from "~/hooks/use-local-storage";
import { useMountEffect } from "~/hooks/use-mount-effect";
import { useComposerHandleContext } from "../composer/context/handle-context";
import { useServerConfig, useServerKeybindings } from "~/rpc/server-state";
import {
  formatSchemaBackedTransportErrorDescription,
  sanitizeThreadErrorMessage,
} from "~/rpc/transport-error";
import { IconExclamationCircle } from "central-icons";
import { useAttachmentPreviewHandoff } from "./attachment-preview-handoff";
import { WorkspaceToolbar, type WorkspaceToolbarProject } from "./workspace-toolbar";
import {
  applyLocalThreadCreated,
  applyLocalThreadTurnStartRequested,
} from "~/stores/local-orchestration-events";
import {
  deriveChatViewLiveness,
  type ComposerSendSnapshot,
  reportMissingActiveThread,
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
  RetainServerThreadDetailSync,
  RuntimeThreadHydrationSync,
  ThreadMediaResetSync,
  ThreadSendIntentsServerAckSync,
} from "./chat-view-lifecycle-sync";
import {
  filterThreadSendIntentsToBranch,
  runtimeDisplayTimelineHasActiveWork,
  runtimeDisplayTimelineRenderableUserMessageIds,
  threadSendIntentMessages,
} from "./thread-timeline-projector";
import { useThreadTimeline } from "./use-thread-timeline";
import {
  threadErrorShownOnUserMessage,
  useTurnFailuresByUserMessageId,
} from "~/lib/turn-failure-index";
import {
  createThreadSendIntent,
  EMPTY_THREAD_SEND_INTENTS,
  useThreadSendIntentStore,
} from "~/stores/thread-send-intent-store";

const EMPTY_ACTIVITIES: OrchestrationThreadActivity[] = [];
const EMPTY_PENDING_APPROVALS: PendingApproval[] = [];
const EMPTY_THREAD_MESSAGES: ChatMessage[] = [];
const EMPTY_TIMELINE_PROPOSED_PLANS: Thread["proposedPlans"] = [];
const DOCKED_COMPOSER_TIMELINE_RESERVE_PX = 96;

function MissingActiveThreadFallback(props: {
  readonly diagnostics: Parameters<typeof reportMissingActiveThread>[1];
}) {
  useMountEffect(() => {
    reportMissingActiveThread(undefined, props.diagnostics);
  });

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden"
      aria-busy="true"
    >
      <Spinner className="size-5 text-muted-foreground" />
    </div>
  );
}

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
        text: " to have Honk find bugs, regressions, security issues, and missing tests",
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
        { kind: "token", text: "/plan" },
        { kind: "text", text: " to plan first without editing files" },
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

function compactPathForTopnav(path: string | null | undefined): string | null {
  const trimmed = path?.trim() ?? "";
  if (!trimmed) return null;

  const unixHome = trimmed.match(/^\/(?:Users|home)\/[^/]+(?=\/|$)/);
  if (unixHome) {
    const suffix = trimmed.slice(unixHome[0].length);
    return suffix ? `~${suffix}` : "~";
  }

  const windowsHome = trimmed.match(/^[A-Za-z]:\\Users\\[^\\]+(?=\\|$)/);
  if (windowsHome) {
    const suffix = trimmed.slice(windowsHome[0].length);
    return suffix ? `~${suffix}` : "~";
  }

  return trimmed;
}

function topnavProjectLabel(project: Project | null | undefined): string | null {
  if (!project) return null;
  const identity = project.repositoryIdentity ?? null;
  const owner = identity?.owner?.trim() ?? "";
  const name = identity?.name?.trim() ?? "";
  const label =
    identity?.displayName?.trim() ||
    (owner && name ? `${owner}/${name}` : "") ||
    name ||
    project.name.trim();
  return label || null;
}

function topnavContextLabel(snapshot: ContextWindowSnapshot | null): string | null {
  if (!snapshot) return null;
  const percentage = formatContextUsagePercentage(snapshot.usedPercentage);
  if (percentage) return `${percentage} context`;
  return `${formatContextWindowTokens(snapshot.usedTokens)} context`;
}

function topnavModelNameFromId(modelId: string): string {
  const rawSegment = modelId.split("/").at(-1)?.trim() ?? modelId.trim();
  const normalized = rawSegment.replace(/_/g, "-");
  if (!normalized) return "Model";
  if (/^gpt[-\s]/i.test(normalized)) {
    return normalized.replace(/^gpt/i, "GPT");
  }
  if (/^claude[-\s]/i.test(normalized)) {
    return normalized.replace(/^claude/i, "Claude").replace(/-/g, " ");
  }
  return normalized;
}

function matchingRuntimeModel(
  models: readonly AgentRuntimeModelDescriptor[],
  modelId: string,
): AgentRuntimeModelDescriptor | null {
  const segment = modelId.split("/").at(-1) ?? modelId;
  return (
    models.find(
      (model) => model.modelId === modelId || model.id === modelId || model.id === segment,
    ) ?? null
  );
}

function topnavModelLabel(input: {
  readonly fallbackSelection: ModelSelection;
  readonly models: readonly AgentRuntimeModelDescriptor[];
  readonly preferences: AgentPreferences;
}): string {
  const policySelection = input.preferences.modelSelection;
  const policyModelId = policySelection.type === "explicit" ? policySelection.modelId : null;
  const modelId = policyModelId ?? input.fallbackSelection.model;
  const runtimeModel = matchingRuntimeModel(input.models, modelId);
  const modelName = runtimeModel?.name.trim() || topnavModelNameFromId(modelId);
  const thinkingLabel =
    agentModeSupportsThinkingLevelSelection(input.preferences.agentMode) &&
    input.preferences.thinkingLevel !== "off"
      ? AGENT_THINKING_LEVEL_LABELS[input.preferences.thinkingLevel]
      : null;
  return thinkingLabel ? `${modelName} ${thinkingLabel}` : modelName;
}

interface ChatViewSharedProps {
  readonly autoFocusComposer?: boolean;
  readonly contentPaneTopBarActions?: ReactNode;
  readonly contentPaneTopBarTitle?: string;
  readonly hideContentPaneTopBar?: boolean;
  readonly isActiveSurface?: boolean;
  readonly isTiledSurface?: boolean;
  readonly reserveTitleBarControlInset?: boolean;
}

export type ChatViewProps =
  | (ChatViewSharedProps & {
      environmentId: EnvironmentId;
      threadId: ThreadId;
      routeKind: "server";
      draftId?: never;
    })
  | (ChatViewSharedProps & {
      environmentId: EnvironmentId;
      threadId: ThreadId;
      routeKind: "draft";
      draftId: ComposerDraftId;
    });

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
  const clearingLocalDispatchRef = useRef(false);

  useEffect(() => {
    if (!serverAcknowledgedLocalDispatch || localDispatch === null) {
      clearingLocalDispatchRef.current = false;
      return;
    }
    if (clearingLocalDispatchRef.current) {
      return;
    }
    clearingLocalDispatchRef.current = true;
    clearStoredLocalDispatch(input.threadKey);
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
  const isActiveSurface = props.isActiveSurface ?? true;
  const isTiledSurface = props.isTiledSurface ?? false;
  const isInactiveTiledSurface = isTiledSurface && !isActiveSurface;
  const autoFocusComposer = props.autoFocusComposer ?? true;
  const draftId = routeKind === "draft" ? props.draftId : null;
  const routeThreadRef = scopeThreadRef(environmentId, threadId);
  const routeThreadKey = scopedThreadKey(routeThreadRef);
  const editComposerDraftTarget = DraftId.make(`inline-message-edit:${routeThreadKey}`);
  const composerDraftTarget: ScopedThreadRef | ComposerDraftId =
    routeKind === "draft" ? props.draftId : routeThreadRef;
  const serverThreadSelector = createThreadSelectorByRef(
    routeKind === "server" ? routeThreadRef : null,
  );
  const serverThread = useStore(serverThreadSelector);
  const serverThreadExists = useStore((store) =>
    routeKind === "server" ? selectThreadExistsByRef(store, routeThreadRef) : false,
  );
  const setStoreThreadError = useStore((store) => store.setError);
  const markThreadVisited = useUiStateStore((store) => store.markThreadVisited);
  const activeThreadLastVisitedAt = useUiStateStore((store) =>
    routeKind === "server" ? store.threadLastVisitedAtById[routeThreadKey] : undefined,
  );
  const settings = useSettings();
  const multitaskModeEnabled = useLocalFeatureFlagsStore((state) => state.multitaskModeEnabled);
  const workspaceProjects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const {
    projectCwd: selectedProjectCwd,
    projectEnvironmentId: selectedProjectEnvironmentId,
    projectRef: selectedProjectRef,
  } = useSelectedWorkspaceProject();
  const { handleNewThread: handleWorkspaceNewThread } = useNewThreadHandler();
  const selectedWorkspaceProjectSelector = createProjectSelectorByRef(selectedProjectRef);
  const selectedWorkspaceProject = useStore(selectedWorkspaceProjectSelector);
  const router = useRouter();
  const queryClient = useQueryClient();
  const coreAuthQuery = useQuery(coreAuthSnapshotQueryOptions());
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
  const ambientComposerRef = useComposerHandleContext();
  const composerRef = isTiledSurface ? localComposerRef : (ambientComposerRef ?? localComposerRef);
  useEffect(() => {
    if (isInactiveTiledSurface) {
      composerRef.current?.blur();
    }
  }, [composerRef, isInactiveTiledSurface]);
  const [editingUserMessageId, setEditingUserMessageId] = useState<MessageId | null>(null);
  const [isTimelineAtEnd, setIsTimelineAtEnd] = useState(true);
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
  const runtimePreferences = useAgentRuntimeStore((state) => state.snapshot.preferences);
  const runtimeModels = useAgentRuntimeStore((state) => state.snapshot.models);
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
  const [pullRequestDialogState, setPullRequestDialogState] =
    useState<PullRequestDialogState | null>(null);
  const [compactingThreadId, setCompactingThreadId] = useState<ThreadId | null>(null);
  const [lastInvokedScriptByProjectId, setLastInvokedScriptByProjectId] = useLocalStorage(
    LAST_INVOKED_SCRIPT_BY_PROJECT_KEY,
    {},
    LastInvokedScriptByProjectSchema,
  );
  const conversationScrollerControllerRef = useRef<ConversationScrollerController | null>(null);
  const isAtEndRef = useRef(true);
  const sendInFlightRef = useRef(false);

  const fallbackDraftProject = draftThread
    ? findWorkspaceProjectForSource(workspaceProjects, draftThread)
    : null;
  const fallbackDraftModelSelection =
    runtimePreferences.agentMode === "composer"
      ? cursorComposerModelSelection(cursorComposerFastEnabled(runtimePreferences.modelSelection))
      : (settings.textGenerationModelSelection ?? fallbackDraftProject?.defaultModelSelection);
  const localDraftError =
    routeKind === "server" && serverThread
      ? null
      : ((draftId ? localDraftErrorsByDraftId[draftId] : null) ?? null);
  const localDraftThread = draftThread
    ? buildLocalDraftThread(threadId, draftThread, fallbackDraftModelSelection, localDraftError)
    : undefined;
  const composerUsesLocalDraftThread = routeKind === "draft";
  const isServerThread =
    routeKind === "server" && serverThread !== undefined && !composerUsesLocalDraftThread;
  const activeThread = isServerThread ? serverThread : localDraftThread;
  const rawInteractionMode =
    composerInteractionMode ?? activeThread?.interactionMode ?? DEFAULT_INTERACTION_MODE;
  const interactionMode =
    rawInteractionMode === "multitask" && !multitaskModeEnabled
      ? DEFAULT_INTERACTION_MODE
      : rawInteractionMode;
  const isLocalDraftThread = !isServerThread && localDraftThread !== undefined;
  const activeThreadId = activeThread?.id ?? null;
  // Scoped to this view's thread so tray activity elsewhere never re-renders it.
  const subagentTrayPresented = useSubagentTrayStore(
    (state) => state.presented && state.focus?.activeThreadId === activeThreadId,
  );
  const isNewThreadHero = isNewThreadHeroDraft({
    activeThread,
    isLocalDraftThread,
    pendingLocalSendCount: threadSendIntents.length,
    promotedTo: draftThread?.promotedTo,
  });
  const runtimeThreadId = isNewThreadHero ? null : activeThreadId;
  const activeRuntimeEvents = useAgentRuntimeStore((state) =>
    selectRuntimeEventsForThread(state, runtimeThreadId),
  );
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
  const activeRuntimeActivity = useAgentRuntimeStore(
    useShallow((state) => selectRuntimeThreadActivity(state, runtimeThreadId)),
  );
  const activeThreadRef = activeThread
    ? scopeThreadRef(activeThread.environmentId, activeThread.id)
    : null;
  const activeThreadKey = activeThreadRef ? scopedThreadKey(activeThreadRef) : null;
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

    const threadId = newThreadId();
    const nextDraftId = DraftId.make(
      // Prefix is for routing; thread-id suffix keeps drafts distinct.
      `new-thread-draft:project:${activeProjectRef.environmentId}:${activeProjectRef.projectId}:${threadId}`,
    );
    setLogicalProjectDraftThreadId(logicalProjectKey, activeProjectRef, nextDraftId, {
      threadId,
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

  const phase = derivePhase(activeThread?.session ?? null);
  const threadActivities = activeThread?.activities ?? EMPTY_ACTIVITIES;
  const sharedThreadActivities = useSharedChatActivities(threadActivities);
  const activeContextWindow = useStableLatestContextWindowSnapshot(sharedThreadActivities);
  const leafId = activeThread?.leafId ?? null;
  const branchViewEntryId = containsThreadEntry(activeThread ?? null, leafId) ? leafId : null;
  const branchView = deriveThreadBranchView(activeThread ?? null, branchViewEntryId);
  const visibleThreadActivities = filterActivitiesToBranch(sharedThreadActivities, branchView);
  const activeSession = activeThread?.session ?? null;
  const activeRunningTurnId =
    activeSession !== null &&
    (activeSession.orchestrationStatus === "starting" ||
      activeSession.orchestrationStatus === "running") &&
    activeLatestTurn !== null &&
    activeLatestTurn.state === "running" &&
    activeLatestTurn.completedAt === null &&
    (activeSession.activeTurnId == null || activeSession.activeTurnId === activeLatestTurn.turnId)
      ? activeLatestTurn.turnId
      : null;
  const derivedWorkLogEntries = deriveWorkLogEntries(visibleThreadActivities, undefined, {
    activeRunningTurnId,
  });
  const workLogEntries = useStableCompletedWorkLogEntries(derivedWorkLogEntries);
  const pendingApprovals = latestTurnSettled
    ? EMPTY_PENDING_APPROVALS
    : derivePendingApprovals(sharedThreadActivities, activeLatestTurn?.turnId ?? null);
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
  const dismissedPendingPlanKeys = useProposedPlanLifecycleStore(
    (state) => state.dismissedPlanKeys,
  );
  const buildingPendingPlanKeys = useProposedPlanLifecycleStore((state) => state.buildingPlanKeys);
  const dismissLifecyclePlan = useProposedPlanLifecycleStore((state) => state.dismissPlan);
  const markLifecyclePlanBuilding = useProposedPlanLifecycleStore(
    (state) => state.markPlanBuilding,
  );
  const clearLifecyclePlanBuilding = useProposedPlanLifecycleStore(
    (state) => state.clearPlanBuilding,
  );
  const activePendingPlanKey =
    activeProposedPlanSourceThreadId && activeProposedPlan
      ? proposedPlanLifecycleKey(activeProposedPlanSourceThreadId, activeProposedPlan.id)
      : null;
  const activePendingPlanDismissed =
    activePendingPlanKey !== null && dismissedPendingPlanKeys.includes(activePendingPlanKey);
  const activePendingPlanBuilding =
    activePendingPlanKey !== null &&
    (buildingPendingPlanKeys.includes(activePendingPlanKey) ||
      (!latestTurnSettled &&
        activeLatestTurn?.sourceProposedPlan?.threadId === activeProposedPlanSourceThreadId &&
        activeLatestTurn.sourceProposedPlan.planId === activeProposedPlan?.id));
  const activePendingPlanHidden = activePendingPlanDismissed || activePendingPlanBuilding;
  const activePendingPlan = activePendingPlanHidden ? null : activeProposedPlan;
  const activePendingPlanSourceThreadId = activePendingPlanHidden
    ? null
    : activeProposedPlanSourceThreadId;
  const showPlanFollowUpPrompt =
    pendingUserInputs.length === 0 &&
    latestTurnSettled &&
    hasActionableProposedPlan(activePendingPlan);
  useEffect(() => {
    const sourceProposedPlan = activeLatestTurn?.sourceProposedPlan;
    if (!latestTurnSettled || !sourceProposedPlan) {
      return;
    }
    clearLifecyclePlanBuilding(sourceProposedPlan.threadId, sourceProposedPlan.planId);
  }, [activeLatestTurn?.sourceProposedPlan, clearLifecyclePlanBuilding, latestTurnSettled]);
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
  const runtimeTimelineHasActiveWork = runtimeDisplayTimelineHasActiveWork(
    activeRuntimeDisplayTimeline,
  );
  const visibleThreadSendIntents = filterThreadSendIntentsToBranch(threadSendIntents, branchView);
  const activeRuntimeAgentRunActive = activeRuntimeActivity.lifecycle === "active";
  const isCompactingActive = activeThreadId !== null && compactingThreadId === activeThreadId;
  const {
    isTurnRunning,
    isTimelineSurfaceActive,
    isWorking,
    timelineTurnActive,
    goalStatusProgressActive,
  } = deriveChatViewLiveness({
    runtimeOwned: activeThreadIsRuntimeOwned,
    latestTurnSettled,
    activeRunningTurnId,
    runtimeAgentRunActive: activeRuntimeAgentRunActive,
    runtimeTimelineHasActiveWork,
    runtimePresentationActive: activeRuntimeActivity.presentationActive,
    visibleSendIntentCount: visibleThreadSendIntents.length,
    isCompactingActive,
    isSendBusy,
    isConnecting,
  });
  const {
    queuedComposerItems,
    editingQueuedComposerItemId,
    queuedComposerItemsExpanded,
    setQueueExpanded,
    beginEditingQueuedComposerItem,
    cancelEditingQueuedComposerItem,
  } = useThreadComposerQueue(routeThreadKey, activeThread?.id ?? null);
  const activeWorkStartedAt = deriveActiveWorkStartedAt(
    activeLatestTurn,
    activeThread?.session ?? null,
    localDispatchStartedAt,
  );
  const threadMessages = activeThread?.messages ?? EMPTY_THREAD_MESSAGES;
  const serverMessages = filterMessagesToBranch(threadMessages, branchView);
  const runtimeRenderableUserMessageIds = runtimeDisplayTimelineRenderableUserMessageIds(
    activeRuntimeDisplayTimeline,
  );
  const {
    attachmentPreviewHandoffSync,
    applyAttachmentPreviewHandoff,
    clearAttachmentPreviewHandoffs,
    handoffAttachmentPreviews,
  } = useAttachmentPreviewHandoff({ serverMessages });
  const activeTimelineTailLeaseTurnKey =
    activeRuntimeActivity.lifecycle === "active"
      ? (activeRuntimeActivity.latestTurnId ?? "runtime-run-pending")
      : (activeRunningTurnId ??
        activeRuntimeActivity.latestTurnId ??
        activeLatestTurn?.turnId ??
        "");
  const activeTimelineTailLeaseKey = [activeThread?.id ?? "", activeTimelineTailLeaseTurnKey].join(
    "\0",
  );
  const committedTimelineMessages = applyAttachmentPreviewHandoff(serverMessages);
  const activeGoalStatus = goalStatusProgressActive
    ? deriveActiveGoalStatus({
        messages: committedTimelineMessages,
        sendIntents: visibleThreadSendIntents,
      })
    : null;
  const proposedPlansForTimeline = activeThread?.proposedPlans ?? EMPTY_TIMELINE_PROPOSED_PLANS;
  const turnFailuresByUserMessageId = useTurnFailuresByUserMessageId({
    messages: committedTimelineMessages,
    activities: visibleThreadActivities,
    runtimeEvents: activeRuntimeEvents,
    latestTurn: activeLatestTurn,
    threadError: activeThread?.error ?? null,
  });
  const suppressThreadErrorBanner = threadErrorShownOnUserMessage({
    threadError: activeThread?.error ?? null,
    turnFailuresByUserMessageId,
    latestTurn: activeLatestTurn,
    messages: committedTimelineMessages,
  });
  const timelineEntries = useThreadTimeline(
    {
      committedMessages: committedTimelineMessages,
      proposedPlans: proposedPlansForTimeline,
      workLogEntries,
      sendIntents: visibleThreadSendIntents,
      runtimeAcknowledgedMessageIds: runtimeRenderableUserMessageIds,
      activeRuntimeDisplayTimeline,
      turnFailuresByUserMessageId,
      isWorking,
      isTurnActive: timelineTurnActive,
      activeTurnStartedAt: activeWorkStartedAt,
    },
    activeTimelineTailLeaseKey,
  );
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
    committedTimelineMessages.some(
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
  const handleBeginEditUserMessage = useStableEvent(onBeginEditUserMessage);

  const onCancelEditUserMessage = (messageId: MessageId) => {
    setEditingUserMessageId((current) => (current === messageId ? null : current));
    clearComposerDraftContent(editComposerDraftTarget);
  };

  const keybindings = useServerKeybindings();
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
      (configuredBaseDirectory.length > 0 ? configuredBaseDirectory : DEFAULT_PROJECTLESS_CWD);

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
  const focusComposer = (mode: ComposerInteractionModeFocusMode = "end") => {
    if (mode === "preserve") {
      composerRef.current?.focus();
      return;
    }
    composerRef.current?.focusAtEnd();
  };
  const scheduleComposerFocus = (mode?: ComposerInteractionModeFocusMode) => {
    window.requestAnimationFrame(() => {
      focusComposer(mode);
    });
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
      workbenchTabPersistenceActions.createTerminal(terminalWorkspaceKey, {
        id: terminalId,
        label:
          readTerminalSessions(terminalWorkspaceKey).sessions.find(
            (session) => session.id === terminalId,
          )?.label ?? "Terminal",
      });
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

  const handleInteractionModeChange = (
    mode: AgentInteractionMode,
    focusMode: ComposerInteractionModeFocusMode = "end",
  ) => {
    if (mode === interactionMode) return;
    setComposerDraftInteractionMode(composerDraftTarget, mode);
    scheduleComposerFocus(focusMode);
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

  const onIsAtEndChange = (isAtEnd: boolean) => {
    if (isAtEndRef.current === isAtEnd) return;
    isAtEndRef.current = isAtEnd;
    setIsTimelineAtEnd(isAtEnd);
  };

  const forceTimelineAtEnd = () => {
    isAtEndRef.current = true;
    setIsTimelineAtEnd(true);
    conversationScrollerControllerRef.current?.scrollToEnd({ animated: false });
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
      <div className="flex min-w-0 items-center gap-2 overflow-hidden **:data-[slot=workbench-chrome-action-group]:gap-2">
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
  const contentPaneTopBarActions = props.contentPaneTopBarActions ? (
    workspaceTopnavActions ? (
      <div className="flex min-w-0 items-center gap-2 overflow-hidden **:data-[slot=workbench-chrome-action-group]:gap-2">
        {workspaceTopnavActions}
        {props.contentPaneTopBarActions}
      </div>
    ) : (
      props.contentPaneTopBarActions
    )
  ) : (
    workspaceTopnavActions
  );
  const contentPaneTopBarTitle =
    props.contentPaneTopBarTitle?.trim() ||
    activeThread?.title.trim() ||
    (routeKind === "draft" ? "New Agent" : "Agent");
  const contentPaneTopBarTooltipDetails: ChatHeaderTooltipDetails = {
    branchName: composerBranchName,
    contextLabel: topnavContextLabel(activeContextWindow),
    modelLabel: topnavModelLabel({
      fallbackSelection: threadCreateModelSelection,
      models: runtimeModels,
      preferences: runtimePreferences,
    }),
    projectLabel: topnavProjectLabel(workspaceProject),
    surfaceLabel: isElectron ? "Desktop" : "Web",
    workspacePath: compactPathForTopnav(activeThreadWorktreePath ?? workspaceToolbarCwd),
  };
  const newAgentFooterTip = getNewAgentFooterTip({
    interactionMode,
    stableKey: draftId ?? routeThreadKey,
    workspaceName: workspaceProject?.name ?? null,
  });
  const heroComposerActions =
    isHeroComposer && interactionMode === "agent" ? (
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

  const requireAvailableModelSelectionForSend = (
    targetThreadId: ThreadId,
    modelSelection: ModelSelection,
  ): boolean => {
    const reason = unavailableModelSelectionReason(
      modelSelection,
      deriveAgentModeAvailability(coreAuthQuery.data),
    );
    if (reason === null) {
      return true;
    }
    setThreadError(targetThreadId, `Selected model is unavailable. ${reason}`);
    return false;
  };

  const prepareRuntimePolicyForSend = (
    targetThreadId: ThreadId,
    nextInteractionMode: AgentInteractionMode,
    modelSelection: ModelSelection,
  ): PreparedRuntimeTurnPolicy | null => {
    try {
      return prepareRuntimeTurnPolicy({
        interactionMode: nextInteractionMode,
        modelSelection,
      });
    } catch (err) {
      setThreadError(
        targetThreadId,
        err instanceof Error ? err.message : "Runtime host unavailable.",
      );
      return null;
    }
  };

  const codexGoalSupportedForCurrentPreferences = (): boolean => {
    if (!activeThread) {
      return false;
    }
    const preferredAgentMode = useAgentRuntimeStore.getState().snapshot.preferences.agentMode;
    const isFirstMessageForThread = !isServerThread || activeThread.messages.length === 0;
    const agentMode =
      isFirstMessageForThread && isLocalDraftThread
        ? preferredAgentMode
        : resolveAgentModeForModelSelection(activeThread.modelSelection, preferredAgentMode);
    return agentMode === "deep" || agentMode === "rush";
  };

  const onCompactContext = async (customInstructions?: string) => {
    if (!activeThread) {
      return;
    }
    const threadIdForCompact = activeThread.id;
    if (isConnecting || isSendBusy || sendInFlightRef.current || isCompactingActive) {
      return;
    }
    if (isTurnRunning) {
      setThreadError(threadIdForCompact, "Wait for the current turn to finish before compacting.");
      return;
    }
    const runtimeCwd = workspaceTarget.cwd;
    if (!runtimeCwd) {
      setThreadError(
        threadIdForCompact,
        "Pi runtime requires an active project before compacting.",
      );
      return;
    }
    if (!requireAvailableModelSelectionForSend(threadIdForCompact, activeThread.modelSelection)) {
      return;
    }

    setCompactingThreadId(threadIdForCompact);
    markLocalRuntimeThread(threadIdForCompact);
    setThreadError(threadIdForCompact, null);
    try {
      await compactRuntimeThread({
        threadId: threadIdForCompact,
        cwd: runtimeCwd,
        interactionMode,
        modelSelection: activeThread.modelSelection,
        ...(customInstructions && customInstructions.length > 0 ? { customInstructions } : {}),
      });
    } catch (error) {
      setThreadError(
        threadIdForCompact,
        error instanceof Error ? error.message : "Failed to compact context.",
      );
    } finally {
      setCompactingThreadId((current) => (current === threadIdForCompact ? null : current));
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
    if (!hasSendableContent || !originalMessage) {
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
    if (!requireAvailableModelSelectionForSend(threadIdForSend, activeThread.modelSelection)) {
      return false;
    }
    const preparedRuntimePolicy = prepareRuntimePolicyForSend(
      threadIdForSend,
      input.interactionMode,
      activeThread.modelSelection,
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
      setThreadError(threadIdForSend, null);
      beginLocalDispatch({ preparingWorktree: false });
      forceTimelineAtEnd();

      markLocalRuntimeThread(threadIdForSend);
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
        replacesClientMessageId: messageId,
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
      if (localTurnStartAnnounced && !serverTurnStartSucceeded) {
        clearUnconfirmedLocalTurnStart(environmentId, threadIdForSend, messageIdForSend);
        localTurnStartAnnounced = false;
      }
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
    if (isInactiveTiledSurface) {
      console.debug("[chat-view] send ignored from inactive tiled surface", {
        environmentId,
        routeKind,
        threadId,
        draftId,
      });
      return;
    }
    if (!activeThread || isSendBusy || isConnecting || sendInFlightRef.current) {
      console.debug("[chat-view] send ignored while blocked", {
        environmentId,
        routeKind,
        threadId,
        draftId,
        hasActiveThread: Boolean(activeThread),
        isSendBusy,
        isConnecting,
        sendInFlight: sendInFlightRef.current,
      });
      return;
    }
    const {
      sendContext: sendCtx,
      interactionMode: interactionModeForSend,
      planFollowUp,
      clearComposerOnSubmit,
    } = snapshot;
    let sendContextForDispatch = sendCtx;
    const { prompt: rawPromptForSend, images: composerImages } = sendCtx;
    const rawTrimmedPrompt = rawPromptForSend.trim();
    const rawStandaloneSlashCommand =
      composerImages.length === 0 ? parseStandaloneComposerSlashCommand(rawTrimmedPrompt) : null;
    if (rawStandaloneSlashCommand?.command === "compact") {
      if (clearComposerOnSubmit) {
        composerRef.current?.clearComposer();
      }
      await onCompactContext(rawStandaloneSlashCommand.body);
      return;
    }
    if (rawStandaloneSlashCommand?.command === "goal") {
      if (rawStandaloneSlashCommand.body.length === 0) {
        setThreadError(activeThread.id, "Add a goal after /goal before sending.");
        return;
      }
      if (!codexGoalSupportedForCurrentPreferences()) {
        setThreadError(activeThread.id, "/goal is available in Deep and Rush modes.");
        return;
      }
      sendContextForDispatch = {
        prompt: `Goal: ${rawStandaloneSlashCommand.body}`,
        images: composerImages,
        hasUnresolvedSlashCommand: false,
      };
    }
    const { prompt: promptForSend } = sendContextForDispatch;
    let composerClearedForSend = false;
    const compiledTurn = compileComposerSubmitTurn(sendContextForDispatch);
    const { trimmedPrompt: trimmed, hasSendableContent } = compiledTurn;
    if (planFollowUp) {
      const followUp = resolvePlanFollowUpSubmission({
        draftText: trimmed,
        planMarkdown: planFollowUp.planMarkdown,
      });
      if (followUp.interactionMode === DEFAULT_INTERACTION_MODE) {
        markLifecyclePlanBuilding(planFollowUp.planThreadId, planFollowUp.planId);
        setComposerDraftInteractionMode(composerDraftTarget, DEFAULT_INTERACTION_MODE);
      }
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
      if (!isComposerModeSlashCommand(standaloneSlashCommand.command)) {
        return;
      }
      if (standaloneSlashCommand.command === "multitask" && !multitaskModeEnabled) {
        setThreadError(activeThread.id, "Enable Multitask Mode from the dev command panel first.");
        return;
      }
      handleInteractionModeChange(standaloneSlashCommand.command);
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
    const initialRuntimeCwd = workspaceTarget.cwd;
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
    if (!initialRuntimeCwd) {
      setThreadError(threadIdForSend, "Pi runtime requires an active project before sending.");
      return;
    }
    if (!requireAvailableModelSelectionForSend(threadIdForSend, activeThread.modelSelection)) {
      return;
    }
    const preparedRuntimePolicy = prepareRuntimePolicyForSend(
      threadIdForSend,
      interactionModeForSend,
      activeThread.modelSelection,
    );
    if (!preparedRuntimePolicy) {
      return;
    }

    if (clearComposerOnSubmit) {
      composerRef.current?.clearComposer();
      composerClearedForSend = true;
    }

    sendInFlightRef.current = true;
    setThreadError(threadIdForSend, null);
    beginLocalDispatch({ preparingWorktree: Boolean(baseBranchForWorktree) });
    const composerImagesSnapshot = [...composerImages];
    const messageIdForSend = snapshot.messageId ?? newMessageId();
    const messageCreatedAt = snapshot.createdAt ?? new Date().toISOString();
    const parentEntryIdForSend = activeThread.leafId ?? null;
    console.debug("[chat-view] send start", {
      environmentId,
      routeKind,
      routeThreadId: threadId,
      activeThreadId: threadIdForSend,
      draftId,
      messageId: messageIdForSend,
      parentEntryId: parentEntryIdForSend,
      isTiledSurface,
    });
    const readTurnAttachments = (() => {
      const preparedAttachments = prepareComposerTurnAttachments(composerImagesSnapshot);
      return () => preparedAttachments;
    })();
    const optimisticAttachments = compiledTurn.optimisticAttachments;
    // Scroll to the current end before adding the optimistic message so the
    // virtualizer pins to the new item when the data changes.
    forceTimelineAtEnd();

    markLocalRuntimeThread(threadIdForSend);
    appendThreadSendIntent(
      routeThreadKey,
      createThreadSendIntent({
        messageId: messageIdForSend,
        text: compiledTurn.outgoingMessageText,
        richText: compiledTurn.outgoingRichText,
        attachments: optimisticAttachments,
        createdAt: messageCreatedAt,
        parentEntryId: parentEntryIdForSend,
      }),
    );
    console.debug("[chat-view] optimistic send intent appended", {
      routeThreadKey,
      messageId: messageIdForSend,
      activeThreadId: threadIdForSend,
    });

    let promotedDraftOptimistically = false;
    let promotedLocalSendThreadKey: string | null = null;
    let serverTurnStartSucceeded = false;
    let runtimeSendSucceeded = false;
    let localThreadAnnounced = false;
    let localTurnStartAnnounced = false;
    const removeOptimisticSendIntent = () => {
      if (promotedLocalSendThreadKey !== null) {
        const removedPromotedIntents = removeThreadSendIntents(
          promotedLocalSendThreadKey,
          new Set([messageIdForSend]),
        );
        revokeThreadSendIntentMessages(removedPromotedIntents);
        removeThreadSendIntents(routeThreadKey, new Set([messageIdForSend]));
        clearThreadLocalDispatch(promotedLocalSendThreadKey);
        return;
      }
      removeThreadSendIntentsByClientMessageId(messageIdForSend);
    };
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
          modelSelection: activeThread.modelSelection,
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
          parentEntryId: parentEntryIdForSend,
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
                  modelSelection: activeThread.modelSelection,
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
      console.debug("[chat-view] send result", {
        routeThreadKey,
        messageId: messageIdForSend,
        serverTurnStartSucceeded,
        runtimeSendSucceeded,
        promotedDraftOptimistically,
      });
      if (localTurnStartAnnounced && !serverTurnStartSucceeded) {
        clearUnconfirmedLocalTurnStart(environmentId, threadIdForSend, messageIdForSend);
        removeOptimisticSendIntent();
        localTurnStartAnnounced = false;
      }
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
      if (!serverTurnStartSucceeded) {
        removeOptimisticSendIntent();
      }
      if (
        !serverTurnStartSucceeded &&
        composerClearedForSend &&
        composerImagesRef.current.length === 0
      ) {
        const retryComposerImages = composerImagesSnapshot.map(cloneComposerImageForRetry);
        composerImagesRef.current = retryComposerImages;
        addComposerDraftImages(composerDraftTarget, retryComposerImages);
        composerRef.current?.restoreComposer({
          prompt: promptForSend,
          images: retryComposerImages,
          ...(sendContextForDispatch.richText !== undefined
            ? { richText: sendContextForDispatch.richText }
            : {}),
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

  type PreparedComposerFollowUpTurn = {
    compiledTurn: ReturnType<typeof compileComposerSubmitTurn>;
    messageText: string;
    interactionMode: AgentInteractionMode;
    sourceProposedPlan: SourceProposedPlanReference | null;
  };

  const prepareComposerFollowUpTurn = (input: {
    sendContext: ComposerSendSnapshot["sendContext"];
    interactionMode: AgentInteractionMode;
    planFollowUp: ComposerSendSnapshot["planFollowUp"];
    existingQueuedFollowUp?: ThreadAgentRuntimeQueuedFollowUp | null;
  }): PreparedComposerFollowUpTurn | null => {
    const compiledTurn = compileComposerSubmitTurn(input.sendContext);
    if (!compiledTurn.hasSendableContent && input.planFollowUp === null) {
      return null;
    }

    let messageText = compiledTurn.outgoingMessageText;
    let nextInteractionMode = input.interactionMode;
    let sourceProposedPlan: SourceProposedPlanReference | null =
      input.existingQueuedFollowUp?.sourceProposedPlan ?? null;
    if (input.planFollowUp) {
      const followUp = resolvePlanFollowUpSubmission({
        draftText: compiledTurn.trimmedPrompt,
        planMarkdown: input.planFollowUp.planMarkdown,
      });
      messageText = followUp.text;
      nextInteractionMode = followUp.interactionMode;
      sourceProposedPlan =
        followUp.interactionMode === DEFAULT_INTERACTION_MODE
          ? {
              threadId: input.planFollowUp.planThreadId,
              planId: input.planFollowUp.planId,
            }
          : null;
    }

    if (!messageText.trim()) {
      return null;
    }

    return {
      compiledTurn,
      messageText,
      interactionMode: nextInteractionMode,
      sourceProposedPlan,
    };
  };

  const submitActiveRunFollowUp = async (input: {
    sendContext: ComposerSendSnapshot["sendContext"];
    interactionMode: AgentInteractionMode;
    planFollowUp: ComposerSendSnapshot["planFollowUp"];
    clearComposerOnSubmit: boolean;
    streamingBehavior: "steer" | "followUp";
  }): Promise<void> => {
    if (!activeThread) {
      return;
    }
    const runtimeCwd = workspaceTarget.cwd;
    if (!runtimeCwd) {
      setThreadError(activeThread.id, "Pi runtime requires an active project before sending.");
      return;
    }
    const preparedTurn = prepareComposerFollowUpTurn(input);
    if (!preparedTurn) {
      return;
    }

    if (!requireAvailableModelSelectionForSend(activeThread.id, activeThread.modelSelection)) {
      return;
    }
    const preparedRuntimePolicy = prepareRuntimePolicyForSend(
      activeThread.id,
      preparedTurn.interactionMode,
      activeThread.modelSelection,
    );
    if (!preparedRuntimePolicy) {
      return;
    }

    sendInFlightRef.current = true;
    const threadIdForSend = activeThread.id;
    const messageIdForSend = newMessageId();
    const parentEntryIdForSend = activeThread.leafId ?? null;
    const composerImagesSnapshot = [...input.sendContext.images];
    let composerClearedForSend = false;

    try {
      const runtimeImages: ThreadAgentRuntimeImageAttachment[] =
        await prepareComposerTurnAttachments(composerImagesSnapshot);

      if (input.planFollowUp && preparedTurn.interactionMode === DEFAULT_INTERACTION_MODE) {
        dismissPendingPlan(input.planFollowUp.planThreadId, input.planFollowUp.planId);
        setComposerDraftInteractionMode(composerDraftTarget, DEFAULT_INTERACTION_MODE);
      }

      if (input.clearComposerOnSubmit) {
        composerRef.current?.clearComposer();
        composerClearedForSend = true;
      }

      setThreadError(threadIdForSend, null);
      forceTimelineAtEnd();

      markLocalRuntimeThread(threadIdForSend);
      await sendRuntimeTurnWithPreparedPolicy({
        threadId: threadIdForSend,
        cwd: runtimeCwd,
        text: preparedTurn.messageText,
        interactionMode: preparedTurn.interactionMode,
        sourceProposedPlan: preparedTurn.sourceProposedPlan,
        clientMessageId: messageIdForSend,
        replacesClientMessageId: null,
        parentEntryId: parentEntryIdForSend,
        images: runtimeImages,
        modelSelection: activeThread.modelSelection,
        preparedPolicy: preparedRuntimePolicy,
        streamingBehavior: input.streamingBehavior,
      });
    } catch (err) {
      removeThreadSendIntentsByClientMessageId(messageIdForSend);
      if (composerClearedForSend && composerImagesRef.current.length === 0) {
        const retryComposerImages = composerImagesSnapshot.map(cloneComposerImageForRetry);
        composerImagesRef.current = retryComposerImages;
        addComposerDraftImages(composerDraftTarget, retryComposerImages);
        composerRef.current?.restoreComposer({
          prompt: input.sendContext.prompt,
          images: retryComposerImages,
          ...(input.sendContext.richText !== undefined
            ? { richText: input.sendContext.richText }
            : {}),
        });
      }
      setThreadError(
        threadIdForSend,
        err instanceof Error ? err.message : "Failed to send follow-up message.",
      );
    } finally {
      sendInFlightRef.current = false;
    }
  };

  const createRuntimeQueuedFollowUp = async (input: {
    sendContext: ComposerSendSnapshot["sendContext"];
    interactionMode: AgentInteractionMode;
    planFollowUp: ComposerSendSnapshot["planFollowUp"];
    clientMessageId: MessageId;
    createdAt: string;
    existingQueuedFollowUp?: ThreadAgentRuntimeQueuedFollowUp | null;
  }): Promise<ThreadAgentRuntimeQueuedFollowUp | null> => {
    if (!activeThread) {
      return null;
    }
    const runtimeCwd = workspaceTarget.cwd;
    if (!runtimeCwd) {
      setThreadError(activeThread.id, "Pi runtime requires an active project before sending.");
      return null;
    }
    const preparedTurn = prepareComposerFollowUpTurn(input);
    if (!preparedTurn) {
      return null;
    }
    if (!requireAvailableModelSelectionForSend(activeThread.id, activeThread.modelSelection)) {
      return null;
    }
    const preparedRuntimePolicy = prepareRuntimePolicyForSend(
      activeThread.id,
      preparedTurn.interactionMode,
      activeThread.modelSelection,
    );
    if (!preparedRuntimePolicy) {
      return null;
    }

    const images: ThreadAgentRuntimeImageAttachment[] = await prepareComposerTurnAttachments([
      ...input.sendContext.images,
    ]);
    return {
      threadId: activeThread.id,
      cwd: runtimeCwd,
      input: preparedTurn.messageText,
      interactionMode: preparedTurn.interactionMode,
      sourceProposedPlan: preparedTurn.sourceProposedPlan,
      clientMessageId: input.clientMessageId,
      replacesClientMessageId: input.existingQueuedFollowUp?.replacesClientMessageId ?? null,
      ...(input.existingQueuedFollowUp?.parentEntryId !== undefined
        ? { parentEntryId: input.existingQueuedFollowUp.parentEntryId }
        : {}),
      images,
      policy: await preparedRuntimePolicy.policy,
      modelSelection: activeThread.modelSelection,
      runtimeMode: DEFAULT_RUNTIME_MODE,
      titleSeed: preparedTurn.messageText,
      createdAt: input.createdAt,
    };
  };

  const clearLiveComposer = () => {
    composerRef.current?.clearComposer();
  };

  const dismissPendingPlan = (agentId: ThreadId, planId: ProposedPlan["id"]) => {
    dismissLifecyclePlan(agentId, planId);
  };

  const onDismissPendingPlan = () => {
    if (!activePendingPlan || !activePendingPlanSourceThreadId) {
      return;
    }
    dismissPendingPlan(activePendingPlanSourceThreadId, activePendingPlan.id);
  };

  const onSend = async (e?: { preventDefault: () => void }) => {
    e?.preventDefault();
    if (isInactiveTiledSurface) {
      console.debug("[chat-view] composer onSend ignored from inactive tiled surface", {
        environmentId,
        routeKind,
        threadId,
        draftId,
      });
      return;
    }
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
    const shouldSubmitPlanFeedback = interactionMode === "plan" && hasPlanFeedbackText;
    const planFollowUp =
      showPlanFollowUpPrompt &&
      activePendingPlan &&
      activePendingPlanSourceThreadId &&
      activeThread &&
      (shouldSubmitPlanFeedback || hasOnlyBlankPlanFollowUp)
        ? {
            planMarkdown: activePendingPlan.planMarkdown,
            planId: activePendingPlan.id,
            planThreadId: activePendingPlanSourceThreadId,
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
    if (editingQueuedComposerItemId) {
      if (!activeThread) {
        return;
      }
      const existingQueuedItem =
        queuedComposerItems.find((item) => item.id === editingQueuedComposerItemId) ?? null;
      const existingQueuedFollowUp =
        useAgentRuntimeStore
          .getState()
          .snapshot.queuedFollowUps.find(
            (item) =>
              item.threadId === activeThread.id &&
              item.clientMessageId === editingQueuedComposerItemId,
          ) ?? null;
      const { hasSendableContent } = currentComposerSendState;
      if (!hasSendableContent || !existingQueuedItem) {
        return;
      }

      const queuedItem = await createRuntimeQueuedFollowUp({
        sendContext,
        interactionMode,
        planFollowUp: existingQueuedItem.planFollowUp,
        clientMessageId: editingQueuedComposerItemId,
        createdAt: existingQueuedItem.createdAt,
        existingQueuedFollowUp,
      });
      if (!queuedItem) {
        return;
      }
      await readHonkRuntimeApi().updateQueuedFollowUp(queuedItem);
      clearLiveComposer();
      cancelEditingQueuedComposerItem(routeThreadKey);
      return;
    }

    if (!currentComposerSendState.hasSendableContent && planFollowUp === null) {
      return;
    }

    const shouldSendActiveRunFollowUp =
      isTurnRunning &&
      !isCompactingActive &&
      (sendWhileStreamingBehavior === "send" || interactionMode === "multitask");
    if (shouldSendActiveRunFollowUp) {
      await submitActiveRunFollowUp({
        sendContext,
        interactionMode,
        planFollowUp,
        clearComposerOnSubmit: true,
        streamingBehavior: "followUp",
      });
      return;
    }

    const shouldQueueDuringActiveTurn =
      isTurnRunning &&
      (isCompactingActive ||
        (interactionMode !== "multitask" &&
          (sendWhileStreamingBehavior === "queue" ||
            sendWhileStreamingBehavior === "stop-and-send")));
    if (shouldQueueDuringActiveTurn) {
      const { hasSendableContent } = currentComposerSendState;
      if (!hasSendableContent) {
        return;
      }

      const queuedItem = await createRuntimeQueuedFollowUp({
        sendContext,
        interactionMode,
        planFollowUp,
        clientMessageId: newMessageId(),
        createdAt: new Date().toISOString(),
      });
      if (!queuedItem) {
        return;
      }
      await readHonkRuntimeApi().enqueueFollowUp(queuedItem);
      clearLiveComposer();
      if (sendWhileStreamingBehavior === "stop-and-send" && !isCompactingActive) {
        await readHonkRuntimeApi().sendQueuedFollowUpNow({
          threadId: queuedItem.threadId,
          clientMessageId: queuedItem.clientMessageId,
        });
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

  const onBuildPendingPlan = () => {
    if (
      !showPlanFollowUpPrompt ||
      !activePendingPlan ||
      !activePendingPlanSourceThreadId ||
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

    markLifecyclePlanBuilding(activePendingPlanSourceThreadId, activePendingPlan.id);
    setComposerDraftInteractionMode(composerDraftTarget, DEFAULT_INTERACTION_MODE);
    void submitComposerSendSnapshot({
      sendContext: {
        ...sendContext,
        prompt: "",
        images: [],
      },
      interactionMode: DEFAULT_INTERACTION_MODE,
      planFollowUp: {
        planMarkdown: activePendingPlan.planMarkdown,
        planId: activePendingPlan.id,
        planThreadId: activePendingPlanSourceThreadId,
      },
      clearComposerOnSubmit: true,
    });
  };

  const onInterrupt = async () => {
    const api = readEnvironmentApi(environmentId);
    if (!activeThread) return;
    const turnId = activeRunningTurnId;
    const runtimeAbort = (async () => {
      try {
        await readHonkRuntimeApi().abort({ threadId: activeThread.id });
      } catch {
        // The runtime host may be unavailable or the thread may already be idle.
      }
    })();
    if (!api) {
      await runtimeAbort;
      return;
    }
    if (!turnId) {
      await runtimeAbort;
      return;
    }
    await Promise.all([
      runtimeAbort,
      api.orchestration.dispatchCommand({
        type: "thread.turn.interrupt",
        commandId: newCommandId(),
        threadId: activeThread.id,
        turnId,
        createdAt: new Date().toISOString(),
      }),
    ]);
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
      cancelEditingQueuedComposerItem(routeThreadKey);
    }
    if (!activeThread) {
      return;
    }
    void readHonkRuntimeApi().removeQueuedFollowUp({
      threadId: activeThread.id,
      clientMessageId: itemId,
    });
  };

  const onSendQueuedComposerItemNow = (itemId: MessageId) => {
    if (isConnecting || isSendBusy || sendInFlightRef.current || !activeThread) {
      return;
    }
    const item = queuedComposerItems.find((entry) => entry.id === itemId);
    if (!item) {
      return;
    }
    if (editingQueuedComposerItemId === itemId) {
      clearLiveComposer();
      cancelEditingQueuedComposerItem(routeThreadKey);
    }
    void readHonkRuntimeApi().sendQueuedFollowUpNow({
      threadId: activeThread.id,
      clientMessageId: item.id,
    });
  };

  const onReorderQueuedComposerItem = (
    itemId: MessageId,
    targetItemId: MessageId | null,
    insertAfter: boolean,
  ) => {
    if (!activeThread) {
      return;
    }
    void readHonkRuntimeApi().reorderQueuedFollowUp({
      threadId: activeThread.id,
      clientMessageId: itemId,
      targetClientMessageId: targetItemId,
      insertAfter,
    });
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
    void readHonkRuntimeApi()
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
    if (!requireAvailableModelSelectionForSend(threadIdForSend, activeThread.modelSelection)) {
      return;
    }
    const preparedRuntimePolicy = prepareRuntimePolicyForSend(
      threadIdForSend,
      nextInteractionMode,
      activeThread.modelSelection,
    );
    if (!preparedRuntimePolicy) {
      return;
    }
    const api = readEnvironmentApi(environmentId);
    const messageIdForSend = newMessageId();
    const messageCreatedAt = new Date().toISOString();
    const parentEntryIdForSend = activeThread.leafId ?? null;
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
    setThreadError(threadIdForSend, null);
    beginLocalDispatch({ preparingWorktree: false });

    // Scroll to the current end *before* adding the optimistic message.
    forceTimelineAtEnd();

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
        parentEntryId: parentEntryIdForSend,
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
      if (localTurnStartAnnounced && !serverTurnStartSucceeded) {
        clearUnconfirmedLocalTurnStart(environmentId, threadIdForSend, messageIdForSend);
        localTurnStartAnnounced = false;
      }
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
        clearLifecyclePlanBuilding(planFollowUp.planThreadId, planFollowUp.planId);
        resetLocalDispatch();
      }
    }
  };
  const handleComposerSend = useStableEvent(onSend);
  const handleCompactContext = useStableEvent(onCompactContext);
  const handleComposerInterrupt = useStableEvent(onInterrupt);
  const handleBuildPendingPlan = useStableEvent(onBuildPendingPlan);
  const handleDismissPendingPlan = useStableEvent(onDismissPendingPlan);
  const handleViewActivePlan = useStableEvent(() => {
    workbenchTabPersistenceActions.activatePlan(workspaceTarget.workspaceKey);
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
  const onExpandTimelineImage = (preview: ExpandedImagePreview) => {
    setExpandedImage(preview);
  };
  const renderEditComposer = (message: ChatMessage): ReactNode => {
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
        modelSelection={activeThread?.modelSelection ?? threadCreateModelSelection}
        activeContextWindow={activeContextWindow}
        resolvedTheme={resolvedTheme}
        settings={settings}
        keybindings={keybindings}
        terminalOpen={false}
        gitCwd={gitCwd}
        onInterrupt={handleComposerInterrupt}
        setThreadError={setThreadError}
        onExpandImage={onExpandTimelineImage}
        onCancelEditUserMessage={onCancelEditUserMessage}
        onSubmitEditUserMessage={onSubmitEditUserMessage}
      />
    );
  };
  const activeTimelineCacheKey = activeThread?.id ?? "";
  const serverMessagesAcknowledgementKey = committedMessageIdsKey(activeThread?.messages);
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
        {isActiveSurface ? (
          <RuntimeThreadHydrationSync
            key={["runtime-hydration", routeKind, threadId, activeProjectCwd ?? gitCwd ?? ""].join(
              "\0",
            )}
            cwd={activeProjectCwd ?? gitCwd}
            interactionMode={interactionMode}
            modelSelection={threadCreateModelSelection}
            routeKind={routeKind}
            threadId={threadId}
          />
        ) : null}
        {isActiveSurface ? (
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
        ) : null}
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
    </>
  );
  const chatViewLifecycleSync = (
    <>
      {activeThreadLifecycleSync}
      <ActiveThreadUiResetSync
        key={["active-thread-ui-reset", activeThread?.id ?? ""].join("\0")}
        isAtEndRef={isAtEndRef}
        setPullRequestDialogState={setPullRequestDialogState}
        setIsTimelineAtEnd={setIsTimelineAtEnd}
      />
      {isActiveSurface && autoFocusComposer ? (
        <ActiveThreadComposerFocusSync
          key={["active-thread-composer-focus", activeThread?.id ?? ""].join("\0")}
          activeThreadId={activeThread?.id ?? null}
          focusComposer={focusComposer}
        />
      ) : null}
      <ThreadMediaResetSync
        key={[draftId ?? "", threadId].join("\0")}
        clearAttachmentPreviewHandoffs={clearAttachmentPreviewHandoffs}
        setExpandedImage={setExpandedImage}
      />
      {isActiveSurface ? (
        <ChatViewKeyboardShortcutsSync
          key={[activeProjectScriptsKey, activeThreadId ?? "", keybindingsKey].join("\0")}
          activeProjectScripts={workspaceProject?.scripts ?? null}
          activeThreadId={activeThreadId}
          keybindings={keybindings}
          runProjectScript={runProjectScript}
        />
      ) : null}
    </>
  );

  if (!activeThread) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-transparent">
        {serverThreadLifecycleSync}
        <MissingActiveThreadFallback
          diagnostics={{
            routeKind,
            environmentId,
            threadId,
            draftId,
            serverThreadExists,
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-transparent">
      {chatViewLifecycleSync}
      {attachmentPreviewHandoffSync}
      {/* Top bar */}
      {props.hideContentPaneTopBar ? null : (
        <header
          className={cn(
            "agent-window-chat-header content-pane-top-bar drag-region box-border flex h-(--honk-workbench-chrome-row-height) select-none items-center px-(--honk-workbench-chrome-padding-inline)",
            isElectron &&
              reserveTitleBarControlInset &&
              "wco:pr-[calc(100vw-env(titlebar-area-width)-env(titlebar-area-x)+1em)]",
          )}
          data-shell-drag-region=""
        >
          <ChatHeader
            activeThreadTitle={contentPaneTopBarTitle}
            actions={contentPaneTopBarActions}
            tooltipDetails={contentPaneTopBarTooltipDetails}
          />
        </header>
      )}

      {/* Error banner */}
      <ThreadErrorBanner
        error={suppressThreadErrorBanner ? null : activeThread.error}
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
                  isTurnActive={timelineTurnActive}
                  isStreaming={isTimelineSurfaceActive}
                  editUserMessagesDisabled={isWorking}
                  bottomClearancePx={DOCKED_COMPOSER_TIMELINE_RESERVE_PX}
                  scrollerControllerRef={conversationScrollerControllerRef}
                  timelineEntries={timelineEntries}
                  pendingApprovals={pendingApprovals}
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
                  onIsAtEndChange={onIsAtEndChange}
                />

                <div
                  aria-hidden="true"
                  data-chat-bottom-gradient-overlay=""
                  className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-32 bg-[linear-gradient(to_top,var(--honk-shell-center-surface-background)_0,color-mix(in_srgb,var(--honk-shell-center-surface-background)_82%,transparent)_52%,transparent_100%)]"
                />
              </div>
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
                ? cn(
                    "pointer-events-none absolute bottom-0 left-0 right-0 isolate z-30 before:pointer-events-none before:absolute before:bottom-[-12px] before:top-1/2 before:z-0 before:bg-(--honk-shell-center-surface-background) *:pointer-events-auto *:relative *:z-1",
                    // Tiled panes must not paint this backdrop into siblings.
                    isTiledSurface
                      ? "before:inset-x-0"
                      : "before:left-1/2 before:ml-[-50vw] before:w-screen",
                  )
                : undefined,
            )}
            data-new-agent-empty-state={isHeroComposer ? "" : undefined}
            {...(isConnecting ? { "data-disabled": "true" } : {})}
            {...(isTimelineAtEnd ? { "data-scrolled-to-end": "" } : {})}
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
            {activeGoalStatus ? <ActiveGoalStatusBar goal={activeGoalStatus.goal} /> : null}
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
              inactive={isInactiveTiledSurface}
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
              activeProposedPlan={activePendingPlan}
              planSurfaceOpen={planSurfaceOpen}
              interactionMode={interactionMode}
              modelSelection={threadCreateModelSelection}
              activeContextWindow={activeContextWindow}
              resolvedTheme={resolvedTheme}
              settings={settings}
              keybindings={keybindings}
              terminalOpen={false}
              gitCwd={gitCwd}
              branchName={composerBranchName}
              executionModeLabel={composerExecutionModeLabel}
              composerImagesRef={composerImagesRef}
              onSend={handleComposerSend}
              onCompactContext={handleCompactContext}
              onInterrupt={handleComposerInterrupt}
              onBuildPlan={handleBuildPendingPlan}
              onDismissPlan={handleDismissPendingPlan}
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
              handleInteractionModeChange={handleInteractionModeChange}
              setThreadError={setThreadError}
              onExpandImage={onExpandTimelineImage}
            />
            {heroComposerActions}
            {isHeroComposer && !isTiledSurface ? (
              <NewAgentFooterTip tip={newAgentFooterTip} />
            ) : null}
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
  const nextSnapshot = deriveLatestContextWindowSnapshot(activities);
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

  const filtered = omitSubagentActivitiesFromSharedChat(activities);
  if (areSameActivityReferences(previousRef.current, filtered)) {
    return previousRef.current;
  }
  previousRef.current = filtered;
  return filtered;
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

interface ActiveGoalStatus {
  readonly goal: string;
}

function deriveActiveGoalStatus(input: {
  readonly messages: ReadonlyArray<ChatMessage>;
  readonly sendIntents: ReadonlyArray<ThreadSendIntent>;
}): ActiveGoalStatus | null {
  const latestInput = latestGoalCandidateInput(input.messages, input.sendIntents);
  if (!latestInput) {
    return null;
  }
  const goal = extractGoalText(latestInput.text);
  return goal ? { goal } : null;
}

function latestGoalCandidateInput(
  messages: ReadonlyArray<ChatMessage>,
  sendIntents: ReadonlyArray<ThreadSendIntent>,
): { readonly text: string; readonly createdAt: string; readonly sequence: number } | null {
  let latest: {
    readonly text: string;
    readonly createdAt: string;
    readonly sequence: number;
  } | null = null;
  let sequence = 0;

  for (const message of messages) {
    if (message.role !== "user") {
      continue;
    }
    latest = newestGoalCandidate(latest, {
      text: message.text,
      createdAt: message.createdAt,
      sequence,
    });
    sequence += 1;
  }

  for (const intent of sendIntents) {
    latest = newestGoalCandidate(latest, {
      text: intent.text,
      createdAt: intent.createdAt,
      sequence,
    });
    sequence += 1;
  }

  return latest;
}

function newestGoalCandidate<T extends { readonly createdAt: string; readonly sequence: number }>(
  previous: T | null,
  next: T,
): T {
  if (!previous) {
    return next;
  }
  const previousTime = Date.parse(previous.createdAt);
  const nextTime = Date.parse(next.createdAt);
  if (Number.isFinite(previousTime) && Number.isFinite(nextTime) && previousTime !== nextTime) {
    return nextTime > previousTime ? next : previous;
  }
  return next.sequence > previous.sequence ? next : previous;
}

function extractGoalText(text: string): string | null {
  const match = /^Goal:\s*([\s\S]+)$/i.exec(text.trim());
  const goal = match?.[1]?.trim();
  return goal ? goal : null;
}

function ActiveGoalStatusBar(props: { readonly goal: string }) {
  return (
    <div
      data-composer-thread-status-bar=""
      className="mx-auto mb-1 box-border flex min-h-7 w-full max-w-agent-chat items-center gap-2 overflow-hidden rounded-full border border-honk-stroke-tertiary bg-honk-bg-elevated px-3 py-1 text-body text-honk-fg-secondary shadow-xs"
      aria-live="polite"
    >
      <span className="inline-flex shrink-0 items-center gap-1.5 font-medium text-honk-fg-primary">
        <span
          className="size-1.5 rounded-full bg-honk-fg-secondary"
          aria-hidden="true"
          data-goal-progress-dot=""
        />
        Goal in progress
      </span>
      <span className="min-w-0 truncate text-honk-fg-tertiary" title={props.goal}>
        {props.goal}
      </span>
    </div>
  );
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
      previousEntry && canReuseCompletedWorkLogEntry(previousEntry, entry) ? previousEntry : entry;
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
  // oxlint-disable-next-line react-doctor/react-compiler-no-manual-memoization -- stable event surface
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
