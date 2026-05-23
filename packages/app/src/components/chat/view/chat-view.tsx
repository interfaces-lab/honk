import {
  type ApprovalRequestId,
  type EnvironmentId,
  type GitBranch,
  type MessageId,
  type ModelSelection,
  type ProjectScript,
  ProviderInstanceId,
  type ProjectId,
  type ProviderApprovalDecision,
  type ResolvedKeybindingsConfig,
  type ServerProvider,
  type ScopedThreadRef,
  type ThreadEntryId,
  type ThreadId,
  type TurnId,
  type KeybindingCommand,
  OrchestrationThreadActivity,
  ProviderInteractionMode,
  RuntimeMode,
  formatThreadEntryPathIssue,
  resolveThreadEntryPath,
} from "@multi/contracts";
import {
  parseScopedThreadKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@multi/client-runtime";
import { projectScriptCwd, projectScriptRuntimeEnv } from "@multi/shared/project-scripts";
import { Debouncer } from "@tanstack/react-pacer";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@multi/ui/alert";
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useShallow } from "zustand/react/shallow";
import { useGitStatus } from "~/lib/git-status-state";
import { readEnvironmentApi } from "../../../environment-api";
import { isElectron } from "../../../env";
import { readLocalApi } from "../../../local-api";
import { parseDiffRouteSearch, stripDiffSearchParams } from "~/app/routes/chat-shell-search";
import {
  collapseExpandedComposerCursor,
  isUnresolvedStandaloneComposerSlashCommand,
  parseStandaloneComposerSlashCommand,
} from "../composer/prompt-triggers";
import {
  derivePendingApprovals,
  derivePendingUserInputs,
  derivePhase,
  deriveTimelineEntries,
  deriveActiveWorkStartedAt,
  findLatestProposedPlan,
  deriveWorkLogEntries,
  hasActionableProposedPlan,
  isLatestTurnSettled,
  type PendingApproval,
  type PendingUserInput,
} from "../../../session-logic";
import {
  buildPendingUserInputAnswers,
  derivePendingUserInputProgress,
  setPendingUserInputCustomAnswer,
  togglePendingUserInputOptionSelection,
  type PendingUserInputDraftAnswer,
} from "~/components/chat/composer/pending-user-input";
import {
  selectEnvironmentState,
  selectSidebarThreadsAcrossEnvironments,
  useStore,
} from "../../../stores/thread-store";
import {
  createProjectSelectorByRef,
  createThreadSelectorByRef,
} from "../../../stores/thread-selectors";
import { useUiStateStore } from "../../../stores/ui-state-store";
import { resolvePlanFollowUpSubmission } from "~/plan/proposed-plan";
import {
  DEFAULT_INTERACTION_MODE,
  MAX_TERMINALS_PER_GROUP,
  type ChatMessage,
  type SessionPhase,
  type Thread,
  type ThreadTreeEntry,
  type TurnDiffSummary,
} from "../../../types";
import { useTheme } from "../../../hooks/use-theme";
import { useTurnDiffSummaries } from "../../../hooks/use-turn-diff-summaries";
import { useCommandPaletteStore } from "../../../stores/ui/command-palette-store";
import { buildTemporaryWorktreeBranchName } from "@multi/shared/git";
import { resolveShortcutCommand, shortcutLabelForCommand } from "../../../keybindings";
import { cn, randomUUID } from "~/lib/utils";
import { toastManager } from "~/app/toast";
import { type NewProjectScriptInput } from "../../project-scripts-control";
import {
  commandForProjectScript,
  decodeProjectScriptKeybindingRule,
  nextProjectScriptId,
  projectScriptIdFromCommand,
} from "~/lib/project-scripts";
import { newCommandId, newDraftId, newMessageId, newThreadId } from "~/lib/utils";
import { useSettings } from "../../../hooks/use-settings";
import { resolveAppProviderModelState } from "../../../model/selection";
import { formatProviderDriverKindLabel } from "../../../model/provider-models";
import { isTerminalFocused } from "../../../lib/terminal-focus";
import { deriveLogicalProjectKey } from "../../../stores/project-identity";
import {
  buildDraftThreadRouteParams,
  buildThreadRouteParams,
} from "~/app/routes/thread-route-targets";
import {
  type ComposerImageAttachment,
  type DraftThreadEnvMode,
  DraftId,
  useComposerDraftStore,
  type DraftId as ComposerDraftId,
} from "../../../stores/chat-drafts";
import { useComposerQueueStore, type QueuedComposerItem } from "../../../stores/chat-send-queue";
import {
  selectThreadTerminalState,
  type ThreadTerminalLaunchContext,
  useTerminalStateStore,
} from "../../../terminal-state-store";
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
import { useSubagentPreviewStore } from "../../../stores/subagent-preview-store";
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
import { formatGitActionErrorDescription } from "~/git/action-error-description";
import { ThreadErrorBanner } from "../message/error-banner";
import { cloneComposerImageForRetry, resolveSendEnvMode } from "../composer/send";
import { createQueuedComposerItem } from "./chat-view-send-flow";
import {
  compileComposerSubmitTurn,
  type ComposerSubmitContext,
  deriveComposerSendState,
  formatOutgoingPrompt,
  prepareComposerTurnAttachments,
} from "../composer-submit";
import {
  collectUserMessageBlobPreviewUrls,
  revokeUserMessagePreviewUrls,
} from "../message/preview-url-lifecycle";
import {
  MAX_HIDDEN_MOUNTED_TERMINAL_THREADS,
  buildLocalDraftThread,
  createLocalDispatchSnapshot,
  hasServerAcknowledgedLocalDispatch,
  LAST_INVOKED_SCRIPT_BY_PROJECT_KEY,
  LastInvokedScriptByProjectSchema,
  type LocalDispatchSnapshot,
  type PullRequestDialogState,
  reconcileMountedTerminalThreadIds,
  shouldWriteThreadErrorToCurrentServerThread,
  threadHasStarted,
} from "./thread-lifecycle";
import { useLocalStorage } from "~/hooks/use-local-storage";
import { useComposerHandleContext } from "../composer/handle-context";
import {
  useServerAvailableEditors,
  useServerConfig,
  useServerKeybindings,
} from "~/rpc/server-state";
import { sanitizeThreadErrorMessage } from "~/rpc/transport-error";
import { retainThreadDetailSubscription } from "../../../environments/runtime/service";
import { useGitAgentActionHandoff } from "~/lib/git-agent-action-handoff";
import { IconChevronRightMedium, IconExclamationCircle } from "central-icons";
import { useAttachmentPreviewHandoff } from "./attachment-preview-handoff";
import { BranchToolbar } from "./branch-toolbar";
import { useMountEffect } from "~/hooks/use-mount-effect";

const EMPTY_ACTIVITIES: OrchestrationThreadActivity[] = [];
const EMPTY_PROVIDERS: ServerProvider[] = [];
const EMPTY_PENDING_APPROVALS: PendingApproval[] = [];
const EMPTY_PENDING_USER_INPUTS: PendingUserInput[] = [];
const EMPTY_PENDING_USER_INPUT_ANSWERS: Record<string, PendingUserInputDraftAnswer> = {};
const EMPTY_QUEUED_COMPOSER_ITEMS: QueuedComposerItem[] = [];
const EMPTY_TIMELINE_PROPOSED_PLANS: Thread["proposedPlans"] = [];
const DOCKED_COMPOSER_TIMELINE_RESERVE_PX = 88;
const COMPOSER_INTERACTION_MODE_CYCLE = [
  "default",
  "ask",
  "plan",
] as const satisfies readonly ProviderInteractionMode[];

interface ThreadBranchView {
  status: "unfiltered" | "valid" | "invalid";
  entryId: ThreadEntryId | null;
  messageIds: ReadonlySet<MessageId> | null;
  turnIds: ReadonlySet<TurnId> | null;
  issue: string | null;
}

function deriveThreadBranchView(
  thread: Thread | null,
  targetEntryId: ThreadEntryId | null | undefined,
): ThreadBranchView {
  const unfiltered: ThreadBranchView = {
    status: "unfiltered",
    entryId: null,
    messageIds: null,
    turnIds: null,
    issue: null,
  };
  if (!thread) {
    return unfiltered;
  }

  const entries = thread.entries ?? [];
  const entryId = targetEntryId ?? thread.activeEntryId ?? null;
  if (!entryId || entries.length === 0) {
    return unfiltered;
  }

  const path = resolveThreadEntryPath({ entries, entryId });
  if (!path.ok) {
    return {
      status: "invalid",
      entryId,
      messageIds: null,
      turnIds: null,
      issue: formatThreadEntryPathIssue(path),
    };
  }

  const messageById = new Map(thread.messages.map((message) => [message.id, message] as const));
  const messageIds = new Set<MessageId>();
  const turnIds = new Set<TurnId>();
  for (const entry of path.entries) {
    if (entry.turnId !== null) {
      turnIds.add(entry.turnId);
    }
    if (entry.kind !== "message" || entry.messageId === null) {
      continue;
    }
    messageIds.add(entry.messageId);
    const message = messageById.get(entry.messageId);
    if (!message) {
      return {
        status: "invalid",
        entryId,
        messageIds: null,
        turnIds: null,
        issue: `Thread entry '${entry.id}' points to missing message '${entry.messageId}'.`,
      };
    }
    if (message?.turnId) {
      turnIds.add(message.turnId);
    }
  }

  return {
    status: "valid",
    entryId,
    messageIds,
    turnIds,
    issue: null,
  };
}

function filterMessagesToBranch(
  messages: ChatMessage[],
  branchView: ThreadBranchView,
): ChatMessage[] {
  const messageIds = branchView.messageIds;
  if (branchView.status === "invalid") {
    return [];
  }
  if (!messageIds) {
    return messages;
  }
  return messages.filter((message) => messageIds.has(message.id));
}

function filterActivitiesToBranch(
  activities: OrchestrationThreadActivity[],
  branchView: ThreadBranchView,
): OrchestrationThreadActivity[] {
  const turnIds = branchView.turnIds;
  if (branchView.status === "invalid") {
    return [];
  }
  if (!turnIds) {
    return activities;
  }
  return activities.filter((activity) => activity.turnId !== null && turnIds.has(activity.turnId));
}

function containsThreadEntry(
  thread: Thread | null,
  entryId: ThreadEntryId | null | undefined,
): entryId is ThreadEntryId {
  if (!thread || !entryId || !thread.entries) {
    return false;
  }
  return resolveThreadEntryPath({ entries: thread.entries, entryId }).ok;
}

function findThreadMessageEntry(
  thread: Thread | null,
  messageId: MessageId | null | undefined,
): ThreadTreeEntry | null {
  if (!thread || !messageId || !thread.entries) {
    return null;
  }
  return (
    thread.entries.find((entry) => entry.kind === "message" && entry.messageId === messageId) ??
    null
  );
}

function ProviderStatusBanner({ status }: { status: ServerProvider | null }) {
  if (!status || status.status === "ready" || status.status === "disabled") {
    return null;
  }

  const providerLabel = status.displayName?.trim() || formatProviderDriverKindLabel(status.driver);
  const defaultMessage =
    status.status === "error"
      ? `${providerLabel} provider is unavailable.`
      : `${providerLabel} provider has limited availability.`;
  const title = `${providerLabel} provider status`;

  return (
    <div className="pt-3 mx-auto max-w-3xl">
      <Alert variant={status.status === "error" ? "error" : "warning"}>
        <IconExclamationCircle />
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription className="line-clamp-3" title={status.message ?? defaultMessage}>
          {status.message ?? defaultMessage}
        </AlertDescription>
      </Alert>
    </div>
  );
}

function useValueIdentityVersion<TValue>(value: TValue): number {
  const valueRef = useRef(value);
  const versionRef = useRef(0);
  if (valueRef.current !== value) {
    valueRef.current = value;
    versionRef.current += 1;
  }
  return versionRef.current;
}

function nextComposerInteractionMode(mode: ProviderInteractionMode): ProviderInteractionMode {
  const index = COMPOSER_INTERACTION_MODE_CYCLE.indexOf(mode);
  const nextIndex = index < 0 ? 0 : (index + 1) % COMPOSER_INTERACTION_MODE_CYCLE.length;
  return COMPOSER_INTERACTION_MODE_CYCLE[nextIndex] ?? DEFAULT_INTERACTION_MODE;
}

type ComposerSendSnapshot = {
  sendContext: ComposerSubmitContext;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  planFollowUp: { planMarkdown: string } | null;
  clearComposerOnSubmit: boolean;
  messageId?: MessageId;
  createdAt?: string;
};
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

  if (serverAcknowledgedLocalDispatch && localDispatch !== null) {
    setLocalDispatch(null);
  }

  return {
    beginLocalDispatch,
    resetLocalDispatch,
    localDispatchStartedAt: localDispatch?.startedAt ?? null,
    isPreparingWorktree: localDispatch?.preparingWorktree ?? false,
    isSendBusy: localDispatch !== null && !serverAcknowledgedLocalDispatch,
  };
}

function assertActiveThread(
  activeThread: Thread | undefined,
  input: {
    routeKind: ChatViewProps["routeKind"];
    environmentId: EnvironmentId;
    threadId: ThreadId;
    draftId: ComposerDraftId | null;
  },
): asserts activeThread is Thread {
  if (activeThread) {
    return;
  }

  throw new Error(
    `ChatView rendered without an active thread for ${input.routeKind} route ${input.environmentId}/${input.threadId}${
      input.draftId ? ` (${input.draftId})` : ""
    }.`,
  );
}

function MountedTerminalThreadsSync({
  activeThreadKey,
  existingOpenTerminalThreadKeys,
  setMountedTerminalThreadKeys,
  terminalOpen,
}: {
  activeThreadKey: string | null;
  existingOpenTerminalThreadKeys: readonly string[];
  setMountedTerminalThreadKeys: Dispatch<SetStateAction<string[]>>;
  terminalOpen: boolean;
}) {
  useMountEffect(() => {
    setMountedTerminalThreadKeys((currentThreadIds) => {
      const nextThreadIds = reconcileMountedTerminalThreadIds({
        currentThreadIds,
        openThreadIds: existingOpenTerminalThreadKeys,
        activeThreadId: activeThreadKey,
        activeThreadTerminalOpen: Boolean(activeThreadKey && terminalOpen),
        maxHiddenThreadCount: MAX_HIDDEN_MOUNTED_TERMINAL_THREADS,
      });
      return currentThreadIds.length === nextThreadIds.length &&
        currentThreadIds.every((nextThreadId, index) => nextThreadId === nextThreadIds[index])
        ? currentThreadIds
        : nextThreadIds;
    });
  });

  return null;
}

function RetainServerThreadDetailSync({
  environmentId,
  routeKind,
  threadId,
}: {
  environmentId: EnvironmentId;
  routeKind: ChatViewProps["routeKind"];
  threadId: ThreadId;
}) {
  useMountEffect(() => {
    if (routeKind !== "server") {
      return;
    }
    return retainThreadDetailSubscription(environmentId, threadId);
  });

  return null;
}

function MarkSettledServerThreadVisitedSync({
  activeThreadLastVisitedAt,
  completedAt,
  environmentId,
  latestTurnSettled,
  markThreadVisited,
  threadId,
}: {
  activeThreadLastVisitedAt: string | null | undefined;
  completedAt: string | null | undefined;
  environmentId: EnvironmentId | undefined;
  latestTurnSettled: boolean;
  markThreadVisited: (threadKey: string) => void;
  threadId: ThreadId | undefined;
}) {
  useMountEffect(() => {
    if (!environmentId || !threadId) return;
    if (!latestTurnSettled) return;
    if (!completedAt) return;
    const turnCompletedAt = Date.parse(completedAt);
    if (Number.isNaN(turnCompletedAt)) return;
    const lastVisitedAt = activeThreadLastVisitedAt ? Date.parse(activeThreadLastVisitedAt) : NaN;
    if (!Number.isNaN(lastVisitedAt) && lastVisitedAt >= turnCompletedAt) return;

    markThreadVisited(scopedThreadKey(scopeThreadRef(environmentId, threadId)));
  });

  return null;
}

function OptimisticUserMessagesUnmountCleanup({
  optimisticUserMessagesRef,
}: {
  optimisticUserMessagesRef: RefObject<ChatMessage[]>;
}) {
  useMountEffect(() => {
    return () => {
      for (const message of optimisticUserMessagesRef.current) {
        revokeUserMessagePreviewUrls(message);
      }
    };
  });

  return null;
}

function ActiveThreadUiResetSync({
  isAtBottomRef,
  setPullRequestDialogState,
  setShowScrollToBottom,
  showScrollDebouncer,
}: {
  isAtBottomRef: RefObject<boolean>;
  setPullRequestDialogState: Dispatch<SetStateAction<PullRequestDialogState | null>>;
  setShowScrollToBottom: Dispatch<SetStateAction<boolean>>;
  showScrollDebouncer: RefObject<{ cancel: () => void }>;
}) {
  useMountEffect(() => {
    setPullRequestDialogState(null);
    isAtBottomRef.current = true;
    showScrollDebouncer.current.cancel();
    setShowScrollToBottom(false);
  });

  return null;
}

function BooleanResetSync({
  setValue,
  value,
}: {
  setValue: Dispatch<SetStateAction<boolean>>;
  value: boolean;
}) {
  useMountEffect(() => {
    setValue(value);
  });

  return null;
}

function ActiveThreadComposerFocusSync({
  activeThreadId,
  focusComposer,
  terminalOpen,
}: {
  activeThreadId: ThreadId | null;
  focusComposer: () => void;
  terminalOpen: boolean;
}) {
  useMountEffect(() => {
    if (!activeThreadId || terminalOpen) return;
    const frame = window.requestAnimationFrame(() => {
      focusComposer();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  });

  return null;
}

function OptimisticUserMessagesServerAckSync({
  activeThreadId,
  handoffAttachmentPreviews,
  optimisticUserMessages,
  serverMessages,
  setOptimisticUserMessages,
}: {
  activeThreadId: ThreadId | null;
  handoffAttachmentPreviews: (messageId: MessageId, previewUrls: string[]) => void;
  optimisticUserMessages: ChatMessage[];
  serverMessages: readonly ChatMessage[] | undefined;
  setOptimisticUserMessages: Dispatch<SetStateAction<ChatMessage[]>>;
}) {
  useMountEffect(() => {
    if (!activeThreadId) return;
    if (!serverMessages || serverMessages.length === 0) {
      return;
    }
    const serverIds = new Set(serverMessages.map((message) => message.id));
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
  });

  return null;
}

function ThreadDraftResetSync({
  clearAttachmentPreviewHandoffs,
  resetLocalDispatch,
  setExpandedImage,
  setOptimisticUserMessages,
}: {
  clearAttachmentPreviewHandoffs: () => void;
  resetLocalDispatch: () => void;
  setExpandedImage: Dispatch<SetStateAction<ExpandedImagePreview | null>>;
  setOptimisticUserMessages: Dispatch<SetStateAction<ChatMessage[]>>;
}) {
  useMountEffect(() => {
    setOptimisticUserMessages((existing) => {
      for (const message of existing) {
        revokeUserMessagePreviewUrls(message);
      }
      return [];
    });
    clearAttachmentPreviewHandoffs();
    resetLocalDispatch();
    setExpandedImage(null);
  });

  return null;
}

function TerminalLaunchActiveThreadSync({
  activeThreadId,
  routeThreadRef,
  setTerminalLaunchContext,
  storeClearTerminalLaunchContext,
}: {
  activeThreadId: ThreadId | null;
  routeThreadRef: ScopedThreadRef;
  setTerminalLaunchContext: Dispatch<SetStateAction<TerminalLaunchContext | null>>;
  storeClearTerminalLaunchContext: (threadRef: ScopedThreadRef) => void;
}) {
  useMountEffect(() => {
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
  });

  return null;
}

function TerminalLaunchLocalSettledSync({
  activeProjectCwd,
  activeThreadId,
  activeThreadRef,
  activeThreadWorktreePath,
  setTerminalLaunchContext,
  storeClearTerminalLaunchContext,
}: {
  activeProjectCwd: string | null;
  activeThreadId: ThreadId | null;
  activeThreadRef: ScopedThreadRef | null;
  activeThreadWorktreePath: string | null;
  setTerminalLaunchContext: Dispatch<SetStateAction<TerminalLaunchContext | null>>;
  storeClearTerminalLaunchContext: (threadRef: ScopedThreadRef) => void;
}) {
  useMountEffect(() => {
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
      if (settledCwd === current.cwd && activeThreadWorktreePath === current.worktreePath) {
        if (activeThreadRef) {
          storeClearTerminalLaunchContext(activeThreadRef);
        }
        return null;
      }
      return current;
    });
  });

  return null;
}

function TerminalLaunchStoredSettledSync({
  activeProjectCwd,
  activeThreadId,
  activeThreadRef,
  activeThreadWorktreePath,
  storeClearTerminalLaunchContext,
  storeServerTerminalLaunchContext,
}: {
  activeProjectCwd: string | null;
  activeThreadId: ThreadId | null;
  activeThreadRef: ScopedThreadRef | null;
  activeThreadWorktreePath: string | null;
  storeClearTerminalLaunchContext: (threadRef: ScopedThreadRef) => void;
  storeServerTerminalLaunchContext: ThreadTerminalLaunchContext | null;
}) {
  useMountEffect(() => {
    if (!activeThreadId || !activeProjectCwd || !storeServerTerminalLaunchContext) {
      return;
    }
    const settledCwd = projectScriptCwd({
      project: { cwd: activeProjectCwd },
      worktreePath: activeThreadWorktreePath,
    });
    if (
      settledCwd === storeServerTerminalLaunchContext.cwd &&
      activeThreadWorktreePath === storeServerTerminalLaunchContext.worktreePath
    ) {
      if (activeThreadRef) {
        storeClearTerminalLaunchContext(activeThreadRef);
      }
    }
  });

  return null;
}

function TerminalLaunchClosedSync({
  activeThreadId,
  activeThreadRef,
  setTerminalLaunchContext,
  storeClearTerminalLaunchContext,
  terminalOpen,
}: {
  activeThreadId: ThreadId | null;
  activeThreadRef: ScopedThreadRef | null;
  setTerminalLaunchContext: Dispatch<SetStateAction<TerminalLaunchContext | null>>;
  storeClearTerminalLaunchContext: (threadRef: ScopedThreadRef) => void;
  terminalOpen: boolean;
}) {
  useMountEffect(() => {
    if (terminalOpen) {
      return;
    }
    if (activeThreadRef) {
      storeClearTerminalLaunchContext(activeThreadRef);
    }
    setTerminalLaunchContext((current) => (current?.threadId === activeThreadId ? null : current));
  });

  return null;
}

function TerminalOpenFocusSync({
  activeThreadKey,
  focusComposer,
  setTerminalFocusRequestId,
  terminalOpen,
  terminalOpenByThreadRef,
}: {
  activeThreadKey: string | null;
  focusComposer: () => void;
  setTerminalFocusRequestId: Dispatch<SetStateAction<number>>;
  terminalOpen: boolean;
  terminalOpenByThreadRef: RefObject<Record<string, boolean>>;
}) {
  useMountEffect(() => {
    if (!activeThreadKey) return;
    const previous = terminalOpenByThreadRef.current[activeThreadKey] ?? false;
    const current = terminalOpen;

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
  });

  return null;
}

function ChatViewKeyboardShortcutsSync({
  activeProjectScripts,
  activeThreadId,
  closeTerminal,
  createNewTerminal,
  keybindings,
  onToggleDiff,
  runProjectScript,
  setTerminalOpen,
  splitTerminal,
  terminalActiveTerminalId,
  terminalOpen,
  toggleTerminalVisibility,
}: {
  activeProjectScripts: readonly ProjectScript[] | null;
  activeThreadId: ThreadId | null;
  closeTerminal: (terminalId: string) => void;
  createNewTerminal: () => void;
  keybindings: ResolvedKeybindingsConfig;
  onToggleDiff: () => void;
  runProjectScript: (script: ProjectScript) => void | Promise<void>;
  setTerminalOpen: (open: boolean) => void;
  splitTerminal: () => void;
  terminalActiveTerminalId: string;
  terminalOpen: boolean;
  toggleTerminalVisibility: () => void;
}) {
  useMountEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => {
      if (!activeThreadId || useCommandPaletteStore.getState().open || event.defaultPrevented) {
        return;
      }
      const shortcutContext = {
        terminalFocus: isTerminalFocused(),
        terminalOpen,
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
        if (!terminalOpen) {
          setTerminalOpen(true);
        }
        splitTerminal();
        return;
      }

      if (command === "terminal.close") {
        event.preventDefault();
        event.stopPropagation();
        if (!terminalOpen) return;
        closeTerminal(terminalActiveTerminalId);
        return;
      }

      if (command === "terminal.new") {
        event.preventDefault();
        event.stopPropagation();
        if (!terminalOpen) {
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
      if (!scriptId || !activeProjectScripts) return;
      const script = activeProjectScripts.find((entry) => entry.id === scriptId);
      if (!script) return;
      event.preventDefault();
      event.stopPropagation();
      void runProjectScript(script);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  return null;
}

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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const rawSearch = useSearch({
    strict: false,
    select: (params) => parseDiffRouteSearch(params),
  });
  const { resolvedTheme } = useTheme();
  // Granular store selectors — avoid subscribing to prompt changes.
  const composerInteractionMode = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.interactionMode ?? null,
  );
  const composerActiveProvider = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.activeProvider ?? null,
  );
  const setComposerDraftPrompt = useComposerDraftStore((store) => store.setPrompt);
  const addComposerDraftImages = useComposerDraftStore((store) => store.addImages);
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
  const gitAgentActionHandoff = useGitAgentActionHandoff();
  const subagentPreviewOpen = useSubagentPreviewStore((state) => state.preview !== null);
  const closeSubagentPreview = useSubagentPreviewStore((state) => state.closePreview);
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
            settings.textGenerationModelSelection ?? fallbackDraftProject?.defaultModelSelection,
            localDraftError,
          )
        : undefined,
    [
      draftThread,
      fallbackDraftProject?.defaultModelSelection,
      localDraftError,
      settings.textGenerationModelSelection,
      threadId,
    ],
  );
  const isServerThread = routeKind === "server" && serverThread !== undefined;
  const activeThread = isServerThread ? serverThread : localDraftThread;
  const runtimeMode = settings.defaultRuntimeMode;
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
  const latestTurnSettled = isLatestTurnSettled(activeLatestTurn, activeThread?.session ?? null);
  const activeProjectRef = activeThread
    ? activeThread.projectId === null
      ? null
      : scopeProjectRef(activeThread.environmentId, activeThread.projectId)
    : null;
  const activeProject = useStore(
    useMemo(() => createProjectSelectorByRef(activeProjectRef), [activeProjectRef]),
  );
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
        runtimeMode: settings.defaultRuntimeMode,
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
      settings.defaultRuntimeMode,
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

  const selectedProviderByThreadId = composerActiveProvider ?? null;
  const threadProvider =
    activeThread?.modelSelection.instanceId ??
    activeProject?.defaultModelSelection?.instanceId ??
    null;
  const primaryServerConfig = useServerConfig();
  const providerStatuses = primaryServerConfig?.providers ?? EMPTY_PROVIDERS;
  const selectedProviderInstanceId =
    selectedProviderByThreadId ?? threadProvider ?? ProviderInstanceId.make("codex");
  const phase = derivePhase(activeThread?.session ?? null);
  const threadActivities = activeThread?.activities ?? EMPTY_ACTIVITIES;
  const activeEntryId = activeThread?.activeEntryId ?? null;
  const branchViewEntryId = containsThreadEntry(activeThread ?? null, activeEntryId)
    ? activeEntryId
    : null;
  const branchView = useMemo(
    () => deriveThreadBranchView(activeThread ?? null, branchViewEntryId),
    [activeThread, branchViewEntryId],
  );
  const visibleThreadActivities = useMemo(
    () => filterActivitiesToBranch(threadActivities, branchView),
    [branchView, threadActivities],
  );
  const activeRunningTurnId =
    activeThread?.session?.orchestrationStatus === "running"
      ? (activeThread.session.activeTurnId ?? activeLatestTurn?.turnId ?? null)
      : null;
  const workLogEntries = useMemo(
    () =>
      deriveWorkLogEntries(visibleThreadActivities, undefined, {
        activeRunningTurnId,
      }),
    [activeRunningTurnId, visibleThreadActivities],
  );
  const pendingApprovals = useMemo(
    () =>
      latestTurnSettled
        ? EMPTY_PENDING_APPROVALS
        : derivePendingApprovals(threadActivities, activeLatestTurn?.turnId ?? null),
    [activeLatestTurn?.turnId, latestTurnSettled, threadActivities],
  );
  const pendingUserInputs = useMemo(
    () =>
      latestTurnSettled
        ? EMPTY_PENDING_USER_INPUTS
        : derivePendingUserInputs(threadActivities, activeLatestTurn?.turnId ?? null),
    [activeLatestTurn?.turnId, latestTurnSettled, threadActivities],
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
  const activeWorkbenchTab = useActiveTab();
  const rightWorkbenchOpen = useRightOpen();
  const rightWorkbenchMuted = useIsMuted();
  const planSurfaceOpen =
    activeWorkbenchTab === "plan" && rightWorkbenchOpen && !rightWorkbenchMuted;
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
  const isWorking = phase === "running" || isSendBusy || isConnecting || isRevertingCheckpoint;
  const queuedComposerItems = useComposerQueueStore(
    (store) => store.queueItemsByThreadKey[routeThreadKey] ?? EMPTY_QUEUED_COMPOSER_ITEMS,
  );
  const editingQueuedComposerItemId = useComposerQueueStore(
    (store) => store.editingQueueItemIdByThreadKey[routeThreadKey] ?? null,
  );
  const queuedComposerItemsExpanded = useComposerQueueStore(
    (store) => store.queueExpandedByThreadKey[routeThreadKey] ?? true,
  );
  const enqueueComposerItem = useComposerQueueStore((store) => store.enqueueComposerItem);
  const removeQueuedComposerItem = useComposerQueueStore((store) => store.removeQueuedComposerItem);
  const takeQueuedComposerItem = useComposerQueueStore((store) => store.takeQueuedComposerItem);
  const reorderQueuedComposerItem = useComposerQueueStore(
    (store) => store.reorderQueuedComposerItem,
  );
  const setQueueExpanded = useComposerQueueStore((store) => store.setQueueExpanded);
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
  const allServerMessages = activeThread?.messages ?? [];
  const serverMessages = useMemo(
    () => filterMessagesToBranch(allServerMessages, branchView),
    [allServerMessages, branchView],
  );
  const {
    attachmentPreviewHandoffSync,
    applyAttachmentPreviewHandoff,
    clearAttachmentPreviewHandoffs,
    handoffAttachmentPreviews,
  } = useAttachmentPreviewHandoff({ serverMessages });
  const timelineMessages = useMemo(() => {
    const serverMessagesWithPreviewHandoff = applyAttachmentPreviewHandoff(serverMessages);

    const pendingGitAgentMessage =
      gitAgentActionHandoff?.target.environmentId === environmentId &&
      gitAgentActionHandoff.target.threadId === threadId
        ? gitAgentActionHandoff.optimisticMessage
        : null;
    const optimisticMessages =
      pendingGitAgentMessage === null
        ? optimisticUserMessages
        : [...optimisticUserMessages, pendingGitAgentMessage];

    if (optimisticMessages.length === 0) {
      return serverMessagesWithPreviewHandoff;
    }
    const serverIds = new Set(serverMessagesWithPreviewHandoff.map((message) => message.id));
    const pendingMessages = optimisticMessages.filter((message) => !serverIds.has(message.id));
    if (pendingMessages.length === 0) {
      return serverMessagesWithPreviewHandoff;
    }
    return [...serverMessagesWithPreviewHandoff, ...pendingMessages];
  }, [
    applyAttachmentPreviewHandoff,
    environmentId,
    gitAgentActionHandoff,
    optimisticUserMessages,
    serverMessages,
    threadId,
  ]);
  const activeEditingUserMessageId =
    editingUserMessageId &&
    timelineMessages.some(
      (message) => message.id === editingUserMessageId && message.role === "user",
    )
      ? editingUserMessageId
      : null;
  const timelineEntries = useMemo(
    () => deriveTimelineEntries(timelineMessages, EMPTY_TIMELINE_PROPOSED_PLANS, workLogEntries),
    [timelineMessages, workLogEntries],
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
      if (!isServerThread || !activeThread) {
        return;
      }
      const msg = activeThread.messages.find(
        (entry) => entry.id === messageId && entry.role === "user",
      );
      if (!msg) {
        return;
      }

      clearComposerDraftContent(editComposerDraftTarget);
      setComposerDraftPrompt(editComposerDraftTarget, msg.text);
      setEditingUserMessageId(messageId);
    },
    [
      clearComposerDraftContent,
      activeThread,
      editComposerDraftTarget,
      isServerThread,
      setComposerDraftPrompt,
    ],
  );

  const onCancelEditUserMessage = useCallback(
    (messageId: MessageId) => {
      setEditingUserMessageId((current) => (current === messageId ? null : current));
      clearComposerDraftContent(editComposerDraftTarget);
    },
    [clearComposerDraftContent, editComposerDraftTarget],
  );

  const gitCwd = activeProject
    ? projectScriptCwd({
        project: { cwd: activeProject.cwd },
        worktreePath: activeThread?.worktreePath ?? null,
      })
    : null;
  const gitStatusQuery = useGitStatus({ environmentId, cwd: gitCwd });
  const checkoutBranchMutation = useMutation(
    gitCheckoutMutationOptions({ environmentId, cwd: gitCwd, queryClient }),
  );
  const keybindings = useServerKeybindings();
  const availableEditors = useServerAvailableEditors();
  const activeProviderStatus = useMemo(
    () =>
      resolveAppProviderModelState({
        settings,
        providers: providerStatuses,
        requestedInstanceId: selectedProviderInstanceId,
      }).selectedProviderEntry?.snapshot ?? null,
    [providerStatuses, selectedProviderInstanceId, settings],
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
        rememberAsLastInvoked?: boolean;
      },
    ) => {
      const api = readWorkbenchTerminalApi(environmentId);
      if (!api || !activeThreadId || !activeProject || !activeThread) return;
      if (options?.rememberAsLastInvoked !== false) {
        setLastInvokedScriptByProjectId((current) => {
          if (current[activeProject.id] === script.id) return current;
          return { ...current, [activeProject.id]: script.id };
        });
      }
      const targetCwd = options?.cwd ?? gitCwd ?? activeProject.cwd;
      const terminalThreadId = workbenchTerminalThreadId(targetCwd);
      const terminalId = readTerminalSessions(targetCwd).activeId;
      const terminalWorktreePath = options?.worktreePath ?? activeThread.worktreePath ?? null;

      const runtimeEnv = projectScriptRuntimeEnv({
        project: {
          cwd: activeProject.cwd,
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
        shellPanelsActions.setActiveTab("terminal");
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
    },
    [
      activeProject,
      activeThread,
      activeThreadId,
      gitCwd,
      setThreadError,
      setLastInvokedScriptByProjectId,
      environmentId,
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
    handleInteractionModeChange(nextComposerInteractionMode(interactionMode));
  }, [handleInteractionModeChange, interactionMode]);
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

  const closeExpandedImage = useCallback(() => {
    setExpandedImage(null);
  }, []);

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
  const showBranchToolbar =
    isLocalDraftThread && activeProjectCwd !== null && activeThreadWorktreePath === null;

  const handleBranchEnvModeChange = useCallback(
    (mode: DraftThreadEnvMode, branch: string | null) => {
      const nextBranch = mode === "worktree" ? (branch ?? activeThreadBranch) : activeThreadBranch;
      if (!isLocalDraftThread || !draftId) {
        return;
      }
      setDraftThreadContext(draftId, {
        envMode: mode,
        branch: nextBranch,
        worktreePath: activeThreadWorktreePath,
      });
    },
    [
      activeThreadBranch,
      activeThreadWorktreePath,
      draftId,
      isLocalDraftThread,
      setDraftThreadContext,
    ],
  );

  const handleBranchSelect = useCallback(
    async (branch: GitBranch) => {
      if (!activeProjectCwd) {
        return;
      }
      const reuseExistingWorktree = Boolean(branch.worktreePath);
      const nextWorktreePath =
        branch.worktreePath && branch.worktreePath !== activeProjectCwd
          ? branch.worktreePath
          : null;
      const nextEnvMode: DraftThreadEnvMode = nextWorktreePath
        ? "worktree"
        : envMode === "worktree"
          ? "worktree"
          : "local";

      try {
        if (nextEnvMode === "local" && !reuseExistingWorktree) {
          await checkoutBranchMutation.mutateAsync(branch.name);
        }
      } catch (error) {
        toastManager.add({
          type: "error",
          title: `Could not checkout ${branch.name}`,
          description: formatGitActionErrorDescription(error, "Git checkout failed."),
        });
        return;
      }

      if (isLocalDraftThread && draftId) {
        setDraftThreadContext(draftId, {
          branch: branch.name,
          worktreePath: nextWorktreePath,
          envMode: nextEnvMode,
        });
      }
    },
    [
      activeProjectCwd,
      checkoutBranchMutation,
      draftId,
      envMode,
      isLocalDraftThread,
      setDraftThreadContext,
    ],
  );

  const openPullRequestBranchDialog = useCallback((reference: string) => {
    setPullRequestDialogState({
      initialReference: reference,
      key: Date.now(),
    });
  }, []);

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
        images: composerImages,
        selectedModel: ctxSelectedModel,
        selectedModelSelection: ctxSelectedModelSelection,
      } = input.sendContext;
      const compiledTurn = compileComposerSubmitTurn(input.sendContext);
      const { hasSendableContent } = compiledTurn;
      const originalMessage = timelineMessages.find(
        (message) => message.id === messageId && message.role === "user",
      );
      const originalEntry = findThreadMessageEntry(activeThread, messageId);
      const branchEditParentEntryId = originalEntry?.parentEntryId ?? null;
      const branchEditAvailable = originalEntry !== null;
      const unchanged =
        originalMessage?.text === compiledTurn.trimmedPrompt && composerImages.length === 0;
      if (!hasSendableContent || !originalMessage || unchanged) {
        return false;
      }

      const revertTurn = revertTurnCountByUserMessageId.get(messageId);
      if (!branchEditAvailable && typeof revertTurn !== "number") {
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
      const turnAttachmentsPromise = prepareComposerTurnAttachments(composerImagesSnapshot);
      const optimisticAttachments = compiledTurn.optimisticAttachments;
      let turnStartSucceeded = false;
      let optimisticMessageAdded = false;

      sendInFlightRef.current = true;
      try {
        if (!branchEditAvailable) {
          if (typeof revertTurn !== "number") {
            return false;
          }
          const reverted = await revertThreadToTurnCountSilent(revertTurn);
          if (!reverted) {
            return false;
          }
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
            text: compiledTurn.outgoingMessageText,
            ...(optimisticAttachments.length > 0 ? { attachments: optimisticAttachments } : {}),
            createdAt: messageCreatedAt,
            streaming: false,
          },
        ]);
        optimisticMessageAdded = true;
        setThreadError(threadIdForSend, null);

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
            text: compiledTurn.outgoingMessageText,
            attachments: turnAttachments,
          },
          modelSelection: ctxSelectedModelSelection,
          titleSeed: activeThread.title,
          runtimeMode: input.runtimeMode,
          interactionMode: input.interactionMode,
          ...(branchEditAvailable ? { parentEntryId: branchEditParentEntryId } : {}),
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
      images: composerImages,
      selectedModel: ctxSelectedModel,
      selectedModelSelection: ctxSelectedModelSelection,
    } = sendCtx;
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
    const messageIdForSend = snapshot.messageId ?? newMessageId();
    const messageCreatedAt = snapshot.createdAt ?? new Date().toISOString();
    const turnAttachmentsPromise = prepareComposerTurnAttachments(composerImagesSnapshot);
    const optimisticAttachments = compiledTurn.optimisticAttachments;
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
        text: compiledTurn.outgoingMessageText,
        ...(optimisticAttachments.length > 0 ? { attachments: optimisticAttachments } : {}),
        createdAt: messageCreatedAt,
        streaming: false,
      },
    ]);

    setThreadError(threadIdForSend, null);
    if (clearComposerOnSubmit) {
      promptRef.current = "";
      clearComposerDraftContent(composerDraftTarget);
      composerRef.current?.resetCursorState();
    }

    let navigatedOptimistically = false;

    let turnStartSucceeded = false;
    await (async () => {
      const title = compiledTurn.title;
      const threadCreateModelSelection = ctxSelectedModelSelection;

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
          text: compiledTurn.outgoingMessageText,
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
        composerImagesRef.current.length === 0
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
    const currentComposerSendState = deriveComposerSendState({
      prompt: sendContext.prompt,
      imageCount: sendContext.images.length,
    });
    const hasPlanFeedbackText = sendContext.prompt.trim().length > 0;
    const hasOnlyBlankPlanFollowUp = !currentComposerSendState.hasSendableContent;
    const planFollowUp =
      showPlanFollowUpPrompt &&
      activeProposedPlan &&
      activeThread &&
      (hasPlanFeedbackText || hasOnlyBlankPlanFollowUp)
        ? {
            planMarkdown: activeProposedPlan.planMarkdown,
            planId: activeProposedPlan.id,
            planThreadId: activeThread.id,
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
        runtimeMode: existingQueuedItem?.runtimeMode ?? runtimeMode,
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
          runtimeMode,
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
      runtimeMode,
      interactionMode,
      planFollowUp,
      clearComposerOnSubmit: true,
    });
  };

  const onBuildActiveProposedPlan = () => {
    if (
      !showPlanFollowUpPrompt ||
      !activeProposedPlan ||
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
      runtimeMode,
      interactionMode,
      planFollowUp: { planMarkdown: activeProposedPlan.planMarkdown },
      clearComposerOnSubmit: true,
    });
  };

  const onInterrupt = useCallback(async () => {
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
  }, [activeRunningTurnId, activeThread, environmentId]);

  const loadQueuedComposerItemIntoComposer = (item: QueuedComposerItem) => {
    const imagesForEdit = item.sendContext.images.map(cloneComposerImageForRetry);
    promptRef.current = item.sendContext.prompt;
    composerImagesRef.current = imagesForEdit;
    clearComposerDraftContent(composerDraftTarget);
    setComposerDraftPrompt(composerDraftTarget, item.sendContext.prompt);
    addComposerDraftImages(composerDraftTarget, imagesForEdit);
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
      if (!api || !activeThreadId) {
        return;
      }

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

  const onAdvanceActivePendingUserInput = useCallback(
    (draftAnswersOverride?: Record<string, PendingUserInputDraftAnswer>) => {
      if (!activePendingUserInput) {
        return;
      }

      const draftAnswers = draftAnswersOverride ?? activePendingDraftAnswers;
      const progress = derivePendingUserInputProgress(
        activePendingUserInput.questions,
        draftAnswers,
        activePendingQuestionIndex,
      );

      if (!progress.canAdvance) {
        return;
      }
      if (progress.isLastQuestion) {
        const resolvedAnswers = buildPendingUserInputAnswers(
          activePendingUserInput.questions,
          draftAnswers,
        );
        if (resolvedAnswers) {
          void onRespondToUserInput(activePendingUserInput.requestId, resolvedAnswers);
        }
        return;
      }

      setActivePendingUserInputQuestionIndex(progress.questionIndex + 1);
    },
    [
      activePendingDraftAnswers,
      activePendingQuestionIndex,
      activePendingUserInput,
      onRespondToUserInput,
      setActivePendingUserInputQuestionIndex,
    ],
  );

  const onSelectActivePendingUserInputOption = useCallback(
    (questionId: string, optionLabel: string, advanceAfterSelect = false) => {
      if (!activePendingUserInput) {
        return;
      }
      const question = activePendingUserInput.questions.find((entry) => entry.id === questionId);
      if (!question) {
        return;
      }

      const requestDraftAnswers =
        pendingUserInputAnswersByRequestId[activePendingUserInput.requestId] ?? {};
      const nextRequestDraftAnswers = {
        ...requestDraftAnswers,
        [questionId]: togglePendingUserInputOptionSelection(
          question,
          requestDraftAnswers[questionId],
          optionLabel,
        ),
      };
      setPendingUserInputAnswersByRequestId((existing) => {
        return {
          ...existing,
          [activePendingUserInput.requestId]: nextRequestDraftAnswers,
        };
      });
      promptRef.current = "";
      composerRef.current?.resetCursorState({ cursor: 0 });

      if (advanceAfterSelect) {
        onAdvanceActivePendingUserInput(nextRequestDraftAnswers);
      }
    },
    [
      activePendingUserInput,
      composerRef,
      onAdvanceActivePendingUserInput,
      pendingUserInputAnswersByRequestId,
    ],
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
        // step-tracking activities that the workbench Plan/Tasks tab will display.
        if (nextInteractionMode === "default") {
          shellPanelsActions.activatePlanTab();
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

  const onProviderModelSelect = useCallback(
    (selection: ModelSelection) => {
      if (!activeThread && routeKind !== "draft") return;
      setComposerDraftModelSelection(composerDraftTarget, selection);
      setStickyComposerModelSelection(selection);
      scheduleComposerFocus();
    },
    [
      composerDraftTarget,
      routeKind,
      scheduleComposerFocus,
      setComposerDraftModelSelection,
      setStickyComposerModelSelection,
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
          onInterrupt={onInterrupt}
          setThreadError={setThreadError}
          onExpandImage={onExpandTimelineImage}
          onCancelEditUserMessage={onCancelEditUserMessage}
          onSubmitEditUserMessage={onSubmitEditUserMessage}
        />
      );
    },
    [
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
      onInterrupt,
      onSubmitEditUserMessage,
      phase,
      providerStatuses,
      resolvedTheme,
      routeKind,
      routeThreadRef,
      runtimeMode,
      settings,
      setThreadError,
      terminalState.terminalOpen,
      threadActivities,
    ],
  );
  const isHeroComposer = activeThread
    ? isLocalDraftThread && !threadHasStarted(activeThread)
    : false;
  const activeTimelineCacheKey = activeThread
    ? `${activeThread.id}:${branchView.entryId ?? "linear"}`
    : "";
  const existingOpenTerminalThreadKeysKey = existingOpenTerminalThreadKeys.join("\0");
  const markThreadVisitedVersion = useValueIdentityVersion(markThreadVisited);
  const focusComposerVersion = useValueIdentityVersion(focusComposer);
  const serverMessagesVersion = useValueIdentityVersion(activeThread?.messages);
  const handoffAttachmentPreviewsVersion = useValueIdentityVersion(handoffAttachmentPreviews);
  const clearAttachmentPreviewHandoffsVersion = useValueIdentityVersion(
    clearAttachmentPreviewHandoffs,
  );
  const resetLocalDispatchVersion = useValueIdentityVersion(resetLocalDispatch);
  const routeThreadRefVersion = useValueIdentityVersion(routeThreadRef);
  const storeClearTerminalLaunchContextVersion = useValueIdentityVersion(
    storeClearTerminalLaunchContext,
  );
  const activeThreadRefVersion = useValueIdentityVersion(activeThreadRef);
  const storeServerTerminalLaunchContextVersion = useValueIdentityVersion(
    storeServerTerminalLaunchContext,
  );
  const closeTerminalVersion = useValueIdentityVersion(closeTerminal);
  const createNewTerminalVersion = useValueIdentityVersion(createNewTerminal);
  const setTerminalOpenVersion = useValueIdentityVersion(setTerminalOpen);
  const runProjectScriptVersion = useValueIdentityVersion(runProjectScript);
  const splitTerminalVersion = useValueIdentityVersion(splitTerminal);
  const keybindingsVersion = useValueIdentityVersion(keybindings);
  const onToggleDiffVersion = useValueIdentityVersion(onToggleDiff);
  const toggleTerminalVisibilityVersion = useValueIdentityVersion(toggleTerminalVisibility);
  const activeProjectScriptsVersion = useValueIdentityVersion(activeProject?.scripts ?? null);
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
          markThreadVisitedVersion,
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
      <OptimisticUserMessagesUnmountCleanup optimisticUserMessagesRef={optimisticUserMessagesRef} />
      <ActiveThreadUiResetSync
        key={activeThread?.id ?? ""}
        isAtBottomRef={isAtBottomRef}
        setPullRequestDialogState={setPullRequestDialogState}
        setShowScrollToBottom={setShowScrollToBottom}
        showScrollDebouncer={showScrollDebouncer}
      />
      <BooleanResetSync
        key={`revert:${activeThread?.id ?? ""}`}
        setValue={setIsRevertingCheckpoint}
        value={false}
      />
      <ActiveThreadComposerFocusSync
        key={[activeThread?.id ?? "", focusComposerVersion, terminalState.terminalOpen].join("\0")}
        activeThreadId={activeThread?.id ?? null}
        focusComposer={focusComposer}
        terminalOpen={Boolean(terminalState.terminalOpen)}
      />
      <OptimisticUserMessagesServerAckSync
        key={[
          activeThread?.id ?? "",
          handoffAttachmentPreviewsVersion,
          optimisticUserMessages.length,
          serverMessagesVersion,
        ].join("\0")}
        activeThreadId={activeThread?.id ?? null}
        handoffAttachmentPreviews={handoffAttachmentPreviews}
        optimisticUserMessages={optimisticUserMessages}
        serverMessages={activeThread?.messages}
        setOptimisticUserMessages={setOptimisticUserMessages}
      />
      <ThreadDraftResetSync
        key={[
          clearAttachmentPreviewHandoffsVersion,
          draftId ?? "",
          resetLocalDispatchVersion,
          threadId,
        ].join("\0")}
        clearAttachmentPreviewHandoffs={clearAttachmentPreviewHandoffs}
        resetLocalDispatch={resetLocalDispatch}
        setExpandedImage={setExpandedImage}
        setOptimisticUserMessages={setOptimisticUserMessages}
      />
      <TerminalLaunchActiveThreadSync
        key={[
          activeThreadId ?? "",
          routeThreadRefVersion,
          storeClearTerminalLaunchContextVersion,
        ].join("\0")}
        activeThreadId={activeThreadId}
        routeThreadRef={routeThreadRef}
        setTerminalLaunchContext={setTerminalLaunchContext}
        storeClearTerminalLaunchContext={storeClearTerminalLaunchContext}
      />
      <TerminalLaunchLocalSettledSync
        key={[
          activeProjectCwd ?? "",
          activeThreadId ?? "",
          activeThreadRefVersion,
          activeThreadWorktreePath ?? "",
          storeClearTerminalLaunchContextVersion,
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
          activeThreadRefVersion,
          activeThreadWorktreePath ?? "",
          storeClearTerminalLaunchContextVersion,
          storeServerTerminalLaunchContextVersion,
        ].join("\0")}
        activeProjectCwd={activeProjectCwd}
        activeThreadId={activeThreadId}
        activeThreadRef={activeThreadRef}
        activeThreadWorktreePath={activeThreadWorktreePath}
        storeClearTerminalLaunchContext={storeClearTerminalLaunchContext}
        storeServerTerminalLaunchContext={storeServerTerminalLaunchContext}
      />
      <TerminalLaunchClosedSync
        key={[
          activeThreadId ?? "",
          activeThreadRefVersion,
          storeClearTerminalLaunchContextVersion,
          terminalState.terminalOpen,
        ].join("\0")}
        activeThreadId={activeThreadId}
        activeThreadRef={activeThreadRef}
        setTerminalLaunchContext={setTerminalLaunchContext}
        storeClearTerminalLaunchContext={storeClearTerminalLaunchContext}
        terminalOpen={Boolean(terminalState.terminalOpen)}
      />
      <TerminalOpenFocusSync
        key={[activeThreadKey ?? "", focusComposerVersion, terminalState.terminalOpen].join("\0")}
        activeThreadKey={activeThreadKey}
        focusComposer={focusComposer}
        setTerminalFocusRequestId={setTerminalFocusRequestId}
        terminalOpen={Boolean(terminalState.terminalOpen)}
        terminalOpenByThreadRef={terminalOpenByThreadRef}
      />
      <ChatViewKeyboardShortcutsSync
        key={[
          activeProjectScriptsVersion,
          activeThreadId ?? "",
          closeTerminalVersion,
          createNewTerminalVersion,
          keybindingsVersion,
          onToggleDiffVersion,
          runProjectScriptVersion,
          setTerminalOpenVersion,
          splitTerminalVersion,
          terminalState.activeTerminalId,
          terminalState.terminalOpen,
          toggleTerminalVisibilityVersion,
        ].join("\0")}
        activeProjectScripts={activeProject?.scripts ?? null}
        activeThreadId={activeThreadId}
        closeTerminal={closeTerminal}
        createNewTerminal={createNewTerminal}
        keybindings={keybindings}
        onToggleDiff={onToggleDiff}
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
      <header
        className={cn(
          "agent-window-chat-header pointer-events-none box-border flex h-(--multi-workbench-chrome-row-height) select-none items-center px-(--multi-workbench-chrome-padding-inline)",
          isElectron &&
            reserveTitleBarControlInset &&
            "wco:pr-[calc(100vw-env(titlebar-area-width)-env(titlebar-area-x)+1em)]",
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
            <div
              className="relative flex min-h-0 flex-1 flex-col"
              data-subagent-conversation-shell=""
              data-subagent-preview-open={subagentPreviewOpen ? "" : undefined}
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
                  activeTurnInProgress={isWorking || !latestTurnSettled}
                  editUserMessagesDisabled={isWorking}
                  activeTurnStartedAt={activeWorkStartedAt}
                  bottomClearancePx={DOCKED_COMPOSER_TIMELINE_RESERVE_PX}
                  timelineControllerRef={messagesTimelineControllerRef}
                  timelineEntries={timelineEntries}
                  activeThreadId={activeThread.id}
                  timelineCacheKey={activeTimelineCacheKey}
                  activeThreadEnvironmentId={activeThread.environmentId}
                  revertTurnCountByUserMessageId={revertTurnCountByUserMessageId}
                  onImageExpand={onExpandTimelineImage}
                  markdownCwd={gitCwd ?? undefined}
                  projectRoot={activeProjectRoot}
                  isServerThread={isServerThread}
                  editingUserMessageId={activeEditingUserMessageId}
                  onBeginEditUserMessage={onBeginEditUserMessage}
                  renderEditComposer={renderEditComposer}
                  awaitingServerThreadDetail={isServerThread && !serverThreadDetailLoaded}
                  onIsAtBottomChange={onIsAtBottomChange}
                />

                {showScrollToBottom && (
                  <div className="pointer-events-none absolute bottom-[calc(var(--multi-composer-compact-shell-min-height)_+_1.25rem)] left-1/2 z-30 flex -translate-x-1/2 justify-center py-1.5">
                    <button
                      type="button"
                      onClick={() => scrollTimelineToBottom(true)}
                      className="pointer-events-auto inline-flex size-7 min-h-7 min-w-7 shrink-0 cursor-(--multi-button-cursor) appearance-none items-center justify-center rounded-full border border-multi-stroke-tertiary bg-(--multi-chat-bubble-background)! p-0 text-multi-icon-secondary shadow-none transition-[background-color,border-color] duration-150 ease-out hover:border-multi-stroke-secondary hover:bg-(--multi-chat-bubble-background)! active:border-multi-stroke-secondary active:bg-(--multi-chat-bubble-background)! focus-visible:border-multi-stroke-secondary focus-visible:bg-(--multi-chat-bubble-background)!"
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
              {subagentPreviewOpen ? (
                <button
                  type="button"
                  data-subagent-preview-click-capture=""
                  aria-label="Close subagent preview"
                  onClick={closeSubagentPreview}
                />
              ) : null}
            </div>
          )}

          {/* Input bar — centered when hero, docked when active thread */}
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
                ? "absolute bottom-0 left-0 right-0 isolate z-30 pointer-events-auto before:pointer-events-none before:absolute before:bottom-[-12px] before:left-1/2 before:top-1/2 before:z-0 before:-ml-[50vw] before:w-screen before:bg-(--multi-chat-surface-background) after:pointer-events-none after:absolute after:bottom-1/2 after:left-1/2 after:z-0 after:-ml-[50vw] after:h-6 after:w-screen after:bg-[linear-gradient(to_top,var(--multi-chat-surface-background),transparent)] [&>*]:relative [&>*]:z-1"
                : undefined,
            )}
            data-layout={isHeroComposer ? "wide" : undefined}
            {...(isConnecting ? { "data-disabled": "true" } : {})}
            {...(showScrollToBottom ? {} : { "data-scrolled-to-bottom": "" })}
          >
            {showBranchToolbar ? (
              <BranchToolbar
                environmentId={environmentId}
                cwd={gitCwd}
                workspaceName={activeProject?.name ?? "Workspace"}
                workspacePath={activeProjectCwd ?? ""}
                envMode={envMode}
                activeWorktreePath={activeWorktreePath}
                activeThreadBranch={activeThreadBranch}
                currentGitBranch={currentGitBranch}
                hasLocalChanges={gitStatusQuery.data?.hasWorkingTreeChanges ?? false}
                isGitRepo={isGitRepo}
                canChangeEnvMode={true}
                disabled={isConnecting || isSendBusy}
                onEnvModeChange={handleBranchEnvModeChange}
                onBranchSelect={handleBranchSelect}
                onCheckoutPullRequest={openPullRequestBranchDialog}
              />
            ) : null}
            <ComposerInput
              ref={composerRef}
              variant={isHeroComposer ? "expanded" : "compact"}
              layout={isHeroComposer ? "new-agent" : "thread"}
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
              onSend={onSend}
              onInterrupt={onInterrupt}
              onBuildPlan={onBuildActiveProposedPlan}
              onViewPlan={shellPanelsActions.activatePlanTab}
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
