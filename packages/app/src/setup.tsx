// First-run setup, at /setup, in the one Honk window.
//
// The opening screen asks the only question that matters — take the defaults or
// configure — and every later screen is one decision on one panel over the same
// backdrop. There is no progress bar: the choice up front already set the
// expectation, and a bar would turn a short, skippable flow into a chore.
//
// Nothing here is durable until it is written. "Use defaults" states exactly
// what it will change before it changes it, and every value it writes stays
// editable in Settings.

import * as stylex from "@stylexjs/stylex";
import { Button, Icon, Switch, Text } from "@honk/ui";
import {
  IconArrowRight,
  IconBubbleCheck,
  IconCheckmark1,
  IconCircleCheck,
  IconFolderOpen,
} from "@honk/ui/icons";
import { colorVars, controlVars, motionVars, spaceVars } from "@honk/ui/tokens.stylex";
import { useNavigate, useSearch } from "@tanstack/react-router";
import * as React from "react";

import { actions as appSettingsActions, useAppSettings } from "./app-settings-store";
import { useAppearanceTheme } from "./appearance-store";
import { completeDesktopOnboarding, getHomeDirectory, pickFolder } from "./desktop-bridge";
import { errorMessage } from "./error-message";
import { SetupAccountsStep } from "./setup-accounts";
import { SetupBackdrop, SetupFooter, SetupPanel, SetupRow, SetupScene } from "./setup-scene";
import { setupLayout } from "./setup-scene.stylex";

/** The one address for setup. Desktop opens it directly on first run. */
export const SETUP_PATH = "/setup";

type SetupStep = "hero" | "folder" | "accounts" | "alerts" | "ready";

// The opening lockup resolves one element at a time so the window reads as
// arriving rather than appearing. Following imputnet/helium-onboarding, the
// mark travels a long way through a heavy blur and the copy that follows moves
// barely at all — the distance is what makes the first element feel like it
// carries the others in. These delays are a fixed film, not a token ramp.
const HERO_MARK_DELAY = "160ms";
const HERO_TITLE_DELAY = "1080ms";
const HERO_BODY_DELAY = "1220ms";
const HERO_ACTIONS_DELAY = "1360ms";
const HERO_FINE_DELAY = "1480ms";
const HERO_MARK_DURATION = "1500ms";
const HERO_MARK_RISE = "120px";
const HERO_MARK_BLUR = "10px";
const HERO_ENTER_DURATION = "620ms";
const HERO_ENTER_RISE = "10px";
const HERO_ENTER_BLUR = "5px";
const HERO_MARK_SIZE = "20px";
const HERO_TITLE_SIZE = "40px";
const HERO_TITLE_LEADING = "46px";
const HERO_BODY_SIZE = "17px";
const HERO_BODY_LEADING = "26px";
// Wide enough for the longest chord in the list so the descriptions align.
const FACT_KEYS_WIDTH = "48px";

const heroEnter = stylex.keyframes({
  from: {
    opacity: 0,
    translate: `0 ${HERO_ENTER_RISE}`,
    filter: `blur(${HERO_ENTER_BLUR})`,
  },
  to: { opacity: 1, translate: "0 0", filter: "blur(0)" },
});

const heroMarkEnter = stylex.keyframes({
  from: {
    opacity: 0,
    translate: `0 ${HERO_MARK_RISE}`,
    filter: `blur(${HERO_MARK_BLUR})`,
  },
  // The blur clears before the travel does, so the mark lands sharp rather
  // than sharpening after it has stopped.
  "88%": { filter: "blur(0)" },
  to: { opacity: 1, translate: "0 0", filter: "blur(0)" },
});

const schemeStyles = stylex.create({
  system: { colorScheme: "light dark" },
  light: { colorScheme: "light" },
  dark: { colorScheme: "dark" },
});

const styles = stylex.create({
  root: {
    outline: "none",
  },
  hero: {
    minHeight: 0,
    flexGrow: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    paddingBlockStart: setupLayout.topClearance,
    paddingBlockEnd: {
      default: setupLayout.edgePad,
      [setupLayout.compactMedia]: setupLayout.edgePadCompact,
    },
    paddingInline: {
      default: setupLayout.edgePad,
      [setupLayout.compactMedia]: setupLayout.edgePadCompact,
    },
  },
  // Left-aligned inside a centered block: the reference's lockup, and it keeps
  // the title, body, and buttons on one edge the eye can track down.
  heroColumn: {
    width: "100%",
    maxWidth: setupLayout.heroColumn,
    display: "grid",
    justifyItems: "start",
    gap: setupLayout.heroGroupGap,
  },
  // Mark, title, and body are one lockup; the gap inside it stays tighter than
  // the gap that separates it from the choice below.
  heroLockup: {
    display: "grid",
    justifyItems: "start",
    gap: spaceVars["--honk-space-panel-pad"],
  },
  reveal: {
    animationName: {
      default: heroEnter,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    animationDuration: {
      // oxlint-disable-next-line honk/design-no-raw-values -- 760ms opening reveal is a bespoke first-run cadence well past the interaction ramp; no motion-duration token owns it
      default: HERO_ENTER_DURATION,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    animationTimingFunction: motionVars["--honk-motion-ease-float"],
    animationFillMode: "both",
  },
  revealMark: {
    animationName: {
      default: heroMarkEnter,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    animationDuration: {
      // oxlint-disable-next-line honk/design-no-raw-values -- the mark's 1.5s travel is the opening film's one long move; no motion-duration token owns it
      default: HERO_MARK_DURATION,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    // oxlint-disable-next-line honk/design-no-raw-values -- staged reveal offsets are a fixed opening film, not a motion-token ramp
    animationDelay: { default: HERO_MARK_DELAY, "@media (prefers-reduced-motion: reduce)": "0s" },
  },
  revealTitle: {
    // oxlint-disable-next-line honk/design-no-raw-values -- staged reveal offsets are a fixed opening film, not a motion-token ramp
    animationDelay: { default: HERO_TITLE_DELAY, "@media (prefers-reduced-motion: reduce)": "0s" },
  },
  revealBody: {
    // oxlint-disable-next-line honk/design-no-raw-values -- staged reveal offsets are a fixed opening film, not a motion-token ramp
    animationDelay: { default: HERO_BODY_DELAY, "@media (prefers-reduced-motion: reduce)": "0s" },
  },
  revealActions: {
    animationDelay: {
      // oxlint-disable-next-line honk/design-no-raw-values -- staged reveal offsets are a fixed opening film, not a motion-token ramp
      default: HERO_ACTIONS_DELAY,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
  },
  revealFine: {
    // oxlint-disable-next-line honk/design-no-raw-values -- staged reveal offsets are a fixed opening film, not a motion-token ramp
    animationDelay: { default: HERO_FINE_DELAY, "@media (prefers-reduced-motion: reduce)": "0s" },
  },
  factList: {
    width: "100%",
    display: "grid",
    gap: spaceVars["--honk-space-panel-pad"],
    padding: setupLayout.edgePadCompact,
  },
  fact: {
    display: "flex",
    alignItems: "baseline",
    gap: spaceVars["--honk-space-panel-pad"],
  },
  factKeys: {
    flexShrink: 0,
    minWidth: FACT_KEYS_WIDTH,
    color: colorVars["--honk-color-text-primary"],
  },
  finishActions: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: spaceVars["--honk-space-gutter"],
  },
  errorRow: {
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
  },
});

export function SetupPage(): React.ReactElement {
  const theme = useAppearanceTheme();
  const navigate = useNavigate();
  const isReplay = useSearch({ from: SETUP_PATH, select: (search) => search.replay });
  const appSettings = useAppSettings();
  const [step, setStep] = React.useState<SetupStep>("hero");
  const [isFinishing, setIsFinishing] = React.useState(false);
  const [finishError, setFinishError] = React.useState<string | null>(null);

  const finish = (): void => {
    if (isFinishing) {
      return;
    }
    setFinishError(null);
    setIsFinishing(true);
    void completeDesktopOnboarding()
      .then(() => navigate({ to: "/", replace: true }))
      .catch((cause: unknown) => {
        setIsFinishing(false);
        setFinishError(errorMessage(cause));
      });
  };

  // "Use defaults" resolves the home folder before it commits, so a failed read
  // never leaves setup half-applied with the folder silently unset. An existing
  // folder is never overwritten: replaying setup must not undo a real choice.
  const useDefaults = (): void => {
    if (isFinishing) {
      return;
    }
    setFinishError(null);
    setIsFinishing(true);
    void getHomeDirectory()
      .then((home) => {
        if (home !== null && appSettings.defaultProjectDirectory === null) {
          appSettingsActions.setDefaultProjectDirectory(home);
        }
        return completeDesktopOnboarding();
      })
      .then(() => navigate({ to: "/", replace: true }))
      .catch((cause: unknown) => {
        setIsFinishing(false);
        setFinishError(errorMessage(cause));
      });
  };

  return (
    <div
      // Focusable so Escape still reaches this handler after a click lands on
      // the backdrop rather than on a control. Not focused on mount — that
      // would steal focus from the opening screen's primary button.
      tabIndex={-1}
      {...stylex.props(schemeStyles[theme], styles.root)}
      onKeyDown={(event) => {
        // A replay is a revisit, so Escape leaves it. First run has no Escape:
        // the window is here to finish setup, and both buttons on the opening
        // screen already lead out of it.
        if (event.key === "Escape" && isReplay && !isFinishing) {
          event.preventDefault();
          void navigate({ to: "/", replace: true });
        }
      }}
    >
      {/* Full strength on the opening and closing screens, dimmed behind the
          configure steps so the panel leads and the backdrop stays scenery. */}
      <SetupBackdrop isDimmed={step !== "hero" && step !== "ready"}>
        {step === "hero" ? (
          <HeroStep
            isBusy={isFinishing}
            errorText={finishError}
            onUseDefaults={useDefaults}
            onConfigure={() => {
              setStep("folder");
            }}
          />
        ) : step === "folder" ? (
          <FolderStep
            key="folder"
            onBack={() => {
              setStep("hero");
            }}
            onContinue={() => {
              setStep("accounts");
            }}
          />
        ) : step === "accounts" ? (
          <SetupAccountsStep
            key="accounts"
            onBack={() => {
              setStep("folder");
            }}
            onContinue={() => {
              setStep("alerts");
            }}
          />
        ) : step === "alerts" ? (
          <AlertsStep
            key="alerts"
            onBack={() => {
              setStep("accounts");
            }}
            onContinue={() => {
              setStep("ready");
            }}
          />
        ) : (
          <ReadyStep
            key="ready"
            isBusy={isFinishing}
            errorText={finishError}
            onBack={() => {
              setStep("alerts");
            }}
            onFinish={finish}
          />
        )}
      </SetupBackdrop>
    </div>
  );
}

function HeroStep({
  isBusy,
  errorText,
  onUseDefaults,
  onConfigure,
}: {
  readonly isBusy: boolean;
  readonly errorText: string | null;
  readonly onUseDefaults: () => void;
  readonly onConfigure: () => void;
}): React.ReactElement {
  return (
    <div {...stylex.props(styles.hero)}>
      <div {...stylex.props(styles.heroColumn)}>
        <div {...stylex.props(styles.heroLockup)}>
          <div {...stylex.props(styles.reveal, styles.revealMark)}>
            <Text
              as="p"
              tone="accent"
              weight="semibold"
              // oxlint-disable-next-line honk/design-no-raw-values -- the wordmark is brand display type above the product ramp; no font token owns it
              style={{ fontSize: HERO_MARK_SIZE, lineHeight: 1.1 }}
            >
              honk
            </Text>
          </div>
          <div {...stylex.props(styles.reveal, styles.revealTitle)}>
            <Text
              as="div"
              role="heading"
              aria-level={1}
              size="xl"
              weight="semibold"
              // oxlint-disable-next-line honk/design-no-raw-values -- the opening title is display type above the product ramp; no font token owns it
              style={{ fontSize: HERO_TITLE_SIZE, lineHeight: HERO_TITLE_LEADING }}
            >
              Meet Honk
            </Text>
          </div>
          <div {...stylex.props(styles.reveal, styles.revealBody)}>
            <Text
              as="p"
              tone="muted"
              // oxlint-disable-next-line honk/design-no-raw-values -- the opening body sits one step above the prose ramp to match the display title; no font token owns it
              style={{ fontSize: HERO_BODY_SIZE, lineHeight: HERO_BODY_LEADING }}
            >
              Codex and Claude, working in your code, in one window. Take the defaults and start
              now, or set it up first.
            </Text>
          </div>
        </div>
        <div {...stylex.props(styles.reveal, styles.revealActions)}>
          <Button
            size="lg"
            variant="neutral"
            disabled={isBusy}
            iconStart={<Icon icon={IconCheckmark1} size="sm" />}
            onClick={onUseDefaults}
          >
            {isBusy ? "Opening Honk…" : "Use defaults"}
          </Button>
          <Button
            size="lg"
            variant="primary"
            disabled={isBusy}
            iconEnd={<Icon icon={IconArrowRight} size="sm" />}
            onClick={onConfigure}
          >
            Configure
          </Button>
        </div>
        <div {...stylex.props(styles.reveal, styles.revealFine)}>
          <Text as="p" size="sm" tone="muted">
            Defaults make your home folder the default project folder and leave background alerts
            on. Both change in Settings.
          </Text>
        </div>
        {errorText === null ? null : (
          <Text as="p" role="alert" size="sm" tone="err">
            {errorText}
          </Text>
        )}
      </div>
    </div>
  );
}

function FolderStep({
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
    <SetupScene
      icon={IconFolderOpen}
      title="Where your work starts"
      description="New threads open in this folder unless you pick another one in the composer."
    >
      <SetupPanel label="Default project folder">
        <SetupRow
          title={directory === null ? "No folder chosen" : folderName(directory)}
          description={
            directory ?? "Choose one now, or pick a folder each time you start a thread."
          }
          control={
            <Button
              size="sm"
              variant="neutral"
              disabled={isPicking}
              iconStart={<Icon icon={IconFolderOpen} size="sm" />}
              onClick={chooseFolder}
            >
              {isPicking ? "Opening picker…" : directory === null ? "Choose…" : "Change…"}
            </Button>
          }
        />
        <SetupRow
          title="Start threads in a worktree"
          description="Each thread gets its own git worktree next to your folder, so threads never compete over the same files. Off, they work in your checkout."
          control={
            <Switch
              size="sm"
              checked={appSettings.defaultThreadEnvironment === "worktree"}
              aria-label="Start threads in a worktree"
              onCheckedChange={(checked) => {
                appSettingsActions.setDefaultThreadEnvironment(checked ? "worktree" : "local");
              }}
            />
          }
        />
      </SetupPanel>
      <SetupFooter onBack={onBack} onNext={onContinue} nextLabel="Next" />
    </SetupScene>
  );
}

function AlertsStep({
  onBack,
  onContinue,
}: {
  readonly onBack: () => void;
  readonly onContinue: () => void;
}): React.ReactElement {
  const appSettings = useAppSettings();

  return (
    <SetupScene
      icon={IconBubbleCheck}
      title="When Honk interrupts you"
      description="Threads keep running while Honk is in the background. These decide whether it says so."
    >
      <SetupPanel label="Background alerts">
        <SetupRow
          title="Thread finished"
          description="Notify when a thread finishes while Honk is in the background."
          control={
            <Switch
              size="sm"
              checked={appSettings.notifyWhenThreadFinishes}
              aria-label="Notify when a thread finishes"
              onCheckedChange={(checked) => {
                appSettingsActions.setNotifyWhenThreadFinishes(checked);
              }}
            />
          }
        />
        <SetupRow
          title="Input needed"
          description="Notify when a thread needs a decision, permission, or answer."
          control={
            <Switch
              size="sm"
              checked={appSettings.notifyWhenThreadNeedsInput}
              aria-label="Notify when a thread needs input"
              onCheckedChange={(checked) => {
                appSettingsActions.setNotifyWhenThreadNeedsInput(checked);
              }}
            />
          }
        />
        <SetupRow
          title="Alert sounds"
          description="Play a sound with those notifications. Failures use a different one."
          control={
            <Switch
              size="sm"
              checked={appSettings.alertSoundsEnabled}
              aria-label="Play alert sounds"
              onCheckedChange={(checked) => {
                appSettingsActions.setAlertSoundsEnabled(checked);
              }}
            />
          }
        />
      </SetupPanel>
      <SetupFooter onBack={onBack} onNext={onContinue} nextLabel="Next" />
    </SetupScene>
  );
}

const ESSENTIALS = [
  { keys: "⏎", description: "Send — or queue it while the agent is working" },
  { keys: "⌘⏎", description: "Steer the running agent right away" },
  { keys: "⌘K", description: "Find threads, start tasks, run commands" },
  { keys: "⌘W", description: "Close the tab — the agent keeps running" },
] as const;

function ReadyStep({
  isBusy,
  errorText,
  onBack,
  onFinish,
}: {
  readonly isBusy: boolean;
  readonly errorText: string | null;
  readonly onBack: () => void;
  readonly onFinish: () => void;
}): React.ReactElement {
  return (
    <SetupScene
      icon={IconCircleCheck}
      title="You're set"
      description="Everything else is four keys."
    >
      <SetupPanel label="The essentials">
        <div {...stylex.props(styles.factList)}>
          {ESSENTIALS.map((essential) => (
            <div key={essential.keys} {...stylex.props(styles.fact)}>
              <span {...stylex.props(styles.factKeys)}>
                <Text size="sm" weight="semibold">
                  {essential.keys}
                </Text>
              </span>
              <Text as="p" size="sm" tone="muted">
                {essential.description}
              </Text>
            </div>
          ))}
        </div>
      </SetupPanel>
      {errorText === null ? null : (
        <div {...stylex.props(styles.errorRow)}>
          <Text as="p" role="alert" size="sm" tone="err">
            {errorText}
          </Text>
        </div>
      )}
      <div {...stylex.props(styles.finishActions)}>
        <Button size="md" variant="quiet" disabled={isBusy} onClick={onBack}>
          Back
        </Button>
        <Button
          size="md"
          variant="primary"
          disabled={isBusy}
          iconStart={<Icon icon={IconCheckmark1} size="sm" />}
          onClick={onFinish}
        >
          {isBusy ? "Opening Honk…" : "Start using Honk"}
        </Button>
      </div>
    </SetupScene>
  );
}

function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter((part) => part.length > 0);
  return parts.at(-1) ?? path;
}
