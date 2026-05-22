# Cursor-Style Subagent Panel Implementation Plan

## Scope

This document plans a Cursor-style subagent details and running-log surface for Multi.

It uses three evidence sources:

- Cursor installed app bundle:
  - `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js`
  - `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.css`
- GitHub source checked out through `codebase`:
  - OpenAI Codex: `/Users/workgyver/.agents/codebases/openai-codex`
  - Cursor public repo: `/Users/workgyver/.agents/codebases/cursor-public`
- Multi local source in `/Users/workgyver/Developer/multi`.

The public Cursor GitHub repo is not the workbench source. It only contains `README.md`, `SECURITY.md`, and an issue template. Cursor workbench evidence therefore comes from the installed app bundle. Do not copy Cursor source into Multi. Use the verified selectors, commands, and layout behavior as an implementation reference.

## Repo Constraints

From `AGENTS.md`:

- Docs-only plan. No tests are needed for this document.
- Keep implementation future work type-safe. No `any`.
- Use `central-icons`; do not add Lucide.
- Keep Tailwind utilities on elements or in `cva` variants.
- Do not create decorative class buckets unless they are real CSS/test selectors.
- Keybindings must be configurable.
- Do not commit unless requested.

## Codebase Sources

### OpenAI Codex

`codebase update openai-codex` resolved:

```text
c83ba22359f4140e44fc43500d2bedbb882d7211
2026-05-21 20:40:34 -0700
Allow parallel MCP tool calls when annotated readOnly (#23750)
```

Important source anchors:

- `codex-rs/app-server-protocol/src/protocol/v2/item.rs`
- `codex-rs/app-server-protocol/src/protocol/event_mapping.rs`
- `codex-rs/app-server-protocol/src/protocol/v2/thread.rs`
- `codex-rs/core/src/tools/handlers/multi_agents_v2/wait.rs`
- `codex-rs/app-server/README.md`

### Cursor Public Repo

`codebase add github:cursor/cursor --name cursor-public --force` resolved:

```text
654b1b4775ca67aef473bd31a14c8c04a1abde2d
2026-05-12 10:25:06 -0500
Merge pull request #4040 from cursor/cursor/readme-content-29ec
```

It does not include workbench source. `git ls-tree -r HEAD` lists:

```text
.github/ISSUE_TEMPLATE/new-issue.md
README.md
SECURITY.md
```

## Cursor Bundle Evidence

The Cursor bundle is minified. Use byte offsets instead of line numbers.

### Exact JS Tokens

| Exact token | Bundle offset | Meaning for Multi |
| --- | ---: | --- |
| `Start multitasking` | `38118423` | Client-level multitask entrypoint text. |
| `Build in Parallel` | `4328967`, `38110644` | Plan/build action that routes to parallel work. |
| `subagentInfo` | `15287955` | First-class subagent request metadata. |
| `agentTranscriptsFolder` | `7327391` | Request/environment path for transcripts. |
| `taskThreadIdByComposerId` | `61757733` | Explicit child task to thread mapping. |
| `subagentStatusesByComposerId` | `61765849` | Derived status map by child composer id. |
| `createdFromBackgroundAgent` | `18496993` | Local chat can be linked to cloud/background agent origin. |
| `openAgentById` | `29759961` | Open/select local agent command path. |
| `ensureLoadableCloudSubagent` | `26388138` | Hydrate cloud subagent before opening. |
| `glass.openCloudAgentById` | `61284201` | Command used to open a cloud/background agent by id. |
| `composer.openBackgroundComposerAsChat` | `37685005` | Opens a background composer as chat. |
| `agent-panel-meta-agent-chat-shell ui-imsg-thread` | `61838132` | Main Agent Panel chat shell tag. |
| `composer-async-subagent-task-notification` | `37900393` | Async subagent notification card. |
| `agent-panel-meta-agent-chat__status-open-button` | `61801500` | Hover/focus open affordance in status rows. |

### Exact CSS Selectors

| Cursor selector/tag | CSS offset | Styling behavior to reproduce in Multi |
| --- | ---: | --- |
| `.agent-panel` | `1716975` | Agent panel root, positioned container. |
| `.agent-panel-conversation-shell` | `1721731` | Full-height flex column chat shell. |
| `.agent-sidebar` | `988566` | Dense navigation/control rail. |
| `.composer-async-subagent-task-notification` | `711955` | Compact async subagent card body. |
| `.composer-async-subagent-response-card` | `712535` | Bordered result card with hover open hint. |
| `.composer-async-subagent-response-card__open-hint` | `712535` | Hidden until hover/focus. |
| `.composer-async-subagent-task-notification__cloud-actions` | `712535` | Wrapped action pill row. |
| `.meta-async-task-card` | `783077` | Wrapper for task/subagent card. |
| `.meta-async-nested-subagent-action-button--view-plan` | `783077` | High-attention view-plan action style. |
| `.ui-subagent-status-indicator__dot--error` | `783168` | Muted error indicator override. |
| `.ui-meta-agent-status-row` | `1798377` | Animated status row with name and task text. |
| `.ui-meta-agent-status-row__name` | `1798377` | Name text changes color on row hover/focus. |
| `.ui-meta-agent-status-row__task` | `1798377` | Task text color/shimmer state. |
| `.agent-panel-meta-agent-chat__status-trigger` | `1798377` | Clickable status row trigger. |
| `.agent-panel-meta-agent-chat__status-container` | `1798377` | Inline status row container. |
| `.agent-panel-meta-agent-chat__status-open-button` | `1799867` | Hover/focus only open button. |
| `.agent-panel-meta-agent-chat__thread-overlay` | `1808155` | Absolute nested thread overlay. |

Cursor styling pattern to apply, not copy:

- Main chat content is centered and max-width constrained.
- Subagent rows are inline, compact, and hover-reactive.
- Open controls are hidden until hover/focus.
- Nested thread details open as an overlay, not as another full page.
- Async subagent result cards use transparent background, tertiary border, clipped quote text, and action pills.

## Actual Codex Source Facts

### `collabAgentToolCall` Is Metadata, Not A Transcript

OpenAI Codex source defines the collab tool call item in `item.rs`.

```rust
CollabAgentToolCall {
    id: String,
    tool: CollabAgentTool,
    status: CollabAgentToolCallStatus,
    sender_thread_id: String,
    receiver_thread_ids: Vec<String>,
    prompt: Option<String>,
    model: Option<String>,
    reasoning_effort: Option<ReasoningEffort>,
    agents_states: HashMap<String, CollabAgentState>,
}
```

Source: `/Users/workgyver/.agents/codebases/openai-codex/codex-rs/app-server-protocol/src/protocol/v2/item.rs:312`.

`CollabAgentState` only carries status and message:

```rust
pub struct CollabAgentState {
    pub status: CollabAgentStatus,
    pub message: Option<String>,
}
```

Source: `/Users/workgyver/.agents/codebases/openai-codex/codex-rs/app-server-protocol/src/protocol/v2/item.rs:1018`.

Valid Codex status values:

```text
pendingInit
running
interrupted
completed
errored
shutdown
notFound
```

Multi currently normalizes only a subset in `resolveSubagentStatusLabel`.

### `thread/read` Can Read A Provider Thread

Codex source:

```rust
pub struct ThreadReadParams {
    pub thread_id: String,
    pub include_turns: bool,
}
```

Source: `/Users/workgyver/.agents/codebases/openai-codex/codex-rs/app-server-protocol/src/protocol/v2/thread.rs:1132`.

Codex app-server docs state that `thread/read` fetches a stored thread by id and `includeTurns` populates `thread.turns`.

Source: `/Users/workgyver/.agents/codebases/openai-codex/codex-rs/app-server/README.md:404`.

### `wait_agent` V2 Does Not Return Child Content

Codex `wait_agent` v2 result:

```rust
pub(crate) struct WaitAgentResult {
    pub(crate) message: String,
    pub(crate) timed_out: bool,
}
```

Source: `/Users/workgyver/.agents/codebases/openai-codex/codex-rs/core/src/tools/handlers/multi_agents_v2/wait.rs:113`.

The spec test requires the tool description to say it does not return content.

Source: `/Users/workgyver/.agents/codebases/openai-codex/codex-rs/core/src/tools/handlers/multi_agents_spec_tests.rs:277`.

## Multi Current State

### Frontend

`WorkLogSubagent` currently stores status metadata only:

- `threadId`
- `providerThreadId`
- `resolvedThreadId`
- `agentId`
- `nickname`
- `role`
- `model`
- `prompt`
- `rawStatus`
- `latestUpdate`
- token usage fields

Source: `packages/app/src/session-logic.ts:50`.

Subagents are extracted from provider payloads:

- receiver ids: `packages/app/src/session/subagents.ts:59`
- receiver agents: `packages/app/src/session/subagents.ts:90`
- agent states: `packages/app/src/session/subagents.ts:295`

The UI renders a compact status-only surface:

- `packages/app/src/components/chat/message/tool-message.tsx:45`
- `packages/app/src/components/chat/message/tool-message.tsx:50`

`ToolCallRenderer` already has an unused nested content hook:

```ts
subagentConversation?: ReactNode;
```

Source: `packages/app/src/components/chat/message/tool-renderer.tsx:91`.

`TaskToolCall` expands only when `subagentConversation` or `renderStep` is supplied.

Source: `packages/app/src/components/chat/message/tool-renderer.tsx:417`.

### Backend

Codex runtime records child receiver thread ids against the parent turn:

- `packages/server/src/provider/CodexSessionRuntime.ts:577`
- `packages/server/src/provider/CodexSessionRuntime.ts:594`

It suppresses child thread and turn lifecycle notifications:

- `thread/started`
- `thread/status/changed`
- `thread/archived`
- `thread/unarchived`
- `thread/closed`
- `thread/compacted`
- `thread/name/updated`
- `turn/started`
- `turn/completed`
- `turn/plan/updated`
- `item/plan/delta`

Source: `packages/server/src/provider/CodexSessionRuntime.ts:599`.

Only child token usage preserves `providerConversationId`:

Source: `packages/server/src/provider/CodexSessionRuntime.ts:840`.

Ingestion converts child token usage into `subagent.usage.updated`:

Source: `packages/server/src/orchestration/ProviderRuntimeIngestion.ts:429`.

Provider contracts currently expose `providerConversationId` on raw provider events, but the normalized runtime refs do not carry provider thread identity.

Sources:

- `packages/contracts/src/provider.ts:124`
- `packages/contracts/src/provider-runtime.ts:44`

## Gap

Multi cannot have Cursor-class subagent details/running logs because the canonical pipeline collapses or suppresses the child thread identity needed to group child output.

The blocker is not UI rendering. The blocker is the missing durable identity envelope:

- child provider thread id
- parent provider thread id
- parent turn id
- parent collab item id
- child provider turn id
- child provider item id
- child event stream kind
- agent title metadata

Without that envelope, React would have to parse raw provider payloads and guess ownership. That would duplicate adapter logic and make the UI provider-specific.

## Implementation Plan

### Phase 1: Normalize Existing Status Rows

Files:

- `packages/app/src/session/subagents.ts`
- `packages/app/src/session-logic.ts`
- `packages/app/src/components/chat/message/tool-message.tsx`

Changes:

1. Extend `resolveSubagentStatusLabel` to cover every Codex status:

```ts
pendingInit -> "Starting"
running -> "Running"
interrupted -> "Interrupted"
completed -> "Completed"
errored -> "Failed"
shutdown -> "Stopped"
notFound -> "Missing"
```

2. Preserve raw status for data selectors:

```tsx
data-subagent-state={subagent.rawStatus ?? "unknown"}
```

3. Keep the existing compact row, but make it clickable only when a child snapshot is available.

4. Use existing `central-icons` imports already present in `tool-renderer.tsx` where possible:

- `IconClock` for running.
- `IconRobot` for agent/subagent.
- `IconChevronRightMedium` for expandable rows.

Do not add Lucide.

### Phase 2: Add Provider Thread Identity To Contracts

Files:

- `packages/contracts/src/provider-runtime.ts`
- `packages/contracts/src/provider.ts`
- affected provider adapters

Change `ProviderRefs` from provider turn/item/request only to include thread lineage:

```ts
const ProviderRefs = Schema.Struct({
  providerThreadId: Schema.optional(TrimmedNonEmptyStringSchema),
  parentProviderThreadId: Schema.optional(TrimmedNonEmptyStringSchema),
  providerTurnId: Schema.optional(TrimmedNonEmptyStringSchema),
  providerItemId: Schema.optional(ProviderItemId),
  providerRequestId: Schema.optional(ProviderRequestId),
});
```

Add a shared subagent identity payload:

```ts
const RuntimeSubagentRef = Schema.Struct({
  providerThreadId: TrimmedNonEmptyStringSchema,
  parentProviderThreadId: Schema.optional(TrimmedNonEmptyStringSchema),
  parentTurnId: Schema.optional(TurnId),
  parentItemId: Schema.optional(ProviderItemId),
  agentId: Schema.optional(TrimmedNonEmptyStringSchema),
  nickname: Schema.optional(TrimmedNonEmptyStringSchema),
  role: Schema.optional(TrimmedNonEmptyStringSchema),
  model: Schema.optional(TrimmedNonEmptyStringSchema),
  prompt: Schema.optional(TrimmedNonEmptyStringSchema),
});
```

Do this as a clean contract break. Do not add compatibility shims unless a caller requires them.

### Phase 3: Preserve Child Routes In Codex Runtime

File:

- `packages/server/src/provider/CodexSessionRuntime.ts`

Replace the current `Map<string, TurnId>` with a route object:

```ts
interface CollabReceiverRoute {
  providerThreadId: string;
  parentTurnId: TurnId;
  parentItemId?: ProviderItemId | undefined;
  senderProviderThreadId?: string | undefined;
}
```

Update `rememberCollabReceiverTurns` to store:

- receiver provider thread id
- parent turn id
- parent item id
- sender provider thread id when present

Update `handleRawNotification` so every child event includes:

- `providerConversationId`
- `parentProviderConversationId`
- `parentTurnId`
- `parentItemId`

Current code only attaches `providerConversationId` for token usage. That must change before a nested log UI is reliable.

### Phase 4: Add Child Thread Reading

Files:

- `packages/server/src/provider/ProviderAdapter.service.ts`
- `packages/server/src/provider/CodexSessionRuntime.ts`
- `packages/server/src/provider/CodexAdapter.ts`
- callers of `readThread`

Change the adapter API from positional canonical thread id to an explicit selector:

```ts
readonly readThread: (
  input: ProviderThreadReadInput,
) => Effect.Effect<ProviderThreadSnapshot, TError>;
```

Shape:

```ts
interface ProviderThreadReadInput {
  threadId: ThreadId;
  providerThreadId?: string | undefined;
  includeTurns?: boolean | undefined;
}
```

Codex runtime implementation:

- default to current session provider thread id for normal reads
- use `input.providerThreadId` for subagent thread reads
- call Codex `thread/read` with `includeTurns: true`
- return both canonical thread id and provider thread id

### Phase 5: Project Nested Subagent Activities

Files:

- `packages/server/src/provider/CodexAdapter.ts`
- `packages/server/src/orchestration/ProviderRuntimeIngestion.ts`
- `packages/server/src/orchestration/Schemas.ts`
- `packages/server/src/orchestration/ThreadProjection.ts`

Add runtime event types:

```text
subagent.thread.started
subagent.thread.state.changed
subagent.item.started
subagent.item.updated
subagent.item.completed
subagent.content.delta
subagent.usage.updated
```

Rules:

- Parent conversation remains the top-level timeline.
- Child events are stored under parent tool call id and child provider thread id.
- Child assistant deltas become nested content, not parent `content.delta`.
- Child command/file/MCP events become nested tool rows.
- `subagent.usage.updated` remains keyed by provider thread id.

### Phase 6: Build Cursor-Style UI In Multi

Files:

- `packages/app/src/components/chat/message/tool-message.tsx`
- `packages/app/src/components/chat/message/tool-renderer.tsx`
- new file: `packages/app/src/components/chat/message/subagent-thread.tsx`
- optional new file: `packages/app/src/components/chat/message/subagent-status-row.tsx`
- `packages/app/src/session-logic.ts`
- `packages/app/src/types.ts`

Use Multi-native Tailwind and `cva`. Do not copy Cursor CSS.

#### Component Map

| Cursor tag | Multi component | Notes |
| --- | --- | --- |
| `.ui-meta-agent-status-row` | `SubagentStatusRow` | Inline row with indicator, name, task/status. |
| `.agent-panel-meta-agent-chat__status-open-button` | `SubagentOpenButton` | Hidden until row hover/focus. |
| `.composer-async-subagent-task-notification` | `SubagentTaskCard` | Quote, status, result, actions. |
| `.composer-async-subagent-response-card` | `SubagentResponseCard` | Bordered result preview. |
| `.agent-panel-meta-agent-chat__thread-overlay` | `SubagentThreadOverlay` | Absolute overlay within timeline surface. |
| `.agent-sidebar` | later `AgentThreadsRail` | Not required for first nested-log implementation. |

#### Data Selectors

Use real selectors for tests and behavior:

```tsx
data-subagent-row=""
data-subagent-state={state}
data-subagent-open=""
data-subagent-thread-overlay=""
data-subagent-provider-thread-id={providerThreadId}
```

Avoid decorative CSS class buckets. Keep visual styling in Tailwind or `cva`.

#### Row Styling

Multi equivalent of Cursor status row:

```tsx
<button
  type="button"
  className={cn(
    "group/subagent-row inline-flex min-h-6 w-fit max-w-full min-w-0 items-center gap-1 overflow-hidden",
    "border-0 bg-transparent p-0 text-left text-detail text-multi-fg-secondary",
    "hover:text-multi-fg-primary focus-visible:text-multi-fg-primary",
  )}
  data-subagent-row=""
>
```

Indicator:

```tsx
<span
  className={cn(
    "size-1.5 shrink-0 rounded-full bg-multi-icon-tertiary",
    isRunning && "bg-multi-icon-accent-primary",
    isFailed && "bg-multi-fg-red-primary",
  )}
/>
```

Open button:

```tsx
<span
  className={cn(
    "ml-1 inline-flex opacity-0 transition-opacity duration-100",
    "group-hover/subagent-row:opacity-100 group-focus-visible/subagent-row:opacity-100",
  )}
  data-subagent-open=""
>
```

#### Card Styling

Multi equivalent of Cursor async subagent result card:

```tsx
<div
  className={cn(
    "mt-1 box-border w-full overflow-hidden rounded-md border border-multi-stroke-tertiary",
    "bg-transparent px-(--conversation-tool-card-padding-x) py-1.5",
  )}
  data-subagent-response-card=""
>
```

Quote preview:

```tsx
<div className="line-clamp-2 min-w-0 overflow-hidden text-detail text-multi-fg-tertiary">
```

Actions:

```tsx
<div className="mt-2 flex flex-wrap items-center gap-1.5" data-subagent-actions="">
```

#### Overlay Styling

Multi already centers timeline content with `mx-auto box-border w-full max-w-agent-chat`.

Source: `packages/app/src/components/chat/timeline/messages-timeline.tsx:446`.

Build the overlay inside the message/tool surface:

```tsx
<div
  className={cn(
    "absolute inset-0 z-20 min-h-0 overflow-y-auto overscroll-contain",
    "bg-multi-bg-primary/95 backdrop-blur-sm",
  )}
  data-subagent-thread-overlay=""
>
```

Keep reduced-motion behavior through existing motion utilities or media-query CSS if the overlay gets transitions.

### Phase 7: Hydrate On Demand

Flow:

1. Render status row from current worklog metadata.
2. If `providerThreadId` exists, row is clickable.
3. On click, request child thread snapshot using the new provider-thread selector.
4. Store snapshot by:

```text
parentThreadId + parentTurnId + parentItemId + providerThreadId
```

5. Pass rendered nested timeline into `ToolCallRenderer.subagentConversation`.
6. Keep live events updating the same nested snapshot while the child is running.

This matches Cursor's behavior: status row first, details on demand, overlay when a thread-level context is needed.

## File-Level Checklist

### Contracts

- `packages/contracts/src/provider-runtime.ts`
  - add provider thread lineage to `ProviderRefs`
  - add `RuntimeSubagentRef`
  - add `subagent.*` runtime events

- `packages/contracts/src/provider.ts`
  - preserve provider conversation ids consistently
  - add child/parent provider conversation fields if kept at raw event level

### Server

- `packages/server/src/provider/CodexSessionRuntime.ts`
  - replace child route map value with `CollabReceiverRoute`
  - emit child provider identity on every child event
  - allow `readThread` to target child provider thread id

- `packages/server/src/provider/CodexAdapter.ts`
  - carry provider thread lineage into runtime events
  - route child events to `subagent.*`

- `packages/server/src/orchestration/ProviderRuntimeIngestion.ts`
  - persist nested subagent activities
  - avoid flattening child output into parent worklog

- `packages/server/src/orchestration/ThreadProjection.ts`
  - expose child subagent activities to the app projection

### App

- `packages/app/src/session-logic.ts`
  - add child transcript/snapshot projection fields
  - normalize all Codex subagent statuses
  - keep `WorkLogSubagent` metadata small and derive UI state

- `packages/app/src/components/chat/message/tool-message.tsx`
  - make subagent rows clickable when thread data is available
  - pass `subagentConversation` into `ToolCallRenderer`

- `packages/app/src/components/chat/message/tool-renderer.tsx`
  - keep existing `TaskToolCall` expansion contract
  - do not add provider-specific parsing here

- `packages/app/src/components/chat/message/subagent-thread.tsx`
  - render nested child messages/tools using normalized projection data

## Verification Plan

For implementation, not this document:

1. Run `pnpm run typecheck`.
2. Add focused unit coverage only for changed derivation/projection logic.
3. If UI changes are implemented, use browser verification for:
   - running status row
   - completed status row
   - failed status row
   - open nested thread overlay
   - long quote clipping
   - hover/focus open affordance

No broad tests unless the implementation touches test infrastructure or the user requests them.

## Decision Summary

Implement the Cursor shape in Multi, but not by copying Cursor code.

The correct architecture is:

1. Durable child provider thread identity.
2. Normalized nested subagent runtime events.
3. Projection-backed child transcript snapshots.
4. Cursor-style status rows and overlays built with Multi Tailwind and `central-icons`.

The first shippable slice is status row polish plus exact Codex status normalization. The full Cursor-style running-log panel requires the contract and ingestion changes first.
