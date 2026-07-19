// Shared chrome for the onboarding steps: the copy column with eyebrow and
// heading, the layer-01 stage panel, the fact-row primitive, and the footer row.
// One layout for every step — decisions live in the copy column, evidence in the
// stage.

import * as stylex from "@stylexjs/stylex";
import { Kbd, Text } from "@honk/ui";
import { colorVars, controlVars, motionVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as React from "react";

import { onboardingLayout } from "./onboarding-layout.stylex";

export type OnboardingStep = "welcome" | "location" | "provider" | "basics";
export const ONBOARDING_STEP_ORDER: readonly OnboardingStep[] = [
  "welcome",
  "location",
  "provider",
  "basics",
];

const CONTENT_GAP = "24px";
const HEADING_SIZE = "28px";
const HEADING_LEADING = "34px";

const stepEnter = stylex.keyframes({
  from: {
    opacity: 0,
    transform: "translateY(4px)",
  },
  to: {
    opacity: 1,
    transform: "translateY(0)",
  },
});

export const onboardingStepStyles = stylex.create({
  stage: {
    minHeight: 0,
    flexGrow: 1,
    display: "flex",
    flexDirection: "column",
    animationName: {
      default: stepEnter,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    animationDuration: {
      default: motionVars["--honk-motion-duration-base"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    animationTimingFunction: motionVars["--honk-motion-ease-out"],
  },
  body: {
    minHeight: 0,
    flexGrow: 1,
    display: "grid",
    gridTemplateColumns: {
      default: "minmax(0, 1fr) minmax(0, 1fr)",
      [onboardingLayout.compactMedia]: "minmax(0, 1fr)",
    },
    overflowY: "auto",
  },
  copy: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    // oxlint-disable-next-line honk/design-no-raw-values -- 24px content column gap is fixed modal layout, no spacing token owns 24px
    gap: CONTENT_GAP,
    padding: {
      default: onboardingLayout.contentPad,
      [onboardingLayout.compactMedia]: onboardingLayout.contentPadCompact,
    },
  },
  copyInner: {
    width: "100%",
    maxWidth: "400px",
    display: "grid",
    gap: spaceVars["--honk-space-panel-pad"],
  },
  panel: {
    minWidth: 0,
    minHeight: {
      default: 0,
      [onboardingLayout.compactMedia]: "220px",
    },
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    padding: {
      default: onboardingLayout.contentPad,
      [onboardingLayout.compactMedia]: onboardingLayout.contentPadCompact,
    },
    backgroundColor: colorVars["--honk-color-layer-01"],
  },
  footer: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    paddingBlock: onboardingLayout.contentPadCompact,
    paddingInline: {
      default: onboardingLayout.contentPad,
      [onboardingLayout.compactMedia]: onboardingLayout.contentPadCompact,
    },
  },
  footerSpacer: {
    flexGrow: 1,
  },
});

export function OnboardingStepCopy({
  step,
  title,
  children,
}: {
  readonly step: OnboardingStep;
  readonly title: string;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <section {...stylex.props(onboardingStepStyles.copy)}>
      <div {...stylex.props(onboardingStepStyles.copyInner)}>
        <Text
          as="p"
          size="xs"
          tone="faint"
          weight="semibold"
          style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}
        >
          Setup {ONBOARDING_STEP_ORDER.indexOf(step) + 1} of {ONBOARDING_STEP_ORDER.length}
        </Text>
        <Text
          as="div"
          role="heading"
          aria-level={1}
          size="xl"
          weight="semibold"
          style={{ fontSize: HEADING_SIZE, lineHeight: HEADING_LEADING }}
        >
          {title}
        </Text>
        {children}
      </div>
    </section>
  );
}

export function OnboardingStepPanel({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <section aria-label={label} {...stylex.props(onboardingStepStyles.panel)}>
      {children}
    </section>
  );
}

// Fact rows: the one primitive for enumerable content in the copy column.
// Text-first — an optional Kbd cluster is the only allowed leading ornament;
// icons and color stay reserved for status in the stage.

// Wide enough for a three-key chord (⌘⇧T); keeps descriptions aligned.
const FACT_KEYS_WIDTH = "64px";

const factStyles = stylex.create({
  list: {
    display: "grid",
    gap: onboardingLayout.contentPadCompact,
  },
  row: {
    display: "flex",
    alignItems: "flex-start",
    gap: spaceVars["--honk-space-gutter"],
  },
  keys: {
    minWidth: FACT_KEYS_WIDTH,
    display: "inline-flex",
    alignItems: "center",
    flexShrink: 0,
    gap: controlVars["--honk-control-gap"],
  },
  copy: {
    minWidth: 0,
    display: "grid",
    gap: controlVars["--honk-control-gap"],
  },
});

export function OnboardingFactList({
  children,
}: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  return <div {...stylex.props(factStyles.list)}>{children}</div>;
}

export function OnboardingFact({
  keys,
  term,
  description,
}: {
  readonly keys?: readonly string[];
  readonly term?: string;
  readonly description: string;
}): React.ReactElement {
  return (
    <div {...stylex.props(factStyles.row)}>
      {keys === undefined ? null : (
        <span {...stylex.props(factStyles.keys)}>
          {keys.map((key) => (
            <Kbd key={key} size="md">
              {key}
            </Kbd>
          ))}
        </span>
      )}
      <div {...stylex.props(factStyles.copy)}>
        {term === undefined ? null : (
          <Text as="p" size="sm" weight="semibold">
            {term}
          </Text>
        )}
        <Text as="p" size="sm" tone="muted">
          {description}
        </Text>
      </div>
    </div>
  );
}
