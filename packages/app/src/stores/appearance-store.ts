import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

import {
  DEFAULT_APPEARANCE_TINT_HUE,
  DEFAULT_APPEARANCE_TINT_INTENSITY,
} from "../lib/appearance-colors";
import {
  type AppearanceSnapshot,
  readAppearanceSnapshot,
  resetAppearanceSettings,
  setCodeFontFamily,
  setCodeFontSize,
  setReduceTransparency,
  setTintHue,
  setTintSaturation,
  setUiFontFamily,
  setUiFontSize,
  subscribeAppearanceSettings,
} from "../lib/appearance-settings";

export const DEFAULT_APPEARANCE_SNAPSHOT: AppearanceSnapshot = {
  reduceTransparency: false,
  hue: DEFAULT_APPEARANCE_TINT_HUE,
  saturation: DEFAULT_APPEARANCE_TINT_INTENSITY,
  uiFontSize: 13,
  codeFontSize: 12,
  uiFont: "",
  codeFont: "",
};

type AppearanceStoreState = AppearanceSnapshot;

function getInitialSnapshot(): AppearanceSnapshot {
  if (typeof window === "undefined") return DEFAULT_APPEARANCE_SNAPSHOT;
  return readAppearanceSnapshot();
}

export const useAppearanceStore = create<AppearanceStoreState>(() => getInitialSnapshot());

function syncAppearanceStore() {
  useAppearanceStore.setState(readAppearanceSnapshot());
}

if (typeof window !== "undefined") {
  subscribeAppearanceSettings(syncAppearanceStore);
}

export function useAppearanceSettingsSnapshot(): AppearanceSnapshot {
  return useAppearanceStore(
    useShallow((state) => ({
      reduceTransparency: state.reduceTransparency,
      hue: state.hue,
      saturation: state.saturation,
      uiFontSize: state.uiFontSize,
      codeFontSize: state.codeFontSize,
      uiFont: state.uiFont,
      codeFont: state.codeFont,
    })),
  );
}

export const appearanceSettingsActions = {
  reset: resetAppearanceSettings,
  setCodeFontFamily,
  setCodeFontSize,
  setReduceTransparency,
  setTintHue,
  setTintSaturation,
  setUiFontFamily,
  setUiFontSize,
} as const;
