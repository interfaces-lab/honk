/**
 * The git service: every command from `./contract`, implemented over one
 * trusted workspace's `ExecutionEnv` through the plumbing in `./exec` and the
 * parsers in `./parse`.
 *
 * @module
 */

import { Context, Effect, Layer, Path } from "effect";
import type { Rpc } from "effect/unstable/rpc";

import { Workspace } from "../workspace";
import type {
  Branches,
  BranchesOutput,
  CaptureCheckpoint,
  CheckpointChanges,
  CheckpointDiff,
  Checkout,
  Checkpoints,
  CheckpointsOutput,
  ContentResult,
  ContentSource,
  DeleteCheckpoints,
  Diff,
  DiffMode,
  Discard,
  DiscardOutput,
  FileChange,
  FileContent,
  FileDiff,
  FileImage,
  FilePatch,
  ImageRef,
  ImageResult,
  Interface,
  Pull,
  RestoreCheckpoint,
  RestoreFiles,
  RestoreFilesOutput,
  Status,
  StatusOutput,
} from "./contract";
import { BaseBranchError, RefError, Rpcs } from "./contract";
import type { Repository } from "./exec";
import {
  CHECKPOINT_IDENTITY,
  CHECKPOINT_REF_ROOT,
  checkpointRefOf,
  EMPTY_TREE,
  openRepository,
  pathspec,
  quoteArgument,
  resolveCallerPath,
  resolveCheckpoint,
  runGit,
  runShell,
  shellCommand,
  validateRef,
  workspacePathOf,
} from "./exec";
import {
  byFile,
  firstNumstat,
  mediaTypeOf,
  parseNameStatus,
  parseNumstat,
  parseRefs,
  parseUntracked,
  REF_FORMAT,
  stripWhitespace,
} from "./parse";

/** Git's default patch context, used when a caller does not ask for one. */
const DEFAULT_CONTEXT_LINES = 3;

/** Upper bound on requested patch context, so one call cannot ask for a novel. */
const MAX_CONTEXT_LINES = 100;

/** How many per-file git commands run at once during a whole-tree diff. */
const FILE_CONCURRENCY = 8;

/**
 * Builds the git service over a trusted workspace's execution environment.
 *
 * Stateless: it holds no repository handle, caches no status, and starts no
 * watcher. Git state is a live observation, so every call reads it again — that
 * is what makes a reload after a reconnect repair anything a client missed.
 *
 * The explicit type annotation is what breaks the reference cycle: the effect
 * is declared before {@link Service}, the class carries it as its `make`, and
 * the generator body may still mention the class because it only runs after
 * the module has fully evaluated.
 */
const make: Effect.Effect<Interface, never, Path.Path | Workspace.Service> = Effect.gen(
  function* () {
    const path = yield* Path.Path;
    const workspace = yield* Workspace.Service;

    /** Resolves the environment and the repository root for one call. */
    const open = Effect.fnUntraced(function* (input: {
      readonly workspaceId: Workspace.WorkspaceId;
    }) {
      const env = yield* workspace.env(input);
      return yield* openRepository(path, env);
    });

    const status = Effect.fn("Git.status")(function* (input: Rpc.Payload<typeof Status>) {
      const repo = yield* open(input);
      const base = yield* resolveBase(repo, input.mode ?? "git");
      const files = yield* collectChanges(repo, base, []);
      const branch = yield* currentBranch(repo);
      const defaultBranch = yield* resolveDefaultBranch(repo);
      return { branch, defaultBranch, files } satisfies StatusOutput;
    });

    const diff = Effect.fn("Git.diff")(function* (input: Rpc.Payload<typeof Diff>) {
      const repo = yield* open(input);
      const base = yield* resolveBase(repo, input.mode ?? "git");
      const changes = yield* collectChanges(repo, base, []);
      const context = clampContext(input.context);
      return yield* Effect.forEach(changes, (change) => patchFor(repo, base, change, context), {
        concurrency: FILE_CONCURRENCY,
      });
    });

    const filePatch = Effect.fn("Git.filePatch")(function* (input: Rpc.Payload<typeof FilePatch>) {
      const repo = yield* open(input);
      const file = yield* resolveCallerPath(repo, input.path);
      const base = yield* resolveBase(repo, input.mode ?? "git");
      const changes = yield* collectChanges(repo, base, [pathspec(file)]);
      const change = changes.find((candidate) => candidate.file === file);
      if (change === undefined) {
        // Not in the change set: the file is clean, gone, or never existed.
        // Reporting whether git tracks it is the difference between "no changes
        // to show" and "there is nothing here", and costs one cheap command.
        const listed = yield* runGit(repo, "ls-files", ["ls-files", "-z", "--", pathspec(file)]);
        return {
          file,
          tracked: listed.stdout.length > 0,
          binary: false,
          additions: 0,
          deletions: 0,
        } satisfies FileDiff;
      }
      return yield* patchFor(repo, base, change, clampContext(input.context));
    });

    const fileImage = Effect.fn("Git.fileImage")(function* (input: Rpc.Payload<typeof FileImage>) {
      const repo = yield* open(input);
      const file = yield* resolveCallerPath(repo, input.path);
      const ref = input.ref ?? "working_tree";
      const encoded = yield* readBase64(repo, file, ref);
      if (encoded === undefined) return { type: "absent", file, ref } satisfies ImageResult;
      return {
        type: "image",
        file,
        ref,
        mediaType: mediaTypeOf(file),
        base64: encoded,
      } satisfies ImageResult;
    });

    const fileContent = Effect.fn("Git.fileContent")(function* (
      input: Rpc.Payload<typeof FileContent>,
    ) {
      const repo = yield* open(input);
      const file = yield* resolveCallerPath(repo, input.path);
      const at: ContentSource = input.at ?? { type: "working_tree" };

      if (at.type === "working_tree") {
        const exists = yield* Effect.promise(() => repo.env.exists(file));
        if (!exists.ok || !exists.value) {
          return { type: "absent", file, at } satisfies ContentResult;
        }
        // Binary is git's own judgment, asked the same way untracked counts
        // are: a `--numstat` against nothing, where `-` means "not text".
        const counted = yield* runGit(
          repo,
          "diff --no-index",
          ["diff", "--no-index", "--numstat", "-z", "--", "/dev/null", file],
          [1],
        );
        if (firstNumstat(counted.stdout).binary) {
          return { type: "binary", file, at } satisfies ContentResult;
        }
        const read = yield* runShell(repo, "cat", shellCommand(["cat", "--", file]), []);
        return { type: "content", file, at, text: read.stdout } satisfies ContentResult;
      }

      const revision = at.type === "head" ? "HEAD" : yield* resolveCheckpoint(repo, at.checkpoint);
      // `rev:./path` resolves against the working directory, so the path needs
      // no repository-prefix arithmetic even when the workspace is a
      // subdirectory of its repository.
      const blob = `${revision}:./${file}`;
      const probe = yield* runGit(repo, "cat-file", ["cat-file", "-e", blob], [1, 128]);
      if (probe.exitCode !== 0) {
        return { type: "absent", file, at } satisfies ContentResult;
      }
      const counted = yield* runGit(repo, "diff --numstat", [
        "diff",
        "--numstat",
        "-z",
        "--no-renames",
        EMPTY_TREE,
        revision,
        "--",
        pathspec(file),
      ]);
      if (firstNumstat(counted.stdout).binary) {
        return { type: "binary", file, at } satisfies ContentResult;
      }
      const shown = yield* runGit(repo, "show", ["show", blob]);
      return { type: "content", file, at, text: shown.stdout } satisfies ContentResult;
    });

    const branches = Effect.fn("Git.branches")(function* (input: Rpc.Payload<typeof Branches>) {
      const repo = yield* open(input);
      const listed = yield* runGit(repo, "for-each-ref", [
        "for-each-ref",
        `--format=${REF_FORMAT}`,
        "refs/heads",
        "refs/remotes",
      ]);
      const current = yield* currentBranch(repo);
      const defaultBranch = yield* resolveDefaultBranch(repo);
      return {
        current,
        defaultBranch,
        branches: parseRefs(listed.stdout),
      } satisfies BranchesOutput;
    });

    const checkout = Effect.fn("Git.checkout")(function* (input: Rpc.Payload<typeof Checkout>) {
      const repo = yield* open(input);
      const branch = validateRef(input.branch);
      if (branch === undefined) return yield* new RefError({ ref: input.branch });
      const argv = input.create === true ? ["switch", "-c", branch] : ["switch", branch];
      yield* runGit(repo, "switch", argv);
    });

    const pull = Effect.fn("Git.pull")(function* (input: Rpc.Payload<typeof Pull>) {
      const repo = yield* open(input);
      yield* runGit(repo, "pull", ["pull", "--ff-only"]);
    });

    const discard = Effect.fn("Git.discard")(function* (input: Rpc.Payload<typeof Discard>) {
      const repo = yield* open(input);
      const files: string[] = [];
      for (const candidate of input.paths) {
        files.push(yield* resolveCallerPath(repo, candidate));
      }
      const base = yield* resolveBase(repo, "git");
      const changes = yield* collectChanges(repo, base, files.map(pathspec));
      const untracked = new Set(
        changes.filter((change) => !change.tracked).map((change) => change.file),
      );
      const discarded = files.filter((file) => !untracked.has(file));
      const skipped = files.filter((file) => untracked.has(file));
      if (discarded.length > 0) {
        yield* runGit(repo, "restore", [
          "restore",
          "--source=HEAD",
          "--staged",
          "--worktree",
          "--",
          ...discarded.map(pathspec),
        ]);
      }
      return { discarded, skipped } satisfies DiscardOutput;
    });

    const captureCheckpoint = Effect.fn("Git.captureCheckpoint")(function* (
      input: Rpc.Payload<typeof CaptureCheckpoint>,
    ) {
      const repo = yield* open(input);
      const ref = checkpointRefOf(input.checkpoint);
      if (ref === undefined) return yield* new RefError({ ref: input.checkpoint });

      // The scratch index lives in the git common dir, like git's own
      // temporary files: same filesystem, and never inside the working tree
      // where a capture would snapshot it.
      const common = yield* runGit(repo, "rev-parse --git-common-dir", [
        "rev-parse",
        "--git-common-dir",
      ]);
      const indexFile = repo.path.join(
        repo.path.resolve(repo.directory, common.stdout.trim()),
        `honk-checkpoint-${crypto.randomUUID()}`,
      );
      const scratchIndex = { GIT_INDEX_FILE: indexFile };

      yield* Effect.gen(function* () {
        // Prime the scratch index from HEAD so paths outside the workspace
        // subtree carry through unchanged; a repository with no commits yet
        // starts the index empty instead.
        const head = yield* runGit(
          repo,
          "rev-parse",
          ["rev-parse", "--verify", "--quiet", "HEAD"],
          [1],
        );
        if (head.exitCode === 0) {
          yield* runGit(repo, "read-tree", ["read-tree", "HEAD"], [], scratchIndex);
        }
        yield* runGit(repo, "add", ["add", "-A", "--", "."], [], scratchIndex);
        const tree = yield* runGit(repo, "write-tree", ["write-tree"], [], scratchIndex);
        // Parentless on purpose: each snapshot stands alone, sharing objects
        // through the store rather than history through a chain, so deleting
        // any one ref never orphans another.
        const commit = yield* runGit(
          repo,
          "commit-tree",
          ["commit-tree", tree.stdout.trim(), "-m", `honk checkpoint ${input.checkpoint}`],
          [],
          { ...scratchIndex, ...CHECKPOINT_IDENTITY },
        );
        yield* runGit(repo, "update-ref", ["update-ref", ref, commit.stdout.trim()]);
      }).pipe(
        Effect.ensuring(
          runShell(repo, "rm", `rm -f -- ${quoteArgument(indexFile)}`, []).pipe(Effect.ignore),
        ),
      );
    });

    const checkpoints = Effect.fn("Git.checkpoints")(function* (
      input: Rpc.Payload<typeof Checkpoints>,
    ) {
      const repo = yield* open(input);
      let root = CHECKPOINT_REF_ROOT;
      if (input.prefix !== undefined) {
        const ref = checkpointRefOf(input.prefix);
        if (ref === undefined) return yield* new RefError({ ref: input.prefix });
        root = ref;
      }
      const listed = yield* runGit(repo, "for-each-ref", [
        "for-each-ref",
        "--format=%(refname)",
        root,
      ]);
      const names: string[] = [];
      for (const line of listed.stdout.split("\n")) {
        if (line.startsWith(`${CHECKPOINT_REF_ROOT}/`)) {
          names.push(line.slice(CHECKPOINT_REF_ROOT.length + 1));
        }
      }
      return { checkpoints: names } satisfies CheckpointsOutput;
    });

    const checkpointChanges = Effect.fn("Git.checkpointChanges")(function* (
      input: Rpc.Payload<typeof CheckpointChanges>,
    ) {
      const repo = yield* open(input);
      const from = yield* resolveCheckpoint(repo, input.from);
      const to = yield* resolveCheckpoint(repo, input.to);
      const changes = yield* trackedChanges(repo, [from, to], []);
      return changes.sort(byFile);
    });

    const checkpointDiff = Effect.fn("Git.checkpointDiff")(function* (
      input: Rpc.Payload<typeof CheckpointDiff>,
    ) {
      const repo = yield* open(input);
      const from = yield* resolveCheckpoint(repo, input.from);
      const to = yield* resolveCheckpoint(repo, input.to);
      const scope: string[] = [];
      if (input.path !== undefined) {
        scope.push(pathspec(yield* resolveCallerPath(repo, input.path)));
      }
      const context = clampContext(input.context);
      const changes = (yield* trackedChanges(repo, [from, to], scope)).sort(byFile);
      return yield* Effect.forEach(
        changes,
        (change) =>
          Effect.gen(function* () {
            if (change.binary) return { ...change } satisfies FileDiff;
            const run = yield* runGit(repo, "diff", [
              "diff",
              `--unified=${context}`,
              "--no-renames",
              from,
              to,
              "--",
              pathspec(change.file),
            ]);
            return { ...change, patch: run.stdout } satisfies FileDiff;
          }),
        { concurrency: FILE_CONCURRENCY },
      );
    });

    const restoreCheckpoint = Effect.fn("Git.restoreCheckpoint")(function* (
      input: Rpc.Payload<typeof RestoreCheckpoint>,
    ) {
      const repo = yield* open(input);
      const oid = yield* resolveCheckpoint(repo, input.checkpoint);
      // Worktree and index both move to the snapshot, then the index returns
      // to HEAD: the restored state shows up as ordinary uncommitted changes,
      // never as something silently staged.
      yield* runGit(repo, "restore", [
        "restore",
        "--source",
        oid,
        "--worktree",
        "--staged",
        "--",
        ".",
      ]);
      // Files created after the snapshot are untracked again once the index
      // moved; removing them is what makes restore faithful. Ignored files
      // were never captured, so they are never touched.
      yield* runGit(repo, "clean", ["clean", "-fd", "--", "."]);
      const head = yield* runGit(
        repo,
        "rev-parse",
        ["rev-parse", "--verify", "--quiet", "HEAD"],
        [1],
      );
      if (head.exitCode === 0) {
        yield* runGit(repo, "reset", ["reset", "--quiet", "--", "."]);
      }
    });

    const restoreFiles = Effect.fn("Git.restoreFiles")(function* (
      input: Rpc.Payload<typeof RestoreFiles>,
    ) {
      const repo = yield* open(input);
      const oid = yield* resolveCheckpoint(repo, input.checkpoint);
      const files: string[] = [];
      for (const candidate of input.paths) {
        files.push(yield* resolveCallerPath(repo, candidate));
      }

      // Partition by what the snapshot holds: a path present there is
      // restored from it; a path absent there did not exist at that turn, so
      // restoring it means removing today's file.
      const restored: string[] = [];
      const removed: string[] = [];
      for (const file of files) {
        const probe = yield* runGit(
          repo,
          "cat-file",
          ["cat-file", "-e", `${oid}:./${file}`],
          [1, 128],
        );
        (probe.exitCode === 0 ? restored : removed).push(file);
      }

      if (restored.length > 0) {
        // Worktree and index both move, then the index returns to HEAD below:
        // the restored state shows up as ordinary uncommitted changes, exactly
        // like a whole-tree restore.
        yield* runGit(repo, "restore", [
          "restore",
          "--source",
          oid,
          "--worktree",
          "--staged",
          "--",
          ...restored.map(pathspec),
        ]);
      }
      for (const file of removed) {
        yield* runShell(repo, "rm", `rm -f -- ${quoteArgument(file)}`, []);
      }
      const head = yield* runGit(
        repo,
        "rev-parse",
        ["rev-parse", "--verify", "--quiet", "HEAD"],
        [1],
      );
      if (head.exitCode === 0) {
        yield* runGit(repo, "reset", ["reset", "--quiet", "--", "."]);
      }
      return { restored, removed } satisfies RestoreFilesOutput;
    });

    const deleteCheckpoints = Effect.fn("Git.deleteCheckpoints")(function* (
      input: Rpc.Payload<typeof DeleteCheckpoints>,
    ) {
      const repo = yield* open(input);
      const root = checkpointRefOf(input.prefix);
      if (root === undefined) return yield* new RefError({ ref: input.prefix });
      const listed = yield* runGit(repo, "for-each-ref", [
        "for-each-ref",
        "--format=%(refname)",
        root,
      ]);
      for (const refname of listed.stdout.split("\n")) {
        // Only names under the checkpoint root ever reach update-ref, so a
        // surprising for-each-ref line cannot become a deletion elsewhere.
        if (!refname.startsWith(`${CHECKPOINT_REF_ROOT}/`)) continue;
        yield* runGit(repo, "update-ref", ["update-ref", "-d", refname]);
      }
    });

    return {
      status,
      diff,
      filePatch,
      fileImage,
      fileContent,
      branches,
      checkout,
      pull,
      discard,
      captureCheckpoint,
      checkpoints,
      checkpointChanges,
      checkpointDiff,
      restoreCheckpoint,
      restoreFiles,
      deleteCheckpoints,
    } satisfies Interface;
  },
);

/**
 * The service key and its construction, declared together: Effect v4's
 * `Context.Service` takes the `make` effect as an option, so `Service.make`
 * is the one place this service is built.
 *
 * @category service
 */
export class Service extends Context.Service<Service, Interface>()("honk/Git", { make }) {}

/**
 * Provides {@link Service} from its own `make`.
 *
 * @category layers
 */
export const layer = Layer.effect(Service, Service.make);

/**
 * {@link layer} with POSIX path rules, for tests and browser-adjacent hosts.
 *
 * TODO(core-migration §6): a Node host should provide its platform `Path`
 * implementation (`NodePath.layer`) instead, so containment is decided the way
 * the operating system resolves paths rather than the way POSIX rules assume.
 * The `Workspace.Service` requirement stays open on purpose — one host builds
 * one workspace layer and shares it.
 *
 * @category layers
 */
export const defaultLayer = layer.pipe(Layer.provide(Path.layer));

/**
 * Binds the git RPCs to {@link Service}.
 *
 * Handlers stay thin: decoding already happened at the RPC boundary, so they
 * only bind payloads to service methods. `Rpcs.toLayer` checks the map is
 * total at compile time. Provide {@link layer} to satisfy the `Service`
 * requirement.
 *
 * @category layers
 */
export const rpcLayer = Rpcs.toLayer(
  Effect.gen(function* () {
    const git = yield* Service;
    return {
      "git.status": (payload) => git.status(payload),
      "git.diff": (payload) => git.diff(payload),
      "git.file_patch": (payload) => git.filePatch(payload),
      "git.file_image": (payload) => git.fileImage(payload),
      "git.file_content": (payload) => git.fileContent(payload),
      "git.branches": (payload) => git.branches(payload),
      "git.checkout": (payload) => git.checkout(payload),
      "git.pull": (payload) => git.pull(payload),
      "git.discard": (payload) => git.discard(payload),
      "git.capture_checkpoint": (payload) => git.captureCheckpoint(payload),
      "git.checkpoints": (payload) => git.checkpoints(payload),
      "git.checkpoint_changes": (payload) => git.checkpointChanges(payload),
      "git.checkpoint_diff": (payload) => git.checkpointDiff(payload),
      "git.restore_checkpoint": (payload) => git.restoreCheckpoint(payload),
      "git.restore_files": (payload) => git.restoreFiles(payload),
      "git.delete_checkpoints": (payload) => git.deleteCheckpoints(payload),
    };
  }),
);

/**
 * Picks the commit a comparison runs against.
 *
 * `git` mode compares to `HEAD`, falling back to the empty tree so a repository
 * without commits reports its files instead of failing. `branch` mode compares
 * to the merge base with the default branch, which is what "what does this
 * branch add" means once the base branch has moved on.
 */
const resolveBase = Effect.fnUntraced(function* (repo: Repository, mode: DiffMode) {
  if (mode === "git") {
    const head = yield* runGit(
      repo,
      "rev-parse",
      ["rev-parse", "--verify", "--quiet", "HEAD"],
      [1],
    );
    return head.exitCode === 0 ? "HEAD" : EMPTY_TREE;
  }
  const base = yield* resolveDefaultBranch(repo);
  if (base === null) return yield* new BaseBranchError();
  const merged = yield* runGit(repo, "merge-base", ["merge-base", base, "HEAD"], [1]);
  const sha = merged.stdout.trim();
  if (merged.exitCode !== 0 || sha.length === 0) return yield* new BaseBranchError();
  return sha;
});

/**
 * Names the branch this repository treats as its trunk.
 *
 * `origin/HEAD` is the authoritative answer when a remote published one. The
 * `main`/`master` fallback is a convention, not a fact, so it is tried only
 * after and reported as `null` when neither exists rather than guessed at.
 */
const resolveDefaultBranch = Effect.fnUntraced(function* (repo: Repository) {
  const symbolic = yield* runGit(
    repo,
    "symbolic-ref",
    ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
    [1],
  );
  const published = symbolic.stdout.trim();
  if (symbolic.exitCode === 0 && published.length > 0) {
    const slash = published.indexOf("/");
    const name = slash === -1 ? published : published.slice(slash + 1);
    if (name.length > 0) return name;
  }
  for (const candidate of ["main", "master"]) {
    const found = yield* runGit(
      repo,
      "rev-parse",
      ["rev-parse", "--verify", "--quiet", `refs/heads/${candidate}`],
      [1],
    );
    if (found.exitCode === 0) return candidate;
  }
  return null;
});

/** The checked-out branch, or `null` on a detached HEAD. */
const currentBranch = Effect.fnUntraced(function* (repo: Repository) {
  const run = yield* runGit(repo, "branch", ["branch", "--show-current"]);
  const name = run.stdout.trim();
  return name.length === 0 ? null : name;
});

/**
 * Lists every changed path between `base` and the working tree.
 *
 * Three commands, because git answers three different questions:
 *
 * - `--name-status` says *what* happened to each tracked path.
 * - `--numstat` says *how much*, and marks binary files with `-`.
 * - `status --porcelain` is the only one that sees untracked files at all.
 *
 * All three use `-z`, so paths arrive NUL-delimited and unquoted — a filename
 * containing a space, a quote, or a newline parses the same as any other.
 *
 * Untracked files get their counts from `git diff --no-index` against
 * `/dev/null`, one command each at bounded concurrency. That is the only way to
 * ask git for a line count on a file it does not track without first writing to
 * the index, and a read must not mutate the repository to answer.
 *
 * TODO(core-migration §12): `/dev/null` is POSIX. A Windows host needs `NUL`,
 * which is a shape this module should take from the environment rather than
 * assume.
 */
const collectChanges = Effect.fnUntraced(function* (
  repo: Repository,
  base: string,
  pathspecs: readonly string[],
) {
  const scope = pathspecs.length === 0 ? [] : ["--", ...pathspecs];
  const changes = yield* trackedChanges(repo, [base], pathspecs);
  const listed = yield* runGit(repo, "status", [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    ...scope,
  ]);

  const untracked: string[] = [];
  for (const gitPath of parseUntracked(listed.stdout)) {
    const file = workspacePathOf(repo, gitPath);
    if (file !== undefined) untracked.push(file);
  }
  const added = yield* Effect.forEach(untracked, (file) => untrackedChange(repo, file), {
    concurrency: FILE_CONCURRENCY,
  });

  return [...changes, ...added].sort(byFile);
});

/**
 * The tracked half of a diff: what git itself reports between `revisions` and
 * the working tree (one revision) or between two snapshots (two revisions).
 *
 * `--name-status` says *what* happened to each path, `--numstat` says *how
 * much* and marks binary files with `-`. Both use `-z`, so a filename with a
 * space, quote, or newline parses the same as any other, and every reported
 * path is re-expressed against the workspace or dropped.
 */
const trackedChanges = Effect.fnUntraced(function* (
  repo: Repository,
  revisions: readonly string[],
  pathspecs: readonly string[],
) {
  const scope = pathspecs.length === 0 ? [] : ["--", ...pathspecs];
  const named = yield* runGit(repo, "diff --name-status", [
    "diff",
    "--name-status",
    "-z",
    "--no-renames",
    ...revisions,
    ...scope,
  ]);
  const numbered = yield* runGit(repo, "diff --numstat", [
    "diff",
    "--numstat",
    "-z",
    "--no-renames",
    ...revisions,
    ...scope,
  ]);

  const counts = parseNumstat(numbered.stdout);
  const changes: FileChange[] = [];
  for (const entry of parseNameStatus(named.stdout)) {
    const file = workspacePathOf(repo, entry.file);
    if (file === undefined) continue;
    const count = counts.get(entry.file);
    changes.push({
      file,
      status: entry.status,
      tracked: true,
      binary: count?.binary ?? false,
      additions: count?.additions ?? 0,
      deletions: count?.deletions ?? 0,
    });
  }
  return changes;
});

/** Counts the lines of an untracked file by diffing it against nothing. */
const untrackedChange = Effect.fnUntraced(function* (repo: Repository, file: string) {
  const run = yield* runGit(
    repo,
    "diff --no-index",
    ["diff", "--no-index", "--numstat", "-z", "--", "/dev/null", file],
    [1],
  );
  const count = firstNumstat(run.stdout);
  return {
    file,
    status: "added",
    tracked: false,
    binary: count.binary,
    additions: count.additions,
    deletions: count.deletions,
  } satisfies FileChange;
});

/**
 * Produces the patch for one already-identified change.
 *
 * Binary files get no patch: git has no textual answer, and an empty string
 * would read as "no changes" rather than "not representable". A client renders
 * those through the image command or not at all.
 */
const patchFor = Effect.fnUntraced(function* (
  repo: Repository,
  base: string,
  change: FileChange,
  context: number,
) {
  if (change.binary) return { ...change } satisfies FileDiff;
  const argv = change.tracked
    ? ["diff", `--unified=${context}`, "--no-renames", base, "--", pathspec(change.file)]
    : ["diff", "--no-index", `--unified=${context}`, "--", "/dev/null", change.file];
  const run = yield* runGit(repo, "diff", argv, change.tracked ? [] : [1]);
  return { ...change, patch: run.stdout } satisfies FileDiff;
});

/**
 * Reads one file at one ref as base64, or reports it as absent there.
 *
 * Both sides go through `base64` in the shell rather than through the
 * environment's binary read, because the committed side only exists inside git
 * and `exec` hands back a string: raw bytes would not survive the trip.
 *
 * The existence probe is separate because a shell pipeline reports the *last*
 * command's exit code — a failing `git show` piped into `base64` still exits 0,
 * so the pipeline alone cannot tell "empty file" from "no such blob".
 */
const readBase64 = Effect.fnUntraced(function* (repo: Repository, file: string, ref: ImageRef) {
  if (ref === "head") {
    // `HEAD:./path` resolves against the working directory, so the path needs
    // no repository-prefix arithmetic when the workspace is a subdirectory.
    const blob = `HEAD:./${file}`;
    const probe = yield* runGit(repo, "cat-file", ["cat-file", "-e", blob], [1, 128]);
    if (probe.exitCode !== 0) return undefined;
    const shown = yield* runShell(
      repo,
      "show",
      `${shellCommand(["git", "show", blob])} | base64`,
      [],
    );
    return stripWhitespace(shown.stdout);
  }
  const exists = yield* Effect.promise(() => repo.env.exists(file));
  if (!exists.ok || !exists.value) return undefined;
  const read = yield* runShell(repo, "cat", `${shellCommand(["cat", "--", file])} | base64`, []);
  return stripWhitespace(read.stdout);
});

/** Keeps a requested patch context inside a range git and a client can both hold. */
function clampContext(requested: number | undefined): number {
  if (requested === undefined) return DEFAULT_CONTEXT_LINES;
  return Math.min(Math.max(Math.trunc(requested), 0), MAX_CONTEXT_LINES);
}
