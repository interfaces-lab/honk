import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Deferred, Effect, Fiber, Layer, Stream } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { describe, expect, it } from "vitest";

import { AgentHarnessError, createHonkClient } from "@honk/core";
import { createNodeExecutionEnv } from "@honk/core/node";
import { Session } from "@honk/core/session";
import { gatedResponse, makeFauxSessionLayer, messageEntries, textOf } from "@honk/core/testing";
import { Workspace } from "@honk/core/workspace";

import * as HonkCoreHost from "./honk-core-host";

// The same client wiring the renderer's /v2 page uses: fetch over loopback
// HTTP against the host layer, so this covers the full serialized contract.
// Ndjson serialization matches the host: framed messages are what let the
// session events stream flow over a chunked HTTP response.
// The production layer owns the fixed /tmp data directory, and a running
// desktop app may hold its writer lease. Tests get the same host wiring over
// a fresh directory so they never contend with a live app.
const freshHostLayer = async (options?: { readonly realModels?: boolean }) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "honk-host-data-"));
  if (options?.realModels === true) {
    return HonkCoreHost.make({ dataDirectory, createExecutionEnv: createNodeExecutionEnv });
  }
  const { createModels, createExecutionEnv } = makeFauxSessionLayer();
  return HonkCoreHost.make({ dataDirectory, createModels, createExecutionEnv });
};

const clientFor = (baseUrl: string) =>
  RpcClient.make(HonkCoreHost.Rpcs).pipe(
    Effect.provide(
      RpcClient.layerProtocolHttp({ url: `${baseUrl}/rpc` }).pipe(
        Layer.provide(FetchHttpClient.layer),
        Layer.provide(RpcSerialization.layerNdjson),
      ),
    ),
  );

describe("honk core host", () => {
  it("serves workspace open and trust over loopback HTTP", async () => {
    // Fresh directories per run: trust persists in the data directory now, so
    // a shared fixed path would answer "ready" on every run after the first.
    const { createModels, createExecutionEnv } = makeFauxSessionLayer();
    const dataDirectory = await mkdtemp(join(tmpdir(), "honk-host-data-"));
    const workspaceDirectory = await mkdtemp(join(tmpdir(), "honk-host-ws-"));

    const program = Effect.gen(function* () {
      const host = yield* HonkCoreHost.HonkCoreHost;
      const client = yield* clientFor(host.baseUrl);

      const first = yield* client["workspace.open"]({ directory: workspaceDirectory });
      expect(first.type).toBe("trust_required");

      yield* client["workspace.trust"]({ directory: workspaceDirectory });

      const second = yield* client["workspace.open"]({ directory: workspaceDirectory });
      expect(Workspace.OpenResult.guards.ready(second)).toBe(true);
    });

    await Effect.runPromise(
      program.pipe(
        Effect.scoped,
        Effect.provide(HonkCoreHost.make({ dataDirectory, createModels, createExecutionEnv })),
      ),
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
      program.pipe(Effect.scoped, Effect.provide(await freshHostLayer())),
    );
  });

  it("runs the session loop over loopback HTTP: create, live events, prompt, reload", async () => {
    const { faux, createModels, createExecutionEnv } = makeFauxSessionLayer();
    const { release, response } = gatedResponse("Hello over HTTP");
    faux.setResponses([response]);

    const program = Effect.gen(function* () {
      const host = yield* HonkCoreHost.HonkCoreHost;
      const client = yield* clientFor(host.baseUrl);

      // Trust canonicalizes through the real filesystem, so the fixture
      // directory must exist before consent can be recorded for it.
      yield* Effect.promise(() => mkdir("/tmp/honk-core-host-session-test", { recursive: true }));
      yield* client["workspace.trust"]({ directory: "/tmp/honk-core-host-session-test" });
      const workspace = yield* client["workspace.open"]({
        directory: "/tmp/honk-core-host-session-test",
      });
      if (!Workspace.OpenResult.guards.ready(workspace)) {
        return yield* Effect.die(new Error("expected a trusted workspace"));
      }
      const { id } = yield* client["session.create"]({ workspaceId: workspace.id });

      const live = yield* Deferred.make<void>();
      const sawStart = yield* Deferred.make<void>();
      const sawSettled = yield* Deferred.make<void>();
      yield* client["session.events"]({ sessionId: id }).pipe(
        Stream.runForEach((frame) =>
          Effect.gen(function* () {
            if (frame.type === "live") {
              yield* Deferred.succeed(live, undefined);
            } else if (frame.event.type === "agent_start") {
              yield* Deferred.succeed(sawStart, undefined);
            } else if (frame.event.type === "settled") {
              yield* Deferred.succeed(sawSettled, undefined);
            }
          }),
        ),
        Effect.forkScoped,
      );

      // Spec section 9 listen-then-read across a real HTTP boundary: the
      // head frame proves the server-side subscription is live before the
      // prompt is sent.
      yield* Deferred.await(live);

      const run = yield* client["session.prompt"]({ sessionId: id, text: "Say hello" }).pipe(
        Effect.forkScoped,
      );
      yield* Deferred.await(sawStart);

      const during = yield* client["session.reload"]({ sessionId: id });
      expect(during.status).toBe("running");

      release();
      yield* Fiber.join(run);
      yield* Deferred.await(sawSettled);

      const after = yield* client["session.reload"]({ sessionId: id });
      expect(after.status).toBe("idle");
      const messages = messageEntries(after.entries);
      expect(messages.map((entry) => entry.message.role)).toEqual(["user", "assistant"]);
      expect(textOf(messages[1])).toBe("Hello over HTTP");
    });

    await Effect.runPromise(
      program.pipe(
        Effect.scoped,
        Effect.provide(
          HonkCoreHost.make({
            dataDirectory: "/tmp/honk-core-host-test",
            createModels,
            createExecutionEnv,
          }),
        ),
      ),
    );
  });

  it("reconstructs Pi's own error classes across the wire", async () => {
    // Steering an idle session is Pi's invalid_state refusal. Over HTTP the
    // error serializes to its stable fields and decodes back into the real
    // AgentHarnessError class, so instanceof keeps working in the renderer.
    const { createModels, createExecutionEnv } = makeFauxSessionLayer();
    const dataDirectory = await mkdtemp(join(tmpdir(), "honk-host-pierr-data-"));
    const workspaceDirectory = await mkdtemp(join(tmpdir(), "honk-host-pierr-ws-"));

    const program = Effect.gen(function* () {
      const host = yield* HonkCoreHost.HonkCoreHost;
      const sdk = yield* Effect.promise(() => createHonkClient({ url: host.baseUrl }));

      yield* Effect.promise(() => sdk.workspace.trust({ directory: workspaceDirectory }));
      const workspace = yield* Effect.promise(() =>
        sdk.workspace.open({ directory: workspaceDirectory }),
      );
      if (!Workspace.OpenResult.guards.ready(workspace)) {
        return yield* Effect.die(new Error("expected a trusted workspace"));
      }
      const { id } = yield* Effect.promise(() =>
        sdk.session.create({ workspaceId: workspace.id }),
      );

      // The SDK is promise-shaped; capture its rejection as a value.
      const error = yield* Effect.promise(() =>
        sdk.session.steer({ sessionId: id, text: "nobody is running" }).then(
          () => null,
          (cause: unknown) => cause,
        ),
      );

      expect(error).toBeInstanceOf(AgentHarnessError);
      if (error instanceof AgentHarnessError) {
        expect(error.code).toBe("invalid_state");
        expect(error.message.length).toBeGreaterThan(0);
      }

      yield* Effect.promise(() => sdk.close());
    });

    await Effect.runPromise(
      program.pipe(
        Effect.scoped,
        Effect.provide(HonkCoreHost.make({ dataDirectory, createModels, createExecutionEnv })),
      ),
    );
  });

  it("returns the typed session NotFoundError across the wire", async () => {
    const program = Effect.gen(function* () {
      const host = yield* HonkCoreHost.HonkCoreHost;
      const client = yield* clientFor(host.baseUrl);

      const error = yield* client["session.reload"]({
        sessionId: Session.SessionId.make("missing"),
      }).pipe(Effect.flip);

      expect(error).toBeInstanceOf(Session.NotFoundError);
      if (error instanceof Session.NotFoundError) {
        expect(error.code).toBe("session.not_found");
        expect(error.sessionId).toBe("missing");
      }
    });

    await Effect.runPromise(
      program.pipe(Effect.scoped, Effect.provide(await freshHostLayer())),
    );
  });

  it("aborts a running session over loopback HTTP and settles it back to idle", async () => {
    const { faux, createModels, createExecutionEnv } = makeFauxSessionLayer();
    const { response } = gatedResponse("never delivered");
    faux.setResponses([response]);

    const program = Effect.gen(function* () {
      const host = yield* HonkCoreHost.HonkCoreHost;
      const client = yield* clientFor(host.baseUrl);

      yield* Effect.promise(() => mkdir("/tmp/honk-core-host-abort-test", { recursive: true }));
      yield* client["workspace.trust"]({ directory: "/tmp/honk-core-host-abort-test" });
      const workspace = yield* client["workspace.open"]({
        directory: "/tmp/honk-core-host-abort-test",
      });
      if (!Workspace.OpenResult.guards.ready(workspace)) {
        return yield* Effect.die(new Error("expected a trusted workspace"));
      }
      const { id } = yield* client["session.create"]({ workspaceId: workspace.id });

      const live = yield* Deferred.make<void>();
      const sawStart = yield* Deferred.make<void>();
      const sawSettled = yield* Deferred.make<void>();
      yield* client["session.events"]({ sessionId: id }).pipe(
        Stream.runForEach((frame) =>
          Effect.gen(function* () {
            if (frame.type === "live") yield* Deferred.succeed(live, undefined);
            if (frame.type === "event" && frame.event.type === "agent_start") {
              yield* Deferred.succeed(sawStart, undefined);
            }
            if (frame.type === "event" && frame.event.type === "settled") {
              yield* Deferred.succeed(sawSettled, undefined);
            }
          }),
        ),
        Effect.forkScoped,
      );
      yield* Deferred.await(live);

      const run = yield* client["session.prompt"]({ sessionId: id, text: "Wait" }).pipe(
        Effect.forkScoped,
      );
      yield* Deferred.await(sawStart);
      yield* client["session.abort"]({ sessionId: id });
      yield* Fiber.join(run);
      yield* Deferred.await(sawSettled);

      const after = yield* client["session.reload"]({ sessionId: id });
      expect(after.status).toBe("idle");
    });

    await Effect.runPromise(
      program.pipe(
        Effect.scoped,
        Effect.provide(
          HonkCoreHost.make({
            dataDirectory: "/tmp/honk-core-host-test",
            createModels,
            createExecutionEnv,
          }),
        ),
      ),
    );
  });

  it("createHonkClient drives the same host through the public facade", async () => {
    // The renderer's client: the HonkClient interface over HTTP, no RPC
    // wiring in application code. Walking open → trust → open through it
    // proves the remote facade against a live host, not a mock.
    const { createModels, createExecutionEnv } = makeFauxSessionLayer();
    const dataDirectory = await mkdtemp(join(tmpdir(), "honk-host-sdk-data-"));
    const workspaceDirectory = await mkdtemp(join(tmpdir(), "honk-host-sdk-ws-"));

    const program = Effect.gen(function* () {
      const host = yield* HonkCoreHost.HonkCoreHost;
      const sdk = yield* Effect.promise(() => createHonkClient({ url: host.baseUrl }));

      const refused = yield* Effect.promise(() =>
        sdk.workspace.open({ directory: workspaceDirectory }),
      );
      expect(refused.type).toBe("trust_required");
      yield* Effect.promise(() => sdk.workspace.trust({ directory: workspaceDirectory }));
      const opened = yield* Effect.promise(() =>
        sdk.workspace.open({ directory: workspaceDirectory }),
      );
      expect(Workspace.OpenResult.guards.ready(opened)).toBe(true);

      const { providers } = yield* Effect.promise(() => sdk.models.list({}));
      expect(providers.some((provider) => provider.id === "faux")).toBe(true);

      yield* Effect.promise(() => sdk.close());
    });

    await Effect.runPromise(
      program.pipe(
        Effect.scoped,
        Effect.provide(HonkCoreHost.make({ dataDirectory, createModels, createExecutionEnv })),
      ),
    );
  });

  it("default layer serves the real provider catalog over the wire", async () => {
    // The shipped host builds Pi's built-in providers over the persisted
    // credential store — the debug page's route to a real model. Listing the
    // catalog proves that wiring without touching any network: anthropic must
    // be present, and the faux provider must not ship in the default layer.
    const program = Effect.gen(function* () {
      const host = yield* HonkCoreHost.HonkCoreHost;
      const client = yield* clientFor(host.baseUrl);

      const { providers } = yield* client["models.list"]({});
      const ids = providers.map((provider) => provider.id);
      expect(ids).toContain("anthropic");
      expect(ids).not.toContain("faux");
    });

    await Effect.runPromise(
      program.pipe(Effect.scoped, Effect.provide(await freshHostLayer({ realModels: true }))),
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
      program.pipe(Effect.scoped, Effect.provide(await freshHostLayer())),
    );
  });
});
