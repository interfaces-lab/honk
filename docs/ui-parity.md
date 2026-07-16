# UI parity checklist — the wireframe gate (round 2)

Every capability the current UI offers, collected by the round-2 opus sweep (12 surface auditors +
a completeness critic; 402 capabilities) and gated by the round-2 grill. This is a design input for
the wireframe boards (ADR 0023 §5): a board that cannot place every `keep` here is incomplete.
Companion: [ui-learnings.md](./ui-learnings.md). Grades were collected before the rulings below —
where they conflict, the ruling wins.

Grade legend: **keep** (capability survives into the rewrite), **kill** (does not return),
**rethink** (capability survives, its current shape/transport does not).
Wire legend: `core-v1` (served by @honk/api), `aux` (desktop aux server — dissolving into the Core
per ADR 0022), `electron-local` (shell chrome IPC), `client-local` (pure UI state),
`legacy-dead` (depends on the deleted runtime; renders nothing today).

## Rulings (law for the rewrite, grill 2026-07-04)

1. **Browser → ADR 0024.** Core-owned browser sessions with screencast; every client views and
   steers live. The Electron webview and IPC automation bridge die with the legacy renderer.
2. **Core grows verbs**: queue ops (update / reorder / send-now), skill-list serving, a
   compact-thread verb, and a plan-update verb. Terminal QoL was deliberately NOT grown (no
   clear-history, no subprocess-activity events): the UI designs honestly around the absence — no
   cosmetic clear that resurrects on reload. `terminals.restart` already exists on the wire and
   finally gets a surface.
3. **Summary enrichment is baseline.** Core serves an authoritative sidebar row status plus
   `latestTurn` and `readableAt` on Thread Summaries; the client-side status reconstruction
   (visit boundaries, activeTurnId inference) does not survive.
4. **Per-user UI state is Core-synced** (ADR 0009 enforced): unread markers, sidebar filters,
   project order, diff-review "viewed" state, plan dismissals, diff layout. Only window geometry
   and per-device theme/zoom stay device-local.
5. **Confirmed kills**: every approval/permission surface (ADR 0007), every dead-runtime consumer
   (agent-runtime-store, honk-runtime-api callers, queued-follow-up store, extension-UI requests),
   the unmounted sonner toast system, and rich-text document rendering/persistence (ADR 0013 —
   Prompt Tokens survive, rendered from the token model, never from a stored editor document).
6. **Text-parsing heuristics die**: git-action shorthand (`resolveGitAgentActionFromPrompt`), the
   `/^Goal:/` status bar, terminal-context regex chips. The concepts return only as structured
   tokens or Parts if a later grill wants them back.
7. **Desktop host-chrome policy**: host-OS conveniences (open in external editor, reveal in Finder,
   native menus as accelerators) may stay desktop-only — parity governs features and data, not host
   conveniences. Any such affordance that gates a feature needs an in-app equivalent.
8. **Open — deferred to later grills**: chat-pane tiling, multitask/subagent orchestration UX,
   `/goal` as a product concept, env-mode/worktree selection placement in the composer.

## composer

- **Prompt text editor (Lexical)** `keep` `client-local`
  Multiline contenteditable input with mode/phase-dependent placeholders ("Send follow-up", "Plan, Build, / for skills, @ for context", per-interaction-mode hints), auto-growth from single-line pill to multiline, and click-anywhere-to-focus.
  — The core text-entry affordance. Text is what goes on the wire (ADR 0013). Keep the editor; the internal editor<->prompt manual sync machinery is an implementation detail to rebuild, not a product capability.
- **Prompt Tokens / chips (@file, /command, $skill, inline markdown link)** `keep` `client-local`
  Atomic contentEditable=false chips with file icons, line-range suffixes (:12-20), and hover tooltips showing the full path/description; arrow-skip and whole-chip backspace deletion.
  — ADR 0013 explicitly preserves Prompt Tokens. The chip vocabulary (mention/command/skill/inline-token) is the right model; keep it as inline atoms over a plain-text buffer.
- **Rich-text document persistence (richTextJson)** `rethink` `client-local`
  The composer serializes the entire Lexical document to JSON and persists it (debounced 500ms) into the draft store so chips survive reload/route changes, alongside a parallel plain-text prompt.
  — ADR 0013 says the wire is raw text + Prompt Tokens and calls out rich-text document state as kill/rethink. The dual source of truth (livePrompt string vs. richTextJson) plus expand/collapse cursor math is exactly what the rewrite should drop; persist text + token spans, not a Lexical document.
- **Editor history (undo/redo)** `keep` `client-local`
  Lexical HistoryPlugin gives undo/redo in the composer.
  — Baseline text-editing expectation.
- **Surround-selection typing** `keep` `client-local`
  Selecting text and typing a bracket/quote wraps the selection (surroundSymbolsMap), including dead-key handling.
  — Low-cost editing affordance users expect from a code-adjacent composer.
- **Focus-on-type** `keep` `client-local`
  Typing anywhere in the thread view (when not connecting/approval/inline-edit) redirects focus into the composer.
  — Good keyboard-first UX; purely local behavior.
- **Slash-command menu (`/`)** `rethink` `legacy-dead`
  Opens on standalone `/`; fuzzy-ranked list of mode commands (ask/plan/debug/multitask), thread actions (compact, goal), and Skills, grouped into Skills/Commands with collapsed "Show N more" sections, keyboard nav, and a mode-prefix pin ("/deb" pins Debug first).
  — Mode/command rows are local, but the Skills half resolves through the desktop runtime bridge (isDesktopRuntimeApiAvailable()===false post-cutover), so skills are always empty. Keep the menu + ranking UX; re-source skills over the core/remote plane (ADR 0022).
- **`@` mention menu (files/folders + past threads)** `keep` `aux`
  Opens on `@`; project file/folder search (files-first default, collapsed to 3) plus a Past Threads section (collapsed to 5), with a hover path-preview panel.
  — File search resolves through the project index (aux/core, being folded into Core). Keep file mentions; the past-threads sub-feature is separately dead (see thread-mention insert). Path preview is desktop-gated and needs remote parity.
- **File/folder mention insertion** `keep` `aux`
  Selecting a file/folder inserts an `@path ` mention chip with a VSCode file icon.
  — Core context-attachment primitive; resolves through the project index.
- **Skill insertion** `rethink` `legacy-dead`
  Selecting a skill inserts a `[$name](path)` skill chip carrying the absolute SKILL.md path.
  — Skill list comes from the dead desktop runtime bridge. The capability (attach a skill) should survive but must be served by the Core (ADR 0022).
- **Past-thread mention insertion** `rethink` `legacy-dead`
  Selecting a past thread from `@` inserts a session-file reference token after an IPC round-trip to resolve the thread's session file path.
  — Depends on readHonkRuntimeApi().getThreadSessionFile, an all-rejecting stub returning {path:null}; the insert silently aborts. GAPS lists codexThreadId/session-file identity as unavailable. Re-decide whether cross-thread references exist in the new product.
- **`/compact` thread-context command** `rethink` `legacy-dead`
  Slash command that compacts the thread's context window; removes the `/compact` text and triggers compaction.
  — compactRuntimeThread throws "Runtime compact is unavailable after core cutover." Compaction is desirable but the wiring is dead; core exposes no compact endpoint in GAPS.
- **`/goal` command (Codex-style goal)** `rethink` `client-local`
  Inserts a `/goal ` token, only offered when the agent mode is a Codex mode (deep/rush).
  — Codex-runtime-specific vocabulary surfaced conditionally on model mode; the rewrite should decide if "goal" is a product concept or Codex baggage.
- **Command-menu prefetch, empty states, dismissal** `keep` `client-local`
  Warms skills + file index on first focus; shows "Searching project files..."/"No results found"; dismisses on Escape, outside-pointer, or trigger-change with per-trigger dismissal memory.
  — Solid menu ergonomics; keep the behavior, rebuild the fragile virtual-anchor MutationObserver positioning.
- **Model / agent-mode picker (creation composer)** `rethink` `legacy-dead`
  New-agent/draft composer picker: Deep/Smart/Rush/Composer with provider icons, model names, descriptions, per-mode Effort (thinking-level) submenu, OpenAI Fast Mode toggle, Composer Fast/Normal toggle, and availability/unavailable reasons; Composer carries an Experimental badge.
  — Reads useAgentRuntimeStore snapshot.preferences (never populated -> always DEFAULT) and writes via readHonkRuntimeApi().updatePreferences (stub mutates an in-memory var only). ADR 0014 wants model+thinking pinned at creation, which this picker's PLACEMENT matches, but the wiring is dead and must write into the thread-create command.
- **Read-only model chip (in-thread composer)** `keep` `core-v1`
  In an existing thread the model control is a non-interactive chip showing the thread's pinned agent mode/model.
  — Exactly matches ADR 0014: model pins at thread creation, no mid-thread switching. There is no cycleModel to remove; keep the read-only chip.
- **Thinking-level (Effort) submenu** `rethink` `legacy-dead`
  Off/Low/Medium/High/Extra High effort options per mode, with Rush/Composer forced to Off.
  — Same dead updatePreferences path. Concept survives (thinking pins at creation, ADR 0014); re-wire into thread creation.
- **Fast-mode localStorage persistence + restore** `kill` `legacy-dead`
  Persists OpenAI/Composer fast-mode toggles to localStorage and restores them on mount for the new-agent composer.
  — Gated on isDesktopRuntimeApiAvailable() (always false) and feeds the dead preferences path; incidental complexity to drop.
- **Interaction-mode chip (Ask/Plan/Debug/Multitask)** `keep` `core-v1`
  Colored, iconed chip showing the active non-default interaction mode with a clear (x) affordance to return to Build; tooltip carries the cycle shortcut.
  — Interaction mode is stored per-draft locally and sent per-turn (GAPS: per-send InteractionMode maps to honk.threads.send). Legit product concept; keep.
- **Interaction-mode cycle shortcut** `keep` `client-local`
  A keybinding (composer.cycleInteractionMode) cycles Agent->Plan->Ask->Debug (+Multitask when enabled) and direct-mode keybindings jump to a mode.
  — Keyboard-first mode switching; local + per-send to core.
- **Interaction-mode suggestion ("Try Plan/Debug Mode")** `keep` `client-local`
  Keyword-heuristic that inspects the prompt and offers a one-tap chip to adopt Plan or Debug mode, marked used once dismissed/consumed.
  — Cheap, purely client-side nudge that improves mode discovery; keep but keep it un-sticky.
- **Per-mode placeholder copy** `keep` `client-local`
  Placeholder text changes by interaction mode ("Ask questions without making changes...", "Create a plan...", "Inspect failures...", "Coordinate background subagents...").
  — Effective, zero-cost way to communicate mode intent.
- **Multitask mode** `rethink` `client-local`
  An interaction mode for coordinating background subagents, gated behind the multitaskModeEnabled local feature flag.
  — Feature-flagged and tied to subagent orchestration; re-decide whether it ships and how it maps to core subagent capabilities.
- **Image attachments (attach button, drag-drop, paste)** `keep` `core-v1`
  - button opens a file picker; also drag-drop and clipboard paste; validates image type, per-file size limit (MB), and max attachment count with toast errors; disabled while pending user input / connecting.
    — Attachments upload per-send (GAPS: upload image attachments supported). Core capability; keep.
- **Image attachment strip** `keep` `client-local`
  Thumbnail strip above the input with per-image remove and expand-to-view.
  — Standard attachment management; stored in the draft, sent to core.
- **Drag-over highlight** `keep` `client-local`
  The composer ring/background highlights while dragging files over it.
  — Affordance feedback for drop; local.
- **Queued-items panel** `rethink` `legacy-dead`
  Lists queued messages with a count header, collapse/expand, drag-reorder with drop indicators, per-row Edit / Send-now / Remove, image thumbnails, double-click-to-edit, and a "next" marker.
  — Sourced from useAgentRuntimeStore.snapshot.queuedFollowUps, which is never populated (no host events post-cutover), and GAPS states core does not project queued messages into UI state. ADR 0005 says queued input is projected state; rebuild this panel from a core-served queue projection.
- **Queue as a send delivery mode** `keep` `core-v1`
  Sending while a turn is running can enqueue the message (send-while-streaming = queue), reflected in the send button label/aria.
  — ADR 0005 makes queue one of the three delivery modes; core serves enqueue via messages.send delivery:"queue". Keep the delivery mode; make it a legible per-send choice.
- **Send queued item now** `rethink` `legacy-dead`
  Per-row and empty-composer-Enter action to immediately send the next queued item.
  — sendQueuedFollowUpNow stub rejects and GAPS says core exposes no send-now endpoint. Re-decide as part of the queue projection rebuild.
- **Edit queued item** `rethink` `legacy-dead`
  Begin-edit loads the queued item back into the composer with an "Editing queued message" banner + Cancel; save re-persists it.
  — Depends on the dead queue store; GAPS says core has no queued-message update endpoint.
- **Reorder queued items (drag)** `rethink` `legacy-dead`
  Drag-and-drop reordering of queued messages with before/after drop indicators.
  — Dead source + GAPS says core has no reorder endpoint.
- **Remove queued item** `rethink` `legacy-dead`
  Per-row trash action to drop a queued message.
  — Core does support cancelQueued (GAPS), but the list it acts on is dead; rebuild against the core queue projection.
- **Queue-expanded persistence** `keep` `client-local`
  Remembers per-thread whether the queue tray is expanded.
  — Trivial local UI state; keep if the queue survives.
- **Send / primary action button** `keep` `core-v1`
  Arrow-up send button; disabled unless sendable content; spinner while connecting/sending; aria/title reflect Connecting / Preparing worktree / Sending / Send message.
  — Primary submit path to core (thread.turn.start -> honk.threads.send).
- **Stop / interrupt button** `keep` `core-v1`
  Stop-generation button shown while a turn runs; interrupts the active turn.
  — ADR 0005 interrupt delivery mode; maps to honk.threads.interrupt.
- **Concurrent stop + send while running** `keep` `core-v1`
  When content is present during a run, both a stop button and a send button render (steer/queue while streaming).
  — Directly expresses ADR 0005 steer/queue-while-running; keep.
- **Enter-to-send / Shift+Enter newline** `keep` `core-v1`
  Enter submits (or sends the next queued item if empty); Shift+Enter inserts a newline; keybinding-driven.
  — Baseline submit ergonomics; the empty-composer-sends-queued branch is dead until the queue is rebuilt.
- **Send-while-streaming behavior setting** `keep` `client-local`
  agentWindowSendWhileStreamingBehavior (queue / stop-and-send / send-immediately) changes the running send button label/aria.
  — Maps to ADR 0005 delivery modes; keep but consider surfacing as a per-send choice rather than a buried setting.
- **Approval panel (composer header)** `kill` `core-v1`
  "Pending approval" header summarizing the request kind (command/file-read/file-change/permissions/mcp-elicitation/dynamic-tool/auth-refresh) with a 1/N counter, plus a disabled/placeholder composer state.
  — ADR 0007: there is NO permission/approval UI in the new product. Core emits no approval activities and GAPS lists approval responses as unsupported, so it is already inert. Remove it; this also deletes ~10 isComposerApprovalState branches from the composer.
- **Approval action buttons** `kill` `core-v1`
  Cancel turn / Decline / Always allow this session / Approve once, dispatching thread.approval.respond.
  — ADR 0007 kills approval flows; GAPS lists approval-response dispatch as unsupported by the core adapter.
- **Ask-question panel (questionnaire)** `rethink` `core-v1`
  Agent-asked questions rendered as a header card: question text, single/multi-select options with a/b/c letter shortcuts, an "Other" freeform answer, multi-question Next/Previous with i/N counter, keyboard letter selection, and Submit.
  — ADR 0007 keeps the ask-question flow but as a Part. Derives from thread activities and responds via thread.user-input.respond -> honk.threads.answerQuestion (implemented). Keep the interaction; move it from a composer header into a timeline Part.
- **Extension-UI request panel** `kill` `legacy-dead`
  select/confirm/input/editor/question/custom request kinds with options, freeform, and multi-question navigation.
  — Reads agent-runtime-store.pendingExtensionUiRequests (never populated) and responds via respondToExtensionUiRequest (stub rejects). Desktop-extension runtime concept with no core equivalent.
- **Plan follow-up tray** `keep` `core-v1`
  "Review Plan" card above the composer: plan title, markdown preview, Dismiss, View Plan, and Build (implement) actions; composer submit becomes "Refine" when text is present.
  — ADR 0007: plan proposals are Parts and survive. activeProposedPlan comes from thread activities; Build maps to honk.threads.implementPlan. Keep; consider aligning its placement with the Part model.
- **Thread status bar (branch + execution mode + context)** `keep` `aux`
  A row under the composer showing git branch name, an execution-mode label, and the context-usage trigger.
  — Branch/execution-mode come from desktop git (aux, folding into Core). Keep; ensure remote parity (ADR 0022) once aux is folded.
- **Context-usage meter, ring, and popover** `keep` `core-v1`
  Percent-full ring + numeric label; popover with used/max tokens, a colored per-category breakdown (system prompt/tools/rules/skills/mcp/subagents/conversation/summarized), an auto-compact note, and a "No context usage reported yet" empty state; hideable via agentWindowUsageSummaryDisplay.
  — activeContextWindow is served by the core read-model. Useful, information-dense; keep.
- **Subagent transcript tray** `keep` `core-v1`
  Popover above the composer (opened from a tool message's subagent) showing the subagent's transcript — messages, reasoning, tool/command steps, running logs — virtualized with auto-follow-on-stream, a role/title header, and close.
  — Fed by subagent-activity-store <- thread-store <- thread-sync (core orchestration activities). Keep, contingent on core continuing to emit subagent activity kinds.
- **Draft composer + draft routes (/draft/:id)** `keep` `client-local`
  A pre-thread composer that persists prompt/richText/images/interactionMode and per-thread/per-draft draft targets across reloads, with a cross-component force-sync mechanism.
  — Draft persistence is good UX and local; keep the draft concept but drop the richText half (ADR 0013) and the force-sync/editor-sync machinery in favor of projected state.
- **Env-mode / worktree selection (draft)** `rethink` `aux`
  Draft-level choice of local vs. worktree execution (with worktreePath), falling back to local when not a git repo; drives a "Preparing worktree..." send state.
  — Worktree is a real core/aux concept, but this lives at the draft/creation boundary and gates on desktop git; confirm whether env selection belongs to the composer or the project/creation surface and ensure remote parity.
- **Inline-edit composer (edit sent message)** `keep` `core-v1`
  The composer reused in an inline-edit layout to edit a previously sent user message, with mode controls suppressed.
  — Edit/resend branches the session tree (sibling, not truncate) per prior decisions; keep, though this is arguably the message-timeline surface rather than the composer proper.
- **Interaction-mode target registry** `keep` `client-local`
  Registers the composer so external shell shortcuts can focus it and set/cycle its interaction mode.
  — Shell-integration glue; keep as local wiring, but simplify in the rewrite.

**Open questions:**

- Does core/v1 actually emit subagent orchestration activities (subagent.thread.started, subagent.item.*, subagent.content.delta) so the subagent tray has data, or is it inert like the queue? thread-sync maps these kinds but core's production of them is unverified.
- How should the creation-time model+thinking selection reach the thread-create command in the rewrite, given the current picker writes only to a dead in-memory preferences stub? Does the core thread-create input carry modelSelection/thinkingLevel?
- ADR 0005 says queued input is projected state, but GAPS says core does not project queued messages to UI and lacks update/reorder/send-now endpoints. Will the rewrite add a core queue projection + those mutations, or drop edit/reorder/send-now and keep only enqueue/cancel?
- Is `/goal` (Codex-style goal token, offered only for deep/rush) a real product concept in the new product, or Codex-runtime baggage to remove?
- Do env-mode/worktree selection belong to the composer surface or to a separate project/creation surface in the rewritten UI? They currently live in the draft composer but gate on desktop git.
- Should ask-question and plan-proposal panels move out of the composer header into inline timeline Parts (as ADR 0007's Part model implies), and if so how does the composer stay the answer-entry point (custom answer typing currently flows through the composer editor)?

## conversation-timeline

- **User message bubble (raw text)** `keep` `core-v1`
  User prompt rendered in a ConversationBubble (role=user), break-words/wrap-anywhere; the primary human turn in the transcript.
  — Core message; served by core/v1. user-message.tsx UserMessageBody.
- **User message long-text collapse** `keep` `client-local`
  Prompts >4 lines or >360 chars wrap in ConversationCollapse (show more/less).
  — Pure UI affordance (shouldUseUserMessageCollapse); cheap, keeps long pastes tidy.
- **User rich-text document rendering** `rethink` `core-v1`
  message.richText rendered by a full second document renderer supporting BOTH TipTap (doc.content) and Lexical (doc.root) node trees — paragraphs, headings, lists, blockquote, code, marks.
  — ADR 0013: wire is raw text + Prompt Tokens; storing/rendering an editor document is exactly the rich-text state to drop. rich-text-message.tsx (~880 lines, two schemas).
- **Prompt-token chips in user messages** `rethink` `core-v1`
  @mention/file, /command, $skill, inline-token, and link chips rendered inline (with VS Code file icons and line-range detail).
  — ADR 0013 keeps Prompt Tokens but they should render from the token model, not by walking a stored TipTap/Lexical doc; file-icon URLs are desktop-origin (ADR 0022). renderTiptapAtom/renderLexicalAtom.
- **Terminal-context inline chips** `rethink` `aux`
  @terminal line-range chips parsed out of message text via regex, with hover tooltip showing captured output.
  — Parsed from rendered text with TERMINAL_CONTEXT_HEADER_PATTERN rather than a token; terminals are now core so remote parity is possible but this heuristic path should be a first-class token. user-message.tsx / terminal-context.ts.
- **Git-action shorthand message** `rethink` `aux`
  When a prompt matches a git intent (commit/push/create-PR), the raw prompt is replaced by an icon+label chip (e.g. 'Create branch and commit').
  — resolveGitAgentActionFromPrompt is a text-pattern heuristic hiding the real prompt; git is aux (desktop-only today, ADR 0022). Belongs to an explicit action token, not regex.
- **User image attachments** `keep` `core-v1`
  Attached images render as a thumbnail group under the bubble; click opens the lightbox; authenticated preview URLs.
  — Core attachments; works remote via previewUrl. UserMessageImageAttachment.
- **Turn-failure footer on user message** `keep` `core-v1`
  A StatusNotice rendered under the user bubble when that turn failed (message.turnFailure).
  — Ties the error to the specific turn instead of a floating banner; core thread state.
- **Assistant markdown message** `keep` `core-v1`
  Assistant text as streaming markdown (code blocks, file links), with '(empty response)' empty state when non-streaming and blank.
  — Core assistant part. assistant-message.tsx + chat-markdown.
- **Streaming text with live cursor** `keep` `core-v1`
  Assistant/thinking text streams token-by-token; isStreaming drives cursor and auto-follow.
  — Core streaming; central to product feel.
- **Reasoning / thinking rows** `keep` `core-v1`
  Dimmed tertiary-color markdown reasoning; collapsed groups summarize as 'Thought for Ns'.
  — Core path is WorkLogEntry with tone==='thinking' (RuntimeThinkingStep duplicate is legacy-dead). ToolCallMessage thinking branch / step-renderer.
- **Thinking status row** `keep` `core-v1`
  Robot-icon + shimmering 'Thinking…/Thought - <task>' status line when no reasoning body exists.
  — ThinkingStatus in tool-renderer.tsx; core-derived.
- **Bash/shell tool card** `keep` `core-v1`
  Syntax-highlighted command ($ tokens), scrollable output block, exit-code/duration/truncated metadata, streaming preview and collapsed output preview, error tint.
  — Rendered from WorkLogEntry command artifacts (core). ShellToolCall/tool-renderer.tsx.
- **Edit/delete tool card with inline diff** `keep` `core-v1`
  File path, +/- stat badges, inline unified diff (InlineToolDiff, themed), collapsed diff preview, delete variant.
  — Core edit part / TurnDiffSummary. EditToolCall + tool-inline-diff.tsx.
- **Read tool card** `keep` `core-v1`
  File code block output with detected file type, line ranges, truncated badge, clickable file link.
  — Core read artifact. readToolCall branch.
- **Grep/glob search tool cards** `keep` `core-v1`
  Grep: matches grouped by file with line numbers; glob/find: file list; match/file count badges, +more.
  — Core search artifacts, parsed by search-output.ts. SearchToolCall.
- **MCP / dynamic / unknown tool cards** `keep` `core-v1`
  Generic tool line with expandable raw/diagnostic output, toolbox icon.
  — Core generic tool parts. ToolMetadataLine branch.
- **Web search / web fetch / image-view / await cards** `keep` `core-v1`
  Web cards with linkable URL; image-view; await card with a live elapsed timer.
  — Core tool parts; await/monitoring is runtime-flavored and should be re-derived from core turn state (ADR 0022 remote parity). resolveActionLabel / AwaitDetails.
- **Tool summary narration row** `keep` `core-v1`
  Meta narration rows (tool.summary) shown with a summary icon; never joins work groups.
  — ToolSummaryRow; core-derived narration.
- **Tool card expand/collapse disclosure** `keep` `client-local`
  Each tool card can be toggled open to reveal command/diff/output; per-card local state.
  — Pure disclosure state; essential for scannability.
- **Conversation density modes** `keep` `client-local`
  Three densities — detailed (full cards + icons), balanced (compact-ungrouped), compact (compact-all-grouped) — control card chrome and whether runs group.
  — User setting drives shouldUseCompact*/shouldGroup*; keep the control, but the grouping engine it feeds is over-built (see learnings). conversation-density.ts.
- **Legacy runtime display-timeline rows** `kill` `legacy-dead`
  runtime-thinking / runtime-tool / runtime-task / runtime-extension-ui-request steps and the parallel activeRuntimeDisplayTimeline source.
  — Sourced from useAgentRuntimeStore, which never receives events post-cutover; a duplicate of the core work-entry path that renders nothing. timeline-render-items.ts runtime-* branches.
- **Extension-UI request row + panel** `kill` `legacy-dead`
  In-timeline 'Waiting for/Answered <title>' rows and an above-composer panel for Cursor desktop-extension elicitations.
  — selectPendingExtensionUiRequestsForThread reads the dead agent-runtime-store; a Cursor-extension concept with no core/v1 equivalent.
- **Subagent status rows** `keep` `core-v1`
  Two-line rows (role/name, model, latest update, token usage, status indicator) for spawned subagents; click opens the subagent tray.
  — Core path is WorkLogEntry.subagents (runtime subagent path is dead). tool-message.tsx SubagentStatusRow.
- **Subagent inline activity tree** `keep` `core-v1`
  Live nested activity log (running glyph + bullets) under an active subagent row, capped at 14 entries.
  — Derived from core subagent logs; good live signal. SubagentInlineActivityTree.
- **Subagent tray + conversation dim mask** `keep` `client-local`
  Opening a subagent's detail tray dims (masks) the main transcript to focus the tray.
  — subagent-tray-store UI state + CSS mask; presentation only.
- **Work-group collapse with summary header** `keep` `client-local`
  Runs of tool/thinking steps collapse to one header: summary verb (Explored/Edited/Ran/Thought), details ('N files'), +/- stats, chevron.
  — Derived projection over core entries; valuable density control but the derivation engine is huge and Cursor-parity-shaped (see learnings). timeline-render-items.ts / step-renderer.tsx.
- **Work-group running preview** `rethink` `client-local`
  While a run is live, the collapsed group shows a scrolling preview of its last steps plus a glanceable shell/edit output strip, with a fade mask when overflowing.
  — Compelling but expensive: many magic PX constants, ResizeObserver, per-row height memory tied to grouping. Rebuild against a single source. WorkGroupPreview.
- **Work-group expand to full steps** `keep` `client-local`
  Clicking a group header expands it to the full ordered step list with a summary line.
  — expandedWorkGroupIds state; core disclosure.
- **Special-case groups (thinking/command/waiting/browser)** `rethink` `legacy-dead`
  Distinct group flavors: thinking-only ('Thought for Ns'), command-only ('Ran N commands'), monitoring-background/await ('Monitoring background tasks'), and browser-MCP groups.
  — Thinking/command flavors survive (core), but await-monitoring and browser groups are keyed off runtime/Cursor-browser-MCP providers that only arrive via the dead runtime store. summarizeRuntimeWaitingGroup / summarizeRuntimeBrowserGroup.
- **Grouped assistant-narration text** `rethink` `client-local`
  Short (<=2 line, no block markdown) assistant text streams inside an open tool group as a dimmed line, then peels out to a full row when the group completes.
  — Clever but a major source of the derivation complexity (release/peel passes); reconsider whether narration should ever live inside a group. isGroupedNarrationMessageStep / peelGroupedNarrationFromCompletedGroups.
- **Proposed-plan card** `keep` `core-v1`
  In-timeline plan Part: title + rendered markdown, with inline TipTap plan editor (Edit → save/cancel) when it's a server thread.
  — ADR 0007: plan proposals are Parts that survive. Keep the card; rethink inline edit — GAPS.md notes plan-markdown updates are unsupported by the core dispatch adapter. proposed-plan-message.tsx.
- **Plan follow-up tray** `keep` `core-v1`
  Above-composer 'Review Plan' card: title, markdown preview, Build / Dismiss / View Plan actions; building state.
  — Drives honk.threads.implementPlan (Build) and plan lifecycle; ADR 0007 plan flow survives. plan-follow-up-tray.tsx.
- **Ask-question questionnaire** `keep` `core-v1`
  Agent question Part: numbered options (radio or multi-select checkbox), freeform textarea option, 1-9/A-Z keyboard selection, N/M multi-question progress.
  — ADR 0007 explicitly keeps ask-question; dispatches honk.threads.answerQuestion. questionnaire.tsx / user-input-panel.tsx.
- **Approval panel + tool-approval actions** `kill` `core-v1`
  Above-composer approval panel and approve/reject actions for command/file/mcp/permission requests.
  — ADR 0007: there is NO permission/approval UI in the new product. approval-panel.tsx / approval-actions.tsx; core dispatch also does not serve approval responses (GAPS.md).
- **Tool-card pending-approval visual coupling** `kill` `core-v1`
  A tool awaiting approval breaks out of its work group, forces 'detailed' density, and auto-expands the shell body.
  — Part of the approval flow removed by ADR 0007; deleting it also simplifies grouping. groupedStepHasPendingApproval, resolveEffectiveToolCallDensity, matchesPendingApprovalKinds.
- **Patch part rendering (TurnDiffSummary)** `rethink` `core-v1`
  Turn-level aggregated diff/patch surfaced through edit cards and +/- stats.
  — Survives as a Part but GAPS.md flags that patch Parts without a turnId are dropped (app keys TurnDiffSummary by TurnId); the rewrite needs a patch identity that doesn't depend on turnId.
- **Thread-error banner** `keep` `core-v1`
  Dismissible error banner at the top of the transcript (StatusNotice), suppressed when the error is already shown on a user message.
  — Core thread.error; sanitized. error-banner.tsx + threadErrorShownOnUserMessage dedupe.
- **Branch-path-invalid alert** `keep` `core-v1`
  When the active branch path can't resolve, an Alert ('Branch path unavailable') replaces silently-dropped messages.
  — Honest failure surface over the thread entry tree. deriveThreadBranchView invalid state.
- **Waiting / working status row** `keep` `core-v1`
  Loader + elapsed time while the agent works, escalating to a 'slow' label after a threshold.
  — Derived from turn liveness; core. status-row.tsx / waiting-status.ts.
- **Active goal status bar** `rethink` `client-local`
  A pill above the composer echoing the current goal, extracted by parsing a 'Goal:' prefix from the latest user message, with a pulsing progress dot.
  — extractGoalText (/^Goal:/) is a fragile text heuristic that only works if the caller prefixed 'Goal:'; if goals matter they should be structured, else drop. deriveActiveGoalStatus.
- **Virtualized conversation scroller** `keep` `client-local`
  Row-virtualized transcript with per-row size estimation, measurement reuse for non-work rows, and running-work-group height memory.
  — Needed for long threads; ConversationScroller. Height estimation is coupled to the grouping engine — simplify with one source.
- **User-message scroll anchors** `keep` `client-local`
  User messages act as scroll anchor rows so the viewport holds position across streaming/reflow.
  — isAnchorRow=user; good scroll stability pattern.
- **Sticky floating edit row** `keep` `client-local`
  The message being edited sticks to the top of the viewport as a floating overlay while its inline composer is open.
  — shouldRenderStickyOverlay; keeps edit context visible. messages-timeline.tsx.
- **Scroll-to-bottom button** `keep` `client-local`
  Floating pill button appears when not scrolled to end; jumps (animated) to the latest.
  — renderScrollToEndButton; standard chat affordance.
- **At-end tracking, status-bar reveal, bottom fade** `keep` `client-local`
  isAtEnd toggles a data attribute that reveals the composer thread-status bar, plus a bottom gradient overlay fades the last rows under the docked composer.
  — onIsAtEndChange + data-scrolled-to-end + gradient overlay; presentation only.
- **Streaming auto-follow** `keep` `client-local`
  While streaming, the scroller stays pinned to the end unless the user scrolls up.
  — isStreaming prop to scroller; expected behavior.
- **Active-branch projection** `keep` `core-v1`
  The thread entry tree is projected to a single active branch (leaf path); messages, activities, and turns are filtered to that branch before rendering.
  — Core thread.entries/leafId; correct model for edit/resend branching. thread-branch-view.ts.
- **Thread-tree branch panel** `rethink` `client-local`
  Panel listing the active branch, the canonical flattened entry tree (depth-indented, child counts, active-leaf marker), and structural issues.
  — Only mounted by router-devtools (dev-only); the data (core entry tree) is real but there is no product branch UI. Per the edit/resend branching design this should become a real feature. thread-tree-panel.tsx.
- **Sibling branch switching** `rethink` `core-v1`
  Navigating between alternate branches created by edit/resend.
  — MISSING in product: edit creates a sibling branch but nothing lets the user see or return to it (no setLeaf/branch navigator in chat). The rewrite must build this.
- **Context-window ring + usage popover** `keep` `core-v1`
  A ring meter that opens a popover with % used, tokens used/max, total processed, and an auto-compacts note.
  — Derived from activity context snapshots (core). context-window-meter.tsx / context-window-usage-details.tsx.
- **Context usage category breakdown** `keep` `core-v1`
  Composer thread-status bar shows branch name, execution mode, ring + %, and a popover with a colored per-category token bar (system/tools/rules/skills/mcp/subagents/conversation) and legend.
  — Core usage.categories; but two divergent renderers exist (ring-only meter vs. this bar) — consolidate. context-usage-bar.tsx.
- **Empty context state** `keep` `client-local`
  When no usage is reported yet, the meter shows a dash and 'No context usage reported yet.'
  — Graceful empty state in the usage popover.
- **Inline message edit (branching)** `keep` `core-v1`
  Clicking an editable user bubble swaps it for a full inline composer (interaction mode, cancel/submit); submitting resends and branches the thread as a sibling.
  — ADR 0005/edit-resend design: send with parentEntryId to branch. inline-message-edit-composer.tsx. (Model pin at creation per ADR 0014 must hold.)
- **Edit affordance gating** `keep` `core-v1`
  Only user messages with a resolvable thread entry are editable; edit is disabled while the agent is working; keyboard Enter/Space activates.
  — editableUserMessageIds + editUserMessagesDisabled; correct guardrails.
- **Expanded image lightbox** `keep` `core-v1`
  Full-screen image dialog with prev/next navigation, arrow-key/Escape handling, an index counter, and click-outside to close.
  — Works remote via authenticated preview URLs. expanded-image-dialog.tsx.
- **New-agent footer tips** `keep` `client-local`
  Rotating hint below the hero composer (/review, /, @, /plan), chosen by a stable hash of the thread key.
  — Low-cost onboarding; borderline composer surface. getNewAgentFooterTip.
- **Missing-active-thread fallback** `keep` `client-local`
  A centered spinner shown (and diagnostics reported) when the routed thread isn't loaded yet.
  — MissingActiveThreadFallback; loading state.

**Open questions:**

- Does core/v1 emit reasoning/thinking as its own Part type, or must the rewrite keep inferring 'thinking' from a WorkLogEntry tone? The tone-based path is the only surviving reasoning source now that runtime-thinking is dead.
- Await/monitoring-background and browser-MCP tool groups are currently keyed off runtime/Cursor-browser-provider metadata that only arrived via the dead runtime store — does core/v1 surface long-running/background tool state at all, or do these group flavors disappear entirely?
- GAPS.md says plan-markdown updates and patch Parts without a turnId aren't served by the core dispatch adapter — should inline plan editing and turnless patch rendering be cut from the rewrite, or is core gaining those endpoints before the UI rewrite?
- Should the branch/tree model become a user-facing navigator (per the edit/resend branching design), and if so does it live in the timeline (inline fork indicators) or a side panel — and must it reach remote/phone clients under ADR 0022?
- With rich-text document state removed (ADR 0013), does the transcript render user prompts from the exact same Prompt-Token model the composer emits, so there is a single token renderer shared across composer and timeline?

## onboarding-auth

- **Desktop Core discover-or-spawn + readiness wait** `keep` `electron-local`
  On desktop launch, DesktopCoreManager probes the discovery file at HONK_HOME/core; if a Core is already live it adopts it, otherwise it spawns `serve --home` as a Node child and polls readiness (probeCore) for up to 1 minute at 100ms intervals before the app can boot.
  — This is the ADR 0002/0022 bootstrap the rewrite explicitly preserves (desktop demotes to a client that discovers-or-spawns a loopback Core). Inherently shell/backend chrome. Correct as-is; only its lack of a visible progress state (see next) needs rework.
- **Hidden-window-until-Core-ready reveal** `rethink` `electron-local`
  The renderer window stays hidden until Core discovery succeeds (revealMainWindow fires on onReady/already-live). If Core never becomes reachable within the timeout, the window simply never appears and the user sees nothing.
  — There is no 'starting Core…' or 'Core failed to start' UI — the first-run experience is a black void until success. A phone/web client (ADR 0022) can't rely on a hidden native window; the rewrite needs an explicit spawning/connecting/failed state that every client family can render.
- **Core crash auto-restart with exponential backoff** `keep` `electron-local`
  If the spawned Core exits while desiredRunning, the manager reschedules a restart with 500ms→10s exponential backoff and resets the attempt counter on the next ready.
  — Sound resilience for the desktop-owned loopback Core. Silent to the user, which is fine for transient restarts but reinforces the need for a visible connection state when restarts stack up.
- **Local auth gate (bearer/pairing) blocking app boot** `keep` `core-v1`
  Router beforeLoad awaits resolveInitialServerAuthGateState: it GETs /core/v1/auth with a bearer, and on 401 tries the bootstrap credential — desktop bearer (core-app-secret file) validated at /core/v1/auth, or a pairing token exchanged at POST /core/v1/sessions/exchange for a durable web session. Result gates authenticated vs requires-auth. Bearer session is persisted to sessionStorage with a 60s revalidation TTL, and transient 502/503/504/network errors retry for 15s.
  — This is the ADR 0019 session posture (opaque bearer, secret-file for Core Apps, pairing-exchange for web) and ADR 0022's bootstrap-vs-session split. The mechanism is correct and remote-parity-shaped; keep. Only its rendered failure state (below) needs redesign.
- **'Local authentication failed' error page** `rethink` `core-v1`
  When the gate returns requires-auth, RootStatusPage renders title 'Local authentication failed', the core error message (or a default 'did not accept the desktop bootstrap credential'), and a Reload Window action.
  — First contact when auth fails is framed as a terse system failure, not onboarding. It offers no way forward except reload — no token entry, no re-pair, no provider sign-in. The rewrite should turn this into an actionable connect/sign-in surface.
- **'Open in Browser' bootstrap hand-off (desktop only)** `rethink` `electron-local`
  On the auth-failure page (and available via getLocalEnvironmentBootstrap), the desktop offers 'Open in Browser', which opens a loopback URL carrying the desktop's core-app-secret in a /#token= hash via openExternal.
  — Desktop-only (browserBootstrapUrl is null in web/serve mode) and it forwards the full owner secret as a bearer rather than minting a scoped, single-use pairing token per ADR 0019/0022. Should be replaced by proper owner-issued pairing.
- **Blank screen during bootstrap await** `rethink` `client-local`
  The root route defines no pendingComponent, so while beforeLoad awaits Core health + auth (up to the 15s transient-retry window) the screen is blank.
  — No loading affordance during the one moment the app is most likely to be slow (cold Core, remote latency). The rewrite needs a real connecting state, doubly so for remote clients.
- **Pairing-token deep-link exchange + URL stripping** `keep` `core-v1`
  getPairingTokenFromUrl reads a token from the URL hash (#token=) or query (?token=); it is exchanged for a durable web session and then stripped from the address bar via history.replaceState.
  — The ADR 0019 web-entry path (one-time pairing token delivered as a /#token= URL). Correct and needed for remote parity; keep. Its gap is that there's no UI to _generate_ such a link (see pairing issuance) and no manual fallback.
- **Manual pairing-token entry (submitServerAuthCredential)** `rethink` `core-v1`
  auth.ts exports submitServerAuthCredential to accept a pasted pairing token, but no component renders an input for it. A web client that lands without a #token= has only 'Reload Window' and dead-ends.
  — ADR 0022 mandates full remote parity, but web onboarding currently has no way to enter a credential — a hard dead-end. The rewrite must wire a token/paste entry (or QR scan) path.
- **Accounts panel empty state** `keep` `core-v1`
  In Settings, when no provider is connected the Accounts section shows 'No accounts connected' with copy explaining Claude uses the Claude Code login and Codex/Cursor can be added.
  — Correct default-empty framing (accounts are empty on first run). Keep, but this belongs in a first-run flow, not buried in settings.
- **Claude Code (Anthropic) delegated status row** `keep` `core-v1`
  A read-only row shows the Claude Code harness availability and a derived detail label ('Claude Max Subscription' / API key); when unavailable it instructs the user to run `claude login`. No in-app action.
  — Exactly the ADR 0016 delegated posture (honk never stores an Anthropic credential; 'log in' means Claude Code itself). Keep the posture, but the bare 'run claude login' instruction is a dead end that should be guided/deep-linked in the rewrite.
- **Codex OAuth device-code login flow** `keep` `core-v1`
  Add → Codex starts a login (coreAuth login mutation, kind codex-oauth); CoreAuthFlowPanel shows waiting/error states, an 'Open login page' button (verificationUri via shell.openExternal with window.open fallback), the user code with a Copy button (clipboard-unavailable toast fallback), plus Cancel and Retry. The auth snapshot polls every 2s while a flow is active.
  — This is the one honk-owned login honk offers UX for (ADR 0016), and the flow is a clean, gracefully-degrading device-code pattern worth keeping as the template for the rewrite.
- **Codex credential lifecycle (Re-login / Remove)** `keep` `core-v1`
  Connected Codex shows Remove; expired/error state shows Re-login; status copy derives from CredentialStatus (missing/available/expired/error).
  — Standard credential management on core/v1; owner-gated per ADR 0022. Keep.
- **Cursor API-key entry + lifecycle** `keep` `core-v1`
  Add → Cursor reveals a password Input with Save/Cancel and a 'Saved locally. Existing keys stay hidden.' note; connected shows Remove; expired/error shows Update key.
  — The ADR 0016 Cursor path (dashboard API key stored by honk, injected on ACP spawn). Keep.
- **Add-account menu with provider icons** `keep` `core-v1`
  The Accounts header shows an 'Add' menu listing only addable credentials (Codex when missing and no active flow; Cursor when missing and not already editing), each with its provider glyph.
  — Good conditional affordance (hides already-connected/in-progress providers). Keep.
- **Provider availability → model availability gating** `keep` `core-v1`
  deriveAgentModeAvailability reads the auth snapshot to compute per-mode unavailable reasons, surfaced as disabled agent-mode options and inline 'unavailable' summaries tied to which accounts are connected.
  — A strong pattern that ties connection state directly to what the user can pick, matching ADR 0016 (ModelDescriptor.available is the one route's state). Keep the coupling, but relocate it away from the legacy-dead preference writes it currently sits next to.
- **Server exposure mode (local-only vs network-accessible)** `rethink` `electron-local`
  Desktop backend resolves LAN bind host/advertised IPv4, falls back to local-only when no address is available, persists the mode, and relaunches on change; exposed to the renderer via getServerExposureState/setServerExposureMode IPC. No app UI reads or sets it — default is local-only.
  — ADR 0022 tier-5 requires exposure policy as a loud owner opt-in, but today it's backend/IPC-only with zero rendered surface and it lives in desktop settings rather than the Core. The rewrite must build a Core-served exposure control reachable from any owner client.
- **Pairing issuance ('connect a device')** `rethink` `core-v1`
  createServerPairingCredential POSTs /core/v1/sessions/pairings to mint a pairing token, but no component calls it — there is no QR, no copyable link, no 'add a phone/browser' UI.
  — The endpoint exists but the owner-facing pairing UI (the entire remote-onboarding entry per ADR 0022) is unbuilt. The rewrite must ship pairing issuance as first-class owner UI from day one.
- **Paired-client session listing + revocation** `rethink` `core-v1`
  listServerClientSessions (GET /core/v1/sessions), revokeServerClientSession (DELETE), and revokeOtherServerClientSessions map role/label/lastSeen into records, but nothing in the UI renders or calls them; listServerPairingLinks/revokeServerPairingLink are inert stubs (empty array / no-op).
  — ADR 0022 requires sessions to be enumerable and revocable (owner-gated). The core surface is half-there but has no rendered device-management panel; the rewrite must build it.
- **Silent WebSocket/SSE reconnect** `rethink` `core-v1`
  subscribeWithReconnect and the watch onStatus 'reconnecting' handler reset the bootstrap gate and re-subscribe with no user-visible indicator; the initial connection subscribe swallows failures (.catch(() => undefined)).
  — Connection loss/recovery is entirely invisible, which is untenable for phone/flaky-network parity (ADR 0022). The rewrite needs explicit connecting/reconnecting/offline status shared across clients.
- **Pi runtime default preferences (agent mode / thinking level / interaction mode)** `kill` `legacy-dead`
  The same settings component that hosts Accounts also renders a 'Pi runtime' section whose selectors write through readHonkRuntimeApi().updatePreferences.
  — honk-runtime-api.ts is the all-rejecting stub; updatePreferences mutates an in-memory fallback that persists nowhere and agent-runtime-store never receives events. ADR 0014 also pins model + thinking at thread creation, so a global mid-config model default contradicts the model. Remove; belongs to the agent-settings surface, not auth.
- **Generic error boundary + not-found status pages** `keep` `client-local`
  RootRouteErrorView shows 'Something went wrong' with Reload Window and Copy Error (copies stack/JSON); RootRouteNotFoundView shows 'Page not found' with Go Home and Reload Window.
  — Baseline app chrome, unrelated to auth logic. Keep (restyle in the rewrite).
- **Standalone component gallery** `keep` `client-local`
  The `packages/ui` Vite gallery renders shared components without a running Core.
  — Dev-only harness for component work; harmless. Keep as a dev aid.

**Open questions:**

- ADR 0022 wants owner-issued pairing (link/QR) as the remote-onboarding entry, but the desktop 'Open in Browser' currently forwards the raw core-app-secret owner bearer in a /#token= URL. Should the rewrite replace this with a scoped single-use pairing token even for the same-machine browser hand-off, or is owner-secret forwarding acceptable on loopback?
- Where should provider account connection (Codex/Cursor/Claude Code) live in the rewrite — a dedicated first-run step, a persistent Accounts area, or both? Today it is only reachable deep in Settings, which conflicts with it being the de facto 'sign in'.
- The exposure-mode control is desktop-settings + IPC today (local-only default) but ADR 0022 makes it a Core-served, loud opt-in reachable from any owner client. Does the exposure decision move entirely into the Core (so a paired phone owner could flip it), and what tier gating/UX does 'public exposure is a loud opt-in' imply?
- For web/serve mode with no #token=, what is the intended onboarding — a paste-token field, a QR scan, or a redirect to a pairing broker? The submitServerAuthCredential path exists but is unwired and the gate currently dead-ends.
- Should first-run surface Core spawn/discovery progress and failure explicitly (a 'starting…/couldn't start Core' screen), replacing the hidden-window-until-ready behavior, so that non-desktop clients have an equivalent connecting state?

## settings

- **Settings nav rail (5 sections)** `keep` `client-local`
  Left rail lists General, Appearance, Agents, Skills+Subagents, Archived as router Links (?section=), each with icon + active/aria-current state. Section switching is pure URL state.
  — Core navigation for a preferences surface; section set is product-shaped, not runtime-coupled.
- **Back-to-chat + settings-gear footer toggle** `keep` `client-local`
  Rail top 'Back' button returns to chat index; footer gear (pressed state) also exits settings; footer also hosts the UpdatePill.
  — Standard entry/exit chrome.
- **Settings search (autocomplete over preference index)** `keep` `client-local`
  Search box filters a hand-maintained preference index with fuzzy/prefix/boundary ranking; selecting a result navigates to the owning section, scrolls the row into center, and retries up to 20x until the DOM node exists. Empty state 'No matching settings.'
  — Strong findability pattern (jump + highlight across sections); worth keeping, though the index duplicates panel metadata (see learnings).
- **route.back keyboard shortcut** `keep` `client-local`
  Global keydown resolves the configured 'route.back' binding (e.g. Esc) and calls window.history.back() while in settings.
  — Keyboard exit; wired through server keybindings config.
- **Restore-all-defaults (orphaned)** `rethink` `client-local`
  useSettingsRestore computes dirty labels across theme + client + appearance, shows a confirm dialog listing what resets, then resets theme/appearance/settings and force-remounts via a restoreSignal. NO visible trigger renders it — grep confirms only restoreSignal is consumed; restoreDefaults/changedSettingLabels are unreachable in the UI.
  — Fully built but has no button; carries provider/context/dirty-tracking plumbing for an action a user can't invoke. Surface once or delete.
- **Per-setting Reset-to-default button** `keep` `client-local`
  Small step-back icon button that appears in a row only when the value differs from default; tooltip 'Reset to default'; stops propagation.
  — Good reversible-affordance pattern; reveal-when-dirty keeps rows clean.
- **Settings mounts full chat workbench shell** `rethink` `client-local`
  SettingsShellHost renders through ChatWorkbenchShellHost with SETTINGS_WORKBENCH_TABS=[browser,files], GitStatusSync, terminal machinery, right-workbench layout — all instantiated for a preferences screen.
  — Heavy shell reuse for a static prefs surface; rewrite should give settings a lighter host.
- **Time format select** `keep` `client-local`
  System default / 12-hour / 24-hour dropdown with reset-when-dirty.
  — Presentation preference; persisted in client settings via local-api.
- **Add project base directory input** `keep` `aux`
  Text input for the folder the Add Project browser opens in; commit-on-change; placeholder is the default projectless cwd; reset-when-dirty.
  — Server setting (settings.json via aux); tied to local FS Add-Project flow.
- **Keybindings: open persisted file** `rethink` `aux`
  Shows resolved keybindings config path (mono) and an 'Open' button that launches the file in the user's preferred editor via local-api shell.openInEditor; inline error + 'Opening…'/'Resolving…' states.
  — Path from aux/server; editing means opening an external editor — desktop-only, no remote-parity path (ADR 0022).
- **About / Version display** `keep` `client-local`
  Shows APP_VERSION in a mono code chip with a description line.
  — Static informational; harmless on any client.
- **Desktop updater controls** `keep` `electron-local`
  Check for Updates / Download / Install button driven by desktop update state; confirms before install when threads are running (lists running thread titles); status labels (Checking/Downloading/Installing), tooltip, disabled logic; errors surfaced as toasts.
  — Inherent desktop auto-update chrome; only rendered in Electron.
- **Diagnostics: logs directory + open** `rethink` `aux`
  Shows logs directory path (tracing-aware description) with an 'Open' folder button via preferred editor; inline error/resolving states.
  — Path from server observability; opening a local folder is desktop-only — needs a remote diagnostics equivalent.
- **Theme select** `keep` `client-local`
  System / Light / Dark dropdown; reset-when-dirty; applied through useTheme to the DOM.
  — Per-device appearance; core to the product.
- **App Icon picker** `keep` `electron-local`
  Radiogroup of dock-icon variants (Classic/Midnight/Sunset/Forest, +Dev in dev builds) rendered as image swatches; only shown on macOS Electron; reset-when-dirty; swaps the running dock icon.
  — Inherent OS dock chrome; correctly gated to mac desktop.
- **Tool Call Density slider + live preview** `keep` `client-local`
  3-stop slider Compact↔Detailed (dotted track, aria-valuetext per stop) over conversation-density values; renders a LIVE preview below (grouped summary row, compact rows, or full diff/shell cards) using the real ToolCallRenderer.
  — Excellent immediate-feedback pattern; a chat-rendering preference that belongs in settings.
- **Tint Hue slider** `keep` `client-local`
  0–360 hue slider with gradient track and a live color swatch; optimistic local value; drives shell/accent CSS vars.
  — Per-device theming via appearance store (localStorage + CSS vars).
- **Tint Intensity slider** `keep` `client-local`
  0–100% saturation slider with % readout; drives shell tint strength.
  — Companion to hue; same appearance plane.
- **Reduce Transparency switch** `keep` `client-local`
  Toggle solid backgrounds vs vibrancy/glass.
  — Accessibility/vibrancy control; per-device.
- **UI Font Size stepper** `keep` `client-local`
  NumberStepper 11–16 with +/- buttons and a bounded numeric input.
  — Per-device typography.
- **Code Font Size stepper** `keep` `client-local`
  NumberStepper 10–18 for editor/diff text.
  — Per-device typography.
- **UI Font Family input** `keep` `client-local`
  Text input with focus-draft/commit-on-blur semantics, Enter-to-commit, placeholder 'System font'.
  — Per-device typography; draft/commit avoids thrashing CSS on each keystroke.
- **Code Font Family input + live code preview** `keep` `client-local`
  Font-family input plus a LIVE tokenized diff preview (addition/deletion lines with syntax colors) rendered in the chosen font/size.
  — Preview-as-you-type; stand-in tokens avoid pulling in the shiki pipeline.
- **Typography section Reset** `keep` `client-local`
  Header 'Reset' button that resets the entire appearance store (hue/intensity/fonts/reduce-transparency) at once.
  — Section-level reset; complements per-row resets.
- **Agent Window font smoothing switch** `keep` `client-local`
  Toggle mac antialiased text smoothing in the agent window.
  — Client setting; mac-relevant rendering knob.
- **Use pointer cursors switch** `keep` `client-local`
  Toggle pointer cursor on buttons/controls; reset-when-dirty.
  — Interaction preference; per-device.
- **Agent mode selector (Deep/Smart/Rush/Composer)** `rethink` `legacy-dead`
  Menu with model names, availability gating (unavailable reasons dim options), a nested submenu per mode showing model description + effort label, inline summary of active model; 'Default model for new sessions.' Writes via readHonkRuntimeApi().updatePreferences.
  — updatePreferences is the all-rejecting stub's in-memory fallback and agent-runtime-store never receives events — the control writes to nothing and never reflects back. Concept (creation-time model pin, ADR 0014) survives but must be rebuilt on core.
- **Thinking level select** `rethink` `legacy-dead`
  Reasoning-depth dropdown, conditionally shown per agent mode; 'default for new Pi sessions'.
  — Same dead runtime path as agent mode. Thinking level pins at thread creation per ADR 0014; re-wire to core.
- **Interaction mode default select** `rethink` `legacy-dead`
  Agent/Ask/Plan/Debug (Multitask behind local feature flag) dropdown, 'default behavior for new agent turns'.
  — Dead runtime write path; core has per-send InteractionMode but no persistent default (GAPS). Re-wire as a creation-time/default seed on core.
- **Accounts: Claude Code status** `keep` `core-v1`
  Row showing delegated Claude Code login state (available + detail, or 'Run claude login').
  — Auth (not approval — ADR 0007 untouched); served by core/v1 auth snapshot.
- **Accounts: Codex OAuth device-code flow** `keep` `core-v1`
  Add Codex via ChatGPT sign-in: waiting/error states, 'Open login page', copy user code, cancel, retry on error, re-login when expired, remove when connected. Polls flow every 2s.
  — Real credential lifecycle on core/v1 auth; needed on every client per ADR 0022.
- **Accounts: Cursor API key** `keep` `core-v1`
  Add/edit form (password input, Save/Cancel), 'Update key' when expired/errored, 'Remove' when present; 'Saved locally' note.
  — Credential kind on core/v1 auth; enables Cursor Composer.
- **Accounts: Add menu + empty state** `keep` `core-v1`
  Section headerAction 'Add' menu offering Codex/Cursor when missing; 'No accounts connected' explanatory empty row.
  — Discoverable add path derived from core credential states.
- **Assistant output streaming switch** `keep` `aux`
  Toggle token-by-token streaming of responses.
  — Server setting (settings.json). Rendering/UX preference; keep, re-home to core-backed settings.
- **Send-while-running select** `keep` `client-local`
  Queue / Stop-and-send / Send immediately — what the composer submit does during an active turn.
  — Directly encodes ADR 0005's three delivery modes as a default; keep as the delivery-mode preference.
- **Usage summary display select** `keep` `client-local`
  Auto / Always / Never for context-usage summary visibility.
  — Chat presentation preference.
- **New threads default mode select** `keep` `aux`
  Local / New worktree default for newly created draft threads.
  — Server setting driving thread creation; keep, re-home to core.
- **Diff line wrapping switch** `keep` `client-local`
  Default wrap state when the diff panel opens.
  — Review-surface preference.
- **Archive confirmation switch** `keep` `client-local`
  Require a second click before archiving a thread.
  — Guard preference; consumed by thread actions.
- **Delete confirmation switch** `keep` `client-local`
  Ask before deleting a thread + its history.
  — Destructive-action guard; consumed by thread actions.
- **Skills list** `rethink` `legacy-dead`
  User/project skills as name+description rows resolved for the first project's cwd, with show-all/less pagination (first 5), plus loading/error/empty/unavailable states.
  — isDesktopRuntimeApiAvailable() is hardcoded false and listSkills returns [] — the list is permanently 'Skills are available in the desktop runtime.' Re-wire skill discovery to core for remote parity.
- **Subagents info cards** `rethink` `client-local`
  Three static hardcoded cards (General-Purpose, Librarian, Oracle) with icons + descriptions.
  — Pure static content with no data source; either back with real subagent registry or drop.
- **Archived threads list** `keep` `core-v1`
  Archived threads grouped by project (project favicon header), each row showing title + 'Archived {relative} · Created {relative}', sorted by archivedAt desc.
  — Reads core-projected thread shells (archivedAt); a real history surface.
- **Unarchive thread** `keep` `core-v1`
  Per-row 'Unarchive' button and context-menu 'Unarchive'; dispatches thread.unarchive.
  — Dispatch routes to honk().threads.unarchive in core service.ts (GAPS note about unsupported archive/delete is stale).
- **Delete archived thread** `keep` `core-v1`
  Context-menu 'Delete' (destructive), gated by delete-confirmation setting; dispatches thread.delete.
  — Routes to honk().threads.delete on core; real destructive action.
- **Archived empty state** `keep` `core-v1`
  Icon + 'No archived threads' / 'Archived threads will appear here.' when nothing archived.
  — Clear empty state; keep.
- **Native right-click context menu on archived rows** `rethink` `electron-local`
  onContextMenu opens the OS/native contextMenu.show with Unarchive / Delete(destructive) at cursor position.
  — Uses native menu via local-api — desktop-only; remote clients need an in-app menu for parity (the per-row Unarchive button already covers the common case).

**Open questions:**

- ADR 0014 pins model+thinking at thread creation — should Settings retain any 'default for new threads' seed for model/thinking/interaction-mode, and if so where does it persist on Core (which has per-send InteractionMode but no persistent default per GAPS)?
- Does the new Core expose skill discovery to all clients, or is the Skills browser dropped entirely? Same question for the static Subagents cards — real registry or cut.
- Which settings become Core-backed (synced across a user's devices for remote parity) vs intentionally per-device client-local (theme, fonts, hue, reduce-transparency, font smoothing)? Today the split is accidental (server vs client vs appearance planes).
- What is the remote-parity story for the desktop-only rows: keybindings editing (currently opens an external editor), diagnostics/logs access, and the archived-row native context menu?
- Keep the hand-maintained settings search index, or derive it from a single panel/registry definition to prevent drift?
- Should a single visible 'Restore defaults' entry replace the orphaned restore machinery, and at what scope (all vs per-section)?

## shell-chrome

- **Frameless titlebar drag regions** `keep` `electron-local`
  [data-shell-drag-region] maps to -webkit-app-region:drag; nested buttons/inputs/tabs/tool-island slots auto-flip to no-drag. Applied to sidebar top offset, sidebar header, and workbench tab-bar spacer so empty chrome drags the window.
  — Core desktop window affordance. Inherently shell chrome; web/mobile ignore -webkit-app-region so there is nothing to serve remotely — it degrades to inert, which is fine.
- **macOS traffic-light inset** `rethink` `electron-local`
  --honk-electron-traffic-inset:80px and --honk-electron-traffic-padding-top:26px reserve space for native traffic lights; the left sidebar toggle sits at that inset. Only under [data-electron]/[data-shell-platform=electron].
  — Hardcoded to macOS geometry. Rewrite needs a per-OS (Windows/Linux caption buttons) and web (no native controls) chrome plan, not a single 80px macOS inset.
- **Native window fullscreen state sync** `keep` `electron-local`
  getWindowChromeState/onWindowChromeState expose { fullscreen } so the shell can adapt to OS fullscreen.
  — Thin, correct desktop chrome hook. No remote equivalent needed.
- **Auto-expand window on workbench open** `keep` `electron-local`
  When the right workbench first opens and left+right+center-min exceeds shell width, expandWindowWidth(deficit) grows the OS window so the center is not crushed.
  — Good desktop ergonomics; guarded to electron only. On web/mobile the responsive overlay mode covers the same intent.
- **Native menu action bridge** `keep` `electron-local`
  onMenuAction listener; only the 'open-settings' action is wired to navigate to settings.
  — Minimal and correct. Any future native-menu commands should route through the same bridge rather than bespoke IPC.
- **Native theme/vibrancy/zoom/background sync** `keep` `electron-local`
  setTheme/setVibrancy/setBackgroundColor/setDisplayZoom push renderer appearance to the OS window; AppShell computes surfaceTheme + vibrancy from appearance settings and platform.
  — Desktop chrome that keeps the native frame matching in-app theme. Web has no window to sync; degrades cleanly.
- **Native context menu** `rethink` `electron-local`
  showContextMenu(items, position) renders an OS context menu and resolves the chosen id; schema-typed ContextMenuItem tree.
  — Desktop-only. A remote client (ADR 0022) needs an in-DOM context menu equivalent; the rewrite should own one menu primitive that works both places.
- **Desktop auto-update pill** `keep` `electron-local`
  Sidebar footer pill: shows version, or Update/Downloading %/Restart/Installing/Retry; install confirms when threads are running (lists titles); double-click dismisses; hidden on web.
  — Inherently desktop packaging chrome. Keep; the running-thread install guard is a good safety detail to preserve.
- **Three-column shell (sidebar / center / workbench)** `keep` `client-local`
  AppShell lays out LeftAside + center (chat or editor) + RightAside workbench with data-attributes driving CSS; center has a min width of 384px.
  — The fundamental frame. Layout is pure client composition; keep as the skeleton of the rewrite.
- **Left sidebar collapse/expand** `keep` `client-local`
  Titlebar toggle button (IconSidebar/IconSidebarHiddenLeftWide, aria 'Collapse/Expand chats', aria-pressed) toggles leftOpen; width animates like a curtain.
  — Standard, keyboard-labeled panel toggle. Keep.
- **Left sidebar column resize** `rethink` `client-local`
  Vertical sash (role=separator, aria 'Resize thread sidebar'), 180–560px, committed to persisted leftW; live width tracked imperatively during drag.
  — Mouse-drag sash has no touch story. ADR 0022 parity requires a resize affordance (or fixed widths) that works on a phone/browser.
- **Right workbench open / hide** `keep` `client-local`
  Titlebar 'Show project panel' button when collapsed; header 'Hide Panel' button; opening also unmutes queries.
  — Clear reversible disclosure. Keep.
- **Right workbench column resize** `rethink` `client-local`
  Left-edge sash, min 300px, max computed from shell width minus docked sidebar minus center-min so the center never starves.
  — Same drag-only limitation as the sidebar sash; the max-width solver is worth keeping, the interaction needs a touch path.
- **Responsive overlay-drawer mode** `keep` `client-local`
  Below width breakpoints the sidebar and secondary rail become overlay drawers with a blurred backdrop; click or Escape closes; exit is debounced 150ms to avoid flip-flop. React re-renders only on mode change, not per pixel.
  — This is the seed of mobile/browser parity (ADR 0022): the layout already thinks in modes not pixels. Build the phone shell on this, don't add a separate mobile layout.
- **Workbench fullscreen / maximize** `keep` `client-local`
  Expand/Minimize toggle in workbench header (both glyphs mounted, flipped via data-attr) maximizes the right panel over the center; Escape exits; editorPanel.toggleFullscreen keybinding; target keyed by workspace+thread; center is unmounted while maximized.
  — Useful focus mode with keyboard parity. Keep.
- **Center editor/chat swap** `rethink` `aux`
  Center region cross-fades between the chat conversation and a Monaco file editor surface using inert + aria-hidden toggling (both stay mounted).
  — File editing content comes from the desktop aux filesystem; per GAPS.md web/serve has no aux, so the editor half is desktop-only. Remote parity needs a Core-served file surface.
- **Per-workspace panel persistence** `keep` `client-local`
  Every panel dimension and state — left/right width+open, active tab, tab set, terminal sessions, browser state, secondary-rail — is keyed by workspaceKey and persisted to localStorage with Effect-Schema validation and legacy-key migration (honk.shell.panels.v3, agentLayout.shared.v6, etc.).
  — Strong pattern: users get their exact layout back per project. Keep — but it is per-device localStorage only, which conflicts with ADR 0022 parity (a phone starts blank); decide sync vs per-device.
- **Workbench tab bar** `rethink` `client-local`
  Right-panel tabs (Changes, Terminal(s), Browser(s), Files, Plan, Dev) with drag-to-reorder (custom drop indicator), horizontal scroll with start/end edge masks, and active-tab scroll-into-view.
  — Tab management is sound but reorder is HTML5-drag only. Keep the tab model; the drag interaction needs a touch equivalent for parity.
- **Workbench tab close affordances** `keep` `client-local`
  Per-tab hover close button (opacity-0 → group-hover), middle-click (auxclick) to close, non-closable pinned tabs (Changes/Files), preview tabs italic.
  — Conventional editor-tab affordances. Keep; note hover-only close needs a visible touch target on mobile.
- **New Tab menu** `keep` `client-local`
  '+' menu in workbench header offering Changes / Terminal / Browser / Files.
  — Discoverable way to add panels. Keep.
- **Git 'Changes' workbench tab** `rethink` `aux`
  Default pinned tab hosting the git status/diff panel; refreshes on focus/visibility and after agent git actions.
  — Backed by desktop aux git; GAPS.md: web/serve has no aux so git is unavailable. ADR 0022 requires a Core-served git surface for remote clients.
- **Terminal workbench tab(s)** `keep` `core-v1`
  Multiple terminal sessions with a session rail (toggle/resize), new/close, per-tab reset, and a running-process close-confirmation dialog.
  — Terminals map to honk.terminals (core/v1). Keep; note GAPS.md gaps: clear/history truncation and per-terminal env/worktree overrides are unsupported.
- **Browser workbench tab(s)** `rethink` `electron-local`
  In-app browser panel (webview) with location bar, favicons, multiple tabs; opened directly or via desktopBridge.onBrowserAutomationOpen for a thread.
  — Implemented as an Electron webview — no web/mobile equivalent. Decide whether an embedded browser ships at all; if so it needs a remote-parity design.
- **Files workbench tab + project file tree** `rethink` `aux`
  File tree + Monaco editor with preview vs durable tabs, file-type favicons, rename propagation to tab ids.
  — Filesystem is desktop aux (GAPS.md: unsupported on web/serve). Needs a Core-served project filesystem for parity.
- **Plan workbench tab** `keep` `core-v1`
  Proposed-plan markdown view with implement action and todo sync; label toggles Plan/Tasks; appears only when a plan exists or plan mode is active.
  — Plan proposals are Parts and survive (ADR 0007). Keep the tab; note GAPS.md flags plan-markdown update dispatch as not yet served by the core adapter, so edit/save needs verification.
- **Dev workbench tab** `kill` `legacy-dead`
  Command-palette 'Open Dev Panel' inspects thread runtime, context usage, timeline, and session tree.
  — Inspects the runtime host that the cutover removed; the underlying runtime store no longer receives events and the runtime API stub rejects. Dead developer scaffolding — drop from the product.
- **Secondary rail (terminal sessions)** `keep` `client-local`
  Collapsible rail inside the terminal tab listing sessions; toggle + resize (160–320px), per-workspace+tab persisted; goes overlay below breakpoint.
  — Reasonable secondary navigation. Keep.
- **Fullscreen chat title in workbench header** `keep` `client-local`
  When maximized, header shows the active thread title with a tooltip and divider.
  — Orienting context when the chat is hidden behind a maximized panel. Keep.
- **Chat-pane tiling: split** `rethink` `client-local`
  Tile overflow menu (dot-grid) offers Split right / Split below to add a new-agent pane beside the current one; maximize/restore and close a tile; per-route tileset persisted (agentLayout.shared.v6).
  — Power feature but entirely mouse/menu + drag driven and stored per-device. ADR 0022 parity: needs a touch story or explicit desktop-only gating.
- **Chat-pane tiling: drag-to-tile from sidebar** `rethink` `client-local`
  Drag a thread, a draft, or the 'New Agent' button onto a pane; a 5-zone drop overlay (top/right/bottom/left/center) shows where it lands and creates the split.
  — HTML5 drag with edge-zone geometry — no touch equivalent. Core interaction of the tiling system; must be redesigned for phone/browser parity.
- **Chat-pane tiling: relocate/merge tiles** `rethink` `client-local`
  Drag a tile's header onto another pane's zone to move or merge it; disallowed-zone computation prevents invalid drops.
  — Same drag-only constraint. Keep the layout algebra (split/close/expand/focus), rework the input.
- **Chat-pane tiling: focus + expand + close** `keep` `client-local`
  Clicking/focusing a pane sets the focused tile (also drives sidebar selection); expandedPanelId maximizes one tile; close collapses back to single pane.
  — The state model (focus/expand/close) is clean and input-agnostic; keep it and give it non-drag controls.
- **Command palette open/search** `keep` `client-local`
  ⌘K (when not terminal-focused) or the sidebar Search button opens a fuzzy palette over Commands / Workspaces / Recent Threads (12) with ranked matching; '>' prefix filters to actions only; empty states 'No matching actions.' / 'No matching commands, projects, or threads.'
  — The universal entrypoint; ranking and empty states are solid. Keep as the spine of navigation.
- **Command palette submenu stack** `keep` `client-local`
  Submenu views ('New thread in…' → project picker) push a view with add-on icon and placeholder; Back button and Backspace-on-empty pop; add-project intent can pre-open the project view.
  — Good drill-down model with keyboard affordances. Keep.
- **Palette navigation actions (projects/threads)** `keep` `core-v1`
  Open project, New thread in current/other project, open recent or searched thread — all persist project selection and route.
  — Backed by core/v1 thread + workspace read model. Keep.
- **Palette: Add Project** `rethink` `aux`
  Opens a native folder picker and registers the project in the aux projects registry; errors with 'Add Project is only available in the desktop app.' on web.
  — Desktop-only (native dialog + aux registry). ADR 0022 parity requires a remote way to add/select a project rather than a desktop gate.
- **Palette: composer mode actions** `keep` `core-v1`
  Agent / Ask / Plan / Debug entries set the focused composer's per-send interaction mode (with keybinding labels); Multitask is added only when a local feature flag is on.
  — Interaction mode is per-send, not model — survives ADR 0014 (which only kills mid-thread model switching). Keep Agent/Ask/Plan/Debug; treat Multitask as flagged scaffolding.
- **Palette: dev/feature-flag entries** `kill` `client-local`
  Enable/Disable Multitask Mode (local flag), Open Dev Panel, Copy server trace path (DEV), Open Component System (DEV).
  — Developer-only tooling mixed into the shipping palette, gated only by import.meta.env.DEV or a local flag. Move to a separate dev registry so the product palette stays trustworthy.
- **Palette: workspace utilities** `rethink` `aux`
  Open workspace in editor (preferred external editor), Copy workspace path, Open settings, Open keyboard shortcuts (opens the keybindings file in an editor).
  — Copy-path is universal (keep), but 'open in editor'/'open keybindings file' rely on a local editor + filesystem and are desktop-only; remote clients need served equivalents or these hidden.
- **Keybinding engine** `keep` `core-v1`
  Server-provided keybindings (useServerKeybindings) with a ⌘K fallback; when-clause AST evaluation (terminalFocus/terminalOpen context), platform-aware mod (⌘ vs Ctrl), last-binding-wins conflict resolution, and mac-symbol vs '+'-join label formatting.
  — Data-driven, remotable foundation (config is served; evaluation is client). Keep the engine wholesale.
- **Shell-level shortcut handlers** `keep` `client-local`
  Window-level keydown handlers for commandPalette.toggle, editorPanel.toggleFullscreen, terminal.toggle/split/new/close, and Escape (exit fullscreen / close overlay), each reading fullscreen/terminal state at event time to avoid re-subscribing.
  — Correct, low-churn wiring. Keep; the 'read state at event time' pattern keeps chrome from re-rendering.
- **Sidebar header actions** `keep` `client-local`
  New Agent (label hardcodes '⌘N', draggable to create a tile) and Search (label read from keybindings); optional Open Workspace.
  — Keep — but unify shortcut-label sourcing: New Agent hardcodes ⌘N while Search derives its label from the config; they should both derive.
- **Sidebar footer + settings entry** `keep` `client-local`
  Version/update pill plus a Settings gear (router link / toggle).
  — Standard footer chrome. Keep.
- **Settings shell** `keep` `aux`
  Settings mode swaps the sidebar for a nav rail (sections, Back to chat) with an autocomplete settings search (empty 'No matching settings.'); shares the same AppShell frame.
  — Reusing the shell for settings is good. Settings persistence is aux/client; keep the frame, ensure settings read/write has a remote path.
- **Terminal close confirmation dialog** `keep` `core-v1`
  Closing a terminal tab with a running process opens an AlertDialog ('A process is still running… Closing the tab will terminate it') before killing it.
  — Genuine shell-chrome safeguard backed by core terminal running-state. Keep.
- **Git-agent action orchestration (hosted in shell-host)** `kill` `legacy-dead`
  ShellHost starts one-shot git-agent turns via the core turn-send path, but the STOP path calls readHonkRuntimeApi().abort() and marks agent-runtime-store.markLocalRuntimeThread.
  — readHonkRuntimeApi().abort() always rejects ('Runtime host unavailable after core cutover') and agent-runtime-store no longer receives events, so stopping a git action is severed. Don't port this wiring; route stop through the core interrupt used elsewhere.

**Open questions:**

- Should shell layout state (tilesets, tab sets, panel widths, terminal/browser sessions) sync across devices through the Core, or remain per-device localStorage? Current implementation is device-local, which collides with ADR 0022 remote parity (a phone opens a workspace blank).
- How does chat-pane tiling (split/drag-to-tile/relocate) translate to touch and small screens — is it a desktop-only power feature that gracefully collapses to single-pane on phone, or must it be fully touch-redesigned?
- Does an embedded browser panel ship in the product? It is currently an Electron webview with no web/mobile equivalent; if it ships, it needs a remote-parity design, and if not, the Browser tab and browser-automation-open bridge should be dropped.
- Are the Dev panel and the local Multitask feature flag part of the product or dev-only? Both currently surface in the shipping command palette but depend on removed/flagged runtime.
- What is the cross-platform window-chrome plan? The traffic-light inset is hardcoded to macOS geometry (80px / 26px); Windows/Linux caption buttons and web (no native frame) need a defined chrome story.
- Is git-agent action orchestration (start one-shot git turns from the shell) staying, and if so, how does its stop path route now that readHonkRuntimeApi().abort() is a rejecting stub — through the core interrupt used by normal turns?

## sidebar-workspace

- **New Agent (header button, ⌘N, draggable)** `keep` `core-v1`
  Top 'New Agent' button in the sidebar header creates a draft/thread in the current project context; shows a hardcoded ⌘N hint; is itself draggable to drop a 'new-agent' payload onto a chat pane tile. Mirrored by per-section '+' buttons.
  — Primary creation entry; resolves to thread.create via core dispatch (service.ts dispatchCoreThreadCreateCommand). Keep. Note the ⌘N label in header.tsx is hardcoded rather than read from server keybindings (the Search shortcut IS read live), so the two shortcut hints diverge in source of truth.
- **Per-project '+' new agent** `keep` `core-v1`
  Hover-revealed '+' on each project section header starts a new agent scoped to that project's cwd (section.canCreateAgent gate; hidden on the Pinned section).
  — Scoped creation is a genuinely useful affordance. Keep. Discoverability is hover-only ([@media(hover:hover)]) — needs a touch equivalent for ADR 0022 phone parity.
- **Search (opens command palette)** `keep` `client-local`
  Header 'Search' row opens the command palette; displays the live server keybinding label (falls back to COMMAND_PALETTE_FALLBACK_KEYBINDINGS).
  — Trigger only; the palette is a separate surface. Keep as the sidebar's search entry point.
- **Open Workspace / Add project (native folder picker)** `rethink` `aux`
  Header 'Open Workspace' button plus the in-collection folder-add icon and the inline 'Open Workspace' row; opens a native OS folder dialog and registers the project in the desktop aux /projects registry.
  — Depends on the desktop aux registry + a native dialog; GAPS.md confirms web/serve mode 'exposes no projects.' ADR 0022 demands a phone/browser can add a workspace too — the rewrite needs a non-native path (remote repo picker / server-side project registry).
- **Thread rows: list, select, open** `keep` `core-v1`
  Server-thread rows render title (thread name → first message → 'Untitled'), relative time, and a status slot; click opens the thread and marks it visited; retains a core detail subscription for 10s on select.
  — The heart of the surface, served by core/v1 workspace summaries. Keep.
- **Row status vocabulary (idle/running/needs_attention/stopped/error)** `keep` `core-v1`
  threadState() collapses orchestration status + latest-turn metadata into five states rendered as distinct StatusDot glyphs (running=animated ChatLoaderGlyph, needs_attention=warning, stopped=inactive, error=critical), plus doneSeen/doneUnseen and an archive icon.
  — Strong, legible status language — keep as the canonical row vocabulary. But it currently reconstructs state client-side: core summaries ship latestTurn:null (GAPS.md), so running/unread lean on session.activeTurnId + a client visit boundary. Rewrite should have Core serve one authoritative row status.
- **Needs-attention signal** `rethink` `core-v1`
  A 'needs_attention' state/dot and a matching filter, surfaced when the thread is waiting on the user.
  — App-side needsSidebarAttention() ORs hasPendingApprovals || hasPendingUserInput || hasActionableProposedPlan. ADR 0007 kills approvals (core already forces hasPendingApprovals=false), and ask-question survives; but core ALSO forces hasActionableProposedPlan=false, so plan-proposal attention is dropped today. Rewrite: drive needs-attention from ask-question + plan-proposal Parts and wire the plan case that's currently silent.
- **Running loader glyph + finish pulse** `keep` `client-local`
  Active turns show an animated ChatLoaderGlyph; when a running turn settles, the dot plays a ~720ms finish animation before resolving to its idle/unread state.
  — Purely presentational polish that reads well; keep.
- **Unread indicator + mark read/unread** `rethink` `client-local`
  Accent 'doneUnseen' dot when a thread has readable activity newer than the last visit; context-menu 'Mark as unread' rewinds the visit boundary; visiting a thread marks it read.
  — Unread boundary lives in localStorage (threadLastVisitedAtById), so it does not sync across devices — a phone and desktop show different unread state (tension with ADR 0022 spirit). Also depends on latestReadableAt, which core summaries currently null out (GAPS.md), degrading detection. Rewrite: decide account-sync vs per-device and source readableAt from Core.
- **Status filter menu (Running/Needs attention/Idle/Stopped/Error + Archived)** `keep` `client-local`
  Hover/focus-revealed filter icon in the Workspaces header opens a multi-select checkbox menu; empty filters show all non-archived threads, status filters narrow by derived row state, 'Archived' opts archived threads in. Active filters highlight the trigger. Persisted.
  — Good scoping tool. Keep. Persistence is localStorage-only (sidebarThreadFilters) so it does not sync across clients; trigger is hover-revealed (touch discoverability gap).
- **Inline rename** `keep` `core-v1`
  Context-menu Rename swaps the row for a focused text input (auto-select); Enter commits, Escape cancels, blur commits; empty title → warning toast and revert.
  — Served via thread.meta.update in core dispatch. Keep (GAPS.md's 'thread metadata commands unsupported' note is stale; service.ts wires thread.meta.update).
- **Archive / unarchive (+ destructive-confirm dialog)** `keep` `core-v1`
  Hover Archive/Unarchive icon and context-menu item toggle archived state; archived rows mute + show an archive icon; archiving threads with active work raises an AlertDialog confirm ('Archive agent?').
  — thread.archive/unarchive are wired in core dispatch. The confirm dialog is a destructive-action guard, NOT an approval panel, so ADR 0007 does not kill it. Keep.
- **Fork chat** `kill` `legacy-dead`
  Context-menu 'Fork chat' (shown only for DESKTOP_RUNTIME_ENVIRONMENT_ID threads) clones a thread into a new sibling.
  — Routes through readHonkRuntimeApi().cloneThread, which the post-cutover stub implements as () => rejectUnavailable() ('Runtime host unavailable after core cutover'). The menu item still renders but the action always throws. Kill, or re-introduce as a Core-served branching feature.
- **Copy thread ID** `keep` `client-local`
  Context-menu action writes the resolved thread id to the clipboard.
  — Cheap developer/debug affordance; harmless. Keep or demote — low priority.
- **Project section: expand / collapse** `keep` `client-local`
  Folder row toggles thread visibility; folder glyph animates closed→open→chevron on hover; state persists per project (projectExpandedById keyed by a derived project state key), defaulting to expanded.
  — Standard grouping control. Keep. Persistence is localStorage-only; the closed/open/chevron triple-glyph hover swap is desktop-hover-first.
- **Project drag-to-reorder** `rethink` `client-local`
  Project sections are HTML5-draggable; a before/after drop-indicator line renders from cursor position (40%/60% hysteresis); reorder persists to projectOrder. Pinned section is not reorderable.
  — Native HTML5 drag is unreliable on touch and conflicts with scroll; order persists only in localStorage. For ADR 0022 phone parity the rewrite needs a pointer/touch-capable reorder (and to decide if order is account-synced).
- **'More' pagination within a project** `rethink` `client-local`
  Each project shows the first 5 threads; a 'More' row reveals +8 per click; the list auto-expands enough to keep the selected thread visible, and collapses the last single-item gap.
  — Manual paging is a workaround for an unvirtualized list. Rewrite should consider virtualized scrolling instead of click-to-reveal-more, especially for large workspaces.
- **Pinned section + pin/unpin** `keep` `client-local`
  Pinned threads float into a top 'Pinned' group (no new-agent/editor actions); hover pin icon and context-menu toggle pinning.
  — Useful prioritization. Keep. Pins live in localStorage (pinnedThreadKeys) and do not sync across devices — reconsider for account-level sync under ADR 0022.
- **Project context menu: Mark All as Read / Archive All** `keep` `core-v1`
  Right-click a project section for 'Mark All as Read' (rewinds visit boundary for all section threads) and 'Archive All' (bulk archive, disabled when the section has no threads).
  — Bulk hygiene actions; Archive All → core, Mark All Read → client-local visit tracking. Keep.
- **Project context menu: Open in Editor Window / Remove from Sidebar** `rethink` `aux`
  Right-click a project for 'Open in Editor Window' (resolves preferred editor via aux server config and launches it) and 'Remove from Sidebar' (deletes the project from the aux registry; shown only when the project has a registry ref).
  — Both depend on the desktop aux server (editor launch + /projects registry); unavailable in web/serve mode per GAPS.md. ADR 0022 remote parity → rewrite needs remote-safe equivalents (or explicitly desktop-only gating).
- **Draft rows (unsent agents)** `rethink` `client-local`
  Composer drafts appear as sidebar rows with a hollow 'draft' dot (or 'running' while submitting); title is derived live from the draft's first prompt line or first attachment name, with markdown skill-preview tokens compacted to $name.
  — The draft-row concept (a pending, unsent agent) should survive. But its title is derived from composer rich-text/prompt-token document state; ADR 0013 pins the wire to raw text + Prompt Tokens, so the underlying draft content model and token-preview stripping must be reworked. Keep the row, rethink the content source.
- **Clear draft** `keep` `client-local`
  Hover 'X' on a draft row discards the unsent draft, clears local send artifacts, and navigates to a fallback thread (or the chat index) if the cleared draft was selected.
  — Necessary lifecycle control for drafts. Keep.
- **Drag thread/draft/new-agent row into a chat pane tile** `rethink` `client-local`
  Thread, draft, and header 'New Agent' rows are draggable with a cloned glass drag-preview; dropping onto the tiling surface opens/creates that agent in a specific pane/zone.
  — Native-drag placement into the desktop tiling shell; inherently desktop and touch-hostile. Rewrite: keep only as a gated desktop power-feature (or drop if tiling is removed); phones need a plain tap-to-open.
- **Workspaces collection wrapper (collapse + empty state)** `keep` `client-local`
  All project sections nest under a collapsible 'Workspaces' header (local collapse state, not persisted); shows a 'No recent workspaces' placeholder row and an inline 'Open Workspace' row when empty.
  — Reasonable top-level grouping. Keep, but note its collapse state is ephemeral useState (resets on remount) unlike per-project state — inconsistent persistence to reconcile.
- **Loading / error / empty states** `keep` `client-local`
  Skeleton shimmer (2 groups × 3 rows) while bootstrapping; 'Unable to load chats right now.' on error; 'No chats yet. Start a chat to begin.' when there are no sections and no add-workspace affordance.
  — Complete state coverage. Keep; refresh copy/visuals in the rewrite.
- **Sidebar resize + visibility toggle + overlay drawer** `keep` `client-local`
  A vertical sash resizes the docked sidebar (only in inline-expanded presentation); the sidebar can be hidden (leftOpen/toggleLeft) and, at narrow widths, switches to an overlay/drawer presentation.
  — Shell chrome. The overlay/drawer mode is exactly the responsive path ADR 0022 needs for phones — keep and lean on it as the mobile presentation.
- **Footer: Settings gear** `keep` `client-local`
  Bottom-left gear links to the default settings route (or toggles back to chat when already in settings).
  — Navigation entry point; keep.
- **Footer: UpdatePill** `keep` `electron-local`
  Desktop app auto-update indicator/button (download/install available update) in the sidebar footer.
  — Inherently desktop shell chrome (app self-update); irrelevant on web. Keep as desktop-only chrome per ADR 0022's shell-chrome carve-out.
- **Window drag region** `keep` `electron-local`
  A top-strip [data-shell-drag-region] over the traffic-light padding makes the sidebar top draggable for moving the window (Electron only).
  — Inherently native-window chrome; keep as desktop-only.

**Open questions:**

- Which organizational state (pins, unread, filters, project order, expand/collapse) should be account-synced through Core vs kept per-device? Today all of it is localStorage-only, violating the spirit of ADR 0022 remote parity.
- Will Core serve one authoritative per-row status (running/needs_attention/stopped/error + latestReadableAt + needsAttention incl. plan proposals) so the sidebar stops reconstructing state from session.activeTurnId + client visit boundaries?
- Does the rewrite keep project-first grouping backed by a stable Core projectId (retiring cwd-string keys, worktree special-casing, and 'retained empty project' logic)?
- Is thread cloning/branching a product feature the new Core should serve? 'Fork chat' is currently legacy-dead (all-rejecting runtime stub) and desktop-gated.
- Is the thread/draft → chat-pane tiling drag kept as a gated desktop-only power feature, or is tiling dropped in the rewrite? It's native-drag and touch-hostile.
- How do desktop-aux-only capabilities (Open Workspace / native picker, Open in Editor Window, Remove from Sidebar) work on a phone/browser under ADR 0022 — remote project registry + repo picker, or explicit desktop-only gating?
- Should the rewrite add a sidebar density and/or a working thread sort control? Neither exists today (the named sort setting doesn't reorder the sidebar; density is transcript-only), and 'More' pagination is a stand-in for a virtualized list.

## status-notifications

- **In-thread working/waiting status row** `keep` `core-v1`
  Between send and first output, the timeline shows a status row labelled 'Planning next moves', escalating to 'Taking longer than expected…' after 15s of the active turn (waiting-status.ts thresholds). Drives off active-turn startedAt.
  — Core exposes activeTurn timing; a pre-first-token 'agent is working' affordance is essential. Copy/threshold are tunable, but the capability stays. status-row.tsx renders via step-renderer.tsx:499.
- **Animated 'thinking' matrix loader glyph** `keep` `client-local`
  Dot-matrix diagonal-sweep animation (ChatLoaderGlyph / ChatLoaderMatrix) used as the running spinner in the sidebar and status row; grid auto-sizes to line height/extent and honors prefers-reduced-motion (falls to a static 0.55-opacity state).
  — Pure presentational, reduced-motion-aware, remote-safe. The shared implementation lives in `packages/ui/src/matrix.tsx`.
- **Sidebar thread status-dot state machine** `keep` `core-v1`
  Each sidebar row shows a StatusDot whose state is derived (view-model.ts threadState): error(critical) / stopped(inactive) / needs_attention(warning) / running(animated glyph) / idle, plus overlays: unread→doneUnseen(accent) vs doneSeen(quaternary), draft(hollow ring), archived(archive icon). StatusSlot hides the dot for idle/seen/non-draft rows.
  — A single well-modeled status vocabulary (`packages/ui/src/status-dot.tsx`) drives the whole sidebar. Preserve the vocabulary; only the needs_attention input changes (see below).
- **Sidebar 'finishing' transition animation** `keep` `client-local`
  When a row goes running→settled, StatusSlot plays a 720ms finish pulse (agent-sidebar-status-finish) before resting on the seen/unseen dot; resets on row identity change.
  — Small motion polish that signals completion; remote-safe. status.tsx:60-106.
- **Unread (doneUnseen) accent tracking** `keep` `core-v1`
  Threads that produced readable output since your last visit render an accent dot; computed from latestReadableAt vs lastVisitedAt visit boundary (use-agent-sidebar-model.ts isUnreadFromVisitBoundary).
  — The primary in-app signal that a background thread finished (completions produce no toast). Keep, but pair with a decision on whether completion should also toast.
- **Base-UI toast system (mounted)** `keep` `client-local`
  The actually-rendered toast stack (app/toast.tsx, mounted in -root-route.tsx via ToastProvider). Five types (error/info/loading/success/warning) with per-type icon + color, a spinning loader icon, stacked/peeking layout that expands on hover, directional swipe-to-dismiss, and a dismiss button.
  — This is the real toast pipeline. Remote-safe. Keep as the single system and delete the parallel one.
- **Sonner toast calls (unmounted / no-op)** `kill` `client-local`
  A second toast API (`toast` from 'sonner') is imported and called in 9 shell files (git 'Path copied', file-tree errors, plan save/copy, project archive/rename errors, 'Update downloaded', etc.) — but no <Toaster> is mounted anywhere in current source, so these calls push to sonner's store and never render.
  — Duplicate system with no viewport → user-facing success/error feedback silently vanishes. Consolidate every call onto the base-UI manager in the rewrite. (grep: no 'Toaster' in packages/*/src; sonner CSS only survives in stale out/ build.)
- **Thread-scoped toast filtering** `rethink` `client-local`
  Toasts can carry data.threadRef/threadId; the viewport (shouldRenderThreadScopedToast) only renders a scoped toast when that thread is the active route target, otherwise suppresses it. Unscoped toasts always render.
  — Good idea for thread-local feedback, but it collides with cross-thread attention alerts (see learnings): an input-needed toast scoped to a backgrounded thread is filtered out. Keep for thread-local toasts; do not scope global attention alerts.
- **Toast auto-dismiss by visible time** `keep` `client-local`
  dismissAfterVisibleMs counts down only while the window is focused+visible, pausing on blur/hidden and persisting remaining time in a module map (ThreadToastVisibleAutoDismiss). Attention toasts use 8s visible time.
  — Correct behavior — a notification shouldn't expire while you're away. Remote-safe. Worth preserving in the unified pipeline.
- **Toast action button + Copy-error button** `keep` `client-local`
  Toasts support a primary action (attention toasts render 'Open' → navigates to the thread) and error toasts render a Copy-error icon-button that copies the description with a check-mark confirmation.
  — Actionable toasts and copyable errors are good UX. Note the 'Open' action is undermined by thread-scoping today (learnings).
- **Anchored / tooltip toasts** `keep` `client-local`
  A second provider (AnchoredToastProvider + anchoredToastManager) positions toasts against an anchor element via Popover positioner, with a compact 'tooltip' chrome variant (title only).
  — Contextual inline confirmations. Remote-safe; fold into the one toast system.
- **Task-completion OS notification (background only)** `rethink` `core-v1`
  TaskCompletionNotifications subscribes to sidebar summaries; when a thread settles (turn completed, no active orchestration) and the window is backgrounded, it fires an OS Notification titled with the thread name, body 'Finished working.', click → focus window + thread. No in-app toast is shown for completions.
  — Capability is right but degraded: fires only when backgrounded, and the wired summary-path passes assistantSummary:null so the body is always generic despite a richer summarizer existing. Decide a consistent in-app + OS completion model.
- **Input-needed notification (toast + OS)** `keep` `core-v1`
  When a thread transitions to needing input (hasPendingUserInput rising, excluding plan-review), shows a warning toast ('Input needed — <thread>: User input requested') and, if backgrounded, an OS notification; de-duped via localStorage seen-ids (200 cap) and suppressed for the currently-visible thread.
  — The ask-question flow survives ADR 0007 as Parts, and core maps hasPendingUserInput = summary.needsAttention (service.ts:397). Keep the alert; fix the scoping bug so it actually renders for backgrounded threads.
- **Approval-needed notification path** `kill` `core-v1`
  collectThreadAttentionCandidates + approvalSummary build request-kind-specific copy ('Command/File-read/File-change/Permissions/MCP/Tool/Auth-refresh approval requested') and the summary collector watches hasPendingApprovals to raise approval toasts/OS notifications.
  — ADR 0007: no approval UI in the new product. Core already hardcodes hasPendingApprovals:false (service.ts:396), so this branch is already dead; delete the copy machinery and the approval collector.
- **Plan-review attention flag + suppression** `rethink` `core-v1`
  isPlanReviewAttentionSummary/hasActionableProposedPlan gate the sidebar needs_attention dot and exclude plan-review threads from the 'user input' toast path so plans surface differently.
  — Plan proposals survive as Parts (ADR 0007), but core hardcodes hasActionableProposedPlan:false (service.ts:398), so this summary-level flag is vestigial. Re-model plan attention as a typed Part-driven signal rather than a boolean summary flag.
- **Browser/OS Notification delivery** `keep` `client-local`
  showSystemThreadNotification wraps the Web Notification API (title/body, tag per thread for coalescing, click→window.focus + focusThread). Guarded by permission + secure-context checks.
  — Web Notification API is remote-capable (works in a browser/phone client with permission), satisfying ADR 0022 in principle — but see the missing permission entry point below.
- **Notification permission state + request + copy** `rethink` `client-local`
  readBrowserNotificationPermissionState (granted/denied/insecure/unsupported/default), requestBrowserNotificationPermission, and buildNotificationSettingsSupportText (per-state help copy) are exported — but not called by any settings/onboarding UI. Desktop auto-grants 'notifications' to the trusted renderer (desktop-window.ts:31).
  — No UI ever requests permission, so browser/remote users (ADR 0022) cannot enable OS notifications; it only works because Electron auto-grants. The rewrite needs an explicit enable-notifications affordance for remote parity.
- **Subagent status rows** `keep` `core-v1`
  In the timeline, spawned subagents render as two-line rows (Cursor parity, tool-message.tsx SubagentStatusRow): role indicator + active label ('Oracle manifesting' / 'Librarian researching' / 'Worker handling' or the finished title) with the latest update on its own line; clickable when details exist; data-subagent-state reflects running/completed/error.
  — Core emits subagent.* activities (api/core/v1/tool.ts), so this is live under core, not legacy-dead. A distinctive multi-agent status affordance to preserve.
- **Subagent activity tray (transcript popover)** `keep` `core-v1`
  Clicking a subagent row opens a Popover tray (subagent-tray.tsx) with a virtualized transcript of that subagent's messages/reasoning/tool calls/commands, auto-follow-on-append while streaming, role/title header, close button, and an empty state 'No thread content yet.'
  — Drill-down into a working subagent is core to the multi-agent story and is core-fed. Remote-safe. Keep; the popover-anchoring may need a rethink for small/phone viewports.
- **Subagent activity projection store** `keep` `core-v1`
  subagent-activity-store.ts projects per-thread ordered subagent activities into WorkLogSubagent view models (status label, isActive, used/max tokens + usedPercentage, logs, transcript items), rAF-batched, transcript-included only when the tray is open, capped at 500 activities.
  — Backing model for the subagent status/tray; fed from core thread activities via thread-store/thread-sync. Keep the read-model; the transcript-lazy optimization is worth carrying.
- **Desktop update pill** `rethink` `electron-local`
  Sidebar pill (update-pill.tsx) reflecting DesktopUpdateState: 'Update · vX' / 'Downloading N%' / 'Installing · vX' / 'Restart · vX' / 'Retry · vX'; disabled while downloading/installing; success toast 'Update downloaded' (sonner→currently no-op); double-click to dismiss; falls back to a plain current-version label. Confirms install if agents are running.
  — Auto-update is inherently desktop shell chrome (gated on isElectron), fine to keep as chrome — but the success feedback rides the unmounted sonner path and must move to the real toast system.
- **Running-agents quit guard** `keep` `electron-local`
  desktop-active-work-bridge.ts publishes runningThreadCount + titles to Electron (bridge.setActiveWorkState) on every store change; the main process shows a native 'Threads are still running' confirmation dialog before quitting (desktop-quit-guard.ts).
  — Status-driven safety gate; inherently shell chrome (you can't 'quit' a browser tab), so desktop-only is acceptable under ADR 0022. Keep as chrome.
- **Dock icon (static, appearance setting)** `keep` `electron-local`
  Electron sets a static dock icon (classic/midnight per appearance setting; setDockIcon). No badge count for unread/needs-attention is set anywhere.
  — Chrome. Note the gap: there is no dock/badge count reflecting unread or needs-attention agents — an opportunity for the rewrite (see learnings).
- **Root status / boot page** `keep` `client-local`
  RootStatusPage (-root-status-page.tsx) renders full-screen title/description/optional monospace details/optional actions for boot, auth-required, and connection-failure states.
  — Connection/boot status is universal and remote-relevant. Keep; align styling with the new design system.
- **Agent status-indicator design exploration (root HTML)** `rethink` `client-local`
  agent-working-status-indicators.html is a standalone reference doc (rendered component examples, an 'indicator inventory', and a 'sidebar status-dot trigger map'); not imported by any source.
  — Not a shipped capability — a design artifact. Fold its indicator inventory into the rewrite's design system, then retire the loose HTML file.

**Open questions:**

- Which toast library survives as the single pipeline — base-UI (currently mounted) or sonner — and who owns migrating the ~30 sonner call sites?
- Should thread-completion produce an in-app toast (not only a background OS notification), and should its body carry the assistant's summary line rather than generic 'Finished working.'?
- Post-ADR-0007, how is 'attention' typed (ask-question Part vs plan-proposal Part), and how does each type map to the sidebar dot color and to any toast/OS alert?
- What exactly sets CoreThreadSummary.needsAttention today (ask-question only?), and do plan proposals surface through a separate Part channel that the sidebar/notifications should read instead of the hardcoded-false summary flags?
- What is the remote/phone notification delivery story under ADR 0022 — Web Push + service worker, plus an explicit permission-enable UI — given the current OS-notification path only works because Electron auto-grants permission?
- Should the rewrite add an aggregate indicator (dock/badge count and/or in-app pill) for working + needs-attention agents, and is it required to be remote-capable rather than the current desktop-only quit-guard use of that data?

## workbench-browser

- **In-app browser panel (Electron webview)** `rethink` `electron-local`
  A workbench tab hosting an Electron `<webview>` (persist:honk-browser partition, sandboxed, preload-injected) that renders live web content inside the app. This is the container everything else hangs off.
  — Entire panel depends on the Electron `<webview>` tag and window.desktopBridge IPC; it cannot function in a plain browser/phone client. ADR 0022 makes remote parity absolute, so the rewrite must re-found this on a remote-capable transport (streamed server-side browser / screencast) or accept it as inherently shell chrome. Product value (agent-drivable local preview) is worth keeping; the webview implementation is not portable.
- **Location bar / omnibox with URL normalization** `keep` `client-local`
  Text input that accepts a URL or search query. normalizeBrowserNavigationInput resolves scheme (http/https/file/about), rewrites localhost/127.0.0.1 to http://, promotes bare domains to https://, and falls back to a Google search URL. Placeholder shows the first detected localhost server or 'Search or enter URL'.
  — Pure UI + string logic with no permission/composer/model concerns, so ADRs 0007/0013/0014 don't bite. The omnibox heuristics are sound and reusable. Keep the behavior; it just needs to drive whatever remote-capable web view replaces the webview.
- **Segmented committed-URL display** `keep` `client-local`
  When unfocused with a committed URL, the raw input is hidden (sr-only) and a segmented, click-to-edit rendering shows: muted scheme, emphasized host, muted path/query/hash. Clicking focuses+selects the input.
  — Good affordance (host emphasis aids scanning, click-to-edit is expected). formatBrowserLocationSegments is portable pure logic. Carry into the rewrite.
- **Back / Forward / Reload navigation controls** `rethink` `electron-local`
  Icon buttons for goBack/goForward (disabled via canGoBack/canGoForward), and reload (disabled when no page). Reload shows a spinner overlay and hides the reload glyph while isLoading; navigation state is re-synced ~120ms after back/forward.
  — Standard and worth keeping as UX, but the state (canGoBack/canGoForward/isLoading) is read directly off the Electron webview via getURL/canGoBack/did-*-loading events. Remote parity requires this history/loading state to arrive over the wire from a server-side browser session instead of the local webview.
- **Loading indicator (spinner + location-bar underline accent)** `rethink` `electron-local`
  Reload button swaps to a spinning ring while loading; the location bar grows a bottom accent underline. Driven by did-start-loading / did-stop-loading webview events.
  — Keep the visual language; the loading signal currently comes from webview DOM events and must be re-sourced from a remote session for parity.
- **'More' actions kebab menu** `rethink` `electron-local`
  Menu with Take Screenshot, Hard Reload, Copy Current URL, and Clear Browsing History / Clear Cookies / Clear Cache. All items disable when there is no committed page.
  — The menu structure is fine, but every action bottoms out in Electron-only capabilities (capturePage, reloadIgnoringCache, clearBrowserPartitionStorage, webview.clearHistory). Rethink which of these even make sense against a remote/streamed browser.
- **Screenshot to clipboard** `rethink` `electron-local`
  Take Screenshot calls webview.capturePage → toDataURL → fetch→blob → navigator.clipboard.write(ClipboardItem). Silent no-op if capture or clipboard is unavailable.
  — Useful action, but capture is Electron webview API and there is zero user feedback on success/failure. For the rewrite, capture must move server-side (the automation engine already does capturePage for agent snapshots) and the flow should confirm the copy.
- **Clear cookies / cache / browsing history** `rethink` `electron-local`
  Three menu actions calling window.desktopBridge.clearBrowserPartitionStorage (cookies; and a cache group = cachestorage/filesystem/shadercache/serviceworkers) and webview.clearHistory (which also resets canGoBack/Forward).
  — Session/storage management is desktop-only IPC against the Electron partition. A remote browser session has a different storage model; decide whether per-session storage reset is even a user-facing need or an implementation detail of session lifecycle.
- **Open DevTools** `rethink` `electron-local`
  Button (and the concept) opening Electron webview DevTools for the loaded page; disabled when no page.
  — Inherently an Electron devtools affordance with no remote equivalent — a phone client cannot open Chromium DevTools. Also mutually exclusive with agent control (the automation engine refuses to attach its CDP debugger while DevTools is open). Rethink or drop for the cross-platform product.
- **Empty state: 'Open a local preview' + localhost discovery** `rethink` `electron-local`
  With no committed URL, an overlay shows a browser icon, 'Open a local preview' copy, and a list of detected localhost servers as one-click 'Open' buttons, with 'Looking for localhost servers...' and 'No localhost server detected.' fallback states.
  — Excellent onboarding for the primary use case (previewing your dev server), but discovery relies on window.desktopBridge.detectLocalhostPorts probing a fixed candidate-port list on the host machine. Keep the empty-state pattern; the port-scan must be re-homed to wherever the code/server actually runs for a remote client.
- **Localhost port auto-rescan** `rethink` `electron-local`
  When the panel is empty and active, it scans candidate ports on mount, re-scans every 120s, and is visibility/focus-aware (pauses when the window is hidden, rescans on focus/visibility).
  — Thoughtful lifecycle (no wasted scanning while hidden). The cadence logic is portable, but the actual probe is host-local desktopBridge IPC and must follow the workspace host in a remote deployment.
- **Load-error banner** `keep` `electron-local`
  A red banner below the chrome shows errorDescription from did-fail-load (ignoring in-page frames and the -3 aborted code); the failed URL is written back into the location bar.
  — Correct, minimal error surfacing. The pattern survives; only the event source (webview did-fail-load) changes to a remote navigation-failed signal.
- **Agent-driven browser automation engine (CDP)** `rethink` `electron-local`
  Desktop-main service (DesktopBrowserAutomation) that attaches a Chromium debugger to the webview and exposes open/navigate/snapshot/click/type/press/scroll/evaluate/waitFor. snapshot returns visible text, an interactive-element list, the full a11y tree, a resized screenshot, plus buffered console/network diagnostics; it injects Playwright's selector runtime for locator resolution and refuses to attach if DevTools or another debugger owns the page.
  — This is the strategic heart of the surface — a browser the agent can see and drive — and the capability must be kept. But it is entirely Electron/CDP and desktop-only, and in the current cut its agent-trigger path is unwired: only register/unregister and the open-channel are consumed, while open/navigate/snapshot/etc. have no caller (the tool bridge lived in the deleted runtime/server per ADR 0011). The rewrite must both re-expose these as agent tools over core/v1 and pick a remote-parity-safe execution model.
- **'Agent connected' status badge** `keep` `electron-local`
  A top-right overlay pill reading 'Agent connected', shown once the webview has registered its webContentsId with the automation host for the active thread and a page is loaded.
  — The right instinct — surfacing that the agent is bound to this browser is valuable orientation. Keep the concept; re-source 'connected' from whatever the rewrite's agent-browser binding is. Note it can currently light up even though no agent tools are wired to actually drive the page.
- **Automation host registration & owner selection** `rethink` `electron-local`
  The webview registers (webContentsId, workspaceKey, browserId, tabId, threadId, active, visible) on dom-ready/did-attach; the engine picks the owning tab per thread by active > visible > most-recently-focused, and unregisters on unmount.
  — The binding model (which browser tab a thread's agent drives) is a real product concept to preserve, but it is expressed through Electron webContents IDs and desktopBridge IPC. Rethink as a thread↔browser-session association in the core model.
- **Agent auto-open browser tab** `rethink` `electron-local`
  When the agent calls open, desktop-main broadcasts BROWSER_AUTOMATION_OPEN_CHANNEL; shell-host listens via onBrowserAutomationOpen and creates a browser tab pointed at the agent's URL for the matching thread.
  — Agent-initiated UI (spawning a browser tab when it needs one) is a keeper behavior, but it rides an Electron broadcast IPC. Re-express as a core/v1 event the remote client can also react to.
- **Multiple browser tabs per workspace** `keep` `client-local`
  Beyond the stable default browser tab, users create additional browser instances via the workbench '+' new-tab menu ('Browser'). Each has its own browserId, persisted URL/state, favicon, and is independently closable.
  — Multi-instance browsing is legitimate and the tab/id model is client-local UI state. Keep; the per-instance content just needs the remote-capable view underneath.
- **Browser tab chrome (favicon, title, close, middle-click, drag-reorder)** `keep` `client-local`
  Browser tabs show a Google-service favicon derived from the URL and the page title as label; closable tabs reveal an X on hover / focus-visible, support middle-click-to-close, and can be drag-reordered among workbench tabs. Metadata (url/title/favicon) is persisted and restored.
  — Standard, well-built tab affordances (hover-reveal close, aux-click, DnD, persistence). Portable client-local UI. One dependency to revisit: favicons are fetched from Google's favicon endpoint, an external call the rewrite may want to self-host or route.
- **Focus-location-bar keyboard shortcut (mod+L)** `keep` `aux`
  Cmd/Ctrl+L focuses and selects the location bar when the browser is active and a terminal isn't focused. Works both from the app window and from inside the webview (the preload forwards a browser-keydown IPC message so the shortcut fires even when focus is in web content).
  — The keybinding definition is served from settings (aux, when: 'browserActive && !terminalFocus'); the cross-boundary forwarding from inside the webview is a nice touch. Keep the shortcut; the webview-forwarding mechanism is Electron-specific and only needed while the view is a local webview.
- **'Browser agent' toolbar button (disabled placeholder)** `kill` `client-local`
  A feather-icon button in the chrome labeled 'Browser agent' that is permanently disabled with no onClick handler.
  — Dead placeholder shipping as a greyed-out control with no behavior — it advertises a feature that does nothing. Remove it; if a manual 'hand this browser to the agent' action is wanted, design it deliberately rather than leaving an inert stub.

**Open questions:**

- Does the browser panel survive as a cross-platform feature at all, or is it explicitly scoped as desktop-only shell chrome? ADR 0022 says remote parity is absolute, but an Electron `<webview>` has no phone/browser equivalent without a server-side/streamed browser session — this is a product decision the rewrite must make before touching the code.
- Where does the agent-facing automation get re-wired? The engine exists but its tool-trigger path was deleted with the runtime/server. Is the plan to re-expose open/navigate/snapshot/click/... as core/v1 agent tools, and if so does the browser session live in desktop-main (register/unregister as today) or move server-side for remote parity?
- Is general web browsing in scope, or only local-preview? The empty state and localhost discovery suggest the real job is 'preview my dev server + let the agent inspect it.' If so, arbitrary-URL browsing, cookie/cache management, and DevTools may be out of scope for the rewrite rather than features to port.
- How should the thread↔browser binding be modeled in core? Today it's Electron webContentsId + owner-selection heuristics (active/visible/focusedAt) inside desktop-main; a remote-parity design needs this as a first-class association a phone client can also observe and act on.
- Should favicons keep hitting Google's external favicon endpoint, or be self-hosted/proxied? It's an outbound third-party call baked into tab chrome.

## workbench-files

- **Project file tree (lazy)** `keep` `aux`
  Left-rail tree of the project rooted at cwd; directories load their children on expand, with a 'Loading...' placeholder row until the fetch resolves. Empty states: 'Add a project to browse files.' (no cwd) and 'Open the file sidebar to browse files.' (rail collapsed).
  — Core file navigation for a coding agent. Currently served by the desktop aux project-filesystem surface and is notImplemented in Core (service.ts:1442, GAPS 'project filesystem ... unsupported'); ADR 0022 remote parity requires folding list/read into Core so a phone/browser gets the tree.
- **Git-status decoration in tree** `keep` `aux`
  Tree rows tint by working-tree git status (added/modified/deleted/renamed/untracked/ignored) via useGitStatus, kept in sync as files change.
  — Valuable at-a-glance signal. Git already routes through the Core aux bridge (createCoreAuxGitApi); parity is closer than the filesystem, but the tree->git plumbing must survive the aux fold.
- **File tree search (filter-in-place)** `keep` `aux`
  Inline 'Search' input in the rail header filters the tree to matching paths (hide-non-matches), Escape clears then closes; opening search force-opens the rail.
  — Standard tree filter. Depends on the same aux filesystem/tree model; keep but re-home behind Core.
- **Single-click preview vs double-click open** `keep` `client-local`
  Single-clicking a file opens an ephemeral 'preview' tab (one shared italic-style slot, replaced on next preview); double-click — or editing the previewed file — promotes it to a durable pinned tab.
  — The familiar VS Code preview-tab idiom; low-friction browsing without tab spam. Promotion-on-edit (panel onDirtyChange -> openEditorTabPath) is a nice touch worth carrying forward.
- **Reveal / select path in tree** `keep` `client-local`
  Imperative revealPath/selectPath auto-expand parent directories and select+focus the row; external selection (from breadcrumbs, active editor) syncs into the tree without re-triggering an open.
  — Needed to keep tree selection in lockstep with the active editor; the suppress-open bookkeeping is intricate but the capability is essential.
- **Context menu: Open in External Editor** `keep` `electron-local`
  Right-click row -> launch the file in the user's preferred external editor (resolves+persists preferred editor; toasts if none).
  — Inherently OS shell chrome (window.desktopBridge.openInEditor). Remote clients silently omit it; treat as capability-gated, not assumed present.
- **Context menu: Reveal in Finder** `keep` `electron-local`
  Right-click -> reveal the file in the OS file manager; shown only on Electron hosts where desktopBridge.showItemInFolder exists.
  — Inherently OS shell chrome; already gated by isElectronHost. Absent on web/phone by nature — acceptable, but the rewrite must not hardcode its presence.
- **Context menu: New File / New Folder** `keep` `aux`
  Creates an inline-rename composition row (unique 'Untitled'/'New Folder' name) under the target directory; committing the name writes an empty file / creates the dir and opens the new file.
  — Primary create flow. Filesystem writes are notImplemented in Core today (service.ts:1445-1448); must be built into Core for parity.
- **Context menu: Rename (inline)** `keep` `aux`
  Right-click -> inline-edit the row name; renames the path on disk, remaps Monaco model + editor history + open tabs, and disposes the old model.
  — Rename correctly cascades to editor state (renameFileInHistory, renameFilePath, markProjectModelClosed). Keep; needs Core write + a rename endpoint.
- **Context menu: Delete (confirmed)** `keep` `aux`
  Right-click -> confirmation AlertDialog with file/folder-specific copy ('removes X and all of its contents', 'cannot be undone'), Delete disabled while the request is in flight.
  — Destructive-op confirm is right. On success it disposes affected Monaco models (even dirty/inactive) and prunes history so gone files can't resurface — that cleanup discipline must be preserved.
- **Context menu: Copy Path / Copy Relative Path** `keep` `client-local`
  Copies the absolute (cwd-joined) or repo-relative path to the clipboard with a success toast.
  — Cheap, useful, already clipboard-based; works on any client with clipboard access.
- **Context menu positioning + a11y** `keep` `client-local`
  Viewport-aware placement (flips to stay on screen) and explicit focus of the first menuitem on open, since the Pierre React-slot menu path strips native auto-focus.
  — Correct menu semantics/focus are table stakes; the rewrite's menu primitive should give this for free rather than re-hand-rolling per surface.
- **Rail header: project label + new-file/new-folder/refresh** `keep` `aux`
  Rail header shows the project name (cwd basename) and hover/focus-revealed New File, New Folder, Refresh icon buttons; New buttons disabled without cwd+environment, Refresh reloads the whole tree.
  — Standard tree affordances. Hover-reveal keeps chrome quiet; keep the pattern.
- **Monaco code editor** `keep` `client-local`
  Full Monaco editor: syntax highlighting, line numbers, code folding, bracket-pair colorization, indentation/bracket guides, whitespace-on-selection, no minimap, Pierre light/dark themes, configurable code font + size (live from appearance settings).
  — Real in-app editing is a differentiator for a coding agent. Open question is whether full Monaco weight is justified vs a lighter read+annotate view, but the editing capability itself is keep.
- **Dirty tracking + Save** `keep` `aux`
  Edits mark the model dirty (dirty dot on the Save button); Save is dirty-gated and reachable via toolbar button, Cmd/Ctrl-S (editor.saveFile keybinding), and the overflow menu. Save refreshes git status afterward.
  — Core edit loop. Write path (writeProjectFile) is notImplemented in Core; must be served by Core with mtime/size returned for the conflict check below.
- **Save-conflict detection (Overwrite/Reload)** `keep` `aux`
  Writes carry expectedMtimeMs/expectedSizeBytes; a ProjectWriteConflictError raises a 'File changed on disk' banner offering Overwrite (force) or Reload (refetch + reset model).
  — Genuinely good, rare optimistic-concurrency UX. Preserve it and ensure Core's write API surfaces the conflict + fresh mtime/size.
- **Word wrap toggle** `keep` `client-local`
  Editor-wide word-wrap preference (not per-file), persisted to localStorage, toggled from the overflow menu; also drives the read-only source preview's wrap/scroll.
  — Cheap editor pref; keep. Editor-wide (not per-file) scope matches Cursor and is the right default.
- **Model-lifetime-follows-file registry** `keep` `client-local`
  A module-global Monaco model registry keyed by env+cwd+path with refcounts: dirty models survive view remounts (placement swaps, hidden panes) so unsaved work isn't lost; clean or explicitly-closed models are disposed. Delete/rename/close hook in via markProjectModelClosed.
  — Deliberate VS Code ModelService pattern and correct. But it's an app-wide singleton needing manual close/rename/delete hooks scattered across the tree and toolbar; the rewrite should keep the semantics while making the cleanup less error-prone.
- **Read-only preview fallback (binary / too-large)** `keep` `aux`
  Binary files and files >1MB (truncated) fall back to a read-only Pierre @pierre/diffs source preview with an explanatory banner ('cannot be edited here' / 'too large to edit here' / 'first 1 MB').
  — Sensible graceful degradation instead of choking Monaco. Keep; the read + truncation flag must exist in Core.
- **Unable-to-preview error state** `keep` `client-local`
  Read failures render a centered 'Unable to preview file' with a formatted error description.
  — Honest error surface; keep.
- **Add selection to Chat (content widget)** `keep` `client-local`
  Selecting text in the editor floats an 'Add to Chat' pill (Monaco content widget) above the selection, labeled with its keybinding; it shows only when the editor is focused with a non-empty selection.
  — This is the editor->agent seam and is already ADR-0013-aligned: it inserts a path + line-range mention (a Prompt Token), not rich-text. Keep the seam prominently.
- **Add selection to Chat (keyboard)** `keep` `client-local`
  editor.addSelectionToChat keybinding sends the current selection as a mention and focuses the composer at end.
  — Same seam via keyboard; delivered through a direct imperative composer handle (no queue+effect indirection). Keep.
- **Editor toolbar: toggle file tree** `keep` `client-local`
  Hamburger button shows/hides the file-tree rail (aria-pressed reflects state).
  — Standard panel toggle; keep.
- **Editor toolbar: Open File command dialog** `keep` `aux`
  Command-palette dialog to open a file: fuzzy-filters already-loaded tree paths and, on a query, runs a server-side project search; file-type icons; 'Loading files...' / 'No matching files.' empty states; capped at 100 results.
  — Fast keyboard-first open. Server search (searchEntries) is notImplemented in Core; fold into Core so remote clients can quick-open too.
- **Editor toolbar: toggle file search** `keep` `aux`
  Magnifier toggles the inline tree search field (force-opens the rail).
  — Duplicate entry point to tree search; keep but could consolidate with the Open File dialog in the rewrite.
- **Editor Back/Forward history** `keep` `client-local`
  Per-workspace file navigation history (up to 50 entries, persisted to localStorage) with Back/Forward toolbar buttons; delete/rename remap or prune history so navigation can't resurrect gone files.
  — Useful editor nav. Client-local view state is fine per-device; the pruning/remap-on-fs-change logic is the load-bearing part to preserve.
- **Breadcrumbs** `keep` `client-local`
  Path breadcrumbs above the editor; each segment is a button (navigate to that dir/open that file), middle segments collapse to '...' when the path has >4 segments, with title tooltips.
  — Good orientation + quick sibling navigation; keep.
- **Editor overflow menu** `keep` `client-local`
  '...' menu: Save, Close Editor, Word Wrap (checkbox), Open in Center / Open in Side Panel, Reveal in File Tree, Open in External Editor — items disabled by capability (no file, no cwd, no external editor).
  — Reasonable overflow home for low-frequency actions; keep, but see the placement item's rethink below.
- **Close editor** `keep` `client-local`
  Closes the current file: distinguishes closing a preview tab (drops the preview slot) from a durable editor, and disposes the Monaco model on explicit close (discarding unsaved edits, VS Code don't-save style).
  — Correct close semantics incl. model disposal; keep.
- **Center vs side-panel editor placement** `rethink` `client-local`
  A file can live in the right workbench panel or be promoted to a full-width center editor surface (with its own toolbar + a 'Back to chat' close button); placement is persisted, and each mode has bespoke empty states ('Return editor to panel', 'Back to chat').
  — Doubles the surface: two mounting components (project-files-panel + project-center-editor-surface), placement state, and special cases like 'the stable Files tab must stay empty'. Desktop-shell-specific and has no clean phone analogue; consolidate to one editor surface model in the rewrite.
- **Stable 'Files' tab stays empty** `rethink` `client-local`
  The persistent Files tab is treated as a browser entry point, not an editor tab: it renders empty (Open File CTA) even when a file remains in the workspace editor history.
  — Subtle, confusing distinction (activeTabId==='files' forces a null path) that exists to reconcile the tab system with editor history; the rewrite's tab model should make 'which tab shows which file' obvious without this special case.
- **Empty-file CTA** `keep` `client-local`
  With no file open, the editor area shows a centered 'Open File' button that launches the Open File dialog.
  — Clear empty state; keep.
- **Editor / tab / placement persistence** `keep` `client-local`
  Open file, active path, editor placement, and navigation history persist per-workspace in localStorage; word-wrap persists globally.
  — Restores session on reload. Per-device persistence is acceptable for view state, but the rewrite should decide consciously whether 'where I was' should follow the user across devices (ADR 0022) or stay per-device.
- **Filesystem-change model/history cleanup** `keep` `client-local`
  On delete or rename, affected Monaco models are disposed (even dirty/inactive) and editor history + open tabs are pruned/remapped so stale or gone files can't be reopened from navigation or persisted state.
  — Prevents ghost-file resurrection; a correctness-grade behavior that any editor rewrite must reproduce, ideally centralized rather than hooked in at each call site.

**Open questions:**

- Does the new product keep full in-app code editing (Monaco write path, save, conflict handling), or narrow the Files surface to read + Add-to-Chat annotation? The answer determines how much of the aux filesystem write plane (writeFile/createDirectory/renamePath/deleteFile) must be built into Core.
- Should editor view state (open file, active path, nav history, placement) stay per-device in localStorage, or follow the user across clients under ADR 0022 remote parity? Currently it is client-local only.
- Git-status tree decoration depends on the aux git bridge; is per-file working-tree status part of the Core workspace/thread read model, or does the tree keep a separate git subscription after the aux fold?
- With one consolidated editor surface (dropping center/side-panel duality), what is the phone/browser layout for viewing a file alongside the chat — overlay, dedicated route, or split — since the current center-vs-panel split has no mobile analogue?
- Should the two file-search entry points (inline tree filter vs the Open File command dialog) be unified into a single quick-open in the rewrite?

## workbench-git

- **Panel view states (loading / idle / error / no-repo / clean / changed)** `keep` `aux`
  The right-workbench Git tab renders one of six mutually-exclusive states derived from git status: 'Loading changes…', 'No workspace selected', 'Git error' + message, 'No repository' + Init button, 'Working tree clean', or the full changed view. Each has bespoke copy and an empty illustration/layout.
  — Intrinsic status projection over the working tree; survives. Data is read via aux git status (onStatus/refreshStatus); per GAPS.md web/serve has no aux, so it must be re-served by Core for ADR 0022 remote parity.
- **Init Git (no-repo empty state)** `keep` `aux`
  When the project has no repo, a centered empty state offers an 'Init Git' button that runs git init then revalidates.
  — Legit one-shot mutation; rewire onto Core so a browser/phone client can also initialize (aux is desktop-only today).
- **Changes-list rail toggle** `keep` `client-local`
  Bars icon in the branch bar shows/hides the left file-tree rail; aria-pressed + active styling; state persisted per-workspace in shell-panels-store.
  — Pure layout chrome. Fine as client-local, but the persisted rail-open flag is per-device (shell-panels-store) and should follow the user for parity.
- **'Local' source badge** `rethink` `client-local`
  A static pill (display icon + 'Local') in the branch bar signalling the working-tree/local context (vs a remote/PR source).
  — Vestigial: only ever reads 'Local' — the panel has no remote/PR compare mode wired. Keep only if the rewrite actually adds a remote/branch compare source; otherwise it's decoration.
- **Branch name pill (copy branch)** `keep` `aux`
  Clickable pill showing the current branch (or 'detached'); click copies the branch name to clipboard with a 'Branch copied' toast.
  — Branch name comes from git status (aux→Core). Small, useful affordance; keep, rewire data to Core.
- **Editor Options menu → Layout (Unified / Split)** `rethink` `client-local`
  Dot-grid menu with a Layout submenu radio to switch the diff renderer between unified and split; current value echoed on the submenu trigger.
  — Valid preference, but persisted only in localStorage (honk:git-diff-style) — per-device, breaks ADR 0022 parity. Move preference into Core/user scope.
- **Editor Options menu → Ignore Whitespace toggle** `kill` `client-local`
  A checkbox/switch in the Editor Options menu labelled 'Ignore Whitespace', defaulting on.
  — Dead control: state is set but never reaches gitPatchQueryOptions or any diff fetch (verified by grep) — toggling changes nothing. Remove, or implement as a real Core diff option.
- **Editor Options menu → Find in Diff (⌘F)** `rethink` `client-local`
  Menu item 'Find in Diff' with a ⌘F shortcut label.
  — Permanently disabled placeholder (MenuItem disabled). A menu item advertising a shortcut that does nothing erodes trust; either ship diff search or drop it.
- **Editor Options menu → Collapse All** `keep` `client-local`
  Collapses every expanded diff card (sets all rows collapsed).
  — Pure view state over the rendered list. Note: an expandAll exists in the model but is not surfaced; add symmetry.
- **Editor Options menu → Refresh Changes (⌘R)** `keep` `aux`
  Menu item that force-refreshes git status and invalidates patch/image caches; labelled with ⌘R.
  — Refresh is real (calls refresh→revalidate). But the ⌘R label is decorative — no keydown handler is registered in the panel; wire the shortcut or drop the label.
- **Commit split-button (primary 'Commit & Push')** `keep` `core-v1`
  Foreground split-button whose primary action runs the default git agent action (commitAndPush) by sending a scripted natural-language prompt to the project's agent thread (creates the thread if none), showing a loading label while the turn runs.
  — Agent-driven commit is the product model; the send routes through coordinateTurnSend (core-v1 messages.send). ADR 0014-safe: reuses the thread's pinned modelSelection or project default. Keep, but make the 'this starts an agent turn' semantics legible.
- **Commit-action dropdown (Create Branch & Commit / Create Branch, Commit & Push / Commit / Commit & Create PR)** `keep` `core-v1`
  Chevron menu on the split-button offering the full set of git agent actions, each a distinct scripted prompt (stage explicit paths only, one concise commit, optional branch/push/PR).
  — Same agent-turn mechanism; these are Parts-style task requests, not approval UI (ADR 0007 clean). Keep; ensure remote clients can trigger them (they already go through core-v1).
- **Stop pending git agent action** `rethink` `legacy-dead`
  While a git agent action is pending, the primary button turns into a Stop button (IconStop) that attempts to abort the running turn.
  — Broken today: stop calls readHonkRuntimeApi().abort, which is the all-rejecting stub ('Runtime host unavailable after core cutover') and always toasts a failure. The capability is valid but must route through Core interrupt (ADR 0005 / honk.threads.interrupt).
- **Change filter menu (Uncommitted / Unstaged / Staged / Branch)** `keep` `aux`
  Folder-icon menu that filters the changed-file list and relabels the header ('N Staged Changes', etc.). Uncommitted/Unstaged/Staged filter the working-tree rows by staged/unstaged flags.
  — Uncommitted/Unstaged/Staged are real projections of git status (aux→Core). The 'Branch' option is not (see next). Keep the three working-tree filters.
- **'Branch' filter + 'All Commits' commit selector** `rethink` `client-local`
  Selecting 'Branch' switches the header to 'N Branch Changes' and reveals an 'All Commits' dropdown intended to pick a commit to compare.
  — Half-built stub: branchCommits is hard-wired to EMPTY_BRANCH_COMMIT_OPTIONS and the branch view falls back to the working-tree file list (no branch-diff data source). Either build real branch/commit comparison against a Core endpoint or cut it.
- **Change totals (+adds / -dels)** `keep` `aux`
  Mono, colored +add/-del summary for the visible file set in the changes header (hidden when zero).
  — Derived from row insertion/deletion counts (aux→Core). Cheap, useful; keep.
- **Discard all changes (button + confirm dialog)** `keep` `aux`
  Undo icon in the changes header opens a 'Discard all changes?' dialog ('Revert all N files… cannot be undone') that runs discardPaths over every file.
  — The user's own destructive action, well-guarded — not an ADR-0007 agent-approval flow. Keep; rewire discardPaths onto Core for remote parity.
- **Discard single file (per-file revert + confirm dialog)** `keep` `aux`
  Each diff header has a revert (step-back) icon that opens a 'Discard changes?' dialog naming the path, then discards that path.
  — Same rationale as discard-all; the only direct git mutation a human can perform here. Keep, rewire to Core.
- **View all / Unview all (bulk review toggle)** `rethink` `client-local`
  Checkbox-icon in the changes header marks every visible file viewed or clears them; hidden for the Branch filter.
  — Review-progress belongs to the user, not the device. Stored in localStorage (honk:git-viewed:<root>) so it won't follow a phone/browser session (ADR 0022). Move to Core.
- **Per-file 'Viewed' checkbox** `rethink` `client-local`
  Each diff header has a Viewed checkbox that marks the file reviewed and auto-collapses it; hidden for the Branch filter.
  — Good review affordance, but same localStorage/per-device persistence problem; persist per-user in Core.
- **Changed-file tree (Pierre trees)** `keep` `aux`
  Left rail renders changed files as a collapsible folder tree with git-status coloring, VS Code file-type icons, single-selection synced to the diff pane, and delegated keyboard navigation.
  — Core navigation surface. Tree state is client-local; the file/status data is aux→Core. Keep; ensure it works for remote clients.
- **Diff cards with sticky custom headers** `keep` `aux`
  Diff pane (@pierre/diffs CodeView) renders each file as a card with a sticky header: expand/collapse toggle, file icon, middle-truncated path, +/- counts, copy-path, status label, discard, viewed checkbox.
  — The heart of the review surface. Patch data via aux getFilePatch (→Core). Keep; consolidate the two diff renderers (see learnings).
- **Syntax-highlighted diff body (unified/split, line numbers, wrap, hunk separators)** `keep` `aux`
  Expanded files render shiki-highlighted diffs honoring the chosen layout, with line numbers, soft-wrap, simple hunk separators, and theme following the app light/dark theme.
  — Standard, high-quality diff rendering; keep. Data via Core once aux folds in.
- **Copy file path** `keep` `client-local`
  Clipboard icon in each diff header copies the file path with a 'Path copied' toast.
  — Trivial local affordance; keep.
- **Image diff preview** `keep` `aux`
  For image files, an inline preview renders the working-tree image (data-uri) with byte-size label, max-height clamp, loading skeleton, and decode-error fallback.
  — Nice non-text handling; image bytes come via aux getFileImage (→Core). Keep.
- **Non-diffable placeholders (binary / large / empty / rename-only) with typed icons** `keep` `aux`
  Files git can't render as text show titled placeholders — binary-by-type (image/video/audio/archive/document icons), 'Large diff', 'No patch available', and 'Rename only' (prev → new path) — each with a message.
  — Rich, graceful degradation vocabulary; a genuine strength. Keep the taxonomy.
- **Rich file-status labels (Added/Deleted/Renamed/Copied/Conflict/Untracked/Ignored + Loading/Error/Large/binary type)** `keep` `aux`
  Header status text with tone coloring reflects both git state and load state (e.g. 'Conflict' in destructive tone, 'Loading', 'Error', 'Large', or the binary file type).
  — Clear, color-coded status vocabulary; keep.
- **Lazy diff loading, auto-scroll/expand, and active-patch LRU cap** `keep` `aux`
  Diff bodies fetch only when a file is expanded/selected; the selected file auto-expands and the pane auto-scrolls to it; active patch queries are capped (LRU, max 80) to bound work on large changesets. Loading shows a skeleton; failures show an inline error.
  — Good performance posture for big diffs; keep. Consolidate to one diff renderer (the GitDiffCard/DiffViewer path with its scroll-prefetch observer is unused dead code beside the live CodeView path).
- **Per-filter empty states** `keep` `client-local`
  When a filter yields no files, the diff pane shows filter-specific copy ('No staged changes.', 'No unstaged changes.', 'No files to compare.').
  — Small polish over aux-backed filter state; keep.

**Open questions:**

- Should 'Viewed' review state and the unified/split preference move from per-device localStorage into Core (per-user/per-thread) so a phone/browser client sees the same review progress (ADR 0022)?
- Is the 'Branch' filter + commit-comparison meant to ship? It needs a real Core branch-diff endpoint; right now it's an empty stub. Build it or cut it.
- Should this panel surface Core turn-checkpoints/revert (core/v1 checkpoints group with revertTurn), which today are only surfaced in chat user-message.tsx — or should git stay working-tree-only and leave turn-revert to the timeline?
- The commit/PR agent actions hijack or create an agent thread and bleed a running turn + broken Stop into the git panel. How should the rewrite make 'this button starts an agent turn on thread X' legible, and which thread should it target when several are open?
- Given web/serve mode has no aux server (GAPS.md), does a remote client get the Git panel at all before aux fully folds into Core — i.e. is git review part of the pre-UI-rewrite aux→Core migration round or after?

## workbench-plan

- **Plan workbench tab (Plan/Tasks panel)** `keep` `client-local`
  A right-hand workbench tab that appears whenever a plan is available (thread in plan mode, an active todo plan, or a proposed plan). Tab label toggles between 'Plan' (plan mode or a proposed plan present) and 'Tasks' (todo steps only). Header shows a file-text icon plus the plan's heading as title. Tab open/active state is device-local workbench state; content is core.
  — A dedicated plan surface is the right home for a proposed plan; the tab shell is chrome. But the Plan/Tasks dual-identity is confused (see 'Tasks' checklist below) — the rewrite should decide whether this tab is 'the proposed plan' or 'live task progress', not both.
- **Proposed-plan markdown render (panel)** `keep` `core-v1`
  Renders the proposed plan's markdown (via ChatMarkdown) inside the panel, with the leading heading and a redundant 'Summary' heading stripped so the panel title carries the heading. Scrollable, max-width 840px reading column.
  — The proposed plan is a Part (ADR 0007 — plan proposals survive). Read display maps cleanly to the core plan Part (mapPlanPart, part.markdown). Core capability, keep.
- **Build plan button (panel header)** `keep` `core-v1`
  Primary yellow 'Build' button in the panel header. Three visual states: Build (arrow-up), Building (spinner), Built (green check). Disabled when already built, when a turn is running, or when the plan isn't actionable. Clicking sends an implementation turn seeded with buildPlanImplementationPrompt(markdown) and marks the core plan implemented.
  — Maps to core/v1 interactions.implementPlan (send turn with sourceProposedPlan → honk.threads.send + honk.threads.implementPlan). This is the surviving 'green-light a plan' flow from ADR 0007. Keep, but simplify the build-state machine (see learnings).
- **Proposed-plan message in chat timeline** `keep` `core-v1`
  The proposed plan also renders inline in the conversation as a distinct timeline row (ProposedPlanMessage): bold title + stripped markdown body, projected from the plan Part at its message position.
  — Plan proposal as an in-conversation Part is exactly ADR 0007's model. Keep the in-timeline presence; but reconcile it with the panel + tray so the plan isn't authored in three places (see learnings).
- **Plan follow-up tray (Review Plan) in composer** `keep` `core-v1`
  Above the composer input, after the turn settles and an actionable proposed plan exists (and no pending questions), a 'Review Plan' tray appears: caption 'Review Plan', plan title, a markdown preview, and action row. This puts the plan decision at the point of action.
  — Surfacing the plan Part as an actionable prompt where attention already is (over the input) is a strong affordance. Keep the pattern; content is the core plan Part.
- **Build button (tray)** `keep` `core-v1`
  Yellow 'Build' / 'Building...' button in the tray. Submits an empty-prompt send carrying planFollowUp context, which routes to the same implementPlan turn. Disabled while connecting/sending.
  — Same core/v1 implementPlan path as the panel Build. Keep — but note it duplicates the panel's Build with a subtly different payload (empty prompt vs buildPlanImplementationPrompt), which the rewrite should unify.
- **View Plan button (tray)** `keep` `client-local`
  'View Plan' button (eye icon) that activates the plan workbench tab; automatically hidden when the plan panel is already open.
  — Pure workbench navigation (workbenchTabPersistenceActions.activatePlan). Cheap, useful, parity-safe. Keep.
- **Dismiss plan button (tray)** `rethink` `client-local`
  Small X button that dismisses the plan tray for the session. Dismissal is persisted per thread:plan key in localStorage so the tray stays hidden across reloads.
  — The affordance is fine, but persistence is device-local localStorage — on a second client the dismissed plan reappears (violates ADR 0022 remote parity). Plan lifecycle (dismissed/building) should be thread state served by the Core, not per-device storage.
- **Plan build lifecycle state (dismissed/building keys)** `rethink` `client-local`
  A zustand store tracks per-plan 'dismissed' and 'building' keys, persisted to localStorage. Marking a plan building both hides its tray and drives the 'active' build status; cleared when the sourced turn settles.
  — This is optimistic UI state compensating for the wire not reporting build progress directly. Under core the build IS observable (activeProposedPlanTurnRunning + implementedAt), so the localStorage building-key layer is redundant scaffolding to replace with server-derived status. Remote parity: localStorage does not travel.
- **Edit plan in panel (Tiptap editor)** `rethink` `legacy-dead`
  A pencil button opens an inline editor: a Tiptap (ProseMirror, StarterKit + Markdown) rich-text editor over the plan markdown, with a Save/Cancel toolbar, dirty tracking, and a markdown round-trip sync. Save dispatches thread.proposed-plan.update.
  — Two problems: (1) core's dispatch adapter does NOT handle thread.proposed-plan.update (GAPS.md 'plan markdown updates' unsupported → the Save rejects under core); (2) ADR 0013 says the wire is raw text — a Tiptap rich-text document editor for a plaintext markdown artifact is kill/rethink. Editing a plan is a legitimate capability, but rebuild it as raw-markdown editing against a Core-served plan mutation, not Tiptap + an unserved command.
- **Edit proposed plan inline in chat** `rethink` `legacy-dead`
  On the timeline ProposedPlanMessage, a hover-revealed 'Edit' button opens the same Tiptap editor inline with Save/Cancel. Only enabled for persisted (non-draft) threads.
  — Same Tiptap + thread.proposed-plan.update path as the panel editor; the write is unserved by core. A second, redundant editor for the same artifact. Consolidate to one edit surface if plan editing survives at all.
- **Live 'Tasks' checklist (todo steps with status)** `rethink` `legacy-dead`
  When the thread has an active todo plan, the panel renders a 'Tasks' section: optional explanation line, step count, and each step with a status indicator (pending dot, in-progress spinner, green check for completed) and strikethrough on completed. Derived from turn.plan.updated activities (TodoWrite).
  — deriveActivePlanState filters activities for kind 'turn.plan.updated', but the core projection (mapActivityPart) returns null for plan parts and never emits turn.plan.updated — so activePlan is always null under core and this view never renders. The live progress-checklist is a genuinely good capability; rebuild it from core tool parts (TodoWrite), don't ship the dead activity path.
- **Todo auto-sync (markdown checkbox patching)** `kill` `legacy-dead`
  An effect reconciles the proposed plan's markdown checkboxes with the live todo step statuses by rewriting the markdown client-side (syncPlanMarkdownTodosWithSteps) and pushing thread.proposed-plan.update.
  — Depends on both the dead activePlan (turn.plan.updated) and the unserved proposed-plan.update mutation, so it is doubly dead under core. It's also an anti-pattern — client-side string-patching of a server Part to keep two representations in sync. Kill; let the Core own plan/todo state.
- **Copy plan markdown** `keep` `client-local`
  Plan-actions (3-dot) menu item that copies the normalized plan markdown to the clipboard with a success/error toast.
  — Pure clipboard write, works on any client. Cheap, parity-safe export. Keep.
- **Download plan markdown** `rethink` `client-local`
  Plan-actions menu item that downloads the plan as a .md file via a Blob + anchor click, filename slugged from the plan title.
  — Blob/anchor download is a browser-desktop idiom; on a phone/native client it degrades. Keep the intent (plans are exportable artifacts) but make the export mechanism parity-aware per ADR 0022.
- **Save plan to project (writeFile + dialog)** `rethink` `aux`
  Plan-actions menu item opens a 'Save plan' dialog: a project-relative path input (default slugged from title, auto-appends .md), inline error alert, Cancel/Save. Writes the plan into the project working tree via projects.writeFile.
  — projects.writeFile is notImplemented in the core environment (GAPS.md 'project filesystem' unsupported) and is inherently desktop-filesystem — no remote parity (ADR 0022). Persisting a plan into the repo is a reasonable feature, but it must go through a Core-served, parity-safe file write or be scoped as explicitly desktop-only.
- **Plan panel empty state** `rethink` `client-local`
  When no proposed plan and no active tasks exist, the panel shows a centered muted message 'No plan data available.'
  — Empty-state copy is fine to keep, but 'No plan data available.' is developer-ish and the panel generally shouldn't be reachable with nothing to show (tab only mounts when planAvailable). Rewrite should give the empty/plan-pending state real editorial copy or not surface the tab at all.
- **Plan title derivation & markdown stripping** `keep` `client-local`
  proposedPlanTitle extracts the first markdown heading as the plan title; stripDisplayedPlanMarkdown removes that leading heading and a redundant 'Summary' heading from the rendered body so the title isn't shown twice.
  — Small editorial layer that makes plans read cleanly (title in chrome, body without duplication). Presentation logic worth carrying forward regardless of wire.

**Open questions:**

- Does the new Core serve a plan-Part edit/update mutation, or are proposed plans immutable once emitted? Today thread.proposed-plan.update is dispatched by two editors but unsupported by the core dispatch adapter (GAPS.md), so all plan editing is dead under core. If plans are immutable, both Tiptap editors should be cut; if editable, a raw-text edit needs a served endpoint.
- Is there a live task/todo checklist in the new product distinct from proposed plans? The current 'Tasks' view depends on turn.plan.updated activities that the core projection never emits (activePlan is always null under core). Decide whether TodoWrite progress is rebuilt from core tool parts or dropped.
- Should plan dismissal and build progress be thread state served by the Core (for ADR 0022 remote parity) instead of per-device localStorage?
- Which of the three plan surfaces (inline chat message, composer tray, workbench panel) is canonical in the rewrite, and how do the others reference it without re-implementing Build/edit?
- Is 'Save plan to project' (filesystem write) in scope for remote/phone clients? It's currently desktop-only and notImplemented in the core environment — either give it a Core-served parity-safe write or scope it as explicitly desktop chrome.
- Should the panel Build (buildPlanImplementationPrompt text) and the tray Build (empty-prompt planFollowUp) send the same payload? They diverge today, which means 'Build' behaves differently depending on where you click it.

## workbench-terminal

- **Interactive PTY terminal (xterm)** `keep` `core-v1`
  A live shell inside the workbench right panel: type commands, run programs, see streamed stdout/stderr. xterm.js host with 10k-line scrollback, blinking bar cursor. Input keystrokes stream to core via terminal.write; output arrives as core 'output' events and is written to xterm.
  — Core primitive of the surface; served by honk.terminals over core/v1 so it has full remote parity. Non-negotiable to keep.
- **Auto-fit + PTY resize** `keep` `core-v1`
  FitAddon fits the xterm to its container; a ResizeObserver (rAF-debounced) plus a MutationObserver on the host document re-fit and push clamped cols/rows to the PTY via terminal.resize, so the shell reflows with the panel.
  — Correct terminal sizing is table stakes; resize verb is core-v1. Keep the mechanism.
- **History hydration + re-attach after reload** `keep` `core-v1`
  On open, api.open returns snapshot.history and xterm seeds it (dedup-guarded). Core has no rename verb, so the app's stable tab id is stored as the core terminal 'title' and re-adopted after a reload wipes local state (findCoreTerminal matches by threadId+title).
  — Session survivability across reload/reconnect is essential and already core-backed. Keep; but the title-as-key hack is fragile (breaks if Core adds rename) and should get a real stable ref field.
- **Live theme + font sync** `keep` `client-local`
  The terminal palette, font family and font size track the app's appearance: a MutationObserver on documentElement class/style plus an APPEARANCE_SETTINGS_CHANGED listener re-paint the xterm (fg/bg resolved through a canvas paint resolver) and re-fit.
  — Makes the embedded terminal feel part of the app rather than a foreign console; carry into the rewrite.
- **Multiple terminal sessions per workspace** `keep` `core-v1`
  A workspace can hold several terminal sessions; each is a tab. Sessions are keyed to a synthetic workspace thread (threadId = `workbench:${workspaceKey}`), so terminals are shared across chat threads and persist independent of which agent thread is open.
  — Workspace-scoping (not thread-scoping) is a sound product decision; keep. Persisted session list is client-local and also keeps.
- **Terminal tabs in the workbench tab strip** `keep` `client-local`
  Each session is a closable pill in the shared right-workbench tab strip: console icon, label = inferred shell name, click/Enter/Space to activate, drag to reorder, middle-click to close, hover/focus-reveal close button.
  — Tabs are the strong navigation primitive (shared with files/browser/dev/plan). Keep as the single session model.
- **New Tab menu → Terminal** `keep` `client-local`
  The '+' New Tab menu in the workbench header lists Terminal (alongside Changes/Browser/File); selecting it creates a fresh terminal session and opens the right panel.
  — Clear create affordance; keep. Only note: it always spawns the default login shell (no shell picker).
- **Collapsible sessions rail** `rethink` `client-local`
  A secondary rail lists the workspace's terminal sessions with console icon, truncated label, active-row highlight, and a hover/focus-reveal close (X) per row; toggled by the sub-chrome button.
  — Redundant with the tab strip — same sessions, same activate/close affordances rendered twice. Consolidate onto tabs (or the rail) in the rewrite rather than shipping two competing lists.
- **Terminal sub-chrome row (rail toggle + shell caption)** `rethink` `client-local`
  A full-width row under the tab strip with a rail toggle (aria-pressed, 'Show/Hide sessions list') and a title showing the login-shell caption (e.g. 'zsh').
  — Exists mainly to toggle the redundant rail; folds away if the rail is dropped. Shell caption is useful but belongs on the tab, and is only accurate on desktop (see remote-parity learning).
- **Keyboard: toggle terminal panel** `keep` `client-local`
  terminal.toggle opens the terminal workbench tab + right panel, or closes the panel if the active tab is already the terminal.
  — Standard quick-access shortcut; keep.
- **Keyboard: new / 'split' terminal** `rethink` `client-local`
  terminal.new and terminal.split both call createTerminal — they add a sibling terminal tab. There is no actual pane splitting; 'split' is an alias for 'new'.
  — The 'split' shortcut promises tiling the product doesn't deliver. Either implement real split panes or drop the alias so the shortcut isn't misleading.
- **Keyboard: close active terminal** `keep` `client-local`
  terminal.close closes the currently active terminal tab (routing through the running-process confirm path).
  — Keep as a session-management shortcut.
- **Clear terminal (Ctrl+L / Cmd+K)** `rethink` `client-local`
  Custom key handler clears the local xterm display and calls api.clear on the PTY. Under core/v1 api.clear rejects (unsupported) and the error is swallowed; no 'cleared' event round-trips.
  — Clear is cosmetic-only under core: the server scrollback is untouched, so a reload re-hydrates the full history and the 'cleared' terminal comes back full. GAPS.md confirms honk.terminals has no clear-history endpoint. Make clear honest (label it visual-only) or implement real clear-history in Core.
- **macOS line-editing key translation** `keep` `client-local`
  The panel intercepts Alt+←/→ (word), Cmd+←/→ (line start/end) and Cmd+Backspace (delete-to-line-start) and injects the matching terminal control sequences, so the shell behaves like a native Mac text field.
  — Small, high-value touch that makes the embedded terminal feel native. Keep and extend cross-platform in the rewrite.
- **Confirm-close when a process is running** `rethink` `core-v1`
  Closing a terminal whose subprocess is 'running' opens an AlertDialog ('A process is still running… Closing the tab will terminate it') before killing the PTY; otherwise it closes immediately.
  — Not a permission panel — a destructive-action guard, so it survives ADR 0007 conceptually. But its trigger is dead under core/v1: core never emits 'activity' events (GAPS.md), so useWorkbenchTerminalRunning is always empty and this dialog never fires. Rewrite must either add activity events to Core or drop the guard.
- **Running-subprocess tracking** `rethink` `core-v1`
  useWorkbenchTerminalRunning maintains a per-thread set of terminal ids with a live subprocess, driven by 'activity' events (hasRunningSubprocess).
  — Effectively dead code: core attach exposes no subprocess activity (GAPS.md), so the set is always empty and nothing consumes it except the never-firing close dialog. No tab badge/indicator is rendered from it at all. If a running indicator is wanted, Core needs activity events; otherwise cut.
- **Restart / relaunch terminal** `rethink` `core-v1`
  The environment adapter supports restart (relaunch an exited or existing PTY), used internally by open when re-adopting an exited terminal. Closing the FINAL terminal bumps a resetKey that remounts the panel with a fresh session — an implicit restart.
  — There is no explicit user-facing restart button, and an exited terminal just sits showing dead output (the 'exited' event is ignored by the panel). Rewrite should surface an explicit restart control and an exited-state affordance rather than requiring close+reopen.
- **Run project script into a terminal tab** `keep` `core-v1`
  Running a project script opens/creates a workbench terminal tab, then writes the script command to the PTY so its output shows live in the terminal.
  — Good use of the terminal as a script-output surface (originates from the project-scripts surface). Keep the terminal-as-target capability.
- **Empty state: no project open** `keep` `client-local`
  When no project cwd is set, the panel shows a centered muted 'No project open'.
  — Necessary empty state; keep.
- **Loading state: preparing terminal** `keep` `client-local`
  While the environment API is not yet ready, the panel shows centered muted 'Preparing terminal...'.
  — Keep as a boot placeholder.
- **Terminal error states** `keep` `client-local`
  Inline destructive-text errors: 'Terminal API unavailable for this workspace.', 'Could not load terminal renderer.' (xterm init failure), and 'Could not open terminal session.' (open failed).
  — Failure surfacing is required; keep but make errors recoverable (retry) rather than dead-end text.
- **Session persistence across reloads** `keep` `client-local`
  Terminal session entries (id + label) persist in the shell-panels store schema, so tabs survive an app reload and re-attach to their core terminals.
  — Keep; pairs with core re-adoption for a seamless reload.
- **Fullscreen the right workbench (incl. terminal)** `keep` `electron-local`
  The workbench header's fullscreen toggle maximizes the right panel, which includes the terminal when it's the active tab.
  — Shell chrome shared across workbench tabs; keep. Fullscreen/window behavior is desktop chrome and inherently shell-level.

**Open questions:**

- Will Core add subprocess-activity events? Without them the running indicator and the confirm-close-running-process guard cannot function, and the rewrite must choose between adding the event or cutting both.
- Will Core gain a real clear-history verb, or does the rewrite redefine 'clear' as a purely visual/soft clear? This determines whether the clear shortcut can be made honest.
- Does the rewrite keep both tabs and a sessions rail, or consolidate to one? If tabs win, the sub-chrome rail-toggle row goes away.
- Should terminals remain workspace-scoped (workbench:${workspaceKey}) in the remote/multi-client world, and how are they shared/echoed when two clients attach to the same workspace terminal?
- Is real split-pane tiling in scope, or is 'split' dropped as an alias for 'new'?

## Addenda — critic findings (uncovered by the sweep)

The thread top bar (chat-header.tsx + workspace-toolbar.tsx) was claimed by no auditor; its capabilities below join the checklist. `packages/marketing` consumes the shared UI package directly (ADR 0023).

- **Chat-title button + rich hover tooltip** _[thread top bar (chat-header.tsx)]_
  The thread-title control in the content-pane top bar opens a tooltip surfacing repo/branch, workspace path, surface label, model label, and context label (ChatTitleTooltipContent). Also hosts the overlay-mode-only 'Toggle sidebar' button. Appears in no surface list.
- **Workspace/project switcher dropdown** _[thread top bar (workspace-toolbar.tsx)]_
  In-header menu to switch the active project among the workspace's projects (active checkmark, cwd subtitle) plus an 'Open Folder... / Add another workspace' item. Distinct from the sidebar's native folder picker; not enumerated anywhere.
- **Active-thread environment-mode picker (Local vs New branch/worktree)** _[thread top bar (workspace-toolbar.tsx)]_
  A header dropdown choosing where the agent runs (Local = current checkout; New branch/worktree = isolated branch on send), each with a description row. The composer surface only lists 'Env-mode / worktree selection (draft)'; the active-thread header instance is uncovered.
- **In-thread branch selector with sections, states, and PR checkout** _[thread top bar (workspace-toolbar.tsx)]_
  Branch menu with a search input, sectioned results (Default / Current / Worktrees / Created by Honk / Your branches / Other branches), per-branch 'with changes' markers, active checkmark, a red 'base branch no longer available' error state, and a 'Checkout Pull Request' item synthesized from a typed PR reference. None of this is in any list.
- **Pull Request checkout dialog** _[chat-view / git (pull-request-thread-dialog.tsx)]_
  The 'Checkout Pull Request' dialog: paste a GitHub PR URL / 'gh pr checkout N' / #N / N, debounced live resolution, a PR preview card (title, #number, head->base branch, open/merged/closed with state color), then create the draft thread in Local or Worktree mode; includes validation, resolving-spinner, and error states. Entirely uncovered (git panel only has the separate 'Commit & Create PR').
- **thread.next / thread.previous keyboard shortcuts** _[shell-chrome / global shortcuts (keybindings.ts)]_
  Keyboard commands to cycle selection to the next/previous thread (resolved in keybindings.ts and dispatched via -chat-route.tsx). The sidebar lists only New-Agent/⌘N; thread cycling is a distinct shortcut absent from every list, despite the brief asking for exhaustive keyboard coverage.
- **chat.newLocal keyboard shortcut** _[shell-chrome / global shortcuts (keybindings.ts)]_
  A separate 'new LOCAL agent' shortcut (handled at routes/-chat-route.tsx:68), distinct from the ⌘N 'New Agent' already listed. Not enumerated.
- **Desktop download controls + landing chrome** _[marketing (packages/marketing)]_
  macOS architecture selector (arm64/x64) feeding a DMG download link (desktop-download-controls.tsx), plus hero, social links, and product-frame preview on the marketing index route. No auditor covered these marketing-visible controls.
