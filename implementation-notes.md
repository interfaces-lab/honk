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
