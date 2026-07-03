import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { Effect } from "effect";
import {
  FileDiff as FileDiffSchema,
  GitOperationError,
  GitUnavailableError,
  NonNegativeInt,
  PatchFileSummary as PatchFileSummarySchema,
  ThreadId,
  TrimmedNonEmptyString,
  TurnCheckpointNotFoundError,
  type FileDiff,
  type PatchFileSummary,
} from "@honk/api/core/v1";

const GIT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
// Matches t3code's checkpoint diff cap: large enough for useful previews, bounded enough to avoid unbounded API payloads.
const CHECKPOINT_DIFF_MAX_OUTPUT_BYTES = 10_000_000;
const HONK_GIT_NAME = "Honk";
const HONK_GIT_EMAIL = "honk@users.noreply.local";
const CHECKPOINT_REFS_PREFIX = "refs/honk/checkpoints";

type GitError = GitUnavailableError | GitOperationError | TurnCheckpointNotFoundError;

interface GitResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface CheckpointCapture {
  readonly turn: number;
  readonly ref: string;
  readonly files: ReadonlyArray<PatchFileSummary>;
}

export interface Checkpoints {
  readonly isRepo: (cwd: string) => Effect.Effect<boolean>;
  readonly initRepo: (cwd: string) => Effect.Effect<void, GitOperationError>;
  readonly baseline: (threadId: ThreadId, cwd: string) => Effect.Effect<void, GitError>;
  readonly capture: (
    threadId: ThreadId,
    cwd: string,
    turn: number,
  ) => Effect.Effect<CheckpointCapture | null, GitError>;
  readonly turnDiff: (
    threadId: ThreadId,
    cwd: string,
    turn: number,
  ) => Effect.Effect<ReadonlyArray<FileDiff>, GitError>;
  readonly fullDiff: (
    threadId: ThreadId,
    cwd: string,
  ) => Effect.Effect<ReadonlyArray<FileDiff>, GitError>;
  readonly revert: (threadId: ThreadId, cwd: string, turn: number) => Effect.Effect<void, GitError>;
  readonly pruneThread: (threadId: ThreadId, cwd: string) => Effect.Effect<void, GitError>;
}

const trimmed = (value: string) => TrimmedNonEmptyString.make(value);
const nonNegative = (value: number) => NonNegativeInt.make(value);

const gitOperationError = (operation: string, cwd: string, detail: string): GitOperationError =>
  new GitOperationError({
    operation: trimmed(operation),
    cwd: trimmed(cwd),
    detail: detail.length === 0 ? "git command failed" : detail.slice(0, 2000),
  });

const unavailable = (cwd: string): GitUnavailableError =>
  new GitUnavailableError({ cwd: trimmed(cwd) });

const missingCheckpoint = (threadId: ThreadId, turn: number): TurnCheckpointNotFoundError =>
  new TurnCheckpointNotFoundError({ threadId, turn: nonNegative(Math.max(0, turn)) });

const checkpointNamespace = (threadId: ThreadId): string =>
  `${CHECKPOINT_REFS_PREFIX}/${Buffer.from(String(threadId), "utf8").toString("base64url")}`;

const checkpointRef = (threadId: ThreadId, turn: number): string =>
  `${checkpointNamespace(threadId)}/turn/${turn}`;

const git = (
  operation: string,
  cwd: string,
  args: ReadonlyArray<string>,
  options: {
    readonly env?: NodeJS.ProcessEnv;
    readonly allowNonZeroExit?: boolean;
    readonly maxOutputBytes?: number;
  } = {},
): Effect.Effect<GitResult, GitOperationError> =>
  Effect.callback<GitResult, GitOperationError>((resume, signal) => {
    const child = spawn("git", [...args], {
      cwd,
      env: options.env ?? process.env,
      windowsHide: true,
    });
    const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const cleanup = (): void => {
      if (timeout !== null) clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      child.stdout.off("data", onStdout);
      child.stderr.off("data", onStderr);
      child.off("error", onError);
      child.off("close", onClose);
    };

    const finish = (effect: Effect.Effect<GitResult, GitOperationError>): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resume(effect);
    };

    const appendOutput = (chunk: string, stream: "stdout" | "stderr"): void => {
      outputBytes += Buffer.byteLength(chunk, "utf8");
      if (outputBytes > maxOutputBytes) {
        child.kill("SIGTERM");
        finish(
          Effect.fail(
            gitOperationError(
              operation,
              cwd,
              `git output exceeded ${maxOutputBytes} bytes for argv: ${args.join(" ")}`,
            ),
          ),
        );
        return;
      }
      if (stream === "stdout") stdout += chunk;
      else stderr += chunk;
    };

    function onStdout(chunk: string): void {
      appendOutput(chunk, "stdout");
    }

    function onStderr(chunk: string): void {
      appendOutput(chunk, "stderr");
    }

    function onError(error: Error): void {
      finish(Effect.fail(gitOperationError(operation, cwd, error.message)));
    }

    function onClose(code: number | null, childSignal: NodeJS.Signals | null): void {
      if (code === 0) {
        finish(Effect.succeed({ stdout, stderr, exitCode: 0 }));
        return;
      }
      const exitCode = code ?? 1;
      const result = { stdout, stderr, exitCode };
      if (options.allowNonZeroExit === true) {
        finish(Effect.succeed(result));
        return;
      }
      const detail =
        stderr.trim() ||
        stdout.trim() ||
        (childSignal === null
          ? `git exited with code ${exitCode}`
          : `git exited from signal ${childSignal}`);
      finish(Effect.fail(gitOperationError(operation, cwd, detail)));
    }

    function onAbort(): void {
      child.kill("SIGTERM");
      finish(Effect.fail(gitOperationError(operation, cwd, "git process aborted")));
    }

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.once("error", onError);
    child.once("close", onClose);
    signal.addEventListener("abort", onAbort, { once: true });
    timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish(
        Effect.fail(gitOperationError(operation, cwd, `git timed out after ${GIT_TIMEOUT_MS}ms`)),
      );
    }, GIT_TIMEOUT_MS);

    return Effect.sync(() => {
      if (!settled) child.kill("SIGTERM");
      cleanup();
    });
  });

const repoStatus = (cwd: string): Effect.Effect<boolean, GitOperationError> =>
  git("Checkpoints.isRepo", cwd, ["rev-parse", "--is-inside-work-tree"], {
    allowNonZeroExit: true,
    maxOutputBytes: 64 * 1024,
  }).pipe(Effect.map((result) => result.exitCode === 0 && result.stdout.trim() === "true"));

const ensureRepo = (cwd: string): Effect.Effect<void, GitUnavailableError | GitOperationError> =>
  Effect.gen(function* () {
    const inside = yield* repoStatus(cwd);
    if (!inside) return yield* Effect.fail(unavailable(cwd));
  });

const hasHeadCommit = (cwd: string): Effect.Effect<boolean, GitOperationError> =>
  git("Checkpoints.hasHeadCommit", cwd, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], {
    allowNonZeroExit: true,
    maxOutputBytes: 64 * 1024,
  }).pipe(Effect.map((result) => result.exitCode === 0 && result.stdout.trim().length > 0));

const resolveCheckpointCommit = (
  cwd: string,
  ref: string,
): Effect.Effect<string | null, GitOperationError> =>
  git(
    "Checkpoints.resolveCheckpointCommit",
    cwd,
    ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
    {
      allowNonZeroExit: true,
      maxOutputBytes: 64 * 1024,
    },
  ).pipe(
    Effect.map((result) => {
      if (result.exitCode !== 0) return null;
      const commit = result.stdout.trim();
      return commit.length === 0 ? null : commit;
    }),
  );

const resolveGitCommonDir = (cwd: string): Effect.Effect<string, GitOperationError> =>
  git("Checkpoints.resolveGitCommonDir", cwd, ["rev-parse", "--git-common-dir"], {
    maxOutputBytes: 64 * 1024,
  }).pipe(
    Effect.map((result) => {
      const gitCommonDir = result.stdout.trim();
      return resolve(cwd, gitCommonDir);
    }),
  );

const captureRef = (
  threadId: ThreadId,
  cwd: string,
  turn: number,
): Effect.Effect<string, GitOperationError> =>
  Effect.gen(function* () {
    const ref = checkpointRef(threadId, turn);
    const gitCommonDir = yield* resolveGitCommonDir(cwd);
    const tempIndexPath = join(gitCommonDir, `honk-ckpt-${randomUUID()}`);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_INDEX_FILE: tempIndexPath,
      GIT_AUTHOR_NAME: HONK_GIT_NAME,
      GIT_AUTHOR_EMAIL: HONK_GIT_EMAIL,
      GIT_COMMITTER_NAME: HONK_GIT_NAME,
      GIT_COMMITTER_EMAIL: HONK_GIT_EMAIL,
    };
    const cleanupTempIndex = Effect.try({
      try: () => rmSync(tempIndexPath, { force: true }),
      catch: (error) => gitOperationError("Checkpoints.cleanupTempIndex", cwd, String(error)),
    }).pipe(Effect.ignore);

    yield* Effect.gen(function* () {
      const headExists = yield* hasHeadCommit(cwd);
      if (headExists) {
        yield* git("Checkpoints.capture.readTree", cwd, ["read-tree", "HEAD"], { env });
      }
      yield* git("Checkpoints.capture.add", cwd, ["add", "-A", "--", "."], { env });
      const tree = (yield* git("Checkpoints.capture.writeTree", cwd, ["write-tree"], {
        env,
      })).stdout.trim();
      if (tree.length === 0) {
        return yield* Effect.fail(
          gitOperationError(
            "Checkpoints.capture.writeTree",
            cwd,
            "git write-tree returned an empty tree oid",
          ),
        );
      }
      const commit = (yield* git(
        "Checkpoints.capture.commitTree",
        cwd,
        ["commit-tree", tree, "-m", `honk checkpoint turn/${turn}`],
        { env },
      )).stdout.trim();
      if (commit.length === 0) {
        return yield* Effect.fail(
          gitOperationError(
            "Checkpoints.capture.commitTree",
            cwd,
            "git commit-tree returned an empty commit oid",
          ),
        );
      }
      yield* git("Checkpoints.capture.updateRef", cwd, ["update-ref", ref, commit]);
    }).pipe(Effect.ensuring(cleanupTempIndex));

    return ref;
  });

const hasCheckpointRef = (
  threadId: ThreadId,
  cwd: string,
  turn: number,
): Effect.Effect<boolean, GitOperationError> =>
  resolveCheckpointCommit(cwd, checkpointRef(threadId, turn)).pipe(
    Effect.map((commit) => commit !== null),
  );

const parseCount = (value: string): number => {
  if (value === "-") return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
};

const parseNumstat = (output: string): ReadonlyArray<PatchFileSummary> => {
  const files: Array<PatchFileSummary> = [];
  for (const record of output.split("\0")) {
    if (record.length === 0) continue;
    const firstTab = record.indexOf("\t");
    const secondTab = firstTab === -1 ? -1 : record.indexOf("\t", firstTab + 1);
    if (firstTab === -1 || secondTab === -1) continue;
    const path = record.slice(secondTab + 1);
    if (path.length === 0) continue;
    files.push(
      PatchFileSummarySchema.make({
        path: trimmed(path),
        additions: nonNegative(parseCount(record.slice(0, firstTab))),
        deletions: nonNegative(parseCount(record.slice(firstTab + 1, secondTab))),
      }),
    );
  }
  return files;
};

const showFile = (
  cwd: string,
  ref: string,
  path: string,
): Effect.Effect<string | null, GitOperationError> =>
  git("Checkpoints.showFile", cwd, ["show", `${ref}:${path}`], {
    allowNonZeroExit: true,
    maxOutputBytes: CHECKPOINT_DIFF_MAX_OUTPUT_BYTES,
  }).pipe(
    Effect.map((result) => {
      if (result.exitCode !== 0) return null;
      return result.stdout;
    }),
  );

const fileDiffs = (
  threadId: ThreadId,
  cwd: string,
  fromTurn: number,
  toTurn: number,
): Effect.Effect<ReadonlyArray<FileDiff>, GitError> =>
  Effect.gen(function* () {
    const fromRef = checkpointRef(threadId, fromTurn);
    const toRef = checkpointRef(threadId, toTurn);
    const fromCommit = yield* resolveCheckpointCommit(cwd, fromRef);
    if (fromCommit === null) return yield* Effect.fail(missingCheckpoint(threadId, fromTurn));
    const toCommit = yield* resolveCheckpointCommit(cwd, toRef);
    if (toCommit === null) return yield* Effect.fail(missingCheckpoint(threadId, toTurn));
    const summary = parseNumstat(
      (yield* git(
        "Checkpoints.diff.numstat",
        cwd,
        ["diff", "--numstat", "-z", "--no-renames", `${fromRef}^{commit}`, `${toRef}^{commit}`],
        { maxOutputBytes: CHECKPOINT_DIFF_MAX_OUTPUT_BYTES },
      )).stdout,
    );
    const files: Array<FileDiff> = [];
    for (const file of summary) {
      const before = yield* showFile(cwd, fromRef, file.path);
      const after = yield* showFile(cwd, toRef, file.path);
      files.push(
        FileDiffSchema.make({
          path: file.path,
          before,
          after,
          additions: file.additions,
          deletions: file.deletions,
        }),
      );
    }
    return files;
  });

const refsForThread = (
  threadId: ThreadId,
  cwd: string,
): Effect.Effect<ReadonlyArray<string>, GitOperationError> =>
  git(
    "Checkpoints.refsForThread",
    cwd,
    ["for-each-ref", "--format=%(refname)", `${checkpointNamespace(threadId)}/turn`],
    { allowNonZeroExit: true },
  ).pipe(
    Effect.map((result) =>
      result.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    ),
  );

const latestTurn = (
  threadId: ThreadId,
  cwd: string,
): Effect.Effect<number | null, GitOperationError> =>
  refsForThread(threadId, cwd).pipe(
    Effect.map((refs) => {
      const prefix = `${checkpointNamespace(threadId)}/turn/`;
      let latest: number | null = null;
      for (const ref of refs) {
        if (!ref.startsWith(prefix)) continue;
        const parsed = Number.parseInt(ref.slice(prefix.length), 10);
        if (!Number.isSafeInteger(parsed) || parsed < 0) continue;
        if (latest === null || parsed > latest) latest = parsed;
      }
      return latest;
    }),
  );

const nulSeparated = (output: string): ReadonlyArray<string> =>
  output.split("\0").filter((path) => path.length > 0);

const deletedPathsFromHead = (
  cwd: string,
  commit: string,
): Effect.Effect<ReadonlyArray<string>, GitOperationError> =>
  Effect.gen(function* () {
    const headExists = yield* hasHeadCommit(cwd);
    if (!headExists) return [];
    const result = yield* git(
      "Checkpoints.revert.deletedPaths",
      cwd,
      ["diff", "--name-only", "-z", "--diff-filter=D", "HEAD", `${commit}^{commit}`, "--", "."],
      { maxOutputBytes: CHECKPOINT_DIFF_MAX_OUTPUT_BYTES },
    );
    return nulSeparated(result.stdout);
  });

const removeWorkspacePath = (
  operation: string,
  cwd: string,
  relativePath: string,
): Effect.Effect<void, GitOperationError> =>
  Effect.try({
    try: () => {
      const root = resolve(cwd);
      const target = resolve(cwd, relativePath);
      if (target === root || !target.startsWith(`${root}${sep}`)) {
        throw new Error(`refusing to remove path outside cwd: ${relativePath}`);
      }
      rmSync(target, { force: true });
    },
    catch: (error) => gitOperationError(operation, cwd, String(error)),
  });

export const makeCheckpoints = (): Checkpoints => {
  const turnDiff: Checkpoints["turnDiff"] = Effect.fn("Checkpoints.turnDiff")(function* (
    threadId: ThreadId,
    cwd: string,
    turn: number,
  ) {
    yield* ensureRepo(cwd);
    if (turn <= 0) return yield* Effect.fail(missingCheckpoint(threadId, turn));
    return yield* fileDiffs(threadId, cwd, turn - 1, turn);
  });

  return {
    isRepo: (cwd) => repoStatus(cwd).pipe(Effect.catch(() => Effect.succeed(false))),

    initRepo: Effect.fn("Checkpoints.initRepo")(function* (cwd: string) {
      yield* git("Checkpoints.initRepo", cwd, ["init"], { maxOutputBytes: 64 * 1024 });
    }),

    baseline: Effect.fn("Checkpoints.baseline")(function* (threadId: ThreadId, cwd: string) {
      const inside = yield* repoStatus(cwd);
      if (!inside) return;
      const exists = yield* hasCheckpointRef(threadId, cwd, 0);
      if (!exists) yield* captureRef(threadId, cwd, 0);
    }),

    capture: Effect.fn("Checkpoints.capture")(function* (
      threadId: ThreadId,
      cwd: string,
      turn: number,
    ) {
      const inside = yield* repoStatus(cwd);
      if (!inside) return null;
      const ref = yield* captureRef(threadId, cwd, turn);
      if (turn === 0) return { turn, ref, files: [] };
      const files = (yield* turnDiff(threadId, cwd, turn)).map((file) =>
        PatchFileSummarySchema.make({
          path: file.path,
          additions: file.additions,
          deletions: file.deletions,
        }),
      );
      return { turn, ref, files };
    }),

    turnDiff,

    fullDiff: Effect.fn("Checkpoints.fullDiff")(function* (threadId: ThreadId, cwd: string) {
      yield* ensureRepo(cwd);
      const turn = yield* latestTurn(threadId, cwd);
      if (turn === null) return yield* Effect.fail(missingCheckpoint(threadId, 0));
      if (turn === 0) return [];
      return yield* fileDiffs(threadId, cwd, 0, turn);
    }),

    revert: Effect.fn("Checkpoints.revert")(function* (
      threadId: ThreadId,
      cwd: string,
      turn: number,
    ) {
      yield* ensureRepo(cwd);
      const ref = checkpointRef(threadId, turn);
      const commit = yield* resolveCheckpointCommit(cwd, ref);
      if (commit === null) return yield* Effect.fail(missingCheckpoint(threadId, turn));
      const gitCommonDir = yield* resolveGitCommonDir(cwd);
      const tempIndexPath = join(gitCommonDir, `honk-ckpt-restore-${randomUUID()}`);
      const env: NodeJS.ProcessEnv = { ...process.env, GIT_INDEX_FILE: tempIndexPath };
      const cleanupTempIndex = Effect.try({
        try: () => rmSync(tempIndexPath, { force: true }),
        catch: (error) =>
          gitOperationError("Checkpoints.revert.cleanupTempIndex", cwd, String(error)),
      }).pipe(Effect.ignore);

      yield* Effect.gen(function* () {
        yield* git("Checkpoints.revert.readTree", cwd, ["read-tree", commit], { env });
        yield* git("Checkpoints.revert.checkoutIndex", cwd, ["checkout-index", "-a", "-f"], {
          env,
        });
        for (const path of yield* deletedPathsFromHead(cwd, commit)) {
          yield* removeWorkspacePath("Checkpoints.revert.removeDeletedPath", cwd, path);
        }
        yield* git("Checkpoints.revert.clean", cwd, ["clean", "-fd", "--", "."], {
          env,
          allowNonZeroExit: true,
        });
        const headExists = yield* hasHeadCommit(cwd);
        if (headExists) {
          yield* git("Checkpoints.revert.reset", cwd, ["reset", "--quiet", "--", "."], {
            allowNonZeroExit: true,
          });
        }
      }).pipe(Effect.ensuring(cleanupTempIndex));
    }),

    pruneThread: Effect.fn("Checkpoints.pruneThread")(function* (threadId: ThreadId, cwd: string) {
      const inside = yield* repoStatus(cwd);
      if (!inside) return;
      for (const ref of yield* refsForThread(threadId, cwd)) {
        yield* git("Checkpoints.pruneThread.deleteRef", cwd, ["update-ref", "-d", ref], {
          allowNonZeroExit: true,
        });
      }
    }),
  };
};
