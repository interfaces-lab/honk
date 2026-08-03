// The shared code-block style lives outside prose.tsx so the component module exports components
// only and remains Fast Refresh compatible. Shiki consumers apply this style to generated <pre>
// nodes; Prose.CodeBlock applies the same object to ordinary blocks.

import * as stylex from "@stylexjs/stylex";

import {
  borderVars,
  colorVars,
  controlVars,
  fontVars,
  proseVars,
  radiusVars,
  spaceVars,
} from "./tokens.stylex";

const styles = stylex.create({
  codeBlock: {
    maxWidth: "100%",
    marginBlockStart: {
      default: proseVars["--honk-prose-flow-gap"],
      ":first-child": 0,
    },
    marginBlockEnd: {
      default: proseVars["--honk-prose-flow-gap"],
      ":last-child": 0,
    },
    boxSizing: "border-box",
    paddingBlock: controlVars["--honk-control-gap"],
    paddingInlineStart: controlVars["--honk-control-gap"],
    paddingInlineEnd: spaceVars["--honk-space-gutter"],
    overflowX: "auto",
    overscrollBehaviorX: "contain",
    borderWidth: borderVars["--honk-border-hairline"],
    borderStyle: "solid",
    borderColor: colorVars["--honk-color-border-muted"],
    borderRadius: radiusVars["--honk-radius-field"],
    backgroundColor: colorVars["--honk-color-layer-01"],
    color: colorVars["--honk-color-fg"],
    fontFamily: fontVars["--honk-font-family-mono"],
    fontSize: fontVars["--honk-text-detail"],
    lineHeight: fontVars["--honk-leading-title"],
    whiteSpace: "pre",
  },
});

const proseCodeBlockStyle = styles.codeBlock;

export { proseCodeBlockStyle };
