# Core Environment Gaps

## Implemented write surfaces

- `thread.turn.start` dispatch maps to `honk.threads.send` with the app's client-minted message id, text, upload image attachments, per-send interaction mode, and parent-entry tri-state. Per-turn model selection is intentionally ignored because core pins model and thinking at thread creation.
- Plan implementation turns that carry `sourceProposedPlan` still send the implementation turn and also mark the referenced core plan through `honk.threads.implementPlan`.
- `thread.turn.interrupt` and `thread.session.stop` dispatch to `honk.threads.interrupt`.
- `thread.user-input.respond` dispatches to `honk.threads.answerQuestion`.
- Terminal open/create/list/attach/write/resize/restart/close/event streaming maps to `honk.terminals`. The app's stable terminal tab id is stored as the core terminal title because core generates terminal ids.
- Desktop-local git and settings/config route through the desktop aux server in desktop mode; web/serve mode has no aux and reports those methods as unavailable.
- Desktop-local project list/create/update/delete route through the desktop aux `/projects` registry when aux is present. The registry stores project metadata and scripts; `repositoryIdentity` is derived from git remotes at serve/event time and cached. Web/serve mode has no aux and exposes no projects.

## Remaining gaps

- `runtimeMode`: core/v1 has no persistent runtime mode. The app store currently requires `Thread.runtimeMode` and `ThreadShell.runtimeMode` in `packages/app/src/types.ts`, so the core projection carries a compatibility value only at the store boundary. This must be removed when the store type is updated for core.
- Thread summary `latestTurn`: core workspace summaries do not include active/latest turn metadata. The detail watch derives this from `ThreadState.activeTurn` / `lastSettled`, but shell rows start with `latestTurn: null`.
- Thread summary interaction mode: core has per-send `InteractionMode`; it does not serve a persistent thread interaction mode. The projection uses the app default at the store boundary.
- Queue: core detail exposes `ThreadState.queue`, but the app thread store has no durable queue slice. This slice does not expose queued messages in UI state.
- Queue mutation gap: core/v1 serves enqueue through `messages.send` (`SendMessageInput.delivery: "queue"`) and cancellation through `messages.cancelQueued` (`DELETE /threads/:threadId/queue/:messageId`) in `packages/api/src/core/v1/api.ts`. It does not expose queued-message update, reorder, or send-now endpoints, so those three app queue operations remain unsupported for core.
- Session-file lookup / `codexThreadId`: core/v1 does not serve legacy runtime session-file identity. The projection omits it with `codexThreadId: null`.
- `Part.patch` without `turnId`: app `TurnDiffSummary` is keyed by `TurnId`. Patch parts with a null `turnId` cannot be exposed without inventing an ID, so they are skipped.
- `ThreadDetail.worktree`: core/v1 has a top-level detail `worktree`, but the current SDK `ThreadState` keeps only `summary.worktree`. If those diverge, the app cannot see the detail-only value through `@honk/sdk`.
- Manual event replay: core SDK watches resync from fresh snapshots on reconnect. The legacy `replayEvents` API has no core event-history equivalent, so this slice maps it to reconnect and returns an empty, up-to-date replay result.
- Terminal clear/history truncation is unsupported because `honk.terminals` has no clear-history endpoint, including separate `deleteHistory` handling for already-closed sessions. Per-terminal `env` and separate `worktreePath` overrides on open/restart are also unsupported. Core attach does not expose subprocess activity, so the app receives started/output/exited/error/restarted events but no terminal `activity` events.
- Non-read surfaces still unsupported by the core environment dispatch adapter: project filesystem, thread metadata commands, archive/delete/navigation commands, approval responses, plan markdown updates, and turn-start failure reporting.
