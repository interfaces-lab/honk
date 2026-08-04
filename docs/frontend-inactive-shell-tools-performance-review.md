# Frontend inactive shell tools performance review

## Scope

This review targets Electron launch when the optional New York vertical tab sidebar is disabled and
the Connect Device dialog is closed. Both are the normal startup state. Extension state, tab-strip
selection, pane sizing, settings controls, device-resume state, and lightweight open/close launchers
remain eager.

## Findings

`vertical-sidebar/extension.tsx` statically imports the 34.1 KiB sidebar view even though the
extension defaults to disabled and its pane renderer is never called in that state. Startup still
parses and evaluates the view, its menus, drag interactions, preview providers, and row components.

The shell also imports the 19.9 KiB Connect Device controller so one menu item can call `open()`, and
the closed overlay host subscribes to that controller for the lifetime of the app. The controller's
pairing state machine, bridge operations, timers, and device types therefore participate in every
startup. A small request store can preserve instant open and interrupted-pairing resume behavior
without loading the controller until the exact dialog fallback is visible.

No existing optimization comment proposes deferring either inactive boundary.

## Proposed change

Keep the extension registration and all state cells permanent. Load the sidebar view only when its
pane renderer is requested. If persisted state enables the sidebar, begin the same cached import
during extension activation so it overlaps the rest of startup.

Keep a tiny Connect Device request store eager. Shell and Settings actions update that store. When a
request or persisted pairing resume exists, the existing overlay host immediately renders its exact
dialog skeleton while a shared import loads the controller and final dialog. Controller close and
cancellation completion clear the request store, preserving the existing asynchronous cancellation
contract.

The sidebar fallback and final view share exact StyleX geometry for the permanent full-height root,
macOS traffic-light seat, navigation inset, and footer. Static row placeholders use the canonical 28
px sidebar row height. The Connect Device fallback retains its permanent dialog header, 288 px stage,
close affordance, and copy layout. Dynamic tab labels, status, grouping, device state, and controls
arrive with their chunks without changing outer geometry.

## Development check

Extend `pnpm --filter @honk/app dev:startup-review` so it fails while either inactive implementation
is in the eager application graph. Run each guard before implementation to prove the baseline and
after the combined change to start Vite. Use one corroborating production build, focused
extension/controller tests, and the bounded Electron first-commit/first-frame probe before merging.

The acceptance target is at least 2% less eager application source or Electron window-ready time,
with no measurable increase in initial React render duration. The sidebar-only checkpoint reached
1.92% median window-ready and 1.96% first-frame improvement, so it is not an independent publishable
candidate and must be measured again with the closed controller boundary.

## Non-goals

- Do not change extension storage, enablement, pane sizing, titlebar selection, or settings behavior.
- Do not change tab grouping, filtering, ordering, drag/drop, menus, previews, or status rendering.
- Do not change device pairing, cancellation, exposure, restart, resume, or polling behavior.
- Do not change build configuration or allocators.
- Do not use browser automation or app-level control for measurement.

## Results

The dev startup graph changed from 142 modules / 1,256.5 KiB to 146 modules / 1,208.0 KiB. The four
small launcher, resource, and shared-layout modules replace 48.5 KiB of inactive implementation
source, a 3.86% reduction. Both guarded implementation modules are absent from the eager graph.

A single production build per tree corroborates the split. Initial JavaScript fell from 2,828,919 to
2,803,219 raw bytes (-0.91%) and from 861,322 to 855,209 gzip bytes (-0.71%).

The bounded Electron review used one warm-up followed by three runs per tree. Median
process-to-ready fell from 5,926 ms to 5,819 ms (-1.81%), median window-created-to-ready fell from
5,094 ms to 4,987 ms (-2.10%), and median first post-ready frame fell from 5,105.6 ms to 4,998.4 ms
(-2.10%).

The same runs used a temporary root React Profiler, removed after measurement. Median initial actual
render duration fell from 2.0 ms to 1.9 ms, while median commit-to-next-frame fell from 6.4 ms to 5.6
ms. The combined boundary clears the startup target without slowing component rendering to first
paint.
