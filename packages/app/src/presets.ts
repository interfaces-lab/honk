// Every thread pins its selected model at birth. Honk's four effort presets also pin a
// persistent sidekick; catalog-backed direct models can omit that pairing.

import type { OpenCodeModelInfo } from "@honk/opencode";
import {
  HONK_AGENT_PAIRINGS,
  type HonkModelArm,
  type HonkPresetStop,
} from "@honk/opencode/pairing";
import { useSyncExternalStore } from "react";

export const OPEN_CODE_GO_PRESET_ID = "kimi-k3" as const;

export type PresetId = HonkPresetStop | typeof OPEN_CODE_GO_PRESET_ID;

export type PresetModel = {
  readonly providerID: string;
  readonly id: string;
};

export type PresetDefinition = {
  readonly id: PresetId;
  readonly label: string;
  // Hard-pinned on create and every prompt. The mode agent carries no model.
  readonly mainModel: PresetModel;
  readonly mainVariant?: string;
  readonly sidekickModel?: PresetModel;
  readonly mainLabel: string;
  readonly sidekickLabel?: string;
};

export function modelLabel(model: HonkModelArm): string {
  const family = model.providerID === "anthropic" ? "Fable 5" : "Sol";
  return `${family} ${model.variant === "xhigh" ? "Extra high" : `${model.variant.slice(0, 1).toUpperCase()}${model.variant.slice(1)}`}`;
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

export function openCodeGoPreset(
  models: readonly Pick<OpenCodeModelInfo, "enabled" | "id" | "name" | "providerID" | "variants">[],
): PresetDefinition | null {
  const model = models.find(
    (candidate) =>
      candidate.enabled &&
      candidate.providerID === "opencode-go" &&
      candidate.id === OPEN_CODE_GO_PRESET_ID,
  );
  if (model === undefined) return null;
  const variant =
    model.variants.find((candidate) => candidate.id === "max")?.id ?? model.variants[0]?.id;
  return Object.freeze({
    id: OPEN_CODE_GO_PRESET_ID,
    label: model.name,
    mainModel: { providerID: model.providerID, id: model.id },
    ...(variant === undefined ? {} : { mainVariant: variant }),
    mainLabel: model.name,
  });
}

export function presetById(
  id: string,
  presets: readonly PresetDefinition[] = PRESETS,
): PresetDefinition {
  return presets.find((preset) => preset.id === id) ?? PRESETS[1]!;
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
  return (
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "ultra" ||
    value === OPEN_CODE_GO_PRESET_ID
  );
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
