# Frontend workbench Changes performance review

## Scope

This review targets Electron launch into Home or a restored thread when the Changes workbench tab is
not open. The workbench controller, rail, route reconciliation, tab badge, and Changes data resource
remain eager because they report working-tree activity before the panel opens.

The Changes editor becomes permanent only when the user opens its tab or launches Honk at a Changes
deep link. Its scope menu, diff cards, file tree, action bar, and dialogs do not participate in the
normal startup view.

## Finding

`workbench.tsx` statically imports `useWorkbenchChangesSnapshot` from `workbench-changes.tsx` for the
rail badge. That file also owns the complete Changes editor and statically imports its diff-card and
file-tree modules. The badge therefore pulls roughly 84 KiB of Changes UI source into every renderer
startup even while the workbench is closed.

No existing optimization comment proposes this split. Comments in the Changes modules document data
ordering, persisted controls, and Cursor-compatible layout and remain product contracts.

## Proposed change

Move the Changes resource, snapshot types, and subscription hook into a small eager module. Keep the
badge subscribed to that module. Load the Changes editor with `React.lazy` only when a Changes tab is
active.

Keep the panel column, workbench header, route state, and badge eager. The lazy fallback shares the
editor's permanent root, toolbar, and centered-stage StyleX definitions. It keeps the final flex
geometry and loading position while the local chunk arrives, without drawing fake files or controls.
Deep-linked Changes routes take the same path.

The first Changes visit pays one local module import. Later visits use the module cache. The resource
already starts for the badge, so deferring the editor does not delay the file-status request.

## Development check

`pnpm --filter @honk/app dev:startup-review` must fail while the Changes editor, diff-card, or file-tree
module remains in the eager application graph. Run it before implementation to prove the baseline and
after implementation to start Vite.

Use one production app build before and after as corroborating evidence. Run the Changes resource,
panel, app architecture, and design checks. Reuse the bounded first-commit and first-frame probe if
startup measurements are close enough to suggest a rendering regression.

The acceptance target is at least 2% less eager application source or Electron window-ready time,
with no measurable increase in initial React render duration.

## Results

The eager application graph moved from 156 modules and 1,430.7 KiB of source to 152 modules and
1,333.2 KiB. That is 97.5 KiB, or 6.82%, less source for Vite and V8 to transform, parse, and compile.
The Changes editor, diff-card, and file-tree modules are outside the graph. The resource and shared
loading geometry remain eager.

One production build per tree moved the JavaScript referenced by `dist/index.html` from 2,965,273 to
2,871,162 raw bytes, a 3.17% reduction. Gzip size moved from 898,241 to 872,523 bytes, a 2.86%
reduction. The deferred Changes chunk is 95.48 KiB raw and 31.81 KiB gzip.

The bounded Electron development probe used one warmup per tree, then three interleaved starts with
DevTools disabled equally and no UI automation. Current main measured 6,874/6,027 ms, 6,845/6,001 ms,
and 6,736/5,906 ms for process/window-ready medians of 6,845/6,001 ms. This change measured
6,528/5,684 ms, 6,597/5,699 ms, and 6,638/5,810 ms for medians of 6,597/5,699 ms. Process startup
improved 3.62%; window-ready improved 5.03%.

A temporary root React Profiler and first post-commit animation-frame marker checked the rendering
tradeoff in those same samples. Median initial React render duration stayed at 2.0 ms. The first frame
moved from 6,010.4 to 5,708.7 ms, 5.02% earlier. Commit-to-frame time moved from 5.0 to 5.3 ms; the
0.3 ms difference is below one frame and not a meaningful rendering regression. Both probes were
removed after measurement.

## Non-goals

- Do not change Changes APIs, refresh timing, badge semantics, scopes, diff rendering, git actions, or
  persisted controls.
- Do not change workbench routing, tab persistence, sizing, focus, or maximization behavior.
- Do not defer the Changes resource or its badge subscription.
- Do not use browser automation or app-level control for measurement.
