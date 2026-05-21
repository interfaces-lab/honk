import { describe, expect, it } from "vitest";
import {
  ProviderDriverKind,
  ProviderOptionDescriptor,
  ProviderOptionSelection,
  ServerProviderModel,
} from "@multi/contracts";

import { getComposerProviderState, resolveProviderTraitsState } from "./provider-state";

// Provider state is data-driven by the model's optionDescriptors, so these tests
// use a single synthetic provider/model and vary only the descriptor shape.

const PROVIDER = "codex";
const MODEL = "test-model";

function selectDescriptor(
  id: string,
  options: ReadonlyArray<{ id: string; label: string; isDefault?: boolean }>,
  promptInjectedValues?: ReadonlyArray<string>,
): Extract<ProviderOptionDescriptor, { type: "select" }> {
  const defaultId = options.find((option) => option.isDefault)?.id;
  return {
    id,
    label: id,
    type: "select",
    options: [...options],
    ...(defaultId ? { currentValue: defaultId } : {}),
    ...(promptInjectedValues && promptInjectedValues.length > 0
      ? { promptInjectedValues: [...promptInjectedValues] }
      : {}),
  };
}

function booleanDescriptor(id: string): Extract<ProviderOptionDescriptor, { type: "boolean" }> {
  return { id, label: id, type: "boolean" };
}

function modelWith(
  descriptors: ReadonlyArray<ProviderOptionDescriptor>,
): ReadonlyArray<ServerProviderModel> {
  return [
    { slug: MODEL, name: MODEL, isCustom: false, capabilities: { optionDescriptors: descriptors } },
  ];
}

function selections(
  ...entries: Array<[string, string | boolean]>
): ReadonlyArray<ProviderOptionSelection> {
  return entries.map(([id, value]) => ({ id, value }));
}

describe("getComposerProviderState", () => {
  it("returns descriptor defaults when no selections are provided", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor("effort", [
          { id: "low", label: "Low" },
          { id: "high", label: "High", isDefault: true },
        ]),
      ]),
      prompt: "",
      modelOptions: undefined,
    });

    expect(state).toEqual({
      provider: PROVIDER,
      promptEffort: "high",
      modelOptionsForDispatch: selections(["effort", "high"]),
      ultrathinkActive: false,
    });
  });

  it("lets selections override defaults and propagates them through dispatch", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor("effort", [
          { id: "low", label: "Low" },
          { id: "high", label: "High", isDefault: true },
        ]),
        booleanDescriptor("fastMode"),
      ]),
      prompt: "",
      modelOptions: selections(["effort", "low"], ["fastMode", true]),
    });

    expect(state).toEqual({
      provider: PROVIDER,
      promptEffort: "low",
      modelOptionsForDispatch: selections(["effort", "low"], ["fastMode", true]),
      ultrathinkActive: false,
    });
  });

  it("preserves selections that match defaults so deepMerge can overwrite prior state", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor("effort", [{ id: "high", label: "High", isDefault: true }]),
        booleanDescriptor("fastMode"),
      ]),
      prompt: "",
      modelOptions: selections(["effort", "high"], ["fastMode", false]),
    });

    expect(state.modelOptionsForDispatch).toEqual(
      selections(["effort", "high"], ["fastMode", false]),
    );
  });

  it("drops selections for descriptors the model does not declare", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([booleanDescriptor("thinking")]),
      prompt: "",
      modelOptions: selections(["effort", "max"], ["thinking", false]),
    });

    expect(state).toEqual({
      provider: PROVIDER,
      promptEffort: null,
      modelOptionsForDispatch: selections(["thinking", false]),
      ultrathinkActive: false,
    });
  });

  it("derives promptEffort from the first select descriptor and preserves all others for dispatch", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor("effort", [{ id: "high", label: "High", isDefault: true }]),
        selectDescriptor("contextWindow", [
          { id: "200k", label: "200k", isDefault: true },
          { id: "1m", label: "1M" },
        ]),
        selectDescriptor("agent", [
          { id: "build", label: "Build", isDefault: true },
          { id: "plan", label: "Plan" },
        ]),
      ]),
      prompt: "",
      modelOptions: selections(["agent", "plan"]),
    });

    expect(state.promptEffort).toBe("high");
    expect(state.modelOptionsForDispatch).toEqual(
      selections(["effort", "high"], ["contextWindow", "200k"], ["agent", "plan"]),
    );
  });

  it("returns undefined dispatch options when the model declares no descriptors", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([]),
      prompt: "",
      modelOptions: selections(["anything", "value"]),
    });

    expect(state).toEqual({
      provider: PROVIDER,
      promptEffort: null,
      modelOptionsForDispatch: undefined,
      ultrathinkActive: false,
    });
  });

  it("renders only Fast for Cursor Composer controls", () => {
    const state = getComposerProviderState({
      provider: ProviderDriverKind.make("cursor"),
      model: "composer-2.5",
      models: [
        {
          slug: "composer-2.5",
          name: "Composer 2.5",
          isCustom: false,
          capabilities: {
            optionDescriptors: [
              selectDescriptor("reasoning", [{ id: "medium", label: "Medium", isDefault: true }]),
              booleanDescriptor("fastMode"),
              booleanDescriptor("thinking"),
            ],
          },
        },
      ],
      prompt: "",
      modelOptions: selections(["reasoning", "medium"], ["fastMode", true], ["thinking", true]),
    });

    expect(state).toEqual({
      provider: ProviderDriverKind.make("cursor"),
      promptEffort: null,
      modelOptionsForDispatch: selections(["fastMode", true]),
      ultrathinkActive: false,
    });
  });

  it("shows Fast for Cursor Composer models with empty advertised capabilities", () => {
    const state = resolveProviderTraitsState({
      provider: ProviderDriverKind.make("cursor"),
      model: "composer-2.5",
      models: [
        {
          slug: "composer-2.5",
          name: "Composer 2.5",
          isCustom: false,
          capabilities: { optionDescriptors: [] },
        },
      ],
      prompt: "",
      modelOptions: undefined,
    });

    expect(state.showFastMode).toBe(true);
    expect(state.fastModeDescriptor).toEqual({
      id: "fastMode",
      label: "Fast Mode",
      type: "boolean",
    });
    expect(state.fastModeEnabled).toBe(false);
  });

  it("does not show Fast for Cursor Composer fast-only model slugs without descriptors", () => {
    const state = resolveProviderTraitsState({
      provider: ProviderDriverKind.make("cursor"),
      model: "composer-2.5-fast",
      models: [
        {
          slug: "composer-2.5-fast",
          name: "Composer 2.5 Fast",
          isCustom: false,
          capabilities: { optionDescriptors: [] },
        },
      ],
      prompt: "",
      modelOptions: undefined,
    });

    expect(state.showFastMode).toBe(false);
    expect(state.fastModeDescriptor).toBeNull();
  });

  it("marks ultrathink active when the prompt triggers a promptInjectedValues descriptor", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor(
          "effort",
          [
            { id: "medium", label: "Medium" },
            { id: "high", label: "High", isDefault: true },
            { id: "ultrathink", label: "Ultrathink" },
          ],
          ["ultrathink"],
        ),
      ]),
      prompt: "Ultrathink:\nInvestigate this failure",
      modelOptions: selections(["effort", "medium"]),
    });

    expect(state).toEqual({
      provider: PROVIDER,
      promptEffort: "medium",
      modelOptionsForDispatch: selections(["effort", "medium"]),
      ultrathinkActive: true,
    });
  });

  it("does not mark ultrathink active when the descriptor has no promptInjectedValues", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor("effort", [{ id: "high", label: "High", isDefault: true }]),
      ]),
      prompt: "Ultrathink:\nInvestigate this failure",
      modelOptions: undefined,
    });

    expect(state.ultrathinkActive).toBe(false);
  });
});
