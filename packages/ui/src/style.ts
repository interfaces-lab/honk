// Public `style` hatch for @honk/ui primitives. Plain objects only.
// Token values stay as `*Vars` accessors so dialkit setProperty repaints without React.
// Do not put baked hex or px where a token belongs.

import type * as React from "react";

type HonkStyle = React.CSSProperties;

type StyleProp<T> = T | false | null | undefined | readonly StyleProp<T>[];

function flattenStyle(style: StyleProp<HonkStyle>): React.CSSProperties | undefined {
  if (!style) return undefined;
  if (Array.isArray(style)) {
    let merged: React.CSSProperties | undefined;
    for (const item of style) {
      const flat = flattenStyle(item);
      if (flat) merged = merged ? { ...merged, ...flat } : flat;
    }
    return merged;
  }
  return style as React.CSSProperties;
}

function applyStyle(
  base: { readonly className?: string; readonly style?: React.CSSProperties },
  style: StyleProp<HonkStyle>,
): { className?: string; style?: React.CSSProperties } {
  const override = flattenStyle(style);
  if (!override) return base;
  return { ...base, style: { ...base.style, ...override } };
}

export { applyStyle, flattenStyle };
export type { HonkStyle, StyleProp };
