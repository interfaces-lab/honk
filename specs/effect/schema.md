# Schema Spec

Effect Schema is the source of truth for Multi contracts.

## Goal

- Domain IDs, DTOs, event payloads, RPC inputs, RPC outputs, and typed errors
  are schema-backed.
- App stores persist small facts and derive UI views from those facts.
- Server-internal schemas alias public contract schemas when the public contract
  is already the source of truth.
- Boundary-specific conversions are narrow and named.

## Current Anchors

- `packages/contracts/src/base-schemas.ts`
- `packages/contracts/src/orchestration.ts`
- `packages/contracts/src/provider.ts`
- `packages/contracts/src/provider-instance.ts`
- `packages/contracts/src/provider-runtime.ts`
- `packages/contracts/src/git.ts`
- `packages/contracts/src/terminal.ts`
- `packages/contracts/src/project.ts`
- `packages/contracts/src/rpc.ts`
- `packages/server/src/orchestration/Schemas.ts`
- `packages/effect-acp/src/schema.ts`
- `packages/effect-codex-app-server/src/schema.ts`

## Preferred Shapes

Use branded schema-backed IDs for single-value domain identifiers.

Use `Schema.Struct` for input/output payloads and local nested shapes.

Use `Schema.Class` only when a data object has durable identity or class
behavior that improves the domain.

Use `Schema.TaggedErrorClass` for expected typed errors.

Rules:

- [x] Contract schemas export both schema values and TypeScript types.
- [x] Orchestration command/event payloads live in contracts.
- [x] `packages/server/src/orchestration/Schemas.ts` aliases contract payloads
      rather than duplicating them.
- [x] Generated protocol schemas are refreshed with their package generators
      before typecheck when protocol schema output is in scope.
- [x] Effect Schema decoder/encoder compilers are hoisted outside function
      bodies; `multi/no-inline-schema-compile` enforces this through oxlint.
- [x] Strict oxlint runs with warnings denied after schema compiler hoisting.
- [x] New app store persisted shapes should be schema-backed when they cross
      localStorage/desktop persistence or runtime boundaries.
- [x] Avoid ad hoc string parsing for contract-shaped data when a schema exists.
- [x] Avoid generic schema bridges. Use boundary-specific helpers.

## Source Of Truth Rule

For each shape, choose one owner:

- Public client/server shape: `packages/contracts`.
- Provider protocol wrapper shape: provider adapter package/module.
- App-only persisted draft state: app store module with explicit schema.
- Generated external protocol shape: generated protocol package, with narrow
  adapters into Multi contracts.

Current app persistence boundaries:

- `packages/app/src/stores/chat-drafts.ts` owns composer and draft-thread
  persistence schemas.
- `packages/app/src/stores/ui-state-store.ts`,
  `packages/app/src/stores/shell-panels-store.ts`, and
  `packages/app/src/terminal-state-store.ts` decode persisted store payloads
  with boundary-local schemas before normalizing state.
- `packages/app/src/app/routes/chat-route-persistence.ts` decodes the last chat
  route cache with the contract `ScopedThreadRef` schema plus the app `DraftId`
  schema.
- `packages/app/src/lib/native-git-react-query.ts` returns the contract
  `GitFilePatchResult` directly instead of an app-local mirrored patch DTO.
- Scalar preferences such as theme, project cwd, and appearance settings are
  intentionally stored as scalar keys and clamped or narrowed at read time.

Rules:

- [x] Do not fork public DTO types in app query hooks.
- [ ] Do not define server-only aliases unless they point back to contracts.
- [ ] Do not add model/provider option types inside composer or picker
      components.
- [ ] Keep derived UI view models private to the rendering boundary.

## Migration Order

- [ ] Move public leaf IDs and refinements first.
- [ ] Move input/output/event payloads next.
- [ ] Move expected domain errors with the error slice.
- [ ] Replace duplicate app/server local types with imports from the owner.
- [ ] Remove now-unused helper validators and tests that only mirrored the old
      duplicate type.

## PR Checklist

- [ ] One schema source of truth owns each changed type.
- [ ] Remaining non-Effect validation is an intentional boundary.
- [ ] Public RPC/HTTP shape is unchanged or intentionally changed.
- [ ] App stores persist facts, not editor-internal JSON documents.
- [x] Typecheck passes.
