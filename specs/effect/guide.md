# Effect Guide

This is the reference shape for Effect-backed code in Multi. It follows the
opencode spec pattern: durable rules here, current work queue in
[todo.md](./todo.md), and boundary-specific detail in sibling specs.

## Package Boundaries

Multi has three main runtime layers:

- `packages/contracts`: schema-backed public contracts, IDs, DTOs, events, and
  transport error shapes.
- `packages/server`: durable services, provider adapters, orchestration,
  persistence, git, project IO, auth, and WebSocket/HTTP handlers.
- `packages/app`: Vite/TanStack React renderer, local state stores, query hooks,
  shell/composer UI, and user-facing error rendering.

Rules:

- [x] Contracts stay runtime-neutral and schema-first.
- [x] Server services own durable side effects and expected domain failures.
- [x] App code renders state and calls environment APIs; it does not invent
      duplicate domain contracts.
- [ ] App helper files are kept only when they own a real boundary, not because
      they are convenient one-off buckets.

Reference sources:

- [x] `pi` favors small package surfaces, curated exports, and direct tests at
      package boundaries.
- [x] opencode's Effect specs favor one roadmap plus boundary-specific
      checklists with explicit "done means" gates.

## Service Shape

Use one service contract plus one implementation module when a service is
actually shared or effectful.

Target server shape:

```ts
export interface ProviderRegistryShape {
  readonly list: () => Effect.Effect<ReadonlyArray<ServerProvider>, ProviderServiceError>;
}
```

Rules:

- [x] Public service methods use traced `Effect.fn("Service.method")`.
- [x] Service contracts expose typed expected error unions.
- [x] Implementation helpers stay private unless another module has a durable
      reason to import them.
- [ ] Do not add new async facades around services unless they are a real
      runtime bridge.
- [ ] Do not add `.logic.ts` or root helper modules for single call sites.

Current examples:

- `packages/server/src/provider/Errors.ts`
- `packages/server/src/orchestration/Errors.ts`
- `packages/server/src/git/GitCore.service.ts`
- `packages/server/src/provider/ProviderService.service.ts`
- `packages/server/src/orchestration/OrchestrationEngine.service.ts`

## Runtime Boundaries

Server runtime construction lives at the server edge. React components and query
hooks call explicit environment APIs; they should not rebuild server layers or
hide RPC calls behind generic app-local service facades.

Rules:

- [x] WebSocket RPC is a product boundary and remains explicit.
- [x] Electron hosts the web app and local server; the browser renderer is not a
      deleted "remote environment" surface.
- [ ] Server Effect layers should be assembled at startup/runtime boundaries,
      not per request unless request context requires it.
- [ ] App query hooks may throw availability errors for disabled UI paths, but
      server/domain errors should be surfaced from the API response unchanged.

## Errors

Expected service failures belong on the Effect error channel. Use
`Schema.TaggedErrorClass` for new expected domain errors. Reserve defects and
plain thrown errors for impossible states, wiring bugs, and renderer-only guard
failures.

Rules:

- [x] Provider, orchestration, git, terminal, project, and protocol packages
      already use schema-backed tagged errors in several core paths.
- [ ] Expected server failures must not be converted to opaque `Error` strings
      before they cross HTTP/RPC boundaries.
- [ ] UI catch blocks should render the best available structured message and
      keep copyable details for command/provider/git failures.

Detailed rules: [errors.md](./errors.md).

Toast renderer inventory: [app-toast-files.md](./app-toast-files.md).

## Schemas

Use Effect Schema as the source of truth for domain contracts.

Rules:

- [x] `packages/contracts/src/*.ts` owns public DTOs, IDs, events, inputs,
      outputs, and transport error classes.
- [x] `packages/server/src/orchestration/Schemas.ts` aliases contract schemas
      instead of forking them.
- [ ] New provider, git, project, terminal, settings, and orchestration contracts
      start in `packages/contracts`, not in app stores or renderer helpers.
- [ ] Boundary-specific derived validators must be narrow and named for their
      boundary.

Detailed rules: [schema.md](./schema.md).

## App Simplification

The app cleanup target is not fewer files at any cost. It is fewer ownership
mysteries.

Rules:

- [ ] Every retained app helper file has a boundary reason.
- [ ] Single-caller helper files are inlined unless they protect readability,
      platform integration, or a cross-surface contract.
- [ ] `.logic.ts` files are not added to make component tests easier.
- [ ] CSS files are retained only for tokens, global renderer contracts, or
      external renderer integration.
- [ ] Deletion waves update the spec checklist before code is removed.

Detailed rules: [app-simplification.md](./app-simplification.md).

State inventory: [app-state-files.md](./app-state-files.md).

Toast inventory: [app-toast-files.md](./app-toast-files.md).

CSS inventory: [app-css-files.md](./app-css-files.md).

## Server And Shared Packages

Server files are runtime/service boundaries. Shared files are public
cross-package primitives and should stay small, curated, and free of app policy.

Rules:

- [x] The proposed-plan server chain is canonical and must not be deleted as
      app helper cleanup.
- [ ] Make `@multi/shared/observability` canonical for trace record/sink/tracer
      behavior and remove server duplicates.
- [x] Keep `@multi/shared/model` as primitive model helpers; app resolver
      policy belongs in `packages/app/src/model`.
- [x] Keep `@multi/shared/project-scripts` canonical for project-script runtime
      helpers used by app and server.
- [ ] Reclassify one-consumer shared exports before keeping them public.

Detailed rules: [server-shared-files.md](./server-shared-files.md).

Runtime and service rules: [server-runtime.md](./server-runtime.md).

## Model And Provider

Provider/model state needs one normalized resolver core. Components render its
results.

Rules:

- [x] Availability, fallback, ordering, and missing-state policy live in model
      core, not picker components.
- [x] Picker/settings/command-palette surfaces consume normalized model output.
- [x] Missing/disabled provider states are discriminated results with consistent
      UI messages.

Detailed rules: [model.md](./model.md).

Supported-provider source of truth: [providers.md](./providers.md).

## Routes

Multi has two route families:

- Server HTTP/WebSocket routes in `packages/server`.
- TanStack renderer routes in `packages/app/src/routes` and route view modules
  in `packages/app/src/app/routes`.

Rules:

- [x] WebSocket RPC methods are explicit in `packages/contracts/src/rpc.ts`.
- [x] TanStack route files validate route/search shape.
- [x] Route files do not own model resolution, plan orchestration, or composer
      state policy.
- [ ] Expected server errors are mapped at HTTP/RPC boundaries, not in generic
      middleware or UI string parsing.

Detailed rules: [routes.md](./routes.md).

Renderer route inventory: [app-route-files.md](./app-route-files.md).

## Composer And Plan

Composer and plan mode are renderer boundaries. They persist plain prompt text
and structured facts, render native controls, and call explicit environment
APIs.

Rules:

- [x] Proposed plans render in the right workbench plan panel.
- [x] Plan actions live on the plan workbench, not in a chat plan card.
- [x] Do not use direct `useEffect` for prop-to-state or store-to-state sync.
- [ ] Existing React effects should be kept only for external sync,
      subscriptions, DOM integration, observers, and cleanup.
- [ ] Composer helper files are kept only when they own a durable behavior
      boundary.

Detailed rules: [composer-plan.md](./composer-plan.md).

## React Effects

React effects are reserved for external-system synchronization. App UI state is
derived in render, changed by event handlers, loaded through query hooks, or
reset with keyed boundaries.

Rules:

- [x] Direct `useEffect` is not allowed for new React code.
- [x] Add a `useMountEffect` wrapper for mount-only external sync.
- [x] Classify the production files with direct `useEffect` before code
      changes.
- [x] Enforce no direct `useEffect` through the local oxlint plugin after the
      migration path is documented.

Detailed rules: [react.md](./react.md).

## Usability Testing

UI cleanup must preserve the product surface, not private helper files.

Rules:

- [ ] Sidebar behavior is covered at multiple viewport sizes.
- [ ] Composer single-line/multi-line transitions are covered as UI behavior.
- [ ] Plan workbench actions are covered in browser tests.
- [ ] Helper tests are deleted or moved when the helper is deleted or inlined.

Detailed rules: [usability-testing.md](./usability-testing.md).

## Verification

Default verifier for code changes is:

```bash
pnpm run typecheck
```

Rules:

- [x] Use focused tests only when creating, changing, or debugging tests.
- [ ] For Effect service migrations, verify the service error channel and the
      public HTTP/RPC shape when the boundary changes.
- [ ] For app UI changes, verify rendered behavior when layout or interaction is
      the changed contract.
