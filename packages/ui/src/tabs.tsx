// The thread-tab plane — honk's browser-grade titlebar tabs, the whole concept in one file
// (ADR 0011 one-file-per-concept). Anatomy comes from the locked board (§0 "tab + status
// language" + §1 in the locked design board); the --tab-bg technique from opencode;
// everything expressed as StyleX 0.19 per the charter.
//
// PRESENTATIONAL ONLY. This component owns geometry, the status vocabulary, and pointer
// gestures; it holds NO tab state. The consumer (an external store per ADR 0025 —
// dev/tab-store.ts is the dress rehearsal, the router-coupled store is the real thing) passes
// the tab list down and receives intents back: onActivate (fired on MOUSEDOWN, like real
// browsers), onClose (the hover-reveal ×, or middle-click), onReorder (pointer-capture drag —
// deliberately NOT HTML5 drag, which conflicts with window drag regions), onNew (the + button).
//
// Doctrines in force:
//   • StyleX charter: tokens only (the named intrinsics below are the justified exceptions);
//     on-self selectors only — anything cross-element (separator suppression, compact mode,
//     drag targets) is computed in JS, because React already knows the whole list.
//   • React doctrine (ADR 0025): ZERO useEffect. The one imperative-DOM job (measuring the
//     strip) attaches a ResizeObserver in a callback ref — the canonical example the ADR names.
//     Drag-in-progress is ephemeral interaction state, so useState/useRef are allowed.

import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { Icon } from "./icon";
import { IconCrossSmall, IconFolder1, IconHome, IconPlusSmall } from "./icons";
import { Matrix } from "./matrix";
import { StatusDot } from "./status-dot";
import { colorVars, controlVars, fontVars, radiusVars, shellVars } from "./tokens.stylex";
import { AnchoredTooltip } from "./tooltip";
import type { TooltipAnchor } from "./tooltip";

// ── Public shape ───────────────────────────────────────────────────────────────────────────

// What the strip needs to know about one tab — a plain read-model row, no store types leak in.
interface HomeTabDescriptor {
  key: string;
  title: string;
  // Home is the pinned anchor: auto width, no close button, never draggable.
  kind: "home";
  // The status slot is the product's status vocabulary (board §0): matrix glyph = working,
  // green = done, amber pulse = needs you, red = failed, hollow ring = draft, layer-03 = idle.
  status: "idle" | "working" | "needs-you" | "done" | "failed" | "draft";
}

type ThreadRepository =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly label: string }
  | { readonly state: "unavailable" };

interface ThreadTabDescriptor {
  key: string;
  title: string;
  kind: "thread";
  status: HomeTabDescriptor["status"];
  // OpenCode resolves project identity from the session directory before painting its avatar.
  // Keep that lifecycle explicit so the tab can show honest loading chrome instead of a blank slot.
  repository: ThreadRepository;
}

type TabDescriptor = HomeTabDescriptor | ThreadTabDescriptor;

interface TabStripProps {
  tabs: readonly TabDescriptor[];
  activeKey: string;
  // Function-typed properties (not method shorthand) so destructuring them stays lint-clean
  // (typescript/unbound-method) — consumers pass store actions, which are plain functions.
  onActivate: (key: string) => void;
  onClose: (key: string) => void;
  onReorder: (from: number, to: number) => void;
  onNew: () => void;
  // Caller override, merged last (charter merge order).
  xstyle?: stylex.StyleXStyles;
}

// ── Tab-anatomy intrinsics (non-tokenized, justified per the stylex skill) ─────────────────
// The locked board's tab-interior geometry (locked.html §1 .tab/.slot/.sdot rules). These are
// the anatomy of THIS component — private numbers proportioned to the shell tokens' 28px tab,
// not shared vocabulary — so they stay named constants here; promote one to tokens.stylex.ts
// only when a second consumer appears.
const TAB_PADDING_X = "6px"; // thread-tab inner inset
const HOME_PADDING_X = "10px"; // Home hugs its content, so it breathes a little wider
const TAB_CONTENT_GAP = "6px"; // slot → title spacing
const STATUS_SLOT_SIZE = "16px"; // the fixed status box at the left of every tab
const STATUS_DOT_SIZE = "8px"; // the round status dot centered in the slot
const DRAFT_RING_WIDTH = "1.5px"; // hollow draft ring stroke (board .sdot.hollow inset)
const AVATAR_RING_WIDTH = "0.5px"; // OpenCode v2 project-avatar inset edge
const AVATAR_STATUS_OFFSET = "-2px"; // tucks the 6px status dot onto the avatar corner
const SEPARATOR_WIDTH = "1.5px"; // the between-tab pill
const SEPARATOR_HEIGHT = "12px";
const CLOSE_SCRIM_WIDTH = "10px"; // how far the close button's fade-out scrim reaches left
// 16px slot ÷ 20px rendered matrix (5 × 4px cells): shrink the sacred glyph to fit without
// touching its geometry, exactly as the board does with transform:scale(.8).
const MATRIX_FIT_SCALE = 0.8;
// The needs-you pulse shares the matrix sweep's 1.2s cadence so the strip's two "look at me"
// rhythms never beat against each other.
const ATTENTION_PULSE_DURATION = "1.2s";
// How dim the amber dot breathes at the trough of the pulse — deep enough to read as motion,
// never so faint the dot seems to vanish.
const ATTENTION_PULSE_TROUGH = 0.35;
// Below this average slot width the strip goes icon-only (ADR 0025 §3's 64px mode).
const COMPACT_MIN_SLOT_WIDTH = 64;
// Horizontal travel (px) before a pointerdown becomes a reorder drag instead of a click.
const DRAG_ACTIVATION_DISTANCE = 4;
// Hover dwell (ms) before a tab's title tooltip appears. Longer than the general Tooltip's 500ms:
// tabs are scrubbed across fast, and a tooltip only helps a truncated/compact tab anyway, so the
// delay leans toward opencode's 2000ms tab-preview feel without matching its rich card.
const TAB_TOOLTIP_OPEN_DELAY_MS = 700;

// ── Strip styles ───────────────────────────────────────────────────────────────────────────

const stripStyles = stylex.create({
  strip: {
    display: "flex",
    alignItems: "center",
    // OpenCode keeps its Home and + buttons outside the 13.5px thread-tab sequence. The outer
    // chrome uses the regular 6px control gap; threadList owns the wider separator lanes below.
    gap: controlVars["--honk-control-gap"],
    height: shellVars["--honk-shell-tab-h"],
    minWidth: 0,
    // tabs are gesture surfaces (mousedown-activate, pointer drag) — never selectable text
    userSelect: "none",
  },
  threadList: {
    display: "flex",
    alignItems: "center",
    gap: shellVars["--honk-shell-tab-gap"],
    minWidth: 0,
    flexShrink: 1,
  },
  // Between-tab separator pills are JS-computed children (stylex skill, Parent-state: no sibling
  // selectors). A zero-width lane with negative half-gap margins nets out to nothing, so
  // inserting or removing one never changes tab spacing — the pill just floats centered in
  // the flex gap the strip already has.
  separatorLane: {
    width: 0,
    marginInline: `calc(${shellVars["--honk-shell-tab-gap"]} * -0.5)`,
    alignSelf: "stretch",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    pointerEvents: "none", // purely decorative — clicks and drags belong to the tabs
  },
  separator: {
    width: SEPARATOR_WIDTH,
    height: SEPARATOR_HEIGHT,
    flexShrink: 0,
    borderRadius: radiusVars["--honk-radius-pill"],
    // A hairline divider, not a surface fill: the between-tab pill takes the border vocabulary
    // (border-base = 10% fg alpha, the stroke ladder's divider step) so it composites on the
    // titlebar surface and never reads as the layer-02 active-tab fill sitting beside it. It is
    // already suppressed next to the active tab by the JS separator loop in TabStrip.
    backgroundColor: colorVars["--honk-color-border-base"],
  },
  // The + button: a tab-height square at the end of the strip.
  newButton: {
    width: shellVars["--honk-shell-tab-h"],
    height: shellVars["--honk-shell-tab-h"],
    flexShrink: 0,
    display: "grid",
    placeItems: "center",
    padding: 0,
    borderStyle: "none",
    borderRadius: radiusVars["--honk-radius-control"],
    // The + sits on the TITLEBAR (bg-deep), like the tabs — so its hover fill must be the chrome
    // step tab-hover, NOT the card-relative layer-01. On the light titlebar layer-01 (#f6f6f6) is
    // LIGHTER than the bar (#f3f3f3) → an invisible hover (the exact backwards-ladder defect the
    // tab fills were fixed for); tab-hover is computed monotonic over bg-deep. Muted glyph →
    // primary on hover, unchanged.
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-tab-hover"] },
    },
    color: {
      default: colorVars["--honk-color-text-muted"],
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-text-primary"] },
    },
    fontFamily: "inherit",
    lineHeight: 1, // the + is an <Icon> (self-sized); keep the button's own line box collapsed
  },
});

// ── Tab styles ─────────────────────────────────────────────────────────────────────────────

const tabStyles = stylex.create({
  // THE --tab-bg PATTERN (opencode technique, board §0 law): the tab declares ONE private
  // custom prop that both its own backgroundColor and the close button's scrim gradient read.
  // Hover is the tab's own condition here; active is a JS pick (`active` below) because the
  // strip already knows activeKey — no attribute selector needed. `--_` prefix = private,
  // never themed (stylex skill, Parent-state alternative 1: private --_vars).
  base: {
    // Material-step fill ladder over the TITLEBAR surface (tabs live on bg-deep by board law):
    // Idle and hover use the neutral chrome ladder. The persistent active state below switches to
    // ALF primary_50 so selection cannot be mistaken for another transient gray hover. Fills stay
    // opaque so the close scrim below can occlude the title.
    "--_tab-bg": {
      default: "transparent",
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-tab-hover"] },
    },
    // parent-sets-var reveal: children read var(--_reveal, 0) — the close button fades in
    // under the tab's OWN hover, with no descendant selector anywhere.
    "--_reveal": {
      default: "0",
      ":hover": { "@media (hover: hover)": "1" },
    },
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: TAB_CONTENT_GAP,
    height: shellVars["--honk-shell-tab-h"],
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: "var(--_tab-bg)",
    overflow: "hidden", // long titles run under the close scrim and clip at the radius
  },
  thread: {
    width: shellVars["--honk-shell-tab-max-w"],
    minWidth: shellVars["--honk-shell-tab-min-w"],
    flexShrink: 1,
    paddingInline: TAB_PADDING_X,
    // pointer-capture reorder owns horizontal gestures; without this, touch browsers steal
    // the drag for scrolling and fire pointercancel mid-reorder.
    touchAction: "none",
  },
  home: {
    width: "auto",
    paddingInline: HOME_PADDING_X,
    flexShrink: 0, // the pinned anchor never collapses — thread tabs absorb all the squeeze
  },
  // Active state, resolved in JS (stylex skill, Parent-state alternative 3 — the strip knows activeKey). The element
  // also carries a data-active attribute purely as a DOM contract for consumers/tests;
  // styling never depends on it.
  active: {
    "--_tab-bg": colorVars["--honk-color-accent-subtle"],
    "--_reveal": "1", // active tabs always show their close — the only touch path to it
  },
  // While being reorder-dragged: ride above neighbors (the translateX is `dynamic.dragShift`).
  dragging: {
    zIndex: 1,
  },
  slot: {
    width: STATUS_SLOT_SIZE,
    height: STATUS_SLOT_SIZE,
    flexShrink: 0,
    display: "grid",
    placeItems: "center",
    position: "relative",
    overflow: "visible",
    // the matrix glyph paints in currentColor; the board renders it text-muted
    color: colorVars["--honk-color-text-muted"],
    fontSize: fontVars["--honk-font-size-body"],
  },
  title: {
    minWidth: 0,
    overflow: "hidden",
    // Ellipsize instead of hard-clipping mid-glyph: the close scrim only exists while the close
    // is revealed (hover/active), so an idle squeezed tab would otherwise slice its last glyph.
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    // 12px = the shipped app's fixed tab text (--honk-text-tab, app tokens.css:72-73; the tab
    // variant renders text-honk-tab in workbench-button.tsx:27) — one step below the 13px chrome
    // body, so tab titles read as chrome type, not prose.
    fontSize: fontVars["--honk-font-size-detail"],
    fontWeight: fontVars["--honk-font-weight-medium"],
    // Idle muted → primary on hover. Tab labels are interactive text, so they cannot use the
    // intentionally sub-AA faint role even before the tab becomes active. Active pins primary via
    // titleActive, applied after this style so
    // it overrides the whole color rule. Self-hover only (charter: no descendant selectors) — the
    // title spans the tab, so hovering the tab hovers the title.
    color: {
      default: colorVars["--honk-color-text-muted"],
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-text-primary"] },
    },
  },
  titleActive: {
    color: colorVars["--honk-color-text-primary"],
  },
  // The hover-reveal close: absolutely parked on the tab's right edge. Its scrim gradient
  // reads the SAME --_tab-bg the tab paints, so the title fades out underneath and the scrim
  // matches transparent, hover, and active backgrounds for free.
  close: {
    position: "absolute",
    insetBlock: 0,
    insetInlineEnd: 0,
    display: "flex",
    alignItems: "center",
    paddingInlineStart: CLOSE_SCRIM_WIDTH,
    paddingInlineEnd: TAB_PADDING_X,
    borderStyle: "none",
    backgroundColor: "transparent",
    backgroundImage: `linear-gradient(to right, transparent, var(--_tab-bg) ${CLOSE_SCRIM_WIDTH})`,
    color: {
      default: colorVars["--honk-color-text-muted"],
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-text-primary"] },
    },
    fontFamily: "inherit",
    lineHeight: 1, // the × is an <Icon> (self-sized); keep the button's own line box collapsed
    // Reveal is CSS-driven by the parent's var. A hidden close is only reachable on touch
    // (no hover there), and active tabs pin reveal to 1 — the accepted trade.
    opacity: "var(--_reveal, 0)",
  },
  // 16px slot ÷ 20px glyph: fit the matrix without altering its sacred geometry.
  matrixFit: {
    transform: `scale(${MATRIX_FIT_SCALE})`,
  },
  // The working/loading glyph's wrapper (ThreadIdentity's role="status" span). It must be a
  // grid-centered box, not an inline span: an inline wrapper gives the 20px Matrix a text line
  // box, so the glyph baseline-seats and pokes out of the 16px overflow-visible slot — the
  // "thinking tab" layout break. lineHeight 0 kills the stray descent entirely.
  statusWrap: {
    width: "100%",
    height: "100%",
    display: "grid",
    placeItems: "center",
    lineHeight: 0,
  },
  avatar: {
    width: "100%",
    height: "100%",
    boxSizing: "border-box",
    display: "grid",
    placeItems: "center",
    overflow: "hidden",
    borderWidth: AVATAR_RING_WIDTH,
    borderStyle: "solid",
    borderColor: colorVars["--honk-color-border-base"],
    borderRadius: radiusVars["--honk-radius-avatar"],
    backgroundColor: colorVars["--honk-color-layer-03"],
    color: colorVars["--honk-color-text-muted"],
    fontSize: fontVars["--honk-font-size-caption"],
    fontWeight: fontVars["--honk-font-weight-medium"],
    lineHeight: 1,
    textTransform: "uppercase",
    fontVariantNumeric: "tabular-nums",
  },
  avatarStatus: {
    position: "absolute",
    insetBlockStart: AVATAR_STATUS_OFFSET,
    insetInlineEnd: AVATAR_STATUS_OFFSET,
  },
  unavailableIcon: {
    color: colorVars["--honk-color-text-faint"],
  },
});

// ── Status vocabulary ──────────────────────────────────────────────────────────────────────

// The needs-you pulse: the amber dot breathes. Reduced-motion pins it fully opaque (a still
// amber dot still says "needs you"); the 0s sibling satisfies create() rule 7 (reduced-motion sibling).
const attentionPulse = stylex.keyframes({
  "0%": { opacity: 1 },
  "50%": { opacity: ATTENTION_PULSE_TROUGH },
  "100%": { opacity: 1 },
});

const statusStyles = stylex.create({
  dot: {
    width: STATUS_DOT_SIZE,
    height: STATUS_DOT_SIZE,
    flexShrink: 0,
    borderRadius: radiusVars["--honk-radius-pill"],
  },
  done: { backgroundColor: colorVars["--honk-color-ok-fg"] },
  needsYou: {
    backgroundColor: colorVars["--honk-color-warn-fg"],
    animationName: {
      default: attentionPulse,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    animationDuration: {
      default: ATTENTION_PULSE_DURATION,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite",
  },
  failed: { backgroundColor: colorVars["--honk-color-err-fg"] },
  idle: { backgroundColor: colorVars["--honk-color-layer-03"] },
  // draft = hollow ring: transparent fill, the stroke drawn inside the same 8px footprint
  draft: {
    backgroundColor: "transparent",
    boxSizing: "border-box",
    borderWidth: DRAFT_RING_WIDTH,
    borderStyle: "solid",
    borderColor: colorVars["--honk-color-text-faint"],
  },
});

const dynamic = stylex.create({
  // Reorder drag offset — a function style per the stylex skill (Dynamic rule 1: runtime values are never an
  // inline style object; StyleX inlines this as a CSS var).
  dragShift: (dx: number) => ({ transform: `translateX(${dx}px)` }),
});

// ── DOM helpers (event delegation targets) ─────────────────────────────────────────────────

function closestTab(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>("[data-tab-key]") : null;
}

function closestClose(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>("[data-tab-close]") : null;
}

// A press on the close must never start a reorder drag — stop pointerdown before the strip's
// delegated handler sees it. The paired compatibility mousedown still bubbles, so the strip's
// activate handler carries its own close guard.
function stopPointerDown(event: React.PointerEvent<HTMLButtonElement>): void {
  event.stopPropagation();
}

// ── Reorder geometry ───────────────────────────────────────────────────────────────────────

interface SlotRect {
  left: number;
  width: number;
}

// Every tab's on-screen box in index order. Only tabs carry data-tab-key, so separators and
// the + button are skipped for free.
function measureSlots(stripEl: HTMLElement | null): readonly SlotRect[] {
  if (stripEl === null) {
    return [];
  }
  return Array.from(stripEl.querySelectorAll<HTMLElement>("[data-tab-key]"), (el) => {
    const rect = el.getBoundingClientRect();
    return { left: rect.left, width: rect.width };
  });
}

// Where the dragged tab lands: its shifted center against each other slot's center over the
// cumulative slot widths — the classic "crossed the neighbor's midpoint" rule. minIndex keeps
// anything from landing before the pinned Home anchor.
function resolveTargetIndex(
  fromIndex: number,
  dx: number,
  slots: readonly SlotRect[],
  minIndex: number,
): number {
  const origin = slots[fromIndex];
  if (origin === undefined) {
    return fromIndex;
  }
  const center = origin.left + origin.width / 2 + dx;
  let target = fromIndex;
  for (let index = 0; index < slots.length; index += 1) {
    if (index === fromIndex) {
      continue;
    }
    const slot = slots[index];
    if (slot === undefined) {
      continue;
    }
    const slotCenter = slot.left + slot.width / 2;
    if (index < fromIndex && center < slotCenter) {
      target = Math.min(target, index);
    }
    if (index > fromIndex && center > slotCenter) {
      target = Math.max(target, index);
    }
  }
  return Math.max(minIndex, target);
}

// One in-flight reorder gesture, tracked between pointer events (mutable ref state).
interface DragSession {
  pointerId: number;
  startX: number;
  fromIndex: number;
  tabEl: HTMLElement;
  isDragging: boolean;
  // Slot geometry snapshotted when the drag activates. Transforms never affect layout, so
  // the snapshot stays valid for the whole gesture.
  slots: readonly SlotRect[] | null;
}

// ── The pieces ─────────────────────────────────────────────────────────────────────────────

// The status slot's content, one glyph per vocabulary word.
function StatusGlyph({ status }: { status: TabDescriptor["status"] }): React.ReactElement {
  switch (status) {
    case "working":
      // the signature glyph, scaled from its native 20px down to the 16px slot
      return <Matrix grid={5} xstyle={tabStyles.matrixFit} />;
    case "done":
      return <span {...stylex.props(statusStyles.dot, statusStyles.done)} />;
    case "needs-you":
      return <span {...stylex.props(statusStyles.dot, statusStyles.needsYou)} />;
    case "failed":
      return <span {...stylex.props(statusStyles.dot, statusStyles.failed)} />;
    case "draft":
      return <span {...stylex.props(statusStyles.dot, statusStyles.draft)} />;
    case "idle":
      return <span {...stylex.props(statusStyles.dot, statusStyles.idle)} />;
  }
}

function repositoryInitial(label: string): string {
  return Array.from(label.trim())[0] ?? "?";
}

function threadStatusTone(
  status: ThreadTabDescriptor["status"],
): "ok" | "warn" | "err" | "draft" | null {
  switch (status) {
    case "done":
      return "ok";
    case "needs-you":
      return "warn";
    case "failed":
      return "err";
    case "draft":
      return "draft";
    case "idle":
    case "working":
      return null;
  }
}

function ThreadIdentity({ tab }: { tab: ThreadTabDescriptor }): React.ReactElement {
  // OpenCode swaps the project avatar for its progress indicator while loading. Honk uses the
  // same swap both while repository metadata resolves and while the thread itself is working.
  if (tab.repository.state === "loading" || tab.status === "working") {
    return (
      <span
        role="status"
        aria-label={tab.repository.state === "loading" ? "Loading repository" : "Working"}
        {...stylex.props(tabStyles.statusWrap)}
      >
        <Matrix grid={5} xstyle={tabStyles.matrixFit} />
      </span>
    );
  }

  const tone = threadStatusTone(tab.status);
  return (
    <>
      {tab.repository.state === "ready" ? (
        <span aria-hidden={true} {...stylex.props(tabStyles.avatar)}>
          {repositoryInitial(tab.repository.label)}
        </span>
      ) : (
        <Icon icon={IconFolder1} size="sm" tone="faint" xstyle={tabStyles.unavailableIcon} />
      )}
      {tone !== null ? (
        <StatusDot
          tone={tone}
          pulse={tab.status === "needs-you"}
          label={tab.status}
          xstyle={tabStyles.avatarStatus}
        />
      ) : null}
    </>
  );
}

interface TabProps {
  tab: TabDescriptor;
  isActive: boolean;
  isCompact: boolean;
  // translateX in px while this tab is being reorder-dragged; null otherwise
  dragOffset: number | null;
}

// React.memo'd: during a drag only the dragged row's dragOffset changes, so every other tab
// skips re-rendering on each pointermove. All interaction handlers live on the strip (event
// delegation via the data-tab-* attributes), which keeps these props primitive/stable and
// the memo effective — the row itself carries zero callbacks.
const Tab = React.memo(function Tab({ tab, isActive, isCompact, dragOffset }: TabProps) {
  const isHome = tab.kind === "home";
  const accessibleName =
    tab.kind === "thread" && tab.repository.state === "ready"
      ? `${tab.title}, ${tab.repository.label}`
      : tab.title;
  return (
    <div
      role="tab"
      aria-selected={isActive}
      aria-label={accessibleName}
      data-tab-key={tab.key}
      // DOM contract only (tests, consumer CSS escapes) — StyleX styling never reads it
      data-active={isActive ? "" : undefined}
      // interactive chrome inside the titlebar drag region opts out of window dragging
      data-shell-no-drag=""
      {...stylex.props(
        tabStyles.base,
        isHome ? tabStyles.home : tabStyles.thread,
        isActive && tabStyles.active,
        dragOffset !== null && tabStyles.dragging,
        dragOffset !== null && dynamic.dragShift(dragOffset),
      )}
    >
      <span {...stylex.props(tabStyles.slot)}>
        {/* Home shows a central-icons home glyph at rest but lets a real status take the slot — the board's "worst
            status leaks through Home" law (§1 note 4). The consumer decides Home's status. */}
        {tab.kind === "home" ? (
          tab.status === "idle" ? (
            <Icon icon={IconHome} size="sm" />
          ) : (
            <StatusGlyph status={tab.status} />
          )
        ) : (
          <ThreadIdentity tab={tab} />
        )}
      </span>
      {!isHome && !isCompact && (
        <span
          data-tab-title=""
          {...stylex.props(tabStyles.title, isActive && tabStyles.titleActive)}
        >
          {tab.title}
        </span>
      )}
      {!isHome && (
        <button
          type="button"
          aria-label={`Close ${tab.title}`}
          data-tab-close={tab.key}
          onPointerDown={stopPointerDown}
          {...stylex.props(tabStyles.close)}
        >
          {/* The pack's close glyph. tone="current" inherits the button's color so the
              faint→primary hover (tabStyles.close) still drives it; decorative (the button owns the
              aria-label), sized to the tab-close footprint. */}
          <Icon icon={IconCrossSmall} size="xs" />
        </button>
      )}
    </div>
  );
});

// ── The strip ──────────────────────────────────────────────────────────────────────────────

function TabStrip({
  tabs,
  activeKey,
  onActivate,
  onClose,
  onReorder,
  onNew,
  xstyle,
}: TabStripProps): React.ReactElement {
  // ── Compact mode: ONE ResizeObserver attached in a callback ref ──
  // This is the canonical callback-ref example from ADR 0025: React hands the ref the element
  // on mount and null on unmount — attach the observer on the element, tear it down on null.
  // No useEffect anywhere in the lifecycle. useCallback([]) keeps the ref's identity stable so
  // React doesn't detach/re-attach it on every render.
  const [stripWidth, setStripWidth] = React.useState(0);
  const stripElRef = React.useRef<HTMLDivElement | null>(null);
  const observerRef = React.useRef<ResizeObserver | null>(null);
  const rafRef = React.useRef(0);

  const attachStrip = React.useCallback((el: HTMLDivElement | null): void => {
    if (el === null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      observerRef.current?.disconnect();
      observerRef.current = null;
      stripElRef.current = null;
      return;
    }
    stripElRef.current = el;
    const observer = new ResizeObserver(() => {
      // RAF-coalesced: a burst of resize notifications collapses into one measurement and one
      // state write per frame. Coalescing lives here with the observer, never in a component.
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        setStripWidth(el.getBoundingClientRect().width);
      });
    });
    observer.observe(el);
    observerRef.current = observer;
  }, []);

  // Derived at render rather than stored as a flag: a tab-count change re-evaluates
  // compactness immediately against the last measured width — no re-measure, no effect.
  const isCompact = stripWidth > 0 && stripWidth / tabs.length < COMPACT_MIN_SLOT_WIDTH;

  // ── Pointer reorder (ephemeral interaction state — useState/useRef sanctioned) ──
  // sessionRef tracks the gesture between events; `drag` is the slice the render needs
  // (which tab, how far). Handlers are delegated on the strip and re-created per render,
  // which is free because no memoized child receives them.
  const sessionRef = React.useRef<DragSession | null>(null);
  const [drag, setDrag] = React.useState<{ fromIndex: number; dx: number } | null>(null);

  const handleMouseDown = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (event.button !== 0) {
      return;
    }
    // A press acts; the title tooltip is now redundant chrome — dismiss it (and cancel any dwell).
    hideTabTooltip();
    // the close's pointerdown is stopped, but its paired mousedown still bubbles up here
    if (closestClose(event.target) !== null) {
      return;
    }
    const key = closestTab(event.target)?.dataset["tabKey"];
    if (key !== undefined) {
      onActivate(key); // activate on MOUSEDOWN, like real browsers — never wait for click
    }
  };

  const handleAuxClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (event.button !== 1) {
      return; // middle-click only
    }
    const key = closestTab(event.target)?.dataset["tabKey"];
    if (key === undefined) {
      return;
    }
    const tab = tabs.find((candidate) => candidate.key === key);
    if (tab === undefined || tab.kind === "home") {
      return; // Home never closes
    }
    event.preventDefault();
    onClose(key);
  };

  const handleClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    const key = closestClose(event.target)?.dataset["tabClose"];
    if (key !== undefined) {
      onClose(key);
    }
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) {
      return;
    }
    const tabEl = closestTab(event.target);
    if (tabEl === null) {
      return;
    }
    const key = tabEl.dataset["tabKey"];
    const fromIndex = tabs.findIndex((candidate) => candidate.key === key);
    const tab = fromIndex === -1 ? undefined : tabs[fromIndex];
    if (tab === undefined || tab.kind === "home") {
      return; // Home is not draggable
    }
    // record the origin only — the drag activates after 4px of horizontal travel
    sessionRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      fromIndex,
      tabEl,
      isDragging: false,
      slots: null,
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const session = sessionRef.current;
    if (session === null || event.pointerId !== session.pointerId) {
      return;
    }
    const dx = event.clientX - session.startX;
    if (!session.isDragging) {
      if (Math.abs(dx) < DRAG_ACTIVATION_DISTANCE) {
        return; // still a click, not a drag
      }
      session.isDragging = true;
      // capture: every move/up now retargets to the tab (and keeps bubbling up to the
      // strip's handlers), even once the pointer leaves the strip
      session.tabEl.setPointerCapture(session.pointerId);
      session.slots = measureSlots(stripElRef.current);
    }
    setDrag({ fromIndex: session.fromIndex, dx });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    const session = sessionRef.current;
    if (session === null || event.pointerId !== session.pointerId) {
      return;
    }
    if (session.isDragging && session.slots !== null) {
      // Home at index 0 is the fixed anchor — nothing may land before it.
      const minIndex = tabs[0]?.kind === "home" ? 1 : 0;
      const to = resolveTargetIndex(
        session.fromIndex,
        event.clientX - session.startX,
        session.slots,
        minIndex,
      );
      if (to !== session.fromIndex) {
        onReorder(session.fromIndex, to);
      }
    }
    sessionRef.current = null;
    setDrag(null);
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>): void => {
    const session = sessionRef.current;
    if (session === null || event.pointerId !== session.pointerId) {
      return;
    }
    sessionRef.current = null; // abort: no reorder
    setDrag(null);
    hideTabTooltip();
  };

  // ── Tab title tooltip (delegated → ONE controlled Base UI tooltip) ──
  // The memo'd Tab has no per-row handlers to hang a <Tooltip.Trigger> on, so hover is detected
  // here on the delegated pointerover/out (they bubble, unlike enter/leave) and drives a single
  // controlled AnchoredTooltip. `tip` is the only render-affecting state; it lives on the STRIP
  // and touches no Tab prop, so every memo'd Tab still skips on hover (React/UX mistake #2). The
  // anchor is a virtual element that reads the hovered tab's rect ON DEMAND (never a cached rect —
  // mistake #1), re-identified per tab (useMemo keyed on the tab key) so Base UI repositions. No
  // useEffect: `open` only flips inside event-handler-scheduled callbacks. The tooltip appears
  // only for an icon-only tab or a CLIPPED title (truncated, or hidden entirely in compact mode).
  const tooltipTimerRef = React.useRef(0);
  // The tab whose dwell is in flight — guards against restarting as the pointer crosses a tab's
  // own children (pointerover bubbles from every descendant).
  const tooltipKeyRef = React.useRef<string | null>(null);
  // The hovered tab element, read by the anchor function; never rendered.
  const anchorElRef = React.useRef<HTMLElement | null>(null);
  const [tip, setTip] = React.useState<{ key: string; title: string } | null>(null);

  // Function anchor: returns the live hovered tab so Base UI observes the real element (tracks its
  // position/size) rather than a snapshot rect. One stable function covers every tab — the host
  // swaps anchorElRef, not the prop (GPT-5.5 consult). Stable identity avoids re-anchor churn.
  const tooltipAnchor: TooltipAnchor = React.useMemo(
    () => (): HTMLElement | null => anchorElRef.current,
    [],
  );

  const clearTooltipTimer = (): void => {
    if (tooltipTimerRef.current !== 0) {
      clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = 0;
    }
  };

  const hideTabTooltip = (): void => {
    clearTooltipTimer();
    tooltipKeyRef.current = null;
    setTip(null);
  };

  const handlePointerOver = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === "touch") {
      return; // touch has no hover; the tab's own text is the accessible name
    }
    const tabEl = closestTab(event.target);
    if (tabEl === null) {
      hideTabTooltip();
      return;
    }
    const key = tabEl.dataset["tabKey"];
    if (key === undefined || key === tooltipKeyRef.current) {
      return; // same tab already handled (or a non-tab child) — don't restart the dwell
    }
    // A newly-hovered tab: reset any prior dwell, then decide if a tooltip would help.
    clearTooltipTimer();
    tooltipKeyRef.current = key; // claim it either way, so moving across its children won't re-check
    const tab = tabs.find((candidate) => candidate.key === key);
    if (tab === undefined) {
      return;
    }
    // Show for Home (always icon-only) or a clipped thread title: compact tabs hide the title
    // outright; otherwise the title span overflows its box. A fully-visible title needs no tooltip.
    const titleEl = tabEl.querySelector<HTMLElement>("[data-tab-title]");
    const isTitleClipped = titleEl !== null && titleEl.scrollWidth > titleEl.clientWidth;
    if (tab.kind !== "home" && !isCompact && !isTitleClipped) {
      return;
    }
    tooltipTimerRef.current = window.setTimeout(() => {
      // Still hovering the same tab when the dwell elapses?
      if (tooltipKeyRef.current === key) {
        anchorElRef.current = tabEl;
        setTip({ key, title: tab.title });
      }
    }, TAB_TOOLTIP_OPEN_DELAY_MS);
  };

  const handlePointerOut = (event: React.PointerEvent<HTMLDivElement>): void => {
    const tabEl = closestTab(event.target);
    if (tabEl === null) {
      return;
    }
    // Only when the pointer actually leaves the tab — moving between its own children fires
    // pointerout with relatedTarget still inside the tab, and must NOT dismiss.
    const related = event.relatedTarget;
    if (related instanceof Node && tabEl.contains(related)) {
      return;
    }
    hideTabTooltip();
  };

  // Tabs interleaved with JS-computed separators: a pill sits between neighbors UNLESS either
  // neighbor is active — the strip knows activeKey, so the board's `[data-active] + .tab`
  // suppression needs no CSS at all (stylex skill, Parent-state alternative 3: JS-resolved).
  const threadChildren: React.ReactNode[] = [];
  let homeTab: React.ReactNode = null;
  for (let index = 0; index < tabs.length; index += 1) {
    const tab = tabs[index];
    if (tab === undefined) {
      continue;
    }
    if (tab.kind === "home") {
      homeTab = (
        <Tab
          key={tab.key}
          tab={tab}
          isActive={tab.key === activeKey}
          isCompact={false}
          dragOffset={null}
        />
      );
      continue;
    }
    if (index > 0 && tabs[index - 1]?.kind === "thread") {
      const isBesideActive = tabs[index - 1]?.key === activeKey || tab.key === activeKey;
      if (!isBesideActive) {
        threadChildren.push(
          <span
            key={`separator-${tab.key}`}
            aria-hidden={true}
            {...stylex.props(stripStyles.separatorLane)}
          >
            <span {...stylex.props(stripStyles.separator)} />
          </span>,
        );
      }
    }
    threadChildren.push(
      <Tab
        key={tab.key}
        tab={tab}
        isActive={tab.key === activeKey}
        isCompact={isCompact}
        dragOffset={drag !== null && drag.fromIndex === index ? drag.dx : null}
      />,
    );
  }

  return (
    <div
      role="tablist"
      aria-label="Threads"
      ref={attachStrip}
      // Window-drag contract: attribute only. The -webkit-app-region CSS lives in the app
      // consumer's plain-CSS escape (ADR 0025 §5) — StyleX can't express that cross-element
      // cascade, so the strip merely marks itself and its controls (data-shell-no-drag).
      data-shell-drag-region=""
      onMouseDown={handleMouseDown}
      onAuxClick={handleAuxClick}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
      {...stylex.props(stripStyles.strip, xstyle)}
    >
      {homeTab}
      <div {...stylex.props(stripStyles.threadList)}>{threadChildren}</div>
      <button
        type="button"
        aria-label="New thread"
        data-shell-no-drag=""
        onClick={onNew}
        {...stylex.props(stripStyles.newButton)}
      >
        {/* The pack's add glyph; tone="current" inherits the button's muted color. */}
        <Icon icon={IconPlusSmall} size="sm" />
      </button>
      {/* ONE controlled tooltip for the whole strip (see handlePointerOver). Base UI portals it
          out of the titlebar, so the bar's overflow never clips it; the virtual anchor points it
          at the hovered tab. Closing intents from Base UI (Escape) route back through hideTabTooltip. */}
      <AnchoredTooltip
        open={tip !== null}
        onOpenChange={(next) => {
          if (!next) {
            hideTabTooltip();
          }
        }}
        anchor={tooltipAnchor}
      >
        {tip?.title}
      </AnchoredTooltip>
    </div>
  );
}

export { TabStrip };
export type { TabDescriptor, TabStripProps };
