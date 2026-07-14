// The plan card — the agent's proposed plan in the thread (Part kind "plan",
// packages/api/src/core/v1/part.ts: planId · markdown · summary · implementedAt). It is assistant
// output, so the ONE hard law of this surface applies: assistant output is NEVER a bubble
// (locked.html §5). No surface, no card, no border, no radius — a bold title over the plan body,
// with hierarchy carried entirely by the fg-primary → fg-secondary → fg-tertiary type ramp, never
// by a container. Anatomy ported from the app's ProposedPlanMessage (packages/app/src/components/
// chat/message/proposed-plan-message.tsx): a semibold truncating title row and an opacity-0 Edit
// affordance revealed on card hover, over the plan's rendered markdown body.
//
// The Part carries markdown; the CALLER resolves it into this leaf's two already-rendered pieces —
// `title` (the app's proposedPlanTitle(markdown)) and `children` (the app's markdown engine
// rendering the stripped body). We only STYLE the body container; the app owns markdown paint.
//
// Presentational and effect-free (ADR 0025): props in, DOM out. The app's editing flow (the TipTap
// editor, the save round-trip, the draft/saving state) is caller composition, not card anatomy — it
// stays out of this leaf. This renders the resting card plus a hover-revealed Edit that simply calls
// onEdit; `implemented` (the Part's implementedAt !== null, resolved by the caller) marks a settled
// plan. Streaming/expanded/editing are all the caller's.

import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { Button } from "./button";
import { Icon } from "./icon";
import { IconCheckmark1, IconPencilLine } from "./icons";
import { Text } from "./text";
import { colorVars, conversationVars, fontVars } from "./tokens.stylex";

// A settled/implemented plan dims a touch so a done plan recedes in a long thread. Display-opacity
// mechanics (status-row's LABEL_OPACITY precedent), not a token — it is render behaviour, not shared
// design vocabulary. 0.7 = a clear "done" recede that still reads (the fg text stays legible on the
// card); the check marker below carries the explicit signal, this only de-emphasizes.
const IMPLEMENTED_OPACITY = 0.7;

const styles = stylex.create({
  card: {
    // Card-level hover feeds the Edit reveal: the root flips its own private --_reveal var and the
    // Edit control reads it (parent-sets-a-var — StyleX 0.19 has no descendant selectors; the
    // work-group headerRow → stop precedent). Hover-capable pointers only.
    "--_reveal": {
      default: "0",
      ":hover": { "@media (hover: hover)": "1" },
    },
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    // header block → body: one step gap (the app's pt-1.5 between the title and the plan body).
    gap: conversationVars["--honk-conversation-step-gap"],
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    // Every conversation row owns its own inset here — there is no timeline-scope descendant CSS to
    // apply it (the tool-call precedent).
    paddingInline: conversationVars["--honk-conversation-inset"],
    fontFamily: fontVars["--honk-font-family-ui"],
    // The conversation tier (13/18): the body markdown (children) inherits it; the Text leaves set
    // their own size over it.
    fontSize: fontVars["--honk-text-title"],
    lineHeight: fontVars["--honk-leading-title"],
    // Hierarchy is the fg ramp, never a container (locked §5): the card paints the primary fg and
    // the muted tiers below step down the ramp.
    color: colorVars["--honk-color-fg"],
  },
  // Implemented = a settled plan recedes a touch. NEVER a surface/bubble change (the law holds) —
  // only opacity.
  implemented: {
    opacity: IMPLEMENTED_OPACITY,
  },
  header: {
    display: "flex",
    flexDirection: "column",
    // title → summary: the tight row gap, so the caption hugs the title.
    gap: conversationVars["--honk-conversation-row-gap"],
    minWidth: 0,
  },
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: conversationVars["--honk-conversation-step-gap"],
    minWidth: 0,
  },
  // The title grows and truncates; the trailing marker/Edit stay put (Text's truncate adds the
  // ellipsis rules + minWidth:0). Its color inherits the card's primary fg.
  title: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  // A one-line muted caption under the title — the fg-secondary tier of the ramp.
  summary: {
    color: colorVars["--honk-color-fg-secondary"],
  },
  // The "Implemented" marker: a small check + label at the ramp's most-muted tier. The Icon inherits
  // this color through currentColor; the label inherits it via tone="inherit".
  marker: {
    display: "inline-flex",
    alignItems: "center",
    gap: conversationVars["--honk-conversation-row-gap"],
    flexShrink: 0,
    color: colorVars["--honk-color-fg-tertiary"],
  },
  // Edit: hidden until the card is hovered, or the button itself is focused (keyboard reaches it —
  // the work-group stop idiom). The fade AND its reduced-motion 0s fallback ride the Button's own
  // opacity transition (its sx.root already transitions opacity at duration-hover), so this leaf
  // declares no motion of its own.
  editReveal: {
    opacity: {
      default: "var(--_reveal, 0)",
      ":focus-visible": "1",
    },
  },
  // The plan body (children = the app's rendered markdown). We style only the container: keep it
  // from overflowing and let long tokens wrap. The 13/18 tier + fg color come from the card.
  body: {
    minWidth: 0,
    overflowWrap: "anywhere",
  },
});

interface PlanCardProps {
  // The plan's title, already resolved by the caller (the app's proposedPlanTitle(markdown)).
  title: string;
  // The plan body — the app's markdown engine renders it; this leaf only styles the container.
  children?: React.ReactNode;
  // A one-line muted caption under the title (the Part's optional `summary`).
  summary?: string | undefined;
  // When given, renders a hover-revealed Edit control (a real <button>) that calls this. Omit for a
  // read-only plan (no button, no reveal).
  onEdit?: (() => void) | undefined;
  // The Part's implementedAt !== null, resolved by the caller: marks a settled plan (a check marker
  // + a touch of dim).
  implemented?: boolean | undefined;
  // Caller override, merged last (charter merge order).
  xstyle?: stylex.StyleXStyles;
}

function PlanCard({
  title,
  children,
  summary,
  onEdit,
  implemented = false,
  xstyle,
}: PlanCardProps): React.ReactElement {
  return (
    <div
      // data-proposed-plan-message mirrors the app's DOM contract (proposed-plan-message.tsx);
      // data-plan-implemented exposes the settled state for tests/consumers. Styling never reads
      // either — the fg ramp and opacity carry the presentation.
      data-proposed-plan-message=""
      data-plan-implemented={implemented ? "" : undefined}
      {...stylex.props(styles.card, implemented && styles.implemented, xstyle)}
    >
      <div {...stylex.props(styles.header)}>
        <div {...stylex.props(styles.titleRow)}>
          <Text size="lg" weight="semibold" tone="inherit" truncate xstyle={styles.title}>
            {title}
          </Text>
          {implemented && (
            <span {...stylex.props(styles.marker)}>
              <Icon icon={IconCheckmark1} size="xs" />
              <Text size="sm" tone="inherit">
                Implemented
              </Text>
            </span>
          )}
          {onEdit !== undefined && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onEdit}
              iconStart={<Icon icon={IconPencilLine} size="sm" />}
              xstyle={styles.editReveal}
            >
              Edit
            </Button>
          )}
        </div>
        {summary !== undefined && (
          <Text as="p" size="sm" tone="inherit" truncate xstyle={styles.summary}>
            {summary}
          </Text>
        )}
      </div>
      {children != null && <div {...stylex.props(styles.body)}>{children}</div>}
    </div>
  );
}

export { PlanCard };
export type { PlanCardProps };
