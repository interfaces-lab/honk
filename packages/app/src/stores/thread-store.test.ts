import { DEFAULT_TEXT_GENERATION_MODEL_SELECTION } from "@honk/shared/server-settings";
import { EnvironmentId } from "@honk/shared/environment";
import {
  EventId,
  RuntimeSessionId,
  TurnId,
  type AgentRuntimeEvent,
  type OrchestrationEvent,
  type OrchestrationShellSnapshot,
} from "@honk/contracts";
import { ThreadId } from "@honk/shared/base-schemas";
import { describe, expect, it } from "vitest";

import { scopeThreadRef } from "~/lib/environment-scope";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE } from "../types";
import {
  initialState,
  selectSidebarThreadSummaryByRef,
  selectSidebarThreadsAcrossEnvironments,
} from "./thread-store";
import {
  applyAgentRuntimeEvent,
  applyOrchestrationEvent,
  syncServerShellSnapshot,
} from "./thread-sync";

const environmentId = EnvironmentId.make("environment:sidebar-live-state");
const threadId = ThreadId.make("thread:sidebar-live-state");
const turnId = TurnId.make("turn:sidebar-live-state");
const runtimeSessionId = RuntimeSessionId.make("runtime:sidebar-live-state");
const createdAt = "2026-06-01T12:00:00.000Z";
const startedAt = "2026-06-01T12:00:01.000Z";
const turnCompletedAt = "2026-06-01T12:00:02.000Z";

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

  it("does not let a stale server shell snapshot hide an active Pi run between turns", () => {
    const baseState = syncServerShellSnapshot(initialState, shellSnapshot, environmentId);
    const turnStartedEvent = {
      id: EventId.make("runtime-event:sidebar-live-state-turn-started"),
      type: "turn.started",
      agentRuntime: "pi",
      threadId,
      runtimeSessionId,
      turnId,
      createdAt: startedAt,
    } satisfies AgentRuntimeEvent;
    const turnCompletedEvent = {
      id: EventId.make("runtime-event:sidebar-live-state-turn-completed"),
      type: "turn.completed",
      agentRuntime: "pi",
      threadId,
      runtimeSessionId,
      turnId,
      createdAt: turnCompletedAt,
      data: { type: "turn_end" },
    } satisfies AgentRuntimeEvent;

    const betweenTurnState = applyAgentRuntimeEvent(
      applyAgentRuntimeEvent(baseState, turnStartedEvent, environmentId),
      turnCompletedEvent,
      environmentId,
    );
    const resyncedState = syncServerShellSnapshot(betweenTurnState, shellSnapshot, environmentId);
    const summary = selectSidebarThreadSummaryByRef(
      resyncedState,
      scopeThreadRef(environmentId, threadId),
    );

    expect(summary?.session?.orchestrationStatus).toBe("running");
    expect(summary?.session?.activeTurnId).toBeUndefined();
    expect(summary?.latestTurn?.state).toBe("completed");
    expect(summary?.latestTurn?.completedAt).toBe(turnCompletedAt);
  });

  it("clears a live Pi running shell state once the server confirms the completed latest turn", () => {
    const baseState = syncServerShellSnapshot(initialState, shellSnapshot, environmentId);
    const turnStartedEvent = {
      id: EventId.make("runtime-event:sidebar-live-state-turn-started"),
      type: "turn.started",
      agentRuntime: "pi",
      threadId,
      runtimeSessionId,
      turnId,
      createdAt: startedAt,
    } satisfies AgentRuntimeEvent;
    const turnCompletedEvent = {
      id: EventId.make("runtime-event:sidebar-live-state-turn-completed"),
      type: "turn.completed",
      agentRuntime: "pi",
      threadId,
      runtimeSessionId,
      turnId,
      createdAt: turnCompletedAt,
      data: { type: "turn_end" },
    } satisfies AgentRuntimeEvent;
    const completedShellSnapshot = {
      ...shellSnapshot,
      threads: [
        {
          ...shellSnapshot.threads[0]!,
          session: null,
          latestTurn: {
            turnId,
            state: "completed",
            requestedAt: startedAt,
            startedAt,
            completedAt: turnCompletedAt,
            assistantMessageId: null,
          },
          updatedAt: turnCompletedAt,
        },
      ],
      updatedAt: turnCompletedAt,
    } satisfies OrchestrationShellSnapshot;

    const runningState = applyAgentRuntimeEvent(
      applyAgentRuntimeEvent(baseState, turnStartedEvent, environmentId),
      turnCompletedEvent,
      environmentId,
    );
    const resyncedState = syncServerShellSnapshot(
      runningState,
      completedShellSnapshot,
      environmentId,
    );
    const summary = selectSidebarThreadSummaryByRef(
      resyncedState,
      scopeThreadRef(environmentId, threadId),
    );

    expect(summary?.session).toBeNull();
    expect(summary?.latestTurn?.state).toBe("completed");
    expect(summary?.latestTurn?.completedAt).toBe(turnCompletedAt);
  });
});
