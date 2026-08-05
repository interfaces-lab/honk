// Experiments 2 and 3: live events across attach, detach, and reload. The
// prompt/reload basics live in lifecycle.test.ts.

import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, Scope, Stream } from "effect";

import { Session } from "../../src/session";
import {
  gatedResponse,
  makeFauxSessionLayer,
  messageEntries,
  openTrustedWorkspace,
} from "../../src/testing";

describe("session experiments 2 and 3: live events across attach, detach, reload", () => {
  it.effect("a subscriber attached before the read loses no events across a reload", () =>
    Effect.gen(function* () {
      const { faux, appLayer } = makeFauxSessionLayer();
      const { release, response } = gatedResponse("Hello from faux");
      faux.setResponses([response]);

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const workspace = yield* openTrustedWorkspace("/tmp/honk-session-tests");
        const { id } = yield* session.create({ workspaceId: workspace.id });

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

        const run = yield* session
          .prompt({ sessionId: id, text: "Say hello" })
          .pipe(Effect.forkScoped);
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

      yield* program.pipe(Effect.scoped, Effect.provide(appLayer));
    }),
  );

  it.effect("a client detaching mid-run stops nothing; a reload reattaches it", () =>
    Effect.gen(function* () {
      const { faux, appLayer } = makeFauxSessionLayer();
      const { release, response } = gatedResponse("Hello from faux");
      faux.setResponses([response]);

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const workspace = yield* openTrustedWorkspace("/tmp/honk-session-tests");
        const { id } = yield* session.create({ workspaceId: workspace.id });

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

        const run = yield* session
          .prompt({ sessionId: id, text: "Say hello" })
          .pipe(Effect.forkScoped);

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

      yield* program.pipe(Effect.scoped, Effect.provide(appLayer));
    }),
  );

  it.effect("events on an unknown session fails with the typed NotFoundError", () =>
    Effect.gen(function* () {
      const { appLayer } = makeFauxSessionLayer();

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const error = yield* session
          .events({ sessionId: Session.SessionId.make("missing") })
          .pipe(Effect.flip);

        expect(error).toBeInstanceOf(Session.NotFoundError);
        expect(error.code).toBe("session.not_found");
      });

      yield* program.pipe(Effect.scoped, Effect.provide(appLayer));
    }),
  );
});
