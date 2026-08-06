/**
 * `sdk.files`: reading and writing inside one trusted workspace.
 *
 * Every call names a workspace and a path, and the workspace directory is the
 * boundary. There is no second permission system here — trust was granted once,
 * to a directory — so the only thing this module enforces is that a path really
 * is inside that directory. A path that escapes is a typed refusal, not a
 * defect: clients ask for paths that came from user input, and being told "that
 * is outside the workspace" is a normal answer.
 *
 * Escaping is checked twice, because there are two ways out:
 *
 * 1. **Syntactically**, with `..` or an absolute path. Pi's `absolutePath`
 *    normalizes the request without touching the disk, and the result must sit
 *    under the workspace root.
 * 2. **Through a symlink**, which no amount of string normalization can see.
 *    The deepest part of the path that actually exists is canonicalized, and
 *    that canonical path must sit under the workspace root.
 *
 * One root serves both checks because workspace trust already canonicalized
 * it: a `WorkspaceDirectory` is the filesystem's own spelling of the
 * directory, so a symlink can only appear *below* the root, where the second
 * gate catches it.
 *
 * All filesystem work goes through the {@link Workspace.ExecutionEnv} that
 * `Workspace.Service` owns for that workspace. That is the same instance the Pi
 * harness hands to its tools, which is what makes "the workspace directory is
 * the boundary" true for the model and for the client at once. This module
 * never constructs an environment of its own.
 *
 * Paths cross the boundary as workspace-relative strings in both directions.
 * Callers may pass either form, and results are always relative — an absolute
 * host path in a response would leak the shape of the user's disk into every
 * client that renders a file tree.
 *
 * @example
 * ```ts
 * const listing = await sdk.files.list({ workspaceId });
 * const readme = await sdk.files.read({ workspaceId, path: "README.md" });
 * if (readme.type === "text") render(readme.text);
 * ```
 *
 * @see spec/honk-built-ins.md section 5 for the method list, and spec/core.md
 * section 5 for the trust contract this module inherits.
 * @module
 */

import type { FileError, FileInfo, Result as PiResult } from "@earendil-works/pi-agent-core";
import { Context, Effect, Layer, Path, Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

import type { ServiceOf } from "./util/rpc";
import { Workspace } from "./workspace";

/** How many matches {@link Find} returns when the caller does not say. */
const defaultFindLimit = 100;

/**
 * How many directory entries {@link Find} will look at before giving up.
 *
 * A workspace is an arbitrary directory: it can contain `node_modules`, a
 * `.git` object store, or a build output tree with more files than anyone wants
 * to walk. Nothing is excluded by name — a filter core invented would silently
 * hide files the user can see in their own editor — so the walk is bounded by
 * effort instead, and says so through `truncated`.
 */
const findScanBudget = 20_000;

/** How much of a file is sniffed for NUL bytes before decoding it as text. */
const binarySniffBytes = 8_000;

/**
 * One filesystem object as a client sees it.
 *
 * `path` is relative to the workspace root, so it can be rendered, stored in
 * application state, and passed straight back into another call. `kind` is
 * Pi's, and symlinks are reported as symlinks rather than resolved: a client
 * showing a file tree should be able to tell the difference.
 *
 * @category schemas
 */
export const Entry = Schema.Struct({
  path: Schema.String,
  name: Schema.String,
  kind: Schema.Literals(["file", "directory", "symlink"]),
  size: Schema.Finite,
  modifiedAt: Schema.Finite,
}).annotate({ identifier: "FilesEntry" });
export type Entry = typeof Entry.Type;

/**
 * The path is outside the workspace directory.
 *
 * The security boundary, as a value. It covers both an absolute path pointing
 * elsewhere and a relative path that climbs out with `..`, and it also covers a
 * path inside the workspace whose symlink target is not — so a caller cannot
 * tell from the error *how* it escaped, only that it did.
 *
 * @category errors
 */
export class EscapeError extends Schema.TaggedErrorClass<EscapeError>()("FilesEscapeError", {
  code: Schema.tag("files.path_escaped"),
  message: Schema.tag("This path is outside the workspace."),
  workspaceId: Workspace.WorkspaceId,
  path: Schema.String,
}) {}

/**
 * Nothing exists at this path.
 *
 * @category errors
 */
export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("FilesNotFoundError", {
  code: Schema.tag("files.not_found"),
  message: Schema.tag("Honk could not find this path in the workspace."),
  path: Schema.String,
}) {}

/**
 * The operating system refused.
 *
 * Distinct from {@link EscapeError} on purpose. The path was inside the
 * workspace and Honk was willing; the host said no. A client should offer to
 * fix permissions, not to pick a different file.
 *
 * @category errors
 */
export class AccessError extends Schema.TaggedErrorClass<AccessError>()("FilesAccessError", {
  code: Schema.tag("files.access_denied"),
  message: Schema.tag("Honk is not allowed to use this path."),
  path: Schema.String,
}) {}

/**
 * Something is already there.
 *
 * Only {@link Rename} raises this. {@link Write} overwrites by design, because
 * writing a file the model just edited is the common case; moving one on top of
 * another is a data-loss bug in whatever asked for it.
 *
 * @category errors
 */
export class ExistsError extends Schema.TaggedErrorClass<ExistsError>()("FilesExistsError", {
  code: Schema.tag("files.already_exists"),
  message: Schema.tag("A file or folder already exists at this path."),
  path: Schema.String,
}) {}

/**
 * Why an operation failed, when the reason is not one of the three above.
 *
 * These are Pi's remaining `FileErrorCode` values, carried through rather than
 * flattened. The set is closed by construction: {@link toFilesError} switches on
 * Pi's code, and a Pi upgrade that adds a code breaks that switch here instead
 * of turning into `"unknown"` at a client.
 *
 * @category schemas
 */
export const OperationReason = Schema.Literals([
  "aborted",
  "not_directory",
  "is_directory",
  "invalid",
  "not_supported",
  "unknown",
]).annotate({ identifier: "FilesOperationReason" });
export type OperationReason = typeof OperationReason.Type;

/**
 * The operation could not be completed, for a reason the caller can inspect.
 *
 * Branch on `reason` to tell "you asked to list a file" (`not_directory`) from
 * "this environment cannot do that" (`not_supported`).
 *
 * @category errors
 */
export class OperationError extends Schema.TaggedErrorClass<OperationError>()(
  "FilesOperationError",
  {
    code: Schema.tag("files.operation_failed"),
    message: Schema.tag("Honk could not complete this file operation."),
    path: Schema.String,
    reason: OperationReason,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

/**
 * What every path-addressed call can fail with.
 *
 * Declared once as a value so the seven RPCs below cannot drift into seven
 * slightly different error contracts.
 */
const pathFailures = [
  Workspace.NotFoundError,
  EscapeError,
  NotFoundError,
  AccessError,
  OperationError,
];

/** @category errors */
export const PathFailure = Schema.Union(pathFailures).annotate({ identifier: "FilesPathFailure" });

/** @category errors */
export const RenameFailure = Schema.Union([...pathFailures, ExistsError]).annotate({
  identifier: "FilesRenameFailure",
});

/**
 * What any path-addressed call can fail with, derived from {@link PathFailure}
 * so the type and the wire schema cannot list different members.
 *
 * `Workspace.NotFoundError` is part of it because a file call names a workspace
 * by id, and an id this host does not know is the same refusal the workspace
 * domain already defines. Restating it as a files-specific error would give
 * clients two names for one condition.
 *
 * @category errors
 */
export type PathError = typeof PathFailure.Type;

/**
 * Every expected failure this domain owns, derived from {@link RenameFailure}:
 * {@link ExistsError} is the only member {@link PathError} leaves out, because
 * only {@link Rename} can raise it.
 *
 * Code branches on `error.code`, never on `error.message`.
 *
 * @category errors
 */
export type Error = typeof RenameFailure.Type;

/**
 * What {@link Read} answers for a file it will not return as text.
 *
 * Only the size, deliberately. `sdk.files.read` is the text-reading method: it
 * exists so a client can show a file and so a person can paste one into a
 * prompt. Base64ing an arbitrary binary through the same JSON response would
 * make every reader pay for a case almost none of them handle, and the spec
 * already routes image bytes through `sdk.git.fileImage`. A client that gets
 * `binary` should render a placeholder with the size, not retry.
 *
 * @category schemas
 */
const BinaryContent = Schema.Struct({
  type: Schema.tag("binary"),
  size: Schema.Finite,
});

/**
 * What {@link Read} answers for text: the content, and whether it was cut off.
 *
 * `truncated` is only ever true when the caller passed `maxLines`. A file is
 * never silently shortened.
 */
const TextContent = Schema.Struct({
  type: Schema.tag("text"),
  text: Schema.String,
  truncated: Schema.Boolean,
});

/**
 * The two things a file can be.
 *
 * A tagged union rather than a nullable `text` field, so a client cannot render
 * an empty string where it meant to render "this is a binary file". The
 * tagged-union utilities (`guards`, `cases`, `match`) come from
 * `Schema.toTaggedUnion`; annotate *before* piping, since `annotate` rebuilds
 * the union and would drop them.
 *
 * @example
 * ```ts
 * const result = await sdk.files.read({ workspaceId, path });
 * Files.ReadResult.match(result, {
 *   text: ({ text }) => showEditor(text),
 *   binary: ({ size }) => showBinaryPlaceholder(size),
 * });
 * ```
 *
 * @category schemas
 */
export const ReadResult = Schema.Union([TextContent, BinaryContent])
  .annotate({ identifier: "FilesReadResult" })
  .pipe(Schema.toTaggedUnion("type"));
export type ReadResult = typeof ReadResult.Type;

/**
 * What {@link Find} answers: the matches it collected, and whether it stopped
 * early.
 *
 * `truncated` covers both limits — the caller's `limit` and
 * {@link findScanBudget} — because from the caller's side they mean the same
 * thing: this is not the whole answer. Narrow the query or the starting path.
 *
 * @category schemas
 */
export const FindResult = Schema.Struct({
  entries: Schema.Array(Entry),
  truncated: Schema.Boolean,
}).annotate({ identifier: "FilesFindResult" });
export type FindResult = typeof FindResult.Type;

/**
 * Searches the workspace for paths containing a substring.
 *
 * Matching is a case-insensitive substring test against the whole
 * workspace-relative path, so `"src/auth"` narrows by directory and `".test."`
 * narrows by filename, without a glob dialect anyone has to learn.
 *
 * Symlinks are reported when they match but never descended into. That keeps
 * the walk finite in the presence of a cycle, and it keeps `find` inside the
 * workspace for the same reason every other method is: a symlinked directory is
 * a door out.
 *
 * Rpc definitions are plain consts. Only the {@link Rpcs} group below uses
 * class-extends, so handlers and clients can reference one nominal group type.
 *
 * @category commands
 */
export const Find = Rpc.make("files.find", {
  payload: {
    workspaceId: Workspace.WorkspaceId,
    query: Schema.NonEmptyString,
    path: Schema.optionalKey(Schema.String),
    limit: Schema.optionalKey(Schema.Int),
  },
  success: FindResult,
  error: PathFailure,
});

/**
 * Lists the direct children of one directory.
 *
 * Omit `path` for the workspace root. Results are ordered directories first,
 * then by name, so a file tree renders the same way twice without the client
 * sorting it — the underlying `listDir` makes no ordering promise.
 *
 * @category commands
 */
export const List = Rpc.make("files.list", {
  payload: {
    workspaceId: Workspace.WorkspaceId,
    path: Schema.optionalKey(Schema.String),
  },
  success: Schema.Array(Entry),
  error: PathFailure,
});

/**
 * Reads one file.
 *
 * The file is read as bytes and then decoded, rather than read as text and
 * hoped for. Pi's `readTextFile` and `readTextLines` are lossy on binary input
 * — an invalid UTF-8 sequence becomes a replacement character and the call
 * still succeeds — so a text-first read cannot tell a UTF-16 asset from a badly
 * encoded source file. Reading bytes lets {@link ReadResult} be honest about
 * which one this is; the cost is that `read` holds the whole file in memory.
 *
 * TODO(core-migration §12): ranged and streaming reads. A client opening a
 * large file should be able to page through it instead of receiving all of it,
 * and `maxLines` is only the head of that.
 *
 * @category commands
 */
export const Read = Rpc.make("files.read", {
  payload: {
    workspaceId: Workspace.WorkspaceId,
    path: Schema.String,
    maxLines: Schema.optionalKey(Schema.Int),
  },
  success: ReadResult,
  error: PathFailure,
});

/**
 * Creates or overwrites one text file, creating parent directories as needed.
 *
 * Text only. Pi's `writeFile` takes bytes too, but a JSON command payload has
 * no way to carry them without picking an encoding, and picking one here would
 * commit every future client to it. Binary writes wait for a transport that can
 * express them.
 *
 * Success is `void`: the resulting metadata comes from {@link List} or
 * {@link Read}, so there is one authoritative way to learn what is on disk
 * rather than a second answer that can disagree with it.
 *
 * @category commands
 */
export const Write = Rpc.make("files.write", {
  payload: {
    workspaceId: Workspace.WorkspaceId,
    path: Schema.String,
    content: Schema.String,
  },
  error: PathFailure,
});

/**
 * Removes one file or directory.
 *
 * A non-empty directory needs `recursive: true`, and deleting a path that is
 * not there fails with {@link NotFoundError} rather than succeeding quietly —
 * an undo affordance that cannot tell "removed it" from "there was nothing to
 * remove" will eventually lie to someone.
 *
 * The workspace root itself is refused with reason `invalid`. It is inside the
 * workspace, so it is not an escape; it is simply not a file this API owns.
 *
 * @category commands
 */
export const Delete = Rpc.make("files.delete", {
  payload: {
    workspaceId: Workspace.WorkspaceId,
    path: Schema.String,
    recursive: Schema.optionalKey(Schema.Boolean),
  },
  error: PathFailure,
});

/**
 * Creates a directory and any missing parents.
 *
 * Idempotent: creating a directory that already exists succeeds.
 *
 * @category commands
 */
export const CreateDirectory = Rpc.make("files.create_directory", {
  payload: {
    workspaceId: Workspace.WorkspaceId,
    path: Schema.String,
  },
  error: PathFailure,
});

/**
 * Moves a file or directory to another path in the same workspace.
 *
 * Pi's `ExecutionEnv` has no rename, so this is a copy followed by a delete.
 * The alternative was `exec("mv ...")`, which is rejected on two counts: it
 * would build a shell command out of caller-controlled paths right next to the
 * containment check this module exists to enforce, and `ExecutionEnv` abstracts
 * environments that need not have a POSIX `mv` at all. Copying uses the same
 * filesystem methods every other command here uses, so it inherits the same
 * boundary.
 *
 * The costs of that choice, none of which this method hides:
 *
 * - It is not atomic. A failure partway leaves the copy behind and the source
 *   in place; nothing is lost, but a client may see both.
 * - Permissions, ownership, and timestamps are not preserved. `ExecutionEnv`
 *   cannot read or set them.
 * - A symlink is refused with reason `not_supported`. Copying one would either
 *   follow it — silently turning a link into a file, possibly one from outside
 *   the workspace — or need a `symlink` call Pi does not expose.
 * - Large files are copied through memory.
 *
 * Both paths are checked for containment, so a rename cannot move a file out of
 * the workspace or pull one in. An existing destination is refused rather than
 * overwritten.
 *
 * @category commands
 */
export const Rename = Rpc.make("files.rename", {
  payload: {
    workspaceId: Workspace.WorkspaceId,
    from: Schema.String,
    to: Schema.String,
  },
  error: RenameFailure,
});

/**
 * The files command catalog, declared once.
 *
 * Everything else derives from this record: the {@link Rpcs} group, the
 * service {@link Interface}, and the client namespace in `honk-core`.
 *
 * @category commands
 */
export const commands = {
  find: Find,
  list: List,
  read: Read,
  write: Write,
  delete: Delete,
  createDirectory: CreateDirectory,
  rename: Rename,
};

/**
 * The files command group, derived from {@link commands}.
 *
 * @category commands
 */
export class Rpcs extends RpcGroup.make(...Object.values(commands)) {}

/**
 * The files service as in-process callers use it, derived from
 * {@link commands}: one method per command, each typed by its Rpc, so the
 * service cannot drift from the wire contract.
 *
 * @category service
 */
export interface Interface extends ServiceOf<typeof commands> {}

/**
 * @category service
 */
export class Service extends Context.Service<Service, Interface>()("honk/Files") {}

/**
 * One workspace's canonical root plus the environment to use.
 *
 * The root comes straight from workspace trust, which canonicalized it, so
 * resolving it again per call would only re-ask a question the brand already
 * answers.
 */
interface Root {
  readonly workspaceId: Workspace.WorkspaceId;
  readonly env: Workspace.ExecutionEnv;
  /** The canonical workspace directory every path must live under. */
  readonly directory: string;
}

/** A path that has passed containment, in both forms the code needs. */
interface Target {
  /** Absolute: safe to hand to Pi. */
  readonly absolute: string;
  /** Workspace-relative: safe to hand to a client. */
  readonly relative: string;
}

/**
 * Builds the files service over `Workspace.Service` and a `Path.Path`.
 *
 * It reaches the filesystem only through `Workspace.env`, so it can neither
 * open a workspace the user has not trusted nor create a second environment
 * with a different root.
 *
 * @category layers
 */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const workspaces = yield* Workspace.Service;
    const path = yield* Path.Path;

    /** Whether `candidate` is `root` or sits under it. */
    const within = (root: string, candidate: string) =>
      candidate === root ||
      candidate.startsWith(root.endsWith(path.sep) ? root : `${root}${path.sep}`);

    /**
     * Runs one Pi filesystem call.
     *
     * Pi's contract is that these "must never throw or reject" and encode every
     * failure in the returned `Result`, so a rejection here is a bug in the
     * environment implementation and stays a defect. Expected failures become
     * this module's typed errors, named by the path the *caller* used.
     */
    const attempt = <A>(target: string, run: () => Promise<PiResult<A, FileError>>) =>
      Effect.flatMap(Effect.promise(run), (result) =>
        result.ok ? Effect.succeed(result.value) : Effect.fail(toFilesError(target, result.error)),
      );

    const rootOf = Effect.fnUntraced(function* (workspaceId: Workspace.WorkspaceId) {
      // find() and env() both refuse an unknown id, and env() is what proves a
      // trust decision was made — this module never builds an environment.
      const info = yield* workspaces.find({ workspaceId });
      const env = yield* workspaces.env({ workspaceId });
      return { workspaceId, env, directory: info.directory } satisfies Root;
    });

    /** Workspace-relative form of an absolute path. */
    const relativeTo = (root: Root, absolute: string) => {
      const relative = path.relative(root.directory, absolute);
      return relative.length === 0 ? "." : relative;
    };

    const toEntry = (root: Root, info: FileInfo): Entry => ({
      path: relativeTo(root, info.path),
      name: info.name,
      kind: info.kind,
      size: info.size,
      modifiedAt: info.mtimeMs,
    });

    /**
     * The containment check, and the only way a path reaches the filesystem.
     *
     * Relative input resolves against the environment's working directory,
     * which `Workspace.env` roots at the workspace. That is a convenience, not
     * the guarantee: the checks below compare against the workspace root
     * regardless, so an environment rooted somewhere else fails closed instead
     * of reading somewhere else.
     */
    const resolve = Effect.fnUntraced(function* (root: Root, input: string) {
      const absolute = yield* attempt(input, () => root.env.absolutePath(input));
      // First gate: `..` and absolute paths, decided without touching the disk.
      if (!within(root.directory, absolute)) {
        return yield* new EscapeError({ workspaceId: root.workspaceId, path: input });
      }

      // Second gate: symlinks. Only an existing path can be canonicalized, and
      // write, createDirectory, and rename all name paths that do not exist
      // yet — so walk up to the deepest ancestor that does. Everything below it
      // is a plain, already-normalized suffix, so if the ancestor is inside the
      // workspace the whole path is.
      let probe = absolute;
      for (;;) {
        if (!within(root.directory, probe)) {
          // Walked past the workspace root without finding anything: the
          // workspace directory itself is gone.
          return yield* new NotFoundError({ path: input });
        }
        const canonical = yield* Effect.promise(() => root.env.canonicalPath(probe));
        if (canonical.ok) {
          if (!within(root.directory, canonical.value)) {
            return yield* new EscapeError({ workspaceId: root.workspaceId, path: input });
          }
          break;
        }
        if (canonical.error.code !== "not_found") {
          return yield* toFilesError(input, canonical.error);
        }
        const parent = path.dirname(probe);
        if (parent === probe) return yield* new NotFoundError({ path: input });
        probe = parent;
      }

      return { absolute, relative: relativeTo(root, absolute) } satisfies Target;
    });

    /**
     * Copies one filesystem object onto a path that does not exist.
     *
     * Recursive, so the return type is annotated: a `const` that references
     * itself cannot be inferred. Bytes rather than text, so a rename never
     * re-encodes a binary file into mojibake.
     */
    const copyInto = (
      root: Root,
      source: FileInfo,
      destination: Target,
    ): Effect.Effect<void, PathError> =>
      Effect.gen(function* () {
        const from = relativeTo(root, source.path);
        if (source.kind === "symlink") {
          return yield* new OperationError({ path: from, reason: "not_supported" });
        } else if (source.kind === "file") {
          const bytes = yield* attempt(from, () => root.env.readBinaryFile(source.path));
          yield* attempt(destination.relative, () =>
            root.env.writeFile(destination.absolute, bytes),
          );
        } else {
          yield* attempt(destination.relative, () =>
            root.env.createDir(destination.absolute, { recursive: true }),
          );
          const children = yield* attempt(from, () => root.env.listDir(source.path));
          for (const child of children) {
            const joined = yield* attempt(destination.relative, () =>
              root.env.joinPath([destination.absolute, child.name]),
            );
            // Re-resolve rather than trusting the join: a child name is
            // filesystem data, and the destination subtree gets the same
            // containment check every caller-supplied path gets.
            yield* copyInto(root, child, yield* resolve(root, joined));
          }
        }
      });

    const find = Effect.fn("Files.find")(function* (input: Rpc.Payload<typeof Find>) {
      const root = yield* rootOf(input.workspaceId);
      const start = yield* resolve(root, input.path ?? ".");
      const limit = Math.max(1, input.limit ?? defaultFindLimit);
      const needle = input.query.toLowerCase();

      const entries: Entry[] = [];
      const pending: string[] = [start.absolute];
      let scanned = 0;
      let stopped = false;

      while (!stopped && pending.length > 0) {
        const directory = pending.pop();
        if (directory === undefined) break;
        const infos = yield* attempt(relativeTo(root, directory), () =>
          root.env.listDir(directory),
        );
        for (const info of infos) {
          scanned += 1;
          if (scanned > findScanBudget) {
            stopped = true;
            break;
          }
          const entry = toEntry(root, info);
          if (entry.path.toLowerCase().includes(needle)) {
            // Stopping on the match *after* the limit is what makes
            // `truncated` mean "there is more", not "you asked for few".
            if (entries.length === limit) {
              stopped = true;
              break;
            }
            entries.push(entry);
          }
          // Symlinked directories report as "symlink" and are not descended.
          if (info.kind === "directory") pending.push(info.path);
        }
      }

      return { entries, truncated: stopped } satisfies FindResult;
    });

    const list = Effect.fn("Files.list")(function* (input: Rpc.Payload<typeof List>) {
      const root = yield* rootOf(input.workspaceId);
      const target = yield* resolve(root, input.path ?? ".");
      const infos = yield* attempt(target.relative, () => root.env.listDir(target.absolute));
      return infos.map((info) => toEntry(root, info)).sort(byKindThenName);
    });

    const read = Effect.fn("Files.read")(function* (input: Rpc.Payload<typeof Read>) {
      const root = yield* rootOf(input.workspaceId);
      const target = yield* resolve(root, input.path);
      const bytes = yield* attempt(target.relative, () => root.env.readBinaryFile(target.absolute));

      const text = decodeUtf8(bytes);
      if (text === undefined)
        return { type: "binary", size: bytes.byteLength } satisfies ReadResult;
      if (input.maxLines === undefined) {
        return { type: "text", text, truncated: false } satisfies ReadResult;
      }

      const kept = Math.max(0, input.maxLines);
      const lines = text.split("\n");
      if (lines.length <= kept)
        return { type: "text", text, truncated: false } satisfies ReadResult;
      return {
        type: "text",
        text: lines.slice(0, kept).join("\n"),
        truncated: true,
      } satisfies ReadResult;
    });

    const write = Effect.fn("Files.write")(function* (input: Rpc.Payload<typeof Write>) {
      const root = yield* rootOf(input.workspaceId);
      const target = yield* resolve(root, input.path);
      yield* attempt(target.relative, () => root.env.writeFile(target.absolute, input.content));
    });

    const remove = Effect.fn("Files.delete")(function* (input: Rpc.Payload<typeof Delete>) {
      const root = yield* rootOf(input.workspaceId);
      const target = yield* resolve(root, input.path);
      if (target.relative === ".") {
        return yield* new OperationError({ path: target.relative, reason: "invalid" });
      }
      // force stays false so a missing path is a NotFoundError, not a success.
      yield* attempt(target.relative, () =>
        root.env.remove(target.absolute, { recursive: input.recursive ?? false, force: false }),
      );
    });

    const createDirectory = Effect.fn("Files.createDirectory")(function* (
      input: Rpc.Payload<typeof CreateDirectory>,
    ) {
      const root = yield* rootOf(input.workspaceId);
      const target = yield* resolve(root, input.path);
      yield* attempt(target.relative, () =>
        root.env.createDir(target.absolute, { recursive: true }),
      );
    });

    const rename = Effect.fn("Files.rename")(function* (input: Rpc.Payload<typeof Rename>) {
      const root = yield* rootOf(input.workspaceId);
      const from = yield* resolve(root, input.from);
      const to = yield* resolve(root, input.to);

      if (from.relative === "." || to.relative === ".") {
        return yield* new OperationError({ path: ".", reason: "invalid" });
      }
      // Renaming a path onto itself is a no-op, not a copy over a delete.
      if (from.absolute === to.absolute) return;
      if (within(from.absolute, to.absolute)) {
        // Copying a directory into itself never terminates.
        return yield* new OperationError({ path: to.relative, reason: "invalid" });
      }
      if (yield* attempt(to.relative, () => root.env.exists(to.absolute))) {
        return yield* new ExistsError({ path: to.relative });
      }

      const source = yield* attempt(from.relative, () => root.env.fileInfo(from.absolute));
      yield* copyInto(root, source, to);
      yield* attempt(from.relative, () =>
        root.env.remove(from.absolute, { recursive: true, force: false }),
      );
    });

    return Service.of({ find, list, read, write, delete: remove, createDirectory, rename });
  }),
);

/**
 * {@link layer} with POSIX path rules, for tests and browser-adjacent hosts.
 *
 * TODO(core-migration §6): a Node host should provide `NodePath.layer` instead,
 * so containment is decided with the same rules the operating system uses to
 * resolve paths. `Workspace.defaultLayer` carries the same TODO, and the two
 * must move together: comparing a POSIX-normalized path against a
 * platform-normalized root is exactly the kind of mismatch a boundary check
 * cannot afford.
 *
 * @category layers
 */
export const defaultLayer = layer.pipe(Layer.provide(Path.layer));

/**
 * Binds the files RPCs to {@link Service}.
 *
 * Handlers stay thin: decoding already happened at the RPC boundary, so they
 * only bind payloads to service methods. Provide {@link layer} to satisfy the
 * `Service` requirement, over the same `Workspace.Service` instance the
 * workspace RPCs use.
 *
 * @category layers
 */
export const rpcLayer = Rpcs.toLayer(
  Effect.gen(function* () {
    const files = yield* Service;
    return {
      "files.find": (payload) => files.find(payload),
      "files.list": (payload) => files.list(payload),
      "files.read": (payload) => files.read(payload),
      "files.write": (payload) => files.write(payload),
      "files.delete": (payload) => files.delete(payload),
      "files.create_directory": (payload) => files.createDirectory(payload),
      "files.rename": (payload) => files.rename(payload),
    };
  }),
);

/**
 * Translates one Pi filesystem failure into this module's error channel.
 *
 * The `default` branch is the exhaustiveness check: it narrows Pi's
 * `FileErrorCode` to exactly the literals {@link OperationReason} lists, so a Pi
 * upgrade that adds a code fails to compile here rather than reaching a client
 * as `"unknown"`.
 */
function toFilesError(
  path: string,
  error: FileError,
): NotFoundError | AccessError | OperationError {
  switch (error.code) {
    case "not_found":
      return new NotFoundError({ path });
    case "permission_denied":
      return new AccessError({ path });
    default:
      return new OperationError({ path, reason: error.code, cause: error });
  }
}

/**
 * Decodes bytes as UTF-8 text, or reports that they are not text.
 *
 * Two tests, because neither alone is enough. A NUL byte in the first few
 * kilobytes is the classic binary tell and catches UTF-16 and most asset
 * formats, whose bytes are otherwise valid-looking. Strict decoding then
 * catches everything else that is not UTF-8. Synchronous and total: this is
 * parsing, so it returns an absent value rather than an Effect.
 */
function decodeUtf8(bytes: Uint8Array): string | undefined {
  if (bytes.subarray(0, binarySniffBytes).includes(0)) return undefined;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/**
 * Orders a directory listing the way a file tree renders it: directories first,
 * then by name. Comparison is on code units, not locale, so two hosts in
 * different regions produce the same listing.
 */
function byKindThenName(left: Entry, right: Entry): number {
  const leftIsDirectory = left.kind === "directory";
  const rightIsDirectory = right.kind === "directory";
  if (leftIsDirectory !== rightIsDirectory) return leftIsDirectory ? -1 : 1;
  if (left.name === right.name) return 0;
  return left.name < right.name ? -1 : 1;
}

// Extensionless on purpose: consumers bundle this source (desktop keeps
// @honk/core in devDependencies so electron-vite bundles it), and consumer
// tsconfigs do not enable allowImportingTsExtensions.
// oxlint-disable-next-line import/no-self-import -- spec/effect.md self-reexport pattern; star imports are banned for consumers.
export * as Files from "./files";
