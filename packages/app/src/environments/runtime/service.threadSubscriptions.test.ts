import { QueryClient } from "@tanstack/react-query";
import {
  CommandId,
  EnvironmentId,
  EventId,
  MessageId,
  type OrchestrationEvent,
  type OrchestrationThread,
  ProjectId,
  ProviderItemId,
  ThreadId,
  ThreadEntryId,
  TurnId,
  type OrchestrationShellSnapshot,
} from "@multi/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSubscribeThread = vi.fn();
const mockThreadUnsubscribe = vi.fn();
const mockCreateEnvironmentConnection = vi.fn();
const mockCreateWsRpcClient = vi.fn();
const mockRefreshGitStatus = vi.fn();

type MessageSentEvent = Extract<OrchestrationEvent, { type: "thread.message-sent" }>;
type ThreadActivityAppendedEvent = Extract<
  OrchestrationEvent,
  { type: "thread.activity-appended" }
>;

function MockWsTransport() {
  return undefined;
}

vi.mock("../primary", () => ({
  getPrimaryKnownEnvironment: vi.fn(() => ({
    id: "env-1",
    label: "Primary environment",
    source: "window-origin",
    target: {
      httpBaseUrl: "http://127.0.0.1:3000/",
      wsBaseUrl: "ws://127.0.0.1:3000/",
    },
    environmentId: EnvironmentId.make("env-1"),
  })),
}));

vi.mock("./connection", () => ({
  createEnvironmentConnection: mockCreateEnvironmentConnection,
}));

vi.mock("../../rpc/ws-rpc-client", () => ({
  createWsRpcClient: mockCreateWsRpcClient,
}));

vi.mock("../../rpc/ws-transport", () => ({
  WsTransport: MockWsTransport,
}));

vi.mock("~/lib/git-status-state", () => ({
  refreshGitStatus: mockRefreshGitStatus,
}));

function makeThreadShellSnapshot(params: {
  readonly threadId: ThreadId;
  readonly projectCwd?: string;
  readonly worktreePath?: string | null;
  readonly sessionStatus?:
    | "idle"
    | "starting"
    | "running"
    | "ready"
    | "interrupted"
    | "stopped"
    | "error";
  readonly hasPendingApprovals?: boolean;
  readonly hasPendingUserInput?: boolean;
  readonly hasActionableProposedPlan?: boolean;
}): OrchestrationShellSnapshot {
  const projectId = ProjectId.make("project-1");
  const turnId = TurnId.make("turn-1");
  const projectCwd = params.projectCwd ?? null;

  return {
    snapshotSequence: 1,
    projects:
      projectCwd === null
        ? []
        : [
            {
              id: projectId,
              title: "Project",
              projectRoot: projectCwd,
              defaultModelSelection: {
                instanceId: "codex",
                model: "gpt-5-codex",
              },
              scripts: [],
              createdAt: "2026-04-13T00:00:00.000Z",
              updatedAt: "2026-04-13T00:00:00.000Z",
            },
          ],
    updatedAt: "2026-04-13T00:00:00.000Z",
    threads: [
      {
        id: params.threadId,
        projectId,
        title: "Thread",
        modelSelection: {
          instanceId: "codex",
          model: "gpt-5-codex",
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: params.worktreePath ?? null,
        latestTurn:
          params.sessionStatus === "running"
            ? {
                turnId,
                state: "running",
                requestedAt: "2026-04-13T00:00:00.000Z",
                startedAt: "2026-04-13T00:00:01.000Z",
                completedAt: null,
                assistantMessageId: null,
              }
            : null,
        createdAt: "2026-04-13T00:00:00.000Z",
        updatedAt: "2026-04-13T00:00:00.000Z",
        archivedAt: null,
        session: params.sessionStatus
          ? {
              threadId: params.threadId,
              status: params.sessionStatus,
              providerName: "codex",
              runtimeMode: "full-access",
              activeTurnId: params.sessionStatus === "running" ? turnId : null,
              lastError: null,
              updatedAt: "2026-04-13T00:00:00.000Z",
            }
          : null,
        latestUserMessageAt: null,
        hasPendingApprovals: params.hasPendingApprovals ?? false,
        hasPendingUserInput: params.hasPendingUserInput ?? false,
        hasActionableProposedPlan: params.hasActionableProposedPlan ?? false,
      },
    ],
  };
}

function makeThreadDetail(threadId: ThreadId): OrchestrationThread {
  return {
    id: threadId,
    projectId: ProjectId.make("project-1"),
    title: "Thread",
    modelSelection: {
      instanceId: "codex",
      model: "gpt-5-codex",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-04-13T00:00:00.000Z",
    updatedAt: "2026-04-13T00:00:00.000Z",
    archivedAt: null,
    deletedAt: null,
    messages: [],
    leafId: null,
    entries: [],
    proposedPlans: [],
    activities: [],
    chatTimelineRows: [],
    session: null,
  };
}

function makeToolActivityEvent(params: {
  readonly sequence: number;
  readonly threadId: ThreadId;
  readonly activityId: string;
  readonly kind: "tool.started" | "tool.updated" | "tool.completed";
  readonly status: "inProgress" | "completed";
  readonly detail?: string | undefined;
  readonly streamKind?: "command_output" | "file_change_output" | undefined;
}): ThreadActivityAppendedEvent {
  return {
    sequence: params.sequence,
    eventId: EventId.make(`event-${params.activityId}`),
    aggregateKind: "thread",
    aggregateId: params.threadId,
    occurredAt: `2026-04-13T00:00:0${params.sequence}.000Z`,
    commandId: CommandId.make("command-tool"),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type: "thread.activity-appended",
    payload: {
      threadId: params.threadId,
      activity: {
        id: EventId.make(params.activityId),
        tone: "tool",
        kind: params.kind,
        summary: "Ran command",
        payload: {
          itemId: "command-1",
          itemType: "command_execution",
          status: params.status,
          ...(params.detail !== undefined ? { detail: params.detail } : {}),
          ...(params.streamKind
            ? { data: { streamKind: params.streamKind, delta: params.detail ?? "" } }
            : {}),
        },
        turnId: null,
        createdAt: `2026-04-13T00:00:0${params.sequence}.000Z`,
      },
    },
  };
}

function makeSubagentDeltaEvent(params: {
  readonly sequence: number;
  readonly threadId: ThreadId;
  readonly delta: string;
}): ThreadActivityAppendedEvent {
  return {
    sequence: params.sequence,
    eventId: EventId.make(`event-subagent-delta-${params.sequence}`),
    aggregateKind: "thread",
    aggregateId: params.threadId,
    occurredAt: `2026-04-13T00:00:0${params.sequence}.000Z`,
    commandId: CommandId.make("command-subagent"),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type: "thread.activity-appended",
    payload: {
      threadId: params.threadId,
      activity: {
        id: EventId.make(`activity-subagent-delta-${params.sequence}`),
        tone: "tool",
        kind: "subagent.content.delta",
        summary: "Subagent content delta",
        payload: {
          providerThreadId: "subagent-thread-1",
          itemId: "subagent-message-1",
          streamKind: "assistant_text",
          delta: params.delta,
        },
        turnId: null,
        createdAt: `2026-04-13T00:00:0${params.sequence}.000Z`,
      },
    },
  };
}

function makeSubagentItemEvent(params: {
  readonly sequence: number;
  readonly threadId: ThreadId;
  readonly activityId: string;
  readonly kind: "subagent.item.started" | "subagent.item.updated" | "subagent.item.completed";
  readonly status: "inProgress" | "completed";
  readonly detail?: string | undefined;
}): ThreadActivityAppendedEvent {
  return {
    sequence: params.sequence,
    eventId: EventId.make(`event-${params.activityId}`),
    aggregateKind: "thread",
    aggregateId: params.threadId,
    occurredAt: `2026-04-13T00:00:0${params.sequence}.000Z`,
    commandId: CommandId.make("command-subagent-item"),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type: "thread.activity-appended",
    payload: {
      threadId: params.threadId,
      activity: {
        id: EventId.make(params.activityId),
        tone: "tool",
        kind: params.kind,
        summary: "Ran command",
        payload: {
          providerThreadId: "subagent-thread-1",
          parentItemId: ProviderItemId.make("parent-subagent-call"),
          itemId: "subagent-command-1",
          itemType: "command_execution",
          status: params.status,
          title: "Ran command",
          ...(params.detail !== undefined ? { detail: params.detail } : {}),
        },
        turnId: null,
        createdAt: `2026-04-13T00:00:0${params.sequence}.000Z`,
      },
    },
  };
}

describe("retainThreadDetailSubscription", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.clearAllMocks();

    mockThreadUnsubscribe.mockImplementation(() => undefined);
    mockSubscribeThread.mockImplementation(() => mockThreadUnsubscribe);
    mockRefreshGitStatus.mockResolvedValue(undefined);
    mockCreateWsRpcClient.mockReturnValue({
      orchestration: {
        subscribeThread: mockSubscribeThread,
      },
    });
    mockCreateEnvironmentConnection.mockImplementation((input) => ({
      environmentId: input.knownEnvironment.environmentId,
      knownEnvironment: input.knownEnvironment,
      client: input.client,
      ensureBootstrapped: vi.fn(async () => undefined),
      reconnect: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
    }));
  });

  afterEach(async () => {
    const { resetEnvironmentServiceForTests } = await import("./service");
    await resetEnvironmentServiceForTests();
    vi.useRealTimers();
  });

  it("keeps thread detail subscriptions warm across releases until idle eviction", async () => {
    const {
      retainThreadDetailSubscription,
      startEnvironmentConnectionService,
      resetEnvironmentServiceForTests,
    } = await import("./service");

    const stop = startEnvironmentConnectionService(new QueryClient());
    const environmentId = EnvironmentId.make("env-1");
    const threadId = ThreadId.make("thread-1");

    const releaseFirst = retainThreadDetailSubscription(environmentId, threadId);
    expect(mockSubscribeThread).toHaveBeenCalledTimes(1);

    releaseFirst();
    expect(mockThreadUnsubscribe).not.toHaveBeenCalled();

    const releaseSecond = retainThreadDetailSubscription(environmentId, threadId);
    expect(mockSubscribeThread).toHaveBeenCalledTimes(1);

    releaseSecond();
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    expect(mockThreadUnsubscribe).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(28 * 60 * 1000);
    expect(mockThreadUnsubscribe).toHaveBeenCalledTimes(1);

    stop();
    await resetEnvironmentServiceForTests();
  });

  it("keeps non-idle thread detail subscriptions attached until the thread becomes idle", async () => {
    const {
      retainThreadDetailSubscription,
      startEnvironmentConnectionService,
      resetEnvironmentServiceForTests,
    } = await import("./service");

    const stop = startEnvironmentConnectionService(new QueryClient());
    const environmentId = EnvironmentId.make("env-1");
    const threadId = ThreadId.make("thread-active");

    const connectionInput = mockCreateEnvironmentConnection.mock.calls[0]?.[0];
    expect(connectionInput).toBeDefined();

    connectionInput.syncShellSnapshot(
      makeThreadShellSnapshot({
        threadId,
        sessionStatus: "ready",
        hasPendingApprovals: true,
      }),
      environmentId,
    );

    const release = retainThreadDetailSubscription(environmentId, threadId);
    expect(mockSubscribeThread).toHaveBeenCalledTimes(1);

    release();
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(mockThreadUnsubscribe).not.toHaveBeenCalled();

    connectionInput.applyShellEvent(
      {
        kind: "thread-upserted",
        sequence: 2,
        thread: makeThreadShellSnapshot({
          threadId,
          sessionStatus: "idle",
        }).threads[0]!,
      },
      environmentId,
    );

    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(mockThreadUnsubscribe).toHaveBeenCalledTimes(1);

    stop();
    await resetEnvironmentServiceForTests();
  });

  it("allows a larger idle cache before capacity eviction starts", async () => {
    const {
      retainThreadDetailSubscription,
      startEnvironmentConnectionService,
      resetEnvironmentServiceForTests,
    } = await import("./service");

    const stop = startEnvironmentConnectionService(new QueryClient());
    const environmentId = EnvironmentId.make("env-1");

    for (let index = 0; index < 12; index += 1) {
      const release = retainThreadDetailSubscription(
        environmentId,
        ThreadId.make(`thread-${index + 1}`),
      );
      release();
    }

    expect(mockThreadUnsubscribe).not.toHaveBeenCalled();

    stop();
    await resetEnvironmentServiceForTests();
  });

  it("disposes cached thread detail subscriptions when the environment service resets", async () => {
    const {
      retainThreadDetailSubscription,
      startEnvironmentConnectionService,
      resetEnvironmentServiceForTests,
    } = await import("./service");

    const stop = startEnvironmentConnectionService(new QueryClient());
    const environmentId = EnvironmentId.make("env-1");
    const threadId = ThreadId.make("thread-2");

    const release = retainThreadDetailSubscription(environmentId, threadId);
    release();

    await resetEnvironmentServiceForTests();
    expect(mockThreadUnsubscribe).toHaveBeenCalledTimes(1);

    stop();
  });

  it("refreshes git status and invalidates patch queries after file-change detail activity", async () => {
    const {
      retainThreadDetailSubscription,
      startEnvironmentConnectionService,
      resetEnvironmentServiceForTests,
    } = await import("./service");
    const queryClient = new QueryClient();
    const environmentId = EnvironmentId.make("env-1");
    const threadId = ThreadId.make("thread-git-refresh");
    const patchQueryKey = [
      "git",
      "patch",
      environmentId,
      "/repo",
      "src/a.ts",
      "modified",
      null,
    ] as const;
    queryClient.setQueryData(patchQueryKey, { kind: "patch", patch: "diff", message: null });

    const stop = startEnvironmentConnectionService(queryClient);
    const connectionInput = mockCreateEnvironmentConnection.mock.calls[0]?.[0];
    expect(connectionInput).toBeDefined();
    connectionInput.syncShellSnapshot(
      makeThreadShellSnapshot({
        threadId,
        projectCwd: "/repo",
      }),
      environmentId,
    );

    const release = retainThreadDetailSubscription(environmentId, threadId);
    const threadListener = mockSubscribeThread.mock.calls[0]?.[1];
    expect(threadListener).toBeDefined();

    threadListener({
      kind: "event",
      event: {
        sequence: 2,
        eventId: EventId.make("event-1"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: "2026-04-13T00:00:01.000Z",
        commandId: null,
        causationEventId: null,
        correlationId: null,
        metadata: {},
        type: "thread.activity-appended",
        payload: {
          threadId,
          activity: {
            id: EventId.make("activity-1"),
            tone: "tool",
            kind: "tool.completed",
            summary: "Edited file",
            payload: { itemType: "file_change" },
            turnId: null,
            createdAt: "2026-04-13T00:00:01.000Z",
          },
        },
      },
    });

    await vi.advanceTimersByTimeAsync(16);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockRefreshGitStatus).toHaveBeenCalledWith({ environmentId, cwd: "/repo" }, undefined, {
      force: true,
    });
    expect(queryClient.getQueryState(patchQueryKey)?.isInvalidated).toBe(true);

    release();
    stop();
    await resetEnvironmentServiceForTests();
  });

  it("batches live thread detail activity events into one frame-sized UI commit", async () => {
    const {
      retainThreadDetailSubscription,
      startEnvironmentConnectionService,
      resetEnvironmentServiceForTests,
    } = await import("./service");
    const { useStore } = await import("~/stores/thread-store");
    const queryClient = new QueryClient();
    const environmentId = EnvironmentId.make("env-1");
    const threadId = ThreadId.make("thread-activity-batch");

    const stop = startEnvironmentConnectionService(queryClient);
    const connectionInput = mockCreateEnvironmentConnection.mock.calls[0]?.[0];
    expect(connectionInput).toBeDefined();
    connectionInput.syncShellSnapshot(makeThreadShellSnapshot({ threadId }), environmentId);

    const release = retainThreadDetailSubscription(environmentId, threadId);
    const threadListener = mockSubscribeThread.mock.calls[0]?.[1];
    expect(threadListener).toBeDefined();
    threadListener({
      kind: "snapshot",
      snapshot: {
        thread: makeThreadDetail(threadId),
      },
    });

    threadListener({
      kind: "event",
      event: makeToolActivityEvent({
        sequence: 2,
        threadId,
        activityId: "activity-command-started",
        kind: "tool.started",
        status: "inProgress",
      }),
    });
    threadListener({
      kind: "event",
      event: makeToolActivityEvent({
        sequence: 3,
        threadId,
        activityId: "activity-command-completed",
        kind: "tool.completed",
        status: "completed",
      }),
    });

    const readActivities = () =>
      useStore.getState().environmentStateById[environmentId]?.activityByThreadId[threadId] ?? {};

    expect(Object.keys(readActivities())).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(16);

    const activities = readActivities();
    expect(Object.keys(activities)).toEqual(["activity-command-completed"]);
    expect(activities["activity-command-completed"]).toMatchObject({
      kind: "tool.completed",
      createdAt: "2026-04-13T00:00:02.000Z",
      payload: {
        itemId: "command-1",
        status: "completed",
      },
    });

    release();
    stop();
    await resetEnvironmentServiceForTests();
  });
});

describe("projection version guards", () => {
  it("accepts only newer shell snapshots and events", async () => {
    const { shouldApplyProjectionEvent, shouldApplyProjectionSnapshot } = await import("./service");

    const current = {
      sequence: 5,
      updatedAt: "2026-04-13T00:00:00.000Z",
    };

    expect(
      shouldApplyProjectionEvent({
        current,
        sequence: 6,
      }),
    ).toBe(true);
    expect(
      shouldApplyProjectionEvent({
        current,
        sequence: 5,
      }),
    ).toBe(false);
    expect(
      shouldApplyProjectionSnapshot({
        current,
        next: {
          snapshotSequence: 5,
          updatedAt: "2026-04-13T00:00:01.000Z",
        },
      }),
    ).toBe(true);
    expect(
      shouldApplyProjectionSnapshot({
        current,
        next: {
          snapshotSequence: 4,
          updatedAt: "2026-04-13T00:00:01.000Z",
        },
      }),
    ).toBe(false);
  });
});

describe("coalesceOrchestrationUiEvents", () => {
  it("does not merge assistant message events in the orchestration stream", async () => {
    const { coalesceOrchestrationUiEvents } = await import("./coalesce-orchestration-events");
    const threadId = ThreadId.make("thread-stream");
    const messageId = MessageId.make("assistant-stream");
    const entryId = ThreadEntryId.make("entry-assistant-stream");
    const turnId = TurnId.make("turn-stream");
    const makeMessageEvent = (
      sequence: number,
      text: string,
      streaming: boolean,
    ): MessageSentEvent => ({
      sequence,
      eventId: EventId.make(`event-stream-${sequence}`),
      aggregateKind: "thread",
      aggregateId: threadId,
      occurredAt: `2026-04-13T00:00:0${sequence}.000Z`,
      commandId: CommandId.make("command-stream"),
      causationEventId: null,
      correlationId: null,
      metadata: {},
      type: "thread.message-sent",
      payload: {
        threadId,
        messageId,
        entryId,
        parentEntryId: null,
        role: "assistant",
        text,
        turnId,
        streaming,
        createdAt: "2026-04-13T00:00:01.000Z",
        updatedAt: `2026-04-13T00:00:0${sequence}.000Z`,
      },
    });

    const events = coalesceOrchestrationUiEvents([
      makeMessageEvent(1, "hello", false),
      makeMessageEvent(2, "hello final", false),
    ]);
    const messageEvents = events as MessageSentEvent[];

    expect(events).toHaveLength(2);
    expect(messageEvents.map((event) => event.payload.text)).toEqual(["hello", "hello final"]);
    expect(messageEvents.map((event) => event.payload.streaming)).toEqual([false, false]);
  });

  it("coalesces stable tool lifecycle activities for UI application", async () => {
    const { coalesceOrchestrationUiEvents } = await import("./coalesce-orchestration-events");
    const threadId = ThreadId.make("thread-tool-coalesce");

    const events = coalesceOrchestrationUiEvents([
      makeToolActivityEvent({
        sequence: 1,
        threadId,
        activityId: "activity-command-started",
        kind: "tool.started",
        status: "inProgress",
        detail: "pnpm test",
      }),
      makeToolActivityEvent({
        sequence: 2,
        threadId,
        activityId: "activity-command-completed",
        kind: "tool.completed",
        status: "completed",
      }),
    ]);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "thread.activity-appended",
      payload: {
        activity: {
          id: "activity-command-completed",
          kind: "tool.completed",
          createdAt: "2026-04-13T00:00:01.000Z",
          payload: {
            itemId: "command-1",
            status: "completed",
            detail: "pnpm test",
          },
        },
      },
    });
  });

  it("preserves stable tool lifecycle payload fields from earlier events", async () => {
    const { coalesceOrchestrationUiEvents } = await import("./coalesce-orchestration-events");
    const threadId = ThreadId.make("thread-tool-coalesce-sparse");

    const events = coalesceOrchestrationUiEvents([
      makeToolActivityEvent({
        sequence: 1,
        threadId,
        activityId: "activity-command-started",
        kind: "tool.started",
        status: "inProgress",
        detail: "pnpm test",
      }),
      makeToolActivityEvent({
        sequence: 2,
        threadId,
        activityId: "activity-command-completed",
        kind: "tool.completed",
        status: "completed",
      }),
    ]);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "thread.activity-appended",
      payload: {
        activity: {
          kind: "tool.completed",
          payload: {
            itemId: "command-1",
            status: "completed",
            detail: "pnpm test",
          },
        },
      },
    });
  });

  it("coalesces stable tool output deltas without losing earlier chunks", async () => {
    const { coalesceOrchestrationUiEvents } = await import("./coalesce-orchestration-events");
    const threadId = ThreadId.make("thread-tool-output-coalesce");

    const events = coalesceOrchestrationUiEvents([
      makeToolActivityEvent({
        sequence: 1,
        threadId,
        activityId: "activity-command-output-1",
        kind: "tool.updated",
        status: "inProgress",
        detail: "hello ",
        streamKind: "command_output",
      }),
      makeToolActivityEvent({
        sequence: 2,
        threadId,
        activityId: "activity-command-output-2",
        kind: "tool.updated",
        status: "inProgress",
        detail: "world",
        streamKind: "command_output",
      }),
    ]);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "thread.activity-appended",
      payload: {
        activity: {
          kind: "tool.updated",
          createdAt: "2026-04-13T00:00:01.000Z",
          payload: {
            itemId: "command-1",
            detail: "hello world",
            data: {
              streamKind: "command_output",
              delta: "hello world",
            },
          },
        },
      },
    });
  });

  it("keeps tool output stream updates separate from lifecycle completion", async () => {
    const { coalesceOrchestrationUiEvents } = await import("./coalesce-orchestration-events");
    const threadId = ThreadId.make("thread-tool-output-lifecycle-coalesce");

    const events = coalesceOrchestrationUiEvents([
      makeToolActivityEvent({
        sequence: 1,
        threadId,
        activityId: "activity-command-started",
        kind: "tool.started",
        status: "inProgress",
        detail: "pnpm test",
      }),
      makeToolActivityEvent({
        sequence: 2,
        threadId,
        activityId: "activity-command-output",
        kind: "tool.updated",
        status: "inProgress",
        detail: "test output",
        streamKind: "command_output",
      }),
      makeToolActivityEvent({
        sequence: 3,
        threadId,
        activityId: "activity-command-completed",
        kind: "tool.completed",
        status: "completed",
      }),
    ]);

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: "thread.activity-appended",
      payload: {
        activity: {
          kind: "tool.completed",
          payload: {
            itemId: "command-1",
            status: "completed",
            detail: "pnpm test",
          },
        },
      },
    });
    expect(events[1]).toMatchObject({
      type: "thread.activity-appended",
      payload: {
        activity: {
          kind: "tool.updated",
          payload: {
            itemId: "command-1",
            detail: "test output",
            data: {
              streamKind: "command_output",
              delta: "test output",
            },
          },
        },
      },
    });
  });

  it("coalesces subagent content deltas by stream key", async () => {
    const { coalesceOrchestrationUiEvents } = await import("./coalesce-orchestration-events");
    const threadId = ThreadId.make("thread-subagent-coalesce");

    const events = coalesceOrchestrationUiEvents([
      makeSubagentDeltaEvent({ sequence: 1, threadId, delta: "hello " }),
      makeSubagentDeltaEvent({ sequence: 2, threadId, delta: "world" }),
    ]);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "thread.activity-appended",
      payload: {
        activity: {
          kind: "subagent.content.delta",
          createdAt: "2026-04-13T00:00:01.000Z",
          payload: {
            delta: "hello world",
            itemId: "subagent-message-1",
            providerThreadId: "subagent-thread-1",
            streamKind: "assistant_text",
          },
        },
      },
    });
  });

  it("coalesces stable subagent item lifecycle activities for UI application", async () => {
    const { coalesceOrchestrationUiEvents } = await import("./coalesce-orchestration-events");
    const threadId = ThreadId.make("thread-subagent-item-coalesce");

    const events = coalesceOrchestrationUiEvents([
      makeSubagentItemEvent({
        sequence: 1,
        threadId,
        activityId: "activity-subagent-command-started",
        kind: "subagent.item.started",
        status: "inProgress",
        detail: "pnpm test",
      }),
      makeSubagentItemEvent({
        sequence: 2,
        threadId,
        activityId: "activity-subagent-command-completed",
        kind: "subagent.item.completed",
        status: "completed",
      }),
    ]);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "thread.activity-appended",
      payload: {
        activity: {
          id: "activity-subagent-command-completed",
          kind: "subagent.item.completed",
          createdAt: "2026-04-13T00:00:01.000Z",
          payload: {
            providerThreadId: "subagent-thread-1",
            itemId: "subagent-command-1",
            itemType: "command_execution",
            status: "completed",
            title: "Ran command",
            detail: "pnpm test",
          },
        },
      },
    });
  });
});
