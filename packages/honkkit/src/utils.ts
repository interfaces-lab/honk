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
