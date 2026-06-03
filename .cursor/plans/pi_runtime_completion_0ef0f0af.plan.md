---
name: Pi Runtime Completion
overview: "Identify and finish the missing work from `implementation-html/pi-sdk-migration-research.html`: the current branch has a Pi runtime package and a partial IPC/settings bridge, but the app still mostly runs through provider/server-era orchestration."
todos:
  - id: wire-composer-runtime
    content: Route composer new-thread and send flows through `MultiRuntimeApi.startThread` and `MultiRuntimeApi.send`.
    status: completed
  - id: project-runtime-events
    content: Expand runtime event projection and app ingestion so Pi events drive timeline, activities, queue, tree, and pending UI.
    status: completed
  - id: implement-policy-auth
    content: Implement full AgentPreferences, AgentModePolicy, Pi AuthStorage, and fixed all-access Pi posture.
    status: completed
  - id: rewrite-agent-ui
    content: Replace provider settings/model picker surfaces with Agent preferences, account rows, Agent Mode, Interaction Mode, and diagnostics.
    status: completed
  - id: add-pi-extensions
    content: Add ask-user, plan mode, and subagent Pi extensions with desktop UI backing.
    status: completed
  - id: prune-old-architecture
    content: Delete provider/server/client-runtime/generated protocol paths after imports are gone.
    status: completed
  - id: verify-target-tests
    content: Run typecheck and add focused runtime/app tests from the first-wave list.
    status: completed
isProject: false
---

# Finish Pi Runtime Rewrite

## Current State

The Pi runtime path is now wired through the desktop runtime bridge:

- [packages/desktop/src/preload.ts](packages/desktop/src/preload.ts) exposes `window.multiRuntime`.
- [packages/desktop/src/ipc/methods/runtime.ts](packages/desktop/src/ipc/methods/runtime.ts) wires runtime host methods, including image-capable sends and abort.
- [packages/app/src/stores/agent-runtime-store.ts](packages/app/src/stores/agent-runtime-store.ts) subscribes to runtime host events.
- [packages/runtime](packages/runtime) contains `DesktopRuntimeHost`, `ThreadAgentRuntime`, event projection, extension UI, session-tree projection, ask-user backing, plan capture, and embedded subagent sessions.
- Broken Pi runtime sessions are cleaned up on failed/replaced starts: the host serializes same-thread starts, disposes partially started sessions, prunes stale runtime events/session trees/pending extension UI, and the app marks disappeared Pi runtime sessions closed instead of leaving them live.

Runtime policy now separates requested model intent from observed Pi session identity. `AgentModelPolicy.modelSelection` is either `{ type: "pi-managed" }` when Multi omits an explicit model and lets Pi choose from settings/availability, or `{ type: "explicit", authProviderId, accountId, modelId }` when a concrete Pi model is selected. Runtime identity still reports nullable auth/account/model fields because Pi types `AgentSession.model` as possibly undefined until a session has a resolved model.

The old provider architecture is no longer the active send path and no longer exports live compatibility contracts. [packages/app/src/components/chat/view/chat-view.tsx](packages/app/src/components/chat/view/chat-view.tsx) sends turns through `MultiRuntimeApi.send`; orchestration commands remain for thread/project metadata, draft promotion, plan edits, approvals, and legacy database fields. `packages/server` remains as the durable backend/CLI package, but server provider adapters, provider runtime ingestion/reactors, provider session runtime persistence, generated ACP/Codex protocol packages, and provider contract modules are deleted.

The desktop dev runner now keeps `MULTI_PORT` for the desktop backend child but clears `VITE_HTTP_URL`/`VITE_WS_URL` in `dev:desktop`, so the renderer follows the desktop bridge/bootstrap path instead of stale web backend URLs. It also preflights `turbo run build --filter=usemulti --ui=stream` before Electron launch, because desktop dev starts the backend from `packages/server/dist/bin.mjs`; this prevents stale backend code after contracts/server changes. The `dev:desktop` Turbo renderer is forced to `--ui=stream` to avoid garbled nested TUI output. `scripts/dev-runner.test.ts` covers desktop/web env derivation and the desktop preflight/stream args.

The desktop Electron bundle now follows the opencode-style invariant that Electron artifacts should have a narrow runtime surface and no unstaged workspace package imports:

- The updated `opencode` codebase mirror confirmed their desktop flow uses a self-contained main/preload/sidecar bundle and only narrow native externalization. Multi keeps `tsdown` instead of switching to `electron-vite`, because the current split is explicit: main emits ESM `dist-electron/main.mjs`, preload emits CJS `dist-electron/preload.cjs`.
- `packages/desktop/src/ipc/methods/runtime.ts` lazy-loads `@multi/runtime` at the runtime IPC boundary, so Pi packages are isolated in a generated runtime chunk and not imported by Electron main at cold startup.
- `packages/desktop/package.json` declares the Pi packages that remain external from the runtime chunk, so local dev and smoke Electron resolve them from `packages/desktop/node_modules`.
- `packages/server/tsdown.config.ts` no longer has to bundle generated provider protocol workspace packages because `packages/effect-acp` and `packages/effect-codex-app-server` are deleted.
- `scripts/build-desktop-artifact.ts` stages installable production dependencies only, merges Pi runtime package dependencies, points the synthetic package at `packages/desktop/dist-electron/main.mjs`, and allowlists only the staged package manifest, node modules, desktop dist/resources, and server dist for electron-builder packaging.
- `packages/desktop/scripts/dev-electron.mjs` watches generated ESM/CJS chunks as well as `main.mjs` and `preload.cjs`, so lazy runtime chunk changes restart the dev Electron process.

Legacy persisted interaction modes are now canonicalized: `AgentInteractionMode` decodes old `"default"` values as `"agent"`, fresh projection schemas default to `"agent"`, and migration `033_NormalizeInteractionModeDefaults` rewrites stale `projection_threads.interaction_mode` rows and orchestration event payloads.

Pruning status:

- Folder and package pruning is complete for disconnected provider-era boundaries: `packages/client-runtime`, `packages/effect-acp`, `packages/effect-codex-app-server`, app provider picker/model/settings helpers, and `packages/server/src/provider` are deleted.
- Provider-driver contracts are deleted: `packages/contracts/src/provider.ts`, `packages/contracts/src/provider-instance.ts`, and `packages/contracts/src/provider-runtime.ts`.
- Formerly shared runtime helpers now live behind runtime names: `packages/contracts/src/runtime-events.ts` carries lifecycle/runtime item helpers, `packages/contracts/src/interaction-mode.ts` carries `AgentInteractionMode`, and model option schemas are `ModelOption*`.
- Orchestration websocket/RPC provider compatibility schemas are removed: there is no provider thread snapshot RPC, provider runtime stream item, provider session runtime status, provider status payload, or provider metadata path in live contracts.
- Server provider adapters, provider runtime ingestion, provider command reactor, provider session runtime persistence, provider metrics, and provider log/config paths are removed.
- Runtime-emitted Pi subagent details now use `subagentThreadId`, `parentThreadId`, and runtime item ids; app-local subagent state and tray keys use subagent thread identity rather than provider-thread compatibility names.
- App/UI composer state no longer carries provider-era `runtimeMode`: composer drafts, draft sessions, queued sends, send snapshots, inline edit submissions, route-created draft sessions, and queue demo fixtures all omit it. `DEFAULT_RUNTIME_MODE` remains only where the app materializes compatibility thread read models or sends `thread.create` payloads that still require the contract field.
- `packages/server` remains as the durable backend/CLI package for orchestration metadata, persistence, project/git/terminal/auth, websocket publishing, and lifecycle; it is no longer a provider adapter/runtime package.
- Historical migrations still reference provider-era table, column, and event names so existing databases can migrate old rows.

Latest verification:

- `pnpm dev:desktop`: reproduced the next persisted-data issue, then passed backend startup after migration `036_NormalizeSubagentActivityPayloadThreadIds`; the backend reached `backend ready` and no further projection decode loop appeared during the follow-up wait.
- `/Users/workgyver/.multi/dev/state.sqlite` verification after `pnpm dev:desktop`: `providerThreadId` remains in 0 subagent projection rows/events, and 0 subagent projection rows/events are missing `subagentThreadId`.
- `pnpm --filter usemulti run build`: passed after adding migrations `034_NormalizeProviderActivityFailureKinds`, `035_DropProviderSessionSchemaResidue`, and `036_NormalizeSubagentActivityPayloadThreadIds`, so `packages/server/dist/bin.mjs` rewrites persisted provider failure kinds, drops inert provider session schema residue, and normalizes old subagent payload thread-id keys before the current projection decoder reads rows.
- `pnpm run typecheck`: passed across 8 packages after adding the provider-to-runtime persisted activity kind migration, provider session schema cleanup migration, and subagent payload thread-id migration.
- `pnpm --filter @multi/contracts run build`: passed; regenerated the ignored `packages/contracts/dist` CJS/ESM/dts outputs so stale provider contract exports are gone from the runtime package surface.
- `pnpm run typecheck`: passed across 8 packages after the final contract build and provider-contract symbol audit.
- `pnpm test dev-runner.test.ts` from `scripts`: passed.
- `pnpm run build:desktop`: passed; desktop main emitted `dist-electron/main.mjs` around 322 kB plus a lazy runtime chunk around 56 kB, with no Pi TUI or `import.meta.resolve` bundling warning.
- Generated bundle checks passed: `packages/desktop/dist-electron/main.mjs` dynamically imports the runtime chunk, Pi imports appear only in that chunk, and `packages/server/dist/bin.mjs` has no runtime imports from `effect-acp/*` or `effect-codex-app-server/*`.
- `pnpm --dir packages/desktop run smoke-test`: passed.
- `pnpm run typecheck`: passed across 10 packages.
- `pnpm --dir packages/runtime exec vitest run test/agent-mode-policy.test.ts test/desktop-runtime-host.test.ts`: passed.
- `pnpm run typecheck`: passed across 10 packages after the canonical model-policy/app-prune slice.
- `pnpm --dir packages/runtime exec vitest run test/thread-agent-runtime.tools.test.ts`: passed after the runtime subagent detail rename.
- `pnpm run typecheck`: passed across 10 packages after the command-palette/client-runtime naming/subagent detail slice.
- `pnpm run typecheck`: passed across 10 packages after removing app/UI runtime-mode draft and queue state.
- `pnpm run typecheck`: passed across 10 packages after renaming app runtime-event ingestion and the shared runtime event contract from provider-runtime naming.
- `pnpm run typecheck`: passed across 10 packages after confirming the folder-level removals and restoring the provider snapshot compatibility contract names.
- `pnpm run typecheck`: passed across 10 packages after cleaning ignored protocol package `dist`/`.turbo` output folders.
- `pnpm run typecheck`: passed across 8 packages after deleting provider contract modules and provider/server compatibility schemas.
- `pnpm --dir packages/app exec vitest run src/components/settings/agent-preferences.test.tsx src/components/chat/extension-ui-panel.test.tsx src/environments/primary/target.test.ts src/stores/agent-runtime-store.test.ts src/stores/thread-sync.test.ts`: passed, 5 files / 12 tests.
- `pnpm --dir packages/runtime exec vitest run test/agent-mode-policy.test.ts test/desktop-extension-ui.test.ts test/desktop-runtime-host.test.ts test/pi-session-tree.contract.test.ts test/thread-agent-runtime.interaction-mode.test.ts test/thread-agent-runtime.lifecycle.test.ts test/thread-agent-runtime.queue.test.ts test/thread-agent-runtime.tools.test.ts`: passed, 8 files / 24 tests.

## Subagent Reference Pack

Use [implementation-html/pi-sdk-migration-research.html](implementation-html/pi-sdk-migration-research.html) as the source of truth. Subagents should reference these sections directly:

- `#new-architecture`: target module shape and identity model.
- `#desktop-ui`: product surface, current UI mismatches, preference page shape, GUI mapping, and implementation order.
- `#implementation-snippets`: concrete contract/runtime/UI snippets intended as first-pass source modules.
- `#ask-plan` and `#ask-tool-demo`: Ask, Plan, Debug, and ask-user extension behavior.
- `#multi-inventory`: deletion/pruning matrix for app, server, contracts, shared, client-runtime, generated protocol packages, scripts, and desktop backend.
- `#pi-test-reuse`: first-wave tests and which Pi tests should be reused or translated.
- `#rewrite`: ordered 14-step rewrite checklist.
- `#risks`: implementation risks and mitigations that should become acceptance checks.

Concrete targets from the HTML:

- `DesktopRuntimeHost` should own the local Effect runtime, SQLite, Pi sessions, project/git/terminal services, and event pubsub. It should live at [packages/runtime/src/desktop-runtime-host.ts](packages/runtime/src/desktop-runtime-host.ts), with no TCP listener by default.
- `MultiRuntimeApi` should be the typed preload contract for renderer requests and streams. The HTML places this at `packages/contracts/src/runtime-api.ts`; the current implementation has a partial version in [packages/contracts/src/runtime.ts](packages/contracts/src/runtime.ts).
- `ThreadAgentRuntime` should own Pi harness sessions plus send, steer, follow-up, abort, compact, tree navigation, and event subscription. The HTML target is `packages/runtime/src/agent/thread-agent-runtime.ts`; current code is [packages/runtime/src/thread-agent-runtime.ts](packages/runtime/src/thread-agent-runtime.ts).
- `AgentHarnessFactory` should create Pi `AgentHarness`/session instances per Multi thread, binding cwd, session file, model, tools, resource loader, settings, and lifecycle scope.
- `AgentModePolicy` should map Agent Mode, Interaction Mode, roles, and account state to Pi `ModelRegistry`, effective thinking level, prompt preset, tool posture, and permission posture.
- `AgentRuntimeProjector` should map Pi `AgentSessionEvent`, `AgentEvent`, assistant message events, tool details, queue, compaction, and errors to `AgentRuntimeEvent`.
- `AuthGateway` should own GUI login, API-key storage, OAuth browser/device-code flows, refresh, and provider status for Claude API Key, Codex OAuth, Codex API Key, and xAI API Key.
- Multi should not add a permission gate over Pi tool calls. The desktop Pi runtime runs all-access, and explicit user-input flows go through Pi extensions such as `ask_user`.
- `DesktopAgentExtensions` should register ask user, proposed plan, subagent, thread reference, git checkpoint, and MCP tool gateway extensions.

Identity and policy details from the HTML:

- Runtime identity should separate `agentRuntime`, `authProviderId`, `modelId`, `accountId`, `threadId`, and `piSessionId`.
- Auth providers should be `anthropic`, `openai-codex`, `openai`, and `xai`; Codex API key may internally map to `openai` if billing/auth semantics require it.
- Agent Modes should be `rush`, `smart`, and `deep`.
- Interaction Modes should be `agent`, `ask`, `plan`, and `debug`; the default agent mode is unlabeled in the GUI.
- Roles should include `main`, `oracle`, `review`, `librarian`, and `subagent`.
- The user should choose account and intent, not a generic Pi provider/model marketplace.

Desktop UI requirements from the HTML:

- Replace `settings-panels.tsx` provider instances, driver options, model picker, runtime modes, and `@multi/client-runtime` scoped refs with a Pi Agent preferences page.
- Delete dynamic provider-driver forms such as provider settings forms. Curated account rows are fixed product UI.
- Replace `ProviderModelPicker` with Agent Mode and Interaction Mode controls.
- Replace provider-era runtime modes like full access, auto-accept edits, and supervised with interaction modes plus permission/subagent policy rows.
- Expand send-while-running to Pi-native delivery: queue, steer, follow-up, and stop-and-send.
- Replace provider status cards with Pi auth/model diagnostics: active lane, auth source, OAuth expiry, API-key configured, model availability, and session directory.
- Preference sections should be Accounts, Mode Policy, Permissions, Pi Session, Resources, GUI Behavior, and Diagnostics.
- Runtime events should feed timeline, status pill, activity stream, usage summary, pending request panels, and tree refresh.
- `@earendil-works/pi-tui` must not be imported by Multi runtime or app code.

Extension behavior from the HTML:

- Ask mode is an interaction posture: answer and inspect only, no writes, patches, formatters, commits, or mutating commands.
- Plan mode should inject a planning prompt, capture a proposed plan, show edit/review/approve controls, and implement via a child thread with the plan reference.
- Debug mode should use a focused diagnostics prompt, allow read/search/safe shell first, and require permission transition or confirmation before edits.
- Add an `ask_user` or `request_user_input` Pi tool backed by `ctx.ui.select`, `ctx.ui.input`, and `ctx.ui.confirm`.
- Pending extension UI should render in the timeline and right workbench; user response should resume the same Pi tool call through `respondToExtensionUi`.
- Subagents should run as child Pi sessions and surface in the agents panel with topology, logs, diff scope, model, status, and handback summary.

Deletion and pruning targets from the HTML:

- Delete [packages/client-runtime](packages/client-runtime) after scoped environment helpers are folded into app-local code or removed.
- Delete `packages/effect-acp` and `packages/effect-codex-app-server`.
- Keep [packages/server](packages/server) for durable backend/CLI responsibilities: orchestration metadata, persistence, project, git, terminal, auth, telemetry, websocket publishing, and lifecycle.
- Remove websocket provider routes, provider internals, native provider runtimes, generated protocol dependencies, provider status/config payloads, and URL-addressed provider environment assumptions.
- Remove provider-driver contracts: `provider-instance.ts`, `provider.ts`, `provider-runtime.ts`, provider snapshot RPC schemas, provider runtime stream schemas, and provider option schemas.
- Retain product surfaces: chat, timeline, Pi-backed tree, workbench, approvals, agents panel, plan surfaces, settings, git/files/terminal, desktop shell, reusable UI, and release scripts that match the new package graph.

First-wave tests from the HTML:

- [packages/runtime/test/thread-agent-runtime.lifecycle.test.ts](packages/runtime/test/thread-agent-runtime.lifecycle.test.ts): start Pi session, bind extensions, switch/fork, dispose, and emit canonical lifecycle events.
- [packages/runtime/test/thread-agent-runtime.tools.test.ts](packages/runtime/test/thread-agent-runtime.tools.test.ts): first-party tools, hidden tools, interaction-mode tool sets, and permission posture.
- [packages/runtime/test/desktop-extension-ui.test.ts](packages/runtime/test/desktop-extension-ui.test.ts): select, confirm, input, editor, abort, timeout, notify, status, widget, title, and editor text behavior without TUI/RPC.
- [packages/runtime/test/agent-mode-policy.test.ts](packages/runtime/test/agent-mode-policy.test.ts): model policy resolves Claude/Codex/xAI, rejects missing auth, and clamps thinking through Pi capability.
- [packages/runtime/test/pi-session-tree.contract.test.ts](packages/runtime/test/pi-session-tree.contract.test.ts): Multi consumes Pi tree/session output directly and never stores a second conversation tree.
- Add `packages/app/src/components/settings/agent-preferences.test.tsx`: preference UI exposes only Claude API Key, Codex OAuth, Codex API Key, xAI API Key, Agent Mode, Interaction Mode, permissions, and tree behavior.
- Add `packages/app/src/components/chat/extension-ui-panel.test.tsx`: pending ask/confirm/input/editor cards render from Pi request data and answer by request id.

## Completed Implementation

1. Composer new-thread and send flows route through `MultiRuntimeApi.startThread` and `MultiRuntimeApi.send`, with queue/follow-up/stop behavior mapped onto the Pi runtime path.

2. Runtime event projection and app ingestion now drive the thread timeline, activities, queue, pending requests, session tree, and usage-facing state from Pi runtime events and session tree output.

3. Agent preferences, model policy, interaction mode, Pi auth posture, and fixed all-access Pi tool behavior are implemented without reintroducing provider permission presets.

4. Desktop UI provider surfaces are replaced with Agent preferences, account rows, Agent Mode, Interaction Mode, permission/session/tree/resource/diagnostic sections, built-in composer mode commands, and pending extension UI surfaces.

5. First-party Pi extensions cover user input, plan capture, and child-session subagents, with subagent activity surfaced through runtime thread identity.

6. Old provider architecture has been pruned from the live package graph and contracts: provider packages, generated protocol packages, provider server adapters/runtime persistence, provider picker/settings/model helpers, provider runtime stream schemas, provider snapshot RPCs, and provider status/config payloads are removed.

7. Verification is complete for the current slice with repo typecheck plus focused app/runtime tests listed above.

## Follow-Up Notes

The plan is no longer in suggested-execution state. Future work should be scoped as new follow-up plans, not restoration of provider compatibility. Remaining lowercase `provider` strings are historical migrations or unrelated auth, git hosting, transport, or model-provider terminology.
