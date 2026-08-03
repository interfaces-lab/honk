import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import { RpcTest } from "effect/unstable/rpc";

import { Workspace } from "../src/workspace";

const handlers = Workspace.rpcLayer.pipe(Layer.provide(Workspace.defaultLayer));

describe("workspace.open contract", () => {
  it.effect("decodes every public result state", () =>
    Effect.gen(function* () {
      const trustRequired = yield* Schema.decodeUnknownEffect(Workspace.OpenResult)({
        type: "trust_required",
        directory: "/workspace",
      });
      const ready = yield* Schema.decodeUnknownEffect(Workspace.OpenResult)({
        type: "ready",
        id: "workspace-1",
        directory: "/workspace",
      });

      expect(trustRequired.type).toBe("trust_required");
      expect(Workspace.OpenResult.guards.ready(ready)).toBe(true);
      if (Workspace.OpenResult.guards.ready(ready)) expect(ready.id).toBe("workspace-1");
    }),
  );

  it("defines typed RPCs with stable error contracts", () => {
    const error = new Workspace.OpenError({ directory: "/workspace" });

    expect(Workspace.Open._tag).toBe("workspace.open");
    expect(Workspace.Rpcs.requests.get("workspace.open")).toBe(Workspace.Open);
    expect(Workspace.Rpcs.requests.get("workspace.trust")).toBe(Workspace.Trust);
    expect(error.code).toBe("workspace.open_failed");
    expect(error.message).toBe("Honk could not open this workspace.");
  });
});

describe("workspace rpc handlers", () => {
  it.effect("walks open, trust, open through an in-process client", () =>
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(Workspace.Rpcs);

      const first = yield* client["workspace.open"]({ directory: "/tmp/honk-demo" });
      expect(first.type).toBe("trust_required");

      yield* client["workspace.trust"]({ directory: "/tmp/honk-demo" });

      const second = yield* client["workspace.open"]({ directory: "/tmp/honk-demo" });
      const directory = Workspace.OpenResult.match(second, {
        trust_required: () => undefined,
        ready: (ready) => ready.directory,
      });
      expect(directory).toBe("/tmp/honk-demo");
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
});
