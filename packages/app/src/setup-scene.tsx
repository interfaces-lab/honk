// Shared chrome for the /setup route.
//
// One system for every step: a full-bleed gradient backdrop that never changes
// between steps, a centered reading column, one panel divided by hairlines
// (never sibling cards), and a centered Back/Next footer. There is no progress
// bar — the step's own title says where you are, and the choice on the opening
// screen already told you how long this will take.
//
// The backdrop's construction follows imputnet/helium-onboarding, whose shader
// is the reference this surface was designed against: a wash built from soft
// highlight bands whose centers ride two out-of-phase sine waves (never hard
// edges), plus a quantized 180px grain blended in overlay, because a wide
// low-contrast wash bands badly on 8-bit displays without it. The backdrop also
// dims behind the configure steps and returns to full strength on the opening
// and closing screens, so brightness tracks whether the screen is a moment or a
// task.

import * as stylex from "@stylexjs/stylex";
import { Button, Icon, Text, type Glyph } from "@honk/ui";
import { IconArrowLeft, IconArrowRight } from "@honk/ui/icons";
import { colorVars, controlVars, motionVars, radiusVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as React from "react";

import { setupLayout } from "./setup-scene.stylex";

// Helium's construction, not a mesh of circles: soft vertical wave bands whose
// stops ramp all the way to transparent, so the field has no edge and no round
// feature anywhere in it. Two bands with co-prime periods drift in opposite
// directions, and each is masked to its own half of the window, so what you see
// is their interference rather than either pattern. A repeating gradient only
// loops seamlessly along its own axis, which is why the bands are vertical and
// the travel is purely horizontal.
const BAND_A_PERIOD = "440px";
const BAND_A_WIDTH = "calc(100% + 440px)";
const BAND_A_DURATION = "42s";
const BAND_B_PERIOD = "700px";
const BAND_B_WIDTH = "calc(100% + 700px)";
const BAND_B_DURATION = "67s";
const BACKDROP_DIM_DURATION = "1s";
const BACKDROP_DIM_OPACITY = 0.5;
// Helium's grain: one 180px cell, overlay-blended, barely above the noise floor.
// Without it a wash this wide and this low-contrast bands on 8-bit displays.
const GRAIN_TILE = "180px";
const GRAIN_OPACITY = 0.055;
const GRAIN_IMAGE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23g)' opacity='0.5'/%3E%3C/svg%3E\")";
// Each band occupies one half of the window and fades out well before the other
// end, so the two never stack into a uniform slab.
const BAND_A_MASK = "linear-gradient(180deg, black 0%, transparent 82%)";
const BAND_B_MASK = "linear-gradient(0deg, black 0%, transparent 78%)";
// The window is only 40px of titlebar; the rest must stay clickable. A
// full-window drag region swallows mouse events in Electron, and the no-drag
// opt-outs in index.css are written for a titlebar strip, not a whole surface.
const DRAG_STRIP_HEIGHT = "40px";

// A step arrives the way Helium's pages do: rising through a blur rather than
// sliding. The blur is what makes a whole-window change read as one move.
const SCENE_ENTER_DURATION = "340ms";
const SCENE_ENTER_DELAY = "50ms";
const SCENE_ENTER_RISE = "24px";
const SCENE_ENTER_BLUR = "8px";

const STEP_TITLE_SIZE = "26px";
const STEP_TITLE_LEADING = "32px";
const STEP_SUBTITLE_SIZE = "16px";
const STEP_SUBTITLE_LEADING = "24px";
// The subtitle wraps tighter than the panel so the header reads as a caption
// over the content rather than a paragraph the width of the page.
const STEP_SUBTITLE_WIDTH = "460px";
const PANEL_ROW_MIN_HEIGHT = "56px";
const PANEL_CONTROL_WIDTH = "180px";
// Content fades out at the bottom edge instead of being cut by the scroll box.
// `black` here is mask alpha, not a color: the mask only reads the alpha channel.
const SCROLL_FADE_MASK = "linear-gradient(to bottom, black 92%, transparent 100%)";

// A wash strong enough to read on a near-black surface is oppressive on a
// near-white one, so each scheme gets its own strength. `light-dark()` resolves
// against the same `color-scheme` the rest of the theme uses, which an explicit
// light/dark preference sets — a `prefers-color-scheme` query would desync from
// it. These are plain strings because StyleX only inlines statically known
// values inside `create`; a helper call there is a build error, not a runtime one.
const ACCENT = colorVars["--honk-color-accent"];
const BAND_A_TINT = `light-dark(color-mix(in srgb, ${ACCENT} 26%, transparent), color-mix(in srgb, ${ACCENT} 40%, transparent))`;
const BAND_B_TINT = `light-dark(color-mix(in srgb, ${ACCENT} 18%, transparent), color-mix(in srgb, ${ACCENT} 30%, transparent))`;
const DEPTH_TOP = `light-dark(color-mix(in srgb, ${ACCENT} 14%, transparent), color-mix(in srgb, ${ACCENT} 20%, transparent))`;
const DEPTH_BOTTOM = `color-mix(in srgb, ${colorVars["--honk-color-bg-inverse"]} 10%, transparent)`;

const bandATravel = stylex.keyframes({
  from: { translate: "0 0" },
  to: { translate: `-${BAND_A_PERIOD} 0` },
});

const bandBTravel = stylex.keyframes({
  from: { translate: `-${BAND_B_PERIOD} 0` },
  to: { translate: "0 0" },
});

const sceneEnter = stylex.keyframes({
  from: {
    opacity: 0,
    translate: `0 ${SCENE_ENTER_RISE}`,
    filter: `blur(${SCENE_ENTER_BLUR})`,
  },
  to: { opacity: 1, translate: "0 0", filter: "blur(0)" },
});

const styles = stylex.create({
  backdrop: {
    position: "fixed",
    inset: 0,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    backgroundColor: colorVars["--honk-color-bg-base"],
    color: colorVars["--honk-color-text-primary"],
  },
  depth: {
    position: "absolute",
    inset: 0,
    backgroundImage: `linear-gradient(180deg, ${DEPTH_TOP} 0%, transparent 55%), linear-gradient(0deg, ${DEPTH_BOTTOM} 0%, transparent 45%)`,
  },
  band: {
    position: "absolute",
    insetBlock: 0,
    insetInlineStart: 0,
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
    willChange: "translate",
  },
  bandA: {
    width: BAND_A_WIDTH,
    backgroundImage: `repeating-linear-gradient(90deg, transparent 0px, ${BAND_A_TINT} 220px, transparent 440px)`,
    maskImage: BAND_A_MASK,
    animationName: {
      default: bandATravel,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    animationDuration: {
      // oxlint-disable-next-line honk/design-no-raw-values -- ambient backdrop travel is an order of magnitude past the interaction ramp; no motion-duration token owns it
      default: BAND_A_DURATION,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
  },
  bandB: {
    width: BAND_B_WIDTH,
    backgroundImage: `repeating-linear-gradient(90deg, transparent 0px, ${BAND_B_TINT} 350px, transparent 700px)`,
    maskImage: BAND_B_MASK,
    animationName: {
      default: bandBTravel,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    animationDuration: {
      // oxlint-disable-next-line honk/design-no-raw-values -- ambient backdrop travel is an order of magnitude past the interaction ramp; no motion-duration token owns it
      default: BAND_B_DURATION,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
  },
  // One wrapper so the whole wash dims as a unit; the layers inside position
  // against it rather than the window.
  wash: {
    position: "absolute",
    inset: 0,
    overflow: "hidden",
    transitionProperty: "opacity",
    transitionDuration: {
      // oxlint-disable-next-line honk/design-no-raw-values -- the backdrop dims over a full second so brightness reads as the room changing, not a control reacting; no motion-duration token owns it
      default: BACKDROP_DIM_DURATION,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
  },
  washDimmed: {
    opacity: BACKDROP_DIM_OPACITY,
  },
  // Only the titlebar strip drags. Making the whole backdrop a drag region
  // hands every pointer event to the OS, which is why the buttons stopped
  // responding; index.css's no-drag opt-outs assume a strip, not a surface.
  dragStrip: {
    position: "absolute",
    insetBlockStart: 0,
    insetInline: 0,
    height: DRAG_STRIP_HEIGHT,
    zIndex: 2,
  },
  grain: {
    position: "absolute",
    inset: 0,
    backgroundImage: GRAIN_IMAGE,
    backgroundRepeat: "repeat",
    backgroundSize: `${GRAIN_TILE} ${GRAIN_TILE}`,
    opacity: GRAIN_OPACITY,
    mixBlendMode: "overlay",
  },
  content: {
    position: "relative",
    zIndex: 1,
    minHeight: 0,
    flexGrow: 1,
    display: "flex",
    flexDirection: "column",
  },
  scene: {
    minHeight: 0,
    flexGrow: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    overflowY: "auto",
    maskImage: SCROLL_FADE_MASK,
    paddingBlockStart: setupLayout.topClearance,
    paddingBlockEnd: {
      default: setupLayout.edgePad,
      [setupLayout.compactMedia]: setupLayout.edgePadCompact,
    },
    paddingInline: {
      default: setupLayout.edgePad,
      [setupLayout.compactMedia]: setupLayout.edgePadCompact,
    },
    animationName: {
      default: sceneEnter,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    animationDuration: {
      // oxlint-disable-next-line honk/design-no-raw-values -- 340ms matches the reference's page cross-dissolve, longer than the control ramp because the whole window moves; no motion-duration token owns it
      default: SCENE_ENTER_DURATION,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    animationDelay: {
      // oxlint-disable-next-line honk/design-no-raw-values -- the incoming step waits out the outgoing one; no motion-duration token owns this offset
      default: SCENE_ENTER_DELAY,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    animationTimingFunction: motionVars["--honk-motion-ease-float"],
    animationFillMode: "both",
  },
  // The step body centers as a block but never grows past the reading measure,
  // so a five-row panel and a two-row panel share one optical center line.
  column: {
    width: "100%",
    maxWidth: setupLayout.column,
    marginBlock: "auto",
    display: "grid",
    justifyItems: "center",
    gap: setupLayout.edgePadCompact,
  },
  header: {
    display: "grid",
    justifyItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    textAlign: "center",
  },
  headline: {
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
  },
  subtitle: {
    maxWidth: STEP_SUBTITLE_WIDTH,
  },
  panel: {
    width: "100%",
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    borderRadius: radiusVars["--honk-radius-panel"],
    // Translucent so the drifting backdrop stays visible through the panel and
    // the step never reads as a window pasted onto a wallpaper.
    backgroundColor: `color-mix(in srgb, ${colorVars["--honk-color-bg-base"]} 78%, transparent)`,
    borderWidth: controlVars["--honk-control-border-width"],
    borderStyle: "solid",
    borderColor: colorVars["--honk-color-border-muted"],
    backdropFilter: "blur(20px)",
    overflow: "hidden",
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: setupLayout.edgePadCompact,
    minHeight: PANEL_ROW_MIN_HEIGHT,
    padding: setupLayout.edgePadCompact,
    textAlign: "start",
    borderBlockStartWidth: {
      default: 0,
      ":not(:first-child)": controlVars["--honk-control-border-width"],
    },
    borderBlockStartStyle: "solid",
    borderBlockStartColor: colorVars["--honk-color-border-muted"],
  },
  rowCopy: {
    minWidth: 0,
    flexGrow: 1,
    display: "grid",
    gap: controlVars["--honk-control-gap"],
  },
  rowControl: {
    flexShrink: 0,
    maxWidth: PANEL_CONTROL_WIDTH,
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: controlVars["--honk-control-gap"],
  },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: spaceVars["--honk-space-gutter"],
  },
});

export function SetupBackdrop({
  isDimmed,
  children,
}: {
  readonly isDimmed: boolean;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <div {...stylex.props(styles.backdrop)}>
      <div aria-hidden={true} {...stylex.props(styles.wash, isDimmed && styles.washDimmed)}>
        <div {...stylex.props(styles.depth)} />
        <div {...stylex.props(styles.band, styles.bandA)} />
        <div {...stylex.props(styles.band, styles.bandB)} />
      </div>
      <div aria-hidden={true} {...stylex.props(styles.grain)} />
      <div {...stylex.props(styles.content)}>{children}</div>
      {/* Setup draws no titlebar, so this strip stands in for one: it is the
          only part of the window that drags, and nothing interactive sits
          under it. */}
      <div aria-hidden={true} data-shell-drag-region="" {...stylex.props(styles.dragStrip)} />
    </div>
  );
}

/**
 * One configure step. Each step mounts a fresh scene, which replays the settle
 * animation — the only cue that the screen advanced now that there is no
 * progress bar.
 */
export function SetupScene({
  icon,
  title,
  description,
  children,
}: {
  readonly icon: Glyph;
  readonly title: string;
  readonly description: string;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <div {...stylex.props(styles.scene)}>
      <div {...stylex.props(styles.column)}>
        <div {...stylex.props(styles.header)}>
          <div {...stylex.props(styles.headline)}>
            <Icon icon={icon} size="xl" tone="muted" />
            <Text
              as="div"
              role="heading"
              aria-level={1}
              size="xl"
              weight="semibold"
              // oxlint-disable-next-line honk/design-no-raw-values -- setup titles use a fixed display size/leading pair above the product type ramp; no font token owns display type
              style={{ fontSize: STEP_TITLE_SIZE, lineHeight: STEP_TITLE_LEADING }}
            >
              {title}
            </Text>
          </div>
          <Text
            as="p"
            tone="muted"
            style={{
              // oxlint-disable-next-line honk/design-no-raw-values -- setup subtitles sit one step above the prose ramp to pair with the display title; no font token owns them
              fontSize: STEP_SUBTITLE_SIZE,
              // oxlint-disable-next-line honk/design-no-raw-values -- paired leading for the size above; no font token owns this ramp step
              lineHeight: STEP_SUBTITLE_LEADING,
              maxWidth: STEP_SUBTITLE_WIDTH,
              textWrap: "pretty",
            }}
          >
            {description}
          </Text>
        </div>
        {children}
      </div>
    </div>
  );
}

export function SetupPanel({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <section aria-label={label} {...stylex.props(styles.panel)}>
      {children}
    </section>
  );
}

export function SetupRow({
  title,
  description,
  control,
}: {
  readonly title: string;
  readonly description: string;
  readonly control: React.ReactNode;
}): React.ReactElement {
  return (
    <div {...stylex.props(styles.row)}>
      <div {...stylex.props(styles.rowCopy)}>
        <Text as="p" size="sm" weight="semibold">
          {title}
        </Text>
        <Text as="p" size="sm" tone="muted">
          {description}
        </Text>
      </div>
      <div {...stylex.props(styles.rowControl)}>{control}</div>
    </div>
  );
}

export function SetupFooter({
  onBack,
  onNext,
  nextLabel,
  isNextBusy = false,
}: {
  readonly onBack: () => void;
  readonly onNext: () => void;
  readonly nextLabel: string;
  readonly isNextBusy?: boolean;
}): React.ReactElement {
  return (
    <div {...stylex.props(styles.footer)}>
      <Button
        size="md"
        variant="quiet"
        iconStart={<Icon icon={IconArrowLeft} size="sm" />}
        onClick={onBack}
      >
        Back
      </Button>
      <Button
        size="md"
        variant="primary"
        disabled={isNextBusy}
        iconEnd={<Icon icon={IconArrowRight} size="sm" />}
        onClick={onNext}
      >
        {nextLabel}
      </Button>
    </div>
  );
}
