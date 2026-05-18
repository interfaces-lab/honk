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

Implemented cleanup paths:

- `packages/server/src/server-runtime-startup.ts` handles inaccessible active
  project roots only during backend startup, not through a recurring runtime
  sweeper or backend-only diagnostic. Cleanup archives every non-deleted,
  non-archived thread for the affected project while preserving the original
  broken project path on the saved records/history; it does not delete records
  or rewrite the stale path. Runtime path failures should stay action-specific
  and must not trigger this archival cleanup.

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
- [x] Orchestration HTTP errors use the contract-owned
      `OrchestrationHttpErrorResponse` body while preserving the existing
      `{ error: string }` wire shape.
- [ ] Keep one-off translations inline at the handler when only one endpoint
      needs them.
- [ ] Extract tiny route-group helpers only when a translation repeats.
- [ ] Do not build one universal `unknown -> status/message` registry.
- [ ] Preserve current public wire bodies unless a breaking contract change is
      explicit.

## Renderer Error Shape

The app should surface command/provider/git failures where the action was
triggered.

Current renderer action audit:

- [x] Git agent start/stop actions are TanStack mutations with `onError` toast
      rendering in `packages/app/src/components/shell-host.tsx`.
- [x] Plan implementation, plan copy, and save-to-project actions catch
      rejected work and render toasts at the workbench action surface.
- [x] Project script add/update/delete actions surface validation or toast
      errors instead of relying on console-only failures.
- [x] Provider slash-command selection is an editor-state replacement, not an
      async provider command execution path.
- [x] Terminal open/write paths surface errors through terminal system messages
      or thread errors; resize/background cleanup failures are not
      user-triggered command failures.

Rules:

- [x] Branch checkout catches failed `git.checkout` mutations and shows a toast
      with the command error message.
- [x] UI action handlers must not leave unhandled rejected promises for user
      actions.
- [ ] Toasts and banners should use the structured error message first, then a
      generic fallback.
- [ ] Long command details should remain copyable when practical.
- [ ] Console-only failures are acceptable only for developer diagnostics, not
      user-triggered workflows.

Toast renderer inventory: [app-toast-files.md](./app-toast-files.md).

Rules:

- [x] Toast error descriptions currently have a copy button by default.
- [ ] Error normalization should happen at action/API boundaries before
      `toastManager.add(...)` is called.
- [ ] Add shared app error formatting only when at least two action handlers
      need the same structured extraction.
- [ ] Do not add a universal `unknown -> toast` registry.

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
