import { EnvironmentId, ProjectId, ThreadId, TurnId } from "@honk/contracts";
import { describe, expect, it } from "vitest";

import {
  DESKTOP_RUNTIME_ENVIRONMENT_ID,
  scopeProjectRef,
  scopeThreadRef,
} from "~/lib/environment-scope";
import { getSidebarThreadModifiedAt, needsSidebarAttention } from "./use-agent-sidebar-model";
import { buildProjectChatSections } from "./view-model";
import type { SidebarThreadSummary as StoreSidebarThreadSummary } from "~/types";
import type { SidebarThreadSummary } from "./types";

const primaryEnvironmentId = EnvironmentId.make("environment:primary");
const projectId = ProjectId.make("project:workspace");
const threadId = ThreadId.make("thread:pi-runtime");
const olderThreadId = ThreadId.make("thread:older");
const newerThreadId = ThreadId.make("thread:newer");
const latestTurnId = TurnId.make("turn:running");
const projectRef = scopeProjectRef(primaryEnvironmentId, projectId);
const routeThreadRef = scopeThreadRef(DESKTOP_RUNTIME_ENVIRONMENT_ID, threadId);

function storeThreadSummary(
  input: Partial<StoreSidebarThreadSummary> = {},
): StoreSidebarThreadSummary {
  return {
    id: threadId,
    environmentId: DESKTOP_RUNTIME_ENVIRONMENT_ID,
    projectId,
    title: "Pi thread",
    interactionMode: "agent",
    session: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    updatedAt: "2026-01-02T00:00:00.000Z",
    latestTurn: null,
    branch: null,
    worktreePath: null,
    latestUserMessageAt: "2026-01-01T00:00:00.000Z",
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...input,
  };
}

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
    archived: false,
    messageCount: 1,
    firstMessage: "Pi thread",
    isStreaming: false,
    orchestrationStatus: null,
    latestTurnState: null,
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

  it("sorts threads by recency", () => {
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
    );

    expect(sections[0]?.items.map((item) => item.id)).toEqual([newerThreadId, olderThreadId]);
  });

  it("maps stopped sessions to the stopped sidebar state", () => {
    const sections = buildProjectChatSections(
      [
        threadSummary({
          orchestrationStatus: "stopped",
        }),
      ],
      [],
      "/repo",
      null,
      undefined,
      ["/repo"],
    );

    expect(sections[0]?.items[0]).toMatchObject({
      kind: "thread",
      state: "stopped",
    });
  });

  it("maps interrupted latest turns to the stopped sidebar state", () => {
    const sections = buildProjectChatSections(
      [
        threadSummary({
          orchestrationStatus: "ready",
          latestTurnState: "interrupted",
        }),
      ],
      [],
      "/repo",
      null,
      undefined,
      ["/repo"],
    );

    expect(sections[0]?.items[0]).toMatchObject({
      kind: "thread",
      state: "stopped",
    });
  });

  it("maps running latest turns to the running sidebar state", () => {
    const sections = buildProjectChatSections(
      [
        threadSummary({
          orchestrationStatus: "ready",
          latestTurnState: "running",
        }),
      ],
      [],
      "/repo",
      null,
      undefined,
      ["/repo"],
    );

    expect(sections[0]?.items[0]).toMatchObject({
      kind: "thread",
      state: "running",
    });
  });
});

describe("getSidebarThreadModifiedAt", () => {
  it("uses latest user message time instead of read-side updatedAt bumps", () => {
    expect(
      getSidebarThreadModifiedAt(
        storeThreadSummary({
          updatedAt: "2026-01-03T00:00:00.000Z",
          latestUserMessageAt: "2026-01-01T00:00:00.000Z",
        }),
      ),
    ).toBe("2026-01-01T00:00:00.000Z");
  });

  it("falls back to updatedAt and then createdAt", () => {
    expect(
      getSidebarThreadModifiedAt(
        storeThreadSummary({
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
          latestUserMessageAt: null,
        }),
      ),
    ).toBe("2026-01-02T00:00:00.000Z");

    expect(
      getSidebarThreadModifiedAt(
        storeThreadSummary({
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: undefined,
          latestUserMessageAt: null,
        }),
      ),
    ).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("needsSidebarAttention", () => {
  it("treats actionable proposed plans as sidebar attention after the run settles", () => {
    expect(
      needsSidebarAttention(
        storeThreadSummary({
          hasActionableProposedPlan: true,
          session: {
            status: "ready",
            orchestrationStatus: "ready",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z",
          },
        }),
      ),
    ).toBe(true);
  });

  it("keeps running threads on the loading state instead of plan attention", () => {
    expect(
      needsSidebarAttention(
        storeThreadSummary({
          hasActionableProposedPlan: true,
          session: {
            status: "running",
            orchestrationStatus: "running",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z",
          },
        }),
      ),
    ).toBe(false);

    expect(
      needsSidebarAttention(
        storeThreadSummary({
          hasActionableProposedPlan: true,
          session: {
            status: "ready",
            orchestrationStatus: "ready",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z",
          },
          latestTurn: {
            turnId: latestTurnId,
            state: "running",
            requestedAt: "2026-01-01T00:00:00.000Z",
            startedAt: "2026-01-02T00:00:00.000Z",
            completedAt: null,
            assistantMessageId: null,
          },
        }),
      ),
    ).toBe(false);
  });
});
