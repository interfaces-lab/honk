import { type CxOptions, cx } from "class-variance-authority";
import { extendTailwindMerge } from "tailwind-merge";

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "multi-xs",
            "multi-sm",
            "multi-base",
            "multi-lg",
            "multi-xl",
            "caption",
            "detail",
            "body",
            "title",
            "multi-code",
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
            "multi-fg-primary",
            "multi-fg-secondary",
            "multi-fg-tertiary",
            "multi-fg-quaternary",
            "multi-icon-accent-primary",
            "multi-icon-primary",
            "multi-icon-quaternary",
            "multi-icon-secondary",
            "multi-icon-tertiary",
            "multi-icon-warning",
          ],
        },
      ],
      rounded: [
        {
          rounded: ["multi", "multi-card", "multi-chip", "multi-control", "multi-pill"],
        },
      ],
    },
  },
});

export function cn(...inputs: CxOptions) {
  return twMerge(cx(inputs));
}

export const controlTransitionClassName = "duration-150 ease-out motion-reduce:transition-none";
export const interactiveControlCursorClassName = "cursor-(--multi-button-cursor)";
export const interactiveHostCursorClassName = "[button&,a&]:cursor-(--multi-button-cursor)";
