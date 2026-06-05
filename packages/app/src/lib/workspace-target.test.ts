import { EnvironmentId, ProjectId } from "@multi/contracts";
import { describe, expect, it } from "vitest";

import { DESKTOP_RUNTIME_ENVIRONMENT_ID } from "~/lib/environment-scope";
import { resolveWorkspaceTarget } from "./workspace-target";
import type { Project } from "~/types";

function project(input: Partial<Project> & Pick<Project, "id" | "environmentId" | "cwd">): Project {
  return {
    name: "Project",
    defaultModelSelection: null,
    scripts: [],
    ...input,
  };
}

const primaryEnvironmentId = EnvironmentId.make("environment:primary");
const secondaryEnvironmentId = EnvironmentId.make("environment:secondary");
const projectId = ProjectId.make("project:workspace");
const workspaceProject = project({
  id: projectId,
  environmentId: primaryEnvironmentId,
  cwd: "/repo",
});

describe("resolveWorkspaceTarget", () => {
  it("uses the selected default project when no thread target exists", () => {
    const target = resolveWorkspaceTarget({
      source: null,
      defaultProject: workspaceProject,
      defaultProjectCwd: workspaceProject.cwd,
      defaultProjectEnvironmentId: workspaceProject.environmentId,
      defaultProjectRef: {
        environmentId: primaryEnvironmentId,
        projectId,
      },
      projects: [workspaceProject],
      projectlessCwd: "/server",
      fallbackEnvironmentId: secondaryEnvironmentId,
    });

    expect(target.cwd).toBe("/repo");
    expect(target.projectCwd).toBe("/repo");
    expect(target.projectRef).toEqual({
      environmentId: primaryEnvironmentId,
      projectId,
    });
    expect(target.environmentId).toBe(primaryEnvironmentId);
    expect(target.rpcEnvironmentId).toBe(primaryEnvironmentId);
  });

  it("keeps a projectless desktop draft projectless", () => {
    const target = resolveWorkspaceTarget({
      source: {
        environmentId: DESKTOP_RUNTIME_ENVIRONMENT_ID,
        projectId: null,
        worktreePath: null,
      },
      defaultProject: workspaceProject,
      defaultProjectCwd: workspaceProject.cwd,
      defaultProjectEnvironmentId: workspaceProject.environmentId,
      defaultProjectRef: {
        environmentId: primaryEnvironmentId,
        projectId,
      },
      projects: [workspaceProject],
      projectlessCwd: "/server",
      fallbackEnvironmentId: secondaryEnvironmentId,
    });

    expect(target.cwd).toBe("/server");
    expect(target.projectCwd).toBeNull();
    expect(target.projectRef).toBeNull();
    expect(target.environmentId).toBe(DESKTOP_RUNTIME_ENVIRONMENT_ID);
    expect(target.rpcEnvironmentId).toBe(secondaryEnvironmentId);
  });

  it("falls back to projectless cwd when the default project ref is not loaded", () => {
    const target = resolveWorkspaceTarget({
      source: {
        environmentId: primaryEnvironmentId,
        projectId,
        worktreePath: null,
      },
      defaultProject: null,
      defaultProjectCwd: workspaceProject.cwd,
      defaultProjectEnvironmentId: primaryEnvironmentId,
      defaultProjectRef: {
        environmentId: primaryEnvironmentId,
        projectId,
      },
      projects: [],
      projectlessCwd: "/server",
      fallbackEnvironmentId: primaryEnvironmentId,
    });

    expect(target.cwd).toBe("/server");
    expect(target.project).toBeNull();
    expect(target.projectCwd).toBeNull();
    expect(target.projectRef).toEqual({
      environmentId: primaryEnvironmentId,
      projectId,
    });
    expect(target.environmentId).toBe(primaryEnvironmentId);
    expect(target.rpcEnvironmentId).toBe(primaryEnvironmentId);
  });

  it("maps desktop runtime project threads back to the project RPC environment", () => {
    const target = resolveWorkspaceTarget({
      source: {
        environmentId: DESKTOP_RUNTIME_ENVIRONMENT_ID,
        projectId,
        worktreePath: "/repo-worktree",
      },
      defaultProject: null,
      defaultProjectCwd: null,
      defaultProjectEnvironmentId: null,
      defaultProjectRef: null,
      projects: [workspaceProject],
      projectlessCwd: "/server",
      fallbackEnvironmentId: secondaryEnvironmentId,
    });

    expect(target.cwd).toBe("/repo-worktree");
    expect(target.projectCwd).toBe("/repo");
    expect(target.worktreePath).toBe("/repo-worktree");
    expect(target.environmentId).toBe(DESKTOP_RUNTIME_ENVIRONMENT_ID);
    expect(target.rpcEnvironmentId).toBe(primaryEnvironmentId);
  });
});
