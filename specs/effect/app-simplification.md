# App Simplification Spec

This spec turns the `pi` and opencode cleanup references into Multi app rules.
It is intentionally concrete: each retained file needs an ownership reason, and
each deletion needs a verifier that covers the behavior being kept.

## Reference Inputs

- [x] `codebase path earendil-pi` resolves to
      `/Users/workgyver/.agents/codebases/earendil-pi`.
- [x] `codebase path anomalyco-opencode` resolves to
      `/Users/workgyver/.agents/codebases/anomalyco-opencode`.
- [x] The requested opencode commit
      `f98449c9b5ef95444911e26206abb3d6479e6883` was fetched locally and its
      `packages/opencode/specs/effect/*` files were read.
- [x] `pi` was sampled from commit
      `b256ac7d7733b56e11d4c691378705c929978f15`.

## Current App Inventory

Snapshot from `rg --files packages/app/src`:

- [x] `331` app `ts` / `tsx` files.
- [x] `17` root-level app `ts` / `tsx` files.
- [x] `90` `*.test.*` / `*.browser.*` files.
- [x] `10` CSS files under `packages/app/src`.
- [x] `0` remaining `*.logic.ts` files under `packages/app/src/app`.
- [x] `0` `*logic*` files outside `session-logic.ts` /
      `session-logic.test.ts`.

This is a planning inventory, not a completion proof. Re-run the inventory
before starting a deletion wave.

Detailed inventories:

- [x] Root app files: [app-root-files.md](./app-root-files.md).
- [x] App state files: [app-state-files.md](./app-state-files.md).
- [x] App route files: [app-route-files.md](./app-route-files.md).
- [x] App toast files: [app-toast-files.md](./app-toast-files.md).
- [x] App CSS files: [app-css-files.md](./app-css-files.md).

## Target Shape

The app should be boring at the center:

- [x] Route files select route params/search and render route views only.
- [ ] Shell files own shell layout, panels, and shell-local persistence only.
- [x] Composer files own prompt editing, attachments, slash menu, send
      preparation, and inline edit geometry only.
- [x] Model files own provider/model selection policy only.
- [ ] Store files persist facts; derived view models live near the UI that uses
      them unless multiple surfaces consume the same projection.
- [x] `lib/*` files are kept only for cross-surface boundaries, not as a dumping
      ground for one-off helpers.
- [ ] Tests cover user behavior at the boundary that matters, not private helper
      implementation details that exist only because the helper was split out.

## Keep / Inline / Delete Rules

Keep a file when at least one is true:

- [ ] It owns a runtime boundary: WebSocket RPC, local storage, terminal host,
      xterm lifecycle, shell panel persistence, environment API, route contract, or
      generated route tree.
- [ ] It is imported by multiple production surfaces and has a stable domain
      name that explains why it changes.
- [ ] It has a test that would be weaker or less readable if moved to a broader
      integration suite.
- [ ] It isolates a third-party or platform edge: browser storage, Electron,
      xterm, Git, file dialogs, RPC, React Query, TanStack Router.

Inline a file when all are true:

- [ ] It has one production caller.
- [ ] Its name describes implementation mechanics rather than a domain boundary.
- [ ] Its test duplicates the helper implementation instead of proving a user
      behavior.
- [ ] Inlining does not make the caller exceed a readable phase structure.

Delete a file when any is true:

- [ ] It exports behavior with no production callers.
- [ ] It exists only to preserve compatibility with a deleted product surface.
- [ ] It mirrors a contract type or schema that already has a source of truth.
- [ ] It wraps a native/library function without adding domain semantics.
- [ ] Its only test asserts that the wrapper calls another wrapper.

## Done Means For A Deletion Wave

- [x] Caller inventory was captured with `rg` or `knip`, not guessed.
- [x] Each file was classified as keep, inline, or delete with a written reason.
- [x] Deleted behavior is covered by a higher-level behavior test, or the spec
      states why the behavior is intentionally gone.
- [x] `pnpm run typecheck` passes.
- [x] Strict oxlint passes with warnings denied.
- [x] Any modified tests were run from the relevant package root.
- [x] `specs/effect/todo.md` is updated with checkbox status.

Current deletion-wave evidence:

- [x] Model/provider caller inventory was captured with targeted `rg`; the same
      production knip run filtered to `packages/app/src` reports no app source
      unused exports. Repo-wide `knip:production` remains noisy on package
      entry/dependency reports and is still tracked in `todo.md`.
- [x] No tests were modified in the latest model/provider export cleanup slice.
- [x] Shared one-consumer helper cleanup moved retained behavior to owning
      boundaries: terminal keyed worker coverage moved to
      `packages/server/test/terminal/KeyedCoalescingWorker.test.ts`, and thread
      title trimming/truncation is asserted by the chat view first-send browser
      test. Both modified tests were run from their package roots.

## First App Cleanup Waves

### Wave A: Root App Files

- [x] Classify every root `packages/app/src/*.ts(x)` file as boundary,
      candidate inline, candidate move, generated, or delete.
- [x] Collapse root one-off helpers into existing directories:
  - [x] `diff-route-search.ts`
  - [x] `pending-user-input.ts`
  - [x] `project-scripts.test.ts` behavior owner
  - [x] `proposed-plan.ts`
  - [x] `thread-routes.ts`
  - [x] `worktree-cleanup.ts`
- [x] Keep generated and entry files explicit:
  - [x] `routeTree.gen.ts`
  - [x] `router.ts`
  - [x] `main.tsx`
  - [x] `vite-env.d.ts`

Detailed inventory: [app-root-files.md](./app-root-files.md).

### Wave B: `lib/*`

- [x] Move model/provider helpers out of `lib` and into `model` or delete them.
      Current `lib` hits are `provider-react-query.ts` checkpoint diff query
      adapters and `ui-session-types.ts` harness/view types, not provider/model
      selection policy.
- [x] Keep `lib/project-scripts.ts` as the app project-script command/id and
      keybinding decode boundary. Component-only presentation helpers for the
      primary script and edit-dialog keybinding value live in
      `components/project-scripts-control.tsx`.
- [x] Inline single-caller settings provider display helpers instead of keeping
      exported component-adjacent helper files. Current example:
      `components/settings/provider-status.ts` moved into
      `components/settings/provider-instance-card.tsx`.
- [x] Collapse duplicate provider metadata exports in
      `components/settings/provider-driver-meta.ts`; keep one public settings
      metadata contract instead of legacy alias names plus exported lookup maps.
- [x] Delete single-caller composer provider-registry helper and helper-only
      test after inlining the guard into `components/chat/composer/input.tsx`.
- [x] Delete single-caller composer model-state hook after inlining the bridge
      into `components/chat/composer/input.tsx`; shared model/provider policy
      stays in `model/selection.ts` and `model/provider-state.ts`.
- [x] Make single-caller provider-instance/model exports private after caller
      inventory; app surfaces consume the normalized resolver or local composer
      display helper instead.
- [x] Delete stale picker provider-option export after caller inventory; picker
      provider choices now come from normalized provider instance entries.
- [x] Collapse unimported picker/provider type exports to private declarations;
      public component exports no longer expose helper-only prop or descriptor
      aliases.
- [x] Remove unowned `ui-slash-menu__*`, `mentions-menu__content`, and
      `ui-menu__*` class hooks after confirming there are no CSS/test consumers;
      existing data attributes and utility classes carry the slash/workbench menu
      behavior and styling.
- [x] Move the one-caller shell Git file icon helper out of `lib` and into
      `components/shell/git`; Git diff card owns that renderer-specific icon
      fallback.
- [x] Delete obsolete `lib/turn-diff-tree.ts` and its helper-only unit test.
      Changed-files rendering now uses the tree component path model, and the
      only production stat summary is private to `assistant-message.tsx`.
- [x] Move the one-caller markdown highlight LRU cache from `lib` into
      `components/chat/markdown` with its focused unit test.
- [x] Keep `lib/desktop-chrome.ts` as the browser/Electron shell chrome metrics
      boundary. Its single production caller is startup boot, and the shell CSS
      contract test reads it to keep chrome CSS variables aligned.
- [x] Remove the one-caller provider-trait scope export; composer-local slot
      gating now reads normalized provider-state flags directly.
- [x] Inline the single-caller provider status banner into `chat-view.tsx` so
      picker files only own picker UI.
- [x] Keep `lib/thread-sort.ts` as a shared sidebar/command-palette ordering
      contract and `lib/timestamp-format.ts` as a shared app display formatter.
- [x] Delete `lib/branch-toolbar-logic.ts` and its helper-only test after
      draft-only branch toolbar behavior moved into `chat-view.browser.tsx` and
      shared Git branch dedupe coverage moved to `packages/shared/test/lib/git.test.ts`.
- [x] Keep terminal helpers only when they are shared by composer, messages, and
      terminal surfaces. Current retained `lib` boundaries are
      `terminal-context.ts`, `terminal-links.ts`, `terminal-dimensions.ts`, and
      `terminal-focus.ts`; single-caller terminal helper files were already
      inlined or deleted in the terminal helper inventory.
- [x] Re-evaluate `sidebar-chat-view-model.ts` after sidebar behavior coverage;
      moved the section projection under `components/shell/agents`.
      `thread-sort.ts` and `timestamp-format.ts` are retained shared
      projections.
- [ ] Delete tests whose only reason to exist is a helper split; replace with
      route/shell/composer behavior coverage where needed.

Detailed state inventory: [app-state-files.md](./app-state-files.md).

### Wave C: CSS

- [x] Classify app CSS files into token/global renderer/feature-delete buckets.
- [x] Keep token and external renderer CSS:
  - [x] `index.css`
  - [x] `styles/tokens.css`
  - [x] `styles/terminal.css`
- [x] Re-evaluate feature CSS files for Tailwind/component ownership:
  - [x] `styles/app.css`
  - [x] `styles/conversation.css`
  - [x] `styles/git-diff.css`
  - [x] `styles/markdown.css`
  - [x] `styles/settings.css`
  - [x] `styles/shell.css`
  - [x] `styles/tool-call.css`
- [x] No new feature CSS file without a renderer or global token reason.

Detailed inventory: [app-css-files.md](./app-css-files.md).

### Wave D: React Effects

- [x] Inventory direct `useEffect` callsite counts in app components.
- [x] Classify each as derived state, event action, data fetching, reset,
      external sync, subscription, observer, or DOM integration.
- [x] Replace derived state and reset effects with inline computation or keyed
      boundaries.
- [x] Keep terminal/xterm/subscription/observer effects with an explicit owner.

Detailed rules: [react.md](./react.md).

### Wave E: Test Shape

- [ ] Prefer browser/integration tests for sidebar, shell, composer, model
      picker, and plan interactions.
- [ ] Keep unit tests for pure domain transforms with stable inputs/outputs.
- [ ] Delete tests for helpers that are inlined or no longer public boundaries.
- [ ] Add multi-viewport sidebar coverage before deleting sidebar helper tests.

Detailed sidebar coverage: [sidebar-usability.md](./sidebar-usability.md).

## Anti-Patterns

- [x] Do not add `.logic.ts` as a way to make component tests easier.
- [ ] Do not keep a file only because it has a test.
- [x] Do not add root-level app files for one-off helpers.
- [ ] Do not add dynamic imports or type-position imports for local code.
- [x] Do not add generic schema bridges, generic route search helpers, or generic
      model fallback helpers.
- [ ] Do not preserve deleted product behavior for compatibility unless the
      requirement is explicit.

Remaining `.logic.ts` classification:

- [x] `packages/app/src/app/toast.logic.ts` was inlined into `toast.tsx` and
      deleted. See [app-toast-files.md](./app-toast-files.md).
