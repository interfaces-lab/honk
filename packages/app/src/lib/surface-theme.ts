import { surfaceThemes } from "@honk/honkkit/theme";

export type SurfaceAppearance = "light" | "dark";

export interface SurfaceThemeInput {
  readonly appearance: SurfaceAppearance;
  readonly osVibrancy: boolean;
  readonly reduceTransparency: boolean;
  readonly highContrast: boolean;
}

export function surfaceThemeFor(input: SurfaceThemeInput) {
  if (input.highContrast) return surfaceThemes.highContrast;
  if (input.reduceTransparency) return surfaceThemes.reducedTransparency;
  return surfaceThemes[input.appearance][input.osVibrancy ? "vibrant" : "solid"];
}

export interface WindowGlassInput {
  readonly osVibrancy: boolean;
  readonly reduceTransparency: boolean;
  readonly highContrast: boolean;
}

export interface WindowGlassState {
  readonly vibrancy: boolean;
}

export function windowGlassFor(input: WindowGlassInput): WindowGlassState {
  return {
    vibrancy: input.osVibrancy && !input.reduceTransparency && !input.highContrast,
  };
}
