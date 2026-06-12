import { type CxOptions, cx } from "class-variance-authority";
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

export const controlTransitionClassName = "duration-150 ease-out motion-reduce:transition-none";
export const interactiveControlCursorClassName = "cursor-(--honk-button-cursor)";
export const interactiveHostCursorClassName = "[button&,a&]:cursor-(--honk-button-cursor)";
