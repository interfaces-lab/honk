// Model selection is one exclusive choice: Fusion (a main paired with a
// sidekick at an effort stop) or a single model running alone. Every thread
// pins its choice at birth; the last-used stop and per-model options are
// remembered so switching back restores them.

import {
  HONK_AGENT_PAIRINGS,
  HONK_MODEL_IDS,
  HONK_PRESET_STOPS,
  honkPairingForFusionAgent,
  type HonkAgentPairing,
  type HonkModelArm,
  type HonkPresetStop,
} from "@honk/opencode/pairing";
import type { OpenCodeModelRef } from "@honk/opencode";
import { useSyncExternalStore } from "react";

export const KIMI_MODEL_ID = "kimi-k3" as const;

// Families that carry their own effort dial. Kimi is a single model too, but the
// gateway exposes no effort control for it, so it never gets a remembered variant.
export const VARIANT_FAMILIES = ["fable5", "opus5", "sol"] as const;
export type VariantFamilyId = (typeof VARIANT_FAMILIES)[number];

export const SINGLE_FAMILIES = [...VARIANT_FAMILIES, KIMI_MODEL_ID] as const;
export type SingleFamilyId = (typeof SINGLE_FAMILIES)[number];

// Fast is a model capability, not a provider-wide billing rule. OpenCode exposes a Fast Sol
// model, and Anthropic Fast supports Opus 5; Fable 5 and Kimi K3 do not support it.
export const FAST_FAMILIES = ["opus5", "sol"] as const;
export type FastFamilyId = (typeof FAST_FAMILIES)[number];

export const VARIANT_FAMILY_MODELS = {
  fable5: HONK_MODEL_IDS.fable5,
  opus5: HONK_MODEL_IDS.opus5,
  sol: HONK_MODEL_IDS.sol,
} as const;

// The max variant is reserved for explicit single-model picks; Fusion tops out at xhigh.
export const SINGLE_VARIANTS = ["medium", "high", "xhigh", "max"] as const;
export type SingleVariant = (typeof SINGLE_VARIANTS)[number];

export type ModelSelectionSnapshot = {
  readonly active: "fusion" | "single";
  readonly stop: HonkPresetStop;
  readonly singleFamily: SingleFamilyId;
  readonly variants: Readonly<Record<VariantFamilyId, SingleVariant>>;
  readonly fast: Readonly<Record<FastFamilyId, boolean>>;
};

const FAMILY_LABELS: Readonly<Record<string, string>> = {
  [HONK_MODEL_IDS.fable5.id]: "Fable 5",
  [HONK_MODEL_IDS.opus5.id]: "Opus 5",
  [HONK_MODEL_IDS.opus5Fast.id]: "Opus 5",
  [HONK_MODEL_IDS.sol.id]: "Sol",
  [HONK_MODEL_IDS.solFast.id]: "Sol",
  [HONK_MODEL_IDS.glm.id]: "GLM-5.2",
  [KIMI_MODEL_ID]: "Kimi K3",
  "gpt-5.5": "GPT-5.5",
  "gpt-5.6-terra": "Terra",
  "gpt-5.6-luna": "Luna",
};

export function familyLabel(family: VariantFamilyId): string {
  return FAMILY_LABELS[VARIANT_FAMILY_MODELS[family].id] ?? VARIANT_FAMILY_MODELS[family].id;
}

export function supportsFast(family: SingleFamilyId): family is FastFamilyId {
  return family === "opus5" || family === "sol";
}

export function variantLabel(variant: string): string {
  if (variant === "xhigh") return "Extra high";
  return `${variant.slice(0, 1).toUpperCase()}${variant.slice(1)}`;
}

export function modelLabel(model: HonkModelArm): string {
  return `${FAMILY_LABELS[model.id] ?? model.id} ${variantLabel(model.variant)}`;
}

export function modelName(id: string): string {
  return FAMILY_LABELS[id] ?? id;
}

export function stopLabel(stop: HonkPresetStop): string {
  return `${stop.slice(0, 1).toUpperCase()}${stop.slice(1)}`;
}

export function fusionPairing(stop: HonkPresetStop): HonkAgentPairing {
  return HONK_AGENT_PAIRINGS.find((pairing) => pairing.stop === stop) ?? HONK_AGENT_PAIRINGS[1]!;
}

export type SubmissionModel = {
  readonly model: { readonly providerID: string; readonly id: string };
  readonly variant?: string;
  // Present only when the submission runs Fusion; drives the per-stop agent name.
  readonly fusionStop?: HonkPresetStop;
};

export function submissionModel(snapshot: ModelSelectionSnapshot): SubmissionModel {
  if (snapshot.active === "single") {
    if (snapshot.singleFamily === KIMI_MODEL_ID) {
      // Kimi exposes no effort control; the gateway's default variant applies.
      return { model: HONK_MODEL_IDS.kimi };
    }
    return {
      model:
        snapshot.singleFamily === "sol" && snapshot.fast.sol
          ? HONK_MODEL_IDS.solFast
          : snapshot.singleFamily === "opus5" && snapshot.fast.opus5
            ? HONK_MODEL_IDS.opus5Fast
            : VARIANT_FAMILY_MODELS[snapshot.singleFamily],
      variant: snapshot.variants[snapshot.singleFamily],
    };
  }
  const pairing = fusionPairing(snapshot.stop);
  return {
    model: { providerID: pairing.main.providerID, id: pairing.main.id },
    variant: pairing.main.variant,
    fusionStop: pairing.stop,
  };
}

// Per-account connectivity as the picker sees it. Purely informational: it
// feeds the preview cards' status and connect messages but never disables a
// row or changes what submits — a missing account fails the run at runtime.
export type ProviderConnectivity = {
  readonly openAi: boolean | null;
  readonly openCodeGo: boolean | null;
  readonly claude: boolean | null;
};

// Connectivity is trustworthy only once the auth store has loaded; before that
// every account reads unknown so nothing gets gated during startup.
export function providerConnectivity(auth: {
  readonly phase: "unavailable" | "loading" | "ready";
  readonly openAiConnected: boolean;
  readonly openCodeGoConnected: boolean;
  readonly claudeConnected: boolean | null;
}): ProviderConnectivity {
  if (auth.phase !== "ready") {
    return { openAi: null, openCodeGo: null, claude: null };
  }
  return {
    openAi: auth.openAiConnected,
    openCodeGo: auth.openCodeGoConnected,
    claude: auth.claudeConnected,
  };
}

export function familyConnectivity(
  family: SingleFamilyId,
  connectivity: ProviderConnectivity,
): boolean | null {
  if (family === "sol") return connectivity.openAi;
  if (family === KIMI_MODEL_ID) return connectivity.openCodeGo;
  return connectivity.claude;
}

export function selectionLabel(snapshot: ModelSelectionSnapshot): string {
  if (snapshot.active === "single") {
    if (snapshot.singleFamily === KIMI_MODEL_ID) return "Kimi K3";
    return familyLabel(snapshot.singleFamily);
  }
  return "Fusion";
}

export function threadModelLabel(agent: string, model: OpenCodeModelRef | null): string {
  const pairing = honkPairingForFusionAgent(agent);
  if (pairing !== undefined) return `Fusion · ${stopLabel(pairing.stop)}`;
  if (model === null) return "Model unavailable";
  const name = modelName(model.id);
  const fast =
    model.id === HONK_MODEL_IDS.solFast.id || model.id === HONK_MODEL_IDS.opus5Fast.id
      ? " · Fast"
      : "";
  return model.variant === undefined
    ? `${name}${fast}`
    : `${name} · ${variantLabel(model.variant)}${fast}`;
}

const STORAGE_KEY = "honk:app:model-selection";
const LEGACY_STORAGE_KEY = "honk:app:preset";

// Shipped defaults, exported so the picker can mark them ("Default" in the level menu).
export const DEFAULT_STOP: HonkPresetStop = "medium";
// Fable defaults to high effort everywhere; medium is opt-in via the picker.
export const DEFAULT_VARIANTS: Readonly<Record<VariantFamilyId, SingleVariant>> = Object.freeze({
  fable5: "high",
  opus5: "high",
  sol: "medium",
});
export const DEFAULT_FAST: Readonly<Record<FastFamilyId, boolean>> = Object.freeze({
  opus5: false,
  sol: false,
});

const DEFAULT_SNAPSHOT: ModelSelectionSnapshot = Object.freeze({
  active: "fusion",
  stop: DEFAULT_STOP,
  singleFamily: "fable5",
  variants: DEFAULT_VARIANTS,
  fast: DEFAULT_FAST,
});

const listeners = new Set<() => void>();

let snapshot: ModelSelectionSnapshot = hydrate();

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getModelSelection(): ModelSelectionSnapshot {
  return snapshot;
}

export function useModelSelection(): ModelSelectionSnapshot {
  return useSyncExternalStore(subscribe, getModelSelection, () => DEFAULT_SNAPSHOT);
}

export const actions = {
  selectFusion(stop?: HonkPresetStop): void {
    publish({ ...snapshot, active: "fusion", ...(stop === undefined ? {} : { stop }) });
  },
  setFusionStop(stop: HonkPresetStop): void {
    publish({ ...snapshot, stop });
  },
  selectSingle(family: SingleFamilyId): void {
    publish({ ...snapshot, active: "single", singleFamily: family });
  },
  setSingleVariant(family: VariantFamilyId, variant: SingleVariant): void {
    publish({
      ...snapshot,
      variants: Object.freeze({ ...snapshot.variants, [family]: variant }),
    });
  },
  setSingleFast(family: FastFamilyId, fast: boolean): void {
    publish({
      ...snapshot,
      fast: Object.freeze({ ...snapshot.fast, [family]: fast }),
    });
  },
  resetSingleOptions(family: VariantFamilyId): void {
    publish({
      ...snapshot,
      variants: Object.freeze({ ...snapshot.variants, [family]: DEFAULT_VARIANTS[family] }),
      fast: supportsFast(family)
        ? Object.freeze({ ...snapshot.fast, [family]: DEFAULT_FAST[family] })
        : snapshot.fast,
    });
  },
} as const;

function publish(next: ModelSelectionSnapshot): void {
  if (
    next.active === snapshot.active &&
    next.stop === snapshot.stop &&
    next.singleFamily === snapshot.singleFamily &&
    VARIANT_FAMILIES.every((family) => next.variants[family] === snapshot.variants[family]) &&
    FAST_FAMILIES.every((family) => next.fast[family] === snapshot.fast[family])
  ) {
    return;
  }
  snapshot = Object.freeze({
    ...next,
    variants: Object.freeze({ ...next.variants }),
    fast: Object.freeze({ ...next.fast }),
  });
  persist(snapshot);
  for (const listener of listeners) {
    listener();
  }
}

function isStop(value: unknown): value is HonkPresetStop {
  return HONK_PRESET_STOPS.includes(value as HonkPresetStop);
}

function isSingleFamily(value: unknown): value is SingleFamilyId {
  return SINGLE_FAMILIES.includes(value as SingleFamilyId);
}

function isSingleVariant(value: unknown): value is SingleVariant {
  return SINGLE_VARIANTS.includes(value as SingleVariant);
}

function hydrate(): ModelSelectionSnapshot {
  if (typeof window === "undefined") {
    return DEFAULT_SNAPSHOT;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null) {
        const value = parsed as Record<string, unknown>;
        const variants =
          typeof value.variants === "object" && value.variants !== null
            ? (value.variants as Record<string, unknown>)
            : {};
        const fast =
          typeof value.fast === "object" && value.fast !== null
            ? (value.fast as Record<string, unknown>)
            : {};
        return Object.freeze({
          active: value.active === "single" ? "single" : "fusion",
          stop: isStop(value.stop) ? value.stop : DEFAULT_SNAPSHOT.stop,
          singleFamily: isSingleFamily(value.singleFamily)
            ? value.singleFamily
            : DEFAULT_SNAPSHOT.singleFamily,
          variants: Object.freeze({
            fable5: isSingleVariant(variants.fable5)
              ? variants.fable5
              : DEFAULT_SNAPSHOT.variants.fable5,
            opus5: isSingleVariant(variants.opus5)
              ? variants.opus5
              : DEFAULT_SNAPSHOT.variants.opus5,
            sol: isSingleVariant(variants.sol) ? variants.sol : DEFAULT_SNAPSHOT.variants.sol,
          }),
          fast: Object.freeze({
            opus5: typeof fast.opus5 === "boolean" ? fast.opus5 : DEFAULT_SNAPSHOT.fast.opus5,
            sol: typeof fast.sol === "boolean" ? fast.sol : DEFAULT_SNAPSHOT.fast.sol,
          }),
        });
      }
    }
    return migrateLegacy();
  } catch {
    return DEFAULT_SNAPSHOT;
  }
}

// The retired "honk:app:preset" key stored one raw string: a stop or "kimi-k3".
function migrateLegacy(): ModelSelectionSnapshot {
  const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
  if (legacy === null) {
    return DEFAULT_SNAPSHOT;
  }
  window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  if (isStop(legacy)) {
    const migrated = Object.freeze({ ...DEFAULT_SNAPSHOT, stop: legacy });
    persist(migrated);
    return migrated;
  }
  if (legacy === KIMI_MODEL_ID) {
    const migrated = Object.freeze({
      ...DEFAULT_SNAPSHOT,
      active: "single" as const,
      singleFamily: KIMI_MODEL_ID,
    });
    persist(migrated);
    return migrated;
  }
  return DEFAULT_SNAPSHOT;
}

function persist(value: ModelSelectionSnapshot): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // localStorage failure must not break the composer.
  }
}
