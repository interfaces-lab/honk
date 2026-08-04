// The shared code-block style lives outside prose.tsx so the component module exports components
// only and remains Fast Refresh compatible. Shiki consumers apply this style to generated <pre>
// nodes; Prose.CodeBlock applies the same object to ordinary blocks.

import * as stylex from "@stylexjs/stylex";

import { borderVars, colorVars, fontVars, proseVars, radiusVars, spaceVars } from "./tokens.stylex";

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
    padding: spaceVars["--honk-space-panel-pad"],
    overflowX: "auto",
    overscrollBehaviorX: "contain",
    borderWidth: borderVars["--honk-border-hairline"],
    borderStyle: "solid",
    borderColor: proseVars["--honk-prose-code-paint"],
    borderRadius: radiusVars["--honk-radius-field"],
    backgroundColor: proseVars["--honk-prose-code-paint"],
    color: colorVars["--honk-color-fg"],
    fontFamily: fontVars["--honk-font-family-mono"],
    fontSize: fontVars["--honk-font-size-code"],
    lineHeight: fontVars["--honk-leading-code"],
    whiteSpace: "pre",
  },
});

const proseCodeBlockStyle = styles.codeBlock;

export { proseCodeBlockStyle };
