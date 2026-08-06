# The conversation surface

How a Honk thread renders an agent turn: what the user sees while the agent
works, what it collapses to when the agent finishes, and who controls how much
detail is on screen.

Reference: Cursor 3.15.1 (`workbench.glass.main.js`, sha256 `020a4bce8862b87b…`),
investigated per `docs/cursor-parity-handbook.md`. Behavioral rules below are
translated, not transplanted. Pi's TUI is the reference for narration.

## 1. The turn grammar

A Pi assistant turn is an ordered stream of content blocks: text, tool calls,
text, tool calls. Tool results arrive separately, keyed by call id. That order
is the whole segmentation model — nothing new is stored:

```
turn    := planning? segment* summary?
segment := headline (one assistant text block)
           followed by a run of tool calls and their results
```

- **Planning** is the gap between the user's message and the first block. The
  surface shows a "Planning next move" shimmer.
- **A headline** is any assistant text block emitted between tool work. The
  model narrates naturally; Honk does not prompt for it. A segment without a
  preceding text block gets no headline and still renders.
- **The summary** is the turn's final text block. It stays visible after the
  turn collapses.

## 2. Disclosure layers

Every turn renders at one of four layers. Same data, different depth:

| Layer | Shows                                                        |
| ----- | ------------------------------------------------------------ |
| L0    | "Worked for 5m 16s" + the ending summary                     |
| L1    | Segment headlines + the rolling preview window               |
| L2    | Full transcript: every headline, every tool row              |
| L3    | One tool row opened: arguments, output, diff                 |

Clicks walk down: L0 header → L1/L2, preview window → L2, tool row → L3.
Collapse walks back up.

## 3. Density is state, on two axes

- **The setting** is the existing app-wide `conversationDensity` from
  `@honk/shared/conversation-density` — an Effect schema with three runtime
  values (legacy stored values migrate at decode). It picks the default layer
  per phase:

  | Value                            | While running | After settle |
  | -------------------------------- | ------------- | ------------ |
  | `compact-all-grouped` (Compact)  | L1            | L0           |
  | `compact-ungrouped` (Balanced)   | L1            | L1           |
  | `detailed` (Detailed)            | L2            | L2           |

- **The per-turn override** is written by clicking a turn's surfaces and wins
  over the setting for that turn only.

Effective layer = `turnOverride ?? densityDefault(phase)`. That one line is
the whole reconciliation. Even at `detailed`, L3 stays closed until clicked —
density never auto-opens raw tool output.

## 4. The grouping rule

Only read-shaped work groups. Minimum two consecutive read-shaped calls form
a group ("Read 3 files"). **Edits and shell commands never disappear into a
group** — at every density they keep a visible row. This is the safety rule:
anything that could change the world stays on screen.

There is exactly one classifier: core's `Tools.writesOf`, the same split the
checkpoint attribution gate uses. `"none"` is read-shaped; `"declared"` and
`"opaque"` are not — so an unknown tool (MCP, future built-ins) never groups,
erring toward visible. As the harness grows read-only tools (grep, glob,
fetch), they become groupable by joining the classifier, not by joining a
transcript list.

## 5. The preview window

One surface with two states. It never unmounts:

- **Running**: a fixed-height, one-line ticker under the current headline.
  Shows the active tool as `action detail` ("bash pnpm vitest run …"),
  shimmering. Labels swap **in place** — the window never grows, the layout
  never shifts. While the model writes prose, the text streams **outside the
  window** as ordinary transcript markdown, Cursor-style; the window holds
  its last completed label. When the next block arrives the prose takes its
  place — a tool call makes it the new segment's headline and the window
  resumes with that tool's label; the end of the turn makes it the summary.
  The ticker is the turn's single status organ: retry countdowns and
  queued-prompt counts render here too.

  A tool row shows its name exactly once: the step's `name` is the only name
  source, and `detail` is a path or command extracted from the arguments —
  never the tool's name repeated. (The old transcript projection copied the
  result's `toolName` into a title and rendered "Read Read"; that path is
  deleted and the shape makes it unexpressible.)
- **Settled**: the same surface becomes the header — "Worked for 5m 16s",
  or "Stopped" / "Canceled" when the run did not finish. A failed turn
  collapses like a finished one; only the label tells the truth.

## 6. Motion rules

- The ticker window is fixed height; only text moves. Outgoing label floats
  up ~7px and fades; incoming rises in. ~220ms, ease-out.
- **The ✓ beat**: when a tool finishes, its shimmer stops and a ✓ stamps for
  ~260ms before the next label enters. Progress is shown, not implied.
- Roll-ups happen inside the ticker: when reads cross the group minimum, the
  label becomes the rolled line ("Read 3 files…").
- Settling is a becoming, not a replacement: the ticker turns into the
  duration header in place; the summary fades in.
- Expansion animates height measured from content. Rows inside never animate
  individually. Density flips are layout-stable: geometry is measured before
  the flip, so text-variant changes cannot cause width or height jumps.
- Under `prefers-reduced-motion`, swaps become instant and the shimmer
  becomes static muted text.

## 7. The composer contract

How text leaves the composer, verbatim from Pi's own TUI (the reference
implementation of chatting with this harness), translated to Honk surfaces.

### Sending

| User intent            | Verb       | Delivery                                        |
| ---------------------- | ---------- | ----------------------------------------------- |
| Send while idle        | `prompt`   | starts the turn                                 |
| Send while running     | `steer`    | at the loop boundary — after the current batch of tool calls |
| Queue for after the run | `followUp` | only after the agent finishes all work          |

While a run is active both verbs stay reachable; a composer setting picks
which one plain Enter means:

- `sendWhileRunning: "queue"` (default) — Enter queues a follow-up, ⌘⏎
  steers now. Matches the composer's shipped hint ("⏎ queues · ⌘⏎ sends
  now").
- `sendWhileRunning: "steer"` — Enter steers (Pi TUI's default), ⌘⏎ queues.

Shift+Enter stays newline in both modes. Streaming does not change the
bindings — the verbs mean the same thing at every moment of a run.

Separately from the verb choice, queue **delivery pacing** is Pi's own mode,
`one-at-a-time` (default) or `all`, mirroring `steeringMode`/`followUpMode`.

### The queue is harness truth, not client state

Pi's `queue_update` event carries the full queue contents (steer, follow-up,
next-turn). The composer renders queue rows from that event and keeps no
shadow queue — a renderer reload cannot lose or duplicate queued messages,
and the queued count in the preview window reads the same truth.

### Editing a queued message is recall, not in-place edit

Pi's rule, adopted whole: queued text is pulled **back into the composer** to
change it — there is no in-queue editor. Two paths:

- **Abort restores**: `abort()` returns the cleared steer and follow-up
  messages (`AbortResult`), and the composer puts that text back in the
  editor. Stopping never destroys something the user typed.
- **Recall while running** (Pi TUI's Alt+Up, "Restore queued messages to
  editor"): shipped TUI behavior at the pinned revision. The harness API it
  uses is not visible in the 0.83 public typings — *verify in Pi's TUI
  source when building recall in core*. Until then, recall rides the abort
  path.

"Stop and send" is therefore a composition, not a verb: abort → text
restored → prompt.

### Editing a sent message opens a branch

Pi's session is a tree, and both edit shapes are native:

- **In-place branch** (TUI `/tree`): navigate to the point before the edited
  message and prompt the new text — a sibling branch in the same session.
  This is the chat surface's "edit sent message".
- **Fork** (TUI `/fork`): a new session file from a prior user message with
  the prompt modified. A session-list operation, not a transcript one.

### The active-path rule (core invariant)

The moment branching exists, every linear read must follow the **active
branch**, not the whole tree: authoritative reloads read Pi's `getBranch()`,
and the turn grammar, workspace trail, model record, and per-turn change
pairing all walk that path. Checkpoints are keyed by entry id and are
branch-agnostic by construction — a revert target stays valid across branch
switches. Today's core reads `getEntries()` (the whole tree); that is
correct only while no branching command is exposed, and switching to
active-path reads is a prerequisite of `session.navigateTree`.

Core commands this contract still owes: `session.abort` returning the
cleared queue, queue-mode settings, `session.navigateTree`, and active-path
reloads. `queue_update` already flows to clients through `session.events`.

## 8. Git actions in the conversation

A Git action ("Commit & Push", "Create Branch & Commit", …) is an agent turn
the user starts with one click instead of typed text. Nothing about it is a
second kind of message:

- **One core command.** `session.gitAction` appends a `honk.git_action`
  marker entry (`{action, files?}`) and prompts the harness with the
  action's canonical instructions — server-side, in that order, in one
  handler. The instruction text lives in core, so every client that names an
  action sends the same words; the app owns only labels.
- **The chip is a rendering, not an entry kind.** The transcript pairs the
  marker with the user message that follows it and renders the pair as one
  chip: the action label, the loading label while the paired turn runs, the
  turn's outcome and receipt at settle. Expanding the chip shows the
  canonical instruction text — the transcript never hides what the model
  was told (core spec §3: what the model saw is what the surface shows).
- **Failure renders itself.** A marker with no user message after it means
  the prompt was refused (busy, model error) and no work ran; the chip shows
  "didn't start". No cleanup, no orphan state to reconcile.
- **Idle-only.** While a run is active the action buttons disable. A Git
  action never rides steer or follow-up, so the chip's pairing stays a
  straight read of entry order and the send-verb contract (§7) is untouched.
- **The offer is chrome.** The button that starts an action (under a settled
  turn's change receipt, or in a source-control surface) is interface
  chrome like the composer — it exists nowhere in the transcript until
  clicked, and then only as the real entries above.

The turn a chip starts is an ordinary turn: grammar, density, disclosure,
and receipts apply unchanged.

## 9. What this deletes

Permission and question trays (core has no mid-run asks), the subagent tray
(Pi has no child sessions), and composer modes (Pi's knobs are model and
thinking level). The old message/part turn model in `transcript-model` is
replaced by the segment grammar above.
