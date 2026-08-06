# Frontend prompt menu performance review

## Scope

This review targets a normal Electron launch that restores Home with the composer prompt menu
closed. The editor shell, placeholder, input surface, attachment band, composer controls, focus
setup, slash/mention detection, menu data, and keyboard commands remain eager.

The prompt menu is a transient portaled surface. It has no permanent first-paint pixels or layout
space while closed. Its correct startup fallback is therefore `null`; the permanent composer must
remain byte-for-byte on the existing render path.

## Finding

`prompt-editor.tsx` statically imports the 17.4 KiB prompt menu view. That also pulls its 1.5 KiB
pointer-interaction helper into the Home startup graph. A normal first paint cannot render either
module because the menu state and live token anchor both begin `null`.

The view owns popup positioning, icons, preview cards, row paint, pointer selection, and scrolling.
Those concerns are useful only after a `/` or `@` trigger has produced a live editor range. The
editor already owns trigger parsing, items, selection, fetching, and keyboard behavior, so none of
that state needs to move or become asynchronous.

No existing optimization comment proposes deferring this closed popup. Comments in the menu explain
geometry and interaction contracts that the implementation must preserve.

## Proposed change

Keep the shared value types where they are and reference them through a compiler-erased
`import type`. Resolve the existing menu view through one cached dynamic import and render it behind
`Suspense` only while both menu state and its anchor are present. The startup analyzer must ignore
type-only edges so it measures executable work without requiring a new runtime module.

Start the cached import as soon as trigger detection finds a valid live range, before publishing the
anchor and menu state. This overlaps the import with the existing command/file lookup and React
update. Reuse the same promise for the lazy view.

Do not add a generic composer-loading abstraction or a speculative popup skeleton. The popup is
closed and occupies no space at first paint, while a fabricated row count would be less exact than
the existing transient behavior.

## Development check

Extend `pnpm --filter @honk/app dev:startup-review` so it fails while the prompt menu view or its
interaction helper remains in the static startup graph. Run that command before implementation to
prove the coupling, then rerun it after the split and let Vite reach ready.

Use one production build per tree to corroborate the emitted boundary. Use the bounded Electron and
root React Profiler check for Home first paint, plus focused menu/resource tests. The acceptance
target is at least 2% less eager application source, initial JavaScript, renderer memory, or cold
start. Initial React render and commit-to-next-frame must not regress meaningfully.

## Non-goals

- Do not change trigger syntax, filtering, command or file fetching, selection, previews, keyboard
  navigation, pointer behavior, positioning, or focus return.
- Do not change the permanent composer shell, attachments, controls, dimensions, or startup focus.
- Do not preload on editor focus because Home may autofocus the composer during startup.
- Do not change build configuration or allocators.
- Do not use browser automation or app-level control for measurement.

## Results

The startup analyzer now excludes TypeScript-only import edges rather than requiring a separate
runtime-visible type module. With the same corrected analyzer on both trees, the Home graph changed
from 106 modules / 909,275 bytes to 105 modules / 890,793 bytes. That removes 18,482 bytes, or 2.03%.
Neither `prompt-menu.tsx` nor `prompt-menu-interaction.ts` is in the static graph.

The final production build emits the menu as a non-preloaded 11,828-byte chunk (4,271 bytes gzip).
Home's initial JavaScript changed from 1,582,460 to 1,571,168 raw bytes (-0.71%) and from 494,276 to
492,457 gzip bytes (-0.37%). The permanent startup render still takes the same branch because both
menu state and its anchor are `null`; the new Suspense fallback contributes no element or layout.

The bounded Electron review used one warmup per tree and six measured Home launches per side across
a sequential and an interleaved batch. Pooled median process-to-ready changed from 5,253 to 5,225 ms,
and median window-to-ready changed from 4,413 to 4,383 ms. Median renderer heap after the first frame
changed from 98.10 to 97.87 MiB.

A temporary root React Profiler, removed after measurement, verified rendering through first paint.
Median initial actual render duration was 2.2 ms on both sides. Median commit-to-next-frame changed
from 6.6 to 6.7 ms, a tenth of a millisecond. The prompt-menu view therefore leaves Home component
rendering neutral while removing the closed popup from startup work.
