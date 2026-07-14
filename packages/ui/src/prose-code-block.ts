// The shared code-block style lives outside prose.tsx so the component module exports components
// only and remains Fast Refresh compatible. Shiki consumers apply this style to generated <pre>
// nodes; Prose.CodeBlock applies the same object to ordinary blocks.

import * as stylex from "@stylexjs/stylex";

import { colorVars, fontVars, proseVars, radiusVars, spaceVars } from "./tokens.stylex";

const styles = stylex.create({
  codeBlock: {
    maxWidth: "100%",
    marginBlockStart: 0,
    marginBlockEnd: {
      default: proseVars["--honk-prose-flow-gap"],
      ":last-child": 0,
    },
    padding: spaceVars["--honk-space-panel-pad"],
    overflowX: "auto",
    overscrollBehaviorX: "contain",
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: colorVars["--honk-color-layer-01"],
    color: colorVars["--honk-color-fg-secondary"],
    fontFamily: fontVars["--honk-font-family-mono"],
    fontSize: fontVars["--honk-text-detail"],
    lineHeight: fontVars["--honk-leading-title"],
    whiteSpace: "pre",
  },
});

const proseCodeBlockStyle = styles.codeBlock;

export { proseCodeBlockStyle };
