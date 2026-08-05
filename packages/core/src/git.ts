/**
 * Git: typed read and mutation methods over one trusted workspace.
 *
 * Everything here runs through the workspace's `ExecutionEnv` — the same
 * instance Pi's harness gets as tool context. Honk does not spawn its own
 * processes and does not construct a second environment, because sharing one
 * is what makes the workspace directory the boundary rather than a suggestion.
 *
 * Two rules shape every line below, and both come from the same place: the
 * payloads are client data.
 *
 * 1. **No caller value is ever interpolated into a shell string.** Pi's `exec`
 *    takes a command line, not an argv array, so this module builds that line
 *    from an argv array through {@link quoteArgument} and never any other way.
 *    Paths reach git behind `--` as `:(literal)` pathspecs; branch names pass
 *    {@link validateRef} first.
 * 2. **Every path stays inside the workspace directory.** Git reports paths
 *    relative to the *repository* root, which can sit above the workspace, so
 *    each reported path is re-expressed against the workspace and dropped when
 *    it lands outside. A caller path that escapes is a {@link PathError}, not a
 *    defect.
 *
 * A non-zero git exit code is an outcome, not a bug: it becomes
 * {@link CommandError} with the code and stderr, except for "not a git
 * repository", which is its own {@link NotARepositoryError} so a client can
 * show "no version control here" instead of an error toast.
 *
 * Checkpoints are whole-workspace snapshots stored as hidden parentless
 * commits under `refs/honk/checkpoints/`. Capture stages the workspace
 * subtree — untracked files included, ignore rules honored — into a scratch
 * index and writes a commit from it, so the user's index, `HEAD`, and
 * branches are never touched and no snapshot appears in any log. Diffing two
 * checkpoints is what gives a thread its per-turn changes; restoring one
 * rewrites the working tree to that snapshot. The git object store is the
 * only storage: unchanged files share objects between snapshots, and the ref
 * name is the entire bookkeeping.
 *
 * @example
 * ```ts
 * const { files } = await sdk.git.status({ workspaceId });
 * for (const file of files) {
 *   const diff = await sdk.git.filePatch({ workspaceId, path: file.file });
 *   render(diff.patch);
 * }
 * ```
 *
 * @see spec/honk-built-ins.md section 5 for the method list, and spec/core.md
 * section 13 — "Git must resolve paths inside the session workspace".
 * @module
 */

import { Context, Effect, Layer, Option, Path, Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

import type { Method } from "./util/rpc";
import { Workspace } from "./workspace";

/**
 * Which comparison a read is asking for.
 *
 * `git` is the working tree against `HEAD` — "what is uncommitted right now".
 * `branch` is the working tree against the merge base with the default branch —
 * "what does this branch add". The names match the modes Honk's existing
 * changes surface already sends, so a client keeps one vocabulary.
 *
 * @category schemas
 */
export const DiffMode = Schema.Literals(["git", "branch"]).annotate({ identifier: "GitDiffMode" });
export type DiffMode = typeof DiffMode.Type;

/**
 * What happened to one path between the base and the working tree.
 *
 * Rename detection is off (`--no-renames`), so a moved file appears as a delete
 * and an add. That is a deliberate simplification: a rename is a similarity
 * heuristic, and two honest rows beat one guessed one.
 *
 * @category schemas
 */
export const ChangeStatus = Schema.Literals(["added", "modified", "deleted"]).annotate({
  identifier: "GitChangeStatus",
});
export type ChangeStatus = typeof ChangeStatus.Type;

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
 * the wire is a typed {@link RefError} a client can show as product copy, not
 * a schema decode failure it has to translate.
 */
const RefName = Schema.NonEmptyString.pipe(
  Schema.check(Schema.isPattern(REF_NAME), Schema.isMaxLength(255), refNameRules),
  Schema.brand("GitRefName"),
);
type RefName = typeof RefName.Type;

/**
 * One changed path, as {@link Status} reports it.
 *
 * `file` is always **workspace-relative** even when the repository root sits
 * above the workspace directory, so a client never receives a path it cannot
 * hand back to {@link FilePatch} or `sdk.files`.
 *
 * `tracked` separates "git knows this file" from "this file is new on disk".
 * Both show as `added` because that is what a reviewer sees, but only the first
 * can be restored from a commit — which is why {@link Discard} needs the flag.
 *
 * `binary` marks a file git will not count lines for; its `additions` and
 * `deletions` are zero because git has no answer, not because nothing changed.
 *
 * @category schemas
 */
export const FileChange = Schema.Struct({
  file: Schema.NonEmptyString,
  status: ChangeStatus,
  tracked: Schema.Boolean,
  binary: Schema.Boolean,
  additions: Schema.Int,
  deletions: Schema.Int,
}).annotate({ identifier: "GitFileChange" });
export type FileChange = typeof FileChange.Type;

/**
 * One changed path with its patch text.
 *
 * `status` and `patch` are optional because {@link FilePatch} answers for any
 * path a client asks about, including one with no changes: that file is real,
 * it is tracked, and it has nothing to show. Encoding that as an absent
 * `status` rather than a fourth status literal keeps "unchanged" from leaking
 * into every list rendering.
 *
 * @category schemas
 */
export const FileDiff = Schema.Struct({
  file: Schema.NonEmptyString,
  status: Schema.optionalKey(ChangeStatus),
  tracked: Schema.Boolean,
  binary: Schema.Boolean,
  additions: Schema.Int,
  deletions: Schema.Int,
  patch: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "GitFileDiff" });
export type FileDiff = typeof FileDiff.Type;

/**
 * The working tree at a glance.
 *
 * `branch` is `null` on a detached HEAD, and `defaultBranch` is `null` when the
 * repository has no `origin/HEAD` and neither `main` nor `master`. Both are
 * genuinely absent states rather than failures, so they travel as values.
 *
 * @category schemas
 */
export const StatusOutput = Schema.Struct({
  branch: Schema.NullOr(Schema.NonEmptyString),
  defaultBranch: Schema.NullOr(Schema.NonEmptyString),
  files: Schema.Array(FileChange),
}).annotate({ identifier: "GitStatusOutput" });
export type StatusOutput = typeof StatusOutput.Type;

/**
 * One ref a client may check out or compare against.
 *
 * @category schemas
 */
export const Branch = Schema.Struct({
  name: Schema.NonEmptyString,
  remote: Schema.Boolean,
  current: Schema.Boolean,
  upstream: Schema.optionalKey(Schema.NonEmptyString),
}).annotate({ identifier: "GitBranch" });
export type Branch = typeof Branch.Type;

/**
 * @category schemas
 */
export const BranchesOutput = Schema.Struct({
  current: Schema.NullOr(Schema.NonEmptyString),
  defaultBranch: Schema.NullOr(Schema.NonEmptyString),
  branches: Schema.Array(Branch),
}).annotate({ identifier: "GitBranchesOutput" });
export type BranchesOutput = typeof BranchesOutput.Type;

/**
 * Which side of a comparison {@link FileImage} should read.
 *
 * A visual diff needs both: `head` is the committed image, `working_tree` is
 * the one on disk now.
 *
 * @category schemas
 */
export const ImageRef = Schema.Literals(["working_tree", "head"]).annotate({
  identifier: "GitImageRef",
});
export type ImageRef = typeof ImageRef.Type;

/** The image exists at the requested ref, base64-encoded for transport. */
const ImagePresent = Schema.Struct({
  type: Schema.tag("image"),
  file: Schema.NonEmptyString,
  ref: ImageRef,
  mediaType: Schema.NonEmptyString,
  base64: Schema.String,
});

/** The path has no content at that ref — a file added or deleted in this diff. */
const ImageAbsent = Schema.Struct({
  type: Schema.tag("absent"),
  file: Schema.NonEmptyString,
  ref: ImageRef,
});

/**
 * What {@link FileImage} answers.
 *
 * A newly added image has no `head` side and a deleted one has no
 * `working_tree` side. Both are the normal halves of a visual diff, so the
 * absent case travels on the success channel and a caller handles it in the
 * same `switch` as the present one.
 *
 * The tagged-union utilities (`guards`, `cases`, `match`) come from
 * `Schema.toTaggedUnion`. Annotate *before* piping: `annotate` rebuilds the
 * union, which would drop those attached utilities.
 *
 * @category schemas
 */
export const ImageResult = Schema.Union([ImagePresent, ImageAbsent])
  .annotate({ identifier: "GitImageResult" })
  .pipe(Schema.toTaggedUnion("type"));
export type ImageResult = typeof ImageResult.Type;

/**
 * Where {@link FileContent} should read from.
 *
 * `working_tree` is the file on disk now, `head` is the committed version, and
 * `checkpoint` is the version a turn's snapshot holds. The three sides are what
 * a client needs to hydrate a partial diff into full contents — expand-context
 * on a rendered patch — and to show any file as it was at any turn.
 *
 * A plain input union, not piped through `Schema.toTaggedUnion`: clients
 * construct these values, they do not match on them.
 *
 * @category schemas
 */
export const ContentSource = Schema.Union([
  Schema.Struct({ type: Schema.tag("working_tree") }),
  Schema.Struct({ type: Schema.tag("head") }),
  Schema.Struct({ type: Schema.tag("checkpoint"), checkpoint: Schema.NonEmptyString }),
]).annotate({ identifier: "GitContentSource" });
export type ContentSource = typeof ContentSource.Type;

/** The file exists at the requested source and git can treat it as text. */
const ContentPresent = Schema.Struct({
  type: Schema.tag("content"),
  file: Schema.NonEmptyString,
  at: ContentSource,
  text: Schema.String,
});

/** The file exists at the requested source, but it is not text. */
const ContentBinary = Schema.Struct({
  type: Schema.tag("binary"),
  file: Schema.NonEmptyString,
  at: ContentSource,
});

/** The path has no content at that source — a file added or deleted since it. */
const ContentAbsent = Schema.Struct({
  type: Schema.tag("absent"),
  file: Schema.NonEmptyString,
  at: ContentSource,
});

/**
 * What {@link FileContent} answers.
 *
 * Absence and binary content are the normal states of a diff's sides — a file
 * added this turn has no checkpoint side, and an image has no text — so both
 * travel on the success channel and a caller handles all three in one
 * `switch`. Binary content is deliberately not inlined here: bytes are
 * {@link FileImage}'s answer, and an empty-string stand-in would read as "empty
 * file", which is a different truth.
 *
 * The tagged-union utilities (`guards`, `cases`, `match`) come from
 * `Schema.toTaggedUnion`. Annotate *before* piping: `annotate` rebuilds the
 * union, which would drop those attached utilities.
 *
 * @category schemas
 */
export const ContentResult = Schema.Union([ContentPresent, ContentBinary, ContentAbsent])
  .annotate({ identifier: "GitContentResult" })
  .pipe(Schema.toTaggedUnion("type"));
export type ContentResult = typeof ContentResult.Type;

/**
 * What {@link Discard} actually threw away, and what it refused to.
 *
 * `skipped` holds the untracked paths. Discarding a tracked change restores a
 * version git still has; "discarding" an untracked file would delete the only
 * copy, which is a different act with a different blast radius. Deleting a file
 * is `sdk.files.delete`, where the client has to say so.
 *
 * @category schemas
 */
export const DiscardOutput = Schema.Struct({
  discarded: Schema.Array(Schema.NonEmptyString),
  skipped: Schema.Array(Schema.NonEmptyString),
}).annotate({ identifier: "GitDiscardOutput" });
export type DiscardOutput = typeof DiscardOutput.Type;

/**
 * The checkpoint names under a prefix, in ref order.
 *
 * Ref order is lexical, not temporal. A checkpoint name is the caller's
 * convention — the session layer names snapshots by entry id and orders them
 * by its own transcript — so this module reports what exists and does not
 * guess at a timeline.
 *
 * @category schemas
 */
export const CheckpointsOutput = Schema.Struct({
  checkpoints: Schema.Array(Schema.NonEmptyString),
}).annotate({ identifier: "GitCheckpointsOutput" });
export type CheckpointsOutput = typeof CheckpointsOutput.Type;

/**
 * What {@link RestoreFiles} put back and what it removed.
 *
 * `restored` paths now hold the checkpoint's version. `removed` paths did not
 * exist at that checkpoint, so restoring them means deleting today's file —
 * reported separately because it is the half a user will want to see named.
 *
 * @category schemas
 */
export const RestoreFilesOutput = Schema.Struct({
  restored: Schema.Array(Schema.NonEmptyString),
  removed: Schema.Array(Schema.NonEmptyString),
}).annotate({ identifier: "GitRestoreFilesOutput" });
export type RestoreFilesOutput = typeof RestoreFilesOutput.Type;

/**
 * The workspace directory is not inside a git repository.
 *
 * Its own state rather than a generic command failure: a client shows a
 * "version control unavailable" surface, not an error. Every method resolves
 * the repository root first, so this answer arrives before any other work.
 *
 * @category errors
 */
export class NotARepositoryError extends Schema.TaggedErrorClass<NotARepositoryError>()(
  "GitNotARepositoryError",
  {
    code: Schema.tag("git.not_a_repository"),
    message: Schema.tag("This workspace is not inside a git repository."),
    directory: Schema.NonEmptyString,
  },
) {}

/**
 * A caller path does not resolve inside the workspace directory.
 *
 * Refusing is the invariant, so it is typed: `../../etc/passwd` is a request
 * Honk answers with "no", not a crash and not a silent clamp to something
 * nearby.
 *
 * @category errors
 */
export class PathError extends Schema.TaggedErrorClass<PathError>()("GitPathError", {
  code: Schema.tag("git.path_outside_workspace"),
  message: Schema.tag("This path is outside the workspace."),
  path: Schema.String,
}) {}

/**
 * A caller-supplied name — a branch or a checkpoint — is not one Honk will
 * hand to git.
 *
 * {@link validateRef} allows a deliberately narrow shape. A refused name is
 * usually a typo and occasionally an injection attempt; both get the same
 * answer, and neither reaches a command line.
 *
 * @category errors
 */
export class RefError extends Schema.TaggedErrorClass<RefError>()("GitRefError", {
  code: Schema.tag("git.invalid_ref"),
  message: Schema.tag("This is not a valid git reference name."),
  ref: Schema.String,
}) {}

/**
 * No checkpoint was captured under this name.
 *
 * Absence is meaningful to a caller: a session created before its first
 * snapshot simply has nothing to compare, and the honest answer is this typed
 * refusal, not a failed command.
 *
 * @category errors
 */
export class CheckpointNotFoundError extends Schema.TaggedErrorClass<CheckpointNotFoundError>()(
  "GitCheckpointNotFoundError",
  {
    code: Schema.tag("git.checkpoint_not_found"),
    message: Schema.tag("Honk has no checkpoint with this name."),
    checkpoint: Schema.NonEmptyString,
  },
) {}

/**
 * A branch-relative comparison has nothing to compare against.
 *
 * Either no default branch could be identified, or it shares no history with
 * `HEAD`. Distinct from {@link CommandError} because the honest client response
 * is to fall back to the working-tree comparison, not to report a failure.
 *
 * @category errors
 */
export class BaseBranchError extends Schema.TaggedErrorClass<BaseBranchError>()(
  "GitBaseBranchError",
  {
    code: Schema.tag("git.base_branch_unknown"),
    message: Schema.tag("Honk could not determine a base branch to compare against."),
  },
) {}

/**
 * Git ran and refused.
 *
 * A non-zero exit is an expected outcome — a checkout blocked by local changes,
 * a pull with no upstream — so it carries git's own `exitCode` and `stderr`
 * rather than a Honk paraphrase. `command` is the code-owned subcommand name,
 * never the assembled command line, so an error message cannot echo caller
 * input back out.
 *
 * @category errors
 */
export class CommandError extends Schema.TaggedErrorClass<CommandError>()("GitCommandError", {
  code: Schema.tag("git.command_failed"),
  message: Schema.tag("A git command failed."),
  command: Schema.NonEmptyString,
  exitCode: Schema.Int,
  stderr: Schema.String,
}) {}

/**
 * Git never ran: the shell was unavailable, the spawn failed, or the call was
 * aborted or timed out.
 *
 * `reason` carries Pi's `ExecutionError` code verbatim as a string. It is not
 * mirrored as a Honk literal union, because a Pi pin bump that adds a code must
 * not turn into a decode failure at this boundary.
 *
 * @category errors
 */
export class ExecError extends Schema.TaggedErrorClass<ExecError>()("GitExecError", {
  code: Schema.tag("git.execution_failed"),
  message: Schema.tag("Honk could not run git in this workspace."),
  command: Schema.NonEmptyString,
  reason: Schema.NonEmptyString,
  detail: Schema.String,
}) {}

/**
 * Every expected failure this domain owns.
 *
 * `Workspace.NotFoundError` is in the union because git is scoped to a trusted
 * workspace: an unknown id fails on the trust gate before any command is built.
 *
 * Code branches on `error.code`, never on `error.message`. Switching on the
 * code narrows the payload type with it.
 *
 * @category errors
 */
export type Error =
  | NotARepositoryError
  | PathError
  | RefError
  | CheckpointNotFoundError
  | BaseBranchError
  | CommandError
  | ExecError
  | Workspace.NotFoundError;

/**
 * The wire form of {@link Error}, shared by every RPC in this module.
 *
 * One union for every command, rather than a hand-narrowed set per command:
 * the set a caller must handle is the same either way once the workspace
 * lookup and the repository probe are in it, and a single union keeps a
 * client's error handling from fragmenting per method. Exported because
 * session commands that delegate to git — revert restores a checkpoint —
 * carry the same failures.
 *
 * @category errors
 */
export const Failure = Schema.Union([
  NotARepositoryError,
  PathError,
  RefError,
  CheckpointNotFoundError,
  BaseBranchError,
  CommandError,
  ExecError,
  Workspace.NotFoundError,
]);

/**
 * What changed in the working tree.
 *
 * A live observation, never transcript data: two sessions open on one directory
 * see each other's edits here. "What did *this* conversation change" is
 * `sdk.session.changes`, and where the two disagree this one is authoritative
 * about the working tree.
 *
 * Rpc definitions are plain consts. Only the {@link Rpcs} group below uses
 * class-extends, so handlers and clients can reference one nominal group type.
 *
 * @category commands
 */
export const Status = Rpc.make("git.status", {
  payload: { workspaceId: Workspace.WorkspaceId, mode: Schema.optionalKey(DiffMode) },
  success: StatusOutput,
  error: Failure,
});

/**
 * Every changed path with its patch.
 *
 * One patch per file, produced by a separate `git diff` per path rather than by
 * splitting one combined patch on its `diff --git` headers. Splitting is a
 * parser that has to guess where a filename ends; asking git per path cannot be
 * wrong. The calls run at bounded concurrency, so the cost is a wider fan-out,
 * not a longer wall clock.
 *
 * @category commands
 */
export const Diff = Rpc.make("git.diff", {
  payload: {
    workspaceId: Workspace.WorkspaceId,
    mode: Schema.optionalKey(DiffMode),
    context: Schema.optionalKey(Schema.Int),
  },
  success: Schema.Array(FileDiff),
  error: Failure,
});

/**
 * The patch for exactly one path.
 *
 * A review surface intersects this with `sdk.session.changes`: that call
 * answers *which* paths a thread touched, this one answers *what* changed in
 * one of them.
 *
 * @category commands
 */
export const FilePatch = Rpc.make("git.file_patch", {
  payload: {
    workspaceId: Workspace.WorkspaceId,
    path: Schema.NonEmptyString,
    mode: Schema.optionalKey(DiffMode),
    context: Schema.optionalKey(Schema.Int),
  },
  success: FileDiff,
  error: Failure,
});

/**
 * One side of an image diff, base64-encoded.
 *
 * Images have no textual patch, so a client that renders a diff needs the bytes
 * of both sides. Binary content cannot survive a shell's stdout as text, so the
 * bytes are base64-encoded before they leave the process.
 *
 * @category commands
 */
export const FileImage = Rpc.make("git.file_image", {
  payload: {
    workspaceId: Workspace.WorkspaceId,
    path: Schema.NonEmptyString,
    ref: Schema.optionalKey(ImageRef),
  },
  success: ImageResult,
  error: Failure,
});

/**
 * One file's text at one source: the working tree, `HEAD`, or a checkpoint.
 *
 * The read that makes a rendered patch expandable. A patch ships with limited
 * context; when a client wants the full file around a hunk — Pierre-style
 * hydration — it asks for both sides here instead of requesting ever-larger
 * context windows. It is also "show me this file as it was at turn N", which
 * is how a transcript surface lets a user walk backward when something broke.
 *
 * @category commands
 */
export const FileContent = Rpc.make("git.file_content", {
  payload: {
    workspaceId: Workspace.WorkspaceId,
    path: Schema.NonEmptyString,
    at: Schema.optionalKey(ContentSource),
  },
  success: ContentResult,
  error: Failure,
});

/**
 * Local and remote-tracking branches, plus which one is checked out.
 *
 * @category commands
 */
export const Branches = Rpc.make("git.branches", {
  payload: { workspaceId: Workspace.WorkspaceId },
  success: BranchesOutput,
  error: Failure,
});

/**
 * Switches the working tree to a branch, optionally creating it.
 *
 * Implemented with `git switch` rather than `git checkout`: `switch` only ever
 * takes a branch, so a name can never be reinterpreted as a pathspec. The name
 * passes {@link validateRef} before that, so it also cannot be read as a flag.
 *
 * Success stays `void`. The new state is read back through {@link Status} and
 * {@link Branches}, so there is no second path to the same values that could
 * disagree with them.
 *
 * @category commands
 */
export const Checkout = Rpc.make("git.checkout", {
  payload: {
    workspaceId: Workspace.WorkspaceId,
    branch: Schema.NonEmptyString,
    create: Schema.optionalKey(Schema.Boolean),
  },
  error: Failure,
});

/**
 * Fast-forwards the current branch from its upstream.
 *
 * `--ff-only` on purpose: a pull that can only fast-forward either succeeds
 * cleanly or refuses, and never leaves a workspace mid-merge with conflict
 * markers an agent will then read as source. A divergent branch is a
 * {@link CommandError} carrying git's own explanation.
 *
 * @category commands
 */
export const Pull = Rpc.make("git.pull", {
  payload: { workspaceId: Workspace.WorkspaceId },
  error: Failure,
});

/**
 * Throws away local changes to the named paths.
 *
 * The only destructive command here, so its scope is stated rather than
 * implied: it names paths, never a directory and never the whole tree, and it
 * restores each one from `HEAD`. There is no bare `git checkout .` behind it —
 * a caller that wants everything must enumerate everything, and gets back a
 * list of what was actually discarded.
 *
 * Untracked paths are reported in `skipped` and left alone. See
 * {@link DiscardOutput}.
 *
 * @category commands
 */
export const Discard = Rpc.make("git.discard", {
  payload: {
    workspaceId: Workspace.WorkspaceId,
    paths: Schema.NonEmptyArray(Schema.NonEmptyString),
  },
  success: DiscardOutput,
  error: Failure,
});

/**
 * Snapshots the workspace as a checkpoint.
 *
 * The snapshot is the whole workspace subtree as it is on disk — untracked
 * files included, ignore rules honored — written as a hidden parentless
 * commit. The user's index, `HEAD`, branches, and log never change, which is
 * what lets a session capture on every settled turn without the user ever
 * seeing git move.
 *
 * The name is the caller's convention; the session layer uses
 * `<sessionId>/<entryId>`. Capturing an existing name moves that ref to the
 * new snapshot, so re-settling a turn re-captures it rather than erroring.
 *
 * @category commands
 */
export const CaptureCheckpoint = Rpc.make("git.capture_checkpoint", {
  payload: {
    workspaceId: Workspace.WorkspaceId,
    checkpoint: Schema.NonEmptyString,
  },
  error: Failure,
});

/**
 * Lists captured checkpoint names, optionally under a prefix.
 *
 * `prefix` narrows by whole name segments — `"abc"` matches `abc/turn-1` but
 * not `abcdef/turn-1` — which is how the session layer asks for one session's
 * snapshots.
 *
 * @category commands
 */
export const Checkpoints = Rpc.make("git.checkpoints", {
  payload: {
    workspaceId: Workspace.WorkspaceId,
    prefix: Schema.optionalKey(Schema.NonEmptyString),
  },
  success: CheckpointsOutput,
  error: Failure,
});

/**
 * Every path that differs between two checkpoints, with counts but no
 * patches.
 *
 * This is the per-turn changes read: diff a turn's checkpoint against the one
 * before it and the answer is what that turn — and only that turn — did to
 * the workspace, bash writes and all. `tracked` is always true here, because
 * everything a snapshot holds was captured; the tracked/untracked distinction
 * belongs to working-tree reads.
 *
 * @category commands
 */
export const CheckpointChanges = Rpc.make("git.checkpoint_changes", {
  payload: {
    workspaceId: Workspace.WorkspaceId,
    from: Schema.NonEmptyString,
    to: Schema.NonEmptyString,
  },
  success: Schema.Array(FileChange),
  error: Failure,
});

/**
 * The patches between two checkpoints, for every changed path or one of them.
 *
 * {@link CheckpointChanges} answers *which* paths a turn touched;
 * this answers *what* changed in them, one `git diff` per file at bounded
 * concurrency — the same shape {@link Diff} uses against the working tree, so
 * a review surface renders both with one component.
 *
 * @category commands
 */
export const CheckpointDiff = Rpc.make("git.checkpoint_diff", {
  payload: {
    workspaceId: Workspace.WorkspaceId,
    from: Schema.NonEmptyString,
    to: Schema.NonEmptyString,
    path: Schema.optionalKey(Schema.NonEmptyString),
    context: Schema.optionalKey(Schema.Int),
  },
  success: Schema.Array(FileDiff),
  error: Failure,
});

/**
 * Rewrites the working tree to a checkpoint.
 *
 * Destructive by design and scoped to the workspace subtree: tracked files
 * return to their snapshot content, files created since the snapshot are
 * removed, and ignored files are left alone. A caller that wants an undo —
 * the session layer's revert does — captures a fresh checkpoint first, which
 * makes restore itself restorable.
 *
 * @category commands
 */
export const RestoreCheckpoint = Rpc.make("git.restore_checkpoint", {
  payload: {
    workspaceId: Workspace.WorkspaceId,
    checkpoint: Schema.NonEmptyString,
  },
  error: Failure,
});

/**
 * Restores the named paths to their checkpoint versions, leaving every other
 * path alone.
 *
 * The finer-grained sibling of {@link RestoreCheckpoint}, and the one a
 * "this file broke — take it back to turn N" affordance needs: whole-tree
 * restore throws away every innocent change made since the snapshot, while
 * this touches exactly the paths the caller names. OpenCode's revert works
 * per file for the same reason.
 *
 * Like {@link Discard}, it names paths, never a directory and never the whole
 * tree. A path the checkpoint does not hold is *removed* — the file did not
 * exist at that turn, and leaving it would make the restore a lie — and the
 * split is reported in {@link RestoreFilesOutput}.
 *
 * @category commands
 */
export const RestoreFiles = Rpc.make("git.restore_files", {
  payload: {
    workspaceId: Workspace.WorkspaceId,
    checkpoint: Schema.NonEmptyString,
    paths: Schema.NonEmptyArray(Schema.NonEmptyString),
  },
  success: RestoreFilesOutput,
  error: Failure,
});

/**
 * Removes every checkpoint ref under a prefix.
 *
 * The cleanup half of the checkpoint lifecycle: when a session's transcript
 * is deleted, its snapshots are worthless — refs pointing at turns nobody can
 * name — so the session layer prunes them here. The commits themselves become
 * unreferenced objects for git's own garbage collection; nothing is rewritten
 * and no other ref is touched.
 *
 * Deleting a prefix with no refs succeeds: the caller wanted them gone, and
 * they are.
 *
 * @category commands
 */
export const DeleteCheckpoints = Rpc.make("git.delete_checkpoints", {
  payload: {
    workspaceId: Workspace.WorkspaceId,
    prefix: Schema.NonEmptyString,
  },
  error: Failure,
});

/**
 * The git command catalog.
 *
 * @category commands
 */
export class Rpcs extends RpcGroup.make(
  Status,
  Diff,
  FilePatch,
  FileImage,
  FileContent,
  Branches,
  Checkout,
  Pull,
  Discard,
  CaptureCheckpoint,
  Checkpoints,
  CheckpointChanges,
  CheckpointDiff,
  RestoreCheckpoint,
  RestoreFiles,
  DeleteCheckpoints,
) {}

/**
 * The git service as in-process callers use it.
 *
 * Every method type derives from its {@link Rpc} through {@link Method}, so the
 * service cannot drift from the wire contract.
 *
 * @category service
 */
export interface Interface {
  readonly status: Method<typeof Status>;
  readonly diff: Method<typeof Diff>;
  readonly filePatch: Method<typeof FilePatch>;
  readonly fileImage: Method<typeof FileImage>;
  readonly fileContent: Method<typeof FileContent>;
  readonly branches: Method<typeof Branches>;
  readonly checkout: Method<typeof Checkout>;
  readonly pull: Method<typeof Pull>;
  readonly discard: Method<typeof Discard>;
  readonly captureCheckpoint: Method<typeof CaptureCheckpoint>;
  readonly checkpoints: Method<typeof Checkpoints>;
  readonly checkpointChanges: Method<typeof CheckpointChanges>;
  readonly checkpointDiff: Method<typeof CheckpointDiff>;
  readonly restoreCheckpoint: Method<typeof RestoreCheckpoint>;
  readonly restoreFiles: Method<typeof RestoreFiles>;
  readonly deleteCheckpoints: Method<typeof DeleteCheckpoints>;
}

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
 * only bind payloads to service methods. Provide {@link layer} to satisfy the
 * `Service` requirement.
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
 * Git's empty tree object: the base a first commit is diffed against.
 *
 * A repository with no commits has no `HEAD`, and diffing against a ref that
 * does not exist fails. This hash is stable across every git installation and
 * means "nothing", which is exactly the right base before the first commit.
 */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/** Git's default patch context, used when a caller does not ask for one. */
const DEFAULT_CONTEXT_LINES = 3;

/** Upper bound on requested patch context, so one call cannot ask for a novel. */
const MAX_CONTEXT_LINES = 100;

/** How many per-file git commands run at once during a whole-tree diff. */
const FILE_CONCURRENCY = 8;

/** The one stderr shape that means "there is no repository here", not "git failed". */
const NOT_A_REPOSITORY = /not a git repository/i;

/** TAB-separated because a git ref may contain neither a tab nor a newline. */
const REF_FORMAT = "%(refname)\t%(HEAD)\t%(upstream:short)";

/** Extensions a client can render as an image, mapped to their media type. */
const IMAGE_MEDIA_TYPES: Readonly<Record<string, string>> = {
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  ico: "image/x-icon",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
};

/** One workspace's repository, resolved once per call. */
interface Repository {
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
interface Run {
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
function quoteArgument(argument: string): string {
  return `'${argument.replaceAll("'", "'\\''")}'`;
}

/** Renders an argv array as a command line no caller value can break out of. */
function shellCommand(argv: readonly string[]): string {
  return argv.map(quoteArgument).join(" ");
}

/**
 * Marks a path as a literal pathspec.
 *
 * Quoting stops the *shell* from reinterpreting a path; this stops *git* from
 * doing it. Without the prefix, a file named `:(exclude)notes.md` would be read
 * as pathspec magic rather than as a filename, which for {@link Discard} would
 * mean touching a different set of files than the caller named.
 */
function pathspec(relative: string): string {
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
const runShell = Effect.fnUntraced(function* (
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
const runGit = Effect.fnUntraced(function* (
  repo: Repository,
  command: string,
  argv: readonly string[],
  allowExitCodes: readonly number[] = [],
  env?: Readonly<Record<string, string>>,
) {
  return yield* runShell(repo, command, shellCommand(["git", ...argv]), allowExitCodes, env);
});

/** Where checkpoint refs live: outside `refs/heads` and `refs/remotes`, so no log, branch list, or push ever sees one. */
const CHECKPOINT_REF_ROOT = "refs/honk/checkpoints";

/** The identity checkpoint commits are written under — never the user's, so a snapshot cannot impersonate them. */
const CHECKPOINT_IDENTITY: Readonly<Record<string, string>> = {
  GIT_AUTHOR_NAME: "Honk",
  GIT_AUTHOR_EMAIL: "checkpoints@honk.invalid",
  GIT_COMMITTER_NAME: "Honk",
  GIT_COMMITTER_EMAIL: "checkpoints@honk.invalid",
};

/**
 * Turns a caller's checkpoint name into a full ref, or refuses it.
 *
 * The name passes {@link validateRef}, so it cannot climb out of
 * {@link CHECKPOINT_REF_ROOT} with `..`, start with a dash, or smuggle
 * revision syntax — a checkpoint can name only a checkpoint.
 */
function checkpointRefOf(name: string): string | undefined {
  const validated = validateRef(name);
  return validated === undefined ? undefined : `${CHECKPOINT_REF_ROOT}/${validated}`;
}

/** Resolves a checkpoint name to its commit, or reports it missing. */
const resolveCheckpoint = Effect.fnUntraced(function* (repo: Repository, name: string) {
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
const openRepository = Effect.fnUntraced(function* (path: Path.Path, env: Workspace.ExecutionEnv) {
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
const resolveCallerPath = Effect.fnUntraced(function* (repo: Repository, input: string) {
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
function workspacePathOf(repo: Repository, gitPath: string): string | undefined {
  if (!gitPath.startsWith(repo.prefix)) return undefined;
  const relative = gitPath.slice(repo.prefix.length);
  return relative.length === 0 ? undefined : relative;
}

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

/** Stable listing order for change sets: by path, on code units. */
function byFile(left: FileChange, right: FileChange): number {
  return left.file < right.file ? -1 : 1;
}

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
 * those through {@link FileImage} or not at all.
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

/** Base64 arrives line-wrapped on some platforms and not others. */
function stripWhitespace(value: string): string {
  return value.replaceAll(/\s+/g, "");
}

/** Maps a file extension to a media type, defaulting to opaque bytes. */
function mediaTypeOf(file: string): string {
  const dot = file.lastIndexOf(".");
  if (dot === -1) return "application/octet-stream";
  return IMAGE_MEDIA_TYPES[file.slice(dot + 1).toLowerCase()] ?? "application/octet-stream";
}

/** Keeps a requested patch context inside a range git and a client can both hold. */
function clampContext(requested: number | undefined): number {
  if (requested === undefined) return DEFAULT_CONTEXT_LINES;
  return Math.min(Math.max(Math.trunc(requested), 0), MAX_CONTEXT_LINES);
}

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
function validateRef(input: string): RefName | undefined {
  return Option.getOrUndefined(decodeRefName(input));
}

/** Splits NUL-delimited git output, dropping the trailing empty record. */
function splitNul(output: string): readonly string[] {
  return output.split("\0").filter((record) => record.length > 0);
}

/** One `--numstat` row: additions, deletions, and whether git called it binary. */
interface Count {
  readonly additions: number;
  readonly deletions: number;
  readonly binary: boolean;
}

const NO_COUNT: Count = { additions: 0, deletions: 0, binary: false };

/**
 * Indexes `--numstat -z` output by the path git reported.
 *
 * A record is `additions TAB deletions TAB path`. The path is joined back from
 * the remaining fields rather than taken as the third, because a filename may
 * contain a tab even though it may not contain a NUL.
 */
function parseNumstat(output: string): ReadonlyMap<string, Count> {
  const counts = new Map<string, Count>();
  for (const record of splitNul(output)) {
    const fields = record.split("\t");
    const additions = fields[0];
    const deletions = fields[1];
    if (additions === undefined || deletions === undefined || fields.length < 3) continue;
    const file = fields.slice(2).join("\t");
    if (file.length === 0) continue;
    counts.set(file, toCount(additions, deletions));
  }
  return counts;
}

/** Reads the counts from the first `--numstat` record and ignores its path. */
function firstNumstat(output: string): Count {
  const record = splitNul(output)[0];
  if (record === undefined) return NO_COUNT;
  const fields = record.split("\t");
  const additions = fields[0];
  const deletions = fields[1];
  if (additions === undefined || deletions === undefined) return NO_COUNT;
  return toCount(additions, deletions);
}

/** Git writes `-` for a file it will not count, which is how binaries appear. */
function toCount(additions: string, deletions: string): Count {
  if (additions === "-" || deletions === "-") return { ...NO_COUNT, binary: true };
  return {
    additions: toInteger(additions),
    deletions: toInteger(deletions),
    binary: false,
  };
}

function toInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Reads `--name-status -z` output, whose records alternate status then path.
 *
 * `--no-renames` is what makes the pairing safe: a rename record carries two
 * paths, and this shape has none.
 */
function parseNameStatus(output: string): readonly { file: string; status: ChangeStatus }[] {
  const records = splitNul(output);
  const entries: { file: string; status: ChangeStatus }[] = [];
  for (let index = 0; index + 1 < records.length; index += 2) {
    const code = records[index];
    const file = records[index + 1];
    if (code === undefined || file === undefined) continue;
    entries.push({ file, status: changeStatusOf(code) });
  }
  return entries;
}

/**
 * Maps a git status letter onto Honk's three outcomes.
 *
 * `T` (type change) and `U` (unmerged) fold into `modified`: the path exists on
 * both sides and differs, which is what a reviewer needs to know.
 */
function changeStatusOf(code: string): ChangeStatus {
  const letter = code.charAt(0);
  if (letter === "A") return "added";
  if (letter === "D") return "deleted";
  return "modified";
}

/**
 * Picks the untracked paths out of `status --porcelain=v1 -z`.
 *
 * Each record is two status characters, a space, then the path. `??` is git's
 * code for a path it has never seen.
 */
function parseUntracked(output: string): readonly string[] {
  const files: string[] = [];
  for (const record of splitNul(output)) {
    if (!record.startsWith("?? ")) continue;
    const file = record.slice(3);
    if (file.length > 0) files.push(file);
  }
  return files;
}

/**
 * Reads `for-each-ref` output in {@link REF_FORMAT}.
 *
 * `origin/HEAD` is skipped: it is a symbolic pointer at another branch in the
 * list, not a branch a client can check out.
 */
function parseRefs(output: string): readonly Branch[] {
  const branches: Branch[] = [];
  for (const line of output.split("\n")) {
    if (line.length === 0) continue;
    const fields = line.split("\t");
    const refname = fields[0];
    if (refname === undefined) continue;
    const remote = refname.startsWith("refs/remotes/");
    const name = remote
      ? refname.slice("refs/remotes/".length)
      : refname.slice("refs/heads/".length);
    if (name.length === 0 || name === "HEAD" || name.endsWith("/HEAD")) continue;
    const upstream = fields[2]?.trim() ?? "";
    branches.push({
      name,
      remote,
      current: fields[1] === "*",
      ...(upstream.length > 0 ? { upstream } : {}),
    });
  }
  return branches;
}

// Extensionless on purpose: consumers bundle this source (desktop keeps
// @honk/core in devDependencies so electron-vite bundles it), and consumer
// tsconfigs do not enable allowImportingTsExtensions.
// oxlint-disable-next-line import/no-self-import -- spec/effect.md self-reexport pattern; star imports are banned for consumers.
export * as Git from "./git";
