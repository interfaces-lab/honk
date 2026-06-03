import type { EnvironmentId, ScopedProjectRef } from "@multi/contracts";
import { projectScriptCwd } from "@multi/shared/project-scripts";

import { DESKTOP_RUNTIME_ENVIRONMENT_ID, scopeProjectRef } from "~/lib/environment-scope";
import type { Project, Thread } from "~/types";
import type { DraftThreadState } from "~/stores/chat-drafts";

type WorkspaceTargetSource = Pick<
  Thread | DraftThreadState,
  "environmentId" | "projectId" | "worktreePath"
>;

interface WorkspaceProjectSource {
  readonly environmentId: EnvironmentId;
  readonly projectId: Project["id"] | null;
}

export interface WorkspaceTarget {
  readonly project: Project | null;
  readonly projectRef: ScopedProjectRef | null;
  readonly projectCwd: string | null;
  readonly worktreePath: string | null;
  readonly cwd: string | null;
  readonly environmentId: EnvironmentId | null;
  readonly rpcEnvironmentId: EnvironmentId | null;
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
  return (
    projects.find((project) =>
      source.environmentId === DESKTOP_RUNTIME_ENVIRONMENT_ID
        ? project.id === source.projectId
        : project.environmentId === source.environmentId && project.id === source.projectId,
    ) ?? null
  );
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
  readonly activeDraftThread: WorkspaceTargetSource | null;
  readonly activeThread: WorkspaceTargetSource | null;
  readonly defaultProject: Project | null;
  readonly projects: readonly Project[];
  readonly projectlessCwd: string | null;
  readonly fallbackEnvironmentId: EnvironmentId | null;
}): WorkspaceTarget {
  const source = input.activeDraftThread ?? input.activeThread ?? null;
  const sourceProject = findWorkspaceProjectForSource(input.projects, source);
  const fallbackProject = input.defaultProject ?? input.projects[0] ?? null;
  const project = sourceProject ?? fallbackProject;
  const sourceOwnsResolvedProject = source
    ? findWorkspaceProjectForSource(project ? [project] : [], source) !== null
    : false;
  const worktreePath = sourceOwnsResolvedProject ? (source?.worktreePath ?? null) : null;
  const cwd = project
    ? projectScriptCwd({ project: { cwd: project.cwd }, worktreePath })
    : (input.projectlessCwd ?? null);
  const environmentId =
    source?.environmentId ?? project?.environmentId ?? input.fallbackEnvironmentId ?? null;
  const rpcEnvironmentId = resolveRpcEnvironmentId({
    project,
    environmentId,
    fallbackEnvironmentId: input.fallbackEnvironmentId,
  });

  return {
    project,
    projectRef: project ? scopeProjectRef(project.environmentId, project.id) : null,
    projectCwd: project?.cwd ?? null,
    worktreePath,
    cwd,
    environmentId,
    rpcEnvironmentId,
  };
}
