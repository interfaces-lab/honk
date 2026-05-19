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
    Finish provider/model resolver consolidation, make the supported-provider
    list canonical, and remove UI-owned fallback policy.

P3  COMPOSER + PLAN
    Keep composer and native plan side panel canonical against the Cursor data
    research already captured in docs.

P4  DELETE
    Continue deleting one-off helper files, obsolete CSS, wrapper routes, and
    dead exported-but-unused modules.

P5  USABILITY TESTS
    Move helper tests toward browser/integration coverage for the actual shell,
    sidebar, composer, picker, and plan behaviors.

P6  EFFECT
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
- `REACT`: renderer state/effect rules.
- `DELETE`: one-off helpers, unused exports, stale tests, and package cleanup.
- `TEST`: browser/integration behavior coverage for cleanup safety.
- `EFFECT`: service shape, layers, bridges, and runtime boundaries.
- `CSS`: global CSS/token ownership and feature CSS deletion.

## Status Markers

- [ ] Todo.
- [~] In progress.
- [x] Done.

## P0: Errors, Rendering, Routes

- [x] Keep provider and orchestration expected errors as `Schema.TaggedErrorClass`
      examples.
- [x] Surface branch checkout failures in the app instead of leaving an
      unhandled promise rejection.
- [x] Audit git action, plan implementation, project script, provider command,
      and terminal actions for unhandled rejected promises.
- [x] Convert startup missing project-root handling from log-only diagnostics to
      a typed project state cleanup path: detect active projects whose
      `projectRoot` is inaccessible during backend startup only, archive every
      non-deleted, non-archived thread for the affected project, and keep the
      original broken project path saved on the archived records for history.
      Runtime path failures should still surface as action-specific errors, not
      trigger this archival cleanup. This should replace repeatedly logging
      `active project project root is not accessible` on every backend start.
- [x] Fix WebSocket RPC subscription error cause serialization so browser tests
      do not emit repeated `SchemaError(Expected array, got Cause...)` warnings.
- [x] Pick one server route/RPC group and make expected errors explicit at the
      contract boundary.
- [x] Decide whether app toast rendering needs a shared formatter for
      schema-backed command/provider/git errors.

## P1: Schema

- [x] Keep orchestration payload source of truth in `packages/contracts`.
- [x] Keep server orchestration schema aliases thin.
- [x] Regenerate `effect-acp` and `effect-codex-app-server` Effect schemas.
- [x] Add `multi/no-inline-schema-compile` oxlint rule and hoist current
      Effect Schema compiler calls.
- [x] Run strict oxlint with warnings denied after schema-rule cleanup.
- [x] Remove app-side duplicate DTOs that mirror contract schema types.
- [x] Schema-back persisted app store shapes that cross local persistence.
- [x] Remove editor-internal prompt JSON from composer persistence and queue
      contracts.

## P2: Model

- [x] Move root model files into `packages/app/src/model`.
- [x] Delete duplicate shell model picker surface.
- [x] Move `getComposerProviderState` out of component ownership.
- [x] Key composer provider option selections by provider instance instead of
      driver kind.
- [x] Write the normalized model resolver contract in
      `packages/app/src/model/provider-state.ts` or its replacement.
- [x] Ensure app model resolver returns discriminated results for missing or
      disabled provider states.
- [x] Route chat/composer selection through the normalized resolver contract.
- [x] Route settings text-generation selection through the normalized resolver
      contract and delete unused exported resolver wrappers.
- [x] Remove unused exports from provider/model helper files after caller
      inventory.
- [x] Keep picker components as consumers of model resolver output only.
- [x] Classify `components/command-palette-model.ts`: not normalized
      provider/model output; leave any collapse to the delete inventory.
- [x] Add compact model selector overflow browser coverage.
- [x] Re-run model/provider one-caller export inventory from
      [model.md](./model.md) before the next model cleanup wave.
- [x] Decide whether current picker display helpers in
      `components/chat/picker/icon-utils.ts` stay as a picker boundary or move
      into the consuming picker files.
- [x] Add full provider settings browser coverage before collapsing
      settings-provider component boundaries.
- [x] Rewire supported providers to the canonical list in
      [providers.md](./providers.md): Codex/OpenAI, Claude, OpenCode, Cursor,
      and Pi pending only.
- [x] Remove provider-specific model constants, aliases, display names, and
      per-provider defaults from `packages/contracts/src/model.ts`; model
      catalogs are provider/runtime-owned.

## P3: Composer And Plan

- [x] Collapse provider skills into the slash menu surface with `/model`.
- [x] Remove `$` as a menu trigger.
- [x] Stop passing prompt editor JSON through composer stores, queues, and send
      boundaries.
- [x] Make inline edit use row-local composer geometry and immediate focus.
- [x] Remove the composer plan-ready banner; the native side panel is the plan
      surface.
- [x] Mount the plan workbench in the browser/TanStack shell as well as the
      hosted Electron shell.
- [x] Restore proposed plan copy, download, save-to-project, and build controls
      on the native plan workbench.
- [x] Stop using render-time `useEffect` to activate the plan tab; plan
      activation is driven by user actions and implementation actions.
- [x] Prevent inactive right-workbench panels from mounting side-effectful
      bodies such as terminal hosts.
- [x] Finish deleting stale slash-menu helper files and tests.
- [x] Typecheck the current composer/plan slice.
- [x] Typecheck the provider-state and terminal-helper cleanup slice.
- [x] Verify rendered inline edit height.
- [x] Verify plan panel controls with focused browser coverage.
- [x] Replace existing prop-to-state effects in composer controls with derived
      state or keyed component boundaries.

## P4: Delete

- [x] Delete saved/remote environment surfaces.
- [x] Delete browser debug tracing product surface.
- [x] Delete unused UI package primitives and QR surfaces.
- [x] Delete root composer file names after moving real boundaries.
- [x] Inventory project-script, pending-user-input, and terminal helper files
      before deletion.
- [~] Continue `knip` strict cleanup for exported-but-unused files.
  - [x] Re-ran `pnpm run knip:production`; repo-wide output still fails on
        package entry/dependency noise, but filtering the same run to
        `packages/app/src` reported no app source unused exports after the
        model/provider cleanup wave.
  - [x] Re-ran `pnpm run knip:production` after provider/model cleanup; the
        repo-wide run still reports package entry/dependency public-surface
        noise, but filtering the output to `packages/app/src`,
        `packages/server/src`, `packages/server/test`, and
        `packages/server/scripts` produced no source-path deletion candidates.
  - [x] Re-ran `pnpm run knip:production` after schema/provider coverage
        cleanup; it still fails on broad package dependency and public export
        reports, but did not surface a new focused app/server source deletion
        target for this pass.
- [x] Re-evaluate `packages/app/src/diff-route-search.ts` after route-search
      ownership is decided; keep the shared search contract at
      `packages/app/src/app/routes/chat-shell-search.ts`.
- [x] Decide current `diff-route-search.ts` ownership: keep the shared search
      contract for now, but move it under route ownership.
- [x] Inline or delete terminal one-off helpers with single production callers.
- [x] Remove project-script one-off helpers only when caller inventory proves
      they are not boundaries.
- [x] Classify the initial 49 root-level `packages/app/src/*.ts(x)` files as
      boundary, move, inline, generated, or delete.
- [x] Re-run app file inventory before each deletion wave:
      `rg --files packages/app/src`.
      Current run: `343` files; no remaining `*logic*` files outside
      `session-logic.ts` and `session-logic.test.ts`.
- [x] Classify the remaining `.logic.ts` file,
      `packages/app/src/app/toast.logic.ts`, as keep/inline/delete.
- [x] Inline `packages/app/src/app/toast.logic.ts` into `toast.tsx` and delete
      helper-only tests after toast behavior coverage is in place.
- [x] Inline and delete `packages/app/src/lib/branch-toolbar-logic.ts` and its
      helper-only test; branch behavior is covered by chat-view browser tests
      and shared Git branch helper behavior is covered in `@multi/shared`.
- [x] Classify app CSS files into token/global renderer/feature-delete buckets.
- [x] Add server/shared file inventory with canonical boundaries and duplicate
      observability target.
- [x] Add app state/store inventory covering `stores`, thread sync/state,
      sidebar projections, and timestamp helpers.
- [x] Consolidate duplicated server/shared observability trace files.
- [x] Reclassify app state one-consumer/overlap candidates:
  - [x] `stores/shell-layout-store.ts`
  - [x] `stores/thread-unread-store.ts`
  - [x] `stores/ui/model-picker-open-state.ts`
  - [x] `stores/chat-send-queue-dispatch.ts`
- [x] Reclassify one-consumer shared exports:
  - [x] `KeyedCoalescingWorker.ts`
  - [x] `String.ts`
  - [x] `subagents.ts`
  - [x] `tool-activity.ts`
- [ ] Delete helper tests only after moving retained behavior to a behavior
      suite.

## P5: Usability Tests

- [x] Add desktop sidebar browser coverage: project sections, active thread,
      badges, and new-thread action.
- [x] Add compact sidebar browser coverage: narrow manual collapse/expansion,
      right-workbench force-open behavior, titlebar toggle visibility, footer
      containment, and route preservation.
- [x] Add worktree sidebar browser coverage: worktree label/path rule and
      composer cwd.
  - [x] Selecting a worktree sidebar row routes project scripts to the worktree
        cwd/env.
  - [x] Selecting a worktree sidebar row routes composer path search to the
        worktree cwd.
  - [x] Worktree label/path rule.
- [x] Add sidebar usability spec mapping existing coverage and missing
      desktop/compact/worktree behavior tests.
- [x] Add composer single-line to multi-line transition browser coverage.
- [x] Add composer delete-back-to-single-line browser coverage.
- [x] Add inline edit click-to-focus latency and height parity coverage.
- [x] Add plan build-handoff browser coverage from the workbench action.
- [x] Add plan workbench active-tab route-search browser coverage.
- [x] Add terminal workbench activation coverage proving inactive workbench
      panels do not mount terminal-like side-effect bodies.
- [x] Stop accepting repeated browser-test warning noise as normal; fix or
      locally document each allowed warning.

### React Effect Inventory

- [x] Add a foundation spec for the no-direct-`useEffect` rule.
- [x] Count current production direct `useEffect` and `useLayoutEffect`
      callsites.
- [x] Classify direct `useEffect` callsites by replacement pattern before
  editing them.
- [x] Add a `useMountEffect` escape-hatch wrapper.
- [x] Implement `multi/no-direct-use-effect` in the existing oxlint plugin.
- [x] Enable the rule with warnings denied after the migration path is clean.
- [x] Move hardcoded route Escape handling through configurable keybindings.
- [x] Replace `shell-host.tsx` git-agent handoff cleanup effect with
      source-owned or derived state.

### Terminal Helper Inventory

Keep these as real boundaries:

- [x] `packages/server/src/terminal/*`: PTY adapters and manager service.
- [x] `packages/app/src/terminal-state-store.ts`: terminal UI state owner.
- [x] `packages/app/src/lib/terminal-context.ts`: prompt/display
      serialization boundary used across composer, messages, and send flow.
- [x] `packages/app/src/lib/terminal-links.ts`: shared link parsing/resolution.
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

## P6: Effect

- [x] Add server runtime/service cleanup spec with opencode facade-removal
      rules: [server-runtime.md](./server-runtime.md).
- [x] Inventory central runtime creation: `ManagedRuntime.make` appears only in
      `packages/server/src/server-runtime.ts`.
- [x] Inventory service contract files: `packages/server/src` has `62`
      `*.service.ts` files.
- [x] Inventory current defect boundaries: `Effect.die` appears in five server
      source locations.
- [x] Sweep service-local runtimes/facades and keep only real runtime bridges.
- [x] Prefer existing server services over raw process/filesystem APIs when
      touching effectful server code. Current cleanup did not add raw server
      process/filesystem paths outside existing service boundaries.
- [x] Keep app React/query boundaries plain unless there is a real durable
      Effect boundary. Current app cleanup uses Effect Schema decoders at
      persistence/contract boundaries without introducing an app Effect runtime.
- [x] Pick one route group and make expected error contracts explicit at the
      route/RPC boundary.
- [x] Classify the five `Effect.die` callsites before converting or keeping
      them.
- [x] Prevent new service-local runtime facades; use the central
      `ServerRuntime` boundary or route-hosted Effect runtime.

## Completion Gates

- [x] Run `pnpm fmt` after cleanup edits.
- [x] Run `pnpm run typecheck` as the default verifier.
- [x] Run focused tests for edited test-owned behavior.
- [x] Current pass: run `pnpm dev:desktop` and verify the backend reaches
      `Listening`, Electron reports `backend ready`, and the main window is
      created.
- [ ] Before this cleanup goal is finished, rerun `pnpm dev:desktop` after the
      final code changes. This remains unrun because project instructions say
      not to run dev commands unless explicitly asked.
