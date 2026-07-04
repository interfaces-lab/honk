import { MessageId } from "@honk/shared/base-schemas";
import { EnvironmentId } from "@honk/shared/environment";
import { ProjectId, ThreadId } from "@honk/shared/base-schemas";
import type { ClientOrchestrationCommand } from "@honk/shared/orchestration";
import { threadEntryIdForMessageId } from "@honk/shared/thread-tree";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EnvironmentApi } from "~/desktop-bridge";
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
import {
  buildThreadTurnStartCommand,
  coordinateTurnSend,
  dispatchTurnStartFailure,
  reconcileTurnSendFailure,
  type CoordinateTurnSendInput,
} from "./turn-send-coordinator";

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

function createEnvironmentApi(input: {
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
  appendSendIntent?: boolean;
  applyLocalTurnStart?: boolean;
  persistBeforeDispatch?: () => Promise<void>;
  bootstrap?: Parameters<typeof buildThreadTurnStartCommand>[0]["bootstrap"];
  replacesClientMessageId?: MessageId | null;
  parentEntryId?: Parameters<typeof coordinateTurnSend>[0]["parentEntryId"];
}): CoordinateTurnSendInput {
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
    interactionMode: "agent",
    cwd,
    api: input.api,
    ...(input.replacesClientMessageId !== undefined
      ? { replacesClientMessageId: input.replacesClientMessageId }
      : {}),
    ...(input.parentEntryId !== undefined ? { parentEntryId: input.parentEntryId } : {}),
    ...(input.appendSendIntent !== undefined ? { appendSendIntent: input.appendSendIntent } : {}),
    ...(input.applyLocalTurnStart !== undefined
      ? { applyLocalTurnStart: input.applyLocalTurnStart }
      : {}),
    ...(input.persistBeforeDispatch ? { persistBeforeDispatch: input.persistBeforeDispatch } : {}),
    ...(input.bootstrap ? { bootstrap: input.bootstrap } : {}),
  };
}

describe("turn-send-coordinator", () => {
  beforeEach(() => {
    useThreadSendIntentStore.getState().resetForTests();
    useStore.setState(initialState);
  });

  afterEach(() => {
    useThreadSendIntentStore.getState().resetForTests();
    useStore.setState(initialState);
    vi.restoreAllMocks();
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
    const api = createEnvironmentApi({ dispatchCommand });

    const result = await coordinateTurnSend(
      baseCoordinateInput({
        api,
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

  it("passes explicit parentEntryId through to thread.turn.start for branching sends", async () => {
    const parentEntryId = threadEntryIdForMessageId(MessageId.make("message:parent"));
    const dispatched: ClientOrchestrationCommand[] = [];
    const api = createEnvironmentApi({
      dispatchCommand: async (command) => {
        dispatched.push(command);
        return { sequence: 1 };
      },
    });

    await coordinateTurnSend(
      baseCoordinateInput({
        api,
        appendSendIntent: false,
        applyLocalTurnStart: false,
        parentEntryId,
      }),
    );

    expect(dispatched[0]).toEqual(expect.objectContaining({ parentEntryId }));
  });

  it("rejects edit sends without an explicit branch parent", async () => {
    const api = createEnvironmentApi({});

    await expect(
      coordinateTurnSend(
        baseCoordinateInput({
          api,
          replacesClientMessageId: MessageId.make("message:missing-parent"),
        }),
      ),
    ).rejects.toThrow("Branching edit sends require parentEntryId.");
  });

  it("returns prepared worktree from core dispatch", async () => {
    const api = createEnvironmentApi({
      dispatchCommand: async () => ({
        sequence: 2,
        preparedWorktree: {
          branch: "wt/fix-chat",
          worktreePath: "/tmp/project/.honk/worktrees/wt-fix-chat",
        },
      }),
    });

    const result = await coordinateTurnSend(
      baseCoordinateInput({
        api,
        appendSendIntent: false,
        applyLocalTurnStart: false,
        persistBeforeDispatch: async () => undefined,
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

    expect(result.preparedWorktree).toEqual({
      branch: "wt/fix-chat",
      worktreePath: "/tmp/project/.honk/worktrees/wt-fix-chat",
    });
  });

  it("clears unconfirmed local turn starts when server dispatch fails", async () => {
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
    const dispatchError = new Error("core unavailable");
    const api = createEnvironmentApi({
      dispatchCommand: async () => {
        throw dispatchError;
      },
    });

    await expect(
      coordinateTurnSend(
        baseCoordinateInput({
          api,
        }),
      ),
    ).rejects.toThrow("core unavailable");

    const thread = getThreadFromEnvironmentState(
      selectEnvironmentState(useStore.getState(), environmentId),
      threadId,
    );
    expect(thread?.messages.some((message) => message.id === messageId)).toBe(false);
    expect(useThreadSendIntentStore.getState().sendIntentsByThreadKey[threadKey]).toBeUndefined();
  });

  it("dispatches thread.turn.start.failed with a fallback detail", async () => {
    const dispatchCommand = vi.fn(async () => ({ sequence: 3 }));
    const api = createEnvironmentApi({ dispatchCommand });

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

  it("reconcileTurnSendFailure clears local turn starts when server persistence failed", () => {
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

    reconcileTurnSendFailure({
      environmentId,
      threadId,
      messageId,
      serverTurnStartSucceeded: false,
      localTurnStartAnnounced: true,
    });

    const thread = getThreadFromEnvironmentState(
      selectEnvironmentState(useStore.getState(), environmentId),
      threadId,
    );
    expect(thread?.messages.some((message) => message.id === messageId)).toBe(false);
  });
});
