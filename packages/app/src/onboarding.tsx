// First-run desktop onboarding in a transparent fullscreen Electron window.
// Native folder picking stays desktop-owned; provider inventory comes from OpenCode.
//
// Step interiors follow one system: the copy column owns the decision (prose,
// action block, alerts), the stage panel owns the consequence (a live miniature
// of the composer from onboarding-demo.tsx). Nothing in a stage is interactive.

import * as stylex from "@stylexjs/stylex";
import { Button, Text } from "@honk/ui";
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
import {
  LocationDemo,
  OnboardingIntro,
  QueueDemo,
  useReducedMotion,
  WelcomeDemo,
} from "./onboarding-demo";
import { OnboardingMist } from "./onboarding-mist";
import { OnboardingProviderStep } from "./onboarding-provider";
import {
  ONBOARDING_COMPACT_MEDIA,
  ONBOARDING_CONTENT_PAD,
  ONBOARDING_CONTENT_PAD_COMPACT,
  ONBOARDING_STEP_ORDER,
  OnboardingFact,
  OnboardingFactList,
  OnboardingStepCopy,
  OnboardingStepPanel,
  onboardingStepStyles,
  type OnboardingStep,
} from "./onboarding-step";

type OnboardingIntroPhase = "running" | "skipping" | "complete";
type OnboardingExitMode = "complete" | "dismiss";

// Fixed modal proportions. Paint and type still use tokens.
const CARD_HEIGHT = "min(640px, calc(100dvh - 48px))";
const CARD_HEIGHT_COMPACT = "calc(100dvh - 24px)";
const PROGRESS_GAP = "4px";
const PROGRESS_PAD_TOP = "24px";
const ONBOARDING_BACKDROP_ENTER_DURATION = "1.25s";
const ONBOARDING_BACKDROP_EXIT_DURATION = "620ms";
const ONBOARDING_SURFACE_ENTER_DURATION = "820ms";
const ONBOARDING_SURFACE_EXIT_DURATION = "520ms";
const ONBOARDING_SURFACE_ENTER_SCALE = 0.92;
const ONBOARDING_SURFACE_ENTER_OFFSET = "24px";
const ONBOARDING_SURFACE_ENTER_BLUR = "8px";
const ONBOARDING_SURFACE_EXIT_BLUR = "4px";

const backdropEnter = stylex.keyframes({
  from: { opacity: 0 },
  to: { opacity: 1 },
});

const backdropExit = stylex.keyframes({
  from: { opacity: 1 },
  to: { opacity: 0 },
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
    scale: 0.97,
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
      // oxlint-disable-next-line honk/design-no-raw-values -- 1.25s backdrop fade-in is a bespoke onboarding cadence, no motion-duration token matches
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
      // oxlint-disable-next-line honk/design-no-raw-values -- 620ms backdrop fade-out is a bespoke onboarding cadence, no motion-duration token matches
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
  popup: {
    position: "relative",
    zIndex: 1,
    width: {
      default: "calc(100% - 48px)",
      [ONBOARDING_COMPACT_MEDIA]: "calc(100% - 24px)",
    },
    maxWidth: "1040px",
    height: {
      default: CARD_HEIGHT,
      [ONBOARDING_COMPACT_MEDIA]: CARD_HEIGHT_COMPACT,
    },
    maxHeight: {
      default: CARD_HEIGHT,
      [ONBOARDING_COMPACT_MEDIA]: CARD_HEIGHT_COMPACT,
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
  popupEntering: {
    animationName: {
      default: onboardingSurfaceEnter,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    animationDuration: {
      // oxlint-disable-next-line honk/design-no-raw-values -- 820ms surface entrance is a bespoke onboarding cadence, no motion-duration token matches
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
      // oxlint-disable-next-line honk/design-no-raw-values -- 520ms surface exit is a bespoke onboarding cadence, no motion-duration token matches
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
    // oxlint-disable-next-line honk/design-no-raw-values -- 24px progress top inset is fixed modal chrome, no spacing token owns 24px
    paddingTop: PROGRESS_PAD_TOP,
    paddingInline: {
      default: ONBOARDING_CONTENT_PAD,
      [ONBOARDING_COMPACT_MEDIA]: ONBOARDING_CONTENT_PAD_COMPACT,
    },
  },
  progress: {
    display: "flex",
    // oxlint-disable-next-line honk/design-no-raw-values -- 4px progress-segment gap is fixed modal layout, no spacing token owns 4px
    gap: PROGRESS_GAP,
    height: "4px",
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
  action: {
    width: "100%",
    minWidth: 0,
    display: "grid",
    justifyItems: "start",
    gap: spaceVars["--honk-space-gutter"],
  },
  actionCopy: {
    minWidth: 0,
    display: "grid",
    gap: controlVars["--honk-control-gap"],
  },
});

function StepProgress({ step }: { readonly step: OnboardingStep }): React.ReactElement {
  const currentIndex = ONBOARDING_STEP_ORDER.indexOf(step);
  return (
    <div {...stylex.props(styles.progressFrame)}>
      <div
        {...stylex.props(styles.progress)}
        role="progressbar"
        aria-label="Onboarding progress"
        aria-valuemin={1}
        aria-valuemax={ONBOARDING_STEP_ORDER.length}
        aria-valuenow={currentIndex + 1}
      >
        {ONBOARDING_STEP_ORDER.map((value, index) => (
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

function WelcomeStep({ onContinue }: { readonly onContinue: () => void }): React.ReactElement {
  return (
    <div {...stylex.props(onboardingStepStyles.stage)}>
      <div {...stylex.props(onboardingStepStyles.body)}>
        <OnboardingStepCopy step="welcome" title="Welcome to Honk">
          <Text as="p" size="base" tone="muted">
            Give Codex and Claude one focused workspace for your code.
          </Text>
          <OnboardingFactList>
            <OnboardingFact
              term="Work in your projects"
              description="Every task starts with the right local context."
            />
            <OnboardingFact
              term="Use your existing accounts"
              description="Connect Codex, or use the Claude Code session already on this Mac."
            />
            <OnboardingFact
              term="Keep the work together"
              description="Threads, files, changes, and terminals stay in one window."
            />
          </OnboardingFactList>
        </OnboardingStepCopy>
        <OnboardingStepPanel label="Honk workspace preview">
          <WelcomeDemo />
        </OnboardingStepPanel>
      </div>
      <div {...stylex.props(onboardingStepStyles.footer)}>
        <span {...stylex.props(onboardingStepStyles.footerSpacer)} />
        <Button autoFocus size="md" variant="primary" onClick={onContinue}>
          Get started
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
    <div {...stylex.props(onboardingStepStyles.stage)}>
      <div {...stylex.props(onboardingStepStyles.body)}>
        <OnboardingStepCopy step="location" title="Choose a default project folder">
          <Text as="p" size="base" tone="muted">
            New tasks start here unless you pick another folder in the composer. Honk reads and
            edits files there only when a task asks it to.
          </Text>
          <div {...stylex.props(styles.action)}>
            <div {...stylex.props(styles.actionCopy)}>
              <Text as="p" size="sm" weight="semibold">
                {directory === null ? "No folder selected" : folderName(directory)}
              </Text>
              {directory === null ? null : (
                <Text
                  as="p"
                  size="sm"
                  tone="muted"
                  family="mono"
                  style={{ overflowWrap: "anywhere" }}
                >
                  {directory}
                </Text>
              )}
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
          <Text as="p" size="sm" tone="faint">
            The system folder picker confirms the location before Honk saves it.
          </Text>
        </OnboardingStepCopy>
        <OnboardingStepPanel label="Default folder preview">
          <LocationDemo folderLabel={directory === null ? null : folderName(directory)} />
        </OnboardingStepPanel>
      </div>
      <div {...stylex.props(onboardingStepStyles.footer)}>
        <Button size="md" variant="quiet" onClick={onBack}>
          Back
        </Button>
        <span {...stylex.props(onboardingStepStyles.footerSpacer)} />
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

function BasicsStep({
  onBack,
  onFinish,
  isCompleting,
  completionError,
}: {
  readonly onBack: () => void;
  readonly onFinish: () => void;
  readonly isCompleting: boolean;
  readonly completionError: string | null;
}): React.ReactElement {
  return (
    <div {...stylex.props(onboardingStepStyles.stage)}>
      <div {...stylex.props(onboardingStepStyles.body)}>
        <OnboardingStepCopy step="basics" title="Learn the essentials">
          <Text as="p" size="base" tone="muted">
            Type what you want done and press Enter. An idle thread starts immediately; a busy one
            queues your message, so you never wait to type.
          </Text>
          <OnboardingFactList>
            <OnboardingFact keys={["⏎"]} description="Send — or queue while the agent is working" />
            <OnboardingFact keys={["⌘", "⏎"]} description="Steer the running agent right away" />
            <OnboardingFact keys={["⌘", "K"]} description="Find threads, start tasks, run commands" />
            <OnboardingFact keys={["⌘", "W"]} description="Close the tab — the agent keeps running" />
          </OnboardingFactList>
          <Text as="p" size="sm" tone="faint">
            Replay this tour any time from the command menu.
          </Text>
          {completionError === null ? null : (
            <Text as="p" role="alert" size="sm" tone="err">
              {completionError}
            </Text>
          )}
        </OnboardingStepCopy>
        <OnboardingStepPanel label="Queue preview">
          <QueueDemo />
        </OnboardingStepPanel>
      </div>
      <div {...stylex.props(onboardingStepStyles.footer)}>
        <Button size="md" variant="quiet" onClick={onBack}>
          Back
        </Button>
        <span {...stylex.props(onboardingStepStyles.footerSpacer)} />
        <Button autoFocus size="md" variant="primary" disabled={isCompleting} onClick={onFinish}>
          {isCompleting ? "Opening Honk…" : "Start using Honk"}
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
          ) : step === "provider" ? (
            <OnboardingProviderStep
              onBack={() => {
                setStep("location");
              }}
              onContinue={() => {
                setStep("basics");
              }}
            />
          ) : (
            <BasicsStep
              onBack={() => {
                setStep("provider");
              }}
              onFinish={completeOnboarding}
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
