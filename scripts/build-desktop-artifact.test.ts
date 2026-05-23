import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ConfigProvider, Effect, Option } from "effect";

import {
  resolveBuildOptions,
  resolveDesktopBuildIconAssets,
  resolveDesktopProductName,
  resolveMockUpdateServerPort,
  resolveMockUpdateServerUrl,
  sanitizeDesktopDistributionEnv,
  sanitizeDesktopPackagingEnv,
} from "./build-desktop-artifact.ts";
import { BRAND_ASSET_PATHS } from "./lib/brand-assets.ts";

it.layer(NodeServices.layer)("build-desktop-artifact", (it) => {
  it("uses the configured desktop packaging product name", () => {
    assert.equal(resolveDesktopProductName(), "Multi");
  });

  it("uses production desktop packaging icons", () => {
    assert.deepStrictEqual(resolveDesktopBuildIconAssets(), {
      macIconIcns: BRAND_ASSET_PATHS.productionMacIconIcns,
      macIconPng: BRAND_ASSET_PATHS.productionMacIconPng,
      linuxIconPng: BRAND_ASSET_PATHS.productionLinuxIconPng,
    });
  });

  it("falls back to the default mock update port when the configured port is blank", () => {
    assert.equal(resolveMockUpdateServerUrl(undefined), "http://localhost:3000");
    assert.equal(resolveMockUpdateServerUrl(4123), "http://localhost:4123");
  });

  it.effect("normalizes mock update server ports from env-style strings", () =>
    Effect.gen(function* () {
      assert.equal(yield* resolveMockUpdateServerPort(undefined), undefined);
      assert.equal(yield* resolveMockUpdateServerPort(""), undefined);
      assert.equal(yield* resolveMockUpdateServerPort("   "), undefined);
      assert.equal(yield* resolveMockUpdateServerPort("4123"), 4123);
    }),
  );

  it.effect("rejects non-numeric or out-of-range mock update ports", () =>
    Effect.gen(function* () {
      const invalidPorts = ["abc", "12.5", "0", "65536"];
      for (const port of invalidPorts) {
        const exit = yield* Effect.exit(resolveMockUpdateServerPort(port));
        assert.equal(exit._tag, "Failure");
      }
    }),
  );

  it("strips desktop development env before distribution builds", () => {
    const sanitized = sanitizeDesktopDistributionEnv({
      PATH: "/bin",
      VITE_DEV_SERVER_URL: "http://127.0.0.1:5733",
      VITE_HTTP_URL: "http://127.0.0.1:4222",
      MULTI_PORT: "4222",
      MULTI_HOME: "/tmp/multi-dev",
      EMPTY_VALUE: "",
    });

    assert.equal(sanitized.PATH, "/bin");
    assert.equal(sanitized.VITE_DEV_SERVER_URL, undefined);
    assert.equal(sanitized.VITE_HTTP_URL, undefined);
    assert.equal(sanitized.MULTI_PORT, undefined);
    assert.equal(sanitized.MULTI_HOME, undefined);
    assert.equal(sanitized.EMPTY_VALUE, undefined);
  });

  it("strips signing secrets from unsigned packaging env", () => {
    const sanitized = sanitizeDesktopPackagingEnv(
      {
        PATH: "/bin",
        CSC_LINK: "secret",
        APPLE_API_KEY: "secret",
      },
      { signed: false },
    );

    assert.equal(sanitized.PATH, "/bin");
    assert.equal(sanitized.CSC_LINK, undefined);
    assert.equal(sanitized.APPLE_API_KEY, undefined);
    assert.equal(sanitized.CSC_IDENTITY_AUTO_DISCOVERY, "false");
  });

  it.effect("preserves explicit false boolean flags over true env defaults", () =>
    Effect.gen(function* () {
      const resolved = yield* resolveBuildOptions({
        platform: Option.some("mac"),
        target: Option.none(),
        arch: Option.some("arm64"),
        buildVersion: Option.none(),
        outputDir: Option.some("release-test"),
        skipBuild: Option.some(false),
        keepStage: Option.some(false),
        signed: Option.some(false),
        verbose: Option.some(false),
        mockUpdates: Option.some(false),
        mockUpdateServerPort: Option.none(),
      }).pipe(
        Effect.provide(
          ConfigProvider.layer(
            ConfigProvider.fromEnv({
              env: {
                MULTI_DESKTOP_SKIP_BUILD: "true",
                MULTI_DESKTOP_KEEP_STAGE: "true",
                MULTI_DESKTOP_SIGNED: "true",
                MULTI_DESKTOP_VERBOSE: "true",
                MULTI_DESKTOP_MOCK_UPDATES: "true",
              },
            }),
          ),
        ),
      );

      assert.equal(resolved.skipBuild, false);
      assert.equal(resolved.keepStage, false);
      assert.equal(resolved.signed, false);
      assert.equal(resolved.verbose, false);
      assert.equal(resolved.mockUpdates, false);
    }),
  );
});
