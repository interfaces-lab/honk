---
version: alpha
name: HonkKit
description: Honk's compact design system, Dark theme (the Light theme is documented at /design.md).
sources:
  canonical: packages/app/src/styles/tokens.css
  imports: packages/app/src/styles/app.css
  tailwind: packages/app/src/index.css
  honkkit: packages/honkkit/src/styles.css
preview: honkkit-design.html#dark
colors:
  primary: "var(--honk-fg-primary)"
  secondary: "var(--honk-fg-secondary)"
  tertiary: "var(--primary)"
  neutral: "var(--honk-color-sidebar)"
  background-100: "var(--honk-color-editor)"
  background-200: "var(--honk-color-chat)"
  neutral-100: "var(--honk-color-editor)"
  neutral-200: "var(--honk-color-chat)"
  neutral-300: "var(--honk-bg-quinary)"
  neutral-400: "var(--honk-stroke-tertiary)"
  neutral-500: "var(--honk-stroke-secondary)"
  neutral-600: "var(--honk-stroke-primary)"
  neutral-700: "var(--honk-fg-quaternary)"
  neutral-800: "var(--honk-fg-tertiary)"
  neutral-900: "var(--honk-fg-secondary)"
  neutral-1000: "var(--honk-fg-primary)"
  action-100: "color-mix(in srgb, var(--primary) 8%, var(--honk-color-editor))"
  action-200: "color-mix(in srgb, var(--primary) 12%, var(--honk-color-editor))"
  action-300: "color-mix(in srgb, var(--primary) 16%, var(--honk-color-editor))"
  action-400: "color-mix(in srgb, var(--primary) 24%, var(--honk-color-editor))"
  action-500: "color-mix(in srgb, var(--primary) 42%, var(--honk-color-editor))"
  action-600: "color-mix(in srgb, var(--primary) 62%, var(--honk-color-editor))"
  action-700: "var(--primary)"
  action-800: "color-mix(in srgb, var(--primary) 88%, var(--honk-fg-primary))"
  action-900: "color-mix(in srgb, var(--primary) 62%, var(--honk-fg-primary))"
  action-1000: "color-mix(in srgb, var(--primary) 26%, var(--honk-fg-primary))"
  success-100: "color-mix(in srgb, var(--success) 8%, var(--honk-color-editor))"
  success-200: "color-mix(in srgb, var(--success) 12%, var(--honk-color-editor))"
  success-300: "color-mix(in srgb, var(--success) 16%, var(--honk-color-editor))"
  success-400: "color-mix(in srgb, var(--success) 24%, var(--honk-color-editor))"
  success-500: "color-mix(in srgb, var(--success) 42%, var(--honk-color-editor))"
  success-600: "color-mix(in srgb, var(--success) 62%, var(--honk-color-editor))"
  success-700: "var(--success)"
  success-800: "color-mix(in srgb, var(--success) 86%, var(--honk-fg-primary))"
  success-900: "color-mix(in srgb, var(--success) 56%, var(--honk-fg-primary))"
  success-1000: "color-mix(in srgb, var(--success) 24%, var(--honk-fg-primary))"
  warning-100: "color-mix(in srgb, var(--warning) 8%, var(--honk-color-editor))"
  warning-200: "color-mix(in srgb, var(--warning) 12%, var(--honk-color-editor))"
  warning-300: "color-mix(in srgb, var(--warning) 16%, var(--honk-color-editor))"
  warning-400: "color-mix(in srgb, var(--warning) 24%, var(--honk-color-editor))"
  warning-500: "color-mix(in srgb, var(--warning) 42%, var(--honk-color-editor))"
  warning-600: "color-mix(in srgb, var(--warning) 62%, var(--honk-color-editor))"
  warning-700: "var(--warning)"
  warning-800: "color-mix(in srgb, var(--warning) 86%, var(--honk-fg-primary))"
  warning-900: "color-mix(in srgb, var(--warning) 56%, var(--honk-fg-primary))"
  warning-1000: "color-mix(in srgb, var(--warning) 24%, var(--honk-fg-primary))"
  destructive-100: "color-mix(in srgb, var(--destructive) 8%, var(--honk-color-editor))"
  destructive-200: "color-mix(in srgb, var(--destructive) 12%, var(--honk-color-editor))"
  destructive-300: "color-mix(in srgb, var(--destructive) 16%, var(--honk-color-editor))"
  destructive-400: "color-mix(in srgb, var(--destructive) 24%, var(--honk-color-editor))"
  destructive-500: "color-mix(in srgb, var(--destructive) 42%, var(--honk-color-editor))"
  destructive-600: "color-mix(in srgb, var(--destructive) 62%, var(--honk-color-editor))"
  destructive-700: "var(--destructive)"
  destructive-800: "color-mix(in srgb, var(--destructive) 86%, var(--honk-fg-primary))"
  destructive-900: "color-mix(in srgb, var(--destructive) 56%, var(--honk-fg-primary))"
  destructive-1000: "color-mix(in srgb, var(--destructive) 24%, var(--honk-fg-primary))"
typography:
  caption:
    {
      fontFamily: "var(--honk-font-ui)",
      fontSize: "var(--honk-text-caption)",
      lineHeight: "var(--honk-leading-caption)",
    }
  detail:
    {
      fontFamily: "var(--honk-font-ui)",
      fontSize: "var(--honk-text-detail)",
      lineHeight: "var(--honk-leading-detail)",
    }
  body:
    {
      fontFamily: "var(--honk-font-ui)",
      fontSize: "var(--honk-text-body)",
      lineHeight: "var(--honk-leading-body)",
    }
  title:
    {
      fontFamily: "var(--honk-font-ui)",
      fontSize: "var(--honk-text-title)",
      lineHeight: "var(--honk-leading-title)",
    }
  heading:
    {
      fontFamily: "var(--honk-font-ui)",
      fontSize: "var(--honk-text-heading)",
      lineHeight: "var(--honk-leading-heading)",
    }
  code:
    {
      fontFamily: "var(--honk-font-mono)",
      fontSize: "var(--honk-code-font-size-user, 12px)",
      lineHeight: "calc(var(--honk-code-font-size-user, 12px) * 1.45)",
    }
spacing:
  "0.25": "var(--honk-spacing-0-25)"
  "0.5": "var(--honk-spacing-0-5)"
  "1": "var(--honk-spacing-1)"
  "1.5": "var(--honk-spacing-1-5)"
  "2": "var(--honk-spacing-2)"
  "2.5": "var(--honk-spacing-2-5)"
  "3": "var(--honk-spacing-3)"
  "4": "var(--honk-spacing-4)"
  "7": "var(--honk-spacing-7)"
rounded:
  sm: "var(--honk-radius-control)"
  md: "var(--honk-radius-card)"
  lg: "var(--honk-radius-xl)"
  full: "var(--honk-radius-pill)"
shadows:
  soft: "var(--honk-shadow-soft)"
  sm: "var(--honk-shadow-sm)"
  base: "var(--honk-shadow-base)"
  lg: "var(--honk-shadow-lg)"
  xl: "var(--honk-shadow-xl)"
  card: "var(--honk-shadow-card)"
  popup: "var(--honk-shadow-popup)"
  toolbar: "var(--honk-shadow-toolbar)"
  flat-ring: "var(--honk-shadow-flat-ring)"
motion:
  hover: "var(--motion-duration-hover)"
  ui: "var(--motion-duration-ui)"
  panel: "var(--motion-duration-panel)"
  drawer: "var(--motion-duration-drawer)"
  dialog: "var(--motion-duration-dialog)"
  easing: "var(--ease-shell)"
components:
  button-primary:
    backgroundColor: "var(--primary)"
    textColor: "var(--primary-foreground)"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0 var(--honk-spacing-3)"
    height: 32px
  button-secondary:
    backgroundColor: "var(--honk-bg-quaternary)"
    textColor: "var(--honk-fg-primary)"
    borderColor: "var(--honk-stroke-tertiary)"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0 var(--honk-spacing-3)"
    height: 32px
  button-tertiary:
    textColor: "var(--honk-fg-secondary)"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0 var(--honk-spacing-3)"
    height: 32px
  button-error:
    backgroundColor: "var(--destructive)"
    textColor: "var(--destructive-foreground)"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0 var(--honk-spacing-3)"
    height: 32px
  button-small:
    typography: "{typography.detail}"
    rounded: "{rounded.sm}"
    padding: "0 var(--honk-spacing-2)"
    height: 28px
  button-large:
    typography: "{typography.title}"
    rounded: "{rounded.sm}"
    padding: "0 var(--honk-spacing-4)"
    height: 38px
  input:
    backgroundColor: "var(--honk-input-surface)"
    textColor: "var(--honk-fg-primary)"
    borderColor: "var(--honk-stroke-tertiary)"
    focusBorderColor: "var(--honk-stroke-focused)"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0 var(--honk-spacing-2-5)"
    height: 32px
  input-small:
    typography: "{typography.detail}"
    rounded: "{rounded.sm}"
    padding: "0 var(--honk-spacing-2)"
    height: 28px
  input-large:
    typography: "{typography.title}"
    rounded: "{rounded.sm}"
    padding: "0 var(--honk-spacing-3)"
    height: 38px
---

# HonkKit Dark

## Overview

HonkKit Dark is Honk's dark theme for dense desktop product UI. It keeps the same token names and Pierre palette roles as the light theme, but computes darker surfaces, lighter foregrounds, reduced shadow, and stronger divider contrast. The goal is parity of hierarchy, not a mechanical inversion.

This is the Dark theme. The Light theme uses the same token names with different computed values and lives at `/design.md`.

## Colors

Each semantic scale runs 10 steps (`100`–`1000`), and the step encodes intent, not just lightness:

- `100` default background
- `200` hover background or secondary surface
- `300` active background
- `400` default border
- `500` hover border
- `600` active border
- `700` solid fill, high contrast
- `800` solid fill, hover
- `900` secondary text and icons
- `1000` primary text and icons

`background-100` is the primary dark editor surface; `background-200` is the dark chrome/chat surface for subtle separation. The `neutral-*` staircase maps Honk's surface, stroke, and foreground roles into one readable ladder. Accent staircases are derived from existing Honk status tokens (`--primary`, `--success`, `--warning`, `--destructive`) and should not become new overlapping CSS variables unless product code repeatedly needs a specific step.

### Glass surfaces

Glass mode uses a fixed compact surface recipe. In dark mode the base surfaces are sidebar `#181818`, chrome/chat `#141414`, editor/elevated `#181818`, foreground/focus `#F0F0F0`, and accent `#599CE7`. When native vibrancy is available, the sidebar is the most translucent pane (`36%` base color over transparent), while chat and editor are denser panes (`72%` base color over transparent). Root glass remains `rgba(0, 0, 0, .42)`. Composer and chat bubbles stay near-opaque with `color-mix(in srgb, var(--honk-base-editor) 96%, #fff)`; do not tint every nested card.

The canonical implementation is StyleX surface themes selected at the app root. Components consume role surfaces (`root`, `sidebar`, `chat`, `editor`, `bubble`, `menu`) and never branch on vibrancy or transparency. Reduce Transparency and High Contrast are separate solid surface themes; they disable native vibrancy and use opaque sidebar/chrome/editor/base colors.

## Typography

The app scale follows `--honk-ui-font-size-user`; workbench chrome has fixed compact metrics. Use text utilities backed by `packages/app/src/index.css` (`text-caption`, `text-detail`, `text-body`, `text-title`, `text-heading`) instead of setting font size or line height by hand. Use `--honk-font-mono` for code, data, and tabular figures.

## Layout

Spacing follows Honk's compact 4px-derived scale. Keep a three-step rhythm: 4–8px inside a control, 12–16px between groups, and 28px between larger sections. Cards use `--honk-radius-card`; everyday controls use `--honk-radius-control`; reserve `--honk-radius-pill` for pills, avatars, and circular controls.

## Elevation and depth

Hierarchy comes from tonal surfaces and borders first, so shadows stay subtle. Use the existing shadow ladder only: `soft`, `sm`, `base`, `lg`, `xl`, `card`, `popup`, `toolbar`, and `flat-ring`. This dark theme intentionally collapses most shadows; use light dividers and inset rings instead of inventing dark elevation.

## Motion

Use motion only when it clarifies a change, never for decoration. State changes use `--motion-duration-hover` or `--motion-duration-ui`; popovers and panels use `--motion-duration-panel`; drawers and dialogs use their named tokens. Honor `prefers-reduced-motion` by dropping nonessential motion.

## Components

The `components` tokens above give ready-to-use values per element (`backgroundColor`, `textColor`, `rounded`, `height`) drawn from this theme:

- Primary button: solid `--primary` fill with a `--primary-foreground` label, for the single most important action on a view.
- Secondary button: `--honk-bg-quaternary` fill with a `--honk-stroke-tertiary` border and `--honk-fg-primary` label.
- Tertiary button: transparent fill with `--honk-fg-secondary` text for low-emphasis actions; it tints with the neutral background staircase on hover.
- Error button: solid `--destructive` fill with `--destructive-foreground`, for destructive actions.
- Input: `--honk-input-surface` fill, `--honk-stroke-tertiary` border, and `--honk-stroke-focused` focus border.

The variant tokens are the default medium (32px) size. Use the `button-small`/`input-small` (28px) and `button-large`/`input-large` (38px) tokens for the other compact app sizes. Hover and active states step up the staircase: a `100` fill becomes `200` on hover and `300` on active, and borders move from `400` to `500` to `600`. Disabled uses neutral `100`/`300` fills, `700` text, and a not-allowed cursor. Focus shows a visible replacement ring using `--honk-stroke-focused`; never remove an outline without a visible replacement.

Product UI should use HonkKit primitives from `@honk/honkkit/*`. The static preview in `honkkit-design.html` shows token-only equivalents for review and consolidation.

## Voice and content

Copy is part of the design; keep it precise and free of filler. Use Title Case for labels, buttons, titles, and tabs; sentence case for body, helper text, and toasts. Name actions with a verb and a noun (`Open HonkKit`, `Copy Token Name`), never `Confirm`, `OK`, or a bare verb. Toasts name the specific thing that changed and never say `successfully`.

## Do's and don'ts

- Use the neutral staircase to rank information: `1000` for primary text, `900` for secondary, `700` for disabled.
- Keep solid accent color for state and the single most important action on a view.
- Show focus on every interactive element.
- Do not signal state with color alone; pair it with text or an icon.
- Do not add local `color-mix()` formulas when a staircase step or semantic role fits.
- Do not add near-duplicate shadow tiers or border opacity variants.
