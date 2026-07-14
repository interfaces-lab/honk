// The preset dial — the composer's four-stop effort selector (2026-07-11 grill: presets
// replace ALL free model selection; each stop pins an Agent+Oracle bundle at thread birth).
// Anatomy from the reference dial (Amp): a full-width dotted track whose leading span fills
// in the selected tier's hue, a spread label row beneath (low … ultra), everything in the
// mono face — the dial reads as an engine gauge, not chrome. The readout under the dial
// (Agent:/Oracle: lines) is the APP's content; this primitive owns track + labels only.
//
// Semantics: a radiogroup. Labels are the radios (roving tabindex, arrow-key stepping); the
// track is decorative but clickable — a click lands on the nearest stop.

import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { colorVars, fontVars, motionVars } from "./tokens.stylex";

// Track anatomy — structural constants of the dotted gauge (local named values, the
// home-page idiom for one-component geometry).
const DOT_DIAMETER = 2.5;
const DOT_PITCH = 9;
const TRACK_HEIGHT = "4px";
const LABEL_ROW_GAP = "6px";

type PresetTone = "low" | "medium" | "high" | "ultra";

const toneColor: Record<PresetTone, string> = {
  low: colorVars["--honk-color-preset-low"],
  medium: colorVars["--honk-color-preset-medium"],
  high: colorVars["--honk-color-preset-high"],
  ultra: colorVars["--honk-color-preset-ultra"],
};

// The dot leader, drawn as a repeating radial gradient so ONE background paints the whole
// row of dots (an element per dot would be ~40 nodes per track).
const dotLeader = (color: string): string =>
  `radial-gradient(circle, ${color} ${String(DOT_DIAMETER / 2)}px, transparent ${String(
    DOT_DIAMETER / 2 + 0.25,
  )}px)`;

const styles = stylex.create({
  root: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    fontFamily: fontVars["--honk-font-family-mono"],
  },
  track: {
    position: "relative",
    height: TRACK_HEIGHT,
    width: "100%",
    backgroundImage: dotLeader(colorVars["--honk-color-layer-03"]),
    backgroundSize: `${String(DOT_PITCH)}px ${TRACK_HEIGHT}`,
    backgroundRepeat: "repeat-x",
    backgroundPosition: "left center",
    cursor: "default",
  },
  trackFill: {
    position: "absolute",
    insetBlock: 0,
    left: 0,
    backgroundSize: `${String(DOT_PITCH)}px ${TRACK_HEIGHT}`,
    backgroundRepeat: "repeat-x",
    backgroundPosition: "left center",
    transitionProperty: "width",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-base"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
  },
  labels: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginTop: LABEL_ROW_GAP,
  },
  label: {
    margin: 0,
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    fontFamily: "inherit",
    fontSize: fontVars["--honk-font-size-body"],
    fontWeight: fontVars["--honk-font-weight-regular"],
    color: {
      default: colorVars["--honk-color-text-muted"],
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-text-primary"] },
    },
    cursor: "default",
    transitionProperty: "color",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-hover"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
  },
  labelSelected: {
    fontWeight: fontVars["--honk-font-weight-semibold"],
  },
});

const dynamic = stylex.create({
  fill: (color: string, pct: number) => ({
    backgroundImage: dotLeader(color),
    width: `${String(pct)}%`,
  }),
  selectedColor: (color: string) => ({
    color: {
      default: color,
      ":hover": { "@media (hover: hover)": color },
    },
  }),
});

interface PresetDialStop {
  readonly id: string;
  readonly label: string;
  readonly tone: PresetTone;
}

interface PresetDialProps {
  readonly stops: readonly PresetDialStop[];
  readonly value: string;
  readonly onValueChange: (id: string) => void;
  // Accessible name for the radiogroup ("Effort preset").
  readonly "aria-label": string;
  readonly xstyle?: stylex.StyleXStyles;
}

function PresetDial({
  stops,
  value,
  onValueChange,
  "aria-label": ariaLabel,
  xstyle,
}: PresetDialProps): React.ReactElement {
  const selectedIndex = Math.max(
    0,
    stops.findIndex((stop) => stop.id === value),
  );
  const selected = stops[selectedIndex];
  const tone = selected?.tone ?? "low";
  // Fill runs to the selected stop's position along the track: index/(n-1).
  const fillPct = stops.length > 1 ? (selectedIndex / (stops.length - 1)) * 100 : 100;

  const stepTo = (index: number): void => {
    const next = stops[Math.min(stops.length - 1, Math.max(0, index))];
    if (next !== undefined && next.id !== value) {
      onValueChange(next.id);
    }
  };

  const handleTrackClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || stops.length < 2) {
      return;
    }
    const ratio = (event.clientX - rect.left) / rect.width;
    stepTo(Math.round(ratio * (stops.length - 1)));
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      stepTo(selectedIndex + 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      stepTo(selectedIndex - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      stepTo(0);
    } else if (event.key === "End") {
      event.preventDefault();
      stepTo(stops.length - 1);
    }
  };

  return (
    <div role="radiogroup" aria-label={ariaLabel} {...stylex.props(styles.root, xstyle)}>
      {/* Decorative gauge — the labels beneath are the real controls. */}
      <div aria-hidden={true} {...stylex.props(styles.track)} onClick={handleTrackClick}>
        <div {...stylex.props(styles.trackFill, dynamic.fill(toneColor[tone], fillPct))} />
      </div>
      <div {...stylex.props(styles.labels)}>
        {stops.map((stop, index) => {
          const isSelected = index === selectedIndex;
          return (
            <button
              key={stop.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              tabIndex={isSelected ? 0 : -1}
              {...stylex.props(
                styles.label,
                isSelected && styles.labelSelected,
                isSelected && dynamic.selectedColor(toneColor[stop.tone]),
              )}
              onClick={() => {
                stepTo(index);
              }}
              onKeyDown={handleKeyDown}
            >
              {stop.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export { PresetDial };
export type { PresetDialProps, PresetDialStop, PresetTone };
