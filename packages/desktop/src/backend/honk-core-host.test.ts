import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { describe, expect, it } from "vitest";

import { Workspace } from "@honk/core/workspace";

import * as HonkCoreHost from "./honk-core-host";

// The same client wiring the renderer's /v2 page uses: fetch over loopback
// HTTP against the host layer, so this covers the full serialized contract.
const clientFor = (baseUrl: string) =>
  RpcClient.make(Workspace.Rpcs).pipe(
    Effect.provide(
      RpcClient.layerProtocolHttp({ url: `${baseUrl}/rpc` }).pipe(
        Layer.provide(FetchHttpClient.layer),
        Layer.provide(RpcSerialization.layerJson),
      ),
    ),
  );

describe("honk core host", () => {
  it("serves workspace open and trust over loopback HTTP", async () => {
    const program = Effect.gen(function* () {
      const host = yield* HonkCoreHost.HonkCoreHost;
      const client = yield* clientFor(host.baseUrl);

      const first = yield* client["workspace.open"]({ directory: "/tmp/honk-core-host-test" });
      expect(first.type).toBe("trust_required");

      yield* client["workspace.trust"]({ directory: "/tmp/honk-core-host-test" });

      const second = yield* client["workspace.open"]({ directory: "/tmp/honk-core-host-test" });
      expect(Workspace.OpenResult.guards.ready(second)).toBe(true);
    });

    await Effect.runPromise(
      program.pipe(Effect.scoped, Effect.provide(HonkCoreHost.layer)),
    );
  });

  it("answers CORS preflights for the dev renderer origin", async () => {
    const program = Effect.gen(function* () {
      const host = yield* HonkCoreHost.HonkCoreHost;
      const response = yield* Effect.promise(() =>
        fetch(`${host.baseUrl}/rpc`, {
          method: "OPTIONS",
          headers: {
            origin: "http://127.0.0.1:5733",
            "access-control-request-method": "POST",
            "access-control-request-headers": "content-type",
          },
        }),
      );

      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(response.headers.get("access-control-allow-headers")).toContain("content-type");
    });

    await Effect.runPromise(
      program.pipe(Effect.scoped, Effect.provide(HonkCoreHost.layer)),
    );
  });

  it("returns the typed OpenError across the wire", async () => {
    const program = Effect.gen(function* () {
      const host = yield* HonkCoreHost.HonkCoreHost;
      const client = yield* clientFor(host.baseUrl);

      const error = yield* client["workspace.open"]({ directory: "relative/dir" }).pipe(
        Effect.flip,
      );

      expect(error).toBeInstanceOf(Workspace.OpenError);
      if (error instanceof Workspace.OpenError) {
        expect(error.code).toBe("workspace.open_failed");
        expect(error.message).toBe("Honk could not open this workspace.");
        expect(error.directory).toBe("relative/dir");
      }
    });

    await Effect.runPromise(
      program.pipe(Effect.scoped, Effect.provide(HonkCoreHost.layer)),
    );
  });
});
