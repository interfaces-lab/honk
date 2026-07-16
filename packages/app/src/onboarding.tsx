// First-run desktop onboarding in a transparent fullscreen Electron window.
// Native folder picking stays desktop-owned; provider inventory comes from OpenCode.

import * as stylex from "@stylexjs/stylex";
import { Button, Icon, Text } from "@honk/ui";
import { IconClawd, IconConsole, IconFolderOpen, IconOpenaiCodex } from "@honk/ui/icons";
import {
  colorVars,
  controlVars,
  elevationVars,
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
import { errorMessage } from "./error-message";
import { OnboardingIntro, useReducedMotion, WorkspaceDemo } from "./onboarding-demo";
import { OnboardingMist } from "./onboarding-mist";
import { OnboardingProvider } from "./onboarding-provider";

type OnboardingStep = "welcome" | "location" | "provider";
type OnboardingIntroPhase = "running" | "skipping" | "complete";
type OnboardingExitMode = "complete" | "dismiss";

const STEP_ORDER: readonly OnboardingStep[] = ["welcome", "location", "provider"];

// Fixed modal proportions. Paint and type still use tokens.
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
const FOLDER_ICON_SIZE = "48px";
const PROVIDER_ROW_HEIGHT = "60px";
const PANEL_MIN_HEIGHT_COMPACT = "220px";
const STEP_ENTER_OFFSET = "4px";
// Rain film runs five seconds before setup becomes interactive.
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
const ONBOARDING_SURFACE_EXIT_OFFSET = "-8px";
const ONBOARDING_SURFACE_EXIT_BLUR = "4px";
const DEMO_COMPOSER_MIN_HEIGHT = "72px";
const DEMO_WORK_MIN_HEIGHT = "178px";
// Demo sizes mirror the live composer and thread so the preview reads as the real app.
const DEMO_COMPOSER_PAD = "16px";
const DEMO_COMPOSER_FOOTER_HEIGHT = "44px";
const DEMO_SEND_SIZE = "24px";

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
    translate: `0 ${ONBOARDING_SURFACE_EXIT_OFFSET}`,
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
  introSkip: {
    position: "absolute",
    zIndex: 1,
    right: CONTENT_PAD,
    bottom: CONTENT_PAD,
  },
  demoStack: {
    position: "relative",
    width: "100%",
    display: "grid",
    justifyItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    // Decorative. Must not intercept the real onboarding controls.
    pointerEvents: "none",
  },
  demoComposer: {
    boxSizing: "border-box",
    width: "100%",
    minHeight: DEMO_COMPOSER_MIN_HEIGHT,
    display: "flex",
    flexDirection: "column",
    borderRadius: radiusVars["--honk-radius-panel"],
    backgroundColor: colorVars["--honk-color-bg-base"],
    boxShadow: elevationVars["--honk-elevation-raised"],
  },
  demoEditor: {
    paddingInline: DEMO_COMPOSER_PAD,
    paddingTop: DEMO_COMPOSER_PAD,
    paddingBottom: spaceVars["--honk-space-gutter"],
  },
  demoComposerFooter: {
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    height: DEMO_COMPOSER_FOOTER_HEIGHT,
    paddingInline: DEMO_COMPOSER_PAD,
  },
  demoLocationChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    height: controlVars["--honk-control-h-sm"],
    paddingInline: spaceVars["--honk-space-gutter"],
    borderRadius: radiusVars["--honk-radius-pill"],
    color: colorVars["--honk-color-text-faint"],
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
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    gap: spaceVars["--honk-space-gutter"],
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
    boxShadow: elevationVars["--honk-elevation-floating"],
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
    boxShadow: elevationVars["--honk-elevation-raised"],
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
});

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
        <Text
          as="p"
          size="xs"
          tone="faint"
          weight="semibold"
          style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}
        >
          Setup {STEP_ORDER.indexOf(step) + 1} of {STEP_ORDER.length}
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
        <span {...stylex.props(styles.footerSpacer)} />
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
              <Text
                as="p"
                size="sm"
                tone="muted"
                family="mono"
                style={{ overflowWrap: "anywhere" }}
              >
                {directory ?? "Choose the folder you use for projects."}
              </Text>
            </div>
            <Button
              autoFocus={directory === null}
              size="md"
              variant="neutral"
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
        <Button size="md" variant="quiet" onClick={onBack}>
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
            <OnboardingProvider
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
