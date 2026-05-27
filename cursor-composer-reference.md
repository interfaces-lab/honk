# Cursor composer reference

Reference notes for `composer-chat-document-fix.md`. This file captures the Cursor binary evidence and the Multi repo map. Byte offsets are version-specific; re-run the commands before citing them.

Last verified: 2026-05-26.

## Corrections since last pass

Two earlier claims in this file and the fix doc were wrong. Both are fixed below.

1. "Task and shell tool cards carry chrome (border, background, radius)." Wrong. Cursor only paints chrome on the todos tool card. Every other tool, including task, shell, edit, read, grep, glob, list, web fetch, search, lints, MCP, renders without a frame. Multi has no todos surface, so no tool call gets chrome. Anywhere chrome was added (task card wrapper, shell expanded body, edit body, metadata block) has been stripped back to typography and indentation only.
2. "Subagent UI is one surface." Wrong. Cursor renders two surfaces. Compact status rows live inline inside the task body. Detailed transcripts live in a separate overlay anchored above the composer. Multi must keep both. The `new-chat` branch deleted the overlay store and tray; that is the "broken card" the user reported, and the store and tray were restored from `main`.

A third misstep was internal: `task-subagent-transcript.tsx` tried to put the full transcript inside the task body. That diverges from Cursor and was removed. The full transcript belongs in the overlay.

## Binary assets

| Asset | Path | Notes |
| ----- | ---- | ----- |
| JS | `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js` | Composer, Lexical, TipTap, agent step renderer, tool routers. |
| CSS | `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.css` | Composer, plan, human bubble, and margin-collapse rules. The file is one long line. |
| Embedded CSS | `workbench.desktop.main.js` | Tool stack CSS for `ui-shell-tool-call`, `ui-task-tool-call`, shimmers, chevrons. Only `ui-todos-tool-call` carries border/fill/radius; everything else is layout and typography. |

There is no separate plan or chat CSS file under `Resources`. Grepping for `composer-human-message` and `composer-create-plan` hits `workbench.desktop.main.css`.

## Verified strings

| String | Location in JS | Role |
| ------ | -------------- | ---- |
| `PromptInputEditor` | line 449 | TipTap prompt surface, not the live agent composer. |
| `PlanEditor` | line 449 | Plan tab body editor export. |
| `RichTextEditor` | line 449 | TipTap rich text editor export. |
| `getSubmitDataFromEditor` | line 6431 | TipTap submit helper. |
| `rich_text` | line 6434 | Protobuf or API field. |
| `lexicalReducerService` | line 44882 | Workbench Lexical reducer service. |
| `LexicalComposer` | line 45644 | Lexical provider. |
| `aislash-editor-input` | line 45654 | Live composer `ContentEditable` class. |
| `composer-lexical-display` | line 46739 | Readonly Lexical human bubble namespace. |
| `bugbotMessageToLexicalRichText` | line 47675 | Minimal Lexical JSON factory. |

Verified CSS strings:

| String | Asset |
| ------ | ----- |
| `composer-human-message` | main CSS |
| `composer-create-plan` | main CSS |
| `aislash-editor-container` | main CSS |
| `aislash-editor-grid` | main CSS |
| `markdown-lexical-editor-container` | main CSS |
| `composer-human-tiptap-readonly-editor` | main CSS |
| `.composer-tool-former-message:has(.ui-tool-call-line,.composer-tool-call-inline,.ui-shell-tool-call)` | main CSS |
| `.ui-shell-tool-call` | embedded JS CSS |
| `.ui-task-tool-call` | embedded JS CSS |
| `.ui-tool-call-line-shimmer` | embedded JS CSS |
| `tool-call-line-shine` | embedded JS CSS |
| `.ui-task-tool-call__chevron` | embedded JS CSS |

The exact embedded CSS byte moved in this Cursor build. `.ui-shell-tool-call` appeared at byte `16319943` during verification. Do not rely on a literal `.ui-shell-tool-call{font-size:14px` search because the embedded stylesheet may include spaces.

## Editor stacks

Cursor has three relevant editor stacks:

| Surface | Editor | Serialized shape |
| ------- | ------ | ---------------- |
| Live agent composer | Lexical `.aislash-editor-input` | Plain `text` plus `richText` as serialized Lexical editor state. |
| Human bubble | TipTap readonly if `richText` is a TipTap `doc`; otherwise Lexical readonly; otherwise plain text. | Stored message `richText`. |
| PromptInputEditor surfaces | TipTap | ProseMirror JSON `doc` through `getSubmitDataFromEditor`. |
| Plan body | TipTap `RichTextEditor` or Lexical markdown editor, depending on surface and flags. | Plan editor content, separate from composer send path. |

Cursor's sync plugin listens to text content changes, stores plain text without ghost text, and stores a rich state for the bubble path. The display router checks whether `richText` parses as a TipTap doc before falling back to Lexical display.

Multi today:

| Area | Multi |
| ---- | ----- |
| Composer input | TipTap `prompt-editor.tsx`. |
| Submit data | `text`, `commands`, and `mentions`. |
| App message type | `ChatMessage` has `text`, not `richText`. |
| Orchestration message | `OrchestrationMessage` has `text`, not `richText`. |
| Package deps | `@tiptap/*` packages are present. `lexical` and `@lexical/react` are not. |

## Cursor timeline model

Cursor does not use a single `MessageRenderer` dispatch. It uses parallel discriminators:

- Virtualized timeline row `kind` for human rows, AI rows, activity groups, synthetic thinking, phase rows, and other chrome.
- Agent activity step `type`, including `assistant-message`, `tool-call`, and `thinking`.
- Tool dispatch on `toolCall.tool.case`.
- Tool result dispatch on `result.case`.
- Bubble type enums for human and AI messages.

Cursor-only row kinds should not be copied into Multi unless Multi has a local product concept for them.

Multi's local discriminator is `OrchestrationThreadActivity.kind`. Composer work
rows should switch on that field. Do not add a second typed activity alias or
route composer code on raw provider runtime event names.

## Tool dispatch notes

Cursor has explicit tool branches for await, edit, delete, shell, task, todos, read, grep, glob, list, semantic search, web search, web fetch, lints, MCP tool discovery, MCP execution, and reflection. The default branch renders a generic `ToolCallLine`.

Chrome rule, from binary audit: only the todos case draws a bordered card. Every other tool, including task and shell, is typography on a transparent background. The collapsed row is `ToolCallLine` (verb, details, optional file/url). The expanded body is indented prose or pre-formatted text, still without a frame. Multi does not render todos, so no tool call should paint a border, fill, or radius.

Useful props from the Cursor shape:

```text
toolCall, callId, loading, startedAtMs, hasError, approval,
editToolCallDisplay, subagentConversation, renderStep,
onFileClick, onUrlClick, onNestedToolExpand,
defaultExpanded, showBackgroundNudge, backgroundNudgeDelayMs
```

Result cases include success, failure, timeout, rejected, spawn error, and permission denied.

## Task tool structure

Reading `wsv` in the JS bundle gives this shape. The wrapper is layout only; no border, fill, or radius.

```text
[data-task-tool-call][data-expanded="true|false"]
  button[data-task-tool-call-header]
    span[data-task-tool-call-status-icon]   // spinner | check | warning | clock
    span[data-task-tool-call-title-area]
      span[data-task-tool-call-title]       // details || action
      span[data-task-tool-call-subtitle]?   // action when details is the title
    IconChevronRightMedium[data-task-tool-call-chevron]
  div[data-task-tool-call-body]             // mounted only when expanded
    {subagentConversation || renderStep(toolCall, 0, callId)}
```

Rules:

- No body, no expander. If `subagentConversation` and `renderStep` are both falsy, render a plain `ToolCallLine`.
- Chevron rotates via CSS on `[data-expanded="true"]`. Do not animate height.
- Title and subtitle are split spans. The subtitle is the muted line.
- Status icon swaps on loading, error, done. Reserve a fixed-width slot so the title baseline does not shift.
- No chrome on the wrapper or body. No hover fill on the header. No divider between header and body.

## Font parity

Cursor renders `ui-tool-call-line` and the task title at the same font size as markdown body text (13px in the audited build). Multi previously overrode tool messages to 12px in `tool-call.css`. The override is gone. Do not reintroduce per-tool `font-size` declarations on `[data-task-tool-call]`, `[data-shell-tool-call]`, or `[data-tool-call-line]`.

## Subagent UI: inline plus overlay

Cursor uses two surfaces for subagent state. Multi matches both.

| Surface | Where | Content |
| ------- | ----- | ------- |
| Inline status rows | Inside the parent task card body | One row per subagent: bullet/avatar, title, model badge, latest update. Clickable. |
| Detailed transcript overlay | Anchored above the composer, dims the timeline behind it | Full subagent transcript, header with back/expand/close, scrollable body. |

Click flow: an inline row opens the overlay focused on that subagent. Collapsing the composer hides the overlay but keeps the selection; expanding the composer shows the same overlay again. Switching threads clears the selection.

Multi wiring after restore:

| Piece | Path |
| ----- | ---- |
| Store | `packages/app/src/stores/subagent-preview-store.ts` |
| Overlay UI | `packages/app/src/components/chat/composer/subagent-preview-tray.tsx` |
| Mount point | `packages/app/src/components/chat/composer/input.tsx` (`SubagentPreviewTrayStack`) |
| Dim mask + click capture | `packages/app/src/components/chat/view/chat-view.tsx` (`[data-subagent-conversation-mask]`, `[data-subagent-preview-click-capture]`) |
| Inline rows | `SubagentStatusSurface` / `SubagentStatusRow` in `tool-message.tsx` |
| CSS | `[data-subagent-conversation-*]`, `[data-subagent-preview-*]`, `[data-subagent-status-*]` in `conversation.css` |

## Wire protocol notes

Primary `agent.v1.InteractionUpdate` arms:

| Field | JS case | Cursor effect | Multi target |
| ----- | ------- | ------------- | ------------ |
| `text_delta` | `textDelta` | Append assistant text. | `content.delta` or streaming assistant message. |
| `thinking_delta` | `thinkingDelta` | Thinking capability bubble. | Reasoning stream. |
| `partial_tool_call` | `partialToolCall` | Early tool row. | `item.started` once per call id. |
| `tool_call_started` | `toolCallStarted` | Running tool row. | `item.started`. |
| `tool_call_delta` | `toolCallDelta` | Update in place by inner delta case. | Parse inner delta and emit `item.updated` or `content.delta`. |
| `tool_call_completed` | `toolCallCompleted` | Finalize tool row. | `item.completed` with merged data. |
| `shell_output_delta` | `shellOutputDelta` | No-op in Cursor main composer adapter. | Command output delta is acceptable in Multi. |
| `summary` | `summary` | Summary bubble or group. | Summary activity, not `task.completed`. |
| `turn_ended` | `turnEnded` | Clear generation state. | Turn complete, not empty text. |

Inner `tool_call_delta` cases to keep distinct:

- `shell_tool_call_delta`.
- `edit_tool_call_delta`.
- `task_tool_call_delta`, which carries nested `interaction_update` for subagents.

## Multi repo map

Frontend:

```text
packages/app/src/components/chat/view/chat-view.tsx
  -> MessagesTimeline in timeline/messages-timeline.tsx
    -> timeline-rows.ts
    -> human-message.tsx
    -> assistant-message.tsx
    -> tool-message.tsx
      -> tool-renderer.tsx

packages/app/src/components/chat/composer/input.tsx
  -> prompt-editor.tsx
  -> subagent-preview-tray.tsx
  -> queued-items-panel.tsx

packages/app/src/session-logic.ts
packages/app/src/styles/conversation.css
packages/app/src/styles/tool-call.css
packages/app/src/styles/tokens.css
```

Server (orchestration only for composer-chat fixes):

```text
packages/server/src/orchestration/ProviderRuntimeIngestion.ts
packages/server/src/orchestration/ProjectionPipeline.ts
packages/server/src/orchestration/ThreadProjection.ts
packages/contracts/src/orchestration.ts
```

## Verified Multi gaps

| Gap | Evidence |
| --- | -------- |
| Running expanded work groups still show preview. | `WorkGroupSection` branches on `isRunning` before `expanded`. |
| Subagent selection is cleared on composer collapse. | `SubagentPreviewActiveThreadSync` calls `closePreview()` when not visible. |
| Subagent tray polls during active runs. | `getProviderThreadSnapshot` repeats every 2500ms while active. |
| Subagent streaming does not read activities first. | `subagent.content.delta` exists in `OrchestrationThreadActivity`, but the tray still reads snapshots. The store and tray UI are restored from `main` after the `new-chat` deletion; the streaming path is still TODO. |
| Shell labels are too generic. | `shellToolCall` maps to `Running` and `Ran`. |
| Task labels are too generic. | `taskToolCall` maps to `Task` and `Task`. |
| Work-log derivation still needs summary handling. | `ProviderRuntimeIngestion` now emits `kind: "tool.summary"`; composer should render it without treating it as task completion. |
| Tool lifecycle collapse depends on stable ids. | `collapseDerivedWorkLogEntries` already collapses lifecycle rows when `payload.itemId` is stable. Verify high-volume updates and `tool.summary`. |
| Activity-heavy runs can churn the store. | Live thread subscription applies most events one at a time. Microbatch activity bursts before re-rendering the expanded UI. |
| Rich text is absent from contracts and app messages. | `OrchestrationMessage` and `ChatMessage` only carry `text`. |
| Lexical is not installed in `@multi/app`. | `package.json` has TipTap deps only. |

Closed since last pass:

| Gap | Resolution |
| --- | ---------- |
| Task tool wrapped its body in a bordered card. | Removed border, fill, and radius from `[data-task-tool-call]`. Cursor's chrome only applies to todos, which Multi does not render. |
| Shell expanded body wrapped command + output in a `bg-multi-editor` card. | Stripped the wrapper; command/output render as prose `pre` blocks with the same font as markdown. |
| Tool messages were rendered at 12px. | Removed the override. Tool lines now inherit the markdown font size. |
| Subagent preview tray and store were deleted in `new-chat`. | Restored `subagent-preview-store.ts` and `subagent-preview-tray.tsx` from `main`. `chat-view.tsx` and `input.tsx` re-mount the overlay; `conversation.css` carries the dim mask, click-capture, container, body, and status-row rules. |
| `task-subagent-transcript.tsx` rendered full transcripts inside the task body. | Deleted. Transcripts belong in the overlay; the task body holds compact status rows and any nested `renderStep` output. |

## CSS notes

Use `conversation.css` for timeline, composer, subagent, bubble, and layout tokens. Use `tool-call.css` for tool line layout, shimmer, chevron rotation, and other typography-level rules. No tool-call rule in this codebase paints a border, fill, or radius.

Recommended data hooks:

| Hook | Owner |
| ---- | ----- |
| `data-assistant-work-group` | Work group root. |
| `data-work-group-expanded` | Work group expanded state. |
| `data-work-group-running` | Work group running state. |
| `data-tool-call-line` | Compact tool line. |
| `data-tool-call-line-action` | Tool verb. |
| `data-tool-call-line-details` | Tool details. |
| `data-shell-tool-call` | Shell tool root (layout only). |
| `data-task-tool-call` | Task tool root (layout only). |
| `data-task-tool-call-header` | Task tool header button. |
| `data-task-tool-call-status-icon` | Task status icon slot. |
| `data-task-tool-call-title-area` | Stacked title + subtitle wrapper. |
| `data-task-tool-call-title` | Task title (`details || action`). |
| `data-task-tool-call-subtitle` | Muted secondary line. |
| `data-task-tool-call-body` | Mounted when `[data-expanded="true"]`. |
| `data-task-tool-call-chevron` | Rotates 90deg via CSS on expand. |
| `data-subagent-status-container` | Inline status rows host. |
| `data-subagent-conversation-shell` | Toggles `[data-subagent-preview-open=""]` to dim the timeline. |
| `data-subagent-conversation-mask` | Dim layer behind the overlay. |
| `data-subagent-preview-click-capture` | Click-outside-to-close hit area. |
| `data-subagent-preview-container` | Overlay frame above the composer. |
| `data-assistant-tool-row` | Timeline tool-row wrapper. |

Cursor motion facts:

| Surface | Timing |
| ------- | ------ |
| Chat hover and bubble transitions | 100ms. |
| Collapsibles and some chevrons | 150ms. |
| Loading shimmers | 2000ms linear infinite. |
| Slash and mention menus | Instant. |
| Task body expansion | Conditional mount, not height animation. |

Multi already has motion tokens in `conversation.css`, not `tokens.css`.

## Re-grep commands

```bash
JS="/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js"
CSS="/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.css"

python3 - <<'PY'
from pathlib import Path
js = Path("/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js")
p = js.read_text(errors="ignore")
for s in (
    "aislash-editor-input",
    "LexicalComposer",
    "lexicalReducerService",
    "composer-lexical-display",
    "rich_text",
    "getSubmitDataFromEditor",
    "PromptInputEditor",
    "PlanEditor",
    "RichTextEditor",
):
    i = p.find(s)
    line = p[:i].count("\n") + 1 if i >= 0 else "missing"
    print(s, i, line)
PY

python3 - <<'PY'
from pathlib import Path
js = Path("/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js").read_text(errors="ignore")
css = Path("/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.css").read_text(errors="ignore")
for name, text in (("js", js), ("css", css)):
    for s in (
        ".ui-shell-tool-call",
        ".ui-task-tool-call",
        ".ui-tool-call-line-shimmer",
        "tool-call-line-shine",
        ".ui-task-tool-call__chevron",
        "instantTransitions",
    ):
        i = text.find(s)
        print(name, s, i)
PY

rg -o '\.[a-z][a-z0-9_-]*' "$CSS" |
  rg '^(composer-human|composer-tool|composer-plan|plan-)' |
  sort -u

rg 'multi-motion-duration|duration-100|duration-150' \
  packages/app/src/components/chat \
  packages/app/src/styles/conversation.css \
  packages/app/src/styles/tool-call.css
```
