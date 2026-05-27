## Symptom

The subagent row can be selected, but the preview tray often does not render in the normal compact follow-up composer. The store is opened from `SubagentStatusRow`, but `SubagentPreviewTrayStack` returns only its sync helper unless `preview !== null`, `belongsToActiveThread`, and `props.visible` are all true (`packages/app/src/components/chat/message/tool-message.tsx:177-188`, `packages/app/src/components/chat/composer/subagent-preview-tray.tsx:46-50`).

In the current working-tree `input.tsx`, `props.visible` is false for the default compact single-line composer because it is computed as `composerVariant !== "compact" || isDockComposerExpanded` (`packages/app/src/components/chat/composer/input.tsx:2227-2231`). The compact composer is only expanded for inline edit, headers, queued edits, images, pending progress, explicit newlines, or measured multiline input (`packages/app/src/components/chat/composer/input.tsx:1513-1524`). A subagent preview selection is not part of that expansion condition.

The separate log display issue is that the branch removed the 2500 ms provider-thread snapshot refresh. `SubagentPreviewBody` now performs a single `getProviderThreadSnapshot` call on mount (`packages/app/src/components/chat/composer/subagent-preview-tray.tsx:161-204`). Meanwhile `subagent.content.delta` is filtered out of the derived subagent logs (`packages/app/src/session-logic.ts:812-818`) and also hidden by the preview store (`packages/app/src/stores/subagent-preview-store.ts:39-45`). That means assistant text relies on the one snapshot read, not live log rows.

## Log evidence (what events did the thread emit?)

Provider log: `/Users/workgyver/.multi/dev/logs/provider/9215a343-0772-47b8-b0d4-ab055bea4760.log`.

The log path exists. The relevant canonical events are healthy and ordered like this:

- Parent collab-agent tool call started at log line 105 with `itemId=call_VDOQCq1764d3DhA9ogmrtcH3`, `itemType=collab_agent_tool_call`, `status=inProgress`, and an empty `receiverThreadIds` array.
- Parent collab-agent tool call completed at log line 117 with the same `itemId`, `status=completed`, and `receiverThreadIds=["019e50df-9bfc-7f81-8b61-5a193b320e3c"]`.
- `subagent.thread.state.changed` fired at log lines 123 and 124 for `providerThreadId=019e50df-9bfc-7f81-8b61-5a193b320e3c`, `parentProviderThreadId=019e50df-764f-7791-8a16-40ad2c7b7598`, `parentTurnId=019e50df-76fc-7e90-8f24-34b61136e5aa`, and `parentItemId=call_VDOQCq1764d3DhA9ogmrtcH3`.
- `subagent.item.started` and `subagent.item.completed` fired for a user message at log lines 187 and 188 with `itemId=04f6ef6c-caf7-4ed4-a027-3900ccd9fae7`, `itemType=user_message`, and statuses `inProgress` then `completed`.
- `subagent.item.started` fired for an assistant message at log line 203 with `itemId=msg_032bb6bc0e9e4696016a109b9075788194b510b96483cb99f9`, `itemType=assistant_message`, `status=inProgress`.
- Many `subagent.content.delta` events followed for that assistant message. The sampled lines include 206, 207, 213-217, 219, and 229-236. They all carry `streamKind=assistant_text`.
- `subagent.item.completed` fired at log line 365 for that assistant message with `status=completed` and a text `detail`.
- Command subagent items fired at log lines 366-371 with `itemType=command_execution`, `status=inProgress` then `completed`.
- A second parent collab-agent completion appears at log line 2039 with `itemId=call_LLRPi3DOysw3JPekBw4z3vJa` and `receiverThreadIds=["019e50df-9bfc-7f81-8b61-5a193b320e3c"]`.
- The subagent finished with `subagent.item.completed` at log line 2036, `subagent.usage.updated` at line 2037, and `subagent.thread.state.changed` idle events at lines 2040 and 2041.

Event counts from the parsed log:

```text
subagent.content.delta 796
subagent.item.completed 21
subagent.item.started 21
subagent.thread.state.changed 4
subagent.usage.updated 5
```

I did not find `subagent.thread.started` in this log. I also did not find canonical `tool.summary` or `task.completed` events in this provider log. The provider log does have parent `item.completed` events for `collab_agent_tool_call`, which `ProviderRuntimeIngestion` maps to work-log `tool.completed` activities when the item type is a tool lifecycle item (`packages/server/src/orchestration/ProviderRuntimeIngestion.ts:667-688`).

## Branch vs main diffs

### `packages/app/src/components/chat/composer/subagent-preview-tray.tsx`

Relevant presentation hunk:

```diff
@@ -32,17 +32,20 @@ export const SubagentPreviewTrayStack = memo(function SubagentPreviewTrayStack(p
   const previewActiveThreadId = preview?.activeThreadId ?? null;
   const belongsToActiveThread =
     props.activeThreadId !== null && previewActiveThreadId === props.activeThreadId;
+  // Keep the selected subagent across composer collapse. Clear it only when
+  // the user switches threads.
   const activeThreadSync = (
     <SubagentPreviewActiveThreadSync
-      key={`${props.activeThreadId ?? ""}:${previewKey ?? ""}:${belongsToActiveThread ? "1" : "0"}:${props.visible ? "1" : "0"}`}
+      key={`${props.activeThreadId ?? ""}:${previewKey ?? ""}:${belongsToActiveThread ? "1" : "0"}`}
       belongsToActiveThread={belongsToActiveThread}
       closePreview={closePreview}
       previewKey={previewKey}
-      visible={props.visible}
     />
   );
 
-  if (!preview || !belongsToActiveThread || !props.visible) {
+  const isPresented = preview !== null && belongsToActiveThread && props.visible;
+
+  if (!isPresented) {
     return activeThreadSync;
   }
```

Relevant snapshot hunk:

```diff
@@ -145,7 +146,6 @@ const SubagentPreviewBody = memo(function SubagentPreviewBody(props: {
   selection: SubagentPreviewSelection;
 }) {
   const { activeThreadId, environmentId, projectRoot, subagent } = props.selection;
-  const isActive = subagent.isActive === true;
   const [snapshotState, setSnapshotState] = useState<SubagentSnapshotState>({ status: "idle" });
   const providerThreadId = subagent.providerThreadId?.trim();
   const canReadTranscript = (providerThreadId?.length ?? 0) > 0;
@@ -170,50 +171,35 @@ const SubagentPreviewBody = memo(function SubagentPreviewBody(props: {
     }
 
     let cancelled = false;
-    let refreshTimeoutId: number | undefined;
-
-    const readSnapshot = (showLoading: boolean) => {
-      if (showLoading) {
-        setSnapshotState((current) =>
-          current.status === "loaded" ? current : { status: "loading" },
-        );
-      }
-
-      void api.orchestration
-        .getProviderThreadSnapshot({
-          threadId: activeThreadId,
-          providerThreadId,
-          includeTurns: true,
-        })
-        .then((snapshot) => {
-          if (cancelled) {
-            return;
-          }
-          setSnapshotState({ status: "loaded", snapshot });
-        })
-        .catch((error: unknown) => {
-          if (cancelled) {
-            return;
-          }
-          setSnapshotState({
-            status: "error",
-            message: error instanceof Error ? error.message : "Failed to load thread snapshot.",
-          });
-        })
-        .finally(() => {
-          if (!cancelled && isActive) {
-            refreshTimeoutId = window.setTimeout(() => readSnapshot(false), 2500);
-          }
-        });
-    };
 
-    readSnapshot(true);
+    setSnapshotState((current) =>
+      current.status === "loaded" ? current : { status: "loading" },
+    );
+
+    void api.orchestration
+      .getProviderThreadSnapshot({
+        threadId: activeThreadId,
+        providerThreadId,
+        includeTurns: true,
+      })
+      .then((snapshot) => {
+        if (cancelled) {
+          return;
+        }
+        setSnapshotState({ status: "loaded", snapshot });
+      })
```

Impact: main refreshed snapshots every 2500 ms while the subagent was active. This branch reads once. Because content deltas are not in `subagent.logs`, assistant text can go stale or stay absent if the one snapshot is early (`packages/app/src/session-logic.ts:812-818`, `packages/app/src/stores/subagent-preview-store.ts:39-45`).

### `packages/app/src/stores/subagent-preview-store.ts`

No diff against `origin/main`. Current behavior still hides `subagent.content.delta` logs and matches preview updates by ids (`packages/app/src/stores/subagent-preview-store.ts:21-37`, `packages/app/src/stores/subagent-preview-store.ts:39-53`).

### `packages/app/src/components/chat/composer/input.tsx`

The working-tree version is modified by another agent. The subagent tray call site itself is present in the current file and passes `visible={composerVariant !== "compact" || isDockComposerExpanded}` (`packages/app/src/components/chat/composer/input.tsx:2227-2231`). The diff against `origin/main` is mostly sizing/styling and does not change that call site. Relevant nearby hunk:

```diff
@@ -2271,81 +2267,81 @@ export const ComposerInput = memo(
                     type="button"
                     className={cn(
                       COMPOSER_TOOLBAR_CONTROL_SIZE,
-                      "flex shrink-0 items-center justify-center rounded-full bg-multi-bg-quaternary p-0 text-multi-icon-tertiary transition-[background-color,color] duration-150 hover:bg-multi-bg-tertiary hover:text-multi-icon-secondary disabled:pointer-events-none disabled:opacity-35",
+                      "flex shrink-0 items-center justify-center rounded-full bg-multi-bg-tertiary p-0 text-multi-icon-tertiary transition-[background-color,color] duration-150 hover:bg-multi-bg-secondary hover:text-multi-icon-secondary disabled:pointer-events-none disabled:opacity-35",
                     )}
                     aria-label="Attach images"
                     disabled={pendingUserInputs.length > 0 || isConnecting}
@@ -2366,83 +2362,81 @@ export const ComposerInput = memo(
                   }
                   className={cn(
                     "flex items-center justify-end",
-                    isDockComposerExpanded
-                      ? "gap-[0.55rem]"
-                      : "gap-2 px-2.5 pb-2.5 sm:px-3 sm:pb-3",
+                    isDockComposerExpanded ? "gap-[0.55rem]" : "gap-2 px-3 pb-2.5 sm:pb-3",
                   )}
                 >
```

Impact: the current working-tree `input.tsx` still passes `visible`, `compact`, and `activeThreadId`; the problem is the meaning of `visible`, not a missing prop (`packages/app/src/components/chat/composer/input.tsx:2227-2231`).

### `packages/app/src/session-logic.ts`

Relevant hunk:

```diff
@@ -726,7 +735,6 @@ export function deriveWorkLogEntries(
   const subagentDetailsByProviderThreadId = deriveSubagentDetailsByProviderThreadId(ordered);
   const entries = ordered
     .filter((activity) => (latestTurnId ? activity.turnId === latestTurnId : true))
-    .filter((activity) => activity.kind !== "account.rate-limits.updated")
     .filter((activity) => activity.kind !== "context-window.updated")
     .filter((activity) => !isSubagentRuntimeActivity(activity))
     .filter((activity) => activity.summary !== "Checkpoint captured")
@@ -1126,8 +1134,10 @@ function toDerivedWorkLogEntry(
           ? `task:${activity.turnId}:${taskId}`
           : `task:${taskId}`
         : activity.id;
-  const tone: WorkLogEntry["tone"] =
-    activity.kind === "task.started" || activity.kind === "task.progress"
+  const isToolSummary = activity.kind === "tool.summary";
+  const tone: WorkLogEntry["tone"] = isToolSummary
+    ? "info"
+    : activity.kind === "task.started" || activity.kind === "task.progress"
       ? "thinking"
       : activity.tone === "approval"
         ? "info"
```

Impact: no branch diff here explains the tray not showing. Current code collects subagent details by provider thread id, skips `subagent.content.delta`, and attaches logs back to extracted subagents (`packages/app/src/session-logic.ts:727-792`, `packages/app/src/session-logic.ts:807-844`).

### `packages/app/src/environments/runtime/service.ts`

Relevant hunk:

```diff
@@ -467,44 +466,6 @@ function emitEnvironmentConnectionRegistryChange() {
   }
 }
 
-export function coalesceOrchestrationUiEvents(
-  events: ReadonlyArray<OrchestrationEvent>,
-): OrchestrationEvent[] {
-  if (events.length < 2) {
-    return [...events];
-  }
-
-  const coalesced: OrchestrationEvent[] = [];
-  for (const event of events) {
-    const previous = coalesced.at(-1);
-    if (
-      previous?.type === "thread.message-sent" &&
-      event.type === "thread.message-sent" &&
-      previous.payload.threadId === event.payload.threadId &&
-      previous.payload.messageId === event.payload.messageId &&
-      !(previous.payload.streaming && !event.payload.streaming && event.payload.text.length === 0)
-    ) {
-      coalesced[coalesced.length - 1] = {
-        ...event,
-        payload: {
-          ...event.payload,
-          attachments: event.payload.attachments ?? previous.payload.attachments,
-          createdAt: previous.payload.createdAt,
-          text:
-            !event.payload.streaming && event.payload.text.length > 0
-              ? event.payload.text
-              : previous.payload.text + event.payload.text,
-        },
-      };
-      continue;
-    }
-
-    coalesced.push(event);
-  }
-
-  return coalesced;
-}
-
 function syncProjectUiFromStore() {
```

Impact: extraction itself is not the break. The service calls `coalesceOrchestrationUiEvents(events)` then applies the returned events to the store (`packages/app/src/environments/runtime/service.ts:611-627`).

### `packages/app/src/environments/runtime/coalesce-orchestration-events.ts`

New module:

```diff
+import { type OrchestrationEvent } from "@multi/contracts";
+
+/**
+ * Coalesce assistant-message streaming bursts so the UI commits one merged
+ * `thread.message-sent` per (threadId, messageId) instead of one commit per
+ * text delta. Approval, user input, plan, tool, and subagent events stay
+ * distinct because each event may represent a separate user-visible action.
+ */
+export function coalesceOrchestrationUiEvents(
+  events: ReadonlyArray<OrchestrationEvent>,
+): OrchestrationEvent[] {
+  if (events.length < 2) {
+    return [...events];
+  }
+
+  const coalesced: OrchestrationEvent[] = [];
+  for (const event of events) {
+    const previous = coalesced.at(-1);
+    if (
+      previous?.type === "thread.message-sent" &&
+      event.type === "thread.message-sent" &&
+      previous.payload.threadId === event.payload.threadId &&
+      previous.payload.messageId === event.payload.messageId &&
+      !(previous.payload.streaming && !event.payload.streaming && event.payload.text.length === 0)
+    ) {
+      coalesced[coalesced.length - 1] = {
+        ...event,
+        payload: {
+          ...event.payload,
+          attachments: event.payload.attachments ?? previous.payload.attachments,
+          createdAt: previous.payload.createdAt,
+          text:
+            !event.payload.streaming && event.payload.text.length > 0
+              ? event.payload.text
+              : previous.payload.text + event.payload.text,
+        },
+      };
+      continue;
+    }
+
+    coalesced.push(event);
+  }
+
+  return coalesced;
+}
```

Impact: no `subagent.*` case was dropped. Only adjacent `thread.message-sent` events are merged; all other events are pushed unchanged (`packages/app/src/environments/runtime/coalesce-orchestration-events.ts:16-44`).

### `packages/app/src/components/chat/timeline/messages-timeline.tsx`

No relevant data-shape diff in the investigated path. Current code passes `activeThreadId`, `activeThreadEnvironmentId`, `projectRoot`, and `subagentDetailsEnabled` to every `ToolCallMessage` in expanded groups and running previews (`packages/app/src/components/chat/timeline/messages-timeline.tsx:903-924`, `packages/app/src/components/chat/timeline/messages-timeline.tsx:1014-1022`).

### `packages/app/src/components/chat/message/tool-message.tsx`

No relevant branch diff in the click wiring. Current code attaches the click handler and opens the store:

```diff
No relevant diff against origin/main for the click path.
```

Current call site:

```text
packages/app/src/components/chat/message/tool-message.tsx:177-188
```

### `packages/app/src/components/chat/message/tool-renderer.tsx`

No relevant diff for subagent preview wiring. Current task tool renderer displays `subagentConversation` when the task tool body is expanded (`packages/app/src/components/chat/message/tool-renderer.tsx:306-320`, `packages/app/src/components/chat/message/tool-renderer.tsx:483-513`).

### `packages/server/src/orchestration/ProviderRuntimeIngestion.ts`

Relevant subagent mapping is present:

```diff
No subagent.* case was removed in the diff against origin/main.
```

Current mapping converts provider runtime subagent events into orchestration activities with `providerThreadId`, `parentProviderThreadId`, `parentTurnId`, `parentItemId`, item ids, item types, `streamKind`, and content indexes where available (`packages/server/src/orchestration/ProviderRuntimeIngestion.ts:501-595`).

## Wiring chain

- Pass: provider runtime emits subagent events. The log contains `subagent.thread.state.changed`, `subagent.item.started`, `subagent.item.completed`, `subagent.content.delta`, and `subagent.usage.updated` with the expected `providerThreadId` and parent ids. See log lines 123-124, 187-188, 203, 206-207, 365-371, and 2036-2041.
- Pass: `ProviderRuntimeIngestion` maps all `subagent.*` runtime events into `thread.activity.append` payloads with the subagent identity payload (`packages/server/src/orchestration/ProviderRuntimeIngestion.ts:501-595`, `packages/server/src/orchestration/ProviderRuntimeIngestion.ts:1558-1567`).
- Pass: `coalesceOrchestrationUiEvents` does not coalesce or drop subagent events. It only merges adjacent `thread.message-sent` events (`packages/app/src/environments/runtime/coalesce-orchestration-events.ts:16-44`).
- Pass: `service.ts` runs coalescing and then applies the resulting UI events to the store (`packages/app/src/environments/runtime/service.ts:611-627`).
- Pass: `applyOrchestrationEvents` reduces thread detail events, and `thread.activity-appended` appends/replaces the activity in thread state (`packages/app/src/stores/thread-sync.ts:1600-1613`, `packages/app/src/stores/thread-sync.ts:1684-1698`).
- Pass with caveat: `deriveWorkLogEntries` filters raw `subagent.*` activities out of the visible work row list, but first derives subagent details and attaches them to parent task tool rows by provider thread id (`packages/app/src/session-logic.ts:727-792`, `packages/app/src/session-logic.ts:807-844`). It intentionally excludes `subagent.content.delta` from `subagent.logs` (`packages/app/src/session-logic.ts:812-818`).
- Pass: parent collab-agent tool rows can carry `WorkLogEntry.subagents`. The log shows parent `collab_agent_tool_call` completions with `receiverThreadIds` at lines 117 and 2039; `extractWorkLogSubagents` decodes receiver thread ids and writes `providerThreadId` into each `WorkLogSubagent` (`packages/app/src/session-logic.ts:2524-2575`).
- Pass: timeline rows render `ToolCallMessage` with the active thread and environment, both in expanded work groups and running previews (`packages/app/src/components/chat/timeline/messages-timeline.tsx:903-924`, `packages/app/src/components/chat/timeline/messages-timeline.tsx:1014-1022`).
- Pass: `SubagentStatusRow` computes `hasDetails`, attaches `onClick`, and calls `openPreview` with `activeThreadId`, `environmentId`, `projectRoot`, and the selected subagent (`packages/app/src/components/chat/message/tool-message.tsx:164-188`, `packages/app/src/components/chat/message/tool-message.tsx:203-219`).
- Fail: `SubagentPreviewTrayStack` refuses to render unless `props.visible` is true (`packages/app/src/components/chat/composer/subagent-preview-tray.tsx:46-50`), and `input.tsx` passes false during normal compact single-line operation (`packages/app/src/components/chat/composer/input.tsx:1513-1524`, `packages/app/src/components/chat/composer/input.tsx:2227-2231`).
- Fail for live assistant text: once the tray does render, the branch reads the provider snapshot once on mount (`packages/app/src/components/chat/composer/subagent-preview-tray.tsx:161-204`). The hook is a real mount-only effect (`packages/app/src/hooks/use-mount-effect.ts:3-5`). Since content deltas are filtered out of `subagent.logs`, the removed poll means assistant transcript updates depend on remounting or reopening after the provider snapshot has the content (`packages/app/src/session-logic.ts:812-818`, `packages/app/src/stores/subagent-preview-store.ts:39-45`).

## Root cause

Primary root cause: `packages/app/src/components/chat/composer/input.tsx:2227-2231` passes `visible={composerVariant !== "compact" || isDockComposerExpanded}` to `SubagentPreviewTrayStack`, while `SubagentPreviewTrayStack` requires `props.visible` before rendering (`packages/app/src/components/chat/composer/subagent-preview-tray.tsx:46-50`). In the normal compact composer, `isDockComposerExpanded` is false unless unrelated composer state expands it (`packages/app/src/components/chat/composer/input.tsx:1513-1524`), so clicking a subagent opens the store but the tray remains unmounted.

Secondary root cause for missing live transcript/log text: `packages/app/src/components/chat/composer/subagent-preview-tray.tsx:161-204` replaced the active 2500 ms snapshot refresh with a one-shot `useMountEffect`, and `subagent.content.delta` is deliberately not preserved as visible logs (`packages/app/src/session-logic.ts:812-818`, `packages/app/src/stores/subagent-preview-store.ts:39-45`). If the one snapshot read happens before the provider transcript has the interesting items, the tray has no later read to display them.

`SubagentPreviewActiveThreadSync` is not the blocker on this branch. It no longer closes the preview just because `visible` is false; it only closes when the selected preview does not belong to the active thread (`packages/app/src/components/chat/composer/subagent-preview-tray.tsx:71-87`). That change keeps a hidden selection around, but it does not make the tray render.

## Recommended fix

Fix the presentation gate first. In `packages/app/src/components/chat/composer/input.tsx`, do not tie subagent tray visibility to the compact composer being expanded. A minimal fix is:

```tsx
<SubagentPreviewTrayStack
  activeThreadId={activeThreadId}
  compact={composerVariant === "compact"}
  visible={!isInlineEditComposer}
/>
```

If the desired layout is to expand the compact composer shell while the tray is open, add a local selector for the preview and include it in `isDockComposerExpanded`, but keep the tray visible condition independent of unrelated text/header/image state.

Then restore live transcript refresh while the subagent is active, or keep `subagent.content.delta` in the preview's fallback running logs until a canonical snapshot with items is loaded. The lowest-risk branch-local repair is to replace the mount-only snapshot read with a keyed effect that reads when `providerThreadId` becomes available and schedules the 2500 ms refresh while `subagent.isActive === true`, matching the removed main behavior.

## Risk / scope of fix

The visibility fix is small and isolated to composer rendering. The main risk is visual: the tray may appear above the single-line follow-up composer, so spacing should be checked in compact and expanded composer states.

The transcript fix has more runtime cost because it reintroduces polling while a subagent is active. Keep the poll scoped to an open tray with a non-empty `providerThreadId`, and stop it on unmount or when `subagent.isActive` is no longer true.
