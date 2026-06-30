import { cva, type CxOptions, cx } from "class-variance-authority";
import { extendTailwindMerge } from "tailwind-merge";

export { mergeProps } from "./utils/mergeProps";

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "honk-xs",
            "honk-sm",
            "honk-base",
            "honk-lg",
            "honk-xl",
            "caption",
            "detail",
            "body",
            "title",
            "honk-code",
            "heading",
            "conversation",
            "conversation-normalized",
            "sidebar-label",
            "sidebar-subtitle",
          ],
        },
      ],
      "text-color": [
        {
          text: [
            "honk-fg-primary",
            "honk-fg-secondary",
            "honk-fg-tertiary",
            "honk-fg-quaternary",
            "honk-icon-accent-primary",
            "honk-icon-primary",
            "honk-icon-quaternary",
            "honk-icon-secondary",
            "honk-icon-tertiary",
            "honk-icon-warning",
          ],
        },
      ],
      rounded: [
        {
          rounded: ["honk", "honk-card", "honk-chip", "honk-control", "honk-pill"],
        },
      ],
    },
  },
});

export function cn(...inputs: CxOptions) {
  return twMerge(cx(inputs));
}

const honkMenuClassNames = {
  root: "honk-menu",
  surface: "honk-menu__surface",
  separator: "honk-menu__separator",
} as const;

const honkMenuClassName = (...names: Array<string | false | null | undefined>) =>
  names.filter(Boolean).join(" ");

export const controlTransitionVariants = cva(
  "duration-(--motion-duration-ui) ease-(--ease-shell) motion-reduce:transition-none",
);
export const interactiveControlCursorVariants = cva("cursor-(--honk-button-cursor)");
export const interactiveHostCursorVariants = cva("[button&,a&]:cursor-(--honk-button-cursor)");

/** Portaled menu/popup shells read `--honk-menu-bg` from `html`. */
export const honkMenuPopupSurfaceClasses = honkMenuClassNames.surface;

export const honkMenuPopupFontClasses = honkMenuClassNames.root;

export const honkMenuPopupTypographyClasses = honkMenuClassName(
  honkMenuPopupFontClasses,
);

export const honkMenuPopupShellClasses = honkMenuClassName(
  honkMenuPopupSurfaceClasses,
  honkMenuPopupTypographyClasses,
);

/** StyleX owns picker-menu chrome; these remain as stable compatibility hooks. */
export const honkMenuPickerChromeClasses = "";

export const honkMenuPickerLayoutClasses = "";

export const honkMenuPickerShellClasses = honkMenuPopupShellClasses;

/** Cursor-parity section divider with a slight horizontal inset. */
export const honkMenuSeparatorClasses = honkMenuClassNames.separator;
