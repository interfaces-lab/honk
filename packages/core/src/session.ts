import type {
  AgentHarnessEvent,
  AgentHarnessOptions,
  Session as PiSession,
  SessionTreeEntry,
} from "@earendil-works/pi-agent-core";
import { AgentHarness, InMemorySessionRepo } from "@earendil-works/pi-agent-core";
import type { Models } from "@earendil-works/pi-ai";
import type { Scope } from "effect";
import { Context, Effect, Layer, PubSub, Ref, Schema, Stream } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

import type { Method } from "./util/rpc";

export const SessionId = Schema.NonEmptyString.pipe(Schema.brand("SessionId")).annotate({
  identifier: "SessionId",
});
export type SessionId = typeof SessionId.Type;

export const SessionInfo = Schema.Struct({ id: SessionId }).annotate({
  identifier: "SessionInfo",
});
export type SessionInfo = typeof SessionInfo.Type;

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("SessionNotFoundError", {
  code: Schema.tag("session.not_found"),
  message: Schema.tag("Honk does not know this session."),
  sessionId: Schema.NonEmptyString,
}) {}

export type Error = NotFoundError;

export const Create = Rpc.make("session.create", {
  success: SessionInfo,
});

// Success stays void: harness.prompt() settles at Pi's prompt settlement point
// and the assistant message lands in the Pi session. Returning that message
// over a transport waits for Pi to export its AssistantMessage schema.
export const Prompt = Rpc.make("session.prompt", {
  payload: { sessionId: SessionId, text: Schema.NonEmptyString },
  error: NotFoundError,
});

export class Rpcs extends RpcGroup.make(Create, Prompt) {}

// Reload output carries Pi-owned entry values. Pi 0.83.0 exports no runtime
// schema for SessionTreeEntry, and spec/core.md forbids a mirrored Honk
// schema, so reload is not an Rpc yet: in-process callers get the typed Pi
// values, and the remote command stays unimplemented until Pi exports the
// schema upstream. The same blocker applies to the events stream below.
export type RunStatus = "idle" | "running";

export interface ReloadOutput {
  readonly entries: readonly SessionTreeEntry[];
  readonly status: RunStatus;
}

export interface Interface {
  readonly create: Method<typeof Create>;
  readonly prompt: Method<typeof Prompt>;
  readonly reload: (input: {
    readonly sessionId: SessionId;
  }) => Effect.Effect<ReloadOutput, NotFoundError>;
  // Resolves only after the subscription is live, so "start listening, then
  // reload" (spec/core.md section 9) is deterministic: every event published
  // after this effect completes reaches the returned stream. The Scope owns
  // the subscription; closing it detaches the client without touching the run.
  readonly events: (input: {
    readonly sessionId: SessionId;
  }) => Effect.Effect<Stream.Stream<AgentHarnessEvent>, NotFoundError, Scope.Scope>;
}

export class Service extends Context.Service<Service, Interface>()("honk/Session") {}

export interface LayerOptions {
  readonly models: Models;
  readonly model: AgentHarnessOptions["model"];
}

interface OpenSession {
  readonly session: PiSession;
  readonly harness: AgentHarness;
  readonly events: PubSub.PubSub<AgentHarnessEvent>;
  // Private host runtime state, mutated from Pi's plain event callback where
  // Effect refs are out of reach. Only reload() reads it.
  readonly run: { status: RunStatus };
}

// The layer takes the Pi model collection instead of building one so tests
// inject Pi's faux provider. Production wiring (builtinModels + credentials)
// arrives with the host construction step. There is no defaultLayer: a model
// collection is required, never defaulted.
export const layer = (options: LayerOptions) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      // In-memory sessions for the first experiment slice; the JSONL repo
      // moves in with the host data directory and the writer lease.
      const repo = new InMemorySessionRepo();
      const open = yield* Ref.make<ReadonlyMap<SessionId, OpenSession>>(new Map());

      const lookup = Effect.fnUntraced(function* (sessionId: SessionId) {
        const found = (yield* Ref.get(open)).get(sessionId);
        if (!found) return yield* new NotFoundError({ sessionId });
        return found;
      });

      const create = Effect.fn("Session.create")(function* () {
        // In-memory repo failures are bugs, not expected outcomes, so Pi
        // promise rejections stay defects here.
        const session = yield* Effect.promise(() => repo.create());
        const metadata = yield* Effect.promise(() => session.getMetadata());
        const id = SessionId.make(metadata.id);
        const harness = new AgentHarness({ session, models: options.models, model: options.model });
        const events = yield* PubSub.unbounded<AgentHarnessEvent>();
        const run: OpenSession["run"] = { status: "idle" };
        // Bridge Pi's callback into the PubSub. Events are temporary
        // notifications (spec/core.md section 9): an unbounded pubsub never
        // drops a publish, and subscribers that lag or detach repair
        // themselves with the next authoritative reload.
        harness.subscribe((event) => {
          if (event.type === "agent_start") run.status = "running";
          if (event.type === "settled") run.status = "idle";
          PubSub.publishUnsafe(events, event);
        });
        yield* Ref.update(open, (map) => new Map(map).set(id, { session, harness, events, run }));
        return { id };
      });

      const prompt = Effect.fn("Session.prompt")(function* (input: Rpc.Payload<typeof Prompt>) {
        const found = yield* lookup(input.sessionId);
        // Pi run failures surface as defects until Pi exports its error
        // schemas; flattening them into a Honk lookalike is forbidden.
        yield* Effect.promise(() => found.harness.prompt(input.text));
      });

      const reload = Effect.fn("Session.reload")(function* (input: {
        readonly sessionId: SessionId;
      }) {
        const found = yield* lookup(input.sessionId);
        // Authoritative committed read from the Pi session. Never touches the
        // harness, so it cannot execute work or change the run.
        const entries = yield* Effect.promise(() => found.session.getEntries());
        return { entries, status: found.run.status };
      });

      const events = Effect.fn("Session.events")(function* (input: {
        readonly sessionId: SessionId;
      }) {
        const found = yield* lookup(input.sessionId);
        const subscription = yield* PubSub.subscribe(found.events);
        return Stream.fromSubscription(subscription);
      });

      return Service.of({ create, prompt, reload, events });
    }),
  );

// Handlers stay thin: decode happened at the RPC boundary, so they only bind
// payloads to the service. Provide a `layer(options)` to satisfy the Service
// requirement.
export const rpcLayer = Rpcs.toLayer(
  Effect.gen(function* () {
    const session = yield* Service;
    return {
      "session.create": () => session.create(),
      "session.prompt": (payload) => session.prompt(payload),
    };
  }),
);

// Extensionless on purpose: consumers bundle this source (desktop keeps
// @honk/core in devDependencies so electron-vite bundles it), and consumer
// tsconfigs do not enable allowImportingTsExtensions.
// oxlint-disable-next-line import/no-self-import -- spec/effect.md self-reexport pattern; star imports are banned for consumers.
export * as Session from "./session";
