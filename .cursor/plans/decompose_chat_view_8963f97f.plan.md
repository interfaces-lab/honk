---
name: Decompose chat view
overview: Start by extracting the transcript view model from `chat-view.tsx`. Cursor's bundled workbench models transcript layout as message and tool state, not as a plain component split.
todos:
  - id: transcript-model
    content: Define the canonical transcript row envelope in `timeline-rows.ts`, over existing app payload types and current work grouping/subagent behavior.
    status: pending
  - id: transcript-builder
    content: Replace the old timeline-row builder with the canonical transcript builder and pin row order, grouping, sticky IDs, and stable identity in tests.
    status: pending
  - id: transcript-row-renderer
    content: Extract a non-virtual transcript row renderer shared by `MessagesTimeline` and subagent transcript panels.
    status: pending
  - id: transcript-props
    content: Narrow row renderer props around existing app types and transcript envelope metadata; delete obsolete prop shapes.
    status: pending
  - id: timeline-routing
    content: Update `MessagesTimeline` row routing without moving virtualization, sticky rows, measurement, or scroll restore.
    status: pending
  - id: subagent-transcript
    content: Migrate `subagent-preview-tray.tsx` onto the shared transcript row rendering for task and subagent transcript rows.
    status: pending
  - id: transcript-css
    content: Add layout and data-attribute CSS in `conversation.css` and `tool-call.css` based on the extracted row model.
    status: pending
  - id: branch-view-pin
    content: Move branch path helpers into `thread-branch-view.ts` after transcript model work is pinned.
    status: pending
  - id: move-lifecycle-sync
    content: Move existing lifecycle sync component definitions into `chat-view-lifecycle-sync.tsx` without changing key construction.
    status: pending
  - id: extract-pending-input
    content: Move pending user input state, derivations, and handlers into `use-thread-pending-user-input.ts`.
    status: pending
  - id: extract-queue
    content: Move queue-only composer handlers into `use-thread-composer-queue.ts` while leaving core send in `ChatView`.
    status: pending
  - id: extract-branch-worktree
    content: Move branch and worktree toolbar state and handlers into `use-thread-branch-worktree.ts`.
    status: pending
  - id: extract-send
    content: Move core composer send, plan follow-up, and inline edit send paths behind typed send runtime helpers.
    status: pending
  - id: verify-slices
    content: Run targeted unit and browser tests after each slice, then `pnpm run typecheck` after TypeScript changes.
    status: pending
isProject: false
---

# Decompose chat-view.tsx

## Contract to preserve

`[packages/app/src/components/chat/view/chat-view.tsx](packages/app/src/components/chat/view/chat-view.tsx)` owns the route-level chat screen. It must keep server and draft routes working, preserve terminal lifecycle timing, preserve optimistic send and rollback behavior, keep pending user input submission intact, keep branch and worktree setup semantics unchanged, and keep `ComposerInput` prop behavior stable.

`[packages/app/src/components/chat/composer/subagent-preview-tray.tsx](packages/app/src/components/chat/composer/subagent-preview-tray.tsx)` already duplicates transcript rendering. It converts subagent activity and snapshot items into `AssistantMessage`, `HumanMessage`, `ToolCallMessage`, and `ThinkingStatus`, the same component family `ChatView` renders through `[MessagesTimeline](packages/app/src/components/chat/timeline/messages-timeline.tsx)`. Invokable subagent panels should use the same row model instead of carrying a second private renderer.

## Cursor bundle findings

The required Cursor bundle inspection used:

- `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js`
- `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.css`

Cursor Composer uses an outer message layout with `.composer-human-ai-pair-container` and `.composer-rendered-message`. Rows carry useful data attributes:

- `data-message-index`
- `data-message-id`
- `data-server-bubble-id`
- `data-message-role`
- `data-message-kind`
- `data-tool-call-id`
- `data-tool-status`
- `data-tool-has-error`

The inner AI content uses step variants:

- `assistant-message`
- `thinking`
- `tool-call`

Cursor tool cards have richer state than a generic work row. The relevant transferable fields are `toolCall`, `callId`, `loading`, `startedAtMs`, `hasError`, `approval`, `editToolCallDisplay`, `subagentConversation`, `renderStep`, `onNestedToolExpand`, and `defaultExpanded`.

Tool cases include shell, read, grep, glob, ls, edit, delete, task, MCP, web, and fetch variants. Shell has command, output, approval, stop, and expansion states. Task and subagent tools preserve nested turns instead of flattening them into normal assistant text.

Cursor also includes product areas Multi does not support, such as cloud agents, background agents, and send-to-background flows. Treat those props, states, and class names as context, not requirements. Exclude fields like `showBackgroundNudge`, `backgroundNudgeDelayMs`, `onSendToBackground`, cloud-agent status, and background-agent status unless Multi already has matching code.

Relevant CSS found in `workbench.desktop.main.css`:

- `.composer-human-message`
- `.composer-human-message-content`
- `.composer-sticky-human-message`
- `.human-dimmed .composer-human-message`
- `.composer-messages-container`
- `.composer-rendered-message[data-message-role=ai]`
- `.composer-tool-former-message`

Detailed tool card CSS is embedded in the JS bundle with classes like `.ui-tool-call-card`, `.ui-shell-tool-call`, `.ui-task-tool-call`, and `.ui-turn-view`.

## Campsite notes

`campsite` is now registered through `codebase` for `https://github.com/campsite/campsite`.

Campsite separates list orchestration from row rendering. Its thread and comment views derive row groups, timestamps, day headers, and system rows in list owners, then delegate to focused row components. Use that as a guide for the split, not for long-list mechanics. Multi should keep virtualization, measurement, sticky rows, and scroll ownership inside `MessagesTimeline`.

## Target data shape

The current data shape is `ChatViewProps`, plus derived route, thread, project, terminal, branch, and composer state inside one component. The transport and persisted read-model source of truth lives below the app:

- `[packages/contracts/src/orchestration.ts](packages/contracts/src/orchestration.ts)` defines `OrchestrationMessage`, `OrchestrationThreadEntry`, `OrchestrationThreadActivity`, `ThreadMessageSentPayload`, `ThreadTurnStartRequestedPayload`, and `ThreadActivityAppendedPayload`.
- `[packages/server/src/orchestration/Schemas.ts](packages/server/src/orchestration/Schemas.ts)` aliases contract schemas as the server-internal orchestration surface.
- `[packages/server/src/orchestration/ProjectionPipeline.ts](packages/server/src/orchestration/ProjectionPipeline.ts)` projects events into thread messages, entries, proposed plans, activities, sessions, turns, checkpoints, and pending approvals.
- `[packages/server/src/orchestration/ProviderRuntimeIngestion.ts](packages/server/src/orchestration/ProviderRuntimeIngestion.ts)` maps provider runtime events into `OrchestrationThreadActivity` records for tools, approvals, user input, tasks, subagents, plans, setup scripts, and context state.
- `[packages/app/src/types.ts](packages/app/src/types.ts)` adapts the orchestration read model into app-level `Thread`, `ChatMessage`, `ProposedPlan`, and activity arrays.

The transcript model is a UI read model derived from the orchestration read model. It must not invent transport fields or become a second protocol. The target shape has three parts:

- `ChatViewThreadScope` for route, active thread, draft thread, project, git cwd, and identity keys.
- `TranscriptViewModel` for user messages, assistant messages, thinking rows, tool rows, task and subagent rows, proposed plans, working rows, and system rows.
- `ComposerSendSnapshot` plus a local send runtime for outbound composer actions.

Use a flat transcript model with pair metadata. Do not make nested pair rows. Flat rows keep TanStack virtualization and sticky user rows simple. Derive row ids, pair ids, message indexes, tool status, and subagent/task rows from existing `OrchestrationMessage`, `OrchestrationThreadEntry`, `OrchestrationProposedPlan`, and `OrchestrationThreadActivity` data.

## Type ownership

Effect schemas stay in `@multi/contracts` for transport and persistence boundaries. `TranscriptViewModel` is not an Effect schema and should not be exported from contracts. It is an app-internal TypeScript view model built from already validated app read-model data.

Use the existing type chain:

- `@multi/contracts` defines wire and persistence shapes with Effect schemas.
- `packages/app/src/types.ts` adapts orchestration snapshots into `Thread`, `ChatMessage`, and `ProposedPlan`.
- `packages/app/src/session-logic.ts` derives `TimelineEntry`, `WorkLogEntry`, `WorkLogSubagent`, and `SubagentTranscriptItem` from `OrchestrationThreadActivity`.
- `packages/app/src/components/chat/timeline/timeline-rows.ts` should derive `TranscriptViewModel` from those app shapes.

Do not import server projection row types into the app. Do not hand-write duplicates of `OrchestrationMessageRole`, activity kind literals, tool item types, or provider snapshot payloads. Import branded IDs and contract enums when needed, and compose existing app types for row payloads.

## Canonical migration rule

This work is unreleased. Do not preserve old transcript APIs for compatibility. Pick the canonical row envelope, migrate every caller in the same wave, and delete the old `MessagesTimelineRow` names, adapters, and compatibility branches once the canonical builder is in place. Keep behavior pinned, but do not keep parallel old and new shapes.

```ts
type TranscriptViewModel = {
  rows: TranscriptRow[];
  stickyRowIds: readonly string[];
};

type TranscriptRow =
  | { kind: "user-message"; id: string; pairId: string; messageIndex: number; createdAt: string; message: ChatMessage }
  | { kind: "assistant-message"; id: string; pairId: string; messageIndex: number; createdAt: string; message: ChatMessage }
  | { kind: "thinking"; id: string; pairId: string | null; createdAt: string; thinking: ThinkingView }
  | { kind: "work-group"; id: string; pairId: string | null; createdAt: string; workGroup: WorkGroupView }
  | { kind: "tool"; id: string; pairId: string | null; createdAt: string; workEntry: WorkLogEntry }
  | { kind: "tool-summary"; id: string; pairId: string | null; createdAt: string; workEntry: WorkLogEntry }
  | { kind: "task"; id: string; pairId: string | null; createdAt: string; workEntry: WorkLogEntry }
  | { kind: "subagent-activity"; id: string; pairId: string | null; createdAt: string; activity: ActivityLineView }
  | { kind: "proposed-plan"; id: string; pairId: string | null; createdAt: string; proposedPlan: ProposedPlan }
  | { kind: "working"; id: string; pairId: string | null; createdAt: string | null }
  | { kind: "system"; id: string; pairId: string | null; createdAt: string; text: string };
```

This must be the canonical union, not a compatibility layer. Represent current Multi behavior before trying to clean up the model. Carry adjacent work grouping, grouped duration, grouped summary, preview rows, expansion identity, tool-summary rows, subagent status rows, subagent activity lines, and snapshot loading, error, empty, cap, and merge behavior.

## Props to extract

Do not start by inventing `UserMessageView`, `AssistantMessageView`, `ToolView`, and `TaskView` field bags. Those would duplicate `ChatMessage`, `WorkLogEntry`, and `ProposedPlan`.

The first model slice should keep payloads as existing app types:

- `ChatMessage` for user, assistant, and system rows.
- `WorkLogEntry` for thinking, tool, tool-summary, task, work-group, and subagent rows.
- `ProposedPlan` for proposed-plan rows.
- `SubagentTranscriptItem` and provider snapshot adapter output for subagent preview transcript rows.

Local transcript fields should be row envelope or layout metadata only. Examples include `id`, `pairId`, `messageIndex`, `stickyRowIds`, `data-message-kind`, and `data-tool-status`.

Render-time interaction fields stay outside the pure builder. Examples include `canEdit`, `isEditing`, `editDisabled`, `isServerThread`, `markdownCwd`, `projectRoot`, expansion state, and subagent preview-open state.

`WorkGroupView` should carry `groupedEntries`, `tone`, `durationStart`, `durationMs`, `isRunning`, `summary`, preview row state, and expansion identity. Do not flatten existing groups into independent tool rows in the first slice.

Do not add Cursor-only cloud or background-agent props to any `*View` type. The view model should preserve Multi's current shipped states. Cursor-only fields belong in the investigation notes, not in implementation types.

Do not duplicate orchestration transport types by hand. Prefer deriving view fields from `Thread["messages"]`, `Thread["entries"]`, `Thread["proposedPlans"]`, `Thread["activities"]`, and `Thread["latestTurn"]`, which already come from the server orchestration projection. If a view field cannot be traced back to those shapes, it does not belong in the first transcript model slice.

## Chosen decomposition

I compared three splits. Composer-first removes the hardest logic first, but risks changing `sendInFlightRef`, optimistic message ordering, and composer restore behavior. Lifecycle-first is safer, but mostly moves definitions and does not reduce the main file quickly. Transcript-first matches Cursor's architecture and removes the duplicated subagent transcript renderer.

Use this sequence:

1. Define the canonical transcript row envelope in `[timeline-rows.ts](packages/app/src/components/chat/timeline/timeline-rows.ts)`. Do not route UI yet. Treat app `Thread`, `TimelineEntry`, and `WorkLogEntry` as the input contract.
2. Replace `deriveMessagesTimelineRows()` with the canonical transcript builder, using `pairId`, `messageIndex`, role, kind, tool status, work grouping, sticky ids, and stable row identity derived from app data that comes from the server orchestration projection.
3. Add characterization tests for row order, row ids, `stickyRowIds`, system-message handling, proposed plans between turns, adjacent thinking and tool grouping, running-to-completed work updates, grouped summaries, `working-indicator-row`, unchanged row references, streaming assistant text, and reordered rows.
4. Update `[messages-timeline.tsx](packages/app/src/components/chat/timeline/messages-timeline.tsx)` row routing while preserving virtualization, sticky user rows, measurement, and scroll restore. Remove old row-shape handling in the same step.
5. Extract a non-virtual transcript row renderer that `MessagesTimeline` can call inside the virtual row and `SubagentPreviewTray` can call without importing virtualizer behavior.
6. Narrow row renderer props around existing `ChatMessage`, `WorkLogEntry`, `ProposedPlan`, and transcript envelope metadata. Do not introduce new field bags that restate orchestration or work-log payloads. Delete obsolete prop shapes rather than layering aliases around them.
7. Migrate `[human-message.tsx](packages/app/src/components/chat/message/human-message.tsx)`, `[assistant-message.tsx](packages/app/src/components/chat/message/assistant-message.tsx)`, and `[tool-message.tsx](packages/app/src/components/chat/message/tool-message.tsx)` to extracted view props.
8. Update `[subagent-preview-tray.tsx](packages/app/src/components/chat/composer/subagent-preview-tray.tsx)` so activity and snapshot transcript rows use the shared non-virtual row renderer.
9. Add data attributes matching the Cursor evidence only where Multi already has the underlying state. Use `data-message-index`, `data-message-id`, `data-message-role`, `data-message-kind`, `data-tool-call-id`, `data-tool-status`, and `data-tool-has-error` when they map directly. Do not add cloud-agent or background-agent attributes.
10. Add layout CSS in `[conversation.css](packages/app/src/components/chat/conversation.css)` and `[tool-call.css](packages/app/src/components/chat/message/tool-call.css)`. Keep Tailwind utilities on elements or variants. Do not create broad decorative class buckets or copy Cursor class names for unsupported features.
11. Move pure branch path helpers from `[chat-view.tsx](packages/app/src/components/chat/view/chat-view.tsx)` into `[thread-branch-view.ts](packages/app/src/components/chat/view/thread-branch-view.ts)`.
12. Move the existing sync component definitions into `[chat-view-lifecycle-sync.tsx](packages/app/src/components/chat/view/chat-view-lifecycle-sync.tsx)`. Keep the `chatViewLifecycleSync` JSX and all keys in `ChatView` for now.
13. Extract pending user input into `[use-thread-pending-user-input.ts](packages/app/src/components/chat/view/use-thread-pending-user-input.ts)`.
14. Extract queue-only composer helpers into `[use-thread-composer-queue.ts](packages/app/src/components/chat/view/use-thread-composer-queue.ts)`.
15. Extract branch and worktree toolbar wiring into `[use-thread-branch-worktree.ts](packages/app/src/components/chat/view/use-thread-branch-worktree.ts)`.
16. Extract the core send path last into `[use-thread-composer-send.ts](packages/app/src/components/chat/view/use-thread-composer-send.ts)`.

## Throughput checkpoint

The smallest meaningful slice is steps 1 through 3. After that slice, the canonical model and builder exist, and tests pin row order, row identity, grouping, sticky ids, and streaming updates. The UI still uses the existing routing.

The second checkpoint is step 4. After that slice, `MessagesTimeline` still owns virtualization, sticky user rows, measurement, and scroll restore, but it routes explicit transcript rows instead of raw `message`, `work`, `proposed-plan`, and `working` rows.

The third checkpoint is steps 5 through 8. After that slice, `SubagentPreviewTray` no longer owns private assistant, human, thinking, and tool row components. It passes normalized rows into the same non-virtual row renderer used by the main timeline.

Only proceed to branch helpers, lifecycle sync, and composer extraction after the transcript checkpoints pass.

## Verification

Run targeted tests from `packages/app` after each slice:

- `pnpm run test -- src/components/chat/timeline/timeline-rows.test.ts`
- `pnpm run test -- src/components/chat/view/thread-lifecycle.test.ts src/components/chat/view/branch-selection.test.ts src/components/chat/view/thread-branch-view.test.ts`
- `pnpm run test -- src/components/chat/composer/subagent-preview-tray.test.ts`
- `pnpm run test:browser -- src/components/chat/view/chat-view.browser.tsx`

Add or preserve checks for bottom-follow on append, scroll restore by `timelineCacheKey`, sticky user row behavior, measurement reuse after row model changes, subagent activity transcript parity, snapshot transcript parity, duplicate snapshot coalescing, full message text preservation, command rows without duplicate bodies, and placeholder filtering.

After substantive TypeScript changes, run `pnpm run typecheck` from `packages/app`. For composer send extraction, also run `[chat-view-inline-edit.browser.tsx](packages/app/src/components/chat/view/chat-view-inline-edit.browser.tsx)` and `[chat-view-plan-workbench-route.browser.tsx](packages/app/src/components/chat/view/chat-view-plan-workbench-route.browser.tsx)`.

## Notes behind the plan

- The useful split is by data ownership: `TranscriptViewModel`, `ChatViewThreadScope`, and `ComposerSendSnapshot`.
- `MessagesTimeline` keeps virtualization and scroll ownership. `timeline-rows.ts` owns transcript derivation.
- Row components should receive view props, not raw session records plus hidden store state.
- Cursor parity matters for transcript quality only. Cloud agents, background agents, and send-to-background flows stay out unless Multi ships those features.
- Reuse Effect-derived contract types through existing app projections. Keep `TranscriptRow` as a thin TypeScript routing union, not a new Effect schema or frontend copy of backend transport types.
- This work is unreleased, so the migration should converge directly on the canonical transcript shape and delete old row APIs instead of keeping compatibility shims.

