import { scopedThreadKey, scopeThreadRef } from "~/lib/environment-scope";
import {
  type EditorId,
  type EnvironmentId,
  type MessageId,
  type AgentInteractionMode,
  type OrchestrationThreadActivity,
  type SourceProposedPlanReference,
  type ThreadId,
} from "@honk/contracts";
import type { TimestampFormat } from "@honk/contracts/settings";
import { useMutation } from "@tanstack/react-query";
import { Outlet, useRouter } from "@tanstack/react-router";
import {
  type ComponentType,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import {
  IconBranch,
  IconBrowserTabs,
  IconCode,
  IconConsole,
  IconFileText,
  IconSquareChecklist,
} from "central-icons";

import { openChatIndex, openThread } from "~/app/chat-navigation";
import { toastManager } from "~/app/toast";
import { useCommandPaletteStore } from "~/stores/ui/command-palette-store";
import { isElectron } from "~/env";
import { formatGitActionErrorDescription } from "~/git/action-error-description";
import { useEnvironmentGitPanel } from "~/hooks/use-environment-git";
import { useHandleNewThread } from "~/hooks/use-handle-new-thread";
import { useRouteThreadId } from "~/hooks/use-route-thread-id";
import { readEnvironmentGitApi } from "~/lib/environment-git-api";
import { refreshGitStatus, useGitStatus } from "~/lib/git-status-state";
import { useServerAvailableEditors, useServerConfig } from "~/rpc/server-state";
import { useComposerDraftStore } from "~/stores/chat-drafts";
import { readEnvironmentApi } from "~/environment-api";
import { readHonkRuntimeApi } from "~/lib/honk-runtime-api";
import { prepareRuntimeTurnPolicy } from "~/lib/runtime-turn-dispatch";
import { inferLoginShellCaption } from "~/lib/shell-caption";
import { coordinateTurnSend, dispatchTurnStartFailure } from "~/lib/turn-send-coordinator";
import { resolveProjectlessCwd } from "~/lib/project-state";
import {
  findWorkspaceProjectByRef,
  findWorkspaceProjectForSource,
  isSourceForWorkspaceProject,
  resolveWorkspaceTarget,
} from "~/lib/workspace-target";
import {
  GIT_AGENT_ACTIONS,
  resolveGitAgentActionFromPrompt,
  resolvePendingGitAgentAction,
  type GitAgentAction,
  type GitAgentRun,
} from "~/lib/git-agent-actions";
import type { GitAgentActionHandoff } from "~/lib/git-agent-action-handoff";
import {
  readTerminalSessions,
  shellPanelsActions,
  useSecondaryRail,
  useTerminalSessions,
} from "~/stores/shell-panels-store";
import {
  useWorkbenchTabSnapshot,
  workbenchTabPersistenceActions,
  type WorkbenchManagedTab,
  type WorkbenchTabIconKey,
  type WorkbenchTabSnapshotRuntimeInput,
} from "~/stores/workbench-tab-store";
import {
  buildPlanImplementationPrompt,
  normalizePlanMarkdownForExport,
} from "~/plan/proposed-plan";
import { cn, newCommandId, newMessageId, newThreadId } from "~/lib/utils";
import { useSettings } from "~/hooks/use-settings";
import {
  deriveActivePlanState,
  findSidebarProposedPlan,
  hasActionableProposedPlan,
  isLatestTurnSettled,
  type ActivePlanState,
  type LatestProposedPlanState,
} from "~/session-logic";
import {
  selectProjectsAcrossEnvironments,
  selectThreadByRef,
  selectSidebarThreadsAcrossEnvironments,
  selectBootstrapCompleteForActiveEnvironment,
  useStore,
} from "~/stores/thread-store";
import {
  applyLocalThreadCreated,
  applyLocalThreadTurnStartRequested,
} from "~/stores/local-orchestration-events";
import { useAgentRuntimeStore } from "~/stores/agent-runtime-store";
import {
  selectThreadGitAgentSurfaceByRef,
  selectThreadPlanSurfaceAcrossEnvironments,
  selectThreadPlanSurfaceByRef,
  type ThreadGitAgentSurface,
  type ThreadPlanSurface,
} from "~/stores/thread-selectors";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE } from "~/types";
import type { Thread } from "~/types";
import { sidebarSelectionIdForChatRoute, useChatRouteTarget } from "~/app/chat-route-state";
import { GitPanel } from "./shell/git/panel";
import { ProjectFilesPanel } from "./shell/files/panel";
import { ProjectCenterEditorSurface } from "./shell/files/project-center-editor-surface";
import {
  AppShell,
  type RightWorkbenchDefinition,
  useRightWorkbenchPanelRuntime,
} from "./shell/shell/app";
import type { WorkbenchTabMeta } from "./shell/shell/right-workbench-header";
import { RightWorkbenchLayout } from "./shell/shell/right-workbench-layout";
import { WorkbenchPanel } from "./shell/shell/workbench-panel";
import { PlanWorkbenchPanel } from "./shell/plan/plan-workbench-panel";
import { ShellSettingsProvider } from "./shell/settings/context";
import { SettingsNavRail } from "./shell/settings/nav-rail";
import { ShellSidebarFooter } from "./shell/sidebar/footer";
import { ShellSidebarHeader } from "./shell/sidebar/header";
import { AgentSidebar } from "./shell/agents/agent-sidebar";
import { useAgentSidebarModel } from "./shell/agents/sidebar/use-agent-sidebar-model";
import { BrowserPanel } from "./shell/browser/panel";
import { DevWorkbenchPanel } from "./shell/dev/dev-workbench-panel";
import { TerminalPanel } from "./shell/terminal/panel";
import { TerminalRail } from "./shell/terminal/terminal-rail";
import {
  readWorkbenchTerminalApi,
  workbenchTerminalThreadId,
} from "./shell/terminal/workbench-terminal";
import {
  forgetWorkbenchTerminalRunning,
  useWorkbenchTerminalRunning,
} from "./shell/terminal/use-workbench-terminal-running";
import { useWorkspaceEditorFileState } from "~/stores/workspace-editor-store";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@honk/honkkit/alert-dialog";
import { Button } from "@honk/honkkit/button";
import { TerminalWorkbenchSubChrome } from "./shell/terminal/workbench-subchrome";

const WORKBENCH_TAB_ICONS: Record<
  WorkbenchTabIconKey,
  ComponentType<{ className?: string | undefined }>
> = {
  plan: IconSquareChecklist,
  dev: IconCode,
  changes: IconBranch,
  terminal: IconConsole,
  file: IconFileText,
  browser: IconBrowserTabs,
};

function toWorkbenchTabMeta(tab: WorkbenchManagedTab): WorkbenchTabMeta {
  return {
    ...tab,
    icon: WORKBENCH_TAB_ICONS[tab.iconKey],
  };
}

async function sendRuntimeShellTurn(input: {
  threadId: ThreadId;
  environmentId: EnvironmentId;
  threadKey: string;
  cwd: string;
  text: string;
  interactionMode: AgentInteractionMode;
  sourceProposedPlan: SourceProposedPlanReference | null;
  clientMessageId: MessageId;
  modelSelection: Thread["modelSelection"];
  titleSeed: string;
  createdAt: string;
  api: NonNullable<ReturnType<typeof readEnvironmentApi>>;
}): Promise<void> {
  const preparedPolicy = prepareRuntimeTurnPolicy({
    interactionMode: input.interactionMode,
    modelSelection: input.modelSelection,
  });
  const result = await coordinateTurnSend({
    environmentId: input.environmentId,
    threadKey: input.threadKey,
    threadId: input.threadId,
    clientMessageId: input.clientMessageId,
    createdAt: input.createdAt,
    message: {
      text: input.text,
      optimisticAttachments: [],
      getTurnAttachments: async () => [],
    },
    modelSelection: input.modelSelection,
    titleSeed: input.titleSeed,
    interactionMode: input.interactionMode,
    sourceProposedPlan: input.sourceProposedPlan,
    cwd: input.cwd,
    preparedPolicy,
    api: input.api,
    appendSendIntent: false,
    startRuntimeBeforePersistence: true,
  });

  if (result.serverPersistenceError) {
    throw result.serverPersistenceError;
  }

  if (!result.runtimeSendSucceeded && result.serverTurnStartSucceeded) {
    await dispatchTurnStartFailure({
      api: input.api,
      threadId: input.threadId,
      messageId: input.clientMessageId,
      detail: "Failed to start runtime turn.",
    });
    throw new Error("Failed to start runtime turn.");
  }
}

function hasGitAgentStartFailure(thread: ThreadGitAgentSurface, action: GitAgentAction): boolean {
  const latestUserMessage = thread.latestUserMessage;
  if (!latestUserMessage || resolveGitAgentActionFromPrompt(latestUserMessage.text) !== action) {
    return false;
  }
  return thread.startFailureActivities.some(
    (activity) =>
      activity.kind === "runtime.turn.start.failed" &&
      activity.createdAt >= latestUserMessage.createdAt,
  );
}

function hasGitAgentActionMessage(
  thread: ThreadGitAgentSurface,
  handoff: GitAgentActionHandoff,
): boolean {
  return thread.userMessageIds.includes(handoff.messageId);
}

function resolveActiveGitAgentHandoff(input: {
  activeRun: GitAgentRun | null;
  activeThread: ThreadGitAgentSurface | null;
  mutationIsPending: boolean;
  orchestrationHandoff: GitAgentActionHandoff | null;
}): GitAgentActionHandoff | null {
  if (input.activeRun !== null || input.orchestrationHandoff === null) {
    return null;
  }

  if (input.mutationIsPending) {
    return input.orchestrationHandoff;
  }

  const activeThread = input.activeThread;
  if (
    activeThread === null ||
    activeThread.environmentId !== input.orchestrationHandoff.target.environmentId ||
    activeThread.id !== input.orchestrationHandoff.target.threadId
  ) {
    return input.orchestrationHandoff;
  }

  const orchestrationStatus = activeThread.session?.orchestrationStatus ?? null;
  if (orchestrationStatus === "starting" || orchestrationStatus === "running") {
    return input.orchestrationHandoff;
  }

  const latestTurnState = activeThread.latestTurn?.state ?? null;
  if (
    latestTurnState === "completed" ||
    latestTurnState === "interrupted" ||
    latestTurnState === "error" ||
    hasGitAgentStartFailure(activeThread, input.orchestrationHandoff.action)
  ) {
    return hasGitAgentActionMessage(activeThread, input.orchestrationHandoff)
      ? null
      : input.orchestrationHandoff;
  }

  return input.orchestrationHandoff;
}

const EMPTY_PLAN_ACTIVITIES: readonly OrchestrationThreadActivity[] = [];

type PlanWorkbenchLabel = "Plan" | "Tasks";

interface PlanWorkbenchState {
  available: boolean;
  activePlan: ActivePlanState | null;
  activeProposedPlan: LatestProposedPlanState | null;
  label: PlanWorkbenchLabel;
  environmentId: EnvironmentId | null;
  markdownCwd: string | undefined;
  timestampFormat: TimestampFormat;
  canImplementPlan: boolean;
  isImplementingPlan: boolean;
  onImplementPlan: (() => void) | undefined;
  onSaveProposedPlan: ((nextMarkdown: string) => Promise<boolean>) | undefined;
}

export function ShellHost(props: { children?: ReactNode; mode: "chat" | "settings" }) {
  return (
    <ShellSettingsProvider>
      {props.mode === "settings" ? (
        <SettingsShellHost>{props.children}</SettingsShellHost>
      ) : (
        <ChatShellHost>{props.children}</ChatShellHost>
      )}
    </ShellSettingsProvider>
  );
}

function SettingsShellHost(props: { children?: ReactNode }) {
  const router = useRouter();
  const firstProjectCwd = useStore(
    (store) => selectProjectsAcrossEnvironments(store)[0]?.cwd ?? null,
  );
  const backToChat = () => {
    void openChatIndex(router);
  };

  const settingsLeft = (
    <div className="thread-rail-pad relative flex min-h-0 flex-1 flex-col px-0">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-(--honk-shell-sidebar-content-top-offset,var(--honk-electron-traffic-padding-top))"
        aria-hidden="true"
      />
      <SettingsNavRail onBack={backToChat} />
      <ShellSidebarFooter settings onToggleSettings={backToChat} />
    </div>
  );

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
      <AppShell
        cwd={firstProjectCwd}
        left={settingsLeft}
        center={props.children ?? <Outlet />}
        centerSurface="editor"
        centerRouteKind="settings"
        right={null}
      />
    </div>
  );
}

function ChatShellHost(props: { children?: ReactNode }) {
  const router = useRouter();
  const openAddProject = useCommandPaletteStore((store) => store.openAddProject);
  const routeThreadId = useRouteThreadId();
  const routeTarget = useChatRouteTarget();
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const sidebarThreads = useStore(useShallow(selectSidebarThreadsAcrossEnvironments));
  const sidebarBootstrapComplete = useStore((state) =>
    selectBootstrapCompleteForActiveEnvironment(state),
  );
  const storeActiveEnvironmentId = useStore((state) => state.activeEnvironmentId);
  const clearUnconfirmedLocalTurnStart = useStore((store) => store.clearUnconfirmedLocalTurnStart);
  const clearUnconfirmedLocalThread = useStore((store) => store.clearUnconfirmedLocalThread);
  const availableEditors = useServerAvailableEditors();
  const firstProjectCwd = projects[0]?.cwd ?? null;
  const markDraftThreadPromoting = useComposerDraftStore((store) => store.markDraftThreadPromoting);
  const cancelDraftThreadPromotion = useComposerDraftStore(
    (store) => store.cancelDraftThreadPromotion,
  );
  const {
    activeDraftThread,
    activeThread: routeActiveThread,
    selectedProjectCwd,
    selectedProjectEnvironmentId,
    selectedLogicalProjectKey,
    selectedProjectRef,
    handleNewThread,
  } = useHandleNewThread();
  const settings = useSettings();
  const threadEnvMode = settings.defaultThreadEnvMode;

  const routeSelectedId = sidebarSelectionIdForChatRoute(routeTarget);
  const [clickedSidebarId, setClickedSidebarId] = useState<string | null>(null);
  const selectedId = clickedSidebarId ?? routeSelectedId;

  useEffect(() => {
    if (clickedSidebarId !== null && clickedSidebarId === routeSelectedId) {
      setClickedSidebarId(null);
    }
  }, [clickedSidebarId, routeSelectedId]);

  const routeThreadRef = routeTarget?.kind === "server" ? routeTarget.threadRef : null;
  const activeThread = routeActiveThread ?? null;
  const activeFullThread = useStore(
    useShallow((store) => selectThreadByRef(store, routeThreadRef) ?? null),
  );
  const activePlanThread = useStore(
    useShallow((store) => selectThreadPlanSurfaceByRef(store, routeThreadRef) ?? null),
  );
  const activeGitAgentThread = useStore(
    useShallow((store) => selectThreadGitAgentSurfaceByRef(store, routeThreadRef) ?? null),
  );
  const markLocalRuntimeThread = useAgentRuntimeStore((store) => store.markLocalRuntimeThread);
  const clearLocalRuntimeThread = useAgentRuntimeStore((store) => store.clearLocalRuntimeThread);
  const gitAgentActionInFlightRef = useRef(false);

  const activeGitAgentRun = (() => {
    if (!activeGitAgentThread) {
      return null;
    }
    const status = activeGitAgentThread.session?.orchestrationStatus ?? null;
    if (status !== "starting" && status !== "running") {
      return null;
    }
    const latestUserMessage = activeGitAgentThread.latestUserMessage;
    const action = latestUserMessage
      ? resolveGitAgentActionFromPrompt(latestUserMessage.text)
      : null;
    if (!action) {
      return null;
    }
    return {
      action,
      target: {
        environmentId: activeGitAgentThread.environmentId,
        threadId: activeGitAgentThread.id,
      },
    };
  })();
  const [gitAgentOrchestrationHandoff, setGitAgentOrchestrationHandoff] =
    useState<GitAgentActionHandoff | null>(null);
  const serverConfig = useServerConfig();
  const projectlessCwd = resolveProjectlessCwd(serverConfig?.cwd);
  const selectedProject = selectedProjectRef
    ? findWorkspaceProjectByRef(projects, selectedProjectRef)
    : null;
  const workspaceSource = activeThread ?? activeDraftThread ?? null;
  const workspaceTarget = resolveWorkspaceTarget({
    source: workspaceSource,
    defaultProject: selectedProject,
    defaultProjectCwd: selectedProjectCwd,
    defaultProjectEnvironmentId: selectedProjectEnvironmentId,
    defaultProjectRef: selectedProjectRef,
    projects,
    projectlessCwd,
    fallbackEnvironmentId: storeActiveEnvironmentId,
  });
  const activeCwd = workspaceTarget.cwd;
  const activeRpcEnvironmentId = workspaceTarget.rpcEnvironmentId;

  const activeProject = activeThread
    ? (findWorkspaceProjectForSource(projects, activeThread) ?? workspaceTarget.project)
    : workspaceTarget.project;
  const activeLatestTurn = activeThread?.latestTurn ?? null;
  const latestTurnSettled = isLatestTurnSettled(activeLatestTurn, activeThread?.session ?? null);
  const sourceProposedPlanThreadId =
    activeLatestTurn?.sourceProposedPlan?.threadId &&
    activeLatestTurn.sourceProposedPlan.threadId !== activeThread?.id
      ? activeLatestTurn.sourceProposedPlan.threadId
      : null;
  const sourceProposedPlanThread = useStore(
    useShallow(
      (store) =>
        selectThreadPlanSurfaceAcrossEnvironments(store, sourceProposedPlanThreadId) ?? null,
    ),
  );
  const planThreads = (() => {
    const threads: Array<Pick<ThreadPlanSurface, "id" | "proposedPlans">> = [];
    if (activePlanThread) {
      threads.push(activePlanThread);
    }
    if (sourceProposedPlanThread && sourceProposedPlanThread.id !== activePlanThread?.id) {
      threads.push(sourceProposedPlanThread);
    }
    return threads;
  })();
  const activePlan = deriveActivePlanState(
    activePlanThread?.planActivities ?? EMPTY_PLAN_ACTIVITIES,
    activeLatestTurn?.turnId ?? undefined,
  );
  const activeProposedPlan = findSidebarProposedPlan({
    threads: planThreads,
    latestTurn: activeLatestTurn,
    latestTurnSettled,
    threadId: activeThread?.id ?? null,
  });
  const activeProposedPlanSourceThreadId =
    activeProposedPlan && activeThread
      ? activeLatestTurn?.sourceProposedPlan?.planId === activeProposedPlan.id
        ? activeLatestTurn.sourceProposedPlan.threadId
        : activeThread.id
      : null;
  const activeTurnRunning =
    activeThread?.session?.orchestrationStatus === "starting" ||
    activeThread?.session?.orchestrationStatus === "running";
  const showPlanImplementationActions = hasActionableProposedPlan(activeProposedPlan);
  const canImplementPlan =
    showPlanImplementationActions &&
    activeThread !== null &&
    activeProposedPlanSourceThreadId !== null &&
    latestTurnSettled &&
    !activeTurnRunning;
  const [isImplementingPlan, setIsImplementingPlan] = useState(false);
  const startPlanImplementation = async () => {
    if (
      !activeThread ||
      !activeProposedPlan ||
      !activeProposedPlanSourceThreadId ||
      !canImplementPlan ||
      isImplementingPlan
    ) {
      return;
    }

    const cwd = activeThread.worktreePath ?? activeProject?.cwd ?? activeCwd;
    if (!cwd) {
      toast.error("Pi runtime requires an active project before sending.");
      return;
    }

    const planMarkdown = activeProposedPlan.planMarkdown;
    const messageText = buildPlanImplementationPrompt(planMarkdown);
    const api = readEnvironmentApi(activeThread.environmentId);
    if (!api) {
      toast.error("Environment API unavailable.");
      return;
    }

    setIsImplementingPlan(true);
    try {
      const clientMessageId = newMessageId();
      const createdAt = new Date().toISOString();
      await sendRuntimeShellTurn({
        threadId: activeThread.id,
        environmentId: activeThread.environmentId,
        threadKey: scopedThreadKey(scopeThreadRef(activeThread.environmentId, activeThread.id)),
        cwd,
        text: messageText,
        interactionMode: "agent",
        sourceProposedPlan: {
          threadId: activeProposedPlanSourceThreadId,
          planId: activeProposedPlan.id,
        },
        clientMessageId,
        modelSelection: activeThread.modelSelection,
        titleSeed: activeThread.title,
        createdAt,
        api,
      });
      workbenchTabPersistenceActions.activatePlan(workspaceTarget.workspaceKey);
    } catch (error) {
      toast.error("Could not implement plan.", {
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    } finally {
      setIsImplementingPlan(false);
    }
  };
  const onSaveProposedPlan = async (nextMarkdown: string): Promise<boolean> => {
    if (
      !activeProposedPlan ||
      !activeProposedPlanSourceThreadId ||
      !activeThread ||
      routeTarget?.kind !== "server"
    ) {
      return false;
    }

    const normalizedMarkdown = normalizePlanMarkdownForExport(nextMarkdown);
    if (normalizedMarkdown.trim().length === 0) {
      return false;
    }
    if (normalizedMarkdown === activeProposedPlan.planMarkdown) {
      return true;
    }

    const api = readEnvironmentApi(activeThread.environmentId);
    if (!api) {
      return false;
    }

    try {
      await api.orchestration.dispatchCommand({
        type: "thread.proposed-plan.update",
        commandId: newCommandId(),
        threadId: activeProposedPlanSourceThreadId,
        planId: activeProposedPlan.id,
        planMarkdown: normalizedMarkdown,
        createdAt: new Date().toISOString(),
      });
      return true;
    } catch (error) {
      toast.error("Could not save plan.", {
        description: error instanceof Error ? error.message : "An error occurred.",
      });
      return false;
    }
  };
  const planAvailable = activePlan !== null || activeProposedPlan !== null;
  const planLabel: PlanWorkbenchLabel = activeProposedPlan ? "Plan" : "Tasks";
  const planWorkbench: PlanWorkbenchState = {
    available: planAvailable,
    activePlan,
    activeProposedPlan,
    label: planLabel,
    environmentId: activeThread?.environmentId ?? activeRpcEnvironmentId,
    markdownCwd: activeCwd ?? undefined,
    timestampFormat: settings.timestampFormat,
    canImplementPlan,
    isImplementingPlan,
    onImplementPlan: showPlanImplementationActions
      ? () => {
          void startPlanImplementation();
        }
      : undefined,
    onSaveProposedPlan: activeProposedPlan ? onSaveProposedPlan : undefined,
  };
  const sidebarLoading = !sidebarBootstrapComplete && sidebarThreads.length === 0;
  const sidebarModel = useAgentSidebarModel({
    activeCwd: workspaceTarget.projectCwd ?? activeCwd,
    activeDraftThread,
    selectedProjectCwd,
    selectedLogicalProjectKey,
    selectedProjectRef,
    threadEnvMode,
    handleNewThread,
    projectlessCwd,
    projects,
    routeActiveThread: routeActiveThread ?? null,
    selectedId: routeSelectedId,
    sidebarThreads,
  });
  const selectSidebarAgent = useCallback(
    (id: string) => {
      flushSync(() => {
        setClickedSidebarId(id);
      });
      sidebarModel.select(id);
    },
    [sidebarModel.select],
  );

  const startGitAgentAction = async (action: GitAgentAction) => {
    if (gitAgentActionInFlightRef.current || activeGitAgentRun !== null) {
      throw new Error("Wait for the current Git action to finish before starting another one.");
    }
    const routeServerThreadFallback =
      routeTarget?.kind === "server" &&
      activeThread?.environmentId === routeTarget.threadRef.environmentId &&
      activeThread.id === routeTarget.threadRef.threadId
        ? activeThread
        : null;
    const currentServerThread =
      routeTarget?.kind === "server"
        ? (activeFullThread ?? routeActiveThread ?? routeServerThreadFallback)
        : null;
    const currentDraftThread = routeTarget?.kind === "draft" ? activeDraftThread : null;

    if (routeTarget?.kind === "server" && !currentServerThread) {
      throw new Error("Current thread is unavailable.");
    }
    if (routeTarget?.kind === "draft" && !currentDraftThread) {
      throw new Error("Current draft is unavailable.");
    }

    const currentServerProject = findWorkspaceProjectForSource(projects, currentServerThread);
    const currentDraftProject = findWorkspaceProjectForSource(projects, currentDraftThread);
    const activeCwdProject = workspaceTarget.project;
    const project =
      currentServerProject ??
      currentDraftProject ??
      activeCwdProject ??
      selectedProject ??
      projects[0];

    if (!project) {
      throw new Error("No project is available for this Git action.");
    }

    if (
      currentServerThread &&
      !isSourceForWorkspaceProject({
        project,
        projects,
        source: currentServerThread,
      })
    ) {
      throw new Error("Open this repository's thread before running the Git action.");
    }
    if (
      currentDraftThread &&
      !isSourceForWorkspaceProject({
        project,
        projects,
        source: currentDraftThread,
      })
    ) {
      throw new Error("Open this repository's draft before running the Git action.");
    }

    const currentThreadStatus = currentServerThread?.session?.orchestrationStatus ?? null;
    if (currentThreadStatus === "starting" || currentThreadStatus === "running") {
      throw new Error("Wait for the current turn to finish before running this Git action.");
    }

    const api = readEnvironmentApi(project.environmentId);
    if (!api) {
      throw new Error("Environment API unavailable.");
    }

    const modelSelection =
      currentServerThread?.modelSelection ??
      project.defaultModelSelection ??
      settings.textGenerationModelSelection;

    const createdAt = new Date().toISOString();
    const actionDetails = GIT_AGENT_ACTIONS[action];
    const title = actionDetails.label;
    const prompt = actionDetails.prompt;
    const messageId = newMessageId();
    const runtimeMode = DEFAULT_RUNTIME_MODE;
    const interactionMode =
      currentServerThread?.interactionMode ??
      currentDraftThread?.interactionMode ??
      DEFAULT_INTERACTION_MODE;
    const threadId = currentServerThread?.id ?? currentDraftThread?.threadId ?? newThreadId();
    const targetThreadEnvironmentId = currentServerThread?.environmentId ?? project.environmentId;
    const projectScopedBranch = currentServerThread?.branch ?? currentDraftThread?.branch ?? null;
    const projectScopedWorktreePath =
      currentServerThread?.worktreePath ?? currentDraftThread?.worktreePath ?? null;
    const promotedDraftId = routeTarget?.kind === "draft" ? routeTarget.draftId : null;
    let draftPromotionMarked = false;
    let localThreadAnnounced = false;
    let localTurnStartAnnounced = false;
    let serverTurnStartSucceeded = false;
    const threadKey = scopedThreadKey(scopeThreadRef(targetThreadEnvironmentId, threadId));
    const preparedPolicy = prepareRuntimeTurnPolicy({ interactionMode, modelSelection });

    const applyLocalBootstrapThread = () => {
      if (currentServerThread || localThreadAnnounced) {
        return;
      }
      applyLocalThreadCreated({
        environmentId: targetThreadEnvironmentId,
        threadId,
        projectId: project.id,
        title,
        modelSelection,
        runtimeMode,
        interactionMode,
        branch: projectScopedBranch,
        worktreePath: projectScopedWorktreePath,
        createdAt: currentDraftThread?.createdAt ?? createdAt,
      });
      localThreadAnnounced = true;
    };
    const applyLocalTurnStartRequest = () => {
      if (localTurnStartAnnounced) {
        return;
      }
      applyLocalThreadTurnStartRequested({
        environmentId: targetThreadEnvironmentId,
        threadId,
        message: {
          messageId,
          text: prompt,
          attachments: [],
        },
        modelSelection,
        titleSeed: title,
        runtimeMode,
        interactionMode,
        createdAt,
      });
      localTurnStartAnnounced = true;
    };

    gitAgentActionInFlightRef.current = true;
    try {
      setGitAgentOrchestrationHandoff({
        action,
        target: { environmentId: targetThreadEnvironmentId, threadId },
        messageId,
      });
      if (promotedDraftId) {
        markDraftThreadPromoting(
          promotedDraftId,
          scopeThreadRef(targetThreadEnvironmentId, threadId),
          title,
        );
        draftPromotionMarked = true;
      }

      applyLocalBootstrapThread();
      applyLocalTurnStartRequest();

      const turnResult = await coordinateTurnSend({
        environmentId: targetThreadEnvironmentId,
        threadKey,
        threadId,
        clientMessageId: messageId,
        createdAt,
        message: {
          text: prompt,
          optimisticAttachments: [],
          getTurnAttachments: async () => [],
        },
        modelSelection,
        titleSeed: title,
        runtimeMode,
        interactionMode,
        sourceProposedPlan: null,
        ...(!currentServerThread
          ? {
              bootstrap: {
                createThread: {
                  projectId: project.id,
                  title,
                  modelSelection,
                  runtimeMode,
                  interactionMode,
                  branch: projectScopedBranch,
                  worktreePath: projectScopedWorktreePath,
                  createdAt: currentDraftThread?.createdAt ?? createdAt,
                },
              },
            }
          : {}),
        cwd: projectScopedWorktreePath ?? project.cwd,
        preparedPolicy,
        api,
        appendSendIntent: false,
        applyLocalTurnStart: false,
        startRuntimeBeforePersistence: false,
        // Claim the runtime overlay as the first runtime frame is dispatched (after the
        // server turn start), not after this whole await chain, so the timeline honors the
        // runtime display timeline immediately and the git action does not flash a waiting row.
        onBeforeRuntimeSend: () => {
          markLocalRuntimeThread(threadId);
        },
      });
      serverTurnStartSucceeded = turnResult.serverTurnStartSucceeded;
      if (turnResult.serverPersistenceError) {
        throw turnResult.serverPersistenceError;
      }
      if (!turnResult.runtimeSendSucceeded && turnResult.serverTurnStartSucceeded) {
        throw new Error("Failed to start Git action.");
      }

      await openThread(router, scopeThreadRef(targetThreadEnvironmentId, threadId));
    } catch (error) {
      clearLocalRuntimeThread(threadId);
      if (serverTurnStartSucceeded) {
        await dispatchTurnStartFailure({
          api,
          threadId,
          messageId,
          detail:
            error instanceof Error && error.message.trim().length > 0
              ? error.message
              : "Failed to start Git action.",
        });
      }
      setGitAgentOrchestrationHandoff(null);
      if (localTurnStartAnnounced && !serverTurnStartSucceeded) {
        clearUnconfirmedLocalTurnStart({
          environmentId: targetThreadEnvironmentId,
          threadId,
          messageId,
        });
      }
      if (localThreadAnnounced && !serverTurnStartSucceeded) {
        clearUnconfirmedLocalThread({
          environmentId: targetThreadEnvironmentId,
          threadId,
        });
      }
      if (draftPromotionMarked && promotedDraftId) {
        cancelDraftThreadPromotion(promotedDraftId);
      }
      throw error;
    } finally {
      gitAgentActionInFlightRef.current = false;
    }
  };
  const gitAgentActionMutation = useMutation({
    mutationKey: [
      "git",
      "agent-action",
      activeRpcEnvironmentId ?? null,
      activeCwd ?? null,
    ] as const,
    mutationFn: startGitAgentAction,
    onError: (error) => {
      setGitAgentOrchestrationHandoff(null);
      toastManager.add({
        type: "error",
        title: "Failed to start Git action",
        description: formatGitActionErrorDescription(error, "Failed to start Git action."),
      });
    },
  });
  const activeGitAgentHandoff = resolveActiveGitAgentHandoff({
    activeRun: activeGitAgentRun,
    activeThread: activeGitAgentThread,
    mutationIsPending: gitAgentActionMutation.isPending,
    orchestrationHandoff: gitAgentOrchestrationHandoff,
  });
  const stopGitAgentActionMutation = useMutation({
    mutationKey: [
      "git",
      "agent-action",
      "stop",
      activeGitAgentRun?.target.environmentId ??
        activeGitAgentHandoff?.target.environmentId ??
        null,
      activeGitAgentRun?.target.threadId ?? activeGitAgentHandoff?.target.threadId ?? null,
    ] as const,
    onMutate: () => {
      setGitAgentOrchestrationHandoff(null);
    },
    mutationFn: async (target: GitAgentRun["target"]) => {
      await readHonkRuntimeApi().abort({ threadId: target.threadId });
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "Failed to stop Git action",
        description: formatGitActionErrorDescription(error, "Failed to stop Git action."),
      });
    },
    onSettled: () => {
      setGitAgentOrchestrationHandoff(null);
    },
  });
  const pendingGitAgentAction = resolvePendingGitAgentAction({
    activeRun: activeGitAgentRun,
    mutationIsPending: gitAgentActionMutation.isPending,
    mutationVariables: gitAgentActionMutation.variables,
    orchestrationHandoff: activeGitAgentHandoff,
  });
  const runGitAgentAction = useCallback(
    (action: GitAgentAction) => gitAgentActionMutation.mutate(action),
    [gitAgentActionMutation.mutate],
  );
  const gitAgentStopTarget = activeGitAgentRun?.target ?? activeGitAgentHandoff?.target ?? null;
  const stopGitAgentActionHandler = useCallback(() => {
    if (!gitAgentStopTarget) {
      return;
    }
    stopGitAgentActionMutation.mutate(gitAgentStopTarget);
  }, [
    gitAgentStopTarget?.environmentId,
    gitAgentStopTarget?.threadId,
    stopGitAgentActionMutation.mutate,
  ]);
  const stopGitAgentAction = gitAgentStopTarget ? stopGitAgentActionHandler : null;
  const stoppingGitAgentAction =
    stopGitAgentActionMutation.isPending && pendingGitAgentAction !== null;
  const center = props.children ?? <Outlet />;

  const chatLeft = (
    <div className="thread-rail-pad relative flex min-h-0 flex-1 flex-col px-0">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-(--honk-shell-sidebar-content-top-offset,var(--honk-electron-traffic-padding-top))"
        aria-hidden="true"
      />
      <div className={cn("shrink-0", isElectron && "no-drag")}>
        <ShellSidebarHeader onNewChat={sidebarModel.create} />
      </div>
      <AgentSidebar
        loading={sidebarLoading}
        error={false}
        sections={sidebarModel.sections}
        selectedId={selectedId}
        onSelectAgent={selectSidebarAgent}
        onPrefetchAgent={sidebarModel.prefetchAgent}
        onNewAgent={sidebarModel.create}
        onOpenWorkspace={openAddProject}
      />
      <ShellSidebarFooter />
    </div>
  );

  return (
    <ChatWorkbenchShellHost
      left={chatLeft}
      center={center}
      routeKind={routeTarget?.kind ?? null}
      routeThreadId={routeThreadId}
      cwd={activeCwd}
      workspaceKey={workspaceTarget.workspaceKey}
      environmentId={activeRpcEnvironmentId}
      availableEditors={availableEditors}
      thread={activeFullThread}
      threadId={activeThread?.id ?? activeDraftThread?.threadId ?? null}
      threadTitle={activeThread?.title ?? activeDraftThread?.promotedTitle ?? null}
      plan={planWorkbench}
      onGitAgentAction={runGitAgentAction}
      onStopGitAgentAction={stopGitAgentAction}
      stoppingGitAgentAction={stoppingGitAgentAction}
      pendingGitAgentAction={pendingGitAgentAction}
    />
  );
}

function TerminalWorkbenchPanel(props: {
  cwd: string | null;
  workspaceKey: string | null;
  environmentId: EnvironmentId | null;
  onActivateTerminal: (terminalId: string) => void;
  onCloseTerminal: (terminalId: string) => void;
  terminalId?: string | undefined;
}) {
  const terminalState = useTerminalSessions(props.workspaceKey);
  const { open: terminalRailOpen } = useSecondaryRail(props.workspaceKey, "terminal");
  const activeTerminalId = props.terminalId ?? terminalState.activeId;

  return (
    <WorkbenchPanel className="overflow-hidden">
      <TerminalWorkbenchSubChrome
        railOpen={terminalRailOpen}
        onToggleRail={() => shellPanelsActions.toggleSecondaryRail(props.workspaceKey, "terminal")}
        shellCaption={inferLoginShellCaption()}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <RightWorkbenchLayout
          workspaceKey={props.workspaceKey}
          tab="terminal"
          railHostClassName="bg-transparent"
          rail={
            <TerminalRail
              sessions={terminalState.sessions}
              activeId={activeTerminalId}
              onActivate={props.onActivateTerminal}
              onClose={props.onCloseTerminal}
            />
          }
        >
          <TerminalPanel
            cwd={props.cwd}
            workspaceKey={props.workspaceKey}
            environmentId={props.environmentId}
            terminalId={activeTerminalId}
          />
        </RightWorkbenchLayout>
      </div>
    </WorkbenchPanel>
  );
}

function GitWorkbenchPanel(props: {
  cwd: string | null;
  workspaceKey: string | null;
  environmentId: EnvironmentId | null;
  onAgentAction: (action: GitAgentAction) => void;
  onStopAgentAction: (() => void) | null;
  stoppingAgentAction: boolean;
  pendingAgentAction: GitAgentAction | null;
}) {
  const runtime = useRightWorkbenchPanelRuntime();
  const active = runtime.open && runtime.activeTab === "git";
  const git = useEnvironmentGitPanel(props.environmentId, props.cwd, { enabled: active });
  const previousPendingAgentActionRef = useRef<GitAgentAction | null>(props.pendingAgentAction);

  useEffect(() => {
    const previousPendingAgentAction = previousPendingAgentActionRef.current;
    previousPendingAgentActionRef.current = props.pendingAgentAction;

    if (previousPendingAgentAction !== null && props.pendingAgentAction === null) {
      void git.refresh().catch(() => undefined);
    }
  }, [git, props.pendingAgentAction]);

  return (
    <WorkbenchPanel>
      {git.lifecycleSync}
      <GitPanel
        git={git}
        workspaceKey={props.workspaceKey}
        onAgentAction={props.onAgentAction}
        onStopAgentAction={props.onStopAgentAction}
        stoppingAgentAction={props.stoppingAgentAction}
        pendingAgentAction={props.pendingAgentAction}
      />
    </WorkbenchPanel>
  );
}

function GitStatusSync(props: { cwd: string | null; environmentId: EnvironmentId | null }) {
  const status = useGitStatus({
    environmentId: props.environmentId,
    cwd: props.cwd,
  });
  const hasStatusData = status.data !== null;

  useEffect(() => {
    if (!props.cwd || !props.environmentId) {
      return;
    }
    const gitApi = readEnvironmentGitApi(props.environmentId);
    if (!gitApi) {
      return;
    }
    void refreshGitStatus({ environmentId: props.environmentId, cwd: props.cwd }, gitApi, {
      force: !hasStatusData,
    }).catch(() => undefined);
  }, [props.cwd, props.environmentId, hasStatusData]);

  return null;
}

function ChatWorkbenchShellHost(props: {
  left: ReactNode;
  center: ReactNode;
  routeKind: "draft" | "server" | null;
  routeThreadId: string | null;
  cwd: string | null;
  workspaceKey: string;
  environmentId: EnvironmentId | null;
  availableEditors: readonly EditorId[];
  thread: Thread | null;
  threadId: ThreadId | null;
  threadTitle: string | null;
  plan: PlanWorkbenchState;
  onGitAgentAction: (action: GitAgentAction) => void;
  onStopGitAgentAction: (() => void) | null;
  stoppingGitAgentAction: boolean;
  pendingGitAgentAction: GitAgentAction | null;
}) {
  const planTabAvailable = props.plan.available && props.plan.environmentId !== null;
  const terminalState = useTerminalSessions(props.workspaceKey);
  const terminalThreadKey = props.workspaceKey ?? props.cwd;
  const terminalThreadId = terminalThreadKey ? workbenchTerminalThreadId(terminalThreadKey) : null;
  const runningTerminalIds = useWorkbenchTerminalRunning(terminalThreadId, props.environmentId);
  const [pendingCloseTerminalId, setPendingCloseTerminalId] = useState<string | null>(null);
  const workbenchTabRuntime = useMemo<WorkbenchTabSnapshotRuntimeInput>(
    () => ({
      plan: { available: planTabAvailable, label: props.plan.label },
      terminal: terminalState,
    }),
    [planTabAvailable, props.plan.label, terminalState],
  );
  const tabSnapshot = useWorkbenchTabSnapshot(props.workspaceKey, workbenchTabRuntime);
  const editorState = useWorkspaceEditorFileState(props.workspaceKey);
  const centerEditorActive = editorState.placement === "center" && editorState.activePath !== null;
  const workbenchTabs: WorkbenchTabMeta[] = useMemo(
    () => tabSnapshot.tabs.map(toWorkbenchTabMeta),
    [tabSnapshot.tabs],
  );
  const activateTerminalSession = useCallback(
    (terminalId: string) => {
      const session = terminalState.sessions.find((entry) => entry.id === terminalId);
      workbenchTabPersistenceActions.createTerminal(props.workspaceKey, {
        id: terminalId,
        label: session?.label ?? inferLoginShellCaption(),
      });
    },
    [props.workspaceKey, terminalState.sessions],
  );
  const closeTerminalSession = useCallback(
    (terminalId: string) => {
      const previousTerminalState = readTerminalSessions(props.workspaceKey);
      const wasActive = previousTerminalState.activeId === terminalId;
      const api = readWorkbenchTerminalApi(props.environmentId);
      if (api && terminalThreadId) {
        void api
          .close({ threadId: terminalThreadId, terminalId, deleteHistory: true })
          .catch(() => undefined);
        forgetWorkbenchTerminalRunning(terminalThreadId, props.environmentId, terminalId);
      }
      shellPanelsActions.removeTerminalSession(props.workspaceKey, terminalId);
      if (!wasActive) return;
      const nextTerminalState = readTerminalSessions(props.workspaceKey);
      if (nextTerminalState.activeId !== terminalId) {
        workbenchTabPersistenceActions.activateTerminal(
          props.workspaceKey,
          nextTerminalState.activeId,
        );
      }
    },
    [props.environmentId, props.workspaceKey, terminalThreadId],
  );
  const requestCloseTerminalSession = useCallback(
    (terminalId: string) => {
      if (runningTerminalIds.has(terminalId)) {
        setPendingCloseTerminalId(terminalId);
        return;
      }
      closeTerminalSession(terminalId);
    },
    [closeTerminalSession, runningTerminalIds],
  );
  const pendingCloseLabel = pendingCloseTerminalId
    ? (terminalState.sessions.find((session) => session.id === pendingCloseTerminalId)?.label ??
      inferLoginShellCaption())
    : inferLoginShellCaption();

  const right: RightWorkbenchDefinition = useMemo(() => {
    const renderers: RightWorkbenchDefinition["renderers"] = {
      files: {
        alwaysMounted: true,
        render: () => (
          <WorkbenchPanel>
            <ProjectFilesPanel
              cwd={props.cwd}
              workspaceKey={props.workspaceKey}
              environmentId={props.environmentId}
              availableEditors={props.availableEditors}
            />
          </WorkbenchPanel>
        ),
      },
      git: {
        alwaysMounted: true,
        render: () => (
          <GitWorkbenchPanel
            cwd={props.cwd}
            workspaceKey={props.workspaceKey}
            environmentId={props.environmentId}
            onAgentAction={props.onGitAgentAction}
            onStopAgentAction={props.onStopGitAgentAction}
            stoppingAgentAction={props.stoppingGitAgentAction}
            pendingAgentAction={props.pendingGitAgentAction}
          />
        ),
      },
      terminal: {
        render: ({ tab }) => (
          <TerminalWorkbenchPanel
            cwd={props.cwd}
            workspaceKey={props.workspaceKey}
            environmentId={props.environmentId}
            onActivateTerminal={activateTerminalSession}
            onCloseTerminal={requestCloseTerminalSession}
            terminalId={tab.terminalId}
          />
        ),
      },
      browser: {
        keepMountedAfterFirstActivation: true,
        render: ({ tab, active }) => (
          <WorkbenchPanel>
            <BrowserPanel
              workspaceKey={props.workspaceKey}
              tabId={tab.id}
              browserId={tab.browserId}
              active={active}
            />
          </WorkbenchPanel>
        ),
      },
      dev: {
        keepMountedAfterFirstActivation: true,
        render: () => (
          <WorkbenchPanel>
            <DevWorkbenchPanel
              thread={props.thread}
              threadId={props.threadId}
              threadTitle={props.threadTitle}
            />
          </WorkbenchPanel>
        ),
      },
    };

    if (planTabAvailable && props.plan.environmentId) {
      renderers.plan = {
        keepMountedAfterFirstActivation: true,
        render: () => (
          <WorkbenchPanel>
            <PlanWorkbenchPanel
              activePlan={props.plan.activePlan}
              activeProposedPlan={props.plan.activeProposedPlan}
              environmentId={props.plan.environmentId}
              label={props.plan.label}
              markdownCwd={props.plan.markdownCwd}
              timestampFormat={props.plan.timestampFormat}
              canImplementPlan={props.plan.canImplementPlan}
              isImplementingPlan={props.plan.isImplementingPlan}
              onImplementPlan={props.plan.onImplementPlan}
              onSaveProposedPlan={props.plan.onSaveProposedPlan}
            />
          </WorkbenchPanel>
        ),
      };
    }

    return {
      tabs: workbenchTabs,
      renderers,
      snapshot: tabSnapshot,
      onCloseTab: (tab) => {
        if (tab.kind === "terminal" && tab.terminalId) {
          requestCloseTerminalSession(tab.terminalId);
          return;
        }
        workbenchTabPersistenceActions.closeTab(props.workspaceKey, tab.id);
      },
    };
  }, [
    activateTerminalSession,
    planTabAvailable,
    props.availableEditors,
    props.cwd,
    props.environmentId,
    props.onGitAgentAction,
    props.onStopGitAgentAction,
    props.pendingGitAgentAction,
    props.plan.activePlan,
    props.plan.activeProposedPlan,
    props.plan.canImplementPlan,
    props.plan.environmentId,
    props.plan.isImplementingPlan,
    props.plan.label,
    props.plan.markdownCwd,
    props.plan.onImplementPlan,
    props.plan.onSaveProposedPlan,
    props.plan.timestampFormat,
    props.stoppingGitAgentAction,
    props.thread,
    props.threadId,
    props.threadTitle,
    props.workspaceKey,
    requestCloseTerminalSession,
    tabSnapshot,
    workbenchTabs,
  ]);

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
      <GitStatusSync cwd={props.cwd} environmentId={props.environmentId} />
      <AppShell
        cwd={props.cwd}
        workspaceKey={props.workspaceKey}
        routeThreadId={props.routeThreadId}
        gitFocusId={null}
        threadTitle={props.threadTitle}
        left={props.left}
        center={
          <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
            <div
              className={cn(
                "absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden",
                centerEditorActive && "pointer-events-none invisible opacity-0",
              )}
              aria-hidden={centerEditorActive ? true : undefined}
              inert={centerEditorActive}
            >
              {props.center}
            </div>
            <div
              className={cn(
                "absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden",
                !centerEditorActive && "pointer-events-none invisible opacity-0",
              )}
              aria-hidden={!centerEditorActive ? true : undefined}
              inert={!centerEditorActive}
            >
              <ProjectCenterEditorSurface
                cwd={props.cwd}
                workspaceKey={props.workspaceKey}
                environmentId={props.environmentId}
                availableEditors={props.availableEditors}
              />
            </div>
          </div>
        }
        right={right}
        centerSurface={centerEditorActive ? "editor" : "chat"}
        centerRouteKind={props.routeKind ?? undefined}
      />
      <AlertDialog
        open={pendingCloseTerminalId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingCloseTerminalId(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Close "{pendingCloseLabel}"?</AlertDialogTitle>
            <AlertDialogDescription>
              A process is still running in this terminal. Closing the tab will terminate it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                const terminalId = pendingCloseTerminalId;
                setPendingCloseTerminalId(null);
                if (terminalId) closeTerminalSession(terminalId);
              }}
            >
              Close terminal
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}
