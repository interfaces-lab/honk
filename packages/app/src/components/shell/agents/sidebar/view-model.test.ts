import { EnvironmentId, ProjectId, ThreadId } from "@multi/contracts";
import { describe, expect, it } from "vitest";

import { DESKTOP_RUNTIME_ENVIRONMENT_ID, scopeProjectRef, scopeThreadRef } from "~/lib/environment-scope";
import { buildProjectChatSections } from "./view-model";
import type { SidebarThreadSummary } from "./types";

const primaryEnvironmentId = EnvironmentId.make("environment:primary");
const projectId = ProjectId.make("project:workspace");
const threadId = ThreadId.make("thread:pi-runtime");
const olderThreadId = ThreadId.make("thread:older");
const newerThreadId = ThreadId.make("thread:newer");
const projectRef = scopeProjectRef(primaryEnvironmentId, projectId);
const routeThreadRef = scopeThreadRef(DESKTOP_RUNTIME_ENVIRONMENT_ID, threadId);

function threadSummary(input: Partial<SidebarThreadSummary> = {}): SidebarThreadSummary {
  return {
    id: threadId,
    environmentId: DESKTOP_RUNTIME_ENVIRONMENT_ID,
    projectId,
    workspaceProjectRef: projectRef,
    projectCwd: "/repo",
    path: "/repo",
    cwd: "/repo",
    name: "Pi thread",
    createdAt: "2026-01-01T00:00:00.000Z",
    modifiedAt: "2026-01-02T00:00:00.000Z",
    latestReadableAt: "2026-01-02T00:00:00.000Z",
    messageCount: 1,
    firstMessage: "Pi thread",
    isStreaming: false,
    orchestrationStatus: null,
    needsAttention: false,
    ...input,
  };
}

describe("buildProjectChatSections", () => {
  it("keeps Pi thread route identity while exposing the owning project identity", () => {
    const sections = buildProjectChatSections(
      [threadSummary()],
      [],
      "/repo",
      null,
      undefined,
      ["/repo"],
      undefined,
      [
        {
          id: projectId,
          environmentId: primaryEnvironmentId,
          title: "Repo",
          cwd: "/repo",
        },
      ],
    );

    expect(sections).toHaveLength(1);
    const section = sections[0]!;
    expect(section.projectRef).toEqual(projectRef);
    expect(section.environmentId).toBe(primaryEnvironmentId);
    expect(section.projectId).toBe(projectId);
    expect(section.threadRefs).toEqual([routeThreadRef]);
    expect(section.items[0]).toMatchObject({
      kind: "thread",
      threadRef: routeThreadRef,
      workspaceProjectRef: projectRef,
    });
  });

  it("preserves thread input order while bootstrap is incomplete", () => {
    const older = threadSummary({
      id: olderThreadId,
      modifiedAt: "2026-01-01T00:00:00.000Z",
    });
    const newer = threadSummary({
      id: newerThreadId,
      modifiedAt: "2026-01-02T00:00:00.000Z",
    });
    const sections = buildProjectChatSections(
      [older, newer],
      [],
      "/repo",
      null,
      undefined,
      ["/repo"],
      undefined,
      [
        {
          id: projectId,
          environmentId: primaryEnvironmentId,
          title: "Repo",
          cwd: "/repo",
        },
      ],
      {
        sortByRecency: false,
        itemOrderRank: new Map([
          [olderThreadId, 0],
          [newerThreadId, 1],
        ]),
      },
    );

    expect(sections[0]?.items.map((item) => item.id)).toEqual([olderThreadId, newerThreadId]);
  });

  it("sorts threads by recency after bootstrap completes", () => {
    const older = threadSummary({
      id: olderThreadId,
      modifiedAt: "2026-01-01T00:00:00.000Z",
    });
    const newer = threadSummary({
      id: newerThreadId,
      modifiedAt: "2026-01-02T00:00:00.000Z",
    });
    const sections = buildProjectChatSections(
      [older, newer],
      [],
      "/repo",
      null,
      undefined,
      ["/repo"],
      undefined,
      [
        {
          id: projectId,
          environmentId: primaryEnvironmentId,
          title: "Repo",
          cwd: "/repo",
        },
      ],
      { sortByRecency: true },
    );

    expect(sections[0]?.items.map((item) => item.id)).toEqual([newerThreadId, olderThreadId]);
  });
});
