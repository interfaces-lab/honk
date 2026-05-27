import { QueryClient } from "@tanstack/react-query";
import {
  CommandId,
  EnvironmentId,
  EventId,
  MessageId,
  type OrchestrationEvent,
  ProjectId,
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
  it("keeps final empty assistant messages separate from streaming chunks", async () => {
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
      makeMessageEvent(1, "hello", true),
      makeMessageEvent(2, "", false),
    ]);
    const messageEvents = events as MessageSentEvent[];

    expect(events).toHaveLength(2);
    expect(messageEvents.map((event) => event.payload.text)).toEqual(["hello", ""]);
    expect(messageEvents.map((event) => event.payload.streaming)).toEqual([true, false]);
  });
});
