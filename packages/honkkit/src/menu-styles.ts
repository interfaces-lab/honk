import * as stylex from "@stylexjs/stylex";

const honkMenuClassNames = {
  root: "honk-menu",
  surface: "honk-menu__surface",
  viewport: "honk-menu__viewport",
  item: "honk-menu__item",
  separator: "honk-menu__separator",
  label: "honk-menu__label",
  shortcut: "honk-menu__shortcut",
  slotLeading: "honk-menu__slot-leading",
  slotLabel: "honk-menu__slot-label",
  slotTrailing: "honk-menu__slot-trailing",
} as const;

const honkMenuClassName = (...names: Array<string | false | null | undefined>) =>
  names.filter(Boolean).join(" ");

const honkMenuStyles = stylex.create({
  surface: {
    backgroundColor: "var(--honk-menu-bg)",
    borderWidth: 0,
    boxShadow: "var(--honk-menu-shadow)",
    color: "var(--honk-fg-primary)",
    display: "flex",
    fontFamily: "var(--honk-font-ui)",
    fontSize: "var(--honk-text-chrome)",
    isolation: "isolate",
    lineHeight: "var(--honk-leading-chrome)",
    minWidth: "var(--honk-menu-min-width)",
    maxWidth: "var(--honk-menu-max-width)",
    outline: "none",
    overflow: "hidden",
    position: "relative",
    borderRadius: "var(--honk-radius-lg)",
    transformOrigin: "var(--transform-origin)",
    transitionDuration: {
      default: "var(--honk-menu-motion-duration)",
      "@media (prefers-reduced-motion: reduce)": "0ms",
    },
    transitionProperty: "opacity, transform, scale",
    transitionTimingFunction: "var(--honk-menu-motion-ease)",
    "::after": {
      borderRadius: "inherit",
      boxShadow:
        "inset 0 0 0 1px var(--honk-menu-ring-outer), inset 0 0 0 2px var(--honk-menu-ring-inner)",
      content: "''",
      inset: 0,
      pointerEvents: "none",
      position: "absolute",
      zIndex: 1,
    },
  },
  surfaceStarting: {
    opacity: {
      default: null,
      "[data-starting-style]": 0,
      "[data-ending-style]": 0,
    },
    scale: {
      default: null,
      "[data-starting-style]": 0.98,
      "[data-ending-style]": 0.98,
      "@media (prefers-reduced-motion: reduce)": 1,
    },
  },
  viewport: {
    maxHeight: "var(--honk-menu-available-height)",
    minHeight: 0,
    overflowX: "hidden",
    overflowY: "auto",
    padding: "var(--honk-menu-scroll-padding)",
    scrollPaddingBlock: "var(--honk-menu-scroll-padding)",
    width: "100%",
  },
  item: {
    alignItems: "center",
    borderRadius: "var(--honk-radius-sm)",
    boxSizing: "border-box",
    color: "var(--honk-fg-secondary)",
    cursor: "var(--honk-button-cursor, default)",
    display: "grid",
    gap: "var(--honk-spacing-1-5)",
    gridTemplateColumns: "auto minmax(0, 1fr) auto",
    minHeight: 24,
    outline: "none",
    paddingBlock: 3,
    paddingInline: "var(--honk-spacing-1)",
    userSelect: "none",
    width: "100%",
    ":hover": {
      backgroundColor: "var(--honk-menu-focus-bg)",
      color: "var(--honk-fg-primary)",
    },
    "[data-focused]": {
      backgroundColor: "var(--honk-menu-focus-bg)",
      color: "var(--honk-fg-primary)",
    },
    "[data-highlighted]": {
      backgroundColor: "var(--honk-menu-focus-bg)",
      color: "var(--honk-fg-primary)",
    },
    "[data-selected]": {
      backgroundColor: "var(--honk-menu-selected-bg)",
      color: "var(--honk-fg-primary)",
    },
    "[data-disabled]": {
      opacity: 0.4,
      pointerEvents: "none",
    },
  },
  itemFlex: {
    display: "flex",
  },
  slotLeading: {
    alignItems: "center",
    color: "var(--honk-fg-tertiary)",
    display: "inline-flex",
    flexShrink: 0,
    height: 16,
    justifyContent: "center",
    width: 16,
  },
  slotLabel: {
    color: "var(--honk-fg-primary)",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  slotDescription: {
    color: "var(--honk-fg-tertiary)",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  slotTrailing: {
    alignItems: "center",
    color: "var(--honk-fg-tertiary)",
    display: "inline-flex",
    flexShrink: 0,
    justifyContent: "center",
    marginInlineStart: "auto",
  },
  label: {
    color: "var(--honk-fg-tertiary)",
    fontSize: "var(--honk-text-detail)",
    fontWeight: 400,
    lineHeight: "var(--honk-leading-detail)",
    paddingBlockEnd: 2,
    paddingBlockStart: 6,
    paddingInline: "var(--honk-spacing-1)",
  },
  separator: {
    backgroundColor: "var(--honk-stroke-tertiary)",
    flexShrink: 0,
    height: 1,
    marginBlock: "var(--honk-spacing-1)",
    marginInline: -3,
  },
  shortcut: {
    color: "var(--honk-fg-tertiary)",
    fontFamily: "var(--honk-font-ui)",
    fontSize: "var(--honk-text-body)",
    fontWeight: 400,
    letterSpacing: 0,
    lineHeight: "var(--honk-leading-body)",
  },
});

export { honkMenuClassName, honkMenuClassNames, honkMenuStyles };
