# Harness event → Part mapping (working spec for the adapter round)

Distilled from source-verified reports (2026-07-01) against pi 0.80.2, @anthropic-ai/claude-agent-sdk
0.3.195, and the legacy cursor-composer-provider. The legacy adapters map only text/reasoning/tool and
drop everything else; the columns below are what the rewrite adapters MUST feed instead.

## pi (native, in-process)

AgentSessionEvent (17 variants; pi-coding-agent dist/core/agent-session.d.ts:40, pi-agent-core
dist/types.d.ts:360) — the streaming truth rides `message_update.assistantMessageEvent`:

| pi event | Part / TurnContext call |
|---|---|
| `assistantMessageEvent: text_start/delta/end` | text part: createPart / appendDelta("text") / completePart |
| `assistantMessageEvent: thinking_start/delta/end` | reasoning part, same lifecycle |
| `tool_execution_start {toolCallId, toolName, args}` | tool part createPart (toolState pending→running) |
| `tool_execution_update {partialResult}` | updatePart (running, display refresh) |
| `tool_execution_end {result, isError}` | updatePart (completed/error) + completePart |
| `compaction_start/end {reason, result, aborted}` | compaction part (create at start, update+complete at end) |
| `auto_retry_start/end` | notice part (severity warning / error on final failure) |
| `turn_start` / `turn_end {message, toolResults}` | step part boundaries + usage |
| `agent_end {willRetry}` | turn settlement (Core runner) |
| `queue_update {steering, followUp}` | Core-internal (honk owns the queue projection; do NOT double-project) |
| `session_info_changed`, `thinking_level_changed` | ignore (honk pins thinking; titles are honk's) |

Steer: `session.steer(text)` — delivered after the current tool batch, before the next LLM call.
Mid-turn prompt() requires `streamingBehavior: "steer"|"followUp"` when streaming.
Restore: eager full-JSONL parse + index, O(entries), on every SessionManager open (continueRecent reads
512-byte headers to pick the file, then full parse). Lazy per-turn pays this per turn start.

Session continuity (grill 2026-07-02): hermetic agentDir/sessionDir under HONK_HOME/harness/pi
(ADR 0017). The store keeps, per thread, an opaque harness session ref (pi: the JSONL path; Claude
in its round: the resume id) plus a per-tree-entry harness leaf id recorded at turn end. A send from
an older or edited entry branches the pi session at the mapped ancestor leaf (sibling branch, never
an appended follow-up); a harness that cannot express the branch rebuilds context from the Canonical
Record — the universal fallback. Interrupt: fiber interruption → awaited `session.abort()`.

## Claude Code (Agent SDK subprocess)

| SDKMessage | Part / TurnContext call |
|---|---|
| `stream_event` content_block text_delta / thinking_delta | text / reasoning appendDelta |
| `assistant` tool_use blocks | tool part createPart (pending; name+args snapshot — input_json_delta ignored) |
| `user` tool_result blocks | updatePart (completed/error keyed by tool_use_id) |
| `tool_progress` | updatePart (running, elapsed) |
| `system/compact_boundary {pre_tokens, trigger}` | compaction part |
| `system/notification`, `permission_denied`, `api_retry`, refusal, rate_limit | notice part |
| `task_started/progress/updated` | step part (subagent lifecycle) or subagent ToolDisplay |
| `result` (success \| error_*) | settlement + usage (authoritative; ttft, cost, num_turns) |
| `session_state_changed → idle` | authoritative turn-over signal |

Resume: `options.resume: sessionId` (+ `forkSession` for branch); each SDKMessage carries session_id;
legacy adapter used NONE of this (stateless per-turn, session_id:""). Interrupt: `Query.interrupt()` +
abortController; result frame carries `terminal_reason: aborted_streaming|aborted_tools`.
Auth policy: canUseTool always-allow (ADR 0007). Questions: elicitation control requests → question
part + awaitAnswer.

Round 2 grill (2026-07-02, SDK 0.3.195 source-verified): config posture is ADR 0018 (user auth +
sessions shared; settingSources ["project"] only; explicit env allowlist). Session continuity: leaves
are self-contained `sessionId/messageUuid` composites (forkSession mints a NEW session id per branch;
ref replacement never invalidates leaves). Branch = resume + resumeSessionAt + forkSession:true when
the leaf is not the session tip (resuming at a non-tip point without forking risks destructive
truncation); plain resume when it is. NO mid-turn steer exists — streaming input only enqueues further
prompts — so the Claude arm declares capabilities.steer:false and the Core downgrades steer→queue at
admission. Plan mode rides the CLI's native protocol (permissionMode "plan", ExitPlanMode → plan
Part); ask/debug enforce via the `tools` restriction; debug_logs parity via an in-process MCP server
under HONK_HOME/harness/claude-code. Questions ride onUserDialog (askUserQuestion kind). ThinkingLevel
maps to `effort`; "off" disables thinking. The accountInfo probe (boot + 5-min stale-while-revalidate)
derives the label: firstParty+subscriptionType → "Claude <Type> Subscription", non-oauth apiKeySource →
"Claude API Key", external providers named as such.

## Cursor (ACP child process)

| ACP message | Part / TurnContext call |
|---|---|
| `session/update: agent_message_chunk {content.text}` | text appendDelta |
| `session/update: tool_call {toolCallId, kind, title, rawInput, status}` | tool part createPart |
| `session/update: tool_call_update` | updatePart (status merge by toolCallId) |
| `session/update: plan {entries[]}` + `cursor/update_todos` | plan part (legacy flattened to text — don't) |
| `cursor/create_plan` (request) | plan part; respond `{accepted:true}` |
| `cursor/ask_question` (request) | question part + awaitAnswer → respond with answers (legacy auto-answered EMPTY) |
| `session/request_permission` (request) | auto-allow allow_once→allow_always→first (ADR 0007) |
| `session/prompt` response `stopReason` | settlement ("cancelled" → aborted) |

No reasoning channel; no usage on the wire (estimate or omit). Cancellation: `session/cancel` + child
close. Child lifecycle: legacy spawns + kills one child PER TURN with full
initialize→authenticate(cursor_login)→session/new handshake; ACP advertises `loadSession: true` — the
adapter round must verify whether loadSession actually restores context across child restarts, else
rebuild from the Canonical Record. Auth: CURSOR_API_KEY env at spawn, isolated auth context (ADR 0016).

Round 3 grill (2026-07-02): per-turn child (lazy-per-turn like the other arms). Continuity: session/load
only when we hold a ref AND the agent advertises loadSession AND the resume point is the session tip,
trusted only when the load round-trip succeeds; any failure, absent capability, or BRANCH resume (ACP
cannot branch) = fresh session/new + ONE transcript-prelude user message rebuilt from the Canonical
Record's active path, then the real user text — the universal fallback made concrete. Probe =
spawnability + initialize handshake only (detail carries the agent version); the stored key stays
reject-on-use, never probe-validated (ADR 0016). Binary discovery is PATH-only — a missing binary is an
unavailable harness with the detail saying so. capabilities.steer:false (the Core downgrades steer to
queue at admission).
