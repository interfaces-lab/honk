import { scopedProjectKey, scopeProjectRef } from "@multi/client-runtime";
import type { EditorId, EnvironmentId } from "@multi/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { Outlet, useNavigate, useParams, useRouter } from "@tanstack/react-router";
import { type ReactNode, useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { prefetchDraftNavigation, prefetchThreadNavigation } from "~/app/thread-prefetch";
import { BrowserPanel } from "~/components/browser-panel";
import { useCommandPaletteStore } from "~/command-palette-store";
import { isElectron } from "~/env";
import { useEnvironmentGitPanel } from "~/hooks/use-environment-git";
import { useHandleNewThread } from "~/hooks/use-handle-new-thread";
import { useRouteThreadId } from "~/hooks/use-route-thread-id";
import { useServerAvailableEditors } from "~/rpc/server-state";
import { useComposerDraftStore } from "~/composer-draft-store";
import { startNewThreadFromContext } from "~/lib/chat-thread-actions";
import { shellPanelsActions } from "~/lib/shell-panels-store";
import { useThreadUnreadStore } from "~/lib/thread-unread-store";
import { type SessionListSummary } from "~/lib/ui-session-types";
import { writeStoredWorkspaceCwd } from "~/lib/workspace-state";
import { resolveWorkbenchBrowserThreadId } from "~/lib/workbench-browser-scope";
import {
  buildWorkspaceChatSections,
  type SidebarDraftSummary,
} from "~/lib/sidebar-chat-view-model";
import { cn } from "~/lib/utils";
import { resolveSidebarNewThreadEnvMode } from "~/lib/thread-sidebar";
import { useSettings } from "~/hooks/use-settings";
import {
  selectProjectsAcrossEnvironments,
  selectThreadsAcrossEnvironments,
  useStore,
} from "~/store";
import type { Project, Thread } from "~/types";
import { resolveThreadRouteTarget } from "~/thread-routes";
import { GitPanel } from "./shell/git/panel";
import { WorkspaceFilesPanel } from "./shell/files/workspace-files-panel";
import { AppShell } from "./shell/shell/app";
import { WorkbenchPanel } from "./shell/shell/workbench-panel";
import { ShellSettingsProvider } from "./shell/settings/context";
import { SettingsNavRail } from "./shell/settings/nav-rail";
import { ShellSidebarFooter } from "./shell/sidebar/footer";
import { ShellSidebarHeader } from "./shell/sidebar/header";
import { ThreadRail } from "./shell/sidebar/thread-rail";
import { TerminalPanel } from "./shell/terminal/panel";

function toHarness(provider: Thread["modelSelection"]["provider"]): "codex" | "claudeCode" {
  return provider === "claudeAgent" ? "claudeCode" : "codex";
}

function toSummary(thread: Thread, project: Project | undefined): SessionListSummary {
  const firstUserMessage = thread.messages.find((message) => message.role === "user")?.text?.trim();
  const cwd = thread.worktreePath ?? project?.cwd ?? "";
  return {
    id: thread.id,
    harness: toHarness(thread.modelSelection.provider),
    path: cwd,
    cwd,
    name: thread.title,
    createdAt: thread.createdAt,
    modifiedAt: thread.updatedAt ?? thread.createdAt,
    messageCount: thread.messages.length,
    firstMessage: firstUserMessage || thread.title,
    allMessagesText: thread.messages.map((message) => message.text).join("\n\n"),
    isStreaming:
      thread.session?.orchestrationStatus === "starting" ||
      thread.session?.orchestrationStatus === "running",
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
    <div className="thread-rail-pad flex min-h-0 flex-1 flex-col px-0">
      <SettingsNavRail />
      <ShellSidebarFooter settings />
    </div>
  );

  return (
    <AppShell
      cwd={firstProjectCwd}
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

  const drafts = useMemo<SidebarDraftSummary[]>(() => {
    return Object.entries(draftThreadsByThreadKey)
      .filter(([, draftThread]) => draftThread.promotedTo == null)
      .map(([draftId, draftThread]) => {
        const composerDraft = composerDraftsByThreadKey[draftId];
        const project = projectByScopedKey.get(
          scopedProjectKey(scopeProjectRef(draftThread.environmentId, draftThread.projectId)),
        );
        const firstAttachment = composerDraft?.images[0] ?? composerDraft?.persistedAttachments[0];
        const attachmentCount =
          (composerDraft?.images.length ?? 0) + (composerDraft?.persistedAttachments.length ?? 0);
        return {
          id: draftId,
          text: composerDraft?.prompt ?? "",
          attachmentCount,
          firstAttachmentName: firstAttachment?.name ?? null,
          cwd: draftThread.worktreePath ?? project?.cwd ?? "/",
          updatedAt: draftThread.createdAt,
        };
      });
  }, [composerDraftsByThreadKey, draftThreadsByThreadKey, projectByScopedKey]);

  const summaries = useMemo(() => {
    return Object.fromEntries(
      threads
        .filter((thread: Thread) => thread.archivedAt === null)
        .map((thread: Thread) => [thread.id, toSummary(thread, projectById.get(thread.projectId))]),
    ) as Record<string, SessionListSummary>;
  }, [projectById, threads]);

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
    ? (activeDraftThread.worktreePath ??
      projectByScopedKey.get(
        scopedProjectKey(
          scopeProjectRef(activeDraftThread.environmentId, activeDraftThread.projectId),
        ),
      )?.cwd ??
      null)
    : null;
  const activeCwd =
    activeDraftCwd ??
    (activeThread
      ? (activeThread.worktreePath ?? projectById.get(activeThread.projectId)?.cwd ?? null)
      : firstProjectCwd);
  const activeEnvironmentId =
    activeThread?.environmentId ??
    projects.find((project) => project.cwd === activeCwd)?.environmentId ??
    projects[0]?.environmentId ??
    null;

  const sections = useMemo(
    () => buildWorkspaceChatSections(summaries, drafts, activeCwd, null, unreadIds),
    [activeCwd, drafts, summaries, unreadIds],
  );

  const create = useCallback(() => {
    void startNewThreadFromContext({
      activeDraftThread,
      activeThread: routeActiveThread,
      defaultProjectRef,
      defaultThreadEnvMode: resolveSidebarNewThreadEnvMode({
        defaultEnvMode: defaultThreadEnvMode,
      }),
      handleNewThread,
    });
  }, [
    activeDraftThread,
    defaultProjectRef,
    defaultThreadEnvMode,
    handleNewThread,
    routeActiveThread,
  ]);

  const clearThreadUnread = useThreadUnreadStore((store) => store.clear);

  const select = useCallback(
    (id: string) => {
      const draft = drafts.find((entry) => entry.id === id);
      if (draft) {
        writeStoredWorkspaceCwd(draft.cwd);
        void navigate({ to: "/draft/$draftId", params: { draftId: id } });
        return;
      }
      clearThreadUnread(id);
      const thread = threads.find((entry: Thread) => entry.id === id);
      if (thread) {
        const cwd = thread.worktreePath ?? projectById.get(thread.projectId)?.cwd;
        if (cwd) {
          writeStoredWorkspaceCwd(cwd);
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

      prefetchThreadNavigation({
        project: projectById.get(thread.projectId),
        queryClient,
        router,
        thread,
      });
    },
    [drafts, projectById, queryClient, router, threads],
  );

  const chatLeft = (
    <div className="agent-window__left-content thread-rail-pad flex min-h-0 flex-1 flex-col px-0">
      <div className={cn("agent-window__sidebar-chrome shrink-0", isElectron && "no-drag")}>
        <ShellSidebarHeader
          onNewChat={create}
          onAddProject={openAddProject}
          {...(isElectron ? {} : { onCollapse: () => shellPanelsActions.toggleLeft(activeCwd) })}
        />
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

function DesktopChatShellHost(props: {
  left: ReactNode;
  center: ReactNode;
  routeThreadId: string | null;
  cwd: string | null;
  environmentId: EnvironmentId | null;
  availableEditors: readonly EditorId[];
}) {
  const git = useEnvironmentGitPanel(props.environmentId);
  const browserThreadId = resolveWorkbenchBrowserThreadId(props.cwd);

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
            <WorkspaceFilesPanel
              cwd={props.cwd}
              environmentId={props.environmentId}
              availableEditors={props.availableEditors}
            />
          </WorkbenchPanel>
        ),
        git: (
          <WorkbenchPanel>
            <GitPanel git={git} />
          </WorkbenchPanel>
        ),
        terminal: (
          <WorkbenchPanel>
            <TerminalPanel cwd={props.cwd} environmentId={props.environmentId} />
          </WorkbenchPanel>
        ),
        browser: (
          <WorkbenchPanel>
            <BrowserPanel
              mode="sidebar"
              threadId={browserThreadId}
              onClosePanel={() => {
                setRightPanelOpen(props.cwd, false);
              }}
            />
          </WorkbenchPanel>
        ),
      }}
    />
  );
}

function setRightPanelOpen(cwd: string | null, open: boolean): void {
  shellPanelsActions.setRightOpen(cwd, open);
  shellPanelsActions.setMuted(cwd, !open);
}
