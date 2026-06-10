# Subagent / Plan UI Parity & ChatView Stability

**Status:** Council complete — ready for implementation  
**Reference:** [`chat_foundation_integrated_7e6834e5.plan.md`](./chat_foundation_integrated_7e6834e5.plan.md)  
**Cursor binary:** `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.{js,css}`  
**Council:** 10 subagents (2026-06-09) — findings integrated below

---

## Executive summary

| Issue | Goal | Problem today |
|-------|------|---------------|
| **UI mismatch** | One scroll axis; UI font size everywhere; tray matches Cursor chrome | Double scroll on tray body; hardcoded `14px`; min-height 160 vs Cursor 220 |
| **Subagent / plan** | Tray = typed store + **same** tool renderer as chat; no ChatView churn | Parallel `SubagentActivityLine` path; `renderStep` not wired; global tray subscription in ChatView |
| **Turn send** | `parentEntryId` only when server has the entry | Runtime projection can look "committed" before `assistant.complete` lands |

---

## Entry point map (start here)

Use this table to onboard an agent or engineer. Each row is the **first file to open**.

### Cursor production (reference binary)

| # | Council | Cursor symbol / selector | What it does | Multi equivalent |
|---|---------|------------------------|--------------|------------------|
| 1 | Tool renderer | `MRm` → `ToolCallRenderer` | Dispatches `shellToolCall` / `readToolCall` / `taskToolCall` / edit | `tool-renderer.tsx` → `ToolCallRenderer` |
| 2 | Tray DOM/CSS | `.agent-panel-subagent-preview-tray-body__conversation-mask` | `overflow:hidden`; inner `qDp` scrolls | `[data-subagent-tray-body]` — **wrong: scroll on body not inner mask** |
| 3 | Font tokens | `.composer-messages-container` → `--conversation-text-font-size: var(--cursor-font-size-base)`; transcript → `-lg` | Base vs large tiers; tools use `--conversation-tool-font-size` | `--multi-ui-font-size-user` → single `--conversation-text-font-size` (no lg tier) |
| 10 | Subagent nest | `O4b` → `F4b` → `LRm` + `renderStep` → `MRm` | `subagentConversation.turns[].steps` flattened by `NRm` | Flat `SubagentTranscriptItem[]` → ad-hoc `TimelineStep` builders |

### Multi renderer (fix UI here)

| # | Council | Entry file | Symbol / hook | Notes |
|---|---------|------------|---------------|-------|
| 4 | Tray pipeline | `composer/input.tsx` ~2181 | `SubagentTrayStack` mount | Tray lives in composer, not timeline |
| 4 | Tray render | `subagent-tray.tsx` | `SubagentTranscriptItemRow` → `SubagentTimelineStep` → `StepRenderer` | Fallback: `SubagentActivityLine` → `ToolCallLine` (**delete for tools**) |
| 7 | Shared tools | `message/tool-renderer.tsx` | `ToolCallRenderer`, `TaskToolCall` | `renderStep` prop exists but **`tool-message.tsx` does not pass it** |
| 7 | Timeline path | `timeline/step-renderer.tsx` | `ToolCallMessage` / `RuntimeSubagentTaskMessage` | Main chat entry — tray should match |
| 4 | Store ingest | `stores/subagent-activity-store.ts` | `upsertActivities`, `reduceSubagentActivityProjection` | Tray-only; `includeTranscript` when tray open |
| 4 | Event feed | `stores/thread-store.ts` ~344 | `syncSubagentActivitiesForRuntimeEvent` | Orchestration `subagent.*` skipped at `thread-sync.ts` ~3283 |

### Multi ChatView / performance

| # | Council | Entry file | Hot subscription | Fix |
|---|---------|------------|------------------|-----|
| 5 | ChatView | `chat-view.tsx` ~503 | `useSubagentTrayStore(presented)` | Scope to active thread or move click-capture into tray |
| 5 | Timeline | `chat-view.tsx` ~978 | `useThreadTimeline({ workLogEntries, activeRuntimeDisplayTimeline })` | Split runtime tail vs stable committed rows |
| 5 | Activities | `chat-view.tsx` ~832 | `deriveWorkLogEntries(visibleThreadActivities)` | Subagent.* already stripped; runtime frames still reproject timeline |

### Multi desktop / persistence

| # | Council | Entry file | Role |
|---|---------|------------|------|
| 6 | Bootstrap | `desktop/src/main/index.ts` | `DesktopApp.program` → `NodeRuntime.runMain` |
| 6 | Ingestion | `desktop/src/app/desktop-app.ts` | `installRuntimeIngestion` + `installRuntimeHostEventBridge` |
| 6 | Persist | `desktop/src/runtime/runtime-ingestion.ts` | `session-tree` → `assistant.complete` HTTP dispatch |
| 6 | Client merge | `stores/thread-sync.ts` ~566 | `threadFromRuntimeSessionTree` sets `leafId` **before** server echo |
| 9 | Parent gate | `lib/git-agent-parent-entry.ts` | `resolveTurnSendParentEntryId` — may still accept runtime id after local `turn.completed` |

### Plan follow-up

| # | Council | Entry file | Violation |
|---|---------|------------|-----------|
| 8 | Tray UI | `composer/plan-follow-up/plan-follow-up-tray.tsx` | OK — reads committed plan |
| 8 | Send | `chat-view.tsx` `onSubmitPlanFollowUp` | **P2:** dual-write outside single coordinator path |
| 8 | Shell dup | `shell-host.tsx` `startPlanImplementation` | Duplicates plan prompt + `coordinateTurnSend` |
| 8 | Projector | `thread-timeline-projector.ts` | Proposed-plan rows OK |

---

## Council findings (10 agents)

### Agent 1 — Cursor `MRm` / Multi `ToolCallRenderer`

- `MRm` props: `toolCall`, `subagentConversation`, **`renderStep`**, `callId`, `loading`, `hasError`, …
- `conversationDensity` comes from context (`SCe` / `useAgentConversationContext`), not `MRm` props.
- `taskToolCall` → `O4b` (`TaskToolCallView`) — only path that gets `subagentConversation` + `renderStep`.
- `data-tool-status`: `loading|completed|error` on wrapper; hooks in `tool-call.css` (JS-only in Cursor).
- **Multi:** `tool-renderer.tsx` + `tool-message.tsx` + `use-conversation-density.ts`. **Gap:** `renderStep` not passed from `tool-message.tsx`.

### Agent 2 — Tray DOM / scroll

- Cursor preview tray: mask `overflow:hidden`, scroll on inner `qDp` (composer scroll primitive).
- `ui-tray__scroll-area` is for **expanded agent-list tray**, not preview follow-up tray.
- Multi: `[data-subagent-tray-body] { overflow-y: auto }` **and** `SubagentTrayBody` class adds `overflow-y-auto` → double scroll.
- Multi `min-height: 160px`; Cursor `min-height: 220px`.

### Agent 3 — Font pipeline

- Cursor: settings `uiFontSizePx` (11–23) → **window zoom** + CSS aliases to unresolved `--cursor-font-size-base` / `-lg`.
- Scopes: composer bar = base; `.react-composer-transcript-scroll` = lg; glass agent panel promotes messages to lg.
- Multi: direct `--multi-ui-font-size-user` (11–16px) → `text-conversation`. **Gaps:** no base/lg split; no `--conversation-tool-font-size`; hardcoded `14px` new-agent + chips in `conversation.css`.

### Agent 4 — Multi tray call graph

```
runtime/orchestration event
  → thread-store.syncSubagentActivities*
  → subagent-activity-store.upsertActivities (rAF)
  → deriveWorkLogSubagentsFromOrderedActivities
User opens tray: SubagentStatusRow → openTray
Composer: SubagentTrayStack → refreshSubagentActivityProjection(includeTranscript:true)
  → SubagentTranscriptItemRow → StepRenderer (canonical)
  → SubagentActivityLine (fallback — parallel path)
```

**Divergence:** Main chat uses `thread-timeline-projector`; tray uses **parallel store** + local step builders.

### Agent 5 — ChatView subscriptions

- Orchestration `subagent.*` does **not** update `serverThread` (thread-sync ~3283) — good.
- Runtime frames **do** update `activeRuntimeDisplayTimeline` → full `useThreadTimeline` recompute.
- `subagentTrayPresented` is **global** → every ChatView re-renders on tray open/close.
- **Decouple:** `chat-view.tsx:503`, split `serverThread` selector, split timeline memo inputs.

### Agent 6 — Desktop bootstrap

```
main/index.ts → desktop-app.ts
  → installRuntimeIngestion (HTTP assistant.complete)
  → installRuntimeHostEventBridge (IPC to renderer)
Renderer: agent-runtime-store → thread-store.applyRuntimeSessionTreeProjection
Chat: ShellHost → ChatView
```

**Race:** client `leafId` from session-tree IPC is **immediate**; server `leafId` from `thread.message-sent` is **async**.

### Agent 7 — Single render path (recommendation)

**Reuse:** `ToolCallRenderer` + `ToolCallMessage` + `StepRenderer`.  
**Do not use in tray:** `GroupedStepsRenderer`, `SubagentActivityLine` for tools.  
**Do:** extend `extractSubagentTranscriptToolFields` → `artifacts` / `requestKind` for `toToolCall`; route all tool items through `SubagentTimelineStep`.

### Agent 8 — Plan follow-up

- Plan tray + subagent tray stack in `input.tsx` — **layout only**, no data coupling.
- **P2 violations:** `onSubmitPlanFollowUp` dual-write; `shell-host` duplicate implement path; `resolvePlanFollowUpSubmission` duplicated in queue dispatch.

### Agent 9 — Parent entry race (refine prior fix)

- `isCommittedRuntimeAssistantMessage` may still accept runtime projection id when `latestTurn.state === "completed"` **before** server has `thread.message-sent`.
- **Council fix direction:** gate runtime ids until orchestration echo, not only local turn state.
- **Verify:** `git-agent-parent-entry.test.ts` add case: completed local turn, no server entry → must fall back.

### Agent 10 — Cursor nested transcript shape

```
subagentConversation.turns[]
  → steps[] (type: "loaded")
  → NRm flatten → LRm + renderStep → MRm for tool-call steps
```

Multi flat `SubagentTranscriptItem` must project to: `tool-call` (with `toolCall`, `status`, `startedAtMs`, `callId`), `assistant-message`, `thinking`. Needs full tool proto, not label-only `WorkLogEntry`.

---

## Issue 1 — UI mismatch

### Goal

Match Cursor production: one scroll owner, mask dims at 0.45, tray `min(70dvh, max(220px, available))`, typography from user UI font setting on **both** prose and tools.

### Problem

| Symptom | Root cause (council-confirmed) |
|---------|-------------------------------|
| Nested scrollbars | `[data-subagent-tray-body]` + `SubagentTrayBody` both `overflow-y-auto` |
| Wrong text size | `conversation.css` L35–38 chips, L188–195 new-agent = `14px` |
| No tool font tier | Missing `--conversation-tool-font-size` alias |
| Overflow | Flex parents missing `min-h-0`; plan + queue + tray stack in composer |

### Implementation entry (Phase A)

1. `packages/app/src/styles/conversation.css` — mask `overflow:hidden`; single scroll child; `min-height: 220px`; add `--conversation-tool-font-size`
2. `packages/app/src/components/chat/composer/subagents/subagent-tray.tsx` — remove duplicate `overflow-y-auto` on body
3. `packages/app/src/styles/tokens.css` / `index.css` — optional transcript-lg scope on `[data-chat-timeline-scroll]`

---

## Issue 2 — Subagent / plan + ChatView

### Goal (foundation plan P4)

- Main chat: `thread-timeline-projector` only.
- Tray: typed `subagent-activity-store`, **presentational**, same `ToolCallRenderer` + `renderStep` as Cursor `O4b`/`LRm`/`MRm`.
- Plan: all sends through `coordinateTurnSend`.
- No ChatView render loop when tray streams.

### Problem

| Symptom | Root cause (council-confirmed) |
|---------|-------------------------------|
| "Ran" / "(no output)" | `SubagentActivityLine` fallback; thin `WorkLogEntry` without `artifacts` |
| Tray ≠ chat styling | `renderStep` not wired; parallel projection store |
| ChatView churn | `subagentTrayPresented` global; runtime timeline reproject every frame |
| Broken `thread.turn.start` | Runtime leaf ahead of server persistence |
| Plan dual paths | `onSubmitPlanFollowUp` + `shell-host` implement bypass coordinator |

### Implementation entry (Phase B–D)

| Phase | First file to open | Action |
|-------|-------------------|--------|
| B | `session-logic.ts` `extractSubagentTranscriptToolFields` | Emit artifacts matching `toToolCall` |
| B | `subagent-tray.tsx` | Remove `SubagentActivityLine` for tools; all → `StepRenderer` |
| B | `tool-message.tsx` | Pass `renderStep` into `ToolCallRenderer` / `TaskToolCall` |
| C | `chat-view.tsx` ~503 | Remove or scope global tray subscription |
| C | `subagent-activity-store.ts` | Structural sharing on `subagentById` when tray open |
| D | `chat-view.tsx` `onSubmitPlanFollowUp` | Route through `coordinateTurnSend` only |
| D | `shell-host.tsx` | Delete duplicate plan implement; call shared helper |
| 9 | `git-agent-parent-entry.ts` | Require orchestration echo before runtime parent ids |

---

## What we have already done (this branch)

| Area | Change | Files |
|------|--------|-------|
| Parent entry (partial) | `resolveTurnSendParentEntryId`; ChatView uses it for sends | `git-agent-parent-entry.ts`, `chat-view.tsx` |
| Message id format | `runtimeSessionEntryMessageId` | `thread-sync.ts`, `contracts/runtime.ts` |
| Command extraction (partial) | `args.command` / `data.command` in subagent normalize | `session-logic.ts` |
| Hydrate dedup | Once per thread per session | `runtime-turn-dispatch.ts` |
| Store perf (partial) | rAF, cache-only when tray closed | `subagent-activity-store.ts` |
| Tests | Parent entry (7), thread-tree projection | `*.test.ts` |
| Debug (remove later) | `debug-session-log.ts`, tray/store logs | multiple |

**Council note:** parent-entry fix may be **insufficient** until orchestration-echo gating (Agent 9).

---

## Work plan (council-ordered)

### Phase A — Layout + typography (P0 UX)

- [ ] A1 Single scroll: mask hidden overflow; one scroll child (match Cursor `qDp` pattern)
- [ ] A2 Tray min-height 220px; height formula match Cursor CSS
- [ ] A3 Remove hardcoded 14px; add `--conversation-tool-font-size`
- [ ] A4 Flex audit: `data-subagent-followup-tray-stack`, composer stack with plan/queue

**Acceptance:** One scrollbar; Settings UI font updates chat + tray + tools.

### Phase B — Shared tool renderer (P0 product)

- [ ] B1 Wire `renderStep` in `tool-message.tsx` (Cursor `MRm` parity)
- [ ] B2 Harden `extractSubagentTranscriptToolFields` → `artifacts` / tool proto
- [ ] B3 Delete tool path through `SubagentActivityLine`; suppress running logs when transcript exists
- [ ] B4 Optional: group flat items into synthetic `turns[]` for `TaskToolCall` subtitle (`B4b` parity)

**Acceptance:** Bash/read/grep in tray match main chat cards.

### Phase C — ChatView stability (P0 perf)

- [ ] C1 Scope tray `presented` subscription (or move click-capture to composer)
- [ ] C2 Split timeline memo: runtime tail vs committed
- [ ] C3 Structural sharing in `subagent-activity-store` projection
- [ ] C4 Remove debug instrumentation after verification

**Acceptance:** No update-depth errors; tray open does not re-render all ChatViews each tick.

### Phase D — Plan + parent entry (P1)

- [ ] D1 Consolidate plan follow-up to `coordinateTurnSend`
- [ ] D2 Orchestration-echo gate for runtime `parentEntryId` (Agent 9)
- [ ] D3 Add regression test: local turn completed, no server entry → fallback parent

**Acceptance:** Implement plan + follow-up send; no broken-path errors.

### Phase E — Verification

- [ ] `pnpm run typecheck`
- [ ] `vitest` parent-entry, thread-sync, runtime-turn-dispatch
- [ ] Manual tray + font + follow-up send
- [ ] `desktop.log.ndjson`: one hydrate/thread, no depth-exceeded

---

## Cursor bundle grep (repeatable)

```bash
CURSOR_JS="/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js"
CURSOR_CSS="/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.css"

rg -o '.{0,60}function MRm.{0,200}' "$CURSOR_JS" | head
rg -o '.{0,50}function O4b.{0,300}' "$CURSOR_JS" | head
rg -o '.{0,100}subagentConversation.{0,120}' "$CURSOR_JS" | head
rg 'agent-panel-subagent-preview' "$CURSOR_CSS" -o | head -20
rg 'conversation-text-font-size' "$CURSOR_CSS" -o | head -10
```

---

## Definition of done

1. Tray and chat share **`ToolCallRenderer` + `renderStep`** (Cursor `MRm`/`O4b`/`LRm`).
2. Layout/scroll/font match Cursor production behavior.
3. `parentEntryId` valid on **server read model** at send time.
4. ChatView stable with tray open and subagent streaming.
5. Plan follow-up uses **only** `coordinateTurnSend`.
6. Debug logs removed; CI green.

---

## Council agent index

| # | Focus | Agent |
|---|-------|-------|
| 1 | Cursor MRm / Multi ToolCallRenderer | [dcfefe0d](dcfefe0d-f5f6-4f3a-8e34-6ab73a771359) |
| 2 | Tray DOM / scroll CSS | [5902ac3b](5902ac3b-76ea-4686-a434-c021fed99a65) |
| 3 | Font token pipeline | [5dad9efc](5dad9efc-8006-41d6-903f-bd105a549497) |
| 4 | Multi tray call graph | [7686f68a](7686f68a-0d51-439e-9800-524bac843044) |
| 5 | ChatView hot paths | [7c97fdb0](7c97fdb0-a9d5-46eb-820c-ef0b51b9c26f) |
| 6 | Desktop bootstrap / ingestion | [c4fe72d7](c4fe72d7-0a61-4b65-b5d5-d87c57cb4e37) |
| 7 | Shared render path plan | [3727da78](3727da78-1f6b-48f9-993d-8a539e362e00) |
| 8 | Plan follow-up entry | [855c7a58](855c7a58-8a04-405c-b663-0f1fa301f436) |
| 9 | Parent entry race | [367975fc](367975fc-2ab0-438b-9a5f-19cae34f14d2) |
| 10 | Cursor O4b nested steps | [c7ca65aa](c7ca65aa-da3d-4603-ab4c-cead2472887b) |

---

## References

- Foundation: `.cursor/plans/chat_foundation_integrated_7e6834e5.plan.md`
- Architecture: `packages/app/ARCHITECTURE.md`
- Cursor parity comments: `conversation.css`, `tool-call.css`, `desktop-chrome.ts`
