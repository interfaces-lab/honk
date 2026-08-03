import {
  CloudflaredTunnelError,
  CloudflaredUnavailableError,
  TailscaleUnavailableError,
  type CloudflaredQuickTunnel,
} from "@honk/cli/host";
import { ConfigProvider, Deferred, Effect, Layer, Ref, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_DESKTOP_SETTINGS,
  DesktopAppSettings,
  DesktopSettingsWriteError,
  layerTest,
} from "../settings/desktop-app-settings";
import {
  DesktopNetworkInterfacesService,
  DesktopServerExposure,
  DesktopServerExposureLanUnavailableError,
  DesktopServerExposurePersistenceError,
  DesktopServerExposurePublicUrlError,
  DesktopServerExposureTailscaleError,
  DesktopServerExposureTunnelError,
  DesktopTailscaleEndpointService,
  DesktopTunnelEndpointService,
  layer,
  normalizeDesktopServerPublicUrl,
  resolveDesktopServerExposure,
  type DesktopNetworkInterfaces,
} from "./desktop-server-exposure";

const exposureLayer = (
  tailscaleAvailable: boolean,
  settingsLayer: Layer.Layer<DesktopAppSettings> = layerTest(DEFAULT_DESKTOP_SETTINGS),
  networkInterfaces: DesktopNetworkInterfaces = {},
  tunnel = DesktopTunnelEndpointService.of({
    probe: Effect.void,
    open: () => Effect.fail(new CloudflaredUnavailableError()),
    release: Effect.void,
  }),
) =>
  layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.succeed(
          DesktopNetworkInterfacesService,
          DesktopNetworkInterfacesService.of({ read: Effect.succeed(networkInterfaces) }),
        ),
        Layer.succeed(
          DesktopTailscaleEndpointService,
          DesktopTailscaleEndpointService.of({
            resolve: tailscaleAvailable
              ? Effect.succeed({
                  url: "https://studio.example.ts.net",
                  magicDnsName: "studio.example.ts.net",
                  tailnetIpv4Addresses: ["100.80.70.60"],
                })
              : Effect.fail(new TailscaleUnavailableError()),
          }),
        ),
        Layer.succeed(DesktopTunnelEndpointService, tunnel),
        settingsLayer,
        ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} })),
      ),
    ),
  );

describe("normalizeDesktopServerPublicUrl", () => {
  it("normalizes a public HTTPS origin", () => {
    expect(normalizeDesktopServerPublicUrl("  https://honk.example.com/  ")).toBe(
      "https://honk.example.com",
    );
    expect(normalizeDesktopServerPublicUrl("https://honk.example.com:443")).toBe(
      "https://honk.example.com",
    );
    expect(normalizeDesktopServerPublicUrl(" ")).toBeNull();
    expect(normalizeDesktopServerPublicUrl(null)).toBeNull();
  });

  it.each([
    "http://honk.example.com",
    "https://user:secret@honk.example.com",
    "https://honk.example.com/path",
    "https://honk.example.com?device=phone",
    "https://honk.example.com#secret",
    "not a URL",
  ])("rejects an unsafe public address: %s", (value) => {
    expect(() => normalizeDesktopServerPublicUrl(value)).toThrow(
      DesktopServerExposurePublicUrlError,
    );
  });
});

describe("DesktopServerExposureTunnelError", () => {
  it("offers recovery without requiring a manual cloudflared install", () => {
    expect(new DesktopServerExposureTunnelError().message).toBe(
      "Honk could not prepare the secure connection. Check your internet connection, then try again.",
    );
  });
});

describe("resolveDesktopServerExposure", () => {
  it("keeps a managed Tailscale endpoint on loopback", () => {
    expect(
      resolveDesktopServerExposure({
        mode: "tailscale",
        port: 3773,
        networkInterfaces: {},
        publicUrl: "https://custom.example.com",
        tailscaleEndpoint: {
          url: "https://workstation.example.ts.net",
          magicDnsName: "workstation.example.ts.net",
          tailnetIpv4Addresses: ["100.90.80.70"],
        },
        tunnelEndpoint: null,
      }),
    ).toMatchObject({
      mode: "tailscale",
      bindHost: "127.0.0.1",
      endpointUrl: "https://workstation.example.ts.net",
      browserUrl: "https://workstation.example.ts.net",
      advertisedHost: "workstation.example.ts.net",
    });
  });

  it("keeps a temporary tunnel endpoint on loopback", () => {
    expect(
      resolveDesktopServerExposure({
        mode: "tunnel",
        port: 3773,
        networkInterfaces: {},
        publicUrl: null,
        tailscaleEndpoint: null,
        tunnelEndpoint: {
          url: "https://blue-bird.trycloudflare.com",
          hostname: "blue-bird.trycloudflare.com",
        },
      }),
    ).toMatchObject({
      mode: "tunnel",
      bindHost: "127.0.0.1",
      endpointUrl: "https://blue-bird.trycloudflare.com",
      browserUrl: "https://blue-bird.trycloudflare.com",
      advertisedHost: "blue-bird.trycloudflare.com",
    });
    expect(
      resolveDesktopServerExposure({
        mode: "tunnel",
        port: 3773,
        networkInterfaces: {},
        publicUrl: null,
        tailscaleEndpoint: null,
        tunnelEndpoint: null,
      }),
    ).toMatchObject({
      bindHost: "127.0.0.1",
      endpointUrl: null,
      browserUrl: null,
      advertisedHost: null,
    });
  });

  it("advertises a private Wi-Fi address when no custom URL is set", () => {
    expect(
      resolveDesktopServerExposure({
        mode: "network-accessible",
        port: 3773,
        networkInterfaces: {
          en0: [{ address: "192.168.1.42", family: "IPv4", internal: false }],
        },
        publicUrl: null,
        tailscaleEndpoint: null,
        tunnelEndpoint: null,
      }),
    ).toMatchObject({
      mode: "network-accessible",
      bindHost: "0.0.0.0",
      endpointUrl: "http://192.168.1.42:3773",
      browserUrl: null,
      advertisedHost: "192.168.1.42",
    });
  });

  it("binds a custom endpoint to the network listener", () => {
    expect(
      resolveDesktopServerExposure({
        mode: "network-accessible",
        port: 3773,
        networkInterfaces: {
          en0: [{ address: "192.168.1.42", family: "IPv4", internal: false }],
        },
        publicUrl: "https://custom.example.com",
        tailscaleEndpoint: null,
        tunnelEndpoint: null,
      }),
    ).toMatchObject({
      mode: "network-accessible",
      bindHost: "0.0.0.0",
      endpointUrl: "https://custom.example.com",
      browserUrl: "https://custom.example.com",
      advertisedHost: "custom.example.com",
    });
  });

  it("skips non-private and non-IPv4 interfaces", () => {
    expect(
      resolveDesktopServerExposure({
        mode: "network-accessible",
        port: 3773,
        networkInterfaces: {
          excluded: [
            { address: "127.0.0.1", family: "IPv4", internal: true },
            { address: "169.254.10.20", family: "IPv4", internal: false },
            { address: "100.101.102.103", family: "IPv4", internal: false },
            { address: "8.8.8.8", family: "IPv4", internal: false },
            { address: "fd00::1", family: "IPv6", internal: false },
          ],
          wifi: [{ address: "10.20.30.40", family: "IPv4", internal: false }],
        },
        publicUrl: null,
        tailscaleEndpoint: null,
        tunnelEndpoint: null,
      }).endpointUrl,
    ).toBe("http://10.20.30.40:3773");
  });

  it("uses only bare private hostname overrides and otherwise discovers an interface", () => {
    const input = {
      mode: "network-accessible" as const,
      port: 3773,
      networkInterfaces: {
        en0: [{ address: "192.168.1.42", family: "IPv4", internal: false }],
      },
      publicUrl: null,
      tailscaleEndpoint: null,
      tunnelEndpoint: null,
    };

    expect(
      resolveDesktopServerExposure({
        ...input,
        advertisedHostOverride: "192.168.1.99:4000",
      }).endpointUrl,
    ).toBe("http://192.168.1.42:3773");
    expect(
      resolveDesktopServerExposure({
        ...input,
        advertisedHostOverride: "192.168.1.99/admin",
      }).endpointUrl,
    ).toBe("http://192.168.1.42:3773");
    expect(
      resolveDesktopServerExposure({
        ...input,
        advertisedHostOverride: "honk.example.com",
      }).endpointUrl,
    ).toBe("http://192.168.1.42:3773");
    expect(
      resolveDesktopServerExposure({
        ...input,
        advertisedHostOverride: "192.168.1.99",
      }).endpointUrl,
    ).toBe("http://192.168.1.99:3773");
  });

  it("does not advertise a derived endpoint for port zero", () => {
    expect(
      resolveDesktopServerExposure({
        mode: "network-accessible",
        port: 0,
        networkInterfaces: {
          en0: [{ address: "192.168.1.42", family: "IPv4", internal: false }],
        },
        publicUrl: null,
        tailscaleEndpoint: null,
        tunnelEndpoint: null,
      }).endpointUrl,
    ).toBeNull();
  });
});

describe("DesktopServerExposure.setConfiguration", () => {
  it("leaves settings unchanged when the tunnel probe fails", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const exposure = yield* DesktopServerExposure;
        const settings = yield* DesktopAppSettings;
        yield* exposure.configureFromSettings({ port: 3773 });
        const change = yield* exposure
          .setConfiguration({ mode: "tunnel", publicUrl: null })
          .pipe(Effect.result);
        return {
          change,
          runtime: yield* exposure.getState,
          settings: yield* settings.get,
        };
      }).pipe(
        Effect.provide(
          exposureLayer(
            true,
            undefined,
            {},
            DesktopTunnelEndpointService.of({
              probe: Effect.fail(new CloudflaredUnavailableError()),
              open: () => Effect.fail(new CloudflaredUnavailableError()),
              release: Effect.void,
            }),
          ),
        ),
      ),
    );

    expect(result.change).toMatchObject({
      _tag: "Failure",
      failure: expect.any(DesktopServerExposureTunnelError),
    });
    expect(result.settings.serverExposureMode).toBe("local-only");
    expect(result.runtime).toMatchObject({ mode: "local-only", endpointUrl: null });
  });

  it("persists tunnel mode for relaunch without opening it", async () => {
    const state = { opened: 0 };
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const exposure = yield* DesktopServerExposure;
        const settings = yield* DesktopAppSettings;
        yield* exposure.configureFromSettings({ port: 3773 });
        const change = yield* exposure.setConfiguration({ mode: "tunnel", publicUrl: null });
        return {
          change,
          runtime: yield* exposure.getState,
          settings: yield* settings.get,
        };
      }).pipe(
        Effect.provide(
          exposureLayer(
            true,
            undefined,
            {},
            DesktopTunnelEndpointService.of({
              probe: Effect.void,
              open: () =>
                Effect.sync(() => {
                  state.opened += 1;
                  return fakeTunnel();
                }),
              release: Effect.void,
            }),
          ),
        ),
      ),
    );

    expect(state.opened).toBe(0);
    expect(result.settings.serverExposureMode).toBe("tunnel");
    expect(result.runtime).toMatchObject({ mode: "tunnel", endpointUrl: null });
    expect(result.change.requiresRelaunch).toBe(true);
  });

  it("persists and applies the mode and URL as one configuration", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const exposure = yield* DesktopServerExposure;
        const settings = yield* DesktopAppSettings;
        yield* exposure.configureFromSettings({ port: 3773 });
        const change = yield* exposure.setConfiguration({
          mode: "network-accessible",
          publicUrl: " https://honk.example.com/ ",
        });
        return {
          change,
          runtime: yield* exposure.getState,
          settings: yield* settings.get,
        };
      }).pipe(Effect.provide(exposureLayer(true))),
    );

    expect(result.settings).toMatchObject({
      serverExposureMode: "network-accessible",
      serverPublicUrl: "https://honk.example.com",
    });
    expect(result.runtime).toMatchObject({
      mode: "network-accessible",
      endpointUrl: "https://honk.example.com",
      customUrl: "https://honk.example.com",
    });
    expect(result.change.requiresRelaunch).toBe(true);
  });

  it("leaves settings and runtime unchanged when Tailscale is unavailable", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const exposure = yield* DesktopServerExposure;
        const settings = yield* DesktopAppSettings;
        yield* exposure.configureFromSettings({ port: 3773 });
        const change = yield* exposure
          .setConfiguration({ mode: "tailscale", publicUrl: null })
          .pipe(Effect.result);
        return {
          change,
          runtime: yield* exposure.getState,
          settings: yield* settings.get,
        };
      }).pipe(Effect.provide(exposureLayer(false))),
    );

    expect(result.change).toMatchObject({
      _tag: "Failure",
      failure: expect.any(DesktopServerExposureTailscaleError),
    });
    expect(result.settings.serverExposureMode).toBe("local-only");
    expect(result.runtime).toMatchObject({ mode: "local-only", endpointUrl: null });
  });

  it("leaves settings and runtime unchanged when no private LAN address is available", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const exposure = yield* DesktopServerExposure;
        const settings = yield* DesktopAppSettings;
        yield* exposure.configureFromSettings({ port: 3773 });
        const before = {
          runtime: yield* exposure.getState,
          settings: yield* settings.get,
        };
        const change = yield* exposure
          .setConfiguration({ mode: "network-accessible", publicUrl: null })
          .pipe(Effect.result);
        return {
          before,
          change,
          runtime: yield* exposure.getState,
          settings: yield* settings.get,
        };
      }).pipe(Effect.provide(exposureLayer(true))),
    );

    expect(result.change).toMatchObject({
      _tag: "Failure",
      failure: expect.any(DesktopServerExposureLanUnavailableError),
    });
    expect(result.runtime).toEqual(result.before.runtime);
    expect(result.settings).toEqual(result.before.settings);
  });

  it("persists a derived private LAN endpoint and requests a relaunch", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const exposure = yield* DesktopServerExposure;
        const settings = yield* DesktopAppSettings;
        yield* exposure.configureFromSettings({ port: 3773 });
        const change = yield* exposure.setConfiguration({
          mode: "network-accessible",
          publicUrl: null,
        });
        return {
          change,
          runtime: yield* exposure.getState,
          settings: yield* settings.get,
        };
      }).pipe(
        Effect.provide(
          exposureLayer(true, undefined, {
            en0: [{ address: "192.168.1.42", family: "IPv4", internal: false }],
          }),
        ),
      ),
    );

    expect(result.change.requiresRelaunch).toBe(true);
    expect(result.runtime).toMatchObject({
      mode: "network-accessible",
      endpointUrl: "http://192.168.1.42:3773",
      browserUrl: null,
      customUrl: null,
    });
    expect(result.settings).toMatchObject({
      serverExposureMode: "network-accessible",
      serverPublicUrl: null,
    });
  });

  it("preserves a custom URL while switching to Tailscale", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const exposure = yield* DesktopServerExposure;
        const settings = yield* DesktopAppSettings;
        yield* exposure.configureFromSettings({ port: 3773 });
        yield* exposure.setConfiguration({
          mode: "network-accessible",
          publicUrl: "https://honk.example.com",
        });
        yield* exposure.setConfiguration({ mode: "tailscale", publicUrl: null });
        return yield* settings.get;
      }).pipe(Effect.provide(exposureLayer(true))),
    );

    expect(result).toMatchObject({
      serverExposureMode: "tailscale",
      serverPublicUrl: "https://honk.example.com",
    });
  });

  it("leaves settings and runtime unchanged when persistence fails", async () => {
    const failingSettings = Layer.effect(
      DesktopAppSettings,
      Effect.gen(function* () {
        const settings = yield* DesktopAppSettings;
        return DesktopAppSettings.of({
          ...settings,
          setServerExposure: () =>
            Schema.decodeUnknownEffect(Schema.Number)("not a settings document").pipe(
              Effect.mapError((cause) => new DesktopSettingsWriteError({ cause })),
              Effect.as({ settings: DEFAULT_DESKTOP_SETTINGS, changed: false }),
            ),
        });
      }),
    ).pipe(Layer.provide(layerTest(DEFAULT_DESKTOP_SETTINGS)));
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const exposure = yield* DesktopServerExposure;
        const settings = yield* DesktopAppSettings;
        yield* exposure.configureFromSettings({ port: 3773 });
        const change = yield* exposure
          .setConfiguration({
            mode: "network-accessible",
            publicUrl: "https://honk.example.com",
          })
          .pipe(Effect.result);
        return {
          change,
          runtime: yield* exposure.getState,
          settings: yield* settings.get,
        };
      }).pipe(Effect.provide(exposureLayer(true, failingSettings))),
    );

    expect(result.change).toMatchObject({
      _tag: "Failure",
      failure: expect.any(DesktopServerExposurePersistenceError),
    });
    expect(result.settings.serverExposureMode).toBe("local-only");
    expect(result.runtime).toMatchObject({ mode: "local-only", endpointUrl: null });
  });
});

describe("DesktopServerExposure.configureFromSettings", () => {
  it("opens the configured tunnel and reports its temporary endpoint", async () => {
    const state = { opened: 0 };
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const exposure = yield* DesktopServerExposure;
        return yield* exposure.configureFromSettings({ port: 3773 });
      }).pipe(
        Effect.provide(
          exposureLayer(
            true,
            layerTest({ ...DEFAULT_DESKTOP_SETTINGS, serverExposureMode: "tunnel" }),
            {},
            DesktopTunnelEndpointService.of({
              probe: Effect.void,
              open: (input) =>
                Effect.sync(() => {
                  expect(input.targetOrigin).toBe("http://127.0.0.1:3773");
                  state.opened += 1;
                  return fakeTunnel();
                }),
              release: Effect.void,
            }),
          ),
        ),
      ),
    );

    expect(state.opened).toBe(1);
    expect(result).toMatchObject({
      mode: "tunnel",
      endpointUrl: "https://blue-bird.trycloudflare.com",
      browserUrl: "https://blue-bird.trycloudflare.com",
    });
  });

  it("degrades a failed open to no endpoint", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const exposure = yield* DesktopServerExposure;
        return yield* exposure.configureFromSettings({ port: 3773 });
      }).pipe(
        Effect.provide(
          exposureLayer(
            true,
            layerTest({ ...DEFAULT_DESKTOP_SETTINGS, serverExposureMode: "tunnel" }),
            {},
            DesktopTunnelEndpointService.of({
              probe: Effect.void,
              open: () => Effect.fail(new CloudflaredTunnelError()),
              release: Effect.void,
            }),
          ),
        ),
      ),
    );

    expect(result).toMatchObject({ mode: "tunnel", endpointUrl: null, browserUrl: null });
  });

  it("does not open a tunnel for port zero", async () => {
    const state = { opened: 0 };
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const exposure = yield* DesktopServerExposure;
        return yield* exposure.configureFromSettings({ port: 0 });
      }).pipe(
        Effect.provide(
          exposureLayer(
            true,
            layerTest({ ...DEFAULT_DESKTOP_SETTINGS, serverExposureMode: "tunnel" }),
            {},
            DesktopTunnelEndpointService.of({
              probe: Effect.void,
              open: () =>
                Effect.sync(() => {
                  state.opened += 1;
                  return fakeTunnel();
                }),
              release: Effect.void,
            }),
          ),
        ),
      ),
    );

    expect(state.opened).toBe(0);
    expect(result).toMatchObject({ mode: "tunnel", endpointUrl: null });
  });

  it("serializes concurrent tunnel replacement without orphaning a child", async () => {
    const children: Array<{ readonly id: number; closed: number }> = [];
    const state = { live: 0, maxLive: 0 };
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const exposure = yield* DesktopServerExposure;
        yield* Effect.all(
          [
            exposure.configureFromSettings({ port: 3773 }),
            exposure.configureFromSettings({ port: 3773 }),
          ],
          { concurrency: "unbounded" },
        );
        return {
          children: children.map((child) => ({ ...child })),
          live: state.live,
          maxLive: state.maxLive,
          exposure: yield* exposure.getState,
        };
      }).pipe(
        Effect.provide(
          exposureLayer(
            true,
            layerTest({ ...DEFAULT_DESKTOP_SETTINGS, serverExposureMode: "tunnel" }),
            {},
            DesktopTunnelEndpointService.of({
              probe: Effect.void,
              // Launching cloudflared suspends, so an instant open would hide the interleaving
              // this test exists to catch.
              open: () =>
                Effect.sleep("5 millis").pipe(
                  Effect.andThen(
                    Effect.sync(() => {
                      const child = { id: children.length + 1, closed: 0 };
                      children.push(child);
                      state.live += 1;
                      state.maxLive = Math.max(state.maxLive, state.live);
                      return fakeTunnel({
                        id: child.id,
                        onClose: () => {
                          child.closed += 1;
                          state.live -= 1;
                        },
                      });
                    }),
                  ),
                ),
              release: Effect.void,
            }),
          ),
        ),
      ),
    );

    expect(result.children).toEqual([
      { id: 1, closed: 1 },
      { id: 2, closed: 0 },
    ]);
    expect(result.live).toBe(1);
    expect(result.maxLive).toBe(1);
    expect(result.exposure.endpointUrl).toBe("https://blue-bird-2.trycloudflare.com");
  });

  it("reports exit only for the current replacement tunnel", async () => {
    const exitA = await Effect.runPromise(Deferred.make<void>());
    const exitB = await Effect.runPromise(Deferred.make<void>());
    const state = { opened: 0 };
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const exposure = yield* DesktopServerExposure;
        yield* exposure.configureFromSettings({ port: 3773 });
        yield* exposure.configureFromSettings({ port: 3773 });
        const completed = yield* Ref.make(false);
        yield* Effect.forkScoped(
          exposure.awaitTunnelExit.pipe(Effect.andThen(Ref.set(completed, true))),
        );
        yield* Deferred.succeed(exitA, undefined);
        yield* Effect.sleep("10 millis");
        const afterReplacedExit = yield* Ref.get(completed);
        yield* Deferred.succeed(exitB, undefined);
        yield* Effect.sleep("10 millis");
        return {
          afterCurrentExit: yield* Ref.get(completed),
          afterReplacedExit,
        };
      }).pipe(
        Effect.provide(
          exposureLayer(
            true,
            layerTest({ ...DEFAULT_DESKTOP_SETTINGS, serverExposureMode: "tunnel" }),
            {},
            DesktopTunnelEndpointService.of({
              probe: Effect.void,
              open: () =>
                Effect.sync(() => {
                  const index = state.opened;
                  state.opened += 1;
                  return fakeTunnel({
                    id: index + 1,
                    exited: Effect.runPromise(Deferred.await(index === 0 ? exitA : exitB)),
                  });
                }),
              release: Effect.void,
            }),
          ),
        ),
        Effect.scoped,
      ),
    );

    expect(result.afterReplacedExit).toBe(false);
    expect(result.afterCurrentExit).toBe(true);
  });

  it("closes and releases the tunnel when its layer scope closes", async () => {
    const state = { closed: 0, released: 0 };
    await Effect.runPromise(
      Effect.gen(function* () {
        const exposure = yield* DesktopServerExposure;
        yield* exposure.configureFromSettings({ port: 3773 });
      }).pipe(
        Effect.provide(
          exposureLayer(
            true,
            layerTest({ ...DEFAULT_DESKTOP_SETTINGS, serverExposureMode: "tunnel" }),
            {},
            DesktopTunnelEndpointService.of({
              probe: Effect.void,
              open: () => Effect.succeed(fakeTunnel({ onClose: () => (state.closed += 1) })),
              release: Effect.sync(() => {
                state.released += 1;
              }),
            }),
          ),
        ),
        Effect.scoped,
      ),
    );

    expect(state).toEqual({ closed: 1, released: 1 });
  });
});

function fakeTunnel(
  input: {
    readonly exited?: Promise<void>;
    readonly id?: number;
    readonly onClose?: () => void;
  } = {},
): CloudflaredQuickTunnel {
  const hostname =
    input.id === undefined
      ? "blue-bird.trycloudflare.com"
      : `blue-bird-${input.id}.trycloudflare.com`;
  const close = Promise.resolve();
  return {
    url: `https://${hostname}`,
    hostname,
    pid: input.id ?? 421,
    startedAt: "2026-07-29T12:00:00.000Z",
    exited: input.exited ?? new Promise(() => undefined),
    close: () => {
      input.onClose?.();
      return close;
    },
  };
}
