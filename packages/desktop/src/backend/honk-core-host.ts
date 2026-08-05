import { writeFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

import { HonkCore } from "@honk/core";
import { createNodeExecutionEnv } from "@honk/core/node";

export interface HonkCoreHostShape {
  readonly baseUrl: string;
}

export class HonkCoreHost extends Context.Service<HonkCoreHost, HonkCoreHostShape>()(
  "honk/desktop/HonkCoreHost",
) {}

// Re-exported, not re-merged: @honk/core owns the command catalog, so a
// desktop, web, or test host cannot assemble a different one. The renderer
// builds its client from this same value.
export const Rpcs = HonkCore.Rpcs;

// Serves the Honk Core RPC group over HTTP on a loopback port so the
// renderer's /v2 page exercises the real Effect RPC remote-client path from
// spec/core.md. Ndjson serialization on purpose: its framing is what lets the
// session events stream flow over a chunked HTTP response.
// TODO(core-migration §6): spec section 6 puts the desktop renderer on an
// in-process IPC client, not a network transport. Handing the renderer
// `core.client()` over IPC deletes `rpcRouteLayer`, `serveLayer`, the
// `NodeHttpServer` layer below, and the `baseUrl` this module exists to mint.
const rpcRouteLayer = (options: HonkCore.HonkCoreOptions) =>
  RpcServer.layerHttp({
    group: Rpcs,
    path: "/rpc",
    protocol: "http",
  }).pipe(Layer.provide(HonkCore.layer(options)), Layer.provide(RpcSerialization.layerNdjson));

// The dev renderer runs on its own origin (the Vite port), so the loopback
// RPC server answers preflights and marks responses like the aux server does.
// TODO(core-migration §6, §5): every session command is reachable unauthenticated
// on this loopback port, and `HttpRouter.cors()` opens it to any origin the
// browser sends, so workspace trust — Honk's only permission gate — guards
// nothing against another local process or a page the user visits. The IPC
// transport from spec section 6 has no origin and no port, which deletes both
// this CORS layer and the server it fronts.
const serveLayer = (options: HonkCore.HonkCoreOptions) =>
  HttpRouter.serve(Layer.mergeAll(rpcRouteLayer(options), HttpRouter.cors()), {
    disableLogger: true,
    disableListenLog: true,
  });

export const make = (options: HonkCore.HonkCoreOptions) =>
  Layer.effect(
    HonkCoreHost,
    Effect.gen(function* () {
      const { address } = yield* HttpServer.HttpServer;
      if (address._tag !== "TcpAddress") {
        return yield* Effect.die(new Error("Honk Core host expected a TCP address."));
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;

      // Discovery for out-of-process clients — the verification CLI reads
      // this to reach the running host instead of fighting it for the writer
      // lease. Removed on shutdown so a dead host never advertises.
      const hostFile = join(options.dataDirectory, "host.json");
      yield* Effect.promise(() => writeFile(hostFile, `${JSON.stringify({ baseUrl })}\n`)).pipe(
        Effect.ignore,
      );
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => rm(hostFile, { force: true })).pipe(Effect.ignore),
      );

      return HonkCoreHost.of({ baseUrl });
    }),
  ).pipe(
    Layer.provide(serveLayer(options)),
    Layer.provide(NodeHttpServer.layer(createServer, { host: "127.0.0.1", port: 0 })),
  );

// TODO(core-migration §6, §10): a fixed /tmp path is a dev convenience, not a
// per-install data directory. The packaged app should derive this from
// Electron's userData path when the main process owns core construction.
const DATA_DIRECTORY = "/tmp/honk-core-desktop";

// The shipped host: every Pi built-in provider over the credential store
// persisted in the data directory's auth.json. A key stored through
// `models.set_credential` (or an ambient env var like ANTHROPIC_API_KEY)
// unlocks its provider for the debug page's next request. Tests inject Pi's
// faux provider through `make` instead.
export const layer = make({
  dataDirectory: DATA_DIRECTORY,
  createExecutionEnv: createNodeExecutionEnv,
});
