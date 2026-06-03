import { EnvironmentId, ProjectId, ThreadId } from "@multi/contracts";
import { describe, expect, it } from "vitest";

import { DESKTOP_RUNTIME_ENVIRONMENT_ID } from "~/lib/environment-scope";
import { getLatestThreadForProject } from "./thread-sort";

const primaryEnvironmentId = EnvironmentId.make("environment:primary");
const projectId = ProjectId.make("project:workspace");
const otherProjectId = ProjectId.make("project:other");

describe("getLatestThreadForProject", () => {
  it("includes desktop-runtime threads that carry the selected project id", () => {
    const latest = getLatestThreadForProject(
      [
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
      projectId,
      "updated_at",
    );

    expect(latest?.id).toBe(ThreadId.make("thread:desktop-runtime"));
  });
});
