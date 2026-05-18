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

## Routes

Multi has two route families:

- Server HTTP/WebSocket routes in `packages/server`.
- TanStack renderer routes in `packages/app/src/routes` and route view modules
  in `packages/app/src/app/routes`.

Rules:

- [x] WebSocket RPC methods are explicit in `packages/contracts/src/rpc.ts`.
- [x] TanStack route files validate route/search shape.
- [ ] Route files do not own model resolution, plan orchestration, or composer
  state policy.
- [ ] Expected server errors are mapped at HTTP/RPC boundaries, not in generic
  middleware or UI string parsing.

Detailed rules: [routes.md](./routes.md).

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
