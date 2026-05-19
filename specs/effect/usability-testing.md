# Usability Testing Spec

Reliability includes layout and interaction behavior. For app UI cleanup,
browser tests should prove the user-facing surface still works after helper
files disappear.

## Target Testing Shape

Prefer tests at the behavior boundary:

- [x] Sidebar collapse/expand and section behavior across desktop and compact
      widths.
- [x] Composer single-line and multi-line transitions.
- [x] Composer action containment at compact widths.
- [x] Inline edit immediate focus and matching sent-message bubble geometry.
- [x] Model picker search, provider switching, and disabled/missing states.
- [x] Plan workbench rendering, actions, and build handoff.
- [x] Terminal workbench activation without hidden-panel side effects.
- [x] Git action error rendering with surfaced command details.

Use smaller unit tests only for pure, durable transforms:

- [x] Prompt segment parsing.
- [x] Terminal context serialization.
- [x] Model resolver output.
- [x] Route target resolution.
- [x] Timestamp formatting, if retained as a stable presentation policy.

## Sidebar Coverage

The sidebar is a product surface, not just a store.

- [x] Add a browser test for desktop width:
  - [x] project sections render
  - [x] active thread remains visible
  - [x] pending/plan badges do not overflow
  - [x] new-thread action remains reachable
- [x] Add a browser test for compact width:
  - [x] collapsed state preserves route at a narrow-but-expanded shell width
  - [x] expanding sidebar restores selectable rows at a narrow-but-expanded
        shell width
  - [x] opening the project panel below the auto-collapse thresholds forces the
        right workbench open while keeping the titlebar toggle visible
  - [x] footer/header actions stay inside the rail
- [x] Add a browser test for worktree threads:
  - [x] worktree path is displayed or hidden according to the shell rule
  - [x] selecting a worktree thread updates the composer path-search cwd
  - [x] selecting a worktree thread routes project scripts to the worktree cwd

Detailed sidebar plan: [sidebar-usability.md](./sidebar-usability.md).

## Composer Coverage

- [x] Browser coverage exists for composer footer containment.
- [x] Browser coverage exists for prompt text, mentions, undo, and surround
      behavior.
- [x] Add explicit single-line to multi-line mode transition coverage.
- [x] Add delete-back-to-single-line coverage.
- [x] Add inline edit click-to-focus latency coverage.
- [x] Add inline edit height comparison against the source message bubble.
- [x] Add compact model selector overflow coverage.

## Model Picker Coverage

- [x] Browser coverage exists for model-name, provider-name, and fuzzy
      multi-token search.
- [x] Browser coverage exists for sidebar provider switching and multiple
      provider instances.
- [x] Browser coverage exists for missing provider, missing model, disabled
      provider, and empty catalog resolver states.

## Plan Coverage

- [x] Browser coverage exists for native plan workbench rendering.
- [x] Browser coverage exists for plan actions menu and save-to-project path
      copy.
- [x] Add browser coverage for build-plan handoff from the workbench.
- [x] Add browser coverage for plan workbench active-tab behavior after route
      changes.
- [x] Add browser coverage for structured project-write error rendering once
      app error formatting exists.

Current evidence:

- [x] `plan-workbench-panel.browser.tsx` renders the project write message,
      structured detail, operation, project cwd, and relative path when saving a
      proposed plan fails.

## Workbench Coverage

- [x] Right-workbench inactive panels do not mount terminal-like bodies until
      their tab is active.

## Git Coverage

- [x] `panel.browser.tsx` renders a failed Git discard action through the toast
      renderer with the command detail, command string, project cwd, and
      operation.

## Pure Transform Coverage

- [x] `prompt-segments.test.ts` covers composer mention, skill, markdown-skill,
      terminal placeholder, and mention-boundary parsing.
- [x] `terminal-context.test.ts` covers terminal context label formatting,
      prompt serialization, extraction, display derivation, placeholder
      insertion/removal, expiry, and inline materialization.
- [x] `selection.test.ts` covers app model resolver output for requested
      provider/model selection, missing-provider fallback, and empty catalogs.
- [x] `thread-route-targets.test.ts` covers canonical server-thread and draft
      route target resolution.
- [x] `timestamp-format.test.ts` covers timestamp formatter options, relative
      expiry labels, expires-in labels, and elapsed duration labels.

## Delete-Or-Update Test Rule

When a helper is deleted or inlined:

- [ ] Delete tests that only assert helper internals.
- [ ] Move any real behavior assertion to the nearest browser/integration suite.
- [ ] Keep pure transform tests only when the transform remains a named public
      behavior.
- [ ] Do not keep a helper file solely to keep its test alive.

## Warning Budget

Browser tests should not pass with large expected warning streams.

- [x] Fix WebSocket RPC `Cause` serialization warnings.
- [x] Fail tests that emit unexpected console errors.
- [x] Allow specific warnings only with a local explanation and TODO.
- [x] Keep screenshots only for failures that need visual debugging.

## Verifier Rules

- [x] For UI layout changes, run the affected browser test.
- [ ] For route/store/model logic changes, run the nearest unit test and one
      behavior test that uses the result.
- [ ] For docs-only spec changes, `git diff --check` is enough unless generated
      docs are involved.
