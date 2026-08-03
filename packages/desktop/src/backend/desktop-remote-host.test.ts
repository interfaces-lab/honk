import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readHostState, writeHostState, type HostState } from "@honk/cli/state";
import type { DesktopServerExposureState } from "@honk/shared/desktop-api";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { DesktopEnvironment } from "../app/desktop-environment";
import { DEFAULT_DESKTOP_SETTINGS, layerTest } from "../settings/desktop-app-settings";
import { OpencodeSidecar } from "./opencode-sidecar";
import { DesktopRemoteHost, layer } from "./desktop-remote-host";
import { DesktopServerExposure } from "./desktop-server-exposure";

const testDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    testDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function makeTestLayer(
  input: {
    readonly bindHost?: string;
    readonly configureFails?: boolean;
    readonly exposureState?: DesktopServerExposureState;
    readonly remoteEnabled?: boolean;
    readonly webAssets?: boolean;
  } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "honk-remote-host-test-"));
  testDirectories.push(directory);
  const statePath = join(directory, "remote-host.json");
  const rendererDirectory = join(directory, "out/renderer");
  if (input.webAssets !== false) {
    await mkdir(join(rendererDirectory, "assets"), { recursive: true });
    await Promise.all([
      writeFile(join(rendererDirectory, "index.html"), "<!doctype html><title>Honk web</title>"),
      writeFile(join(rendererDirectory, "assets/app.js"), "console.log('Honk web');"),
    ]);
  }
  const NodeServices = await import("@effect/platform-node/NodeServices");
  const DesktopConfig = await import("../app/desktop-config");
  const DesktopEnvironmentModule = await import("../app/desktop-environment");
  const environment = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* DesktopEnvironment;
    }).pipe(
      Effect.provide(
        DesktopEnvironmentModule.layer({
          dirname: directory,
          homeDirectory: directory,
          platform: "darwin",
          processArch: "arm64",
          appVersion: "0.0.0-test",
          appPath: directory,
          isPackaged: false,
          resourcesPath: directory,
          documentsDirectory: directory,
          runningUnderArm64Translation: false,
        }),
      ),
      Effect.provide(DesktopConfig.layerTest({ HONK_HOME: directory })),
      Effect.provide(NodeServices.layer),
    ),
  );
  const sidecarRequested = await Effect.runPromise(Deferred.make<void>());
  const sidecarReady = await Effect.runPromise(Deferred.make<void>());
  const tunnelExit = await Effect.runPromise(Deferred.make<void>());
  const closedTunnels: number[] = [];
  const exposureState =
    input.exposureState ??
    (input.remoteEnabled
      ? {
          mode: "network-accessible" as const,
          localUrl: "http://127.0.0.1:3773",
          endpointUrl: "https://studio.example.com",
          browserUrl: "https://studio.example.com",
          customUrl: "https://studio.example.com",
          advertisedHost: null,
        }
      : {
          mode: "local-only" as const,
          localUrl: "http://127.0.0.1:3773",
          endpointUrl: null,
          browserUrl: null,
          customUrl: null,
          advertisedHost: null,
        });
  const dependencies = Layer.mergeAll(
    Layer.succeed(DesktopEnvironment, {
      ...environment,
      appRoot: directory,
      remoteHostStatePath: statePath,
    }),
    layerTest({ ...DEFAULT_DESKTOP_SETTINGS, remoteHostName: "Studio Mac" }),
    Layer.succeed(
      DesktopServerExposure,
      DesktopServerExposure.of({
        getState: Effect.succeed(exposureState),
        backendConfig: input.remoteEnabled
          ? Effect.succeed({
              port: 0,
              bindHost: input.bindHost ?? "127.0.0.1",
              httpBaseUrl: new URL("http://127.0.0.1:0"),
            })
          : Effect.die("The local-only test must not request backend configuration."),
        configureFromSettings: () =>
          input.configureFails
            ? Effect.sync(() => {
                throw new Error("Exposure setup failed.");
              })
            : Effect.succeed(exposureState),
        setConfiguration: () =>
          Effect.die("The remote-host test must not change exposure configuration."),
        closeTunnel: Effect.sync(() => {
          closedTunnels.push(Date.now());
        }),
        awaitTunnelExit: Deferred.await(tunnelExit),
      }),
    ),
    Layer.succeed(
      OpencodeSidecar,
      OpencodeSidecar.of({
        start: Effect.void,
        stop: () => Effect.void,
        snapshot: input.remoteEnabled
          ? Deferred.succeed(sidecarRequested, undefined).pipe(
              Effect.andThen(Deferred.await(sidecarReady)),
              Effect.as({
                status: "ready" as const,
                url: "http://127.0.0.1:4096",
                password: "sidecar-password",
              }),
            )
          : Effect.succeed({ status: "idle", url: null, password: null }),
      }),
    ),
  );
  return {
    closedTunnels,
    statePath,
    sidecarReady,
    sidecarRequested,
    tunnelExit,
    remoteHostLayer: layer.pipe(
      Layer.provide(dependencies),
      Layer.provide(DesktopConfig.layerTest({ HONK_HOME: directory })),
      Layer.provide(NodeServices.layer),
    ),
  };
}

function savedState(): HostState {
  return {
    version: 1,
    pid: 1,
    adminSecret: "admin-secret",
    serverId: "server-identity",
    origin: "http://127.0.0.1:3773",
    publicUrl: "https://studio.example.com",
    upstreamOrigin: "http://127.0.0.1:4096",
    cwd: "/tmp",
    devices: [
      {
        id: "phone",
        label: "Phone",
        passwordHash: "phone-hash",
        createdAt: "2026-07-20T18:00:00.000Z",
        revokedAt: null,
      },
      {
        id: "tablet",
        label: "Tablet",
        passwordHash: "tablet-hash",
        createdAt: "2026-07-20T18:01:00.000Z",
        revokedAt: null,
      },
    ],
  };
}

describe("DesktopRemoteHost offline device management", () => {
  it("serves the browser pairing shell before the device has credentials", async () => {
    const test = await makeTestLayer({ remoteEnabled: true });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const remoteHost = yield* DesktopRemoteHost;
        yield* Deferred.succeed(test.sidecarReady, undefined);
        yield* remoteHost.start;
        const pairing = yield* remoteHost.issuePairing;
        const saved = yield* Effect.promise(() => readHostState(test.statePath));
        if (saved === null) throw new Error("The remote host did not save its runtime state.");
        const page = yield* Effect.promise(() =>
          fetch(saved.origin, { headers: { accept: "text/html" } }),
        );
        const asset = yield* Effect.promise(() => fetch(`${saved.origin}/assets/app.js`));
        return {
          assetBody: yield* Effect.promise(() => asset.text()),
          assetStatus: asset.status,
          body: yield* Effect.promise(() => page.text()),
          pairing,
          status: page.status,
          wwwAuthenticate: page.headers.get("www-authenticate"),
        };
      }).pipe(Effect.provide(test.remoteHostLayer), Effect.scoped),
    );

    expect(result).toMatchObject({
      assetBody: "console.log('Honk web');",
      assetStatus: 200,
      body: "<!doctype html><title>Honk web</title>",
      pairing: { url: expect.stringContaining("#pairing=") },
      status: 200,
      wwwAuthenticate: null,
    });
  });

  it("omits a browser pairing link from a plaintext LAN snapshot", async () => {
    const test = await makeTestLayer({
      remoteEnabled: true,
      exposureState: {
        mode: "network-accessible",
        localUrl: "http://127.0.0.1:3773",
        endpointUrl: "http://192.168.1.42:3773",
        browserUrl: null,
        customUrl: null,
        advertisedHost: "192.168.1.42",
      },
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const remoteHost = yield* DesktopRemoteHost;
        yield* Deferred.succeed(test.sidecarReady, undefined);
        yield* remoteHost.start;
        return {
          pairing: yield* remoteHost.issuePairing,
          state: yield* remoteHost.getState,
        };
      }).pipe(Effect.provide(test.remoteHostLayer), Effect.scoped),
    );

    expect(result.pairing.url).toBeNull();
    expect(result.pairing.mobileUrl).toMatch(/^honk:\/\/connect\?origin=/);
    expect(result.state).toMatchObject({
      status: "ready",
      publicUrl: "http://192.168.1.42:3773",
    });
  });

  it("reports when Same Wi-Fi has no LAN address", async () => {
    const test = await makeTestLayer({
      remoteEnabled: true,
      exposureState: {
        mode: "network-accessible",
        localUrl: "http://127.0.0.1:3773",
        endpointUrl: null,
        browserUrl: null,
        customUrl: null,
        advertisedHost: null,
      },
    });

    const state = await Effect.runPromise(
      Effect.gen(function* () {
        const remoteHost = yield* DesktopRemoteHost;
        yield* remoteHost.start;
        return yield* remoteHost.getState;
      }).pipe(Effect.provide(test.remoteHostLayer), Effect.scoped),
    );

    expect(state).toMatchObject({
      status: "error",
      errorMessage: "Honk could not find this computer on your Wi-Fi network.",
    });
  });

  it("starts the host with the temporary tunnel URL", async () => {
    const test = await makeTestLayer({
      remoteEnabled: true,
      exposureState: {
        mode: "tunnel",
        localUrl: "http://127.0.0.1:3773",
        endpointUrl: "https://blue-bird.trycloudflare.com",
        browserUrl: "https://blue-bird.trycloudflare.com",
        customUrl: null,
        advertisedHost: "blue-bird.trycloudflare.com",
      },
    });

    const state = await Effect.runPromise(
      Effect.gen(function* () {
        const remoteHost = yield* DesktopRemoteHost;
        yield* Deferred.succeed(test.sidecarReady, undefined);
        yield* remoteHost.start;
        return yield* remoteHost.getState;
      }).pipe(Effect.provide(test.remoteHostLayer), Effect.scoped),
    );

    expect(state).toMatchObject({
      status: "ready",
      publicUrl: "https://blue-bird.trycloudflare.com",
    });
  });

  it("stops advertising a temporary link once its process exits", async () => {
    const test = await makeTestLayer({
      remoteEnabled: true,
      exposureState: {
        mode: "tunnel",
        localUrl: "http://127.0.0.1:3773",
        endpointUrl: "https://blue-bird.trycloudflare.com",
        browserUrl: "https://blue-bird.trycloudflare.com",
        customUrl: null,
        advertisedHost: "blue-bird.trycloudflare.com",
      },
    });

    const state = await Effect.runPromise(
      Effect.gen(function* () {
        const remoteHost = yield* DesktopRemoteHost;
        yield* Deferred.succeed(test.sidecarReady, undefined);
        yield* remoteHost.start;
        yield* Deferred.succeed(test.tunnelExit, undefined);
        // The watcher runs in its own fiber, so hand it the scheduler before reading the state.
        yield* Effect.yieldNow;
        return yield* remoteHost.getState;
      }).pipe(Effect.provide(test.remoteHostLayer), Effect.scoped),
    );

    expect(state).toMatchObject({
      status: "error",
      publicUrl: null,
      errorMessage: "The temporary link closed. Restart Honk to create a new one.",
    });
  });

  it("does not advertise a temporary link whose process exits during startup", async () => {
    const test = await makeTestLayer({
      remoteEnabled: true,
      exposureState: {
        mode: "tunnel",
        localUrl: "http://127.0.0.1:3773",
        endpointUrl: "https://blue-bird.trycloudflare.com",
        browserUrl: "https://blue-bird.trycloudflare.com",
        customUrl: null,
        advertisedHost: "blue-bird.trycloudflare.com",
      },
    });

    const state = await Effect.runPromise(
      Effect.gen(function* () {
        const remoteHost = yield* DesktopRemoteHost;
        const startup = yield* Effect.forkScoped(remoteHost.start);
        yield* Deferred.await(test.sidecarRequested);
        yield* Deferred.succeed(test.tunnelExit, undefined);
        yield* Deferred.succeed(test.sidecarReady, undefined);
        yield* Fiber.join(startup);
        yield* Effect.yieldNow;
        return yield* remoteHost.getState;
      }).pipe(Effect.provide(test.remoteHostLayer), Effect.scoped),
    );

    expect(state).toMatchObject({
      status: "error",
      publicUrl: null,
      errorMessage: "The temporary link closed. Restart Honk to create a new one.",
    });
  });

  it("closes the tunnel when the host cannot bind", async () => {
    // 192.0.2.1 is TEST-NET-1, so no interface carries it and the listener always fails.
    const test = await makeTestLayer({ remoteEnabled: true, bindHost: "192.0.2.1" });

    const state = await Effect.runPromise(
      Effect.gen(function* () {
        const remoteHost = yield* DesktopRemoteHost;
        yield* Deferred.succeed(test.sidecarReady, undefined);
        yield* remoteHost.start;
        return yield* remoteHost.getState;
      }).pipe(Effect.provide(test.remoteHostLayer), Effect.scoped),
    );

    expect(state.status).toBe("error");
    expect(test.closedTunnels).toHaveLength(1);
  });

  it("reports a tunnel-specific error when no temporary URL was opened", async () => {
    const test = await makeTestLayer({
      remoteEnabled: true,
      exposureState: {
        mode: "tunnel",
        localUrl: "http://127.0.0.1:3773",
        endpointUrl: null,
        browserUrl: null,
        customUrl: null,
        advertisedHost: null,
      },
    });

    const state = await Effect.runPromise(
      Effect.gen(function* () {
        const remoteHost = yield* DesktopRemoteHost;
        yield* remoteHost.start;
        return yield* remoteHost.getState;
      }).pipe(Effect.provide(test.remoteHostLayer), Effect.scoped),
    );

    expect(state).toMatchObject({
      status: "error",
      errorMessage:
        "Honk could not open a temporary link. Check this computer's internet connection, then try again.",
    });
  });

  it("fails device connections clearly when the browser shell is missing", async () => {
    const test = await makeTestLayer({ remoteEnabled: true, webAssets: false });

    const state = await Effect.runPromise(
      Effect.gen(function* () {
        const remoteHost = yield* DesktopRemoteHost;
        yield* remoteHost.start;
        return yield* remoteHost.getState;
      }).pipe(Effect.provide(test.remoteHostLayer), Effect.scoped),
    );

    expect(state).toMatchObject({
      status: "error",
      errorMessage:
        "Honk's web app is missing. Reinstall Honk or rebuild the desktop app, then try again.",
    });
    await expect(readHostState(test.statePath)).resolves.toBeNull();
  });

  it("serializes concurrent rename and revoke updates while connections are off", async () => {
    const test = await makeTestLayer();
    await writeHostState(savedState(), test.statePath);

    const state = await Effect.runPromise(
      Effect.gen(function* () {
        const remoteHost = yield* DesktopRemoteHost;
        yield* remoteHost.start;
        yield* Effect.all(
          [remoteHost.renameDevice("phone", "Personal phone"), remoteHost.revokeDevice("tablet")],
          { concurrency: "unbounded" },
        );
        return yield* remoteHost.getState;
      }).pipe(Effect.provide(test.remoteHostLayer), Effect.scoped),
    );

    expect(state).toMatchObject({
      status: "disabled",
      name: "Studio Mac",
      devices: [
        { id: "phone", label: "Personal phone", revokedAt: null },
        { id: "tablet", label: "Tablet", revokedAt: expect.any(String) },
      ],
    });
    await expect(readHostState(test.statePath)).resolves.toMatchObject({ devices: state.devices });
  });

  it("keeps saved device history visible when exposure configuration throws", async () => {
    const test = await makeTestLayer({ configureFails: true });
    await writeHostState(savedState(), test.statePath);

    const state = await Effect.runPromise(
      Effect.gen(function* () {
        const remoteHost = yield* DesktopRemoteHost;
        yield* remoteHost.start;
        return yield* remoteHost.getState;
      }).pipe(Effect.provide(test.remoteHostLayer), Effect.scoped),
    );

    expect(state).toMatchObject({
      status: "error",
      name: "Studio Mac",
      errorMessage: "Exposure setup failed.",
      devices: [
        { id: "phone", label: "Phone" },
        { id: "tablet", label: "Tablet" },
      ],
    });
  });

  it("does not overwrite a device revoked while the remote host is starting", async () => {
    const test = await makeTestLayer({ remoteEnabled: true });
    await writeHostState(savedState(), test.statePath);

    const state = await Effect.runPromise(
      Effect.gen(function* () {
        const remoteHost = yield* DesktopRemoteHost;
        const startup = yield* Effect.forkScoped(remoteHost.start);
        yield* Deferred.await(test.sidecarRequested);
        yield* remoteHost.revokeDevice("tablet");
        yield* Deferred.succeed(test.sidecarReady, undefined);
        yield* Fiber.join(startup);
        return yield* remoteHost.getState;
      }).pipe(Effect.provide(test.remoteHostLayer), Effect.scoped),
    );

    expect(state.errorMessage).toBeNull();
    expect(state).toMatchObject({
      status: "ready",
      devices: [
        { id: "phone", label: "Phone", revokedAt: null },
        { id: "tablet", label: "Tablet", revokedAt: expect.any(String) },
      ],
    });
    await expect(readHostState(test.statePath)).resolves.toMatchObject({ devices: state.devices });
  });
});
