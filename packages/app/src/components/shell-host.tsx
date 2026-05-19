import {
  scopedProjectKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@multi/client-runtime";
import { DEFAULT_PROJECTLESS_CWD, type EditorId, type EnvironmentId } from "@multi/contracts";
import type { TimestampFormat } from "@multi/contracts/settings";
import { useMutation } from "@tanstack/react-query";
import { Outlet, useNavigate, useParams, useRouter } from "@tanstack/react-router";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { IconBranch, IconConsole, IconFileText, IconSquareChecklist } from "central-icons";

import { readLastChatRouteTarget } from "~/app/routes/chat-route-persistence";
import { toastManager } from "~/app/toast";
import { prefetchDraftNavigation, prefetchThreadNavigation } from "~/app/thread-prefetch";
import { useCommandPaletteStore } from "~/stores/ui/command-palette-store";
import { isElectron } from "~/env";
import { formatGitActionErrorDescription } from "~/git/action-error-description";
import { useEnvironmentGitPanel } from "~/hooks/use-environment-git";
import { useHandleNewThread } from "~/hooks/use-handle-new-thread";
import { useRouteThreadId } from "~/hooks/use-route-thread-id";
import { getServerConfig, useServerAvailableEditors } from "~/rpc/server-state";
import { useComposerDraftStore } from "~/stores/chat-drafts";
import { resolveAppProviderModelState } from "~/model/selection";
import { readEnvironmentApi } from "~/environment-api";
import {
  startNewThreadFromContext,
  startNewThreadInProjectFromContext,
} from "~/lib/chat-thread-actions";
import {
  GIT_AGENT_ACTIONS,
  resolveGitAgentActionFromPrompt,
  resolvePendingGitAgentAction,
  type GitAgentAction,
  type GitAgentRun,
} from "~/lib/git-agent-actions";
import {
  GitAgentActionHandoffContext,
  type GitAgentActionHandoff,
} from "~/lib/git-agent-action-handoff";
import {
  shellPanelsActions,
  useSecondaryRail,
  useTerminalSessions,
} from "~/stores/shell-panels-store";
import { useUiStateStore } from "~/stores/ui-state-store";
import { writeStoredProjectCwd } from "~/lib/project-state";
import { deriveLogicalProjectKey } from "~/stores/project-identity";
import { buildPlanImplementationPrompt } from "~/plan/proposed-plan";
import {
  buildProjectChatSections,
  type SidebarDraftSummary,
  type SidebarThreadSummary as SidebarSectionThreadSummary,
} from "./shell/agents/sidebar-chat-view-model";
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
  selectSidebarThreadsAcrossEnvironments,
  useStore,
} from "~/stores/thread-store";
import { createThreadSelectorAcrossEnvironments } from "~/stores/thread-selectors";
import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type Project,
  type SidebarThreadSummary as StoreSidebarThreadSummary,
  type Thread,
} from "~/types";
import { resolveThreadRouteTarget } from "~/app/routes/thread-route-targets";
import { GitPanel } from "./shell/git/panel";
import { ProjectFilesPanel } from "./shell/files/project-files-panel";
import { AppShell, type RightWorkbenchDefinition } from "./shell/shell/app";
import type { WorkbenchTabMeta } from "./shell/shell/right-workbench-header";
import { RightWorkbenchLayout } from "./shell/shell/right-workbench-layout";
import { WorkbenchPanel } from "./shell/shell/workbench-panel";
import { PlanWorkbenchPanel } from "./shell/plan/plan-workbench-panel";
import { getComposerProviderState } from "../model/provider-state";
import { formatOutgoingPrompt } from "./chat/composer/send";
import { ShellSettingsProvider } from "./shell/settings/context";
import { SettingsNavRail } from "./shell/settings/nav-rail";
import { ShellSidebarFooter } from "./shell/sidebar/footer";
import { ShellSidebarHeader } from "./shell/sidebar/header";
import { AgentList } from "./shell/agents/list";
import { TerminalPanel } from "./shell/terminal/panel";
import { TerminalRail } from "./shell/terminal/terminal-rail";
import { TerminalWorkbenchSubChrome } from "./shell/terminal/workbench-subchrome";

function inferLoginShellCaption(): string {
  try {
    const envShell =
      typeof process !== "undefined" && process.env && typeof process.env.SHELL === "string"
        ? process.env.SHELL
        : undefined;
    if (envShell) {
      const raw = envShell.trim().replace(/^["']+|["']+$/g, "");
      const last = Math.max(raw.lastIndexOf("/"), raw.lastIndexOf("\\"));
      const base = last < 0 ? raw : raw.slice(last + 1);
      const withoutExe = base.replace(/\.exe$/i, "");
      if (withoutExe.length > 0) {
        return withoutExe;
      }
    }
  } catch {
    /* non-Node or restricted env */
  }

  if (typeof navigator !== "undefined" && /Win/i.test(navigator.userAgent)) {
    return "powershell";
  }

  return "zsh";
}

function projectScopedKeyFor(
  environmentId: EnvironmentId,
  projectId: Project["id"] | null,
): string | null {
  return projectId ? scopedProjectKey(scopeProjectRef(environmentId, projectId)) : null;
}

function needsSidebarAttention(sidebarThread: StoreSidebarThreadSummary | undefined): boolean {
  if (!sidebarThread) return false;
  if (sidebarThread.hasPendingApprovals || sidebarThread.hasPendingUserInput) {
    return true;
  }
  if (
    sidebarThread.session?.status === "running" ||
    sidebarThread.session?.status === "connecting"
  ) {
    return false;
  }
  return (
    sidebarThread.interactionMode === "plan" &&
    isLatestTurnSettled(sidebarThread.latestTurn, sidebarThread.session) &&
    sidebarThread.hasActionableProposedPlan
  );
}

function isUnreadFromVisitBoundary(
  latestReadableAt: string | null | undefined,
  lastVisitedAt: string | null | undefined,
): boolean {
  if (!latestReadableAt) return false;
  if (!lastVisitedAt) return true;
  const latestReadableAtMs = Date.parse(latestReadableAt);
  const lastVisitedAtMs = Date.parse(lastVisitedAt);
  return (
    Number.isFinite(latestReadableAtMs) &&
    Number.isFinite(lastVisitedAtMs) &&
    latestReadableAtMs > lastVisitedAtMs
  );
}

function hasGitAgentStartFailure(thread: Thread, action: GitAgentAction): boolean {
  const latestUserMessage = thread.messages.findLast((message) => message.role === "user");
  if (!latestUserMessage || resolveGitAgentActionFromPrompt(latestUserMessage.text) !== action) {
    return false;
  }
  return thread.activities.some(
    (activity) =>
      activity.kind === "provider.turn.start.failed" &&
      activity.createdAt >= latestUserMessage.createdAt,
  );
}

function resolveActiveGitAgentHandoff(input: {
  activeRun: GitAgentRun | null;
  activeThread: Thread | null;
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
    return null;
  }

  return input.orchestrationHandoff;
}

function toSummaryFromSidebarThread(
  thread: StoreSidebarThreadSummary,
  project: Project | null,
): SidebarSectionThreadSummary {
  const cwd =
    thread.projectId === null
      ? DEFAULT_PROJECTLESS_CWD
      : (thread.worktreePath ?? project?.cwd ?? DEFAULT_PROJECTLESS_CWD);
  const projectCwd = thread.projectId === null ? DEFAULT_PROJECTLESS_CWD : (project?.cwd ?? cwd);
  const orchestrationStatus = thread.session?.orchestrationStatus ?? null;
  return {
    id: thread.id,
    environmentId: thread.environmentId,
    projectId: thread.projectId,
    projectCwd,
    path: cwd,
    cwd,
    name: thread.title,
    createdAt: thread.createdAt,
    modifiedAt: thread.updatedAt ?? thread.createdAt,
    latestReadableAt: thread.latestTurn?.completedAt ?? null,
    messageCount: 0,
    firstMessage: thread.title,
    isStreaming: orchestrationStatus === "starting" || orchestrationStatus === "running",
    orchestrationStatus,
    needsAttention: needsSidebarAttention(thread),
  };
}

const EMPTY_THREAD_ACTIVITIES: Thread["activities"] = [];

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
  const navigate = useNavigate();
  const firstProjectCwd = useStore(
    (store) => selectProjectsAcrossEnvironments(store)[0]?.cwd ?? null,
  );
  const backToChat = useCallback(() => {
    const lastChatRouteTarget = readLastChatRouteTarget();
    if (lastChatRouteTarget?.kind === "draft") {
      void navigate({ to: "/draft/$draftId", params: { draftId: lastChatRouteTarget.draftId } });
      return;
    }
    if (lastChatRouteTarget?.kind === "server") {
      void navigate({
        to: "/$environmentId/$threadId",
        params: {
          environmentId: lastChatRouteTarget.threadRef.environmentId,
          threadId: lastChatRouteTarget.threadRef.threadId,
        },
      });
      return;
    }

    void navigate({ to: "/" });
  }, [navigate]);

  const settingsLeft = (
    <div className="thread-rail-pad relative flex min-h-0 flex-1 flex-col px-0">
      <div
        className="drag-region pointer-events-none absolute inset-x-0 top-0 h-(--multi-shell-sidebar-content-top-offset,var(--multi-electron-traffic-padding-top))"
        aria-hidden="true"
      />
      <SettingsNavRail />
      <ShellSidebarFooter settings />
    </div>
  );

  return (
    <AppShell
      cwd={firstProjectCwd}
      onBack={backToChat}
      left={settingsLeft}
      center={props.children ?? <Outlet />}
      right={null}
    />
  );
}

function ChatShellHost(props: { children?: ReactNode }) {
  const navigate = useNavigate();
  const router = useRouter();
  const openAddProject = useCommandPaletteStore((store) => store.openAddProject);
  const routeThreadId = useRouteThreadId();
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const sidebarThreads = useStore(useShallow(selectSidebarThreadsAcrossEnvironments));
  const availableEditors = useServerAvailableEditors();
  const firstProjectCwd = projects[0]?.cwd ?? null;
  const draftThreadsByThreadKey = useComposerDraftStore((store) => store.draftThreadsByThreadKey);
  const composerDraftsByThreadKey = useComposerDraftStore((store) => store.draftsByThreadKey);
  const markDraftThreadPromoting = useComposerDraftStore((store) => store.markDraftThreadPromoting);
  const cancelDraftThreadPromotion = useComposerDraftStore(
    (store) => store.cancelDraftThreadPromotion,
  );
  const threadLastVisitedAtById = useUiStateStore((store) => store.threadLastVisitedAtById);
  const pinnedThreadKeys = useUiStateStore((store) => store.pinnedThreadKeys);
  const {
    activeDraftThread,
    activeThread: routeActiveThread,
    defaultProjectRef,
    handleNewThread,
  } = useHandleNewThread();
  const settings = useSettings();
  const defaultThreadEnvMode = settings.defaultThreadEnvMode;

  const selectedId =
    routeTarget?.kind === "draft" ? routeTarget.draftId : (routeTarget?.threadRef.threadId ?? null);

  const projectByScopedKey = useMemo(
    () =>
      new Map(
        projects.map((project) => [
          scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
          project,
        ]),
      ),
    [projects],
  );

  const drafts = useMemo<SidebarDraftSummary[]>(() => {
    return Object.entries(draftThreadsByThreadKey)
      .filter(([, draftThread]) => draftThread.promotedTo == null)
      .flatMap(([draftId, draftThread]): SidebarDraftSummary[] => {
        const composerDraft = composerDraftsByThreadKey[draftId];
        const hasVisibleDraftContent =
          composerDraft &&
          (composerDraft.prompt.trim().length > 0 ||
            composerDraft.images.length > 0 ||
            composerDraft.persistedAttachments.length > 0);
        if (!hasVisibleDraftContent) {
          return [];
        }
        if (draftThread.projectId === null) {
          const firstAttachment =
            composerDraft?.images[0] ?? composerDraft?.persistedAttachments[0];
          return [
            {
              id: draftId,
              text: composerDraft?.prompt ?? "",
              attachmentCount:
                (composerDraft?.images.length ?? 0) +
                (composerDraft?.persistedAttachments.length ?? 0),
              firstAttachmentName: firstAttachment?.name ?? null,
              cwd: DEFAULT_PROJECTLESS_CWD,
              environmentId: draftThread.environmentId,
              projectId: null,
              projectCwd: DEFAULT_PROJECTLESS_CWD,
              updatedAt: draftThread.createdAt,
            },
          ];
        }
        const projectKey = projectScopedKeyFor(draftThread.environmentId, draftThread.projectId);
        const project = projectKey ? projectByScopedKey.get(projectKey) : undefined;
        if (!project) {
          return [];
        }
        const firstAttachment = composerDraft?.images[0] ?? composerDraft?.persistedAttachments[0];
        const attachmentCount =
          (composerDraft?.images.length ?? 0) + (composerDraft?.persistedAttachments.length ?? 0);
        return [
          {
            id: draftId,
            text: composerDraft?.prompt ?? "",
            attachmentCount,
            firstAttachmentName: firstAttachment?.name ?? null,
            cwd: draftThread.worktreePath ?? project.cwd,
            environmentId: draftThread.environmentId,
            projectId: draftThread.projectId,
            projectCwd: project.cwd,
            updatedAt: draftThread.createdAt,
          },
        ];
      });
  }, [composerDraftsByThreadKey, draftThreadsByThreadKey, projectByScopedKey]);

  const summaries = useMemo(() => {
    return sidebarThreads.flatMap((thread) => {
      if (thread.archivedAt !== null) {
        return [];
      }
      if (thread.projectId === null) {
        return [toSummaryFromSidebarThread(thread, null)];
      }
      const projectKey = projectScopedKeyFor(thread.environmentId, thread.projectId);
      const project = projectKey ? projectByScopedKey.get(projectKey) : undefined;
      return project ? [toSummaryFromSidebarThread(thread, project)] : [];
    });
  }, [projectByScopedKey, sidebarThreads]);

  const unreadIds = useMemo(() => {
    const ids = new Set<string>();
    for (const thread of sidebarThreads) {
      const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
      if (
        isUnreadFromVisitBoundary(
          thread.latestTurn?.completedAt,
          threadLastVisitedAtById[threadKey],
        )
      ) {
        ids.add(thread.id);
      }
    }
    return ids;
  }, [sidebarThreads, threadLastVisitedAtById]);
  const pinnedThreadKeySet = useMemo(() => new Set(pinnedThreadKeys), [pinnedThreadKeys]);

  const activeThread = routeActiveThread ?? null;

  const activeGitAgentRun = useMemo(() => {
    if (!activeThread) {
      return null;
    }
    const status = activeThread.session?.orchestrationStatus ?? null;
    if (status !== "starting" && status !== "running") {
      return null;
    }
    const latestUserMessage = activeThread.messages.findLast((message) => message.role === "user");
    const action = latestUserMessage
      ? resolveGitAgentActionFromPrompt(latestUserMessage.text)
      : null;
    if (!action) {
      return null;
    }
    return {
      action,
      target: {
        environmentId: activeThread.environmentId,
        threadId: activeThread.id,
        turnId: activeThread.session?.activeTurnId ?? activeThread.latestTurn?.turnId ?? undefined,
      },
    };
  }, [activeThread]);
  const [gitAgentOrchestrationHandoff, setGitAgentOrchestrationHandoff] =
    useState<GitAgentActionHandoff | null>(null);
  const activeDraftCwd = activeDraftThread
    ? activeDraftThread.projectId === null
      ? DEFAULT_PROJECTLESS_CWD
      : (activeDraftThread.worktreePath ??
        (activeDraftThread.projectId
          ? projectByScopedKey.get(
              scopedProjectKey(
                scopeProjectRef(activeDraftThread.environmentId, activeDraftThread.projectId),
              ),
            )?.cwd
          : undefined) ??
        null)
    : null;
  const defaultProject = defaultProjectRef
    ? (projectByScopedKey.get(scopedProjectKey(defaultProjectRef)) ?? null)
    : null;
  const activeCwd =
    activeDraftCwd ??
    (activeThread
      ? activeThread.projectId === null
        ? DEFAULT_PROJECTLESS_CWD
        : (activeThread.worktreePath ??
          (activeThread.projectId
            ? projectByScopedKey.get(
                scopedProjectKey(
                  scopeProjectRef(activeThread.environmentId, activeThread.projectId),
                ),
              )?.cwd
            : undefined) ??
          null)
      : (defaultProject?.cwd ?? firstProjectCwd));
  const activeEnvironmentId =
    activeThread?.environmentId ??
    projects.find((project) => project.cwd === activeCwd)?.environmentId ??
    defaultProject?.environmentId ??
    projects[0]?.environmentId ??
    null;
  const activeProject = activeThread?.projectId
    ? (projectByScopedKey.get(
        scopedProjectKey(scopeProjectRef(activeThread.environmentId, activeThread.projectId)),
      ) ?? null)
    : null;
  const composerDraftInteractionMode = useComposerDraftStore((store) => {
    if (!routeTarget) {
      return null;
    }
    return (
      store.getComposerDraft(
        routeTarget.kind === "server" ? routeTarget.threadRef : routeTarget.draftId,
      )?.interactionMode ?? null
    );
  });
  const runtimeMode =
    activeThread?.runtimeMode ?? activeDraftThread?.runtimeMode ?? DEFAULT_RUNTIME_MODE;
  const interactionMode =
    composerDraftInteractionMode ??
    activeThread?.interactionMode ??
    activeDraftThread?.interactionMode ??
    DEFAULT_INTERACTION_MODE;
  const activeLatestTurn = activeThread?.latestTurn ?? null;
  const latestTurnSettled = isLatestTurnSettled(activeLatestTurn, activeThread?.session ?? null);
  const sourceProposedPlanThreadId =
    activeLatestTurn?.sourceProposedPlan?.threadId &&
    activeLatestTurn.sourceProposedPlan.threadId !== activeThread?.id
      ? activeLatestTurn.sourceProposedPlan.threadId
      : null;
  const sourceProposedPlanThread = useStore(
    useMemo(
      () => createThreadSelectorAcrossEnvironments(sourceProposedPlanThreadId),
      [sourceProposedPlanThreadId],
    ),
  );
  const planThreads = useMemo(() => {
    const threads: Thread[] = [];
    if (activeThread) {
      threads.push(activeThread);
    }
    if (sourceProposedPlanThread && sourceProposedPlanThread.id !== activeThread?.id) {
      threads.push(sourceProposedPlanThread);
    }
    return threads;
  }, [activeThread, sourceProposedPlanThread]);
  const activePlan = useMemo(
    () =>
      deriveActivePlanState(
        activeThread?.activities ?? EMPTY_THREAD_ACTIVITIES,
        activeLatestTurn?.turnId ?? undefined,
      ),
    [activeLatestTurn?.turnId, activeThread?.activities],
  );
  const activeProposedPlan = useMemo(
    () =>
      findSidebarProposedPlan({
        threads: planThreads,
        latestTurn: activeLatestTurn,
        latestTurnSettled,
        threadId: activeThread?.id ?? null,
      }),
    [activeLatestTurn, activeThread?.id, latestTurnSettled, planThreads],
  );
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
  const resolvePlanImplementationModelSelection = useCallback(
    (implementationPrompt: string) => {
      const composerDraftKey = activeThread
        ? scopedThreadKey(scopeThreadRef(activeThread.environmentId, activeThread.id))
        : routeTarget?.kind === "draft"
          ? routeTarget.draftId
          : null;
      const composerDraft =
        composerDraftKey !== null
          ? useComposerDraftStore.getState().draftsByThreadKey[composerDraftKey]
          : undefined;
      const serverConfig = getServerConfig();
      const resolved = resolveAppProviderModelState({
        draft: composerDraft,
        providers: serverConfig?.providers ?? [],
        settings,
        sessionProviderInstanceId: activeThread?.session?.providerInstanceId,
        threadModelSelection: activeThread?.modelSelection,
        projectModelSelection: activeProject?.defaultModelSelection,
      });
      const composerProviderState = getComposerProviderState({
        provider: resolved.selectedProvider,
        model: resolved.selectedModel,
        models: resolved.selectedProviderModels,
        prompt: implementationPrompt,
        modelOptions: resolved.modelOptionSelectionsByInstance?.[resolved.selectedInstanceId],
      });
      return {
        modelSelection: resolved.modelSelection,
        messageText: formatOutgoingPrompt({
          provider: resolved.selectedProvider,
          model: resolved.selectedModel,
          models: resolved.selectedProviderModels,
          effort: composerProviderState.promptEffort,
          text: implementationPrompt,
        }),
      };
    },
    [activeProject?.defaultModelSelection, activeThread, routeTarget, settings],
  );
  const startPlanImplementation = useCallback(async () => {
    if (
      !activeThread ||
      !activeProposedPlan ||
      !activeProposedPlanSourceThreadId ||
      !canImplementPlan ||
      isImplementingPlan
    ) {
      return;
    }

    const api = readEnvironmentApi(activeThread.environmentId);
    if (!api) {
      toast.error("Environment API unavailable.");
      return;
    }

    const createdAt = new Date().toISOString();
    const planMarkdown = activeProposedPlan.planMarkdown;
    const implementationPrompt = buildPlanImplementationPrompt(planMarkdown);
    const { modelSelection, messageText } =
      resolvePlanImplementationModelSelection(implementationPrompt);
    const sourceProposedPlan = {
      threadId: activeProposedPlanSourceThreadId,
      planId: activeProposedPlan.id,
    };

    setIsImplementingPlan(true);
    try {
      if (
        modelSelection.model !== activeThread.modelSelection.model ||
        modelSelection.instanceId !== activeThread.modelSelection.instanceId ||
        JSON.stringify(modelSelection.options ?? null) !==
          JSON.stringify(activeThread.modelSelection.options ?? null)
      ) {
        await api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId: activeThread.id,
          modelSelection,
        });
      }
      if (runtimeMode !== activeThread.runtimeMode) {
        await api.orchestration.dispatchCommand({
          type: "thread.runtime-mode.set",
          commandId: newCommandId(),
          threadId: activeThread.id,
          runtimeMode,
          createdAt,
        });
      }
      if (activeThread.interactionMode !== "default") {
        await api.orchestration.dispatchCommand({
          type: "thread.interaction-mode.set",
          commandId: newCommandId(),
          threadId: activeThread.id,
          interactionMode: "default",
          createdAt,
        });
      }

      await api.orchestration.dispatchCommand({
        type: "thread.turn.start",
        commandId: newCommandId(),
        threadId: activeThread.id,
        message: {
          messageId: newMessageId(),
          role: "user",
          text: messageText,
          attachments: [],
        },
        modelSelection,
        titleSeed: activeThread.title,
        runtimeMode,
        interactionMode: "default",
        sourceProposedPlan,
        createdAt,
      });
      shellPanelsActions.activatePlanTab();
    } catch (error) {
      toast.error("Could not implement plan.", {
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    } finally {
      setIsImplementingPlan(false);
    }
  }, [
    activeProposedPlan,
    activeProposedPlanSourceThreadId,
    activeThread,
    canImplementPlan,
    isImplementingPlan,
    resolvePlanImplementationModelSelection,
    runtimeMode,
  ]);
  const implementPlanInCurrentThread = useCallback(() => {
    void startPlanImplementation();
  }, [startPlanImplementation]);
  const planAvailable =
    interactionMode === "plan" || activePlan !== null || activeProposedPlan !== null;
  const planLabel: PlanWorkbenchLabel =
    activeProposedPlan || interactionMode === "plan" ? "Plan" : "Tasks";
  const planWorkbench: PlanWorkbenchState = {
    available: planAvailable,
    activePlan,
    activeProposedPlan,
    label: planLabel,
    environmentId: activeThread?.environmentId ?? activeEnvironmentId,
    markdownCwd: activeCwd ?? undefined,
    timestampFormat: settings.timestampFormat,
    canImplementPlan,
    isImplementingPlan,
    onImplementPlan: showPlanImplementationActions ? implementPlanInCurrentThread : undefined,
  };
  const sections = useMemo(() => {
    const projectStateKeyByCwd = new Map(
      projects.map((project) => [project.cwd, deriveLogicalProjectKey(project)] as const),
    );
    return buildProjectChatSections(
      summaries,
      drafts,
      activeCwd,
      null,
      unreadIds,
      projects.map((project) => project.cwd),
      pinnedThreadKeySet,
    ).map((section) => {
      const projectStateKey = section.projectCwd
        ? projectStateKeyByCwd.get(section.projectCwd)
        : undefined;
      return projectStateKey ? Object.assign(section, { projectStateKey }) : section;
    });
  }, [activeCwd, drafts, pinnedThreadKeySet, projects, summaries, unreadIds]);

  const create = useCallback(
    (cwd?: string) => {
      const context = {
        activeDraftThread,
        activeThread: routeActiveThread,
        defaultProjectRef,
        defaultThreadEnvMode,
        handleNewThread,
      };
      const project =
        cwd && cwd.length > 0 ? projects.find((candidate) => candidate.cwd === cwd) : null;
      if (project) {
        writeStoredProjectCwd(project.cwd);
        void startNewThreadInProjectFromContext(
          context,
          scopeProjectRef(project.environmentId, project.id),
        );
        return;
      }
      void startNewThreadFromContext(context);
    },
    [
      activeDraftThread,
      defaultProjectRef,
      defaultThreadEnvMode,
      handleNewThread,
      projects,
      routeActiveThread,
    ],
  );

  const markThreadVisited = useUiStateStore((store) => store.markThreadVisited);

  const select = useCallback(
    (id: string) => {
      const draft = drafts.find((entry) => entry.id === id);
      if (draft) {
        if (draft.projectId !== null) {
          writeStoredProjectCwd(draft.cwd);
        }
        void navigate({ to: "/draft/$draftId", params: { draftId: id } });
        return;
      }
      const summary = summaries.find((entry) => entry.id === id);
      if (summary) {
        markThreadVisited(scopedThreadKey(scopeThreadRef(summary.environmentId, summary.id)));
        if (summary.projectId !== null && summary.cwd) {
          writeStoredProjectCwd(summary.cwd);
        }
        void navigate({
          to: "/$environmentId/$threadId",
          params: { environmentId: summary.environmentId, threadId: summary.id },
        });
      }
    },
    [drafts, markThreadVisited, navigate, summaries],
  );

  const prefetchAgent = useCallback(
    (id: string) => {
      if (drafts.some((draft) => draft.id === id)) {
        prefetchDraftNavigation(router, id);
        return;
      }

      const summary = summaries.find((entry) => entry.id === id);
      if (!summary || summary.projectId === null) {
        return;
      }

      prefetchThreadNavigation({
        router,
        thread: { environmentId: summary.environmentId, id: summary.id },
      });
    },
    [drafts, router, summaries],
  );

  const startGitAgentAction = useCallback(
    async (action: GitAgentAction) => {
      const routeServerThreadFallback =
        routeTarget?.kind === "server" &&
        activeThread?.environmentId === routeTarget.threadRef.environmentId &&
        activeThread.id === routeTarget.threadRef.threadId
          ? activeThread
          : null;
      const currentServerThread =
        routeTarget?.kind === "server" ? (routeActiveThread ?? routeServerThreadFallback) : null;
      const currentDraftThread = routeTarget?.kind === "draft" ? activeDraftThread : null;

      if (routeTarget?.kind === "server" && !currentServerThread) {
        throw new Error("Current thread is unavailable.");
      }
      if (routeTarget?.kind === "draft" && !currentDraftThread) {
        throw new Error("Current draft is unavailable.");
      }

      const currentServerProject = currentServerThread?.projectId
        ? (projectByScopedKey.get(
            scopedProjectKey(
              scopeProjectRef(currentServerThread.environmentId, currentServerThread.projectId),
            ),
          ) ?? null)
        : null;
      const currentDraftProject = currentDraftThread?.projectId
        ? (projectByScopedKey.get(
            scopedProjectKey(
              scopeProjectRef(currentDraftThread.environmentId, currentDraftThread.projectId),
            ),
          ) ?? null)
        : null;
      const activeCwdProject = activeCwd
        ? (projects.find((project) => project.cwd === activeCwd) ?? null)
        : null;
      const project =
        currentServerProject ??
        currentDraftProject ??
        activeCwdProject ??
        defaultProject ??
        projects[0];

      if (!project) {
        throw new Error("No project is available for this Git action.");
      }

      if (
        currentServerThread &&
        (currentServerThread.environmentId !== project.environmentId ||
          currentServerThread.projectId !== project.id)
      ) {
        throw new Error("Open this repository's thread before running the Git action.");
      }
      if (
        currentDraftThread &&
        (currentDraftThread.environmentId !== project.environmentId ||
          currentDraftThread.projectId !== project.id)
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

      const composerDraftKey =
        currentServerThread !== null
          ? scopedThreadKey(
              scopeThreadRef(currentServerThread.environmentId, currentServerThread.id),
            )
          : routeTarget?.kind === "draft"
            ? routeTarget.draftId
            : null;
      const composerDraft =
        composerDraftKey !== null
          ? useComposerDraftStore.getState().draftsByThreadKey[composerDraftKey]
          : undefined;
      const serverConfig = getServerConfig();
      const modelSelection = resolveAppProviderModelState({
        draft: composerDraft,
        providers: serverConfig?.providers ?? [],
        settings,
        sessionProviderInstanceId: currentServerThread?.session?.providerInstanceId,
        threadModelSelection: currentServerThread?.modelSelection,
        projectModelSelection: project.defaultModelSelection,
      }).modelSelection;

      const createdAt = new Date().toISOString();
      const actionDetails = GIT_AGENT_ACTIONS[action];
      const title = actionDetails.label;
      const prompt = actionDetails.prompt;
      const messageId = newMessageId();
      const runtimeMode =
        currentServerThread?.runtimeMode ?? currentDraftThread?.runtimeMode ?? DEFAULT_RUNTIME_MODE;
      const interactionMode =
        currentServerThread?.interactionMode ??
        currentDraftThread?.interactionMode ??
        DEFAULT_INTERACTION_MODE;
      const threadId = currentServerThread?.id ?? currentDraftThread?.threadId ?? newThreadId();
      const projectScopedBranch = currentServerThread?.branch ?? currentDraftThread?.branch ?? null;
      const projectScopedWorktreePath =
        currentServerThread?.worktreePath ?? currentDraftThread?.worktreePath ?? null;
      const promotedDraftId = routeTarget?.kind === "draft" ? routeTarget.draftId : null;
      let draftPromotionMarked = false;

      try {
        setGitAgentOrchestrationHandoff({
          action,
          target: { environmentId: project.environmentId, threadId },
          optimisticMessage: {
            id: messageId,
            role: "user",
            text: prompt,
            attachments: [],
            createdAt,
            streaming: false,
          },
        });
        if (promotedDraftId) {
          markDraftThreadPromoting(
            promotedDraftId,
            scopeThreadRef(project.environmentId, threadId),
          );
          draftPromotionMarked = true;
        }

        if (!currentServerThread) {
          await api.orchestration.dispatchCommand({
            type: "thread.create",
            commandId: newCommandId(),
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
        }

        await api.orchestration.dispatchCommand({
          type: "thread.turn.start",
          commandId: newCommandId(),
          threadId,
          message: {
            messageId,
            role: "user",
            text: prompt,
            attachments: [],
          },
          modelSelection,
          titleSeed: title,
          runtimeMode,
          interactionMode,
          createdAt,
        });

        await navigate({
          to: "/$environmentId/$threadId",
          params: { environmentId: project.environmentId, threadId },
        });
      } catch (error) {
        setGitAgentOrchestrationHandoff(null);
        if (draftPromotionMarked && promotedDraftId) {
          cancelDraftThreadPromotion(promotedDraftId);
        }
        throw error;
      }
    },
    [
      activeCwd,
      activeDraftThread,
      activeThread,
      cancelDraftThreadPromotion,
      defaultProject,
      markDraftThreadPromoting,
      navigate,
      projectByScopedKey,
      projects,
      routeActiveThread,
      routeTarget,
      settings,
    ],
  );
  const gitAgentActionMutation = useMutation({
    mutationKey: ["git", "agent-action", activeEnvironmentId ?? null, activeCwd ?? null] as const,
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
  const activeGitAgentHandoff = useMemo(
    () =>
      resolveActiveGitAgentHandoff({
        activeRun: activeGitAgentRun,
        activeThread,
        mutationIsPending: gitAgentActionMutation.isPending,
        orchestrationHandoff: gitAgentOrchestrationHandoff,
      }),
    [
      activeGitAgentRun,
      activeThread,
      gitAgentActionMutation.isPending,
      gitAgentOrchestrationHandoff,
    ],
  );
  const interruptGitAgentActionMutation = useMutation({
    mutationKey: [
      "git",
      "agent-action",
      "interrupt",
      activeGitAgentRun?.target.environmentId ??
        activeGitAgentHandoff?.target.environmentId ??
        null,
      activeGitAgentRun?.target.threadId ?? activeGitAgentHandoff?.target.threadId ?? null,
    ] as const,
    onMutate: () => {
      setGitAgentOrchestrationHandoff(null);
    },
    mutationFn: async (target: GitAgentRun["target"]) => {
      const api = readEnvironmentApi(target.environmentId);
      if (!api) {
        throw new Error("Environment API unavailable.");
      }
      await api.orchestration.dispatchCommand({
        type: "thread.turn.interrupt",
        commandId: newCommandId(),
        threadId: target.threadId,
        ...(target.turnId !== undefined ? { turnId: target.turnId } : {}),
        createdAt: new Date().toISOString(),
      });
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
  const gitAgentInterruptTarget =
    activeGitAgentRun?.target ?? activeGitAgentHandoff?.target ?? null;
  const stopGitAgentAction = gitAgentInterruptTarget
    ? () => interruptGitAgentActionMutation.mutate(gitAgentInterruptTarget)
    : null;
  const stoppingGitAgentAction =
    interruptGitAgentActionMutation.isPending && pendingGitAgentAction !== null;
  const center = (
    <GitAgentActionHandoffContext.Provider value={activeGitAgentHandoff}>
      {props.children ?? <Outlet />}
    </GitAgentActionHandoffContext.Provider>
  );

  const chatLeft = (
    <div className="thread-rail-pad relative flex min-h-0 flex-1 flex-col px-0">
      <div
        className="drag-region pointer-events-none absolute inset-x-0 top-0 h-(--multi-shell-sidebar-content-top-offset,var(--multi-electron-traffic-padding-top))"
        aria-hidden="true"
      />
      <div className={cn("shrink-0", isElectron && "no-drag")}>
        <ShellSidebarHeader onNewChat={create} onAddProject={openAddProject} />
      </div>
      <AgentList
        loading={false}
        error={false}
        sections={sections}
        selectedId={selectedId}
        onSelectAgent={select}
        onPrefetchAgent={prefetchAgent}
        onNewAgent={create}
      />
      <ShellSidebarFooter />
    </div>
  );

  return (
    <ChatWorkbenchShellHost
      left={chatLeft}
      center={center}
      routeThreadId={routeThreadId}
      cwd={activeCwd}
      environmentId={activeEnvironmentId}
      availableEditors={availableEditors}
      plan={planWorkbench}
      onGitAgentAction={(action) => gitAgentActionMutation.mutate(action)}
      onStopGitAgentAction={stopGitAgentAction}
      stoppingGitAgentAction={stoppingGitAgentAction}
      pendingGitAgentAction={pendingGitAgentAction}
    />
  );
}

function TerminalWorkbenchPanel(props: {
  cwd: string | null;
  environmentId: EnvironmentId | null;
}) {
  const terminalState = useTerminalSessions(props.cwd);
  const { open: terminalRailOpen } = useSecondaryRail(props.cwd, "terminal");
  return (
    <WorkbenchPanel className="overflow-hidden">
      <TerminalWorkbenchSubChrome
        railOpen={terminalRailOpen}
        onToggleRail={() => shellPanelsActions.toggleSecondaryRail(props.cwd, "terminal")}
        shellCaption={inferLoginShellCaption()}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <RightWorkbenchLayout
          cwd={props.cwd}
          tab="terminal"
          railHostClassName="bg-transparent"
          rail={
            <TerminalRail
              sessions={terminalState.sessions}
              activeId={terminalState.activeId}
              onActivate={(id) => shellPanelsActions.setActiveTerminal(props.cwd, id)}
              onClose={(id) => shellPanelsActions.removeTerminalSession(props.cwd, id)}
            />
          }
        >
          <TerminalPanel
            cwd={props.cwd}
            environmentId={props.environmentId}
            terminalId={terminalState.activeId}
          />
        </RightWorkbenchLayout>
      </div>
    </WorkbenchPanel>
  );
}

function ChatWorkbenchShellHost(props: {
  left: ReactNode;
  center: ReactNode;
  routeThreadId: string | null;
  cwd: string | null;
  environmentId: EnvironmentId | null;
  availableEditors: readonly EditorId[];
  plan: PlanWorkbenchState;
  onGitAgentAction: (action: GitAgentAction) => void;
  onStopGitAgentAction: (() => void) | null;
  stoppingGitAgentAction: boolean;
  pendingGitAgentAction: GitAgentAction | null;
}) {
  const git = useEnvironmentGitPanel(props.environmentId, props.cwd);
  const planTabAvailable = props.plan.available && props.plan.environmentId !== null;
  const workbenchTabs = useMemo<WorkbenchTabMeta[]>(() => {
    const tabs: WorkbenchTabMeta[] = planTabAvailable
      ? [{ id: "plan", label: props.plan.label, icon: IconSquareChecklist }]
      : [];
    tabs.push(
      {
        id: "git",
        label: "Changes",
        icon: IconBranch,
        badge: git.count > 0 ? String(git.count) : null,
      },
      { id: "terminal", label: "Terminal", icon: IconConsole },
      { id: "files", label: "Files", icon: IconFileText },
    );
    return tabs;
  }, [git.count, planTabAvailable, props.plan.label]);

  const right = useMemo<RightWorkbenchDefinition>(() => {
    const panels: RightWorkbenchDefinition["panels"] = {
      files: (
        <WorkbenchPanel>
          <ProjectFilesPanel
            cwd={props.cwd}
            environmentId={props.environmentId}
            availableEditors={props.availableEditors}
          />
        </WorkbenchPanel>
      ),
      git: (
        <WorkbenchPanel>
          <GitPanel
            git={git}
            onAgentAction={props.onGitAgentAction}
            onStopAgentAction={props.onStopGitAgentAction}
            stoppingAgentAction={props.stoppingGitAgentAction}
            pendingAgentAction={props.pendingGitAgentAction}
          />
        </WorkbenchPanel>
      ),
      terminal: <TerminalWorkbenchPanel cwd={props.cwd} environmentId={props.environmentId} />,
    };

    if (planTabAvailable && props.plan.environmentId) {
      panels.plan = (
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
          />
        </WorkbenchPanel>
      );
    }

    return { tabs: workbenchTabs, panels };
  }, [
    git,
    props.availableEditors,
    props.cwd,
    props.environmentId,
    props.onGitAgentAction,
    props.onStopGitAgentAction,
    props.pendingGitAgentAction,
    props.plan.activePlan,
    props.plan.activeProposedPlan,
    props.plan.environmentId,
    props.plan.canImplementPlan,
    props.plan.label,
    props.plan.markdownCwd,
    props.plan.isImplementingPlan,
    props.plan.onImplementPlan,
    props.plan.timestampFormat,
    planTabAvailable,
    props.stoppingGitAgentAction,
    workbenchTabs,
  ]);

  return (
    <>
      {git.lifecycleSync}
      <AppShell
        cwd={props.cwd}
        routeThreadId={props.routeThreadId}
        gitFocusId={git.focusId}
        left={props.left}
        center={props.center}
        right={right}
      />
    </>
  );
}
