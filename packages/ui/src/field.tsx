// The input surface — the one primitive that draws "a place you type": the control well,
// the hairline ring, the field radius, and the crisp accent focus ring. Callers compose the
// inside (scope chips, the bare input, hint keys, a submit control) as flex children; the
// container owns geometry and focus so no call site ever hand-rolls another ring recipe.
// Zero logic, zero effects — focus is CSS :focus-within, never a React focus state.
//
//   Field          the surface: flex row, ring, radius, focus outline
//   └ Field.Input  the bare text input: transparent, unstyled, fills the row

import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { colorVars, controlVars, fontVars, radiusVars } from "./tokens.stylex";

type FieldSize = "md" | "lg";

// A hairline ring drawn as an inset shadow (not a border, so it never shifts layout).
const RING_BASE = `inset 0 0 0 1px ${colorVars["--honk-color-border-base"]}`;
const RING_HOVER = `inset 0 0 0 1px ${colorVars["--honk-color-border-strong"]}`;
// Focus ring intrinsics — the same 1px hairline + 2px gap recipe button.tsx and checkbox.tsx
// draw; control anatomy, not tokens. Drawn with `outline` so it never collides with the ring.
const FOCUS_RING_WIDTH = "1px";
const FOCUS_RING_OFFSET = "2px";

const sx = stylex.create({
  root: {
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    width: "100%",
    boxSizing: "border-box",
    // Bluesky's TextField rests on contrast_50 rather than the near-white contrast_25 layer;
    // this is the same semantic control fill used by neutral buttons.
    backgroundColor: colorVars["--honk-color-control"],
    borderRadius: radiusVars["--honk-radius-field"],
    boxShadow: {
      default: RING_BASE,
      ":hover": { "@media (hover: hover)": RING_HOVER },
    },
    outlineColor: colorVars["--honk-color-accent"],
    outlineStyle: { default: "none", ":focus-within": "solid" },
    outlineWidth: FOCUS_RING_WIDTH,
    outlineOffset: FOCUS_RING_OFFSET,
  },
  // Sizes ride the shared control scale: md is the standard 28px field; lg is the hero
  // surface (omnibox) — the 32px step plus block padding so inner chips get breathing room.
  sizeMd: {
    minHeight: controlVars["--honk-control-h-md"],
    paddingBlock: 0,
    paddingInline: controlVars["--honk-control-pad-md"],
  },
  sizeLg: {
    minHeight: controlVars["--honk-control-h-lg"],
    paddingBlock: controlVars["--honk-control-gap"],
    paddingInline: controlVars["--honk-control-pad-lg"],
  },
  input: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    minWidth: 0,
    borderWidth: 0,
    borderStyle: "none",
    outline: "none",
    backgroundColor: "transparent",
    padding: 0,
    color: colorVars["--honk-color-text-primary"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body"],
    lineHeight: fontVars["--honk-leading-body"],
    "::placeholder": {
      color: colorVars["--honk-color-text-muted"],
    },
  },
});

interface FieldProps extends Omit<React.ComponentPropsWithoutRef<"div">, "className" | "style"> {
  size?: FieldSize;
  // Caller override, merged last (charter merge order).
  xstyle?: stylex.StyleXStyles;
}

function FieldRoot({ size = "md", xstyle, children, ...rest }: FieldProps): React.ReactElement {
  return (
    <div {...rest} {...stylex.props(sx.root, size === "lg" ? sx.sizeLg : sx.sizeMd, xstyle)}>
      {children}
    </div>
  );
}

interface FieldInputProps
  extends Omit<React.ComponentPropsWithoutRef<"input">, "className" | "style"> {
  ref?: React.Ref<HTMLInputElement>;
  xstyle?: stylex.StyleXStyles;
}

function FieldInput({ xstyle, ...rest }: FieldInputProps): React.ReactElement {
  return <input {...rest} {...stylex.props(sx.input, xstyle)} />;
}

const Field = Object.assign(FieldRoot, { Input: FieldInput });

export { Field };
export type { FieldInputProps, FieldProps, FieldSize };
