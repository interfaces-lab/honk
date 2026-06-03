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
            "heading",
            "conversation",
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
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: CxOptions) {
  return twMerge(cx(inputs));
}

export const controlTransitionClassName = "duration-150 ease-out motion-reduce:transition-none";
