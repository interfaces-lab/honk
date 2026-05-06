import {
  scopedProjectKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@multi/client-runtime";
import type { EditorId, EnvironmentId, ThreadId } from "@multi/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { Outlet, useNavigate, useParams, useRouter } from "@tanstack/react-router";
import { type ReactNode, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";

import { prefetchDraftNavigation, prefetchThreadNavigation } from "~/app/thread-prefetch";
import { useCommandPaletteStore } from "~/command-palette-store";
import { isElectron } from "~/env";
import { useEnvironmentGitPanel } from "~/hooks/use-environment-git";
import { useHandleNewThread } from "~/hooks/use-handle-new-thread";
import { useRouteThreadId } from "~/hooks/use-route-thread-id";
import { useServerAvailableEditors } from "~/rpc/server-state";
import { useComposerDraftStore } from "~/composer-draft-store";
import { readEnvironmentApi } from "~/environment-api";
import {
  startNewThreadFromContext,
  startNewThreadInProjectFromContext,
} from "~/lib/chat-thread-actions";
import { GIT_AGENT_ACTIONS, type GitAgentAction } from "~/lib/git-agent-actions";
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
  selectThreadsAcrossEnvironments,
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

function toHarness(instanceId: Thread["modelSelection"]["instanceId"]): "codex" | "claudeCode" {
  return instanceId === "claudeAgent" ? "claudeCode" : "codex";
}

const PROJECTLESS_CWD = "~";

function sidebarThreadKey(thread: { environmentId: EnvironmentId; id: ThreadId }) {
  return scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
}

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

function toSummary(
  thread: Thread,
  project: Project,
  sidebarThread: StoreSidebarThreadSummary | undefined,
): SidebarSectionThreadSummary {
  const firstUserMessage = thread.messages.find((message) => message.role === "user")?.text?.trim();
  const cwd = thread.worktreePath ?? project.cwd;
  const orchestrationStatus =
    thread.session?.orchestrationStatus ?? sidebarThread?.session?.orchestrationStatus ?? null;
  return {
    id: thread.id,
    environmentId: thread.environmentId,
    projectId: project.id,
    projectCwd: project.cwd,
    harness: toHarness(thread.modelSelection.instanceId),
    path: cwd,
    cwd,
    name: thread.title,
    createdAt: thread.createdAt,
    modifiedAt: thread.updatedAt ?? thread.createdAt,
    messageCount: thread.messages.length,
    firstMessage: firstUserMessage || thread.title,
    allMessagesText: thread.messages.map((message) => message.text).join("\n\n"),
    isStreaming: orchestrationStatus === "starting" || orchestrationStatus === "running",
    orchestrationStatus,
    needsAttention: needsSidebarAttention(sidebarThread),
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

  const settingsLeft = (
    <div className="agent-window__left-content thread-rail-pad flex min-h-0 flex-1 flex-col px-0">
      <SettingsNavRail />
      <ShellSidebarFooter settings />
    </div>
  );

  return (
    <AppShell
      cwd={firstProjectCwd}
      panelPersistenceCwd={firstProjectCwd}
      changesCount={0}
      onBack={() => void navigate({ to: "/" })}
      left={settingsLeft}
      center={props.children ?? <Outlet />}
      right={null}
    />
  );
}

function ChatShellHost(props: { children?: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const router = useRouter();
  const openAddProject = useCommandPaletteStore((store) => store.openAddProject);
  const routeThreadId = useRouteThreadId();
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const threads = useStore(useShallow(selectThreadsAcrossEnvironments));
  const sidebarThreads = useStore(useShallow(selectSidebarThreadsAcrossEnvironments));
  const availableEditors = useServerAvailableEditors();
  const firstProjectCwd = projects[0]?.cwd ?? null;
  const draftThreadsByThreadKey = useComposerDraftStore((store) => store.draftThreadsByThreadKey);
  const composerDraftsByThreadKey = useComposerDraftStore((store) => store.draftsByThreadKey);
  const unread = useThreadUnreadStore((store) => store.unread);
  const {
    activeDraftThread,
    activeThread: routeActiveThread,
    defaultProjectRef,
    handleNewThread,
  } = useHandleNewThread();
  const defaultThreadEnvMode = useSettings((settings) => settings.defaultThreadEnvMode);

  const selectedId =
    routeTarget?.kind === "draft" ? routeTarget.draftId : (routeTarget?.threadRef.threadId ?? null);

  const projectById = useMemo(
    () =>
      new Map<Project["id"], Project>(projects.map((project: Project) => [project.id, project])),
    [projects],
  );
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
  const sidebarThreadByKey = useMemo(
    () => new Map(sidebarThreads.map((thread) => [sidebarThreadKey(thread), thread])),
    [sidebarThreads],
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
    return threads.flatMap((thread: Thread) => {
      if (thread.archivedAt !== null) {
        return [];
      }
      if (thread.projectId === null) {
        const sidebarThread = sidebarThreadByKey.get(sidebarThreadKey(thread));
        const firstUserMessage = thread.messages
          .find((message) => message.role === "user")
          ?.text?.trim();
        const orchestrationStatus =
          thread.session?.orchestrationStatus ??
          sidebarThread?.session?.orchestrationStatus ??
          null;
        return [
          {
            id: thread.id,
            environmentId: thread.environmentId,
            projectId: null,
            projectCwd: PROJECTLESS_CWD,
            harness: toHarness(thread.modelSelection.instanceId),
            path: PROJECTLESS_CWD,
            cwd: PROJECTLESS_CWD,
            name: thread.title,
            createdAt: thread.createdAt,
            modifiedAt: thread.updatedAt ?? thread.createdAt,
            messageCount: thread.messages.length,
            firstMessage: firstUserMessage || thread.title,
            allMessagesText: thread.messages.map((message) => message.text).join("\n\n"),
            isStreaming: orchestrationStatus === "starting" || orchestrationStatus === "running",
            orchestrationStatus,
            needsAttention: needsSidebarAttention(sidebarThread),
          },
        ];
      }
      const projectKey = projectScopedKeyFor(thread.environmentId, thread.projectId);
      const project = projectKey ? projectByScopedKey.get(projectKey) : undefined;
      if (!project) {
        return [];
      }
      return [toSummary(thread, project, sidebarThreadByKey.get(sidebarThreadKey(thread)))];
    });
  }, [projectByScopedKey, sidebarThreadByKey, threads]);

  const unreadIds = useMemo(
    () => new Set(Object.keys(unread).filter((id) => unread[id])),
    [unread],
  );

  const activeThread = useMemo(
    () =>
      routeThreadId
        ? (threads.find((thread: Thread) => thread.id === routeThreadId) ?? null)
        : null,
    [routeThreadId, threads],
  );
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
  const activeDraftProjectCwd = activeDraftThread
    ? ((activeDraftThread.projectId
        ? projectByScopedKey.get(
            scopedProjectKey(
              scopeProjectRef(activeDraftThread.environmentId, activeDraftThread.projectId),
            ),
          )?.cwd
        : null) ?? null)
    : null;
  const activeThreadProjectCwd = activeThread
    ? ((activeThread.projectId
        ? projectByScopedKey.get(
            scopedProjectKey(scopeProjectRef(activeThread.environmentId, activeThread.projectId)),
          )?.cwd
        : null) ?? null)
    : null;
  const rightWorkbenchPersistenceCwd = activeDraftThread
    ? activeDraftThread.projectId === null
      ? PROJECTLESS_CWD
      : (activeDraftProjectCwd ?? activeDraftThread.worktreePath ?? null)
    : activeThread
      ? activeThread.projectId === null
        ? PROJECTLESS_CWD
        : (activeThreadProjectCwd ?? activeThread.worktreePath ?? null)
      : (defaultProject?.cwd ?? firstProjectCwd);
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
      const thread = threads.find((entry: Thread) => entry.id === id);
      if (thread) {
        const cwd =
          thread.projectId === null
            ? null
            : (thread.worktreePath ?? projectById.get(thread.projectId)?.cwd);
        if (cwd) {
          writeStoredProjectCwd(cwd);
        }
        void navigate({
          to: "/$environmentId/$threadId",
          params: { environmentId: thread.environmentId, threadId: id },
        });
      }
    },
    [clearThreadUnread, drafts, navigate, projectById, threads],
  );

  const prefetchAgent = useCallback(
    (id: string) => {
      if (drafts.some((draft) => draft.id === id)) {
        prefetchDraftNavigation(router, id);
        return;
      }

      const thread = threads.find((entry: Thread) => entry.id === id);
      if (!thread) {
        return;
      }
      if (thread.projectId === null) {
        return;
      }

      prefetchThreadNavigation({
        project: projectById.get(thread.projectId),
        queryClient,
        router,
        thread,
      });
    },
    [drafts, projectById, queryClient, router, threads],
  );

  const startGitAgentAction = useCallback(
    async (action: GitAgentAction) => {
      const activeDraftProject = activeDraftThread
        ? activeDraftThread.projectId
          ? (projectByScopedKey.get(
              scopedProjectKey(
                scopeProjectRef(activeDraftThread.environmentId, activeDraftThread.projectId),
              ),
            ) ?? null)
          : null
        : null;
      const activeThreadProject = activeThread
        ? activeThread.projectId
          ? (projectById.get(activeThread.projectId) ?? null)
          : null
        : null;
      const activeCwdProject = activeCwd
        ? (projects.find((project) => project.cwd === activeCwd) ?? null)
        : null;
      const project =
        activeThreadProject ??
        activeDraftProject ??
        activeCwdProject ??
        defaultProject ??
        projects[0];

      if (!project) {
        toast.error("No project is available for this Git action.");
        return;
      }

      const api = readEnvironmentApi(project.environmentId);
      if (!api) {
        toast.error("Environment API unavailable.");
        return;
      }

      const modelSelection =
        activeThread?.modelSelection ?? project.defaultModelSelection ?? undefined;
      if (!modelSelection) {
        toast.error("Choose a model before running this Git action.");
        return;
      }

      const createdAt = new Date().toISOString();
      const actionDetails = GIT_AGENT_ACTIONS[action];
      const title = actionDetails.label;
      const prompt = actionDetails.prompt;
      const runtimeMode =
        activeThread?.runtimeMode ?? activeDraftThread?.runtimeMode ?? DEFAULT_RUNTIME_MODE;
      const interactionMode =
        activeThread?.interactionMode ??
        activeDraftThread?.interactionMode ??
        DEFAULT_INTERACTION_MODE;
      const targetThread =
        activeThread?.environmentId === project.environmentId &&
        activeThread.projectId === project.id &&
        activeThread.session?.orchestrationStatus !== "starting" &&
        activeThread.session?.orchestrationStatus !== "running"
          ? activeThread
          : null;
      const threadId = targetThread?.id ?? newThreadId();
      const projectScopedBranch =
        activeThread?.projectId === project.id
          ? activeThread.branch
          : activeDraftThread?.projectId === project.id
            ? activeDraftThread.branch
            : null;
      const projectScopedWorktreePath =
        activeThread?.projectId === project.id
          ? activeThread.worktreePath
          : activeDraftThread?.projectId === project.id
            ? activeDraftThread.worktreePath
            : null;

      try {
        if (!targetThread) {
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
            createdAt,
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
        toast.error(error instanceof Error ? error.message : "Failed to start Git action.");
      }
    },
    [
      activeCwd,
      activeDraftThread,
      activeThread,
      defaultProject,
      navigate,
      projectById,
      projectByScopedKey,
      projects,
    ],
  );

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
        panelPersistenceCwd={rightWorkbenchPersistenceCwd}
        environmentId={activeEnvironmentId}
        availableEditors={availableEditors}
        onGitAgentAction={(action) => {
          void startGitAgentAction(action);
        }}
      />
    );
  }

  return (
    <AppShell
      cwd={activeCwd}
      panelPersistenceCwd={rightWorkbenchPersistenceCwd}
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
  panelPersistenceCwd: string | null;
  environmentId: EnvironmentId | null;
  availableEditors: readonly EditorId[];
  onGitAgentAction: (action: GitAgentAction) => void;
}) {
  const git = useEnvironmentGitPanel(props.environmentId, props.cwd);

  return (
    <AppShell
      cwd={props.cwd}
      panelPersistenceCwd={props.panelPersistenceCwd}
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
            <GitPanel git={git} onAgentAction={props.onGitAgentAction} />
          </WorkbenchPanel>
        ),
        terminal: <TerminalWorkbenchPanel cwd={props.cwd} environmentId={props.environmentId} />,
      }}
    />
  );
}
