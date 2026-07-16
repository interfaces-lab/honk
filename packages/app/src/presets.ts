// Every thread pins one Main + Sidekick bundle at birth. The main model rides every prompt.
// The Honk plugin keeps a persistent child session on the paired sidekick.

import {
  HONK_AGENT_PAIRINGS,
  type HonkModelArm,
  type HonkPresetStop,
} from "@honk/opencode/pairing";
import { useSyncExternalStore } from "react";

export type PresetId = HonkPresetStop;

export type PresetModel = {
  readonly providerID: string;
  readonly id: string;
};

export type PresetDefinition = {
  readonly id: PresetId;
  readonly label: string;
  // Hard-pinned on create and every prompt. The mode agent carries no model.
  readonly mainModel: PresetModel;
  readonly mainVariant: string;
  readonly sidekickModel: PresetModel;
  readonly mainLabel: string;
  readonly sidekickLabel: string;
};

function modelLabel(model: HonkModelArm): string {
  const family = model.providerID === "anthropic" ? "Fable 5" : "Sol";
  return `${family} ${model.variant}`;
}

export const PRESETS: readonly PresetDefinition[] = Object.freeze(
  HONK_AGENT_PAIRINGS.map((pairing) => ({
    id: pairing.stop,
    label: pairing.stop,
    mainModel: { providerID: pairing.main.providerID, id: pairing.main.id },
    mainVariant: pairing.main.variant,
    sidekickModel: { providerID: pairing.sidekick.providerID, id: pairing.sidekick.id },
    mainLabel: modelLabel(pairing.main),
    sidekickLabel: modelLabel(pairing.sidekick),
  })),
);

export function presetById(id: string): PresetDefinition {
  return PRESETS.find((preset) => preset.id === id) ?? PRESETS[1]!;
}

const STORAGE_KEY = "honk:app:preset";
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
    // localStorage failure must not break the composer.
  }
}
