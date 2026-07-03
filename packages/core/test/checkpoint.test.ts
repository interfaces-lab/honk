import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import {
  decodeThreadStreamEvent,
  MessageId,
  ModelId,
  ThreadId,
  type ThreadStreamEvent,
} from "@honk/api/core/v1";
import { makeAuth } from "../src/auth";
import { makeCheckpoints } from "../src/checkpoint";
import { makeCore, type Core } from "../src/core";
import type { Harness } from "../src/harness";
import { resolveCoreHome } from "../src/home";

const PINNED_MODEL = ModelId.make("openai-codex/gpt-5.5");

const writingHarness: Harness = {
  capabilities: { steer: false },
  runTurn: (ctx) =>
    Effect.sync(() => {
      writeFileSync(join(ctx.cwd, "file.txt"), `${ctx.userText}\n`);
    }),
};

const runGit = (cwd: string, args: ReadonlyArray<string>): void => {
  const result = spawnSync("git", [...args], { cwd, encoding: "utf8" });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `git ${args.join(" ")} failed`);
  }
};

const makeTestCore = (home: string): Core => {
  const coreHome = resolveCoreHome(home);
  const auth = makeAuth(coreHome);
  auth.storage.set("openai-codex", { type: "api_key", key: "test-key" });
  return makeCore(coreHome, auth, { "openai-codex": writingHarness }, makeCheckpoints());
};

const waitForIdle = (core: Core, threadId: ThreadId) =>
  Effect.gen(function* () {
    for (let index = 0; index < 100; index++) {
      const detail = yield* core.getDetail(threadId);
      if (detail.summary.status === "idle") return detail;
      yield* Effect.sleep(25);
    }
    return yield* Effect.die(new Error("thread never settled"));
  });

const waitForPatch = (core: Core, threadId: ThreadId) =>
  Effect.gen(function* () {
    for (let index = 0; index < 100; index++) {
      const detail = yield* core.getDetail(threadId);
      if (detail.parts.some((part) => part._tag === "patch")) return detail;
      yield* Effect.sleep(25);
    }
    return yield* Effect.die(new Error("patch part never arrived"));
  });

const threadEvents = (core: Core, threadId: ThreadId): ReadonlyArray<ThreadStreamEvent> => {
  const events: Array<ThreadStreamEvent> = [];
  for (const row of core.store.listThreadEvents(String(threadId), 0)) {
    const parsed: unknown = JSON.parse(row.encoded);
    events.push(decodeThreadStreamEvent(parsed));
  }
  return events;
};

describe("checkpoints", () => {
  // Real git subprocesses (init, baseline/capture write-tree, revert) under
  // full-suite load exceed vitest's 5s default; give the git-touching tests room.
  it("emits patch parts, returns diffs, and reverts checkpoints", { timeout: 20_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), "honk-checkpoint-test-"));
    const repo = join(root, "repo");
    const home = join(root, "home");
    mkdirSync(repo);
    runGit(repo, ["init"]);
    writeFileSync(join(repo, "file.txt"), "before\n");
    const core = makeTestCore(home);
    const threadId = ThreadId.make("thread_checkpoint_patch");

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const summary = yield* core.createThread({
            threadId,
            cwd: repo,
            model: PINNED_MODEL,
            worktree: { branch: "ckpt/test", path: repo },
          });
          expect(summary.worktree).toEqual({ branch: "ckpt/test", path: repo });
          yield* core.admit(threadId, {
            messageId: MessageId.make("msg_checkpoint_patch"),
            text: "after",
          });
          const detail = yield* waitForPatch(core, threadId);
          expect(detail.summary.worktree).toEqual({ branch: "ckpt/test", path: repo });
          const patch = detail.parts.find((part) => part._tag === "patch");
          if (patch === undefined || patch._tag !== "patch") {
            return yield* Effect.die(new Error("missing patch part"));
          }
          expect(patch.turn).toBe(1);
          expect(patch.ref).toContain("/turn/1");
          expect(patch.files).toEqual([{ path: "file.txt", additions: 1, deletions: 1 }]);

          const turnDiff = yield* core.checkpoints.turnDiff(threadId, repo, 1);
          expect(turnDiff).toEqual([
            { path: "file.txt", before: "before\n", after: "after\n", additions: 1, deletions: 1 },
          ]);
          const fullDiff = yield* core.checkpoints.fullDiff(threadId, repo);
          expect(fullDiff).toEqual(turnDiff);

          writeFileSync(join(repo, "file.txt"), "manual\n");
          yield* core.checkpoints.revert(threadId, repo, 1);
          expect(readFileSync(join(repo, "file.txt"), "utf8")).toBe("after\n");
          yield* core.checkpoints.revert(threadId, repo, 0);
          expect(readFileSync(join(repo, "file.txt"), "utf8")).toBe("before\n");
        }),
      );
    } finally {
      await Effect.runPromise(core.dispose());
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("disables tracking outside a repo without failing the turn", { timeout: 20_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), "honk-checkpoint-nonrepo-"));
    const cwd = join(root, "workspace");
    const home = join(root, "home");
    mkdirSync(cwd);
    const core = makeTestCore(home);
    const threadId = ThreadId.make("thread_checkpoint_nonrepo");

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          yield* core.createThread({ threadId, cwd, model: PINNED_MODEL });
          yield* core.admit(threadId, {
            messageId: MessageId.make("msg_checkpoint_nonrepo"),
            text: "after",
          });
          const detail = yield* waitForIdle(core, threadId);
          expect(detail.summary.status).toBe("idle");
          expect(readFileSync(join(cwd, "file.txt"), "utf8")).toBe("after\n");
          expect(detail.parts.some((part) => part._tag === "patch")).toBe(false);
          const settled = threadEvents(core, threadId).find(
            (event) => event._tag === "turn.settled",
          );
          expect(settled).toMatchObject({ _tag: "turn.settled", state: "completed" });
        }),
      );
    } finally {
      await Effect.runPromise(core.dispose());
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("initializes a non-repo cwd explicitly", { timeout: 20_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), "honk-checkpoint-init-"));
    const checkpoints = makeCheckpoints();

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          expect(yield* checkpoints.isRepo(root)).toBe(false);
          yield* checkpoints.initRepo(root);
          expect(yield* checkpoints.isRepo(root)).toBe(true);
          expect(existsSync(join(root, ".git"))).toBe(true);
        }),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
