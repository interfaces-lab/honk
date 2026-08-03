import type { MessageEntry, SessionTreeEntry } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, Layer, Scope, Stream } from "effect";
import { RpcTest } from "effect/unstable/rpc";

import { Session } from "../src/session";

const makeFauxSessionLayer = () => {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  return { faux, sessionLayer: Session.layer({ models, model: faux.getModel() }) };
};

// A response the test releases explicitly, so "while the run is active" is a
// deterministic program point instead of a sleep.
const gatedResponse = (text: string) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const response = async () => {
    await gate;
    return fauxAssistantMessage(text);
  };
  return { release, response };
};

const messageEntries = (entries: readonly SessionTreeEntry[]): MessageEntry[] =>
  entries.filter((entry): entry is MessageEntry => entry.type === "message");

const textOf = (entry: MessageEntry | undefined): string | undefined => {
  const message = entry?.message;
  if (message?.role !== "user" && message?.role !== "assistant") return undefined;
  if (typeof message.content === "string") return message.content;
  const block = message.content.find((part) => part.type === "text");
  return block?.type === "text" ? block.text : undefined;
};

describe("session experiment 1: one harness, one fake model, one prompt, one reload", () => {
  it.effect("creates, prompts, and reloads the committed Pi transcript", () =>
    Effect.gen(function* () {
      const { faux, sessionLayer } = makeFauxSessionLayer();
      faux.setResponses([fauxAssistantMessage("Hello from faux")]);

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const { id } = yield* session.create();

        yield* session.prompt({ sessionId: id, text: "Say hello" });

        const state = yield* session.reload({ sessionId: id });
        const messages = messageEntries(state.entries);

        expect(messages.map((entry) => entry.message.role)).toEqual(["user", "assistant"]);
        expect(textOf(messages[0])).toBe("Say hello");
        expect(textOf(messages[1])).toBe("Hello from faux");
      });

      yield* program.pipe(Effect.provide(sessionLayer));
    }),
  );

  it.effect("reload is a read: it never executes work or changes the session", () =>
    Effect.gen(function* () {
      const { faux, sessionLayer } = makeFauxSessionLayer();
      faux.setResponses([fauxAssistantMessage("unused")]);

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const { id } = yield* session.create();

        const before = yield* session.reload({ sessionId: id });
        const again = yield* session.reload({ sessionId: id });

        expect(messageEntries(before.entries)).toHaveLength(0);
        expect(again.entries).toEqual(before.entries);
        expect(faux.state.callCount).toBe(0);
        expect(faux.getPendingResponseCount()).toBe(1);
      });

      yield* program.pipe(Effect.provide(sessionLayer));
    }),
  );

  it.effect("reports running during a prompt and idle after Pi settles", () =>
    Effect.gen(function* () {
      const { faux, sessionLayer } = makeFauxSessionLayer();
      const { release, response } = gatedResponse("done");
      faux.setResponses([response]);

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const { id } = yield* session.create();

        const sawStart = yield* Deferred.make<void>();
        const sawSettled = yield* Deferred.make<void>();
        const stream = yield* session.events({ sessionId: id });
        yield* stream.pipe(
          Stream.runForEach((event) =>
            Effect.gen(function* () {
              if (event.type === "agent_start") yield* Deferred.succeed(sawStart, undefined);
              if (event.type === "settled") yield* Deferred.succeed(sawSettled, undefined);
            }),
          ),
          Effect.forkScoped,
        );

        const run = yield* session.prompt({ sessionId: id, text: "Say hello" }).pipe(Effect.forkScoped);

        yield* Deferred.await(sawStart);
        const during = yield* session.reload({ sessionId: id });
        expect(during.status).toBe("running");

        release();
        yield* Fiber.join(run);
        yield* Deferred.await(sawSettled);

        const after = yield* session.reload({ sessionId: id });
        expect(after.status).toBe("idle");
        expect(messageEntries(after.entries).map((entry) => entry.message.role)).toEqual([
          "user",
          "assistant",
        ]);
      });

      yield* program.pipe(Effect.scoped, Effect.provide(sessionLayer));
    }),
  );

  it.effect("prompt on an unknown session fails with the typed NotFoundError", () =>
    Effect.gen(function* () {
      const { sessionLayer } = makeFauxSessionLayer();

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const error = yield* session
          .prompt({ sessionId: Session.SessionId.make("missing"), text: "hi" })
          .pipe(Effect.flip);

        expect(error).toBeInstanceOf(Session.NotFoundError);
        expect(error.code).toBe("session.not_found");
        expect(error.sessionId).toBe("missing");
      });

      yield* program.pipe(Effect.provide(sessionLayer));
    }),
  );
});

describe("session experiments 2 and 3: live events across attach, detach, reload", () => {
  it.effect("a subscriber attached before the read loses no events across a reload", () =>
    Effect.gen(function* () {
      const { faux, sessionLayer } = makeFauxSessionLayer();
      const { release, response } = gatedResponse("Hello from faux");
      faux.setResponses([response]);

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const { id } = yield* session.create();

        // Spec section 9 handoff: start listening, then read. The events
        // effect resolves only once the subscription is live.
        const seen: string[] = [];
        const sawStart = yield* Deferred.make<void>();
        const sawSettled = yield* Deferred.make<void>();
        const stream = yield* session.events({ sessionId: id });
        yield* stream.pipe(
          Stream.runForEach((event) =>
            Effect.gen(function* () {
              seen.push(event.type);
              if (event.type === "agent_start") yield* Deferred.succeed(sawStart, undefined);
              if (event.type === "settled") yield* Deferred.succeed(sawSettled, undefined);
            }),
          ),
          Effect.forkScoped,
        );

        const run = yield* session.prompt({ sessionId: id, text: "Say hello" }).pipe(Effect.forkScoped);
        yield* Deferred.await(sawStart);

        // The read happens while the run is mid-turn; events keep flowing.
        const during = yield* session.reload({ sessionId: id });
        expect(during.status).toBe("running");

        release();
        yield* Fiber.join(run);
        yield* Deferred.await(sawSettled);

        expect(seen).toContain("agent_start");
        expect(seen).toContain("message_end");
        expect(seen).toContain("agent_end");
        expect(seen).toContain("settled");
      });

      yield* program.pipe(Effect.scoped, Effect.provide(sessionLayer));
    }),
  );

  it.effect("a client detaching mid-run stops nothing; a reload reattaches it", () =>
    Effect.gen(function* () {
      const { faux, sessionLayer } = makeFauxSessionLayer();
      const { release, response } = gatedResponse("Hello from faux");
      faux.setResponses([response]);

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const { id } = yield* session.create();

        // Client A stays attached for the whole run.
        const seenByA: string[] = [];
        const sawSettled = yield* Deferred.make<void>();
        const streamA = yield* session.events({ sessionId: id });
        yield* streamA.pipe(
          Stream.runForEach((event) =>
            Effect.gen(function* () {
              seenByA.push(event.type);
              if (event.type === "settled") yield* Deferred.succeed(sawSettled, undefined);
            }),
          ),
          Effect.forkScoped,
        );

        // Client B owns its subscription scope so the test can detach it at
        // an exact program point.
        const scopeB = yield* Scope.make();
        const streamB = yield* session.events({ sessionId: id }).pipe(Scope.provide(scopeB));

        const run = yield* session.prompt({ sessionId: id, text: "Say hello" }).pipe(Effect.forkScoped);

        // B watches the run start, then disconnects while the turn is open.
        yield* streamB.pipe(
          Stream.filter((event) => event.type === "agent_start"),
          Stream.take(1),
          Stream.runDrain,
        );
        yield* Scope.close(scopeB, Exit.void);

        // A reconnecting client repairs itself with an authoritative read.
        const during = yield* session.reload({ sessionId: id });
        expect(during.status).toBe("running");

        release();
        yield* Fiber.join(run);
        yield* Deferred.await(sawSettled);

        const after = yield* session.reload({ sessionId: id });
        expect(after.status).toBe("idle");
        expect(messageEntries(after.entries).map((entry) => entry.message.role)).toEqual([
          "user",
          "assistant",
        ]);
        expect(seenByA).toContain("agent_end");
      });

      yield* program.pipe(Effect.scoped, Effect.provide(sessionLayer));
    }),
  );

  it.effect("events on an unknown session fails with the typed NotFoundError", () =>
    Effect.gen(function* () {
      const { sessionLayer } = makeFauxSessionLayer();

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const error = yield* session
          .events({ sessionId: Session.SessionId.make("missing") })
          .pipe(Effect.flip);

        expect(error).toBeInstanceOf(Session.NotFoundError);
        expect(error.code).toBe("session.not_found");
      });

      yield* program.pipe(Effect.scoped, Effect.provide(sessionLayer));
    }),
  );
});

describe("session rpc handlers", () => {
  it.effect("walks create and prompt through an in-process client", () =>
    Effect.gen(function* () {
      const { faux, sessionLayer } = makeFauxSessionLayer();
      faux.setResponses([fauxAssistantMessage("Hello over rpc")]);
      // provideMerge on purpose: the test needs the rpc handlers and the same
      // Session.Service instance (for the service-only reload) in one context.
      const handlers = Session.rpcLayer.pipe(Layer.provideMerge(sessionLayer));

      const program = Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(Session.Rpcs);
        const session = yield* Session.Service;

        const { id } = yield* client["session.create"]();
        yield* client["session.prompt"]({ sessionId: id, text: "Say hello" });

        const state = yield* session.reload({ sessionId: id });
        const messages = messageEntries(state.entries);
        expect(textOf(messages[1])).toBe("Hello over rpc");
      });

      yield* program.pipe(Effect.provide(handlers));
    }),
  );

  it.effect("rejects an unknown session with the typed NotFoundError", () =>
    Effect.gen(function* () {
      const { sessionLayer } = makeFauxSessionLayer();
      const handlers = Session.rpcLayer.pipe(Layer.provide(sessionLayer));

      const program = Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(Session.Rpcs);
        const error = yield* client["session.prompt"]({
          sessionId: Session.SessionId.make("missing"),
          text: "hi",
        }).pipe(Effect.flip);

        expect(error).toBeInstanceOf(Session.NotFoundError);
        expect(error.code).toBe("session.not_found");
      });

      yield* program.pipe(Effect.provide(handlers));
    }),
  );
});
