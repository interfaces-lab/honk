# Cursor composer reference

Reference notes for `composer-chat-document-fix.md`. This file captures the Cursor binary evidence and the Multi repo map. Treat byte offsets as version-specific. Re-run the commands before using exact offsets as proof.

Last verified: 2026-05-26.

## Binary assets

| Asset | Path | Notes |
| ----- | ---- | ----- |
| JS | `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js` | Composer, Lexical, TipTap, agent step renderer, tool routers. |
| CSS | `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.css` | Composer, plan, human bubble, and margin-collapse rules. The file is one long line. |
| Embedded CSS | `workbench.desktop.main.js` | Tool stack CSS for `ui-shell-tool-call`, `ui-task-tool-call`, shimmers, and chevrons. |

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

## Tool dispatch notes

Cursor has explicit tool branches for await, edit, delete, shell, task, todos, read, grep, glob, list, semantic search, web search, web fetch, lints, MCP tool discovery, MCP execution, and reflection. The default branch renders a generic `ToolCallLine`.

Useful props from the Cursor shape:

```text
toolCall, callId, loading, startedAtMs, hasError, approval,
editToolCallDisplay, subagentConversation, renderStep,
onFileClick, onUrlClick, onNestedToolExpand,
defaultExpanded, showBackgroundNudge, backgroundNudgeDelayMs
```

Result cases include success, failure, timeout, rejected, spawn error, and permission denied.

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
| Shell labels are too generic. | `shellToolCall` maps to `Running` and `Ran`. |
| Task labels are too generic. | `taskToolCall` maps to `Task` and `Task`. |
| `tool.summary` is semantically wrong. | `ProviderRuntimeIngestion` maps it to `kind: "task.completed"`. |
| Tool lifecycle may not collapse in the UI. | `collapseDerivedWorkLogEntries` keys lifecycle by `entry.id`; verify collapse uses stable `toolCallId` from activity payloads. |
| Rich text is absent from contracts and app messages. | `OrchestrationMessage` and `ChatMessage` only carry `text`. |
| Lexical is not installed in `@multi/app`. | `package.json` has TipTap deps only. |

## CSS notes

Use `conversation.css` for timeline, composer, subagent, bubble, and layout tokens. Use `tool-call.css` for tool line, shell card, task card, shimmer, and embedded Cursor tool-stack parity.

Recommended data hooks:

| Hook | Owner |
| ---- | ----- |
| `data-assistant-work-group` | Work group root. |
| `data-work-group-expanded` | Work group expanded state. |
| `data-work-group-running` | Work group running state. |
| `data-tool-call-line` | Compact tool line. |
| `data-tool-call-line-action` | Tool verb. |
| `data-tool-call-line-details` | Tool details. |
| `data-shell-tool-call` | Shell card root. |
| `data-task-tool-call` | Task card root. |
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
