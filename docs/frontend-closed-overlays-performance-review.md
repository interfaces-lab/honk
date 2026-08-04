# Frontend closed-overlays performance review

## Scope

This review targets a normal Electron launch into Home or a restored thread. The Command menu,
Connect Device dialog, Settings sheet, and toast viewport are closed during that job.

The permanent startup UI is the title bar, tab strip, active route, status controls, shell material,
hotkey registry, command-menu store, device-connection controller, and buffered toast store. Those
parts must remain eager. Once a user requests an overlay, its popup frame becomes permanent while the
visual module loads.

## Finding

`shell.tsx` statically imports `CommandMenuOverlay`, `ConnectDeviceDialog`, `SettingsOverlay`, and
`ToastViewport`. All four components render no visible UI during a normal startup, but their complete
visual trees, icons, QR renderer, command ranking UI, settings rail, toast cards, and supporting code
remain in the renderer's initial module set.

The stores and actions that open these overlays already live in separate modules. The shell can
subscribe to their small snapshots and import the visual component only after its state becomes open.
No existing source comment proposes this split. The comment that overlays leave the active route
mounted is a product contract and remains unchanged.

## Proposed change

Add small eager overlay hosts. They keep the four state subscriptions in the shell and conditionally
mount a `React.lazy` visual component only while that overlay is requested.

The Command menu fallback keeps the final 620 px width cap, clamped top position, search-header
height, scope label, and result-row geometry. The Connect Device fallback keeps the final dialog
header, close-control location, body alignment, and 288 px square connection stage. The Settings
fallback keeps the final 920 px width cap, 744 px height cap, 48 px viewport clearance, 200 px rail,
compact 152 px rail, close-control location, active section title, and content column. Text bars and
stage content are transient; popup geometry does not move when the real component replaces them. A
toast fallback keeps the final fixed bottom-right position, 340 px width cap, spacing, copy, and
dismiss behavior while its visual module loads. Toast timers and items remain eager and buffered.

The first open pays one local chunk import. Later opens use the browser module cache. Closing an
overlay still leaves the active route mounted, and its existing store or controller remains the only
owner of state.

## Development check

`pnpm --filter @honk/app dev:startup-review` walks static imports before starting Vite. Extend it to
fail while `command-menu.tsx`, `connect-device.tsx`, `settings.tsx`, or `toast.tsx` remains in the
eager application graph. Run it before implementation to prove the baseline and after implementation
to start the dev server.

Use one production app build before and after the change. Compare the module script and
module-preload files referenced by `dist/index.html` as corroborating evidence. The acceptance target
is at least 2% less eager application source or Electron window-ready time. Focused overlay tests, app
typecheck, architecture check, design lint, and the app build guard behavior and chunk validity.

## Results

The static startup graph moved from 159 modules and 1,527.9 KiB of application source to 158 modules
and 1,470.7 KiB: 3.74% less source for Vite and V8 to transform, parse, and compile. All nine settings
panels and all four closed visual modules are outside that graph. The production HTML entry set moved
from 3,041,442 to 2,980,917 raw JavaScript bytes (1.99%) and from 915,074 to 901,658 gzip bytes
(1.47%). This corroborates the source-graph result but is not the primary acceptance metric.

The bounded Electron development probe used three starts and no UI automation. Merged main's median
was 7,849 ms process-wide and 6,932 ms from window creation to `ready-to-show`. This change measured
7,774/6,304 ms, 7,845/6,735 ms, and 7,792/6,831 ms, for medians of 7,792 ms and 6,735 ms. Visible
window startup improved 2.84%; process-wide startup improved 0.73%, with sidecar startup still
dominating that broader clock.

## Non-goals

- Do not change Vite, Rollup, dependency optimization, minification, or allocators.
- Do not change commands, ranking, hotkeys, pairing state, permissions, or dismissal behavior.
- Do not defer the shell, stores, controller, or active route.
- Do not use browser automation or app-level control for measurement.
