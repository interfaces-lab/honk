# Honk

A coding-agent product with a strong UI emphasis: one Core per machine runs agents; every surface
(desktop, web, CLI) is a Client of that Core.

## Language

**Core**:
The single Honk process on a machine that executes agents and owns all durable state. Everything else
attaches to it.
_Avoid_: backend, server, runtime host, engine

**Client**:
Any surface attached to the Core — the desktop app, a web browser, the CLI. Clients render and command;
they never execute agents or own durable state.
_Avoid_: frontend, app (ambiguous with the desktop shell)

**Core App**:
A Client that may also start the Core when none is running: the desktop app and the CLI. Web is never a
Core App — it waits for a running Core and attaches.
_Avoid_: launcher, host app, native client

**Serve Mode**:
Running the Core explicitly and headless via the CLI so it outlives any app — how web and remote Clients
get a Core to attach to without the desktop running.
_Avoid_: daemon, background service

**Thread**:
One conversation with an agent, including all of its branches. The unit clients subscribe to.
_Avoid_: session (reserved for auth and for harness-internal state), chat

**Thread Summary**:
The sidebar-grade projection of a Thread: title, status, and small metadata. It changes only on specific
invocations (rename, auto-title replacement, status transitions) — never as a side effect of Part
traffic. Clients watching the workspace subscribe to summaries, not to every Thread's Parts.
_Avoid_: thread list item, shell snapshot

**Canonical Record**:
The Core's private, durable, append-only account of everything that happened in a Thread. It never
leaves the Core; the public wire only ever carries projections of it.
_Avoid_: event log (implies publicly replayable), session file, transcript (that's what the model sees)

**Part**:
The render-ready atom of a conversation as Clients see it: a closed tagged union (text, reasoning, tool,
plan, question, …) with a stable id and a lifecycle state. Threads are painted from a Part
snapshot and patched by seq-stamped Part deltas — never by parsing content or ordering heuristics.
_Avoid_: block, chunk, timeline item, display item

**Extension**:
User-installed code that extends the Core — never a Harness. Extensions observe the projection, contribute
custom Parts and commands, and register tools that reach every Harness's model context through MCP.
_Avoid_: plugin, add-on

**Harness**:
An engine that runs an agent loop, integrated into the Core as a sibling adapter: pi (the native and most
customizable one), Claude Code (via the Anthropic Agent SDK), and Cursor (via ACP). Each Harness keeps its
own internal session state; the Core writes the Canonical Record by observing Harness events.
_Avoid_: provider (that's a model vendor), engine, runtime

**Provider**:
A model/credential vendor: Anthropic, OpenAI (Codex), Cursor. Each Provider's models execute through
exactly one Harness and unlock in exactly one way (ADR 0016): Anthropic via the delegated local Claude
Code login, Codex via OAuth through pi, Cursor via a stored API key.
_Avoid_: harness, vendor

**Queue**:
Delivery of input that waits until the agent would otherwise stop, then starts the next turn. Queued
input is projected state: every Client sees it, any Client can cancel it.
_Avoid_: follow-up, nextTurn

**Steer**:
Delivery of input injected into the running turn at the next safe point, without stopping it.
_Avoid_: mid-turn message, nudge

**Interrupt**:
Stopping the running turn immediately. May carry a message, which starts a new turn right away (force
send). The stopped turn always settles as an explicit aborted outcome — uniformly, whichever provider was
running.
_Avoid_: force send, stop, cancel (cancel is for removing Queued items)

**Prompt Token**:
A text-embedded reference inside a message — `[$skill](skill-path)`, a file mention — rendered by
Clients as chips but stored and sent as nothing more than the raw text the model sees. The grammar is
part of the contract; the SDK ships the parser.
_Avoid_: entity, chip (the UI component), mention, rich text

**Mode**:
The picker-level name for a pinned (model, thinking level) pair — Rush, Smart, Deep, Composer. UI
vocabulary only: the wire carries `model` and `thinkingLevel`, never a mode id, and the Core defines
which pairs are offered. Once a message is submitted, the pair never changes (ADR 0014).
_Avoid_: agent mode (legacy), preset, model profile

**Interaction Mode**:
The per-send posture constraining what the agent may do this turn — agent, ask, plan, debug, multitask.
Distinct from Mode: it travels on every send (plan→implement flips it mid-thread), the Core defines each
posture's meaning (toolsets, prompt), and every Harness projects what it can honor. This is the safety
mechanism — never permission prompts (ADR 0007).
_Avoid_: mode (reserved for the model pair), permission level, agent mode

**core/v1**:
The versioned schema namespace that defines the Core's wire contract. The version segment changes only on
breaking wire changes — the same role Cursor's `agent/v1` protobuf namespace plays, but authored as
schemas in our own code.
_Avoid_: contracts (the legacy package), protocol
