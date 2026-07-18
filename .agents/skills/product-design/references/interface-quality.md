# Interface quality

Use semantic `@honk/ui` controls before custom controls. Establish hierarchy with type, spacing, and
alignment before containers or decoration. Focus, hover, selected, open, and disabled states must remain
distinct in a control cluster. Color reports status or focus/primary intent; it does not provide identity
or liveliness. Tool identity comes from glyph shape and text.

The shared theme contract is `packages/ui/src/theme.ts`, its generated platform bindings, and the
`tokens.stylex.ts` facade. Styling mechanics belong to the `stylex` and `styling-tokens` skills. Run the
deterministic floor with `pnpm run lint:design`.
