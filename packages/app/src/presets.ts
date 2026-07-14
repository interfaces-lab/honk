// The model presets behind the composer's selector. Every thread is born from one preset that
// pins an Agent + Oracle model bundle, and a thread's preset never changes after creation.
// The authoritative model/variant ids live in the generated opencode config (the sidecar
// supervisor writes the agent definitions); this module is the UI's view of that table —
// display labels + the persisted "which stop is dialed" state (plain store, tab-store idiom).

import { useSyncExternalStore } from "react";

export type PresetId = "low" | "medium" | "high" | "ultra";

export type PresetModel = {
  readonly providerID: string;
  readonly id: string;
};

export type PresetDefinition = {
  readonly id: PresetId;
  readonly label: string;
  // The model bundle this stop hard-pins (sent explicitly on create + every prompt; the
  // MODE agent carries no model of its own). Ids MUST match the desktop config generator's
  // OPENCODE_MODEL_IDS (packages/desktop/src/backend/opencode-config.ts).
  readonly agentModel: PresetModel;
  readonly agentVariant: string;
  // Readout lines under the dial — the models this stop pins, as the user reads them.
  readonly agentLabel: string;
  readonly oracleLabel: string;
};

const SOL: PresetModel = Object.freeze({ providerID: "openai", id: "gpt-5.6-sol" });
const FABLE: PresetModel = Object.freeze({ providerID: "anthropic", id: "claude-fable-5" });

// Table per the grill: medium/high/ultra verbatim from the reference screenshots; low is the
// shipped default completion (flagged for veto in the grill summary).
export const PRESETS: readonly PresetDefinition[] = Object.freeze([
  {
    id: "low",
    label: "low",
    agentModel: SOL,
    agentVariant: "low",
    agentLabel: "GPT-5.6 Sol low",
    oracleLabel: "GPT-5.6 Sol medium",
  },
  {
    id: "medium",
    label: "medium",
    agentModel: SOL,
    agentVariant: "medium",
    agentLabel: "GPT-5.6 Sol medium",
    oracleLabel: "GPT-5.6 Sol high",
  },
  {
    id: "high",
    label: "high",
    agentModel: SOL,
    agentVariant: "xhigh",
    agentLabel: "GPT-5.6 Sol xhigh",
    oracleLabel: "Fable 5 high",
  },
  {
    id: "ultra",
    label: "ultra",
    agentModel: FABLE,
    agentVariant: "high",
    agentLabel: "Fable 5 high",
    oracleLabel: "GPT-5.6 Sol high",
  },
]);

export function presetById(id: string): PresetDefinition {
  return PRESETS.find((preset) => preset.id === id) ?? PRESETS[1]!;
}

const STORAGE_KEY = "honk:app-next:preset";
const DEFAULT_PRESET: PresetId = "medium";

const listeners = new Set<() => void>();

let selected: PresetId = hydrate();

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSelectedPreset(): PresetId {
  return selected;
}

export function useSelectedPreset(): PresetId {
  return useSyncExternalStore(subscribe, getSelectedPreset, () => DEFAULT_PRESET);
}

export const actions = {
  // Accepts the selector's string id and validates before changing the persisted preset.
  select(id: string): void {
    if (!isPresetId(id) || id === selected) {
      return;
    }
    selected = id;
    persist(id);
    for (const listener of listeners) {
      listener();
    }
  },
} as const;

function isPresetId(value: unknown): value is PresetId {
  return value === "low" || value === "medium" || value === "high" || value === "ultra";
}

function hydrate(): PresetId {
  if (typeof window === "undefined") {
    return DEFAULT_PRESET;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isPresetId(raw) ? raw : DEFAULT_PRESET;
  } catch {
    return DEFAULT_PRESET;
  }
}

function persist(id: PresetId): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Persistence must never break the composer.
  }
}
