import { describe, it, assert } from "@effect/vitest";
import { type ServerProvider } from "@multi/contracts";
import { createModelCapabilities } from "@multi/shared/model";

import { haveProvidersChanged, mergeProviderSnapshot } from "../../src/provider/ProviderRegistry.ts";

function provider(input: Partial<ServerProvider> & Pick<ServerProvider, "driver">): ServerProvider {
  const { driver, ...overrides } = input;
  return {
    instanceId: input.instanceId ?? driver,
    driver,
    status: "ready",
    enabled: true,
    installed: true,
    auth: { status: "authenticated" },
    checkedAt: "2026-03-25T00:00:00.000Z",
    version: "1.0.0",
    models: [],
    slashCommands: [],
    skills: [],
    ...overrides,
  };
}

describe("ProviderRegistry helpers", () => {
  it("treats equal provider snapshots as unchanged", () => {
    const providers = [provider({ driver: "codex" }), provider({ driver: "cursor" })];

    assert.strictEqual(haveProvidersChanged(providers, [...providers]), false);
  });

  it("preserves previously discovered provider models when a refresh returns none", () => {
    const previousProvider = provider({
      driver: "cursor",
      checkedAt: "2026-04-14T00:00:00.000Z",
      version: "2026.04.09-f2b0fcd",
      models: [
        {
          slug: "composer-1",
          name: "Composer 1",
          isCustom: false,
          capabilities: createModelCapabilities({
            optionDescriptors: [
              {
                id: "fastMode",
                label: "Fast Mode",
                type: "boolean",
              },
            ],
          }),
        },
      ],
    });
    const refreshedProvider = provider({
      ...previousProvider,
      checkedAt: "2026-04-14T00:01:00.000Z",
      models: [],
    });

    assert.deepStrictEqual(mergeProviderSnapshot(previousProvider, refreshedProvider).models, [
      ...previousProvider.models,
    ]);
  });

  it("does not backfill stale capabilities onto refreshed models", () => {
    const previousProvider = provider({
      driver: "cursor",
      checkedAt: "2026-04-14T00:00:00.000Z",
      version: "2026.04.09-f2b0fcd",
      models: [
        {
          slug: "composer-1",
          name: "Composer 1",
          isCustom: false,
          capabilities: createModelCapabilities({
            optionDescriptors: [
              {
                id: "fastMode",
                label: "Fast Mode",
                type: "boolean",
              },
            ],
          }),
        },
      ],
    });
    const refreshedProvider = provider({
      ...previousProvider,
      checkedAt: "2026-04-14T00:01:00.000Z",
      models: [
        {
          slug: "composer-1",
          name: "Composer 1",
          isCustom: false,
          capabilities: createModelCapabilities({ optionDescriptors: [] }),
        },
      ],
    });

    assert.deepStrictEqual(mergeProviderSnapshot(previousProvider, refreshedProvider).models, [
      ...refreshedProvider.models,
    ]);
  });
});
