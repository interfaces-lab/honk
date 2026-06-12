import {
  DEFAULT_TEXT_GENERATION_MODEL_SELECTION,
  EnvironmentId,
  EventId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
  type OrchestrationShellSnapshot,
} from "@honk/contracts";
import { describe, expect, it } from "vitest";

import { scopeThreadRef } from "~/lib/environment-scope";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE } from "../types";
import { initialState, selectSidebarThreadSummaryByRef, selectSidebarThreadsAcrossEnvironments } from "./thread-store";
import { applyOrchestrationEvent, syncServerShellSnapshot } from "./thread-sync";

const environmentId = EnvironmentId.make("environment:sidebar-live-state");
const threadId = ThreadId.make("thread:sidebar-live-state");
const turnId = TurnId.make("turn:sidebar-live-state");
const createdAt = "2026-06-01T12:00:00.000Z";
const startedAt = "2026-06-01T12:00:01.000Z";

const shellSnapshot = {
  snapshotSequence: 1,
  projects: [],
  threads: [
    {
      id: threadId,
      projectId: null,
      title: "Running thread",
      modelSelection: DEFAULT_TEXT_GENERATION_MODEL_SELECTION,
      runtimeMode: DEFAULT_RUNTIME_MODE,
      interactionMode: DEFAULT_INTERACTION_MODE,
      branch: null,
      worktreePath: null,
      latestTurn: null,
      createdAt,
      updatedAt: createdAt,
      archivedAt: null,
      session: {
        threadId,
        status: "ready",
        runtimeMode: DEFAULT_RUNTIME_MODE,
        activeTurnId: null,
        updatedAt: createdAt,
        lastError: null,
      },
      latestUserMessageAt: createdAt,
      hasPendingApprovals: false,
      hasPendingUserInput: false,
      hasActionableProposedPlan: false,
    },
  ],
  updatedAt: createdAt,
} satisfies OrchestrationShellSnapshot;

const sessionSetEvent = {
  sequence: 2,
  eventId: EventId.make("event:sidebar-live-state-session-set"),
  aggregateKind: "thread",
  aggregateId: threadId,
  occurredAt: startedAt,
  commandId: null,
  causationEventId: null,
  correlationId: null,
  metadata: {},
  type: "thread.session-set",
  payload: {
    threadId,
    session: {
      threadId,
      status: "running",
      runtimeMode: DEFAULT_RUNTIME_MODE,
      activeTurnId: turnId,
      updatedAt: startedAt,
      lastError: null,
    },
  },
} satisfies OrchestrationEvent;

function stateWithRunningDetailEvent() {
  return applyOrchestrationEvent(
    syncServerShellSnapshot(initialState, shellSnapshot, environmentId),
    sessionSetEvent,
    environmentId,
  );
}

describe("sidebar thread selectors", () => {
  it("reads running state from the canonical sidebar summary", () => {
    const summaries = selectSidebarThreadsAcrossEnvironments(stateWithRunningDetailEvent());

    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.session?.orchestrationStatus).toBe("running");
    expect(summaries[0]?.latestTurn?.state).toBe("running");
  });

  it("reads the canonical sidebar summary for ref lookups", () => {
    const summary = selectSidebarThreadSummaryByRef(
      stateWithRunningDetailEvent(),
      scopeThreadRef(environmentId, threadId),
    );

    expect(summary?.session?.orchestrationStatus).toBe("running");
    expect(summary?.latestTurn?.state).toBe("running");
  });
});
