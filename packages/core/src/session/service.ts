/**
 * The session service: every command from `./contract`, landing on a real Pi
 * `AgentHarness`, with per-turn checkpoints gated by `./attribution`.
 *
 * @module
 */

import type {
  AgentHarnessEvent,
  AgentHarnessOptions,
  Session as PiSession,
  SessionTreeEntry,
} from "@earendil-works/pi-agent-core";
import { AgentHarness, AgentHarnessError, JsonlSessionRepo, SessionError } from "@earendil-works/pi-agent-core";
import type { Models as PiModels } from "@earendil-works/pi-ai";
import { Context, Effect, Layer, PubSub, Ref, Schema, Stream } from "effect";
import type { Rpc } from "effect/unstable/rpc";

import { Git } from "../git";
import { Models } from "../models";
import { Tools } from "../tools";
import { Workspace } from "../workspace";
import { gateTurnFiles, modelOf, turnToolWrites } from "./attribution";
import type {
  Abort,
  AbortOutput,
  ChangesOutput,
  Create,
  Delete,
  FollowUp,
  Get,
  Interface,
  ListOutput,
  PiError,
  Prompt,
  Revert,
  RunStatus,
  SessionInfo,
  SessionSummary,
  SetWorkspace,
  Steer,
  TurnChanges,
} from "./contract";
import { NotFoundError, Rpcs, SessionId } from "./contract";

/**
 * Runs one Pi operation, keeping Pi's typed failures and Pi's crashes apart.
 *
 * A rejection that is a Pi error class is an expected outcome — a busy
 * harness, steering while idle, a broken session read — and lands on the
 * error channel as itself. Anything else is a bug and stays a defect.
 *
 * Interruption is deliberately not wired to `harness.abort()`: a run belongs
 * to the session, not to the caller that happened to await it, and a client
 * that disconnects mid-prompt must never end work in progress (spec section
 * 10). Ending a run is its own command.
 */
const runPi = <A>(run: () => Promise<A>): Effect.Effect<A, PiError> =>
  Effect.tryPromise({ try: run, catch: (cause) => cause }).pipe(
    Effect.catch((cause) =>
      cause instanceof AgentHarnessError || cause instanceof SessionError
        ? Effect.fail(cause)
        : Effect.die(cause),
    ),
  );

/**
 * What {@link layer} needs beyond its services.
 *
 * The model collection is not here: it lives in {@link Models.Service}, which
 * this layer requires, so the harnesses stream through the same collection
 * the models RPCs describe and credential writes unlock.
 *
 * @category layers
 */
export interface LayerOptions {
  /**
   * The host data directory's environment: Pi session transcripts persist in
   * its `sessions/` subtree through the JSONL repository. The same instance
   * the workspace trust store and lease use.
   */
  readonly storage: Workspace.ExecutionEnv;
}

/**
 * Builds the harness for one trusted workspace, with Pi's execution tools
 * bound to that workspace's environment.
 *
 * A top-level helper rather than an inline construction so {@link
 * WorkspaceHarness} can name the resulting type. `AgentHarness` is generic over
 * its tool context and tool union, and both follow from the tools passed here.
 */
const createWorkspaceHarness = (input: {
  readonly session: PiSession;
  readonly models: PiModels;
  readonly model: AgentHarnessOptions["model"];
  readonly binding: SessionBinding;
}) =>
  new AgentHarness({
    session: input.session,
    models: input.models,
    model: input.model,
    tools: [...Tools.builtins()],
    // The provider form of Pi's tool context: resolved at each turn snapshot,
    // so setWorkspace swaps the binding and the next turn runs in the new
    // directory while a run already in progress finishes in its old one.
    toolContext: () => ({ env: input.binding.env }),
  });

/** The harness type Honk actually opens: Pi's, with execution tools bound. */
type WorkspaceHarness = ReturnType<typeof createWorkspaceHarness>;

/**
 * Which workspace the session runs in right now.
 *
 * Mutable because `/cd` is an operation, not a new session: the harness reads
 * it through its tool-context provider, and `sdk.files`/`sdk.git` calls keep
 * addressing workspaces by id regardless.
 */
interface SessionBinding {
  workspace: Workspace.Info;
  env: Workspace.ExecutionEnv;
}

/** One captured checkpoint: which entry settled it, in which workspace's repository. */
interface Snapshot {
  readonly entryId: string;
  readonly workspaceId: Workspace.WorkspaceId;
}

/**
 * Private host runtime state for one open session.
 *
 * Never serialized and never exposed. Desktop, web, and mobile see commands and
 * Pi values; an `AgentHarness` instance goes only to in-process extensions.
 */
interface OpenSession {
  readonly session: PiSession;
  readonly harness: WorkspaceHarness;
  readonly events: PubSub.PubSub<AgentHarnessEvent>;
  readonly binding: SessionBinding;

  /**
   * The session's checkpoint history, in capture order.
   *
   * Host bookkeeping, not a second transcript: the snapshots themselves live
   * in the workspace repository, and this list only remembers which
   * repository holds each one — which is what lets a session that `/cd`s span
   * two object stores without guessing.
   */
  readonly snapshots: Snapshot[];

  /**
   * Mutated from Pi's plain event callback, where Effect refs are out of
   * reach, and read only by `reload`.
   *
   * TODO(core-migration effect-v4): `SubscriptionRef` models this properly —
   * `getUnsafe` for the Pi callback, an Effect read for `reload`, and
   * `changes` as a stream so status reaches clients without a reload.
   */
  readonly run: { status: RunStatus };
}

/**
 * Builds the session service.
 *
 * Requires {@link Workspace.Service}, {@link Git.Service}, and
 * {@link Models.Service} — each the *same* instance its own RPCs use. A second
 * workspace instance splits the trust store; a second models instance splits
 * the catalog credential writes unlock.
 *
 * @example
 * ```ts
 * const services = Session.layer({ storage }).pipe(
 *   Layer.provide(Models.layer({ collection, credentials })),
 *   Layer.provideMerge(Workspace.defaultLayer({ createExecutionEnv, storage })),
 * );
 * ```
 *
 * @category layers
 */
export const layer = (options: LayerOptions) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const workspaces = yield* Workspace.Service;
      const git = yield* Git.Service;
      const models = yield* Models.Service;

      // One JSONL transcript per session under <dataDirectory>/sessions,
      // owned by Pi's repository for the core's whole lifetime. The durable
      // truth spec section 9 talks about is these files.
      const repo = new JsonlSessionRepo({ fs: options.storage, sessionsRoot: "sessions" });

      // TODO(core-migration §10, §16): sessions are resources, not map
      // entries. Nothing ever calls harness.requestShutdown() or
      // waitForShutdown(), and nothing evicts a closed session, so this map
      // only grows. The fix is explicit lifecycle — a scoped finalizer that
      // settles every open harness at host shutdown, plus deliberate
      // eviction — NOT RcMap: spec/effect.md forbids refcounting a resource
      // that non-Effect holders (a Pi harness mid-run) still reference.
      const open = yield* Ref.make<ReadonlyMap<SessionId, OpenSession>>(new Map());

      /** Reads one session's stored metadata, or nothing if it never existed. */
      const findMetadata = Effect.fnUntraced(function* (sessionId: SessionId) {
        const listed = yield* runPi(() => repo.list());
        return listed.find((metadata) => metadata.id === sessionId);
      });

      /** The transcript record of one /cd: which workspace the session moved to. */
      const WorkspaceChangeData = Schema.Struct({ workspaceId: Workspace.WorkspaceId });

      /**
       * Resolves a `honk.workspace_change` entry to a workspace, or nothing.
       *
       * Nothing when the entry does not decode or the workspace is gone from
       * the trust store — a transcript is history, and history may reference
       * places this host can no longer place.
       */
      const workspaceFromChange = Effect.fnUntraced(function* (data: unknown) {
        const decoded = yield* Schema.decodeUnknownEffect(WorkspaceChangeData)(data).pipe(
          Effect.orElseSucceed(() => undefined),
        );
        if (decoded === undefined) return undefined;
        return yield* workspaces
          .find({ workspaceId: decoded.workspaceId })
          .pipe(Effect.orElseSucceed(() => undefined));
      });

      /**
       * Builds the private runtime state around one Pi session.
       *
       * Shared by create and restore, so a restored session gets exactly the
       * wiring a fresh one does: the harness over the current binding, the
       * event bridge, and the run status.
       */
      const openFromPiSession = Effect.fnUntraced(function* (
        session: PiSession,
        binding: SessionBinding,
        snapshots: Snapshot[],
        model: AgentHarnessOptions["model"],
      ) {
        // TODO(core-migration §7, §12): built-in execution tools only. No
        // resources, no systemPrompt, no MCP or extension tools yet, and no
        // setTools(allTools, activeToolNames) recompute - passing
        // activeToolNames matters there, because Pi retains the previous
        // active names when it is omitted.
        const harness = createWorkspaceHarness({
          session,
          models: models.collection,
          model,
          binding,
        });

        const events = yield* PubSub.unbounded<AgentHarnessEvent>();
        const run: OpenSession["run"] = { status: "idle" };

        // Bridge Pi's callback into the PubSub. Events are temporary
        // notifications: an unbounded pubsub never drops a publish, and
        // subscribers that lag or detach repair themselves with the next
        // authoritative reload.
        harness.subscribe((event) => {
          if (event.type === "agent_start") run.status = "running";
          if (event.type === "settled") run.status = "idle";
          PubSub.publishUnsafe(events, event);
        });

        return { session, harness, events, run, binding, snapshots } satisfies OpenSession;
      });

      /**
       * Walks the transcript's `/cd` records once, answering both questions
       * a stored session poses: which workspace each entry ran in, and where
       * the session ended up.
       */
      const workspaceTrail = Effect.fnUntraced(function* (
        entries: readonly SessionTreeEntry[],
        origin: Workspace.Info,
      ) {
        const attributed: Snapshot[] = [{ entryId: "base", workspaceId: origin.id }];
        let workspace = origin;
        for (const entry of entries) {
          if (entry.type === "custom" && entry.customType === "honk.workspace_change") {
            const target = yield* workspaceFromChange(entry.data);
            if (target) workspace = target;
          }
          attributed.push({ entryId: entry.id, workspaceId: workspace.id });
        }
        return { attributed, workspace };
      });

      /**
       * Restores a stored session into the open map, or reports it
       * unrestorable.
       *
       * Trust gates restoration exactly as it gates creation: the session's
       * directory must still be in the trust store, or no environment is
       * created and the session stays closed. The final workspace binding
       * comes from the transcript's last `/cd` record, so a restored session
       * continues where it moved to, not where it began.
       */
      const restore = Effect.fnUntraced(function* (sessionId: SessionId) {
        const metadata = yield* findMetadata(sessionId);
        if (!metadata) return undefined;
        const origin = yield* workspaces.locate({ directory: metadata.cwd });
        if (!origin) return undefined;

        const session = yield* runPi(() => repo.open(metadata));
        const entries = yield* runPi(() => session.getEntries());
        const { attributed, workspace } = yield* workspaceTrail(entries, origin);

        // The transcript's own model record, resolved against the live
        // catalog. A model that left the catalog fails restoration typed —
        // substituting another would silently move the conversation.
        const model = yield* models.resolve(modelOf(entries));

        // Snapshot history is what actually survives a restart: checkpoint
        // refs in the workspace repositories, intersected with the transcript
        // in transcript order. Nothing is stored twice.
        const captured = new Map<Workspace.WorkspaceId, ReadonlySet<string>>();
        for (const workspaceId of new Set(attributed.map((snapshot) => snapshot.workspaceId))) {
          const names = yield* git
            .checkpoints({ workspaceId, prefix: sessionId })
            .pipe(Effect.orElseSucceed((): Git.CheckpointsOutput => ({ checkpoints: [] })));
          captured.set(
            workspaceId,
            new Set(names.checkpoints.map((name) => name.slice(sessionId.length + 1))),
          );
        }
        const snapshots = attributed.filter(
          (snapshot) => captured.get(snapshot.workspaceId)?.has(snapshot.entryId) ?? false,
        );

        // The id came out of the trust store an instant ago; a miss here is a
        // bug, not an outcome.
        const env = yield* workspaces.env({ workspaceId: workspace.id }).pipe(Effect.orDie);
        const opened = yield* openFromPiSession(session, { workspace, env }, snapshots, model);

        // Two concurrent restores converge on one instance; the loser's
        // harness is dropped unused before it ever ran anything.
        return yield* Ref.modify(open, (map) => {
          const raced = map.get(sessionId);
          if (raced) return [raced, map] as const;
          return [opened, new Map(map).set(sessionId, opened)] as const;
        });
      });

      const lookup = Effect.fnUntraced(function* (sessionId: SessionId) {
        const found = (yield* Ref.get(open)).get(sessionId);
        if (found) return found;
        // Lazy restore: the first use after a restart reopens the session.
        const restored = yield* restore(sessionId);
        if (!restored) return yield* new NotFoundError({ sessionId });
        return restored;
      });

      /**
       * Captures a checkpoint for this session and remembers where it lives.
       *
       * Failures are swallowed on purpose: a workspace without a git
       * repository has no checkpoints, and snapshot bookkeeping must never
       * fail the run that triggered it. A capture that did not happen is
       * simply not recorded, so `changes` stays honest instead of pointing at
       * refs that do not exist.
       */
      const captureSnapshot = Effect.fnUntraced(function* (
        sessionId: SessionId,
        found: OpenSession,
        entryId: string,
      ) {
        const workspaceId = found.binding.workspace.id;
        const captured = yield* git
          .captureCheckpoint({ workspaceId, checkpoint: `${sessionId}/${entryId}` })
          .pipe(
            Effect.as(true),
            Effect.orElseSucceed(() => false),
          );
        if (!captured) return;
        const last = found.snapshots.at(-1);
        if (last !== undefined && last.entryId === entryId && last.workspaceId === workspaceId) {
          return;
        }
        found.snapshots.push({ entryId, workspaceId });
      });

      /** Snapshots the settled state under the turn's last entry id. */
      const settleSnapshot = Effect.fnUntraced(function* (
        sessionId: SessionId,
        found: OpenSession,
      ) {
        const entries = yield* runPi(() => found.session.getEntries());
        yield* captureSnapshot(sessionId, found, entries.at(-1)?.id ?? "base");
      });

      const create = Effect.fn("Session.create")(function* (input: Rpc.Payload<typeof Create>) {
        const workspace = yield* workspaces.find({ workspaceId: input.workspaceId });
        // Resolve the model before anything persists: a reference that fails
        // must not leave an orphan transcript behind.
        const model = yield* models.resolve(input.model);
        // The session's transcript is rooted in its workspace from the first
        // byte: Pi stores the cwd in the session metadata, and that stored
        // directory is what restoration resolves through the trust store.
        const session = yield* runPi(() => repo.create({ cwd: workspace.directory }));
        const metadata = yield* runPi(() => session.getMetadata());
        const id = SessionId.make(metadata.id);

        // The choice is durable from birth: Pi's own model_change entry is
        // what restoration reads, so the session reopens on the model it was
        // created with — even when it was the resolved default.
        yield* runPi(() => session.appendModelChange(model.provider, model.id));

        // One environment per trusted workspace, shared with sdk.files and
        // sdk.git, so all three resolve against the same directory and a
        // caller cannot reach outside it by choosing a different built-in.
        const env = yield* workspaces.env({ workspaceId: workspace.id });
        const opened = yield* openFromPiSession(session, { workspace, env }, [], model);

        // The base checkpoint: the workspace as this session found it, so the
        // first turn has something to diff against and "base" is a revert
        // target meaning "before this conversation touched anything".
        yield* captureSnapshot(id, opened, "base");

        yield* Ref.update(open, (map) => new Map(map).set(id, opened));
        return { id, workspaceId: workspace.id };
      });

      const list = Effect.fn("Session.list")(function* () {
        const listed = yield* runPi(() => repo.list());
        const sessions: SessionSummary[] = [];
        for (const metadata of listed) {
          const located = yield* workspaces.locate({ directory: metadata.cwd });
          // A session whose directory left the trust store is unplaceable:
          // listing it would invite an open the trust gate must refuse.
          if (!located) continue;
          sessions.push({
            id: SessionId.make(metadata.id),
            workspaceId: located.id,
            directory: located.directory,
            createdAt: metadata.createdAt,
          });
        }
        return { sessions } satisfies ListOutput;
      });

      const get = Effect.fn("Session.get")(function* (input: Rpc.Payload<typeof Get>) {
        const opened = (yield* Ref.get(open)).get(input.sessionId);
        if (opened) {
          return {
            id: input.sessionId,
            workspaceId: opened.binding.workspace.id,
          } satisfies SessionInfo;
        }
        // Metadata only — get answers identity, and identity must not cost a
        // harness. The origin workspace is the honest answer for a session
        // nobody has opened; the current binding exists only once it is open.
        const metadata = yield* findMetadata(input.sessionId);
        if (!metadata) return yield* new NotFoundError({ sessionId: input.sessionId });
        const located = yield* workspaces.locate({ directory: metadata.cwd });
        if (!located) return yield* new NotFoundError({ sessionId: input.sessionId });
        return { id: input.sessionId, workspaceId: located.id } satisfies SessionInfo;
      });

      const remove = Effect.fn("Session.delete")(function* (input: Rpc.Payload<typeof Delete>) {
        const metadata = yield* findMetadata(input.sessionId);
        if (!metadata) return yield* new NotFoundError({ sessionId: input.sessionId });
        const opened = (yield* Ref.get(open)).get(input.sessionId);
        if (opened) {
          // End the run before its transcript disappears under it. A failed
          // abort must not block deletion — the user asked for gone.
          yield* runPi(() => opened.harness.abort()).pipe(Effect.ignore);
          yield* Ref.update(open, (map) => {
            const next = new Map(map);
            next.delete(input.sessionId);
            return next;
          });
        }

        // Every repository this session snapshotted into: the live list when
        // the session is open, the transcript's /cd trail when it is not.
        // Best-effort by design — a broken transcript or a vanished workspace
        // must not block the deletion the user asked for.
        const targets = yield* Effect.gen(function* () {
          const ids = new Set<Workspace.WorkspaceId>();
          if (opened) {
            ids.add(opened.binding.workspace.id);
            for (const snapshot of opened.snapshots) ids.add(snapshot.workspaceId);
            return ids;
          }
          const origin = yield* workspaces.locate({ directory: metadata.cwd });
          if (!origin) return ids;
          const session = yield* runPi(() => repo.open(metadata));
          const entries = yield* runPi(() => session.getEntries());
          const { attributed } = yield* workspaceTrail(entries, origin);
          for (const snapshot of attributed) ids.add(snapshot.workspaceId);
          return ids;
        }).pipe(Effect.orElseSucceed(() => new Set<Workspace.WorkspaceId>()));

        yield* Effect.forEach(
          [...targets],
          (workspaceId) =>
            git.deleteCheckpoints({ workspaceId, prefix: input.sessionId }).pipe(Effect.ignore),
          { discard: true },
        );
        yield* runPi(() => repo.delete(metadata));
      });

      const prompt = Effect.fn("Session.prompt")(function* (input: Rpc.Payload<typeof Prompt>) {
        const found = yield* lookup(input.sessionId);
        yield* runPi(() => found.harness.prompt(input.text));
        // Pi's prompt promise resolves at the settlement point, so this is
        // "after the turn": one checkpoint per settled turn, no event-side
        // bookkeeping. Steers and follow-ups fold into the same run and are
        // covered by this capture.
        yield* settleSnapshot(input.sessionId, found);
      });

      const abort = Effect.fn("Session.abort")(function* (input: Rpc.Payload<typeof Abort>) {
        const found = yield* lookup(input.sessionId);
        const cleared = yield* runPi(() => found.harness.abort());
        // An aborted run still wrote whatever it wrote before the abort.
        yield* settleSnapshot(input.sessionId, found);
        // The cleared queue goes back to the caller: stopping never destroys
        // text the user typed (spec/conversation.md section 7).
        return {
          clearedSteer: toWire(cleared.clearedSteer),
          clearedFollowUp: toWire(cleared.clearedFollowUp),
        } satisfies AbortOutput;
      });

      const steer = Effect.fn("Session.steer")(function* (input: Rpc.Payload<typeof Steer>) {
        const found = yield* lookup(input.sessionId);
        yield* runPi(() => found.harness.steer(input.text));
      });

      const followUp = Effect.fn("Session.followUp")(function* (
        input: Rpc.Payload<typeof FollowUp>,
      ) {
        const found = yield* lookup(input.sessionId);
        yield* runPi(() => found.harness.followUp(input.text));
      });

      const reload = Effect.fn("Session.reload")(function* (input: {
        readonly sessionId: SessionId;
      }) {
        const found = yield* lookup(input.sessionId);
        // Authoritative committed read straight from the Pi session. It never
        // touches the harness, which is what makes it safe during a run and
        // proves invariant 3: reloading cannot execute work.
        const entries = yield* runPi(() => found.session.getEntries());
        return { entries, status: found.run.status };
      });

      /**
       * Diffs consecutive checkpoints, gated by each turn's own tool calls.
       *
       * The snapshot diff is the truth about content; the turn's tool calls
       * are the truth about attribution. Intersecting them is what keeps a
       * sibling session's edits out of this turn's receipt without hiding
       * what a shell command wrote. A pair whose diff cannot be computed —
       * pruned refs, a repository that went away — contributes nothing rather
       * than failing the read.
       */
      const changes = Effect.fn("Session.changes")(function* (input: {
        readonly sessionId: SessionId;
      }) {
        const found = yield* lookup(input.sessionId);
        const entries = yield* runPi(() => found.session.getEntries());
        const order = new Map(entries.map((entry, index) => [entry.id, index] as const));

        const turns: TurnChanges[] = [];
        for (let index = 1; index < found.snapshots.length; index += 1) {
          const from = found.snapshots[index - 1];
          const to = found.snapshots[index];
          if (from === undefined || to === undefined) continue;
          // A /cd boundary: the two snapshots live in different repositories,
          // so there is no comparable base and the pair is honestly skipped.
          if (from.workspaceId !== to.workspaceId) continue;

          const files = yield* git
            .checkpointChanges({
              workspaceId: to.workspaceId,
              from: `${input.sessionId}/${from.entryId}`,
              to: `${input.sessionId}/${to.entryId}`,
            })
            .pipe(Effect.orElseSucceed((): readonly Git.FileChange[] => []));
          if (files.length === 0) continue;

          const gated = gateTurnFiles(
            files,
            turnToolWrites(entries, order.get(from.entryId), order.get(to.entryId)),
          );
          if (gated.length > 0) turns.push({ entryId: to.entryId, files: gated });
        }
        return { turns } satisfies ChangesOutput;
      });

      const setWorkspace = Effect.fn("Session.setWorkspace")(function* (
        input: Rpc.Payload<typeof SetWorkspace>,
      ) {
        const found = yield* lookup(input.sessionId);
        if (found.binding.workspace.id === input.workspaceId) return;
        const workspace = yield* workspaces.find({ workspaceId: input.workspaceId });
        const env = yield* workspaces.env({ workspaceId: workspace.id });
        found.binding.workspace = workspace;
        found.binding.env = env;

        // The move lands in the Pi transcript as a custom entry — out of
        // model context, like Pi's own model-change entries — and that
        // entry's id names the new workspace's baseline checkpoint, so the
        // next turn diffs against the directory as the session found it.
        const entryId = yield* runPi(() =>
          found.session.appendCustomEntry("honk.workspace_change", {
            workspaceId: workspace.id,
            directory: workspace.directory,
          }),
        );
        yield* captureSnapshot(input.sessionId, found, entryId);
      });

      const revert = Effect.fn("Session.revert")(function* (input: Rpc.Payload<typeof Revert>) {
        const found = yield* lookup(input.sessionId);
        const target = found.snapshots.find((snapshot) => snapshot.entryId === input.entryId);
        if (target === undefined) {
          return yield* new Git.CheckpointNotFoundError({
            checkpoint: `${input.sessionId}/${input.entryId}`,
          });
        }
        // The revert lands in the transcript as a custom entry, and that
        // entry's id names the safety checkpoint of the present. A fresh id
        // by construction: naming the safety by an existing entry would
        // overwrite the very checkpoint being restored. Undo is a revert to
        // this entry.
        const entryId = yield* runPi(() =>
          found.session.appendCustomEntry("honk.revert", { toEntryId: input.entryId }),
        );
        yield* captureSnapshot(input.sessionId, found, entryId);
        yield* git.restoreCheckpoint({
          workspaceId: target.workspaceId,
          checkpoint: `${input.sessionId}/${target.entryId}`,
        });
      });

      const events = Effect.fn("Session.events")(function* (input: {
        readonly sessionId: SessionId;
      }) {
        const found = yield* lookup(input.sessionId);
        // Subscribing before returning is the guarantee: once this effect
        // completes, every subsequent event reaches the caller's stream.
        const subscription = yield* PubSub.subscribe(found.events);
        return Stream.fromSubscription(subscription);
      });

      return Service.of({
        create,
        prompt,
        abort,
        steer,
        followUp,
        reload,
        changes,
        setWorkspace,
        revert,
        list,
        get,
        delete: remove,
        events,
      });
    }),
  );

/**
 * @category service
 */
export class Service extends Context.Service<Service, Interface>()("honk/Session") {}

/**
 * Normalizes a Pi value for JSON transport.
 *
 * Pi values can carry explicit `undefined` properties, which JSON cannot
 * represent, so the serializer rejects them. This round-trips each value
 * through JSON exactly once — the same normalization Pi's own JSONL persistence
 * applies — and changes nothing else.
 *
 * TODO(core-migration §6): hand-rolled normalization inside handlers, applied
 * per entry on every reload. Adopting Pi's protocol schemas moves this into the
 * codec at the boundary, where a value is parsed once and trusted after.
 */
const toWire = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * Binds the session RPCs to {@link Service}.
 *
 * Handlers stay thin: decoding already happened at the RPC boundary, so they
 * only bind payloads to service methods and apply wire normalization.
 * `Rpcs.toLayer` checks the map is total at compile time. Provide
 * `layer(options)` to satisfy the `Service` requirement.
 *
 * @category layers
 */
export const rpcLayer = Rpcs.toLayer(
  Effect.gen(function* () {
    const session = yield* Service;
    return {
      "session.create": (payload) => session.create(payload),
      "session.prompt": (payload) => session.prompt(payload),
      "session.abort": (payload) => session.abort(payload),
      "session.steer": (payload) => session.steer(payload),
      "session.follow_up": (payload) => session.followUp(payload),
      "session.changes": (payload) => session.changes(payload),
      "session.set_workspace": (payload) => session.setWorkspace(payload),
      "session.revert": (payload) => session.revert(payload),
      "session.list": (payload) => session.list(payload),
      "session.get": (payload) => session.get(payload),
      "session.delete": (payload) => session.delete(payload),
      "session.reload": (payload) =>
        session
          .reload(payload)
          .pipe(Effect.map((state) => ({ ...state, entries: state.entries.map(toWire) }))),
      // Stream.unwrap folds the subscription Scope into the stream lifetime:
      // when the rpc call ends, the stream closes and the client detaches
      // without touching the run. The `live` head frame is prepended here
      // rather than inside the service, because in-process callers already get
      // that guarantee from the Effect resolving.
      "session.events": (payload) =>
        Stream.unwrap(
          session
            .events(payload)
            .pipe(
              Effect.map((stream) =>
                Stream.concat(
                  Stream.make({ type: "live" } as const),
                  stream.pipe(
                    Stream.map((event) => ({ type: "event", event: toWire(event) }) as const),
                  ),
                ),
              ),
            ),
        ),
    };
  }),
);
