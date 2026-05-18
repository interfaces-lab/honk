# Multi App Foundation Spec

This is the foundation document for making `packages/app` smaller, more
understandable, and easier to verify. It turns the opencode spec style into
Multi-specific rules for runtime, models, routes, errors, schema, UI, tests, and
Effect boundaries.

The execution inventory and deletion waves live in
[`multi-app-slimming-spec.md`](./multi-app-slimming-spec.md). This file is the
source of truth for the target architecture those waves must move toward.
Durable boundary specs now live in [`../specs`](../specs); use those files for
rules that other agents and future cleanup slices should follow.

## Opencode Spec Pattern

Opencode does not treat cleanup as a loose refactor. It keeps a small spec
family under `packages/opencode/specs`:

- `effect/guide.md`: current rules for service shape, runtime boundaries,
  errors, schemas, preferred services, bridges, and tests.
- `effect/todo.md`: priority roadmap with named tracks like `ERR`, `HTTP`,
  `TEST`, `RT`, and `OA`.
- `effect/errors.md`: typed error rules, HTTP boundary rules, rendering rules,
  migration order, and PR checklist.
- `effect/schema.md`: one schema source of truth for domain models, DTOs, IDs,
  inputs, outputs, and typed errors.
- `effect/routes.md`: route handler shape, route error boundaries, OpenAPI
  compatibility rules, and route PR checklist.
- `effect/facades.md`: exact runtime-backed facade inventory, exclusions,
  caller templates, tests, grep gates, and "done means" checklist.
- `effect/tools.md`: tool migration target shape, exported tool inventory, and
  follow-up cleanup checklist.
- `v2/message-shape.md`: option-based model spec for a specific data shape.

The reusable pattern:

- [x] Start with rules and target shape, not implementation churn.
- [x] Keep each spec scoped to one boundary.
- [x] Name intentional exclusions.
- [x] Require caller inventory before deleting or rewiring code.
- [x] Define "done" with grepable evidence and focused verification.
- [x] Prefer vertical slices over broad rewrites.
- [x] Let tests follow the architecture being kept, not code being deleted.

Multi's matching spec tree:

- [x] `specs/effect/guide.md`: service, runtime, error, schema, route, and
  verification rules.
- [x] `specs/effect/todo.md`: current priority tracks and cleanup queue.
- [x] `specs/effect/errors.md`: typed error and rendering rules.
- [x] `specs/effect/schema.md`: schema ownership rules.
- [x] `specs/effect/routes.md`: server transport and TanStack route rules.

## Multi Foundation Tracks

Use these track names in docs, PR descriptions, and implementation checklists.

- `ENV`: primary environment runtime and removal of remote/saved environments.
- `MODEL`: provider/model core resolver and selector primitives.
- `ROUTE`: TanStack route boundaries and route wrapper collapse.
- `PLAN`: native plan mode side panel and implementation workflow.
- `COMPOSER`: canonical agent input surface, model controls, and compact versus
  expanded behavior.
- `ERROR`: typed app/server errors and user-facing rendering.
- `SCHEMA`: schema-backed domain models, IDs, DTOs, and IPC contracts.
- `UI`: shell usability, responsive layout, and rendered behavior.
- `TEST`: integration-style verification for kept behavior.
- `EFFECT`: Effect service boundaries, facades, runtime bridges, and plain
  React boundaries.
- `OBS`: server observability, renderer diagnostics, and trace boundaries.
- `DELETE`: deletion inventory, grep gates, and dependency cleanup.

## Non-Negotiable Shape

- [x] `packages/app` has one primary environment runtime path.
- [x] Remote/saved backend support is not a compatibility surface to preserve.
- [x] Browser-only pairing/debug surfaces are not product foundations.
- [x] Browser rendering remains the Vite/TanStack React app served by the server
  and hosted by Electron.
- [ ] Provider/model selection has one core resolver with UI primitives on top.
- [ ] Plan/task rendering is a first-class integrated side panel, implemented
  with plain React unless a retained abstraction proves it removes real
  complexity.
- [ ] Composer behavior has one canonical state model:
  new-agent/hero expanded, thread single-line compact, and thread multiline
  expanded.
- [ ] Route files own routing and loading only; product orchestration lives in
  app/domain modules.
- [ ] Tests verify user-visible behavior at rendered boundaries.
- [ ] Effect is used at durable service/runtime boundaries, not as scattered
  local indirection.
- [ ] Files named `.logic.ts` or helper tests are kept only when they own a real
  domain boundary.

## ENV: Environment Runtime

Goal:

- One primary environment connection.
- No saved backend registry.
- No remote bearer bootstrap in the app.
- No `/pair` route for browser pairing.
- No saved-environment IPC, desktop persistence, or browser localStorage.

Target shape:

- `environments/primary/*` owns primary descriptor/bootstrap helpers.
- `environments/runtime/service.ts` owns one connection registry for the primary
  environment and thread subscriptions.
- `environments/runtime/catalog.ts` is either deleted or reduced to primary HTTP
  URL helpers.
- `LocalApi.persistence` stores client settings only.
- `DesktopBridge` exposes local shell capabilities only.

Rules:

- [x] Do not keep a compatibility shim for saved environments.
- [x] Do not leave route, IPC, or contract types that only serve deleted remote
  UI.
- [ ] Keep desktop local bootstrap auth only if it is required for the desktop
  app to connect to its own server.
- [ ] Server auth code must be justified by a current product boundary, not old
  browser pairing UI.

Done means:

- [x] No `SavedEnvironment`, `savedEnvironment`, or `saved-environment` symbols
  remain in app, desktop, or contract code.
- [x] No `bootstrapRemoteBearerSession`, `resolveRemotePairingTarget`, or remote
  websocket token flow remains in app code.
- [x] `/pair` is absent from route files and `routeTree.gen.ts`.
- [x] `pnpm run typecheck` passes.

## OBS: Renderer And Observability Boundary

Goal:

- Keep the product renderer: Vite, TanStack Router, React, and the Electron
  hosted window.
- Keep the server web/static/dev host and WebSocket RPC core.
- Keep server-side tracing/metrics for server diagnostics.
- Remove app-side browser debug event collection when it is not a product
  feature.

Target shape:

- `packages/app/src/main.tsx` mounts the router only.
- Renderer diagnostics use normal local error handling and console output.
- Server routes expose current product APIs, static/dev hosting, environment
  metadata, attachments, auth bootstrap, orchestration HTTP, and WebSocket RPC.
- `packages/server/src/observability/Observability.ts` owns server tracing and
  metrics without a browser trace collector service.

Rules:

- [x] Do not treat "browser debug" as the Vite/TanStack renderer.
- [x] Do not remove `staticAndDevRouteLayer`, `websocketRpcRouteLayer`, auth
  bootstrap routes, environment descriptor routes, or attachment routes while
  deleting debug collectors.
- [x] Do not keep app-side OTLP/exporter code without a current product
  consumer.
- [x] Do not keep server receiver routes that only exist for deleted app-side
  browser tracing.
- [x] Do not keep trace propagation CORS headers when no app caller sends them.

Done means:

- [x] No `traceBrowserEvent`, `installBrowserDebugTracing`, or
  `configureClientTracing` references remain in app source.
- [x] No `/api/debug/browser-events` or browser OTLP proxy route remains in
  app/server source.
- [x] No `BrowserTraceCollector` service remains.
- [x] `agentation` is removed from `@multi/app`.
- [x] Server-side `ObservabilityLive` still owns server OTLP tracing and
  metrics.
- [x] `pnpm run typecheck` passes.

## MODEL: Provider And Model Core

Goal:

- One model/provider resolver core like `pi`: small, explicit, and consumed by
  selectors.
- Draft state stores selections; it does not own provider resolution logic.
- UI pickers display resolver output instead of reimplementing resolution.

Current candidate files:

- `packages/app/src/model/selection.ts`
- `packages/app/src/model/provider-instances.ts`
- `packages/app/src/model/provider-models.ts`
- `packages/app/src/lib/runtime-models.ts`
- `packages/app/src/model/chat-selection.ts`
- `packages/app/src/stores/chat-drafts.ts`
- `packages/app/src/components/chat/picker/*`
- `packages/app/src/components/shell/pickers/model.tsx`

Target shape:

- `model/selection.ts` and `model/provider-instances.ts` are the app core for model
  options and provider instance entries.
- `model/chat-selection.ts` is the chat dispatch boundary that combines draft,
  thread, project, settings, and provider status inputs into one dispatch
  selection.
- A single core path resolves:
  - selected provider instance
  - selected model
  - provider capabilities
  - custom model options
  - fallback/default selection
- Picker components consume normalized entries from that core.
- Server provider status is input data, not picker-owned state.
- Composer draft state stores only the selected model/provider IDs and draft
  affordances.

Rules:

- [x] No duplicate resolver path for chat picker versus shell picker.
- [ ] No provider registry logic inside `stores/chat-drafts.ts`.
- [ ] No UI component should decide provider/model fallback behavior.
- [ ] Resolver APIs should return discriminated result objects instead of
  throwing for normal missing/disabled provider states.
- [ ] Provider/model tests should cover open/filter/select/send behavior and the
  core fallback matrix.

Done means:

- [ ] One resolver module is the import source for provider/model decisions.
- [x] Shell and chat pickers share the same primitives or one is deleted.
- [ ] `stores/chat-drafts.ts` no longer contains provider registry logic.
- [ ] Grep confirms old duplicate resolver exports are deleted or thin aliases
  with a removal note.

Completed slices:

- [x] Deleted unused shell model picker and its browser-only spec.
- [x] Deleted duplicate `lib/runtime-models.ts` resolver path.
- [x] Deleted `/model-picker-variants` route and page.
- [x] Moved effective chat model resolution out of `stores/chat-drafts.ts`
  into `model/chat-selection.ts`.
- [x] Moved `getComposerProviderState` from composer UI ownership into
  `model/provider-state.ts`.
- [x] `pnpm run typecheck` passes after the MODEL slice.

## ROUTE: Route Boundaries

Goal:

- TanStack routes declare routes and validation.
- App route modules render route-specific views.
- Thin wrappers with no route behavior are collapsed.
- Deleted product surfaces disappear from generated route types.

Rules:

- [ ] Route files may validate search, redirect for active product state, and
  select route components.
- [ ] Route files may not own settings workflows, provider/model logic, runtime
  connection orchestration, or plan/task orchestration.
- [ ] Generated route tree must match actual kept routes.
- [ ] Route wrappers are kept only when they own real route-specific behavior.

Done means:

- [ ] `/pair` and deleted debug/variant routes are absent.
- [ ] `routeTree.gen.ts` has no deleted route imports or route IDs.
- [ ] Route wrapper grep finds only wrappers with real behavior.

## PLAN: Native Plan Mode Side Panel

Goal:

- Plan mode has a native integrated side panel.
- The side panel is the first-class plan surface for active and proposed plan
  state.
- The side panel owns the primary Implement action.
- Plan/task UI is plain React inside the shell workflow it supports.
- Chat may show plan conversation context, but it is not the primary plan
  control surface.

Rules:

- [x] Keep plan-specific shell persistence because Plan is a real shell side
  panel.
- [x] Do not expose an "Open Plan" composer control; entering plan mode should
  make the native side panel the obvious plan surface.
- [x] Do not make the chat plan card the primary interaction surface.
- [x] Put the proper Implement action in the side panel.
- [ ] Align with Cursor's plan flow: the plan surface owns build/implement
  actions, and composer input is only for adding follow-up plan feedback.
- [x] Do not render a composer plan card/banner as the primary plan-ready
  affordance. Plan readiness belongs in the side panel.
- [x] Keep copy/download/save actions only if they are current product controls;
  otherwise delete them rather than hiding them behind compatibility code.
- [x] Render active/proposed plan state from current thread/session state.
- [x] Keep the side-panel implementation small enough that a user can trace
  state flow through the shell and panel without a catalog maze.

Done means:

- [x] The shell has a Plan side-panel tab or equivalent native side-panel slot.
- [x] The side panel displays active/proposed plan state for the selected
  thread.
- [x] The side panel has the primary Implement button.
- [x] Composer controls include plan mode, not "Open Plan".
- [x] Chat plan cards are removed or demoted to non-primary timeline context.
- [x] Composer no longer renders a separate plan-ready banner/card.
- [ ] Plan side panel has the primary implementation affordance and a secondary
  path to continue planning when follow-up text is needed.
- [x] Dedicated plan catalog/workbench files are deleted or reduced to plain
  side-panel components with current callers only.
- [x] `pnpm run typecheck` passes after the native Plan side-panel slice.

## COMPOSER: Canonical Agent Input Surface

Goal:

- The composer is the bordered inset for every input control it owns.
- The composer surface is authored as one canonical TSX module for structure,
  state selection, footer controls, and primary actions.
- Styling lives on the rendered elements as Tailwind utilities. There is no
  composer-specific stylesheet.
- New-agent/hero state uses a fixed-height expanded composer with inner editor
  scroll and a bottom row that is justified between selector controls and the
  primary action.
- Thread state has two native modes:
  - single-line compact mode while the editor fits one line
  - multiline expanded mode as soon as the editor measures taller than one line,
    with deletion back to one line returning to compact mode
- Plan mode remains a composer mode selector, while plan implementation belongs
  to the native side panel.

Cursor data research:

- [x] Read
  `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.css`.
- [x] Read
  `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js`.
- [x] Cursor's `full-input-box` / `ai-input-full-input-box` uses a column base
  with a bottom container and toggles `.compact` for row layout.
- [x] Cursor JS drives compactness through an `isCompactMode` input and flips
  flex direction, alignment, gap, and bottom-container width instead of moving
  controls outside the input surface.
- [x] Cursor CSS keeps the bottom container inside the box:
  `.ai-input-full-input-box-bottom-container` is flex, `flex-shrink: 0`,
  `align-items: center`, and `justify-content: space-between`.
- [x] Cursor CSS bounds model picker controls with `max-width`, `min-width: 0`,
  and `overflow: hidden` on `.glass-model-picker-wrapper` and its trigger text.
- [x] Cursor compact prompt CSS uses `data-variant=compact` and
  `:not([data-expanded])` for the one-line state, while `data-expanded` returns
  the prompt to stacked behavior.
- [x] Cursor sent-message edit mode is inline: `prompt-edit-input` renders a
  prompt input in the human message row, replacing the bubble instead of
  opening the bottom composer.
- [x] Cursor inline edit does not remount the bottom composer. It uses a
  message-row prompt input shape with the same text baseline as the human
  bubble and bounded editor height (`20px` minimum, `240px` maximum in the
  bundled workbench source).
- [x] Cursor edit focus is row-local: clicking the sent message swaps the row
  and focuses the inline input immediately instead of waiting on a bottom
  composer layout pass.
- [x] Cursor's bundled edit state is explicit row state:
  `editingBubbleId` is compared with each message bubble id, and the edit row
  mounts a `role: "top"` prompt input with a separate previous-bubble delegate.
- [x] Cursor uses row-level sticky behavior for human messages and plan blocks;
  editing a sticky human message keeps the editor in that sticky row.
- [x] Cursor plan mode command is `changeToPlan`, labeled `Plan Mode`, and it
  emits a mode-change request with payload `{ mode: "plan" }`.
- [x] Cursor plan execution controls render on the plan surface and plan editor
  breadcrumbs. The primary label is `Build` / `Build Plan`; accepting dispatches
  a plan execution request instead of routing through a bottom-composer card.
- [x] Cursor model picking is an integrated contract with selection, auto/max
  mode, saved model parameters, and parameter preference clearing. Multi should
  keep model selection as one provider/model boundary instead of a dumb dropdown.

Current Multi evidence:

- [x] `ComposerInput` maps `variant="hero"` to expanded and `variant="dock"`
  to compact.
- [x] `ComposerPromptEditor` measures multiline state from newline text and
  editor/content height, and reports it through `onMeasuredMultilineChange`.
- [x] `ComposerInput` expands dock mode when there is a header, queued item,
  image, pending progress, or measured multiline editor.
- [x] The old `ComposerFooterShell` owned the bottom selector/action row before
  the rewrite.
- [x] `ProviderModelPicker` already has bounded trigger text and compact
  display props.
- [x] The current overflow risk is in layout, not missing feature support:
  footer left uses negative margin plus horizontal overflow inside a bordered
  composer, and compact controls can visually bleed instead of staying inset.

Edit-message research:

- [x] Edit mode is not a second bottom composer state. `ChatView` creates a
  separate `inline-message-edit:<thread>` draft target and swaps the clicked
  user message row into an inline editor.
- [x] `HumanMessage` returns the edit composer instead of the normal user
  bubble while `isEditing` is true. If the active user row is sticky, the editor
  is the sticky row; there is no duplicate sticky message and normal row.
- [x] Submitting an edit is a thread rewrite: `ChatView` reverts to the
  checkpoint before the original user message, appends a new optimistic user
  message, persists the selected model/runtime/mode for the next turn, and
  dispatches a fresh `thread.turn.start`.
- [x] Inline edit currently reuses the full `ComposerInput` but pays for that
  reuse with empty pending arrays, no-op pending callbacks, and a second outer
  border with a Cancel row outside the composer inset.
- [x] Inline edit should stop using the full bottom-composer geometry. It should
  keep provider/model/send behavior but render as a row-local edit input with
  Cursor-sized editor bounds and no frame-delayed focus.
- [x] Clicking a message to edit should not feel delayed by `requestAnimationFrame`
  focus scheduling or bottom-composer header/footer measurement.

Function and helper decisions:

- [x] Keep `ComposerPromptEditor` as a real boundary. TipTap/ProseMirror node
  mapping, atom text serialization, cursor conversion, multiline measurement,
  and controlled editor sync cannot be replaced by a browser primitive.
- [x] Keep `useComposerImageAttachments` as a real boundary. Drag/paste/file
  input handling, attachment limits, blob preview URLs, and persisted data URL
  fallback are one browser workflow.
- [x] Keep `readFileAsDataUrl`; the browser still exposes data URL reads through
  `FileReader`, so the wrapper names the async boundary rather than reimplementing
  a native API.
- [x] Keep `useComposerCommandMenu` while it owns query debounce, project file
  lookup, provider slash commands, skills, active item resolution, and loading
  state. It should not become a presentational wrapper.
- [x] Keep provider/model state behind `useComposerModelState` while it joins
  draft selection, provider snapshots, model options, prompt-injected effort,
  and context-window visibility.
- [x] Remove call-site no-op props from inline edit. Pending approval/input
  behavior is optional composer capability, not a requirement every composer
  surface must fake.
- [x] Remove parent-provided `focusComposer` / `scheduleComposerFocus` props
  from `ComposerInput`; the component owns the prompt editor ref and can focus
  itself.
- [x] Remove unused list wrappers that only return `null` for empty input. Keep
  only the chip primitive when it is still used by the editor node view.
- [x] Prefer central-icons over handwritten button glyphs when a matching icon
  exists.
- [x] Delete `packages/app/src/lib/pierre-shiki-theme.ts`. It had one caller,
  so the Pierre tree theme adapter now lives inside `components/tree.tsx`, the
  only wrapper that needs `@pierre/trees` host CSS variables.
- [x] Delete `packages/app/src/lib/pierre-workbench-code-css.ts`. The shared
  unsafe CSS string now lives in `lib/diff-rendering.ts` next to the Pierre code
  theme resolver used by diff and source-preview embeds.
- [x] Keep `thread-sort.ts` as a domain policy boundary while sidebar,
  command palette, and project command actions all need the same thread
  ordering rule: configured creation order or latest user-message recency, with
  deterministic ID tie breaks.
- [x] Delete `packages/app/src/lib/shell-runtime-constants.ts`. Its composer
  event export was unused; the remaining shell-layout event belongs to
  `lib/project-state.ts`, the only module that writes the stored project cwd.
- [x] Delete `packages/app/src/lib/terminal-shell-caption.ts`. It had one
  caller; the terminal subtitle helper now lives beside
  `TerminalWorkbenchPanel` in `components/shell-host.tsx`.
- [x] Delete `packages/app/src/lib/window-controls-overlay.ts`. Electron window
  controls overlay wiring is a one-time app boot concern and now lives directly
  in `main.tsx`.
- [x] Delete `packages/app/src/lib/path-label.ts`. Its one exported function
  only labels sidebar project groups, so the helper now lives inside
  `lib/sidebar-chat-view-model.ts`.
- [x] Remove the production inline dynamic import from `local-api.ts` test
  reset wiring. Browser specs now reset client settings through a top-level
  import from `hooks/use-settings.ts`.
- [x] Delete `packages/app/src/client-persistence-storage.ts`. It had one
  caller; browser client-settings fallback persistence now lives in
  `local-api.ts`, the boundary that chooses desktop bridge versus browser
  localStorage.
- [x] Move root provider/model helper files into `packages/app/src/model/*`.
  Model ordering, provider instances, provider models, app selection, and
  composer selection are one model core cluster, not generic root utilities.
- [x] Move markdown file-link parsing into
  `components/chat/markdown/file-links.ts`, next to the renderer that consumes
  it.
- [x] Remove root thread store files. `store.ts` became
  `stores/thread-store.ts`, `store-selectors.ts` became
  `stores/thread-selectors.ts`, `thread-sync.ts` became
  `stores/thread-sync.ts`, and `thread-state.ts` was collapsed into the thread
  store module.
- [x] Move root `timestamp-format.ts` into `lib/timestamp-format.ts`; it is a
  UI formatting helper, not an app entry boundary.
- [x] Delete QR code generator surfaces:
  `packages/shared/src/qr-code.ts`, `packages/ui/src/qr-code.tsx`, and
  `packages/ui/test/qr-code.test.tsx`. The UI QR component had no product
  caller; the shared vendored generator only supported terminal QR output for
  headless pairing.
- [x] Rewire headless auth URLs away from deleted `/pair` UI. Server startup
  and CLI formatting now emit root bootstrap URLs like `/#token=...`, matching
  the app bootstrap parser.
- [x] Remove root `composer-*` files. Draft persistence and queued-send state
  are stores, while prompt document parsing, prompt segment parsing, cursor
  logic, and composer handle context are owned by `components/chat/composer`.
- [x] Rename generic text-measurement hooks without composer branding. The
  Pretext one-line hook is a generic UI helper consumed by `PretextOneLine`,
  not part of the composer domain.
- [x] Delete Cursor composer patch scripts after research is captured here.
  Multi should not carry local Cursor app patch artifacts as product code.

Canonical rewrite shape:

- [x] Keep `components/chat/composer/input.tsx` as the one file that owns the composer shell:
  root/container markup, single-line versus multiline state, footer row,
  compact overflow menu, mode/access controls, and primary actions.
- [x] Keep specialized implementation files only when they own a hard boundary:
  rich text editor behavior, command menu rendering, image attachments, pending
  approvals/input panels, provider picker, and provider traits.
- [x] Delete shell-only composer files after their behavior is inlined:
  prompt root/toolbar wrappers, footer shell wrappers, compact controls menu,
  footer mode controls, and primary actions.
- [x] Replace `.agent-window ... composer` styling with component-local
  Tailwind utilities and delete the composer-specific stylesheet.
- [x] Keep popover/menu components composable through props; do not inline model
  picker, command menu, or provider trait internals into the composer shell.

Rules:

- [x] Do not create a second composer implementation for "new agent" versus
  "thread"; keep one component with explicit state inputs.
- [x] Do not return `null` from a composer shell component just to suppress a
  state; delete the file or move the condition to the caller.
- [x] Single-line thread mode is row layout: attachment/input/model/menu/send
  stay on the same line and inside the composer border.
- [x] Multiline thread mode is stacked layout: editor grows to the same max
  height as new-agent state, then inner editor scroll takes over.
- [x] New-agent/hero state is fixed-height enough to prevent page/control
  reflow; overflow belongs to the inner editor, not the outer shell.
- [x] Toolbar rows use `justify-between` without negative margins or scroll
  bleed. Popovers may escape; toolbar buttons may not.
- [ ] Model, traits, access, mode, and send controls use props and shared
  primitives; no local redeclaration aliases when the value can be passed
  inline or imported directly.
- [x] Inline message edit uses the canonical composer inset directly. Cancel
  belongs inside the same bordered composer surface, and pending approval/input
  props are omitted rather than faked with no-op callbacks.
- [x] Plan follow-up text can refine the plan, but implementing a plan is the
  side-panel primary action, not a composer split action.
- [x] `agent-window` selector coupling is not allowed in composer layout CSS.

Done means:

- [x] Shell-only composer wrapper files are deleted or proven to own a real
  boundary.
- [ ] The compact thread composer renders one visual row when the editor is one
  line tall.
- [ ] The compact thread composer switches to stacked multiline layout when the
  editor exceeds one line, and switches back after deletion.
- [ ] The new-agent/hero composer has fixed outer dimensions with inner editor
  scroll and an inset bottom toolbar.
- [ ] Clicking an editable sent user bubble replaces that message row with the
  edit composer; sticky-row behavior remains a single row, not a duplicate.
- [ ] Footer controls stay within the composer border at desktop, tablet, and
  mobile widths.
- [x] `Open Plan`, chat plan card primary actions, and composer-side plan
  implementation controls remain absent.
- [x] `pnpm run typecheck` passes after the composer slice.

## ERROR: Error Boundaries

Goal:

- Expected failures are typed and rendered clearly.
- UI boundaries show useful, structured errors.
- Server/HTTP boundaries translate domain errors at the boundary.

Rules adapted from opencode:

- [ ] Expected domain failures use typed error classes or discriminated result
  unions.
- [ ] Defects are for bugs, impossible states, and unknown final fallbacks.
- [ ] Service/domain modules do not import route-specific HTTP status or UI
  rendering code.
- [ ] Route/server handlers translate domain errors into public response shapes.
- [ ] UI renderers format structured errors instead of showing opaque
  `Error: Name` strings.
- [ ] Shared error mappers stay small and boundary-specific.

Multi early slices:

- [ ] Provider/model selection failures.
- [ ] Git/worktree action failures.
- [ ] Server auth/bootstrap failures that remain after browser pairing removal.
- [ ] Settings persistence failures.

Done means:

- [ ] One error vocabulary exists per kept domain.
- [ ] User-visible failures render actionably.
- [ ] Generic middleware or UI fallback code does not grow domain-specific name
  checks.

## SCHEMA: Domain Models And Contracts

Goal:

- One source of truth for domain IDs, DTOs, IPC payloads, and route inputs.
- Boundary schemas are narrow and intentional.

Rules adapted from opencode:

- [ ] Use schema-backed branded IDs for stable domain identifiers.
- [ ] Use exported schema/classes for public contract objects.
- [ ] Use local structs/types for internal component-only shapes.
- [ ] Do not duplicate app, desktop, and contract shapes by hand.
- [ ] IPC contracts live in `packages/contracts`; app/desktop code consumes
  them.
- [ ] Browser-only persistence schemas are removed when browser persistence is
  not a product boundary.

Done means:

- [ ] Removed product surfaces have no stale contract schemas.
- [ ] Kept IPC methods have one schema source.
- [ ] Public contract changes are intentional and reflected in all consumers.

## UI: Shell Usability

Goal:

- App layout behavior is tested as users see it.
- Usability is a foundation, not a late polish step.

Rules:

- [ ] Rendered shell tests cover desktop, tablet, and mobile widths.
- [ ] Sidebar/workbench collapse order is verified in the DOM.
- [ ] Row actions, rename state, and composer controls are verified at real
  rendered sizes.
- [ ] CSS string tests may guard invariants, but they do not replace rendered
  behavior checks.
- [ ] Controls should be product controls, not explanatory text about controls.

Done means:

- [ ] AppShell viewport coverage exists for kept layout behavior.
- [ ] Removed surfaces do not leave tests for deleted UI.
- [ ] Tests fail on real overlap/collapse regressions.

## TEST: Verification Foundation

Goal:

- Tests follow kept product behavior.
- Deleting code deletes its helper tests.
- New tests are integration-style when the risk is user-visible.

Rules:

- [ ] Do not add tests to justify keeping dead architecture.
- [ ] Do not keep helper tests for deleted `.logic.ts` files.
- [ ] Prefer browser/rendered tests for shell, settings, model picker, and
  composer workflows.
- [ ] Prefer focused core tests for provider/model fallback matrices.
- [ ] Run only the specific test when creating or modifying a test.
- [ ] Use `pnpm run typecheck` as the broad verifier for code changes.

Done means:

- [ ] Verification maps to current user-visible behavior or current core logic.
- [ ] No tests import deleted saved/remote/pairing surfaces.
- [ ] Typecheck and targeted tests agree with the kept architecture.

## EFFECT: Runtime And Service Boundaries

Goal:

- Effect exists where it makes runtime/service boundaries clearer.
- React/component-local code stays plain React.
- Runtime-backed facades are removed unless the boundary is intentional.

Rules adapted from opencode:

- [ ] One service module per real service boundary.
- [ ] No service-local runtime facades for convenience.
- [ ] Plain async/React callers should not get wrapped in Effect just to look
  consistent.
- [ ] Effects should run through established runtime boundaries.
- [ ] Expected service failures live on the error channel or return typed
  results; defects remain defects.
- [ ] Helpers stay file-local unless multiple current callers need them.

Done means:

- [ ] Runtime/facade callsites have an inventory.
- [ ] Deleted facades have no production or test callers.
- [ ] Remaining Effect modules own real service boundaries.

## DELETE: Deletion Discipline

Goal:

- Deletion is safe because it is inventoried, not because compatibility shims
  hide leftovers.

Rules:

- [ ] Build a caller inventory before deleting a product surface.
- [ ] Mark intentional exclusions.
- [ ] Delete route, UI, runtime, persistence, IPC, contract, and test surfaces
  together when they serve the same removed product path.
- [ ] Prefer grep gates over broad test suites for deleted-symbol evidence.
- [ ] Do not preserve backward compatibility for unreleased code unless the user
  asks for it.
- [ ] Knip is a strict cleanup gate: all issue families are errors, entry
  exports are included, test/browser specs are modeled instead of globally
  ignored, and a production-only gate catches code reachable only from tests.

Done means:

- [ ] Each deletion wave has a before/after symbol grep.
- [ ] Each wave updates this foundation doc or the slimming execution spec.
- [ ] `pnpm run knip` and `pnpm run knip:production` are available as strict
  inventory gates.
- [ ] Typecheck passes after rewiring.

## Foundation Checklist

- [x] Use opencode specs as the model for Multi foundations.
- [x] Create named Multi tracks for errors, models, routes, runtime, UI, tests,
  Effect, observability, and deletion.
- [x] Separate durable architecture rules from the deletion execution ledger.
- [x] Implement `ENV` Wave 1 and check off the corresponding done criteria.
- [x] Implement `OBS` browser/debug tracing removal and check off the
  corresponding done criteria.
- [ ] Implement `MODEL` consolidation.
- [ ] Implement `PLAN` plain React collapse.
- [ ] Implement `COMPOSER` canonical compact/expanded layout.
- [ ] Implement `UI` rendered shell verification.
- [ ] Implement `ERROR` and `SCHEMA` slices as code touches those boundaries.
