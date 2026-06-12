import type { EnvironmentId, ScopedProjectRef } from "@honk/contracts";
import type { SidebarThreadSortOrder } from "@honk/contracts/settings";
import { projectScriptCwd } from "@honk/shared/project-scripts";

import { DESKTOP_RUNTIME_ENVIRONMENT_ID, scopeProjectRef } from "~/lib/environment-scope";
import type { Project, Thread } from "~/types";
import type { DraftThreadState } from "~/stores/chat-drafts";
import { sortThreads, type ThreadSortInput } from "./thread-sort";

type WorkspaceTargetSource = Pick<
  Thread | DraftThreadState,
  "environmentId" | "projectId" | "worktreePath"
>;

interface WorkspaceProjectSource {
  readonly environmentId: EnvironmentId;
  readonly projectId: Project["id"] | null;
}

type WorkspaceProjectIdentity = Pick<Project, "environmentId" | "id">;

export interface WorkspaceTarget {
  readonly project: Project | null;
  readonly projectRef: ScopedProjectRef | null;
  readonly projectCwd: string | null;
  readonly worktreePath: string | null;
  readonly cwd: string | null;
  readonly environmentId: EnvironmentId | null;
  readonly rpcEnvironmentId: EnvironmentId | null;
  readonly workspaceKey: string;
}

export function findWorkspaceProjectByRef(
  projects: readonly Project[],
  ref: ScopedProjectRef | null | undefined,
): Project | null {
  if (!ref) return null;
  return (
    projects.find(
      (project) => project.environmentId === ref.environmentId && project.id === ref.projectId,
    ) ?? null
  );
}

export function findWorkspaceProjectForSource(
  projects: readonly Project[],
  source: WorkspaceProjectSource | null | undefined,
): Project | null {
  if (!source?.projectId) return null;
  if (source.environmentId === DESKTOP_RUNTIME_ENVIRONMENT_ID) {
    const matches = projects.filter((project) => project.id === source.projectId);
    return matches.length === 1 ? (matches[0] ?? null) : null;
  }
  return (
    projects.find(
      (project) =>
        project.environmentId === source.environmentId && project.id === source.projectId,
    ) ?? null
  );
}

export function isSourceForWorkspaceProjectRef(input: {
  readonly projectRef: ScopedProjectRef | null | undefined;
  readonly source: WorkspaceProjectSource | null | undefined;
}): boolean {
  if (!input.projectRef || !input.source?.projectId) return false;
  if (input.source.environmentId === DESKTOP_RUNTIME_ENVIRONMENT_ID) {
    return input.source.projectId === input.projectRef.projectId;
  }
  return (
    input.source.environmentId === input.projectRef.environmentId &&
    input.source.projectId === input.projectRef.projectId
  );
}

export function isSourceForWorkspaceProject(input: {
  readonly project: WorkspaceProjectIdentity | ScopedProjectRef | null | undefined;
  readonly projects: readonly Project[];
  readonly source: WorkspaceProjectSource | null | undefined;
}): boolean {
  if (!input.project || !input.source?.projectId) return false;
  if ("projectId" in input.project) {
    return isSourceForWorkspaceProjectRef({
      projectRef: input.project,
      source: input.source,
    });
  }
  const project = findWorkspaceProjectForSource(input.projects, input.source);
  return (
    project !== null &&
    project.environmentId === input.project.environmentId &&
    project.id === input.project.id
  );
}

export function getLatestWorkspaceThreadForProject<
  T extends WorkspaceProjectSource & Pick<Thread, "id" | "archivedAt"> & ThreadSortInput,
>(input: {
  readonly project: WorkspaceProjectIdentity | ScopedProjectRef;
  readonly projects: readonly Project[];
  readonly threads: readonly T[];
  readonly sortOrder: SidebarThreadSortOrder;
}): T | null {
  return (
    sortThreads(
      input.threads.filter(
        (thread) =>
          thread.archivedAt === null &&
          isSourceForWorkspaceProject({
            project: input.project,
            projects: input.projects,
            source: thread,
          }),
      ),
      input.sortOrder,
    )[0] ?? null
  );
}

export function deriveWorkspaceKey(input: {
  readonly rpcEnvironmentId: EnvironmentId | null;
  readonly cwd: string | null;
}): string {
  return JSON.stringify({
    rpcEnvironmentId: input.rpcEnvironmentId ?? null,
    cwd: input.cwd ?? null,
  });
}

function resolveRpcEnvironmentId(input: {
  readonly project: Project | null;
  readonly environmentId: EnvironmentId | null;
  readonly fallbackEnvironmentId: EnvironmentId | null;
}): EnvironmentId | null {
  if (input.project) {
    return input.project.environmentId;
  }
  if (input.environmentId === DESKTOP_RUNTIME_ENVIRONMENT_ID) {
    return input.fallbackEnvironmentId === DESKTOP_RUNTIME_ENVIRONMENT_ID
      ? null
      : input.fallbackEnvironmentId;
  }
  return input.environmentId;
}

export function resolveWorkspaceTarget(input: {
  readonly source: WorkspaceTargetSource | null;
  readonly defaultProject: Project | null;
  readonly defaultProjectCwd: string | null;
  readonly defaultProjectEnvironmentId: EnvironmentId | null;
  readonly defaultProjectRef: ScopedProjectRef | null;
  readonly projects: readonly Project[];
  readonly projectlessCwd: string | null;
  readonly fallbackEnvironmentId: EnvironmentId | null;
}): WorkspaceTarget {
  const source = input.source;
  const sourceProject = findWorkspaceProjectForSource(input.projects, source);
  const selectedProject = input.defaultProject ?? null;
  const sourceMatchesDefaultProjectRef = isSourceForWorkspaceProjectRef({
    projectRef: input.defaultProjectRef,
    source,
  });
  const sourceHasProject = source?.projectId !== null && source?.projectId !== undefined;
  const project = source
    ? sourceHasProject
      ? (sourceProject ?? (sourceMatchesDefaultProjectRef ? selectedProject : null))
      : null
    : selectedProject;
  const sourceOwnsResolvedProject = isSourceForWorkspaceProject({
    project,
    projects: input.projects,
    source,
  });
  const worktreePath = sourceOwnsResolvedProject ? (source?.worktreePath ?? null) : null;
  const selectedCwd = project
    ? project.cwd
    : selectedProject && (!source || (sourceHasProject && sourceMatchesDefaultProjectRef))
      ? input.defaultProjectCwd
      : null;
  const cwd = selectedCwd
    ? projectScriptCwd({ project: { cwd: selectedCwd }, worktreePath })
    : (input.projectlessCwd ?? null);
  const environmentId =
    source?.environmentId ??
    project?.environmentId ??
    input.defaultProjectEnvironmentId ??
    input.fallbackEnvironmentId ??
    null;
  const rpcEnvironmentId = resolveRpcEnvironmentId({
    project,
    environmentId,
    fallbackEnvironmentId: input.fallbackEnvironmentId,
  });
  const workspaceKey = deriveWorkspaceKey({ rpcEnvironmentId, cwd });

  return {
    project,
    projectRef: project
      ? scopeProjectRef(project.environmentId, project.id)
      : sourceHasProject && sourceMatchesDefaultProjectRef
        ? input.defaultProjectRef
        : !source
          ? input.defaultProjectRef
          : null,
    projectCwd: selectedCwd ?? null,
    worktreePath,
    cwd,
    environmentId,
    rpcEnvironmentId,
    workspaceKey,
  };
}
