// The onboarding stage system: every step's right panel renders the same hero
// object — a miniature composer built from real product primitives — layered
// with that step's consequence. Stages are evidence, not controls: aria-hidden,
// non-interactive, and never the only place information lives.

import * as stylex from "@stylexjs/stylex";
import { Button, ChangeReceipt, Icon, Matrix, StatusDot, Text, ToolCallLine } from "@honk/ui";
import type { Glyph } from "@honk/ui";
import { IconArrowUp, IconClawd, IconFolderOpen, IconOpenaiCodex } from "@honk/ui/icons";
import {
  colorVars,
  controlVars,
  conversationVars,
  elevationVars,
  motionVars,
  radiusVars,
  spaceVars,
} from "@honk/ui/tokens.stylex";
import * as React from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

const introTimeline = stylex.keyframes({
  "0%": { opacity: 0 },
  "6%": { opacity: 1 },
  "88%": { opacity: 1 },
  "100%": { opacity: 0 },
});
const introSkip = stylex.keyframes({
  from: { opacity: 1, scale: 1, filter: "blur(0)" },
  to: { opacity: 0, scale: 0.98, filter: "blur(4px)" },
});

const styles = stylex.create({
  intro: {
    position: "absolute",
    inset: 0,
    animationName: { default: introTimeline, "@media (prefers-reduced-motion: reduce)": "none" },
    // oxlint-disable-next-line honk/design-no-raw-values -- 5s intro cinematic timeline is a fixed animation length, no motion-duration token owns multi-second durations
    animationDuration: { default: "5s", "@media (prefers-reduced-motion: reduce)": "0s" },
    animationTimingFunction: "linear",
    animationFillMode: "both",
  },
  introSkipping: {
    animationName: { default: introSkip, "@media (prefers-reduced-motion: reduce)": "none" },
    // oxlint-disable-next-line honk/design-no-raw-values -- 420ms intro skip-out is a bespoke one-off duration, no motion-duration token matches 420ms
    animationDuration: { default: "420ms", "@media (prefers-reduced-motion: reduce)": "0s" },
    animationTimingFunction: motionVars["--honk-motion-ease-in"],
    animationFillMode: "both",
  },
  introButton: { position: "absolute", zIndex: 1, right: "40px", bottom: "40px" },
  stage: {
    position: "relative",
    width: "100%",
    display: "grid",
    justifyItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    pointerEvents: "none",
  },
  composer: {
    boxSizing: "border-box",
    width: "100%",
    minHeight: "72px",
    display: "flex",
    flexDirection: "column",
    borderRadius: radiusVars["--honk-radius-panel"],
    backgroundColor: colorVars["--honk-color-bg-base"],
    boxShadow: elevationVars["--honk-elevation-raised"],
  },
  editor: {
    // oxlint-disable-next-line honk/design-no-raw-values -- 16px composer editor inline padding is fixed demo geometry, no spacing token owns 16px
    paddingInline: "16px",
    // oxlint-disable-next-line honk/design-no-raw-values -- 16px composer editor top padding is fixed demo geometry, no spacing token owns 16px
    paddingTop: "16px",
    paddingBottom: spaceVars["--honk-space-gutter"],
  },
  footer: {
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    height: "44px",
    // oxlint-disable-next-line honk/design-no-raw-values -- 16px composer footer inline padding is fixed demo geometry, no spacing token owns 16px
    paddingInline: "16px",
  },
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    height: controlVars["--honk-control-h-sm"],
    paddingInline: spaceVars["--honk-space-gutter"],
    borderRadius: radiusVars["--honk-radius-pill"],
    color: colorVars["--honk-color-text-faint"],
  },
  spacer: { flexGrow: 1 },
  send: {
    width: "24px",
    height: "24px",
    flexShrink: 0,
    display: "grid",
    placeItems: "center",
    borderRadius: radiusVars["--honk-radius-pill"],
    backgroundColor: colorVars["--honk-color-accent-fill"],
    color: colorVars["--honk-color-on-accent"],
  },
  work: {
    boxSizing: "border-box",
    width: "100%",
    minHeight: "178px",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    gap: spaceVars["--honk-space-gutter"],
  },
  threadRow: {
    boxSizing: "border-box",
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    paddingInline: conversationVars["--honk-conversation-inset"],
  },
  threadRows: {
    width: "100%",
    display: "grid",
    gap: spaceVars["--honk-space-gutter"],
  },
});

const DEMO_CHANGED_FILES = [
  { path: "packages/app/src/onboarding.tsx", additions: 70, deletions: 11, status: "modified" },
  { path: "packages/desktop/src/window/desktop-window.ts", additions: 12, deletions: 2, status: "modified" },
  { path: "packages/desktop/electron.vite.config.ts", additions: 4, deletions: 1, status: "modified" },
] as const;

export function useReducedMotion(): boolean {
  return React.useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(REDUCED_MOTION_QUERY);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  );
}

export function OnboardingIntro(props: {
  readonly phase: "running" | "skipping";
  readonly onSkip: () => void;
  readonly onFinished: () => void;
}): React.ReactElement {
  return (
    <div
      {...stylex.props(styles.intro, props.phase === "skipping" && styles.introSkipping)}
      onAnimationEnd={(event) => {
        if (event.currentTarget === event.target) props.onFinished();
      }}
    >
      <span {...stylex.props(styles.introButton)}>
        <Button size="sm" variant="quiet" onClick={props.onSkip}>
          Skip intro
        </Button>
      </span>
    </div>
  );
}

function DemoStage({ children }: { readonly children: React.ReactNode }): React.ReactElement {
  return (
    <div aria-hidden={true} {...stylex.props(styles.stage)}>
      {children}
    </div>
  );
}

function DemoComposer({
  text,
  folderLabel,
  agent,
}: {
  readonly text: string;
  readonly folderLabel: string;
  readonly agent?: { readonly icon: Glyph; readonly label: string } | null;
}): React.ReactElement {
  return (
    <div {...stylex.props(styles.composer)}>
      <div {...stylex.props(styles.editor)}>
        <Text
          size="base"
          style={{ minWidth: 0, maxWidth: "310px", overflow: "hidden", whiteSpace: "nowrap" }}
        >
          {text}
        </Text>
      </div>
      <div {...stylex.props(styles.footer)}>
        <span {...stylex.props(styles.chip)}>
          <Icon icon={IconFolderOpen} size="sm" tone="faint" />
          <Text size="xs" tone="faint">
            {folderLabel}
          </Text>
        </span>
        {agent === undefined ? null : agent === null ? (
          <span {...stylex.props(styles.chip)}>
            <StatusDot tone="draft" />
            <Text size="xs" tone="faint">
              No account yet
            </Text>
          </span>
        ) : (
          <span {...stylex.props(styles.chip)}>
            <Icon icon={agent.icon} size="sm" tone="faint" />
            <Text size="xs" tone="faint">
              {agent.label}
            </Text>
          </span>
        )}
        <span {...stylex.props(styles.spacer)} />
        <span {...stylex.props(styles.send)}>
          <Icon icon={IconArrowUp} size="sm" />
        </span>
      </div>
    </div>
  );
}

function DemoCaption({ children }: { readonly children: React.ReactNode }): React.ReactElement {
  return (
    <Text as="p" size="sm" tone="faint" style={{ textAlign: "center" }}>
      {children}
    </Text>
  );
}

// Welcome: the whole picture — you type, the agent works, changes come back as a receipt.
export function WelcomeDemo(): React.ReactElement {
  return (
    <DemoStage>
      <DemoComposer text="Animate the first-run onboarding flow" folderLabel="honk" />
      <div {...stylex.props(styles.work)}>
        <ToolCallLine verb="Explored" detail="Electron window lifecycle" />
        <ToolCallLine verb="Edited" detail="onboarding.tsx" added={70} removed={11} />
        <Text as="p" size="sm" style={{ paddingInline: conversationVars["--honk-conversation-inset"] }}>
          The setup window now hands off only after Honk is ready.
        </Text>
        <ChangeReceipt files={DEMO_CHANGED_FILES} onReview={() => undefined} />
      </div>
    </DemoStage>
  );
}

// Location: the picked folder lands in the composer's location chip, live.
export function LocationDemo({
  folderLabel,
}: {
  readonly folderLabel: string | null;
}): React.ReactElement {
  return (
    <DemoStage>
      <DemoComposer
        text="Add a settings page"
        folderLabel={folderLabel ?? "Choose a folder"}
      />
      <DemoCaption>
        {folderLabel === null
          ? "Your default folder appears here once you pick it."
          : `New tasks start in ${folderLabel}.`}
      </DemoCaption>
    </DemoStage>
  );
}

// Provider: the composer's account chip shows who will run your tasks, live.
export function ProviderDemo({
  codexConnected,
  claudeConnected,
}: {
  readonly codexConnected: boolean;
  readonly claudeConnected: boolean;
}): React.ReactElement {
  const agent = codexConnected
    ? { icon: IconOpenaiCodex, label: "Codex" }
    : claudeConnected
      ? { icon: IconClawd, label: "Claude Code" }
      : null;
  return (
    <DemoStage>
      <DemoComposer text="Fix the flaky session test" folderLabel="honk" agent={agent} />
      <DemoCaption>
        {agent === null
          ? "Connect an account and it powers every task."
          : `Tasks run with ${agent.label}.`}
      </DemoCaption>
    </DemoStage>
  );
}

// Basics: queue-first in one picture — one task working, the next queued behind it.
export function QueueDemo(): React.ReactElement {
  return (
    <DemoStage>
      <DemoComposer text="Also update the docs" folderLabel="honk" />
      <div {...stylex.props(styles.threadRows)}>
        <div {...stylex.props(styles.threadRow)}>
          <Matrix variant="working" />
          <Text size="sm">Refactor the onboarding flow</Text>
          <span {...stylex.props(styles.spacer)} />
          <Text size="xs" tone="faint">
            Working
          </Text>
        </div>
        <div {...stylex.props(styles.threadRow)}>
          <StatusDot tone="draft" />
          <Text size="sm" tone="muted">
            Also update the docs
          </Text>
          <span {...stylex.props(styles.spacer)} />
          <Text size="xs" tone="faint">
            Queued · ⌘⏎ sends now
          </Text>
        </div>
      </div>
      <DemoCaption>⏎ queues while the agent works — nothing waits on you.</DemoCaption>
    </DemoStage>
  );
}
