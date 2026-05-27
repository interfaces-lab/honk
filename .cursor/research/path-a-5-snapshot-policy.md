# Path A — Council slice 5: Snapshot vs streaming policy

Read-only analysis for inline subagent transcript inside the task card body. Scope: when Multi calls `getProviderThreadSnapshot`, how streamed `subagent.*` activities reconcile with snapshot, and where merge logic lives.

References: `subagent-panel-regression.md`, `composer-chat-document-fix.md:168-205`, `cursor-subagent-click-flow.md` §3, `path-a-2-orchestration-data.md`.

Log sample: `/Users/workgyver/.multi/dev/logs/provider/9215a343-0772-47b8-b0d4-ab055bea4760.log`.

---

## 1. `getProviderThreadSnapshot` API — verbatim

### App surface (`EnvironmentApi`)

```383:385:packages/contracts/src/ipc.ts
    getProviderThreadSnapshot: (
      input: OrchestrationGetProviderThreadSnapshotInput,
    ) => Promise<OrchestrationGetProviderThreadSnapshotResult>;
```

Wired in `environment-api.ts` as RPC passthrough:

```52:52:packages/app/src/environment-api.ts
      getProviderThreadSnapshot: rpcClient.orchestration.getProviderThreadSnapshot,
```

### Input / result schemas

```1548:1568:packages/contracts/src/orchestration.ts
export const OrchestrationGetProviderThreadSnapshotInput = Schema.Struct({
  threadId: ThreadId,
  providerThreadId: Schema.optional(TrimmedNonEmptyString),
  includeTurns: Schema.optional(Schema.Boolean),
});
export type OrchestrationGetProviderThreadSnapshotInput =
  typeof OrchestrationGetProviderThreadSnapshotInput.Type;

const OrchestrationProviderThreadTurnSnapshot = Schema.Struct({
  id: TurnId,
  providerTurnId: Schema.optional(TrimmedNonEmptyString),
  items: Schema.Array(ProviderThreadSnapshotItem),
});

export const OrchestrationGetProviderThreadSnapshotResult = Schema.Struct({
  threadId: ThreadId,
  providerThreadId: Schema.optional(TrimmedNonEmptyString),
  turns: Schema.Array(OrchestrationProviderThreadTurnSnapshot),
});
export type OrchestrationGetProviderThreadSnapshotResult =
  typeof OrchestrationGetProviderThreadSnapshotResult.Type;
```

`OrchestrationGetProviderThreadSnapshotResult` is structurally identical to `ProviderThreadSnapshot` (`packages/contracts/src/provider.ts:112-117`).

### `ProviderThreadSnapshot` and `ProviderThreadSnapshotItem`

```105:117:packages/contracts/src/provider.ts
export const ProviderThreadTurnSnapshot = Schema.Struct({
  id: TurnId,
  providerTurnId: Schema.optional(TrimmedNonEmptyString),
  items: Schema.Array(ProviderThreadSnapshotItem),
});
export type ProviderThreadTurnSnapshot = typeof ProviderThreadTurnSnapshot.Type;

export const ProviderThreadSnapshot = Schema.Struct({
  threadId: ThreadId,
  providerThreadId: Schema.optional(TrimmedNonEmptyString),
  turns: Schema.Array(ProviderThreadTurnSnapshot),
});
export type ProviderThreadSnapshot = typeof ProviderThreadSnapshot.Type;
```

```157:165:packages/contracts/src/provider-runtime.ts
export const ProviderThreadSnapshotItem = Schema.Struct({
  id: Schema.optional(TrimmedNonEmptyStringSchema),
  itemType: CanonicalItemType,
  role: ProviderThreadSnapshotItemRole,
  title: Schema.optional(TrimmedNonEmptyStringSchema),
  detail: Schema.optional(Schema.String),
  data: Schema.optional(Schema.Unknown),
});
export type ProviderThreadSnapshotItem = typeof ProviderThreadSnapshotItem.Type;
```

### Server implementation chain

WS handler (`packages/server/src/ws.ts:650-663`):

```650:663:packages/server/src/ws.ts
        [ORCHESTRATION_WS_METHODS.getProviderThreadSnapshot]: (input) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.getProviderThreadSnapshot,
            Effect.serviceOption(ProviderService).pipe(
              Effect.flatMap(
                Option.match({
                  onNone: () =>
                    Effect.fail(
                      new OrchestrationGetSnapshotError({
                        message: "Provider thread snapshots are unavailable in this environment",
                      }),
                    ),
                  onSome: (providerService) =>
                    providerService.readThread(input).pipe(
```

`ProviderService.readThread` routes to the session adapter (`packages/server/src/provider/ProviderService.ts:863-886`):

```863:886:packages/server/src/provider/ProviderService.ts
  const readThread: ProviderServiceShape["readThread"] = Effect.fn("readThread")(
    function* (rawInput) {
      const input = yield* decodeInputOrValidationError({
        operation: "ProviderService.readThread",
        decode: decodeProviderThreadReadInput,
        payload: rawInput,
      });
      ...
        return yield* routed.adapter.readThread(input);
```

Codex adapter (representative path for the sample log) calls native `thread/read` with optional `providerThreadId` (`packages/server/src/provider/CodexSessionRuntime.ts:1496-1505`):

```1496:1505:packages/server/src/provider/CodexSessionRuntime.ts
      readThread: (input) =>
        Effect.gen(function* () {
          const providerThreadId = input?.providerThreadId ?? (yield* readProviderThreadId);
          const response = yield* client.request("thread/read", {
            threadId: providerThreadId,
            includeTurns: input?.includeTurns ?? true,
          });
          return parseThreadSnapshot(response, {
            userMessageTitle: input?.providerThreadId ? "Instruction" : "User message",
          });
        }),
```

### Subagent thread vs parent thread return shape

Both use the same `ProviderThreadSnapshot` envelope. Difference is which native provider thread is read and the user-message title default.

**Parent thread** (`providerThreadId` omitted): reads the session’s primary provider thread; user items titled `"User message"`.

**Subagent thread** (`providerThreadId` set, e.g. `019e50df-9bfc-7f81-8b61-5a193b320e3c` from log line 123): reads that native thread; user items titled `"Instruction"` (`CodexSessionRuntime.ts:1503-1504`).

Turn shape (both):

```708:711:packages/server/src/provider/CodexSessionRuntime.ts
    turns: response.thread.turns.map((turn) => ({
      id: TurnId.make(turn.id),
      items: turn.items.map((item) => codexThreadSnapshotItem(item, options)),
    })),
```

Item shape (example fields from `codexThreadSnapshotItem`, `715-730`):

```715:730:packages/server/src/provider/CodexSessionRuntime.ts
function codexThreadSnapshotItem(
  item: CodexThreadItem,
  options: { readonly userMessageTitle?: string | undefined },
): ProviderThreadSnapshotItem {
  const itemType = codexThreadSnapshotItemType(readStringField(item, "type"));
  const id = readStringField(item, "id");
  const title = codexThreadSnapshotItemTitle(itemType, item, options);
  const detail = codexThreadSnapshotItemDetail(item);
  return {
    ...(id ? { id } : {}),
    itemType,
    role: codexThreadSnapshotItemRole(itemType),
    ...(title ? { title } : {}),
    ...(detail ? { detail } : {}),
    data: item,
  };
}
```

For the sample subagent, a snapshot turn would contain items like `user_message` (role `user`, detail = prompt text), `assistant_message` (role `assistant`, detail = full final text), `command_execution` (role `tool`), matching canonical types mapped at `733-766`.

---

## 2. Current call sites

### Grep results (production)

| Location | Role |
| -------- | ---- |
| `packages/app/src/components/chat/composer/subagent-preview-tray.tsx:180` | **Only UI caller** — mount effect |
| `packages/app/src/environment-api.ts:52` | API wiring |
| `packages/app/src/rpc/ws-rpc-client.ts:257-259` | RPC transport |
| `packages/server/src/ws.ts:650` | Server handler |
| `packages/app/src/components/shell/plan/plan-workbench-panel.browser.tsx:85` | Test stub (`unexpectedEnvironmentApiCall`) |

No other app code path invokes `getProviderThreadSnapshot` today.

### Current branch: mount-only read

Confirmed at `subagent-preview-tray.tsx:161-204`:

```161:204:packages/app/src/components/chat/composer/subagent-preview-tray.tsx
  // Reconcile-only: live progress streams through `subagent.logs`.
  useMountEffect(() => {
    if (!canReadTranscript || !providerThreadId) {
      return;
    }
    ...
    void api.orchestration
      .getProviderThreadSnapshot({
        threadId: activeThreadId,
        providerThreadId,
        includeTurns: true,
      })
      .then((snapshot) => {
        ...
        setSnapshotState({ status: "loaded", snapshot });
      })
    ...
  });
```

Single fetch on mount; no timer; no re-fetch on `subagent.isActive` or new activities.

### `main`: polls every 2500 ms

Confirmed via `git show origin/main:packages/app/src/components/chat/composer/subagent-preview-tray.tsx` (lines ~175-210):

```tsx
        .finally(() => {
          if (!cancelled && isActive) {
            refreshTimeoutId = window.setTimeout(() => readSnapshot(false), 2500);
          }
        });
```

`main` schedules `readSnapshot(false)` every 2500 ms while `subagent.isActive === true`. Path A explicitly rejects this pattern (`composer-chat-document-fix.md:180`).

---

## 3. Streaming sufficiency analysis

### Activity catalog (member 2)

Subagent kinds emitted by `ProviderRuntimeIngestion` (`501-595`):

| Runtime → activity kind | Inline body use |
| ----------------------- | --------------- |
| `subagent.thread.started` | Header / status metadata |
| `subagent.thread.state.changed` | Header / `isActive`; terminal `idle` |
| `subagent.item.started` / `updated` / `completed` | Open/update/close transcript rows |
| `subagent.content.delta` | Append streaming text (`streamKind`, `delta`) |
| `subagent.usage.updated` | Token meter only |

Mapping example for deltas (`571-594`):

```571:594:packages/server/src/orchestration/ProviderRuntimeIngestion.ts
    case "subagent.content.delta": {
      return [
        {
          ...
          kind: "subagent.content.delta",
          ...
          payload: {
            ...buildSubagentIdentityPayload(event.payload.subagent),
            streamKind: event.payload.streamKind,
            delta: truncateDetail(event.payload.delta, 2_000),
            ...(event.itemId ? { itemId: event.itemId } : {}),
            ...
          },
```

Sample log: 796 `subagent.content.delta` events for one subagent run (`subagent-panel-regression.md:29`); lifecycle at lines 187-188 (user), 203 (assistant started), 206-217 (deltas), 365 (assistant completed), 366-371 (command).

### Can inline body render ENTIRELY from streamed activities?

**Yes, during a connected live subscription** — once member 2’s `deriveSubagentTranscriptByProviderThreadId` coalesces `subagent.content.delta` into `transcriptItems` (see `path-a-2-orchestration-data.md:442-456`). Cursor uses the same model: streamed turns, not snapshot polling (`cursor-subagent-click-flow.md` §3, line 258: “Snapshot polling on tray open vs streamed `subagentConversation.turns`”).

Streaming covers:

- Item lifecycle (open/close/loading) via `subagent.item.*`
- Live assistant text via coalesced deltas
- Tool/command rows via `subagent.item.*` with `itemType` `command_execution`, etc.
- Terminal text via `subagent.item.completed` `detail` (log line 2036: full assistant body in `detail`)

### Scenarios where streaming is insufficient

#### a. Cold open — tab/card opened mid-run after deltas already fired

**Gap:** Inline body mounts with empty `transcriptItems` for a `providerThreadId` that already emitted activities before the parent thread’s activity list was subscribed or before the card expanded.

**Evidence:**

- Log line 119: subagent turn started with `"items":[],"itemsView":"notLoaded"` — provider has content not yet reflected in streamed items.
- Current derivation drops deltas from `logs` (`session-logic.ts:816-818`); branch tray relies on one snapshot instead (`subagent-panel-regression.md:7`).
- `deriveSubagentDetailsByProviderThreadId` only sees activities already in the parent Multi `threadId` store (`807-845`); no backfill unless reconcile fetch runs.

**Trigger:** First mount of inline body when `transcriptItems.length === 0` (or no `subagent.*` activities for `providerThreadId`) but `providerThreadId` is known (from `extractWorkLogSubagents`, `2524-2575`).

#### b. Tab disconnected and reconnected with gap

**Gap:** WS drop may lose delta bursts; on reconnect the thread subscription receives a full snapshot before incremental events.

**Evidence:**

- `attachThreadDetailSubscription` (`service.ts:267-275`): `item.kind === "snapshot"` calls `syncServerThreadDetail`, replacing thread state — activities may jump without per-delta replay.
- `connection.ts:126-131`: shell `onResubscribe` resets bootstrap gate; thread stream uses same transport resubscribe path (`ws-transport.ts:128`).
- After reconnect, sequence gaps are not automatically backfilled by re-emitting every `subagent.content.delta`; snapshot is the authoritative full thread read.

**Trigger:** `subscribeThread` delivers `kind: "snapshot"` after reconnect (`service.ts:270-272`), scoped to subagents on that parent thread with `isActive === true` or empty transcript.

#### c. Thread re-hydrated from disk after restart

**Gap:** Persisted activities replay item lifecycle and truncated deltas; full message bodies may be incomplete.

**Evidence:**

- Each delta stored with `truncateDetail(..., 2_000)` at ingestion (`ProviderRuntimeIngestion.ts:582`) — long assistant messages lose tail in stored activities.
- `subagent.item.completed` carries `detail` but ingestion also truncates generic detail to 180 chars (`87-87`, `562`) unless the completed payload bypasses that limit for subagent items — completed assistant in log line 2036 shows full text in activity payload (good for terminal), but mid-run replay from disk without completed event still lacks full text.
- Provider native `thread/read` returns complete `detail` on snapshot items (`codexThreadSnapshotItemDetail`, `830+`).

**Trigger:** Cold load of thread detail from server/hydration when subagent `transcriptItems` incomplete (open `loading` rows, or missing rows vs known `itemId`s from parent tool).

#### d. Additional: delta truncation during live run (edge)

Even while connected, individual activity records cap delta at 2000 chars. Coalesced in-memory transcript is fine live; **persisted** activity history used after navigation away/back may be lossy until terminal reconcile.

---

## 4. Reconcile-only policy (proposal)

Spec anchor:

```180:180:composer-chat-document-fix.md
- Use `getProviderThreadSnapshot` only on open, reconnect, explicit gaps, or terminal reconcile. Do not poll it every 2500ms during an active run.
```

Related event-store rule (`166:166:composer-chat-document-fix.md`):

```166:166:composer-chat-document-fix.md
| Active run | Append from `subagent.item.*` / `subagent.content.delta` on the thread. | Do not poll snapshot as the primary path. |
```

### Exact triggers

| # | Trigger | Condition | Never |
|---|---------|-----------|-------|
| 1 | **Cold open** | First mount of inline subagent body for `providerThreadId` AND zero `subagent.*` activities (or empty `transcriptItems`) for that id in parent thread activities | Timer |
| 2 | **Reconnect gap** | `subscribeThread` callback receives `item.kind === "snapshot"` (`service.ts:270-272`) AND subagent has `providerThreadId` on active parent turn | Timer |
| 3 | **Explicit gap** | Detected mismatch: e.g. open `loading` row with no deltas for >N seconds, or `itemId` in parent collab state but no matching transcript row | Timer |
| 4 | **Terminal reconcile** | `subagent.thread.state.changed` with `payload.state === "idle"` (`ProviderRuntimeIngestion.ts:526-527`, log lines 2040-2041) for that `providerThreadId` | Timer |

**Never:** interval polling (reject `main`’s 2500 ms loop). Live updates come from streamed activities only.

One in-flight request per `(threadId, providerThreadId)`; dedupe terminal reconcile if cold-open fetch already in flight.

---

## 5. Reconcile merge rule

When streamed `transcriptItems` and snapshot disagree, apply `mergeTranscript(streamed, snapshot)`:

### Rules

| Item type | Rule |
| --------- | ---- |
| **`assistant_message`** | If streamed row exists and `status === "completed"` (or `loading === false` with non-empty `text` from `item.completed`): **keep streamed**. If streamed row is open/incomplete (`loading === true` or missing text): **prefer snapshot `detail`** for `text`, set `loading: false`. |
| **`user_message`** | **Snapshot authoritative** once snapshot received: replace `text` from snapshot `detail`; set `loading: false`. Streamed partial user rows are rare (user items complete immediately — log 187-188). |
| **Tool / command / other lifecycle** | **Streamed lifecycle wins** for `status`, `loading`, ordering. Snapshot **fills missing items** (by `item.id`) not present in streamed map. Do not downgrade a streamed `completed` row to `loading`. |
| **Ordering** | Primary order: streamed sequence/`createdAt`. Insert snapshot-only items at turn boundaries by provider turn index. |

### Pseudo-code

```ts
function mergeTranscript(
  streamed: SubagentTranscriptItem[],
  snapshot: ProviderThreadSnapshot | null,
): SubagentTranscriptItem[] {
  if (!snapshot) return streamed;

  const byItemId = new Map(streamed.map((row) => [row.itemId, row]));
  const snapshotItems = snapshot.turns.flatMap((turn) => turn.items);

  for (const snap of snapshotItems) {
    const itemId = snap.id ?? "";
    if (!itemId) continue;

    const existing = byItemId.get(itemId);

    if (snap.itemType === "user_message") {
      byItemId.set(itemId, {
        ...(existing ?? syntheticRow(snap)),
        text: snap.detail ?? existing?.text ?? "",
        loading: false,
        status: "completed",
        itemType: snap.itemType,
      });
      continue;
    }

    if (snap.itemType === "assistant_message") {
      if (existing && !existing.loading && existing.status === "completed") {
        continue; // streamed terminal wins
      }
      byItemId.set(itemId, {
        ...(existing ?? syntheticRow(snap)),
        text: snap.detail ?? existing?.text ?? "",
        loading: false,
        status: "completed",
        itemType: snap.itemType,
      });
      continue;
    }

    // tool / command / etc.
    if (!existing) {
      byItemId.set(itemId, snapshotRowToTranscriptItem(snap));
    } else if (existing.loading && snapshotTerminal(snap)) {
      byItemId.set(itemId, {
        ...existing,
        text: existing.text || snap.detail,
        loading: false,
        status: "completed",
      });
    }
  }

  return sortBySequence([...byItemId.values()]);
}
```

Reconcile runs **only** when a snapshot fetch completes (four triggers above), not on every render.

---

## 6. Placement

### Recommendation: **(a) `session-logic.ts`**

Keep merge **stateless**: pure functions over thread activities + optional snapshot argument.

Natural insertion point — parallel to existing subagent derivation (`727-845`):

```727:845:packages/app/src/session-logic.ts
  const subagentDetailsByProviderThreadId = deriveSubagentDetailsByProviderThreadId(ordered);
  ...
            subagents: applySubagentDetails(
              applySubagentUsage(workEntry.subagents, subagentUsageByProviderThreadId),
              subagentDetailsByProviderThreadId,
            ),
```

Proposed additions in the same block:

1. `deriveSubagentTranscriptByProviderThreadId(ordered)` — builds streamed `transcriptItems` (includes delta coalescing; stop filtering `subagent.content.delta` at `816-818`).
2. `mergeTranscript(streamed, snapshot?)` — called when snapshot available.
3. `applySubagentTranscript(subagents, transcriptByProviderThreadId, reconcileSnapshot?)` — mirror of `applySubagentDetails` at `1026-1045`.

```1026:1045:packages/app/src/session-logic.ts
function applySubagentDetails(
  subagents: ReadonlyArray<WorkLogSubagent>,
  detailsByProviderThreadId: ReadonlyMap<string, DerivedSubagentDetails>,
): WorkLogSubagent[] {
  return subagents.map((subagent) => {
    const key = subagent.providerThreadId ?? subagent.threadId;
    const details = key ? detailsByProviderThreadId.get(key) : undefined;
    ...
      logs: details.logs,
      hasDetails: details.logs.length > 0,
```

Extend to set `transcriptItems` and `hasDetails: transcriptItems.length > 0`.

### Why not (b) app-side store?

No need for a durable snapshot cache keyed by `providerThreadId` unless reconcile fetch latency requires optimistic UI — streamed derivation already updates every render from activities. Snapshot is ephemeral input to `mergeTranscript` at reconcile time; optional thin `Map<providerThreadId, ProviderThreadSnapshot>` in task-card expand state is enough for UI loading flags, not a second subscription system.

---

## 7. Service-layer hook

### Candidate sites in `service.ts`

**A. Terminal idle — `applyRecoveredEventBatch`** (`603-627`):

```603:627:packages/app/src/environments/runtime/service.ts
function applyRecoveredEventBatch(
  events: ReadonlyArray<OrchestrationEvent>,
  environmentId: EnvironmentId,
) {
  ...
  const uiEvents = coalesceOrchestrationUiEvents(events);
  ...
  useStore.getState().applyOrchestrationEvents(uiEvents, environmentId);
```

After `applyOrchestrationEvents`, scan batch for `thread.activity-appended` where activity `kind === "subagent.thread.state.changed"` and `payload.state === "idle"`. Emit reconcile request for `payload.providerThreadId` (callback/event bus/hook consumed by expanded task card — not a poll loop).

**B. Reconnect gap — `attachThreadDetailSubscription`** (`267-275`):

```267:275:packages/app/src/environments/runtime/service.ts
  entry.unsubscribe = connection.client.orchestration.subscribeThread(
    { threadId: entry.threadId },
    (item) => {
      if (item.kind === "snapshot") {
        useStore.getState().syncServerThreadDetail(item.snapshot.thread, entry.environmentId);
        return;
      }
      applyEnvironmentThreadDetailEvent(item.event, entry.environmentId);
    },
  );
```

After `syncServerThreadDetail`, signal reconcile for subagents on that thread with empty or stale transcripts.

**C. Single-event path — `applyEnvironmentThreadDetailEvent`** (`659-664`):

```659:664:packages/app/src/environments/runtime/service.ts
export function applyEnvironmentThreadDetailEvent(
  event: OrchestrationEvent,
  environmentId: EnvironmentId,
) {
  applyRecoveredEventBatch([event], environmentId);
}
```

Same idle detection applies per event.

**D. Cold open** — not service-layer; inline task card body mount effect checks transcript emptiness and calls `getProviderThreadSnapshot` once (replacing tray mount effect).

### `coalesceOrchestrationUiEvents` — no subagent branch

Confirmed (`coalesce-orchestration-events.ts:3-44`):

```3:8:packages/app/src/environments/runtime/coalesce-orchestration-events.ts
/**
 * Coalesce assistant-message streaming bursts so the UI commits one merged
 * `thread.message-sent` per (threadId, messageId) instead of one commit per
 * text delta. Approval, user input, plan, tool, and subagent events stay
 * distinct because each event may represent a separate user-visible action.
 */
```

Only adjacent `thread.message-sent` pairs merge. All `subagent.*` activities pass through unchanged.

---

## 8. Deletion of mount-only snapshot read

Once inline body uses reconcile-only policy:

- `subagent-preview-tray.tsx:161-204` mount-only `getProviderThreadSnapshot` becomes **obsolete with the tray** (Path A removes composer tray per `cursor-subagent-click-flow.md` §7).
- **No other production code path** depends on that read (grep §2). Plan workbench stub does not call it.

Safe to delete tray snapshot effect when tray is removed; inline body owns the four triggers.

---

## 9. Type changes (concrete)

### `SubagentTranscriptItem` (coordinate with member 2)

From `path-a-2-orchestration-data.md:388-410`:

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

Extend `WorkLogSubagent` (`session-logic.ts:50-69`):

```ts
export interface WorkLogSubagent {
  ...
  readonly transcriptItems?: ReadonlyArray<SubagentTranscriptItem>;
}
```

### `WorkLogSubagent.snapshotState` — **not needed**

Reconcile snapshot is ephemeral input to `mergeTranscript` at fetch completion. Loading/error for reconcile can live in task-card local state (`"idle" | "loading" | "loaded" | "error"`). Derivation stays pure; no `snapshotState` marker on `WorkLogSubagent`.

---

## Summary

| Question | Answer |
| -------- | ------ |
| Primary render path | Streamed `subagent.*` → `transcriptItems` in `session-logic.ts` |
| When to call snapshot | Cold open (empty transcript), reconnect snapshot, explicit gap, terminal `idle` |
| When never | Timer / 2500 ms poll |
| Merge location | `mergeTranscript` in `session-logic.ts` beside `deriveSubagentDetailsByProviderThreadId` |
| Service role | Detect idle + reconnect snapshot; dispatch reconcile fetch hook |
| Tray mount read | Delete with tray; only caller today |
