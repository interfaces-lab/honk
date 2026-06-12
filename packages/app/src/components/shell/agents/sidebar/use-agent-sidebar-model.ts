import {
  scopedProjectKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "~/lib/environment-scope";
import type { EnvironmentId, ProjectId, ScopedProjectRef } from "@honk/contracts";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";

import {
  openDraft,
  openThread,
  prefetchDraftNavigation,
  prefetchThreadNavigation,
} from "~/app/chat-navigation";
import { retainThreadDetailSubscription } from "~/environments/runtime/service";
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
import { useThreadSendIntentStore } from "~/stores/thread-send-intent-store";
import { type SidebarThreadFilter, useUiStateStore } from "~/stores/ui-state-store";
import type { Project, SidebarThreadSummary as StoreSidebarThreadSummary, Thread } from "~/types";
import type { SidebarDraftSummary, SidebarProjectSummary, SidebarThreadSummary } from "./types";
import { buildProjectChatSections, threadState } from "./view-model";

type HandleNewThread = (
  projectRef: ScopedProjectRef,
  options?: {
    branch?: string | null;
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
  readonly updatedAt: string;
  readonly worktreePath: string | null;
  readonly submitting: boolean;
  readonly title: string | null;
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

export function needsSidebarAttention(
  sidebarThread: StoreSidebarThreadSummary | undefined,
): boolean {
  if (!sidebarThread) return false;
  if (sidebarThread.hasPendingApprovals || sidebarThread.hasPendingUserInput) {
    return true;
  }
  if (
    sidebarThread.session?.status === "running" ||
    sidebarThread.session?.status === "connecting" ||
    sidebarThread.latestTurn?.state === "running"
  ) {
    return false;
  }
  return sidebarThread.hasActionableProposedPlan;
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

export function getSidebarThreadModifiedAt(
  thread: Pick<StoreSidebarThreadSummary, "createdAt" | "latestUserMessageAt" | "updatedAt">,
): string {
  return thread.latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt;
}

/**
 * Empty filters show every non-archived thread. Status filters narrow by the
 * row's derived state; "archived" opts archived threads into the list.
 */
function summaryMatchesThreadFilters(
  summary: SidebarThreadSummary,
  filters: readonly SidebarThreadFilter[],
): boolean {
  if (summary.archived && !filters.includes("archived")) {
    return false;
  }
  const statusFilters = filters.filter((filter) => filter !== "archived");
  if (statusFilters.length === 0) {
    return true;
  }
  return statusFilters.includes(threadState(summary));
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
    modifiedAt: getSidebarThreadModifiedAt(thread),
    archived: thread.archivedAt !== null,
    latestReadableAt: thread.latestTurn?.completedAt ?? null,
    messageCount: 0,
    firstMessage: thread.title,
    isStreaming: orchestrationStatus === "starting" || orchestrationStatus === "running",
    orchestrationStatus,
    latestTurnState: thread.latestTurn?.state ?? null,
    needsAttention: needsSidebarAttention(thread),
  };
}

export function useAgentSidebarModel(input: {
  activeCwd: string | null;
  activeDraftThread: DraftThreadState | null;
  selectedProjectCwd: string | null;
  selectedLogicalProjectKey: string | null;
  selectedProjectRef: ScopedProjectRef | null;
  threadEnvMode: DraftThreadEnvMode;
  handleNewThread: HandleNewThread;
  projectlessCwd: string;
  projects: readonly Project[];
  routeActiveThread: ActiveThreadActionSource | null;
  selectedId: string | null;
  sidebarThreads: readonly StoreSidebarThreadSummary[];
}) {
  const router = useRouter();
  const sidebarThreadKeySet = useMemo(
    () =>
      new Set(
        input.sidebarThreads.map((thread) =>
          scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
        ),
      ),
    [input.sidebarThreads],
  );
  const localSendArtifactEntries = useThreadSendIntentStore(
    useShallow((store) => {
      const entries: string[] = [];
      const seenThreadKeys = new Set<string>();
      for (const [threadKey, intents] of Object.entries(store.sendIntentsByThreadKey)) {
        const title = intents?.at(-1)?.text.trim() ?? "";
        entries.push(threadKey, title);
        seenThreadKeys.add(threadKey);
      }
      for (const [threadKey, dispatch] of Object.entries(store.localDispatchByThreadKey)) {
        if (!dispatch || seenThreadKeys.has(threadKey)) {
          continue;
        }
        entries.push(threadKey, "");
      }
      return entries;
    }),
  );
  const localSendTitleByThreadKey = useMemo(() => {
    const titles = new Map<string, string | null>();
    for (let index = 0; index < localSendArtifactEntries.length; index += 2) {
      const threadKey = localSendArtifactEntries[index];
      const title = localSendArtifactEntries[index + 1];
      if (!threadKey) {
        continue;
      }
      titles.set(threadKey, title?.trim() || null);
    }
    return titles;
  }, [localSendArtifactEntries]);
  const visibleDraftShellEntries = useComposerDraftStore(
    useShallow((store) => {
      const entries: VisibleSidebarDraftShellEntry[] = [];
      for (const [draftId, draftThread] of Object.entries(store.draftThreadsByThreadKey)) {
        const promotedThreadKey = draftThread.promotedTo
          ? scopedThreadKey(draftThread.promotedTo)
          : null;
        const draftThreadKey = scopedThreadKey(
          scopeThreadRef(draftThread.environmentId, draftThread.threadId),
        );
        const hasSidebarThread = promotedThreadKey
          ? sidebarThreadKeySet.has(promotedThreadKey)
          : sidebarThreadKeySet.has(draftThreadKey);
        const hasLocalSendArtifact =
          localSendTitleByThreadKey.has(draftThreadKey) ||
          (promotedThreadKey !== null && localSendTitleByThreadKey.has(promotedThreadKey));
        if (hasSidebarThread) {
          continue;
        }
        if (
          draftThread.promotedTo == null &&
          !hasLocalSendArtifact &&
          !composerDraftHasVisibleContent(store.draftsByThreadKey[draftId])
        ) {
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
      const promotedThreadKey = draftThread.promotedTo
        ? scopedThreadKey(draftThread.promotedTo)
        : null;
      const draftThreadKey = scopedThreadKey(
        scopeThreadRef(draftThread.environmentId, draftThread.threadId),
      );
      const localSendTitle =
        (promotedThreadKey ? localSendTitleByThreadKey.get(promotedThreadKey) : undefined) ??
        localSendTitleByThreadKey.get(draftThreadKey) ??
        null;
      const hasLocalSendArtifact =
        localSendTitleByThreadKey.has(draftThreadKey) ||
        (promotedThreadKey !== null && localSendTitleByThreadKey.has(promotedThreadKey));
      shells.push({
        id: draftId,
        environmentId: draftThread.environmentId,
        projectId: draftThread.projectId,
        createdAt: draftThread.createdAt,
        updatedAt: draftThread.updatedAt,
        worktreePath: draftThread.worktreePath,
        submitting: draftThread.promotedTo != null || hasLocalSendArtifact,
        title: draftThread.promotedTitle ?? localSendTitle,
      });
    }
    return shells;
  }, [localSendTitleByThreadKey, visibleDraftShellEntries]);
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const markThreadVisited = useUiStateStore((store) => store.markThreadVisited);
  const sidebarThreadFilters = useUiStateStore((store) => store.sidebarThreadFilters);
  const projectlessCwd = input.projectlessCwd;
  const selectedProjectEnvironmentId = input.selectedProjectRef?.environmentId ?? null;
  const selectedProjectId = input.selectedProjectRef?.projectId ?? null;
  const selectedProjectRef = useMemo(
    () =>
      selectedProjectEnvironmentId && selectedProjectId
        ? scopeProjectRef(selectedProjectEnvironmentId, selectedProjectId)
        : null,
    [selectedProjectEnvironmentId, selectedProjectId],
  );

  const newThreadContextRef = useRef<ChatThreadActionContext>({
    activeDraftThread: input.activeDraftThread,
    activeThread: input.routeActiveThread ?? undefined,
    selectedLogicalProjectKey: input.selectedLogicalProjectKey,
    selectedProjectRef,
    threadEnvMode: input.threadEnvMode,
    handleNewThread: input.handleNewThread,
    projects: input.projects,
  });
  newThreadContextRef.current = {
    activeDraftThread: input.activeDraftThread,
    activeThread: input.routeActiveThread ?? undefined,
    selectedLogicalProjectKey: input.selectedLogicalProjectKey,
    selectedProjectRef,
    threadEnvMode: input.threadEnvMode,
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
    if (!selectedProjectRef || !input.selectedProjectCwd) {
      return;
    }
    writeStoredProjectSelection({
      environmentId: selectedProjectRef.environmentId,
      projectId: selectedProjectRef.projectId,
      cwd: input.selectedProjectCwd,
    });
  }, [selectedProjectRef, input.selectedProjectCwd]);

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
              title: draftShell.title,
              state: draftShell.submitting ? "running" : "draft",
              updatedAt: draftShell.updatedAt,
            },
          ];
        }
        const project = findWorkspaceProjectForSource(input.projects, draftShell);
        const projectRef = project
          ? scopeProjectRef(project.environmentId, project.id)
          : isSourceForWorkspaceProjectRef({
                projectRef: selectedProjectRef,
                source: draftShell,
              })
            ? selectedProjectRef
            : null;
        const projectCwd = project?.cwd ?? (projectRef ? input.selectedProjectCwd : null);
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
            title: draftShell.title,
            state: draftShell.submitting ? "running" : "draft",
            updatedAt: draftShell.updatedAt,
          },
        ];
      }),
    [
      selectedProjectRef,
      input.selectedProjectCwd,
      input.projects,
      projectlessCwd,
      visibleDraftShells,
    ],
  );

  const summaries = useMemo(
    () =>
      input.sidebarThreads.flatMap((thread) => {
        const summary = ((): SidebarThreadSummary | null => {
          if (thread.projectId === null) {
            return toSummaryFromSidebarThread(thread, null, projectlessCwd);
          }
          const project = findWorkspaceProjectForSource(input.projects, thread);
          if (project) {
            return toSummaryFromSidebarThread(thread, project, projectlessCwd);
          }
          if (
            isSourceForWorkspaceProjectRef({
              projectRef: selectedProjectRef,
              source: thread,
            }) &&
            input.selectedProjectCwd
          ) {
            return {
              ...toSummaryFromSidebarThread(thread, null, input.selectedProjectCwd),
              workspaceProjectRef: selectedProjectRef,
              projectCwd: input.selectedProjectCwd,
              cwd: thread.worktreePath ?? input.selectedProjectCwd,
              path: thread.worktreePath ?? input.selectedProjectCwd,
            };
          }
          return null;
        })();
        return summary && summaryMatchesThreadFilters(summary, sidebarThreadFilters)
          ? [summary]
          : [];
      }),
    [
      selectedProjectRef,
      input.selectedProjectCwd,
      input.projects,
      input.sidebarThreads,
      projectlessCwd,
      sidebarThreadFilters,
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
        void openDraft(router, id);
        setTimeout(() => {
          if (draft.projectId !== null) {
            const project = findWorkspaceProjectForSource(input.projects, draft);
            if (project) {
              persistProjectSelection(project);
            } else if (
              isSourceForWorkspaceProjectRef({
                projectRef: selectedProjectRef,
                source: draft,
              })
            ) {
              persistDefaultProjectSelection();
            }
          }
        }, 0);
        return;
      }
      const summary = summaries.find((entry) => entry.id === id);
      if (summary) {
        const threadRef = scopeThreadRef(summary.environmentId, summary.id);
        void openThread(router, threadRef);
        const releaseThreadDetail = retainThreadDetailSubscription(
          threadRef.environmentId,
          threadRef.threadId,
        );
        setTimeout(releaseThreadDetail, 10_000);
        setTimeout(() => {
          markThreadVisited(scopedThreadKey(threadRef));
          if (summary.projectId !== null && summary.cwd) {
            const project = findWorkspaceProjectForSource(input.projects, summary);
            if (project) {
              persistProjectSelection(project);
            } else if (
              isSourceForWorkspaceProjectRef({
                projectRef: selectedProjectRef,
                source: summary,
              })
            ) {
              persistDefaultProjectSelection();
            }
          }
        }, 0);
      }
    },
    [
      drafts,
      selectedProjectRef,
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
      const draft = drafts.find((entry) => entry.id === id);
      if (draft) {
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
