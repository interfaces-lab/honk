import { cva, type CxOptions, cx } from "class-variance-authority";
import { extendTailwindMerge } from "tailwind-merge";

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

export const controlTransitionVariants = cva(
  "duration-(--motion-duration-ui) ease-(--ease-shell) motion-reduce:transition-none",
);
export const interactiveControlCursorVariants = cva("cursor-(--honk-button-cursor)");
export const interactiveHostCursorVariants = cva("[button&,a&]:cursor-(--honk-button-cursor)");

/** Portaled menu/popup shells read `--honk-menu-surface-background` from `html`. */
export const honkMenuPopupSurfaceClasses = "bg-(--honk-menu-surface-background)";

export const honkMenuPopupFontClasses = "font-honk text-honk-chrome text-honk-fg-primary";

export const honkMenuPopupTypographyClasses = cn(
  honkMenuPopupFontClasses,
  "backdrop-blur-[length:var(--honk-glass-blur-surface)] dark:backdrop-blur-none",
);

export const honkMenuPopupShellClasses = cn(honkMenuPopupSurfaceClasses, honkMenuPopupTypographyClasses);

/** Cursor picker-menu edge: one hairline via shadow-sm, not border + shadow + inset ring. */
export const honkMenuPickerChromeClasses = "border-0 shadow-honk-sm outline-hidden";

/** Match menu popup hairline (`shadow-honk-sm` / stroke-tertiary) on workbench surfaces. */
export const honkMenuSeparatorClasses = "mx-0 my-1 h-px shrink-0 bg-honk-stroke-tertiary";
