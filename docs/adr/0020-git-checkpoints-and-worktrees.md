# Git checkpoints live in the Core; worktrees are optional and orthogonal

Status: accepted (Round 7 grill, 2026-07-03)

## Context

Round 7 ports the app off the legacy WS-RPC git surface. Two prior systems were studied for how an
agent product tracks "what the agent changed" and how it isolates parallel work:

- **opencode** takes tree-hash snapshots around every step into a *separate shadow git repo*
  (`--git-dir <data>/snapshot/<project>`, `git add . && git write-tree`), diffs the first-step-start
  hash against the last-step-finish hash for a session diff, and restores/reverts by tree hash. It has
  **no worktrees** — every agent works in the real tree; isolation is purely temporal.
- **t3code** takes the same kind of snapshot but as *hidden dangling commits inside the same repo*
  under `refs/t3/checkpoints/<threadId>/turn/<n>` (temp index → `write-tree` → `commit-tree` →
  `update-ref`, HEAD/index/branches untouched), keyed **per-thread, per-turn** — baseline on
  `turn.started`, capture on `turn.completed`. That yields a per-turn diff (`n-1 → n`), a full-thread
  diff (`0 → n`), and stepwise revert. Worktrees are a **separate, opt-in** feature (`git worktree
  add -b t3code/<hex>`), and checkpoints work with or without them.

The legacy honk stored `branch`/`worktreePath` on threads and ran a large server-side `GitManager`.
The new Core has no git surface yet. The decision: where change-tracking lives, and whether worktrees
survive.

## Decision

1. **Change-tracking is a Core domain (`checkpoint.ts`), not a client concern.** The snapshot is taken
   around a *turn*, and the turn lifecycle is owned by the Core — so the Core owns the checkpoint. It
   adopts t3code's **hidden-ref, same-repo** mechanism (not opencode's separate shadow repo): a temp
   index + `write-tree` + `commit-tree` + `update-ref` under `refs/honk/checkpoints/<b64url(threadId)>/
   turn/<n>`. HEAD, the index, and every real branch are never touched. No real commits are created by
   change-tracking.

2. **Checkpoints are keyed per-thread, per-turn**, with a turn-0 baseline. The Core captures on the
   turn-lifecycle boundaries it already owns (`startTurn` → baseline if absent; `settleTurn` → capture),
   and emits the checkpoint ref on the turn's parts. Two projections serve the UI: **turn diff**
   (`turn n-1 → n`) and **full-thread diff** (`turn 0 → n`). Revert restores a checkpoint into the
   working tree.

3. **Every client gets the diff/revert timeline over core/v1** — web serve mode included — because it
   is Core state, not desktop-local.

4. **Worktrees survive, but are opt-in and orthogonal** (t3code's model). A thread may run in the main
   checkout or in an isolated worktree; checkpoints work identically either way, operating on whatever
   cwd the thread resolves to. Worktree *provisioning and lifecycle* (create on first turn, `worktree
   remove` on orphaned delete, branch naming, PR prep) stay **desktop-local** — they are filesystem and
   forge concerns the Core needn't own for v1. The thread carries an optional opaque `worktree` field so
   the Core can resolve the right cwd and every client can label it.

5. **Init-if-no-git is offered, not automatic.** When a thread's cwd is not a git repo, the client shows
   an explicit "Initialize repository" action (→ `git init`); until then, change-tracking is disabled
   for that thread and the UI says so. The Core never initializes a user's repo behind their back.

## How "per-turn" maps onto the Core's turn lifecycle

t3code snapshots on `turn.started`/`turn.completed`. Our Core already owns those exact boundaries, and
"per-turn" maps onto them cleanly precisely because a *turn* is our unit — not a message and not a
step:

- **Baseline** is captured in `startTurnLocked` (turn/0), once per thread, the first time any turn runs
  against a repo cwd.
- **Capture** happens in `settleTurn` for *every* terminal state — `completed`, `aborted`, and
  `failed` alike — so "what this turn changed" reflects whatever hit disk, even on an interrupted turn.
- **Steer folds in, it does not fork.** Steered input is consumed by the *running* turn (the awaitable
  mailbox), so it produces no new turn and no new checkpoint — its edits are captured at that turn's
  settle. Correct: steer is mid-turn, not a turn of its own.
- **Queue promotion and supersede each make their own turn.** A promoted queued message and an
  interrupt-with-message successor both run as fresh turns through `startTurnLocked`/`settleTurn`, so
  each gets its own capture — exactly one before/after pair per turn that actually ran.
- **Keying.** Checkpoints are keyed by a per-thread monotonic turn ordinal `n` (the count of turns
  started on the thread). Branches (edit/resend siblings) share the ordinal space but each turn owns a
  distinct ref, so no collision. Turn-diff is `n-1 → n`; full-thread-diff walks turn/0 → the active
  leaf's turn. A tool-heavy turn yields one pair, not one per step (finer granularity can come later
  without a wire break — see below).
- **Fail-open, always.** Capture and baseline are detached from settlement correctness: a non-repo cwd
  or any git error disables tracking for that turn (logged per Round 6), and never wedges or fails the
  turn. Change-tracking is best-effort observability layered on top of the turn machine, never a
  dependency of it.

## Consequences

- A new `checkpoint.ts` Core domain plus a small `worktree` field on the Thread wire — the only new
  core/v1 surface Round 7 adds beyond PTY. It fits the Part model: a `step`/`patch` Part per turn
  carrying the checkpoint ref and changed-file summary.
- The desktop aux `git.ts` port keeps only its **management** half (worktree/branch/PR); its
  change-tracking half is superseded by `checkpoint.ts` and is not wired into the app.
- "Similar to current methods" (worktrees stay) and "how opencode handles it" (a snapshot-diff
  timeline) both hold, because t3code demonstrates the two are independent.
- Rejected: opencode-exact (drop worktrees) — discards parallel-thread isolation the current flow
  relies on, for no gain once snapshots no longer require dropping them. Rejected: a wholesale
  desktop-local git port — it would deny web clients the diff timeline and put change-tracking below
  the Core that owns the turns it tracks.

## Open (grill) questions folded into this proposal

- Snapshot cadence is per-turn (not per-step); a turn with many tool steps yields one before/after pair.
  Finer granularity can come later without a wire break (the ref scheme already namespaces by turn).
- Checkpoint refs are pruned when their thread is deleted; orphaned-worktree cleanup mirrors t3code
  (prompt on delete when the thread is the last referrer). No periodic GC in v1.
