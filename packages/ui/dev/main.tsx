// The @honk/ui story browser — a per-component library, NOT a remake of the app's UI (user
// ruling 2026-07-05): every component viewable in isolation, in all its states, tweakable
// through the dialkit rail. The real chat view gets composed later, in the actual app rebuild;
// nothing here is product chrome beyond what a single component's story needs.
//
// Layout: a left story rail (token-styled list nav) → the story canvas → the dialkit rail.
// One hash route per component story; StrictMode stays ON.
//
// Doctrines in force (ADR 0025 + the StyleX charter):
//   • ZERO useEffect anywhere. Stores are plain modules read via useSyncExternalStore; route
//     loaders are the only route→store seam (here only the index redirect needs it); event
//     handlers call store actions; timers live in dev/fake-thread.ts. Ephemeral story-local
//     interaction state (a disclosure toggle, the spec strip's local tab list) uses useState —
//     the same sanction tabs.tsx has for drag state.
//   • Tokens only in create() — the gallery-chrome intrinsics below are named constants with
//     justifications, per the tabs.tsx precedent.

/// <reference types="vite/client" />

import "dialkit/styles.css";

import * as stylex from "@stylexjs/stylex";
import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  redirect,
  RouterProvider,
  useRouterState,
} from "@tanstack/react-router";
import { DialRoot } from "dialkit";
import * as React from "react";
import { createRoot } from "react-dom/client";

import {
  AlertDialog,
  AnchoredTooltip,
  Badge,
  Button,
  ChangeReceipt,
  Checkbox,
  Dialog,
  Icon,
  IconButton,
  Kbd,
  Matrix,
  Menu,
  Popover,
  Separator,
  Shell,
  Spinner,
  StatusDot,
  StatusRow,
  Switch,
  TabStrip,
  Text,
  Toaster,
  Tooltip,
  TooltipProvider,
  ToolCallLine,
  UserMessage,
  WorkGroup,
  toast,
} from "../src";
import type { IconSize, IconTone, TabDescriptor, TextSize, TextTone, TextWeight } from "../src";
// The Icon story renders the curated set from data, and pulls a few representative glyphs for the
// size/tone demos — all straight from @honk/ui's own icon catalog, never the raw pack.
import {
  ICON_CATALOG,
  IconCircleCheck,
  IconConsole,
  IconCrossSmall,
  IconEyeOpen,
  IconMagnifyingGlass,
} from "../src/icons";
import {
  colorVars,
  elevationVars,
  fontVars,
  motionVars,
  radiusVars,
  shellVars,
  spaceVars,
} from "../src/tokens.stylex";
import {
  ConversationDials,
  DesignSystemDials,
  IconDials,
  ShellDials,
  TabsDials,
  TextDials,
  ThemeDials,
  ToastDials,
  useAppearance,
} from "./dials";
import type { Appearance } from "./dials";
import { startFake, stopFake, useFakeThread } from "./fake-thread";
import { useShellHotkeys } from "./hotkeys";
import type { ShellHotkeyActions } from "./hotkeys";
import { getTabsSnapshot, tabActions, useTabs } from "./tab-store";

// ── Gallery-chrome intrinsics (named, justified — not product vocabulary) ──────────────────
// The story rail's fixed width: sized to the longest story name, a fact of this dev tool.
const STORY_RAIL_WIDTH = "168px";
// The dial rail's fixed width: dialkit's inline panel is designed around ~280-300px.
const DIAL_RAIL_WIDTH = "300px";
// Vertical padding on a rail nav item — list-item anatomy of the gallery nav, not a product inset.
const RAIL_ITEM_PAD_Y = "4px";
// Breathing room between story sections on the canvas — gallery rhythm, not product spacing.
const SECTION_GAP = "28px";
// The story canvas's page inset — a generous, symmetric gutter so specimens never hug the region
// edges (gallery chrome, not product spacing).
const CANVAS_PAD = "32px";
// The centered reading column: the canvas fills the region full-width, but its content caps here and
// centers, so on a wide display the specimens sit in a comfortable column instead of stretching
// edge-to-edge. Sized to clear the widest specimen (the Shell demo window / design board, ~1120px).
const CONTENT_MAX_WIDTH = "1120px";
// The sliver between story-rail nav items, so adjacent hover/active fills never touch.
const RAIL_ITEM_GAP = "2px";
// The Shell story's full-fidelity demo window: proportions of the locked board's desktop frame
// (locked.html §1 .frame.desktop, 1120×640) — an honest window shape, demo-only geometry.
const DEMO_WINDOW_MAX_WIDTH = "1120px";
const DEMO_WINDOW_HEIGHT = "640px";
// The Shell story's small single-region specimen: throwaway demo geometry proportioned to the canvas.
const MINI_FRAME_WIDTH = "440px";
const MINI_FRAME_HEIGHT = "240px";
// Traffic-light stand-ins: 12px buttons, 8px apart, in the OS's stoplight colors — macOS
// chrome facts mirrored for the demo, not our vocabulary (the OS draws the real ones over the
// --honk-shell-inset-left reservation; centering 52px of dots in the 80px reservation lands the
// first button at x=14, exactly the shipped trafficLightPosition).
const TRAFFIC_LIGHT_SIZE = "12px";
const TRAFFIC_LIGHT_GAP = "8px";
const TRAFFIC_LIGHT_CLOSE = "#ff5f57";
const TRAFFIC_LIGHT_MINIMIZE = "#febc2e";
const TRAFFIC_LIGHT_ZOOM = "#28c840";
// A narrow box that forces <Text truncate> to actually truncate in its spec row.
const TRUNCATE_DEMO_WIDTH = "160px";
// Cap the conversation specimens at a readable column; the real timeline column (840px) is the
// future app's concern, not this gallery's.
const SPECIMEN_MAX_WIDTH = "560px";
// The icon-catalog grid cell: wide enough for the longest pack name (IconDotGrid1x3Horizontal) to
// sit under its glyph. A fact of THIS gallery's icon story, not product vocabulary.
const ICON_CELL_WIDTH = "148px";
// The Design-system page's radius swatch — a plain box big enough to read its corner rounding.
const DEMO_SWATCH_W = "72px";
const DEMO_SWATCH_H = "44px";

// ── Styles (tokens only; charter merge order at call sites) ────────────────────────────────

// The appearance dial → the frame's color-scheme. Shell pins 'light dark' on itself, so the
// dial can't reach it through <html>; this is the manual theme-toggle escape shell.tsx
// documents — override colorScheme via xstyle, never a duplicate token set. One static style
// per select option, picked in JS (stylex skill, Parent-state alternative 3: JS-resolved picks).
const schemeStyles = stylex.create({
  system: { colorScheme: "light dark" },
  light: { colorScheme: "light" },
  dark: { colorScheme: "dark" },
});

const styles = stylex.create({
  // The gallery's own three-column body inside the Sheet (the Shell no longer ships
  // Split/Region — content splits are the consumer's composition).
  galleryBody: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    minHeight: 0,
    display: "flex",
  },
  galleryCol: {
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    position: "relative",
    flexShrink: 1,
    flexBasis: "0%",
  },
  galleryColGrow: {
    flexGrow: 1,
  },
  galleryColDivided: {
    borderLeftWidth: "1px",
    borderLeftStyle: "solid",
    borderLeftColor: colorVars["--honk-color-border-muted"],
  },
  // Fixed-width side columns: the base sets flexBasis 0% + shrink 1, so pin both.
  storyRegion: {
    flexBasis: STORY_RAIL_WIDTH,
    flexShrink: 0,
  },
  dialRegion: {
    flexBasis: DIAL_RAIL_WIDTH,
    flexShrink: 0,
  },
  rail: {
    display: "flex",
    flexDirection: "column",
    gap: RAIL_ITEM_GAP,
    padding: spaceVars["--honk-space-gutter"],
    overflowY: "auto",
  },
  railHeading: {
    paddingInline: spaceVars["--honk-space-control-pad-x"],
    paddingBlock: RAIL_ITEM_PAD_Y,
  },
  railItem: {
    display: "block",
    paddingInline: spaceVars["--honk-space-control-pad-x"],
    paddingBlock: RAIL_ITEM_PAD_Y,
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-layer-01"] },
    },
    color: colorVars["--honk-color-text-muted"],
    textDecoration: "none",
    fontSize: fontVars["--honk-font-size-body"],
  },
  railItemActive: {
    backgroundColor: colorVars["--honk-color-layer-02"],
    color: colorVars["--honk-color-text-primary"],
    fontWeight: fontVars["--honk-font-weight-medium"],
  },
  // The scroll region: fills the middle Shell region, centers its content, and carries the page
  // inset. The section rhythm lives on the inner column so the padding + centering never fight it.
  canvas: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    minHeight: 0,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    paddingBlock: CANVAS_PAD,
    paddingInline: CANVAS_PAD,
  },
  // The centered reading column: full-width up to CONTENT_MAX_WIDTH, then it caps and the canvas's
  // align-items centers it. Owns the section-to-section rhythm.
  canvasInner: {
    width: "100%",
    maxWidth: CONTENT_MAX_WIDTH,
    display: "flex",
    flexDirection: "column",
    gap: SECTION_GAP,
  },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-gutter"],
  },
  specRow: {
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-panel-pad"],
    flexWrap: "wrap",
  },
  specColumn: {
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-gutter"],
    maxWidth: SPECIMEN_MAX_WIDTH,
  },
  // A fixed-width variant label so spec rows column-align.
  specLabel: {
    flexBasis: STORY_RAIL_WIDTH,
    flexShrink: 0,
  },
  // A status dot beside its own text label, read as one inline status.
  statusInline: {
    display: "inline-flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
  },
  // The icon catalog: glyphs wrap into a grid, each in a fixed-width cell so the names below them
  // column-align regardless of glyph width.
  iconGrid: {
    display: "flex",
    flexWrap: "wrap",
    gap: spaceVars["--honk-space-panel-pad"],
  },
  iconCell: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    width: ICON_CELL_WIDTH,
  },
  truncateBox: {
    width: TRUNCATE_DEMO_WIDTH,
  },
  // The Shell story's demo windows (height overrides the frame's 100dvh — xstyle merges last).
  // Window radius + the floating shadow are exactly what a window adds over the bare frame.
  demoWindow: {
    width: "100%",
    maxWidth: DEMO_WINDOW_MAX_WIDTH,
    height: DEMO_WINDOW_HEIGHT,
    flexShrink: 0,
    borderRadius: radiusVars["--honk-radius-window"],
    overflow: "hidden",
    boxShadow: elevationVars["--honk-elevation-floating"],
  },
  miniFrame: {
    height: MINI_FRAME_HEIGHT,
    width: MINI_FRAME_WIDTH,
    flexShrink: 0,
    borderRadius: radiusVars["--honk-radius-window"],
    overflow: "hidden",
    boxShadow: elevationVars["--honk-elevation-floating"],
  },
  // Anchors the absolutely-positioned traffic-light stand-ins to the titlebar's own box.
  titleBarAnchor: {
    position: "relative",
  },
  // The stand-in dots, centered in the titlebar's left inset (the exact space the OS owns).
  // Decorative only: pointer events off, so nothing pretends to be close/min/zoom.
  trafficLights: {
    position: "absolute",
    insetInlineStart: 0,
    insetBlock: 0,
    width: shellVars["--honk-shell-inset-left"],
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: TRAFFIC_LIGHT_GAP,
    pointerEvents: "none",
  },
  trafficLight: {
    width: TRAFFIC_LIGHT_SIZE,
    height: TRAFFIC_LIGHT_SIZE,
    flexShrink: 0,
    borderRadius: radiusVars["--honk-radius-pill"],
  },
  // The OS's stoplight fills (named intrinsics above) — a focused mac window shows color here,
  // and the grey stand-ins were half the wireframe feel. Still decorative, still inert.
  trafficLightClose: { backgroundColor: TRAFFIC_LIGHT_CLOSE },
  trafficLightMinimize: { backgroundColor: TRAFFIC_LIGHT_MINIMIZE },
  trafficLightZoom: { backgroundColor: TRAFFIC_LIGHT_ZOOM },
  // A region's placeholder content: top-anchored and inset by the card's panel-pad, so the
  // panelPad dial visibly moves it (a centered label would hide the inset).
  regionContent: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-gutter"],
    padding: spaceVars["--honk-space-panel-pad"],
    overflow: "hidden",
  },
  // The TabStrip specimens sit on the deep background, where the titlebar puts them.
  stripHost: {
    display: "flex",
    alignItems: "center",
    padding: spaceVars["--honk-space-gutter"],
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: colorVars["--honk-color-bg-deep"],
  },
  button: {
    height: shellVars["--honk-shell-tab-h"], // the shell's control height — reused, not re-invented
    width: "fit-content",
    paddingInline: spaceVars["--honk-space-control-pad-x"],
    borderStyle: "none",
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: {
      default: colorVars["--honk-color-layer-02"],
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-layer-03"] },
    },
    color: colorVars["--honk-color-text-primary"],
    fontFamily: "inherit",
    fontSize: fontVars["--honk-font-size-body"],
    fontWeight: fontVars["--honk-font-weight-medium"],
    transitionProperty: "background-color",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-fast"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
  },
});

// ── Shared story scaffolding ────────────────────────────────────────────────────────────────

// Counts render invocations of the component that calls it (not commits — StrictMode
// double-invokes and discarded renders count too, so the absolute number runs high). Only the
// RELATIVE story matters: streaming sections must climb while static gauges hold still.
// Deliberate dev-only Rules-of-React bend: a ref write during render is fine for a relative
// gauge but would be wrong (and Compiler-hostile) anywhere real.
function useRenderCount(): number {
  const renders = React.useRef(0);
  renders.current += 1;
  return renders.current;
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children?: React.ReactNode;
}): React.ReactElement {
  return (
    <section {...stylex.props(styles.section)}>
      <Text as="p" size="sm" tone="faint" weight="semibold">
        {title}
      </Text>
      {note !== undefined && (
        <Text as="p" size="sm" tone="faint">
          {note}
        </Text>
      )}
      {children}
    </section>
  );
}

function SpecLabel({ children }: { children: string }): React.ReactElement {
  return (
    <Text size="sm" tone="faint" family="mono" xstyle={styles.specLabel}>
      {children}
    </Text>
  );
}

// ── Story: Shell ────────────────────────────────────────────────────────────────────────────

// A region's neutral placeholder: it names the region's role in the window anatomy and nothing
// more — the gallery is a component library, never an app remake (user ruling), so no fake
// product UI lives inside the demo regions.
function RegionPlaceholder({
  title,
  children,
}: {
  title: string;
  children: string;
}): React.ReactElement {
  return (
    <div {...stylex.props(styles.regionContent)}>
      <Text size="base" tone="muted" weight="medium">
        {title}
      </Text>
      <Text as="p" size="sm" tone="faint">
        {children}
      </Text>
    </div>
  );
}

// The demo window's tabs: Home pinned first, then the whole status vocabulary so the strip
// reads alive (board §0 tab + status language).
const WINDOW_SPEC_TABS: readonly TabDescriptor[] = [
  { key: "home", title: "Home", kind: "home", status: "idle" },
  {
    key: "w-working",
    title: "composer tokens",
    kind: "thread",
    status: "working",
    repository: { state: "ready", label: "honk" },
  },
  {
    key: "w-done",
    title: "aux→core git",
    kind: "thread",
    status: "done",
    repository: { state: "ready", label: "honk" },
  },
  {
    key: "w-needs-you",
    title: "screencast spike",
    kind: "thread",
    status: "needs-you",
    repository: { state: "ready", label: "honk" },
  },
  {
    key: "w-failed",
    title: "trace flaky verify",
    kind: "thread",
    status: "failed",
    repository: { state: "ready", label: "honk" },
  },
  {
    key: "w-draft",
    title: "dark mode audit",
    kind: "thread",
    status: "draft",
    repository: { state: "ready", label: "honk" },
  },
];

// The real TabStrip seated in the demo window's titlebar, on honest local state (the
// StatusSpecStrip pattern): activate, close, drag-reorder, and + really mutate the list —
// principle 6, every control does what it says. Ephemeral story state → useState (the ADR 0025
// sanction); the persisted store in dev/tab-store.ts belongs to the Tabs story, not here.
function SpecimenTabStrip(): React.ReactElement {
  const [tabs, setTabs] = React.useState<readonly TabDescriptor[]>(WINDOW_SPEC_TABS);
  const [activeKey, setActiveKey] = React.useState("w-working");
  // Serial for keys of +-created drafts — a ref because it is bookkeeping, never rendered.
  const draftSerial = React.useRef(0);

  return (
    <TabStrip
      tabs={tabs}
      activeKey={activeKey}
      onActivate={setActiveKey}
      onClose={(key) => {
        const index = tabs.findIndex((tab) => tab.key === key);
        if (index === -1) {
          return;
        }
        const next = tabs.filter((tab) => tab.key !== key);
        setTabs(next);
        // Closing the active tab hands focus to its left neighbor (Home at worst) — a close
        // must never leave the window without an active view.
        if (key === activeKey) {
          const neighbor = next[index - 1] ?? next[0];
          if (neighbor !== undefined) {
            setActiveKey(neighbor.key);
          }
        }
      }}
      onReorder={(from, to) => {
        setTabs((current) => {
          const next = [...current];
          const [moved] = next.splice(from, 1);
          if (moved === undefined) {
            return current;
          }
          next.splice(to, 0, moved);
          return next;
        });
      }}
      onNew={() => {
        // + really opens a tab: a hollow-ring draft (nothing is running yet), focused like a
        // browser's new tab.
        draftSerial.current += 1;
        const key = `w-new-${String(draftSerial.current)}`;
        setTabs((current) => [
          ...current,
          {
            key,
            title: "untitled draft",
            kind: "thread",
            status: "draft",
            repository: { state: "ready", label: "honk" },
          },
        ]);
        setActiveKey(key);
      }}
    />
  );
}

function ShellStory(): React.ReactElement {
  // The demo windows pin their own color-scheme from the appearance dial — a nested Shell would
  // otherwise re-anchor to 'light dark' and ignore the dial (shell.tsx documents the escape).
  const appearance: Appearance = useAppearance();
  return (
    <>
      <ShellDials />
      <Section
        title="Shell — the window anatomy"
        note="The v2 inset floating sheet end to end: deep root → 36px titlebar → Stage carrying the 8px gutter → ONE floating Sheet (bg-base, 10px radius, the raised elevation ring) — never sibling cards. The real TabStrip sits on the titlebar's bottom edge exactly as the app seats it, on honest specimen state: activate, close, drag-reorder, and + all really happen; Home is pinned first."
      >
        <Shell xstyle={[styles.demoWindow, schemeStyles[appearance]]}>
          <Shell.TitleBar
            xstyle={styles.titleBarAnchor}
            trailing={
              <Text size="xs" tone="faint">
                trailing slot
              </Text>
            }
          >
            <div aria-hidden={true} {...stylex.props(styles.trafficLights)}>
              <span {...stylex.props(styles.trafficLight, styles.trafficLightClose)} />
              <span {...stylex.props(styles.trafficLight, styles.trafficLightMinimize)} />
              <span {...stylex.props(styles.trafficLight, styles.trafficLightZoom)} />
            </div>
            <SpecimenTabStrip />
          </Shell.TitleBar>
          <Shell.Stage>
            <Shell.Sheet>
              <RegionPlaceholder title="Shell.Sheet">
                The floating content sheet: base paint, 10px radius, the raised elevation ring — 8px
                of the deep well shows on every side (the Stage gutter). There is no rail/sidebar
                column in this anatomy; page nav lives inside the sheet.
              </RegionPlaceholder>
            </Shell.Sheet>
          </Shell.Stage>
        </Shell>
        <Text as="p" size="xs" tone="faint">
          The three dots are stand-ins: the titlebar's left inset (--honk-shell-inset-left) is
          reserved for macOS, which draws the real traffic lights there — nothing of ours renders or
          clicks in that space.
        </Text>
      </Section>
      <Section
        title="Window drag — an Electron contract"
        note="Shell.TitleBar marks itself data-shell-drag-region and interactive chrome opts out with data-shell-no-drag — attributes only, inert in this browser. The -webkit-app-region CSS that makes the bar actually drag the window lives in the Electron host's plain-CSS escape (ADR 0025 §5), so this demo makes no pretense of dragging."
      />
      <Section
        title="The sheet at rest"
        note="Stage owns the gutter; Sheet is the ONLY card. Content splits inside it with hairlines and layer fills — never nested cards."
      >
        <Shell xstyle={[styles.miniFrame, schemeStyles[appearance]]}>
          <Shell.TitleBar />
          <Shell.Stage>
            <Shell.Sheet>
              <RegionPlaceholder title="Shell.Sheet">
                The frame at rest: one sheet, no dividers.
              </RegionPlaceholder>
            </Shell.Sheet>
          </Shell.Stage>
        </Shell>
      </Section>
    </>
  );
}

// ── Story: Tabs ─────────────────────────────────────────────────────────────────────────────

// fake-thread's onStatus channel plugs straight into tabActions.setStatus: the store no-ops
// writes that change nothing (replaceTab returns the same array for a same-status write OR an
// unknown key, and publish bails on reference equality) — so per-tick forwarding can't re-render
// the strip, and the Conversation story's tab-less live run never leaks a tab into the store.

const THREAD_TITLES: readonly string[] = [
  "Refactor the tab plane",
  "Trace the flaky verify",
  "Port matrix to StyleX",
  "Audit token drift",
  "Wire the hotkey map",
  "Dedupe reopen stack",
];

let threadSerial = 0;

function newThread(): void {
  // skip serials already taken by tabs persisted from a previous session
  do {
    threadSerial += 1;
  } while (getTabsSnapshot().tabs.some((tab) => tab.key === `T${threadSerial}`));

  const key = `T${threadSerial}`;
  const title = THREAD_TITLES[(threadSerial - 1) % THREAD_TITLES.length] ?? key;

  startFake(key, title, tabActions.setStatus);
  tabActions.open({
    key,
    title,
    kind: "thread",
    status: "working",
    repository: { state: "ready", label: "honk" },
  });
}

// Module-level because these close over stores, not component state — there is nothing to
// rebuild per render. (Identity is NOT load-bearing: the hotkeys registry keys registrations on
// the key strings and syncs callbacks each render.) All actions go straight to the store — the
// story browser's routes are per-story, so tab activation no longer navigates.
const tabsHotkeyActions: ShellHotkeyActions = {
  closeActive(): void {
    tabActions.closeActive();
  },
  reopen(): void {
    tabActions.reopen();
  },
  newThread,
  activateIndex(index: number): void {
    const tab = getTabsSnapshot().tabs[index];

    if (tab !== undefined) {
      tabActions.activate(tab.key);
    }
  },
};

// The status vocabulary, one tab per word (board §0 tab + status language).
const STATUS_SPEC_TABS: readonly TabDescriptor[] = [
  { key: "home", title: "Home", kind: "home", status: "idle" },
  {
    key: "s-loading",
    title: "loading repository",
    kind: "thread",
    status: "idle",
    repository: { state: "loading" },
  },
  {
    key: "s-working",
    title: "working — matrix",
    kind: "thread",
    status: "working",
    repository: { state: "ready", label: "honk" },
  },
  {
    key: "s-needs-you",
    title: "needs you — amber pulse",
    kind: "thread",
    status: "needs-you",
    repository: { state: "ready", label: "honk" },
  },
  {
    key: "s-done",
    title: "done — green",
    kind: "thread",
    status: "done",
    repository: { state: "ready", label: "honk" },
  },
  {
    key: "s-failed",
    title: "failed — red",
    kind: "thread",
    status: "failed",
    repository: { state: "ready", label: "honk" },
  },
  {
    key: "s-draft",
    title: "draft — hollow",
    kind: "thread",
    status: "draft",
    repository: { state: "ready", label: "honk" },
  },
];

// A self-contained specimen strip over local state, so its controls stay honest (activate,
// close, reorder all really happen — principle 6). Ephemeral story state → useState.
function StatusSpecStrip(): React.ReactElement {
  const [tabs, setTabs] = React.useState<readonly TabDescriptor[]>(STATUS_SPEC_TABS);
  const [activeKey, setActiveKey] = React.useState("s-working");

  return (
    <div {...stylex.props(styles.stripHost)}>
      <TabStrip
        tabs={tabs}
        activeKey={activeKey}
        onActivate={setActiveKey}
        onClose={(key) => {
          setTabs((current) => current.filter((tab) => tab.key !== key));
        }}
        onReorder={(from, to) => {
          setTabs((current) => {
            const next = [...current];
            const [moved] = next.splice(from, 1);
            if (moved === undefined) {
              return current;
            }
            next.splice(to, 0, moved);
            return next;
          });
        }}
        onNew={() => {
          setTabs(STATUS_SPEC_TABS); // the + on the specimen resets it
        }}
      />
    </div>
  );
}

function TabsStory(): React.ReactElement {
  const { tabs, activeKey } = useTabs();
  // Hotkeys bind only while this story is mounted — the registry unbinds on unmount, so no
  // other story answers ⌥W/⌥N (the locked one-registry law, scoped to this route).
  useShellHotkeys(tabsHotkeyActions);
  // Gauge scope: this counts TabsStory renders — tab-store transitions move it, fake-thread
  // row ticks must not (the store no-ops same-status writes, so ticks never publish).
  const stripRenders = useRenderCount();

  return (
    <>
      <TabsDials />
      <Section
        title="TabStrip — live store"
        note="Wired to dev/tab-store.ts (persisted) + dev/hotkeys.ts: ⌥W close · ⌥⇧T reopen · ⌥N new · ⌥1-9 activate (the ⌘ twins are browser-reserved until the Electron host). Drag to reorder; middle-click closes; new runs walk working → needs-you → done."
      >
        <div {...stylex.props(styles.stripHost)}>
          <TabStrip
            tabs={tabs}
            activeKey={activeKey}
            onActivate={tabActions.activate}
            onClose={tabActions.close}
            onReorder={tabActions.reorder}
            onNew={newThread}
          />
        </div>
        <div {...stylex.props(styles.specRow)}>
          <button type="button" onClick={newThread} {...stylex.props(styles.button)}>
            new fake thread
          </button>
          <button
            type="button"
            onClick={() => {
              tabActions.closeActive();
            }}
            {...stylex.props(styles.button)}
          >
            close active
          </button>
          <button
            type="button"
            onClick={() => {
              tabActions.reopen();
            }}
            {...stylex.props(styles.button)}
          >
            reopen
          </button>
          <Text size="xs" tone="faint" family="mono" tabularNums>
            strip ×{stripRenders}
          </Text>
        </div>
      </Section>
      <Section
        title="Status vocabulary"
        note="matrix = working · green = done · amber pulse = needs you · red = failed · hollow = draft · gray = idle (Home). The specimen is its own little state — the + resets it."
      >
        <StatusSpecStrip />
      </Section>
    </>
  );
}

// ── Story: Matrix ───────────────────────────────────────────────────────────────────────────

const MATRIX_GRIDS: readonly number[] = [3, 5, 7];

function MatrixStory(): React.ReactElement {
  return (
    <>
      <Section
        title="Matrix — the signature status glyph"
        note="Sacred geometry (2px dots on 4px cells, 1.2s diagonal sweep) never drifts; grid size scales the glyph by adding dots."
      >
        {MATRIX_GRIDS.map((grid) => (
          <div key={grid} {...stylex.props(styles.specRow)}>
            <SpecLabel>{`grid=${grid}`}</SpecLabel>
            <Matrix grid={grid} isActive />
            <Text size="sm" tone="faint">
              active
            </Text>
            <Matrix grid={grid} isActive={false} />
            <Text size="sm" tone="faint">
              idle
            </Text>
          </div>
        ))}
      </Section>
    </>
  );
}

// ── Story: Text ─────────────────────────────────────────────────────────────────────────────

const TEXT_SIZES: readonly TextSize[] = ["xs", "sm", "base", "lg", "xl"];
const TEXT_TONES: readonly TextTone[] = [
  "primary",
  "muted",
  "faint",
  "accent",
  "ok",
  "warn",
  "err",
  "inherit",
];
const TEXT_WEIGHTS: readonly TextWeight[] = ["regular", "medium", "semibold"];

function TextStory(): React.ReactElement {
  return (
    <>
      <TextDials />
      <Section
        title="Sizes — the prose ramp"
        note="caption 10/12 · detail 11/14 · body 12/16 · title 13/18 (the conversation tier) · heading 16/21."
      >
        {TEXT_SIZES.map((size) => (
          <div key={size} {...stylex.props(styles.specRow)}>
            <SpecLabel>{`size=${size}`}</SpecLabel>
            <Text size={size}>The quick brown honk jumps over the lazy shell.</Text>
          </div>
        ))}
      </Section>
      <Section title="Tones">
        {TEXT_TONES.map((tone) => (
          <div key={tone} {...stylex.props(styles.specRow)}>
            <SpecLabel>{`tone=${tone}`}</SpecLabel>
            <Text tone={tone}>Color carries status, never identity.</Text>
          </div>
        ))}
      </Section>
      <Section title="Weights">
        {TEXT_WEIGHTS.map((weight) => (
          <div key={weight} {...stylex.props(styles.specRow)}>
            <SpecLabel>{`weight=${weight}`}</SpecLabel>
            <Text weight={weight} size="lg">
              Verbs lead, details trail.
            </Text>
          </div>
        ))}
      </Section>
      <Section title="Family · numerals · truncation">
        <div {...stylex.props(styles.specRow)}>
          <SpecLabel>family=mono</SpecLabel>
          <Text family="mono">pnpm --filter @honk/ui exec tsc --noEmit</Text>
        </div>
        <div {...stylex.props(styles.specRow)}>
          <SpecLabel>tabularNums</SpecLabel>
          <Text tabularNums>1,024 rows · +118 −12 · 0.4s</Text>
        </div>
        <div {...stylex.props(styles.specRow)}>
          <SpecLabel>truncate</SpecLabel>
          <div {...stylex.props(styles.truncateBox)}>
            <Text as="p" truncate>
              A very long line that must ellipsize inside its 160px box instead of wrapping.
            </Text>
          </div>
        </div>
      </Section>
    </>
  );
}

// ── Story: Icon ─────────────────────────────────────────────────────────────────────────────

const ICON_SIZES: readonly IconSize[] = ["xs", "sm", "md", "lg", "xl"];
const ICON_TONES: readonly IconTone[] = [
  "current",
  "muted",
  "faint",
  "accent",
  "ok",
  "warn",
  "err",
  "info",
];

function IconStory(): React.ReactElement {
  return (
    <>
      <IconDials />
      {/* The whole curated set, grouped exactly as @honk/ui/icons groups it — one Section per
          catalog category, every production glyph on screen under its pack name. Driven off
          ICON_CATALOG so this story can never drift from the module it documents. */}
      {ICON_CATALOG.map((group) => (
        <Section key={group.category} title={group.category}>
          <div {...stylex.props(styles.iconGrid)}>
            {group.glyphs.map(([name, glyph]) => (
              <div key={name} {...stylex.props(styles.iconCell)}>
                <Icon icon={glyph} size="lg" />
                <SpecLabel>{name}</SpecLabel>
              </div>
            ))}
          </div>
        </Section>
      ))}
      <Section
        title="Sizes"
        note="xs 12 · sm 14 · md 16 (default) · lg 18 · xl 20 — the wrapper owns the font box, the glyph renders at 1em."
      >
        {(
          [
            ["IconMagnifyingGlass", IconMagnifyingGlass],
            ["IconEyeOpen", IconEyeOpen],
            ["IconConsole", IconConsole],
          ] as const
        ).map(([name, glyph]) => (
          <div key={name} {...stylex.props(styles.specRow)}>
            <SpecLabel>{name}</SpecLabel>
            {ICON_SIZES.map((size) => (
              <Icon key={size} icon={glyph} size={size} />
            ))}
          </div>
        ))}
      </Section>
      <Section
        title="Tones"
        note="current (default) inherits the surrounding text color; the rest are the status family."
      >
        {ICON_TONES.map((tone) => (
          <div key={tone} {...stylex.props(styles.specRow)}>
            <SpecLabel>{`tone=${tone}`}</SpecLabel>
            <Icon icon={IconConsole} tone={tone} />
            <Icon icon={IconMagnifyingGlass} tone={tone} />
            <Icon icon={IconEyeOpen} tone={tone} />
          </div>
        ))}
      </Section>
    </>
  );
}

// ── Story: Conversation ─────────────────────────────────────────────────────────────────────

// A disclosure specimen owning its ephemeral expanded state (sanctioned useState).
function ExpandableToolCall(): React.ReactElement {
  const [isExpanded, setExpanded] = React.useState(false);

  return (
    <div {...stylex.props(styles.specColumn)}>
      <ToolCallLine
        verb="Ran"
        detail="pnpm test composer · exit 0"
        isExpanded={isExpanded}
        onToggle={() => {
          setExpanded((current) => !current);
        }}
      />
      {isExpanded && (
        <WorkGroup.OutputStrip>
          {"RUN  composer.spec.tsx\n ✓ parses token spans (12ms)\n ✓ queues on enter (4ms)"}
        </WorkGroup.OutputStrip>
      )}
    </div>
  );
}

// A work-group specimen owning its expanded state.
function ExpandableWorkGroup(): React.ReactElement {
  const [isExpanded, setExpanded] = React.useState(false);

  return (
    <WorkGroup>
      <WorkGroup.Header
        verb="Explored"
        detail="input.tsx, tokens.ts · 3 searches"
        isExpanded={isExpanded}
        onToggle={() => {
          setExpanded((current) => !current);
        }}
      />
      {isExpanded && (
        <>
          <ToolCallLine verb="Read" detail="composer/input.tsx · 412 lines" />
          <ToolCallLine verb="Grepped" detail="richTextJson · 9 hits" />
          <ToolCallLine verb="Read" detail="composer/tokens.ts · 118 lines" />
        </>
      )}
    </WorkGroup>
  );
}

const LIVE_KEY = "live-spec";

const LIVE_STATUS_LINES = {
  working: "working — rows stream through the live window",
  "needs-you": "needs you — the run is paused on your input",
  done: "done — all steps settled",
} as const;

function startLiveRun(): void {
  // setStatus no-ops for keys without a tab, so the live run never leaks into the Tabs story's
  // persisted store — the onStatus channel stays wired all the same.
  startFake(LIVE_KEY, "Streaming spec", tabActions.setStatus);
}

// The live streaming variant: driven by dev/fake-thread.ts so the render-isolation story stays
// observable. Its own component so only THIS section re-renders per tick — the static spec
// sheets above it hold still.
function LiveRun(): React.ReactElement {
  const thread = useFakeThread(LIVE_KEY);
  // Climbs once per 300ms tick while streaming; static sections' gauges (none — they don't
  // subscribe) stay put, which is the whole point of the wholesale-replaced snapshots.
  const rowRenders = useRenderCount();

  if (thread === undefined) {
    return (
      <button type="button" onClick={startLiveRun} {...stylex.props(styles.button)}>
        start a streaming run
      </button>
    );
  }

  const isWorking = thread.status === "working";
  const tail = thread.rows[thread.rows.length - 1];

  return (
    <div {...stylex.props(styles.specColumn)}>
      <div {...stylex.props(styles.specRow)}>
        <Text size="sm" tone={thread.status === "needs-you" ? "warn" : "faint"}>
          {LIVE_STATUS_LINES[thread.status]}
        </Text>
        <Text size="xs" tone="faint" family="mono" tabularNums>
          rows ×{rowRenders}
        </Text>
      </div>
      <WorkGroup isRunning={isWorking}>
        <WorkGroup.Header
          verb={isWorking ? `${tail?.verb ?? "Working"}…` : "Worked"}
          detail={isWorking ? tail?.detail : `${thread.rows.length} steps`}
          isRunning={isWorking}
          isExpanded={!isWorking}
          onStop={
            isWorking
              ? () => {
                  stopFake(LIVE_KEY);
                }
              : undefined
          }
        />
        {isWorking ? (
          <WorkGroup.Preview isScrollable={thread.rows.length > 4}>
            {thread.rows.map((row) => (
              <ToolCallLine
                key={row.id}
                verb={row.verb}
                detail={row.detail}
                state={row.state}
                added={row.added}
                removed={row.removed}
              />
            ))}
          </WorkGroup.Preview>
        ) : (
          thread.rows.map((row) => (
            <ToolCallLine
              key={row.id}
              verb={row.verb}
              detail={row.detail}
              state={row.state}
              added={row.added}
              removed={row.removed}
            />
          ))
        )}
      </WorkGroup>
      {isWorking && <StatusRow>Planning next moves</StatusRow>}
      {thread.status !== "working" && (
        <button type="button" onClick={startLiveRun} {...stylex.props(styles.button)}>
          restart the run
        </button>
      )}
    </div>
  );
}

function ConversationStory(): React.ReactElement {
  return (
    <>
      <ConversationDials />
      <Section
        title="UserMessage — the only bubble"
        note="Full-column bubble on the elevated surface with a 1px inset ring; 13px text on the window's 16px leading. Assistant output NEVER gets one of these (locked §5)."
      >
        <div {...stylex.props(styles.specColumn)}>
          <UserMessage>Replace richTextJson with token spans over the plain buffer.</UserMessage>
          <UserMessage>
            <UserMessage.Preview>
              Audit the composer command-menu placement against the live caret, including the fixed
              virtual anchor, viewport collision behavior, async result-count revisions, and the
              path-preview side panel. Verify both slash and at-mention flows with enough results to
              force the menu against every viewport edge, then report the exact files changed and
              the checks that passed after the fix.
            </UserMessage.Preview>
          </UserMessage>
          <UserMessage
            footer={
              <Text size="sm" tone="err">
                The turn failed — the model rejected the request.
              </Text>
            }
          >
            Fix the flake in composer/input.tsx, then run the verify workflow and report which gates
            were red before your change and which stayed red after it.
          </UserMessage>
        </div>
      </Section>
      <Section
        title="ChangeReceipt — the settled turn receipt"
        note="Resolved snapshot diffs stay attached to their turn. The first four files and disclosure occupy Cursor's five-row preview; Review is the one aggregate action."
      >
        <ChangeReceipt
          files={[
            {
              path: "packages/ui/src/user-message.tsx",
              additions: 96,
              deletions: 8,
              status: "modified",
            },
            {
              path: "packages/ui/src/change-receipt.tsx",
              additions: 214,
              deletions: 0,
              status: "added",
            },
            {
              path: "packages/app-next/src/thread.tsx",
              additions: 18,
              deletions: 31,
              status: "modified",
            },
            {
              path: "packages/ui/src/index.ts",
              additions: 7,
              deletions: 1,
              status: "modified",
            },
            {
              path: "packages/ui/src/legacy-patch-chip.tsx",
              additions: 0,
              deletions: 44,
              status: "deleted",
            },
            {
              path: "packages/ui/dev/main.tsx",
              additions: 42,
              deletions: 0,
              status: "modified",
            },
          ]}
          onReview={() => {
            toast("Reviewing the six resolved turn changes");
          }}
        />
      </Section>
      <Section
        title="ToolCallLine — the activity row"
        note="verb (74% fg) · detail (54% fg, tabular) · optional diff stats · optional chevron. No status icons, ever — running shimmers, failed goes red, hover promotes one step."
      >
        <div {...stylex.props(styles.specColumn)}>
          <ToolCallLine verb="Read" detail="src/tabs.tsx · 687 lines" />
          <ToolCallLine verb="Running" detail="pnpm test composer…" state="running" />
          <ToolCallLine verb="Command" detail="node .design/lint.mjs · exit 1" state="failed" />
          <ToolCallLine verb="Edited" detail="composer/tokens.ts" added={118} removed={12} />
          <ExpandableToolCall />
        </div>
      </Section>
      <Section
        title="StatusRow — the waiting indicator"
        note="Mask-shimmer label at the conversation tier; the 15s slow-label swap is store timing, not a component timer."
      >
        <div {...stylex.props(styles.specColumn)}>
          <StatusRow>Planning next moves</StatusRow>
          <StatusRow>This is taking a bit longer...</StatusRow>
        </div>
      </Section>
      <Section
        title="WorkGroup — verb line + live window"
        note="Header leads with the verb; running groups keep a 144px bottom-anchored preview with a top fade, and the last shell/edit step tails output in the 90px mono strip. Stop reveals on header hover (locked §5) — see the live run below for the working one."
      >
        <div {...stylex.props(styles.specColumn)}>
          <WorkGroup>
            <WorkGroup.Header verb="Edited" detail="composer/tokens.ts" added={118} removed={12} />
          </WorkGroup>
          <ExpandableWorkGroup />
          {/* No Stop on this static specimen — a control must do what it says (principle 6);
              the live run below carries the real, working Stop. */}
          <WorkGroup isRunning>
            <WorkGroup.Header verb="Editing…" detail="dev-footer.tsx" isRunning />
            <WorkGroup.Preview isScrollable>
              <ToolCallLine verb="Read" detail="dev-footer.tsx · 0.4s" />
              <ToolCallLine verb="Edited" detail="dev-footer.tsx" added={24} removed={3} />
              <ToolCallLine verb="Running" detail="pnpm test dev-footer…" state="running" />
              <WorkGroup.OutputStrip>
                {
                  "RUN  dev-footer.spec.tsx\n ✓ renders perf cells (12ms)\n ⠸ retry cell shows live count…"
                }
              </WorkGroup.OutputStrip>
            </WorkGroup.Preview>
          </WorkGroup>
        </div>
      </Section>
      <Section
        title="Live streaming run"
        note="dev/fake-thread.ts drives structured rows on real 300ms timers: each tick settles the running row (references of settled rows survive) and streams the next. Stop on the header really stops it."
      >
        <LiveRun />
      </Section>
    </>
  );
}

// ── Story: Badge ────────────────────────────────────────────────────────────────────────────

const BADGE_TONES = ["neutral", "accent", "ok", "warn", "err", "outline"] as const;

function BadgeStory(): React.ReactElement {
  return (
    <>
      <Section
        title="Badge — tones"
        note="A small labelled chip: neutral + accent, the status fills (ok/warn/err — the pale *-bg under the *-fg), and outline. No info tone yet — the status family has no sourced info background."
      >
        <div {...stylex.props(styles.specRow)}>
          {BADGE_TONES.map((tone) => (
            <Badge key={tone} tone={tone}>
              {tone}
            </Badge>
          ))}
        </div>
      </Section>

      <Section
        title="Sizes + counts"
        note="sm · md. minWidth = height, so a single glyph reads as a coin (a count, a dot of emphasis)."
      >
        <div {...stylex.props(styles.specRow)}>
          <Badge size="sm" tone="accent">
            sm
          </Badge>
          <Badge size="md" tone="accent">
            md
          </Badge>
          <Badge size="sm" tone="err">
            3
          </Badge>
          <Badge size="md" tone="neutral">
            128
          </Badge>
          <Badge size="md" tone="ok">
            NEW
          </Badge>
        </div>
      </Section>
    </>
  );
}

// ── Story: StatusDot ────────────────────────────────────────────────────────────────────────

const STATUS_TONES = ["ok", "warn", "err", "info", "accent", "neutral", "draft"] as const;

function StatusDotStory(): React.ReactElement {
  return (
    <>
      <Section
        title="StatusDot — semantic tones"
        note="The status color language as a round glyph. The app maps its vocabulary onto the tone: done→ok, needs-you→warn, failed→err, unseen→accent, idle→neutral, and draft→the hollow ring."
      >
        <div {...stylex.props(styles.iconGrid)}>
          {STATUS_TONES.map((tone) => (
            <div key={tone} {...stylex.props(styles.iconCell)}>
              <StatusDot tone={tone} label={tone} />
              <Text size="xs" tone="faint" family="mono">
                {tone}
              </Text>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Pulse — the attention beat"
        note="warn + pulse is the needs-you dot — the identity's slow amber pulse (2000ms, opacity breath). Every pulse carries its own reduced-motion off-switch."
      >
        <div {...stylex.props(styles.specRow)}>
          <span {...stylex.props(styles.statusInline)}>
            <StatusDot tone="warn" pulse />
            <Text size="sm">Needs you</Text>
          </span>
          <span {...stylex.props(styles.statusInline)}>
            <StatusDot tone="accent" pulse />
            <Text size="sm">Unseen</Text>
          </span>
          <span {...stylex.props(styles.statusInline)}>
            <StatusDot tone="err" pulse />
            <Text size="sm">Failed</Text>
          </span>
        </div>
      </Section>

      <Section
        title="Inline with text"
        note="A dot beside its own label is decorative (aria-hidden) — the row already reads as one status. A lone dot with no text takes a label prop and becomes an announced status region."
      >
        <div {...stylex.props(styles.specRow)}>
          <span {...stylex.props(styles.statusInline)}>
            <StatusDot tone="ok" />
            <Text size="sm">Done</Text>
          </span>
          <span {...stylex.props(styles.statusInline)}>
            <StatusDot tone="neutral" />
            <Text size="sm">Idle</Text>
          </span>
          <span {...stylex.props(styles.statusInline)}>
            <StatusDot tone="draft" />
            <Text size="sm">Draft</Text>
          </span>
        </div>
      </Section>
    </>
  );
}

// ── Story: Button ───────────────────────────────────────────────────────────────────────────

const BUTTON_VARIANTS = ["primary", "secondary", "ghost", "outline", "danger"] as const;
const BUTTON_SIZES = ["sm", "md", "lg"] as const;

function ButtonStory(): React.ReactElement {
  return (
    <>
      <Section
        title="Button — variants (Base UI)"
        note="secondary is the DEFAULT — the shell's chrome button (fill + hairline ring + primary text). primary is the opt-in accent action; danger carries the status err triplet. Hover/press/focus are live — hover and tab through them."
      >
        <div {...stylex.props(styles.specRow)}>
          {BUTTON_VARIANTS.map((variant) => (
            <Button key={variant} variant={variant}>
              {variant}
            </Button>
          ))}
        </div>
      </Section>

      <Section
        title="Sizes"
        note="sm · md · lg on the shared control scale (24 / 28 / 32px). md reuses honk's 28px control height — the same number the tab + sidebar row use."
      >
        {BUTTON_SIZES.map((size) => (
          <div key={size} {...stylex.props(styles.specRow)}>
            <SpecLabel>{size}</SpecLabel>
            <Button size={size} variant="primary">
              Send
            </Button>
            <Button size={size} variant="secondary">
              Cancel
            </Button>
            <Button
              size={size}
              variant="secondary"
              iconStart={<Icon icon={IconCircleCheck} size="sm" />}
            >
              Approve
            </Button>
          </div>
        ))}
      </Section>

      <Section
        title="Icon + label"
        note="iconStart / iconEnd slot around the label; the root's flex + the control-gap token lay them out — no wrapper."
      >
        <div {...stylex.props(styles.specRow)}>
          <Button variant="secondary" iconStart={<Icon icon={IconMagnifyingGlass} size="sm" />}>
            Search
          </Button>
          <Button variant="primary" iconStart={<Icon icon={IconCircleCheck} size="sm" />}>
            Confirm
          </Button>
          <Button variant="danger" iconStart={<Icon icon={IconCrossSmall} size="sm" />}>
            Delete
          </Button>
          <Button variant="ghost" iconEnd={<Icon icon={IconEyeOpen} size="sm" />}>
            Preview
          </Button>
        </div>
      </Section>

      <Section
        title="IconButton — square, tooltip-paired"
        note="Icon-only controls REQUIRE an aria-label; a Tooltip usually gives the same label visually. This is the port hierarchy paying off — the tab-strip's tooltip, now driving a button. Hover one."
      >
        <div {...stylex.props(styles.specRow)}>
          <Tooltip label="Search">
            <IconButton aria-label="Search">
              <Icon icon={IconMagnifyingGlass} size="sm" />
            </IconButton>
          </Tooltip>
          <Tooltip label="Open console">
            <IconButton aria-label="Open console">
              <Icon icon={IconConsole} size="sm" />
            </IconButton>
          </Tooltip>
          <Tooltip label="Approve">
            <IconButton aria-label="Approve" variant="secondary">
              <Icon icon={IconCircleCheck} size="sm" />
            </IconButton>
          </Tooltip>
          <Tooltip label="Close">
            <IconButton aria-label="Close" variant="danger">
              <Icon icon={IconCrossSmall} size="sm" />
            </IconButton>
          </Tooltip>
        </div>
      </Section>

      <Section
        title="States"
        note="disabled dims to 0.4 and drops the pointer; render composes the button AS an <a> (real anchor semantics, button paint); block fills the inline axis."
      >
        <div {...stylex.props(styles.specRow)}>
          <Button variant="primary" disabled>
            Disabled
          </Button>
          <Button variant="secondary" disabled>
            Disabled
          </Button>
          {/* render = polymorphism: the button's paint on a real <a>. Rendering a non-<button>
              needs nativeButton={false} so Base UI drops the native-button semantics it can't keep. */}
          <Button variant="ghost" render={<a href="#/button" />} nativeButton={false}>
            Rendered as a link
          </Button>
        </div>
        <div {...stylex.props(styles.specColumn)}>
          <Button variant="primary" block>
            Block — fills the inline axis
          </Button>
        </div>
      </Section>
    </>
  );
}

// ── Story: Tooltip ──────────────────────────────────────────────────────────────────────────

const TOOLTIP_SIDES = ["top", "right", "bottom", "left"] as const;

// Exercises the controlled/triggerless AnchoredTooltip the tab strip uses: a button toggles
// `open`, anchored to itself via a function anchor. Proves the delegated-host path independent of
// any hover detection.
function ControlledTooltipProbe(): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const btnRef = React.useRef<HTMLButtonElement | null>(null);
  const anchor = React.useMemo(() => (): HTMLElement | null => btnRef.current, []);
  return (
    <div {...stylex.props(styles.specRow)}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => {
          setOpen((v) => !v);
        }}
        {...stylex.props(styles.button)}
      >
        {open ? "hide anchored" : "show anchored"}
      </button>
      <AnchoredTooltip open={open} onOpenChange={setOpen} anchor={anchor}>
        Anchored, controlled, triggerless — the tab-strip path.
      </AnchoredTooltip>
    </div>
  );
}

function TooltipStory(): React.ReactElement {
  return (
    <>
      <Section
        title="Tooltip — hover/focus label (Base UI)"
        note="Wraps @base-ui/react tooltip: portalled out of any overflow:hidden ancestor, a StyleX surface, on-self scale-fade (120ms in / 80ms out via the motion tokens), one shared open delay through TooltipProvider. Hover, or Tab to a control and hold focus."
      >
        <div {...stylex.props(styles.specRow)}>
          <Tooltip label="Run the verify workflow">
            <button type="button" {...stylex.props(styles.button)}>
              hover me
            </button>
          </Tooltip>
          <Tooltip label="Settings">
            <button type="button" aria-label="Settings" {...stylex.props(styles.button)}>
              <Icon icon={IconConsole} />
            </button>
          </Tooltip>
          <Tooltip label="A longer label that wraps within the tooltip's 280px max width instead of running off the edge of the window.">
            <button type="button" {...stylex.props(styles.button)}>
              long label
            </button>
          </Tooltip>
        </div>
      </Section>
      <Section
        title="Placement"
        note="side = top · right · bottom · left, with the shipped 6px offset; Base UI auto-flips when a side has no room."
      >
        <div {...stylex.props(styles.specRow)}>
          {TOOLTIP_SIDES.map((side) => (
            <Tooltip key={side} label={`side=${side}`} side={side}>
              <button type="button" {...stylex.props(styles.button)}>
                {side}
              </button>
            </Tooltip>
          ))}
        </div>
      </Section>
      <Section
        title="Delegated tab tooltips"
        note="The tab strip can't wrap each memo'd Tab in a Trigger, so it drives ONE controlled AnchoredTooltip from its delegated pointer events — the full title appears only when a tab is truncated or compact. Squeeze the window on the Shell story and hover a clipped tab. The button below is that same controlled/triggerless shape, toggled by click."
      >
        <ControlledTooltipProbe />
      </Section>
    </>
  );
}

// ── Story: Toast ────────────────────────────────────────────────────────────────────────────

function ToastStory(): React.ReactElement {
  return (
    <>
      <ToastDials />
      <Toaster />
      <Section
        title="Toast — friendly top-center stack (Sonner)"
        note="A compact dark pill with rounded type and a roomy leading slot. Toasts arrive from the top center, peek and scale as a collapsed stack, expand on hover, pause while you interact, and dismiss by swiping up or sideways. The stack behavior comes from Sonner; every visible value comes from @honk/ui tokens."
      >
        <div {...stylex.props(styles.specRow)}>
          <Button
            onClick={() => {
              toast("Ready to review", {
                description: "The verify checks all passed.",
                icon: <Icon icon={IconCircleCheck} size="lg" tone="ok" />,
              });
            }}
          >
            Default
          </Button>
          <Button
            onClick={() => {
              toast.success("Changes saved", {
                description: "Your workspace is up to date.",
              });
            }}
          >
            Success
          </Button>
          <Button
            onClick={() => {
              toast.error("Couldn’t save changes", {
                description: "The Core connection closed unexpectedly.",
              });
            }}
          >
            Error
          </Button>
          <Button
            onClick={() => {
              toast("Update available", {
                description: "Restart when you’re ready.",
                action: {
                  label: "Restart",
                  onClick: () => {
                    toast.success("Restart scheduled");
                  },
                },
              });
            }}
          >
            Action
          </Button>
          <Button
            onClick={() => {
              toast("First notification", { description: "Hover the stack to open it." });
              toast.info("Second notification", { description: "The cards keep their depth." });
              toast.warning("Third notification", {
                description: "Swipe one away in any direction.",
              });
            }}
          >
            Stack three
          </Button>
          <Button
            onClick={() => {
              toast.loading("Syncing workspace", {
                description: "This stays until it is dismissed.",
              });
            }}
          >
            Loading
          </Button>
        </div>
      </Section>
    </>
  );
}

// ── Story: Popover ──────────────────────────────────────────────────────────────────────────

function PopoverStory(): React.ReactElement {
  return (
    <Section
      title="Popover — bare floating surface (Base UI)"
      note="Wraps @base-ui/react popover: portalled out of any overflow:hidden ancestor, a StyleX surface (bg-base fill, floating elevation + a hairline ring, window radius), the tooltip's on-self scale-fade (120ms in / 80ms out). Pointer-interactive — it holds arbitrary content. Base UI moves focus into the popup on open and back to the trigger on close. Click a trigger."
    >
      <div {...stylex.props(styles.specRow)}>
        <Popover.Root>
          <Popover.Trigger render={<Button>Rename thread…</Button>} />
          <Popover.Popup>
            <div {...stylex.props(styles.specColumn)}>
              <Popover.Title>Rename thread</Popover.Title>
              <Popover.Description>
                Give this thread a name — arbitrary interactive content lives on the popover
                surface.
              </Popover.Description>
              <Popover.Close render={<Button variant="primary">Done</Button>} />
            </div>
          </Popover.Popup>
        </Popover.Root>

        <Popover.Root>
          <Popover.Trigger render={<Button variant="ghost">Open above, end-aligned</Button>} />
          <Popover.Popup side="top" align="end">
            <div {...stylex.props(styles.specColumn)}>
              <Popover.Title>Placement</Popover.Title>
              <Popover.Description>
                side=&quot;top&quot; align=&quot;end&quot; — the folded positioner steers it.
              </Popover.Description>
              <Popover.Close render={<Button>Close</Button>} />
            </div>
          </Popover.Popup>
        </Popover.Root>
      </div>
    </Section>
  );
}

// ── Story: Menu ─────────────────────────────────────────────────────────────────────────────

function MenuStory(): React.ReactElement {
  return (
    <Section
      title="Menu — a dropdown of actions (Base UI)"
      note="A Button opens a portalled list on the shared overlay surface (bg-base · floating elevation · window radius) with the on-self scale-fade (120ms in / 80ms out via the motion tokens). Base UI brings the composite keyboard model: ↑/↓ roam rows, the active row lights via [data-highlighted], type-ahead jumps, Esc / outside-click dismiss. Rows snap to the 28px control scale. Open it, then drive it from the keyboard."
    >
      <div {...stylex.props(styles.specRow)}>
        <Menu.Root>
          <Menu.Trigger render={<Button variant="secondary">Actions</Button>} />
          <Menu.Popup>
            <Menu.Group>
              <Menu.GroupLabel>This thread</Menu.GroupLabel>
              <Menu.Item>
                <Icon icon={IconMagnifyingGlass} size="sm" />
                Find in thread
              </Menu.Item>
              <Menu.Item>
                <Icon icon={IconEyeOpen} size="sm" />
                View details
              </Menu.Item>
              <Menu.Item disabled>
                <Icon icon={IconConsole} size="sm" />
                Move to project
              </Menu.Item>
            </Menu.Group>
            <Menu.Separator />
            <Menu.Item>Export transcript</Menu.Item>
            <Menu.Item>Delete thread</Menu.Item>
          </Menu.Popup>
        </Menu.Root>
      </div>
    </Section>
  );
}

// ── Story: Dialog ───────────────────────────────────────────────────────────────────────────

function DialogStory(): React.ReactElement {
  return (
    <Section
      title="Dialog — a centered modal (Base UI)"
      note="A Button opens a portalled modal: Base UI traps focus, locks page scroll, and dismisses on Escape / outside-press / Cancel. A styled Base.Backdrop dims the app with the scrim token; the popup self-centers (no positioner), grows from its center with the on-self scale-fade (120ms in / 80ms out), and wears the shared overlay surface (bg-base · floating elevation + hairline ring · window radius). The Header stacks Title + Description; the Footer right-aligns actions over a hairline rule. Open it, then Esc or click the scrim to close."
    >
      <div {...stylex.props(styles.specRow)}>
        <Dialog.Root>
          <Dialog.Trigger render={<Button>Rename thread…</Button>} />
          <Dialog.Popup>
            <Dialog.Header>
              <Dialog.Title>Rename thread</Dialog.Title>
              <Dialog.Description>
                Give this thread a name — it updates everywhere the thread appears.
              </Dialog.Description>
            </Dialog.Header>
            <Text size="sm" tone="muted">
              The thread is currently “Untitled”.
            </Text>
            <Dialog.Footer>
              <Dialog.Close render={<Button variant="ghost">Cancel</Button>} />
              <Button variant="primary">Save</Button>
            </Dialog.Footer>
          </Dialog.Popup>
        </Dialog.Root>
      </div>
    </Section>
  );
}

// ── Story: AlertDialog ──────────────────────────────────────────────────────────────────────

function AlertDialogStory(): React.ReactElement {
  return (
    <Section
      title="Alert Dialog — a forced decision (Base UI)"
      note="Base UI's alert-dialog: always modal, role=alertdialog, and non-dismissable by the scrim (outside-press disabled), so the choice can't be dodged by clicking away. The centered card reuses the overlay surface (bg-base · window radius · hairline ring + floating elevation) and grows from its center with the scale-fade (120ms in / 80ms out); the scrim wash fades under it. Header stacks Title + Description; Footer right-aligns the actions over a hairline divider. Open it, then pick Cancel (closes) or Delete."
    >
      <div {...stylex.props(styles.specRow)}>
        <AlertDialog.Root>
          <AlertDialog.Trigger render={<Button variant="danger">Delete thread…</Button>} />
          <AlertDialog.Popup>
            <AlertDialog.Header>
              <AlertDialog.Title>Delete thread?</AlertDialog.Title>
              <AlertDialog.Description>
                This permanently deletes the thread and its entire transcript. This action cannot be
                undone.
              </AlertDialog.Description>
            </AlertDialog.Header>
            <AlertDialog.Footer>
              <AlertDialog.Close render={<Button variant="ghost">Cancel</Button>} />
              <Button variant="danger">Delete</Button>
            </AlertDialog.Footer>
          </AlertDialog.Popup>
        </AlertDialog.Root>
      </div>
    </Section>
  );
}

// ── Story: Switch ───────────────────────────────────────────────────────────────────────────

function SwitchStory(): React.ReactElement {
  return (
    <>
      <Section
        title="Switch — off · on · disabled (Base UI)"
        note="An instant-effect toggle: the track flips layer-02 → accent and the on-accent knob slides on check. State is uncontrolled here (defaultChecked) — click to toggle; tab in for the accent focus ring, drop your OS to reduced-motion and the slide + flip go instant."
      >
        <div {...stylex.props(styles.specRow)}>
          <span {...stylex.props(styles.statusInline)}>
            <Switch />
            <Text size="sm">Off</Text>
          </span>
          <span {...stylex.props(styles.statusInline)}>
            <Switch defaultChecked />
            <Text size="sm">On</Text>
          </span>
          <span {...stylex.props(styles.statusInline)}>
            <Switch disabled />
            <Text size="sm" tone="faint">
              Disabled off
            </Text>
          </span>
          <span {...stylex.props(styles.statusInline)}>
            <Switch disabled defaultChecked />
            <Text size="sm" tone="faint">
              Disabled on
            </Text>
          </span>
        </div>
      </Section>
      <Section
        title="Sizes"
        note="md is the canonical toggle (30×18 track, 14px knob); sm is the compact menu-row density (26×16, 12px knob). Named-intrinsic geometry — a switch track is shorter than the 24/28/32 control scale, so it reads its own anatomy consts, not controlVars."
      >
        {(["sm", "md"] as const).map((size) => (
          <div key={size} {...stylex.props(styles.specRow)}>
            <SpecLabel>{size}</SpecLabel>
            <Switch size={size} />
            <Switch size={size} defaultChecked />
          </div>
        ))}
      </Section>
    </>
  );
}

// ── Story: Checkbox ─────────────────────────────────────────────────────────────────────────

function CheckboxStory(): React.ReactElement {
  return (
    <>
      <Section
        title="Checkbox — states"
        note="Base UI Checkbox.Root (role=checkbox + hidden input) + Indicator. Unchecked = bg-base field + hairline border-base ring; checked/indeterminate = accent fill (ring drops); the tick fades in on Base UI's transition attrs. Uncontrolled via defaultChecked; the mixed box uses `indeterminate` (a centered dash, not the checkmark)."
      >
        <div {...stylex.props(styles.specRow)}>
          <SpecLabel>unchecked</SpecLabel>
          <Checkbox aria-label="unchecked" />
          <SpecLabel>checked</SpecLabel>
          <Checkbox defaultChecked aria-label="checked" />
          <SpecLabel>indeterminate</SpecLabel>
          <Checkbox indeterminate aria-label="indeterminate" />
        </div>
        <div {...stylex.props(styles.specRow)}>
          <SpecLabel>disabled</SpecLabel>
          <Checkbox disabled aria-label="disabled" />
          <SpecLabel>disabled checked</SpecLabel>
          <Checkbox disabled defaultChecked aria-label="disabled checked" />
          <SpecLabel>disabled mixed</SpecLabel>
          <Checkbox disabled indeterminate aria-label="disabled mixed" />
        </div>
      </Section>
      <Section
        title="Checkbox — sizes"
        note="md 18 (default) · sm 16 — named intrinsics matched to switch.tsx's md/sm track heights so a checkbox and a switch sit level in a row, NOT the 24/28/32 control scale (a tick box is not a full control). The checkmark is a 12px <Icon> for both."
      >
        <div {...stylex.props(styles.specRow)}>
          <SpecLabel>sm</SpecLabel>
          <Checkbox size="sm" defaultChecked aria-label="small checked" />
          <Checkbox size="sm" indeterminate aria-label="small mixed" />
          <SpecLabel>md</SpecLabel>
          <Checkbox size="md" defaultChecked aria-label="medium checked" />
          <Checkbox size="md" indeterminate aria-label="medium mixed" />
        </div>
      </Section>
    </>
  );
}

// ── Story: Separator ────────────────────────────────────────────────────────────────────────

function SeparatorStory(): React.ReactElement {
  return (
    <>
      <Section
        title="Separator — horizontal rule (Base UI)"
        note="A hairline between stacked sections. tone=muted (default) is the quiet divider; tone=base is a hair stronger (border-base vs border-muted). It is a 1px background fill, not a CSS border, so toggling it never shifts layout."
      >
        <div {...stylex.props(styles.specColumn)}>
          <Text size="sm" tone="muted">
            Above the muted rule (default)
          </Text>
          <Separator />
          <Text size="sm" tone="muted">
            Between the two tones
          </Text>
          <Separator tone="base" />
          <Text size="sm" tone="muted">
            Below the base rule
          </Text>
        </div>
      </Section>
      <Section
        title="Vertical — the toolbar divider"
        note="orientation=vertical stretches to the row's cross axis via alignSelf (never height:100%, which would collapse under an indefinite parent); flexShrink 0 keeps it from vanishing in a tight row. Base UI supplies role=separator + aria-orientation for free."
      >
        <div {...stylex.props(styles.specRow)}>
          <Text size="sm">Edit</Text>
          <Separator orientation="vertical" />
          <Text size="sm">Select</Text>
          <Separator orientation="vertical" />
          <Text size="sm">View</Text>
          <Separator orientation="vertical" tone="base" />
          <Text size="sm">Help</Text>
        </div>
      </Section>
    </>
  );
}

// ── Story: Spinner ──────────────────────────────────────────────────────────────────────────

function SpinnerStory(): React.ReactElement {
  return (
    <>
      <Section
        title="Spinner — indeterminate loader"
        note="A faint ring (border-muted) whose top arc the tone repaints, spinning linearly at the 900ms spinner duration — the classic quarter-arc loader. tone = accent (the liveness default) · muted (a quiet inline loader). Pure StyleX, no Base UI."
      >
        <div {...stylex.props(styles.iconGrid)}>
          {(["accent", "muted"] as const).map((tone) => (
            <div key={tone} {...stylex.props(styles.iconCell)}>
              <Spinner tone={tone} label={`Loading (${tone})`} />
              <Text size="xs" tone="faint" family="mono">
                {tone}
              </Text>
            </div>
          ))}
        </div>
      </Section>
      <Section
        title="Sizes"
        note="sm · md · lg on the ICON ramp (14 / 16 / 18px) — a spinner stands in for a glyph, so it sizes like an <Icon>, not a control."
      >
        {(["sm", "md", "lg"] as const).map((size) => (
          <div key={size} {...stylex.props(styles.specRow)}>
            <SpecLabel>{`size=${size}`}</SpecLabel>
            <Spinner size={size} tone="accent" label={`Loading ${size}`} />
            <Spinner size={size} tone="muted" label={`Loading ${size} muted`} />
          </div>
        ))}
      </Section>
      <Section
        title="A11y — announced vs decorative"
        note="A lone spinner takes a label and becomes an announced status region (role=status). A spinner beside its own visible text is decorative (aria-hidden), so nothing double-announces. Reduced motion halts the spin to a static tracked ring — toggle the OS setting to see it stop."
      >
        <div {...stylex.props(styles.specRow)}>
          <span {...stylex.props(styles.statusInline)}>
            <Spinner tone="muted" />
            <Text size="sm">Loading…</Text>
          </span>
          <span {...stylex.props(styles.statusInline)}>
            <Spinner tone="accent" />
            <Text size="sm">Sending</Text>
          </span>
          <Spinner tone="accent" label="Loading" />
        </div>
      </Section>
    </>
  );
}

// ── Story: Kbd ──────────────────────────────────────────────────────────────────────────────

function KbdStory(): React.ReactElement {
  return (
    <>
      <Section
        title="Kbd — sizes"
        note="A monospace keycap chip on a native <kbd>. minWidth = height, so a lone glyph reads as a square coin; a word grows past it on the inline pad. sm takes micro type, md caption."
      >
        <div {...stylex.props(styles.specRow)}>
          <Kbd size="sm">K</Kbd>
          <Kbd size="sm">/</Kbd>
          <Kbd size="sm">Esc</Kbd>
          <Kbd size="md">K</Kbd>
          <Kbd size="md">/</Kbd>
          <Kbd size="md">Esc</Kbd>
        </div>
      </Section>
      <Section
        title="Shortcuts"
        note="Modifier symbols and multi-key hints compose as separate keycaps in the app's own flex row — the app arranges primitives; a Kbd is one key."
      >
        <div {...stylex.props(styles.specRow)}>
          <Kbd>⌘</Kbd>
          <Kbd>⇧</Kbd>
          <Kbd>⌥</Kbd>
          <Kbd>⌃</Kbd>
          <Kbd>K</Kbd>
          <Kbd>⏎</Kbd>
          <Kbd>Tab</Kbd>
          <Kbd>Space</Kbd>
        </div>
      </Section>
    </>
  );
}

// ── Story: Design system (the master tuning page) ─────────────────────────────────────────────
// One page that surfaces EVERY token knob (the dial rail mounts a panel per group via
// DesignSystemDials) over a specimen board that repaints live as you dial — the "adjust every value
// across the design system" surface. Specimens are the real primitives (they already read the
// tokens), so tuning Control resizes the buttons, Radius re-rounds them, Chrome & weight restyles
// the type, Motion changes the pulse + tooltip fade. Copy a panel to export its JSON.

const SWATCH_RING = `inset 0 0 0 1px ${colorVars["--honk-color-border-base"]}`;
const RADIUS_SWATCHES = [
  ["panel", "rPanel"],
  ["window", "rWindow"],
  ["control", "rControl"],
  ["field", "rField"],
  ["bubble", "rBubble"],
] as const;
// The prose ramp maps the five Text sizes onto the five type steps (xs=caption … xl=heading).
const TYPE_RAMP = [
  ["xl", "Heading — the largest step"],
  ["lg", "Title — the conversation tier"],
  ["base", "Body — default prose"],
  ["sm", "Detail — secondary rows"],
  ["xs", "Caption — the smallest label"],
] as const;
const ICON_RAMP = ["xs", "sm", "md", "lg", "xl"] as const;

const swatchStyles = stylex.create({
  box: {
    width: DEMO_SWATCH_W,
    height: DEMO_SWATCH_H,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colorVars["--honk-color-layer-02"],
    color: colorVars["--honk-color-text-muted"],
    fontFamily: fontVars["--honk-font-family-mono"],
    fontSize: fontVars["--honk-font-size-micro"],
    boxShadow: SWATCH_RING,
  },
  rPanel: { borderRadius: radiusVars["--honk-radius-panel"] },
  rWindow: { borderRadius: radiusVars["--honk-radius-window"] },
  rControl: { borderRadius: radiusVars["--honk-radius-control"] },
  rField: { borderRadius: radiusVars["--honk-radius-field"] },
  rBubble: { borderRadius: radiusVars["--honk-radius-bubble"] },
});

function DesignStory(): React.ReactElement {
  return (
    <>
      <DesignSystemDials />
      <Toaster />
      <Section
        title="Design system — every knob in one place"
        note="The dial rail on the right has a panel per token group. Move any knob and every specimen below repaints live — the values rewrite --honk-* on <html> with zero React. Hit a panel's Copy button to export its values as JSON, then paste into tokens.stylex.ts. (Colors arrive in the next pass — light-dark pairs need per-arm knobs.)"
      />

      <Section title="Controls — dial Control · Radius · Chrome & weight">
        <div {...stylex.props(styles.specRow)}>
          {BUTTON_VARIANTS.map((variant) => (
            <Button key={variant} variant={variant}>
              {variant}
            </Button>
          ))}
        </div>
        <div {...stylex.props(styles.specRow)}>
          {BUTTON_SIZES.map((size) => (
            <Button key={size} size={size} variant="primary">
              Send
            </Button>
          ))}
          <Tooltip label="Search">
            <IconButton aria-label="Search">
              <Icon icon={IconMagnifyingGlass} size="sm" />
            </IconButton>
          </Tooltip>
          {BADGE_TONES.slice(0, 4).map((tone) => (
            <Badge key={tone} tone={tone}>
              {tone}
            </Badge>
          ))}
          {STATUS_TONES.slice(0, 5).map((tone) => (
            <StatusDot key={tone} tone={tone} label={tone} />
          ))}
        </div>
      </Section>

      <Section title="Radius — dial Radius">
        <div {...stylex.props(styles.specRow)}>
          {RADIUS_SWATCHES.map(([label, variant]) => (
            <span key={label} {...stylex.props(swatchStyles.box, swatchStyles[variant])}>
              {label}
            </span>
          ))}
        </div>
      </Section>

      <Section title="Type — dial Prose type · Chrome & weight">
        <div {...stylex.props(styles.specColumn)}>
          {TYPE_RAMP.map(([size, sample]) => (
            <Text key={size} size={size}>
              {sample}
            </Text>
          ))}
        </div>
      </Section>

      <Section title="Icon — dial Icon">
        <div {...stylex.props(styles.specRow)}>
          {ICON_RAMP.map((size) => (
            <Icon key={size} icon={IconEyeOpen} size={size} />
          ))}
        </div>
      </Section>

      <Section title="Motion — dial Motion (hover the button; the dot pulses)">
        <div {...stylex.props(styles.specRow)}>
          <StatusDot tone="warn" pulse label="pulse" />
          <Tooltip label="I fade in on the Motion durations">
            <Button variant="secondary">Hover me</Button>
          </Tooltip>
        </div>
      </Section>
      <Section title="Toast — dial Toast">
        <Button
          onClick={() => {
            toast("Design tokens updated", {
              description: "The friendly top-center surface repaints live.",
              icon: <Icon icon={IconCircleCheck} size="lg" tone="ok" />,
            });
          }}
        >
          Show toast
        </Button>
      </Section>
    </>
  );
}

// ── Shell chrome (the browser itself) ───────────────────────────────────────────────────────

const STORIES = [
  { path: "/design", label: "Design system" },
  { path: "/shell", label: "Shell" },
  { path: "/tabs", label: "Tabs" },
  { path: "/button", label: "Button" },
  { path: "/switch", label: "Switch" },
  { path: "/checkbox", label: "Checkbox" },
  { path: "/badge", label: "Badge" },
  { path: "/status-dot", label: "StatusDot" },
  { path: "/separator", label: "Separator" },
  { path: "/spinner", label: "Spinner" },
  { path: "/kbd", label: "Kbd" },
  { path: "/toast", label: "Toast" },
  { path: "/tooltip", label: "Tooltip" },
  { path: "/popover", label: "Popover" },
  { path: "/menu", label: "Menu" },
  { path: "/dialog", label: "Dialog" },
  { path: "/alert-dialog", label: "AlertDialog" },
  { path: "/matrix", label: "Matrix" },
  { path: "/text", label: "Text" },
  { path: "/icon", label: "Icon" },
  { path: "/conversation", label: "Conversation" },
] as const;

function StoryRail(): React.ReactElement {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <nav aria-label="Component stories" {...stylex.props(styles.rail)}>
      <Text as="p" size="xs" tone="faint" weight="semibold" xstyle={styles.railHeading}>
        @honk/ui
      </Text>
      {STORIES.map((story) => (
        <Link
          key={story.path}
          to={story.path}
          {...stylex.props(styles.railItem, pathname === story.path && styles.railItemActive)}
        >
          {story.label}
        </Link>
      ))}
    </nav>
  );
}

function RootLayout(): React.ReactElement {
  const appearance: Appearance = useAppearance();

  return (
    <Shell xstyle={schemeStyles[appearance]}>
      <Shell.Stage>
        <Shell.Sheet>
          <div {...stylex.props(styles.galleryBody)}>
            <div {...stylex.props(styles.galleryCol, styles.storyRegion)}>
              <StoryRail />
            </div>
            <div
              {...stylex.props(styles.galleryCol, styles.galleryColDivided, styles.galleryColGrow)}
            >
              <div {...stylex.props(styles.canvas)}>
                <div {...stylex.props(styles.canvasInner)}>
                  <Outlet />
                </div>
              </div>
            </div>
            <div {...stylex.props(styles.galleryCol, styles.galleryColDivided, styles.dialRegion)}>
              <DialRoot mode="inline" defaultOpen />
              {/* Theme is the one always-on panel; every other panel mounts inside its story,
                  so the rail follows the story on screen (see dev/dials.ts, the panel catalog). */}
              <ThemeDials />
            </div>
          </div>
        </Shell.Sheet>
      </Shell.Stage>
    </Shell>
  );
}

// ── Routes (loaders are the route→store seam ADR 0025 allows) ──────────────────────────────
// None of the stories needs route state synced into a store, so the seam carries only the
// index redirect onto the first story.

const rootRoute = createRootRoute({
  component: RootLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  loader: () => {
    throw redirect({ to: "/shell" });
  },
  component: () => null,
});

const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/shell",
  component: ShellStory,
});

const tabsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tabs",
  component: TabsStory,
});

const buttonRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/button",
  component: ButtonStory,
});

const badgeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/badge",
  component: BadgeStory,
});

const statusDotRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/status-dot",
  component: StatusDotStory,
});

const tooltipRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tooltip",
  component: TooltipStory,
});

const toastRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/toast",
  component: ToastStory,
});

const popoverRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/popover",
  component: PopoverStory,
});

const menuRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/menu",
  component: MenuStory,
});

const dialogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dialog",
  component: DialogStory,
});

const alertDialogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/alert-dialog",
  component: AlertDialogStory,
});

const matrixRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/matrix",
  component: MatrixStory,
});

const textRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/text",
  component: TextStory,
});

const iconRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/icon",
  component: IconStory,
});

const conversationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/conversation",
  component: ConversationStory,
});

const designRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/design",
  component: DesignStory,
});

const switchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/switch",
  component: SwitchStory,
});

const checkboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/checkbox",
  component: CheckboxStory,
});

const separatorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/separator",
  component: SeparatorStory,
});

const spinnerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/spinner",
  component: SpinnerStory,
});

const kbdRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/kbd",
  component: KbdStory,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  designRoute,
  shellRoute,
  tabsRoute,
  buttonRoute,
  switchRoute,
  checkboxRoute,
  badgeRoute,
  statusDotRoute,
  separatorRoute,
  spinnerRoute,
  kbdRoute,
  toastRoute,
  tooltipRoute,
  popoverRoute,
  menuRoute,
  dialogRoute,
  alertDialogRoute,
  matrixRoute,
  textRoute,
  iconRoute,
  conversationRoute,
]);

// Hash history: the playground serves one HTML file, and story deep links must survive reloads.
const router = createRouter({ routeTree, history: createHashHistory() });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// ── Mount ───────────────────────────────────────────────────────────────────────────────────

const rootEl = document.getElementById("root");

if (rootEl === null) {
  throw new Error("dev/index.html must provide #root");
}

createRoot(rootEl).render(
  <React.StrictMode>
    {/* One TooltipProvider at the root shares the open delay + skip-grouping window across every
        trigger-based Tooltip (the tab strip's controlled AnchoredTooltip owns its own delay). */}
    <TooltipProvider>
      <RouterProvider router={router} />
    </TooltipProvider>
  </React.StrictMode>,
);
