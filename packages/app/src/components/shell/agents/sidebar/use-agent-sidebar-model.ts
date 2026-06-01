import {
  scopedProjectKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@multi/client-runtime";
import { DEFAULT_PROJECTLESS_CWD, type ScopedProjectRef } from "@multi/contracts";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

import { prefetchDraftNavigation, prefetchThreadNavigation } from "~/app/thread-prefetch";
import {
  startNewThreadFromContext,
  startNewThreadInProjectFromContext,
} from "~/lib/chat-thread-actions";
import { writeStoredProjectCwd } from "~/lib/project-state";
import { getProjectOrderKey, deriveSidebarProjectStateKey } from "~/stores/project-identity";
import {
  type DraftThreadEnvMode,
  type DraftThreadState,
  useComposerDraftStore,
} from "~/stores/chat-drafts";
import { useUiStateStore } from "~/stores/ui-state-store";
import type {
  Project,
  SidebarThreadSummary as StoreSidebarThreadSummary,
  Thread,
} from "~/types";
import type { SidebarDraftSummary, SidebarProjectSummary, SidebarThreadSummary } from "./types";
import { buildProjectChatSections } from "./view-model";

type HandleNewThread = (
  projectRef: ScopedProjectRef,
  options?: {
    branch?: string | null;
    reuseExistingDraft?: boolean;
    worktreePath?: string | null;
    envMode?: DraftThreadEnvMode;
  },
) => Promise<void>;

function projectScopedKeyFor(
  environmentId: Project["environmentId"],
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
): SidebarThreadSummary {
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

export function useAgentSidebarModel(input: {
  activeCwd: string | null;
  activeDraftThread: DraftThreadState | null;
  defaultProjectRef: ScopedProjectRef | null;
  defaultThreadEnvMode: DraftThreadEnvMode;
  handleNewThread: HandleNewThread;
  projects: readonly Project[];
  routeActiveThread: Thread | null;
  sidebarThreads: readonly StoreSidebarThreadSummary[];
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const draftThreadsByThreadKey = useComposerDraftStore((store) => store.draftThreadsByThreadKey);
  const draftSessionVisibilitySignature = useComposerDraftStore((store) => {
    let signature = "";
    for (const [draftId, draftThread] of Object.entries(store.draftThreadsByThreadKey)) {
      if (draftThread.promotedTo != null) {
        continue;
      }
      const composerDraft = store.draftsByThreadKey[draftId];
      if (!composerDraft) {
        continue;
      }
      const imageCount = composerDraft.images.length;
      const persistedAttachmentCount = composerDraft.persistedAttachments.length;
      const hasPrompt = composerDraft.prompt.trim().length > 0;
      if (!hasPrompt && imageCount === 0 && persistedAttachmentCount === 0) {
        continue;
      }
      const firstAttachment = composerDraft.images[0] ?? composerDraft.persistedAttachments[0];
      const firstAttachmentName = firstAttachment?.name ?? "";
      signature += [
        draftId.length,
        draftId,
        hasPrompt ? "1" : "0",
        imageCount,
        persistedAttachmentCount,
        firstAttachmentName.length,
        firstAttachmentName,
      ].join("\u0000");
    }
    return signature;
  });
  const threadLastVisitedAtById = useUiStateStore((store) => store.threadLastVisitedAtById);
  const pinnedThreadKeys = useUiStateStore((store) => store.pinnedThreadKeys);
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const markThreadVisited = useUiStateStore((store) => store.markThreadVisited);

  const projectByScopedKey = useMemo(
    () =>
      new Map(
        input.projects.map((project) => [
          scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
          project,
        ]),
      ),
    [input.projects],
  );

  const drafts = useMemo<SidebarDraftSummary[]>(() => {
    const composerDraftsByThreadKey = useComposerDraftStore.getState().draftsByThreadKey;
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
  }, [draftSessionVisibilitySignature, draftThreadsByThreadKey, projectByScopedKey]);

  const summaries = useMemo(() => {
    return input.sidebarThreads.flatMap((thread) => {
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
  }, [input.sidebarThreads, projectByScopedKey]);

  const unreadIds = useMemo(() => {
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
  }, [input.sidebarThreads, threadLastVisitedAtById]);
  const pinnedThreadKeySet = useMemo(() => new Set(pinnedThreadKeys), [pinnedThreadKeys]);

  const sections = useMemo(() => {
    const projectStateKeyByCwd = new Map(
      input.projects.map((project) => [project.cwd, deriveSidebarProjectStateKey(project)] as const),
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
      input.sidebarThreads.flatMap((thread) =>
        thread.projectId === null
          ? []
          : [scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId))],
      ),
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
        section.environmentId && section.projectId
          ? scopedProjectKey(scopeProjectRef(section.environmentId, section.projectId))
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
      const context = {
        activeDraftThread: input.activeDraftThread,
        activeThread: input.routeActiveThread ?? undefined,
        defaultProjectRef: input.defaultProjectRef,
        defaultThreadEnvMode: input.defaultThreadEnvMode,
        handleNewThread: input.handleNewThread,
      };
      const project =
        cwd && cwd.length > 0 ? input.projects.find((candidate) => candidate.cwd === cwd) : null;
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
      input.activeDraftThread,
      input.defaultProjectRef,
      input.defaultThreadEnvMode,
      input.handleNewThread,
      input.projects,
      input.routeActiveThread,
    ],
  );

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

  return {
    create,
    prefetchAgent,
    sections,
    select,
  };
}
