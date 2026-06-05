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
  console.log("[workspace.project-selection.persist]", {
    environmentId: project.environmentId,
    projectId: project.id,
    cwd: project.cwd,
  });
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
  console.log("[workspace.project-selection.ensure.start]", {
    environmentId: input.environmentId,
    rawCwd: input.rawCwd,
    cwd,
    projectCount: input.projects.length,
  });
  if (cwd.length === 0) {
    console.log("[workspace.project-selection.ensure.empty-cwd]", {
      rawCwd: input.rawCwd,
    });
    return null;
  }

  const existing = findProjectByPath(
    input.projects.filter((project) => project.environmentId === input.environmentId),
    cwd,
  );
  if (existing) {
    console.log("[workspace.project-selection.ensure.existing]", {
      environmentId: existing.environmentId,
      projectId: existing.id,
      cwd: existing.cwd,
    });
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
  console.log("[workspace.project-selection.ensure.create]", {
    environmentId: input.environmentId,
    projectId,
    commandId,
    cwd,
    title,
    hasEnvironmentApi: api !== null,
  });
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
      .then((result) => {
        console.log("[workspace.project-selection.ensure.remote-dispatch.complete]", {
          environmentId: input.environmentId,
          projectId,
          commandId,
          sequence: result.sequence,
        });
      })
      .catch((error: unknown) => {
        console.log("[workspace.project-selection.ensure.remote-dispatch.error]", {
          environmentId: input.environmentId,
          projectId,
          commandId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }

  const project = selectProjectByRef(useStore.getState(), projectRef) ?? null;
  console.log("[workspace.project-selection.ensure.created-result]", {
    environmentId: projectRef.environmentId,
    projectId: projectRef.projectId,
    cwd,
    projectAvailable: project !== null,
    projectCwd: project?.cwd ?? null,
  });

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
