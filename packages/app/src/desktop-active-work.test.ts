import { EnvironmentId, ProjectId, ProviderDriverKind, ThreadId, TurnId } from "@multi/contracts";
import { describe, expect, it } from "vitest";

import { countRunningThreadsWithServerState } from "./desktop-active-work";
import {
  initialEnvironmentState,
  type AppState,
  type EnvironmentState,
} from "./stores/thread-store";
import { DEFAULT_INTERACTION_MODE, type SidebarThreadSummary, type ThreadSession } from "./types";

const environmentId = EnvironmentId.make("environment-1");
const threadId = ThreadId.make("thread-1");
const projectId = ProjectId.make("project-1");
const turnId = TurnId.make("turn-1");
const timestamp = "2026-05-21T12:00:00.000Z";

function makeSession(overrides: Partial<ThreadSession> = {}): ThreadSession {
  return {
    provider: ProviderDriverKind.make("codex"),
    status: "running",
    orchestrationStatus: "running",
    activeTurnId: turnId,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function makeSummary(overrides: Partial<SidebarThreadSummary> = {}): SidebarThreadSummary {
  return {
    id: threadId,
    environmentId,
    projectId,
    title: "Thread",
    interactionMode: DEFAULT_INTERACTION_MODE,
    session: null,
    createdAt: timestamp,
    archivedAt: null,
    updatedAt: timestamp,
    latestTurn: null,
    branch: null,
    worktreePath: null,
    latestUserMessageAt: timestamp,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  };
}

function makeState(
  summaries: ReadonlyArray<SidebarThreadSummary>,
  snapshotSource: EnvironmentState["snapshotSource"] = "server",
): AppState {
  const sidebarThreadSummaryById: EnvironmentState["sidebarThreadSummaryById"] = {};
  for (const summary of summaries) {
    sidebarThreadSummaryById[summary.id] = summary;
  }

  return {
    activeEnvironmentId: environmentId,
    environmentStateById: {
      [environmentId]: {
        ...initialEnvironmentState,
        threadIds: summaries.map((summary) => summary.id),
        sidebarThreadSummaryById,
        snapshotSource,
      },
    },
  };
}

describe("countRunningThreadsWithServerState", () => {
  it("counts server-backed threads with an active running turn", () => {
    const state = makeState([makeSummary({ session: makeSession() })]);

    expect(countRunningThreadsWithServerState(state)).toBe(1);
  });

  it("ignores stale running latest-turn state when the session is stopped", () => {
    const state = makeState([
      makeSummary({
        session: makeSession({
          status: "closed",
          orchestrationStatus: "stopped",
          activeTurnId: undefined,
        }),
        latestTurn: {
          turnId,
          state: "running",
          requestedAt: timestamp,
          startedAt: timestamp,
          completedAt: null,
          assistantMessageId: null,
        },
      }),
    ]);

    expect(countRunningThreadsWithServerState(state)).toBe(0);
  });

  it("ignores running sessions that do not have an active turn", () => {
    const state = makeState([
      makeSummary({
        session: makeSession({ activeTurnId: undefined }),
      }),
    ]);

    expect(countRunningThreadsWithServerState(state)).toBe(0);
  });

  it("ignores cached snapshots", () => {
    const state = makeState([makeSummary({ session: makeSession() })], "cache");

    expect(countRunningThreadsWithServerState(state)).toBe(0);
  });
});
