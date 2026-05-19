# Implementation Notes

Running notes for the provider rewrite toward the canonical supported list:
Codex/OpenAI, Claude, OpenCode, Cursor, and Pi pending only.

## Decisions

- Use `pi` as the pending Pi driver key. It remains UI-only pending until a
  provider contract and adapter exist.
- Keep the existing `claudeAgent` driver key for Claude because it is already a
  persisted supported key in contracts, settings, and sessions.
- Keep the existing `cursor` driver key as canonical. Cursor was not supposed
  to be removed; the current requirement makes Cursor one of the supported
  providers and one of the two ACP-focused providers.
- Keep Cursor ACP capability discovery in place. Cursor needs the
  parameterized model picker client capability during initialize, and Multi's
  model picker should consume Cursor's discovered config options instead of
  inventing separate UI policy.
- Treat Cursor model capabilities as live ACP facts. `null` means "not probed
  yet"; an empty descriptor list means "probed and no options." The provider
  registry must not copy stale option descriptors onto refreshed Cursor models,
  because that can re-enable unsupported thinking/reasoning controls.
- Preserve Cursor ACP model-selection failure context. Base model failures are
  surfaced as `session/set_model`; option update failures are surfaced as
  `session/set_config_option`, so logs and UI errors do not mislabel the broken
  step.
- Do not trust Cursor ACP config echoes as the source of truth immediately
  after a successful config write. A provider log showed Cursor accepting
  `model=composer-2.5` while the response still reported
  `currentValue=kimi-k2.5`; Multi now records the requested value locally so it
  does not resend the same accepted model update on every turn. The refreshed
  `t3code` mirror still trusts the ACP response directly, so Multi intentionally
  diverges here based on the captured Cursor behavior.
- Keep `packages/contracts/src/model.ts` schema-only. Provider model catalogs,
  aliases, and per-provider defaults must not live in contracts because Cursor
  can add models such as Composer 2.5 through its own model/config discovery
  without a Multi contract release.

## Tradeoffs

- Pi is represented as pending in settings/model picker UI only. It is not
  registered in server provider or adapter lists, so session routing still
  fails clearly if someone manually persists a `pi` instance.
- Cursor remains a built-in provider despite being ACP-backed. The unsupported
  pending affordance is only for Pi.
- Removing contract-level model aliases means shorthand inputs such as `sonnet`
  are no longer canonical unless the provider catalog itself exposes that name.
  This keeps user selection resolution tied to live provider facts.

## Changes To Watch

- Existing dirty work unrelated to the provider rewrite remains untouched.
- `scripts/oxlint-plugin-multi.js` had prior in-progress changes before this
  provider rewrite and still needs its own verification later.
- Noncanonical coming-soon providers such as Gemini, GitHub Copilot, and ACP
  Registry should be removed from the active settings/picker surfaces. Pi is
  the only pending placeholder in the canonical list.
- The app Vite shared config split must keep `packages/app/vite.shared.ts`
  inside the app tsconfig include list, and helper return types must be
  concrete rather than `UserConfig[...] | undefined` because the repo enables
  `exactOptionalPropertyTypes`.

## Chat View Source Findings

- Cursor renders work/tool activity through grouped AI activity rows derived
  from conversation headers. The group is part of the pair grouping model, not
  an extra assistant-message card.
- Cursor caches completed turn grouping by a signature including pair index,
  bubble ids, pending decisions, grouped text length, density, shell grouping,
  and collapse mode. That cache avoids regrouping old completed turns during
  navigation.
- Cursor's compact `ToolCallLine` emits action/details spans. The CSS owns
  line layout: `display: flex`, `gap: 4px`, `white-space: nowrap`,
  `overflow: hidden`, `text-overflow: ellipsis`, and tabular numbers.
- Cursor shell rows use a richer shell renderer. The compact line summary is
  built as `Ran`/`Running` plus a details node with a command description and
  optional summary. Command output expansion can use measured layout, but the
  collapsed work-line text itself is not pretext-measured.
- Cursor chat spacing is mostly zero between grouped message/tool rows:
  `.composer-message-group` margins are forced to zero, and tool-former rows
  with `ui-tool-call-line`, `composer-tool-call-inline`, or `ui-shell-tool-call`
  also collapse vertical margins.
- Cursor keeps conversation variables on the message container:
  `--conversation-font-size`, `--conversation-text-inset`, and
  `--conversation-tool-card-padding-x` drive the compact chat row rhythm.

## Chat Rewrite Decisions

- Reintroduce `Worked for <duration>` only as part of a single canonical work
  group row. Do not bring back the old separate `worked-header` row type or
  assistant-turn wrapper.
- Keep work-group expansion local to the timeline render tree. There is no
  persisted UI state because the work group is transcript presentation, not a
  user preference.
- Keep command/project-action terminal behavior on the shell workbench terminal
  (`components/shell/terminal/panel.tsx`). Project actions target the
  workbench terminal thread for the target cwd and the active shell terminal id;
  using chat/thread terminal state is the broken behavior.
- Remove `PretextOneLine` from compact tool-call rows. It recalculates on
  navigation/layout and creates visible truncation churn; CSS overflow is the
  canonical behavior for this surface.
- Make compact command/tool rows expose the full chat lane for stable
  truncation, but keep the visible action/details/chevron cluster intrinsic up
  to `max-width: 100%`.
- Keep expandable-row chevrons adjacent to the visible text cluster. Do not use
  `justify-between`, `ml-auto`, or a `flex-1` text cluster that turns the
  chevron into a far-right column.

## Chat Rewrite Tradeoffs

- The group summary is derived from available `WorkLogEntry` facts. When an
  entry does not expose a precise file/read/search kind, the summary falls back
  to `Worked N steps` instead of guessing.

## Effect Logic Cleanup

- `packages/server/src/http.ts` attachment route expected failures now use
  route-local tagged errors instead of inline ad hoc text returns.
- The public wire behavior is intentionally unchanged for that route:
  `Bad Request`, `Invalid attachment path`, `Not Found`, and
  `Internal Server Error` still map to the same status codes.
- `packages/server/src/http.ts` project favicon and static/dev expected
  failures now use route-local tagged errors instead of inline ad hoc text
  returns. Public text/status responses are intentionally unchanged, including
  fallback favicon SVG success and SPA index fallback behavior.
- The environment descriptor route was left unchanged because its descriptor
  service is currently infallible; there is no route-local expected failure
  branch to translate.
- I did not add a generic route error registry. The mapping remains local to the
  route group, matching the effect spec.
- `packages/server/src/git/OpenCodeTextGeneration.ts` no longer throws generic
  `Error` values for expected OpenCode text-generation failures. SDK rejections
  flow through `runOpenCodeSdk` and are mapped to `TextGenerationError`; missing
  session data, prompt error info, and empty output now fail directly as
  `TextGenerationError`.
- Terminal PTY write/resize failures now map through
  `TerminalProcessOperationError`, a public `TerminalError` branch. This keeps
  Bun PTY unavailable-handle failures on the terminal service error channel
  instead of surfacing as defects from user-triggered write/resize operations.
- Terminal PTY spawn adapter failures now map through `PtySpawnError` in both
  `NodePTY` and `BunPTY`, so native spawn exceptions stay on the adapter error
  channel and the terminal manager can preserve shell fallback handling.
- Bun PTY's Windows unavailable path now returns an adapter whose `spawn`
  fails with `PtySpawnError` instead of dying during layer construction.
- Server helper inventory was rerun for the remaining one-off candidates.
  Filesystem, attachment, image MIME, path expansion, startup access, lifecycle
  events, and package script helpers were classified as real boundaries. The
  auth CLI formatter is still a one-caller helper, but it has direct formatter
  tests, so inlining it is deferred until those assertions move to CLI behavior
  coverage.
- The one-caller `PretextOneLine` wrapper and `use-pretext-one-line` hook were
  deleted. The Git diff header now uses CSS ellipsis on its existing
  filename-first label, and the app no longer depends on `@chenglou/pretext`.
- The composer slash menu no longer uses a direct layout effect to query and
  scroll the active command row. The active row scrolls itself into view through
  an item-local callback ref when it becomes active.
- Human message overflow collapse no longer uses a direct layout effect for
  measurement. The measured content element now performs its initial overflow
  check and owns `ResizeObserver` cleanup through a React 19 callback ref.
- Composer `/model` trigger handling no longer uses a direct layout effect as an
  action relay. Prompt update paths now route through `applyComposerTrigger`,
  remove the typed trigger range, and open the model picker with the typed
  search seed at event time.
- Model picker open initialization no longer uses a direct layout effect. A
  keyed `ModelPickerOpenSync` child now owns the open-time rail reset, search
  seed, and deferred input focus through the mount-only effect wrapper.
- Prompt editor direct layout effects are now isolated in editor-owned
  integration hooks: `usePromptEditorControlledStateSync` owns controlled
  TipTap document/selection reconciliation, and
  `usePromptEditorMultilineMeasurement` owns the `ResizeObserver` measurement
  path.
- Root `packages/app/src/ws-rpc-client.ts` was deleted. Environment-scoped RPC
  client lookup now belongs to `environments/runtime`, while raw websocket RPC
  client construction and types remain under `rpc/ws-rpc-client.ts`.
- Direct app `useLayoutEffect` calls now go through
  `hooks/use-layout-sync-effect.ts`, and the local oxlint rule rejects direct
  `useEffect` / `useLayoutEffect` usage outside the wrapper files.
- `messages-timeline.browser.tsx` proves work-group layout: collapsed summary
  visible without expand, live preview while running+collapsed, and chevron
  adjacency on expanded tool rows.
- The remaining production `Effect.die` cleanup pass converted the Node sqlite
  compatibility check, provider event provider-mismatch guard, and provider
  command reactor thread lookup misses to typed expected errors.
- Thinking work rows now derive task completion from orchestration activity
  lifecycle payloads. Task lifecycle entries collapse by `taskId`, carry
  `completedAt`, split from tool work rows, and render completed headers as
  `Thought briefly` or `Thought for <duration>`.
- Inline tool diffs now use the shared `@pierre/diffs/react` `Virtualizer`
  around parsed `FileDiff` rows, so large per-edit patches avoid mounting every
  file diff at once while preserving the raw-patch fallback.

## Timeline (open gaps)

- `expandedWorkGroupIds`: `id in set` = explicitly expanded; default
  collapsed. Ephemeral only.
- `WorkGroupPreview` is colocated in `messages-timeline.tsx` (single call site).
  Preview auto-scroll and `data-work-preview-scrollable` use
  `useLayoutSyncEffect` + `ResizeObserver`.
- Preview pane is not virtualized internally; 144px cap keeps entry count small.
