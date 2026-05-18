# Multi App Slimming Spec

This is the execution inventory for the cleanup. The target architecture and
durable rules live in
[`multi-app-foundation-spec.md`](./multi-app-foundation-spec.md).

## References

- `pi`: `/Users/workgyver/.agents/codebases/earendil-pi`
- `opencode` current codebase-cli checkout:
  `/Users/workgyver/.agents/codebases/anomalyco-opencode`
- Multi durable specs:
  `specs/effect/guide.md`, `specs/effect/todo.md`,
  `specs/effect/errors.md`, `specs/effect/schema.md`, and
  `specs/effect/routes.md`
- Requested opencode effect spec tree:
  `packages/opencode/specs/effect` at
  `f98449c9b5ef95444911e26206abb3d6479e6883`

The updated local opencode checkout has the same effect spec folder, including
`migration.md`, `facades.md`, `guide.md`, `errors.md`, `routes.md`, `schema.md`,
`tools.md`, and `todo.md`. The codebase-cli checkout is shallow and does not
contain the pinned historical commit object, so the pinned tree was verified
through GitHub raw/content lookup while the local checkout is used for reading.

## Execution Ledger

- [x] Register and update the `earendil-pi` codebase-cli checkout.
- [x] Register and update the opencode codebase-cli checkout.
- [x] Locate the requested opencode effect specs and record the exact local and
  pinned-source paths.
- [x] Record the app-wide `packages/app/src` size and complexity inventory.
- [x] Record the first-pass strip ledger by cleanup wave.
- [x] Confirm the cleanup is for unreleased code and should be canonical, with
  no compatibility patch layer.
- [x] Confirm remote/saved environment product support is not part of the target
  product.
- [x] Confirm browser-function/debug product support is not part of the target
  product.
- [x] Create `docs/multi-app-foundation-spec.md` as the foundation spec for
  runtime, models, routes, errors, schema, UI, tests, Effect boundaries, and
  deletion discipline.
- [x] Create a root `specs/effect` tree modeled after opencode's spec family so
  future agents have boundary-specific rules for errors, schemas, routes,
  runtime shape, and the cleanup queue.
- [x] Remove remote/saved environment app runtime, route, settings, persistence,
  IPC, desktop, and contract surfaces.
- [x] Reduce the environment runtime to one primary environment connection path.
- [x] Remove browser/debug tracing product surface from the app.
- [ ] Consolidate provider/model resolution around one core resolver.
- [x] Retain a native plan mode side panel, implemented with plain React and a
  primary Implement action.
- [x] Rewrite the composer shell as one canonical component file with inline
  Tailwind layout and minimal shared CSS tokens.
- [ ] Collapse deleted or behavior-free route wrappers.
- [ ] Add only the verification coverage that remains valuable after the code is
  deleted or rewired.
- [x] Run `pnpm run typecheck` after code changes and record the result.
- [x] Move provider/model root files into `packages/app/src/model/*`.
- [x] Move provider-state derivation out of composer UI ownership.
- [x] Move markdown link parsing beside `chat-markdown`.
- [x] Move/collapse thread store root files under `packages/app/src/stores/*`.
- [x] Move timestamp formatting from the root into `packages/app/src/lib`.
- [x] Inventory terminal-prefixed files before deleting or inlining helpers.

This ledger is the source of truth for status. Items are either checked or
unchecked; the document does not use a third state.

## What Opencode Teaches

Opencode's effect cleanup is inventory-driven:

- count runtime/facade call sites first
- name explicit excluded call sites
- remove one facade boundary at a time
- move callers to one contiguous runtime boundary
- convert tests away from facade helpers only when that service is in scope
- define done with grepable evidence, not by passing a broad suite

The relevant rule for `multi-app` is not "add more Effect". It is "collapse
unnecessary app-local indirection and delete stale product surface with a clear
caller inventory."

## What Pi Teaches

`pi` keeps the core surfaces more direct:

- model resolution lives in one core resolver/registry path
- browser/web UI files are mostly component-directed instead of route/runtime
  orchestration-directed
- integration tests sit next to package behavior, not as large collections of
  extracted helper tests
- extension/provider capability is built on top of a narrower core instead of
  leaking provider details through the whole UI

The relevant rule for `multi-app` is to define the smallest local app core,
then build UI primitives/selectors from that core.

## Current Multi App Shape

Measured from `packages/app/src`:

- 393 TypeScript/TSX files excluding screenshot artifacts
- about 96k lines
- about 7,397 function-like nodes
- about 1,273 exported declarations/statements

Largest cleanup hotspots:

- `components/chat/view`: about 10.9k lines, 807 function-like nodes
- `lib`: about 8.9k lines, 769 function-like nodes
- `components/chat/composer`: about 7.3k lines
- `components/settings`: about 6.4k lines
- `components/chat/picker`: about 3.4k lines
- `rpc`: about 3.2k lines
- `environments/runtime`: about 2.9k lines
- `stores/chat-drafts.ts` before cleanup: 2,696 lines
- `session-logic.ts`: 2,468 lines
- `thread-sync.ts`: 1,611 lines

This is the first deletion target: not random files, but wide surfaces that
exist because features were generalized beyond the current product.

First-pass strip ledger:

| Wave | Lines in measured target files | Function-like nodes | Exported declarations/statements | Nature of reduction |
| --- | ---: | ---: | ---: | --- |
| Remote/saved environments | 4,389 | 360 | 75 | Mostly delete, with primary connection retained |
| Provider/model selector | 2,520 | 213 | 54 | Collapse duplicate resolver/UI paths into one core |
| Plan side-panel dedicated files | 398 | 14 | 4 | Keep native side panel, reduce to plain React current behavior |
| Browser tracing/debug | 749 | 54 | 17 | Mostly delete app browser debug; server HTTP file is partial |
| Route split | 1,040 | 89 | 24 | Delete removed routes and collapse thin wrappers |

This covers 9,096 measured lines and 730 function-like nodes before counting
the provider/model slice embedded in the draft store, the plan slice
embedded in `ShellHost`, and server auth/pairing code that may become
unnecessary after the remote decision. The realistic first milestone is not to
delete all 9k lines in one pass; it is to remove the remote surface and
browser-debug surface cleanly, then consolidate provider/model resolution.

## Delete Or Collapse Targets

### 1. Remote/Saved Environment Surface

User stated: "We don't need remote connection."

Candidate files and surfaces:

- `packages/app/src/environments/remote/api.ts`
- `packages/app/src/environments/remote/target.ts`
- saved environment registry/runtime parts of
  `packages/app/src/environments/runtime/catalog.ts`
- saved environment connection paths in
  `packages/app/src/environments/runtime/service.ts`
- `/pair` route and `PairingRouteSurface`
- saved environment persistence in `LocalApi`
- saved environment IPC bridge and desktop service
- server pairing/auth routes if desktop-only local auth remains enough
- "Connections" settings page sections for pairing and saved backends

Expected app simplification:

- one primary environment connection
- no saved backend registry
- no remote bearer bootstrap
- no remote websocket token issue flow in the app
- no pair route in the app router
- no saved-environment secrets in browser/desktop persistence

Do not delete blindly:

- desktop local bootstrap may still use auth/bootstrap concepts
- server auth may still protect local desktop/browser sessions
- release/package boundaries may still expose contract types

### 2. Browser/Observability Debug Surface

User stated: "We don't have a browser function."

Scope clarification:

- [x] "Browser function" means browser debug/tracing product surface.
- [x] It does not mean the Vite/TanStack React renderer.
- [x] It does not mean the server web/static/dev host.
- [x] It does not mean the Electron-hosted renderer window.
- [x] It does not mean the WebSocket RPC core.

Candidate surfaces:

- [x] `packages/app/src/observability/browserDebug.ts`
- [x] `packages/app/src/observability/clientTracing.ts`
- [x] app calls to `traceBrowserEvent`
- [x] server `BrowserTraceCollector` route if only used by app browser debug
- [x] `Agentation` dev overlay in `main.tsx`

Expected app simplification:

- [x] normal console/error handling only in app
- [x] server tracing remains server-side if still useful
- [x] no app-level browser trace collector API

### 3. Native Plan Mode Side Panel

User stated:

- "task and plan panel can be fully plain react."
- "the kept behavior should be a native plan mode integrated side panel, with a
  proper implement button"
- "instead of a 'open plan' and in chat plan card, side panel should be the
  actual first citizen"

Candidate surfaces:

- `PlanWorkbenchPanel`
- `useThreadPlanCatalog` (deleted)
- plan/workbench tab assembly in `ShellHost`
- plan-specific side-panel actions: copy/download/save/implement menu
- composer "Open Plan" controls
- chat plan card primary controls

Expected app simplification:

- keep Plan as a native shell side panel
- render active/proposed plan state in that side panel as the first-class
  surface
- put the proper Implement button in the side panel
- keep plan mode in the composer, but remove "Open Plan" as a separate control
- remove or demote chat plan card primary actions
- reduce catalog/workbench indirection unless it has current side-panel callers

### 4. Provider/Model Selector Core

User stated provider/model selector is too complicated and should have a good
core like `pi`.

Candidate surfaces:

- [ ] `model-selection.ts`
- [ ] `provider-instances.ts`
- [ ] `provider-models.ts`
- [x] `lib/runtime-models.ts`
- [ ] `components/chat/picker/*`
- [x] `components/shell/pickers/*`
- [x] `routes/model-picker-variants.tsx`
- [x] `components/model-picker-variants/model-picker-variants-page.tsx`
- [x] model-selection parts of `composer-draft-store.ts`

Expected app simplification:

- [ ] one core resolver for provider instance, model, and options
- [ ] one UI selector consumes the core result
- [x] no duplicate runtime-model resolver path
- [ ] draft store keeps only selected model state, not provider registry logic

### 5. Terminal Helpers

Terminal is a real product boundary: server PTY adapters, terminal manager,
thread terminal state, xterm host sync, prompt terminal-context serialization,
terminal links, focus handling, dimensions, and terminal CSS are not deletion
targets just because their filenames start with `terminal`.

Keep boundaries:

- [x] `packages/server/src/terminal/*`
- [x] `packages/app/src/terminal-state-store.ts`
- [x] `packages/app/src/lib/terminal-context.ts`
- [x] `packages/app/src/terminal-links.ts`
- [x] `packages/app/src/lib/terminal-dimensions.ts`
- [x] `packages/app/src/lib/terminal-focus.ts`
- [x] `packages/app/src/components/thread-terminal-drawer.tsx`
- [x] `packages/app/src/components/chat/view/persistent-thread-terminal-drawer.tsx`
- [x] `packages/app/src/components/shell/terminal/panel.tsx`
- [x] `packages/app/src/components/shell/terminal/terminal-host-theme.ts`
- [x] `packages/app/src/components/shell/terminal/terminal-xterm-host-sync.ts`
- [x] `packages/app/src/components/chat/message/terminal-context-chip.tsx`
- [x] `packages/app/src/styles/terminal.css`

Collapse candidates:

- [x] `components/chat/composer/pending-terminal-contexts.tsx`: one chip
  wrapper used by `prompt-editor.tsx`.
- [x] `terminal-activity.ts`: one switch helper used by
  `terminal-state-store.ts`.
- [x] `lib/terminal-state-cleanup.ts`: one retention helper used by
  `environments/runtime/service.ts`.
- [x] `components/chat/view/project-script-terminal-actions.ts`: only
  `chat-view.tsx` calls it; inline only if the project-script terminal flow
  remains readable.
- [x] `components/chat/shared/user-message-terminal-contexts.ts`: one
  production caller in `human-message.tsx`; keep only if message rendering
  needs a named parser boundary.

Keep even if single-caller:

- [x] `components/shell/terminal/terminal-rail.tsx`
- [x] `components/shell/terminal/workbench-subchrome.tsx`

Expected app simplification:

- terminal runtime and xterm boundaries stay explicit
- one-off terminal switch/format wrappers are inlined into their sole caller
- tests follow kept boundaries rather than deleted helper files

### 6. Router Split

Current app has both generated TanStack route files and app route view wrappers.
This may be legitimate, but it is a complexity multiplier.

Candidate surfaces:

- `packages/app/src/routes/*`
- `packages/app/src/app/routes/*`
- route-only wrappers that only forward context into one component

Expected app simplification:

- keep TanStack where it provides route matching/loading
- collapse wrappers that do not own route-specific behavior
- avoid putting product orchestration in route files

## Test Strategy Change

The right test direction is not more helper tests first. The first behavioral
coverage gap is user-visible shell behavior:

- sidebar behavior across desktop/tablet/mobile widths
- project workbench collapse before thread sidebar collapse
- thread row actions and rename state at real rendered sizes
- provider/model selector flow as a user opens, filters, selects, and sends

Current evidence:

- there is a string-level CSS contract in
  `components/shell/shell/app-shell-css-contract.test.ts`
- there are sidebar model/helper tests in `lib/thread-sidebar.test.ts`
- there is browser coverage for row geometry in `components/shell/agents/list.browser.tsx`
- there is not yet a direct rendered AppShell viewport test

That direct viewport test is useful, but it should follow the cleanup spec, not
replace it.

## Proposed First Waves

### Wave 1: Remote Surface Removal Spec

Deliverable:

- exact caller inventory for every `SavedEnvironment`, `remote`, `/pair`, and
  saved environment IPC symbol
- mark each as delete, keep, or needs decision
- after user confirmation, remove the app remote/saved environment path

Initial measured inventory:

| Area | File | Lines | Function-like nodes | Exported declarations/statements | Initial action |
| --- | --- | ---: | ---: | ---: | --- |
| App remote HTTP auth | `packages/app/src/environments/remote/api.ts` | 144 | 8 | 5 | Delete if remote pairing goes |
| App remote target parsing | `packages/app/src/environments/remote/target.ts` | 87 | 4 | 2 | Delete if remote pairing goes |
| App saved environment catalog | `packages/app/src/environments/runtime/catalog.ts` | 342 | 42 | 19 | Split primary-only catalog, then delete saved registry/runtime state |
| App environment service | `packages/app/src/environments/runtime/service.ts` | 1,312 | 113 | 17 | Keep primary connection, delete saved connection branch |
| Connections settings UI | `packages/app/src/components/settings/connections-settings.tsx` | 1,458 | 94 | 1 | Delete saved backend/pairing sections or replace with local-only diagnostics |
| Pairing route surface | `packages/app/src/components/pairing/pairing-route-surface.tsx` | 206 | 15 | 2 | Delete if `/pair` route goes |
| Pair route definition | `packages/app/src/routes/pair.tsx` | 18 | 1 | 1 | Delete route |
| Pair route view wrapper | `packages/app/src/app/routes/pair-route.tsx` | 32 | 3 | 2 | Delete route wrapper |
| Browser persistence | `packages/app/src/client-persistence-storage.ts` | 195 | 19 | 9 | Remove saved environment storage helpers |
| Local app API | `packages/app/src/local-api.ts` | 155 | 16 | 4 | Remove saved environment persistence surface |
| Desktop saved env service | `packages/desktop/src/settings/DesktopSavedEnvironments.ts` | 363 | 39 | 8 | Delete if desktop no longer stores remote backends |
| Desktop saved env IPC | `packages/desktop/src/ipc/methods/savedEnvironments.ts` | 77 | 6 | 5 | Delete IPC methods/channels/preload bridge |

Subtotal before server auth cleanup:

- 4,389 lines
- 360 function-like nodes
- 75 exported declarations/statements

Files currently referencing saved environment concepts:

- `packages/app/src/client-persistence-storage.test.ts`
- `packages/app/src/client-persistence-storage.ts`
- `packages/app/src/components/chat/picker/provider-model-picker.browser.tsx`
- `packages/app/src/components/chat/view/chat-view.browser.harness.tsx`
- `packages/app/src/components/chat/view/chat-view.tsx`
- `packages/app/src/components/settings/connections-settings.tsx`
- `packages/app/src/components/settings/settings-panels.browser.tsx`
- `packages/app/src/environments/runtime/catalog.test.ts`
- `packages/app/src/environments/runtime/catalog.ts`
- `packages/app/src/environments/runtime/index.ts`
- `packages/app/src/environments/runtime/service.addSavedEnvironment.test.ts`
- `packages/app/src/environments/runtime/service.threadSubscriptions.test.ts`
- `packages/app/src/environments/runtime/service.ts`
- `packages/app/src/lib/native-runtime-api.test.ts`
- `packages/app/src/local-api.test.ts`
- `packages/app/src/local-api.ts`
- `packages/contracts/src/ipc.ts`
- `packages/desktop/src/app/DesktopEnvironment.ts`
- `packages/desktop/src/client-persistence.ts`
- `packages/desktop/src/ipc/DesktopIpcHandlers.ts`
- `packages/desktop/src/ipc/channels.ts`
- `packages/desktop/src/ipc/methods/savedEnvironments.ts`
- `packages/desktop/src/main.ts`
- `packages/desktop/src/preload.ts`
- `packages/desktop/src/settings/DesktopSavedEnvironments.ts`

Files currently referencing pairing concepts:

- `packages/app/src/app/routes/pair-route.tsx`
- `packages/app/src/auth-bootstrap.test.ts`
- `packages/app/src/components/chat/view/chat-view.browser.fixtures.ts`
- `packages/app/src/components/keybindings-toast.browser.tsx`
- `packages/app/src/components/pairing/pairing-route-surface.tsx`
- `packages/app/src/components/settings/connections-settings.tsx`
- `packages/app/src/components/settings/settings-panels.browser.tsx`
- `packages/app/src/environments/primary/auth.ts`
- `packages/app/src/environments/primary/index.ts`
- `packages/app/src/environments/remote/api.test.ts`
- `packages/app/src/environments/remote/api.ts`
- `packages/app/src/environments/remote/target.ts`
- `packages/app/src/environments/runtime/service.addSavedEnvironment.test.ts`
- `packages/app/src/environments/runtime/service.ts`
- `packages/app/src/local-api.test.ts`
- `packages/app/src/pairing-url.ts`
- `packages/app/src/routeTree.gen.ts`
- `packages/app/src/routes/_chat.tsx`
- `packages/app/src/routes/pair.tsx`
- `packages/app/src/routes/settings.tsx`
- `packages/app/src/rpc/server-state.test.ts`
- `packages/contracts/src/auth.ts`
- `packages/server/src/auth/AuthControlPlane.service.ts`
- `packages/server/src/auth/AuthControlPlane.ts`
- `packages/server/src/auth/BootstrapCredentialService.service.ts`
- `packages/server/src/auth/BootstrapCredentialService.ts`
- `packages/server/src/auth/ServerAuth.service.ts`
- `packages/server/src/auth/ServerAuth.ts`
- `packages/server/src/auth/ServerAuthPolicy.ts`
- `packages/server/src/auth/http.ts`
- `packages/server/src/cli-auth-format.ts`
- `packages/server/src/cli.ts`
- `packages/server/src/persistence/AuthPairingLinks.service.ts`
- `packages/server/src/persistence/AuthPairingLinks.ts`
- `packages/server/src/persistence/Errors.ts`
- `packages/server/src/persistence/migrations/020_AuthAccessManagement.ts`
- `packages/server/src/persistence/migrations/021_AuthSessionClientMetadata.ts`
- `packages/server/src/server-runtime-startup.ts`
- `packages/server/src/server-runtime.ts`
- `packages/server/src/startup-access.ts`
- `packages/server/src/ws.ts`

Confirmed canonical decisions:

- [x] Delete remote/saved backend support instead of preserving compatibility.
- [x] Keep one primary environment path as the app runtime boundary.
- [x] Remove `/pair` from the app route tree.
- [x] Remove saved-environment persistence from app, desktop, and contracts.
- [ ] Decide whether any server auth code remains after the app and desktop
  remote/pairing UI is gone.
- [ ] Decide whether network exposure settings remain as a local-only diagnostic
  or are deleted with pairing.

Implementation checklist:

- [x] App runtime surface
  - [x] Delete `packages/app/src/environments/remote/api.ts`.
  - [x] Delete `packages/app/src/environments/remote/target.ts`.
  - [x] Delete `packages/app/src/environments/remote/api.test.ts`.
  - [x] Remove these imports from
    `packages/app/src/environments/runtime/service.ts`:
    `bootstrapRemoteBearerSession`, `fetchRemoteEnvironmentDescriptor`,
    `fetchRemoteSessionState`, `resolveRemoteWebSocketConnectionUrl`, and
    `resolveRemotePairingTarget`.
  - [x] Remove saved-environment connection creation, metadata refresh,
    reconnect, disconnect, add, and remove flows from `service.ts`.
  - [x] Keep the primary connection path:
    `createPrimaryEnvironmentConnection`, `getPrimaryEnvironmentConnection`,
    `readEnvironmentConnection`, `requireEnvironmentConnection`,
    `startEnvironmentConnectionService`, and thread-detail subscriptions.

- [x] App catalog/persistence surface
  - [x] Reduce `packages/app/src/environments/runtime/catalog.ts` to primary
    environment HTTP URL helpers only, or delete it if primary helpers move to
    `primary/target.ts`.
  - [x] Remove `SavedEnvironmentRecord`, `useSavedEnvironmentRegistryStore`,
    `useSavedEnvironmentRuntimeStore`, hydration, bearer-token helpers, and
    saved environment test reset helpers.
  - [x] Remove saved-environment persistence from `LocalApi` in
    `packages/app/src/local-api.ts`.
  - [x] Remove saved-environment storage helpers from
    `packages/app/src/client-persistence-storage.ts`.
  - [x] Delete or rewrite `client-persistence-storage.test.ts`,
    `environments/runtime/catalog.test.ts`,
    `environments/runtime/service.addSavedEnvironment.test.ts`, and the
    saved-environment mocks in `service.threadSubscriptions.test.ts`.

- [x] App route/settings UI
  - [x] Delete `packages/app/src/routes/pair.tsx`.
  - [x] Delete `packages/app/src/app/routes/pair-route.tsx`.
  - [x] Delete `packages/app/src/components/pairing/pairing-route-surface.tsx`.
  - [x] Regenerate or update `packages/app/src/routeTree.gen.ts`.
  - [x] Remove saved backend and pairing sections from
    `packages/app/src/components/settings/connections-settings.tsx`.
  - [x] Update `settings-panels.browser.tsx` to cover only the kept local
    connection/diagnostics UI, or remove that browser spec if the settings
    surface is deleted.

- [x] Desktop IPC and persistence
  - [x] Delete `packages/desktop/src/ipc/methods/savedEnvironments.ts`.
  - [x] Remove saved-environment IPC handler imports and installs from
    `packages/desktop/src/ipc/DesktopIpcHandlers.ts`.
  - [x] Remove saved-environment channel constants from
    `packages/desktop/src/ipc/channels.ts`.
  - [x] Remove saved-environment bridge methods and duplicated channel constants
    from `packages/desktop/src/preload.ts`.
  - [x] Delete `packages/desktop/src/settings/DesktopSavedEnvironments.ts`.
  - [x] Remove `DesktopSavedEnvironments.layer` from
    `packages/desktop/src/main.ts`.
  - [x] Remove `savedEnvironmentRegistryPath` from
    `packages/desktop/src/app/DesktopEnvironment.ts`.
  - [x] Confirm whether `packages/desktop/src/client-persistence.ts` is dead
    after this. If it is unreferenced, delete it too.

- [x] Contracts
  - [x] Remove `PersistedSavedEnvironmentRecord` and
    `PersistedSavedEnvironmentRecordSchema` from
    `packages/contracts/src/ipc.ts`.
  - [x] Remove saved-environment methods from `DesktopBridge` and `LocalApi` in
    the same file.
  - [x] Keep `EnvironmentApi` and primary environment contracts.

- [x] Grep gates
  - [x] `rg "SavedEnvironment|savedEnvironment|saved environment|saved-environment" packages/app/src packages/desktop/src packages/contracts/src`
    returns no app/desktop/contract hits except any intentionally kept migration
    notes.
  - [x] `rg "bootstrapRemoteBearerSession|fetchRemoteEnvironmentDescriptor|fetchRemoteSessionState|resolveRemoteWebSocketConnectionUrl|resolveRemotePairingTarget" packages/app/src`
    returns no hits.
  - [x] `rg "GET_SAVED_ENVIRONMENT|SET_SAVED_ENVIRONMENT|REMOVE_SAVED_ENVIRONMENT|DesktopSavedEnvironments" packages/desktop/src packages/contracts/src`
    returns no hits.
  - [x] `rg "createFileRoute\\(\"/pair\"|PairingRouteSurface|PairRoute" packages/app/src`
    returns no hits.

Verification checklist:

- [x] `rg` for saved/remote pairing symbols only finds intentionally kept
  server code.
- [x] `pnpm run typecheck` passes.
- [x] `pnpm run typecheck` passed after the opencode-style spec tree,
  slash-menu skill integration, prompt JSON removal, inline edit alignment, plan
  side-panel label update, and checkout error surfacing.

Wave 1 evidence:

- [x] `rg "SavedEnvironment|savedEnvironment|saved environment|saved-environment|readBrowserSaved|writeBrowserSaved|getSavedEnvironment|setSavedEnvironment|removeSavedEnvironment|useSavedEnvironment|Remote environments|ConnectionsSettings|settings/connections|PairingRouteSurface|createFileRoute\\(\"/pair\"|resolveRemotePairingTarget|bootstrapRemoteBearerSession" packages/app/src packages/desktop/src packages/contracts/src`
  returned no hits.
- [x] `rg "GET_SAVED_ENVIRONMENT|SET_SAVED_ENVIRONMENT|REMOVE_SAVED_ENVIRONMENT|DesktopSavedEnvironments|savedEnvironmentRegistryPath|saved-environments" packages/desktop/src packages/contracts/src`
  returned no hits.
- [x] `rg "kind: \"primary\"|kind: \"saved\"|readonly kind: \"primary\"|connection\\.kind" packages/app/src/environments/runtime packages/app/src/lib/git-status-state.test.ts packages/app/src/local-api.test.ts packages/app/src/components/chat/picker/provider-model-picker.browser.tsx`
  returned no hits.
- [x] `pnpm run typecheck` completed with 10 successful tasks.

### Wave 2: Provider/Model Core Consolidation

Deliverable:

- introduce one app model resolver module
- move duplicate runtime/model picker logic into it
- reduce draft store model-selection helper surface

Initial measured inventory:

| Area | File | Lines | Function-like nodes | Exported declarations/statements | Initial action |
| --- | --- | ---: | ---: | ---: | --- |
| App model resolver | `packages/app/src/model-selection.ts` | 300 | 25 | 9 | Keep as core candidate, reduce imports from UI-specific provider registry |
| Provider instances | `packages/app/src/provider-instances.ts` | 200 | 23 | 10 | Merge into core resolver if still needed |
| Provider model helpers | `packages/app/src/provider-models.ts` | 100 | 17 | 9 | Merge into core resolver |
| Runtime model helpers | `packages/app/src/lib/runtime-models.ts` | 465 | 52 | 21 | Deleted; only unused shell picker consumed it |
| Chat model picker root | `packages/app/src/components/chat/picker/model-picker.tsx` | 233 | 12 | 1 | Keep UI shell, consume core result |
| Chat model picker content | `packages/app/src/components/chat/picker/model-content.tsx` | 550 | 53 | 1 | Simplify after core result is stable |
| Chat model picker sidebar | `packages/app/src/components/chat/picker/model-sidebar.tsx` | 268 | 10 | 1 | Simplify or inline if provider rail remains small |
| Shell model picker | `packages/app/src/components/shell/pickers/model.tsx` | 404 | 21 | 2 | Deleted with browser-only spec |

Subtotal before draft-store cleanup:

- 2,520 lines
- 213 function-like nodes
- 54 exported declarations/statements

Related callers and tests:

- [ ] `packages/app/src/components/chat/composer/provider-registry.tsx`
- [ ] `packages/app/src/components/chat/composer/use-model-state.ts`
- [ ] `packages/app/src/components/chat/picker/provider-model-picker.browser.tsx`
- [x] `packages/app/src/components/shell/pickers/model.browser.tsx`
- [x] `packages/app/src/stores/chat-drafts.ts`
- [x] `packages/app/src/model/chat-selection.ts`
- [x] `packages/app/src/routes/model-picker-variants.tsx`

`stores/chat-drafts.ts` was 2,696 lines with 160 function-like nodes. It
should not be deleted as part of this wave, but its provider/model selection
normalization and sticky-selection logic should move behind the one core
resolver. The target is a draft store that stores selections, not a draft store
that knows how to resolve every provider/model capability.

Verification:

- [x] `rg` finds no `runtime-models`, shell picker, `RuntimeModelItem`, or
  `model-picker-variants` references in app source.
- [x] `stores/chat-drafts.ts` no longer exports model-resolution helpers.
- [x] `pnpm run typecheck` passed across all 10 workspace typecheck tasks.
- [ ] existing provider/model browser spec still covers open/filter/select

### Wave 3: Native Plan Side Panel

Deliverable:

- [x] Retain Plan as a first-class integrated side panel.
- [x] Collapse plan catalog/workbench indirection that is not needed by that side
  panel
- [x] Keep plan mode in composer controls, without an "Open Plan" control.
- [x] Move the primary Implement action to the side panel.
- [x] Remove or demote chat plan card primary behavior.

Initial measured inventory:

| Area | File | Lines | Function-like nodes | Exported declarations/statements | Initial action |
| --- | --- | ---: | ---: | ---: | --- |
| Plan side panel | `packages/app/src/components/shell/plan/plan-workbench-panel.tsx` | 275 | 9 | 2 | Keep as native side panel; reduce to plain React current behavior |
| Thread plan catalog hook | `packages/app/src/lib/thread-plan-catalog.ts` | 123 | 5 | 2 | Deleted; side panel resolves current/source threads through the existing thread selector |
| Shell assembly | `packages/app/src/components/shell-host.tsx` | 1,290 | 67 | 1 | Keep Plan as a shell side-panel tab; move excess orchestration into a focused plan module if needed |
| Shell panel store | `packages/app/src/stores/shell-panels-store.ts` | 519 | 68 | 16 | Keep `plan` tab state because Plan is a real side panel |
| Composer controls | `packages/app/src/components/chat/composer/*` | variable | variable | variable | Keep plan mode; remove "Open Plan" control |
| Chat view plan card | `packages/app/src/components/chat/view/chat-view.tsx` | variable | variable | variable | Do not make chat cards the primary plan action surface |

Directly deletable/collapsible subtotal:

- [x] Deleted the chat timeline `ProposedPlanCard` surface.
- [x] Removed composer "Open Plan" controls and props.
- [x] Removed the composer plan implementation split-button; implementation is
  side-panel-owned.
- [x] Deleted `packages/app/src/lib/thread-plan-catalog.ts`.
- [x] Removed plan copy/download/save export actions from the side panel.
- [x] Removed the secondary "Implement in a new thread" side-panel action.
- [x] Do not count the side panel itself as a deletion target.

Larger affected files:

- `ShellHost` and `shell-panels-store` include plan as a slice of broader shell
  behavior. The target is to keep Plan as a native side-panel slice while
  simplifying how state and implementation actions flow into it.

Related callers and tests:

- `packages/app/src/components/chat/view/chat-view.tsx`
- `packages/app/src/components/chat/composer/input.tsx`
- `packages/app/src/components/shell/plan/plan-workbench-panel.browser.tsx`
- `packages/app/src/proposed-plan.ts`
- `packages/app/src/session-logic.ts`

Verification:

- [x] `pnpm run typecheck` passed across all 10 workspace typecheck tasks after
  the native Plan side-panel slice.
- [ ] Rendered verification for plan side-panel visibility only if this wave is
  asked to add or change verification coverage

### 4. Composer Canonical Rewrite

Deliverable:

- [x] Rewrite the composer shell from first principles around one canonical
  component module.
- [x] Delete shell-only composer wrapper files once their behavior is inlined.
- [x] Keep hard-boundary modules: rich text editor, command menu, model picker,
  provider traits, image attachments, and pending request panels.
- [x] Move layout styling onto elements with Tailwind utilities.
- [x] Delete `styles/composer.css`; placeholder/editor styling is expressed on
  the editor element.

Data research completed before rewrite:

- [x] Cursor bundle uses `data-variant` and `data-expanded` to switch compact
  row layout versus expanded stacked layout.
- [x] Cursor compact layout keeps plus/editor/model/menu/send in one row; the
  toolbar wrappers become layout-transparent while compact.
- [x] Cursor expanded layout restores a bottom toolbar row with
  `justify-content: space-between`.
- [x] Cursor model picker wrappers are bounded with `max-width`, `min-width: 0`,
  and `overflow: hidden`.
- [x] Multi already measures single-line versus multiline editor state in
  `ComposerPromptEditor`; the rewrite should reuse that signal instead of
  creating a second detector.

Files to inline or delete:

- [x] `packages/app/src/components/chat/composer/prompt-input.tsx`
- [x] `packages/app/src/components/chat/composer/composer-footer-shell.tsx`
- [x] `packages/app/src/components/chat/composer/composer-footer-mode-controls.tsx`
- [x] `packages/app/src/components/chat/composer/compact-composer-controls-menu.tsx`
- [x] `packages/app/src/components/chat/composer/primary-actions.tsx`
- [x] `packages/app/src/components/chat/composer/use-composer-footer-layout.ts`
- [x] `packages/app/src/components/composer-footer-layout.ts`
- [x] `packages/app/src/components/chat/composer/pending-terminal-contexts.tsx`

Files to keep as boundaries:

- [x] `packages/app/src/components/chat/composer/prompt-editor.tsx`
- [x] `packages/app/src/components/chat/composer/command-menu.tsx`
- [x] `packages/app/src/components/chat/composer/image-attachment-strip.tsx`
- [x] `packages/app/src/components/chat/composer/pending-approval-panel.tsx`
- [x] `packages/app/src/components/chat/composer/pending-approval-actions.tsx`
- [x] `packages/app/src/components/chat/composer/pending-user-input-panel.tsx`
- [x] `packages/app/src/components/chat/composer/queued-items-panel.tsx`
- [x] `packages/app/src/components/chat/picker/model-picker.tsx`
- [x] `packages/app/src/components/chat/picker/traits-picker.tsx`

Implementation order:

- [x] Inline prompt root/container/toolbar state into `input.tsx`.
- [x] Inline compact overflow menu, mode/access controls, and primary action
  rendering into `input.tsx`.
- [x] Delete the shell-only files and update imports/tests that referenced
  exported helper functions.
- [x] Replace compact row CSS with Tailwind classes on the row, editor wrapper,
  model trigger wrapper, overflow menu button, and submit action.
- [x] Replace expanded composer CSS with Tailwind classes on the surface,
  editor wrapper, and bottom toolbar.
- [x] Delete `styles/composer.css` and remove the `agent-panel-followup-input`
  wrapper classes from `ChatView`.
- [x] Trace inline edit mode: clicking a user message swaps that message row to
  an inline composer, and sticky user rows remain the single edited row.
- [x] Remove inline edit no-op pending callbacks and empty pending arrays by
  narrowing `ComposerInput` optional capability props.
- [x] Remove parent focus props from `ComposerInput`; focus scheduling should
  use the editor ref already owned by the composer.
- [x] Move edit Cancel into the composer inset or into a first-class edit
  action slot, not a second card row outside the input.
- [x] Delete unused terminal context list wrapper; keep the terminal context chip
  primitive used by the editor atom node.
- [x] Replace handwritten attach-plus glyphs with the matching `central-icons`
  icon.
- [x] Rename leftover composer-specific layout tokens that are really chat or
  workbench tokens.
- [x] Remove arbitrary Tailwind width utilities (`w-[...]`, `min-w-[...]`,
  `max-w-[...]`) from `packages/app/src`; use named scale utilities or
  parent-bounded `max-w-full` instead.
- [x] Move root composer draft and queue state out of `packages/app/src`.
  Draft state belongs in `stores/chat-drafts.ts`; queued sends belong in
  `stores/chat-send-queue.ts` plus the queue dispatcher colocated with store
  orchestration.
- [x] Move composer prompt text internals beside the canonical composer shell:
  prompt document parsing, prompt segment parsing, trigger/cursor logic, and
  handle context belong under `components/chat/composer` with names that
  describe the behavior instead of root `composer-*` modules.
- [x] Rename `hooks/use-composer-pretext-one-line.ts`; it is a generic
  Pretext-backed one-line measurement hook.
- [x] Delete `scripts/cursor-composer-untint-overrides.css` and
  `scripts/apply-cursor-composer-untint.sh`; the Cursor data research is now
  documented and should not remain as patch artifacts.

Verification:

- [x] `rg "agent-window .*composer|PromptInputRoot|ComposerFooterShell|CompactComposerControlsMenu|ComposerFooterModeControls|ComposerPrimaryActions" packages/app/src`
  returns no production composer-shell hits after deletion.
- [x] `pnpm run typecheck` passes.

### Wave 5: Shell Behavior Coverage

Deliverable:

- rendered viewport browser test for AppShell sidebar/workbench behavior
- delete or reduce proxy string checks that become redundant

Verification:

- run the specific browser test from `packages/app`

Current test gap:

- `packages/app/src/components/shell/shell/app-shell-css-contract.test.ts`
  checks CSS source strings.
- `packages/app/src/lib/thread-sidebar.test.ts` checks sidebar helper behavior.
- `packages/app/src/components/shell/agents/list.browser.tsx` checks row
  geometry.
- No current rendered test asserts the actual shell/sidebar/workbench behavior
  at multiple viewport widths.

The kept verification should render `AppShell` with production CSS and verify:

- [ ] desktop: thread sidebar and right workbench visible
- [ ] tablet: right workbench collapsed, thread sidebar visible
- [ ] mobile: both right workbench and thread sidebar collapsed

This is a reliability gate for the usability problem the prompt called out. It
should land after the spec-led cleanup target is chosen, not as a substitute for
deleting surface area.

### Wave 6: Browser/Observability Debug Removal

Deliverable:

- remove app browser debug tracing when it is not a product feature
- keep server/desktop observability only if it is still used for logs and
  diagnostics

Initial measured inventory:

| Area | File | Lines | Function-like nodes | Exported declarations/statements | Initial action |
| --- | --- | ---: | ---: | ---: | --- |
| Browser debug event buffer | `packages/app/src/observability/browserDebug.ts` | 184 | 16 | 2 | Delete if browser debug trace collector goes |
| Client OTLP bridge | `packages/app/src/observability/clientTracing.ts` | 145 | 10 | 4 | Delete app-side client tracing if server tracing stays server-only |
| App entry dev overlay/tracing | `packages/app/src/main.tsx` | 41 | 0 | 0 | Remove `Agentation` and browser trace install if not used |
| Server browser collector service | `packages/server/src/observability/BrowserTraceCollector.service.ts` | 14 | 0 | 2 | Delete if no app posts browser debug events |
| Server HTTP route host | `packages/server/src/http.ts` | 365 | 28 | 9 | Remove only browser debug/OTLP proxy routes, not the whole file |

Candidate app/server subtotal:

- 749 lines touched
- 54 function-like nodes
- 17 exported declarations/statements

Files currently referencing browser tracing/debug:

- [x] `packages/app/src/app/routes/chat-draft-route.tsx`
- [x] `packages/app/src/app/routes/chat-thread-route.tsx`
- [x] `packages/app/src/app/routes/root-route.tsx`
- [x] `packages/app/src/components/chat/composer/pending-user-input-panel.tsx`
- [x] `packages/app/src/components/chat/composer/primary-actions.tsx`
- [x] `packages/app/src/components/chat/view/chat-view.tsx`
- [x] `packages/app/src/components/shell/terminal/panel.tsx`
- [x] `packages/app/src/environments/runtime/connection.ts`
- [x] `packages/app/src/environments/runtime/service.ts`
- [x] `packages/app/src/hooks/use-handle-new-thread.ts`
- [x] `packages/app/src/main.tsx`
- [x] `packages/app/src/observability/browserDebug.ts`
- [x] `packages/app/src/observability/clientTracing.ts`
- [x] `packages/app/src/rpc/ws-transport.ts`
- [x] `packages/server/src/http.ts`
- [x] `packages/server/src/observability/BrowserTraceCollector.service.ts`
- [x] `packages/server/src/observability/Observability.ts`
- [x] `packages/server/src/server-runtime.ts`

Preserved product/runtime surface:

- [x] `RouterProvider` and `getRouter` in the Vite/TanStack renderer.
- [x] Electron `createHashHistory` renderer hosting.
- [x] Browser/web `createBrowserHistory` renderer hosting.
- [x] `staticAndDevRouteLayer` for server-hosted web/dev assets.
- [x] `websocketRpcRouteLayer` and `WsTransport` for core app/server
  communication.
- [x] auth bootstrap, environment descriptor, attachment, orchestration, and
  favicon routes.
- [x] server OTLP tracing/metrics in `ObservabilityLive`.

Removed implementation:

- [x] app browser debug event buffer.
- [x] app client OTLP exporter bridge.
- [x] browser debug install and render trace calls in `main.tsx`.
- [x] `Agentation` dev overlay and package dependency.
- [x] app `traceBrowserEvent` calls across route, composer, terminal, runtime,
  and WebSocket files.
- [x] server `/api/debug/browser-events` route.
- [x] server `/api/observability/v1/traces` browser proxy route.
- [x] server `BrowserTraceCollector` service and layer provider.
- [x] browser OTLP decode branch in server/shared trace record modules.
- [x] browser trace propagation CORS headers `b3` and `traceparent`.

Verification:

- [x] `rg` finds no app `traceBrowserEvent`, `installBrowserDebugTracing`, or
  `configureClientTracing` references after removal.
- [x] `rg` finds no source/package references to `Agentation`, `agentation`,
  `/api/debug/browser-events`, `/api/observability/v1/traces`,
  `BrowserTraceCollector`, `decodeOtlpTraceRecords`, `otlp-span`, `b3`, or
  `traceparent`.
- [x] `pnpm run typecheck` passed across all 10 workspace typecheck tasks.

### Wave 7: Route Split Collapse

Deliverable:

- collapse route wrappers that do not own behavior
- remove routes for deleted product surfaces such as `/pair` and model picker
  variants

Measured route files:

| File | Lines | Initial action |
| --- | ---: | --- |
| `packages/app/src/app/routes/chat-draft-route.tsx` | 105 | Keep if behavior remains route-specific |
| `packages/app/src/app/routes/chat-index-route.tsx` | 76 | Keep or inline into route file |
| `packages/app/src/app/routes/chat-route.tsx` | 102 | Keep if shell composition remains route-specific |
| `packages/app/src/app/routes/chat-thread-route.tsx` | 120 | Keep if behavior remains route-specific |
| `packages/app/src/app/routes/pair-route.tsx` | 31 | Delete with `/pair` |
| `packages/app/src/app/routes/root-route.tsx` | 387 | Split bootstraps from route rendering or collapse bootstraps into app root |
| `packages/app/src/app/routes/settings-route.tsx` | 45 | Keep or inline |
| `packages/app/src/routes/*` | 253 total | Keep generated route definitions, delete deleted routes |

Route subtotal:

- 1,040 lines across route definitions and app route view wrappers
- 89 function-like nodes
- 24 exported declarations/statements

Verification:

- deleted routes disappear from `routeTree.gen.ts`
- route tree regenerates or typecheck confirms generated tree consistency
- `pnpm run typecheck`

## Dependency Audit

These dependencies appear in one or two source/config files and should be
reviewed after the waves above. Low reference count does not mean unused; it
means the package is easy to verify.

| Dependency | Reference count in app source/config/package | Initial action |
| --- | ---: | --- |
| `agentation` | 2 | Deleted in Wave 5 |
| `@tanstack/react-query-devtools` | 2 | Delete if router/devtools panel does not expose it |
| `@tanstack/react-router-devtools` | 2 | Delete if router devtools are removed |
| `@tanstack/react-devtools` | 2 | Delete if `RouterDevtoolsPanel` no longer needs it |
| `@tanstack/devtools-vite` | 1 | Delete with TanStack devtools |
| `@effect/language-service` | 1 | Keep only if local tooling uses it |
| `@rolldown/plugin-babel` | 2 | Keep only if Vite config still needs it |
| `babel-plugin-react-compiler` | 1 | Keep only if compiler remains enabled |
| `@tanstack/react-hotkeys` | 2 | Keep if composer mode hotkeys remain on it |
| `@tanstack/react-pacer` | currently used in runtime service | Delete if remote/saved connection throttling goes and no other throttling remains |

## Strict Knip Gate

Goal:

- make dead files, unused exports, unused types, unlisted dependencies,
  unresolved imports, duplicate exports, catalog drift, and config hints fail
  by default
- keep test and browser spec files inside the graph instead of hiding them with
  broad ignores
- add a production-only gate so test-only reachability cannot hide dead product
  code

Rules:

- [x] `pnpm run knip` reports every Knip issue family, not only files,
  dependencies, catalog, and unresolved imports.
- [x] `pnpm run knip` avoids Knip's `--strict` flag because that mode excludes
  other workspaces from direct dependency accounting and creates false positives
  for live `workspace:*` imports. Strictness comes from all issue families,
  entry-export checks, config-hint failures, and no broad source ignores.
- [x] Entry-file exports are included; public package entry files are not
  exempt from unused export reporting.
- [x] Config hints are treated as failures.
- [x] Test and browser files are modeled as entries where they are legitimate
  executable specs, not globally ignored.
- [x] `pnpm run knip:production` exists for production-source reachability.
- [x] Generated Effect schema output has a narrow export/type exclusion so the
  strict report focuses on handwritten code and package boundaries.

Verification:

- [ ] `pnpm run knip` runs with the strict config and reports only real cleanup
  work, not config/schema errors.
- [ ] `pnpm run knip:production` runs and identifies production-only dead code.
- [ ] Current Knip findings are either deleted, rewired, or documented with a
  narrow intentional exclusion.

## Done Criteria

This cleanup is done only when:

- [ ] deleted files/symbols have a caller inventory
- [ ] large product surfaces are removed only after intentional behavior is named
- [ ] no route, IPC, or contract type remains solely for deleted app UI
- [ ] model/provider selection has one core resolver path
- [ ] shell/sidebar verification exercises user-visible behavior, not only
  helper functions
- [ ] strict Knip gates are configured and outstanding findings have a cleanup
  ledger
- [ ] `pnpm run typecheck` passes

## Prompt To Artifact Checklist

- [x] Use codebase-cli for `earendil-works/pi`: registered path recorded as
  `/Users/workgyver/.agents/codebases/earendil-pi`; Pi lessons summarized.
- [x] Use opencode effect migration specs: registered opencode path recorded;
  requested effect spec tree and files listed; opencode cleanup rules
  summarized.
- [x] Identify extra function/effect/react/router code: app-wide
  file/line/function/export counts and wave-specific ledgers are documented.
- [x] Determine how many functions can be stripped from `multi-app`:
  first-pass ledger identifies 730 function-like nodes in measured target files.
- [x] Create a foundation doc like opencode's spec family:
  `docs/multi-app-foundation-spec.md` defines Multi tracks for `ENV`, `MODEL`,
  `ROUTE`, `PLAN`, `ERROR`, `SCHEMA`, `UI`, `TEST`, `EFFECT`, `OBS`, and
  `DELETE`.
- [x] Record that remote connection is not needed: Wave 1 targets remote/saved
  environments and is confirmed for canonical deletion.
- [x] Record that browser function is not needed: Wave 5 targets browser
  tracing/debug and dev overlay for deletion.
- [ ] Make codebase reliable/understandable: cleanup waves are documented, but
  code deletion and rewiring still need to land.
- [x] Task/plan panel can be plain React: Wave 3 now retains Plan as the native
  side panel and targets only unnecessary catalog/workbench indirection.
- [x] Composer can be canonical and composable: Wave 4 defines a one-file shell
  rewrite with inline Tailwind and minimal CSS tokens.
- [ ] Improve usability verification for sidebar multiple screen sizes: Wave 5
  defines rendered AppShell viewport requirements.
- [ ] Provider/model selector is too complicated: Wave 2 deleted duplicate
  runtime/shell picker paths and moved effective composer resolution out of the
  draft store; core resolver consolidation remains open.
- [ ] Build good core like `pi`: Pi model resolver lesson and Wave 2 core
  resolver target are documented; implementation is partially landed.
