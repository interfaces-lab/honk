import { EnvironmentId, ProjectId, ThreadId } from "@multi/contracts";
import { assert, it } from "vitest";

import { buildProjectChatSections, type SidebarThreadSummary } from "./sidebar-chat-view-model";

const ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const PROJECT_A_ID = ProjectId.make("project-a");
const PROJECT_B_ID = ProjectId.make("project-b");

function sum(
  id: ThreadId,
  projectId: ProjectId,
  projectCwd: string,
  cwd: string,
  modifiedAt: string,
): SidebarThreadSummary {
  return {
    id,
    environmentId: ENVIRONMENT_ID,
    projectId,
    projectCwd,
    harness: "codex",
    path: cwd,
    cwd,
    name: id,
    createdAt: modifiedAt,
    modifiedAt,
    messageCount: 1,
    firstMessage: id,
    isStreaming: false,
  };
}

it("buildProjectChatSections does not reorder project sections when cwd changes", () => {
  const sums = [
    sum(ThreadId.make("thread-a"), PROJECT_A_ID, "/ws/a", "/ws/a", "2026-04-08T10:00:00.000Z"),
    sum(ThreadId.make("thread-b"), PROJECT_B_ID, "/ws/b", "/ws/b", "2026-04-08T09:00:00.000Z"),
  ];

  const first = buildProjectChatSections(sums, [], "/ws/a", "/Users/workgyver");
  const second = buildProjectChatSections(sums, [], "/ws/b", "/Users/workgyver");

  assert.deepEqual(
    first.map((section) => section.cwd),
    ["/ws/a", "/ws/b"],
  );
  assert.deepEqual(
    second.map((section) => section.cwd),
    ["/ws/a", "/ws/b"],
  );
  assert.equal(first[0]?.label, "ws/a");
  assert.equal(second[1]?.label, "ws/b");
});
