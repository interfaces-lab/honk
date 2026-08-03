// The new onboarding, at /setup, in the one Honk window.
//
// Every page shares the OnboardingLayout frame: the recurring generative art
// on the left half, the page's content on the white right half. Pages land one
// at a time; spec/onboarding.md records the inventory this grows toward.

import * as stylex from "@stylexjs/stylex";
import { useNavigate, useSearch } from "@tanstack/react-router";
import * as React from "react";

import { OnboardingLayout } from "./onboarding-layout";

/** The one address for onboarding. Desktop opens it directly on first run. */
export const ONBOARDING_PATH = "/setup";

// Only the titlebar strip drags: a full-window drag region hands every pointer
// event to the OS, and index.css's no-drag opt-outs assume a strip.
const DRAG_STRIP_HEIGHT = "40px";

const styles = stylex.create({
  canvas: {
    position: "fixed",
    inset: 0,
    overflow: "hidden",
    colorScheme: "light",
    outline: "none",
  },
  dragStrip: {
    position: "absolute",
    insetBlockStart: 0,
    insetInline: 0,
    height: DRAG_STRIP_HEIGHT,
  },
});

export function OnboardingPage(): React.ReactElement {
  const navigate = useNavigate();
  const isReplay = useSearch({ from: ONBOARDING_PATH, select: (search) => search.replay });
  const canvasRef = React.useRef<HTMLDivElement | null>(null);

  // Nothing on the canvas can hold focus yet, so the canvas takes it — without
  // this, Escape on a replay would land on <body> and never reach the handler.
  React.useEffect(() => {
    canvasRef.current?.focus();
  }, []);

  return (
    <div
      ref={canvasRef}
      tabIndex={-1}
      {...stylex.props(styles.canvas)}
      onKeyDown={(event) => {
        // A replay is a revisit, so Escape leaves it. First run stays: the flow
        // that finishes onboarding is not built yet.
        if (event.key === "Escape" && isReplay) {
          event.preventDefault();
          void navigate({ to: "/", replace: true });
        }
      }}
    >
      <OnboardingLayout />
      <div aria-hidden={true} data-shell-drag-region="" {...stylex.props(styles.dragStrip)} />
    </div>
  );
}
