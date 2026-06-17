# Pi Runtime Hardening Implementation Plan

## Goal

Harden Honk's Pi-backed runtime path using:

- Flue as the reference for replayable streams, explicit cursors, durable offsets,
  delivered-batch checkpoints, and backpressure.
- Pi as the reference for append-only session trees, branch navigation, labels,
  summaries, session switching, and extension command semantics.
- Honk as the source of truth for product behavior, renderer performance,
  orchestration events, IPC boundaries, and UI surface.

The implementation must support heavy local subagent activity. Hidden threads and
background tabs must not receive raw token/tool/subagent deltas through React just
to preserve correctness.

## Resolved Design Decisions

1. Public orchestration dispatch and runtime ingestion are separate authority
   classes.
   - Public dispatch accepts only client/user commands.
   - Runtime persistence uses a private desktop/server ingestion channel.

2. Streaming uses a hybrid replay model.
   - Orchestration uses event-level replay with `nextSequence` and `upToDate`.
   - Runtime UI uses projection-level replay/coalescing.
   - Raw Pi events remain inside the runtime host/private ingestion path.

3. Runtime durability stores typed runtime facts.
   - Do not persist internal orchestration commands in the desktop outbox.
   - Do not persist raw Pi event shape as the durable contract.
   - Store semantic facts such as assistant completion, tool activity, and
     context-window updates.

4. Archive is server-authoritative.
   - Archive state can be persisted immediately.
   - Stop/cleanup is driven by server/runtime orchestration.
   - Partial cleanup failure is visible, not swallowed.

5. Pi tree work starts as a thin vertical product slice.
   - Persist the minimum useful branch metadata.
   - Ship actionable branch navigation/resume UI.
   - Do not chase full Pi tree parity before there is a loved UI surface.

6. Delivery is layered.
   - Avoid one large P0-P2 rewrite.
   - Each layer must leave the system shippable and have targeted tests.

## P0 Scope

### P0.1 Public/Internal Command Boundary

Problem:
`ClientOrchestrationCommand` currently includes internal commands, so public HTTP
and WS dispatch can accept commands such as `thread.session.set`,
`thread.message.assistant.complete`, `thread.proposed-plan.upsert`, and
`thread.activity.append`.

Plan:

- Introduce or expose a public command schema that contains only dispatchable
  client commands.
- Make HTTP and WS public dispatch decode only that public schema.
- Keep internal commands server-side.
- Add a private runtime ingestion route/channel that accepts typed runtime facts.
- Convert trusted runtime facts to internal orchestration commands only inside
  server-owned code.

Acceptance:

- Public HTTP dispatch rejects all internal command types.
- Public WS dispatch rejects all internal command types.
- Runtime ingestion can still persist trusted assistant/tool/context facts.
- Tests cover both accepted public commands and rejected internal commands.

### P0.2 Persist Full Runtime Data Before Wire Scrubbing

Problem:
The desktop bridge emits scrubbed wire runtime events to the renderer. Persistence
currently ingests host events from that path, so tool completion data can lose
`toolName`, `toolCallId`, `isError`, args, results, or be omitted.

Plan:

- Derive runtime facts from full in-process Pi runtime events before
  `toWireRuntimeEvent`.
- Keep renderer/UI wire events scrubbed and coalesced.
- Remove persistence dependence on UI wire events.
- Define typed fact payloads instead of parsing broad `unknown` event data.

Acceptance:

- Tool completion persistence keeps full data even when the UI wire event is
  scrubbed.
- Subagent, shell/tool, context-window, and assistant-completion facts have typed
  schemas.
- Tests prove scrubbed UI events cannot degrade persisted activity data.

### P0.3 Replayable Streams Without React Background Storms

Problem:
Snapshot plus hot PubSub can miss events. A naive fix that streams more data to
React would overload hidden tabs/threads during subagent-heavy local runs.

Plan:

- Change orchestration replay to return:
  - `events`
  - `nextSequence`
  - `upToDate`
- Add app-side gap detection.
- Repair gaps by calling replay before applying later events.
- Keep runtime UI on projection-level updates:
  - active thread: rich projection, RAF/16ms target
  - background thread: coarse status, no raw token/subagent deltas
  - refocus: projection catch-up by cursor
- Keep raw Pi events inside the runtime host/private ingestion path.

Acceptance:

- A snapshot/live subscription gap is detected and repaired.
- Replay pagination cannot silently truncate at the event-store default limit.
- Hidden subagent-heavy threads do not push raw deltas through React.
- Active-thread streaming remains responsive.

## P1 Scope

### P1.1 Durable Runtime Outbox

Problem:
Runtime ingestion is currently fire-and-forget with in-memory dedup and no durable
ack/checkpoint/retry.

Plan:

- Add a local durable outbox for typed runtime facts.
- Store:
  - `factId`
  - `threadId`
  - `runtimeSessionId`
  - `sourceEventId`
  - `kind`
  - typed `payload`
  - `createdAt`
  - `attempts`
  - `status`
  - last error/ack sequence when available
- Retry failed facts.
- Make server ingestion idempotent by fact id.

Acceptance:

- Backend outage does not permanently lose runtime facts.
- Retrying a fact is idempotent.
- Successful ingestion records an ack.
- Failed facts are observable for diagnostics.

### P1.2 Pi Turn vs Canonical Persistence Ordering

Problem:
The app can start Pi before server persistence. Runtime can succeed while the
canonical orchestration turn fails.

Plan:

- Prefer persistence-before-runtime for normal sends where possible.
- Where runtime must start first, persist a repairable local fact/intention.
- Surface Pi-only turns as recoverable, not invisible drift.
- Reconcile Pi JSONL entries back into canonical orchestration when persistence
  recovers.

Acceptance:

- A server dispatch failure after Pi start leaves a visible recoverable state.
- Recovery can backfill or explicitly discard the Pi-only turn.
- Duplicate prompt/edit cases do not create ambiguous branch ancestry.

### P1.3 Server-Authoritative Archive Lifecycle

Problem:
Archive currently persists while stop/abort/terminal cleanup is best-effort and
often swallowed. Startup archive paths can bypass WS-only side effects.

Plan:

- Treat archive as a server-side lifecycle operation.
- If work is running, emit stop request in the archive flow.
- Move cleanup to a reactor/side-effect layer.
- Surface cleanup failure as activity/state.
- Route startup inaccessible-root archive through the same lifecycle path.
- Update UI copy so it reflects stopping/cleanup state accurately.

Acceptance:

- Archiving a running thread emits archive and stop lifecycle evidence.
- Renderer abort failure does not determine archive correctness.
- Startup archive follows the same cleanup path.
- Cleanup failure is visible.

### P1.4 Pi Extension Command Semantics

Problem:
Some Pi extension actions currently return success-shaped no-ops.

Plan:

- Implement supported actions:
  - `fork`
  - `navigateTree`
  - `switchSession`
  - `newSession`
  - `reload`
- If an action is not supported yet, throw or report unsupported visibly.
- Never return `{ cancelled: false }` when no state change happened.

Acceptance:

- Extensions cannot believe a navigation/session action succeeded when it did
  not.
- Unsupported actions produce visible diagnostics.
- Implemented actions update runtime/session tree state correctly.

## P2 Scope

### P2.1 Thin Pi Tree Product Slice

Problem:
Honk projects Pi metadata but durable/UI tree behavior is mostly message-only and
diagnostic.

Plan:

- Keep message entries as the core navigable path.
- Persist minimal useful branch metadata:
  - labels
  - branch summaries
  - compaction checkpoints
  - active leaf/cursor metadata
- Replace or reshape the tree panel into a branch navigator.
- Clicking a navigable node dispatches `thread.tree.navigate`.
- Sending from a selected branch passes the selected `parentEntryId`.
- Keep non-message metadata out of the primary chat timeline unless it directly
  helps the user understand branch state.

Acceptance:

- User can select an older branch node and send from there.
- Branch label/summary survives reload/replay.
- Message edit still creates a sibling branch correctly.
- Background tree/session updates are coalesced.

### P2.2 Message Edit and Branch Identity

Problem:
Runtime currently associates client messages with Pi entries using exact text plus
sidecar entries. Duplicate prompt text can misassociate branch ancestry.

Plan:

- Prefer a real Pi metadata/correlation id if available.
- Avoid text-only matching for client-message to Pi-entry mapping.
- Keep sidecars only as compatibility or migration support.

Acceptance:

- Duplicate prompts can be edited/resumed without wrong ancestry.
- Branching edit sends create the intended sibling branch.
- Correlation survives reload.

### P2.3 Credential IPC Hardening

Problem:
The UI curates credential kinds, but the runtime host accepts broader provider
and method pairs.

Plan:

- Validate provider/method/kind pairs at the host boundary.
- Keep UI, contracts, runtime host, and docs aligned.
- Fix the README account drift or implement the missing provider end-to-end.

Acceptance:

- Unsupported provider/method pairs are rejected by the host.
- README and settings list the same supported account surface.

### P2.4 Regression Naming Cleanup

Problem:
Some canonical behavior tests are labeled as regressions.

Plan:

- Rename redundant `(regression)` test suite labels to behavior names.
- Keep coverage.
- Do not remove tests just because the function is canonical.

Acceptance:

- Prompt segment tests remain.
- Suite names describe behavior rather than issue history.

## Layered PR Sequence

1. Command boundary.
   - Public commands only on public dispatch.
   - Private runtime ingestion stub.
   - Internal-command rejection tests.

2. Typed runtime facts.
   - Fact schemas.
   - Derive from full unscrumbed runtime events.
   - Stop using scrubbed UI events for persistence.

3. Durable desktop outbox.
   - Local fact queue.
   - Retry and idempotency.
   - Ack/failure tracking.

4. Replayable orchestration stream.
   - Cursor replay result.
   - Gap detection.
   - App repair path.

5. Runtime UI backpressure.
   - Projection-level runtime catch-up.
   - Active/background visibility tiers.
   - Subagent event coalescing.

6. Archive lifecycle.
   - Server-owned stop/cleanup.
   - Shared startup/user archive path.
   - Visible cleanup failure.

7. Pi branch product slice.
   - Extension action behavior.
   - Branch navigator UI.
   - Minimal durable Pi metadata.
   - Edit/resume identity tests.

## Non-Negotiable Gates

- Public HTTP and WS dispatch cannot submit internal orchestration commands.
- Runtime persistence consumes full typed runtime facts, not scrubbed UI events.
- Replay responses expose enough cursor state to continue without loss or silent
  truncation.
- Hidden subagent-heavy threads do not stream raw deltas into React.
- Runtime facts are durable and retryable.
- Archive cleanup failures are explicit.
- Branch navigation is usable from the UI and survives reload.

Laziness Protocol

Writing code is cheap for you, which makes over-engineering easy. Counter it by borrowing a human maintainer's fatigue. Aim for the most result with the least code and complexity.
Prefer deletion. When asked to refactor or improve, look for removals before additions.
Maintain a flat hierarchy. Avoid deep abstractions. If answering a question requires tracing through more than 3 files or layers, flatten it.
Consolidate decisions. Do not repeat the same choice in several places. Put it behind one source of truth and pass the result as a simple flag.
Minimize the diff. Make the smallest change that solves the problem. Fewer lines beat "elegant" boilerplate.
Question the threading. If a task asks you to pass a new signal through types, schemas, pipelines, or similar layers, stop and look for a more direct path.
Prime directive: If a human developer would find the code exhausting to maintain, it is a bad solution. Be lazy. Stay simple.


Subtract Before You Add

When evolving a system, remove complexity first, then build. Deletion gives you a simpler base, which makes the next addition smaller and less brittle.

Why: Adding to a complex system compounds complexity. Removing first cuts the surface area, reveals the essential structure, and usually makes the next design obvious. Default to subtraction.

The pattern:
Sequence removal before construction
Cut before you polish (get to the minimum before investing in quality)
Design for observed usage, not speculative edge cases
No speculative validators, parsers, or guards beyond what the spec demands
Out-of-spec features drag validators behind them. Persistence, retry-on-startup, and schema migration each need guards to defend their inputs.
Simplify prompts (remove redundant instructions, excessive templates)
When a reference has no novel content, delete it rather than leaving a stub