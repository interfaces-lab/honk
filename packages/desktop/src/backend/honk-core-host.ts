import { createServer } from "node:http";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

import { Workspace } from "@honk/core/workspace";

export interface HonkCoreHostShape {
  readonly baseUrl: string;
}

export class HonkCoreHost extends Context.Service<HonkCoreHost, HonkCoreHostShape>()(
  "honk/desktop/HonkCoreHost",
) {}

// Serves the Honk Core workspace RPC group over HTTP on a loopback port so the
// renderer's /debug/core page exercises the real Effect RPC remote-client path
// from spec/core.md. The writer-lease host replaces this once session hosting
// lands; the RPC group and handlers already come unchanged from @honk/core.
const rpcRouteLayer = RpcServer.layerHttp({
  group: Workspace.Rpcs,
  path: "/rpc",
  protocol: "http",
}).pipe(
  Layer.provide(Workspace.rpcLayer),
  Layer.provide(Workspace.layer),
  Layer.provide(RpcSerialization.layerJson),
);

// The dev renderer runs on its own origin (the Vite port), so the loopback
// RPC server answers preflights and marks responses like the aux server does.
const serveLayer = HttpRouter.serve(Layer.mergeAll(rpcRouteLayer, HttpRouter.cors()), {
  disableLogger: true,
  disableListenLog: true,
});

export const layer = Layer.effect(
  HonkCoreHost,
  Effect.gen(function* () {
    const { address } = yield* HttpServer.HttpServer;
    if (address._tag !== "TcpAddress") {
      return yield* Effect.die(new Error("Honk Core host expected a TCP address."));
    }
    return HonkCoreHost.of({ baseUrl: `http://127.0.0.1:${address.port}` });
  }),
).pipe(
  Layer.provide(serveLayer),
  Layer.provide(NodeHttpServer.layer(createServer, { host: "127.0.0.1", port: 0 })),
);
