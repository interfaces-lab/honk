import * as NodeServices from "@effect/platform-node/NodeServices";
import { CheckpointRef, ProjectId, ThreadId, TurnId } from "@multi/contracts";
import { Effect, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";

import { ServerConfig } from "../../src/config.ts";
import {
  ThreadProjection,
  type ThreadCheckpointContext,
} from "../../src/orchestration/ThreadProjection.service.ts";
import {
  checkpointRefForThreadTurn,
  preTurnCheckpointRefForThreadTurn,
} from "../../src/checkpointing/Utils.ts";
import { CheckpointDiffQueryLive } from "../../src/checkpointing/CheckpointDiffQuery.ts";
import {
  CheckpointStore,
  type CheckpointStoreShape,
} from "../../src/checkpointing/CheckpointStore.service.ts";
import { CheckpointDiffQuery } from "../../src/checkpointing/CheckpointDiffQuery.service.ts";

function makeThreadCheckpointContext(input: {
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
  readonly projectRoot: string;
  readonly worktreePath: string | null;
  readonly checkpointTurnCount: number;
  readonly checkpointRef: CheckpointRef;
}): ThreadCheckpointContext {
  return {
    threadId: input.threadId,
    projectId: input.projectId,
    projectRoot: input.projectRoot,
    worktreePath: input.worktreePath,
    checkpoints: [
      {
        turnId: TurnId.make("turn-1"),
        checkpointTurnCount: input.checkpointTurnCount,
        checkpointRef: input.checkpointRef,
        status: "ready",
        files: [],
        assistantMessageId: null,
        completedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  };
}

describe("CheckpointDiffQueryLive", () => {
  it("computes diffs using canonical turn-0 checkpoint refs", async () => {
    const projectId = ProjectId.make("project-1");
    const threadId = ThreadId.make("thread-1");
    const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1);
    const hasCheckpointRefCalls: Array<CheckpointRef> = [];
    const diffCheckpointsCalls: Array<{
      readonly fromCheckpointRef: CheckpointRef;
      readonly toCheckpointRef: CheckpointRef;
      readonly cwd: string;
    }> = [];

    const threadCheckpointContext = makeThreadCheckpointContext({
      projectId,
      threadId,
      projectRoot: process.cwd(),
      worktreePath: null,
      checkpointTurnCount: 1,
      checkpointRef: toCheckpointRef,
    });

    const checkpointStore: CheckpointStoreShape = {
      isGitRepository: () => Effect.succeed(true),
      captureCheckpoint: () => Effect.void,
      hasCheckpointRef: ({ checkpointRef }) =>
        Effect.sync(() => {
          hasCheckpointRefCalls.push(checkpointRef);
          return true;
        }),
      restoreCheckpoint: () => Effect.succeed(true),
      diffCheckpoints: ({ fromCheckpointRef, toCheckpointRef, cwd }) =>
        Effect.sync(() => {
          diffCheckpointsCalls.push({ fromCheckpointRef, toCheckpointRef, cwd });
          return "diff patch";
        }),
      deleteCheckpointRefs: () => Effect.void,
    };

    const layer = CheckpointDiffQueryLive.pipe(
      Layer.provideMerge(Layer.succeed(CheckpointStore, checkpointStore)),
      Layer.provideMerge(
        Layer.succeed(ThreadProjection, {
          getSnapshot: () =>
            Effect.die("CheckpointDiffQuery should not request the full orchestration snapshot"),
          getShellSnapshot: () =>
            Effect.die("CheckpointDiffQuery should not request the orchestration shell snapshot"),
          getCounts: () => Effect.succeed({ projectCount: 0, threadCount: 0 }),
          getActiveProjectByProjectRoot: () => Effect.succeed(Option.none()),
          getProjectShellById: () => Effect.succeed(Option.none()),
          getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
          getThreadCheckpointContext: () => Effect.succeed(Option.some(threadCheckpointContext)),
          getThreadShellById: () => Effect.succeed(Option.none()),
          getThreadDetailById: () => Effect.succeed(Option.none()),
        }),
      ),
      Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-checkpoint-diff-" })),
      Layer.provideMerge(NodeServices.layer),
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const query = yield* CheckpointDiffQuery;
        return yield* query.getTurnDiff({
          threadId,
          fromTurnCount: 0,
          toTurnCount: 1,
        });
      }).pipe(Effect.provide(Layer.mergeAll(layer, NodeServices.layer))),
    );

    const expectedFromRef = preTurnCheckpointRefForThreadTurn(threadId, 1);
    expect(hasCheckpointRefCalls).toEqual([expectedFromRef]);
    expect(diffCheckpointsCalls).toEqual([
      {
        cwd: process.cwd(),
        fromCheckpointRef: expectedFromRef,
        toCheckpointRef,
      },
    ]);
    expect(result).toEqual({
      threadId,
      fromTurnCount: 0,
      toTurnCount: 1,
      diff: "diff patch",
    });
  });

  it("fails when the thread is missing from the snapshot", async () => {
    const threadId = ThreadId.make("thread-missing");

    const checkpointStore: CheckpointStoreShape = {
      isGitRepository: () => Effect.succeed(true),
      captureCheckpoint: () => Effect.void,
      hasCheckpointRef: () => Effect.succeed(true),
      restoreCheckpoint: () => Effect.succeed(true),
      diffCheckpoints: () => Effect.succeed(""),
      deleteCheckpointRefs: () => Effect.void,
    };

    const layer = CheckpointDiffQueryLive.pipe(
      Layer.provideMerge(Layer.succeed(CheckpointStore, checkpointStore)),
      Layer.provideMerge(
        Layer.succeed(ThreadProjection, {
          getSnapshot: () =>
            Effect.die("CheckpointDiffQuery should not request the full orchestration snapshot"),
          getShellSnapshot: () =>
            Effect.die("CheckpointDiffQuery should not request the orchestration shell snapshot"),
          getCounts: () => Effect.succeed({ projectCount: 0, threadCount: 0 }),
          getActiveProjectByProjectRoot: () => Effect.succeed(Option.none()),
          getProjectShellById: () => Effect.succeed(Option.none()),
          getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
          getThreadCheckpointContext: () => Effect.succeed(Option.none()),
          getThreadShellById: () => Effect.succeed(Option.none()),
          getThreadDetailById: () => Effect.succeed(Option.none()),
        }),
      ),
      Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-checkpoint-diff-" })),
      Layer.provideMerge(NodeServices.layer),
    );

    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const query = yield* CheckpointDiffQuery;
          return yield* query.getTurnDiff({
            threadId,
            fromTurnCount: 0,
            toTurnCount: 1,
          });
        }).pipe(Effect.provide(layer), Effect.provide(NodeServices.layer)),
      ),
    ).rejects.toThrow("Thread 'thread-missing' not found.");
  });
});
