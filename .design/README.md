# Honk's agent-facing product-design system

This folder teaches an agent to produce on-system honk UI. It follows the Vercel method
([Teaching agents product design](https://vercel.com/blog/teaching-agents-product-design-at-vercel)):
split guidance into three kinds and never blur them —

- **judgment** (prose you apply with taste) → `principles.md`
- **canon** (shipped files worth copying, and one worth never copying) → `exemplars.md`
- **deterministic checks** (rules a machine enforces) → `lint.mjs`

The split is the point. A linter can count that a raw hex sits at a call site; it cannot judge
whether a control is honest or a status color is carrying identity. So the mechanical floor lives in
`lint.mjs`, and everything requiring product context lives in `principles.md`. When in doubt about
which layer owns a decision: if code can detect the failure with no false positives, it belongs in
the lint; otherwise it belongs in the prose.

## Reading order (load this before touching UI)

1. **This README** — the decision hierarchy below, so you know what outranks what.
2. **`principles.md`** — the nine product-design judgment calls.
3. **`exemplars.md`** — the file to open for the pattern you're about to write, plus the
   anti-exemplar to stay out of.
4. **`lint.mjs`** — run it before you're done: `node .design/lint.mjs` (exit 1 on any violation).

## The decision hierarchy (highest authority first)

When two sources seem to disagree, the higher one wins.

1. **The skills — product judgment, platform routing, and authoring mechanics.** Load the global
   `design` skill to resolve the request mode and route into this Honk-specific system. For
   `@honk/ui`, load `honk-ui` to decide whether code is shared, web, or native. Load both local
   styling skills before writing StyleX:
   - `.agents/skills/design/SKILL.md` — product-design modes, evidence, state coverage, and
     verification workflow, adapted from Vercel's product-design model.
   - `.agents/skills/honk-ui/SKILL.md` — the one-API platform contract, Bluesky research protocol,
     and the web/native verification boundary.
   - `.agents/skills/stylex/SKILL.md` — StyleX authoring rules (create-block shape, merge order,
     border longhands, hover/reduced-motion guards, on-self selectors, dynamic values).
   - `.agents/skills/styling-tokens/SKILL.md` — the token vocabulary across StyleX / Tailwind /
     plain CSS; the "never raw values" rule and the allowed-literal whitelist the lint mirrors.
     This folder never restates skill mechanics — it points to their owners. Package-specific platform
     rules live in `packages/ui/AGENTS.md`.
2. **The token sources.** `packages/ui/src/theme.ts` owns values shared by web and native, and
   `platform-tokens.stylex.ts` is its generated web binding. `tokens.stylex.ts` retains values that
   remain web-only. Call sites reference semantic keys or the resolved native theme and never
   literals. Cite real key names only — read the files, don't guess.
3. **This folder — product-design judgment.** `principles.md` and `exemplars.md` decide _what good
   looks like_ on top of the two sources above. Product rulings that gate parity live in
   `docs/ui-parity.md`.

## The dialkit loop — how design _values_ get tuned

Values (never call sites) change in `theme.ts` when shared with native, or `tokens.stylex.ts` when
web-only. Run `pnpm run check:mobile` after shared changes. The loop for retuning web values:

1. **Open the gallery:** `pnpm --filter @honk/ui dev` — a per-component story browser. The dial rail
   shows **per-component panels** (`packages/ui/dev/dials.ts` holds the catalog): an always-on Theme
   panel (appearance + accent), plus the active story's own panel dialing only the tokens that
   component reads — Shell (gutter/pads/radii/titlebar), Tabs (tab geometry), Text (the compact type
   ramp), Prose (reading measure, size, leading, and flow), Icon (the size steps), Conversation
   (insets, gaps, bubble radius, the fg %-mixes, shimmer). The Matrix story deliberately has no
   panel: the glyph is sacred geometry.
2. **Tweak in the gallery.** Moving a slider rewrites the published `--honk-*` custom properties
   inline on `<html>`, so every consumer re-skins live with zero React re-renders. Tuned values stay
   applied when you switch stories; after a reload, a panel's persisted values return when its story
   next mounts.
3. **Copy.** dialkit's Copy button emits the panel's current values as a JSON instruction.
4. **Bake it in.** An agent takes that JSON and updates the matching token _values_ in `theme.ts` for
   shared values or `tokens.stylex.ts` for web-only values, then synchronizes generated bindings.
   Call sites remain unchanged, so the Client re-skins without downstream literals.

## Running the lint

```
node .design/lint.mjs
```

Zero dependencies, plain node. Walks `packages/ui/src` and `packages/ui/dev` (extend `DIRS` at the
top of the file — `packages/app/src` joins once it's rebuilt). Prints `file:line:col  code  message`
for each violation and exits 1; prints a clean summary and exits 0 otherwise. Rules:
`no-use-effect`, `no-raw-values`, `no-border-shorthand`, `no-cross-element`, `no-container-queries`,
`no-classname-style`, `no-banned-imports`. It is a deterministic _floor_ — a green run means you
didn't trip a mechanical rule, not that the design is right. That judgment is `principles.md`.
