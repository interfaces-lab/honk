# Orchestration runtime mapping inventory

This inventory records what the built-in provider adapters emit today and what
`ProviderRuntimeIngestion` does with those events. It is the Phase 1 evidence for
`orchestration_cleanup_871c4f14.plan.md`.

## Mapping record shape

Use this shape for later conformance fixtures:

```ts
interface AdapterRuntimeMapping {
  driver: "codex" | "claudeAgent" | "cursor" | "cursorSdk" | "opencode";
  nativeSource: string;
  runtimeEventType: string;
  payloadOwner: "adapter" | "contracts" | "ingestion";
  ingestionOutput:
    | "command"
    | "activity"
    | "assistant-message"
    | "command-and-activity"
    | "ignored"
    | "unhandled";
  consumer: string;
}
```

## Canonical runtime vocabulary

The central event contract lives in
`packages/contracts/src/provider-runtime.ts`. Its raw sources are:

- `codex.app-server.notification`
- `codex.app-server.request`
- `codex.eventmsg`
- `codex.sdk.thread-event`
- `claude.sdk.message`
- `claude.sdk.permission`
- `cursor.sdk.message`
- `cursor.sdk.delta`
- `opencode.sdk.event`
- `acp.jsonrpc`
- `acp.<name>.extension`

`codex.eventmsg` and `codex.sdk.thread-event` are contract-only sources today.
No built-in adapter currently emits canonical events with those raw sources.

## Ingestion outputs

`packages/server/src/orchestration/ProviderRuntimeIngestion.ts` has three output
paths:

| Runtime event | Output | Consumer |
| --- | --- | --- |
| `session.started`, `session.state.changed`, `session.exited`, `thread.started`, `turn.started`, `turn.completed`, `turn.aborted` | `thread.session.set` command | projection session state |
| `runtime.error` | `thread.session.set` command and `runtime.error` activity | projection session state, timeline |
| `content.delta` with `assistant_text` | assistant message delta command | composer messages |
| `item.completed` with `assistant_message` | assistant message finalization commands | composer messages |
| `turn.proposed.delta`, `turn.proposed.completed` | proposed-plan upsert command | proposed plan projection |
| `thread.metadata.updated` with `payload.name` | thread metadata command | thread list/title |
| `turn.diff.updated` | checkpoint placeholder command when the thread has a git repo | checkpoint projection |
| `request.opened`, `request.resolved` | approval activities, except `tool_user_input` | approvals and timeline |
| `user-input.requested`, `user-input.resolved` | user-input activities | pending user input and timeline |
| `runtime.warning` | runtime warning activity | timeline |
| `turn.plan.updated` | plan activity | work log/timeline |
| `task.started`, `task.progress`, `task.completed` | task activities | work log/timeline |
| `tool.summary` | `tool.summary` activity | work log/timeline |
| `thread.state.changed` with `compacted` | `context-compaction` activity | timeline |
| `thread.token-usage.updated` with nonzero tokens | context-window or subagent usage activity | context display and subagent tray |
| `subagent.thread.*`, `subagent.item.*`, `subagent.content.delta`, `subagent.usage.updated` | subagent activities | subagent tray and timeline |
| `files.persisted` with files | `tool.completed` activity | git status and file patch invalidation |
| `item.started`, `item.updated`, `item.completed` for tool lifecycle item types | tool activities | tool timeline |
| `content.delta` with `command_output` or `file_change_output` | `tool.updated` activity | shell and file-change output |

The ingestion service also subscribes to `thread.turn-start-requested` domain
events, but `processDomainEvent` is currently a no-op.

## Adapter inventory

### `codex`

Primary file: `packages/server/src/provider/CodexAdapter.ts`

Native sources:

- `codex.app-server.notification`
- `codex.app-server.request`

Emitted canonical events:

- Session, thread, and turn lifecycle events. Ingestion writes session commands.
- `thread.state.changed` and `thread.token-usage.updated`. Only compaction and
  nonzero token updates become activities.
- `thread.metadata.updated`. Only `payload.name` becomes a thread metadata
  command.
- `thread.realtime.started`, `thread.realtime.item-added`,
  `thread.realtime.audio.delta`, `thread.realtime.error`, and
  `thread.realtime.closed`. Ingestion does not handle these today.
- `turn.plan.updated`, `turn.proposed.delta`, `turn.proposed.completed`, and
  `turn.diff.updated`. These become a plan activity, proposed-plan commands, or a
  checkpoint placeholder.
- `item.started`, `item.updated`, and `item.completed`. Tool lifecycle items
  become tool activities. Completed assistant items finalize assistant messages.
- `content.delta` with assistant, reasoning, plan, command, and file-change
  streams. Assistant text becomes message commands; command and file-change
  output becomes tool output. Reasoning and plan text are unhandled.
- Full `subagent.*` coverage. These become activities only.
- `request.*` and `user-input.*`. These become approval or user-input
  activities.
- `tool.progress`, `model.rerouted`, `config.warning`, `deprecation.notice`,
  `account.updated`, `account.rate-limits.updated`, and `mcp.oauth.completed`.
  Ingestion does not handle these today.
- `runtime.error` and `runtime.warning`. Errors update session state and append
  an activity; warnings append an activity.

Native logging writes pre-mapped app-server events. Unmapped Codex methods are
therefore visible in native logs even when no canonical event is emitted.

### `claudeAgent`

Primary file: `packages/server/src/provider/ClaudeAdapter.ts`

Native sources:

- `claude.sdk.message`
- `claude.sdk.permission`

Emitted canonical events:

- Session lifecycle plus `session.configured`. Ingestion handles lifecycle
  events, but not `session.configured`.
- Thread start, compaction, and token usage. Start becomes a session command;
  compaction and nonzero token usage become activities.
- Turn start, completion, and proposed-plan completion. These become lifecycle
  or proposed-plan commands.
- `item.*` for tools and assistant messages. Tool lifecycle items become
  activities; completed assistant messages finalize assistant messages.
- `content.delta` with assistant and reasoning streams. Assistant text becomes
  message commands. Reasoning text is unhandled.
- `turn.plan.updated`, `task.started`, `task.progress`, `task.completed`,
  `files.persisted`, and `tool.summary`. These become activities.
- `hook.started`, `hook.progress`, `hook.completed`, `tool.progress`,
  `auth.status`, and `account.rate-limits.updated`. Ingestion does not handle
  these today.
- Permission messages emit `request.*` and `user-input.*` events. These become
  approval and user-input activities.
- `runtime.error` and `runtime.warning`. Errors update session state and append
  an activity; warnings append an activity.

Native logging records SDK messages before handler routing.

### `cursor`

Primary files:

- `packages/server/src/provider/CursorAdapter.ts`
- `packages/server/src/provider/acp/AcpCoreRuntimeEvents.ts`

Native sources:

- `acp.jsonrpc`
- `acp.cursor.extension`

Emitted canonical events:

- Session, thread, and turn lifecycle. Ingestion writes session commands.
- `turn.plan.updated` from core ACP plan updates and `cursor/update_todos`.
  Ingestion appends a plan activity.
- `item.started` and `item.completed` for assistant messages. The start event is
  ignored; completion finalizes the assistant message.
- `item.updated` and `item.completed` for ACP tool calls. Tool lifecycle events
  become activities.
- `content.delta` with assistant text. Ingestion writes assistant message
  commands.
- `request.opened` and `request.resolved`. Ingestion appends approval
  activities.
- `user-input.requested` and `user-input.resolved` from `cursor/ask_question`.
  Ingestion appends user-input activities.
- `turn.proposed.completed` from `cursor/create_plan`. Ingestion upserts a
  proposed plan.

The ACP adapter does not currently emit subagent, hook, task, token usage,
reasoning, telemetry, `tool.progress`, `tool.summary`, or `turn.diff.updated`
events.

Native logging covers ACP protocol, request, update, and extension events.
ACP `ModeChanged` events are logged or suppressed at the adapter boundary and do
not produce canonical runtime events.

### `cursorSdk`

Primary file: `packages/server/src/provider/CursorSdkAdapter.ts`

Native sources:

- `cursor.sdk.delta`
- `cursor.sdk.message`

Emitted canonical events:

- Session, thread, and turn lifecycle. Ingestion writes session commands.
- `content.delta` with assistant text, reasoning text, and command output.
  Assistant text becomes message commands; command output becomes tool output;
  reasoning text is unhandled.
- `tool.summary` from summary deltas and stream messages. Ingestion appends a
  `tool.summary` activity.
- `item.started`, `item.updated`, and `item.completed` for tools, assistant
  messages, and git interactions. Tool lifecycle items become activities;
  completed assistant messages finalize assistant messages.

The Cursor SDK adapter does not currently emit approval, user-input, subagent,
plan, proposed-plan, diff, hook, task, token usage, or account/MCP telemetry
events. Adapter-level request response methods fail before ingestion.

Native logging records `onDelta` and `run.stream` payloads. Some SDK interaction
updates are native-log-only and produce no canonical event.

### `opencode`

Primary file: `packages/server/src/provider/OpenCodeAdapter.ts`

Native source:

- `opencode.sdk.event`

Emitted canonical events:

- Session, thread, and turn lifecycle. Ingestion writes session commands.
- `content.delta` with assistant and reasoning text. Assistant text becomes
  message commands; reasoning text is unhandled.
- `item.started`, `item.updated`, and `item.completed` for tool and assistant
  items. Tool lifecycle items become activities; completed assistant items
  finalize assistant messages.
- Subagent events for task and collab-agent tools. These become subagent
  activities only.
- `request.opened` and `request.resolved` from permission events. These become
  approval activities, although some resolution payloads use
  `requestType: "unknown"`.
- `user-input.requested` and `user-input.resolved` from question events. These
  become user-input activities.
- `runtime.warning` and `runtime.error`. Errors update session state and append
  an activity; warnings append an activity.

The OpenCode adapter does not currently emit `session.configured`,
`session.state.changed`, thread metadata, token usage, plan/proposed-plan/diff,
hook, task, `tool.summary`, `files.persisted`, or account/MCP telemetry events.

Native logging records handled SDK events and subagent-routed events.

## Logging coverage

`packages/server/src/provider/EventNdjsonLogger.ts` defines three streams:
`native`, `canonical`, and `orchestration`.

| Stream | Production coverage | Notes |
| --- | --- | --- |
| `native` | Wired for all five built-in adapters | Records provider-native payloads before canonical mapping. |
| `canonical` | Wired through `ProviderService.publishRuntimeEvent` | Records every emitted `ProviderRuntimeEvent`. |
| `orchestration` | Not wired in production | The stream type exists and tests cover the logger helper, but ingestion does not write post-mapping commands or activities to it. |

The native stream label is currently `NTIVE`. Canonical and orchestration both
resolve to `CANON`, so line prefixes cannot distinguish those streams if
orchestration logging is wired later without changing the logger.

## Findings for later phases

- The contract has a wider event vocabulary than ingestion handles. Current
  unhandled families include `thread.realtime.*`, Claude hooks, `tool.progress`,
  provider account/MCP telemetry, auth status, model reroutes, and config or
  deprecation notices.
- `tool.summary` has its own activity kind. Composer should render it without
  treating it as task completion.
- Main-thread reasoning streams are emitted by multiple adapters but do not
  become messages or activities.
- Subagent assistant text stays on the activity path only. It does not use the
  assistant message command path.
- Runtime approvals still enter ingestion as `requestType`; ingestion derives
  `requestKind` locally. OpenCode sometimes resolves permissions with
  `requestType: "unknown"`.
