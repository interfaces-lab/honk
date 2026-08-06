/**
 * How git commands run, and how caller input is allowed to reach them.
 *
 * This file is the security layer of the git module, deliberately small so it
 * can be audited in one sitting. Two rules shape every export, and both come
 * from the same place: the payloads are client data.
 *
 * 1. **No caller value is ever interpolated into a shell string.** Pi's `exec`
 *    takes a command line, not an argv array, so this file builds that line
 *    from an argv array through {@link quoteArgument} and never any other way.
 *    Paths reach git behind `--` as `:(literal)` pathspecs; branch names pass
 *    {@link validateRef} first.
 * 2. **Every path stays inside the workspace directory.** Git reports paths
 *    relative to the *repository* root, which can sit above the workspace, so
 *    each reported path is re-expressed against the workspace and dropped when
 *    it lands outside. A caller path that escapes is a `PathError`, not a
 *    defect.
 *
 * @module
 */

import { Effect, Option, Path, Schema } from "effect";

import type { Workspace } from "../workspace";
import {
  CheckpointNotFoundError,
  CommandError,
  ExecError,
  NotARepositoryError,
  PathError,
  RefError,
} from "./contract";

/**
 * Git's empty tree object: the base a first commit is diffed against.
 *
 * A repository with no commits has no `HEAD`, and diffing against a ref that
 * does not exist fails. This hash is stable across every git installation and
 * means "nothing", which is exactly the right base before the first commit.
 */
export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/** The one stderr shape that means "there is no repository here", not "git failed". */
const NOT_A_REPOSITORY = /not a git repository/i;

/** One workspace's repository, resolved once per call. */
export interface Repository {
  readonly path: Path.Path;
  readonly env: Workspace.ExecutionEnv;
  /** The workspace directory: the containment boundary and every command's cwd. */
  readonly directory: string;
  /**
   * Where the workspace sits inside the repository, in git's own words:
   * `""` when it is the repository root, `"packages/core/"` when it is not.
   */
  readonly prefix: string;
}

/** One completed command. */
export interface Run {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Wraps one argument so a POSIX shell passes it through untouched.
 *
 * Pi's `exec` takes a command line, not an argv array, so something has to
 * bridge the two — and this is the only thing in this module that does. Single
 * quotes suppress every expansion a shell performs; the only character they
 * cannot contain is a single quote, which is closed, escaped, and reopened.
 *
 * A caller value that reaches git does so through here or not at all.
 */
export function quoteArgument(argument: string): string {
  return `'${argument.replaceAll("'", "'\\''")}'`;
}

/** Renders an argv array as a command line no caller value can break out of. */
export function shellCommand(argv: readonly string[]): string {
  return argv.map(quoteArgument).join(" ");
}

/**
 * Marks a path as a literal pathspec.
 *
 * Quoting stops the *shell* from reinterpreting a path; this stops *git* from
 * doing it. Without the prefix, a file named `:(exclude)notes.md` would be read
 * as pathspec magic rather than as a filename, which for discard would mean
 * touching a different set of files than the caller named.
 */
export function pathspec(relative: string): string {
  return `:(literal)${relative}`;
}

/**
 * Runs one command line and normalizes the environment's failure.
 *
 * Pi's `exec` never rejects: it returns a `Result`, and an `ExecutionError`
 * there means the command never ran. That is different from a command that ran
 * and refused, so it becomes {@link ExecError} rather than a defect.
 *
 * `env` entries ride Pi's exec options — inherited variables stay, these
 * override — and the effect's abort signal is handed to the process, so
 * interrupting a git call kills the command instead of orphaning it.
 */
export const runShell = Effect.fnUntraced(function* (
  repo: Repository,
  command: string,
  line: string,
  allowExitCodes: readonly number[],
  env?: Readonly<Record<string, string>>,
) {
  const result = yield* Effect.promise((signal) =>
    repo.env.exec(line, {
      abortSignal: signal,
      ...(env === undefined ? {} : { env: { ...env } }),
    }),
  );
  if (!result.ok) {
    return yield* new ExecError({
      command,
      reason: result.error.code,
      detail: result.error.message,
    });
  }
  const run: Run = result.value;
  // "Not a git repository" is checked before the allowed codes, so a command
  // that tolerates a non-zero exit still cannot mask a missing repository.
  if (run.exitCode !== 0 && NOT_A_REPOSITORY.test(run.stderr)) {
    return yield* new NotARepositoryError({ directory: repo.directory });
  }
  if (run.exitCode === 0 || allowExitCodes.includes(run.exitCode)) return run;
  return yield* new CommandError({ command, exitCode: run.exitCode, stderr: run.stderr.trim() });
});

/**
 * Runs one git command from an argv array.
 *
 * `command` is the subcommand name, a code-owned literal used for tracing and
 * for {@link CommandError}. The assembled line never appears in an error, so no
 * error message can echo a caller's path back to another client.
 *
 * `allowExitCodes` names the codes that are answers rather than failures —
 * `git diff --no-index` exits 1 when the files differ, which is the whole point
 * of running it.
 */
export const runGit = Effect.fnUntraced(function* (
  repo: Repository,
  command: string,
  argv: readonly string[],
  allowExitCodes: readonly number[] = [],
  env?: Readonly<Record<string, string>>,
) {
  return yield* runShell(repo, command, shellCommand(["git", ...argv]), allowExitCodes, env);
});

/** Where checkpoint refs live: outside `refs/heads` and `refs/remotes`, so no log, branch list, or push ever sees one. */
export const CHECKPOINT_REF_ROOT = "refs/honk/checkpoints";

/** The identity checkpoint commits are written under — never the user's, so a snapshot cannot impersonate them. */
export const CHECKPOINT_IDENTITY: Readonly<Record<string, string>> = {
  GIT_AUTHOR_NAME: "Honk",
  GIT_AUTHOR_EMAIL: "checkpoints@honk.invalid",
  GIT_COMMITTER_NAME: "Honk",
  GIT_COMMITTER_EMAIL: "checkpoints@honk.invalid",
};

/**
 * Ref names — branches and checkpoint segments — Honk will pass to git.
 *
 * Narrower than `git check-ref-format` allows, and deliberately so: it is an
 * allowlist, and every real branch name fits it. A leading `-` cannot appear,
 * so a name can never be read as a flag; `@`, `~`, `^`, `:`, `?`, `*`, `[`,
 * whitespace, and control characters cannot appear, so revision syntax cannot
 * be smuggled through.
 */
const REF_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/** The rules the pattern alone cannot state: no climbing, no empty segments, no lock suffix. */
const refNameRules = Schema.makeFilter<string>(
  (name) =>
    !name.includes("..") &&
    !name.includes("//") &&
    !name.endsWith("/") &&
    !name.endsWith(".") &&
    !name.endsWith(".lock"),
);

/**
 * A branch or checkpoint name this module has vouched for.
 *
 * The brand is the proof that {@link validateRef} ran, so a validated name can
 * travel through helpers without being re-checked at each one. Module-private:
 * command payloads stay `NonEmptyString` on purpose, because a bad name over
 * the wire is a typed `RefError` a client can show as product copy, not
 * a schema decode failure it has to translate.
 */
const RefName = Schema.NonEmptyString.pipe(
  Schema.check(Schema.isPattern(REF_NAME), Schema.isMaxLength(255), refNameRules),
  Schema.brand("GitRefName"),
);
type RefName = typeof RefName.Type;

/** {@link RefName}'s decoder, built once so every call reuses one parser. */
const decodeRefName = Schema.decodeOption(RefName);

/**
 * Accepts a branch or checkpoint name, or returns `undefined` to refuse it.
 *
 * Validation, not escaping: quoting would already stop the shell, but git
 * itself reads `-f` as a flag and `main@{1}` as a revision, and neither is what
 * a client naming a ref meant. The rules live on {@link RefName} — the schema
 * is the only validator — and the returned brand is the proof a name passed,
 * so helpers downstream take a `RefName` instead of re-checking a string.
 */
export function validateRef(input: string): RefName | undefined {
  return Option.getOrUndefined(decodeRefName(input));
}

/**
 * Turns a caller's checkpoint name into a full ref, or refuses it.
 *
 * The name passes {@link validateRef}, so it cannot climb out of
 * {@link CHECKPOINT_REF_ROOT} with `..`, start with a dash, or smuggle
 * revision syntax — a checkpoint can name only a checkpoint.
 */
export function checkpointRefOf(name: string): string | undefined {
  const validated = validateRef(name);
  return validated === undefined ? undefined : `${CHECKPOINT_REF_ROOT}/${validated}`;
}

/** Resolves a checkpoint name to its commit, or reports it missing. */
export const resolveCheckpoint = Effect.fnUntraced(function* (repo: Repository, name: string) {
  const ref = checkpointRefOf(name);
  if (ref === undefined) return yield* new RefError({ ref: name });
  const shown = yield* runGit(
    repo,
    "rev-parse",
    ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
    [1],
  );
  const oid = shown.stdout.trim();
  if (shown.exitCode !== 0 || oid.length === 0) {
    return yield* new CheckpointNotFoundError({ checkpoint: name });
  }
  return oid;
});

/**
 * Resolves the repository containing the workspace directory.
 *
 * Runs first in every method so "not a git repository" is answered once, in one
 * place, as its own state.
 *
 * It asks for `--show-prefix` rather than `--show-toplevel` because the answer
 * has to survive symlinks. A workspace reached through a symlinked parent — the
 * ordinary shape of a macOS temp directory — has a `cwd` in one namespace and a
 * repository root in another, and subtracting one from the other produces a
 * path that climbs out of the workspace and gets every change discarded. The
 * prefix is git's own statement of where the workspace sits in the repository,
 * so it needs no path arithmetic across namespaces at all.
 */
export const openRepository = Effect.fnUntraced(function* (
  path: Path.Path,
  env: Workspace.ExecutionEnv,
) {
  const probe: Repository = { path, env, directory: env.cwd, prefix: "" };
  const run = yield* runGit(probe, "rev-parse", ["rev-parse", "--show-prefix"]);
  return { path, env, directory: env.cwd, prefix: run.stdout.trim() } satisfies Repository;
});

/**
 * Turns caller input into a workspace-relative path, or refuses it.
 *
 * The containment check is the invariant, so it is the first thing that
 * happens to a client string. Absolute input is accepted only when it already
 * points inside the workspace; relative input resolves against the workspace
 * directory. `..` that climbs out, and a NUL byte that could truncate an
 * argument, are both refusals.
 *
 * TODO(core-migration §13): a symlink inside the workspace that points outside
 * it still resolves, because the check is syntactic. Closing that needs
 * `env.canonicalPath`, which resolves symlinks but requires the path to exist —
 * so it cannot be the only check, and layering the two is its own change.
 */
export const resolveCallerPath = Effect.fnUntraced(function* (repo: Repository, input: string) {
  const relative = containedPath(repo, repo.path.resolve(repo.directory, input));
  if (input.includes("\0") || relative === undefined) {
    return yield* new PathError({ path: input });
  }
  return relative;
});

/**
 * Re-expresses an absolute path as workspace-relative, or reports it as outside.
 *
 * `undefined` means the path is not in the workspace — including the workspace
 * directory itself, which is not a file any of these methods can act on.
 */
function containedPath(repo: Repository, absolute: string): string | undefined {
  const relative = repo.path.relative(repo.directory, absolute);
  if (relative.length === 0 || repo.path.isAbsolute(relative)) return undefined;
  if (relative === ".." || relative.startsWith(`..${repo.path.sep}`)) return undefined;
  return relative;
}

/**
 * Translates a path git reported into a workspace-relative one.
 *
 * Git speaks in repository-root-relative paths, always with `/` separators.
 * When a workspace is a subdirectory of its repository, the root's other
 * subtrees hold real changes that this session has no business seeing — so a
 * path outside the workspace prefix is dropped rather than clamped or reported.
 */
export function workspacePathOf(repo: Repository, gitPath: string): string | undefined {
  if (!gitPath.startsWith(repo.prefix)) return undefined;
  const relative = gitPath.slice(repo.prefix.length);
  return relative.length === 0 ? undefined : relative;
}
