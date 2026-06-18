import {
  EventId,
  EnvironmentId,
  MessageId,
  ProjectId,
  ThreadId,
  TurnId,
  threadEntryIdForMessageId,
  type EnvironmentApi,
  type LocalApi,
  type HonkRuntimeApi,
  type HonkRuntimeHostSnapshot,
  type ThreadAgentRuntimeSendTurnInput,
} from "@honk/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetEnvironmentApiOverridesForTests } from "~/environment-api";
import { __resetLocalApiForTests } from "~/local-api";
import {
  applyLocalThreadCreated,
  applyLocalThreadTurnStartRequested,
} from "~/stores/local-orchestration-events";
import {
  createThreadSendIntent,
  useThreadSendIntentStore,
} from "~/stores/thread-send-intent-store";
import { initialState, selectEnvironmentState, useStore } from "~/stores/thread-store";
import { getThreadFromEnvironmentState } from "~/thread-derivation";
import { DEFAULT_RUNTIME_MODE } from "~/types";
import { createEmptyRuntimeHostSnapshot } from "./honk-runtime-api";
import { prepareRuntimeTurnPolicy } from "./runtime-turn-dispatch";
import {
  buildThreadTurnStartCommand,
  coordinateTurnSend,
  dispatchTurnStartFailure,
  reconcileTurnSendFailure,
  type CoordinateTurnSendInput,
} from "./turn-send-coordinator";
import {
  deriveThreadBranchView,
  filterMessagesToBranch,
} from "~/components/chat/view/thread-branch-view";

const environmentId = EnvironmentId.make("environment:turn-coordinator");
const threadId = ThreadId.make("thread:turn-coordinator");
const threadKey = "environment:turn-coordinator:thread:turn-coordinator";
const messageId = MessageId.make("message:turn-coordinator");
const createdAt = "2026-06-08T12:00:00.000Z";
const cwd = "/tmp/project";
const modelSelection = {
  instanceId: "model-instance",
  model: "test-model",
} as const;

async function notCalled(): Promise<never> {
  throw new Error("Unexpected API call.");
}

function createRuntimeApi(input: {
  snapshot: HonkRuntimeHostSnapshot;
  onSendTurn?: (turn: ThreadAgentRuntimeSendTurnInput) => void;
}): HonkRuntimeApi {
  return {
    getHostSnapshot: async () => input.snapshot,
    getPreferences: async () => input.snapshot.preferences,
    updatePreferences: async () => input.snapshot.preferences,
    configureCredential: async () => input.snapshot,
    hydrateThread: async () => undefined,
    cloneThread: async () => undefined,
    setThreadFocus: async () => undefined,
    sendTurn: async (turn) => {
      input.onSendTurn?.(turn);
      return TurnId.make(`turn:${turn.threadId}`);
    },
    enqueueFollowUp: async () => undefined,
    updateQueuedFollowUp: async () => undefined,
    removeQueuedFollowUp: async () => undefined,
    reorderQueuedFollowUp: async () => undefined,
    sendQueuedFollowUpNow: async () => undefined,
    compactThread: async () => undefined,
    abort: async () => undefined,
    respondToExtensionUiRequest: async () => undefined,
    listSkills: async () => ({ skills: [] }),
    getThreadSessionFile: async () => ({ path: null }),
    onHostEvent: () => () => undefined,
  };
}

function createLocalApi(runtime: HonkRuntimeApi): LocalApi {
  return {
    runtime,
    dialogs: {
      pickFolder: async () => null,
      confirm: async () => false,
    },
    shell: {
      openInEditor: async () => notCalled(),
      openExternal: async () => undefined,
      showItemInFolder: async () => undefined,
    },
    contextMenu: {
      show: async () => null,
    },
    persistence: {
      getClientSettings: async () => null,
      setClientSettings: async () => undefined,
    },
    server: {
      getConfig: async () => notCalled(),
      upsertKeybinding: async () => notCalled(),
      getSettings: async () => notCalled(),
      updateSettings: async () => notCalled(),
    },
  };
}

function createOrchestrationApi(input: {
  dispatchCommand?: EnvironmentApi["orchestration"]["dispatchCommand"];
}): EnvironmentApi {
  return {
    terminal: {
      open: async () => notCalled(),
      write: async () => notCalled(),
      resize: async () => notCalled(),
      clear: async () => notCalled(),
      restart: async () => notCalled(),
      close: async () => notCalled(),
      onEvent: () => () => undefined,
    },
    projects: {
      listDirectory: async () => notCalled(),
      readFile: async () => notCalled(),
      searchEntries: async () => notCalled(),
      writeFile: async () => notCalled(),
      deleteFile: async () => notCalled(),
      createDirectory: async () => notCalled(),
      renamePath: async () => notCalled(),
    },
    filesystem: {
      browse: async () => notCalled(),
    },
    git: {
      pull: async () => notCalled(),
      refreshStatus: async () => notCalled(),
      onStatus: () => () => undefined,
      listBranches: async () => notCalled(),
      createWorktree: async () => notCalled(),
      removeWorktree: async () => notCalled(),
      createBranch: async () => notCalled(),
      checkout: async () => notCalled(),
      init: async () => notCalled(),
      resolvePullRequest: async () => notCalled(),
      preparePullRequestThread: async () => notCalled(),
      discardPaths: async () => notCalled(),
      getFilePatch: async () => notCalled(),
      getFileImage: async () => notCalled(),
    },
    orchestration: {
      dispatchCommand: input.dispatchCommand ?? (async () => ({ sequence: 1 })),
      replayEvents: async () => ({ events: [], nextSequence: 0, upToDate: true }),
      subscribeShell: () => () => undefined,
      subscribeThread: () => () => undefined,
    },
  };
}

function baseCoordinateInput(input: {
  api: EnvironmentApi;
  preparedPolicy: ReturnType<typeof prepareRuntimeTurnPolicy>;
  appendSendIntent?: boolean;
  applyLocalTurnStart?: boolean;
  startRuntimeBeforePersistence?: boolean;
  persistBeforeDispatch?: () => Promise<void>;
  bootstrap?: Parameters<typeof buildThreadTurnStartCommand>[0]["bootstrap"];
  replacesClientMessageId?: MessageId | null;
  parentEntryId?: Parameters<typeof coordinateTurnSend>[0]["parentEntryId"];
}) {
  return {
    environmentId,
    threadKey,
    threadId,
    clientMessageId: messageId,
    createdAt,
    message: {
      text: "fix the chat",
      optimisticAttachments: [],
      getTurnAttachments: async () => [],
    },
    modelSelection,
    titleSeed: "Fix chat",
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: "agent" as const,
    cwd,
    preparedPolicy: input.preparedPolicy,
    api: input.api,
    ...(input.replacesClientMessageId !== undefined
      ? { replacesClientMessageId: input.replacesClientMessageId }
      : {}),
    ...(input.parentEntryId !== undefined ? { parentEntryId: input.parentEntryId } : {}),
    ...(input.appendSendIntent !== undefined ? { appendSendIntent: input.appendSendIntent } : {}),
    ...(input.applyLocalTurnStart !== undefined
      ? { applyLocalTurnStart: input.applyLocalTurnStart }
      : {}),
    ...(input.startRuntimeBeforePersistence !== undefined
      ? { startRuntimeBeforePersistence: input.startRuntimeBeforePersistence }
      : {}),
    ...(input.persistBeforeDispatch ? { persistBeforeDispatch: input.persistBeforeDispatch } : {}),
    ...(input.bootstrap ? { bootstrap: input.bootstrap } : {}),
  } satisfies CoordinateTurnSendInput;
}

describe("turn-send-coordinator", () => {
  beforeEach(async () => {
    useThreadSendIntentStore.getState().resetForTests();
    useStore.setState(initialState);
    __resetEnvironmentApiOverridesForTests();
    vi.unstubAllGlobals();
    await __resetLocalApiForTests();
  });

  afterEach(async () => {
    __resetEnvironmentApiOverridesForTests();
    vi.unstubAllGlobals();
    await __resetLocalApiForTests();
  });

  it("builds thread.turn.start with bootstrap and source plan", () => {
    const command = buildThreadTurnStartCommand({
      threadId,
      clientMessageId: messageId,
      createdAt,
      text: "implement plan",
      attachments: [],
      modelSelection,
      titleSeed: "Plan thread",
      runtimeMode: DEFAULT_RUNTIME_MODE,
      interactionMode: "agent",
      parentEntryId: null,
      sourceProposedPlan: {
        threadId: ThreadId.make("thread:plan"),
        planId: "plan-1",
      },
      bootstrap: {
        createThread: {
          projectId: ProjectId.make("project:turn-coordinator"),
          title: "Plan thread",
          modelSelection,
          runtimeMode: DEFAULT_RUNTIME_MODE,
          interactionMode: "agent",
          branch: "main",
          worktreePath: null,
          createdAt,
        },
      },
    });

    expect(command).toMatchObject({
      type: "thread.turn.start",
      threadId,
      message: {
        messageId,
        role: "user",
        text: "implement plan",
      },
      sourceProposedPlan: {
        threadId: ThreadId.make("thread:plan"),
        planId: "plan-1",
      },
      bootstrap: {
        createThread: expect.objectContaining({
          title: "Plan thread",
        }),
      },
    });
  });

  it("appends send intent and dispatches turn start with the same message id", async () => {
    const dispatchCommand = vi.fn(async () => ({ sequence: 1 }));
    const sentTurns: ThreadAgentRuntimeSendTurnInput[] = [];
    const snapshot = {
      ...createEmptyRuntimeHostSnapshot(),
      diagnostics: [],
    };
    vi.stubGlobal("window", {
      nativeApi: createLocalApi(
        createRuntimeApi({
          snapshot,
          onSendTurn: (turn) => {
            sentTurns.push(turn);
          },
        }),
      ),
    });
    const api = createOrchestrationApi({ dispatchCommand });
    const preparedPolicy = prepareRuntimeTurnPolicy({ interactionMode: "agent", modelSelection });

    const result = await coordinateTurnSend(
      baseCoordinateInput({
        api,
        preparedPolicy,
        applyLocalTurnStart: false,
      }),
    );

    expect(result.serverTurnStartSucceeded).toBe(true);
    expect(result.runtimeSendSucceeded).toBe(true);
    expect(dispatchCommand).toHaveBeenCalledTimes(1);
    expect(dispatchCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "thread.turn.start",
        modelSelection,
        message: expect.objectContaining({
          messageId,
          text: "fix the chat",
        }),
      }),
    );
    expect(sentTurns).toEqual([
      expect.objectContaining({
        threadId,
        cwd,
        input: "fix the chat",
        clientMessageId: messageId,
        replacesClientMessageId: null,
      }),
    ]);
    expect(useThreadSendIntentStore.getState().sendIntentsByThreadKey[threadKey]).toEqual([
      createThreadSendIntent({
        messageId,
        text: "fix the chat",
        attachments: [],
        createdAt,
        parentEntryId: null,
      }),
    ]);
  });

  it("uses the local leaf for runtime appends while letting orchestration append at its own leaf", async () => {
    const parentMessageId = MessageId.make("message:existing-parent");
    const parentEntryId = threadEntryIdForMessageId(parentMessageId);
    applyLocalThreadCreated({
      environmentId,
      threadId,
      projectId: ProjectId.make("project:turn-coordinator"),
      title: "Existing thread",
      modelSelection,
      runtimeMode: DEFAULT_RUNTIME_MODE,
      interactionMode: "agent",
      branch: null,
      worktreePath: null,
      createdAt,
    });
    applyLocalThreadTurnStartRequested({
      environmentId,
      threadId,
      message: {
        messageId: parentMessageId,
        text: "existing",
        attachments: [],
      },
      modelSelection,
      titleSeed: "Existing thread",
      runtimeMode: DEFAULT_RUNTIME_MODE,
      interactionMode: "agent",
      parentEntryId: null,
      createdAt,
    });
    const dispatched: unknown[] = [];
    const sentTurns: ThreadAgentRuntimeSendTurnInput[] = [];
    const dispatchCommand = vi.fn(async (command: unknown) => {
      dispatched.push(command);
      return { sequence: 1 };
    });
    const snapshot = {
      ...createEmptyRuntimeHostSnapshot(),
      diagnostics: [],
    };
    vi.stubGlobal("window", {
      nativeApi: createLocalApi(
        createRuntimeApi({
          snapshot,
          onSendTurn: (turn) => {
            sentTurns.push(turn);
          },
        }),
      ),
    });
    const api = createOrchestrationApi({ dispatchCommand });
    const preparedPolicy = prepareRuntimeTurnPolicy({ interactionMode: "agent", modelSelection });

    await coordinateTurnSend(
      baseCoordinateInput({
        api,
        preparedPolicy,
        applyLocalTurnStart: false,
      }),
    );

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).not.toHaveProperty("parentEntryId");
    expect(sentTurns[0]).toEqual(expect.objectContaining({ parentEntryId }));
  });

  it("passes an explicit parentEntryId through to thread.turn.start for branching sends", () => {
    const command = buildThreadTurnStartCommand({
      threadId,
      clientMessageId: messageId,
      createdAt,
      text: "edited message",
      attachments: [],
      modelSelection,
      titleSeed: "Edit thread",
      runtimeMode: DEFAULT_RUNTIME_MODE,
      interactionMode: "agent",
      parentEntryId: null,
      sourceProposedPlan: null,
    });

    expect(command).toHaveProperty("parentEntryId", null);
  });

  it("passes replacesClientMessageId to runtime sends for branching edits", async () => {
    const originalMessageId = MessageId.make("message:original-edit");
    const parentEntryId = null;
    const sentTurns: ThreadAgentRuntimeSendTurnInput[] = [];
    const snapshot = {
      ...createEmptyRuntimeHostSnapshot(),
      diagnostics: [],
    };
    vi.stubGlobal("window", {
      nativeApi: createLocalApi(
        createRuntimeApi({
          snapshot,
          onSendTurn: (turn) => {
            sentTurns.push(turn);
          },
        }),
      ),
    });
    const api = createOrchestrationApi({});
    const preparedPolicy = prepareRuntimeTurnPolicy({ interactionMode: "agent", modelSelection });

    await coordinateTurnSend(
      baseCoordinateInput({
        api,
        preparedPolicy,
        appendSendIntent: false,
        applyLocalTurnStart: false,
        parentEntryId,
        replacesClientMessageId: originalMessageId,
      }),
    );

    expect(sentTurns[0]).toEqual(
      expect.objectContaining({
        clientMessageId: messageId,
        parentEntryId,
        replacesClientMessageId: originalMessageId,
      }),
    );
  });

  it("rejects edit sends without an explicit branch parent", async () => {
    const snapshot = {
      ...createEmptyRuntimeHostSnapshot(),
      diagnostics: [],
    };
    vi.stubGlobal("window", {
      nativeApi: createLocalApi(createRuntimeApi({ snapshot })),
    });
    const api = createOrchestrationApi({});
    const preparedPolicy = prepareRuntimeTurnPolicy({ interactionMode: "agent", modelSelection });

    await expect(
      coordinateTurnSend(
        baseCoordinateInput({
          api,
          preparedPolicy,
          replacesClientMessageId: MessageId.make("message:missing-parent"),
        }),
      ),
    ).rejects.toThrow("Branching edit sends require parentEntryId.");
  });

  it("skips send intent when callers already announced optimistic state", async () => {
    const snapshot = {
      ...createEmptyRuntimeHostSnapshot(),
      diagnostics: [],
    };
    vi.stubGlobal("window", {
      nativeApi: createLocalApi(createRuntimeApi({ snapshot })),
    });
    const api = createOrchestrationApi({});
    const preparedPolicy = prepareRuntimeTurnPolicy({ interactionMode: "agent", modelSelection });

    await coordinateTurnSend(
      baseCoordinateInput({
        api,
        preparedPolicy,
        appendSendIntent: false,
        applyLocalTurnStart: false,
      }),
    );

    expect(useThreadSendIntentStore.getState().sendIntentsByThreadKey[threadKey]).toBeUndefined();
  });

  it("uses prepared worktree cwd for runtime send when persistence must finish first", async () => {
    const events: string[] = [];
    const sentTurns: ThreadAgentRuntimeSendTurnInput[] = [];
    const snapshot = {
      ...createEmptyRuntimeHostSnapshot(),
      diagnostics: [],
    };
    vi.stubGlobal("window", {
      nativeApi: createLocalApi(
        createRuntimeApi({
          snapshot,
          onSendTurn: (turn) => {
            events.push("send");
            sentTurns.push(turn);
          },
        }),
      ),
    });
    const api = createOrchestrationApi({
      dispatchCommand: async () => {
        events.push("dispatch");
        return {
          sequence: 2,
          preparedWorktree: {
            branch: "wt/fix-chat",
            worktreePath: "/tmp/project/.honk/worktrees/wt-fix-chat",
          },
        };
      },
    });
    const preparedPolicy = prepareRuntimeTurnPolicy({ interactionMode: "agent", modelSelection });

    const result = await coordinateTurnSend(
      baseCoordinateInput({
        api,
        preparedPolicy,
        appendSendIntent: false,
        applyLocalTurnStart: false,
        startRuntimeBeforePersistence: false,
        persistBeforeDispatch: async () => {
          events.push("persist");
        },
        bootstrap: {
          prepareWorktree: {
            projectCwd: cwd,
            baseBranch: "main",
            branch: "wt/fix-chat",
          },
          runSetupScript: true,
        },
      }),
    );

    expect(events).toEqual(["persist", "dispatch", "send"]);
    expect(result.preparedWorktree).toEqual({
      branch: "wt/fix-chat",
      worktreePath: "/tmp/project/.honk/worktrees/wt-fix-chat",
    });
    expect(sentTurns[0]?.cwd).toBe("/tmp/project/.honk/worktrees/wt-fix-chat");
  });

  it("captures dispatch failures without throwing when runtime already started", async () => {
    const snapshot = {
      ...createEmptyRuntimeHostSnapshot(),
      diagnostics: [],
    };
    vi.stubGlobal("window", {
      nativeApi: createLocalApi(createRuntimeApi({ snapshot })),
    });
    const dispatchError = new Error("server unavailable");
    const api = createOrchestrationApi({
      dispatchCommand: async () => {
        throw dispatchError;
      },
    });
    const preparedPolicy = prepareRuntimeTurnPolicy({ interactionMode: "agent", modelSelection });

    const result = await coordinateTurnSend(
      baseCoordinateInput({
        api,
        preparedPolicy,
        appendSendIntent: false,
        applyLocalTurnStart: false,
        startRuntimeBeforePersistence: true,
      }),
    );

    expect(result.serverTurnStartSucceeded).toBe(false);
    expect(result.runtimeSendSucceeded).toBe(true);
    expect(result.serverPersistenceError).toBe(dispatchError);
  });

  it("retries implicit runtime appends without a parent when the runtime cannot resolve it", async () => {
    const priorMessageId = MessageId.make("message:prior-runtime-parent");
    applyLocalThreadCreated({
      environmentId,
      threadId,
      projectId: ProjectId.make("project:turn-coordinator"),
      title: "Local thread",
      modelSelection,
      interactionMode: "agent",
      branch: "main",
      worktreePath: null,
      createdAt,
    });
    applyLocalThreadTurnStartRequested({
      environmentId,
      threadId,
      message: {
        messageId: priorMessageId,
        text: "prior",
        attachments: [],
      },
      modelSelection,
      titleSeed: "Local thread",
      runtimeMode: DEFAULT_RUNTIME_MODE,
      interactionMode: "agent",
      parentEntryId: null,
      createdAt,
    });

    const snapshot = {
      ...createEmptyRuntimeHostSnapshot(),
      diagnostics: [],
    };
    const sentTurns: ThreadAgentRuntimeSendTurnInput[] = [];
    vi.stubGlobal("window", {
      nativeApi: createLocalApi(
        createRuntimeApi({
          snapshot,
          onSendTurn: (turn) => {
            sentTurns.push(turn);
            if (sentTurns.length === 1) {
              throw new Error(
                `Cannot branch from thread entry ${String(turn.parentEntryId)}: runtime entry not found.`,
              );
            }
          },
        }),
      ),
    });
    const api = createOrchestrationApi({});
    const preparedPolicy = prepareRuntimeTurnPolicy({ interactionMode: "agent", modelSelection });

    const result = await coordinateTurnSend(
      baseCoordinateInput({
        api,
        preparedPolicy,
        appendSendIntent: false,
        applyLocalTurnStart: false,
        startRuntimeBeforePersistence: true,
      }),
    );

    expect(result.runtimeSendSucceeded).toBe(true);
    expect(sentTurns).toHaveLength(2);
    expect(sentTurns[0]?.parentEntryId).toBe(threadEntryIdForMessageId(priorMessageId));
    expect(sentTurns[1]?.parentEntryId).toBeUndefined();
  });

  it("does not retry explicit runtime branches without a parent", async () => {
    const parentEntryId = threadEntryIdForMessageId(MessageId.make("message:explicit-parent"));
    const snapshot = {
      ...createEmptyRuntimeHostSnapshot(),
      diagnostics: [],
    };
    const sentTurns: ThreadAgentRuntimeSendTurnInput[] = [];
    vi.stubGlobal("window", {
      nativeApi: createLocalApi(
        createRuntimeApi({
          snapshot,
          onSendTurn: (turn) => {
            sentTurns.push(turn);
            throw new Error(
              `Cannot branch from thread entry ${String(turn.parentEntryId)}: runtime entry not found.`,
            );
          },
        }),
      ),
    });
    const api = createOrchestrationApi({});
    const preparedPolicy = prepareRuntimeTurnPolicy({ interactionMode: "agent", modelSelection });

    await expect(
      coordinateTurnSend(
        baseCoordinateInput({
          api,
          preparedPolicy,
          appendSendIntent: false,
          applyLocalTurnStart: false,
          startRuntimeBeforePersistence: true,
          parentEntryId,
        }),
      ),
    ).rejects.toThrow("runtime entry not found");

    expect(sentTurns).toHaveLength(1);
    expect(sentTurns[0]?.parentEntryId).toBe(parentEntryId);
  });

  it("rethrows dispatch failures when runtime must wait for persistence", async () => {
    const snapshot = {
      ...createEmptyRuntimeHostSnapshot(),
      diagnostics: [],
    };
    vi.stubGlobal("window", {
      nativeApi: createLocalApi(createRuntimeApi({ snapshot })),
    });
    const dispatchError = new Error("worktree failed");
    const api = createOrchestrationApi({
      dispatchCommand: async () => {
        throw dispatchError;
      },
    });
    const preparedPolicy = prepareRuntimeTurnPolicy({ interactionMode: "agent", modelSelection });

    await expect(
      coordinateTurnSend(
        baseCoordinateInput({
          api,
          preparedPolicy,
          appendSendIntent: false,
          applyLocalTurnStart: false,
          startRuntimeBeforePersistence: false,
        }),
      ),
    ).rejects.toThrow("worktree failed");
  });

  it("dispatches thread.turn.start.failed with a fallback detail", async () => {
    const dispatchCommand = vi.fn(async () => ({ sequence: 3 }));
    const api = createOrchestrationApi({ dispatchCommand });

    await dispatchTurnStartFailure({
      api,
      threadId,
      messageId,
      detail: "   ",
    });

    expect(dispatchCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "thread.turn.start.failed",
        threadId,
        messageId,
        detail: "Failed to send turn.",
      }),
    );
  });

  it("clears unconfirmed local turn starts when server persistence never succeeded", () => {
    applyLocalThreadCreated({
      environmentId,
      threadId,
      projectId: ProjectId.make("project:turn-coordinator"),
      title: "Local thread",
      modelSelection,
      interactionMode: "agent",
      branch: "main",
      worktreePath: null,
      createdAt,
    });
    applyLocalThreadTurnStartRequested({
      environmentId,
      threadId,
      message: {
        messageId,
        text: "local only",
        attachments: [],
      },
      modelSelection,
      titleSeed: "Local thread",
      runtimeMode: DEFAULT_RUNTIME_MODE,
      interactionMode: "agent",
      parentEntryId: null,
      createdAt,
    });

    const beforeThread = getThreadFromEnvironmentState(
      selectEnvironmentState(useStore.getState(), environmentId),
      threadId,
    );
    expect(beforeThread?.messages.some((message) => message.id === messageId)).toBe(true);

    reconcileTurnSendFailure({
      environmentId,
      threadId,
      messageId,
      serverTurnStartSucceeded: false,
      localTurnStartAnnounced: true,
    });

    const afterThread = getThreadFromEnvironmentState(
      selectEnvironmentState(useStore.getState(), environmentId),
      threadId,
    );
    expect(afterThread?.messages.some((message) => message.id === messageId)).toBe(false);
  });

  it("moves the optimistic branch leaf so stale descendants are hidden immediately", () => {
    const originalMessageId = MessageId.make("message:original-branch");
    const originalAssistantMessageId = MessageId.make("message:original-assistant");
    const replacementMessageId = MessageId.make("message:replacement-branch");
    applyLocalThreadCreated({
      environmentId,
      threadId,
      projectId: ProjectId.make("project:turn-coordinator"),
      title: "Local thread",
      modelSelection,
      interactionMode: "agent",
      branch: "main",
      worktreePath: null,
      createdAt,
    });
    applyLocalThreadTurnStartRequested({
      environmentId,
      threadId,
      message: {
        messageId: originalMessageId,
        text: "original",
        attachments: [],
      },
      modelSelection,
      titleSeed: "Local thread",
      runtimeMode: DEFAULT_RUNTIME_MODE,
      interactionMode: "agent",
      parentEntryId: null,
      createdAt,
    });
    useStore.getState().applyOrchestrationEvent(
      {
        sequence: 1,
        eventId: EventId.make("event:assistant-branch"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: "2026-06-08T12:00:01.000Z",
        commandId: null,
        causationEventId: null,
        correlationId: null,
        metadata: {},
        type: "thread.message-sent",
        payload: {
          threadId,
          messageId: originalAssistantMessageId,
          entryId: threadEntryIdForMessageId(originalAssistantMessageId),
          parentEntryId: threadEntryIdForMessageId(originalMessageId),
          role: "assistant",
          text: "old answer",
          attachments: [],
          turnId: null,
          streaming: false,
          createdAt: "2026-06-08T12:00:01.000Z",
          updatedAt: "2026-06-08T12:00:01.000Z",
        },
      },
      environmentId,
    );
    applyLocalThreadTurnStartRequested({
      environmentId,
      threadId,
      message: {
        messageId: replacementMessageId,
        text: "original",
        attachments: [],
      },
      modelSelection,
      titleSeed: "Local thread",
      runtimeMode: DEFAULT_RUNTIME_MODE,
      interactionMode: "agent",
      parentEntryId: null,
      createdAt: "2026-06-08T12:00:02.000Z",
    });

    const thread = getThreadFromEnvironmentState(
      selectEnvironmentState(useStore.getState(), environmentId),
      threadId,
    );
    expect(thread?.leafId).toBe(threadEntryIdForMessageId(replacementMessageId));

    const branchView = deriveThreadBranchView(thread ?? null, thread?.leafId ?? null);
    const visibleMessages = filterMessagesToBranch(thread?.messages ?? [], branchView);
    expect(visibleMessages.map((message) => message.id)).toEqual([replacementMessageId]);
  });
});
