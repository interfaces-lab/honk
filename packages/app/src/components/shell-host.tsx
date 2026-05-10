import {
  scopedProjectKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@multi/client-runtime";
import { type EditorId, type EnvironmentId } from "@multi/contracts";
import { useMutation } from "@tanstack/react-query";
import { Outlet, useNavigate, useParams, useRouter } from "@tanstack/react-router";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";

import { readLastChatRouteTarget } from "~/chat-route-persistence";
import { prefetchDraftNavigation, prefetchThreadNavigation } from "~/app/thread-prefetch";
import { useCommandPaletteStore } from "~/command-palette-store";
import { isElectron } from "~/env";
import { useEnvironmentGitPanel } from "~/hooks/use-environment-git";
import { useHandleNewThread } from "~/hooks/use-handle-new-thread";
import { useRouteThreadId } from "~/hooks/use-route-thread-id";
import { getServerConfig, useServerAvailableEditors } from "~/rpc/server-state";
import { useComposerDraftStore } from "~/composer-draft-store";
import { resolveComposerModelSelection } from "~/composer-model-selection";
import { readEnvironmentApi } from "~/environment-api";
import {
  startNewThreadFromContext,
  startNewThreadInProjectFromContext,
} from "~/lib/chat-thread-actions";
import {
  GIT_AGENT_ACTIONS,
  resolveGitAgentActionFromPrompt,
  resolveGitAgentInterruptTarget,
  resolvePendingGitAgentAction,
  type GitAgentAction,
  type GitAgentInterruptTarget,
  type GitAgentRun,
} from "~/lib/git-agent-actions";
import {
  shellPanelsActions,
  useSecondaryRail,
  useTerminalSessions,
} from "~/lib/shell-panels-store";
import { useThreadUnreadStore } from "~/lib/thread-unread-store";
import { writeStoredProjectCwd } from "~/lib/project-state";
import { inferLoginShellCaption } from "~/lib/terminal-shell-caption";
import {
  buildProjectChatSections,
  type SidebarDraftSummary,
  type SidebarThreadSummary as SidebarSectionThreadSummary,
} from "~/lib/sidebar-chat-view-model";
import { cn, newCommandId, newMessageId, newThreadId } from "~/lib/utils";
import { resolveSidebarNewThreadEnvMode, resolveThreadStatusPill } from "~/lib/thread-sidebar";
import { useSettings } from "~/hooks/use-settings";
import {
  selectProjectsAcrossEnvironments,
  selectSidebarThreadsAcrossEnvironments,
  useStore,
} from "~/store";
import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type Project,
  type SidebarThreadSummary as StoreSidebarThreadSummary,
  type Thread,
} from "~/types";
import { resolveThreadRouteTarget } from "~/thread-routes";
import { GitPanel } from "./shell/git/panel";
import { ProjectFilesPanel } from "./shell/files/project-files-panel";
import { AppShell } from "./shell/shell/app";
import { RightWorkbenchLayout } from "./shell/shell/right-workbench-layout";
import { WorkbenchPanel } from "./shell/shell/workbench-panel";
import { ShellSettingsProvider } from "./shell/settings/context";
import { SettingsNavRail } from "./shell/settings/nav-rail";
import { ShellSidebarFooter } from "./shell/sidebar/footer";
import { ShellSidebarHeader } from "./shell/sidebar/header";
import { ThreadRail } from "./shell/sidebar/thread-rail";
import { TerminalPanel } from "./shell/terminal/panel";
import { TerminalRail } from "./shell/terminal/terminal-rail";
import { TerminalWorkbenchSubChrome } from "./shell/terminal/workbench-subchrome";

const PROJECTLESS_CWD = "~";

function projectScopedKeyFor(
  environmentId: EnvironmentId,
  projectId: Project["id"] | null,
): string | null {
  return projectId ? scopedProjectKey(scopeProjectRef(environmentId, projectId)) : null;
}

function needsSidebarAttention(sidebarThread: StoreSidebarThreadSummary | undefined): boolean {
  if (!sidebarThread) return false;
  const label = resolveThreadStatusPill({ thread: sidebarThread })?.label;
  return label === "Pending Approval" || label === "Awaiting Input" || label === "Plan Ready";
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

function toSummaryFromSidebarThread(
  thread: StoreSidebarThreadSummary,
  project: Project | null,
): SidebarSectionThreadSummary {
  const cwd =
    thread.projectId === null
      ? PROJECTLESS_CWD
      : (thread.worktreePath ?? project?.cwd ?? PROJECTLESS_CWD);
  const projectCwd = thread.projectId === null ? PROJECTLESS_CWD : (project?.cwd ?? cwd);
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
    messageCount: 0,
    firstMessage: thread.title,
    isStreaming: orchestrationStatus === "starting" || orchestrationStatus === "running",
    orchestrationStatus,
    needsAttention: needsSidebarAttention(thread),
  };
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
    <div className="agent-window__left-content thread-rail-pad flex min-h-0 flex-1 flex-col px-0">
      <SettingsNavRail />
      <ShellSidebarFooter settings />
    </div>
  );

  return (
    <AppShell
      cwd={firstProjectCwd}
      changesCount={0}
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
  const unread = useThreadUnreadStore((store) => store.unread);
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
        projects.map((project: Project) => [
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
              cwd: PROJECTLESS_CWD,
              environmentId: draftThread.environmentId,
              projectId: null,
              projectCwd: PROJECTLESS_CWD,
              updatedAt: draftThread.createdAt,
            } satisfies SidebarDraftSummary,
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
          } satisfies SidebarDraftSummary,
        ];
      });
  }, [composerDraftsByThreadKey, draftThreadsByThreadKey, projectByScopedKey]);

  const summaries = useMemo(() => {
    return sidebarThreads.flatMap((thread): SidebarSectionThreadSummary[] => {
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

  const unreadIds = useMemo(
    () => new Set(Object.keys(unread).filter((id) => unread[id])),
    [unread],
  );

  const activeThread = routeActiveThread ?? null;

  const activeGitAgentRun = useMemo((): GitAgentRun | null => {
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
    useState<GitAgentRun | null>(null);
  const activeDraftCwd = activeDraftThread
    ? activeDraftThread.projectId === null
      ? PROJECTLESS_CWD
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
        ? PROJECTLESS_CWD
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
  const sections = useMemo(
    () => buildProjectChatSections(summaries, drafts, activeCwd, null, unreadIds),
    [activeCwd, drafts, summaries, unreadIds],
  );

  const create = useCallback(
    (cwd?: string) => {
      const context = {
        activeDraftThread,
        activeThread: routeActiveThread,
        defaultProjectRef,
        defaultThreadEnvMode: resolveSidebarNewThreadEnvMode({
          defaultEnvMode: defaultThreadEnvMode,
        }),
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

  const clearThreadUnread = useThreadUnreadStore((store) => store.clear);

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
      clearThreadUnread(id);
      const summary = summaries.find((entry) => entry.id === id);
      if (summary) {
        if (summary.projectId !== null && summary.cwd) {
          writeStoredProjectCwd(summary.cwd);
        }
        void navigate({
          to: "/$environmentId/$threadId",
          params: { environmentId: summary.environmentId, threadId: summary.id },
        });
      }
    },
    [clearThreadUnread, drafts, navigate, summaries],
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
          ? scopedThreadKey(scopeThreadRef(currentServerThread.environmentId, currentServerThread.id))
          : routeTarget?.kind === "draft"
            ? routeTarget.draftId
            : null;
      const composerDraft =
        composerDraftKey !== null
          ? useComposerDraftStore.getState().draftsByThreadKey[composerDraftKey]
          : undefined;
      const serverConfig = getServerConfig();
      const modelSelection = resolveComposerModelSelection({
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
            messageId: newMessageId(),
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
      toast.error(error instanceof Error ? error.message : "Failed to start Git action.");
    },
  });
  const interruptGitAgentActionMutation = useMutation({
    mutationKey: [
      "git",
      "agent-action",
      "interrupt",
      activeGitAgentRun?.target.environmentId ??
        gitAgentOrchestrationHandoff?.target.environmentId ??
        null,
      activeGitAgentRun?.target.threadId ?? gitAgentOrchestrationHandoff?.target.threadId ?? null,
    ] as const,
    onMutate: () => {
      setGitAgentOrchestrationHandoff(null);
    },
    mutationFn: async (target: GitAgentInterruptTarget) => {
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
      toast.error(error instanceof Error ? error.message : "Failed to stop Git action.");
    },
    onSettled: () => {
      setGitAgentOrchestrationHandoff(null);
    },
  });
  useEffect(() => {
    if (activeGitAgentRun !== null) {
      setGitAgentOrchestrationHandoff(null);
      return;
    }
    if (gitAgentOrchestrationHandoff === null || gitAgentActionMutation.isPending) {
      return;
    }
    const targetMatchesActiveThread =
      activeThread?.environmentId === gitAgentOrchestrationHandoff.target.environmentId &&
      activeThread.id === gitAgentOrchestrationHandoff.target.threadId;
    if (!targetMatchesActiveThread) {
      return;
    }
    const orchestrationStatus = activeThread.session?.orchestrationStatus ?? null;
    if (orchestrationStatus === "starting" || orchestrationStatus === "running") {
      return;
    }
    const latestTurnState = activeThread.latestTurn?.state ?? null;
    if (
      latestTurnState === "completed" ||
      latestTurnState === "interrupted" ||
      latestTurnState === "error" ||
      hasGitAgentStartFailure(activeThread, gitAgentOrchestrationHandoff.action)
    ) {
      setGitAgentOrchestrationHandoff(null);
    }
  }, [
    activeGitAgentRun,
    activeThread,
    gitAgentActionMutation.isPending,
    gitAgentOrchestrationHandoff,
  ]);
  const pendingGitAgentAction = resolvePendingGitAgentAction({
    activeRun: activeGitAgentRun,
    mutationIsPending: gitAgentActionMutation.isPending,
    mutationVariables: gitAgentActionMutation.variables,
    orchestrationHandoff: gitAgentOrchestrationHandoff,
  });
  const gitAgentInterruptTarget = resolveGitAgentInterruptTarget({
    activeRun: activeGitAgentRun,
    orchestrationHandoff: gitAgentOrchestrationHandoff,
  });
  const stopGitAgentAction = gitAgentInterruptTarget
    ? () => interruptGitAgentActionMutation.mutate(gitAgentInterruptTarget)
    : null;
  const stoppingGitAgentAction =
    interruptGitAgentActionMutation.isPending && pendingGitAgentAction !== null;

  const chatLeft = (
    <div className="agent-window__left-content thread-rail-pad flex min-h-0 flex-1 flex-col px-0">
      <div className={cn("agent-window__sidebar-chrome shrink-0", isElectron && "no-drag")}>
        <ShellSidebarHeader onNewChat={create} onAddProject={openAddProject} />
      </div>
      <ThreadRail
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

  if (isElectron) {
    return (
      <DesktopChatShellHost
        left={chatLeft}
        center={props.children ?? <Outlet />}
        routeThreadId={routeThreadId}
        cwd={activeCwd}
        environmentId={activeEnvironmentId}
        availableEditors={availableEditors}
        onGitAgentAction={(action) => gitAgentActionMutation.mutate(action)}
        onStopGitAgentAction={stopGitAgentAction}
        stoppingGitAgentAction={stoppingGitAgentAction}
        pendingGitAgentAction={pendingGitAgentAction}
      />
    );
  }

  return (
    <AppShell
      cwd={activeCwd}
      changesCount={0}
      left={chatLeft}
      center={props.children ?? <Outlet />}
      right={null}
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

function DesktopChatShellHost(props: {
  left: ReactNode;
  center: ReactNode;
  routeThreadId: string | null;
  cwd: string | null;
  environmentId: EnvironmentId | null;
  availableEditors: readonly EditorId[];
  onGitAgentAction: (action: GitAgentAction) => void;
  onStopGitAgentAction: (() => void) | null;
  stoppingGitAgentAction: boolean;
  pendingGitAgentAction: GitAgentAction | null;
}) {
  const git = useEnvironmentGitPanel(props.environmentId, props.cwd);

  return (
    <AppShell
      cwd={props.cwd}
      changesCount={git.count}
      routeThreadId={props.routeThreadId}
      gitFocusId={git.focusId}
      left={props.left}
      center={props.center}
      right={{
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
      }}
    />
  );
}
