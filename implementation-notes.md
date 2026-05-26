# Pi Tree Logic Implementation Notes

## Decisions

- Tree state is normalized in `projection_thread_entries`; `projection_threads.active_entry_id` stores the selected point in the tree.
- Message entries use deterministic ids: `message:${messageId}`. This lets old linear messages backfill without inventing new ids.
- `thread.message-sent` now carries `entryId` and `parentEntryId` when available. Old events remain decodable; projectors fall back to deterministic message entry ids.
- `projection_turns.user_entry_id` records the user entry that started a provider turn, so assistant deltas and completions attach to the correct tree parent even after active navigation changes.
- Provider turns receive an explicit active-path `context` built from the selected branch and excluding the current user message. Adapters prefix that context into the provider prompt text.
- When explicit branch context is sent, the provider session is started without a persisted resume cursor. This avoids stale native linear history conflicting with the selected branch, at the cost of a heavier session restart on branched turns.

## UI Shape

- The whole tree is shown as a thread-scoped side panel next to the message timeline.
- The panel separates selection from navigation: clicking a row selects it, while `Continue from here` pivots the active entry with `thread.tree.navigate`.
- The panel surfaces the active path, sibling branches, child branches, and the whole tree in one place so users can compare alternatives before pivoting.
- The message timeline is now branch-aware: while the tree panel is open, the selected entry previews that branch; when the panel is closed, the timeline follows the active entry.
- Activating a branch clears preview mode and follows the active branch leaf. New sends therefore render linearly at the newest message instead of leaving the chat pinned to the pivot entry.
- Work/activity rows are filtered to the visible branch's turn ids so hidden sibling branches do not leak tool logs into the preview.
- The tree panel uses shell-panel surface and workbench border tokens rather than standalone chat-card colors.
- The tree toggle is configurable through the keybinding system as `threadTree.toggle`; default is `mod+shift+y` outside terminal focus.

## Deferred

- Branch summary rows are supported in the storage and UI shape but not generated yet.
- Label rows are stored as metadata entries and rendered when present, but there is not yet an inline label editing surface.

## Cursor SDK Adapter / Streaming Investigation

### Evidence Inspected

- Latest production thread titled `Verify Cursor SDK Adapter` is `91ec0904-f5ba-4d1e-b600-03c3cf745ac3`, created `2026-05-25T06:39:21.699Z` and updated `2026-05-25T07:11:56.933Z`.
- That thread contains 584 `thread.message-sent` events and 990 `thread.activity-appended` events. Assistant messages stream as many `streaming=true` deltas followed by a final same-message `streaming=false` event with empty text.
- The same thread records 58 `tool.started` / `Ran command started`, 698 `tool.updated` / `Ran command`, and 58 `tool.completed` / `Ran command` activity rows, which explains why an additional group summary line made `Ran` appear more often than Cursor.
- Cursor's bundled workbench exposes `agent.v1.InteractionUpdate` variants including `text_delta`, `partial_tool_call`, `tool_call_delta`, `tool_call_started`, `tool_call_completed`, `summaryStarted`, and `summaryCompleted`.
- Cursor renders shell calls with `Running command` / `Ran command` inside its shell tool row and edit calls with `Editing` / `Edited`; command labels belong on the row, not as a second expanded aggregate line.
- Cursor models git/PR metadata as dedicated tool cases such as `setActiveBranchToolCall`, `prManagementToolCall`, and `editPrLabelsToolCall`, not as terminal output.
- Cursor hides mounted webview containers by setting `opacity=0`, `pointerEvents=none`, and `inert=true`, with visible state controlled by the owning container.
- The installed `@cursor/sdk` exposes `Run.stream(): AsyncGenerator<SDKMessage, void>` and `SDKTaskMessage { type: "task"; status?: string; text?: string }`, so task summaries must be consumed from the run message stream.

### Running Decisions

- Use this existing Markdown notes file rather than adding a separate HTML artifact, to keep the investigation notes close to prior implementation notes without introducing another format.
- Keep Cursor bundle reverse-engineering evidence separate from repo patch decisions. Code changes should wait until the Cursor behavior and the local failure mode agree.
- Spawned five read-only gpt-5.5 medium council agents without full-history forks because the multi-agent tool rejects explicit model overrides when `fork_context` is enabled.
- Cursor SDK summaries are consumed from `Run.stream()` rather than `onDelta`: the installed SDK maps summary updates to `SDKTaskMessage` and the local accumulator suppresses summary deltas.
- Cursor SDK `tool-call-delta` is treated as a running tool update, matching Cursor's incremental tool-call stream shape while still letting the existing lifecycle code emit `item.started` first and `item.updated` afterward.
- Cursor SDK git result metadata is surfaced as a completed `dynamic_tool_call` titled `Git updated`, not a shell `command_execution`, because Cursor models git operations as dedicated tool/metadata cases rather than terminal output.
- Final empty assistant `thread.message-sent` events are kept separate from preceding streaming chunks during app-side UI coalescing. Coalescing them made a partial delta look like authoritative final text and could truncate the live message.
- The subagent preview tray is closed/hidden while the compact composer is collapsed. This follows Cursor's owner-boundary visibility model and avoids leaving the timeline dimmed by an invisible preview.
- Collapsed shell sidebars/workbench panes now use `inert` in addition to `aria-hidden`/pointer suppression so hidden mounted panes cannot remain focusable.
- Expanded command-only work groups no longer repeat the aggregate `Ran N commands` summary above rows that already render each command with the shell `Ran` action.
