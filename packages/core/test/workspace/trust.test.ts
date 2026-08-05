// The trust gate over the wire: open, trust, canonicalization, and refusals.
// Lookup by id lives in lookup.test.ts.

import { symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { RpcTest } from "effect/unstable/rpc";

import { Workspace } from "../../src/workspace";
import { fixture, handlers } from "./fixture";

describe("workspace rpc handlers", () => {
  it.effect("walks open, trust, open through an in-process client", () =>
    Effect.gen(function* () {
      const { directory, canonical } = yield* Effect.promise(() => fixture("honk-demo-"));
      const client = yield* RpcTest.makeClient(Workspace.Rpcs);

      const first = yield* client["workspace.open"]({ directory });
      expect(first.type).toBe("trust_required");

      yield* client["workspace.trust"]({ directory });

      const second = yield* client["workspace.open"]({ directory });
      const opened = Workspace.OpenResult.match(second, {
        trust_required: () => undefined,
        ready: (ready) => ready.directory,
      });
      // The workspace's one name is the filesystem's spelling, not the
      // caller's: a tmpdir alias resolves to its canonical form.
      expect(opened).toBe(canonical);
      if (Workspace.OpenResult.guards.ready(second)) expect(second.id).not.toHaveLength(0);
    }).pipe(Effect.provide(handlers)),
  );

  it.effect("rejects a relative directory with the typed OpenError", () =>
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(Workspace.Rpcs);

      const error = yield* client["workspace.open"]({ directory: "relative/dir" }).pipe(
        Effect.flip,
      );

      expect(error).toBeInstanceOf(Workspace.OpenError);
      if (error instanceof Workspace.OpenError) {
        expect(error.code).toBe("workspace.open_failed");
        expect(error.directory).toBe("relative/dir");
      }
    }).pipe(Effect.provide(handlers)),
  );

  it.effect("refuses a directory that does not exist, for open and for trust", () =>
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(Workspace.Rpcs);
      const missing = join(tmpdir(), "honk-does-not-exist", "nested");

      const openError = yield* client["workspace.open"]({ directory: missing }).pipe(Effect.flip);
      const trustError = yield* client["workspace.trust"]({ directory: missing }).pipe(Effect.flip);

      // There is nothing for the user to consent to: an unresolvable
      // directory fails before trust could be recorded for it.
      expect(openError).toBeInstanceOf(Workspace.OpenError);
      expect(trustError).toBeInstanceOf(Workspace.TrustError);
    }).pipe(Effect.provide(handlers)),
  );

  it.effect("two spellings of one directory are one trust decision", () =>
    Effect.gen(function* () {
      const { directory: real, canonical } = yield* Effect.promise(() => fixture("honk-real-"));
      const { directory: holder } = yield* Effect.promise(() => fixture("honk-alias-"));
      const alias = join(holder, "door");
      yield* Effect.promise(() => symlink(real, alias));

      const client = yield* RpcTest.makeClient(Workspace.Rpcs);

      // Trust through the symlink, open through the real path: same
      // directory, so the trust decision must carry over.
      yield* client["workspace.trust"]({ directory: alias });
      const opened = yield* client["workspace.open"]({ directory: real });

      expect(Workspace.OpenResult.guards.ready(opened)).toBe(true);
      if (Workspace.OpenResult.guards.ready(opened)) {
        expect(opened.directory).toBe(canonical);
      }
    }).pipe(Effect.provide(handlers)),
  );
});
