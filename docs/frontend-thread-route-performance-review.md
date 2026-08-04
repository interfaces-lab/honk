# Frontend thread route performance review

## Scope

This review targets a normal Electron launch that restores Home. The title bar, tabs, shell material,
Home navigation, Home inventory, and Home composer remain eager. A thread's session/workbench frame
also remains eager when a thread route is active.

The permanent static conversation UI while a thread module loads is the full-width flex column and
its centered `Connecting to thread` spinner. That exact state already exists in `ThreadPage`; the
route fallback must reuse it without changing dimensions, copy, or status semantics.

## Finding

`router.tsx` statically imports `ThreadPage`, so Home startup parses the whole conversation branch.
Removing that one edge from the source graph makes 39 modules and 310.2 KiB exclusive to the thread
route. They include the transcript and virtualization model, Markdown rendering, thread composer,
queue and task trays, subagent UI, message tools, and artifact presentation. Home cannot render or
interact with any of them.

No existing optimization comment proposes deferring the thread route. Comments inside the thread
components document scroll, resize, queue, and focus behavior; all of those implementations remain
unchanged.

## Proposed change

Resolve `ThreadPage` through one cached dynamic import. Start that import in the thread route's
`beforeLoad` hook, before React renders the route. Home never requests it. A direct or restored thread
route starts the same promise during route resolution, which overlaps connection startup and avoids
waiting until the Suspense component renders.

Extract the existing page frame and connecting state into one small eager layout module. Both the
real page's connecting branch and the Suspense fallback render the same component, so their permanent
geometry and pixels cannot drift.

This stays a single route boundary. It does not create a generic route-loading framework or split
individual transcript components.

## Development check

Extend `pnpm --filter @honk/app dev:startup-review` so it fails while `thread/page.tsx` remains in the
static startup graph. Run the dev command before implementation to prove the coupling, then rerun it
after the split and let Vite reach ready.

Use one final production build per tree to measure Home's initial JavaScript. Use the bounded Electron
and root React Profiler check for Home first paint, plus focused route/layout tests. The acceptance
target is at least 2% less initial JavaScript or Home window-ready time. Initial React render and
commit-to-next-frame must remain neutral.

## Non-goals

- Do not defer Home, the shell, session route parsing, the workbench frame, or session watches shared
  with the workbench.
- Do not change thread connection, unavailable, populated, empty-thread, transcript, composer, tray,
  workbench, focus, or scroll behavior.
- Do not change route paths, tab restoration, remembered workbench routes, or redirects.
- Do not change build configuration or allocators.
- Do not use browser automation or app-level control for measurement.

## Results

The dev startup graph changed from 147 modules / 1,205.2 KiB to 110 modules / 897.1 KiB. That is 37
fewer modules and 25.6% less eager application source. `thread/page.tsx` and its transcript, Markdown,
composer, task, tool, and subagent branch are absent from Home's static graph.

The final production build for each tree confirmed the emitted boundary. Home's initial JavaScript
fell from 2,731,288 to 1,582,460 raw bytes, a 1,148,828 byte or 42.1% reduction. Gzip size fell from
832,684 to 494,276 bytes, a 338,408 byte or 40.6% reduction.

The bounded Electron check used one warm-up and three measured Home launches per tree. Median
process-to-ready fell from 6,449 to 5,125 ms, or 20.5%. Median window-created-to-ready fell from 5,582
to 4,301 ms, or 23.0%. Median renderer heap after the first frame fell from 115.16 to 98.75 MiB, or
14.3%.

A temporary root React Profiler, removed after measurement, confirmed the component path through
first paint. Median initial render duration improved from 2.2 to 2.1 ms. Median
commit-to-next-frame changed from 3.8 to 4.5 ms. That sub-millisecond difference included one 39.4 ms
changed-side scheduler skip; the other changed samples were 3.8 and 4.5 ms. The large window-ready
improvement and lower React render time show that the boundary does not delay Home's first paint.

The focused component test locks the connecting fallback's complete server-rendered markup and proves
that repeated route preload calls share the same import promise. The loaded page uses the same
`ThreadPageLoading` component for its own connecting branch, so the fallback and final route cannot
drift at that state.
