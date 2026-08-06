# Frontend closed workbench performance review

## Scope

This review targets Electron launch into Home or a thread with the workbench closed. Workbench
routing, tab ownership, the closed rail, status badges, browser resources, PTY bridges, and close
behavior remain eager.

The panel column becomes permanent when the user opens or restores the workbench. Browser and
Terminal become permanent only when their tabs mount. The tool header, pane dispatcher, embedded page
host, terminal renderer host, theme adapter, and recovery UI do not participate in a normal closed
startup.

## Finding

`workbench.tsx` always mounts `WorkbenchPanelColumn`, then hides it with `display: none` when the
workbench is closed. That static edge pulls in the tool header, pane dispatcher, and every direct
surface import before first paint. The pane dispatcher statically imports Browser and Terminal, while
`workbench.tsx` also imports Terminal disposal from the component module.

The Browser resource already lives in `browser-store.ts`. A closed Terminal tab cannot own a mounted
renderer session, so its disposal module is only needed after the Terminal view has loaded. No
existing optimization comment proposes deferring the closed column or either pane. Their source
comments describe runtime and layout contracts and remain unchanged.

## Proposed change

Load `WorkbenchPanelColumn` with `React.lazy` only after the workbench opens or owns a managed tab.
Once a tab exists, keep the column mounted through collapse exactly as today. Load `BrowserSurface`
and `WorkbenchTerminal` with nested lazy boundaries when their tabs mount. Change Terminal close
cleanup to import the already-loaded Terminal module on demand. If a tab closes while its first import
is still pending, the shared import resolves once and disposal runs before any abandoned session can
survive.

Keep the workbench host, closed rail, toggle, tab state, Browser resource, and desktop bridges eager.
The column fallback keeps the stored width, maximized state, separator, 36 px header, and body region.
Browser loading keeps the final toolbar and page-host geometry, with control-sized static placeholders
and a centered loading status. Terminal loading keeps the final deep-background root, gutter, and
terminal area geometry. Fallbacks and final views share their permanent StyleX layout constants, so
neither chunk handoff resizes the panel.

The first visit pays one local module import per tool. Later visits use the module cache. Terminal's
Ghostty library and WASM already load on demand and retain that second-stage behavior.

## Development check

`pnpm --filter @honk/app dev:startup-review` must fail while the closed panel column, tool header, pane
dispatcher, Browser, or Terminal remains in the eager application graph. Run it before implementation
to prove the baseline and after implementation to start Vite.

Use one production build per tree as corroborating evidence. Run focused Browser, Terminal, panel,
architecture, design, formatting, lint, and React checks. Use the bounded first-commit and first-frame
probe before merging.

The acceptance target is at least 2% less eager application source or Electron window-ready time,
with no measurable increase in initial React render duration.

## Non-goals

- Do not change Browser navigation, embedded-view lifecycle, resource state, or picture-in-picture.
- Do not change PTY ownership, Ghostty configuration, terminal persistence, restart, theme, resize,
  scroll, or focus behavior.
- Do not change workbench routing, tab order, sizing, maximization, or mounted-tab survival after the
  workbench has opened.
- Do not use browser automation or app-level control for measurement.

## Results

The dev startup graph fell from 152 modules / 1,333.2 KiB to 142 modules / 1,256.5 KiB. That is ten
fewer eager modules and 76.7 KiB less source (-5.75%). The guard confirms that all two runtime-pane
modules and all three closed-panel modules are absent from the eager graph.

A production build corroborates the split without being the acceptance metric. Initial JavaScript
fell from 2,871,162 to 2,828,919 raw bytes (-1.47%) and from 870,863 to 861,322 gzip bytes (-1.10%).

The bounded Electron review used one warm-up followed by three interleaved runs per tree. Median
process-to-ready fell from 6,325 ms to 5,940 ms (-6.09%), and median window-created-to-ready fell from
5,495 ms to 5,110 ms (-7.01%). Median first post-ready frame fell from 5,505.5 ms to 5,120.2 ms
(-7.00%).

The same runs used a temporary root React Profiler, removed after measurement. Median initial actual
render duration fell from 2.0 ms to 1.8 ms, while median commit-to-next-frame fell from 5.8 ms to 5.4
ms. The combined deferral therefore clears the startup target without slowing component rendering to
first paint.
