import * as stylex from "@stylexjs/stylex";
import { Button, ChangeReceipt, Icon, Text, ToolCallLine } from "@honk/ui";
import { IconArrowUp, IconFolderOpen } from "@honk/ui/icons";
import { colorVars, controlVars, conversationVars, elevationVars, motionVars, radiusVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as React from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const introTimeline = stylex.keyframes({ "0%": { opacity: 0 }, "6%": { opacity: 1 }, "88%": { opacity: 1 }, "100%": { opacity: 0 } });
const introSkip = stylex.keyframes({ from: { opacity: 1, scale: 1, filter: "blur(0)" }, to: { opacity: 0, scale: 0.98, filter: "blur(4px)" } });
const styles = stylex.create({
  intro: { position: "absolute", inset: 0, animationName: { default: introTimeline, "@media (prefers-reduced-motion: reduce)": "none" }, animationDuration: { default: "5s", "@media (prefers-reduced-motion: reduce)": "0s" }, animationTimingFunction: "linear", animationFillMode: "both" },
  introSkipping: { animationName: { default: introSkip, "@media (prefers-reduced-motion: reduce)": "none" }, animationDuration: { default: "420ms", "@media (prefers-reduced-motion: reduce)": "0s" }, animationTimingFunction: motionVars["--honk-motion-ease-in"], animationFillMode: "both" },
  introButton: { position: "absolute", zIndex: 1, right: "40px", bottom: "40px" },
  stack: { position: "relative", width: "100%", display: "grid", justifyItems: "center", gap: spaceVars["--honk-space-gutter"], pointerEvents: "none" },
  composer: { boxSizing: "border-box", width: "100%", minHeight: "72px", display: "flex", flexDirection: "column", borderRadius: radiusVars["--honk-radius-panel"], backgroundColor: colorVars["--honk-color-bg-base"], boxShadow: elevationVars["--honk-elevation-raised"] },
  editor: { paddingInline: "16px", paddingTop: "16px", paddingBottom: spaceVars["--honk-space-gutter"] },
  footer: { display: "flex", alignItems: "center", gap: controlVars["--honk-control-gap"], height: "44px", paddingInline: "16px" },
  location: { display: "inline-flex", alignItems: "center", gap: controlVars["--honk-control-gap"], height: controlVars["--honk-control-h-sm"], paddingInline: spaceVars["--honk-space-gutter"], borderRadius: radiusVars["--honk-radius-pill"], color: colorVars["--honk-color-text-faint"] },
  spacer: { flexGrow: 1 },
  send: { width: "24px", height: "24px", flexShrink: 0, display: "grid", placeItems: "center", borderRadius: radiusVars["--honk-radius-pill"], backgroundColor: colorVars["--honk-color-accent-fill"], color: colorVars["--honk-color-on-accent"] },
  work: { boxSizing: "border-box", width: "100%", minHeight: "178px", display: "flex", flexDirection: "column", justifyContent: "center", gap: spaceVars["--honk-space-gutter"] },
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
  return <div {...stylex.props(styles.intro, props.phase === "skipping" && styles.introSkipping)} onAnimationEnd={(event) => { if (event.currentTarget === event.target) props.onFinished(); }}><span {...stylex.props(styles.introButton)}><Button size="sm" variant="quiet" onClick={props.onSkip}>Skip intro</Button></span></div>;
}

export function WorkspaceDemo(): React.ReactElement {
  return (
    <div aria-hidden={true} {...stylex.props(styles.stack)}>
      <div {...stylex.props(styles.composer)}><div {...stylex.props(styles.editor)}><Text size="base" style={{ minWidth: 0, maxWidth: "310px", overflow: "hidden", whiteSpace: "nowrap" }}>Animate the first-run onboarding flow</Text></div><div {...stylex.props(styles.footer)}><span {...stylex.props(styles.location)}><Icon icon={IconFolderOpen} size="sm" tone="faint" /><Text size="xs" tone="faint">honk</Text></span><span {...stylex.props(styles.spacer)} /><span {...stylex.props(styles.send)}><Icon icon={IconArrowUp} size="sm" /></span></div></div>
      <div {...stylex.props(styles.work)}><ToolCallLine verb="Explored" detail="Electron window lifecycle" /><ToolCallLine verb="Edited" detail="onboarding.tsx" added={70} removed={11} /><Text as="p" size="sm" style={{ paddingInline: conversationVars["--honk-conversation-inset"] }}>The setup window now hands off only after Honk is ready.</Text><ChangeReceipt files={DEMO_CHANGED_FILES} onReview={() => undefined} /></div>
    </div>
  );
}
