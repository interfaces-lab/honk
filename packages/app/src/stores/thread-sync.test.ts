import {
  CommandId,
  EnvironmentId,
  EventId,
  MessageId,
  RuntimeItemId,
  ThreadEntryId,
  ThreadId,
  TurnId,
  ProjectId,
  type OrchestrationEvent,
  type OrchestrationShellSnapshot,
  type ProviderRuntimeEvent,
} from "@multi/contracts";
import { describe, expect, it } from "vitest";

import {
  applyOrchestrationEvent,
  applyProviderRuntimeEvent,
  applyShellEvent,
  syncServerShellSnapshot,
  syncServerThreadDetail,
} from "./thread-sync";
import { initialState } from "./thread-store";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE } from "../types";
import { getThreadFromEnvironmentState } from "../thread-derivation";

const environmentId = EnvironmentId.make("environment-thread-sync");
const projectId = ProjectId.make("project-1");
const threadId = ThreadId.make("thread-1");

const modelSelection = {
  instanceId: "codex",
  model: "gpt-5-codex",
};

function shellSnapshot(): OrchestrationShellSnapshot {
  return {
    snapshotSequence: 1,
    projects: [
      {
        id: projectId,
        title: "Project",
        projectRoot: "/tmp/project",
        repositoryIdentity: null,
        defaultModelSelection: null,
        scripts: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    threads: [
      {
        id: threadId,
        projectId,
        title: "Thread",
        modelSelection,
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_INTERACTION_MODE,
        branch: null,
        worktreePath: null,
        latestTurn: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        archivedAt: null,
        session: null,
        latestUserMessageAt: null,
        hasPendingApprovals: false,
        hasPendingUserInput: false,
        hasActionableProposedPlan: false,
      },
    ],
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("thread sync", () => {
  it("bootstraps shell state without detail records", () => {
    const state = syncServerShellSnapshot(initialState, shellSnapshot(), environmentId);
    const environmentState = state.environmentStateById[environmentId];

    expect(environmentState?.bootstrapComplete).toBe(true);
    expect(environmentState?.projectIds).toEqual([projectId]);
    expect(environmentState?.threadIdsByProjectId[projectId]).toEqual([threadId]);
    expect(environmentState?.messageIdsByThreadId[threadId]).toBeUndefined();
    expect(environmentState?.sidebarThreadSummaryById[threadId]?.title).toBe("Thread");
  });

  it("applies detail snapshots to detail records", () => {
    const bootstrapped = syncServerShellSnapshot(initialState, shellSnapshot(), environmentId);
    const messageId = MessageId.make("message-1");
    const state = syncServerThreadDetail(
      bootstrapped,
      {
        id: threadId,
        projectId,
        title: "Thread",
        modelSelection,
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_INTERACTION_MODE,
        branch: null,
        worktreePath: null,
        latestTurn: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:01.000Z",
        archivedAt: null,
        deletedAt: null,
        messages: [
          {
            id: messageId,
            role: "user",
            text: "hello",
            turnId: null,
            streaming: false,
            createdAt: "2026-01-01T00:00:01.000Z",
            updatedAt: "2026-01-01T00:00:01.000Z",
          },
        ],
        leafId: null,
        entries: [],
        proposedPlans: [],
        activities: [],
        chatTimelineRows: [],
        session: null,
      },
      environmentId,
    );
    const environmentState = state.environmentStateById[environmentId];

    expect(environmentState?.messageIdsByThreadId[threadId]).toEqual([messageId]);
    expect(environmentState?.messageByThreadId[threadId]?.[messageId]?.text).toBe("hello");
    expect(environmentState?.sidebarThreadSummaryById[threadId]?.title).toBe("Thread");
  });

  it("keeps assistant runtime deltas transient until the committed message arrives", () => {
    const turnId = TurnId.make("turn-live");
    const assistantMessageId = MessageId.make("assistant:item-live");
    const bootstrapped = syncServerShellSnapshot(initialState, shellSnapshot(), environmentId);
    const runtimeDelta: ProviderRuntimeEvent = {
      type: "content.delta",
      eventId: EventId.make("event-live-delta"),
      provider: "codex",
      providerInstanceId: "codex",
      threadId,
      turnId,
      itemId: RuntimeItemId.make("item-live"),
      createdAt: "2026-01-01T00:00:02.000Z",
      payload: {
        streamKind: "assistant_text",
        delta: "hello live",
      },
    };

    const live = applyProviderRuntimeEvent(bootstrapped, runtimeDelta, environmentId);
    const liveEnvironmentState = live.environmentStateById[environmentId];
    const liveThread = liveEnvironmentState
      ? getThreadFromEnvironmentState(liveEnvironmentState, threadId)
      : undefined;

    expect(liveEnvironmentState?.messageByThreadId[threadId]).toBeUndefined();
    expect(liveEnvironmentState?.liveAssistantTurnByThreadId[threadId]?.[turnId]?.text).toBe(
      "hello live",
    );
    expect(liveThread?.messages).toEqual([
      expect.objectContaining({
        id: assistantMessageId,
        text: "hello live",
        streaming: true,
        turnId,
      }),
    ]);

    const committed = applyOrchestrationEvent(
      live,
      {
        sequence: 2,
        eventId: EventId.make("event-live-commit"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: "2026-01-01T00:00:03.000Z",
        commandId: CommandId.make("command-live-commit"),
        causationEventId: null,
        correlationId: CommandId.make("command-live-commit"),
        metadata: {},
        type: "thread.message-sent",
        payload: {
          threadId,
          messageId: assistantMessageId,
          entryId: ThreadEntryId.make("entry-assistant-live"),
          parentEntryId: null,
          role: "assistant",
          text: "hello live",
          turnId,
          streaming: false,
          createdAt: "2026-01-01T00:00:03.000Z",
          updatedAt: "2026-01-01T00:00:03.000Z",
        },
      } satisfies OrchestrationEvent,
      environmentId,
    );
    const committedEnvironmentState = committed.environmentStateById[environmentId];
    const committedThread = committedEnvironmentState
      ? getThreadFromEnvironmentState(committedEnvironmentState, threadId)
      : undefined;

    expect(committedEnvironmentState?.liveAssistantTurnByThreadId[threadId]).toEqual({});
    expect(committedThread?.messages).toEqual([
      expect.objectContaining({
        id: assistantMessageId,
        text: "hello live",
        streaming: false,
        turnId,
      }),
    ]);
    expect(committedThread?.chatTimelineRows).toEqual([
      expect.objectContaining({
        kind: "message",
        messageId: assistantMessageId,
        turnId,
        entryId: "entry-assistant-live",
      }),
    ]);
  });

  it("derives live timeline rows when thread activities arrive", () => {
    const turnId = TurnId.make("turn-work");
    const bootstrapped = syncServerThreadDetail(
      syncServerShellSnapshot(initialState, shellSnapshot(), environmentId),
      {
        id: threadId,
        projectId,
        title: "Thread",
        modelSelection,
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_INTERACTION_MODE,
        branch: null,
        worktreePath: null,
        latestTurn: {
          turnId,
          state: "running",
          requestedAt: "2026-01-01T00:00:01.000Z",
          startedAt: "2026-01-01T00:00:02.000Z",
          completedAt: null,
          assistantMessageId: null,
        },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:02.000Z",
        archivedAt: null,
        deletedAt: null,
        messages: [],
        leafId: null,
        entries: [],
        proposedPlans: [],
        activities: [],
        chatTimelineRows: [],
        session: {
          threadId,
          status: "running",
          providerName: "codex",
          runtimeMode: DEFAULT_RUNTIME_MODE,
          activeTurnId: turnId,
          lastError: null,
          updatedAt: "2026-01-01T00:00:02.000Z",
        },
      },
      environmentId,
    );

    const updated = applyOrchestrationEvent(
      bootstrapped,
      {
        sequence: 2,
        eventId: EventId.make("event-tool-completed"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: "2026-01-01T00:00:03.000Z",
        commandId: CommandId.make("command-tool-completed"),
        causationEventId: null,
        correlationId: CommandId.make("command-tool-completed"),
        metadata: {},
        type: "thread.activity-appended",
        payload: {
          threadId,
          activity: {
            id: EventId.make("activity-tool-completed"),
            tone: "tool",
            kind: "tool.completed",
            summary: "Ran command",
            payload: {
              itemId: "tool-1",
              itemType: "command_execution",
              status: "completed",
            },
            turnId,
            createdAt: "2026-01-01T00:00:03.000Z",
          },
        },
      } satisfies OrchestrationEvent,
      environmentId,
    );
    const environmentState = updated.environmentStateById[environmentId];
    const thread = environmentState
      ? getThreadFromEnvironmentState(environmentState, threadId)
      : undefined;

    expect(thread?.chatTimelineRows).toEqual([
      expect.objectContaining({
        kind: "work",
        activityIds: ["activity-tool-completed"],
        turnId,
        toolCallId: "tool-1",
      }),
    ]);
  });

  it("interrupts the active running turn when the interrupt event omits a turn id", () => {
    const turnId = TurnId.make("turn-active");
    const assistantMessageId = MessageId.make("assistant-active");
    const bootstrapped = syncServerThreadDetail(
      syncServerShellSnapshot(initialState, shellSnapshot(), environmentId),
      {
        id: threadId,
        projectId,
        title: "Thread",
        modelSelection,
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_INTERACTION_MODE,
        branch: null,
        worktreePath: null,
        latestTurn: {
          turnId,
          state: "running",
          requestedAt: "2026-01-01T00:00:01.000Z",
          startedAt: "2026-01-01T00:00:02.000Z",
          completedAt: null,
          assistantMessageId,
        },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:02.000Z",
        archivedAt: null,
        deletedAt: null,
        messages: [
          {
            id: assistantMessageId,
            role: "assistant",
            text: "still streaming",
            turnId,
            streaming: true,
            createdAt: "2026-01-01T00:00:02.000Z",
            updatedAt: "2026-01-01T00:00:03.000Z",
          },
        ],
        leafId: null,
        entries: [],
        proposedPlans: [],
        activities: [],
        chatTimelineRows: [],
        session: {
          threadId,
          status: "running",
          providerName: "codex",
          runtimeMode: DEFAULT_RUNTIME_MODE,
          activeTurnId: turnId,
          lastError: null,
          updatedAt: "2026-01-01T00:00:02.000Z",
        },
      },
      environmentId,
    );

    const interrupted = applyOrchestrationEvent(
      bootstrapped,
      {
        sequence: 2,
        eventId: EventId.make("event-turn-interrupt-requested"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: "2026-01-01T00:00:04.000Z",
        commandId: CommandId.make("command-turn-interrupt"),
        causationEventId: null,
        correlationId: CommandId.make("command-turn-interrupt"),
        metadata: {},
        type: "thread.turn-interrupt-requested",
        payload: {
          threadId,
          createdAt: "2026-01-01T00:00:04.000Z",
        },
      } satisfies OrchestrationEvent,
      environmentId,
    );

    const environmentState = interrupted.environmentStateById[environmentId];
    const latestTurn = environmentState?.threadTurnStateById[threadId]?.latestTurn;
    const message = environmentState?.messageByThreadId[threadId]?.[assistantMessageId];
    expect(latestTurn?.state).toBe("interrupted");
    expect(latestTurn?.completedAt).toBe("2026-01-01T00:00:04.000Z");
    expect(message?.streaming).toBe(false);
    expect(message?.completedAt).toBe("2026-01-01T00:00:04.000Z");
  });

  it("removes thread scoped records on shell thread removal", () => {
    const messageId = MessageId.make("message-1");
    const bootstrapped = syncServerThreadDetail(
      syncServerShellSnapshot(initialState, shellSnapshot(), environmentId),
      {
        id: threadId,
        projectId,
        title: "Thread",
        modelSelection,
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_INTERACTION_MODE,
        branch: null,
        worktreePath: null,
        latestTurn: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:01.000Z",
        archivedAt: null,
        deletedAt: null,
        messages: [
          {
            id: messageId,
            role: "user",
            text: "hello",
            turnId: null,
            streaming: false,
            createdAt: "2026-01-01T00:00:01.000Z",
            updatedAt: "2026-01-01T00:00:01.000Z",
          },
        ],
        leafId: null,
        entries: [],
        proposedPlans: [],
        activities: [],
        chatTimelineRows: [],
        session: null,
      },
      environmentId,
    );
    const state = applyShellEvent(
      bootstrapped,
      {
        kind: "thread-removed",
        sequence: 2,
        threadId,
      },
      environmentId,
    );
    const environmentState = state.environmentStateById[environmentId];

    expect(environmentState?.threadIds).toEqual([]);
    expect(environmentState?.messageByThreadId[threadId]).toBeUndefined();
    expect(environmentState?.sidebarThreadSummaryById[threadId]).toBeUndefined();
  });

  it("archives and unarchives without changing the thread activity timestamp", () => {
    const bootstrapped = syncServerShellSnapshot(initialState, shellSnapshot(), environmentId);
    const archived = applyOrchestrationEvent(
      bootstrapped,
      {
        sequence: 2,
        eventId: EventId.make("event-thread-archived"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: "2026-01-01T00:00:10.000Z",
        commandId: CommandId.make("command-thread-archive"),
        causationEventId: null,
        correlationId: CommandId.make("command-thread-archive"),
        metadata: {},
        type: "thread.archived",
        payload: {
          threadId,
          archivedAt: "2026-01-01T00:00:10.000Z",
          updatedAt: "2026-01-01T00:00:10.000Z",
        },
      } satisfies OrchestrationEvent,
      environmentId,
    );

    expect(
      archived.environmentStateById[environmentId]?.threadShellById[threadId]?.archivedAt,
    ).toBe("2026-01-01T00:00:10.000Z");
    expect(archived.environmentStateById[environmentId]?.threadShellById[threadId]?.updatedAt).toBe(
      "2026-01-01T00:00:00.000Z",
    );

    const unarchived = applyOrchestrationEvent(
      archived,
      {
        sequence: 3,
        eventId: EventId.make("event-thread-unarchived"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: "2026-01-01T00:00:20.000Z",
        commandId: CommandId.make("command-thread-unarchive"),
        causationEventId: null,
        correlationId: CommandId.make("command-thread-unarchive"),
        metadata: {},
        type: "thread.unarchived",
        payload: {
          threadId,
          updatedAt: "2026-01-01T00:00:20.000Z",
        },
      } satisfies OrchestrationEvent,
      environmentId,
    );

    expect(
      unarchived.environmentStateById[environmentId]?.threadShellById[threadId]?.archivedAt,
    ).toBeNull();
    expect(
      unarchived.environmentStateById[environmentId]?.threadShellById[threadId]?.updatedAt,
    ).toBe("2026-01-01T00:00:00.000Z");
  });

  it("applies project events with canonical project names", () => {
    const event = {
      sequence: 1,
      eventId: EventId.make("event-1"),
      aggregateKind: "project",
      aggregateId: projectId,
      occurredAt: "2026-01-01T00:00:00.000Z",
      commandId: CommandId.make("command-1"),
      causationEventId: null,
      correlationId: CommandId.make("command-1"),
      metadata: {},
      type: "project.created",
      payload: {
        projectId,
        title: "Project",
        projectRoot: "/tmp/project",
        repositoryIdentity: null,
        defaultModelSelection: null,
        scripts: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    } satisfies OrchestrationEvent;
    const state = applyShellEvent(
      initialState,
      {
        kind: "project-upserted",
        sequence: 1,
        project: {
          id: projectId,
          title: event.payload.title,
          projectRoot: event.payload.projectRoot,
          repositoryIdentity: event.payload.repositoryIdentity,
          defaultModelSelection: event.payload.defaultModelSelection,
          scripts: event.payload.scripts,
          createdAt: event.payload.createdAt,
          updatedAt: event.payload.updatedAt,
        },
      },
      environmentId,
    );

    expect(state.environmentStateById[environmentId]?.projectById[projectId]?.name).toBe("Project");
  });
});
