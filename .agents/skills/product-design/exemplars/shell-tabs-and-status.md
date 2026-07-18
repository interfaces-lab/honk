# Shell, tabs, and status

**Evidence:** `packages/ui/src/shell.tsx`, `tabs.tsx`, and `matrix.tsx`.

Shell implements the inset anatomy as `Shell → TitleBar / Body → Panel → Split → Region`, with region
hairlines and the desktop drag-region attribute contract. Tabs remain presentational: state lives in the
store, cross-element decisions are computed from the list, measurement uses callback-ref
`ResizeObserver`, and reorder uses pointer capture rather than HTML drag.

Matrix demonstrates a module-level media-query store with `useSyncExternalStore`, SSR snapshot, and
reduced-motion behavior. Fixed non-token glyph geometry remains intrinsic; token-owned values remain
governed by `honk/design-no-raw-values`.
