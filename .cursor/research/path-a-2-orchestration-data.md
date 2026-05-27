# Path A — Council slice 2: Orchestration data flow

Read-only analysis for replacing the above-composer subagent tray with Cursor’s inline-in-task-card model. Scope: what already arrives on `WorkLogEntry.subagents`, what is dropped today, and what app-side derivation must add (especially `subagent.content.delta` → coalesced inline transcript).

References: `composer-chat-document-fix.md` (data path, canonical activity map, coalescing spec), `.cursor/research/multi-current-state.md`, `.cursor/research/subagent-panel-regression.md`.

Log sample: `/Users/workgyver/.multi/dev/logs/provider/9215a343-0772-47b8-b0d4-ab055bea4760.log` (2757 lines; 847 `"type":"subagent.*"` lines; 796 `subagent.content.delta`; 0 `subagent.thread.started` in this run).

---

## 1. Activity kind catalog

All `subagent.*` values in `OrchestrationThreadActivityKind`:

```269:292:packages/contracts/src/orchestration.ts
export const OrchestrationThreadActivityKind = Schema.Literals([
  "approval.requested",
  "approval.resolved",
  "user-input.requested",
  "user-input.resolved",
  "runtime.error",
  "runtime.warning",
  "turn.plan.updated",
  "task.started",
  "task.progress",
  "task.completed",
  "tool.started",
  "tool.updated",
  "tool.completed",
  "tool.summary",
  "context-window.updated",
  "context-compaction",
  "subagent.thread.started",
  "subagent.thread.state.changed",
  "subagent.item.started",
  "subagent.item.updated",
  "subagent.item.completed",
  "subagent.content.delta",
  "subagent.usage.updated",
```

Subagent-only kinds and payload types (quoted from contracts):

| `kind` | Payload type (schema) | Represents | Target UI (Path A) | Flows into `WorkLogSubagent` today? |
| ------ | --------------------- | ---------- | -------------------- | ----------------------------------- |
| `subagent.thread.started` | `SubagentIdentityActivityPayload` | Subagent provider thread spawned; identity + parent linkage | Subagent header / `isActive` | **Partial** — not a top-level work row (`isSubagentRuntimeActivity` filters it at `739`). Contributes via `deriveSubagentDetailsByProviderThreadId` → `logs[]`, `rawStatus` (`"running"`), `statusLabel`, `isActive`. Does **not** set `WorkLogSubagent` on parent until parent tool payload has `receiverThreadIds`. |
| `subagent.thread.state.changed` | `SubagentStateChangedActivityPayload` | Thread state (`active`, `idle`, `error`, …) | Status chip / header | **Partial** — same side channel: `logs[]`, `rawStatus`/`statusLabel`/`isActive`/`latestUpdate` (latestUpdate skipped for this kind at `854-858`). Hidden from preview when canonical transcript exists (`subagent-preview-store.ts:49-50`). |
| `subagent.item.started` | `SubagentItemActivityPayload` | Item opened (message, command, tool, …) | Inline transcript row (open) | **Partial** — appended to `logs[]` via `toSubagentLog`; merged onto parent `WorkLogSubagent` by `providerThreadId`. Preview hides many snapshot item types when transcript loaded (`isSubagentProviderSnapshotItemType`). |
| `subagent.item.updated` | `SubagentItemActivityPayload` | Item progress | Inline row update | **Partial** — same as `item.started`. |
| `subagent.item.completed` | `SubagentItemActivityPayload` | Item terminal + `detail` | Inline row close + final text | **Partial** — same; `detail` can become log `detail` and `latestUpdate` unless snapshot item type (`861-863`). |
| `subagent.content.delta` | `SubagentContentDeltaActivityPayload` | Streaming text/output chunk | Live text on open message/tool/command row | **Filtered out** — explicit `continue` at `816-818`; never reaches `logs[]`. `toSubagentLog` exists but is unreachable for accumulation. |
| `subagent.usage.updated` | `SubagentUsageUpdatedActivityPayload` | Token usage snapshot | Context meter on subagent row | **Partial** — skipped in details loop (`815-816`); applied via `deriveSubagentUsageByProviderThreadId` → `usedTokens` / `maxTokens` / `usedPercentage` on matched `WorkLogSubagent` (`978-1023`). |

### Payload field definitions (contracts)

Identity fields (all subagent payloads):

```391:401:packages/contracts/src/orchestration.ts
const SubagentIdentityActivityPayloadFields = {
  providerThreadId: Schema.optional(TrimmedNonEmptyString),
  parentProviderThreadId: Schema.optional(TrimmedNonEmptyString),
  parentTurnId: Schema.optional(TurnId),
  parentItemId: Schema.optional(ProviderItemId),
  agentId: Schema.optional(TrimmedNonEmptyString),
  nickname: Schema.optional(TrimmedNonEmptyString),
  role: Schema.optional(TrimmedNonEmptyString),
  model: Schema.optional(TrimmedNonEmptyString),
  prompt: Schema.optional(TrimmedNonEmptyString),
} as const;
```

State changed:

```405:409:packages/contracts/src/orchestration.ts
const SubagentStateChangedActivityPayload = Schema.Struct({
  ...SubagentIdentityActivityPayloadFields,
  state: Schema.Literals(["active", "idle", "archived", "closed", "compacted", "error"]),
  detail: Schema.optional(Schema.Unknown),
});
```

Item lifecycle:

```411:419:packages/contracts/src/orchestration.ts
const SubagentItemActivityPayload = Schema.Struct({
  ...SubagentIdentityActivityPayloadFields,
  itemType: Schema.optional(TrimmedNonEmptyString),
  itemId: Schema.optional(TrimmedNonEmptyString),
  status: Schema.optional(TrimmedNonEmptyString),
  title: Schema.optional(TrimmedNonEmptyString),
  detail: Schema.optional(TrimmedNonEmptyString),
  data: Schema.optional(Schema.Unknown),
});
```

Content delta (note `itemId`, `contentIndex`, `summaryIndex`):

```421:428:packages/contracts/src/orchestration.ts
const SubagentContentDeltaActivityPayload = Schema.Struct({
  ...SubagentIdentityActivityPayloadFields,
  streamKind: TrimmedNonEmptyString,
  delta: Schema.String,
  itemId: Schema.optional(TrimmedNonEmptyString),
  contentIndex: Schema.optional(Schema.Int),
  summaryIndex: Schema.optional(Schema.Int),
});
```

Usage:

```430:433:packages/contracts/src/orchestration.ts
const SubagentUsageUpdatedActivityPayload = Schema.Struct({
  ...SubagentIdentityActivityPayloadFields,
  ...ThreadTokenUsageSnapshot.fields,
});
```

Provider runtime mirror (`ContentDeltaPayload`):

```457:462:packages/contracts/src/provider-runtime.ts
const ContentDeltaPayload = Schema.Struct({
  streamKind: RuntimeContentStreamKind,
  delta: Schema.String,
  contentIndex: Schema.optional(Schema.Int),
  summaryIndex: Schema.optional(Schema.Int),
});
```

`RuntimeContentStreamKind`: `"assistant_text"`, `"reasoning_text"`, `"reasoning_summary_text"`, `"plan_text"`, `"command_output"`, `"file_change_output"`, `"unknown"` (`97:105:packages/contracts/src/provider-runtime.ts`).

### Server mapping (read-only confirmation)

`ProviderRuntimeIngestion.ts` maps each runtime `subagent.*` event to `OrchestrationThreadActivity` with the same `kind`, copying identity via `buildSubagentIdentityPayload` (`119:132`, `501:612:packages/server/src/orchestration/ProviderRuntimeIngestion.ts`). For `subagent.content.delta`, ingestion sets `payload.itemId` from `event.itemId` when present (`583:589`).

Example canonical log line (assistant stream):

```text
"type":"subagent.content.delta","payload":{"subagent":{"providerThreadId":"019e50df-9bfc-7f81-8b61-5a193b320e3c",...,"parentItemId":"call_VDOQCq1764d3DhA9ogmrtcH3"},"streamKind":"assistant_text",...}
```

(log file line ~203+ in grep sample; `parentItemId` matches parent collab tool `itemId` from regression doc).

---

## 2. Current `WorkLogSubagent` and `WorkLogSubagentLog` shapes

Quoted from `session-logic.ts`:

```50:81:packages/app/src/session-logic.ts
export interface WorkLogSubagent {
  threadId: string;
  providerThreadId?: string | undefined;
  resolvedThreadId?: string | undefined;
  agentId?: string | undefined;
  nickname?: string | undefined;
  role?: string | undefined;
  model?: string | undefined;
  prompt?: string | undefined;
  rawStatus?: string | undefined;
  latestUpdate?: string | undefined;
  title?: string | undefined;
  statusLabel?: string | undefined;
  isActive?: boolean | undefined;
  usedTokens?: number | undefined;
  maxTokens?: number | undefined;
  usedPercentage?: number | undefined;
  logs?: ReadonlyArray<WorkLogSubagentLog> | undefined;
  hasDetails?: boolean | undefined;
}

export interface WorkLogSubagentLog {
  id: string;
  createdAt: string;
  kind: string;
  label: string;
  itemId?: string | undefined;
  detail?: string | undefined;
  streamKind?: string | undefined;
  itemType?: string | undefined;
  status?: string | undefined;
}
```

### Field provenance

| Field | Populating activity / code path |
| ----- | -------------------------------- |
| `threadId`, `providerThreadId` | `extractWorkLogSubagents` from parent tool `data.item` `receiverThreadIds` / `receiverAgents` (`2537:2549`, `2552:2572`). Key = provider thread id. |
| `agentId`, `nickname`, `role`, `model`, `prompt` | Same extractors + `decodeSubagentReceiverAgents` / `decodeSubagentAgentStates` (`packages/app/src/session/subagents.ts:59-154`). |
| `title` | `resolveSubagentTitle(nickname, role)` in extract (`2546-2547`, `2566-2569`). |
| `statusLabel`, `isActive` (initial) | Extract defaults (`2547-2548`, `2570-2571`); overridden by `applySubagentDetails` from subagent thread/item/state activities. |
| `rawStatus`, `statusLabel`, `latestUpdate`, `isActive` (live) | `deriveSubagentDetailsByProviderThreadId` + `resolveSubagentRawStatus` / `resolveSubagentLatestUpdate` (`807:845`, `965:976`, `848:866`). |
| `logs`, `hasDetails` | `deriveSubagentDetailsByProviderThreadId` → `applySubagentDetails` (`1036:1044`). `hasDetails: details.logs.length > 0`. |
| `usedTokens`, `maxTokens`, `usedPercentage` | `subagent.usage.updated` only (`978:1007`, `1012:1023`). |
| `resolvedThreadId` | not found in `session-logic.ts` population paths reviewed |

`WorkLogEntry.subagents` is set in `toDerivedWorkLogEntry` when `extractWorkLogSubagents` returns non-empty (`1228:1229`), then enriched after collapse (`780:788`).

---

## 3. Current filtering — where content deltas go to die

### Primary drop: derivation loop

```812:818:packages/app/src/session-logic.ts
  for (const activity of activities) {
    if (
      !isSubagentRuntimeActivity(activity) ||
      activity.kind === "subagent.usage.updated" ||
      activity.kind === "subagent.content.delta"
    ) {
      continue;
    }
```

All `subagent.content.delta` activities are skipped before `toSubagentLog` or any accumulator.

Related: `resolveSubagentLatestUpdate` ignores deltas (`854:858`).

### Top-level work log filter

```739:739:packages/app/src/session-logic.ts
    .filter((activity) => !isSubagentRuntimeActivity(activity))
```

```803:805:packages/app/src/session-logic.ts
function isSubagentRuntimeActivity(activity: OrchestrationThreadActivity): boolean {
  return activity.kind.startsWith("subagent.");
}
```

Subagent kinds never become standalone `WorkLogEntry` rows.

### Preview store visibility

```39:45:packages/app/src/stores/subagent-preview-store.ts
export function isSubagentPreviewLogVisible(
  log: WorkLogSubagentLog,
  hasCanonicalTranscript: boolean,
): boolean {
  if (log.kind === "subagent.content.delta") {
    return false;
  }
```

Signature builder also skips delta logs (`87:89:packages/app/src/stores/subagent-preview-store.ts`).

### Tray body (downstream)

`subagent-preview-tray.tsx` uses `getProviderThreadSnapshot` once on mount (regression doc); even if deltas were in `logs`, preview filters them. Path A inline card should read `transcriptItems`, not resurrect tray polling as primary.

### Other choke points

| Location | Behavior |
| -------- | -------- |
| `deriveWorkLogEntries` turn filter | Only affects **work row** activities (`737`); `deriveSubagentDetailsByProviderThreadId(ordered)` uses full activity list (`735`) — subagent side channel is turn-unscoped. |
| `logs` cap | Last 200 logs per `providerThreadId` (`832`). |
| `isSubagentProviderSnapshotItemType` | Suppresses `latestUpdate` from item logs for message/reasoning/plan types (`868:891`, `861:863`) — pushes UI toward snapshot for those types. |
| `coalesceOrchestrationUiEvents` | Does not merge or drop `subagent.*` (`6:8`, `16:44:packages/app/src/environments/runtime/coalesce-orchestration-events.ts`). |
| `requestAnimationFrame` / activity microbatch | **not found** under `packages/app/src/environments/runtime/`. Each subscription event → `applyRecoveredEventBatch([event])` (`659:663:packages/app/src/environments/runtime/service.ts`). |

`toSubagentLog` would map deltas if they were not filtered:

```906:916:packages/app/src/session-logic.ts
  const label =
    activity.kind === "subagent.content.delta"
      ? labelForSubagentStream(streamKind)
      : (title ?? labelForSubagentActivityKind(activity.kind, itemType));
  return {
    id: activity.id,
    ...
    ...(delta !== null ? { detail: delta } : detail ? { detail } : state ? { detail: state } : {}),
```

Per-event `id` on deltas would create hundreds of log rows — Path A must coalesce, not append raw logs.

---

## 4. Parent task tool → subagents link

### `extractWorkLogSubagents` (full function)

```2524:2576:packages/app/src/session-logic.ts
function extractWorkLogSubagents(
  payload: Record<string, unknown> | null,
): ReadonlyArray<WorkLogSubagent> {
  const item = extractPayloadItem(payload);
  if (!item) {
    return [];
  }

  const threadIds = decodeSubagentReceiverThreadIds(item);
  const agents = decodeSubagentReceiverAgents(item, threadIds);
  const states = decodeSubagentAgentStates(item);
  const byThreadId = new Map<string, WorkLogSubagent>();

  for (const agent of agents) {
    byThreadId.set(agent.providerThreadId, {
      threadId: agent.providerThreadId,
      providerThreadId: agent.providerThreadId,
      agentId: agent.agentId,
      nickname: agent.nickname,
      role: agent.role,
      model: agent.model,
      prompt: agent.prompt,
      title: resolveSubagentTitle(agent.nickname, agent.role),
      statusLabel: "Started",
      isActive: true,
    });
  }

  for (const state of Object.values(states)) {
    const existing = byThreadId.get(state.threadId);
    const statusLabel = resolveSubagentStatusLabel(state.status);
    byThreadId.set(state.threadId, {
      ...existing,
      threadId: state.threadId,
      providerThreadId: existing?.providerThreadId ?? state.threadId,
      agentId: state.agentId ?? existing?.agentId,
      nickname: state.nickname ?? existing?.nickname,
      role: state.role ?? existing?.role,
      model: state.model ?? existing?.model,
      prompt: state.prompt ?? existing?.prompt,
      rawStatus: state.status ?? existing?.rawStatus,
      latestUpdate: state.message ?? existing?.latestUpdate,
      title: resolveSubagentTitle(
        state.nickname ?? existing?.nickname,
        state.role ?? existing?.role,
      ),
      statusLabel,
      isActive: isActiveSubagentStatus(state.status, statusLabel),
    });
  }

  return [...byThreadId.values()];
}
```

`decodeSubagentReceiverThreadIds` reads `receiverThreadIds` (and aliases) from tool item payload (`59:87:packages/app/src/session/subagents.ts`).

### How a task / collab tool row gets `WorkLogSubagent[]`

1. Parent emits `tool.started` / `tool.updated` / `tool.completed` with `itemType: "collab_agent_tool_call"` and `data.item` containing `receiverThreadIds` / `receiverAgents` (often empty on start, populated on complete — see regression log lines 105 vs 117).
2. `toDerivedWorkLogEntry` calls `extractWorkLogSubagents(payload)` (`1105`, `1228:1229`).
3. `isSubagentLifecycle` prevents tool lifecycle collapse (`1126`, `1321:1322`) so collab rows do not merge away.
4. `mergeSubagents` on lifecycle merge unions subagents by `providerThreadId ?? threadId ?? agentId` (`1440:1450`, `1382`).
5. After collapse, `applySubagentUsage` + `applySubagentDetails` merge thread-wide subagent activities onto each `WorkLogSubagent` by key `subagent.providerThreadId ?? subagent.threadId` (`1020:1021`, `1031:1032`).

**Join key today:** `providerThreadId` equality between (a) ids from parent tool payload and (b) `payload.providerThreadId` on `subagent.*` activities.

**`parentItemId`:** present on ingested subagent payloads (`buildSubagentIdentityPayload` `126:126`) and in sample log, but **not found** used in `extractWorkLogSubagents` or `applySubagentDetails` for parent linkage. Path A inline card can use it later to validate parent `toolCallId` / `itemId`.

### `taskToolCall` UI wiring

When `toolCall.tool.case === "taskToolCall"`, subagent status renders inside the task card body (`65:76:packages/app/src/components/chat/message/tool-message.tsx`). Path A should feed inline transcript into `subagentConversation` instead of only `SubagentStatusRow` + tray.

Test proof for usage merge:

```1454:1494:packages/app/src/session-logic.test.ts
  it("merges subagent usage updates onto collab subagent rows", () => {
    ...
    expect(entries[0]?.subagents?.[0]).toMatchObject({
      providerThreadId: "codex-subagent-thread-1",
      usedTokens: 4200,
      ...
    });
  });
```

---

## 5. Proposal — coalesced inline transcript on `WorkLogSubagent`

### Spec: coalescing key (from plan)

```176:180:composer-chat-document-fix.md
- Coalesce `subagent.content.delta` by `providerThreadId`, `itemId`, `streamKind`, and `contentIndex` or `summaryIndex`.
- Use `payload.providerThreadId` as the primary tray key.
- Use `payload.parentItemId` to connect the subagent back to the parent task tool when present.
- Treat `subagent.thread.*` as header/status metadata when item rows exist.
```

### New types (app)

Add to `session-logic.ts` (or `session/subagent-transcript.ts`):

```ts
export type SubagentTranscriptItemKind =
  | "message"
  | "tool"
  | "command"
  | "reasoning"
  | "plan"
  | "status"
  | "output";

export interface SubagentTranscriptItem {
  readonly id: string;
  readonly role?: "user" | "assistant" | "system";
  readonly kind: SubagentTranscriptItemKind;
  readonly itemId: string;
  readonly sequence?: number;
  readonly text?: string;
  readonly toolCall?: Record<string, unknown>;
  readonly loading: boolean;
  readonly createdAt: string;
  readonly streamKind?: string;
  readonly status?: string;
  readonly itemType?: string;
}
```

Extend:

```ts
export interface WorkLogSubagent {
  ...
  readonly transcriptItems?: ReadonlyArray<SubagentTranscriptItem>;
}
```

### Stream coalesce key helper

```ts
function subagentStreamCoalesceKey(
  providerThreadId: string,
  itemId: string,
  streamKind: string,
  contentIndex?: number,
  summaryIndex?: number,
): string {
  const indexPart =
    contentIndex !== undefined
      ? `c:${contentIndex}`
      : summaryIndex !== undefined
        ? `s:${summaryIndex}`
        : "";
  return `${providerThreadId}\u001f${itemId}\u001f${streamKind}\u001f${indexPart}`;
}
```

### Reduction rules by `kind`

Process activities in `compareActivitiesByOrder` (same order as `deriveSubagentDetailsByProviderThreadId`). Maintain `Map<providerThreadId, { itemsById: Map<string, SubagentTranscriptItem>; streamBuffers: Map<string, string> }>`.

| Activity kind | Reduction |
| ------------- | --------- |
| `subagent.thread.started` | Update subagent header only (`rawStatus` → running). No transcript row unless no items yet (optional `kind: "status"`). |
| `subagent.thread.state.changed` | Update header `rawStatus` / `isActive`. Optional `status` row with `detail` when no item rows; hide in UI when `transcriptItems.length > 0` (mirrors preview log rule). |
| `subagent.item.started` | **Open row:** `id = itemId`, `itemId`, `createdAt`, `sequence`, `loading: true`, `itemType`, `status`. Map `itemType` → `kind`/`role` (e.g. `user_message` → `message`/`user`, `assistant_message` → `message`/`assistant`, `command_execution` → `command`, tool lifecycle types → `tool`). Seed `text` from `title` or `detail` if present. |
| `subagent.item.updated` | **Merge row** by `itemId`: patch `status`, `text`/`detail`, `toolCall` from `data`, keep `loading` unless terminal status. |
| `subagent.item.completed` | **Close row:** `loading: false`, `status: completed`, set `text` from `payload.detail` when non-empty (prefer over stream buffer for that `itemId`). |
| `subagent.content.delta` | **Append to stream buffer** keyed by `subagentStreamCoalesceKey(providerThreadId, itemId, streamKind, contentIndex, summaryIndex)`. Ensure open row for `itemId` exists (create synthetic `message`/`output` row if `item.started` missed). Append `payload.delta` to buffer; mirror into row `text`. Use `mergeStreamText` pattern (`1425:1437`) for append. |
| `subagent.usage.updated` | No transcript row; only token fields on `WorkLogSubagent`. |

After pass, materialize `transcriptItems` as ordered array (sort by `sequence` then `createdAt`), cap length (e.g. 500 items, truncate oldest).

### Snapshot reconcile

On `getProviderThreadSnapshot` (open, reconnect, gap, terminal only — `180:180:composer-chat-document-fix.md`):

- For each snapshot item with `itemType` `assistant_message` or `user_message` and `status === "completed"`, find `transcriptItems` row with same `itemId`.
- Replace `text` with snapshot body; set `loading: false`.
- Do not poll snapshot every 2500ms during active run.

### Wire into derivation

1. Add `deriveSubagentTranscriptByProviderThreadId(ordered)` parallel to details (`807`).
2. In `applySubagentDetails` (or new `applySubagentTranscript`), set `transcriptItems` on matched subagents.
3. Remove `subagent.content.delta` from the `continue` at `816` — feed transcript reducer instead of `logs[]`.
4. Keep `logs[]` for backward compatibility during tray removal or drop once inline path ships.

---

## 6. Event-effects / service path impact

### `coalesceOrchestrationUiEvents`

No new branch required. Module comment and implementation only merge adjacent `thread.message-sent`:

```3:8:packages/app/src/environments/runtime/coalesce-orchestration-events.ts
/**
 * Coalesce assistant-message streaming bursts so the UI commits one merged
 * `thread.message-sent` per (threadId, messageId) instead of one commit per
 * text delta. Approval, user input, plan, tool, and subagent events stay
 * distinct because each event may represent a separate user-visible action.
 */
```

### `deriveOrchestrationBatchEffects`

No subagent branches (`23:80:packages/app/src/environments/runtime/orchestration-event-effects.ts`). Subagent activities do not affect git refresh or draft promotion.

### `service.ts` apply path

```603:626:packages/app/src/environments/runtime/service.ts
function applyRecoveredEventBatch(
  events: ReadonlyArray<OrchestrationEvent>,
  environmentId: EnvironmentId,
) {
  ...
  const batchEffects = deriveOrchestrationBatchEffects(events);
  ...
  const uiEvents = coalesceOrchestrationUiEvents(events);
  ...
  useStore.getState().applyOrchestrationEvents(uiEvents, environmentId);
```

Each `thread.activity-appended` with a subagent kind reaches the store; `deriveWorkLogEntries` runs on read in `chat-view.tsx` (grep: `deriveWorkLogEntries(visibleThreadActivities, ...)`).

### Per-rAF microbatch for `subagent.content.delta`

**Not implemented today.** With 796 deltas in the sample log, derivation must coalesce inside `session-logic` per `deriveWorkLogEntries` call. Optional future P0-F: buffer `thread.activity-appended` per thread and flush once per frame, merging deltas by stable stream key before store commit (`composer-chat-document-fix.md:201-204`). Not required if transcript reducer coalesces on every derivation — cost is O(deltas) per render, acceptable if virtualized.

---

## 7. Type contract changes (concrete diff plan)

| Step | File | Change |
| ---- | ---- | ------ |
| 1 | `packages/app/src/session-logic.ts` (or new module) | Export `SubagentTranscriptItem`, `SubagentTranscriptItemKind`, `subagentStreamCoalesceKey`. |
| 2 | `WorkLogSubagent` | Add `transcriptItems?: ReadonlyArray<SubagentTranscriptItem>`. |
| 3 | `deriveSubagentTranscriptByProviderThreadId` | New reducer; include `subagent.content.delta`; exclude `subagent.usage.updated`. |
| 4 | `deriveSubagentDetailsByProviderThreadId` | Keep `continue` for `subagent.content.delta` (do not append per-delta logs). |
| 5 | `applySubagentDetails` | Merge `transcriptItems`; set `hasDetails: (transcriptItems?.length ?? 0) > 0 \|\| logs.length > 0`. |
| 6 | `subagent-preview-store.ts` / tray | Deprecate: inline UI reads `transcriptItems` on task card. |
| 7 | Tests | `session-logic.test.ts`: coalesce many deltas → one row text; `item.completed` finalizes; usage still merges. |

Schema verification — delta payload fields exist:

```421:428:packages/contracts/src/orchestration.ts
  streamKind: TrimmedNonEmptyString,
  delta: Schema.String,
  itemId: Schema.optional(TrimmedNonEmptyString),
  contentIndex: Schema.optional(Schema.Int),
  summaryIndex: Schema.optional(Schema.Int),
```

Ingestion copies `event.itemId` → `payload.itemId` (`583:583:packages/server/src/orchestration/ProviderRuntimeIngestion.ts`).

---

## Wiring summary (end-to-end)

```text
Provider log subagent.* 
  → ProviderRuntimeIngestion (501-612) 
  → thread.activity-appended 
  → coalesceOrchestrationUiEvents (pass-through) 
  → thread store activities[] 
  → deriveWorkLogEntries
       ├─ extractWorkLogSubagents (parent tool receiverThreadIds → WorkLogSubagent shell)
       ├─ deriveSubagentDetailsByProviderThreadId (logs, status; NO deltas)
       ├─ deriveSubagentUsageByProviderThreadId
       └─ [NEW] deriveSubagentTranscriptByProviderThreadId (coalesced deltas + items)
  → WorkLogEntry.subagents on collab/task tool rows
  → ToolCallMessage taskToolCall → inline transcript (Path A)
```

---

## Council slice 2 takeaway

**New field:** `WorkLogSubagent.transcriptItems`.

**`subagent.content.delta` rule:** For each activity, require `payload.providerThreadId` and `payload.itemId`; compute stream key `providerThreadId + itemId + streamKind + (contentIndex ?? summaryIndex)`; append `payload.delta` into that bucket and into the open `SubagentTranscriptItem` for `itemId`; on `subagent.item.completed` for the same `itemId`, set `loading: false` and prefer final `payload.detail` over the buffer; reconcile completed `user_message` / `assistant_message` rows from `getProviderThreadSnapshot` only on open/reconnect/gap/terminal.
