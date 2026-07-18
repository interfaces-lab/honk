# @honk/app agent rules

Read the repository `AGENTS.md` first. These rules apply specifically to the shared web and desktop
application in `packages/app`.

## Priorities

- Prioritize, in this order: stability, simplicity, performance.
- Preserve user-visible behavior, persisted state, and session continuity before refactoring.
- Before changing app startup, session navigation, transcript rendering, virtualization, or external-store subscriptions, record a repeatable baseline and compare the same workflow after the change. Use a production build for performance claims.

## Debugging

- Never restart the app, backend, or development server. The user owns those processes.
- Diagnose the root cause before changing code. Do not hide lifecycle or synchronization bugs with remount keys, arbitrary delays, retries, polling, or duplicated state.

## Application Boundaries

- `@honk/app` is shared by browser and desktop hosts. Keep Electron and Node APIs behind the existing host bridges; app components must remain browser-safe.
- Treat sessions, tabs, drafts, transcripts, and workbench state as durable product behavior. Preserve migration and restoration semantics when changing their models or stores.
- Prefer derived render state over mirrored React state. External stores must return stable snapshots and use the existing subscription patterns.
- Keep expensive work out of render paths. Do not trade correctness or clarity for speculative memoization.

## Verification

- Run `pnpm --filter @honk/app typecheck`.
- Run affected tests with `pnpm --filter @honk/app exec vitest run <test-files>`; run the full app suite when a shared store, session, transcript, or workbench contract changes.
- Run `pnpm run check:app-architecture` for structural changes and `pnpm run lint:design` for user-facing changes.
- Build with `pnpm --filter @honk/app build` when changing startup, bundling, lazy loading, or production performance.
