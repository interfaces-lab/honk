import { HONK_AGENT_PAIRINGS, honkFusionAgentName } from "@honk/opencode/pairing";
import { describe, expect, it } from "vitest";

import {
  actions,
  familyConnectivity,
  fusionPairing,
  getModelSelection,
  modelLabel,
  providerConnectivity,
  selectionLabel,
  submissionModel,
  supportsFast,
  threadModelLabel,
  variantLabel,
  type ModelSelectionSnapshot,
  type ProviderConnectivity,
} from "./presets";

const FUSION_MEDIUM: ModelSelectionSnapshot = Object.freeze({
  active: "fusion",
  stop: "medium",
  singleFamily: "fable5",
  variants: Object.freeze({ fable5: "medium", opus5: "high", sol: "medium" }),
  fast: Object.freeze({ opus5: false, sol: false }),
});

describe("model selection", () => {
  it("submits the fusion main with the stop that names the per-stop agent", () => {
    const plan = submissionModel(FUSION_MEDIUM);
    const pairing = fusionPairing("medium");
    expect(plan.model).toEqual({
      providerID: pairing.main.providerID,
      id: pairing.main.id,
    });
    expect(plan.variant).toBe(pairing.main.variant);
    expect(plan.fusionStop).toBe("medium");
    expect(honkFusionAgentName("medium")).toBe("honk-build-fusion-medium");
  });

  it("submits a single model with its remembered variant and no fusion stop", () => {
    const plan = submissionModel({
      ...FUSION_MEDIUM,
      active: "single",
      singleFamily: "sol",
      variants: Object.freeze({ fable5: "medium", opus5: "high", sol: "xhigh" }),
    });
    expect(plan.model).toEqual({ providerID: "openai", id: "gpt-5.6-sol" });
    expect(plan.variant).toBe("xhigh");
    expect(plan.fusionStop).toBeUndefined();
  });

  it("submits Fast Sol as OpenCode's priority-tier model without changing effort", () => {
    const plan = submissionModel({
      ...FUSION_MEDIUM,
      active: "single",
      singleFamily: "sol",
      variants: Object.freeze({ fable5: "medium", opus5: "high", sol: "high" }),
      fast: Object.freeze({ ...FUSION_MEDIUM.fast, sol: true }),
    });
    expect(plan.model).toEqual({ providerID: "openai", id: "gpt-5.6-sol-fast" });
    expect(plan.variant).toBe("high");
  });

  it("submits Opus 5 through the claude-code provider with its remembered variant", () => {
    const plan = submissionModel({
      ...FUSION_MEDIUM,
      active: "single",
      singleFamily: "opus5",
      variants: Object.freeze({ fable5: "medium", opus5: "xhigh", sol: "medium" }),
    });
    expect(plan.model).toEqual({ providerID: "claude-code", id: "claude-opus-5" });
    expect(plan.variant).toBe("xhigh");
    expect(plan.fusionStop).toBeUndefined();
  });

  it("submits Fast Opus through the Claude Code wrapper without changing effort", () => {
    const plan = submissionModel({
      ...FUSION_MEDIUM,
      active: "single",
      singleFamily: "opus5",
      variants: Object.freeze({ fable5: "medium", opus5: "xhigh", sol: "medium" }),
      fast: Object.freeze({ ...FUSION_MEDIUM.fast, opus5: true }),
    });
    expect(plan.model).toEqual({ providerID: "claude-code", id: "claude-opus-5-fast" });
    expect(plan.variant).toBe("xhigh");
  });

  it("submits Kimi K3 without a pinned variant", () => {
    const plan = submissionModel({
      ...FUSION_MEDIUM,
      active: "single",
      singleFamily: "kimi-k3",
    });
    expect(plan.model).toEqual({ providerID: "opencode-go", id: "kimi-k3" });
    expect(plan.variant).toBeUndefined();
    expect(plan.fusionStop).toBeUndefined();
  });

  it("labels the trigger for both fusion and single selections", () => {
    expect(selectionLabel(FUSION_MEDIUM)).toBe("Fusion");
    expect(
      selectionLabel({
        ...FUSION_MEDIUM,
        active: "single",
        singleFamily: "fable5",
        variants: Object.freeze({ fable5: "max", opus5: "high", sol: "medium" }),
      }),
    ).toBe("Fable 5");
    expect(selectionLabel({ ...FUSION_MEDIUM, active: "single", singleFamily: "opus5" })).toBe(
      "Opus 5",
    );
    expect(
      selectionLabel({
        ...FUSION_MEDIUM,
        active: "single",
        singleFamily: "sol",
        fast: Object.freeze({ ...FUSION_MEDIUM.fast, sol: true }),
      }),
    ).toBe("Sol");
    expect(selectionLabel({ ...FUSION_MEDIUM, active: "single", singleFamily: "kimi-k3" })).toBe(
      "Kimi K3",
    );
  });

  it("labels an existing thread from its core agent and model", () => {
    expect(
      threadModelLabel("honk-plan", {
        providerID: "openai",
        id: "gpt-5.6-sol",
        variant: "xhigh",
      }),
    ).toBe("Sol · Extra high");
    expect(
      threadModelLabel("honk-plan", {
        providerID: "openai",
        id: "gpt-5.6-sol-fast",
        variant: "high",
      }),
    ).toBe("Sol · High · Fast");
    expect(
      threadModelLabel("honk-plan", {
        providerID: "claude-code",
        id: "claude-opus-5-fast",
        variant: "high",
      }),
    ).toBe("Opus 5 · High · Fast");
    expect(
      threadModelLabel("honk-build-fusion-high", {
        providerID: "claude-code",
        id: "claude-fable-5",
        variant: "high",
      }),
    ).toBe("Fusion · High");
    expect(threadModelLabel("honk-build", null)).toBe("Model unavailable");
  });

  it("names every model family the fusion table uses", () => {
    for (const pairing of HONK_AGENT_PAIRINGS) {
      expect(modelLabel(pairing.main)).not.toContain(pairing.main.id);
      expect(modelLabel(pairing.sidekick)).not.toContain(pairing.sidekick.id);
    }
    expect(modelLabel({ providerID: "opencode-go", id: "glm-5.2", variant: "medium" })).toBe(
      "GLM-5.2 Medium",
    );
    expect(variantLabel("xhigh")).toBe("Extra high");
    expect(variantLabel("max")).toBe("Max");
  });

  it("exposes Fast only for models whose request path supports it", () => {
    expect(supportsFast("sol")).toBe(true);
    expect(supportsFast("opus5")).toBe(true);
    expect(supportsFast("fable5")).toBe(false);
    expect(supportsFast("kimi-k3")).toBe(false);
  });

  it("remembers options for unselected models without changing the active selection", () => {
    const initial = getModelSelection();
    actions.selectSingle("sol");

    actions.setFusionStop("high");
    actions.setSingleVariant("fable5", "max");
    actions.setSingleFast("opus5", true);

    expect(getModelSelection()).toMatchObject({
      active: "single",
      singleFamily: "sol",
      stop: "high",
      variants: { fable5: "max" },
      fast: { opus5: true },
    });

    actions.setFusionStop(initial.stop);
    actions.setSingleVariant("fable5", initial.variants.fable5);
    actions.setSingleVariant("opus5", initial.variants.opus5);
    actions.setSingleVariant("sol", initial.variants.sol);
    actions.setSingleFast("opus5", initial.fast.opus5);
    actions.setSingleFast("sol", initial.fast.sol);
    if (initial.active === "fusion") {
      actions.selectFusion();
      return;
    }
    actions.selectSingle(initial.singleFamily);
  });
});

const ALL_CONNECTED: ProviderConnectivity = Object.freeze({
  openAi: true,
  openCodeGo: true,
  claude: true,
});

// Connectivity never gates or remaps a selection; it only feeds the picker's
// informational status and connect messages. Submission always runs exactly
// what the user picked and lets a missing account fail at runtime.
describe("provider connectivity", () => {
  it("reads all accounts as unknown until the auth store is ready", () => {
    const loading = providerConnectivity({
      phase: "loading",
      openAiConnected: false,
      openCodeGoConnected: false,
      claudeConnected: null,
    });
    expect(loading).toEqual({ openAi: null, openCodeGo: null, claude: null });
    expect(
      providerConnectivity({
        phase: "ready",
        openAiConnected: true,
        openCodeGoConnected: false,
        claudeConnected: false,
      }),
    ).toEqual({ openAi: true, openCodeGo: false, claude: false });
  });

  it("maps each single family to the account it runs on", () => {
    expect(familyConnectivity("sol", { ...ALL_CONNECTED, openAi: false })).toBe(false);
    expect(familyConnectivity("kimi-k3", { ...ALL_CONNECTED, openCodeGo: false })).toBe(false);
    expect(familyConnectivity("fable5", { ...ALL_CONNECTED, claude: null })).toBe(null);
    expect(familyConnectivity("opus5", ALL_CONNECTED)).toBe(true);
  });

  it("keeps a claw fusion selection running on Claude alone", () => {
    const claw: ModelSelectionSnapshot = Object.freeze({ ...FUSION_MEDIUM, stop: "claw" });
    const plan = submissionModel(claw);
    expect(plan.model).toEqual({ providerID: "claude-code", id: "claude-fable-5" });
    expect(plan.fusionStop).toBe("claw");
    expect(honkFusionAgentName("claw")).toBe("honk-build-fusion-claw");
    expect(fusionPairing("claw").sidekick).toMatchObject({ id: "claude-opus-5" });
  });
});
