# Multi current state (composer chat parity)

## Index

- Files mapped: 16
- P0 critical sites: 6 (with file:line back-pointers)
- P1 critical sites: 2

## P0 critical sites (jump table)

| Plan item | File | Line range | Note |
| ---- | ---- | ---- | ---- |
| P0-A | messages-timeline.tsx | L895-L919 | `isRunning` branch runs before `expanded`; expanded+running still renders `WorkGroupPreview` |
| P0-B | subagent-preview-tray.tsx | L68-L86 | `SubagentPreviewActiveThreadSync` calls `closePreview()` when `!visible` or wrong thread |
| P0-B | input.tsx | L2231-L2235 | passes `visible={composerVariant !== "compact" \|\| isDockComposerExpanded}` to tray stack |
| P0-D | subagent-preview-tray.tsx | L161-L207, L238-L244, L363-L387 | 2500ms snapshot poll; tray body uses parallel `SubagentActivityLine`, not main timeline rows |
| P0-E | messages-timeline.tsx | L924-L926 | local duplicate `isCommandWorkEntry` (narrower than canonical) |
| P0-E | timeline-rows.ts | L395-L402 | canonical private `isCommandWorkEntry` (not exported) |
| P0-F | service.ts | L470-L506, L642-L665, L268-L276 | `coalesceOrchestrationUiEvents` + per-event `applyOrchestrationEvents`; no rAF microbatching |

## P1 critical sites (jump table)

| Plan item | File | Line range | Note |
| ---- | ---- | ---- | ---- |
| P1 ingestion | ProviderRuntimeIngestion.ts | L420-L437, L643-L739 | `tool.summary` emission; tool lifecycle + output deltas carry `payload.itemId` when `event.itemId` set |
| P1 session-logic | session-logic.ts | L718-L784, L1084-L1235, L1237-L1325 | `deriveWorkLogEntries` + collapse keyed on derived `entry.id` / `toolCallId` from `payload.itemId`; no `tool.summary` special case |

---

## Cross-file findings

**Does Multi have a parallel `SubagentActivityLine` path today?** Yes.

- Main timeline work/tool rows: `messages-timeline.tsx` → `WorkGroupSection` / `WorkGroupPreview` → `ToolCallMessage` (`tool-message.tsx`) → `ToolCallRenderer` (`tool-renderer.tsx`).
- Subagent tray: `subagent-preview-tray.tsx` renders `SubagentActivityLine` (L363-L387), which wraps `ToolCallLine` / `ExpandableToolMetadataLine` directly — not `ToolCallMessage`.
- Tray transcript primary source today is `getProviderThreadSnapshot` (L182-L207, polled every 2500ms while `isActive`), with `subagent.logs` rendered as secondary `SubagentActivityLine` rows (L232-L245).
- `session-logic.ts` already derives subagent state onto `WorkLogEntry.subagents` (filtered out of top-level work log via `isSubagentRuntimeActivity`), but the tray does not reuse main-timeline row components for that data.

---

## Existing tests

| Path | Suite / cases | Encodes current bug? |
| ---- | ------------- | -------------------- |
| `packages/app/src/components/chat/timeline/messages-timeline.test.tsx` | `describe("messages-timeline")`: inline terminal labels; edit affordance; context compaction; changed file paths; shell tool output | No |
| `packages/app/src/components/chat/timeline/messages-timeline.browser.tsx` | `describe("messages-timeline")`: activity rows; collapsed work summary + chevrons; caps running preview tail (6 entries, 144px); **collapsed** running preview pane; scroll pinning cases; sticky user row | **Yes** — `"renders a live preview pane when a running work group is collapsed"` (L399-L437): after click-expand while still running, asserts `[data-work-group-preview]` **is still present** (L435). Plan P0-A will flip this. |
| `packages/app/src/environments/runtime/service.threadSubscriptions.test.ts` | `retainThreadDetailSubscription` (5 cases); `projection version guards`; `coalesceOrchestrationUiEvents` | No |
| `packages/app/src/environments/runtime/orchestration-event-effects.test.ts` | `deriveOrchestrationBatchEffects` (5 cases) | No |
| `packages/server/test/orchestration/ProviderRuntimeIngestion.test.ts` | `ProviderRuntimeIngestion` (30+ cases); includes `"projects provider tool summaries into thread activities"` (L2576) asserting `kind: "tool.summary"` | No |

---

## packages/app/src/components/chat/timeline/messages-timeline.tsx

**Lines:** 1072

**Exports:**
- `TimelineRowSharedState` (interface)
- `TimelineRowCtx` (context)
- `MessagesTimelineController` (interface)
- `MessagesTimeline` (component)

### WorkGroupSection: isRunning vs expanded branch (P0-A)

```tsx
// L895-L919
      {isRunning ? (
        <>
          {expanded && !isCommandGroup ? <WorkGroupSummaryLine summary={summary} /> : null}
          <WorkGroupPreview
            key={`work-preview:${row.id}`}
            row={row}
            onExpand={handleToggle}
            projectRoot={projectRoot}
          />
        </>
      ) : expanded ? (
        <div className="flex min-w-0 max-w-full flex-col gap-(--chat-timeline-step-gap)">
          {!isCommandGroup ? <WorkGroupSummaryLine summary={summary} /> : null}
          {row.groupedEntries.map((workEntry) => (
            <ToolCallMessage
              key={`work-row:${workEntry.id}`}
              workEntry={workEntry}
              projectRoot={projectRoot}
              activeThreadId={activeThreadId}
              environmentId={activeThreadEnvironmentId}
              subagentDetailsEnabled
            />
          ))}
        </div>
      ) : null}
```

Preview caps: `WORK_GROUP_PREVIEW_MAX_ENTRIES = 6` (L64), `WORK_GROUP_PREVIEW_PX = 144` (L533). `estimateTimelineRowSize` uses preview height whenever `row.isRunning` (L644-L650), ignoring expanded state.

### Local duplicate `isCommandWorkEntry` (P0-E)

```tsx
// L924-L926
function isCommandWorkEntry(entry: WorkLogEntry): boolean {
  return entry.itemType === "command_execution" || Boolean(entry.command);
}
```

Used at L850 for `isCommandGroup` header/summary behavior.

---

## packages/app/src/components/chat/timeline/timeline-rows.ts

**Lines:** 473

**Exports:**
- `TimelineDurationMessage`, `WorkTimelineRow`, `WorkGroupSummary`, `MessageTimelineRow`, `ProposedPlanTimelineRow`, `WorkingTimelineRow`
- `BaseMessagesTimelineRow`, `MessagesTimelineRow`, `StableMessagesTimelineRowsState`
- `computeMessageDurationStart`, `deriveMessagesTimelineRows`, `computeStableMessagesTimelineRows`, `summarizeWorkGroup`

### Row union

```tsx
// L53-L57
export type BaseMessagesTimelineRow =
  | WorkTimelineRow
  | MessageTimelineRow
  | ProposedPlanTimelineRow
  | WorkingTimelineRow;
```

Work rows group consecutive `TimelineEntry` work entries (L103-L126), set `isRunning` when any grouped entry has `status === "running"`.

### Canonical `isCommandWorkEntry` (P0-E)

```tsx
// L395-L402
function isCommandWorkEntry(entry: WorkLogEntry): boolean {
  return (
    entry.requestKind === "command" ||
    entry.itemType === "command_execution" ||
    Boolean(entry.command) ||
    Boolean(entry.artifacts?.some((artifact) => artifact.type === "command"))
  );
}
```

Private — not exported. Used in `summarizeWorkGroup` (L214).

---

## packages/app/src/session-logic.ts

**Lines:** 2824

**Exports (relevant):** `WorkLogEntry`, `WorkLogSubagent`, `WorkLogSubagentLog`, `deriveWorkLogEntries`, `deriveTimelineEntries`, tool artifact types, pending approval/user-input/plan helpers.

### `deriveWorkLogEntries` signature + pipeline (P1)

```tsx
// L718-L734
export function deriveWorkLogEntries(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  latestTurnId: TurnId | undefined,
  options: WorkLogDerivationOptions = {},
): WorkLogEntry[] {
  const ordered = [...activities].toSorted(compareActivitiesByOrder);
  ...
  const entries = ordered
    .filter((activity) => (latestTurnId ? activity.turnId === latestTurnId : true))
    .filter((activity) => activity.kind !== "context-window.updated")
    .filter((activity) => !isSubagentRuntimeActivity(activity))
    .filter((activity) => activity.summary !== "Checkpoint captured")
    .filter((activity) => !isPlanBoundaryToolActivity(activity))
    .map((activity) => toDerivedWorkLogEntry(activity, completedAtByTaskKey));
```

**Activity kinds handled in derivation helpers (switch / kind checks):**
- Status dispatch (`resolveWorkLogStatus`): `tool.updated`, `tool.started`, `tool.completed`, `task.started`, `task.progress`, `task.completed` (L2147-L2161)
- Tool lifecycle collapse: `tool.started`, `tool.updated`, `tool.completed` (L1328-L1329)
- Task lifecycle collapse: `task.started`, `task.progress`, `task.completed` (L1332-L1333)
- Subagent side-channel: all `subagent.*` via `isSubagentRuntimeActivity` (L794-L795), attached to parent entries through `extractWorkLogSubagents` / `deriveSubagentDetailsByProviderThreadId`
- Pending approvals: `approval.requested`, `approval.resolved`, `provider.approval.respond.failed`
- Pending user input: `user-input.requested`, `user-input.resolved`, `provider.user-input.respond.failed`
- Plan: `turn.plan.updated`

**No `tool.summary` branch** — summaries pass through as ordinary derived entries with `entryId = activity.id`.

### Collapse keying (P1)

```tsx
// L1116-L1127
  const toolCallId = asTrimmedString(payload?.itemId);
  ...
  const entryId =
    toolCallId && isToolLifecycleActivityKind(activity.kind) && !isSubagentLifecycle
      ? activity.turnId
        ? `tool:${activity.turnId}:${toolCallId}`
        : `tool:${toolCallId}`
      : ...
        : activity.id;
```

```tsx
// L1321-L1324
  return (
    previous.toolCallId !== undefined &&
    previous.toolCallId === next.toolCallId &&
    previous.id === next.id
  );
```

Collapse index map uses `activeLifecycleWorkEntryId` → `entry.id` (L1268-L1273). Stable **`payload.itemId`** feeds `toolCallId` and the derived `entry.id`; not raw per-activity `activity.id` for tool lifecycle rows.

---

## packages/app/src/environments/runtime/service.ts

**Lines:** 1002

**Exports (relevant):** `coalesceOrchestrationUiEvents`, `applyEnvironmentThreadDetailEvent`, `shouldApplyTerminalEvent`, `subscribeEnvironmentConnections`, thread detail subscription retain/release helpers.

### `coalesceOrchestrationUiEvents` (P0-F)

```tsx
// L470-L505
export function coalesceOrchestrationUiEvents(
  events: ReadonlyArray<OrchestrationEvent>,
): OrchestrationEvent[] {
  if (events.length < 2) {
    return [...events];
  }
  const coalesced: OrchestrationEvent[] = [];
  for (const event of events) {
    const previous = coalesced.at(-1);
    if (
      previous?.type === "thread.message-sent" &&
      event.type === "thread.message-sent" &&
      ...
    ) {
      coalesced[coalesced.length - 1] = { ...event, payload: { ... merged text ... } };
      continue;
    }
    coalesced.push(event);
  }
  return coalesced;
}
```

Coalesces **assistant message streaming only** — not activity bursts.

### `applyOrchestrationEvents` call path (P0-F)

```tsx
// L642-L665
function applyRecoveredEventBatch(events, environmentId) {
  ...
  const batchEffects = deriveOrchestrationBatchEffects(events);
  const uiEvents = coalesceOrchestrationUiEvents(events);
  ...
  useStore.getState().applyOrchestrationEvents(uiEvents, environmentId);
```

`applyOrchestrationEvents` is implemented in `packages/app/src/stores/thread-sync.ts` (store layer), invoked from here.

### Subscribe path — no per-frame microbatching (P0-F)

```tsx
// L268-L276
  entry.unsubscribe = connection.client.orchestration.subscribeThread(
    { threadId: entry.threadId },
    (item) => {
      if (item.kind === "snapshot") { ... return; }
      applyEnvironmentThreadDetailEvent(item.event, entry.environmentId);
    },
  );
```

Each subscription callback invokes `applyEnvironmentThreadDetailEvent` → `applyRecoveredEventBatch([event], ...)` immediately. **No `requestAnimationFrame` buffer** present in this file.

---

## packages/app/src/environments/runtime/orchestration-event-effects.ts

**Lines:** 121

**Exports:**
- `OrchestrationBatchEffects` (interface)
- `deriveOrchestrationBatchEffects`

Derives side effects from raw event batches **before** UI coalescing in `service.ts`: draft promotion, terminal cleanup, git refresh on `tool.updated`/`tool.completed` with `itemType: "file_change"`, provider invalidation flags.

---

## packages/app/src/components/chat/composer/subagent-preview-tray.tsx

**Lines:** 418

**Exports:**
- `SubagentPreviewTrayStack`

### Snapshot polling + `getProviderThreadSnapshot` (P0-D)

```tsx
// L175-L207
    const readSnapshot = (showLoading: boolean) => {
      ...
      void api.orchestration
        .getProviderThreadSnapshot({
          threadId: activeThreadId,
          providerThreadId,
          includeTurns: true,
        })
        .then((snapshot) => { setSnapshotState({ status: "loaded", snapshot }); })
        ...
        .finally(() => {
          if (!cancelled && isActive) {
            refreshTimeoutId = window.setTimeout(() => readSnapshot(false), 2500);
          }
        });
    };
    readSnapshot(true);
```

### Parallel `SubagentActivityLine` path (P0-D)

```tsx
// L232-L244
      {runningLogs.map((log) => (
        <SubagentActivityLine
          key={log.id}
          action={log.label}
          detail={log.detail}
          loading={log.id === streamingLogId}
        />
      ))}
```

```tsx
// L363-L387
const SubagentActivityLine = memo(function SubagentActivityLine({ action, detail, loading }) {
  ...
  return <ToolCallLine action={action} details={body ?? ""} loading={loading} />;
});
```

---

## packages/app/src/stores/subagent-preview-store.ts

**Lines:** 130

**Exports:**
- `SubagentPreviewSelection`, `subagentPreviewKey`, `isSubagentPreviewLogVisible`, `subagentPreviewUpdateSignature`
- `useSubagentPreviewStore`

### Store shape (P0-B)

```tsx
// L106-L129
interface SubagentPreviewStore {
  preview: SubagentPreviewSelection | null;
  openPreview: (selection: SubagentPreviewSelection) => void;
  updatePreviewSubagent: (subagent: WorkLogSubagent) => void;
  closePreview: () => void;
}

export const useSubagentPreviewStore = create<SubagentPreviewStore>((set, get) => ({
  preview: null,
  openPreview: (selection) => set({ preview: selection }),
  updatePreviewSubagent: (subagent) => { ... },
  closePreview: () => set({ preview: null }),
}));
```

No separate `subagentFocus` / `subagentPresented` split yet — single `preview` selection cleared by `closePreview`.

### `SubagentPreviewActiveThreadSync` (P0-B)

```tsx
// L68-L86
function SubagentPreviewActiveThreadSync({ belongsToActiveThread, closePreview, previewKey, visible }) {
  useMountEffect(() => {
    if (previewKey !== null && (!belongsToActiveThread || !visible)) {
      closePreview();
    }
  });
  return null;
}
```

Wired from `SubagentPreviewTrayStack` (L35-L42); `visible` prop originates in `input.tsx` L2234.

---

## packages/app/src/components/chat/composer/input.tsx

**Lines:** 2476

**Exports:** `ComposerInput` (default export component; large file)

### Tray visibility wiring (P0-B)

```tsx
// L2231-L2235
          <SubagentPreviewTrayStack
            activeThreadId={activeThreadId}
            compact={composerVariant === "compact"}
            visible={composerVariant !== "compact" || isDockComposerExpanded}
          />
```

Collapsing dock composer sets `visible=false` → sync effect clears preview selection.

---

## packages/server/src/orchestration/ProviderRuntimeIngestion.ts

**Lines:** 1615

**Exports:** `ProviderRuntimeIngestionLive` (Layer)

Core mapping function: `mapRuntimeEventToActivities` (internal; emits `OrchestrationThreadActivity[]` consumed as `thread.activity-appended`).

### `tool.summary` emission (P1)

```tsx
// L420-L437
    case "tool.summary": {
      return [
        {
          id: event.eventId,
          ...
          kind: "tool.summary",
          summary: truncateDetail(event.payload.summary, 2_000),
          payload: {
            summary: truncateDetail(event.payload.summary, 2_000),
            ...(event.payload.precedingToolUseIds
              ? { precedingToolUseIds: event.payload.precedingToolUseIds }
              : {}),
          },
          ...
        },
      ];
    }
```

### Tool lifecycle + `payload.itemId` (P1)

```tsx
// L691-L710 (item.started; updated/completed mirror pattern)
    case "item.started": {
      ...
          payload: {
            itemType: event.payload.itemType,
            ...(event.itemId ? { itemId: event.itemId } : {}),
            ...
          },
```

```tsx
// L717-L738 (content.delta → tool.updated)
        payload: {
          itemType: event.payload.streamKind === "command_output" ? "command_execution" : "file_change",
          ...(event.itemId ? { itemId: event.itemId } : {}),
          ...
        },
```

**`payload.itemId` stability:** When adapters emit `event.itemId`, ingestion copies it to all tool lifecycle activities and output-delta updates for the same tool call. Missing `event.itemId` omits the field (no synthetic fallback in these paths).

### Activity kinds emitted (cross-check vs orchestration-runtime-mapping.md)

| Activity kind | Runtime trigger (this file) |
| --- | --- |
| `approval.requested` / `approval.resolved` | `request.opened` / `request.resolved` |
| `user-input.requested` / `user-input.resolved` | `user-input.requested` / `user-input.resolved` |
| `runtime.error` / `runtime.warning` | same |
| `turn.plan.updated` | `turn.plan.updated` |
| `task.started` / `task.progress` / `task.completed` | same |
| `tool.summary` | `tool.summary` |
| `context-compaction` | `thread.state.changed` (`compacted`) |
| `context-window.updated` | `thread.token-usage.updated` (main thread) |
| `subagent.usage.updated` | token usage with `providerThreadId` |
| `subagent.thread.started` / `subagent.thread.state.changed` | `subagent.thread.*` |
| `subagent.item.started` / `updated` / `completed` | `subagent.item.*` (kind = `event.type`) |
| `subagent.content.delta` | `subagent.content.delta` |
| `tool.started` / `tool.updated` / `tool.completed` | `item.started` / `updated` / `completed` for tool item types |
| `tool.updated` | `content.delta` (`command_output`, `file_change_output`) |
| `tool.completed` | `files.persisted` |

Session/assistant/proposed-plan paths emit **commands**, not activities (see mapping doc).

---

## packages/server/src/orchestration/ProjectionPipeline.ts

**Lines:** 1591

**Exports:** `ORCHESTRATION_PROJECTOR_NAMES`, `OrchestrationProjectionPipelineLive`

Routes domain events through projectors (thread, messages, activities, session, etc.). Composer-chat plan treats this as downstream of ingestion — no P0/P1 edit sites identified in plan.

---

## packages/server/src/orchestration/ThreadProjection.ts

**Lines:** 1369

**Exports:** `ThreadProjectionLive`

Applies thread-scoped projection updates (activities append, session state, messages). Consumes decider output.

---

## packages/server/src/orchestration/decider.ts

**Lines:** ~1113

**Exports:** `decideOrchestrationCommand`

Pure command→event decider for orchestration writes. Not a composer UI touch point; listed for ingestion stack completeness.

---

## packages/contracts/src/orchestration.ts

**Lines:** 1652

**Exports:** Full orchestration read/write model; activity and message schemas.

### `OrchestrationThreadActivityKind` (exact values)

```tsx
// L269-L304
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
  "provider.turn.start.failed",
  "provider.turn.interrupt.failed",
  "provider.approval.respond.failed",
  "provider.user-input.respond.failed",
  "provider.session.stop.failed",
  "checkpoint.capture.failed",
  "checkpoint.revert.failed",
  "checkpoint.captured",
  "setup-script.requested",
  "setup-script.started",
  "setup-script.failed",
]);
```

---

## packages/contracts/src/provider-runtime.ts

**Lines:** 1144

**Exports:** Canonical provider runtime event union (`ProviderRuntimeEventType`, event structs), `TOOL_LIFECYCLE_ITEM_TYPES`, `isToolLifecycleItemType`, snapshot types, request kinds.

Composer plan reads this only indirectly — UI switches on `OrchestrationThreadActivity.kind`, not provider event names.

---

## packages/app/src/components/chat/message/tool-renderer.tsx

**Lines:** 1224

**Exports:** `ToolCallConversationDensity`, `ToolCase`, `ToolCallModel`, `ToolCallApproval`, `ToolCallRendererProps`, `ThinkingStatus`, `ToolCallRenderer`, `ToolCallLine`, `ExpandableToolMetadataLine`

### `ToolCallRenderer` dispatch cases

Primary `switch (toolCall.tool.case)` (L256-L343):

| Case | Component |
| ---- | --------- |
| `awaitToolCall` | `ToolCallLine` |
| `shellToolCall` | `ShellToolCall` |
| `editToolCall`, `deleteToolCall` | `EditToolCall` |
| `taskToolCall` | `TaskToolCall` |
| `webSearchToolCall`, `webFetchToolCall` | `ToolCallLine` |
| `readToolCall`, `grepToolCall`, `globToolCall`, `mcpToolCall`, `dynamicToolCall`, `imageViewToolCall`, `unknownToolCall` | `ExpandableToolMetadataLine` |

Secondary `iconForToolCase` switch (L1179-L1199) covers the same case strings for verbose icon display.

Shell labels today: resolved via `resolveActionLabel` — plan P2 notes generic `Running` / `Ran` for shell.

---

## packages/app/src/components/chat/message/tool-message.tsx

**Lines:** 484

**Exports:** `ToolCallMessage`

Maps `WorkLogEntry` → `ToolCallModel` → `ToolCallRenderer`. When `workEntry.subagents` present, renders `SubagentStatusRow` buttons that call `useSubagentPreviewStore.openPreview` (L109-L117, L152-L163) — entry point into subagent tray, separate from main work-group rows.
