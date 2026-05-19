# Sidebar Usability Spec

The sidebar is a product workflow surface. Cleanup of `thread-sidebar.ts`,
`sidebar-chat-view-model.ts`, `thread-unread-store.ts`, shell panel state, or
sidebar row components requires browser coverage at the user-facing boundary,
not only helper tests.

## Current Coverage

Existing browser coverage:

- [x] `packages/app/src/components/shell/agents/list.browser.tsx` verifies
      compact selected-row geometry and rename-mode row geometry.
- [x] `packages/app/src/components/shell/agents/list.browser.tsx` verifies
      project section rendering, active selected rows, new-thread action
      reachability, and draft-row selection.
- [x] `packages/app/src/components/chat/view/chat-view.browser.tsx` verifies
      archive from sidebar row context menu.
- [x] `packages/app/src/components/chat/view/chat-view.browser.tsx` verifies
      full thread title on the sidebar row.
- [x] `packages/app/src/components/chat/view/chat-view.browser.tsx` verifies
      command palette shortcut rendering and running from the sidebar trigger.
- [x] `packages/app/src/components/chat/view/chat-view.browser.tsx` verifies
      adding a project from the sidebar add button.
- [x] `packages/app/src/components/chat/view/chat-view.browser.tsx` verifies
      some worktree draft/thread flows, but not as sidebar layout behavior.
- [x] `packages/app/src/components/chat/view/chat-view.browser.tsx` verifies
      active worktree cwd is used for proposed-plan save-to-project actions.
- [x] `packages/app/src/components/chat/view/chat-view-sidebar-worktree.browser.tsx`
      verifies selecting a worktree thread from the sidebar, the short
      worktree path section label, row-level path/branch hiding, composer path
      search using the worktree cwd, project scripts running with the worktree
      cwd/env, worktree section new-thread draft env mode, and unread clearing
      from the visited boundary.
- [x] `packages/app/src/components/chat/view/chat-view-sidebar-worktree.browser.tsx`
      verifies Cursor-style quick archive row actions dispatch archive commands
      and batch the toast text from `Archived "{name}"` to
      `Archived {count} threads` with `Undo all`.
- [x] `packages/app/src/components/shell/agents/list.browser.tsx` verifies
      persisted project expansion across sidebar remounts and stable rendered
      project ordering as projects are added/removed.
- [x] `packages/app/src/components/shell/shell/app-shell.browser.tsx` verifies
      narrow left-rail collapse/expand state, restored sidebar content, URL
      preservation, and right-workbench force-open behavior below the
      auto-collapse thresholds while keeping the titlebar toggle visible.

Current test viewport facts:

- [x] Chat-view browser harness has `DEFAULT_VIEWPORT` at `960x1100`.
- [x] Chat-view browser harness has `WIDE_FOOTER_VIEWPORT` at `1400x1100`.
- [x] Chat-view browser harness has `COMPACT_FOOTER_VIEWPORT` at `430x932`.
- [x] Existing sidebar behavior tests mostly run at `DEFAULT_VIEWPORT`.

## Coverage Gaps

Desktop sidebar:

- [x] Project sections render with thread and draft rows.
- [x] Active thread remains visible and selected after route changes.
- [x] Pending approval, pending input, running, completed, unread, and plan-ready
      indicators fit inside the row.
- [x] New-thread action remains reachable for a project section.
- [x] Sidebar footer/header actions stay inside the rail.
- [x] Row context menu remains reachable without shifting row geometry.
- [x] Thread rows expose a trailing quick archive icon action without changing
      row selection semantics.

Compact sidebar:

- [x] The left rail can manually collapse and expand without changing the route
      at a narrow-but-expanded shell width.
- [x] Collapsed state hides row content from interaction and accessibility.
- [x] Expanding restores selectable rows and project sections.
- [x] Opening the project panel below the auto-collapse thresholds forces the
      right workbench to render while the compact shell chrome stays reachable.
- [x] Header/footer/actions do not overflow the composer or viewport.
- [x] Thread rows keep stable height, status slot, title slot, and time slot.

Worktree sidebar:

- [x] Worktree thread rows show or hide path/branch according to the shell rule.
- [x] Selecting a worktree thread updates project-script terminal cwd.
- [x] Selecting a worktree thread updates composer path-search cwd.
- [x] Creating a new thread from a worktree project preserves the intended
      draft env mode.
- [x] Active worktree path is used for plan save-to-project actions.

State behavior:

- [x] `ui-state-store` visited state owns the user-visible unread rule; the
      deleted `thread-unread-store` no longer competes with it.
- [x] Project expansion state persists across route changes/remounts.
- [x] Project ordering remains stable after projects are added/removed.
- [x] Prewarm IDs are limited to visible rows.

## Test Targets

Add focused browser tests before deleting sidebar helper files:

- [x] `desktop sidebar renders project sections and active thread`
  - viewport: `DEFAULT_VIEWPORT`
  - asserts project section labels, active row, visible row status/time slots,
    and new-thread affordance.
- [x] `compact sidebar collapse preserves route and containment`
  - viewport: narrow-but-expanded shell width.
  - toggles sidebar closed/open and asserts URL unchanged, rows restored, and
    collapsed rails have no visible width beyond their border.
- [x] `project panel force-opens below auto-collapse width`
  - viewport: `COMPACT_FOOTER_VIEWPORT`
  - starts with auto-collapsed left/right rails, opens the project panel, and
    asserts the right workbench renders and the titlebar toggle remains inside
    the compact shell bounds.
- [x] `sidebar worktree thread updates composer cwd`
  - viewport: `DEFAULT_VIEWPORT`
  - selects worktree row and asserts composer path-search cwd uses the
    worktree path.
- [x] `sidebar worktree thread routes project scripts to worktree cwd`
  - viewport: `DEFAULT_VIEWPORT`
  - selects worktree row and asserts project script terminal open uses the
    worktree cwd and `MULTI_WORKTREE_PATH`.
- [x] `sidebar indicators fit in narrow rows`
  - viewport: constrained `172px` rendered AgentList width, matching a narrow
    expanded rail.
  - asserts running, attention/pending/plan, unread, completed, and error
    status slots do not overlap title/time slots.
- [x] `worktree sidebar section creates a worktree draft`
  - viewport: `DEFAULT_VIEWPORT`
  - selects a worktree row, clicks the worktree section new-agent affordance,
    and asserts the draft session keeps worktree env mode, branch, project id,
    and worktree path.
- [x] `sidebar unread state follows visit boundaries`
  - viewport: `DEFAULT_VIEWPORT`
  - seeds a stale visit boundary, asserts the worktree row renders unseen, then
    selects it and asserts the row renders seen.
- [x] `project expansion and order persist as sidebar behavior`
  - rendered AgentList remount verifies persisted collapsed state.
  - rendered AgentList rerenders verify project section order across add/remove
    changes.
- [x] `sidebar quick archive batches toast text`
  - viewport: `DEFAULT_VIEWPORT`
  - clicks two row archive icons, asserts both archive commands are dispatched,
    and asserts the toast changes from named single archive text to plural
    `Archived {count} threads` text with `Undo all`.
  - clicks `Undo all`, asserts one unarchive command per archived row, and
    asserts the archive toast is dismissed.

## Deletion Gates

Before moving or deleting these files:

- [x] `packages/app/src/lib/thread-sidebar.ts`
- [x] `packages/app/src/components/shell/agents/sidebar-chat-view-model.ts`
- [x] `packages/app/src/lib/thread-sort.ts`
- [x] `packages/app/src/stores/thread-unread-store.ts`
- [ ] `packages/app/src/stores/ui-state-store.ts`
- [ ] `packages/app/src/components/shell/agents/list.tsx`
- [ ] `packages/app/src/components/shell/agents/row.tsx`
- [ ] `packages/app/src/components/shell/sidebar/thread-rail.tsx`

Required evidence:

- [x] At least one desktop sidebar browser test covers the behavior.
- [x] At least one compact sidebar browser test covers the behavior.
- [x] If a helper unit test is deleted, its retained behavior is represented in
      the browser suite or explicitly removed from product scope.
  - [x] `getSidebarThreadIdsToPrewarm` helper assertions moved to
        `components/shell/agents/list.browser.tsx`, which verifies visible-row
        retention from the rendered sidebar.
  - [x] `resolveSidebarNewThreadEnvMode` helper assertions removed with the
        pass-through wrapper; no production caller used the explicit override
        branch.
  - [x] `resolveSidebarNewThreadSeedContext` assertions moved to
        `chat-thread-actions.test.ts`, the production boundary that starts
        project-scoped new threads.
  - [x] Sidebar selection/traversal/row-class/project-status/folded-thread/
        project-sort/jump-hint helper assertions were removed with their
        no-production exports.
  - [x] Final production behavior moved to owning modules:
        `shell-host.tsx`, `use-handle-new-thread.ts`, and
        `use-thread-actions.ts`.
  - [x] `thread-unread-store.ts` was deleted after sidebar unread behavior moved
        to `ui-state-store` visit boundaries and browser coverage verified the
        row state transition.
  - [x] `thread-sort.ts` is retained as the shared sidebar/command-palette
        ordering boundary; timestamp helpers are private implementation details.
- [x] `pnpm run typecheck` passes for code changes.

## Done Means

- [x] Sidebar behavior is verified at desktop and compact widths.
- [x] Sidebar cleanup no longer relies on helper-only tests as the main safety
      net.
- [x] Project, thread, draft, unread, pending, plan, and worktree states are
      visible in behavior tests.
- [x] Route preservation is verified when collapsing/expanding the sidebar.
