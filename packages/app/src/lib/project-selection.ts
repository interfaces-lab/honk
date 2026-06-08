import { type EnvironmentId, type ModelSelection, type ScopedProjectRef } from "@multi/contracts";

import { readEnvironmentApi } from "~/environment-api";
import { scopeProjectRef } from "~/lib/environment-scope";
import { findProjectByPath, inferProjectTitleFromPath } from "~/lib/project-paths";
import { writeStoredProjectSelection } from "~/lib/project-state";
import { newCommandId, newProjectId } from "~/lib/utils";
import { applyLocalProjectCreated } from "~/stores/local-orchestration-events";
import { deriveLogicalProjectKey, derivePhysicalProjectKeyFromPath } from "~/stores/project-identity";
import { selectProjectByRef, useStore } from "~/stores/thread-store";
import { type Project } from "~/types";

export interface EnsuredProjectSelection {
  readonly projectRef: ScopedProjectRef;
  readonly project: Project | null;
  readonly cwd: string;
  readonly created: boolean;
  readonly logicalProjectKey: string;
}

export function persistProjectSelection(project: Pick<Project, "environmentId" | "id" | "cwd">) {
  writeStoredProjectSelection({
    environmentId: project.environmentId,
    projectId: project.id,
    cwd: project.cwd,
  });
}

export async function openWorkspaceFolder(input: {
  readonly environmentId: EnvironmentId;
  readonly projects: readonly Project[];
  readonly rawCwd: string;
  readonly defaultModelSelection: ModelSelection | null;
}): Promise<EnsuredProjectSelection | null> {
  const cwd = input.rawCwd.trim();
  if (cwd.length === 0) {
    return null;
  }

  const existing = findProjectByPath(
    input.projects.filter((project) => project.environmentId === input.environmentId),
    cwd,
  );
  if (existing) {
    persistProjectSelection(existing);
    return {
      projectRef: scopeProjectRef(existing.environmentId, existing.id),
      project: existing,
      cwd: existing.cwd,
      created: false,
      logicalProjectKey: deriveLogicalProjectKey(existing),
    };
  }

  const api = readEnvironmentApi(input.environmentId);
  const projectId = newProjectId();
  const projectRef = scopeProjectRef(input.environmentId, projectId);
  const commandId = newCommandId();
  const title = inferProjectTitleFromPath(cwd);
  const createdAt = new Date().toISOString();
  writeStoredProjectSelection({
    environmentId: input.environmentId,
    projectId,
    cwd,
  });
  applyLocalProjectCreated({
    environmentId: input.environmentId,
    projectId,
    title,
    projectRoot: cwd,
    defaultModelSelection: input.defaultModelSelection,
    createdAt,
  });
  if (api) {
    void api.orchestration
      .dispatchCommand({
        type: "project.create",
        commandId,
        projectId,
        title,
        projectRoot: cwd,
        createProjectRootIfMissing: true,
        defaultModelSelection: input.defaultModelSelection,
        createdAt,
      })
      .catch(() => undefined);
  }

  const project = selectProjectByRef(useStore.getState(), projectRef) ?? null;

  return {
    projectRef,
    project,
    cwd,
    created: true,
    logicalProjectKey: project
      ? deriveLogicalProjectKey(project)
      : derivePhysicalProjectKeyFromPath(input.environmentId, cwd),
  };
}
