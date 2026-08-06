/**
 * Workspace trust: the only permission gate in Honk.
 *
 * Honk asks one question before opening a workspace: **do you trust this
 * workspace?** An untrusted workspace is not a restricted session, it is
 * *unopened*. Honk must not load its extensions, MCP configuration, skills,
 * prompts, instructions, or tools. It may resolve the canonical path and return
 * the small amount of metadata needed to show the trust prompt.
 *
 * Once trusted, the workspace is allow-all. Pi, tools, MCP servers, and
 * extensions may use every host capability exposed to them. There is no second
 * permission system, no per-tool allow/ask/deny, and no approval callback
 * around individual tool calls.
 *
 * @example
 * ```ts
 * const opened = await sdk.workspace.open({ directory });
 *
 * if (opened.type === "trust_required") {
 *   if (!(await showWorkspaceTrustPrompt(opened.directory))) return;
 *   await sdk.workspace.trust({ directory: opened.directory });
 * }
 *
 * const workspace = await sdk.workspace.open({ directory });
 * ```
 *
 * @see spec/core.md section 5 for the trust contract, and invariants 6 and 7.
 * @module
 */

import type { ExecutionEnv } from "@earendil-works/pi-agent-core";
import { Context, Effect, Layer, Path, Ref, Schema, Scope } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

import type { ServiceOf } from "./util/rpc";

/**
 * Pi's filesystem and shell capability, re-exported so built-ins type it
 * without their own Pi dependency pin.
 *
 * @category types
 */
export type { ExecutionEnv } from "@earendil-works/pi-agent-core";

/**
 * Identifies one trusted workspace for the lifetime of a core.
 *
 * Ids are minted only when trust is recorded, so **holding a `WorkspaceId`
 * proves a trust decision was made**. That is what lets session creation take
 * an id and skip re-checking the gate: an unknown id and an untrusted
 * directory are the same refusal.
 *
 * Trust persists under the host data directory, so an id is stable across
 * restarts — which is what lets a stored session's transcript reference the
 * workspace it ran in.
 *
 * @category identifiers
 */
export const WorkspaceId = Schema.NonEmptyString.pipe(Schema.brand("WorkspaceId")).annotate({
  identifier: "WorkspaceId",
});
export type WorkspaceId = typeof WorkspaceId.Type;

/**
 * A canonical absolute path to a workspace root.
 *
 * The brand marks a path the filesystem has vouched for: absolute, existing,
 * a directory, with every symlink resolved. Two clients naming the same
 * directory differently — `/tmp` and `/private/tmp` on macOS are one
 * directory — must land on the same `WorkspaceDirectory`, or trust recorded
 * through one would not be found by the other, and one directory would hold
 * two trust decisions.
 *
 * @category identifiers
 */
export const WorkspaceDirectory = Schema.NonEmptyString.pipe(
  Schema.brand("WorkspaceDirectory"),
).annotate({ identifier: "WorkspaceDirectory" });
export type WorkspaceDirectory = typeof WorkspaceDirectory.Type;

/** The refusal: a real directory Honk will not open until the user consents. */
const TrustRequired = Schema.Struct({
  type: Schema.tag("trust_required"),
  directory: WorkspaceDirectory,
});

/** The open workspace: trusted, identified, and usable for sessions. */
const Ready = Schema.Struct({
  type: Schema.tag("ready"),
  id: WorkspaceId,
  directory: WorkspaceDirectory,
});

/**
 * What {@link Open} answers: either the trust refusal or a ready workspace.
 *
 * Needing trust is an expected product state, not a failure. It travels on the
 * success channel so a caller must handle it in the same `switch` that handles
 * the ready case, rather than discovering it in a `catch`.
 *
 * The tagged-union utilities (`guards`, `cases`, `match`) come from
 * `Schema.toTaggedUnion`. Annotate *before* piping: `annotate` rebuilds the
 * union, which would drop those attached utilities.
 *
 * @example
 * ```ts
 * if (Workspace.OpenResult.guards.ready(opened)) useWorkspace(opened.id);
 * ```
 *
 * @category schemas
 */
export const OpenResult = Schema.Union([TrustRequired, Ready])
  .annotate({ identifier: "WorkspaceOpenResult" })
  .pipe(Schema.toTaggedUnion("type"));
export type OpenResult = typeof OpenResult.Type;

/**
 * The directory could not be resolved to a canonical workspace root.
 *
 * Distinct from the trust refusal: this means Honk could not identify the
 * directory at all, so there is nothing for the user to consent to.
 *
 * @category errors
 */
export class OpenError extends Schema.TaggedErrorClass<OpenError>()("WorkspaceOpenError", {
  code: Schema.tag("workspace.open_failed"),
  message: Schema.tag("Honk could not open this workspace."),
  directory: Schema.NonEmptyString,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

/**
 * Consent could not be recorded for this directory.
 *
 * @category errors
 */
export class TrustError extends Schema.TaggedErrorClass<TrustError>()("WorkspaceTrustError", {
  code: Schema.tag("workspace.trust_failed"),
  message: Schema.tag("Honk could not trust this workspace."),
  directory: Schema.NonEmptyString,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

/**
 * No trusted workspace carries this id.
 *
 * Because ids exist only for trusted directories, this is also the answer when
 * a caller presents an id from a previous host process.
 *
 * @category errors
 */
export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()(
  "WorkspaceNotFoundError",
  {
    code: Schema.tag("workspace.not_found"),
    message: Schema.tag("Honk does not know this workspace."),
    workspaceId: WorkspaceId,
  },
) {}

/**
 * Every expected failure this domain owns.
 *
 * Code branches on `error.code`, never on `error.message`. Switching on the
 * code narrows the payload type with it.
 *
 * @category errors
 */
export type Error = OpenError | TrustError | NotFoundError;

/**
 * A trusted workspace as the rest of the core sees it.
 *
 * Deliberately small. Git state, file listings, and MCP configuration belong to
 * the features that own them, not to workspace identity.
 *
 * @category types
 */
export interface Info {
  readonly id: WorkspaceId;
  readonly directory: WorkspaceDirectory;
}

/**
 * Resolves a directory and reports whether it is trusted.
 *
 * This must check stored trust **before** it reads any workspace-controlled
 * configuration or creates a harness. Returning `trust_required` is a normal
 * outcome; only an unresolvable directory fails.
 *
 * Rpc definitions are plain consts. Only the {@link Rpcs} group below uses
 * class-extends, so handlers and clients can reference one nominal group type.
 *
 * @category commands
 */
export const Open = Rpc.make("workspace.open", {
  payload: { directory: Schema.NonEmptyString },
  success: OpenResult,
  error: OpenError,
});

/**
 * Records the user's consent for a directory.
 *
 * The only approval API in version zero. It is idempotent: trusting an
 * already-trusted directory keeps the existing id, so a double-click cannot
 * orphan the sessions bound to it.
 *
 * Consent is the caller's to obtain. This call records a decision the user has
 * already made; it does not prompt.
 *
 * @category commands
 */
export const Trust = Rpc.make("workspace.trust", {
  payload: { directory: Schema.NonEmptyString },
  error: TrustError,
});

/**
 * The workspace command catalog, declared once.
 *
 * Everything else derives from this record: the {@link Rpcs} group, the
 * wire-facing half of {@link Interface}, and the client namespace in
 * `honk-core`.
 *
 * @category commands
 */
export const commands = {
  open: Open,
  trust: Trust,
};

/**
 * The workspace command group, derived from {@link commands}.
 *
 * @category commands
 */
export class Rpcs extends RpcGroup.make(...Object.values(commands)) {}

/**
 * The workspace service as in-process callers use it.
 *
 * The wire-facing methods derive from {@link commands}, so the service cannot
 * drift from the wire contract. `find`, `env`, and `locate` are service-only
 * additions with no RPC behind them.
 *
 * @category service
 */
export interface Interface extends ServiceOf<typeof commands> {
  /**
   * Resolves a trusted workspace by id.
   *
   * Service-only, with no RPC behind it: sessions bind to workspaces in
   * process. Because ids are minted only when trust is recorded, `find` can
   * never surface an untrusted directory — which is why session creation can
   * accept an id and perform no second trust check.
   */
  readonly find: (input: {
    readonly workspaceId: WorkspaceId;
  }) => Effect.Effect<Info, NotFoundError>;

  /**
   * The execution environment rooted at this workspace's directory.
   *
   * One per trusted workspace, created on first use and shared from then on:
   * the Pi harness receives it as tool context, and `sdk.files` and `sdk.git`
   * read and write through the same instance. Sharing is what makes the
   * workspace directory the boundary — a caller cannot reach outside it by
   * asking a different built-in.
   *
   * Only trusted workspaces have one. An untrusted directory has no
   * `WorkspaceId`, so there is no way to ask for its environment.
   */
  readonly env: (input: {
    readonly workspaceId: WorkspaceId;
  }) => Effect.Effect<ExecutionEnv, NotFoundError>;

  /**
   * Looks up a trusted workspace by its canonical directory, or answers that
   * none exists.
   *
   * Service-only, for session restoration: a persisted session names its
   * directory, and restoring it must not create an environment for a
   * directory the user never trusted. Absence is the normal answer for that
   * question, so this is the one nullable `find` the interface carries.
   */
  readonly locate: (input: { readonly directory: string }) => Effect.Effect<Info | undefined>;
}

/**
 * What {@link layer} needs to give a trusted workspace a body.
 *
 * The factory is injected rather than imported so `@honk/core` carries no
 * platform dependency: a Node host passes `NodeExecutionEnv`, and a test or a
 * future sandboxed host passes its own. `ExecutionEnv` is Pi's interface, not
 * a Honk abstraction over it.
 *
 * The parameter is a plain string because the factory serves two callers:
 * trusted workspaces receive an environment rooted at their canonical
 * directory, and canonicalization itself uses a short-lived probe environment
 * to ask the filesystem what the canonical form *is*. The probe never
 * executes anything; it exists to resolve one path.
 *
 * @category layers
 */
export interface LayerOptions {
  readonly createExecutionEnv: (directory: string) => ExecutionEnv;

  /**
   * The host data directory's environment, where trust is persisted.
   *
   * The same instance the session repository and lease use: one directory,
   * one environment, provided by the core assembly.
   */
  readonly storage: ExecutionEnv;
}

/**
 * Builds the workspace service over a `Path.Path` implementation.
 *
 * Parameterized construction: `Service.make(options)` is the one place this
 * service is built, and {@link layer} just binds it to the key. The explicit
 * return type is what breaks the reference cycle between this function and
 * the {@link Service} class that carries it.
 */
const make = (options: LayerOptions): Effect.Effect<Interface, never, Path.Path | Scope.Scope> =>
  Effect.gen(function* () {
    const path = yield* Path.Path;

    // Trust lives in workspaces.json under the data directory: loaded once
    // at construction, written through on every new decision. The in-memory
    // map is the working copy; the file is what makes ids stable across
    // restarts.
    const trusted = yield* Ref.make<ReadonlyMap<WorkspaceDirectory, WorkspaceId>>(
      yield* loadTrust(options.storage),
    );

    // One environment per trusted workspace, created on first use.
    const envs = yield* Ref.make<ReadonlyMap<WorkspaceId, ExecutionEnv>>(new Map());

    // The layer scope owns every environment it handed out: teardown calls
    // each one's cleanup() so tracked child processes die with the host.
    // Best-effort on purpose — a failed cleanup must not block shutdown.
    // TODO(core-migration §10): workspace.close should release one
    // workspace's environment early; this finalizer is the host backstop.
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        const map = yield* Ref.get(envs);
        yield* Effect.forEach(
          [...map.values()],
          (env) => Effect.tryPromise(() => env.cleanup()).pipe(Effect.ignore),
          { concurrency: "unbounded", discard: true },
        );
      }),
    );

    /**
     * Canonicalizes caller input into a workspace identity, or refuses it.
     *
     * A workspace needs exactly one canonical form, and only the filesystem
     * can provide it: `path.resolve` cannot see that `/tmp` is a symlink.
     * The probe environment asks the filesystem for the real path of the
     * lexically resolved input and confirms it is a directory, so a path
     * that does not exist, names a file, or reaches the root through a
     * symlink alias is settled here — before trust is recorded and before
     * any environment is kept.
     *
     * Relative input is refused outright: the host's working directory is
     * not the user's intent, and guessing would let two directories claim
     * one trust decision.
     */
    const canonicalize = Effect.fnUntraced(function* (input: string) {
      if (!path.isAbsolute(input)) return undefined;
      const probe = options.createExecutionEnv(path.resolve(input));
      const canonical = yield* Effect.promise(() => probe.canonicalPath("."));
      if (!canonical.ok) return undefined;
      const info = yield* Effect.promise(() => probe.fileInfo(canonical.value));
      if (!info.ok || info.value.kind !== "directory") return undefined;
      return WorkspaceDirectory.make(canonical.value);
    });

    const open = Effect.fn("Workspace.open")(function* (input: Rpc.Payload<typeof Open>) {
      const directory = yield* canonicalize(input.directory);
      if (!directory) return yield* new OpenError({ directory: input.directory });
      const id = (yield* Ref.get(trusted)).get(directory);
      if (!id) return { type: "trust_required", directory } satisfies OpenResult;
      return { type: "ready", id, directory } satisfies OpenResult;
    });

    const find = Effect.fn("Workspace.find")(function* (input: {
      readonly workspaceId: WorkspaceId;
    }) {
      for (const [directory, id] of yield* Ref.get(trusted)) {
        if (id === input.workspaceId) return { id, directory } satisfies Info;
      }
      return yield* new NotFoundError({ workspaceId: input.workspaceId });
    });

    const env = Effect.fn("Workspace.env")(function* (input: {
      readonly workspaceId: WorkspaceId;
    }) {
      const existing = (yield* Ref.get(envs)).get(input.workspaceId);
      if (existing) return existing;
      // find() first: an unknown id must fail before anything is created.
      const workspace = yield* find(input);
      const created = options.createExecutionEnv(workspace.directory);
      // Re-read under update so two concurrent callers converge on one
      // instance; the loser's environment is dropped unused.
      const winner = yield* Ref.modify(envs, (map) => {
        const raced = map.get(workspace.id);
        if (raced) return [raced, map] as const;
        return [created, new Map(map).set(workspace.id, created)] as const;
      });
      return winner;
    });

    const locate = Effect.fnUntraced(function* (input: { readonly directory: string }) {
      for (const [directory, id] of yield* Ref.get(trusted)) {
        if (directory === input.directory) return { id, directory } satisfies Info;
      }
      return undefined;
    });

    const trust = Effect.fn("Workspace.trust")(function* (input: Rpc.Payload<typeof Trust>) {
      const directory = yield* canonicalize(input.directory);
      if (!directory) return yield* new TrustError({ directory: input.directory });
      // Mint outside Ref.modify so the update function stays pure; the fresh
      // id is simply unused when the directory is already trusted.
      const id = mintWorkspaceId();
      type Trusted = ReadonlyMap<WorkspaceDirectory, WorkspaceId>;
      const map = yield* Ref.modify(trusted, (current): [Trusted | undefined, Trusted] => {
        if (current.has(directory)) return [undefined, current];
        const next = new Map(current).set(directory, id);
        return [next, next];
      });
      if (map === undefined) return;
      // Write-through: a decision the file does not hold was never recorded,
      // so a failed write fails the trust call rather than lying until the
      // next restart. The lease guarantees one writer, so last-write-wins
      // inside this host is the only ordering that exists.
      const written = yield* Effect.promise(() =>
        options.storage.writeFile(trustFile, serializeTrust(map)),
      );
      if (!written.ok) {
        yield* Ref.update(trusted, (current) => {
          const next = new Map(current);
          next.delete(directory);
          return next;
        });
        return yield* new TrustError({ directory: input.directory, cause: written.error });
      }
    });

    return { open, trust, find, env, locate } satisfies Interface;
  });

/**
 * The service key and its construction, declared together: Effect v4's
 * `Context.Service` takes `make` as an option, so `Service.make(options)` is
 * the one parameterized constructor of this service.
 *
 * @category service
 */
export class Service extends Context.Service<Service, Interface>()("honk/Workspace", { make }) {}

/**
 * Builds the workspace service over a `Path.Path` implementation.
 *
 * One layer instance owns one trust store. Providing this layer twice in the
 * same host splits that store, and an id minted by one half is unknown to the
 * other — so hosts must build it once and share it.
 *
 * @category layers
 */
export const layer = (options: LayerOptions) => Layer.effect(Service, Service.make(options));

/**
 * {@link layer} with POSIX path rules, for tests and browser-adjacent hosts.
 *
 * TODO(core-migration §6): a Node host should provide its platform `Path`
 * implementation (`NodePath.layer`) instead, so directories canonicalize the
 * way the operating system resolves them rather than the way POSIX rules
 * assume.
 *
 * @category layers
 */
export const defaultLayer = (options: LayerOptions) =>
  layer(options).pipe(Layer.provide(Path.layer));

/**
 * Binds the workspace RPCs to {@link Service}.
 *
 * Handlers stay thin: decoding already happened at the RPC boundary, so they
 * only bind payloads to service methods. Provide {@link layer} to satisfy the
 * `Service` requirement.
 *
 * @category layers
 */
export const rpcLayer = Rpcs.toLayer(
  Effect.gen(function* () {
    const workspace = yield* Service;
    return {
      "workspace.open": (payload) => workspace.open(payload),
      "workspace.trust": (payload) => workspace.trust(payload),
    };
  }),
);

/** Mints the id that stands for one recorded trust decision. */
function mintWorkspaceId() {
  return WorkspaceId.make(crypto.randomUUID());
}

/** Where trust decisions persist, relative to the host data directory. */
const trustFile = "workspaces.json";

/**
 * The stored shape: an array of decisions rather than an object keyed by
 * path, so a directory containing `__proto__` or a dot is just data.
 */
const TrustFile = Schema.Array(Schema.Struct({ directory: WorkspaceDirectory, id: WorkspaceId }));

/**
 * Reads the persisted trust decisions, or starts empty when none were made.
 *
 * A missing file is the ordinary first run. A file that exists but cannot be
 * read or decoded is a broken host store, and construction fails loudly
 * rather than silently re-asking for trust the user already gave — a decision
 * store that "recovers" by forgetting decisions is worse than one that stops.
 */
const loadTrust = Effect.fnUntraced(function* (storage: ExecutionEnv) {
  const read = yield* Effect.promise(() => storage.readTextFile(trustFile));
  if (!read.ok) {
    if (read.error.code === "not_found") {
      return new Map<WorkspaceDirectory, WorkspaceId>();
    }
    return yield* Effect.die(read.error);
  }
  const decoded = yield* Schema.decodeUnknownEffect(TrustFile)(JSON.parse(read.value)).pipe(
    Effect.orDie,
  );
  return new Map(decoded.map((entry) => [entry.directory, entry.id] as const));
});

/** The write-through form of the trust map. */
function serializeTrust(map: ReadonlyMap<WorkspaceDirectory, WorkspaceId>): string {
  const entries = [...map].map(([directory, id]) => ({ directory, id }));
  return `${JSON.stringify(entries, null, 2)}\n`;
}

// Extensionless on purpose: consumers bundle this source (desktop keeps
// @honk/core in devDependencies so electron-vite bundles it), and consumer
// tsconfigs do not enable allowImportingTsExtensions.
// oxlint-disable-next-line import/no-self-import -- spec/effect.md self-reexport pattern; star imports are banned for consumers.
export * as Workspace from "./workspace";
