import { EnvironmentId } from "@honk/shared/environment";
import { ProjectId, ThreadId } from "@honk/shared/base-schemas";
import { describe, expect, it } from "vitest";

import { DESKTOP_RUNTIME_ENVIRONMENT_ID } from "~/lib/environment-scope";
import { getLatestWorkspaceThreadForProject } from "./workspace-target";
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
const otherProjectId = ProjectId.make("project:other");
const workspaceProject = project({
  id: projectId,
  environmentId: primaryEnvironmentId,
  cwd: "/repo",
});

describe("getLatestWorkspaceThreadForProject", () => {
  it("includes desktop-runtime threads that carry the selected project id", () => {
    const latest = getLatestWorkspaceThreadForProject({
      project: workspaceProject,
      projects: [workspaceProject],
      threads: [
        {
          id: ThreadId.make("thread:primary"),
          environmentId: primaryEnvironmentId,
          projectId,
          archivedAt: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          latestUserMessageAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: ThreadId.make("thread:desktop-runtime"),
          environmentId: DESKTOP_RUNTIME_ENVIRONMENT_ID,
          projectId,
          archivedAt: null,
          createdAt: "2026-01-02T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
          latestUserMessageAt: "2026-01-02T00:00:00.000Z",
        },
        {
          id: ThreadId.make("thread:other-project"),
          environmentId: DESKTOP_RUNTIME_ENVIRONMENT_ID,
          projectId: otherProjectId,
          archivedAt: null,
          createdAt: "2026-01-03T00:00:00.000Z",
          updatedAt: "2026-01-03T00:00:00.000Z",
          latestUserMessageAt: "2026-01-03T00:00:00.000Z",
        },
      ],
      sortOrder: "updated_at",
    });

    expect(latest?.id).toBe(ThreadId.make("thread:desktop-runtime"));
  });

  it("does not select ambiguous desktop-runtime project threads across environments", () => {
    const latest = getLatestWorkspaceThreadForProject({
      project: workspaceProject,
      projects: [
        workspaceProject,
        project({
          id: projectId,
          environmentId: secondaryEnvironmentId,
          cwd: "/repo-copy",
        }),
      ],
      threads: [
        {
          id: ThreadId.make("thread:primary"),
          environmentId: primaryEnvironmentId,
          projectId,
          archivedAt: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          latestUserMessageAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: ThreadId.make("thread:ambiguous-desktop-runtime"),
          environmentId: DESKTOP_RUNTIME_ENVIRONMENT_ID,
          projectId,
          archivedAt: null,
          createdAt: "2026-01-02T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
          latestUserMessageAt: "2026-01-02T00:00:00.000Z",
        },
      ],
      sortOrder: "updated_at",
    });

    expect(latest?.id).toBe(ThreadId.make("thread:primary"));
  });
});
