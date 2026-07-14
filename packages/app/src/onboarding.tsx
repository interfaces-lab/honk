// First-run desktop onboarding. Electron mounts this route in a dedicated transparent fullscreen
// window, so the dialog scrim dims the actual screen while the main app window stays uncreated.
// The native folder picker and sidecar provider-auth API remain the source of truth for both setup
// choices; completion hands control back to the Electron window lifecycle.

import * as stylex from "@stylexjs/stylex";
import { Button, Field, Icon, ListRow, Matrix, Spinner, Text, type Glyph } from "@honk/ui";
import {
  IconArrowUp,
  IconCheckmark1,
  IconClawd,
  IconConsole,
  IconFileBend,
  IconFolderOpen,
  IconOpenaiCodex,
} from "@honk/ui/icons";
import {
  colorVars,
  controlVars,
  conversationVars,
  elevationVars,
  fontVars,
  motionVars,
  radiusVars,
  spaceVars,
} from "@honk/ui/tokens.stylex";
import * as React from "react";

import { actions as appSettingsActions, useAppSettings } from "./app-settings-store";
import { useAppearanceTheme } from "./appearance-store";
import {
  completeDesktopOnboarding,
  dismissDesktopOnboarding,
  finishDesktopOnboarding,
  getOnboardingWindowShownSnapshot,
  pickFolder,
  subscribeOnboardingWindowShown,
} from "./desktop-bridge";
import { OnboardingMist } from "./onboarding-mist";
import type {
  ProviderInventory,
  SidecarProvider,
  SidecarProviderAuthMethod,
  SidecarProviderAuthPrompt,
} from "./sidecar";
import { getBoundHonkClient } from "./watch-registry";

type OnboardingStep = "welcome" | "location" | "provider";
type AuthProviderId = "openai" | "anthropic";
type OAuthProviderId = Exclude<AuthProviderId, "anthropic">;
type OnboardingIntroPhase = "running" | "skipping" | "complete";
type OnboardingExitMode = "complete" | "dismiss";

interface AuthProviderDefinition {
  readonly id: AuthProviderId;
  readonly label: string;
  readonly accountLabel: string;
  readonly icon: Glyph;
}

const AUTH_PROVIDERS: readonly AuthProviderDefinition[] = [
  {
    id: "openai",
    label: "Codex",
    accountLabel: "OpenAI / ChatGPT",
    icon: IconOpenaiCodex,
  },
  {
    id: "anthropic",
    label: "Claude",
    accountLabel: "Claude Code on this Mac",
    icon: IconClawd,
  },
] as const;

const STEP_ORDER: readonly OnboardingStep[] = ["welcome", "location", "provider"];

// Reference-derived onboarding anatomy. These are fixed modal proportions and responsive cutoffs,
// not reusable identity values; all paint, type, radius, elevation, and motion still use tokens.
const CARD_MAX_WIDTH = "1040px";
const CARD_WIDTH = "calc(100% - 48px)";
const CARD_WIDTH_COMPACT = "calc(100% - 24px)";
const CARD_HEIGHT = "min(640px, calc(100dvh - 48px))";
const CARD_HEIGHT_COMPACT = "calc(100dvh - 24px)";
const COMPACT_MEDIA = "@media (max-width: 760px)";
const CONTENT_PAD = "40px";
const CONTENT_PAD_COMPACT = "20px";
const CONTENT_GAP = "24px";
const COPY_MAX_WIDTH = "400px";
const HEADING_SIZE = "28px";
const HEADING_LEADING = "34px";
const PROGRESS_HEIGHT = "4px";
const PROGRESS_GAP = "4px";
const PROGRESS_PAD_TOP = "24px";
const FEATURE_ICON_SIZE = "34px";
const PROVIDER_ICON_SIZE = "36px";
const FOLDER_ICON_SIZE = "48px";
const PROVIDER_ROW_HEIGHT = "60px";
const PANEL_MIN_HEIGHT_COMPACT = "220px";
const STEP_ENTER_OFFSET = "4px";
// The rain film gets five seconds to establish the surface before setup becomes interactive.
const ONBOARDING_INTRO_DURATION = "5s";
const ONBOARDING_INTRO_SKIP_DURATION = "420ms";
const ONBOARDING_BACKDROP_ENTER_DURATION = "1.25s";
const ONBOARDING_BACKDROP_EXIT_DURATION = "620ms";
const ONBOARDING_SURFACE_ENTER_DURATION = "820ms";
const ONBOARDING_SURFACE_EXIT_DURATION = "520ms";
const ONBOARDING_SURFACE_ENTER_SCALE = 0.92;
const ONBOARDING_SURFACE_ENTER_OFFSET = "24px";
const ONBOARDING_SURFACE_ENTER_BLUR = "8px";
const ONBOARDING_SURFACE_EXIT_SCALE = 0.97;
const ONBOARDING_SURFACE_EXIT_BLUR = "4px";
const DEMO_COMPOSER_MIN_HEIGHT = "72px";
const DEMO_WORK_MIN_HEIGHT = "178px";
const DEMO_PROMPT_MAX_WIDTH = "310px";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

const stepEnter = stylex.keyframes({
  from: {
    opacity: 0,
    transform: `translateY(${STEP_ENTER_OFFSET})`,
  },
  to: {
    opacity: 1,
    transform: "translateY(0)",
  },
});

const backdropEnter = stylex.keyframes({
  from: { opacity: 0 },
  to: { opacity: 1 },
});

const backdropExit = stylex.keyframes({
  from: { opacity: 1 },
  to: { opacity: 0 },
});

const introTimeline = stylex.keyframes({
  "0%": { opacity: 0 },
  "6%": { opacity: 1 },
  "88%": { opacity: 1 },
  "100%": { opacity: 0 },
});

const introSkip = stylex.keyframes({
  from: { opacity: 1, scale: 1, filter: "blur(0)" },
  to: { opacity: 0, scale: 0.98, filter: `blur(${ONBOARDING_SURFACE_EXIT_BLUR})` },
});

const onboardingSurfaceEnter = stylex.keyframes({
  from: {
    opacity: 0,
    scale: ONBOARDING_SURFACE_ENTER_SCALE,
    translate: `0 ${ONBOARDING_SURFACE_ENTER_OFFSET}`,
    filter: `blur(${ONBOARDING_SURFACE_ENTER_BLUR})`,
  },
  to: {
    opacity: 1,
    scale: 1,
    translate: "0 0",
    filter: "blur(0)",
  },
});

const onboardingSurfaceExit = stylex.keyframes({
  from: {
    opacity: 1,
    scale: 1,
    translate: "0 0",
    filter: "blur(0)",
  },
  to: {
    opacity: 0,
    scale: ONBOARDING_SURFACE_EXIT_SCALE,
    translate: "0 -8px",
    filter: `blur(${ONBOARDING_SURFACE_EXIT_BLUR})`,
  },
});

const schemeStyles = stylex.create({
  system: { colorScheme: "light dark" },
  light: { colorScheme: "light" },
  dark: { colorScheme: "dark" },
});

const styles = stylex.create({
  root: {
    position: "fixed",
    inset: 0,
    display: "grid",
    placeItems: "center",
    overflow: "hidden",
    backgroundColor: "transparent",
    outline: "none",
  },
  backdrop: {
    position: "absolute",
    inset: 0,
    overflow: "hidden",
    willChange: "opacity",
  },
  backdropBeforeEnter: {
    opacity: 0,
  },
  backdropEntering: {
    animationName: {
      default: backdropEnter,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    animationDuration: {
      default: ONBOARDING_BACKDROP_ENTER_DURATION,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    animationTimingFunction: motionVars["--honk-motion-ease-out"],
    animationFillMode: "both",
    opacity: {
      default: null,
      "@media (prefers-reduced-motion: reduce)": 1,
    },
  },
  backdropExiting: {
    animationName: {
      default: backdropExit,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    animationDuration: {
      default: ONBOARDING_BACKDROP_EXIT_DURATION,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    animationTimingFunction: motionVars["--honk-motion-ease-in"],
    animationFillMode: "both",
    opacity: {
      default: null,
      "@media (prefers-reduced-motion: reduce)": 0,
    },
  },
  intro: {
    position: "absolute",
    inset: 0,
    animationName: {
      default: introTimeline,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    animationDuration: {
      default: ONBOARDING_INTRO_DURATION,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    animationTimingFunction: "linear",
    animationFillMode: "both",
  },
  introSkipping: {
    animationName: {
      default: introSkip,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    animationDuration: {
      default: ONBOARDING_INTRO_SKIP_DURATION,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    animationTimingFunction: motionVars["--honk-motion-ease-in"],
    animationFillMode: "both",
  },
  skipAction: {
    position: "absolute",
    zIndex: 1,
    right: CONTENT_PAD,
    bottom: CONTENT_PAD,
    color: colorVars["--honk-color-toast-text"],
    backgroundColor: colorVars["--honk-color-toast-subtle"],
  },
  demoStack: {
    position: "relative",
    width: "100%",
    display: "grid",
    justifyItems: "center",
    gap: spaceVars["--honk-space-gutter"],
  },
  demoComposer: {
    boxSizing: "border-box",
    width: "100%",
    minHeight: DEMO_COMPOSER_MIN_HEIGHT,
    display: "grid",
    gap: controlVars["--honk-control-gap"],
    padding: spaceVars["--honk-space-panel-pad"],
    borderRadius: radiusVars["--honk-radius-window"],
    backgroundColor: colorVars["--honk-color-bg-base"],
    boxShadow: `${CARD_RING}, ${elevationVars["--honk-elevation-floating"]}`,
  },
  demoContext: {
    width: "fit-content",
    display: "inline-flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    paddingBlock: controlVars["--honk-control-pad-sm"],
    paddingInline: controlVars["--honk-control-pad-md"],
    borderRadius: radiusVars["--honk-radius-pill"],
    backgroundColor: colorVars["--honk-color-control"],
  },
  demoPromptRow: {
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
  },
  demoPromptText: {
    minWidth: 0,
    maxWidth: DEMO_PROMPT_MAX_WIDTH,
    flexGrow: 1,
    overflow: "hidden",
    whiteSpace: "nowrap",
  },
  demoSend: {
    width: DEMO_SEND_SIZE,
    height: DEMO_SEND_SIZE,
    flexShrink: 0,
    display: "grid",
    placeItems: "center",
    borderRadius: radiusVars["--honk-radius-pill"],
    backgroundColor: colorVars["--honk-color-accent-fill"],
    color: colorVars["--honk-color-on-accent"],
  },
  demoWork: {
    boxSizing: "border-box",
    width: "100%",
    minHeight: DEMO_WORK_MIN_HEIGHT,
    display: "grid",
    alignContent: "center",
    gap: spaceVars["--honk-space-panel-pad"],
    padding: CONTENT_PAD_COMPACT,
    borderRadius: radiusVars["--honk-radius-window"],
    backgroundColor: colorVars["--honk-color-bg-base"],
    boxShadow: `${CARD_RING}, ${elevationVars["--honk-elevation-floating"]}`,
  },
  demoActivity: {
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    paddingInlineStart: DEMO_ACTIVITY_INDENT,
  },
  demoResponse: {
    paddingInlineStart: DEMO_ACTIVITY_INDENT,
  },
  demoChange: {
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    padding: spaceVars["--honk-space-panel-pad"],
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: colorVars["--honk-color-layer-01"],
  },
  demoChangeIcon: {
    width: DEMO_CHANGE_ICON_SIZE,
    height: DEMO_CHANGE_ICON_SIZE,
    display: "grid",
    placeItems: "center",
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: colorVars["--honk-color-accent-subtle"],
  },
  popup: {
    position: "relative",
    zIndex: 1,
    width: {
      default: CARD_WIDTH,
      [COMPACT_MEDIA]: CARD_WIDTH_COMPACT,
    },
    maxWidth: CARD_MAX_WIDTH,
    height: {
      default: CARD_HEIGHT,
      [COMPACT_MEDIA]: CARD_HEIGHT_COMPACT,
    },
    maxHeight: {
      default: CARD_HEIGHT,
      [COMPACT_MEDIA]: CARD_HEIGHT_COMPACT,
    },
    minHeight: 0,
    padding: 0,
    gap: 0,
    display: "flex",
    flexDirection: "column",
    borderRadius: radiusVars["--honk-radius-window"],
    backgroundColor: colorVars["--honk-color-bg-base"],
    boxShadow: `${CARD_RING}, ${elevationVars["--honk-elevation-floating"]}`,
    color: colorVars["--honk-color-text-primary"],
    outline: "none",
    overflow: "hidden",
  },
  popupBeforeEnter: {
    opacity: 0,
    scale: ONBOARDING_SURFACE_ENTER_SCALE,
    translate: `0 ${ONBOARDING_SURFACE_ENTER_OFFSET}`,
    filter: `blur(${ONBOARDING_SURFACE_ENTER_BLUR})`,
  },
  popupEntering: {
    animationName: {
      default: onboardingSurfaceEnter,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    animationDuration: {
      default: ONBOARDING_SURFACE_ENTER_DURATION,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    animationTimingFunction: motionVars["--honk-motion-ease-float"],
    animationFillMode: "both",
  },
  popupExiting: {
    animationName: {
      default: onboardingSurfaceExit,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    animationDuration: {
      default: ONBOARDING_SURFACE_EXIT_DURATION,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    animationTimingFunction: motionVars["--honk-motion-ease-in"],
    animationFillMode: "both",
    opacity: {
      default: null,
      "@media (prefers-reduced-motion: reduce)": 0,
    },
  },
  progressFrame: {
    flexShrink: 0,
    paddingTop: PROGRESS_PAD_TOP,
    paddingInline: {
      default: CONTENT_PAD,
      [COMPACT_MEDIA]: CONTENT_PAD_COMPACT,
    },
  },
  progress: {
    display: "flex",
    gap: PROGRESS_GAP,
    height: PROGRESS_HEIGHT,
  },
  progressSegment: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    borderRadius: radiusVars["--honk-radius-pill"],
    backgroundColor: colorVars["--honk-color-control"],
    transitionProperty: "background-color",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-base"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
  },
  progressSegmentComplete: {
    backgroundColor: colorVars["--honk-color-accent-fill"],
  },
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
      [COMPACT_MEDIA]: "minmax(0, 1fr)",
    },
    overflowY: "auto",
  },
  copy: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    gap: CONTENT_GAP,
    padding: {
      default: CONTENT_PAD,
      [COMPACT_MEDIA]: CONTENT_PAD_COMPACT,
    },
  },
  copyInner: {
    width: "100%",
    maxWidth: COPY_MAX_WIDTH,
    display: "grid",
    gap: spaceVars["--honk-space-panel-pad"],
  },
  eyebrow: {
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
  heading: {
    fontSize: HEADING_SIZE,
    lineHeight: HEADING_LEADING,
  },
  panel: {
    minWidth: 0,
    minHeight: {
      default: 0,
      [COMPACT_MEDIA]: PANEL_MIN_HEIGHT_COMPACT,
    },
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    padding: {
      default: CONTENT_PAD,
      [COMPACT_MEDIA]: CONTENT_PAD_COMPACT,
    },
    backgroundColor: colorVars["--honk-color-layer-01"],
    boxShadow: {
      default: PANEL_HAIRLINE_VERTICAL,
      [COMPACT_MEDIA]: PANEL_HAIRLINE_HORIZONTAL,
    },
  },
  footer: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    paddingBlock: CONTENT_PAD_COMPACT,
    paddingInline: {
      default: CONTENT_PAD,
      [COMPACT_MEDIA]: CONTENT_PAD_COMPACT,
    },
    boxShadow: FOOTER_HAIRLINE,
  },
  footerSpacer: {
    flexGrow: 1,
  },
  featureList: {
    display: "grid",
    gap: CONTENT_PAD_COMPACT,
  },
  featureRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: spaceVars["--honk-space-panel-pad"],
  },
  featureIcon: {
    width: FEATURE_ICON_SIZE,
    height: FEATURE_ICON_SIZE,
    flexShrink: 0,
    display: "grid",
    placeItems: "center",
    borderRadius: radiusVars["--honk-radius-pill"],
    backgroundColor: colorVars["--honk-color-control"],
  },
  featureCopy: {
    minWidth: 0,
    display: "grid",
    gap: controlVars["--honk-control-gap"],
  },
  providerGlyphPair: {
    display: "flex",
    alignItems: "center",
    gap: PROGRESS_GAP,
  },
  centerStack: {
    width: "100%",
    display: "grid",
    justifyItems: "center",
    gap: CONTENT_PAD_COMPACT,
    textAlign: "center",
  },
  folderIcon: {
    width: FOLDER_ICON_SIZE,
    height: FOLDER_ICON_SIZE,
    display: "grid",
    placeItems: "center",
    borderRadius: radiusVars["--honk-radius-pill"],
    backgroundColor: colorVars["--honk-color-control"],
  },
  folderCopy: {
    width: "100%",
    minWidth: 0,
    display: "grid",
    gap: controlVars["--honk-control-gap"],
  },
  path: {
    overflowWrap: "anywhere",
  },
  stack: {
    width: "100%",
    display: "grid",
    gap: spaceVars["--honk-space-panel-pad"],
  },
  tightStack: {
    width: "100%",
    display: "grid",
    gap: controlVars["--honk-control-gap"],
  },
  providerList: {
    width: "100%",
    display: "grid",
    gap: controlVars["--honk-control-gap"],
  },
  providerRow: {
    height: PROVIDER_ROW_HEIGHT,
    paddingInline: spaceVars["--honk-space-panel-pad"],
    backgroundColor: colorVars["--honk-color-bg-base"],
    boxShadow: `inset 0 0 0 ${HAIRLINE} ${colorVars["--honk-color-border-muted"]}`,
  },
  providerRowUnavailable: {
    opacity: 0.5,
    cursor: "default",
  },
  providerStatusRow: {
    width: "100%",
    height: PROVIDER_ROW_HEIGHT,
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    boxSizing: "border-box",
    paddingInline: spaceVars["--honk-space-panel-pad"],
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: colorVars["--honk-color-bg-base"],
    boxShadow: `inset 0 0 0 ${HAIRLINE} ${colorVars["--honk-color-border-muted"]}`,
  },
  providerIcon: {
    width: PROVIDER_ICON_SIZE,
    height: PROVIDER_ICON_SIZE,
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: colorVars["--honk-color-control"],
  },
  providerMeta: {
    display: "inline-flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
  },
  oauthHeading: {
    display: "grid",
    gap: controlVars["--honk-control-gap"],
  },
  oauthActions: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
  },
  waitingRow: {
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
  },
  error: {
    color: colorVars["--honk-color-err-fg"],
  },
});

function subscribeReducedMotion(onStoreChange: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onStoreChange);
  return () => {
    query.removeEventListener("change", onStoreChange);
  };
}

function getReducedMotionSnapshot(): boolean {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function useReducedMotion(): boolean {
  return React.useSyncExternalStore(subscribeReducedMotion, getReducedMotionSnapshot, () => false);
}

function WorkspaceDemo(): React.ReactElement {
  return (
    <div aria-hidden={true} {...stylex.props(styles.demoStack)}>
      <div {...stylex.props(styles.demoComposer)}>
        <span {...stylex.props(styles.demoContext)}>
          <Icon icon={IconFileBend} size="xs" tone="muted" />
          <Text size="xs" tone="muted" family="mono">
            desktop-window.ts
          </Text>
        </span>
        <div {...stylex.props(styles.demoPromptRow)}>
          <Text size="base" xstyle={styles.demoPromptText}>
            Animate the first-run onboarding flow
          </Text>
          <span {...stylex.props(styles.demoSend)}>
            <Icon icon={IconArrowUp} size="sm" />
          </span>
        </div>
      </div>

      <div {...stylex.props(styles.demoWork)}>
        <div {...stylex.props(styles.demoActivity)}>
          <Matrix isActive grid={4} />
          <Text size="sm" tone="muted">
            Explored
          </Text>
          <Text size="sm" tone="faint" family="mono">
            Electron window lifecycle
          </Text>
        </div>
        <div {...stylex.props(styles.demoActivity)}>
          <Matrix isActive grid={4} />
          <Text size="sm" tone="muted">
            Edited
          </Text>
          <Text size="sm" tone="faint" family="mono">
            onboarding.tsx
          </Text>
        </div>
        <Text as="p" size="base" xstyle={styles.demoResponse}>
          The setup window now hands off only after Honk is ready.
        </Text>
        <div {...stylex.props(styles.demoChange)}>
          <span {...stylex.props(styles.demoChangeIcon)}>
            <Icon icon={IconChanges} size="sm" tone="accent" />
          </span>
          <div {...stylex.props(styles.featureCopy)}>
            <Text size="sm" weight="semibold">
              Changes ready to review
            </Text>
            <Text size="xs" tone="faint" family="mono">
              3 files changed · +86 −14
            </Text>
          </div>
        </div>
      </div>
    </div>
  );
}

function OnboardingIntro({
  phase,
  onSkip,
  onFinished,
}: {
  readonly phase: Exclude<OnboardingIntroPhase, "complete">;
  readonly onSkip: () => void;
  readonly onFinished: () => void;
}): React.ReactElement {
  return (
    <div
      {...stylex.props(styles.intro, phase === "skipping" && styles.introSkipping)}
      onAnimationEnd={(event) => {
        if (event.currentTarget === event.target) {
          onFinished();
        }
      }}
    >
      <Button size="sm" variant="ghost" xstyle={styles.skipAction} onClick={onSkip}>
        Skip intro
      </Button>
    </div>
  );
}

function StepProgress({ step }: { readonly step: OnboardingStep }): React.ReactElement {
  const currentIndex = STEP_ORDER.indexOf(step);
  return (
    <div {...stylex.props(styles.progressFrame)}>
      <div
        {...stylex.props(styles.progress)}
        role="progressbar"
        aria-label="Onboarding progress"
        aria-valuemin={1}
        aria-valuemax={STEP_ORDER.length}
        aria-valuenow={currentIndex + 1}
      >
        {STEP_ORDER.map((value, index) => (
          <span
            key={value}
            {...stylex.props(
              styles.progressSegment,
              index <= currentIndex && styles.progressSegmentComplete,
            )}
          />
        ))}
      </div>
    </div>
  );
}

function StageCopy({
  step,
  title,
  children,
}: {
  readonly step: OnboardingStep;
  readonly title: string;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <section {...stylex.props(styles.copy)}>
      <div {...stylex.props(styles.copyInner)}>
        <Text as="p" size="xs" tone="faint" weight="semibold" xstyle={styles.eyebrow}>
          Setup {STEP_ORDER.indexOf(step) + 1} of {STEP_ORDER.length}
        </Text>
        <Text
          as="div"
          role="heading"
          aria-level={1}
          size="xl"
          weight="semibold"
          xstyle={styles.heading}
        >
          {title}
        </Text>
        {children}
      </div>
    </section>
  );
}

function FeatureRow({
  icon,
  title,
  description,
}: {
  readonly icon: React.ReactNode;
  readonly title: string;
  readonly description: string;
}): React.ReactElement {
  return (
    <div {...stylex.props(styles.featureRow)}>
      <span {...stylex.props(styles.featureIcon)}>{icon}</span>
      <div {...stylex.props(styles.featureCopy)}>
        <Text as="p" size="base" weight="semibold">
          {title}
        </Text>
        <Text as="p" size="sm" tone="muted">
          {description}
        </Text>
      </div>
    </div>
  );
}

function WelcomeStep({ onContinue }: { readonly onContinue: () => void }): React.ReactElement {
  return (
    <div {...stylex.props(styles.stage)}>
      <div {...stylex.props(styles.body)}>
        <StageCopy step="welcome" title="Welcome to Honk">
          <Text as="p" size="base" tone="muted">
            Give Codex and Claude one focused workspace for your code.
          </Text>
          <div {...stylex.props(styles.featureList)}>
            <FeatureRow
              icon={<Icon icon={IconFolderOpen} size="md" tone="muted" />}
              title="Work in your projects"
              description="Start every task with the right local context."
            />
            <FeatureRow
              icon={
                <span {...stylex.props(styles.providerGlyphPair)}>
                  <Icon icon={IconOpenaiCodex} size="sm" tone="muted" />
                  <Icon icon={IconClawd} size="sm" tone="muted" />
                </span>
              }
              title="Use your existing setup"
              description="Connect Codex or use the Claude Code session on this Mac."
            />
            <FeatureRow
              icon={<Icon icon={IconConsole} size="md" tone="muted" />}
              title="Keep the work together"
              description="Threads, files, changes, and terminals stay in one window."
            />
          </div>
        </StageCopy>
        <section {...stylex.props(styles.panel)} aria-label="Honk workspace preview">
          <WorkspaceDemo />
        </section>
      </div>
      <div {...stylex.props(styles.footer)}>
        <Button autoFocus size="lg" variant="primary" onClick={onContinue}>
          Let&apos;s go
        </Button>
      </div>
    </div>
  );
}

function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter((part) => part.length > 0);
  return parts.at(-1) ?? path;
}

function LocationStep({
  onBack,
  onContinue,
}: {
  readonly onBack: () => void;
  readonly onContinue: () => void;
}): React.ReactElement {
  const appSettings = useAppSettings();
  const directory = appSettings.defaultProjectDirectory;
  const [isPicking, setIsPicking] = React.useState(false);

  const chooseFolder = (): void => {
    if (isPicking) {
      return;
    }
    setIsPicking(true);
    void pickFolder(directory)
      .then((selectedPath) => {
        if (selectedPath !== null) {
          appSettingsActions.setDefaultProjectDirectory(selectedPath);
        }
      })
      .finally(() => {
        setIsPicking(false);
      });
  };

  return (
    <div {...stylex.props(styles.stage)}>
      <div {...stylex.props(styles.body)}>
        <StageCopy step="location" title="Choose a default project folder">
          <Text as="p" size="base" tone="muted">
            New tasks start here unless you choose another folder in the composer. Honk reads and
            edits files there only when a task asks it to.
          </Text>
          <Text as="p" size="sm" tone="faint">
            The system folder picker confirms the location before Honk saves it.
          </Text>
        </StageCopy>
        <section {...stylex.props(styles.panel)} aria-label="Default project folder">
          <div {...stylex.props(styles.centerStack)}>
            <span {...stylex.props(styles.folderIcon)}>
              <Icon
                icon={IconFolderOpen}
                size="xl"
                tone={directory === null ? "muted" : "accent"}
              />
            </span>
            <div {...stylex.props(styles.folderCopy)}>
              <Text as="p" size="base" weight="semibold">
                {directory === null ? "No folder selected" : folderName(directory)}
              </Text>
              <Text as="p" size="sm" tone="muted" family="mono" xstyle={styles.path}>
                {directory ?? "Choose the folder you use for projects."}
              </Text>
            </div>
            <Button
              autoFocus={directory === null}
              size="md"
              variant="secondary"
              disabled={isPicking}
              onClick={chooseFolder}
            >
              {isPicking
                ? "Opening picker…"
                : directory === null
                  ? "Choose folder…"
                  : "Choose a different folder…"}
            </Button>
          </div>
        </section>
      </div>
      <div {...stylex.props(styles.footer)}>
        <Button size="md" variant="ghost" onClick={onBack}>
          Back
        </Button>
        <span {...stylex.props(styles.footerSpacer)} />
        <Button
          autoFocus={directory !== null}
          size="md"
          variant="primary"
          disabled={directory === null || isPicking}
          onClick={onContinue}
        >
          Continue
        </Button>
      </div>
    </div>
  );
}

type ProviderLoad =
  | { readonly phase: "loading" }
  | { readonly phase: "error"; readonly message: string }
  | { readonly phase: "ready"; readonly inventory: ProviderInventory };

type ProviderOAuthFlow =
  | { readonly kind: "idle" }
  | {
      readonly kind: "methods";
      readonly providerId: OAuthProviderId;
      readonly methods: readonly SidecarProviderAuthMethod[];
    }
  | {
      readonly kind: "inputs";
      readonly providerId: OAuthProviderId;
      readonly method: SidecarProviderAuthMethod;
      readonly inputs: Readonly<Record<string, string>>;
      readonly promptIndex: number;
    }
  | {
      readonly kind: "starting";
      readonly providerId: OAuthProviderId;
      readonly methodLabel: string;
    }
  | {
      readonly kind: "code";
      readonly providerId: OAuthProviderId;
      readonly methodIndex: number;
      readonly url: string;
      readonly instructions: string;
    }
  | {
      readonly kind: "waiting";
      readonly providerId: OAuthProviderId;
      readonly url: string;
      readonly instructions: string;
    };

function providerDefinition(providerId: AuthProviderId): AuthProviderDefinition {
  return AUTH_PROVIDERS.find((provider) => provider.id === providerId) ?? AUTH_PROVIDERS[0]!;
}

function inventoryProvider(
  inventory: ProviderInventory,
  providerId: AuthProviderId,
): SidecarProvider | null {
  return inventory.providers.find((provider) => provider.id === providerId) ?? null;
}

function isProviderAuthPromptVisible(
  prompt: SidecarProviderAuthPrompt,
  inputs: Readonly<Record<string, string>>,
): boolean {
  if (prompt.when === undefined) {
    return true;
  }
  const current = inputs[prompt.when.key];
  if (current === undefined) {
    return false;
  }
  return prompt.when.op === "eq" ? current === prompt.when.value : current !== prompt.when.value;
}

function nextProviderAuthPromptIndex(
  method: SidecarProviderAuthMethod,
  start: number,
  inputs: Readonly<Record<string, string>>,
): number | null {
  for (let index = start; index < method.prompts.length; index += 1) {
    const prompt = method.prompts[index];
    if (prompt !== undefined && isProviderAuthPromptVisible(prompt, inputs)) {
      return index;
    }
  }
  return null;
}

function requireClient(): NonNullable<ReturnType<typeof getBoundHonkClient>> {
  const client = getBoundHonkClient();
  if (client === null) {
    throw new Error("Honk is not connected to its local engine yet.");
  }
  return client;
}

async function readProviderInventory(): Promise<ProviderInventory> {
  return requireClient().listProviders();
}

function openAuthorizationPage(url: string): void {
  if (url.length > 0) {
    window.open(url, "_blank", "noopener");
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function ProviderStatusList({
  inventory,
  onConnectCodex,
}: {
  readonly inventory: ProviderInventory;
  readonly onConnectCodex: () => void;
}): React.ReactElement {
  return (
    <div {...stylex.props(styles.providerList)}>
      {AUTH_PROVIDERS.map((definition) => {
        const provider = inventoryProvider(inventory, definition.id);
        const oauthMethods =
          provider?.authMethods.filter((method) => method.type === "oauth") ?? [];
        const isManagedClaude = definition.id === "anthropic";
        const isConnected = provider?.connected === true;
        const canConnectCodex = !isManagedClaude && !isConnected && oauthMethods.length > 0;
        const status = isConnected
          ? isManagedClaude
            ? "Managed locally"
            : "Connected"
          : canConnectCodex
            ? "Sign in"
            : "Unavailable";
        const content = (
          <>
            <ListRow.Slot xstyle={styles.providerIcon}>
              <Icon icon={definition.icon} size="md" tone="muted" />
            </ListRow.Slot>
            <ListRow.Title>{definition.label}</ListRow.Title>
            <ListRow.Subtitle>{definition.accountLabel}</ListRow.Subtitle>
            <ListRow.Meta>
              <span {...stylex.props(styles.providerMeta)}>
                {isConnected ? <Icon icon={IconCheckmark1} size="xs" tone="ok" /> : null}
                {status}
              </span>
            </ListRow.Meta>
          </>
        );

        if (!canConnectCodex) {
          return (
            <div
              key={definition.id}
              {...stylex.props(
                styles.providerStatusRow,
                !isConnected && styles.providerRowUnavailable,
              )}
            >
              {content}
            </div>
          );
        }

        return (
          <ListRow key={definition.id} xstyle={styles.providerRow} onClick={onConnectCodex}>
            {content}
          </ListRow>
        );
      })}
    </div>
  );
}

function OAuthFlowPanel({
  flow,
  textInputRef,
  codeInputRef,
  onChooseMethod,
  onSubmitPrompt,
  onCompleteCode,
}: {
  readonly flow: Exclude<ProviderOAuthFlow, { readonly kind: "idle" }>;
  readonly textInputRef: React.RefObject<HTMLInputElement | null>;
  readonly codeInputRef: React.RefObject<HTMLInputElement | null>;
  readonly onChooseMethod: (providerId: OAuthProviderId, method: SidecarProviderAuthMethod) => void;
  readonly onSubmitPrompt: (value: string) => void;
  readonly onCompleteCode: () => void;
}): React.ReactElement {
  const definition = providerDefinition(flow.providerId);

  if (flow.kind === "methods") {
    return (
      <div {...stylex.props(styles.stack)}>
        <div {...stylex.props(styles.oauthHeading)}>
          <Text as="p" size="base" weight="semibold">
            Sign in to {definition.label}
          </Text>
          <Text as="p" size="sm" tone="muted">
            Choose the OAuth method you want to use.
          </Text>
        </div>
        <div {...stylex.props(styles.providerList)}>
          {flow.methods.map((method, index) => (
            <ListRow
              key={method.index}
              autoFocus={index === 0}
              xstyle={styles.providerRow}
              onClick={() => {
                onChooseMethod(flow.providerId, method);
              }}
            >
              <ListRow.Slot xstyle={styles.providerIcon}>
                <Icon icon={definition.icon} size="md" tone="muted" />
              </ListRow.Slot>
              <ListRow.Title>{method.label}</ListRow.Title>
            </ListRow>
          ))}
        </div>
      </div>
    );
  }

  if (flow.kind === "inputs") {
    const prompt = flow.method.prompts[flow.promptIndex];
    if (prompt === undefined) {
      return (
        <Text as="p" size="sm" tone="muted">
          This OAuth method did not provide its next prompt.
        </Text>
      );
    }
    return (
      <div {...stylex.props(styles.stack)}>
        <div {...stylex.props(styles.oauthHeading)}>
          <Text as="p" size="base" weight="semibold">
            {flow.method.label}
          </Text>
          <Text as="p" size="sm" tone="muted">
            {prompt.message}
          </Text>
        </div>
        {prompt.type === "text" ? (
          <div {...stylex.props(styles.tightStack)}>
            <Field size="lg">
              <Field.Input
                key={`${flow.method.index}:${prompt.key}`}
                ref={textInputRef}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                placeholder={prompt.placeholder ?? "Required…"}
                aria-label={prompt.message}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    onSubmitPrompt(textInputRef.current?.value ?? "");
                  }
                }}
              />
            </Field>
            <div {...stylex.props(styles.oauthActions)}>
              <Button
                size="md"
                variant="primary"
                onClick={() => {
                  onSubmitPrompt(textInputRef.current?.value ?? "");
                }}
              >
                Continue
              </Button>
            </div>
          </div>
        ) : (
          <div {...stylex.props(styles.providerList)}>
            {prompt.options.map((option, index) => (
              <ListRow
                key={option.value}
                autoFocus={index === 0}
                xstyle={styles.providerRow}
                onClick={() => {
                  onSubmitPrompt(option.value);
                }}
              >
                <ListRow.Title>{option.label}</ListRow.Title>
                {option.hint === undefined ? null : (
                  <ListRow.Subtitle>{option.hint}</ListRow.Subtitle>
                )}
              </ListRow>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (flow.kind === "code") {
    return (
      <div {...stylex.props(styles.stack)}>
        <div {...stylex.props(styles.oauthHeading)}>
          <Text as="p" size="base" weight="semibold">
            Finish signing in to {definition.label}
          </Text>
          <Text as="p" size="sm" tone="muted">
            {flow.instructions}
          </Text>
        </div>
        <Field size="lg">
          <Field.Input
            ref={codeInputRef}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste authorization code…"
            aria-label={`${definition.label} authorization code`}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                onCompleteCode();
              }
            }}
          />
        </Field>
        <div {...stylex.props(styles.oauthActions)}>
          <Button size="md" variant="primary" onClick={onCompleteCode}>
            Complete sign-in
          </Button>
          {flow.url.length > 0 ? (
            <Button
              size="md"
              variant="ghost"
              onClick={() => {
                openAuthorizationPage(flow.url);
              }}
            >
              Open browser again
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div {...stylex.props(styles.stack)}>
      <div {...stylex.props(styles.waitingRow)}>
        <Spinner size="md" />
        <Text as="p" size="base" weight="semibold">
          {flow.kind === "starting" ? `Starting ${flow.methodLabel}…` : "Waiting for your browser…"}
        </Text>
      </div>
      {flow.kind === "waiting" ? (
        <>
          <Text as="p" size="sm" tone="muted">
            {flow.instructions}
          </Text>
          {flow.url.length > 0 ? (
            <div {...stylex.props(styles.oauthActions)}>
              <Button
                size="md"
                variant="ghost"
                onClick={() => {
                  openAuthorizationPage(flow.url);
                }}
              >
                Open browser again
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <Text as="p" size="sm" tone="muted">
          Honk is asking the local engine to prepare the OAuth flow.
        </Text>
      )}
    </div>
  );
}

function ProviderStep({
  onBack,
  onComplete,
  isCompleting,
  completionError,
}: {
  readonly onBack: () => void;
  readonly onComplete: () => void;
  readonly isCompleting: boolean;
  readonly completionError: string | null;
}): React.ReactElement {
  const [load, setLoad] = React.useState<ProviderLoad>({ phase: "loading" });
  const [flow, setFlow] = React.useState<ProviderOAuthFlow>({ kind: "idle" });
  const [authError, setAuthError] = React.useState<string | null>(null);
  const loadSequence = React.useRef(0);
  const authSequence = React.useRef(0);
  const loadStarted = React.useRef(false);
  const textInputRef = React.useRef<HTMLInputElement>(null);
  const codeInputRef = React.useRef<HTMLInputElement>(null);

  const refresh = (): void => {
    const sequence = ++loadSequence.current;
    setLoad({ phase: "loading" });
    void readProviderInventory()
      .then((inventory) => {
        if (loadSequence.current === sequence) {
          setLoad({ phase: "ready", inventory });
        }
      })
      .catch((cause: unknown) => {
        if (loadSequence.current === sequence) {
          setLoad({ phase: "error", message: errorMessage(cause) });
        }
      });
  };

  const loadOnMount = (node: HTMLDivElement | null): void => {
    if (node !== null && !loadStarted.current) {
      loadStarted.current = true;
      refresh();
    }
  };

  const finishAuthentication = async (
    providerId: OAuthProviderId,
    sequence: number,
  ): Promise<void> => {
    const inventory = await readProviderInventory();
    if (authSequence.current !== sequence) {
      return;
    }
    const provider = inventoryProvider(inventory, providerId);
    if (provider?.connected !== true) {
      throw new Error(
        `${providerDefinition(providerId).label} did not report a connected account.`,
      );
    }
    loadSequence.current += 1;
    setLoad({ phase: "ready", inventory });
    setFlow({ kind: "idle" });
  };

  const failAuthentication = (cause: unknown, sequence: number): void => {
    if (authSequence.current !== sequence) {
      return;
    }
    setFlow({ kind: "idle" });
    setAuthError(errorMessage(cause));
  };

  const startOauth = (
    providerId: OAuthProviderId,
    method: SidecarProviderAuthMethod,
    inputs: Readonly<Record<string, string>>,
  ): void => {
    const sequence = ++authSequence.current;
    setAuthError(null);
    setFlow({ kind: "starting", providerId, methodLabel: method.label });
    void (async () => {
      const client = requireClient();
      const authorization = await client.authorizeProviderOauth(providerId, method.index, inputs);
      if (authSequence.current !== sequence) {
        return;
      }
      openAuthorizationPage(authorization.url);
      if (authorization.method === "code") {
        setFlow({
          kind: "code",
          providerId,
          methodIndex: method.index,
          url: authorization.url,
          instructions: authorization.instructions,
        });
        return;
      }
      setFlow({
        kind: "waiting",
        providerId,
        url: authorization.url,
        instructions: authorization.instructions,
      });
      await client.completeProviderOauth(providerId, method.index);
      await finishAuthentication(providerId, sequence);
    })().catch((cause: unknown) => {
      failAuthentication(cause, sequence);
    });
  };

  const beginOauth = (providerId: OAuthProviderId, method: SidecarProviderAuthMethod): void => {
    const inputs: Readonly<Record<string, string>> = {};
    const promptIndex = nextProviderAuthPromptIndex(method, 0, inputs);
    setAuthError(null);
    if (promptIndex === null) {
      startOauth(providerId, method, inputs);
      return;
    }
    setFlow({ kind: "inputs", providerId, method, inputs, promptIndex });
  };

  const connectCodex = (): void => {
    if (load.phase !== "ready") {
      return;
    }
    const providerId: OAuthProviderId = "openai";
    const provider = inventoryProvider(load.inventory, providerId);
    if (provider === null) {
      setAuthError("Codex is unavailable from the local engine.");
      return;
    }
    if (provider.connected) {
      setAuthError(null);
      setFlow({ kind: "idle" });
      return;
    }
    const oauthMethods = provider.authMethods.filter((method) => method.type === "oauth");
    if (oauthMethods.length === 0) {
      setAuthError(`${providerDefinition(providerId).label} did not provide an OAuth method.`);
      return;
    }
    if (oauthMethods.length === 1) {
      beginOauth(providerId, oauthMethods[0]!);
      return;
    }
    setAuthError(null);
    setFlow({ kind: "methods", providerId, methods: oauthMethods });
  };

  const submitPrompt = (value: string): void => {
    if (flow.kind !== "inputs") {
      return;
    }
    const prompt = flow.method.prompts[flow.promptIndex];
    const normalized = value.trim();
    if (prompt === undefined || normalized.length === 0) {
      return;
    }
    const inputs = { ...flow.inputs, [prompt.key]: normalized };
    const promptIndex = nextProviderAuthPromptIndex(flow.method, flow.promptIndex + 1, inputs);
    if (promptIndex === null) {
      startOauth(flow.providerId, flow.method, inputs);
      return;
    }
    setFlow({ ...flow, inputs, promptIndex });
  };

  const completeCode = (): void => {
    if (flow.kind !== "code") {
      return;
    }
    const code = codeInputRef.current?.value.trim() ?? "";
    if (code.length === 0) {
      return;
    }
    const sequence = authSequence.current;
    const { providerId, methodIndex, url, instructions } = flow;
    setAuthError(null);
    setFlow({ kind: "waiting", providerId, url, instructions });
    void (async () => {
      await requireClient().completeProviderOauth(providerId, methodIndex, code);
      await finishAuthentication(providerId, sequence);
    })().catch((cause: unknown) => {
      failAuthentication(cause, sequence);
    });
  };

  const cancelAuth = (): void => {
    authSequence.current += 1;
    setAuthError(null);
    setFlow({ kind: "idle" });
  };

  return (
    <div ref={loadOnMount} {...stylex.props(styles.stage)}>
      <div {...stylex.props(styles.body)}>
        <StageCopy step="provider" title="Set up coding accounts">
          <Text as="p" size="base" tone="muted">
            Codex signs in through your browser. Claude uses the Claude Code session already on this
            Mac, so Honk never asks for an Anthropic API key.
          </Text>
          <Text as="p" size="sm" tone="faint">
            Codex sign-in is optional and remains available later in Settings.
          </Text>
        </StageCopy>
        <section {...stylex.props(styles.panel)} aria-label="Coding accounts">
          <div {...stylex.props(styles.stack)}>
            {load.phase === "loading" ? (
              <div {...stylex.props(styles.waitingRow)}>
                <Spinner size="md" />
                <Text as="p" size="sm" tone="muted">
                  Checking Codex and Claude…
                </Text>
              </div>
            ) : load.phase === "error" ? (
              <div {...stylex.props(styles.stack)}>
                <Text as="p" role="alert" size="sm" xstyle={styles.error}>
                  {load.message}
                </Text>
                <div {...stylex.props(styles.oauthActions)}>
                  <Button autoFocus size="md" variant="secondary" onClick={refresh}>
                    Retry
                  </Button>
                </div>
              </div>
            ) : flow.kind === "idle" ? (
              <ProviderStatusList inventory={load.inventory} onConnectCodex={connectCodex} />
            ) : (
              <OAuthFlowPanel
                flow={flow}
                textInputRef={textInputRef}
                codeInputRef={codeInputRef}
                onChooseMethod={beginOauth}
                onSubmitPrompt={submitPrompt}
                onCompleteCode={completeCode}
              />
            )}
            {authError === null ? null : (
              <Text as="p" role="alert" size="sm" xstyle={styles.error}>
                {authError}
              </Text>
            )}
            {completionError === null ? null : (
              <Text as="p" role="alert" size="sm" xstyle={styles.error}>
                {completionError}
              </Text>
            )}
          </div>
        </section>
      </div>
      <div {...stylex.props(styles.footer)}>
        <Button size="md" variant="ghost" onClick={flow.kind === "idle" ? onBack : cancelAuth}>
          {flow.kind === "idle" ? "Back" : "Cancel"}
        </Button>
        <span {...stylex.props(styles.footerSpacer)} />
        {flow.kind === "idle" ? (
          <Button
            autoFocus
            size="md"
            variant="primary"
            disabled={isCompleting}
            onClick={onComplete}
          >
            {isCompleting ? "Opening Honk…" : "Start using Honk"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function DesktopOnboarding({
  isReplay = false,
}: {
  readonly isReplay?: boolean;
}): React.ReactElement {
  const theme = useAppearanceTheme();
  const isReducedMotion = useReducedMotion();
  const [step, setStep] = React.useState<OnboardingStep>("welcome");
  const [introPhase, setIntroPhase] = React.useState<OnboardingIntroPhase>("running");
  const [exitMode, setExitMode] = React.useState<OnboardingExitMode | null>(null);
  const [isCompleting, setIsCompleting] = React.useState(false);
  const [completionError, setCompletionError] = React.useState<string | null>(null);
  const isWindowShown = React.useSyncExternalStore(
    subscribeOnboardingWindowShown,
    getOnboardingWindowShownSnapshot,
    () => false,
  );
  const isIntroComplete = isReducedMotion || introPhase === "complete";
  const shouldShowCard = isWindowShown && isIntroComplete;

  const focusRoot = React.useCallback((node: HTMLDivElement | null): void => {
    node?.focus({ preventScroll: true });
  }, []);

  const finishExit = (mode: OnboardingExitMode): void => {
    const request = mode === "complete" ? finishDesktopOnboarding() : dismissDesktopOnboarding();
    void request.catch((cause: unknown) => {
      setExitMode(null);
      setIsCompleting(false);
      setCompletionError(errorMessage(cause));
    });
  };

  const beginExit = (mode: OnboardingExitMode): void => {
    if (exitMode !== null) {
      return;
    }
    setExitMode(mode);
    if (isReducedMotion) {
      queueMicrotask(() => {
        finishExit(mode);
      });
    }
  };

  const completeOnboarding = (): void => {
    if (isCompleting || exitMode !== null) {
      return;
    }
    setCompletionError(null);
    setIsCompleting(true);
    void completeDesktopOnboarding()
      .then(() => {
        beginExit("complete");
      })
      .catch((cause: unknown) => {
        setIsCompleting(false);
        setCompletionError(errorMessage(cause));
      });
  };

  return (
    <div
      ref={focusRoot}
      tabIndex={-1}
      {...stylex.props(styles.root, schemeStyles[theme])}
      onKeyDown={(event) => {
        if (event.key === "Escape" && isReplay && exitMode === null) {
          event.preventDefault();
          beginExit("dismiss");
        }
      }}
    >
      <div
        aria-hidden={true}
        {...stylex.props(
          styles.backdrop,
          exitMode !== null
            ? styles.backdropExiting
            : isWindowShown
              ? styles.backdropEntering
              : styles.backdropBeforeEnter,
        )}
        onAnimationEnd={(event) => {
          if (event.currentTarget === event.target && exitMode !== null) {
            finishExit(exitMode);
          }
        }}
      >
        <OnboardingMist theme={theme} />
      </div>

      {isWindowShown && !isReducedMotion && introPhase !== "complete" ? (
        <OnboardingIntro
          phase={exitMode !== null ? "skipping" : introPhase}
          onSkip={() => {
            if (exitMode === null) {
              setIntroPhase("skipping");
            }
          }}
          onFinished={() => {
            if (exitMode === null) {
              setIntroPhase("complete");
            }
          }}
        />
      ) : null}

      {shouldShowCard ? (
        <section
          role="dialog"
          aria-modal={true}
          aria-label="Set up Honk"
          {...stylex.props(
            styles.popup,
            exitMode !== null ? styles.popupExiting : styles.popupEntering,
          )}
        >
          <StepProgress step={step} />
          {step === "welcome" ? (
            <WelcomeStep
              onContinue={() => {
                setStep("location");
              }}
            />
          ) : step === "location" ? (
            <LocationStep
              onBack={() => {
                setStep("welcome");
              }}
              onContinue={() => {
                setStep("provider");
              }}
            />
          ) : (
            <ProviderStep
              onBack={() => {
                setStep("location");
              }}
              onComplete={completeOnboarding}
              isCompleting={isCompleting}
              completionError={completionError}
            />
          )}
        </section>
      ) : null}
    </div>
  );
}

export { DesktopOnboarding };
