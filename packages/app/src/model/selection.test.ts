import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@multi/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@multi/contracts/settings";
import { createModelCapabilities } from "@multi/shared/model";
import { describe, expect, it } from "vitest";

import { resolveAppProviderModelState } from "./selection";

const CODEX_INSTANCE_ID = ProviderInstanceId.make("codex");
const CLAUDE_INSTANCE_ID = ProviderInstanceId.make("claudeAgent");

function provider(input: {
  readonly driver: string;
  readonly instanceId: ProviderInstanceId;
  readonly displayName: string;
  readonly models: ServerProvider["models"];
}): ServerProvider {
  return {
    driver: ProviderDriverKind.make(input.driver),
    instanceId: input.instanceId,
    displayName: input.displayName,
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-05-19T00:00:00.000Z",
    slashCommands: [],
    skills: [],
    models: input.models,
  };
}

const PROVIDERS: ReadonlyArray<ServerProvider> = [
  provider({
    driver: "codex",
    instanceId: CODEX_INSTANCE_ID,
    displayName: "Codex",
    models: [
      {
        slug: "gpt-5-codex",
        name: "GPT-5 Codex",
        isCustom: false,
        capabilities: createModelCapabilities({
          optionDescriptors: [
            {
              id: "reasoningEffort",
              label: "Reasoning",
              type: "select",
              currentValue: "medium",
              options: [
                { id: "low", label: "Low" },
                { id: "medium", label: "Medium" },
                { id: "high", label: "High" },
              ],
            },
          ],
        }),
      },
      {
        slug: "gpt-5.3-codex",
        name: "GPT-5.3 Codex",
        isCustom: false,
        capabilities: createModelCapabilities({
          optionDescriptors: [],
        }),
      },
    ],
  }),
  provider({
    driver: "claudeAgent",
    instanceId: CLAUDE_INSTANCE_ID,
    displayName: "Claude",
    models: [
      {
        slug: "claude-opus-4-6",
        name: "Claude Opus 4.6",
        isCustom: false,
        capabilities: createModelCapabilities({
          optionDescriptors: [],
        }),
      },
    ],
  }),
];

describe("resolveAppProviderModelState", () => {
  it("resolves requested provider/model output and dispatch defaults", () => {
    const state = resolveAppProviderModelState({
      settings: DEFAULT_UNIFIED_SETTINGS,
      providers: PROVIDERS,
      requestedInstanceId: CODEX_INSTANCE_ID,
      requestedModel: "gpt-5-codex",
    });

    expect(state.status).toEqual({ kind: "ready", message: null });
    expect(state.selectedInstanceId).toBe(CODEX_INSTANCE_ID);
    expect(state.selectedProvider).toBe(ProviderDriverKind.make("codex"));
    expect(state.selectedModel).toBe("gpt-5-codex");
    expect(state.selectedCatalogItem).toMatchObject({
      instanceId: CODEX_INSTANCE_ID,
      slug: "gpt-5-codex",
      name: "GPT-5 Codex",
      instanceDisplayName: "Codex",
    });
    expect(state.modelSelection).toEqual({
      instanceId: CODEX_INSTANCE_ID,
      model: "gpt-5-codex",
      options: [{ id: "reasoningEffort", value: "medium" }],
    });
  });

  it("falls back to a selectable provider/model while preserving missing-provider status", () => {
    const state = resolveAppProviderModelState({
      settings: DEFAULT_UNIFIED_SETTINGS,
      providers: PROVIDERS,
      requestedInstanceId: ProviderInstanceId.make("retiredProvider"),
      requestedModel: "retired-model",
    });

    expect(state.status).toEqual({
      kind: "missing-provider",
      requestedInstanceId: ProviderInstanceId.make("retiredProvider"),
      message: "Selected provider is no longer available.",
    });
    expect(state.selectedInstanceId).toBe(CODEX_INSTANCE_ID);
    expect(state.selectedModel).toBe("gpt-5-codex");
    expect(state.selectedCatalogItem?.slug).toBe("gpt-5-codex");
    expect(state.modelSelection.instanceId).toBe(CODEX_INSTANCE_ID);
    expect(state.modelSelection.model).toBe("gpt-5-codex");
  });

  it("reports an empty catalog without inventing selectable model rows", () => {
    const state = resolveAppProviderModelState({
      settings: DEFAULT_UNIFIED_SETTINGS,
      providers: [
        provider({
          driver: "codex",
          instanceId: CODEX_INSTANCE_ID,
          displayName: "Codex",
          models: [],
        }),
      ],
      requestedInstanceId: CODEX_INSTANCE_ID,
      requestedModel: "gpt-5-codex",
    });

    expect(state.status).toEqual({
      kind: "empty-catalog",
      selectedInstanceId: CODEX_INSTANCE_ID,
      message: "Selected provider has no selectable models.",
    });
    expect(state.modelCatalogItems).toEqual([]);
    expect(state.selectableModelOptions).toEqual([]);
    expect(state.selectedCatalogItem).toBeUndefined();
    expect(state.selectedModel).toBe("gpt-5-codex");
    expect(state.modelSelection).toEqual({
      instanceId: CODEX_INSTANCE_ID,
      model: "gpt-5-codex",
    });
  });
});
