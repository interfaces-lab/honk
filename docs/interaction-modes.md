# Interaction Modes — Core-owned definition (working spec)

Distilled from the source-verified legacy study (2026-07-02). The Core owns each mode's
meaning; every Harness projects what it can honor (CONTEXT.md: Interaction Mode).

## The five postures

| Mode | Tool profile (legacy) | Prompt posture | Loop behavior |
|---|---|---|---|
| agent | unrestricted | identity only ("Build") | none |
| ask | read-only allowlist: read, grep, find, ls, ask_question | identity SWAP (ask variant) + CRITICAL read-only guidance | edits blocked at tool_call with a switch-to-Build message |
| plan | read tools + bash + create_plan (no edit/write) | research-first guidance, create_plan as final action | create_plan tool TERMINATES the turn (terminate:true) → proposed plan; fallback: markdown plan-scan of last message |
| debug | read tools + bash + edit + write + debug_logs | repro→instrument→smallest-fix guidance | debug_logs tool (path/read/clear under agentDir/honk-debug-logs) |
| multitask | unrestricted | coordinator guidance: delegate first, runInBackground, no polling | ONLY mode where background subagents unlock; children always run as agent; completions return as hidden synthetic user turns |

UI: agent is the unmarked "Build" baseline; multitask was feature-flagged in legacy.

## What the rewrite changes structurally

1. **interactionModeQueue dissolves.** Legacy needed a FIFO of pending modes because pi sequenced
   turns internally and the mode had to find its turn later (enqueue/peek/consume/activate/remove/reset
   + a deferred tool-profile restore). The new Core owns turn sequencing: the mode rides
   SendMessageInput → QueuedMessage → TurnContext.interactionMode, attached at startTurnLocked. The
   whole queue mechanism has no equivalent — do not port it.
2. **Claude gets hard enforcement legacy never had.** Legacy hardcoded permissionMode "default" with
   no allowedTools/disallowedTools — ask/plan reached Claude as advisory transcript text only. The
   Claude adapter maps ask/plan to the SDK's disallowedTools/allowedTools (and plan to its plan
   surface where it fits), keeping guidance text as the second layer.
3. **Cursor stays advisory + honest.** ACP has no tool filtering; guidance text is the only lever.
   If a mode cannot be meaningfully honored there, that is capability data, not silent pretending.
4. **Codex nudge**: legacy suppresses the Codex tool-use nudge in ask/plan/multitask (applies to
   agent/debug only) — carry the rule into the pi adapter's mode posture.

## Adapter obligations (pi round)

- Tool profiles + guidance + ask-identity swap enforced via honk-internal pi extension(s); block
  message points the user at the right mode switch.
- create_plan → plan Part + turn settlement as proposed (plan flow, ADR 0007's surviving verb).
  The legacy markdown-scan fallback is DROPPED (grill 2026-07-02): create_plan is the only path to a
  plan Part — a plan-mode turn that never calls it settles with its text visible and no plan Part.
  Fail honest; the scan is the content-parsing heuristic the Part contract bans.
- Ask-mode edits are ABSENT, not blocked (grill 2026-07-02): lazy per-turn sessions pass the mode's
  tool allowlist at session creation, so there is no tool_call interception and no block message —
  a model that cannot see `edit` cannot call it. The legacy block-at-tool_call machinery has no port.
- debug_logs tool relocates under HONK_HOME/harness/pi.
- Background subagents (multitask) defer until the subagent round; foreground subagent depth cap 1.
