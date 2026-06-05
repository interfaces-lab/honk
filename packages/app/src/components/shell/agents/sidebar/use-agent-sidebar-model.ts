import {
  scopedProjectKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "~/lib/environment-scope";
import { type ScopedProjectRef } from "@multi/contracts";
import { useNavigate, useRouter } from "@tanstack/react-router";

import {
  openDraft,
  openThread,
  prefetchDraftNavigation,
  prefetchThreadNavigation,
} from "~/app/chat-navigation";
import {
  startNewThreadFromContext,
  startNewThreadInProjectFromContext,
} from "~/lib/chat-thread-actions";
import { writeStoredProjectSelection } from "~/lib/project-state";
import {
  findWorkspaceProjectForSource,
  isSourceForWorkspaceProjectRef,
} from "~/lib/workspace-target";
import { getProjectOrderKey, deriveSidebarProjectStateKey } from "~/stores/project-identity";
import {
  type DraftThreadEnvMode,
  type DraftThreadState,
  useComposerDraftStore,
} from "~/stores/chat-drafts";
import { useUiStateStore } from "~/stores/ui-state-store";
import type { Project, SidebarThreadSummary as StoreSidebarThreadSummary, Thread } from "~/types";
import type { SidebarDraftSummary, SidebarProjectSummary, SidebarThreadSummary } from "./types";
import { buildProjectChatSections } from "./view-model";

type HandleNewThread = (
  projectRef: ScopedProjectRef,
  options?: {
    branch?: string | null;
    reuseExistingDraft?: boolean;
    worktreePath?: string | null;
    envMode?: DraftThreadEnvMode;
    logicalProjectKey?: string | null;
  },
) => Promise<void>;

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
  return false;
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

function toSummaryFromSidebarThread(
  thread: StoreSidebarThreadSummary,
  project: Project | null,
  projectlessCwd: string,
): SidebarThreadSummary {
  const cwd =
    thread.projectId === null
      ? projectlessCwd
      : (thread.worktreePath ?? project?.cwd ?? projectlessCwd);
  const projectCwd = thread.projectId === null ? projectlessCwd : (project?.cwd ?? cwd);
  const orchestrationStatus = thread.session?.orchestrationStatus ?? null;
  return {
    id: thread.id,
    environmentId: thread.environmentId,
    projectId: thread.projectId,
    workspaceProjectRef: project ? scopeProjectRef(project.environmentId, project.id) : null,
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

export function useAgentSidebarModel(input: {
  activeCwd: string | null;
  activeDraftThread: DraftThreadState | null;
  defaultProjectCwd: string | null;
  defaultLogicalProjectKey: string | null;
  defaultProjectRef: ScopedProjectRef | null;
  defaultThreadEnvMode: DraftThreadEnvMode;
  handleNewThread: HandleNewThread;
  projectlessCwd: string;
  projects: readonly Project[];
  routeActiveThread: Thread | null;
  sidebarThreads: readonly StoreSidebarThreadSummary[];
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const draftThreadsByThreadKey = useComposerDraftStore((store) => store.draftThreadsByThreadKey);
  const composerDraftsByThreadKey = useComposerDraftStore((store) => store.draftsByThreadKey);
  const threadLastVisitedAtById = useUiStateStore((store) => store.threadLastVisitedAtById);
  const pinnedThreadKeys = useUiStateStore((store) => store.pinnedThreadKeys);
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const markThreadVisited = useUiStateStore((store) => store.markThreadVisited);
  const projectlessCwd = input.projectlessCwd;

  function persistProjectSelection(project: Project) {
    writeStoredProjectSelection({
      environmentId: project.environmentId,
      projectId: project.id,
      cwd: project.cwd,
    });
  }

  function persistDefaultProjectSelection(): void {
    if (!input.defaultProjectRef || !input.defaultProjectCwd) {
      return;
    }
    writeStoredProjectSelection({
      environmentId: input.defaultProjectRef.environmentId,
      projectId: input.defaultProjectRef.projectId,
      cwd: input.defaultProjectCwd,
    });
  }

  const drafts: SidebarDraftSummary[] = Object.entries(draftThreadsByThreadKey)
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
        const firstAttachment = composerDraft?.images[0] ?? composerDraft?.persistedAttachments[0];
        return [
          {
            id: draftId,
            text: composerDraft?.prompt ?? "",
            attachmentCount:
              (composerDraft?.images.length ?? 0) +
              (composerDraft?.persistedAttachments.length ?? 0),
            firstAttachmentName: firstAttachment?.name ?? null,
            cwd: projectlessCwd,
            environmentId: draftThread.environmentId,
            projectId: null,
            workspaceProjectRef: null,
            projectCwd: projectlessCwd,
            updatedAt: draftThread.createdAt,
          },
        ];
      }
      const project = findWorkspaceProjectForSource(input.projects, draftThread);
      const projectRef = project
        ? scopeProjectRef(project.environmentId, project.id)
        : isSourceForWorkspaceProjectRef({
              projectRef: input.defaultProjectRef,
              source: draftThread,
            })
          ? input.defaultProjectRef
          : null;
      const projectCwd = project?.cwd ?? (projectRef ? input.defaultProjectCwd : null);
      if (!projectRef || !projectCwd) {
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
          cwd: draftThread.worktreePath ?? projectCwd,
          environmentId: draftThread.environmentId,
          projectId: draftThread.projectId,
          workspaceProjectRef: projectRef,
          projectCwd,
          updatedAt: draftThread.createdAt,
        },
      ];
    });

  const summaries = input.sidebarThreads.flatMap((thread) => {
    if (thread.archivedAt !== null) {
      return [];
    }
    if (thread.projectId === null) {
      return [toSummaryFromSidebarThread(thread, null, projectlessCwd)];
    }
    const project = findWorkspaceProjectForSource(input.projects, thread);
    if (project) {
      return [toSummaryFromSidebarThread(thread, project, projectlessCwd)];
    }
    if (
      isSourceForWorkspaceProjectRef({
        projectRef: input.defaultProjectRef,
        source: thread,
      }) &&
      input.defaultProjectCwd
    ) {
      return [
        {
          ...toSummaryFromSidebarThread(thread, null, input.defaultProjectCwd),
          workspaceProjectRef: input.defaultProjectRef,
          projectCwd: input.defaultProjectCwd,
          cwd: thread.worktreePath ?? input.defaultProjectCwd,
          path: thread.worktreePath ?? input.defaultProjectCwd,
        },
      ];
    }
    return [];
  });

  const unreadIds = (() => {
    const ids = new Set<string>();
    for (const thread of input.sidebarThreads) {
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
  })();
  const pinnedThreadKeySet = new Set(pinnedThreadKeys);

  const sections = (() => {
    const projectStateKeyByCwd = new Map(
      input.projects.map(
        (project) => [project.cwd, deriveSidebarProjectStateKey(project)] as const,
      ),
    );
    const projectStateKeyByProjectKey = new Map(
      input.projects.map(
        (project) =>
          [
            scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
            deriveSidebarProjectStateKey(project),
          ] as const,
      ),
    );
    const projectOrderRank = new Map(projectOrder.map((projectKey, index) => [projectKey, index]));
    const projectOrderKeysByProjectStateKey = new Map<string, string[]>();
    for (const project of input.projects) {
      const projectStateKey = deriveSidebarProjectStateKey(project);
      const orderKeys = projectOrderKeysByProjectStateKey.get(projectStateKey);
      if (orderKeys) {
        orderKeys.push(getProjectOrderKey(project));
      } else {
        projectOrderKeysByProjectStateKey.set(projectStateKey, [getProjectOrderKey(project)]);
      }
    }
    const orderedSidebarProjects: SidebarProjectSummary[] = input.projects
      .map((project, index) => ({
        id: project.id,
        environmentId: project.environmentId,
        title: project.name,
        cwd: project.cwd,
        index,
        orderIndex: projectOrderRank.get(getProjectOrderKey(project)) ?? Number.MAX_SAFE_INTEGER,
      }))
      .toSorted((left, right) => {
        const byOrder = left.orderIndex - right.orderIndex;
        if (byOrder !== 0) return byOrder;
        return left.index - right.index;
      })
      .map(({ id, environmentId, title, cwd }) => ({
        id,
        environmentId,
        title,
        cwd,
      }));
    const projectCwds = orderedSidebarProjects.map((project) => project.cwd);
    const projectKeysWithThreads = new Set(
      input.sidebarThreads.flatMap((thread) => {
        const project = findWorkspaceProjectForSource(input.projects, thread);
        return project ? [scopedProjectKey(scopeProjectRef(project.environmentId, project.id))] : [];
      }),
    );
    const retainedSidebarProjects = orderedSidebarProjects.filter((project) =>
      projectKeysWithThreads.has(
        scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
      ),
    );
    return buildProjectChatSections(
      summaries,
      drafts,
      input.activeCwd,
      null,
      unreadIds,
      projectCwds,
      pinnedThreadKeySet,
      retainedSidebarProjects,
    ).map((section) => {
      const sectionProjectKey =
        section.projectRef
          ? scopedProjectKey(section.projectRef)
          : null;
      const projectStateKey =
        (sectionProjectKey ? projectStateKeyByProjectKey.get(sectionProjectKey) : undefined) ??
        (section.projectCwd ? projectStateKeyByCwd.get(section.projectCwd) : undefined);
      const projectOrderKeys = projectStateKey
        ? projectOrderKeysByProjectStateKey.get(projectStateKey)
        : undefined;
      if (!projectStateKey) {
        return section;
      }
      if (!projectOrderKeys) {
        return Object.assign(section, { projectStateKey });
      }
      return Object.assign(section, { projectOrderKeys, projectStateKey });
    });
  })();

  const create = (cwd?: string) => {
    const context = {
      activeDraftThread: input.activeDraftThread,
      activeThread: input.routeActiveThread ?? undefined,
      defaultLogicalProjectKey: input.defaultLogicalProjectKey,
      defaultProjectRef: input.defaultProjectRef,
      defaultThreadEnvMode: input.defaultThreadEnvMode,
      handleNewThread: input.handleNewThread,
      projects: input.projects,
    };
    const project =
      cwd && cwd.length > 0 ? input.projects.find((candidate) => candidate.cwd === cwd) : null;
    if (project) {
      persistProjectSelection(project);
      void startNewThreadInProjectFromContext(
        context,
        scopeProjectRef(project.environmentId, project.id),
      );
      return;
    }
    void startNewThreadFromContext(context);
  };

  const select = (id: string) => {
    const draft = drafts.find((entry) => entry.id === id);
    if (draft) {
      if (draft.projectId !== null) {
        const project = findWorkspaceProjectForSource(input.projects, draft);
        if (project) {
          persistProjectSelection(project);
        } else if (
          isSourceForWorkspaceProjectRef({
            projectRef: input.defaultProjectRef,
            source: draft,
          })
        ) {
          persistDefaultProjectSelection();
        }
      }
      void openDraft(navigate, id);
      return;
    }
    const summary = summaries.find((entry) => entry.id === id);
    if (summary) {
      markThreadVisited(scopedThreadKey(scopeThreadRef(summary.environmentId, summary.id)));
      if (summary.projectId !== null && summary.cwd) {
        const project = findWorkspaceProjectForSource(input.projects, summary);
        if (project) {
          persistProjectSelection(project);
        } else if (
          isSourceForWorkspaceProjectRef({
            projectRef: input.defaultProjectRef,
            source: summary,
          })
        ) {
          persistDefaultProjectSelection();
        }
      }
      void openThread(navigate, scopeThreadRef(summary.environmentId, summary.id));
    }
  };

  const prefetchAgent = (id: string) => {
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
  };

  return {
    create,
    prefetchAgent,
    sections,
    select,
  };
}
