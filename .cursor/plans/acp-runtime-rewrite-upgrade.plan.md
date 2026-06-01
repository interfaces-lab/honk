---
name: acp-runtime-rewrite-upgrade
overview: Rewrite Multi's ACP implementation into an OpenCode-shaped generic ACP runtime backed by effect-acp, with Cursor as the only current consumer. Port OpenCode's promoted ACP tests first, then migrate files and delete the old runtime shape.
todos:
  - id: phase-0-protocol-parity
    content: Add missing typed ACP protocol wrappers and stop using raw core method requests.
    status: completed
  - id: phase-1-port-upstream-tests
    content: Port OpenCode ACP behavior tests into Multi test files before rewriting implementation.
    status: completed
  - id: phase-2-migrate-file-shape
    content: Rename and split current server ACP files into the OpenCode-shaped target files.
    status: completed
  - id: phase-3-rewrite-runtime
    content: Rewrite AcpRuntime around the new modules while preserving Cursor behavior.
    status: completed
  - id: phase-4-wire-cursor
    content: Rewire CursorAdapter, CursorProvider, and CursorTextGeneration through the rewritten runtime.
    status: completed
  - id: phase-5-delete-legacy
    content: Delete old filenames, old imports, raw core calls, and obsolete compatibility paths.
    status: completed
isProject: false
---

# ACP Runtime Rewrite Plan

## Objective

Replace the current mixed ACP implementation with an OpenCode-shaped ACP runtime in `packages/server/src/provider/acp`, backed by the typed `effect-acp` protocol package.

Cursor is the only ACP consumer today. The runtime remains generic only because it follows OpenCode's promoted ACP module shape and passes ported OpenCode behavior tests, not because we invented provider-agnostic abstractions.

## Non-Negotiables

- Port tests before rewriting runtime behavior.
- Use `effect-acp` for protocol typing and transport.
- Keep `effect-acp` raw `request` and `notify` as the ACP extension API.
- Do not keep old server ACP filenames as compatibility re-exports.
- Do not delete Cursor typed-method fallbacks until real Cursor probe coverage proves the typed method works.
- Do not split files unless the split matches the OpenCode promoted module shape or removes concrete local complexity.
- Keep `CursorAdapter.ts` responsible for provider turn state, pending approvals, pending user input, and emitted provider runtime events.

## Upstream Reference

Use `anomalyco/opencode@4cc166a400e028cd2e9833a5983899a7e710d51c`.

Reference files:

- `packages/opencode/src/acp/agent.ts`
- `packages/opencode/src/acp/service.ts`
- `packages/opencode/src/acp/session.ts`
- `packages/opencode/src/acp/directory.ts`
- `packages/opencode/src/acp/event.ts`
- `packages/opencode/src/acp/permission.ts`
- `packages/opencode/src/acp/content.ts`
- `packages/opencode/src/acp/tool.ts`
- `packages/opencode/src/acp/config-option.ts`
- `packages/opencode/src/acp/usage.ts`
- `packages/opencode/src/acp/error.ts`
- `packages/opencode/src/acp/profile.ts`

Reference tests:

- `packages/opencode/test/acp/config-option.test.ts`
- `packages/opencode/test/acp/content.test.ts`
- `packages/opencode/test/acp/directory.test.ts`
- `packages/opencode/test/acp/error.test.ts`
- `packages/opencode/test/acp/event.test.ts`
- `packages/opencode/test/acp/permission.test.ts`
- `packages/opencode/test/acp/service-session.test.ts`
- `packages/opencode/test/acp/session.test.ts`
- `packages/opencode/test/acp/tool.test.ts`
- `packages/opencode/test/acp/usage.test.ts`
- `packages/opencode/test/cli/acp/config-options.test.ts`
- `packages/opencode/test/cli/acp/initialize-auth.test.ts`
- `packages/opencode/test/cli/acp/lifecycle.test.ts`
- `packages/opencode/test/cli/acp/prompt-content.test.ts`
- `packages/opencode/test/cli/acp/skills.test.ts`

## Source Coverage Matrix

Every OpenCode ACP source file and promoted test must be accounted for before implementation starts.

Source files:

- `agent.ts`: omit as a direct server file; Multi is an ACP client of Cursor, not an ACP agent process. Use it only for protocol expectation and extension-method guidance.
- `service.ts`: translate into `AcpRuntime.ts` only for client-side lifecycle, initialization, auth, session setup, prompt, config, model, mode, permission, and notification flow.
- `session.ts`: merge into `AcpSession.ts` for session state, turn state, tool-call state, and session setup bookkeeping.
- `directory.ts`: N/A unless Cursor exposes directory management through the client path; do not invent a directory surface.
- `event.ts`: port into `AcpEvent.ts`.
- `permission.ts`: port into `AcpPermission.ts`.
- `content.ts`: port into `AcpContent.ts` for prompt/content block conversion used by Cursor prompts.
- `tool.ts`: port into `AcpTool.ts`.
- `config-option.ts`: port into `AcpConfigOption.ts`.
- `usage.ts`: N/A unless Cursor emits usage through ACP session updates; do not invent usage accounting.
- `error.ts`: port applicable adapter/runtime error normalization into `AcpError.ts`.
- `profile.ts`: N/A as a standalone module; Multi's existing native/protocol logging belongs in `AcpLogging.ts`, and no OpenCode profiling env surface should be introduced.

Source tests:

- `config-option.test.ts`: port to `AcpConfigOption.test.ts`.
- `content.test.ts`: port applicable content conversion cases to `AcpContent.test.ts`.
- `directory.test.ts`: mark N/A in `AcpRuntime.test.ts` unless Cursor client flow gains directory behavior.
- `error.test.ts`: port applicable cases to `AcpError.test.ts`.
- `event.test.ts`: port to `AcpEvent.test.ts`.
- `permission.test.ts`: port to `AcpPermission.test.ts`.
- `service-session.test.ts`: port client-relevant session lifecycle cases to `AcpSession.test.ts` and `AcpRuntime.test.ts`.
- `session.test.ts`: port to `AcpSession.test.ts`.
- `tool.test.ts`: port to `AcpTool.test.ts`.
- `usage.test.ts`: mark N/A in `AcpRuntime.test.ts` unless Cursor emits usage through ACP.
- `config-options.test.ts`: port to `AcpRuntime.test.ts` and `CursorAcpModel.test.ts`.
- `initialize-auth.test.ts`: port to `AcpRuntime.test.ts`.
- `lifecycle.test.ts`: port to `AcpRuntime.test.ts`.
- `prompt-content.test.ts`: port to `AcpContent.test.ts`.
- `skills.test.ts`: port only slash-command or command-list behavior Multi supports into `CursorAcp.test.ts`.

## Target Files

Create or migrate to these files.

Generic ACP runtime files:

- `packages/server/src/provider/acp/AcpRuntime.ts`
- `packages/server/src/provider/acp/AcpSession.ts`
- `packages/server/src/provider/acp/AcpEvent.ts`
- `packages/server/src/provider/acp/AcpPermission.ts`
- `packages/server/src/provider/acp/AcpTool.ts`
- `packages/server/src/provider/acp/AcpConfigOption.ts`
- `packages/server/src/provider/acp/AcpContent.ts`
- `packages/server/src/provider/acp/AcpError.ts`
- `packages/server/src/provider/acp/AcpLogging.ts`
- `packages/server/src/provider/acp/AcpProviderEvent.ts`

Cursor ACP consumer files:

- `packages/server/src/provider/acp/CursorAcp.ts`
- `packages/server/src/provider/acp/CursorAcpModel.ts`
- `packages/server/src/provider/acp/CursorAcpExtension.ts`

Delete these files by the end of the rewrite:

- `packages/server/src/provider/acp/AcpSessionRuntime.ts`
- `packages/server/src/provider/acp/AcpRuntimeModel.ts`
- `packages/server/src/provider/acp/AcpCoreRuntimeEvents.ts`
- `packages/server/src/provider/acp/AcpNativeLogging.ts`
- `packages/server/src/provider/acp/AcpAdapterSupport.ts`
- `packages/server/src/provider/acp/CursorAcpSupport.ts`
- `packages/server/src/provider/acp/tool-activity.ts`, after moving ACP-specific behavior to `AcpTool.ts`

## Phase 0. Protocol Parity

Status: completed.

Changes already made:

- Added typed `session/set_mode` RPC support to `packages/effect-acp/src/rpc.ts`.
- Added `agent.setSessionMode` to `packages/effect-acp/src/client.ts`.
- Added `handleSetSessionMode` to `packages/effect-acp/src/agent.ts`.
- Updated server ACP runtime to call `acp.agent.setSessionMode`.
- Updated mock agents and protocol tests.

Verification already run:

- `pnpm --filter effect-acp test -- test/client.test.ts test/agent.test.ts`
- `pnpm --filter usemulti exec vitest run test/provider/acp/AcpRuntime.test.ts`
- `pnpm run typecheck`

## Phase 1. Port OpenCode Tests

Status: completed for the target modules Multi owns today.

Goal: create failing or partially passing target tests before implementation changes.

Bootstrap rule:

- If a target test imports a target module that does not exist yet, create the minimal target module skeleton in the same phase.
- Skeletons may contain moved current helpers or explicit unimplemented exports only when the test failure still identifies behavior.
- Prefer moving pure helpers with the tests so failures are behavioral, not missing-file or missing-export failures.
- Do not leave empty placeholder modules after Phase 2.

Create these tests:

- `packages/server/test/provider/acp/AcpConfigOption.test.ts`
- `packages/server/test/provider/acp/AcpContent.test.ts`
- `packages/server/test/provider/acp/AcpError.test.ts`
- `packages/server/test/provider/acp/AcpEvent.test.ts`
- `packages/server/test/provider/acp/AcpPermission.test.ts`
- `packages/server/test/provider/acp/AcpSession.test.ts`
- `packages/server/test/provider/acp/AcpTool.test.ts`
- `packages/server/test/provider/acp/AcpRuntime.test.ts`
- `packages/server/test/provider/acp/CursorAcp.test.ts`
- `packages/server/test/provider/acp/CursorAcpModel.test.ts`
- `packages/server/test/provider/acp/CursorAcpExtension.test.ts`

Port mapping:

- OpenCode `config-option.test.ts` -> Multi `AcpConfigOption.test.ts`.
- OpenCode `content.test.ts` and `prompt-content.test.ts` -> Multi `AcpContent.test.ts`.
- OpenCode `error.test.ts` -> Multi `AcpError.test.ts`.
- OpenCode `event.test.ts` -> Multi `AcpEvent.test.ts`.
- OpenCode `permission.test.ts` -> Multi `AcpPermission.test.ts`.
- OpenCode `session.test.ts` and `service-session.test.ts` -> Multi `AcpSession.test.ts`.
- OpenCode `tool.test.ts` -> Multi `AcpTool.test.ts`.
- OpenCode `initialize-auth.test.ts`, `lifecycle.test.ts`, and `config-options.test.ts` -> Multi `AcpRuntime.test.ts`.
- OpenCode `skills.test.ts` -> Multi `CursorAcp.test.ts` only for slash-command or command-list behavior that Multi actually supports.

Porting rules:

- Port behavior, not fixture names.
- Translate agent-server expectations into client-provider expectations at the provider/runtime boundary.
- Mark a source case as not applicable only in a short comment in the target test.
- Keep one reference comment per test file naming the OpenCode source test.

Verification:

- Run `pnpm --filter usemulti exec vitest run test/provider/acp/AcpConfigOption.test.ts test/provider/acp/AcpTool.test.ts test/provider/acp/AcpPermission.test.ts`.
- Initial runs can fail until Phase 2/3, but every failure must identify target behavior instead of missing scaffolding.

Exit criteria:

- Every target module has a corresponding test file.
- The test files encode the target behavior before the implementation is migrated.

## Phase 2. Migrate File Shape

Status: completed.

Goal: move code into target filenames without changing behavior beyond import/type fixes.

Phase 2A pure-helper extraction:

- Move config option helpers from `AcpRuntimeModel.ts` to `AcpConfigOption.ts`.
- Move tool call parsing and ACP-specific tool presentation from `AcpRuntimeModel.ts` and `tool-activity.ts` to `AcpTool.ts`.
- Move permission parsing and ACP permission outcome mapping to `AcpPermission.ts`.
- Move adapter error mapping from `AcpAdapterSupport.ts` to `AcpError.ts`.

Phase 2A verification:

- `pnpm --filter usemulti exec vitest run test/provider/acp/AcpConfigOption.test.ts test/provider/acp/AcpTool.test.ts test/provider/acp/AcpPermission.test.ts test/provider/acp/AcpError.test.ts`
- `pnpm run typecheck`

Phase 2B runtime/event rename migration:

- Move `AcpSessionRuntime.ts` to `AcpRuntime.ts`.
- Move pure session update parsing from `AcpRuntimeModel.ts` to `AcpEvent.ts`.
- Move provider runtime event conversion from `AcpCoreRuntimeEvents.ts` to `AcpProviderEvent.ts`.
- Move native request/protocol logging from `AcpNativeLogging.ts` to `AcpLogging.ts`.

Phase 2B verification:

- `pnpm --filter usemulti exec vitest run test/provider/acp/AcpEvent.test.ts test/provider/acp/AcpProviderEvent.test.ts test/provider/acp/AcpRuntime.test.ts`
- `pnpm run typecheck`

Phase 2C Cursor rename migration:

- Move Cursor runtime factory and command construction from `CursorAcpSupport.ts` to `CursorAcp.ts`.
- Move Cursor model selection and config update helpers from `CursorAcpSupport.ts` and `CursorProvider.ts` to `CursorAcpModel.ts`.
- Keep Cursor extension schemas in `CursorAcpExtension.ts`.

Import updates:

- Update `CursorAdapter.ts`.
- Update `CursorProvider.ts`.
- Update `CursorTextGeneration.ts`.
- Update `packages/server/test/provider/acp/*`.
- Update `CursorAcpCliProbe.test.ts`.

Verification:

- `pnpm --filter usemulti exec vitest run test/provider/acp`
- `pnpm run typecheck`

Exit criteria:

- New target filenames compile.
- Behavior is unchanged except where tests explicitly define the new expected behavior.
- No new compatibility barrel files exist.

## Phase 3. Rewrite Runtime To OpenCode Shape

Status: completed for the mock-backed runtime rewrite.

Goal: make the moved code structurally match the OpenCode promoted implementation.

Runtime contract:

- OpenCode `initialize`: implement in `AcpRuntime.ts` as ACP client initialization against Cursor.
- OpenCode `authenticate`: implement in `AcpRuntime.ts` with Cursor auth method selection.
- OpenCode `session/new`, `session/load`, `session/resume`, `session/prompt`, `session/cancel`: implement as client calls and state transitions.
- OpenCode `session/set_model`, `session/set_mode`, `session/set_config_option`: implement through typed `effect-acp` methods where available, with Cursor-proven fallbacks only where still required.
- OpenCode `session/update`: translate in `AcpEvent.ts` and emit provider runtime events from `AcpProviderEvent.ts`.
- OpenCode permission requests: translate in `AcpPermission.ts`; CursorAdapter remains responsible for approval state and side effects.
- OpenCode directory, usage, and agent-side session listing/forking/closing service surfaces: omit unless Cursor's client path exposes matching behavior. Do not add a non-Cursor ACP consumer surface.

Directives:

- Keep `AcpRuntime.ts` as the full runtime/service file.
- Extract stateful session bookkeeping into `AcpSession.ts`.
- Put ACP notification parsing, assistant segmentation, and tool-call merge behavior in `AcpEvent.ts`.
- Put all config option lookup, validation, and current-value updates in `AcpConfigOption.ts`.
- Put all permission request parsing and decision mapping in `AcpPermission.ts`.
- Put tool kind/location/command/content/raw-output mapping in `AcpTool.ts`.
- Put prompt/content block conversion in `AcpContent.ts`; Cursor prompts are the current consumer, so this module and `AcpContent.test.ts` are required.
- Put provider adapter error normalization in `AcpError.ts`.
- Keep Cursor-specific spawn args, auth method, capabilities, model pinning, and Cursor probing out of `AcpRuntime.ts`.

Cursor-specific directives:

- `CursorAcp.ts` owns command construction, auth method, client capabilities, runtime factory, and Cursor CLI process settings.
- `CursorAcpModel.ts` owns Cursor model resolution, spawn model selection, config option selection, and capability probing.
- `CursorAcpExtension.ts` owns only Cursor extension schemas and pure decoding.
- `CursorAdapter.ts` owns extension side effects, pending user input, pending approvals, turn state, and emitted events.

Verification:

- `pnpm --filter usemulti exec vitest run test/provider/acp`
- `pnpm --filter usemulti exec vitest run test/provider/ProviderAdapterRegistry.test.ts test/provider/ProviderRegistry.test.ts`
- `pnpm run typecheck`

Verification run:

- `pnpm --filter usemulti exec vitest run test/provider/acp test/provider/CursorProvider.test.ts`
- `pnpm --filter effect-acp test -- test/client.test.ts test/agent.test.ts`
- `pnpm run typecheck`

Exit criteria:

- `AcpRuntime.ts` reads like the Multi equivalent of OpenCode `service.ts`.
- Supporting files map clearly to OpenCode's promoted ACP files.
- Cursor-specific behavior is isolated to `CursorAcp.ts`, `CursorAcpModel.ts`, `CursorAcpExtension.ts`, and `CursorAdapter.ts`.

## Phase 4. Cursor Integration And Probe Coverage

Status: completed. Current mock-backed ACP/Cursor tests pass, the current real Cursor CLI probe passes, and the probe now proves typed `session/set_model` and `session/set_mode`.

Goal: prove Cursor, the only ACP consumer, still works through the rewritten runtime.

Required behavior:

- Initialize/authenticate/new-session.
- Load existing ACP session with fallback to new session.
- Config option current-value tracking.
- Idempotent config writes.
- Stale config option echo handling.
- Typed `session/set_mode` with no model/mode compatibility fallback.
- Typed `session/set_model` with no model/mode compatibility fallback.
- Config option writes remain only for actual config options.
- Prompt event stream ordering.
- Assistant text segmentation around tool calls.
- Tool-call merge and placeholder suppression.
- Permission request mapping and outcomes.
- Cursor ask-question, create-plan, and todo extension parsing.
- Provider request/open and request/resolved events.
- Native raw logging source separation.

Verification:

- `pnpm --filter usemulti exec vitest run test/provider/acp`
- Cursor adapter/runtime integration tests covering approvals, user input, extension events, model selection, and turn state:
  - `packages/server/test/provider/acp/CursorAcp.test.ts`.
  - `packages/server/test/provider/acp/CursorAcpModel.test.ts`.
  - `packages/server/test/provider/acp/CursorAcpExtension.test.ts`.
  - `packages/server/test/provider/acp/CursorAcpCliProbe.test.ts`.
  - Add a mock-runtime Cursor adapter test before rewriting `CursorAdapter.ts` if the existing tests do not cover pending approvals, ask-question answers, create-plan/todo events, mode changes, model selection, prompt lifecycle, cancellation, and provider request open/resolved events.
- `T3_CURSOR_ACP_PROBE=1 pnpm --filter usemulti exec vitest run test/provider/acp/CursorAcpCliProbe.test.ts`
- Extend `CursorAcpCliProbe.test.ts` before deleting fallbacks so it verifies `session/set_mode` and `session/set_model` success paths against the current Cursor CLI.
- `pnpm run typecheck`

Verification run:

- `T3_CURSOR_ACP_PROBE=1 pnpm --filter usemulti exec vitest run test/provider/acp/CursorAcpCliProbe.test.ts`

Exit criteria:

- Mock ACP tests pass.
- Cursor adapter tests pass.
- Real Cursor probe proves the risky protocol paths before fallback deletion.

## Phase 5. Delete Legacy Shape

Status: completed.

Goal: remove the old implementation surface.

Delete:

- Old server ACP filenames.
- Old imports.
- Old raw core method calls.
- Old compatibility helpers.
- Server-side typed-method fallbacks only after `T3_CURSOR_ACP_PROBE=1 pnpm --filter usemulti exec vitest run test/provider/acp/CursorAcpCliProbe.test.ts` proves typed paths against the current Cursor CLI. If the probe fails, keep the fallbacks and keep the probe as required coverage.

Keep:

- `effect-acp` raw `request` and `notify` for ACP extension methods.
- Cursor extension raw request/notification handling where ACP requires extensions.

Final verification:

- `pnpm --filter effect-acp test`
- `pnpm --filter usemulti exec vitest run test/provider/acp`
- `pnpm run typecheck`

Verification run:

- `pnpm --filter effect-acp test`
- `pnpm --filter usemulti exec vitest run test/provider/acp test/provider/CursorProvider.test.ts`
- `pnpm --filter usemulti exec vitest run test/provider/ProviderAdapterRegistry.test.ts test/provider/ProviderRegistry.test.ts`
- `T3_CURSOR_ACP_PROBE=1 pnpm --filter usemulti exec vitest run test/provider/acp/CursorAcpCliProbe.test.ts`
- `pnpm run typecheck`

Definition of done:

- No import references old ACP filenames.
- No old-name compatibility barrels remain.
- The runtime modules map to OpenCode's promoted ACP shape.
- The ported OpenCode-inspired tests cover the generic ACP runtime.
- Cursor-specific tests and probes cover the only real ACP provider path.
