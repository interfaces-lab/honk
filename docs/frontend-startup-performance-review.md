# Frontend startup performance review

## Scope

This review targets the renderer's initial JavaScript graph. The user is launching Honk to reach the
restored Home or thread view. Settings is closed during that job.

The permanent startup UI is the title bar, tab strip, current route, status controls, toast viewport,
and shell material. Those parts must stay eager. The settings dialog frame is permanent while Settings
is open: its close control, section rail, active-section title, fixed 920 px width cap, and fixed 744 px
height cap must render without moving. Only the selected section body is transient.

## Finding

`settings.tsx` statically imports every settings section. Since `AppShell` renders the closed
`SettingsOverlay`, the renderer parses and evaluates all nine section modules during startup. None of
their controls can be used until Settings opens, and only one section can be visible at a time.

No source comment proposes deferring these section modules. The existing StyleX comment in
`vite.config.ts` requires the generated stylesheet to remain eager. This change leaves that contract
alone and does not change Vite, Rollup, Electron, or allocator configuration.

## Proposed change

Load each settings section with `React.lazy`. Keep the dialog frame and section navigation eager. Wrap
only the selected section body in one Suspense boundary. While a section chunk loads, retain the exact
dialog, rail, header, scroll container, and content-column geometry. The fallback occupies the same
content column and reports a quiet loading status without changing focus or dismiss behavior.

The first visit to a section pays one local chunk import. Later renders use the module cache. This is a
small, favorable interaction cost because it removes code for eight invisible sections from a typical
Settings visit and all nine from application startup.

## Development check

`pnpm --filter @honk/app dev:startup-review` walks static TypeScript imports from `src/main.tsx` before
starting Vite. It prints eager application source bytes and fails if any settings section entry remains
in the static startup graph. The check intentionally ignores dynamic imports.

`HONK_STARTUP_REVIEW=1 pnpm --filter @honk/desktop dev` also prints an `electron-ready` record when the
main window reaches Electron's `ready-to-show` event. `processMs` starts at Electron process creation.
`windowMs` starts when Honk creates the main `BrowserWindow`. The probe is development-only and does
not interact with the window.

Source bytes are a quick development proxy. The acceptance measurement is the emitted initial
JavaScript from one production build before and after the change. The target is at least 2% less
initial JavaScript. Typecheck, focused tests, the design lint, and the app build guard behavior and
chunk validity.

## Result

The development import check moved from 172 eager app modules and 1,663.1 KiB of source to 159
modules and 1,527.9 KiB. All nine settings panel entries left the static startup graph. That is 13
fewer eager modules and 8.1% less eager app source.

The production build's initial JavaScript set is the module script and module-preload files named by
`dist/index.html`. It moved from 3,133,697 bytes to 3,041,442 bytes, a 92,255 byte or 2.94% reduction.
Gzip size moved from 933,714 bytes to 915,074 bytes, a 1.996% reduction.

A bounded V8 module-compile check parsed the initial files without launching a browser or Electron.
After 10 warmups, 50 samples moved from a 37.43 ms median at baseline to 35.60 ms. That is a 4.89%
reduction. The baseline p10 to p90 range was 37.00 to 37.92 ms. The changed range was 35.04 to 36.04
ms. This isolates JavaScript parse and compile work. It does not claim to measure the full Electron
launch path.

The Electron dev check used one dependency-optimizer warmup per worktree, then three fresh Electron
processes per side. Baseline process-to-ready samples were 8,291, 8,365, and 8,375 ms. Changed samples
were 7,673, 7,849, and 7,929 ms. The median fell 6.17%. Baseline window-to-ready samples were 7,382,
7,433, and 7,526 ms. Changed samples were 6,816, 6,932, and 6,991 ms. That median fell 6.74%. These
development measurements include Vite's on-demand transforms and detached DevTools, but exclude Vite
dependency optimization. They verify the Electron renderer path without claiming packaged-launch
timings.

## Non-goals

- Do not change production build settings, dependency optimization, minification, or allocators.
- Do not defer permanent shell UI or route content.
- Do not change settings copy, layout, controls, persistence, permissions, or section ordering.
- Do not use browser automation or app-level control for the measurement.
