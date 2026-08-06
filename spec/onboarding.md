# Onboarding

> **Status:** White canvas. This records what a first-run user must get through
> before Honk is useful. No page here is designed yet — this is the inventory we
> design from, not the flow itself.

## What must be true before Honk is useful

Ordered by how hard the requirement actually is:

1. **A coding account.** Threads run on Codex (OpenAI sign-in) or Claude Code
   (an existing `claude` CLI session on this machine). Without at least one,
   Honk can open but cannot work. This is the only hard gate.
2. **A folder to work in.** A default project folder is convenience, not a
   requirement — the composer can pick a folder per thread.
3. **Workspace trust.** Per `spec/core.md` §5, opening a workspace requires one
   trust decision; an untrusted workspace is unopened, not restricted. This is
   a per-workspace gate, not a per-install one.
4. **Everything else is preference.** Worktree-vs-checkout default, background
   alerts, alert sounds — all optional, all editable in Settings afterward.

## Pages to get a user started

The candidate inventory, by job — not by screen design:

| #   | Page                | Job                                                                                                          | Required?                                       |
| --- | ------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| 1   | Welcome             | Identify the product; offer the one fork: start now with defaults, or configure first                        | Yes — it is the entry                           |
| 2   | Coding accounts     | Connect Codex and/or detect Claude Code                                                                      | The only real gate; skippable but consequential |
| 3   | Project folder      | Choose the default folder; set worktree default                                                              | Optional                                        |
| 4   | Alerts              | Decide when background work may interrupt                                                                    | Optional                                        |
| 5   | Ready / orientation | Hand over the minimal mental model (Enter queues, ⌘⏎ steers, ⌘K finds, ⌘W never stops work) and exit to Home | Yes — it is the exit                            |

Workspace trust is deliberately **not** a page yet — see open decisions.

## Canvas layout (decided)

Every onboarding page shares one frame, split in half (`OnboardingLayout`):

- **Left half:** recurring generative art — written by math and code, never an
  asset — on its own palette, deliberately outside Honk's themed colors
  (drafting paper and ink). First piece: an abstract gear train of three gears
  drawn only as circular fans of radial lines. Rules of that gear world:
  meshing gears sink exactly halfway into each other's lines (so ring midlines
  are true pitch circles), holes stay large so bands read as gear rather than
  sun, periods are ratio-locked to tooth counts, and phases are solved so the
  lines interleave like teeth and never cross.
- **Right half:** the white canvas where each page's content renders.

## System constraints any design must honor

- Setup lives at `/setup` in the one Honk window; the desktop opens it directly
  on first run, before the backend is reachable. Page 1 cannot depend on a
  connection.
- The flow is replayable from the command menu (`replay` search param). A
  replay may leave via Escape; a true first run has no exit but finishing.
- Nothing is durable until written. Replaying setup must never overwrite a real
  prior choice (e.g. an already-set project folder).
- Every value setup writes stays editable in Settings; setup is a shortcut,
  never the only door.
- Claude Code is a read-only probe — setup reports its state and never offers a
  control it cannot honor.

## Open decisions (awaiting direction)

1. Does workspace trust join onboarding, or stay at first folder open? The core
   spec makes it per-workspace, which argues for first-open.
2. Does the defaults-vs-configure fork survive the redesign, or does the new
   flow take a different shape entirely?
3. Is a coding account worth blocking on (page 2 as a soft wall), or does Honk
   open empty-handed and prompt at first thread?
4. What does "started" mean — finishing setup, or reaching a first running
   thread? The answer decides whether onboarding ends at Home or at a seeded
   first action.
