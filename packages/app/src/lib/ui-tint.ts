export const TINT_PAD = { h: 168, inset: 12, w: 220 } as const;

export function tintPreviewCss(hue: number, saturation: number) {
  const c = Math.max(0.06, (0.24 * saturation) / 100);
  return `oklch(0.78 ${c} ${hue})`;
}
