/**
 * The public entry point to Honk Core.
 *
 * Three functions define the whole surface:
 *
 * - {@link createHonkCore} starts one host for one data directory. It resolves
 *   after the host owns its stores and services, or rejects. There is no
 *   `init()`, no `ready` promise, and no `isReady` flag.
 * - {@link HonkCore.client} attaches one in-process interface to that running
 *   host. It is synchronous because the core is already ready, and it never
 *   starts a second core.
 * - {@link createHonkClient} attaches the same interface to a host in another
 *   process, over HTTP.
 *
 * @example
 * ```ts
 * import { createHonkCore } from "@honk/core";
 *
 * await using core = await createHonkCore({ dataDirectory, createExecutionEnv });
 * const sdk = core.client();
 *
 * const opened = await sdk.workspace.open({ directory });
 * if (opened.type === "trust_required") {
 *   await sdk.workspace.trust({ directory: opened.directory });
 * }
 *
 * const workspace = await sdk.workspace.open({ directory });
 * if (workspace.type !== "ready") return;
 *
 * const session = await sdk.session.create({ workspaceId: workspace.id });
 * await sdk.session.prompt({ sessionId: session.id, text: "Explain the auth flow" });
 *
 * const state = await sdk.session.reload({ sessionId: session.id });
 * render(state.entries);
 * ```
 *
 * @see spec/core.md section 6 for the construction contract this module implements.
 * @module
 */

import type { CredentialStore, MutableModels } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { Effect, Exit, Layer, ManagedRuntime, Scope, Stream } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import type { Rpc, RpcGroup } from "effect/unstable/rpc";
import { RpcClient, RpcSerialization, RpcServer } from "effect/unstable/rpc";

import { Files } from "./files";
import { Git } from "./git";
import { Lease } from "./lease";
import { Models } from "./models";
import { Session } from "./session";
import { Tools } from "./tools";
import { Workspace } from "./workspace";

// Pi and Honk error classes are re-exported here so an application narrows
// every SDK rejection from one import without depending on AgentHarness
// (spec/core.md section 6). The Pi classes are the real ones: a rejected
// sdk.session call carries the same instance Pi threw.
export { AgentHarnessError, SessionError } from "@earendil-works/pi-agent-core";
export { LeaseError } from "./lease";
// Tools ships the write-attribution classifier (`Tools.writesOf`) so surfaces
// share one read-shaped/write-shaped split with the checkpoint gate instead
// of keeping a second tool list.
export { Files, Git, Lease, Models, Session, Tools, Workspace };

/**
 * The complete Honk command catalog: one RPC group covering every namespace.
 *
 * Hosts serve this group and clients derive from it, so the wire contract has
 * exactly one owner. Merging happens here rather than in a host package so a
 * desktop, web, or test host cannot assemble a different catalog.
 *
 * @category catalog
 */
export const Rpcs = Workspace.Rpcs.merge(Session.Rpcs, Files.Rpcs, Git.Rpcs, Models.Rpcs);

/**
 * A request/response SDK method derived from its RPC definition.
 *
 * The client repeats no payload, result, or error type: `Call` reads the
 * payload and success types straight off the `Rpc`, so a schema change in
 * `session` or `workspace` reaches the public API with no edit here.
 *
 * The returned promise fulfills with the success value or rejects with the
 * owning domain's error instance. Effect's `runPromise` squashes the failure
 * cause, so `catch` receives the real `Workspace.OpenError` or
 * `Session.NotFoundError` — not a wrapper to unpack.
 *
 * @example
 * ```ts
 * try {
 *   await sdk.session.reload({ sessionId });
 * } catch (error: unknown) {
 *   if (error instanceof Session.NotFoundError) forgetSession(sessionId);
 *   else throw error;
 * }
 * ```
 *
 * @category types
 */
export type Call<R extends Rpc.Any> = (input: Rpc.PayloadConstructor<R>) => Promise<Rpc.Success<R>>;

/**
 * A streaming SDK method derived from its RPC definition.
 *
 * Streams reach Promise-world callers as an `AsyncIterable`, so `for await`
 * consumes them and `break` or `return` detaches. Detaching closes only this
 * subscription; the run continues and other clients keep receiving events.
 *
 * @example
 * ```ts
 * for await (const frame of sdk.session.events({ sessionId })) {
 *   if (frame.type === "live") await reloadAuthoritative();
 *   else applyEvent(frame.event);
 * }
 * ```
 *
 * @category types
 */
export type Subscribe<R extends Rpc.Any> = (
  input: Rpc.PayloadConstructor<R>,
) => AsyncIterable<Rpc.SuccessChunk<R>>;

/**
 * One SDK namespace, derived from a domain's `commands` record: one
 * {@link Call} per command. The namespaces below repeat no method lists — a
 * command added to a domain's record appears here with no edit.
 *
 * @category types
 */
export type NamespaceOf<Commands extends Record<string, Rpc.Any>> = {
  readonly [K in keyof Commands]: Call<Commands[K]>;
};

/**
 * One interface attached to a running core.
 *
 * Namespaces group calls; they do not hide execution. Every method takes one
 * object argument so the SDK can add optional fields without positional
 * overloads, and every returned value is plain data that can live in
 * application state or cross a worker boundary.
 *
 * A client owns its connection, its subscriptions, and its disposable reload
 * buffer. The core owns sessions, harnesses, storage, and the writer lease.
 *
 * @category client
 */
export interface HonkClient {
  /**
   * Workspace trust: the only permission gate in Honk.
   *
   * `open` answers `trust_required` for a directory the user has not trusted,
   * which is a product state and not a failure. It must not read
   * workspace-controlled configuration or create a harness before that check.
   */
  readonly workspace: NamespaceOf<typeof Workspace.commands>;

  /**
   * Session lifecycle and run control, each call landing on the real Pi
   * `AgentHarness` for that session.
   *
   * `reload` is the authoritative read: idempotent, safe while a run is
   * active, and independent of which clients are attached. `events` is the
   * temporary notification channel that lets an attached interface update
   * without reloading after every change.
   */
  readonly session: NamespaceOf<typeof Session.commands> & {
    readonly events: Subscribe<typeof Session.Events>;

    /**
     * The read-to-live handoff, packaged (spec section 9): subscribe, then
     * one authoritative read, then advisory events with a repair read at
     * each commit point — serialized, so reads never overlap. A surface
     * renders `state` frames as truth and `event` frames as liveness, and
     * reimplements no timing rules of its own.
     */
    readonly watch: (input: {
      readonly sessionId: Session.SessionId;
    }) => AsyncIterable<SessionWatchFrame>;
  };

  /**
   * Reading and writing inside a trusted workspace.
   *
   * Every path is workspace-relative in both directions, and one that escapes
   * the workspace directory fails rather than resolving. No absolute host path
   * reaches a client.
   */
  readonly files: NamespaceOf<typeof Files.commands>;

  /**
   * Version control for a trusted workspace.
   *
   * Workspace-scoped by nature: `status` and `diff` answer "what changed in
   * this checkout", which is a different question from
   * {@link HonkClient.session.changes}'s "what did this conversation change".
   * A review surface intersects the two.
   *
   * Checkpoints are the snapshot primitive under per-turn changes: hidden
   * whole-workspace commits the session layer captures on every settled turn,
   * diffs to answer "what did *this* turn do", and restores to revert to one.
   */
  readonly git: NamespaceOf<typeof Git.commands>;

  /**
   * The provider catalog and the credentials that unlock it.
   *
   * `list` is the settings read: every provider with its auth status and
   * models, configured or not. `setCredential` stores an API key;
   * `deleteCredential` is logout. Which model a session runs on is chosen at
   * {@link HonkClient.session.create} and recorded in the transcript.
   */
  readonly models: NamespaceOf<typeof Models.commands>;

  /**
   * Detaches this interface.
   *
   * Closing a client ends its subscriptions and releases its resources. It
   * does not close the core and does not stop an active run: a browser
   * refresh or a lost phone connection must never end work in progress.
   */
  readonly close: () => Promise<void>;
}

/**
 * Everything {@link createHonkCore} needs to own a data directory.
 *
 * @category construction
 */
export interface HonkCoreOptions {
  /**
   * The directory this core owns.
   *
   * Pi session transcripts live under `sessions/`, trust decisions in
   * `workspaces.json`, provider credentials in `auth.json`, and the writer
   * lease in `lease`. One live core per data directory: construction fails
   * with {@link Lease.LeaseError} while another host's lease is fresh.
   */
  readonly dataDirectory: string;

  /**
   * Replaces the built-in provider catalog. A test seam, not configuration.
   *
   * Production omits it: the core builds `builtinModels({ credentials })`
   * over its own persisted credential store, so every Pi provider is present
   * and a stored key or ambient env var unlocks it (spec section 11). Tests
   * pass a collection carrying Pi's faux provider, whose auth always
   * resolves — fixtures run offline with no credential setup.
   */
  readonly createModels?: (credentials: CredentialStore) => MutableModels;

  /**
   * Builds the filesystem and shell environment for one trusted workspace.
   *
   * Injected rather than imported so `@honk/core` carries no platform
   * dependency of its own. A Node host passes
   * `(cwd) => new NodeExecutionEnv({ cwd })`; a test passes the same thing or a
   * stub. One instance per workspace is shared by the Pi harness's tools,
   * `sdk.files`, and `sdk.git`, which is what keeps the workspace directory the
   * boundary for all three.
   */
  readonly createExecutionEnv: Workspace.LayerOptions["createExecutionEnv"];
}

/**
 * A running Honk Core host.
 *
 * The host outlives every interface attached to it. Renderer reloads, network
 * drops, and closed clients leave it running; only the host lifecycle closes
 * the core and releases its writer lease.
 *
 * @category construction
 */
export interface HonkCore {
  /**
   * Attaches another in-process interface to this core.
   *
   * Synchronous by contract: the core is already ready, so there is nothing to
   * await. In-process clients speak the same {@link Rpcs} group as remote ones
   * with the serialization step removed, which keeps one command catalog
   * rather than a fast path that can drift from the wire path.
   */
  readonly client: () => HonkClient;

  /**
   * Shuts the core down and releases its data directory.
   *
   * TODO(core-migration §10, §16): this closes layers but settles nothing.
   * Shutdown must reach every open harness — `requestShutdown()` then
   * `waitForShutdown()`, or `waitForIdle()` first under a finish-first policy —
   * and dispose the shared session store before the lease is released. The
   * host policy for active work is still an open question in spec section 16.
   */
  readonly close: () => Promise<void>;

  /** Supports `await using core = await createHonkCore(...)`. */
  readonly [Symbol.asyncDispose]: () => Promise<void>;
}

/**
 * The core's whole service graph, as one layer that requires nothing.
 *
 * It outputs the RPC handler services for every command in {@link Rpcs} and
 * keeps `Session.Service` and `Workspace.Service` private. There is one
 * assembly of a Honk Core host, and this is it: {@link createHonkCore} runs it
 * in a `ManagedRuntime` for in-process clients, and a host that serves the
 * group over a transport provides this same layer to its RPC server. A host
 * that re-assembled the parts itself could drift from this one.
 *
 * @example
 * ```ts
 * // Serving the same core over a transport instead of in process.
 * RpcServer.layerHttp({ group: Rpcs, path: "/rpc", protocol: "http" }).pipe(
 *   Layer.provide(HonkCore.layer(options)),
 *   Layer.provide(RpcSerialization.layerNdjson),
 * );
 * ```
 *
 * @category construction
 */
export const layer = (options: HonkCoreOptions) => {
  // One environment for everything the host persists: session transcripts,
  // the trust store, credentials, and the lease all live under the data
  // directory and go through this instance.
  const storage = options.createExecutionEnv(options.dataDirectory);

  // The credential store and the collection are built as a pair: the
  // collection resolves request auth through the same store the models RPCs
  // write, so a key stored through settings unlocks the very next request.
  const credentials = Models.credentialStore(storage);
  const collection = options.createModels?.(credentials) ?? builtinModels({ credentials });
  const modelsLayer = Models.layer({ collection, credentials });

  // One Workspace instance backs both the trust RPCs and session lookup.
  // Providing a second would split the trust store, and a WorkspaceId minted
  // by one half would be unknown to the other.
  const services = Layer.mergeAll(
    // Session captures a checkpoint per settled turn through Git.Service and
    // builds harnesses over Models.Service. The same layer references appear
    // twice, so Effect's layer memoization builds one instance of each,
    // shared with their own RPC handlers.
    Session.layer({ storage }).pipe(Layer.provide(Git.defaultLayer), Layer.provide(modelsLayer)),
    Files.defaultLayer,
    Git.defaultLayer,
    modelsLayer,
  ).pipe(
    // One Workspace instance for all of them: sessions, files, and git resolve
    // the same trust decisions and share one ExecutionEnv per workspace.
    // TODO(core-migration §6): POSIX paths. A Node host needs NodePath.layer so
    // workspace directories canonicalize the way the platform resolves them.
    Layer.provideMerge(
      Workspace.defaultLayer({ createExecutionEnv: options.createExecutionEnv, storage }),
    ),
  );

  // The lease merges beside the services rather than gating them: layers
  // build concurrently, so a losing host may read the stores before its
  // construction fails, but it can never finish constructing — and only a
  // constructed core mutates anything.
  const lease = Layer.effectDiscard(Lease.acquire(storage, options.dataDirectory));

  return Layer.mergeAll(
    Workspace.rpcLayer,
    Session.rpcLayer,
    Files.rpcLayer,
    Git.rpcLayer,
    Models.rpcLayer,
    lease,
  ).pipe(Layer.provide(services));
};

/**
 * Builds the namespace facade over a flat RPC client.
 *
 * Written once and shared by {@link createHonkCore} and
 * {@link createHonkClient}: the two constructors differ only in transport and
 * `close`, so the method wiring must not exist twice. Method types derive from
 * the {@link Rpcs} definitions through {@link NamespaceOf}, so a missing or
 * misbound method is a type error, not a runtime surprise.
 *
 * `run` executes one request/response effect; `iterate` turns a stream into
 * the caller's `AsyncIterable`. Both close over the constructor's runtime.
 */
const makeSdk = <E>(
  rpc: RpcClient.FromGroup<typeof Rpcs, E>,
  run: <A, EX>(effect: Effect.Effect<A, EX>) => Promise<A>,
  iterate: <A, EX>(stream: Stream.Stream<A, EX>) => AsyncIterable<A>,
): Omit<HonkClient, "close"> => {
  const session = {
    create: (input) => run(rpc["session.create"](input)),
    prompt: (input) => run(rpc["session.prompt"](input)),
    steer: (input) => run(rpc["session.steer"](input)),
    followUp: (input) => run(rpc["session.follow_up"](input)),
    gitAction: (input) => run(rpc["session.git_action"](input)),
    abort: (input) => run(rpc["session.abort"](input)),
    reload: (input) => run(rpc["session.reload"](input)),
    changes: (input) => run(rpc["session.changes"](input)),
    setWorkspace: (input) => run(rpc["session.set_workspace"](input)),
    revert: (input) => run(rpc["session.revert"](input)),
    list: (input) => run(rpc["session.list"](input)),
    get: (input) => run(rpc["session.get"](input)),
    delete: (input) => run(rpc["session.delete"](input)),
    events: (input) => iterate(rpc["session.events"](input)),
  } satisfies Omit<HonkClient["session"], "watch">;

  return {
    workspace: {
      open: (input) => run(rpc["workspace.open"](input)),
      trust: (input) => run(rpc["workspace.trust"](input)),
    },
    session: { ...session, watch: (input) => watchSession(session, input) },
    files: {
      find: (input) => run(rpc["files.find"](input)),
      list: (input) => run(rpc["files.list"](input)),
      read: (input) => run(rpc["files.read"](input)),
      write: (input) => run(rpc["files.write"](input)),
      delete: (input) => run(rpc["files.delete"](input)),
      createDirectory: (input) => run(rpc["files.create_directory"](input)),
      rename: (input) => run(rpc["files.rename"](input)),
    },
    git: {
      status: (input) => run(rpc["git.status"](input)),
      diff: (input) => run(rpc["git.diff"](input)),
      filePatch: (input) => run(rpc["git.file_patch"](input)),
      fileImage: (input) => run(rpc["git.file_image"](input)),
      fileContent: (input) => run(rpc["git.file_content"](input)),
      branches: (input) => run(rpc["git.branches"](input)),
      checkout: (input) => run(rpc["git.checkout"](input)),
      pull: (input) => run(rpc["git.pull"](input)),
      discard: (input) => run(rpc["git.discard"](input)),
      captureCheckpoint: (input) => run(rpc["git.capture_checkpoint"](input)),
      checkpoints: (input) => run(rpc["git.checkpoints"](input)),
      checkpointChanges: (input) => run(rpc["git.checkpoint_changes"](input)),
      checkpointDiff: (input) => run(rpc["git.checkpoint_diff"](input)),
      restoreCheckpoint: (input) => run(rpc["git.restore_checkpoint"](input)),
      restoreFiles: (input) => run(rpc["git.restore_files"](input)),
      deleteCheckpoints: (input) => run(rpc["git.delete_checkpoints"](input)),
    },
    models: {
      list: (input) => run(rpc["models.list"](input)),
      setCredential: (input) => run(rpc["models.set_credential"](input)),
      deleteCredential: (input) => run(rpc["models.delete_credential"](input)),
    },
  };
};

/**
 * Starts one Honk Core host for one data directory.
 *
 * Construction has no half-ready state. The returned promise resolves only
 * after the host's services are built and usable, and rejects if any required
 * part cannot start — in which case nothing is left running to clean up.
 *
 * @throws Rejects with the layer construction error if the host cannot start.
 *
 * @example
 * ```ts
 * const core = await createHonkCore({ dataDirectory, createExecutionEnv });
 * const desktop = core.client();
 * const inspector = core.client(); // a second interface, still one core
 * ```
 *
 * @category construction
 */
export const createHonkCore = async (options: HonkCoreOptions): Promise<HonkCore> => {
  const runtime = ManagedRuntime.make(layer(options));

  // Awaiting the context is what turns "the layer describes a host" into "the
  // host exists". A failure here is a construction failure, so the runtime is
  // disposed before the rejection escapes.
  const context = await runtime.context().catch(async (cause: unknown) => {
    await runtime.dispose();
    throw cause;
  });

  /**
   * Builds one client over its own scope.
   *
   * The scope is forked from the core's scope, so closing the client releases
   * only this interface while closing the core releases every interface it
   * handed out.
   */
  const client = (): HonkClient => {
    const scope = Scope.forkUnsafe(runtime.scope);

    // Synchronous by construction: the runtime's services are already built,
    // and wiring two in-memory halves together performs no I/O.
    const rpc = runtime.runSync(
      makeInProcessRpcClient().pipe(Effect.provideService(Scope.Scope, scope)),
    );

    return {
      ...makeSdk(
        rpc,
        (effect) => runtime.runPromise(effect),
        (stream) => Stream.toAsyncIterableWith(stream, context),
      ),
      close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
    };
  };

  const close = () => runtime.dispose();

  return { client, close, [Symbol.asyncDispose]: close };
};

/**
 * What {@link createHonkClient} needs to reach a running host.
 *
 * @category construction
 */
export interface HonkClientOptions {
  /** Base URL of a host serving {@link Rpcs}, e.g. `http://127.0.0.1:9163`. */
  readonly url: string;
}

/**
 * Attaches a {@link HonkClient} to a host over HTTP.
 *
 * The remote counterpart of {@link HonkCore.client}: the same interface, the
 * same command catalog, with ndjson framing so the session events stream flows
 * over a chunked response. Both constructors build their facade through the
 * one shared `makeSdk`, so the two cannot drift.
 *
 * TODO(core-migration §6): Honk and Pi protocol version negotiation that fails
 * the connection on mismatch.
 *
 * @example
 * ```ts
 * const sdk = await createHonkClient({ url: endpoint.baseUrl });
 * const workspace = await sdk.workspace.open({ directory });
 * ```
 *
 * @category construction
 */
export const createHonkClient = async (options: HonkClientOptions): Promise<HonkClient> => {
  const runtime = ManagedRuntime.make(
    RpcClient.layerProtocolHttp({ url: `${options.url}/rpc` }).pipe(
      Layer.provide(FetchHttpClient.layer),
      Layer.provide(RpcSerialization.layerNdjson),
    ),
  );
  const context = await runtime.context().catch(async (cause: unknown) => {
    await runtime.dispose();
    throw cause;
  });

  // The client lives in the runtime's own scope, so it lasts until close().
  const rpc = await runtime.runPromise(
    RpcClient.make(Rpcs).pipe(Effect.provideService(Scope.Scope, runtime.scope)),
  );

  return {
    ...makeSdk(
      rpc,
      (effect) => runtime.runPromise(effect),
      (stream) => Stream.toAsyncIterableWith(stream, context),
    ),
    close: () => runtime.dispose(),
  };
};

/**
 * One frame of {@link HonkClient.session.watch}.
 *
 * `state` is authoritative: committed entries, run status, and per-turn
 * change receipts from one consistent read. `event` is advisory — Pi's live
 * event, for streaming text and activity — and is always eventually followed
 * by the `state` frame that makes it durable or moot.
 *
 * @category client
 */
export type SessionWatchFrame =
  | {
      readonly type: "state";
      readonly entries: readonly Session.SessionTreeEntry[];
      readonly status: Session.RunStatus;
      readonly turns: Session.ChangesOutput["turns"];
    }
  | { readonly type: "event"; readonly event: Session.AgentHarnessEvent };

/** The session calls a watch composes; both client constructors pass their own. */
interface SessionWatchCalls {
  readonly reload: Call<typeof Session.Reload>;
  readonly changes: Call<typeof Session.Changes>;
  readonly events: Subscribe<typeof Session.Events>;
}

/**
 * The watch policy, once, for every client (spec/core.md section 9).
 *
 * The `live` head frame proves the subscription is active before the first
 * authoritative read, so nothing can slip between subscribe and reload.
 * After that, a commit point — a message committed, a run settled, a run
 * started (which committed the prompt) — triggers one repair read; the
 * generator serializes them by construction, so reads never overlap and a
 * burst of events cannot pile up concurrent reloads. Receipts refresh only
 * where they can change: at attach and at settlement.
 *
 * TODO(core-migration §9): each repair read is still a full transcript read,
 * O(n^2) over a long thread. Applying committed entries from the events
 * themselves needs Pi to carry the entry (not just the message) in
 * `message_end`.
 */
async function* watchSession(
  calls: SessionWatchCalls,
  input: { readonly sessionId: Session.SessionId },
): AsyncGenerator<SessionWatchFrame, void, undefined> {
  let turns: Session.ChangesOutput["turns"] = [];

  const state = async (refreshTurns: boolean): Promise<SessionWatchFrame> => {
    if (refreshTurns) {
      // A workspace without a repository has no receipts; that must not end
      // the watch, so a failed changes read keeps the previous receipts.
      turns = await calls.changes(input).then(
        (output) => output.turns,
        () => turns,
      );
    }
    const snapshot = await calls.reload(input);
    return { type: "state", entries: snapshot.entries, status: snapshot.status, turns };
  };

  for await (const frame of calls.events(input)) {
    if (frame.type === "live") {
      yield await state(true);
      continue;
    }
    yield { type: "event", event: frame.event };
    const kind = frame.event.type;
    if (kind === "agent_start" || kind === "message_end") {
      yield await state(false);
    } else if (kind === "settled") {
      yield await state(true);
    }
  }
}

/**
 * The in-process transport: a client and a server for the same group, wired
 * directly to each other with no serializer, socket, or HTTP framing.
 *
 * Requests, stream chunks, acknowledgements, and interrupts still travel the
 * normal client/server machinery, so an in-process client exercises the same
 * code path a remote one does. Effect's `RpcTest.makeClient` is the upstream
 * reference for this wiring.
 */
const makeInProcessRpcClient = Effect.fnUntraced(function* () {
  // The two halves are mutually recursive: the server answers requests, so it
  // needs the client's inbox before the client exists. One of them therefore
  // has to be named ahead of its construction, which is why this type is
  // spelled out rather than inferred. `RpcGroup.Rpcs` turns the group value
  // into the RPC union the client constructor is generic over.
  type ClientHalf = Effect.Success<
    ReturnType<typeof RpcClient.makeNoSerialization<RpcGroup.Rpcs<typeof Rpcs>, never, false>>
  >;

  // Holding the write function in a mutable binding keeps that ordering
  // explicit. A definite-assignment assertion would only hide it, and
  // spec/core.md section 14 rules out assertions here.
  let inbox: ClientHalf["write"] | undefined;

  const server = yield* RpcServer.makeNoSerialization(Rpcs, {
    onFromServer: (response) => (inbox === undefined ? Effect.void : inbox(response)),
  });

  const client = yield* RpcClient.makeNoSerialization(Rpcs, {
    supportsAck: true,
    onFromClient: ({ message }) => server.write(0, message),
  });

  inbox = client.write;
  return client.client;
});

// Extensionless on purpose: consumers bundle this source (desktop keeps
// @honk/core in devDependencies so electron-vite bundles it), and consumer
// tsconfigs do not enable allowImportingTsExtensions.
// oxlint-disable-next-line import/no-self-import -- spec/effect.md self-reexport pattern; star imports are banned for consumers.
export * as HonkCore from "./honk-core";
