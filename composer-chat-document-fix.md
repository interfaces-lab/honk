# Composer chat document fix plan

Plan for fixing the remaining composer chat/document rendering mismatches in Multi.

Last verified: 2026-05-28.

## Priority dependency

`.cursor/plans/decompose_chat_view_8963f97f.plan.md` is the higher-priority implementation plan. Do not modify that plan from this document.

This document is now a bug/parity addendum for the decomposition work. Route transcript rendering work through the shared transcript extraction in that plan:

- `packages/app/src/components/chat/transcript/transcript-view.tsx`
- `packages/app/src/components/chat/transcript/transcript-view-model.ts`
- `packages/app/src/components/chat/timeline/messages-timeline.tsx`
- `packages/app/src/components/chat/composer/subagent-preview-tray.tsx`

Do not keep adding private rendering logic to `subagent-preview-tray.tsx`. The tray should become a consumer of `TranscriptView`, not a parallel transcript renderer.

## Current state

Subagent integration is already present. Do not redo it.

Existing pieces:

- `packages/app/src/stores/subagent-preview-store.ts` keeps subagent preview focus and presentation state.
- `packages/app/src/components/chat/composer/subagent-preview-tray.tsx` already reuses `AssistantMessage`, `HumanMessage`, and `ToolCallMessage`.
- `packages/app/src/stores/subagent-preview-store.ts` hides low-level `subagent.*` item/delta noise once a canonical transcript exists.
- `packages/app/src/session-logic.ts` already derives subagents from thread activities and attaches them to parent work entries.
- Work grouping, command grouping, and orchestration UI coalescing have already been extracted or restored in the codebase. Do not put broad "restore grouping" or "restore tray" tasks back into this plan.

The remaining issue is narrower. The subagent panel still passes transcript and snapshot items through a lossy private adapter before rendering tools. That can make the panel differ from the main chat view, especially for file-read tools, Shiki-highlighted code, and duplicate provider events.

The fix belongs in the shared transcript model from the decomposition plan, not in another private subagent renderer.

## Cursor bundle notes

Reference files:

- `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js`
- `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.css`

The bundle is minified and mostly single-line, so byte offsets are the useful anchors.

### Message shell

Cursor uses one rendered-message shell for composer bubbles:

- JS `@35205884` `KB1`: per-bubble composer renderer.
- JS `@35215836`: class `relative composer-rendered-message hide-if-empty composer-message-blur`.
- The wrapper writes `data-message-index`, `data-message-id`, `data-server-bubble-id`, `data-message-role`, `data-message-kind`, `data-tool-call-id`, `data-tool-status`, `data-tool-has-error`.

Supported message kinds:

- `human`
- `assistant`
- `thinking`
- `tool`
- `background-composer`

Multi should keep one transcript contract that different views can host. The shared `TranscriptViewModel` should carry enough message and tool data for both `MessagesTimeline` and invokable subagent panels.

### Step grouping

Cursor converts AI bubbles into steps, groups them, then renders steps:

- JS `@34409759` `z01`: builds AI render steps.
- JS `@34410882` `V01`: calls grouped-step logic.
- JS `@3291784` `nmd/groupSteps`: grouping state machine.
- JS `@3287442` `aXg/isStepGroupable`: decides whether a step can join a group.
- JS `@3288337` `mXg/conflictsWithPendingActivityGroup`: splits shell/edit/non-shell groups by density.
- JS `@3303769` `DXg/StepGroupSummaryView`: renders grouped summary state.
- JS `@3306794` `smd/GroupedSteps`: grouped step renderer.

Important options:

- `groupThinking: true`
- `groupText: true`
- `textMaxLength: 100`
- `textMaxLines: 2`
- `minGroupSize`
- `separateShellGroups`
- `isToolGroupable`
- `shouldDrop`
- `isCompleted`

This is reference behavior only. Multi already has grouping work in progress, and the chat-view decomposition plan owns the shared transcript shape. Use these anchors only as evidence when a parity bug is specifically about grouping.

### One-line tool row

Cursor's ideal tool row is a one-line trigger:

- JS `@3146314` `G$`: renders `.ui-tool-call-line`.
- Props: `action`, `details`, `loading`, `onClick`, `className`.
- Clickable rows get `role="button"`, `tabIndex=0`, Enter/Space handling, and `.ui-tool-call-line--clickable`.

Task/subagent specializes that one-line row:

- JS `@3502466` `a6r`
- JS `@3503218` `_hd`
- JS `@3503505` `Hsv`
- JS `@3504311` `jsv`: task card/detail renderer.

For Multi, the subagent row in chat should stay a compact one-line trigger. Opening it should reveal the floating panel. The floating panel should render through the shared transcript renderer from the decomposition plan.

### Async subagent notification and panel trigger

Cursor parses async subagent notifications separately from tool rendering:

- JS `@26308638` `gfC`: field parser.
- JS `@26309452` `HLi`: accepts only subagent notifications with task id.
- JS `@26309751` `Vqn`: suppresses empty or aborted notifications.
- JS `@34610426` `Hx1`: async subagent response card.
- JS `@34408563` `G01` and `@34408284` `zlf`: open/focus behavior.
- JS `@59232728` `openSubagentPreviewInAgentsTray`: Glass tray open request.
- JS `@34616313` `ro_`: emits `agent_id=...` and `agent_name=...`.

Relevant parsed shape:

```ts
{
  kind: "shell" | "subagent";
  status: "success" | "error" | "aborted" | "unknown";
  task_id: string;
  title?: string;
  output_path?: string;
  detail: string;
}
```

Multi does not need to copy this protocol. The useful behavior is a compact chat row, panel open keyed by stable agent identity, and panel content rendered through the shared transcript renderer.

### Tool rendering props

Cursor derives a one-line summary first, then chooses body/card rendering when needed:

- JS `@3280897` `Ydd`: summary dispatcher for tool calls.
- JS `@3288793` `IEh`: group metadata extraction.
- JS `@3300373` `EXg`: activity group display info.
- JS `@3462k` `uee`: generic one-line wrapper.
- JS `@3473k` `bhd`: shell block renderer.
- JS `@3493k` `QRs`: approval/blocking card renderer.
- JS `@3500k`: MCP body/result renderer.

Important tool fields:

- Read: `readToolCall.args.path`, line span, output.
- Grep/search: `grepToolCall.args.pattern`, optional path.
- Shell: `shellToolCall.args.command`, output, approval status, running state.
- Edit: path, before/after content, diff stats.
- MCP: server/provider id, tool name, parameters, text result, image result, UI resource.
- Dismissed states: `skipped`, `rejected`, `cancelled`.

For Multi, this means `TranscriptViewModel` rows must preserve enough payload to let the shared transcript renderer choose the same tool rendering path for main chat and subagent panels.

### CSS map

Composer message CSS:

- CSS `@651703` `.composer-bar,.composer-messages-container`: conversation variables.
- CSS `@652291` `.composer-messages-container`: insets and debug vars.
- CSS `@652654` glass-mode message overrides.
- CSS `@652988` `.composer-message-group:has(+.composer-message-group)`.
- CSS `@653959` `.composer-message-group,.composer-message-group .composer-message-group`.
- CSS `@654080` AI `.composer-tool-former-message` margin.
- CSS `@654216` inline tool row zero-margin.
- CSS `@654559` nested inline/shell zero-margin.

Subagent notification CSS:

- CSS `@660880` quote row sizing.
- CSS `@661053` quote bubble chrome.
- CSS `@661815` `.composer-async-subagent-task-notification`.
- CSS `@662395` `.composer-async-subagent-response-card`.
- CSS `@662680` hidden `Open` hint.
- CSS `@663387` reveal `Open` on hover/focus.
- CSS `@663993-666216` cloud actions and compact markdown detail.

Tool CSS:

- CSS `@658758` `.composer-tool-call-simple-layout`.
- CSS `@698859` `.composer-tool-call-container`.
- CSS `@714088` `.mcp-tool-result-scroll-container`.
- CSS `@714703` `.mcp-tool-result-preformatted`.

Markdown/code CSS:

- CSS `@503852` `.vs-markdown-container .rendered-markdown code`.
- CSS `@504047` `.vs-markdown-container .rendered-markdown pre`.
- CSS `@380076` `.chat-tool-hover .monaco-tokenized-source`.

Shiki is not in the static CSS file. Shiki variables and token output are injected from JS:

- JS `@9712671` and `@52877689`: `css-variables` Shiki theme.
- JS `@52973368`: HAST output creates `<pre class="shiki"><code><span class="line"><span style=...>`.
- JS `@53040752`: `tokenizeStructuredSync`.
- JS `@53052778`: token spans get `style={{ color: token.color }}`.
- JS `@16894733`: `.markdown-root` defines `--shiki-foreground`, `--shiki-background: transparent`, and token variables.
- JS `@16324617`: `.ui-shell-tool-call__command` defines Shiki variables for command rendering.
- JS `@16329948`: `.ui-shell-tool-call__output` sets output background and tertiary text.

## Repro inputs

Use these logs when validating fixes:

- Broken subagent: `/Users/workgyver/.multi/dev/logs/provider/025faa85-e3a7-4b95-9a6f-5c1280a440fc.log`
- Duplicated messages: `/Users/workgyver/.multi/dev/logs/provider/207335f9-ed95-4280-bf95-04ee39a69cce.log`

Observed from the broken subagent log:

- Child thread events can appear before parent metadata is complete.
- The parent task can briefly report `agentsStates` as `pendingInit`.
- Later parent-linked `subagent.thread.state.changed` and `subagent.content.delta` events are present.
- UI should tolerate early partial parent metadata and update once stable `providerThreadId` / parent item linkage arrives.

Observed from the duplicated-message log:

- The provider log intentionally contains raw protocol, decoded protocol, native events, and canonical events.
- UI duplication should be judged after canonical ingestion, not by counting provider log lines.
- Suspicious real duplication comes from streamed assistant chunks without stable item ids and append-only ingestion keyed too broadly.

## Current Multi gap

The panel currently renders through the same component family, but it owns private row conversion first:

- `packages/app/src/components/chat/composer/subagent-preview-tray.tsx`
- `subagentTranscriptItemToWorkEntry`
- `subagentSnapshotItemToWorkEntry`

Those functions preserve:

- `text`
- `command`
- `rawCommand`
- `output`
- `title`
- `itemType`
- `toolCallId`
- `status`

They do not consistently preserve:

- `artifacts`
- `changedFiles`
- original payload/data
- read-file path metadata
- truncated metadata
- MCP result structure
- diff stats and before/after content

That loss is enough to make the floating panel render a different file-read component than the main chat view.

Avoid:

- Expanding the private adapter inside `subagent-preview-tray.tsx` as the long-term solution.
- Adding subagent-only render components for file reads, search results, MCP results, or command output.
- Making `MessagesTimeline` and `SubagentPreviewTray` normalize transcript rows independently.

Do this:

- Extract the shared transcript renderer first, as specified by `.cursor/plans/decompose_chat_view_8963f97f.plan.md`.
- Make subagent panels pass normalized rows into `TranscriptView`.
- Ensure `TranscriptViewModel` preserves the tool payload/artifact fields required for exact chat/panel parity.

## Target behavior

### Chat row

Subagent chat row should be a compact trigger:

- one line
- stable label
- current status
- opens floating panel
- no duplicated transcript content in the top-level timeline

### Floating panel

Floating panel should render the exact same logical messages as chat:

- assistant rows through the shared transcript renderer
- user rows through the shared transcript renderer
- tool rows through the shared transcript renderer
- file reads through the normal file-read artifact/component
- markdown/code through the same `ChatMarkdown` path
- no separate long-term `SubagentActivityLine` fallback for tool items that can be represented as real transcript rows

### Logs

Provider logs can contain multiple lanes. UI should only render canonical logical messages:

- raw protocol events are diagnostics
- native provider events are diagnostics unless converted to canonical activities
- canonical activities should collapse by stable ids
- deltas should append only once per stable stream key

## Implementation plan

### P0: Shared transcript payload parity

Goal: make the decomposition plan's shared `TranscriptViewModel` preserve the same tool payload shape for main chat and invokable subagent panels.

Work:

- During the `shared-transcript-view` slice, define transcript tool rows that can carry original payload/data where available.
- Populate `changedFiles` for file-read rows from payload path fields, snapshot args, or provider item data.
- Populate file-read artifacts using the same semantics as `extractToolReadArtifact`.
- Preserve command artifacts for `command_execution` instead of only `command` and `output`.
- Preserve search artifacts for `file_search` instead of flattening to `detail`.
- Preserve MCP result structure, diff stats, and before/after content when present.
- Keep `subagent-preview-tray.tsx` as a consumer of shared transcript rows, not the owner of a private transcript renderer.

Acceptance:

- A file-read tool in the main chat and in the floating subagent panel render the same component.
- The panel shows read path, output, partial/truncated state, and code coloring the same way as chat.
- No new subagent-only file-read component is introduced.
- `subagent-preview-tray.tsx` no longer owns private assistant/human/tool row renderers after the decomposition slice lands.

Primary files:

- `packages/app/src/components/chat/transcript/transcript-view.tsx`
- `packages/app/src/components/chat/transcript/transcript-view-model.ts`
- `packages/app/src/components/chat/composer/subagent-preview-tray.tsx`
- `packages/app/src/components/chat/timeline/messages-timeline.tsx`
- `packages/app/src/session-logic.ts`
- `packages/app/src/components/chat/message/tool-message.tsx`
- `packages/app/src/components/chat/message/tool-renderer.tsx`

### P1: Deduplicate canonical message streams

Goal: remove visible duplicated messages without hiding valid repeated provider diagnostics.

Work:

- Inspect `packages/server/src/provider/acp/AcpRuntimeModel.ts` for ACP assistant chunks that lack stable `itemId`.
- Inspect `packages/server/src/orchestration/ProviderRuntimeIngestion.ts` assistant delta buffering keys.
- Ensure assistant stream buffers key by stable `itemId` when present, else a provider turn/message id, not per event id.
- Collapse tool lifecycle rows by stable `payload.itemId` / `toolCallId`.
- Keep provider event log lanes intact; do not "fix" duplication by dropping diagnostic provider log entries.

Acceptance:

- The duplicated-message log does not produce duplicate visible assistant text in the UI.
- Provider diagnostic logs still include raw/native/canonical events.
- Tool lifecycle updates still progress one visible row instead of producing multiple rows.

Primary files:

- `packages/server/src/provider/acp/AcpRuntimeModel.ts`
- `packages/server/src/orchestration/ProviderRuntimeIngestion.ts`
- `packages/app/src/session-logic.ts`
- `packages/app/src/environments/runtime/service.ts`

### P2: Shiki color parity

Goal: code blocks and tool code output use theme-safe CSS-variable tokens.

Cursor model:

- Token colors are CSS variables, not concrete theme hex values.
- `--shiki-background` is transparent.
- Container owns block background.
- Generic markdown `pre/code` rules do not override token span colors.

Work:

- Define `--shiki-foreground`, `--shiki-background: transparent`, and token variables on Multi chat markdown/code containers.
- Ensure token spans keep their Shiki-provided `color`.
- Remove or narrow generic `.chat-markdown ... pre` / `code` color overrides that fight Shiki spans.
- Keep code block background on the container, not the Shiki theme.

Acceptance:

- Shiki highlighted code in assistant markdown matches tool/read code colors.
- Light/dark themes do not require re-tokenizing with hard-coded colors.
- Plain fallback code still has readable foreground/background.

Primary files:

- `packages/app/src/components/chat/markdown/chat-markdown.tsx`
- `packages/app/src/styles/markdown.css`
- `packages/app/src/components/chat/message/tool-renderer.tsx`
- `packages/app/src/styles/tool-call.css`

### P3: One-line subagent trigger polish

Goal: keep the top-level subagent row compact while the panel body moves to `TranscriptView`.

Work:

- Keep the top-level row compact: action, detail/status, loading state, click handler.
- Use stable ids from `providerThreadId`, `threadId`, or `agentId`.
- Do not render the full transcript in the top-level timeline.
- Keep the existing preview store; only adjust data passed to it if needed.
- Do not reintroduce snapshot polling as the active-run primary path.
- Do not add this as a separate implementation slice before `.cursor/plans/decompose_chat_view_8963f97f.plan.md` reaches the shared transcript checkpoint.

Acceptance:

- Clicking the row opens the same focused subagent panel after composer collapse/reopen.
- Active status updates without duplicate transcript rows.
- The row stays one line unless the existing design explicitly wraps narrow content.

Primary files:

- `packages/app/src/stores/subagent-preview-store.ts`
- `packages/app/src/components/chat/composer/subagent-preview-tray.tsx`
- `packages/app/src/components/chat/timeline/messages-timeline.tsx`
- `packages/app/src/components/chat/timeline/timeline-rows.ts`

## Out of scope

Do not include these in this fix plan:

- Rebuilding subagent focus/store/tray from scratch.
- A second private transcript renderer in `subagent-preview-tray.tsx`.
- Broad Cursor message grouping rewrites.
- Cloud-agent background composer parity.
- Lexical rich text composer migration.
- New panel architecture.
- New provider adapter split.
- Cosmetic card chrome changes unrelated to the listed bugs.

## Verification

Default verifier:

```bash
pnpm run typecheck
```

Targeted checks:

```bash
cd packages/app && pnpm run test -- src/components/chat/composer/subagent-preview-tray.test.tsx
cd packages/app && pnpm exec vitest run src/components/chat/message/tool-message.test.tsx
cd packages/app && pnpm exec vitest run src/environments/runtime/service.threadSubscriptions.test.ts
cd packages/server && pnpm exec vitest run test/orchestration/ProviderRuntimeIngestion.test.ts
```

Manual acceptance:

- Open the broken subagent log and confirm the subagent row opens a stable panel.
- Compare the same file-read item in main chat and subagent panel.
- Confirm no duplicated visible assistant text from the duplicated-message log.
- Confirm Shiki token colors survive in assistant markdown, file-read output, and shell/tool output.
- Collapse and reopen the composer with a subagent selected; the same panel focus should remain.

## File touch order

Follow the priority plan's order first. This document starts at that plan's second checkpoint:

1. `packages/app/src/components/chat/transcript/transcript-view-model.ts`
2. `packages/app/src/components/chat/transcript/transcript-view.tsx`
3. `packages/app/src/components/chat/composer/subagent-preview-tray.tsx`
4. `packages/app/src/components/chat/timeline/messages-timeline.tsx`
5. `packages/app/src/session-logic.ts`
6. `packages/app/src/components/chat/message/tool-message.tsx`
7. `packages/app/src/components/chat/message/tool-renderer.tsx`
8. `packages/app/src/components/chat/markdown/chat-markdown.tsx`
9. `packages/app/src/styles/markdown.css`
10. `packages/server/src/provider/acp/AcpRuntimeModel.ts`
11. `packages/server/src/orchestration/ProviderRuntimeIngestion.ts`
12. `packages/app/src/environments/runtime/service.ts`
