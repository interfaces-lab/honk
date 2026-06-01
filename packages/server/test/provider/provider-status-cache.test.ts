import * as NodeServices from "@effect/platform-node/NodeServices";
import { ServerProvider } from "@multi/contracts";
import { createModelCapabilities } from "@multi/shared/model";
import { assert, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";

import {
  hydrateCachedProvider,
  readProviderStatusCache,
  resolveProviderStatusCachePath,
  writeProviderStatusCache,
} from "../../src/provider/provider-status-cache.ts";

const emptyCapabilities = createModelCapabilities({ optionDescriptors: [] });

const makeProvider = (
  driver: ServerProvider["driver"],
  overrides?: Partial<ServerProvider>,
): ServerProvider => ({
  instanceId: driver,
  driver,
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-04-11T00:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
  ...overrides,
});

it.layer(NodeServices.layer)("providerStatusCache", (it) => {
  it.effect("writes and reads provider status snapshots", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-provider-cache-" });
      const codexProvider = makeProvider("codex");
      const cursorProvider = makeProvider("cursor", {
        status: "warning",
        auth: { status: "unknown" },
      });
      const openCodeProvider = makeProvider("cursor", {
        status: "warning",
        auth: { status: "unknown", type: "cursor" },
      });
      const codexPath = resolveProviderStatusCachePath({
        cacheDir: tempDir,
        instanceId: "codex",
      });
      const cursorPath = resolveProviderStatusCachePath({
        cacheDir: tempDir,
        instanceId: "cursor",
      });
      const openCodePath = resolveProviderStatusCachePath({
        cacheDir: tempDir,
        instanceId: "cursor",
      });

      yield* writeProviderStatusCache({
        filePath: codexPath,
        provider: codexProvider,
      });
      yield* writeProviderStatusCache({
        filePath: cursorPath,
        provider: cursorProvider,
      });
      yield* writeProviderStatusCache({
        filePath: openCodePath,
        provider: openCodeProvider,
      });

      assert.deepStrictEqual(yield* readProviderStatusCache(codexPath), codexProvider);
      assert.deepStrictEqual(yield* readProviderStatusCache(cursorPath), cursorProvider);
      assert.deepStrictEqual(yield* readProviderStatusCache(openCodePath), openCodeProvider);
    }),
  );

  it("hydrates cached provider status while preserving current settings-derived models", () => {
    const cachedCodex = makeProvider("codex", {
      checkedAt: "2026-04-10T12:00:00.000Z",
      models: [
        {
          slug: "gpt-5-mini",
          name: "GPT-5 Mini",
          isCustom: false,
          capabilities: emptyCapabilities,
        },
      ],
      message: "Cached message",
      skills: [
        {
          name: "github:gh-fix-ci",
          path: "/tmp/skills/gh-fix-ci/SKILL.md",
          enabled: true,
          displayName: "CI Debug",
        },
      ],
    });
    const fallbackCodex = makeProvider("codex", {
      models: [
        {
          slug: "gpt-5.4",
          name: "GPT-5.4",
          isCustom: false,
          capabilities: emptyCapabilities,
        },
      ],
      message: "Pending refresh",
    });

    assert.deepStrictEqual(
      hydrateCachedProvider({
        cachedProvider: cachedCodex,
        fallbackProvider: fallbackCodex,
      }),
      {
        ...fallbackCodex,
        models: [
          ...fallbackCodex.models,
          {
            slug: "gpt-5-mini",
            name: "GPT-5 Mini",
            isCustom: false,
            capabilities: emptyCapabilities,
          },
        ],
        installed: cachedCodex.installed,
        version: cachedCodex.version,
        status: cachedCodex.status,
        auth: cachedCodex.auth,
        checkedAt: cachedCodex.checkedAt,
        slashCommands: cachedCodex.slashCommands,
        skills: cachedCodex.skills,
        message: cachedCodex.message,
      },
    );
  });

  it("ignores stale cached enabled state when the provider is now disabled", () => {
    const cachedCodex = makeProvider("codex", {
      checkedAt: "2026-04-10T12:00:00.000Z",
      message: "Cached ready status",
    });
    const disabledFallback = makeProvider("codex", {
      enabled: false,
      installed: false,
      version: null,
      status: "disabled",
      auth: { status: "unknown" },
      message: "Codex is disabled in Multi settings.",
    });

    assert.deepStrictEqual(
      hydrateCachedProvider({
        cachedProvider: cachedCodex,
        fallbackProvider: disabledFallback,
      }),
      disabledFallback,
    );
  });
});
