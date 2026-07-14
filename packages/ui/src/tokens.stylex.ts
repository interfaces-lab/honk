// The design vocabulary — the ONE file where honk's client (@honk/ui + @honk/app) design
// values live. Nothing else in the client layer may write a raw px/hex/ms/color; everything
// references a token from here (StyleX charter, ADR 0023 + the stylex skill).
//
// WHERE THESE VALUES COME FROM (the shell identity round, 2026-07-05)
// These are no longer the wireframe board's placeholder vocabulary. The identity round replaced
// the VALUES (never the call sites) with honk's real shell identity, drawn from the two sources
// the user named:
//   • the opencode v2 design system (github.com/anomalyco/opencode,
//     packages/ui/src/v2/styles/colors.css + theme.css) — the neutral ladder's character:
//     zero-hue greys in small even steps with one deep well, alpha chrome over opaque fills,
//     ring-and-bevel elevation;
//   • honk's shipped app (packages/app + packages/honkkit) — the brand hue (#599ce7 sky blue,
//     never opencode's indigo), the foreground base the whole app derives from, and the chrome
//     geometry (34px titlebar, 80px traffic-light reservation, the 12/13px chrome type).
// Each group's comment names its own sources. The typography + icon + conversation groups were
// already ported from the shipped app in the chat round and are unchanged except where noted.
//
// STRUCTURE STAYS LOCKED — VALUES ARE THE IDENTITY
// The locked board (.design/wireframes/locked.html §0/§1) owns structure and vocabulary law
// (inset recipe, tab plane, status language); its pixels were throwaway. Component call sites
// only ever reference token KEYS (e.g. colorVars["--honk-color-accent"]), so retuning identity
// never touches a component. Keep it that way: no literal values outside this file.
//
// THEMING MECHANISM
// Light/dark lives INSIDE the color values via CSS `light-dark()`. Which arm resolves is driven
// by `color-scheme`, which the theme-scope element sets (light | dark) — a manual theme toggle
// flips `color-scheme`, not a duplicate token set, and no `prefers-color-scheme` media query is
// needed. (Root wiring lives in the app, not here — this file only defines the vars.)
//
// SHAPE (stylex skill, Tokens rules 1-2): one `stylex.defineVars` per concern over a plain `*Defaults`
// object exported alongside it, plus a `*VarName` key-union type. Keys are the literal
// `--honk-*` custom-property names, read by bracket at call sites.

import * as stylex from "@stylexjs/stylex";

// ── Color ──────────────────────────────────────────────────────────────────────────────────
// bg-*/layer-* = the inset recipe's surfaces (deep root → base cards → layer-01/02/03 fills);
// text-* = the type ramp; border-* = hairline strokes; accent = the one brand hue; the
// status family (ok/warn/err/info) carries meaning — fg for glyphs/text, bg + border for chips.
//
// SURFACES — ALF RETUNE (2026-07-12): values re-anchored to Bluesky's ALF palette
// (@bsky.app/alf 0.1.14 palette.ts; mapping report: 2026-07-12 session scratchpad
// reports/alf-token-mapping.md, opus-mapped + fable-reviewed). Light arm = ALF's default
// contrast ladder (blue-tinted grays: contrast_50 page bg, white card, contrast_25/100/200/300
// fills). Dark arm = ALF's DIM theme (invertPalette over the subdued palette — the navy
// #151D28-rooted ladder), chosen over ALF's pure-black dark theme so honk's floating-sheet
// elevation stays legible and the neutrals carry the same blue cast as the accent. Semantic
// structure unchanged — this is a value retune, not a rename.
const colorDefaults = {
  "--honk-color-bg-deep": "light-dark(#EFF2F6, #151D28)",
  "--honk-color-bg-base": "light-dark(#ffffff, #1C2736)",
  "--honk-color-layer-01": "light-dark(#F9FAFB, #222E3F)",
  "--honk-color-layer-02": "light-dark(#DCE2EA, #2C3A4E)",
  "--honk-color-layer-03": "light-dark(#C0CAD8, #394960)",
  // CHROME FILL — the tab plane's neutral hover step, computed over bg-deep (tabs live on the
  // titlebar, which is the deep root, by locked §0/§1 law) instead of the card-relative layer
  // ladder above: on the light titlebar (#f3f3f3) the card layers run BACKWARDS (layer-01 is
  // lighter than the bar, making hover disappear). The hover is opaque on purpose: the tab close
  // button's scrim gradient reads the tab fill and must occlude the title fading beneath it.
  "--honk-color-tab-hover": "light-dark(#DCE2EA, #1C2736)",
  // OPENCODE-SHELL PORT ADDITIONS (2026-07-11, token-bridge report) — the v2 surfaces honk had
  // trimmed that the ported shell/composer actually consume. layer-04 completes the ladder
  // (grey-400/700); inverse/contrast are the flipped surfaces (tooltips, contrast buttons):
  // bg-contrast is opencode's grey-1000/grey-700 pair, its text/icon ride text-contrast below.
  "--honk-color-layer-04": "light-dark(#A5B2C5, #485B75)",
  "--honk-color-bg-inverse": "light-dark(#19222E, #ffffff)",
  "--honk-color-bg-contrast": "light-dark(#232E3E, #586C89)",
  "--honk-color-text-inverse": "light-dark(#ffffff, #111822)",
  // White on the contrast surface in BOTH arms (opencode text-contrast) — the contrast fill is
  // dark in both modes, so its label never flips.
  "--honk-color-text-contrast": "#ffffff",
  // TEXT. primary = ALF's text atom, pure black/white (contrast_1000 both palettes — user
  // ruling 2026-07-12: "black and white is good", replacing honk's softened #141414/#f0f0f0).
  // The conversation ramp derives from fg below by %-mixes, so the whole prose surface
  // re-anchors with it. muted/faint = ALF's text_contrast_medium (contrast_700) /
  // text_contrast_low (contrast_400) — the blue-gray working tones. faint is sub-AA in both
  // arms, same de-emphasis posture as the previous #808080.
  "--honk-color-text-primary": "light-dark(#000000, #ffffff)",
  "--honk-color-text-muted": "light-dark(#405168, #ABB8C9)",
  "--honk-color-text-faint": "light-dark(#8798B0, #586C89)",
  // BORDERS. Neutral alpha, never opaque grey, so hairlines composite on any layer — opencode
  // v2 border-muted/base (8%/10% alpha) and the shipped stroke ladder (8%/12% fg-mix, app
  // tokens.css --honk-stroke-tertiary/-secondary) agree on these intensities.
  "--honk-color-border-muted": "light-dark(rgba(0,0,0,.08), rgba(255,255,255,.08))",
  "--honk-color-border-base": "light-dark(rgba(0,0,0,.10), rgba(255,255,255,.10))",
  // The ladder's emphatic rung (opencode border-strong, alpha .20 both arms) — selected/active
  // outlines in the ported shell (e.g. the rail's selected project ring).
  "--honk-color-border-strong": "light-dark(rgba(0,0,0,.20), rgba(255,255,255,.20))",
  // ACCENT — Bluesky primary blue (ALF retune), split into PAINT vs FILL (2026-07-12 contrast
  // fix). `accent` is the PAINT arm — links, icons, focus rings — light = canonical
  // primary_500 #006AFF (~4.7:1 on white), dark = dim primary_600 #4D97FF (~6:1 on the navy
  // bg; ALF-literal #0F73FF reads 3.9:1 as paint, too weak for icons/links).
  "--honk-color-accent": "light-dark(#006AFF, #4D97FF)",
  // The FILL arm — a filled control's background (primary button, switch-on track). White
  // labels ride it in BOTH arms, so both arms use canonical primary_500 #006AFF (4.66:1 with
  // white). ALF's brighter dim primary_500 #0F73FF only reaches 4.27:1, which is insufficient
  // for the small labels used by Button and Badge. Never paint text with this token; never fill
  // with `accent` (its lighter dark arm is paint for links/icons, not a white-label surface).
  "--honk-color-accent-fill": "#006AFF",
  // The foreground painted ON the accent fill (a primary button's label/icon): white on both
  // arms, clearing AA against the shared #006AFF fill.
  "--honk-color-on-accent": "#ffffff",
  // The standing-selection wash — ALF primary_50 in each theme (light primary_50 / inverted
  // subdued primary_50). Bluesky uses this exact rung for the active Following feed; contrast_25
  // is only the neutral navigation hover, so it cannot communicate a persistent selection.
  "--honk-color-accent-subtle": "light-dark(#E5F0FF, #122949)",
  // CONTROL FILL — the neutral button's chip (2026-07-12 contrast retune, ALF-anchored). The
  // layer ladder starts at contrast_25 (#F9FAFB), which is 1.05:1 on the white card — a
  // near-white rectangle on white, the "buttons don't read" defect. Bluesky's own secondary
  // button fills with contrast_50 and hovers down the ramp, so the control trio takes ALF
  // contrast_50/100/200 in light (rest #EFF2F6 · hover #DCE2EA · press #C0CAD8) and the dim
  // ladder's same steps in dark. Buttons read these, NEVER layer-01/02/03: layer-01 doubles as
  // bg-deep's value in light, so a layer-filled control on the deep root would vanish.
  "--honk-color-control": "light-dark(#EFF2F6, #222E3F)",
  "--honk-color-control-hover": "light-dark(#DCE2EA, #2C3A4E)",
  "--honk-color-control-press": "light-dark(#C0CAD8, #394960)",
  // INTERACTION-STATE TINT — a neutral wash for FILLED variants (primary/danger), whose base is a
  // brand/status fill with no named "hover" rung. (Neutral controls hover by climbing the layer
  // ladder instead — layer-01→02→03, tab-hover→active — and never need this.) Applied as a
  // full-cover inset box-shadow so ONE tint darkens/lightens any fill uniformly. Alphas sit in the
  // same neutral black/white language as the hairlines (border-muted/base .08/.10), a touch either
  // side: press is darker than hover. Transparent ghost controls and list rows use these washes too,
  // because their host surface can vary and an opaque layer token would assume the wrong surface.
  "--honk-color-state-hover": "light-dark(rgba(0,0,0,.06), rgba(255,255,255,.08))",
  "--honk-color-state-press": "light-dark(rgba(0,0,0,.12), rgba(255,255,255,.14))",
  // SCRIM — the dimming wash behind a modal (the dialog / alert-dialog backdrop): black at a low
  // alpha, a touch heavier in the dark arm so the modal still separates from a dark app beneath it.
  // honkkit's shipped backdrop is black/32 (dialog.tsx); this keeps that light value and deepens the
  // dark one. A translucent overlay, not a surface — same neutral-black language as the state tints.
  "--honk-color-scrim": "light-dark(rgba(0,0,0,.32), rgba(0,0,0,.55))",
  // TOAST. The friendly notification floats above either appearance on one stable dark neutral
  // surface, matching expo-dynamic-toast's card/foreground/muted palette. Status remains in the
  // leading glyph; the card itself does not change hue, preserving honk's status-color discipline.
  "--honk-color-toast-bg": "#1a1a1c",
  "--honk-color-toast-text": "#f5f5f7",
  "--honk-color-toast-muted": "#a6a6ad",
  "--honk-color-toast-border": "rgba(255,255,255,.08)",
  "--honk-color-toast-subtle": "rgba(255,255,255,.06)",
  "--honk-color-toast-action-text": "#0a0a0b",
  // STATUS. ok/err = ALF positive/negative (retune): fg = hue_700 light / dim hue_600 dark ·
  // bg = hue_50 / dim hue_100 · border = hue_100 / dim hue_200 — honk's "fg dark-step light,
  // light-step dark; bg palest/deepest" convention translated onto ALF's 13-step ramps. warn
  // and info KEEP their previous values: ALF ships no yellow ramp (only static #FFC404, which
  // cannot hold text on white) and no info role (info == primary there — collapsing it would
  // make info indistinguishable from the new blue accent, and preset-high derives from it).
  // Mid-saturation discipline still applies: color carries status, never decoration.
  "--honk-color-ok-fg": "light-dark(#036D38, #0EDD75)",
  "--honk-color-warn-fg": "light-dark(#8e7231, #f2cf76)",
  "--honk-color-err-fg": "light-dark(#A71134, #F76486)",
  "--honk-color-info-fg": "light-dark(#2c47c8, #7698fd)",
  "--honk-color-ok-bg": "light-dark(#D3FDE8, #04522B)",
  "--honk-color-warn-bg": "light-dark(#fefaec, #4b4025)",
  "--honk-color-err-bg": "light-dark(#FEE7EC, #6F0B22)",
  "--honk-color-ok-border": "light-dark(#A3FACF, #056636)",
  "--honk-color-warn-border": "light-dark(#f7e5b5, #ac8833)",
  // info completes the triplet family (opencode state-bg/border-info, blue-100/1200 + 300/900)
  // — honk had only info-fg; the ported chips need the full set like ok/warn/err.
  "--honk-color-info-bg": "light-dark(#ecf1fe, #1b2852)",
  "--honk-color-info-border": "light-dark(#c3d4fd, #263fa9)",
  "--honk-color-err-border": "light-dark(#FDD3DD, #910D2C)",
  // PRESET TIERS (the composer's effort dial, 2026-07-11 grill: low/medium/high/ultra, each
  // pinning an Agent+Oracle model bundle at thread birth). The tier hues follow the reference
  // dial (Amp's low grey · medium green · high blue · ultra purple), expressed in honk's own
  // vocabulary where a hue already exists: low rides readable text-muted, medium the ok green, high the
  // info blue. Ultra's purple is NEW — honk had no purple; arms picked to hold AA-adjacent
  // contrast on each card like the status fg family (light ~5:1 on white, dark ~8:1 on #161616).
  "--honk-color-preset-low": "var(--honk-color-text-muted)",
  "--honk-color-preset-medium": "var(--honk-color-ok-fg)",
  "--honk-color-preset-high": "var(--honk-color-info-fg)",
  "--honk-color-preset-ultra": "light-dark(#6d45c8, #c0a7f5)",

  // ── Conversation ramp (CURRENT-APP PORT — the chat surface's exact colors) ──────────────
  // The decision hierarchy ports the chat view's visual values from the current app. The app
  // derives the whole conversation surface from ONE foreground base plus %-mixes of it
  // (packages/app/src/styles/tokens.css); the same derivation is kept here — var() references
  // between tokens are legal because every token lands on the same :root — so retuning the fg
  // base re-derives the ramp for free.
  // fg base: tokens.css:94 (light #141414) / :175 (dark #f0f0f0). The identity round unified
  // --honk-color-text-primary onto this same value (see TEXT above).
  "--honk-color-fg": "light-dark(#000000, #ffffff)",
  // Verb/secondary text = 74% fg; detail/tertiary text = 54% fg (tokens.css --honk-fg-secondary
  // / --honk-fg-tertiary).
  "--honk-color-fg-secondary": "color-mix(in srgb, var(--honk-color-fg) 74%, transparent)",
  "--honk-color-fg-tertiary": "color-mix(in srgb, var(--honk-color-fg) 54%, transparent)",
  // Failed tool rows. RECONCILED by the primitive pixel pass (2026-07-05) against the new
  // identity ladder: the app shipped --honk-tone-red #fc6b83 as ONE value for both modes
  // (tokens.css:417 + :393), but that pink was tuned for the dark editor and, dropped onto the
  // identity's white bg-base card (#ffffff), it reads at only 2.76:1 — below the 3:1 UI floor —
  // and clashes in hue with the identity's brick-red error foreground. A failed tool row IS an
  // error, so it now tracks the identity's own error foreground (--honk-color-err-fg, opencode
  // red-800 light / red-500 dark) by reference: one error red across the whole surface, AA on both
  // cards (6.1:1 light, 6.4:1 dark), instead of a second, weaker conversation-only red.
  "--honk-color-fg-red": "var(--honk-color-err-fg)",
  // Icon ramp's tertiary step = 46% fg (tokens.css --honk-icon-tertiary) — the disclosure
  // chevron's paint.
  "--honk-color-icon-tertiary": "color-mix(in srgb, var(--honk-color-fg) 46%, transparent)",
  // Hairline strokes over the conversation surface: 12% / 8% fg (tokens.css --honk-stroke-secondary
  // / --honk-stroke-tertiary).
  "--honk-color-stroke-secondary": "color-mix(in srgb, var(--honk-color-fg) 12%, transparent)",
  "--honk-color-stroke-tertiary": "color-mix(in srgb, var(--honk-color-fg) 8%, transparent)",
  // The user message bubble — a raised card, restated on the ALF ladder (contrast_25 light /
  // dim contrast_50 dark) so it sits one step off the surrounding surface in both arms.
  "--honk-color-message-bubble-bg": "light-dark(#F9FAFB, #222E3F)",
  // Its inset ring: stroke-tertiary in light, stroke-secondary in dark (packages/honkkit/src/
  // styles.css [data-message-bubble-surface]::after + the html.dark override).
  "--honk-color-message-bubble-ring":
    "light-dark(var(--honk-color-stroke-tertiary), var(--honk-color-stroke-secondary))",
  // Diff stats on edit rows (tokens.css:138-139). sRGB arms only — the app's
  // @media (color-gamut: p3) upgrade is a media-conditional override one token value can't
  // carry; still deferred (a P3 pass is not this round's scope).
  "--honk-color-diff-addition": "oklch(0.752 0.137 179.603)",
  "--honk-color-diff-deletion": "oklch(0.647 0.239 23.794)",
} as const;

// ── Elevation ──────────────────────────────────────────────────────────────────────────────
// opencode v2's elevation recipes (theme.css --v2-elevation-*): depth is drawn by EDGES, not
// blur — every tier ends in a 0.5px spread ring (alpha-dark-12 light / alpha-light-16 dark)
// and, in dark, a -0.5px top light edge (alpha-light-6) standing in for ambient light. The
// shipped app does the same thing (ring-first --honk-shadow-* recipes, the two-ring menu), so
// both sources agree that edges do the depth work here.
// `light-dark()` is color-only and cannot hold a comma-separated shadow list (its two args are
// top-level, comma-delimited), so each layer keeps ONE geometry across themes and only its
// colors switch — the established caveat (styling-tokens skill §Theming).
//   raised   = v2-elevation-raised (2px/1px drops) — the card tier.
//   floating = v2-elevation-overlay geometry (16px/32px drops) — menus, the gallery's demo
//              window; the top bevel now rides this tier too (the board round had dropped it).
const elevationDefaults = {
  "--honk-elevation-raised":
    "0 2px 4px light-dark(rgba(0,0,0,.04), rgba(0,0,0,.30))," +
    " 0 1px 2px light-dark(rgba(0,0,0,.08), rgba(0,0,0,.30))," +
    " 0 0 0 .5px light-dark(rgba(0,0,0,.12), rgba(255,255,255,.16))," +
    // dark-only top light edge; transparent in light, so it contributes nothing there.
    " 0 -.5px 0 light-dark(transparent, rgba(255,255,255,.06))",
  "--honk-elevation-floating":
    "0 16px 32px light-dark(rgba(0,0,0,.04), rgba(0,0,0,.30))," +
    " 0 8px 16px light-dark(rgba(0,0,0,.08), rgba(0,0,0,.30))," +
    " 0 0 0 .5px light-dark(rgba(0,0,0,.12), rgba(255,255,255,.16))," +
    " 0 -.5px 0 light-dark(transparent, rgba(255,255,255,.06))",
  // expo-dynamic-toast's deliberately soft, close shadow. The toast owns a separate elevation
  // because it is a compact friendly notification, not a window-sized floating menu.
  "--honk-elevation-toast": "0 10px 20px rgba(0,0,0,.45)",
  // opencode v2-elevation-button-neutral — the standing bevel a neutral button wears at rest
  // (the composer's model/agent triggers, the panel's New-session button): a 1px drop + the
  // same 0.5px ring + dark top light-edge language as the tiers above.
  "--honk-elevation-button-neutral":
    "0 1px 2px light-dark(rgba(0,0,0,.06), rgba(0,0,0,.24))," +
    " 0 0 0 .5px light-dark(rgba(0,0,0,.12), rgba(255,255,255,.16))," +
    " 0 -.5px 0 light-dark(transparent, rgba(255,255,255,.06))",
  // opencode v2-elevation-elements — the hairline under-edge small inline elements wear
  // (kbd chips, the dial's stop marks): a bare 0.5px drop, no ring.
  "--honk-elevation-elements": "0 .5px .5px rgba(0,0,0,.40)",
} as const;

// ── Radius ─────────────────────────────────────────────────────────────────────────────────
// panel = inset cards; window = the outer frame; control = buttons/tabs; field = inputs/composer;
// avatar = OpenCode v2's compact project mark; pill = fully-round chips and status dots.
// Aligned to the shipped app's radius scale (app tokens.css: --honk-radius-control 6px,
// --honk-radius-card 10px, and the 3/4/6/8/12/14/16 scale): panel = card 10, control = 6,
// field = the scale's 8 (the board's 9 sat off-scale). window 12 is board-kept — the shipped
// app never rounds its own window (the OS does), so nothing contradicts it.
const radiusDefaults = {
  "--honk-radius-panel": "10px",
  "--honk-radius-window": "12px",
  "--honk-radius-control": "6px",
  "--honk-radius-field": "8px",
  "--honk-radius-avatar": "4px",
  "--honk-radius-pill": "999px",
  // CURRENT-APP PORT: the user message bubble's 12px — the app's --honk-radius-xl
  // (packages/app/src/styles/tokens.css) applied by conversation-bubble.tsx's userBubble.
  "--honk-radius-bubble": "12px",
} as const;

// ── Space ──────────────────────────────────────────────────────────────────────────────────
// Minimal on purpose — only what the shell actually uses. gutter = the 8px inset between the
// deep root and the cards (the 8px is the locked recipe's own number, principles.md §1);
// panel-pad = a card's inner inset; control-pad-x = horizontal padding inside a control (both
// on the shipped 4px spacing grid, app tokens.css spacing scale).
const spaceDefaults = {
  "--honk-space-gutter": "8px",
  "--honk-space-panel-pad": "12px",
  "--honk-space-control-pad-x": "10px",
} as const;

// ── Control ──────────────────────────────────────────────────────────────────────────────────
// The shared size scale every INTERACTIVE control snaps to — button, icon-button, and (as they
// land) input, select, checkbox row. One family so a control's height is dialable as a system, not
// re-typed per primitive. Three heights + their inline paddings + the icon↔label gap.
//   h-md = 28px is honk's canonical control height — the SAME number the shell's tab + sidebar row
//     already use (shellVars --honk-shell-tab-h, shell.css --honk-sidebar-item-height). Kept as its
//     own control-family token (call sites are sacred) so tuning button size never moves the tab
//     plane and vice-versa. h-sm/h-lg step ±4 (the shipped 4px control grid).
//   pad-md = 10px equals the composer/control inline pad (--honk-space-control-pad-x); duplicated
//     on purpose so the whole button scale lives in one place. gap = the 6px icon-label gap
//     (shipped spacing-1-5; the wireframe .gbtn uses 5 — 6 is the shipped control value).
const controlDefaults = {
  "--honk-control-h-sm": "24px",
  "--honk-control-h-md": "28px",
  "--honk-control-h-lg": "32px",
  "--honk-control-pad-sm": "8px",
  "--honk-control-pad-md": "10px",
  "--honk-control-pad-lg": "12px",
  "--honk-control-gap": "6px",
} as const;

// ── Font ───────────────────────────────────────────────────────────────────────────────────
// Two ramps live here, honestly sourced:
//   • Families + the CHROME size ramp (font-size-body → -micro) drive the shell frame + tab
//     strip; identity-round values, see the ramp's own comment.
//   • The PROSE type ramp (text-* paired with leading-*) + the SF-Pro semibold weight are ported
//     from the current app's typography, resolved at its 13px default. Sizes/leadings from
//     packages/app/src/styles/tokens.css:15-24; weights from packages/honkkit/src/text.tsx:92-100.
// family-ui = bundled Inter. family-mono deliberately uses the platform stack: the bundled
// JetBrains face distorted dense menus and evidence rows at the app's compact type sizes.
const fontDefaults = {
  "--honk-font-family-ui": '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  "--honk-font-family-mono": 'ui-monospace, "SF Mono", Menlo, Monaco, Consolas, monospace',
  // Friendly notification copy follows the reference's SF Rounded face while retaining portable
  // rounded/system fallbacks outside Apple platforms.
  "--honk-font-family-rounded":
    'ui-rounded, "SF Pro Rounded", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',

  // Chrome/UI size ramp — the shipped app's fixed chrome type (app tokens.css "Workbench-fixed
  // typography"): body 13 = --honk-text-chrome · detail 12 = --honk-text-tab · caption 11 =
  // the sidebar subtitle (shell.css --honk-sidebar-subtitle-size) · micro 10 completes the
  // integer ladder one step below. The board's half-pixel steps (12.5/11.5/10.5) were
  // placeholder; shipped chrome sits on whole pixels.
  "--honk-font-size-body": "13px",
  "--honk-font-size-detail": "12px",
  "--honk-font-size-caption": "11px",
  "--honk-font-size-micro": "10px",
  // The step ABOVE body: opencode's text-base 14 (ui/src/styles/theme.css font-size ramp
  // small 13 / base 14) — the sidebar panel header + session-row tier in the v2 shell. The
  // 13px chrome body stays the tab/control tier; this names the one larger chrome step the
  // opencode shell actually uses so the port never writes a raw 14.
  "--honk-font-size-body-lg": "14px",

  // Prose type ramp (current-app port): each size paired with its line-height (leading), effective
  // px at the app's 13px default — caption 10·12 · detail 11·14 · body 12·16 · title 13·18 ·
  // heading 16·21 (tokens.css:15-24). The <Text> primitive maps its size prop onto these; the chat
  // conversation tier is the title step (13·18). Distinct from the chrome ramp above ON PURPOSE —
  // the app fixes chrome typography apart from the scalable prose ramp.
  "--honk-text-caption": "10px",
  "--honk-text-detail": "11px",
  "--honk-text-body": "12px",
  "--honk-text-title": "13px",
  "--honk-text-heading": "16px",
  "--honk-leading-caption": "12px",
  "--honk-leading-detail": "14px",
  "--honk-leading-body": "16px",
  "--honk-leading-title": "18px",
  "--honk-leading-heading": "21px",

  // Weights — RETUNED for the bundled Inter face (the 510/590 values were SF-Pro-specific
  // optical corrections; on Inter's variable axis opencode uses the plain stops). book 440 is
  // opencode's body/editor weight (home nav rows, the composer editor `font-[440]`) — Inter
  // renders 400 slightly lighter than SF, and 440 is the reference's deliberate correction.
  "--honk-font-weight-regular": "400",
  "--honk-font-weight-book": "440",
  "--honk-font-weight-medium": "500",
  "--honk-font-weight-semibold": "600",
} as const;

// ── Icon ───────────────────────────────────────────────────────────────────────────────────
// The glyph-box size ramp for the <Icon> primitive. Icon sets font-size from one of these and the
// glyph renders at size="1em", so the token owns the box. Ported from the current app's icon sizing
// (packages/honkkit/src/theme/tokens.stylex.ts:56-60; the app's Tailwind size-3/3.5/4/4.5/5 census
// confirms 16px — md — as the dominant default step).
const iconDefaults = {
  "--honk-icon-size-xs": "12px",
  "--honk-icon-size-sm": "14px",
  "--honk-icon-size-md": "16px",
  "--honk-icon-size-lg": "18px",
  "--honk-icon-size-xl": "20px",
} as const;

// ── Motion ─────────────────────────────────────────────────────────────────────────────────
// The blessed motion vocabulary, sourced whole from opencode v2 + the shipped honk app (round 8
// motion research). THE HEADLINE FINDING: neither source animates a message or a tool-call row
// on MOUNT — no enter fade, no slide. So there is deliberately NO enter/fade-in token here;
// inventing one would diverge from both references. Motion is reserved for four jobs only:
// liveness (shimmer/spin), disclosure (chevron + height), hover/press state, and OVERLAYS that
// scale-fade in on their own open state (menu/tooltip/tray). Every animated call site still
// re-declares its own prefers-reduced-motion → 0s sibling (stylex skill, create() rule 7) —
// StyleX cannot emit a media-query token override the way the shipped global :root does.
//
// Duration tiers (motion memo Q4; each value appears in a source):
//   instant     overlay EXIT — always faster than its enter (opencode tooltip/select 80ms).
//   hover       hover/press color+opacity flips, the close-button reveal (shipped --motion-duration-hover 100ms).
//   fast        overlay ENTER — the menu/tooltip/tray scale-in (opencode menu-v2/tooltip-v2 120ms).
//   base        standard reveals: tabs, status bars, the tooltip enter (shipped --motion-duration-ui 150ms).
//   expand      collapsible HEIGHT open/close (shipped collapsible 200ms; opencode accordion 180ms).
//   collapsible the disclosure CHEVRON rotation only — kept at its own honest 100ms (shipped --motion-duration-collapsible).
//   shimmer     one running-verb shine pass / waiting-label sweep (shipped --motion-duration-shimmer 2000ms; opencode 1200ms — honk's identity is 2000).
//   spinner     indeterminate spin (opencode loader-v2 900ms).
const motionDefaults = {
  "--honk-motion-duration-instant": "80ms",
  "--honk-motion-duration-hover": "100ms",
  "--honk-motion-duration-fast": "120ms",
  "--honk-motion-duration-base": "150ms",
  "--honk-motion-duration-expand": "200ms",
  "--honk-motion-duration-collapsible": "100ms",
  "--honk-motion-duration-shimmer": "2000ms",
  "--honk-motion-duration-spinner": "900ms",
  // Easings. ease-out is honk's real house curve (shipped --ease-shell, tokens.css:483) —
  // REPLACING the round-1 board's un-sourced cubic-bezier(0.2,0,0,1); the identity round's
  // "values are sourced" law applies to motion too. ease-in accelerates overlay exits (opencode
  // tooltip/select/toast close all use the plain keyword). ease-float is the expo-out honk floats
  // overlays on (shipped --honk-menu-motion-ease / --honk-motion-ease-float, tokens.css:381).
  "--honk-motion-ease-out": "cubic-bezier(0.215, 0.61, 0.355, 1)",
  "--honk-motion-ease-in": "ease-in",
  "--honk-motion-ease-float": "cubic-bezier(0.16, 1, 0.3, 1)",
  // The main-frame slide (opencode layout.tsx: the content frame's `left` animates on sidebar
  // toggle with this spring-flavored curve over the expand duration; disabled during drag).
  "--honk-motion-ease-slide": "cubic-bezier(0.22, 1, 0.36, 1)",
  // Overlay scale endpoint — the scale an overlay grows from on enter / shrinks to on exit
  // (shipped --tt-scale 0.98; opencode menu/tooltip use 0.96). honk identity = 0.98. Unitless: it
  // is consumed inside scale().
  "--honk-motion-scale-overlay": "0.98",
} as const;

// ── Z-index ────────────────────────────────────────────────────────────────────────────────
// The overlay stacking order, ported from honkkit's z-index stack (packages/honkkit/src/
// styles.css:6-35) collapsed onto @honk/ui's own namespace. The shipped stack ran a "base" tier
// (60: popover/menu/select/tooltip) under a "workbench" tier (70) under dialogs (80) under
// command (90) under toasts (100); the new unified surface keeps the numeric tiers but one name
// per concept. An overlay's z-index is a PRIMITIVE internal (its slot in the overlay stack), so a
// primitive reads these in StyleX on its positioner (tooltip.tsx sx.positioner), NOT a Tailwind
// utility — Tailwind is for the app arranging primitives, not a primitive's own stacking (round-8
// division, refined by the GPT-5.5 consult). Tokenizing keeps the stack dialable and on the bridge.
// tooltip sits at the top of the overlay tier so a hint over an open menu still reads.
const zDefaults = {
  // The shell stage's internal layers (opencode layout.tsx composition: sidebar nav 10 <
  // main frame 20 < resize handle / hover-peek 30) — all below the overlay tiers.
  "--honk-z-stage-side": "10",
  "--honk-z-stage-main": "20",
  "--honk-z-stage-float": "30",
  "--honk-z-titlebar": "50",
  "--honk-z-popover": "60",
  "--honk-z-menu": "60",
  "--honk-z-tooltip": "65",
  "--honk-z-dialog": "80",
  "--honk-z-command": "90",
  "--honk-z-toast": "100",
} as const;

// ── Toast ───────────────────────────────────────────────────────────────────────────────────
// Component-specific anatomy ported from expo-dynamic-toast and the supplied top-center
// reference: a compact pill, 32px leading slot, 14/13px two-line type, and an 18px top inset.
// Sonner owns stack physics and swipe thresholds; these tokens own only the visible vocabulary.
const toastDefaults = {
  "--honk-toast-offset": "18px",
  "--honk-toast-radius": "18px",
  "--honk-toast-padding-block": "12px",
  "--honk-toast-padding-inline": "16px",
  "--honk-toast-content-gap": "3px",
  "--honk-toast-item-gap": "12px",
  "--honk-toast-icon-size": "32px",
  "--honk-toast-border-width": "1px",
  "--honk-toast-title-size": "14px",
  "--honk-toast-title-leading": "18px",
  "--honk-toast-description-size": "13px",
  "--honk-toast-description-leading": "17px",
  "--honk-toast-close-size": "22px",
} as const;

// ── Conversation ───────────────────────────────────────────────────────────────────────────
// Geometry of the thread surface's rows (CURRENT-APP PORT). inset = the horizontal text inset
// every conversation row carries inside the timeline column (--conversation-text-inset: 11px,
// packages/app/src/styles/conversation.css); row-min-h = the 24px min-height the tool line and
// status row share (min-h-6: packages/honkkit/src/tool-call.tsx toolCallLineVariants +
// packages/app/.../message/status-row.tsx); row-gap = the 4px slot gap inside rows and between
// a work group's header and body (gap-1 + --chat-timeline-collapsible-header-gap,
// conversation.css); step-gap = the 6px gap between steps inside a group
// (--chat-timeline-step-gap, conversation.css).
const conversationDefaults = {
  "--honk-conversation-inset": "11px",
  "--honk-conversation-row-min-h": "24px",
  "--honk-conversation-row-gap": "4px",
  "--honk-conversation-step-gap": "6px",
} as const;

// ── Shell ──────────────────────────────────────────────────────────────────────────────────
// Fixed geometry of the window chrome / thread-tab strip, aligned to the SHIPPED app's chrome
// where it contradicts the board: titlebar 34px (Cursor/VS Code .part.titlebar parity —
// packages/app/src/lib/desktop-chrome.ts TITLEBAR_HEIGHT + shell.css --honk-header-height);
// inset-left 80px (MACOS_TRAFFIC_LIGHTS.spacerWidth in desktop-chrome.ts, in sync with the
// Electron trafficLightPosition — the board's 84px was placeholder). tab-h 28 stands: the board
// asks 28 and the shipped app's own control row height agrees (shell.css
// --honk-sidebar-item-height: 28px). tab-max-w/min-w bound a tab as the strip fills; tab-gap is
// the spacing between tabs (the 1.5px separator pills sit within it).
//
// titlebar-seat = opencode's tab-seating mechanism made a dial. opencode aligns its tab row with
// `items-center` AND a top pad (pt-2 on its 36px bar) so the 28px tabs net to BOTTOM-seated with
// clear air above (titlebar research §1). honk's TitleBar centers the row (items-center) and adds
// THIS top pad: 0 = true-centered (3px/3px on the 34px bar), and dialing it toward 6px pushes the
// 28px tab down until it bottom-seats — the exact opencode sweep, tunable per the "wireframe is
// never the fixed pixel" rule instead of hard-coded to one seat.
//
// GEOMETRY-CLONE RETUNE (2026-07-11, shell-anatomy report): the opencode v2 desktop's chrome
// numbers replace the shipped-app holdovers — titlebar h-9 = 36px with pt-2 (an 8px seat:
// 36 − 8 − 28 nets the 28px tab bottom-seated with all its air above, opencode's exact
// arrangement); traffic-light reservation 84px (their macOS padding-left, up from the shipped
// 80 — the Electron trafficLightPosition y moves to 14 in the desktop host to match the taller
// bar). Tab width/gap already matched. rail/side are the sidebar column: 64px icon rail; the
// side column (rail + panel) defaults 344 and clamps at 244 (side-min); panel = side − rail.
const shellDefaults = {
  "--honk-shell-titlebar-h": "36px",
  "--honk-shell-titlebar-seat": "8px",
  "--honk-shell-tab-h": "28px",
  "--honk-shell-tab-max-w": "224px",
  "--honk-shell-tab-min-w": "28px",
  "--honk-shell-inset-left": "84px",
  "--honk-shell-tab-gap": "13.5px",
  "--honk-shell-rail-w": "64px",
  "--honk-shell-side-w": "344px",
  "--honk-shell-side-min-w": "244px",
} as const;

// Vars (referenced at call sites) + their `*Defaults` maps (for typed-union keys, per Tokens rule 2).
const colorVars = stylex.defineVars(colorDefaults);
const elevationVars = stylex.defineVars(elevationDefaults);
const radiusVars = stylex.defineVars(radiusDefaults);
const spaceVars = stylex.defineVars(spaceDefaults);
const controlVars = stylex.defineVars(controlDefaults);
const fontVars = stylex.defineVars(fontDefaults);
const iconVars = stylex.defineVars(iconDefaults);
const motionVars = stylex.defineVars(motionDefaults);
const zVars = stylex.defineVars(zDefaults);
const toastVars = stylex.defineVars(toastDefaults);
const conversationVars = stylex.defineVars(conversationDefaults);
const shellVars = stylex.defineVars(shellDefaults);

// Key-union types: `keyof typeof *Defaults` gives the literal `--honk-*` names for typed lookups.
type ColorVarName = keyof typeof colorDefaults;
type ElevationVarName = keyof typeof elevationDefaults;
type RadiusVarName = keyof typeof radiusDefaults;
type SpaceVarName = keyof typeof spaceDefaults;
type ControlVarName = keyof typeof controlDefaults;
type FontVarName = keyof typeof fontDefaults;
type IconVarName = keyof typeof iconDefaults;
type MotionVarName = keyof typeof motionDefaults;
type ZVarName = keyof typeof zDefaults;
type ToastVarName = keyof typeof toastDefaults;
type ConversationVarName = keyof typeof conversationDefaults;
type ShellVarName = keyof typeof shellDefaults;

export {
  colorDefaults,
  colorVars,
  controlDefaults,
  controlVars,
  conversationDefaults,
  conversationVars,
  elevationDefaults,
  elevationVars,
  radiusDefaults,
  radiusVars,
  spaceDefaults,
  spaceVars,
  fontDefaults,
  fontVars,
  iconDefaults,
  iconVars,
  motionDefaults,
  motionVars,
  shellDefaults,
  shellVars,
  toastDefaults,
  toastVars,
  zDefaults,
  zVars,
};

export type {
  ColorVarName,
  ControlVarName,
  ConversationVarName,
  ElevationVarName,
  RadiusVarName,
  SpaceVarName,
  FontVarName,
  IconVarName,
  MotionVarName,
  ShellVarName,
  ToastVarName,
  ZVarName,
};
