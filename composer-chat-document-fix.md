# Composer chat parity implementation plan

Plan for matching Cursor's local composer timeline in Multi. Scope is the composer chat surface: timeline, tools, work groups, subagent UI, composer input, and related styles.

Visual and wire-shape reference for Cursor lives in `cursor-composer-reference.md`. Implementation work stays in Multi's orchestration and chat packages.

Last verified: 2026-05-26.

Orchestration checkpoint: `OrchestrationThreadActivity` is the typed activity union. Do not add parallel `Typed*` activity aliases, keyword-based helpers, or provider-runtime event names as composer timeline rows.

## Recent corrections

Three earlier mistakes drove visible regressions. They are fixed; do not reintroduce them.

1. Chrome on task and shell tool calls. Cursor only paints a bordered card on the todos tool. Multi has no todos surface. No tool call should draw a border, fill, or radius. Anywhere chrome existed (the task wrapper, the shell expanded body, the `EditToolCall` body, the metadata block) was stripped back to typography and indentation.
2. Tool message font size pinned to 12px. Cursor renders tool lines and titles at the markdown body size (13px in the audited build). The `font-size` overrides in `tool-call.css` were removed. Tool messages inherit the markdown size.
3. Deleting the subagent preview store and tray in `new-chat`. The "broken card with chrome" the user reported was the missing overlay, not a styling issue on the task card. The store and tray were restored from `main`; the dim mask, click-capture, and CSS were re-wired.

## What matters next

Multi still shows a work-group preview while the run is active, loses subagent focus when the composer collapses, and polls a snapshot during runs instead of streaming `subagent.*` activities. Fix those before rich text parity.

## Data path (what this plan owns)

Composer chat reads **projected thread state**, not a provider SDK. The stack to fix:

```text
packages/server/src/orchestration/
  ProviderRuntimeIngestion.ts   → thread.activity-appended (canonical OrchestrationThreadActivity)
  ProjectionPipeline.ts / ThreadProjection.ts / decider.ts

packages/app/src/environments/runtime/
  service.ts                    → subscribe, coalesceOrchestrationUiEvents, applyOrchestrationEvents
  orchestration-event-effects.ts → batch side effects from orchestration events

packages/app/src/
  session-logic.ts              → deriveWorkLogEntries(activities) → WorkLogEntry[]

packages/app/src/components/chat/
  timeline-rows.ts              → row model (work / message / working / proposed-plan)
  messages-timeline.tsx         → virtualized timeline, WorkGroupSection
  message/tool-renderer.tsx       → tool row chrome
  composer/*                    → input, subagent tray, plan tray
```

Provider drivers under `packages/server/src/provider/` are out of scope for this plan unless orchestration ingestion proves an activity contract gap that only a driver change can fill. Do not list adapter refactors here.

## Canonical activity map

Composer UI reads three local sources:

| Area | Source | UI owner |
| ----- | ------ | -------- |
| Messages | `OrchestrationMessage` and assistant message commands | Human and assistant timeline rows. |
| Work | `OrchestrationThreadActivity` | Work groups, tool rows, task rows, subagent tray data. |
| Composer chrome | Pending approval and user-input state from activities | Approval panels and question flows, not generic work rows. |

Activity kind ownership:

| Activity kind | Target |
| ------------- | ------ |
| `tool.started`, `tool.updated`, `tool.completed` | `WorkLogEntry` tool rows, collapsed by `payload.itemId`. |
| `tool.summary` | Summary work row or group summary; never task completion. |
| `task.started`, `task.progress`, `task.completed` | Thinking/task work rows, collapsed by `payload.taskId`. |
| `subagent.thread.*`, `subagent.item.*`, `subagent.content.delta`, `subagent.usage.updated` | Parent task/subagent tray state, not top-level timeline noise. |
| `approval.*`, `provider.approval.respond.failed` | Pending approval state and stale-request cleanup. |
| `user-input.*`, `provider.user-input.respond.failed` | Pending user-input state and stale-request cleanup. |
| `context-window.updated` | Context window display only. |
| `turn.plan.updated` | Active plan state only. |
| `runtime.error`, `runtime.warning`, `context-compaction`, checkpoint/setup/provider failures | Work or error rows when user-visible. |

## Scope

In scope:

- Timeline rows, tool rows, work groups, subagent UI, composer tray, plan tray, and queued composer.
- Orchestration activity semantics and app derivation from `OrchestrationThreadActivity` (`ProviderRuntimeIngestion`, `session-logic`, runtime `service.ts`).
- Chat components and styles (`conversation.css`, `tool-call.css`, `tokens.css`).
- Later rich text parity with `text` plus `richText`, readonly human bubbles, and an editable in-chat plan body.

Out of scope:

- Cloud agents and background composer as chat.
- `.cloud-readonly` bubbles.
- `plan_mode_build_in_cloud`.
- `ai-background-task-completion-group` rows. Multi should use `work`, `message`, `working`, and `proposed-plan` unless the product adds a matching local concept.
- Provider adapter splits, SDK deltas, or driver-specific parsing.

## Current diagnosis

Multi has three views of agent work that do not share state cleanly:

1. `WorkGroupSection` renders generic `work` timeline rows from `deriveWorkLogEntries`.
2. `SubagentStatusRow` opens the composer preview tray.
3. `SubagentPreviewTray` reads provider thread snapshots on a 2500ms timer instead of streaming from `subagent.*` activities already on the thread.

Cursor models the same area as typed tool rows on a shared `ui-tool-call-line` base, group headers for collapsed summaries, and a separate overlay for the full transcript. None of those tool surfaces draws chrome; only the todos tool gets a border.

What this produces in Multi today: a header that says "Working · 16 steps" while the body shows only the preview tail, a subagent tray that loses its selection when the composer collapses, and tray flicker every 2.5 seconds during active runs.

## Priority plan

| Phase | Scope | Acceptance |
| ----- | ----- | ---------- |
| P0-A | Work groups render all entries when expanded, even while running. Collapsed running state may show a small tail preview. | Expanding "Working · 16 steps" shows 16 rows. |
| P0-B | Split subagent selection from presentation with a `subagentFocus` store and `subagentPresented` state. | Collapse composer, expand again, and the same subagent is still selected. |
| P0-C | Virtualize subagent tray scroll regions. | 100+ subagent steps scroll smoothly. |
| P0-D | Drive subagent transcript from `subagent.*` thread activities, including coalesced `subagent.content.delta`; snapshot poll is reconcile-only. | Steady active runs do not flicker. |
| P0-E | Export one `isCommandWorkEntry` helper from `timeline-rows.ts` and delete the duplicate in `messages-timeline.tsx`. | Command group classification is consistent. |
| P0-F | Extract `coalesceOrchestrationUiEvents` from `service.ts`, then add subscription microbatching for activity bursts. | `service.ts` drops below 1000 lines without behavior changes; activity-heavy runs commit at most once per frame. |
| P1 | Finish work-log derivation from `OrchestrationThreadActivity` (`tool.summary`, stable tool lifecycle collapse, activity noise). | Activity count and work rows match a production-like thread. |
| P2 | Fix shell/task labels and add shell output preview. | Shell rows say `Running command` and `Ran command`. |
| P2-M | Wire chat motion to motion tokens, add reduced-motion handling, and reveal task chevrons on hover. | No shimmer or smooth scroll under reduced motion; chat menus remain instant. |
| P3 | Add extra timeline row kinds only if orchestration already exposes equivalent local activities. | No Cursor cloud-only rows are copied. |
| P4-A | Add Lexical composer input and store `richText` on sent messages. | Send and reopen a thread with text plus rich text intact. |
| P4-B | Add readonly human bubble branches for TipTap docs and Lexical roots. | Cursor-exported Lexical rich text displays without losing plain text. |
| P4-C | Add editable in-chat plan body. | Plans can be edited in the conversation, not only in the tray or workbench. |
| P5 | Audit CSS tokens and tool-former margin collapse. | Tool spacing is pixel-close to Cursor where the local products overlap. |

## P0 details

### Work groups

`WorkGroupSection` currently branches on `isRunning` before `expanded`. That means a running expanded group still renders `WorkGroupPreview`.

Target behavior:

| State | Render |
| ----- | ------ |
| Collapsed and idle | Header plus summary. |
| Collapsed and running | Header plus count, with an optional tail preview capped by entries and height. |
| Expanded and idle | Every `groupedEntries` row. |
| Expanded and running | Every `groupedEntries` row. |

If expanded groups can grow past a few dozen rows, use a nested virtual list or flatten child work rows into the main timeline. Cursor keeps nested rows inside the group, so a nested virtual list is the closer match.

Implementation details:

- `WorkGroupSection` must check `expanded` before the running preview path.
- Pick one collapsed preview cap and test it. Current code uses six entries and a 144px cap; do not leave the plan saying three while the implementation says six.
- Update `estimateTimelineRowSize` when expanded running groups render every child row.
- Keep `expandedWorkGroupIds` stable for the current timeline cache key while new activity rows arrive.
- Update the browser test that currently encodes the bug: expanded running groups should not render `[data-work-group-preview]`.

### Subagent focus

Use one durable selection and derive whether it is visible:

```ts
type SubagentFocus = {
  key: string;
  activeThreadId: ThreadId;
  parentItemId?: string;
  providerThreadId?: string;
} | null;

const subagentPresented =
  subagentFocus !== null &&
  (composerVariant !== "compact" || isDockComposerExpanded);
```

Expected behavior:

| Event | Store | UI |
| ----- | ----- | -- |
| Click a subagent row | Set `subagentFocus`. | |
| Collapse composer | Keep `subagentFocus`. | Hide the tray only. |
| Expand composer | Keep store unchanged. | Show the same tray again. |
| Change thread | Clear `subagentFocus`. | Close the tray. |
| Active run | Append from `subagent.item.*` / `subagent.content.delta` on the thread. | Do not poll snapshot as the primary path. |

### Subagent transcript

Render subagent steps with the same row components used by the main timeline. Do not invent a parallel `SubagentActivityLine` path for long-term display.

Build the tray body from thread activities (`subagent.thread.started`, `subagent.item.started`, `subagent.content.delta`, and related kinds) that `session-logic` surfaces on `WorkLogEntry.subagents`.

Required derivation:

- Coalesce `subagent.content.delta` by `providerThreadId`, `itemId`, `streamKind`, and `contentIndex` or `summaryIndex`.
- Use `payload.providerThreadId` as the primary tray key.
- Use `payload.parentItemId` to connect the subagent back to the parent task tool when present.
- Treat `subagent.thread.*` as header/status metadata when item rows exist.
- Use `getProviderThreadSnapshot` only on open, reconnect, explicit gaps, or terminal reconcile. Do not poll it every 2500ms during an active run.

## P1 details

P1 is orchestration and derivation, not provider code.

### Server: `ProviderRuntimeIngestion.ts`

- Keep `tool.summary` as an `OrchestrationThreadActivity` kind. Do not reintroduce `task.completed` as the summary alias.
- Audit which runtime events become `thread.activity-appended` and whether `payload.itemId` stays stable across `tool.started`, `tool.updated`, and `tool.completed`.
- Treat provider runtime events as adapter output only. Composer should switch on `OrchestrationThreadActivity.kind`, not on provider event names.

### App: `session-logic.ts`

- `deriveWorkLogEntries` and `collapseDerivedWorkLogEntries` must switch on `activity.kind` and collapse tool lifecycle rows on stable `payload.itemId`, not per-activity `id`, so a busy thread does not produce hundreds of visible `tool.updated` rows.
- Confirm subagent lifecycle activities attach to the parent `WorkLogEntry` the timeline and tray both read.
- `tool.summary` must render once and must not increment task/tool lifecycle counts.
- Preserve the current lifecycle collapse behavior for `tool.started` / `tool.updated` / `tool.completed`; extend tests for `tool.summary` instead of rewriting collapse from scratch.

### App: `environments/runtime/service.ts`

- Keep message streaming coalescing in `coalesceOrchestrationUiEvents`.
- Buffer live subscription events per thread and flush on `requestAnimationFrame` or a short frame-sized window.
- Coalesce activity bursts only when the activity has a stable key: tool lifecycle by `payload.itemId`, subagent deltas by the subagent stream key. Do not coalesce approvals, user-input, or plan events.
- Run side-effect derivation on the raw batch before UI coalescing.

## P2 details

Labels should match the tool semantics:

| Tool case | Loading | Completed |
| --------- | ------- | --------- |
| `shellToolCall` | `Running command` | `Ran command` |
| `editToolCall` | `Editing` | `Edited` |
| `deleteToolCall` | `Deleting` | `Deleted` |
| `taskToolCall` | `Working on task` | `Completed task` |

Style tool rows through `tool-call.css` with data attributes already emitted by the React components.

Keep Tailwind for one-off layout. Put cross-cutting tool row, shell, task, shimmer, and margin-collapse rules in CSS.

Add these data hooks as the CSS contract:

| Hook | Owner |
| ---- | ----- |
| `data-shell-tool-call` | Shell tool root. |
| `data-task-tool-call` | Task tool root. |
| `data-tool-summary` | `tool.summary` row. |
| `data-assistant-tool-row` | Work-group tool row wrapper. |

## P4 details

Cursor's live agent composer input is Lexical. Multi's current composer is TipTap. That does not make TipTap wrong for the immediate chat bug, but it does mean true rich text parity needs a separate phase.

P4 should add:

- Optional `richText` to the message contracts and app `ChatMessage`.
- Lexical input that syncs both plain `text` and serialized rich text.
- Readonly bubble routing that handles TipTap `doc`, Lexical `root`, and plain text fallback.
- A plan body editor separate from the composer send path.

Do not start P4 until P0 and P1 are either done or staffed separately. The user-visible broken chat thread is in P0.

## File touch order

Orchestration and runtime (foundation):

1. `packages/server/src/orchestration/ProviderRuntimeIngestion.ts`.
2. `packages/app/src/session-logic.ts`.
3. `packages/app/src/environments/runtime/service.ts`.
4. `packages/app/src/environments/runtime/orchestration-event-effects.ts`.

Chat UI (after P1 semantics are trustworthy):

5. `packages/app/src/components/chat/timeline/timeline-rows.ts`.
6. `packages/app/src/components/chat/timeline/messages-timeline.tsx`.
7. `packages/app/src/stores/subagent-preview-store.ts`.
8. `packages/app/src/components/chat/composer/subagent-preview-tray.tsx`.
9. `packages/app/src/components/chat/composer/input.tsx`.
10. `packages/app/src/components/chat/message/tool-message.tsx`.
11. `packages/app/src/components/chat/message/tool-renderer.tsx`.
12. `packages/app/src/styles/tool-call.css`.
13. `packages/app/src/styles/conversation.css`.

Contracts for P4:

1. `packages/contracts/src/orchestration.ts` for message shape only. The activity contract is already canonical.
2. `packages/app/src/types.ts`.

## Verification

Default verifier:

```bash
pnpm run typecheck
```

Targeted checks by phase:

```bash
cd packages/app && pnpm exec vitest run src/components/chat/timeline/messages-timeline.browser.tsx
cd packages/app && pnpm exec vitest run src/components/chat/timeline/messages-timeline.test.tsx
cd packages/app && pnpm exec vitest run src/environments/runtime/service.threadSubscriptions.test.ts
cd packages/app && pnpm exec vitest run src/environments/runtime/orchestration-event-effects.test.ts
cd packages/server && pnpm exec vitest run test/orchestration/ProviderRuntimeIngestion.test.ts
```

Manual acceptance:

- Expand a running "Working · 16 steps" group and count all rows.
- Collapse and reopen the composer with a subagent selected.
- Watch an active subagent run for tray flicker.
- Confirm `subagent.content.delta` appears in the tray through activity derivation before snapshot reconcile.
- Confirm `tool.summary` renders once and does not complete a task card.
- Confirm shell labels and task labels match the table above.
- Check reduced motion with chat shimmers, tray entry, chevrons, and scroll-to-bottom.

## Reference map

Use `cursor-composer-reference.md` for:

- Cursor binary string locations and CSS selectors (visual parity only).
- Lexical, TipTap, and plan editor source hints.
- Re-grep commands for future Cursor versions.

Do not treat that file as the implementation checklist. This plan's checklist is orchestration, runtime, `session-logic`, and `packages/app/src/components/chat/`.
