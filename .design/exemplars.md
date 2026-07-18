# Exemplars. The files to copy from, and the one never to

Each entry says _why_ it's canon and _what_ to lift. Open the exemplar for the pattern you're about
to write. These are shipped `@honk/ui` components and accepted integration fixtures. All paths are
repo-relative.

## `packages/ui/src/theme.ts` + generated platform tokens. Token shape

`theme.ts` is the only authored source for concrete cross-platform colors and metrics. The sync
script projects it into `platform-tokens.stylex.ts` and `platform-tokens.css`; callers import the
stable `tokens.stylex.ts` facade. Canon for keeping web, native, first paint, Shiki, xterm, and the
desktop host on one contract.
Copy:

- Concrete shared values in `theme.ts`, with a provenance entry for every color. Light follows
  Cursor 3.11.25's bundled workbench core and Cursor Light theme; dark restores Honk's
  Cursor-derived git palette (`#141414` chrome,
  `#181818` editor, `#252526` elevation, `#599CE7` accent).
- One generated `stylex.defineVars` **per concern** over a plain `*Defaults` object, plus a
  `*VarName = keyof typeof *Defaults` key-union type. Never edit generated files by hand.
- Keys are the literal `--honk-*` custom-property names, read by bracket at call sites.
- Light/dark lives **inside** the value via `light-dark(#light, #dark)`. The mode flips via
  `color-scheme`, not a duplicate token set.
- `tokens.stylex.ts` owns web-only motion, elevation, z-index, shell, toast, and prose values. Shared
  values are re-exported from the generated binding, so a second color or control declaration is a
  lint failure.

## `packages/ui/dev/main.tsx`, Controls. Canonical control matrix

This is the accepted cluster proof for `Button`, `IconButton`, `Picker`, `ListRow`, and `Menu`.
Copy:

- Commands use primary, neutral, quiet, or destructive Buttons. Value-bearing controls use Picker;
  persistent navigation uses ListRow; transient one-line commands use Menu.Item.
- The matrix keeps selected rows beside hovered and disabled rows, rich picker options beside compact
  options, long labels inside narrow bounds, and a real composer footer beside the primitives. A
  control is not canonical until its neighbors still form one hierarchy.
- Flat surfaces have one fill or one hairline. Selection is a stable subtle fill, hover is transient,
  open Picker triggers stay visibly open, and focus remains distinct from both.
- Call sites may wrap controls for layout, but they do not replace radius, paint, ring, typography,
  or state treatment. `node .design/lint.mjs` enforces that boundary in `packages/app`.

## `packages/ui/src/menu.tsx`. Attribute conditions and entry/exit transitions

Canon for on-self attribute-driven state and headless-transition animation without effects.
Copy:

- State via **on-self attribute conditions**: `[data-highlighted]`, `[data-selected]`,
  `[data-disabled]`, `:hover`. No ancestor or sibling selectors.
- Entry/exit via `[data-starting-style]` / `[data-ending-style]` on self (Base UI transition hooks),
  never `useState` + `requestAnimationFrame`.
- Every transition carries its `@media (prefers-reduced-motion: reduce)` sibling. The decorative ring
  is an `::after` inset box-shadow, not a border.

## `packages/ui/src/matrix.tsx`. Effect-free environment reads and justified intrinsics

Status glyph. Shows how to read the outside world without an effect.
Copy:

- Environment input (OS reduce-motion) via a **module-level `matchMedia` store + `useSyncExternalStore`**
  with an SSR server-snapshot. Use this for any `matchMedia` or media dependency.
- Fixed geometry that must never drift (glyph cells, sweep timing) stays **inline on non-token
  properties** — width, height, inset, transform, opacity take literal intrinsics directly. Hoist to
  a named constant only when the value is shared or the name carries meaning the property doesn't.
  On a token-owned property (spacing, color, type, radius, motion, elevation), a raw value takes an
  `oxlint-disable-next-line honk/design-no-raw-values` with a one-line reason — the lint resolves
  hoisted constants, so a `const X = "2px"` costume no longer passes.
- Runtime values (the n×n grid template, per-dot delay) via **function styles** in `stylex.create`,
  never an inline DOM style. `React.memo` + `aria-hidden` on a decorative glyph. The public
  `style` hatch is the plain-object, React-Native-shaped component boundary from `style.ts`. It is
  merged after StyleX output and is not a substitute for internal function styles.

## `packages/ui/src/tabs.tsx`. Presentational chrome and callback-ref measurement

The tab plane. Imperative DOM and cross-element layout without effects or cross-element selectors.
Copy:

- **Callback-ref `ResizeObserver`** (attach on the element, detach on `null`) for measurement. This
  is the effect-free imperative-DOM pattern.
- **Cross-element computed in JS**. Separator suppression around the active tab and the icon-only
  compact mode are computed from the list React already holds, since StyleX 0.19 has no sibling
  selectors. Hover-reveal close uses the parent-sets-a-`--var`, child-reads-it pattern.
- **Presentational only**. The strip owns geometry, the status vocabulary, and pointer gestures. It
  holds _no_ tab state. The store passes the list down and receives intents back. Reorder is
  pointer-capture (4px activation), never HTML5 drag. HTML5 drag conflicts with window drag regions.

## `packages/ui/src/shell.tsx`. The inset recipe as one compound

The window anatomy (§0) as zero-logic composition primitives behind a single compound export.
Copy:

- `Shell → Shell.TitleBar / Shell.Body → Shell.Panel → Shell.Split → Shell.Region` is one compound.
  Plain `Object.assign` property attachment, no context, no parallel flat exports. Each piece is a
  props→DOM component with an optional typed `style` hatch merged **last** through `applyStyle`.
  `Shell` owns `color-scheme`. That is the one place every `light-dark()` token resolves.
- Region hairlines via **border longhands** (`borderLeftWidth/Style/Color`), drawn by the caller on
  each region after the first. JS composes it because StyleX has no sibling selectors.
- Window drag is the `data-shell-drag-region` **attribute contract**. The `-webkit-app-region` CSS
  lives in the app's plain-CSS escape, not here.

## `packages/ui/src/text.tsx` + `icon.tsx`. Variant leaves over lookup tables

The typography and glyph primitives. Canon for how a variant-driven leaf is shaped.
Copy:

- Variants (`size`/`tone`/`weight`…) pick **pre-built styles from a `Record` lookup table**. No
  branching in render, no dynamic styles for enumerable choices (stylex skill, Parent-state
  alternative 3). `inherit`/`current` map to `undefined`/`currentColor`, so "emit no rule" is
  expressible without an all-null StyleX override.
- `className` is omitted from props. The only styling escape is the typed plain-object `style`
  hatch, merged **last** through `applyStyle` so web and future native renderers share one API.
- Icon's sizing pattern. The wrapper span sets `font-size` from an icon-size token and the glyph
  renders at `size="1em"`. Token-owned geometry with zero descendant selectors. Glyphs pass as
  **components** (`icon={IconX}`), typed structurally so the leaf stays icon-library-agnostic.
- Accessibility default. Decorative (`aria-hidden`) until a `label` promotes to `role="img"`.

## `packages/ui/src/tool-call.tsx` (+ `user-message`, `status-row`, `work-group`). Ported conversation family

The chat surface's row family. Current-app values under the locked §5 structure laws.
Copy:

- **Port discipline**. Every value carries a source citation (file + token name). Law-fixed geometry
  (the 144/90px windows) stays a named constant while swappable vocabulary becomes tokens.
- Hover promotion via the **parent-sets-a-`--var` channel pair** (`--_verb-color`/`--_detail-color`).
  A shared animation is built once and **exported as a shared style** (`toolCallShimmer`), the same
  way the app shares its `.tool-call-shimmer` class.
- **Honest controls**. Chevron + button semantics render only when `onToggle` exists. A static row
  is a `div` (principle 6). Reduced motion renders the honest still state, never a frozen mid-sweep.
- A component family is one concept in one file. `WorkGroup` + `.Header/.Preview/.OutputStrip` via
  the same `Object.assign` compound idiom as `Shell`.

## Anti-exemplar. Raw product controls and call-site chrome

Do not add a raw `<button>` or repaint a shared Button, Picker, ListRow, or Menu item in
`packages/app`. Those patterns split interaction behavior from appearance and are the failure this
migration removes. Focus-sensitive Lexical listbox options are the explicit exception: they keep
their combobox semantics and editor-focus behavior while reusing canonical row anatomy.

App composition may use token-backed Tailwind wrappers and inline intrinsic StyleX values on
non-token properties. Surface,
radius, ring, typography, and hover/press/selected styling stay in `@honk/ui`; third-party DOM
adapters live in a colocated CSS module, while root resets and vendor baseline imports stay global.
