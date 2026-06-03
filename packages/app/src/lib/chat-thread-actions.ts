import { scopeProjectRef } from "~/lib/environment-scope";
import type { EnvironmentId, ProjectId, ScopedProjectRef } from "@multi/contracts";
import type { DraftThreadEnvMode } from "../stores/chat-drafts";

interface ThreadContextLike {
  environmentId: EnvironmentId;
  projectId: ProjectId | null;
  branch: string | null;
  worktreePath: string | null;
}

interface DraftThreadContextLike extends ThreadContextLike {
  envMode: DraftThreadEnvMode;
}

interface NewThreadHandler {
  (
    projectRef: ScopedProjectRef,
    options?: {
      branch?: string | null;
      reuseExistingDraft?: boolean;
      worktreePath?: string | null;
      envMode?: DraftThreadEnvMode;
    },
  ): Promise<void>;
}

type NewThreadOptions = NonNullable<Parameters<NewThreadHandler>[1]>;

export interface ChatThreadActionContext {
  readonly activeDraftThread: DraftThreadContextLike | null;
  readonly activeThread: ThreadContextLike | undefined;
  readonly defaultProjectRef: ScopedProjectRef | null;
  readonly defaultThreadEnvMode: DraftThreadEnvMode;
  readonly handleNewThread: NewThreadHandler;
}

export function resolveThreadActionProjectRef(
  context: ChatThreadActionContext,
): ScopedProjectRef | null {
  if (context.activeThread?.projectId !== null && context.activeThread !== undefined) {
    return scopeProjectRef(context.activeThread.environmentId, context.activeThread.projectId);
  }
  if (context.activeDraftThread?.projectId !== null && context.activeDraftThread !== null) {
    return scopeProjectRef(
      context.activeDraftThread.environmentId,
      context.activeDraftThread.projectId,
    );
  }
  return context.defaultProjectRef;
}

function buildContextualThreadOptions(context: ChatThreadActionContext): NewThreadOptions {
  return {
    branch: context.activeThread?.branch ?? context.activeDraftThread?.branch ?? null,
    worktreePath:
      context.activeThread?.worktreePath ?? context.activeDraftThread?.worktreePath ?? null,
    envMode:
      context.activeDraftThread?.envMode ??
      (context.activeThread?.worktreePath ? "worktree" : "local"),
  };
}

function buildDefaultThreadOptions(context: ChatThreadActionContext): NewThreadOptions {
  return {
    envMode: context.defaultThreadEnvMode,
  };
}

function buildProjectThreadOptions(
  context: ChatThreadActionContext,
  projectRef: ScopedProjectRef,
): NewThreadOptions {
  if (context.defaultThreadEnvMode === "worktree") {
    return {
      envMode: "worktree",
    };
  }

  if (context.activeDraftThread?.projectId === projectRef.projectId) {
    return {
      branch: context.activeDraftThread.branch,
      worktreePath: context.activeDraftThread.worktreePath,
      envMode: context.activeDraftThread.envMode,
    };
  }

  if (context.activeThread?.projectId === projectRef.projectId) {
    return {
      branch: context.activeThread.branch,
      worktreePath: context.activeThread.worktreePath,
      envMode: context.activeThread.worktreePath ? "worktree" : "local",
    };
  }

  return {
    envMode: context.defaultThreadEnvMode,
  };
}

export async function startNewThreadInProjectFromContext(
  context: ChatThreadActionContext,
  projectRef: ScopedProjectRef,
): Promise<void> {
  await context.handleNewThread(projectRef, {
    ...buildProjectThreadOptions(context, projectRef),
    reuseExistingDraft: false,
  });
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
