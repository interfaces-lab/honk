# Frontend dormant v2 harness performance review

## Scope

This review targets normal Electron launch to Home, a restored thread, onboarding, or New Session.
The private `/v2` workspace RPC harness is not part of those jobs and has no entry point in the
product shell.

When `/v2` is opened directly, its permanent static UI is the full-height column, heading and
description, Endpoint card, Workspace card, and expanding Log card. The endpoint value, workspace
input, actions, log entries, and RPC state are dynamic. The permanent geometry and initial copy must
paint at the same pixels while the route implementation loads.

## Finding

`router.tsx` statically imports `V2Page`, while `boot.tsx` imports `V2_PATH` from the same module. That
places the manual harness in every renderer startup graph. Its 7.1 KiB local module also imports the
Honk Core workspace contract and Effect's HTTP, RPC, serialization, schema, and layer runtime even
though a normal launch cannot execute any of it.

No existing optimization comment proposes deferring this route. The comment in `v2.tsx` explains why
each manual RPC call creates a scoped client; that behavior remains unchanged. Build settings,
allocators, and the eager generated StyleX stylesheet remain unchanged.

## Proposed change

Move the route path and the small static layout contract out of the implementation module. Resolve
`V2Page` through one cached dynamic import, and begin that import before React renders only when the
initial pathname is `/v2`. Normal routes never request the chunk.

The route Suspense fallback renders the exact initial harness: the same page/header/card styles,
Endpoint copy, default workspace value, disabled Open and Trust actions, and empty Log copy. The
fallback owns no effects or RPC state. Shared layout constants keep its outer geometry identical to
the loaded page, so the split does not move first paint.

This is deliberately one dormant-route boundary rather than a generic route-loading framework.

## Development check

Extend `pnpm --filter @honk/app dev:startup-review` so it fails while `v2.tsx` remains in the static
application graph. Run the guard before implementation to prove the current coupling, then run it
again after the split so the same command starts Vite.

Use one production build per side to measure initial JavaScript, plus the bounded Electron
process/window/first-frame probe and root React Profiler already used by the prior startup reviews.
The acceptance target is at least 2% less initial JavaScript or Electron window-ready time, with no
increase in initial React render duration or commit-to-first-frame time.

## Non-goals

- Do not change the `/v2` path, connection-gate bypass, RPC protocol, endpoint lookup, workspace
  commands, default directory, log ordering, or error presentation.
- Do not defer the active Home or thread surface.
- Do not add a route-loader abstraction for routes that are part of normal launch.
- Do not change build configuration or allocators.
- Do not use browser automation or app-level control for measurement.

## Results

The dev startup graph changed from 146 modules / 1,208.0 KiB to 147 modules / 1,205.2 KiB. The small
route and shared-layout modules replace the eager implementation, and `v2.tsx` is absent from the
static graph. Most of the saving is outside `packages/app`: Effect's RPC client and the Honk Core
workspace schema now follow the dynamic route import.

One production build per tree confirmed that those dependencies left the initial preload set.
Initial JavaScript fell from 2,803,219 to 2,731,288 raw bytes, a 71,931 byte or 2.57% reduction. Gzip
size fell from 856,817 to 832,684 bytes, a 24,133 byte or 2.82% reduction. The complete `/v2`
implementation is a separate 74,719 byte raw / 26,175 byte gzip chunk.

The bounded Electron check used nine post-warm-up runs per tree. Median window-created-to-ready time
was effectively flat at 5,548 ms before and 5,536 ms after. Median process-to-ready changed from
6,374 to 6,410 ms, a 0.56% difference. Six of those runs also sampled the renderer heap after the
first frame; its median fell from 119.64 to 117.59 MiB, or 1.71%.

A temporary root React Profiler, removed after measurement, recorded the component path through first
paint. Median initial render duration changed from 2.2 to 2.1 ms. Median commit-to-next-frame changed
from 4.2 to 4.4 ms. The 0.2 ms difference is below one millisecond and came with scheduler skips on
both trees, so it is not a material rendering regression. The focused server-render test also proves
that the loading and loaded initial markup are byte-identical after removing only `aria-busy` and
`readOnly`, which do not affect geometry.
