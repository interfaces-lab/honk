import {
  scopedProjectKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "~/lib/environment-scope";
import type { EnvironmentId, ProjectId, ScopedProjectRef } from "@multi/contracts";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";

import {
  openDraft,
  openThread,
  prefetchDraftNavigation,
  prefetchThreadNavigation,
} from "~/app/chat-navigation";
import {
  type ChatThreadActionContext,
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
  type ComposerThreadDraftState,
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

type ActiveThreadActionSource = Pick<
  Thread,
  "environmentId" | "projectId" | "branch" | "worktreePath"
>;

interface VisibleSidebarDraftShell {
  readonly id: string;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId | null;
  readonly createdAt: string;
  readonly worktreePath: string | null;
}

interface SidebarThreadVisitInput {
  readonly id: StoreSidebarThreadSummary["id"];
  readonly key: string;
  readonly latestReadableAt: string | null | undefined;
}

type VisibleSidebarDraftShellTuple = readonly [draftId: string, draftThread: DraftThreadState];
type VisibleSidebarDraftShellEntry = string | DraftThreadState;

function composerDraftHasVisibleContent(draft: ComposerThreadDraftState | undefined): boolean {
  return Boolean(
    draft &&
    (draft.prompt.trim().length > 0 ||
      draft.images.length > 0 ||
      draft.persistedAttachments.length > 0),
  );
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
  routeActiveThread: ActiveThreadActionSource | null;
  selectedId: string | null;
  sidebarThreads: readonly StoreSidebarThreadSummary[];
}) {
  const router = useRouter();
  const visibleDraftShellEntries = useComposerDraftStore(
    useShallow((store) => {
      const entries: VisibleSidebarDraftShellEntry[] = [];
      for (const [draftId, draftThread] of Object.entries(store.draftThreadsByThreadKey)) {
        if (draftThread.promotedTo != null) {
          continue;
        }
        if (!composerDraftHasVisibleContent(store.draftsByThreadKey[draftId])) {
          continue;
        }
        entries.push(...([draftId, draftThread] satisfies VisibleSidebarDraftShellTuple));
      }
      return entries;
    }),
  );
  const visibleDraftShells = useMemo(() => {
    const shells: VisibleSidebarDraftShell[] = [];
    for (let index = 0; index < visibleDraftShellEntries.length; index += 2) {
      const draftId = visibleDraftShellEntries[index];
      const draftThread = visibleDraftShellEntries[index + 1];
      if (typeof draftId !== "string" || typeof draftThread === "string" || !draftThread) {
        continue;
      }
      shells.push({
        id: draftId,
        environmentId: draftThread.environmentId,
        projectId: draftThread.projectId,
        createdAt: draftThread.createdAt,
        worktreePath: draftThread.worktreePath,
      });
    }
    return shells;
  }, [visibleDraftShellEntries]);
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const markThreadVisited = useUiStateStore((store) => store.markThreadVisited);
  const projectlessCwd = input.projectlessCwd;
  const defaultProjectEnvironmentId = input.defaultProjectRef?.environmentId ?? null;
  const defaultProjectId = input.defaultProjectRef?.projectId ?? null;
  const defaultProjectRef = useMemo(
    () =>
      defaultProjectEnvironmentId && defaultProjectId
        ? scopeProjectRef(defaultProjectEnvironmentId, defaultProjectId)
        : null,
    [defaultProjectEnvironmentId, defaultProjectId],
  );

  const newThreadContextRef = useRef<ChatThreadActionContext>({
    activeDraftThread: input.activeDraftThread,
    activeThread: input.routeActiveThread ?? undefined,
    defaultLogicalProjectKey: input.defaultLogicalProjectKey,
    defaultProjectRef,
    defaultThreadEnvMode: input.defaultThreadEnvMode,
    handleNewThread: input.handleNewThread,
    projects: input.projects,
  });
  newThreadContextRef.current = {
    activeDraftThread: input.activeDraftThread,
    activeThread: input.routeActiveThread ?? undefined,
    defaultLogicalProjectKey: input.defaultLogicalProjectKey,
    defaultProjectRef,
    defaultThreadEnvMode: input.defaultThreadEnvMode,
    handleNewThread: input.handleNewThread,
    projects: input.projects,
  };

  const persistProjectSelection = useCallback((project: Project) => {
    writeStoredProjectSelection({
      environmentId: project.environmentId,
      projectId: project.id,
      cwd: project.cwd,
    });
  }, []);

  const persistDefaultProjectSelection = useCallback(() => {
    if (!defaultProjectRef || !input.defaultProjectCwd) {
      return;
    }
    writeStoredProjectSelection({
      environmentId: defaultProjectRef.environmentId,
      projectId: defaultProjectRef.projectId,
      cwd: input.defaultProjectCwd,
    });
  }, [defaultProjectRef, input.defaultProjectCwd]);

  const drafts: SidebarDraftSummary[] = useMemo(
    () =>
      visibleDraftShells.flatMap((draftShell): SidebarDraftSummary[] => {
        if (draftShell.projectId === null) {
          return [
            {
              id: draftShell.id,
              cwd: projectlessCwd,
              environmentId: draftShell.environmentId,
              projectId: null,
              workspaceProjectRef: null,
              projectCwd: projectlessCwd,
              updatedAt: draftShell.createdAt,
            },
          ];
        }
        const project = findWorkspaceProjectForSource(input.projects, draftShell);
        const projectRef = project
          ? scopeProjectRef(project.environmentId, project.id)
          : isSourceForWorkspaceProjectRef({
                projectRef: defaultProjectRef,
                source: draftShell,
              })
            ? defaultProjectRef
            : null;
        const projectCwd = project?.cwd ?? (projectRef ? input.defaultProjectCwd : null);
        if (!projectRef || !projectCwd) {
          return [];
        }
        return [
          {
            id: draftShell.id,
            cwd: draftShell.worktreePath ?? projectCwd,
            environmentId: draftShell.environmentId,
            projectId: draftShell.projectId,
            workspaceProjectRef: projectRef,
            projectCwd,
            updatedAt: draftShell.createdAt,
          },
        ];
      }),
    [
      defaultProjectRef,
      input.defaultProjectCwd,
      input.projects,
      projectlessCwd,
      visibleDraftShells,
    ],
  );

  const summaries = useMemo(
    () =>
      input.sidebarThreads.flatMap((thread) => {
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
            projectRef: defaultProjectRef,
            source: thread,
          }) &&
          input.defaultProjectCwd
        ) {
          return [
            {
              ...toSummaryFromSidebarThread(thread, null, input.defaultProjectCwd),
              workspaceProjectRef: defaultProjectRef,
              projectCwd: input.defaultProjectCwd,
              cwd: thread.worktreePath ?? input.defaultProjectCwd,
              path: thread.worktreePath ?? input.defaultProjectCwd,
            },
          ];
        }
        return [];
      }),
    [
      defaultProjectRef,
      input.defaultProjectCwd,
      input.projects,
      input.sidebarThreads,
      projectlessCwd,
    ],
  );

  const sidebarThreadVisitInputs = useMemo(
    () =>
      input.sidebarThreads.map((thread): SidebarThreadVisitInput => {
        const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
        return {
          id: thread.id,
          key: threadKey,
          latestReadableAt: thread.latestTurn?.completedAt ?? null,
        };
      }),
    [input.sidebarThreads],
  );
  const sidebarThreadVisitedAt = useUiStateStore(
    useShallow((store) =>
      sidebarThreadVisitInputs.map((thread) => store.threadLastVisitedAtById[thread.key] ?? null),
    ),
  );
  const pinnedSidebarThreadKeys = useUiStateStore(
    useShallow((store) => {
      const pinnedThreadKeys = new Set(store.pinnedThreadKeys);
      return sidebarThreadVisitInputs.flatMap((thread) =>
        pinnedThreadKeys.has(thread.key) ? [thread.key] : [],
      );
    }),
  );

  const unreadIds = useMemo(() => {
    const ids = new Set<string>();
    for (let index = 0; index < sidebarThreadVisitInputs.length; index += 1) {
      const thread = sidebarThreadVisitInputs[index];
      if (!thread) {
        continue;
      }
      if (isUnreadFromVisitBoundary(thread.latestReadableAt, sidebarThreadVisitedAt[index])) {
        ids.add(thread.id);
      }
    }
    return ids;
  }, [sidebarThreadVisitInputs, sidebarThreadVisitedAt]);
  const pinnedThreadKeySet = useMemo(
    () => new Set(pinnedSidebarThreadKeys),
    [pinnedSidebarThreadKeys],
  );

  const sections = useMemo(() => {
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
        return project
          ? [scopedProjectKey(scopeProjectRef(project.environmentId, project.id))]
          : [];
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
      const sectionProjectKey = section.projectRef ? scopedProjectKey(section.projectRef) : null;
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
  }, [
    drafts,
    input.activeCwd,
    input.projects,
    input.sidebarThreads,
    pinnedThreadKeySet,
    projectOrder,
    summaries,
    unreadIds,
  ]);

  const create = useCallback(
    (cwd?: string) => {
      const context = newThreadContextRef.current;
      const project =
        cwd && cwd.length > 0 ? context.projects.find((candidate) => candidate.cwd === cwd) : null;
      if (project) {
        persistProjectSelection(project);
        void startNewThreadInProjectFromContext(
          context,
          scopeProjectRef(project.environmentId, project.id),
        );
        return;
      }
      void startNewThreadFromContext(context);
    },
    [persistProjectSelection],
  );

  const select = useCallback(
    (id: string) => {
      if (id === input.selectedId) {
        return;
      }
      const draft = drafts.find((entry) => entry.id === id);
      if (draft) {
        if (draft.projectId !== null) {
          const project = findWorkspaceProjectForSource(input.projects, draft);
          if (project) {
            persistProjectSelection(project);
          } else if (
            isSourceForWorkspaceProjectRef({
              projectRef: defaultProjectRef,
              source: draft,
            })
          ) {
            persistDefaultProjectSelection();
          }
        }
        void openDraft(router, id);
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
              projectRef: defaultProjectRef,
              source: summary,
            })
          ) {
            persistDefaultProjectSelection();
          }
        }
        void openThread(router, scopeThreadRef(summary.environmentId, summary.id));
      }
    },
    [
      drafts,
      defaultProjectRef,
      input.projects,
      input.selectedId,
      markThreadVisited,
      persistDefaultProjectSelection,
      persistProjectSelection,
      router,
      summaries,
    ],
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

  return useMemo(
    () => ({
      create,
      prefetchAgent,
      sections,
      select,
    }),
    [create, prefetchAgent, sections, select],
  );
}
