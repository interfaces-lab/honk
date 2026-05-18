# Effect TODO

This is the current cleanup roadmap. It mirrors opencode's `todo.md`: short
tracks, concrete priorities, and checkbox status. Re-run targeted `rg` before
starting any item; this file is a plan, not a guaranteed inventory.

## Priorities

```text
P0  ERR + RENDER + ROUTE
    Make expected failures typed, preserve useful messages across RPC/HTTP,
    and surface user-triggered failures in UI.

P1  SCHEMA
    Keep contracts as the single source of truth for DTOs, events, IDs, and
    public transport errors.

P2  MODEL
    Finish provider/model resolver consolidation and remove UI-owned fallback
    policy.

P3  COMPOSER + PLAN
    Keep composer and native plan side panel canonical against the Cursor data
    research already captured in docs.

P4  DELETE
    Continue deleting one-off helper files, obsolete CSS, wrapper routes, and
    dead exported-but-unused modules.

P5  EFFECT
    Remove service-local runtime/facade indirection where it is not an explicit
    runtime boundary.
```

## Tracks

- `ERR`: typed service/domain failures and error unions.
- `RENDER`: app toasts, banners, and copyable details for user-triggered
  failures.
- `ROUTE`: route/search contracts and server transport error mapping.
- `SCHEMA`: schema ownership and duplicate type deletion.
- `MODEL`: provider/model resolver core.
- `COMPOSER`: composer, slash menu, inline edit, prompt serialization.
- `PLAN`: native side panel and plan execution controls.
- `DELETE`: one-off helpers, unused exports, stale tests, and package cleanup.
- `EFFECT`: service shape, layers, bridges, and runtime boundaries.

## Status Markers

- [ ] Todo.
- [~] In progress.
- [x] Done.

## P0: Errors, Rendering, Routes

- [x] Keep provider and orchestration expected errors as `Schema.TaggedErrorClass`
  examples.
- [x] Surface branch checkout failures in the app instead of leaving an
  unhandled promise rejection.
- [ ] Audit git action, plan implementation, project script, provider command,
  and terminal actions for unhandled rejected promises.
- [ ] Pick one server route/RPC group and make expected errors explicit at the
  contract boundary.
- [ ] Decide whether app toast rendering needs a shared formatter for
  schema-backed command/provider/git errors.

## P1: Schema

- [x] Keep orchestration payload source of truth in `packages/contracts`.
- [x] Keep server orchestration schema aliases thin.
- [x] Regenerate `effect-acp` and `effect-codex-app-server` Effect schemas.
- [x] Add `multi/no-inline-schema-compile` oxlint rule and hoist current
  Effect Schema compiler calls.
- [x] Run strict oxlint with warnings denied after schema-rule cleanup.
- [ ] Remove app-side duplicate DTOs that mirror contract schema types.
- [ ] Schema-back persisted app store shapes that cross local persistence.
- [ ] Remove editor-internal prompt JSON from composer persistence and queue
  contracts.

## P2: Model

- [x] Move root model files into `packages/app/src/model`.
- [x] Delete duplicate shell model picker surface.
- [x] Move `getComposerProviderState` out of component ownership.
- [ ] Ensure app model resolver returns discriminated results for missing or
  disabled provider states.
- [ ] Keep picker components as consumers of model resolver output only.

## P3: Composer And Plan

- [x] Collapse provider skills into the slash menu surface with `/model`.
- [x] Remove `$` as a menu trigger.
- [x] Stop passing prompt editor JSON through composer stores, queues, and send
  boundaries.
- [x] Make inline edit use row-local composer geometry and immediate focus.
- [x] Remove the composer plan-ready banner; the native side panel is the plan
  surface.
- [ ] Finish deleting stale slash-menu helper files and tests.
- [x] Typecheck the current composer/plan slice.
- [x] Typecheck the provider-state and terminal-helper cleanup slice.
- [ ] Verify rendered inline edit height and plan panel controls.

## P4: Delete

- [x] Delete saved/remote environment surfaces.
- [x] Delete browser debug tracing product surface.
- [x] Delete unused UI package primitives and QR surfaces.
- [x] Delete root composer file names after moving real boundaries.
- [x] Inventory project-script, pending-user-input, and terminal helper files
  before deletion.
- [ ] Continue `knip` strict cleanup for exported-but-unused files.
- [ ] Re-evaluate `packages/app/src/diff-route-search.ts` after route-search
  ownership is decided.
- [x] Inline or delete terminal one-off helpers with single production callers.
- [ ] Remove project-script and pending-user-input one-off helpers only when
  caller inventory proves they are not boundaries.

### Terminal Helper Inventory

Keep these as real boundaries:

- [x] `packages/server/src/terminal/*`: PTY adapters and manager service.
- [x] `packages/app/src/terminal-state-store.ts`: terminal UI state owner.
- [x] `packages/app/src/lib/terminal-context.ts`: prompt/display
  serialization boundary used across composer, messages, and send flow.
- [x] `packages/app/src/terminal-links.ts`: shared link parsing/resolution.
- [x] `packages/app/src/lib/terminal-dimensions.ts`: shared workbench/thread
  terminal sizing.
- [x] `packages/app/src/lib/terminal-focus.ts`: cross-cutting terminal focus
  guard for keybindings and shell focus.
- [x] `packages/app/src/components/thread-terminal-drawer.tsx`: xterm drawer
  boundary.
- [x] `packages/app/src/components/chat/view/persistent-thread-terminal-drawer.tsx`:
  adapter between chat state and the drawer.
- [x] `packages/app/src/components/shell/terminal/panel.tsx`,
  `terminal-host-theme.ts`, and `terminal-xterm-host-sync.ts`: workbench
  terminal host boundaries.
- [x] `packages/app/src/components/chat/message/terminal-context-chip.tsx`:
  shared terminal context chip.
- [x] `packages/app/src/styles/terminal.css`: terminal host CSS imported by
  app styles.

Inline or collapse these only after reading the caller:

- [x] `packages/app/src/components/chat/composer/pending-terminal-contexts.tsx`:
  one chip wrapper used only by `prompt-editor.tsx`.
- [x] `packages/app/src/terminal-activity.ts`: one switch helper used only by
  `terminal-state-store.ts`.
- [x] `packages/app/src/lib/terminal-state-cleanup.ts`: one retention helper
  used only by `environments/runtime/service.ts`.
- [x] `packages/app/src/components/chat/view/project-script-terminal-actions.ts`:
  two project-script terminal helpers used only by `chat-view.tsx`; inline only
  if it does not make chat-view less readable.
- [x] `packages/app/src/components/chat/shared/user-message-terminal-contexts.ts`:
  one production caller in `human-message.tsx`; keep if message display needs a
  named parser boundary.

Keep single-caller UI files when they are shell slots, not helper buckets:

- [x] `packages/app/src/components/shell/terminal/terminal-rail.tsx`.
- [x] `packages/app/src/components/shell/terminal/workbench-subchrome.tsx`.

## P5: Effect

- [ ] Sweep service-local runtimes/facades and keep only real runtime bridges.
- [ ] Prefer existing server services over raw process/filesystem APIs when
  touching effectful server code.
- [ ] Keep app React/query boundaries plain unless there is a real durable
  Effect boundary.
