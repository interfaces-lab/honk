import { scopedProjectKey } from "~/lib/environment-scope";
import { type ScopedProjectRef } from "@honk/contracts";
import { useRouter } from "@tanstack/react-router";
import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { type DraftThreadEnvMode, DraftId, useComposerDraftStore } from "../stores/chat-drafts";
import { deriveLogicalProjectKey } from "../stores/project-identity";
import { type AppState, selectProjectsAcrossEnvironments, useStore } from "../stores/thread-store";
import { selectThreadWorkspaceSurfaceByRef } from "../stores/thread-selectors";
import { readChatRouteTarget, useChatRouteTarget } from "~/app/chat-route-state";
import { clearNewThreadDraftSendArtifacts, openDraft } from "~/app/chat-navigation";
import type { AppRouter } from "~/router";
import { useSelectedWorkspaceProject } from "../lib/selected-workspace-project";
import { newThreadId } from "../lib/utils";
import { DEFAULT_INTERACTION_MODE } from "../types";

export interface NewThreadActionOptions {
  readonly branch?: string | null;
  readonly worktreePath?: string | null;
  readonly envMode?: DraftThreadEnvMode;
  readonly logicalProjectKey?: string | null;
}

export async function openNewThreadWithRouter(
  router: AppRouter,
  projectRef: ScopedProjectRef,
  options?: NewThreadActionOptions,
): Promise<void> {
  const store = useComposerDraftStore.getState();
  const currentRouteTarget = readChatRouteTarget(router);
  const projects = selectProjectsAcrossEnvironments(useStore.getState());
  const project = projects.find(
    (candidate) =>
      candidate.id === projectRef.projectId && candidate.environmentId === projectRef.environmentId,
  );
  const logicalProjectKey =
    options?.logicalProjectKey?.trim() ||
    (project ? deriveLogicalProjectKey(project) : scopedProjectKey(projectRef));

  const unsentDraft =
    store.getDraftSessionByLogicalProjectKey(logicalProjectKey) ??
    store.getDraftSessionByProjectRef(projectRef);

  if (unsentDraft && unsentDraft.promotedTo == null) {
    const alreadyOnUnsentDraft =
      currentRouteTarget?.kind === "draft" &&
      currentRouteTarget.draftId === unsentDraft.draftId &&
      unsentDraft.environmentId === projectRef.environmentId &&
      unsentDraft.projectId === projectRef.projectId;

    if (alreadyOnUnsentDraft) {
      clearNewThreadDraftSendArtifacts(unsentDraft.draftId);
      return;
    }

    if (
      options?.branch !== undefined ||
      options?.worktreePath !== undefined ||
      options?.envMode !== undefined
    ) {
      store.setLogicalProjectDraftThreadId(logicalProjectKey, projectRef, unsentDraft.draftId, {
        threadId: unsentDraft.threadId,
        createdAt: unsentDraft.createdAt,
        interactionMode: unsentDraft.interactionMode,
        branch: options.branch ?? unsentDraft.branch,
        worktreePath: options.worktreePath ?? unsentDraft.worktreePath,
        envMode: options.envMode ?? unsentDraft.envMode,
      });
    }

    await openDraft(router, unsentDraft.draftId);
    return;
  }

  const draftId = DraftId.make(
    `new-thread-draft:project:${projectRef.environmentId}:${projectRef.projectId}`,
  );
  store.setLogicalProjectDraftThreadId(logicalProjectKey, projectRef, draftId, {
    threadId: newThreadId(),
    createdAt: new Date().toISOString(),
    interactionMode: DEFAULT_INTERACTION_MODE,
    branch: options?.branch ?? null,
    worktreePath: options?.worktreePath ?? null,
    envMode: options?.envMode ?? "local",
  });
  store.clearComposerContent(draftId);
  await openDraft(router, draftId);
}

function useNewThreadAction() {
  const router = useRouter();

  return useCallback(
    (projectRef: ScopedProjectRef, options?: NewThreadActionOptions) =>
      openNewThreadWithRouter(router, projectRef, options),
    [router],
  );
}

export function useNewThreadHandler() {
  return {
    handleNewThread: useNewThreadAction(),
  };
}

export function useHandleNewThread() {
  const { projectCwd, projectEnvironmentId, projectRef, logicalProjectKey } =
    useSelectedWorkspaceProject();
  const routeTarget = useChatRouteTarget();
  const routeThreadRef = routeTarget?.kind === "server" ? routeTarget.threadRef : null;
  const activeThread = useStore(
    useShallow(
      (store: AppState) => selectThreadWorkspaceSurfaceByRef(store, routeThreadRef) ?? null,
    ),
  );
  const activeDraftThread = useComposerDraftStore((store) =>
    routeTarget
      ? routeTarget.kind === "server"
        ? store.getDraftThread(routeTarget.threadRef)
        : store.getDraftSession(routeTarget.draftId)
      : null,
  );
  const handleNewThread = useNewThreadAction();

  return {
    activeDraftThread,
    activeThread,
    selectedProjectCwd: projectCwd,
    selectedProjectEnvironmentId: projectEnvironmentId,
    selectedProjectRef: projectRef,
    selectedLogicalProjectKey: logicalProjectKey,
    handleNewThread,
    routeThreadRef,
  };
}
