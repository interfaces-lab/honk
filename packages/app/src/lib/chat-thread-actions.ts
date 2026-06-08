import { scopeProjectRef } from "~/lib/environment-scope";
import type { EnvironmentId, ProjectId, ScopedProjectRef } from "@multi/contracts";
import { type DraftThreadEnvMode, useComposerDraftStore } from "../stores/chat-drafts";
import type { ThreadRouteTarget } from "~/routes/-thread-route-targets";
import { useStore } from "../stores/thread-store";
import { selectThreadWorkspaceSurfaceByRef } from "../stores/thread-selectors";
import {
  findWorkspaceProjectForSource,
  isSourceForWorkspaceProject,
  isSourceForWorkspaceProjectRef,
} from "./workspace-target";
import type { Project } from "../types";

interface ThreadContextLike {
  environmentId: EnvironmentId;
  projectId: ProjectId | null;
  branch: string | null;
  worktreePath: string | null;
}

interface DraftThreadContextLike extends ThreadContextLike {
  envMode: DraftThreadEnvMode;
  logicalProjectKey: string;
}

interface NewThreadHandler {
  (
    projectRef: ScopedProjectRef,
    options?: {
      branch?: string | null;
      reuseExistingDraft?: boolean;
      worktreePath?: string | null;
      envMode?: DraftThreadEnvMode;
      logicalProjectKey?: string | null;
    },
  ): Promise<void>;
}

type NewThreadOptions = NonNullable<Parameters<NewThreadHandler>[1]>;

export interface ChatThreadActionContext {
  readonly activeDraftThread: DraftThreadContextLike | null;
  readonly activeThread: ThreadContextLike | undefined;
  readonly defaultLogicalProjectKey: string | null;
  readonly defaultProjectRef: ScopedProjectRef | null;
  readonly defaultThreadEnvMode: DraftThreadEnvMode;
  readonly handleNewThread: NewThreadHandler;
  readonly projects: readonly Project[];
}

export function readThreadActionContext(input: {
  readonly defaultLogicalProjectKey: string | null;
  readonly defaultProjectRef: ScopedProjectRef | null;
  readonly defaultThreadEnvMode: DraftThreadEnvMode;
  readonly handleNewThread: NewThreadHandler;
  readonly projects: readonly Project[];
  readonly routeTarget: ThreadRouteTarget | null;
}): ChatThreadActionContext {
  const draftStore = useComposerDraftStore.getState();
  return {
    activeDraftThread:
      input.routeTarget?.kind === "server"
        ? draftStore.getDraftThread(input.routeTarget.threadRef)
        : input.routeTarget?.kind === "draft"
          ? draftStore.getDraftSession(input.routeTarget.draftId)
          : null,
    activeThread:
      input.routeTarget?.kind === "server"
        ? selectThreadWorkspaceSurfaceByRef(useStore.getState(), input.routeTarget.threadRef)
        : undefined,
    defaultLogicalProjectKey: input.defaultLogicalProjectKey,
    defaultProjectRef: input.defaultProjectRef,
    defaultThreadEnvMode: input.defaultThreadEnvMode,
    handleNewThread: input.handleNewThread,
    projects: input.projects,
  };
}

export function resolveThreadActionProjectRef(
  context: ChatThreadActionContext,
): ScopedProjectRef | null {
  const activeThreadProject = findWorkspaceProjectForSource(context.projects, context.activeThread);
  if (activeThreadProject) {
    return scopeProjectRef(activeThreadProject.environmentId, activeThreadProject.id);
  }
  const activeDraftProject = findWorkspaceProjectForSource(
    context.projects,
    context.activeDraftThread,
  );
  if (activeDraftProject) {
    return scopeProjectRef(activeDraftProject.environmentId, activeDraftProject.id);
  }
  return context.defaultProjectRef;
}

function buildContextualThreadOptions(context: ChatThreadActionContext): NewThreadOptions {
  const logicalProjectKey =
    context.activeDraftThread?.logicalProjectKey ??
    (isSourceForWorkspaceProjectRef({
      projectRef: context.defaultProjectRef,
      source: context.activeThread,
    })
      ? context.defaultLogicalProjectKey
      : null);
  return {
    branch: context.activeThread?.branch ?? context.activeDraftThread?.branch ?? null,
    worktreePath:
      context.activeThread?.worktreePath ?? context.activeDraftThread?.worktreePath ?? null,
    envMode:
      context.activeDraftThread?.envMode ??
      (context.activeThread?.worktreePath ? "worktree" : "local"),
    logicalProjectKey,
  };
}

function buildDefaultThreadOptions(context: ChatThreadActionContext): NewThreadOptions {
  return {
    envMode: context.defaultThreadEnvMode,
    logicalProjectKey: context.defaultLogicalProjectKey,
  };
}

function projectRefsEqual(
  left: ScopedProjectRef | null | undefined,
  right: ScopedProjectRef | null | undefined,
): boolean {
  return Boolean(
    left &&
    right &&
    left.environmentId === right.environmentId &&
    left.projectId === right.projectId,
  );
}

function buildProjectThreadOptions(
  context: ChatThreadActionContext,
  projectRef: ScopedProjectRef,
): NewThreadOptions {
  const activeDraftThread = context.activeDraftThread;
  if (
    activeDraftThread &&
    isSourceForWorkspaceProject({
      project: projectRef,
      projects: context.projects,
      source: activeDraftThread,
    })
  ) {
    return {
      branch: activeDraftThread.branch,
      worktreePath: activeDraftThread.worktreePath,
      envMode: activeDraftThread.envMode,
      logicalProjectKey: activeDraftThread.logicalProjectKey,
    };
  }

  if (
    activeDraftThread &&
    isSourceForWorkspaceProjectRef({
      projectRef,
      source: activeDraftThread,
    })
  ) {
    return {
      branch: activeDraftThread.branch,
      worktreePath: activeDraftThread.worktreePath,
      envMode: activeDraftThread.envMode,
      logicalProjectKey: activeDraftThread.logicalProjectKey,
    };
  }

  if (context.defaultThreadEnvMode === "worktree") {
    return {
      envMode: "worktree",
    };
  }

  const activeThread = context.activeThread;
  if (
    activeThread &&
    isSourceForWorkspaceProject({
      project: projectRef,
      projects: context.projects,
      source: activeThread,
    })
  ) {
    return {
      branch: activeThread.branch,
      worktreePath: activeThread.worktreePath,
      envMode: activeThread.worktreePath ? "worktree" : "local",
      logicalProjectKey: projectRefsEqual(projectRef, context.defaultProjectRef)
        ? context.defaultLogicalProjectKey
        : null,
    };
  }

  return {
    envMode: context.defaultThreadEnvMode,
    logicalProjectKey: projectRefsEqual(projectRef, context.defaultProjectRef)
      ? context.defaultLogicalProjectKey
      : null,
  };
}

function activeDraftBelongsToProject(
  context: ChatThreadActionContext,
  projectRef: ScopedProjectRef,
): boolean {
  return Boolean(
    context.activeDraftThread &&
    (isSourceForWorkspaceProject({
      project: projectRef,
      projects: context.projects,
      source: context.activeDraftThread,
    }) ||
      isSourceForWorkspaceProjectRef({
        projectRef,
        source: context.activeDraftThread,
      })),
  );
}

export async function startNewThreadInProjectFromContext(
  context: ChatThreadActionContext,
  projectRef: ScopedProjectRef,
): Promise<void> {
  const options = buildProjectThreadOptions(context, projectRef);
  await context.handleNewThread(
    projectRef,
    activeDraftBelongsToProject(context, projectRef)
      ? options
      : { ...options, reuseExistingDraft: false },
  );
}

export async function startNewThreadFromContext(
  context: ChatThreadActionContext,
): Promise<boolean> {
  const projectRef = resolveThreadActionProjectRef(context);
  if (!projectRef) {
    return false;
  }

  await context.handleNewThread(projectRef, buildContextualThreadOptions(context));
  return true;
}

export async function startNewLocalThreadFromContext(
  context: ChatThreadActionContext,
): Promise<boolean> {
  const projectRef = resolveThreadActionProjectRef(context);
  if (!projectRef) {
    return false;
  }

  await context.handleNewThread(projectRef, buildDefaultThreadOptions(context));
  return true;
}
