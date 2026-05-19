# Server And Shared File Inventory

This inventory covers non-ignored files in `packages/server` and
`packages/shared`. It exists to separate canonical runtime boundaries from
shared-package drift before deletion or movement.

Inventory command:

```bash
rg --files packages/server packages/shared
```

Current count:

- [x] `packages/server/src`: `229` files.
- [x] `packages/server/test`: `90` files.
- [x] `packages/shared/src`: `19` files.
- [x] `packages/shared/test`: `9` files.

Source grouping:

- [x] `packages/server/src` root files: `24`.
- [x] `packages/server/src/auth`: `14`.
- [x] `packages/server/src/checkpointing`: `10`.
- [x] `packages/server/src/environment`: `3`.
- [x] `packages/server/src/git`: `18`.
- [x] `packages/server/src/observability`: `3`.
- [x] `packages/server/src/orchestration`: `27`.
- [x] `packages/server/src/persistence`: `60`.
- [x] `packages/server/src/project`: `13`.
- [x] `packages/server/src/provider`: `47`.
- [x] `packages/server/src/telemetry`: `3`.
- [x] `packages/server/src/terminal`: `5`.
- [x] `packages/shared/src` root files: `15`.
- [x] `packages/shared/src/observability`: `4`.

## Server Boundaries To Keep

These groups are canonical runtime boundaries. Do not delete them as helper
cleanup.

- [x] `packages/server/src/orchestration/*`: proposed-plan, projection,
      ingestion, command, reactor, and timeline derivation boundary.
- [x] `packages/server/src/persistence/*`: durable SQLite repositories,
      migrations, command receipts, projections, auth sessions, and provider
      runtime state.
- [x] `packages/server/src/provider/*`: provider registry, provider service,
      adapter contracts, provider-specific adapters, ACP runtime, provider status,
      and managed server providers.
- [x] `packages/server/src/auth/*`: control plane, bootstrap credentials,
      policy, secret store, session credentials, and auth HTTP routes.
- [x] `packages/server/src/project/*`: project paths, files, entries, favicon,
      setup scripts, and repository identity.
- [x] `packages/server/src/git/*`: Git core, manager, status broadcaster,
      GitHub CLI, remote refs, and provider-specific Git text generation.
- [x] `packages/server/src/checkpointing/*`: checkpoint store, lifecycle,
      retention, diff query, and diff helpers.
- [x] `packages/server/src/terminal/*`: PTY and terminal manager services.
- [x] `packages/server/src/environment/*`: server environment and labels.
- [x] `packages/server/src/telemetry/*`: analytics and identity boundary.
- [x] `packages/server/src/server-runtime.ts`, `server.ts`, `ws.ts`,
      `http.ts`, `config.ts`, `bootstrap.ts`, `bin.ts`, and `cli.ts`: process,
      HTTP/WebSocket, startup, and CLI boundaries.

## Proposed Plan Chain

The proposed-plan implementation is a server/app chain, not an app-only UI
helper.

- [x] Provider event ingestion starts in
      `packages/server/src/orchestration/ProviderRuntimeIngestion.ts`.
- [x] Provider adapters emit plan-related events:
      `CodexAdapter`, `CursorAdapter`, and ACP `AcpRuntimeModel`.
- [x] Orchestration command/event handling flows through `decider.ts`,
      `projector.ts`, `ProjectionPipeline.ts`, and `ThreadProjection.ts`.
- [x] Proposed plans persist through
      `ProjectionThreadProposedPlans.ts`, `ProjectionTurns.ts`, and
      `ProjectionThreads.ts`.
- [x] Proposed-plan migrations are `013`, `014`, `015`, `023`, and `024`.
- [x] App rendering derives from the projected thread state and native plan
      workbench; it should not invent a second plan source.

Do not delete proposed-plan server files while the native workbench feature is
active.

## Shared Package Rules

`@multi/shared` is a cross-package utility package. A file belongs here only
when at least two runtime packages need the same pure/runtime-neutral behavior,
or when keeping it here prevents duplicated adapter code.

Rules:

- [ ] Shared files expose reusable primitives, not app policy.
- [ ] App-specific projection helpers do not live in shared only because the
      app has multiple components.
- [ ] Server-only helpers move back to server unless a second package is about
      to consume them.
- [ ] Shared package exports are curated in `packages/shared/package.json`; no
      wildcard public surface.
- [ ] If a shared file has one production consumer, classify it before keeping
      it public.

## Shared File Classification

Keep as shared boundaries:

- [x] `DrainableWorker.ts`: used by orchestration reactors and runtime
      ingestion.
- [x] `Net.ts`: used by desktop, server CLI/startup, opencode runtime, and dev
      runner.
- [x] `Struct.ts`: shared deep merge for settings in app and server.
- [x] `cli-args.ts`: shared CLI parsing for server adapter and release script.
- [x] `git.ts`: shared Git normalization, branch, and status helpers used by
      app, server Git, orchestration, and project identity.
- [x] `logging.ts`: rotating file sink used by server observability/provider
      logging.
- [x] `model.ts`: shared model primitives used by app resolver/picker/store and
      server provider/Git text-generation code. It owns runtime-neutral model
      selection creation, descriptor normalization, slug aliases, capability
      helpers, and prompt-effort prefix parsing only; app fallback,
      availability, ordering, and missing-state policy stay in
      `packages/app/src/model`.
- [x] `path.ts`: shared path classification for app project paths and server
      project entries.
- [x] `project-scripts.ts`: canonical project-script runtime helper shared by
      app terminal surfaces and server setup-script runner.
- [x] `schema-json.ts`: shared lenient JSON/schema decode helpers used by
      desktop settings and server providers/config/Git.
- [x] `search-ranking.ts`: shared ranking used by app slash/model search and
      server project entries.
- [x] `server-settings.ts`: pure server-settings patch/parse helper used by
      desktop and server; server service remains in `packages/server`.
- [x] `shell.ts`: shared login-shell/PATH probing used by desktop sync and
      server terminal/jank code.

Classify before keeping public:

- [x] `KeyedCoalescingWorker.ts`: moved to
      `packages/server/src/terminal/KeyedCoalescingWorker.ts` with its focused
      worker test under `packages/server/test/terminal` because terminal history
      persistence is the only production consumer.
- [x] `String.ts`: deleted as a shared export after moving thread title
      trimming/truncation into `packages/app/src/components/chat/view/chat-view-send-flow.ts`.
      The retained behavior is covered by the first-send worktree draft browser
      test assertion on the `thread.meta.update` title.
- [x] `subagents.ts`: moved to `packages/app/src/session/subagents.ts` because
      the only production consumer is app session/worklog derivation.
- [x] `thread-segments.ts`: used by server attachment storage and app command
      palette; keep until thread/path ownership is decided.
- [x] `tool-activity.ts`: moved to
      `packages/server/src/provider/acp/tool-activity.ts` because the only
      production consumer is ACP runtime normalization.

## Observability Duplication

The duplicate server trace implementation was removed. Shared now owns trace
record formatting, sinks, local file tracing, and attribute compaction; server
keeps metrics, runtime assembly, and RPC instrumentation.

Removed duplicate files:

- [x] `packages/server/src/observability/Attributes.ts`
- [x] `packages/server/src/observability/TraceRecord.ts`
- [x] `packages/server/src/observability/TraceSink.ts`
- [x] `packages/server/src/observability/LocalFileTracer.ts`

Canonical shared files:

- [x] `packages/shared/src/observability/Attributes.ts`
- [x] `packages/shared/src/observability/TraceRecord.ts`
- [x] `packages/shared/src/observability/TraceSink.ts`
- [x] `packages/shared/src/observability/LocalFileTracer.ts`

Target:

- [x] `@multi/shared/observability` owns trace record formatting, trace sink,
      local file tracer, and attribute compaction.
- [x] `packages/server/src/observability/Metrics.ts` keeps server-only metrics.
- [x] `packages/server/src/observability/Observability.ts` keeps server runtime
      assembly.
- [x] `packages/server/src/observability/RpcInstrumentation.ts` keeps server
      RPC instrumentation.
- [x] Move server-only `normalizeModelMetricLabel` into server metrics unless a
      second package needs it.
- [x] Remove server duplicate trace files only after imports and tests point at
      shared.

## One-Off Server Helper Candidates

These files are not deletion decisions. They need caller inventory before code
changes.

- [ ] `packages/server/src/atomic-write.ts`
- [ ] `packages/server/src/attachment-paths.ts`
- [ ] `packages/server/src/attachment-store.ts`
- [ ] `packages/server/src/cli-auth-format.ts`
- [ ] `packages/server/src/image-mime.ts`
- [ ] `packages/server/src/path-expansion.ts`
- [ ] `packages/server/src/startup-access.ts`
- [ ] `packages/server/src/server-lifecycle-events.ts`
- [ ] `packages/server/scripts/acp-mock-agent.ts`
- [ ] `packages/server/scripts/cli.ts`

Rules:

- [ ] Keep helpers that protect filesystem, auth, attachment, or startup
      semantics.
- [ ] Move narrow helpers next to the owning route, CLI, or runtime surface.
- [ ] Delete script entrypoints only after package command inventory proves
      they are not used.

## First Server/Shared Cleanup Candidates

- [x] Make shared observability canonical and remove server duplicate
      trace/sink/tracer files.
- [x] Reclassify `KeyedCoalescingWorker.ts` as shared primitive or terminal
      private helper.
- [x] Reclassify `String.ts` as app-local helper or inline usage.
- [x] Reclassify `tool-activity.ts` as server ACP helper unless app use is
      planned.
- [x] Reclassify `subagents.ts` as app session/worklog helper.
- [x] Document `shared/model.ts` as primitive-only and keep app model resolver
      policy in `packages/app/src/model`.
- [ ] Keep `shared/project-scripts.ts` canonical and move app project-script
      tests to the behavior owner.

## Done Means

- [x] Each moved/deleted server/shared file has caller inventory captured with
      `rg`, `git ls-files`, or `knip`.
- [x] Public `@multi/shared` exports remain intentional in
      `packages/shared/package.json`.
- [ ] Server runtime boundaries still expose typed Effect errors where
      expected failures are possible.
- [ ] Proposed-plan chain still runs provider event to projection to native
      workbench.
- [x] `pnpm run typecheck` passes for code changes.

Current cleanup evidence:

- [x] `rg` found no production consumers for
      `@multi/shared/KeyedCoalescingWorker`, `@multi/shared/subagents`, or
      `@multi/shared/tool-activity` after the moves.
- [x] `@multi/shared` no longer exports those three package subpaths.
- [x] `@multi/shared` no longer exports the one-caller `./String` subpath.
- [x] The moved keyed worker test passed from `packages/server` with
      `pnpm exec vitest run test/terminal/KeyedCoalescingWorker.test.ts`.
- [x] The retained thread title trim/truncate behavior passed from
      `packages/app` with
      `pnpm exec vitest run --config vitest.browser.config.ts src/components/chat/view/chat-view.browser.tsx -t "does not render branch controls on server thread mode"`.
- [x] `pnpm run typecheck` passed after the shared export removals.
- [x] Strict oxlint passed with warnings denied, and `git diff --check` is clean.
- [x] Server observability imports now point at `@multi/shared/observability`;
      the server duplicate trace files were deleted and
      `normalizeModelMetricLabel` moved to server `Metrics.ts`.
- [x] The edited observability tests passed from `packages/server` with
      `pnpm exec vitest run test/observability/Attributes.test.ts test/observability/TraceSink.test.ts test/observability/LocalFileTracer.test.ts`.
- [x] `pnpm run typecheck` passed after the observability consolidation.
