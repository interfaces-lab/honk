/**
 * The git wire contract: schemas, typed errors, and the command catalog.
 *
 * Everything a client or handler needs to *name* a git operation lives here;
 * how a command actually runs lives in `./service`. See `./index` for the
 * module-level story.
 *
 * @module
 */

import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

import type { ServiceOf } from "../util/rpc";
import { Workspace } from "../workspace";

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
 * `validateRef` allows a deliberately narrow shape. A refused name is
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
 * The wire form of every expected failure this domain owns, shared by every
 * RPC in this module.
 *
 * One union for every command, rather than a hand-narrowed set per command:
 * the set a caller must handle is the same either way once the workspace
 * lookup and the repository probe are in it, and a single union keeps a
 * client's error handling from fragmenting per method. Exported because
 * session commands that delegate to git — revert restores a checkpoint —
 * carry the same failures.
 *
 * `Workspace.NotFoundError` is in the union because git is scoped to a trusted
 * workspace: an unknown id fails on the trust gate before any command is built.
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
 * Every expected failure this domain owns, derived from {@link Failure} so the
 * type and the wire schema cannot list different members.
 *
 * Code branches on `error.code`, never on `error.message`. Switching on the
 * code narrows the payload type with it.
 *
 * @category errors
 */
export type Error = typeof Failure.Type;

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
 * passes `validateRef` before that, so it also cannot be read as a flag.
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
 * The git command catalog, declared once.
 *
 * Everything else derives from this record: the {@link Rpcs} group, the
 * service {@link Interface}, and the client namespace in `honk-core`. Adding a
 * command here is what makes it exist everywhere; forgetting a projection is a
 * compile error, not a drift.
 *
 * @category commands
 */
export const commands = {
  status: Status,
  diff: Diff,
  filePatch: FilePatch,
  fileImage: FileImage,
  fileContent: FileContent,
  branches: Branches,
  checkout: Checkout,
  pull: Pull,
  discard: Discard,
  captureCheckpoint: CaptureCheckpoint,
  checkpoints: Checkpoints,
  checkpointChanges: CheckpointChanges,
  checkpointDiff: CheckpointDiff,
  restoreCheckpoint: RestoreCheckpoint,
  restoreFiles: RestoreFiles,
  deleteCheckpoints: DeleteCheckpoints,
};

/**
 * The git command group, derived from {@link commands}.
 *
 * @category commands
 */
export class Rpcs extends RpcGroup.make(...Object.values(commands)) {}

/**
 * The git service as in-process callers use it, derived from {@link commands}:
 * one method per command, each typed by its Rpc, so the service cannot drift
 * from the wire contract.
 *
 * @category service
 */
export interface Interface extends ServiceOf<typeof commands> {}
