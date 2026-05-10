# Tool Call Display Improvements

## Purpose

Improve assistant-side tool-call rendering so the conversation shows useful execution evidence without turning every tool event into raw payload text.

This plan is grounded only in the pi-mono terminal UI implementation at `github:badlogic/pi-mono`, refreshed with `codebase update pi-mono` to commit `e25415dd`.

The target behavior is:

1. One evolving row per tool call lifecycle.
1. A compact row that is useful while collapsed.
1. An expanded body with the best available renderer for the tool.
1. Structured artifacts for diffs, command output, file reads, searches, and diagnostics.
1. Raw payload output only as a fallback.

## TUI Reference Findings

The pi-mono TUI design is the right reference shape:

1. `packages/agent/src/types.ts` defines a small tool lifecycle: `tool_execution_start`, `tool_execution_update`, and `tool_execution_end`. Tools can stream partial results through `AgentToolUpdateCallback`.
1. `packages/agent/src/agent-loop.ts` emits tool-call argument updates as assistant message updates, starts execution by `toolCallId`, streams `partialResult`, and emits the final result before persisting the tool-result message.
1. `packages/coding-agent/src/modes/interactive/interactive-mode.ts` keeps `pendingTools: Map<string, ToolExecutionComponent>`, creates or updates a component as tool-call arguments stream, marks arguments complete on assistant message end, then updates the same component for partial and final tool results.
1. `packages/coding-agent/src/modes/interactive/components/tool-execution.ts` centralizes the shell: it owns expanded state, renderer state, last rendered components, partial/final result state, and fallback output.
1. `packages/coding-agent/src/core/extensions/types.ts` gives each tool definition optional `renderShell`, `renderCall`, and `renderResult` hooks with a `ToolRenderContext` containing `toolCallId`, `args`, `cwd`, `argsComplete`, `isPartial`, `expanded`, and `isError`.
1. Built-in tools use structured details, not raw payloads: bash has truncation and full-output metadata, read has truncation metadata, grep has match/truncation metadata, and edit has diff details.

Important correction: pi-mono TUI edit diffs are not unified patches. `packages/coding-agent/src/core/tools/edit-diff.ts` generates a terminal-oriented line-number diff like `+12 text` and `-12 text`, and `modes/interactive/components/diff.ts` renders that custom format. Multi should not feed that format to `@pierre/diffs`; Multi should keep unified diff as its app-level format.

## Current Shape In Multi

Multi already has the outer shell:

1. `packages/app/src/session-logic.ts` derives `WorkLogEntry` from orchestration activities.
1. `WorkLogEntry` already carries `toolCallId`, `itemType`, `command`, `output`, `detail`, `changedFiles`, and status.
1. `collapseDerivedWorkLogEntries()` already merges `tool.started`, `tool.updated`, and `tool.completed` by `toolCallId`.
1. `packages/app/src/components/chat/tool-call-message.tsx` maps `WorkLogEntry` into `ToolCallModel`.
1. `packages/app/src/components/chat/tool-call-renderer.tsx` already has compact rows, expandable shell output, expandable generic metadata, and expandable edit details.
1. `ToolCallModel` is the canonical renderer boundary for app-local tool artifacts.
1. `packages/app` already uses `@pierre/diffs` for patch rendering in the diff panel and git workbench.

The gap is not the row shell. The gap is that useful structured data is mostly collapsed into strings before the renderer sees it.

Provider/runtime evidence in Multi:

1. `packages/contracts/src/provider-runtime.ts` has `turn.diff.updated` with `{ unifiedDiff }`, but lifecycle items carry only `payload.data: unknown`. There is no contract-level tool display artifact type today.
1. `packages/server/src/provider/CodexAdapter.ts` maps `turn/diff/updated` to `turn.diff.updated`, and maps `item/fileChange/outputDelta` to `content.delta` with `streamKind: "file_change_output"`. That unified diff is turn-level, not per-tool.
1. `packages/server/src/orchestration/ProviderRuntimeIngestion.ts` turns `turn.diff.updated` into checkpoint/diff bookkeeping, while `item.updated`, `item.completed`, and `content.delta` become tool activities that preserve `payload.data`.
1. ACP is the current per-tool structured diff source. `packages/effect-acp/src/_generated/schema.gen.ts` defines tool-call content entries with `{ type: "diff", path, oldText?, newText }`; `packages/server/src/provider/acp/AcpRuntimeModel.ts` preserves those entries in `payload.data.content`.
1. Claude/OpenCode-style file-change output currently arrives as lifecycle data or `file_change_output` text, not as a first-class per-tool unified patch field.
1. Chat rendering already defaults tool rows collapsed: `packages/app/src/components/chat/tool-call-message.tsx` passes `defaultExpanded={false}`, and `EditToolCall` initializes expanded state from that prop.
1. The app has no inline diff size threshold today. `packages/app/src/components/diff-panel.tsx` virtualizes the full diff panel and falls back to raw patch text when parsing fails, but there is no summary-only cutoff in chat rendering.

## Design Principles

1. Preserve one lifecycle row per `toolCallId`.
1. Normalize provider/runtime events before chat rendering.
1. Treat tool output as artifacts, not prose.
1. Keep compact rows useful without expansion.
1. Make expanded bodies renderer-specific but data-model-driven.
1. Keep raw JSON/text fallback for unknown tools and unsafe conversions.
1. Support streaming previews and final results on the same row.

## Proposed Display Model

Add app-local display artifacts to `WorkLogEntry` first. Do not move this into `packages/contracts` until another runtime consumer needs the same shape.

```ts
type ToolDisplayArtifact =
  | ToolDiffArtifact
  | ToolCommandArtifact
  | ToolReadArtifact
  | ToolSearchArtifact
  | ToolDiagnosticArtifact
  | ToolRawArtifact;

type ToolDiffArtifact = {
  type: "diff";
  format: "unified";
  source: "preview" | "result";
  title?: string;
  summary?: string;
  files: Array<{
    path: string;
    additions?: number;
    deletions?: number;
  }>;
  unifiedDiff: string;
  isPreview?: boolean;
};

type ToolCommandArtifact = {
  type: "command";
  command?: string;
  output?: string;
  exitCode?: number;
  durationMs?: number;
  truncated?: boolean;
  fullOutputPath?: string;
  isPartial?: boolean;
};

type ToolReadArtifact = {
  type: "read";
  path?: string;
  output?: string;
  truncated?: boolean;
  isPartial?: boolean;
};

type ToolSearchArtifact = {
  type: "search";
  query?: string;
  output?: string;
  matchedFiles?: string[];
  truncated?: boolean;
  isPartial?: boolean;
};

type ToolDiagnosticArtifact = {
  type: "diagnostic";
  severity: "info" | "warning" | "error";
  message: string;
};

type ToolRawArtifact = {
  type: "raw";
  text: string;
};
```

Keep the artifact list appendable, but merge artifacts of the same semantic slot during lifecycle collapse. For example, the latest diff preview for a `toolCallId` should replace the previous preview, and the final result should replace the preview if it covers the same file set.

## Diff Strategy

Use unified diff as Multi's canonical diff artifact.

Reasons:

1. `@pierre/diffs` expects patch-style diffs.
1. Multi already renders unified patches in the diff panel and git workbench.
1. ACP exposes diff content as `{ type: "diff", path, oldText?, newText }`, which can be converted to a unified patch.
1. Codex file-change items expose per-tool `changes[].diff` hunks with a path. Multi can wrap those hunks with standard file headers for `@pierre/diffs`.
1. pi-mono TUI proves the UX pattern, not the diff wire format.

Do not parse pi-mono's TUI line-number diff format into Multi. It is a terminal display format, not a portable artifact format.

Current provider decisions:

1. Do not treat Codex `turn.diff.updated` as a per-tool artifact. In current Multi code it belongs to turn/checkpoint diff state.
1. Do not render Codex turn-level diffs inline in the assistant changed-files section. That section should stay a file summary and deep link.
1. Generate per-tool unified diff artifacts from Codex `fileChange.changes[]` hunks by adding file headers. This keeps the diff in the edit row without synthetic activities.
1. Generate per-tool unified diff artifacts from ACP `{ type: "diff", path, oldText?, newText }` content. `oldText` missing or null means a new-file patch.
1. Do not add generic patch scraping in the first milestone. Add more provider extractors only when a concrete adapter payload shape is verified.

## Renderer Strategy

Model this after pi-mono's TUI split:

1. `ToolCallMessage` should continue choosing the high-level tool case.
1. `ToolCallRenderer` should receive normalized artifact data, similar in spirit to pi-mono's `ToolRenderContext`.
1. Renderers should choose the best artifact:
   - edit: unified diff first, detail text fallback.
   - shell: command plus output with truncation/full-output metadata.
   - read: path, range, preview text, truncation state.
   - grep/search: query, count, matched files, output preview.
   - unknown/dynamic/MCP: summary plus raw fallback.
1. Do not thread rendered React nodes through display overrides. `ToolCallRenderer` should receive canonical artifact data and choose the renderer itself.

## Normalization Plan

Normalize in `packages/app/src/session-logic.ts` or a neighboring helper called from `toDerivedWorkLogEntry()`.

Inputs to preserve:

1. `payload.data.item`, `payload.data.result`, `payload.data.rawOutput`, `payload.data.content`, and nested `files`/`patches`/`operations`.
1. `content.delta` activities for `command_output` and `file_change_output`.
1. ACP tool content entries with `{ type: "diff", path, oldText, newText }`.
1. Command output metadata such as truncation, exit code, and full output path when available.

Merge in `mergeDerivedWorkLogEntries()`:

1. Keep existing string merging for `detail` and `output`.
1. Add `mergeToolDisplayArtifacts(previous.artifacts, next.artifacts)`.
1. Key diff artifacts by `type + source + file set`.
1. Key command artifacts by `type + command`.
1. Prefer final artifacts over previews.
1. Preserve raw fallback only when no richer artifact exists.

## TUI Lessons To Copy

Copy these behaviors from pi-mono's TUI:

1. Create the row as soon as tool-call args are visible, not only when execution starts.
1. Update the row in place as args stream.
1. Mark args complete separately from execution start. This is what lets pi-mono compute edit previews after the assistant message finishes.
1. Stream partial command output through the same row.
1. Reuse renderer state across updates so expanded/collapsed state and cached rendering survive partial updates.
1. Render compact by default, with an explicit expand action for body details.
1. Keep final result rendering from duplicating a preview that already showed the same diff.

Do not copy:

1. The terminal-only edit diff format.
1. Loose renderer APIs without concrete artifact types.
1. Provider-specific payload parsing inside chat components.

## Implemented Milestone

Implement the TUI artifact path in app-local code:

1. Add `ToolDiffArtifact` and `artifacts?: ToolDisplayArtifact[]` app-locally.
1. Extract Codex `fileChange.changes[]` hunks into unified diff artifacts for edit rows.
1. Extract ACP `{ type: "diff", path, oldText, newText }` content into unified diff artifacts.
1. Do not extract generic unified patch text. Codex file-change hunks and ACP old/new content are the verified per-tool diff sources.
1. Leave Codex `turn.diff.updated` on the turn/checkpoint path; do not attach it to edit rows.
1. Merge preview and final diff artifacts by `toolCallId`.
1. Add `InlineToolDiff` using `@pierre/diffs`, with raw preformatted fallback if patch parsing fails.
1. Pass artifacts through `ToolCallModel` and render diffs inside `EditToolCall`.
1. Keep `detail` rendering unchanged for rows with no diff artifact.
1. Keep edit rows collapsed by default. Do not add auto-expand or a summary-only size threshold.
1. Render shell rows from `ToolCommandArtifact` instead of only `command`/`output` strings.
1. Keep output collapsed by default.
1. Surface truncation and full-output hints in the expanded body.
1. Normalize read, search, diagnostic, and raw fallback artifacts without provider-specific parsing in chat components.

This mirrors pi-mono's lifecycle model and bash/read/search renderer shape while keeping Multi's canonical app format as unified diff artifacts.

## Codebase-Resolved Decisions

1. No current provider adapter emits a first-class reliable per-tool unified patch. ACP emits per-tool old/new diff content that Multi can convert; Codex emits a turn-level unified diff; file-change output streams are text.
1. File-change previews should be generated in Multi from ACP structured old/new content. A file list, output stream, or prose detail is not enough evidence to generate a patch.
1. Inline diff rendering should have no summary-only threshold in the first milestone. Rows are collapsed by default, parse failures already need a raw fallback, and there is no existing threshold to preserve.
1. Artifact types should stay app-local now. `packages/contracts` intentionally leaves lifecycle `data` as unknown, so adding chat display artifacts there would widen the runtime contract before another consumer needs it.
1. Completed edit rows should stay collapsed by default. That matches current `ToolCallMessage` behavior and the pi-mono TUI lesson of compact rows with explicit expansion.

## Plan Assessment

The plan is solid if it stays lifecycle-first and artifact-first.

The main risk is normalizing too late. If chat components inspect provider payloads directly, the implementation will drift away from the pi-mono TUI lesson. The right boundary is session/work-log derivation: preserve structured artifacts there, merge them by `toolCallId`, then keep renderers simple.
