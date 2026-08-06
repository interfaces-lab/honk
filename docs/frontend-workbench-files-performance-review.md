# Frontend workbench Files performance review

## Scope

This review targets Electron launch into Home or a restored thread without a Files workbench deep
link. The thread transcript, workbench state, closed rail, panel sizing, tool header, and route
reconciliation are permanent startup work and stay eager.

Files tabs are not persisted between process launches. The explorer and read-only viewer become
permanent only after the user opens Files, opens a transcript file link, or launches Honk at a Files
deep link.

## Finding

`workbench-panel-surface.tsx` statically imports `workbench-files.tsx`, which statically imports
`workbench-file-viewer.tsx`. Together they add 45.2 KiB of application source to every renderer
startup even when the workbench is closed. Neither module owns shell hotkeys, tab state, route
reconciliation, sizing, or the permanent workbench rail.

No existing optimization comment proposes deferring this surface. The existing comments inside the
Files modules describe API limitations, resource lifetime, and visual behavior and remain intact.

## Proposed change

Keep `WorkbenchPanelSurface` eager and make only the `WorkbenchFiles` implementation a conditional
`React.lazy` import. A Files or file tab mounts the local chunk; all other tab kinds follow their
existing paths. The module cache makes later Files tabs synchronous.

During the first handoff, keep the panel column and tool header mounted. The fallback preserves the
permanent horizontal split, 38% explorer width, 160–240 px explorer bounds, hairline separator,
large-control toolbar height, editor header height, and centered loading stage. It renders no fake
file names. A deep-linked file therefore gets the final pixel geometry before its data-bearing module
arrives.

## Development check

`pnpm --filter @honk/app dev:startup-review` must fail while `workbench-files.tsx` or
`workbench-file-viewer.tsx` remains in the eager application graph. Run it before implementation to
prove the baseline and after implementation to start Vite.

Use one production app build before and after, plus focused workbench Files/viewer and panel tests.
The acceptance target is at least 2% less eager application source or Electron window-ready time.

## Results

The eager application graph moved from 158 modules and 1,471.1 KiB of source to 156 modules and
1,430.7 KiB: 2.75% less source to transform, parse, and compile. Both Files modules are outside the
graph. The production HTML entry set moved from 2,980,917 to 2,965,273 raw JavaScript bytes (0.52%)
and from 901,658 to 898,241 gzip bytes (0.38%); shared icons and runtime helpers remain eager for
other surfaces.

The bounded Electron development probe discarded one run that hit a Vite dependency-optimizer cache
error, then used three clean starts and no UI automation. Merged main's median was 7,792 ms
process-wide and 6,735 ms from window creation to `ready-to-show`. This change measured 7,562/6,495
ms, 7,292/6,430 ms, and 7,307/6,445 ms, for medians of 7,307 ms and 6,445 ms. Process-wide startup
improved 6.22%; visible window startup improved 4.31%.

## Non-goals

- Do not change build configuration, allocators, Files APIs, caching, refresh behavior, or viewer
  limits.
- Do not defer Changes, Terminal, Browser, Tasks, Plan, or Side Chat in this PR.
- Do not unmount visited workbench tabs or change route, tab, sizing, focus, or maximization behavior.
- Do not use browser automation or app-level control for measurement.
