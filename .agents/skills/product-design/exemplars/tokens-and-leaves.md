# Tokens and primitive leaves

**Evidence:** `packages/ui/src/theme.ts`, `platform-tokens.stylex.ts`, `tokens.stylex.ts`, `text.tsx`,
and `icon.tsx`.

The authored shared concrete values live in `theme.ts` and generated bindings should not be hand-edited.
Shared light/dark values use `light-dark()` and resolve through shell `color-scheme`; web-only motion,
elevation, z-index, shell, toast, and prose values remain in `tokens.stylex.ts`.

Text and Icon show enumerable variants selecting prebuilt styles rather than dynamic branches. Their
typed plain-object style hatch merges last. Icon is decorative by default and a label promotes it to an
image role. These patterns apply to shared primitive leaves; they do not require every component to use
the same API shape.
