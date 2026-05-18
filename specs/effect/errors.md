# Typed Error And Rendering Spec

This is Multi's typed error target, adapted from opencode's `ERR`, `RENDER`,
and `HTTP` tracks.

## Goal

- Expected server failures live on the Effect error channel.
- Service interfaces expose expected failures in their return types.
- Domain errors are authored with `Schema.TaggedErrorClass`.
- Plain `Error` and defects are reserved for impossible states, renderer guards,
  and final unknown-boundary fallbacks.
- HTTP/WebSocket boundaries preserve useful structured details.
- App UI surfaces errors deliberately instead of leaking unhandled promises or
  opaque console-only failures.

## Current Anchors

Keep these as reference patterns:

- `packages/server/src/provider/Errors.ts`
- `packages/server/src/orchestration/Errors.ts`
- `packages/server/src/checkpointing/Errors.ts`
- `packages/server/src/persistence/Errors.ts`
- `packages/contracts/src/git.ts`
- `packages/contracts/src/terminal.ts`
- `packages/contracts/src/project.ts`
- `packages/contracts/src/orchestration.ts`
- `packages/effect-acp/src/errors.ts`
- `packages/effect-codex-app-server/src/errors.ts`

## Service Error Shape

Use schema-tagged errors for expected domain failures:

```ts
export class ProviderValidationError extends Schema.TaggedErrorClass<ProviderValidationError>()(
  "ProviderValidationError",
  {
    operation: Schema.String,
    issue: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export type ProviderServiceError =
  | ProviderValidationError
  | ProviderUnsupportedError
  | ProviderSessionNotFoundError;
```

Rules:

- [x] Export service/domain error unions from service boundaries.
- [x] Include expected error unions in Effect method signatures.
- [x] Use `yield* new DomainError(...)` or `Effect.fail(new DomainError(...))`
  for direct expected failures.
- [ ] Do not `throw` expected provider, git, orchestration, project, terminal,
  auth, settings, or persistence failures inside Effect services.
- [ ] Do not use `Effect.die(...)` for validation, unavailable resource, busy
  session, missing worktree, provider process, auth, or command failure.

## Transport Boundary Shape

Server services stay transport-agnostic. They should not import renderer toast
code, React, TanStack Router, or UI types.

HTTP/WebSocket handlers translate expected service errors into public contract
errors declared in `packages/contracts`.

Rules:

- [x] Public RPC error classes belong in `packages/contracts` when clients must
  decode them.
- [ ] Keep one-off translations inline at the handler when only one endpoint
  needs them.
- [ ] Extract tiny route-group helpers only when a translation repeats.
- [ ] Do not build one universal `unknown -> status/message` registry.
- [ ] Preserve current public wire bodies unless a breaking contract change is
  explicit.

## Renderer Error Shape

The app should surface command/provider/git failures where the action was
triggered.

Rules:

- [x] Branch checkout catches failed `git.checkout` mutations and shows a toast
  with the command error message.
- [ ] UI action handlers must not leave unhandled rejected promises for user
  actions.
- [ ] Toasts and banners should use the structured error message first, then a
  generic fallback.
- [ ] Long command details should remain copyable when practical.
- [ ] Console-only failures are acceptable only for developer diagnostics, not
  user-triggered workflows.

## Migration Order

Use vertical slices:

- [ ] Pick one domain boundary: provider, git, orchestration, project, terminal,
  auth, settings, or persistence.
- [ ] Inventory expected `throw new Error`, `Effect.die`, and plain `Data.TaggedError`
  call sites in that boundary.
- [ ] Convert expected failures to `Schema.TaggedErrorClass` where they cross a
  service or transport boundary.
- [ ] Map the expected errors at HTTP/WebSocket handlers if the wire shape
  changes.
- [ ] Render the public error in the app action surface that triggered it.
- [ ] Run `pnpm run typecheck`.

## PR Checklist

- [ ] Expected failures are typed errors, not defects.
- [ ] Service method signatures expose the expected error union.
- [ ] HTTP/RPC handlers translate domain errors at the boundary.
- [ ] Public contract error bodies are explicit schema contracts.
- [ ] UI action handlers surface errors and do not leave unhandled promises.
- [ ] Generic middleware or catch-all code got smaller or stayed unchanged.
