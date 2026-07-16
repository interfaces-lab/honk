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
4. **`oxlint-plugin.mjs`** — AST-backed deterministic rules loaded through the
   [Oxlint JS plugin API](https://oxc.rs/docs/guide/usage/linter/writing-js-plugins.html).
   `lint.mjs` is the focused runner: `node .design/lint.mjs` (exit 1 on any violation).

## The decision hierarchy (highest authority first)
