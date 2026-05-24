# Cursor-Style Subagent Panel Implementation Plan

## Scope

This document plans a Cursor-style subagent details and running-log surface for Multi.

## Current Diagnosis (May 2026)

Observed on thread `9215a343-0772-47b8-b0d4-ab055bea4760`:

- Provider log shows Codex subagent events flowing correctly: `subagent.thread.state.changed`, `subagent.item.started`, `subagent.content.delta`, with child `providerThreadId` `019e50df-9bfc-7f81-8b61-5a193b320e3c`.
- UI shows only a normal work-group timeline row (`data-timeline-row-kind="work"`, `data-meta-agent-chat-message-kind="tool-call"` in `TimelineRowContent`). No composer tray appears on click.

This is a **UI wiring issue**, not a provider/adapter gap for Codex.

What exists today:

| Piece                                               | Status                                                    |
| --------------------------------------------------- | --------------------------------------------------------- |
| Codex `subagent.*` normalization                    | Working                                                   |
| `WorkLogSubagent` + status rows in timeline         | Partial — rows render under Task tool                     |
| `packages/app/src/stores/subagent-preview-store.ts` | Created, **not consumed**                                 |
| Composer followup tray stack                        | **Not implemented**                                       |
| Click → open preview                                | Opens inline `CollapsiblePanel` in timeline (wrong layer) |

What Cursor actually does on subagent click:

- Does **not** open a message popover or inline collapsible in the transcript.
- Opens a **composer followup header tray stack** above the prompt input:
  - `agent-panel-followup-header-tray-stack`
  - `agent-panel-followup-header-non-stacked-tray`
  - `ui-prompt-input-header-tray`
  - `agent-panel-subagent-preview-tray-container` — nested conversation (~70dvh) with header (back / close / expand / title)

Multi equivalents to mirror:

- `PlanFollowUpTray` and `QueuedComposerItemsTray` in `packages/app/src/components/chat/composer/input.tsx`
- Base UI `Collapsible` for tray open/close at the composer layer, not inside timeline rows

Additional timeline wiring gap:

- Running work-group preview passes `subagentDetailsEnabled={false}` to `ToolCallMessage`, so status rows in the collapsed preview are non-interactive even before the tray exists.

It uses three evidence sources:

- Cursor installed app bundle:
  - `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js`
  - `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.css`
- GitHub source checked out through `codebase`:
  - OpenAI Codex: `/Users/workgyver/.agents/codebases/openai-codex`
  - OpenCode: `/Users/workgyver/.agents/codebases/opencode`
  - Agent Client Protocol TypeScript SDK: `/Users/workgyver/.agents/codebases/acp-typescript-sdk`
  - Claude Agent SDK TypeScript: `/Users/workgyver/.agents/codebases/claude-agent-sdk-typescript`
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

### Agent Client Protocol TypeScript SDK

`codebase add github:agentclientprotocol/typescript-sdk --name acp-typescript-sdk --force` resolved:

```text
47da5c6657aa39ae03d039c6d7cf33cc7eada1f4
2026-05-18 23:09:02 +0200
chore(main): release 0.22.1 (#154)
```

ACP `SessionUpdate` exposes session chunks, tool calls, plan updates, config/mode updates, and usage updates. It does not define a first-class child thread or child transcript update shape.

Source: `/Users/workgyver/.agents/codebases/acp-typescript-sdk/src/schema/types.gen.ts:5055`.

Official docs: <https://agentclientprotocol.github.io/typescript-sdk/types/SessionUpdate.html>.

### Claude Agent SDK TypeScript

`codebase add github:anthropics/claude-agent-sdk-typescript --name claude-agent-sdk-typescript --force` resolved:

```text
321a1055052a79f3703aa06bff7d550a371c115b
2026-05-22 01:16:48 +0000
chore: Update CHANGELOG.md
```

The public checkout is mostly docs, changelog, and examples. The changelog confirms the SDK emits subagent task lifecycle messages:

- `task_started`
- `task_progress`
- `task_notification`

Source: `/Users/workgyver/.agents/codebases/claude-agent-sdk-typescript/CHANGELOG.md:369`.

Official docs: <https://platform.claude.com/docs/en/agent-sdk/typescript>.

### OpenCode

`codebase update opencode` resolved:

```text
8a5592053144aaad4d8804382644ac0312b5e6dd
2026-05-22 16:25:15 +0000
chore: generate
```

Important source anchors:

- `packages/opencode/src/tool/task.ts`
- `packages/opencode/src/tool/task_status.ts`
- `packages/opencode/src/cli/cmd/run/types.ts`
- `packages/opencode/src/cli/cmd/run/subagent-data.ts`
- `packages/opencode/src/cli/cmd/run/footer.command.tsx`
- `packages/opencode/src/cli/cmd/run/footer.subagent.tsx`
- `packages/ui/src/components/message-part.tsx`

Official source: <https://github.com/anomalyco/opencode>.

## Cursor Bundle Evidence

The Cursor bundle is minified. Use byte offsets instead of line numbers.

### Exact JS Tokens

| Exact token                                        |         Bundle offset | Meaning for Multi                                          |
| -------------------------------------------------- | --------------------: | ---------------------------------------------------------- |
| `Start multitasking`                               |            `38118423` | Client-level multitask entrypoint text.                    |
| `Build in Parallel`                                | `4328967`, `38110644` | Plan/build action that routes to parallel work.            |
| `subagentInfo`                                     |            `15287955` | First-class subagent request metadata.                     |
| `agentTranscriptsFolder`                           |             `7327391` | Request/environment path for transcripts.                  |
| `taskThreadIdByComposerId`                         |            `61757733` | Explicit child task to thread mapping.                     |
| `subagentStatusesByComposerId`                     |            `61765849` | Derived status map by child composer id.                   |
| `createdFromBackgroundAgent`                       |            `18496993` | Local chat can be linked to cloud/background agent origin. |
| `openAgentById`                                    |            `29759961` | Open/select local agent command path.                      |
| `ensureLoadableCloudSubagent`                      |            `26388138` | Hydrate cloud subagent before opening.                     |
| `glass.openCloudAgentById`                         |            `61284201` | Command used to open a cloud/background agent by id.       |
| `composer.openBackgroundComposerAsChat`            |            `37685005` | Opens a background composer as chat.                       |
| `agent-panel-meta-agent-chat-shell ui-imsg-thread` |            `61838132` | Main Agent Panel chat shell tag.                           |
| `composer-async-subagent-task-notification`        |            `37900393` | Async subagent notification card.                          |
| `agent-panel-meta-agent-chat__status-open-button`  |            `61801500` | Hover/focus open affordance in status rows.                |
| `agent-panel-followup-header-tray-stack`           |                bundle | Stacked tray layers above composer input.                  |
| `agent-panel-followup-header-non-stacked-tray`     |                bundle | Single followup tray slot.                                 |
| `ui-prompt-input-header-tray`                      |                bundle | Tray visibility / trigger wrapper on prompt header.        |
| `agent-panel-subagent-preview-tray-container`      |                bundle | Nested subagent conversation preview panel.                |

### Exact CSS Selectors

| Cursor selector/tag                                         | CSS offset | Styling behavior to reproduce in Multi                                          |
| ----------------------------------------------------------- | ---------: | ------------------------------------------------------------------------------- |
| `.agent-panel`                                              |  `1716975` | Agent panel root, positioned container.                                         |
| `.agent-panel-conversation-shell`                           |  `1721731` | Full-height flex column chat shell.                                             |
| `.agent-sidebar`                                            |   `988566` | Dense navigation/control rail.                                                  |
| `.composer-async-subagent-task-notification`                |   `711955` | Compact async subagent card body.                                               |
| `.composer-async-subagent-response-card`                    |   `712535` | Bordered result card with hover open hint.                                      |
| `.composer-async-subagent-response-card__open-hint`         |   `712535` | Hidden until hover/focus.                                                       |
| `.composer-async-subagent-task-notification__cloud-actions` |   `712535` | Wrapped action pill row.                                                        |
| `.meta-async-task-card`                                     |   `783077` | Wrapper for task/subagent card.                                                 |
| `.meta-async-nested-subagent-action-button--view-plan`      |   `783077` | High-attention view-plan action style.                                          |
| `.ui-subagent-status-indicator__dot--error`                 |   `783168` | Muted error indicator override.                                                 |
| `.ui-meta-agent-status-row`                                 |  `1798377` | Animated status row with name and task text.                                    |
| `.ui-meta-agent-status-row__name`                           |  `1798377` | Name text changes color on row hover/focus.                                     |
| `.ui-meta-agent-status-row__task`                           |  `1798377` | Task text color/shimmer state.                                                  |
| `.agent-panel-meta-agent-chat__status-trigger`              |  `1798377` | Clickable status row trigger.                                                   |
| `.agent-panel-meta-agent-chat__status-container`            |  `1798377` | Inline status row container.                                                    |
| `.agent-panel-meta-agent-chat__status-open-button`          |  `1799867` | Hover/focus only open button.                                                   |
| `.agent-panel-meta-agent-chat__thread-overlay`              |  `1808155` | Legacy/alternate nested thread surface. Do not use as the primary click target. |
| `.agent-panel-followup-header-tray-stack`                   |     bundle | Stacked backdrop layers for composer followup trays.                            |
| `.agent-panel-subagent-preview-tray-container`              |     bundle | Nested subagent transcript panel above composer.                                |

Cursor styling pattern to apply, not copy:

- Main chat content is centered and max-width constrained.
- Subagent rows are inline, compact, and hover-reactive in the timeline.
- Open controls are hidden until hover/focus on the status row.
- **Primary click behavior:** open a composer followup header tray stack above the prompt input, not an inline timeline expansion or absolute overlay inside the message bubble.
- The preview tray is a bounded nested conversation (`~70dvh`) with its own header chrome.
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

`WorkLogSubagent` currently stores normalized metadata plus local detail fields:

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
- `logs`
- `hasDetails`

Source: `packages/app/src/session-logic.ts:50`.

Subagents are extracted from provider payloads:

- receiver ids: `packages/app/src/session/subagents.ts:59`
- receiver agents: `packages/app/src/session/subagents.ts:90`
- agent states: `packages/app/src/session/subagents.ts:295`

The UI renders a compact status surface in the timeline:

- `data-subagent-row`: `packages/app/src/components/chat/message/tool-message.tsx`
- `data-subagent-open`: `packages/app/src/components/chat/message/tool-message.tsx`
- `data-subagent-status-container`, `data-subagent-status-stack`, `data-subagent-entry`: status row chrome

**Not yet wired:**

- `packages/app/src/stores/subagent-preview-store.ts` — selection store for open preview
- Composer tray component — should render above `ComposerInput` shell (same slot as `PlanFollowUpTray`)
- Status row click should call `openPreview()`, not toggle a local inline `CollapsiblePanel`

Current incorrect behavior: `SubagentStatusRow` opens an inline `CollapsiblePanel` with `SubagentThreadPanel` inside the timeline row. This does not match Cursor and is easy to miss when the work group is collapsed or previewing.

`ToolCallRenderer` already has an unused nested content hook:

```ts
subagentConversation?: ReactNode;
```

Source: `packages/app/src/components/chat/message/tool-renderer.tsx:91`.

`TaskToolCall` expands only when `subagentConversation` or `renderStep` is supplied.

Source: `packages/app/src/components/chat/message/tool-renderer.tsx:417`.

### Backend

Provider contracts now include a provider-thread selector for snapshots:

```ts
export const ProviderThreadReadInput = Schema.Struct({
  threadId: ThreadId,
  providerThreadId: Schema.optional(TrimmedNonEmptyString),
  includeTurns: Schema.optional(Schema.Boolean),
});
```

Source: `packages/contracts/src/provider.ts:97`.

Provider runtime refs also include thread lineage:

```ts
export const RuntimeSubagentRef = Schema.Struct({
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

Source: `packages/contracts/src/provider-runtime.ts:53`.

Codex runtime records child receiver routes with the parent turn, parent item, and sender thread:

```ts
collabReceiverRoutes.set(receiverThreadId, {
  providerThreadId: receiverThreadId,
  parentTurnId: route.parentTurnId,
  parentItemId: route.parentItemId,
  senderProviderThreadId: notification.params.item.senderThreadId ?? route.senderProviderThreadId,
});
```

Source: `packages/server/src/provider/CodexSessionRuntime.ts:592`.

Codex raw notifications now preserve child and parent provider ids:

```ts
...(providerConversationId ? { providerConversationId } : {}),
...(childRoute?.senderProviderThreadId
  ? { parentProviderConversationId: childRoute.senderProviderThreadId }
  : {}),
...(childRoute?.parentItemId ? { parentItemId: childRoute.parentItemId } : {}),
```

Source: `packages/server/src/provider/CodexSessionRuntime.ts:845`.

Codex adapter maps child events to `subagent.*` only when both child and parent provider thread ids exist:

```ts
function subagentRefFromEvent(event: ProviderEvent): RuntimeSubagentRef | undefined {
  const providerThreadId = trimText(event.providerConversationId);
  const parentProviderThreadId = trimText(event.parentProviderConversationId);
  if (!providerThreadId || !parentProviderThreadId) {
    return undefined;
  }
  return { providerThreadId, parentProviderThreadId };
}
```

Source: `packages/server/src/provider/CodexAdapter.ts:433`.

## Other Adapter UI

Multi has four built-in adapters:

```ts
const CODEX_PROVIDER = ProviderDriverKind.make("codex");
const CLAUDE_AGENT_PROVIDER = ProviderDriverKind.make("claudeAgent");
const OPENCODE_PROVIDER = ProviderDriverKind.make("opencode");
const CURSOR_PROVIDER = ProviderDriverKind.make("cursor");
```

Source: `packages/server/src/provider/builtInProviderCatalog.ts:14`.

The shared UI should be provider-agnostic, but details must be capability-gated. A subagent row is allowed only when the adapter emits normalized `subagent.*` runtime events or can read a child provider thread by id.

### Adapter Capability Matrix

| Adapter  | Source shape                                                                                    | Multi UI today                                      | Cursor-style details rule                                                                                                              |
| -------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Codex    | App-server child provider thread ids plus `thread/read`                                         | Compact `data-subagent-row` status rows in timeline | Supported when `providerThreadId` exists. Click opens composer preview tray (not yet wired).                                           |
| Claude   | SDK task lifecycle summaries: `task_started`, `task_progress`, `task_notification`              | Normal `Subagent task` tool/task progress rows      | Do not show nested transcript UI until the SDK gives a readable child transcript or durable child thread id.                           |
| Cursor   | ACP `session/update` chunks, tool calls, plan, usage                                            | Generic ACP tool rows and plan updates              | Do not show Cursor private subagent UI from ACP. ACP does not expose child thread identity.                                            |
| OpenCode | Current adapter emits generic tool lifecycle; upstream task tool has child `sessionId` metadata | Normal `TaskToolCall` row for task/agent tools      | Can support the shared subagent UI after mapping task `metadata.sessionId` to `RuntimeSubagentRef` and reading child session messages. |

### Codex UI

Codex is the reference adapter for the shared subagent surface.

Codex maps child lifecycle, child items, child content deltas, and child usage into normalized events:

```text
subagent.thread.started
subagent.thread.state.changed
subagent.item.started
subagent.item.updated
subagent.item.completed
subagent.content.delta
subagent.usage.updated
```

Source: `packages/server/src/provider/CodexAdapter.ts:550`.

Codex adapter reads a child thread snapshot by forwarding `providerThreadId`:

```ts
getThreadSnapshot(input.threadId, {
  includeTurns: input.includeTurns ?? false,
  ...(input.providerThreadId ? { providerThreadId: input.providerThreadId } : {}),
});
```

Source: `packages/server/src/provider/CodexAdapter.ts:1832`.

UI to apply:

- Use the existing compact status row in the timeline under the Task tool.
- Show `data-subagent-open` on hover/focus and when the row matches the open preview key.
- On click, call `useSubagentPreviewStore.openPreview()` — do **not** toggle an inline timeline panel.
- Render nested transcript in the composer followup tray: `subagent.logs` first, then child `ProviderThreadSnapshot`.
- Hydrate snapshot on tray open via `getProviderThreadSnapshot({ providerThreadId })`.

Styling stays in Tailwind:

```tsx
"group/subagent-row inline-flex min-h-6 w-fit max-w-full min-w-0 items-center gap-1 overflow-hidden";
"border-0 bg-transparent p-0 text-left text-detail text-multi-fg-secondary";
"cursor-pointer hover:text-multi-fg-primary focus-visible:text-multi-fg-primary";
```

Source: `packages/app/src/components/chat/message/tool-message.tsx:170`.

### Claude UI

Claude tools are classified as subagent tasks by tool name:

```ts
if (
  normalized === "task" ||
  normalized === "agent" ||
  normalized.includes("subagent") ||
  normalized.includes("sub-agent")
) {
  return "collab_agent_tool_call";
}
```

Source: `packages/server/src/provider/ClaudeAdapter.ts:418`.

The user-facing title is:

```ts
case "collab_agent_tool_call":
  return "Subagent task";
```

Source: `packages/server/src/provider/ClaudeAdapter.ts:553`.

Claude SDK task messages are mapped to generic task events, not child transcript events:

```text
task_started -> task.started
task_progress -> task.progress
task_notification -> task.completed
```

Source: `packages/server/src/provider/ClaudeAdapter.ts:2136`.

UI to apply:

- Keep Claude in the normal tool/task row path.
- Use `TaskToolCall` for task tool calls and `ThinkingStatus` for task progress.
- Do not render `data-subagent-row` unless a future Claude SDK event exposes a durable child transcript id or child session reader.
- If `task_progress.summary` is present, use it as the visible progress detail, not as a fake nested log.

This avoids implying transcript availability that the adapter does not have.

### Cursor UI

Cursor in Multi is ACP-backed. ACP `SessionUpdate` includes content chunks, tool call updates, plan updates, config/mode updates, and usage updates:

```ts
export type SessionUpdate =
  | (ContentChunk & { sessionUpdate: "user_message_chunk" })
  | (ContentChunk & { sessionUpdate: "agent_message_chunk" })
  | (ContentChunk & { sessionUpdate: "agent_thought_chunk" })
  | (ToolCall & { sessionUpdate: "tool_call" })
  | (ToolCallUpdate & { sessionUpdate: "tool_call_update" })
  | (Plan & { sessionUpdate: "plan" })
  | (UsageUpdate & { sessionUpdate: "usage_update" });
```

Source: `/Users/workgyver/.agents/codebases/acp-typescript-sdk/src/schema/types.gen.ts:5055`.

Multi's Cursor adapter maps ACP updates into generic runtime events:

```text
AssistantItemStarted -> item.started
AssistantItemCompleted -> item.completed
PlanUpdated -> turn.plan.updated
ToolCallUpdated -> item.updated/item.completed
ContentDelta -> content.delta
```

Source: `packages/server/src/provider/CursorAdapter.ts:431`.

ACP tool calls are normalized by tool kind only:

```ts
case "read": return "file_read";
case "execute": return "command_execution";
case "edit":
case "delete":
case "move": return "file_change";
case "search": return "file_search";
case "fetch": return "web_fetch";
default: return "dynamic_tool_call";
```

Source: `packages/server/src/provider/acp/AcpCoreRuntimeEvents.ts:51`.

Cursor `readThread` only returns the active ACP session turns:

```ts
const ctx = yield * requireSession(input.threadId);
return { threadId: input.threadId, turns: ctx.turns };
```

Source: `packages/server/src/provider/CursorAdapter.ts:1271`.

UI to apply:

- Keep Cursor on generic tool rows and plan updates.
- Do not expose `data-subagent-row` for Cursor ACP output.
- Do not parse Cursor installed bundle internals at runtime.
- If ACP later adds child session/thread identity, map that in the adapter first, then reuse the same Multi `data-subagent-*` UI.

Cursor's own app has private workbench tags such as `.ui-meta-agent-status-row` and `.agent-panel-meta-agent-chat__thread-overlay`, but those are not available through ACP. They remain visual references only.

### OpenCode UI

Multi's current OpenCode adapter recognizes task/agent tools as collaboration tools:

```ts
if (normalized.includes("task") || normalized.includes("agent") || normalized.includes("subtask")) {
  return "collab_agent_tool_call";
}
```

Source: `packages/server/src/provider/OpenCodeAdapter.ts:172`.

But current OpenCode runtime mapping emits generic item lifecycle only:

```ts
type: part.state.status === "pending"
  ? "item.started"
  : part.state.status === "completed" || part.state.status === "error"
    ? "item.completed"
    : "item.updated";
```

Source: `packages/server/src/provider/OpenCodeAdapter.ts:717`.

Current `readThread` reads only the active OpenCode session id:

```ts
context.client.session.messages({ sessionID: context.openCodeSessionId });
```

Source: `packages/server/src/provider/OpenCodeAdapter.ts:1320`.

Upstream OpenCode has the missing identity. Its task tool creates a child session and stores it in tool metadata:

```ts
sessions.create({
  parentID: ctx.sessionID,
  title: params.description + ` (@${next.name} subagent)`,
});

const metadata = {
  parentSessionId: ctx.sessionID,
  sessionId: nextSession.id,
  model,
};
```

Source: `/Users/workgyver/.agents/codebases/opencode/packages/opencode/src/tool/task.ts:152`.

OpenCode also has a `task_status` tool that inspects or waits on a background task id:

```ts
metadata: {
  task_id: params.task_id,
  state: inspected.result.state,
  timed_out: inspected.timedOut,
}
```

Source: `/Users/workgyver/.agents/codebases/opencode/packages/opencode/src/tool/task_status.ts:157`.

OpenCode's direct CLI UI has a dedicated subagent selector and detail body:

```tsx
<PanelShell id="run-direct-footer-subagent-panel" title="Select subagent">
<RunFooterMenu id="run-direct-footer-subagent-list" empty="No active subagents" />
<box id="run-direct-footer-subagent">
```

Sources:

- `/Users/workgyver/.agents/codebases/opencode/packages/opencode/src/cli/cmd/run/footer.command.tsx:531`
- `/Users/workgyver/.agents/codebases/opencode/packages/opencode/src/cli/cmd/run/footer.subagent.tsx:113`

OpenCode derives its subagent tabs from task tool metadata:

```ts
function taskSessionID(part: ToolPart) {
  return text(metadata(part, "sessionId")) ?? text(metadata(part, "sessionID"));
}
```

Source: `/Users/workgyver/.agents/codebases/opencode/packages/opencode/src/cli/cmd/run/subagent-data.ts:312`.

OpenCode web UI uses generic tool tags, not a visible subagent transcript panel:

```tsx
data-component="context-tool-group-trigger"
data-component="context-tool-group-list"
data-component="tool-trigger"
data-slot="basic-tool-tool-title"
```

Source: `/Users/workgyver/.agents/codebases/opencode/packages/ui/src/components/message-part.tsx:951`.

UI to apply:

- Short term: keep OpenCode as a normal `TaskToolCall` row labelled from the task tool.
- Do not show the subagent popover until the adapter stores child `sessionId` as `RuntimeSubagentRef.providerThreadId`.
- Medium term: when a tool part has `metadata.sessionId`, emit `subagent.thread.started` and attach updates from that child session as `subagent.item.*` and `subagent.content.delta`.
- Change OpenCode `readThread` to honor `input.providerThreadId` by calling `session.messages({ sessionID: input.providerThreadId })`.
- Once that exists, use the same Multi tags as Codex: `data-subagent-row`, `data-subagent-open`, `data-subagent-followup-tray`, and `data-subagent-preview-container`.

Do not build an OpenCode-specific footer menu in Multi. Their TUI proves the data model and expected states, but Multi should keep one shared subagent surface.

## Gap

Multi cannot have Cursor-class subagent details/running logs for every adapter because only Codex currently provides both pieces needed by the shared UI:

- durable child provider thread identity
- adapter-level mapping from child output into normalized `subagent.*` runtime events

For Claude and Cursor, the blocker is upstream/adapter capability, not React rendering. For OpenCode, upstream has child session identity, but Multi's OpenCode adapter has not mapped that identity into `RuntimeSubagentRef` or taught `readThread` to read a child OpenCode session.

## Implementation Plan

### Phase 1: Split Timeline Status From Composer Preview

Files:

- `packages/app/src/components/chat/message/tool-message.tsx`
- `packages/app/src/components/chat/message/tool-renderer.tsx`
- `packages/app/src/stores/subagent-preview-store.ts`
- `packages/app/src/components/chat/composer/subagent-preview-tray.tsx` (new)
- `packages/app/src/components/chat/composer/input.tsx`
- `packages/app/src/session-logic.ts`

Rules:

- Timeline owns **status rows only**: `data-subagent-row`, `data-subagent-open`, `data-subagent-status-container`.
- Composer owns **preview tray**: `data-subagent-followup-tray-stack`, `data-subagent-followup-tray`, `data-subagent-preview-container`.
- Keep row styling in Tailwind on the element.
- Keep `central-icons` imports. Do not add Lucide.
- Keep the row clickable only when a real detail source exists: normalized subagent logs or readable `providerThreadId`.
- Do not parse provider-native payloads in React to invent child ownership.
- Remove inline `CollapsiblePanel` / `SubagentThreadPanel` from timeline rows once composer tray is wired.

### Phase 2: Capability-Gate Adapters

Files:

- `packages/app/src/session-logic.ts`
- `packages/app/src/components/chat/message/tool-message.tsx`
- `packages/server/src/provider/*Adapter.ts`

Rules:

- `codex`: enable the subagent row and details popover when `providerThreadId` exists.
- `claudeAgent`: render generic `Subagent task` and `task.progress`; no `data-subagent-row` until a durable child transcript id exists.
- `cursor`: render generic ACP tool rows and plans; no `data-subagent-row` from ACP output.
- `opencode`: render generic task rows until the adapter maps task metadata `sessionId` to `RuntimeSubagentRef`.

### Phase 3: Add OpenCode Child Session Support

Files:

- `packages/server/src/provider/OpenCodeAdapter.ts`
- `packages/app/src/session-logic.ts`
- `packages/app/src/components/chat/message/tool-message.tsx`

Changes:

1. Detect OpenCode task tool metadata:

```ts
metadata.sessionId ?? metadata.sessionID;
```

2. Map that child session id into:

```ts
RuntimeSubagentRef.providerThreadId;
RuntimeSubagentRef.parentProviderThreadId;
RuntimeSubagentRef.parentTurnId;
RuntimeSubagentRef.parentItemId;
```

3. Emit normalized events:

```text
subagent.thread.started
subagent.thread.state.changed
subagent.item.started
subagent.item.updated
subagent.item.completed
subagent.content.delta
```

4. Update OpenCode `readThread`:

```ts
const sessionID = input.providerThreadId ?? context.openCodeSessionId;
context.client.session.messages({ sessionID });
```

5. Once OpenCode emits child identity, reuse the exact same Multi UI tags as Codex:

```tsx
data-subagent-row=""
data-subagent-open=""
data-subagent-followup-tray=""
data-subagent-preview-container=""
```

### Phase 4: Keep Claude And Cursor Honest

Files:

- `packages/server/src/provider/ClaudeAdapter.ts`
- `packages/server/src/provider/CursorAdapter.ts`
- `packages/server/src/provider/acp/AcpCoreRuntimeEvents.ts`
- `packages/app/src/components/chat/message/tool-message.tsx`

Rules:

- Claude task events stay top-level task progress until the SDK provides a child transcript reader or child session id.
- Cursor ACP events stay generic tool/plan/content events until ACP provides child thread identity.
- Do not copy Cursor's private bundle tags into runtime behavior.
- Do not display an empty or fake subagent popover for either adapter.

### Phase 5: Composer Followup Tray Stack

Files:

- `packages/app/src/components/chat/message/tool-message.tsx`
- `packages/app/src/components/chat/composer/subagent-preview-tray.tsx` (new)
- `packages/app/src/components/chat/composer/input.tsx`
- `packages/app/src/stores/subagent-preview-store.ts`
- `packages/app/src/styles/conversation.css` (only if tray needs tokens beyond Tailwind)
- `packages/app/src/session-logic.ts`

Use Multi-native Tailwind and `cva`. Do not copy Cursor CSS. Use Base UI `Collapsible` at the composer layer.

#### Component Map

| Cursor tag                                         | Multi component                | Notes                                                                            |
| -------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------- |
| `.ui-meta-agent-status-row`                        | `SubagentStatusRow`            | Inline timeline row with indicator, name, task/status. Click sets preview store. |
| `.agent-panel-meta-agent-chat__status-open-button` | chevron on status row          | Hidden until row hover/focus or preview is open.                                 |
| `.agent-panel-followup-header-tray-stack`          | `SubagentPreviewTrayStack`     | Rendered above composer shell in `ComposerInput`.                                |
| `.agent-panel-subagent-preview-tray-container`     | `SubagentPreviewTrayContainer` | Bounded nested conversation with header chrome.                                  |
| `.composer-async-subagent-task-notification`       | `SubagentTaskCard`             | Optional later: quote, status, result, actions in timeline.                      |
| `.composer-async-subagent-response-card`           | `SubagentResponseCard`         | Optional later: bordered result preview in timeline.                             |
| `.agent-panel-meta-agent-chat__thread-overlay`     | —                              | **Do not implement.** Wrong layer; superseded by composer tray.                  |

#### Data Selectors

Use real selectors for tests and behavior:

```tsx
// Timeline
data-subagent-row=""
data-subagent-state={state}
data-subagent-open=""
data-subagent-provider-thread-id={providerThreadId}
data-subagent-status-container=""
data-subagent-status-stack=""

// Composer tray
data-subagent-followup-tray-stack=""
data-subagent-followup-tray=""
data-subagent-preview-container=""
data-subagent-preview-open=""
```

Avoid decorative CSS class buckets. Keep visual styling in Tailwind or `cva`.

#### Composer Wiring

Render the tray in `ComposerInput` above the composer shell, in the same column as `PlanFollowUpTray`:

```tsx
{
  preview ? (
    <SubagentPreviewTrayStack
      selection={preview}
      compact={composerVariant === "compact"}
      onClose={closePreview}
    />
  ) : null;
}
```

`SubagentPreviewTrayStack` reads `useSubagentPreviewStore`. Timeline rows write to the same store on click.

Mirror `PlanFollowUpTray` layout patterns:

- `plan-tray` elevation / border / shadow vocabulary
- `max-h-[70dvh]` on preview body
- header row: back/close, title, optional expand (later)

#### Row Styling

Multi equivalent of Cursor status row (timeline only — no nested panel):

```tsx
<button
  type="button"
  className={cn(
    "group/subagent-row inline-flex min-h-6 w-fit max-w-full min-w-0 items-center gap-1 overflow-hidden",
    "border-0 bg-transparent p-0 text-left text-detail text-multi-fg-secondary",
    "hover:text-multi-fg-primary focus-visible:text-multi-fg-primary",
  )}
  data-subagent-row=""
  onClick={() => openPreview({ key, activeThreadId, environmentId, projectRoot, subagent })}
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
    isPreviewOpen && "opacity-100",
  )}
  data-subagent-open=""
>
```

#### Preview Tray Styling

Build the tray above the composer, not inside the timeline surface:

```tsx
<div
  className={cn(
    "pointer-events-auto min-w-0 overflow-hidden bg-multi-bg-elevated font-multi text-detail shadow-multi-card",
  )}
  data-subagent-followup-tray=""
  data-subagent-preview-open=""
>
  <div data-subagent-preview-container="" className="flex max-h-[70dvh] min-h-0 flex-col">
    {/* header + ScrollArea transcript */}
  </div>
</div>
```

Optional stacked backdrop layers when multiple followup trays coexist:

```tsx
<div data-subagent-followup-tray-stack="" className="relative flex flex-col gap-2">
  {/* tray + decorative stack layers behind */}
</div>
```

Keep reduced-motion behavior through existing motion utilities or media-query CSS if the tray gets enter/exit transitions.

### Phase 6: Hydrate On Demand

Flow:

1. Render status row from current worklog metadata in the timeline.
2. If `providerThreadId` exists (or logs exist), row is clickable.
3. On click, set `useSubagentPreviewStore` — composer tray opens.
4. Tray mounts `SubagentPreviewTrayContainer`, which requests child thread snapshot using `providerThreadId`.
5. Store snapshot keyed by `subagentPreviewKey(subagent)`.
6. Render nested messages/tools inside the tray `ScrollArea` using normalized projection + `ChatMarkdown`.
7. Keep live `subagent.*` events updating the open preview via `updatePreviewSubagent()`.
8. Close tray clears store; timeline row loses `data-subagent-open` highlight.

This matches Cursor's behavior: status row in transcript, nested conversation in composer followup tray on demand.

Timeline work-group fix:

- Running preview should pass `subagentDetailsEnabled={true}` (or always allow row click → store) so users can open the tray without expanding the work group first.

## File-Level Checklist

### Contracts

- `packages/contracts/src/provider-runtime.ts`
  - already contains provider thread lineage and `RuntimeSubagentRef`
  - change only if OpenCode needs an additional normalized metadata field

- `packages/contracts/src/provider.ts`
  - already contains `ProviderThreadReadInput.providerThreadId`
  - no contract change is required for OpenCode child session reads

### Server

- `packages/server/src/provider/CodexSessionRuntime.ts`
  - current reference implementation for child route identity

- `packages/server/src/provider/CodexAdapter.ts`
  - current reference implementation for `subagent.*`

- `packages/server/src/orchestration/ProviderRuntimeIngestion.ts`
  - verify OpenCode `subagent.*` events project into the same worklog shape

- `packages/server/src/orchestration/ThreadProjection.ts`
  - verify OpenCode child session snapshots are exposed through the existing provider snapshot path

- `packages/server/src/provider/OpenCodeAdapter.ts`
  - extract task tool `metadata.sessionId`
  - emit `RuntimeSubagentRef`
  - map child session events to `subagent.*`
  - honor `ProviderThreadReadInput.providerThreadId`

- `packages/server/src/provider/ClaudeAdapter.ts`
  - keep task lifecycle as generic task events

- `packages/server/src/provider/CursorAdapter.ts`
  - keep ACP output generic until ACP exposes child identity

### App

- `packages/app/src/session-logic.ts`
  - keep `WorkLogSubagent` metadata small and derive UI state
  - attach OpenCode subagent logs only after normalized `subagent.*` events exist

- `packages/app/src/components/chat/message/tool-message.tsx`
  - timeline status rows only; click calls `openPreview()`
  - remove inline `SubagentThreadPanel` once tray ships
  - keep provider capability gating explicit

- `packages/app/src/stores/subagent-preview-store.ts`
  - ephemeral open/close/update for composer tray selection

- `packages/app/src/components/chat/composer/subagent-preview-tray.tsx` (new)
  - `SubagentPreviewTrayStack` + `SubagentPreviewTrayContainer`
  - loads `getProviderThreadSnapshot` on open
  - renders nested transcript in `ScrollArea`

- `packages/app/src/components/chat/composer/input.tsx`
  - render tray above composer shell (same slot as `PlanFollowUpTray`)

- `packages/app/src/components/chat/timeline/messages-timeline.tsx`
  - enable subagent row clicks in running work-group preview (`subagentDetailsEnabled`)

- `packages/app/src/components/chat/message/tool-renderer.tsx`
  - keep existing `TaskToolCall` expansion contract for task-tool-embedded status rows
  - do not add provider-specific parsing here

## Verification Plan

For implementation, not this document:

1. Run `pnpm run typecheck`.
2. Add focused unit coverage only if the changed code is derivation/projection logic.
3. If UI changes are implemented, use browser verification for:
   - running status row in timeline
   - completed status row
   - failed status row
   - click opens composer followup tray (not inline timeline expansion)
   - tray shows nested transcript from snapshot + live logs
   - close tray clears highlight on timeline row
   - running work-group preview allows subagent click without expanding group
   - hover/focus open affordance on status row

No broad tests unless the implementation touches test infrastructure or the user requests them.

## Decision Summary

Implement the Cursor shape in Multi, but not by copying Cursor code.

The correct architecture is:

1. Durable child provider thread identity.
2. Normalized nested subagent runtime events.
3. Projection-backed child transcript snapshots.
4. Inline timeline status rows + **composer followup preview tray** built with Multi Tailwind, Base UI `Collapsible`, and `central-icons`.

Codex already has the required data shape. The remaining work is UI wiring: store → composer tray → snapshot hydrate. OpenCode is the next feasible adapter because upstream exposes child `sessionId` metadata. Claude and Cursor should stay on generic task/tool UI until their protocols expose child transcript identity.
