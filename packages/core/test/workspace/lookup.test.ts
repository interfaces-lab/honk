// Service-only lookup by id: the proof that holding a WorkspaceId is holding
// a trust decision. The trust flows themselves live in trust.test.ts.

import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { Workspace } from "../../src/workspace";
import { fixture, serviceLayer } from "./fixture";

describe("workspace lookup by id", () => {
  it.effect("finds a trusted workspace by the id that open returned", () =>
    Effect.gen(function* () {
      const program = Effect.gen(function* () {
        const { directory } = yield* Effect.promise(() => fixture("honk-find-"));
        const workspace = yield* Workspace.Service;
        yield* workspace.trust({ directory });
        const opened = yield* workspace.open({ directory });
        if (!Workspace.OpenResult.guards.ready(opened)) {
          return yield* Effect.die(new Error("expected a ready workspace"));
        }

        const found = yield* workspace.find({ workspaceId: opened.id });
        expect(found.id).toBe(opened.id);
        expect(found.directory).toBe(opened.directory);
      });

      yield* program.pipe(Effect.provide(serviceLayer()));
    }),
  );

  it.effect("unknown ids fail with the typed NotFoundError", () =>
    Effect.gen(function* () {
      const program = Effect.gen(function* () {
        const workspace = yield* Workspace.Service;
        const error = yield* workspace
          .find({ workspaceId: Workspace.WorkspaceId.make("missing") })
          .pipe(Effect.flip);

        expect(error).toBeInstanceOf(Workspace.NotFoundError);
        expect(error.code).toBe("workspace.not_found");
        expect(error.workspaceId).toBe("missing");
      });

      yield* program.pipe(Effect.provide(serviceLayer()));
    }),
  );
});
