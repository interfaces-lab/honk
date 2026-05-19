import type * as EffectAcpSchema from "effect-acp/schema";
import { describe, expect, it } from "vitest";

import {
  buildCursorCapabilitiesForModelConfigResponse,
  buildCursorDiscoveredModelsFromConfigOptions,
} from "../../src/provider/CursorProvider.ts";

const modelConfigOptions = [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: "gpt-5.4",
    options: [
      { value: "composer-2.5", name: "Composer 2.5" },
      { value: "gpt-5.4", name: "GPT-5.4" },
    ],
  },
  {
    id: "reasoning",
    name: "Reasoning",
    category: "thought_level",
    type: "select",
    currentValue: "medium",
    options: [
      { value: "low", name: "Low" },
      { value: "medium", name: "Medium" },
      { value: "high", name: "High" },
    ],
  },
  {
    id: "fast",
    name: "Fast",
    category: "model_config",
    type: "select",
    currentValue: "false",
    options: [
      { value: "false", name: "Normal" },
      { value: "true", name: "Fast" },
    ],
  },
] satisfies ReadonlyArray<EffectAcpSchema.SessionConfigOption>;

describe("buildCursorDiscoveredModelsFromConfigOptions", () => {
  it("marks the current model as probed even when Cursor exposes no model options", () => {
    const models = buildCursorDiscoveredModelsFromConfigOptions([
      {
        id: "mode",
        name: "Mode",
        category: "mode",
        type: "select",
        currentValue: "agent",
        options: [{ value: "agent", name: "Agent" }],
      },
      {
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: "kimi-k2.5",
        options: [
          { value: "composer-2.5", name: "Composer 2.5" },
          { value: "kimi-k2.5", name: "Kimi K2.5" },
        ],
      },
    ] satisfies ReadonlyArray<EffectAcpSchema.SessionConfigOption>);

    expect(models).toEqual([
      {
        slug: "composer-2.5",
        name: "Composer 2.5",
        isCustom: false,
        capabilities: null,
      },
      {
        slug: "kimi-k2.5",
        name: "Kimi K2.5",
        isCustom: false,
        capabilities: { optionDescriptors: [] },
      },
    ]);
  });
});

describe("buildCursorCapabilitiesForModelConfigResponse", () => {
  it("does not attach model settings when Cursor describes a different current model", () => {
    const capabilities = buildCursorCapabilitiesForModelConfigResponse(
      modelConfigOptions,
      "composer-2.5",
    );

    expect(capabilities).toEqual({ optionDescriptors: [] });
  });

  it("attaches model settings when Cursor confirms the requested current model", () => {
    const capabilities = buildCursorCapabilitiesForModelConfigResponse(
      modelConfigOptions,
      "gpt-5.4",
    );

    expect(capabilities.optionDescriptors?.map((descriptor) => descriptor.id)).toEqual([
      "reasoning",
      "fastMode",
    ]);
  });
});
