# Exemplars — the files to copy from (and the one never to)

Canonical files, each with *why* it's canon and *what* to lift. Open the exemplar for the pattern
you're about to write instead of reinventing it. Two are frozen honkkit prior art (copy the *shape*,
not honkkit's sprawl); the rest are the shipped `@honk/ui` components (construction rounds 5–6). All paths are repo-relative.

## `packages/ui/src/tokens.stylex.ts` — token shape

The one file where design *values* live; everything else references keys. Canon for how a token file
is shaped.
Copy:
- One `stylex.defineVars` **per concern** (color, elevation, radius, space, font, motion, shell) over
  a plain `*Defaults` object, plus a `*VarName = keyof typeof *Defaults` key-union type.
- Keys are the literal `--honk-*` custom-property names, read by bracket at call sites.
- Light/dark lives **inside** the value via `light-dark(#light, #dark)`; the mode flips via
  `color-scheme`, not a duplicate token set.
- Values carry **two honest sources** — placeholder vocabulary awaiting the identity round, plus the
  typography / icon / conversation groups ported value-exact from the current app — and each group's
  comment names its source. Either way the identity round swaps values here, never call sites. Note the derived-token
  pattern (`--honk-color-err-border`, the `color-mix` fg ramp) and the shadow-list caveat
  (`light-dark()` is color-only, so keep one geometry and switch only colors).

## `packages/honkkit/src/theme/surface-tokens.stylex.ts` — the surface matrix (frozen prior art)

The proof that `createTheme` is how honk expresses a surface/vibrancy/contrast matrix over one var set
(the pattern for the whole rewrite). honkkit is frozen — take the mechanism,
leave the naming sprawl.
Copy:
- One `surfaceVars` map, then a `stylex.createTheme(surfaceVars, {...})` object **per surface state**
  (light/dark × solid/vibrant, plus `reducedTransparency` and `highContrast`), collected in a nested
  lookup and spread onto the scope element with `stylex.props`.
- Swapping a subtree's surface = selecting a different theme object, not descendant CSS selectors.
Ignore: the dozens of alias vars — that duplication is exactly the wart the rewrite removes.

## `packages/honkkit/src/menu-styles.ts` — attribute conditions + entry/exit transitions (frozen prior art)

Canon for on-self attribute-driven state and headless-transition animation without effects.
Copy:
- State via **on-self attribute conditions**: `[data-highlighted]`, `[data-selected]`,
  `[data-disabled]`, `:hover` — no ancestor/sibling selectors.
- Entry/exit via `[data-starting-style]` / `[data-ending-style]` on self (Base UI transition hooks),
  never `useState` + `requestAnimationFrame`.
- Every transition carries its `@media (prefers-reduced-motion: reduce)` sibling; the decorative ring
  is an `::after` inset box-shadow, not a border.

## `packages/ui/src/matrix.tsx` — effect-free environment reads + justified intrinsics

The signature status glyph, and the canonical example of reading the outside world without an effect.
Copy:
- Environment input (OS reduce-motion) via a **module-level `matchMedia` store + `useSyncExternalStore`**
  with an SSR server-snapshot — the pattern for any `matchMedia`/media dependency.
- Fixed geometry that must never drift (glyph cells, sweep timing) as **named constants with a
  one-line justification** — not tokens (tokens are swappable), not inline literals (lint flags those).
- Runtime values (the n×n grid template, per-dot delay) via **function styles** in `stylex.create`,
  never `style=`. `React.memo` + `aria-hidden` on a decorative glyph.

## `packages/ui/src/tabs.tsx` — the hardest chrome, presentational + callback-ref

The tab plane: the canonical example of doing imperative DOM and cross-element layout
without effects or cross-element selectors.
Copy:
- **Callback-ref `ResizeObserver`** (attach on the element, detach on `null`) for measurement — the
  canonical effect-free imperative-DOM pattern.
- **Cross-element computed in JS**: separator suppression around the active tab and the icon-only
  compact mode are computed from the list React already holds, since StyleX 0.19 has no sibling
  selectors. Hover-reveal close uses the parent-sets-a-`--var`, child-reads-it pattern.
- **Presentational only**: the strip owns geometry, the status vocabulary, and pointer gestures, and
  holds *no* tab state — the store passes the list down and receives intents back. Reorder is
  pointer-capture (4px activation), never HTML5 drag (conflicts with window drag regions).

## `packages/ui/src/shell.tsx` — the inset recipe as one compound

The window anatomy (§0) as zero-logic composition primitives behind a single compound export.
Copy:
- `Shell → Shell.TitleBar / Shell.Body → Shell.Panel → Shell.Split → Shell.Region` — ONE compound
  (plain `Object.assign` property attachment, no context, no parallel flat exports), each piece a
  props→DOM component with an optional `xstyle` merged **last**. `Shell` owns `color-scheme` — the
  one place every `light-dark()` token resolves.
- Region hairlines via **border longhands** (`borderLeftWidth/Style/Color`), drawn by the caller on
  each region after the first (JS composes it — StyleX has no sibling selectors).
- Window drag is the `data-shell-drag-region` **attribute contract**; the `-webkit-app-region` CSS
  lives in the app's plain-CSS escape, not here.

## `packages/ui/src/text.tsx` + `icon.tsx` — variant leaves over lookup tables

The typography and glyph primitives; canon for how a variant-driven leaf is shaped.
Copy:
- Variants (`size`/`tone`/`weight`…) pick **pre-built styles from a `Record` lookup table** — no
  branching in render, no dynamic styles for enumerable choices (stylex skill, Parent-state
  alternative 3). `inherit`/`current` map to `null`/`currentColor`, so "emit no rule" is expressible.
- `className`/`style` are `Omit`-ed from props; the only styling escape is `xstyle`, merged **last**.
- Icon's sizing pattern: the wrapper span sets `font-size` from an icon-size token and the glyph
  renders at `size="1em"` — token-owned geometry with zero descendant selectors. Glyphs pass as
  **components** (`icon={IconX}`), typed structurally so the leaf stays icon-library-agnostic.
- Accessibility default: decorative (`aria-hidden`) until a `label` promotes to `role="img"`.

## `packages/ui/src/tool-call.tsx` (+ `user-message`, `status-row`, `work-group`) — the ported conversation family

The chat surface's row family: current-app values under the locked §5 structure laws.
Copy:
- **Port discipline**: every value carries a source citation (file + token name); law-fixed geometry
  (the 144/90px windows) stays a named constant while swappable vocabulary becomes tokens.
- Hover promotion via the **parent-sets-a-`--var` channel pair** (`--_verb-color`/`--_detail-color`);
  a signature animation is built once and **exported as a shared style** (`toolCallShimmer`), exactly
  as the app shares its `.tool-call-shimmer` class.
- **Honest controls**: chevron + button semantics render only when `onToggle` exists — a static row
  is a `div` (principle 6). Reduced motion renders the honest still state, never a frozen mid-sweep.
- A component family is one concept in one file: `WorkGroup` + `.Header/.Preview/.OutputStrip` via
  the same `Object.assign` compound idiom as `Shell`.

## Anti-exemplar — `packages/app` (today's pre-rewrite client)

**Read for behavior, never copy for structure.** `packages/app` currently holds the legacy client the
rewrite exists to delete: a 25-store zustand layer (`stores/thread-sync.ts` is 4,350 lines), the
three core-projection shims (`environments/core/service.ts`), and dead runtime-overlay code. Its
styling and effects patterns are exactly what the rewrite charter rejects.
- **Do** mine it (and `docs/ui-parity.md`, the graded 402-capability checklist) for *what the current
  UI does* — behavior parity is the goal.
- **Never** copy its zustand stores, its `useEffect` lifecycles, its projection layer, or its styling.
  The SDK is the store; components are effect-free; styles are StyleX-only.
