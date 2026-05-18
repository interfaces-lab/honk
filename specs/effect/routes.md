# Route And Transport Spec

Multi has server transport routes and renderer routes. Keep both small and
boundary-focused.

## Server Routes

Server HTTP/WebSocket routes own transport translation only.

Current anchors:

- `packages/server/src/http.ts`
- `packages/server/src/ws.ts`
- `packages/contracts/src/rpc.ts`
- `packages/app/src/rpc/ws-rpc-client.ts`
- `packages/app/src/environment-api.ts`

Rules:

- [x] WebSocket RPC methods are named in `packages/contracts/src/rpc.ts`.
- [x] App clients call the environment API rather than server internals.
- [ ] Server route handlers yield stable services at handler construction or
  runtime startup boundaries.
- [ ] Expected domain errors are translated to declared public contract errors.
- [ ] Generic server middleware must not accumulate domain-specific error name
  checks.
- [ ] Raw HTTP routes are kept only for static/dev hosting, auth bootstrap,
  attachment transfer, health/meta endpoints, and WebSocket upgrade paths.

## Renderer Routes

TanStack route files own path/search validation and route selection only.

Current anchors:

- `packages/app/src/routes/*.tsx`
- `packages/app/src/app/routes/*.tsx`
- `packages/app/src/routeTree.gen.ts`
- `packages/app/src/thread-routes.ts`
- `packages/app/src/chat-route-persistence.ts`
- `packages/app/src/diff-route-search.ts`

Rules:

- [x] Route files may validate search and route params.
- [x] Route files may retain search params across thread navigation when the
  search params are a real cross-route UI state.
- [ ] Route files may not own settings workflows, provider/model selection,
  composer policy, git orchestration, or plan implementation.
- [ ] Shared route-search helpers are kept only when multiple route/component
  boundaries need the same search contract.
- [ ] Thin route wrappers are deleted when they only forward props.

## Diff Route Search

`packages/app/src/diff-route-search.ts` is a route-search contract, not a
random utility. It is kept only if these callers continue to share one search
shape:

- `packages/app/src/routes/_chat.tsx`
- `packages/app/src/routes/_chat.$environmentId.$threadId.tsx`
- `packages/app/src/components/diff-panel.tsx`
- `packages/app/src/components/chat/view/chat-view.tsx`
- `packages/app/src/components/shell/git/panel.tsx`

Rules:

- [ ] If those callers still share the same route search shape, move the file
  beside route ownership and name it for chat route search.
- [ ] If the shape becomes panel-local, inline it into the panel boundary and
  delete the shared file.
- [ ] Do not keep a root helper merely because it is used by tests.

## PR Checklist

- [ ] Route files own routing only.
- [ ] Server routes own transport translation only.
- [ ] Search param contracts are colocated with route ownership.
- [ ] Expected errors cross transport boundaries as explicit contract errors.
- [ ] `routeTree.gen.ts` matches kept routes.
