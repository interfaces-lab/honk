export type ComposerMenuPopoverAnchor = {
  getBoundingClientRect: () => DOMRect;
};

/** Live DOM anchor for composer `/` and `@` menus. Do not cache rects in React state. */
export function composerMenuPopoverAnchorFromElement(
  resolveElement: () => HTMLElement | null,
): ComposerMenuPopoverAnchor {
  return {
    getBoundingClientRect: () => {
      const element = resolveElement();
      return element ? element.getBoundingClientRect() : new DOMRect(0, 0, 0, 0);
    },
  };
}
