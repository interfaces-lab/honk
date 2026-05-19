# App State File Inventory

This inventory covers app state owners, store files, and state-derived helper
files. It answers the current `store.ts` vs `stores/` question from the actual
worktree: there is no `packages/app/src/store.ts` now; app state lives under
`packages/app/src/stores`, with shared thread sorting under `lib` and
sidebar-owned section projection under `components/shell/agents`.

Inventory commands:

```bash
rg --files packages/app/src | rg '(^|/)store\.ts$|stores/|thread-(sync|state|sort)|timestamp-format|sidebar-chat-view-model'
wc -l packages/app/src/stores/*.ts packages/app/src/lib/thread-sort.ts packages/app/src/lib/timestamp-format.ts packages/app/src/components/shell/agents/sidebar-chat-view-model.ts
```

Current facts:

- [x] `packages/app/src/store.ts` does not exist.
- [x] `packages/app/src/stores` has `14` tracked `ts` files plus `2` UI
      subdirectory files.
- [x] `packages/app/src/stores/chat-drafts.ts` is the largest app store file at
      `2540` lines.
- [x] `packages/app/src/stores/thread-sync.ts` is the largest server-state
      mapper file at `1610` lines.
- [x] `packages/app/src/lib/thread-sidebar.ts` is deleted; its retained
      production behavior now lives at the owning callsites.
- [x] `packages/app/src/components/shell/agents/sidebar-chat-view-model.ts`
      has its own sidebar section/view model pipeline.

## Canonical State Owners

Keep these as state boundaries unless the owning product surface changes.

- [x] `packages/app/src/stores/thread-store.ts`: in-memory normalized
      environment/thread/project read model and selectors.
- [x] `packages/app/src/stores/thread-sync.ts`: server orchestration/shell event
      to app read-model mapper and reducer.
  - archive/unarchive events update `archivedAt` without treating the restore
    action as new thread activity; `updatedAt` stays tied to message/activity
    ordering.
- [x] `packages/app/src/stores/chat-drafts.ts`: persisted composer draft and
      pre-thread draft-session state.
- [x] `packages/app/src/stores/chat-send-queue.ts`: queued composer send/edit
      state and preview URL cleanup.
- [x] `packages/app/src/stores/shell-panels-store.ts`: persisted shell left
      rail, right workbench, secondary rail, and terminal session layout state.
- [x] `packages/app/src/stores/ui-state-store.ts`: persisted sidebar UI state,
      project order/expansion, thread visited state, and changed-files expansion.
- [x] `packages/app/src/stores/appearance-store.ts`: app store adapter for
      appearance settings.
- [x] `packages/app/src/stores/thread-selection-store.ts`: sidebar/thread
      multi-selection state.

Rules:

- [ ] Store files persist facts or own mutable UI state; they do not render UI.
- [ ] Server read-model mapping stays in `thread-sync.ts` or a replacement
      mapper boundary, not in route/view components.
- [ ] Derived sidebar, composer, model, and plan views should be functions near
      their owning UI surface unless they are consumed by multiple surfaces.
- [x] Persisted local-storage shapes need schema-backed validation before new
      fields are added.

## Canonical But Too Large

These files are real boundaries but should be changed carefully and with
behavior coverage. Do not delete them as helper cleanup.

- [x] `chat-drafts.ts`: owns two domains, composer content and draft-thread
      session metadata. It should eventually expose a smaller public surface, but
      it is the canonical persistence boundary today.
- [x] `thread-sync.ts`: owns event/read-model mapping, retention limits,
      projection updates, proposed-plan mapping, model slug normalization, and
      shell/thread detail updates. It is too large, but the replacement is a
      mapper/reducer boundary, not component-local state.
- [x] `shell-panels-store.ts`: owns shell layout and workbench panel
      persistence. It should not be split until shell/workbench behavior tests
      cover panel route sync and terminal session persistence.
- [x] `ui-state-store.ts`: owns sidebar UI persistence and visit/unread
      semantics. Keep until sidebar multi-viewport behavior tests cover the same
      workflow.

## Move Or Inline Candidates

Classify before code changes.

- [x] `packages/app/src/stores/shell-layout-store.ts`: deleted after caller
      inventory showed no production writers, so Git focus paths were always
      empty.
- [x] `packages/app/src/stores/chat-send-queue-dispatch.ts`: retained as an
      environment runtime boundary; it drains queued composer items after thread
      projection/session changes and dispatches through the environment API.
- [x] `packages/app/src/stores/thread-unread-store.ts`: deleted after sidebar
      unread action state moved into `ui-state-store` visit boundaries. Browser
      coverage now verifies unread display and selection clearing at the
      rendered sidebar boundary.
- [x] `packages/app/src/stores/ui/model-picker-open-state.ts`: deleted because
      the only production caller wrote to it and no surface read it.
- [x] `packages/app/src/stores/ui/command-palette-store.ts`: command palette
      owner. Keep if the command palette remains global; otherwise colocate with
      command palette component.

## Projection Helper Files

These are not stores, but they define app state views.

- [x] `packages/app/src/lib/thread-sidebar.ts`: deleted after preferred project
      ordering moved into `use-handle-new-thread.ts`, thread attention logic
      moved into `shell-host.tsx`, and delete fallback selection moved into
      `use-thread-actions.ts`.
- [x] `packages/app/src/components/shell/agents/sidebar-chat-view-model.ts`:
      builds sidebar section models from thread/draft summaries with path
      labels, relative time, state, grouping, and active section metadata.
- [x] `packages/app/src/lib/thread-sort.ts`: shared thread/project ordering
      primitive used by sidebar and command palette surfaces.
- [x] `packages/app/src/lib/timestamp-format.ts`: app display formatter for
      configured clock format, relative time, elapsed duration, and expiry labels.

Target:

- [x] Move sidebar-only projections under the sidebar/shell agents ownership.
- [x] Merge duplicate relative-time behavior from `sidebar-chat-view-model.ts`
      with `timestamp-format.ts` or keep one private to the sidebar model.
- [x] Keep `thread-sort.ts` only if command palette and sidebar both need the
      same ordering contract; otherwise move it under sidebar ownership.
- [x] Keep `timestamp-format.ts` as an app display formatting boundary while it
      has multiple UI consumers.
- [x] Do not keep helper tests only because the helper files exist; replace
      helper coverage with sidebar and command-palette behavior tests where
      practical.

## Root State Boundaries

These root files are state-related and should move only with a narrow plan:

- [x] `packages/app/src/thread-derivation.ts`: materializes full `Thread` views
      from normalized environment state.
- [x] `packages/app/src/session-logic.ts`: derives timeline, worklog, proposed
      plan, pending, and status views.
- [x] `packages/app/src/terminal-state-store.ts`: terminal UI state owner.

Rules:

- [ ] Do not split `session-logic.ts` until behavior slices are named and
      covered.
- [ ] Keep `thread-derivation.ts` close to `thread-store` / `thread-sync`
      unless the normalized read model is redesigned.
- [ ] Keep `terminal-state-store.ts` separate from shell panel layout state;
      terminal session UI and terminal process state are different domains.

## First State Cleanup Candidates

- [x] Reclassify `shell-layout-store.ts` after reading
      `hooks/use-environment-git.ts`.
- [x] Reclassify `thread-unread-store.ts` against `ui-state-store` visited and
      unread behavior.
- [x] Delete `thread-unread-store.ts` after `ui-state-store` became the single
      user-visible unread boundary for sidebar rows.
- [x] Move `model-picker-open-state.ts` next to the model picker or replace it
      with local/open prop state.
- [x] Move sidebar-only helpers out of `lib/thread-sidebar.ts` after adding
      sidebar behavior coverage.
  - [x] Inline visible-thread prewarm limiting into
        `components/shell/agents/list.tsx`; browser coverage now verifies the
        first ten expanded visible rows are retained.
  - [x] Delete the unused `resolveSidebarNewThreadEnvMode` pass-through after
        caller inventory showed production only passed the default mode through.
  - [x] Move project new-thread seed-context logic into
        `lib/chat-thread-actions.ts`; its behavior assertions now live in
        `chat-thread-actions.test.ts`.
  - [x] Delete no-production sidebar selection, traversal, row-class,
        project-status, folded-thread, project-sort, and jump-hint exports
        after caller inventory showed only helper-test consumers.
  - [x] Delete `lib/thread-sidebar.ts` after moving the final three production
        consumers to their owning modules.
- [x] Replace sidebar helper tests with browser coverage for desktop, compact,
      worktree, and multi-viewport sidebar behavior.

Detailed sidebar coverage gates:
[sidebar-usability.md](./sidebar-usability.md).

## Done Means

- [x] New persisted app state has schema-backed decode/normalize logic.
- [ ] New UI-only state is colocated with the owning component unless multiple
      surfaces need it.
- [ ] Store names describe the domain they own, not generic implementation
      mechanics.
- [x] Deleted helper behavior is covered by route/shell/sidebar/composer
      behavior tests, or the spec states that behavior is intentionally gone.
- [x] `pnpm run typecheck` passes for code changes.
