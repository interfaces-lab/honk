import { scopedProjectKey } from "~/lib/environment-scope";
import { type ScopedProjectRef } from "@honk/contracts";
import { projectScriptCwd } from "@honk/shared/project-scripts";
import { useRouter } from "@tanstack/react-router";
import { useShallow } from "zustand/react/shallow";
import { type DraftThreadEnvMode, DraftId, useComposerDraftStore } from "../stores/chat-drafts";
import { deriveLogicalProjectKey } from "../stores/project-identity";
import { type AppState, selectProjectsAcrossEnvironments, useStore } from "../stores/thread-store";
import { selectThreadWorkspaceSurfaceByRef } from "../stores/thread-selectors";
import {
  type ChatRouteTarget,
  readChatRouteTarget,
  useChatRouteTarget,
} from "~/app/chat-route-state";
import { openDraft } from "~/app/chat-navigation";
import type { AppRouter } from "~/router";
import { useSelectedWorkspaceProject } from "../lib/selected-workspace-project";
import { newThreadId } from "../lib/utils";
import { DEFAULT_INTERACTION_MODE, type Project } from "../types";
import { deriveWorkspaceKey } from "~/lib/workspace-target";
import {
  getWorkspaceFullscreenTarget,
  workspaceEditorActions,
} from "~/stores/workspace-editor-store";

export interface NewThreadActionOptions {
  readonly branch?: string | null;
  readonly worktreePath?: string | null;
  readonly envMode?: DraftThreadEnvMode;
  readonly logicalProjectKey?: string | null;
}

function exitFullscreenForNewThreadProject(
  project: Pick<Project, "cwd" | "environmentId"> | undefined,
  worktreePath: string | null,
  threadId: string | null,
): void {
  if (!project) {
    return;
  }
  const workspaceKey = deriveWorkspaceKey({
    rpcEnvironmentId: project.environmentId,
    cwd: projectScriptCwd({ project, worktreePath }),
  });
  if (getWorkspaceFullscreenTarget(workspaceKey, threadId) === "none") {
    return;
  }
  workspaceEditorActions.exitFullscreen(workspaceKey, threadId);
}

function fullscreenThreadIdFromRouteTarget(target: ChatRouteTarget | null): string | null {
  if (!target) {
    return null;
  }
  return target.kind === "server" ? target.threadRef.threadId : target.draftId;
}

export async function openNewThreadWithRouter(
  router: AppRouter,
  projectRef: ScopedProjectRef,
  options?: NewThreadActionOptions,
): Promise<void> {
  const store = useComposerDraftStore.getState();
  const currentRouteTarget = readChatRouteTarget(router);
  const currentFullscreenThreadId = fullscreenThreadIdFromRouteTarget(currentRouteTarget);
  const projects = selectProjectsAcrossEnvironments(useStore.getState());
  const project = projects.find(
    (candidate) =>
      candidate.id === projectRef.projectId && candidate.environmentId === projectRef.environmentId,
  );
  const logicalProjectKey =
    options?.logicalProjectKey?.trim() ||
    (project ? deriveLogicalProjectKey(project) : scopedProjectKey(projectRef));
  const previousDraft =
    store.getDraftSessionByLogicalProjectKey(logicalProjectKey) ??
    store.getDraftSessionByProjectRef(projectRef);

  const threadId = newThreadId();
  const draftId = DraftId.make(
    // Prefix is for routing; thread-id suffix keeps drafts distinct.
    `new-thread-draft:project:${projectRef.environmentId}:${projectRef.projectId}:${threadId}`,
  );
  const draftWorktreePath = options?.worktreePath ?? previousDraft?.worktreePath ?? null;
  exitFullscreenForNewThreadProject(project, draftWorktreePath, currentFullscreenThreadId);
  store.setLogicalProjectDraftThreadId(logicalProjectKey, projectRef, draftId, {
    threadId,
    createdAt: new Date().toISOString(),
    interactionMode: DEFAULT_INTERACTION_MODE,
    branch: options?.branch ?? null,
    worktreePath: draftWorktreePath,
    envMode: options?.envMode ?? "local",
  });
  store.clearComposerContent(draftId);
  await openDraft(router, draftId);
}

function useNewThreadAction() {
  const router = useRouter();

  return (projectRef: ScopedProjectRef, options?: NewThreadActionOptions) =>
    openNewThreadWithRouter(router, projectRef, options);
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
