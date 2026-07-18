import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { applyStyle, type HonkStyle, type StyleProp } from "./style";
import { colorVars, controlVars, fontVars, radiusVars } from "./tokens.stylex";

type FieldSize = "md" | "lg";

// Hairline is an inset shadow so the ring never shifts layout.
const RING_BASE = `inset 0 0 0 1px ${colorVars["--honk-color-border-base"]}`;
const RING_HOVER = `inset 0 0 0 1px ${colorVars["--honk-color-border-strong"]}`;

const sx = stylex.create({
  root: {
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    width: "100%",
    boxSizing: "border-box",
    backgroundColor: colorVars["--honk-color-control"],
    borderRadius: radiusVars["--honk-radius-field"],
    boxShadow: {
      default: RING_BASE,
      ":hover": { "@media (hover: hover)": RING_HOVER },
    },
    outlineColor: colorVars["--honk-color-accent"],
    outlineStyle: { default: "none", ":focus-within": "solid" },
    outlineWidth: controlVars["--honk-control-focus-ring-width"],
    outlineOffset: controlVars["--honk-control-focus-ring-offset"],
  },
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
  style?: StyleProp<HonkStyle>;
}

function FieldRoot({ size = "md", style, children, ...rest }: FieldProps): React.ReactElement {
  return (
    <div
      {...rest}
      {...applyStyle(stylex.props(sx.root, size === "lg" ? sx.sizeLg : sx.sizeMd), style)}
    >
      {children}
    </div>
  );
}

interface FieldInputProps extends Omit<
  React.ComponentPropsWithoutRef<"input">,
  "className" | "style"
> {
  ref?: React.Ref<HTMLInputElement>;
  style?: StyleProp<HonkStyle>;
}

function FieldInput({ style, ...rest }: FieldInputProps): React.ReactElement {
  return <input {...rest} {...applyStyle(stylex.props(sx.input), style)} />;
}

const Field = Object.assign(FieldRoot, { Input: FieldInput });

export { Field };
export type { FieldInputProps, FieldProps, FieldSize };
