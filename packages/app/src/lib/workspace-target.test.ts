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
      activeDraftThread: null,
      activeThread: null,
      defaultProject: workspaceProject,
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

  it("keeps a projectless desktop draft on the selected workspace", () => {
    const target = resolveWorkspaceTarget({
      activeDraftThread: {
        environmentId: DESKTOP_RUNTIME_ENVIRONMENT_ID,
        projectId: null,
        worktreePath: null,
      },
      activeThread: null,
      defaultProject: workspaceProject,
      projects: [workspaceProject],
      projectlessCwd: "/server",
      fallbackEnvironmentId: secondaryEnvironmentId,
    });

    expect(target.cwd).toBe("/repo");
    expect(target.projectCwd).toBe("/repo");
    expect(target.environmentId).toBe(DESKTOP_RUNTIME_ENVIRONMENT_ID);
    expect(target.rpcEnvironmentId).toBe(primaryEnvironmentId);
  });

  it("maps desktop runtime project threads back to the project RPC environment", () => {
    const target = resolveWorkspaceTarget({
      activeDraftThread: null,
      activeThread: {
        environmentId: DESKTOP_RUNTIME_ENVIRONMENT_ID,
        projectId,
        worktreePath: "/repo-worktree",
      },
      defaultProject: null,
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
