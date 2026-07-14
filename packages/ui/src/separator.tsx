// The separator — honk's hairline divider (a rule between toolbar groups, list sections, or
// stacked panels). Built on Base UI's Separator, which renders a `<div>` carrying the correct
// screen-reader semantics (role="separator" + aria-orientation) that a bare styled <div> would
// miss — so even though a divider never takes a pointer, we WRAP the Base UI part (round-8 rule:
// if Base UI ships the component, wrap it) rather than hand-roll a span like status-dot, which has
// no Base UI equivalent to lean on. One concept per file (ADR 0011).
//
// STYLING (round-8 doctrine): a primitive is StyleX + Base UI only — no className. StyleX owns the
// whole surface reading the token bus, so a dialkit setProperty on --honk-color-border-* repaints
// every rule with zero React. The hairline is drawn as a 1px BACKGROUND fill on the div (a real
// 1px box), not a CSS border a variant toggles — one honest line that never shifts layout. There
// is no motion here: a divider never animates, so (unlike Button/StatusDot) there is deliberately
// no keyframe and no reduced-motion sibling.
//
// TONE maps onto honk's two-step neutral-alpha stroke ladder — the SAME border tokens the button's
// rings read (colorVars border-muted/-base): `muted` is the DEFAULT quiet hairline; `base` is a
// hair stronger (rgba .10 vs .08) for a divider that needs to carry more weight. Alpha, never
// opaque grey, so the rule composites cleanly on whatever layer sits beneath it.

import { Separator as Base } from "@base-ui/react/separator";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { colorVars } from "./tokens.stylex";

type SeparatorTone = "muted" | "base";

// The divider's thickness — display anatomy (a named intrinsic, like the button's FOCUS_RING_WIDTH
// or the status dot's DOT_SIZE), not shared design vocabulary. One device pixel: the hairline rule.
const HAIRLINE = "1px";

const sx = stylex.create({
  // flexShrink 0 so a rule never collapses when its flex parent (a tight toolbar) runs out of room.
  root: {
    flexShrink: 0,
  },
  // A full-width, 1px-tall rule — the horizontal divider between stacked sections.
  horizontal: {
    height: HAIRLINE,
    width: "100%",
  },
  // A 1px-wide rule that stretches to its flex row's cross axis via alignSelf — NOT height:100%,
  // which would collapse to 0 under an indefinite parent, whereas `stretch` fills it. The vertical
  // group divider inside a toolbar row.
  vertical: {
    width: HAIRLINE,
    alignSelf: "stretch",
  },
  muted: { backgroundColor: colorVars["--honk-color-border-muted"] },
  base: { backgroundColor: colorVars["--honk-color-border-base"] },
});

const axisStyleByOrientation: Record<"horizontal" | "vertical", stylex.StyleXStyles> = {
  horizontal: sx.horizontal,
  vertical: sx.vertical,
};
const toneStyleByTone: Record<SeparatorTone, stylex.StyleXStyles> = {
  muted: sx.muted,
  base: sx.base,
};

// className/style are Omitted from the public props (the StyleX charter's no-classname-style rule):
// the app composes layout on a WRAPPER, and one instance is nudged with `xstyle` (a StyleX
// override). Everything else — orientation, `render`, ref, aria/id — rides Base.Props via `...rest`.
interface SeparatorProps extends Omit<Base.Props, "className" | "style"> {
  tone?: SeparatorTone;
  // StyleX escape hatch for the app to nudge one instance (e.g. an inset margin) without the
  // StyleX-vs-Tailwind footgun.
  xstyle?: stylex.StyleXStyles;
}

function Separator({
  orientation = "horizontal",
  tone = "muted",
  xstyle,
  ...rest
}: SeparatorProps): React.ReactElement {
  return (
    <Base
      {...rest}
      // Passed explicitly (destructured out of `rest`) so Base UI sets the matching aria-orientation
      // + data-orientation, and so we can select the axis style below.
      orientation={orientation}
      data-slot="separator"
      {...stylex.props(
        sx.root,
        axisStyleByOrientation[orientation],
        toneStyleByTone[tone],
        xstyle,
      )}
    />
  );
}

export { Separator };
export type { SeparatorProps, SeparatorTone };
