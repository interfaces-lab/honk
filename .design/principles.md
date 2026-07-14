# Principles — honk's product-design judgment

Nine judgment calls — the decisions the lint *can't* make for you. For *how* to express any of
this in code, go to the platform and styling skills — this file never restates mechanics.

## 1. The inset recipe

The whole app is a deep root, an 8px gutter, and borderless `bg-base` cards floated on a half-pixel
ring shadow. A thread view is **one** card, split into regions by 1px hairlines — never sibling
cards, never nested panes. Depth comes from the single shadow ring and the layer-01/02/03 fills, not
from borders or boxes-in-boxes.
When building a new surface, this means: reach for one `Panel` and divide it with `Region` hairlines;
if you're tempted to add a second card inside the inset, you're fighting the recipe — merge it.

## 2. Tab + status language

The tab's status slot is honk's core vocabulary, and it is fixed: matrix glyph = working, green =
done, amber pulse = needs you, red = failed, hollow ring = draft, accent corner dot = unread, idle
gray = at rest. This tiny alphabet is how attention travels — Home carries the worst-status glyph of
its threads so trouble leaks through from anywhere. Never invent a new status color or a second
meaning for an existing one.
When building anything that reports state (a row, a tab, a badge), this means: map it onto exactly
these glyphs; if your state doesn't fit one, question whether it's really a new state or just noise.

## 3. Text-first — assistant output is never a bubble

User messages are the *only* bubbled element in the app. Agent prose, work, and thinking are
full-width text; hierarchy is carried entirely by a four-role type ramp — **primary prose** (what the
agent says), **muted verbs** (Explored / Edited / Ran), **faint detail** (paths, counts), and **mono
evidence** (diffs, output). No status icons on tool calls, ever. This is the one hard law of the
thread surface.
When building any agent-output element, this means: choose a type role, not a container; if you're
reaching for a bubble, border, or a green check on a tool call, stop — the ramp already says it.

## 4. Restraint — color carries status, never identity or decoration

Color is spent on exactly one job: status. Tool tabs are a 12px glyph + a label, never a colored
icon; identity reads from shape and text, not hue. The accent is the one brand hue and it marks focus
and primary intent, not decoration. A screen that uses color to look lively has spent the budget that
status needs to be legible.
When building a component, this means: default everything to the text/faint ramp and reserve the
status family + accent for meaning; if a color isn't reporting state or focus, take it out.

## 5. Two audiences, one dial

honk serves builders and engineers over the *same* data; the "engineering details" dial swaps
vocabulary and chrome density, it never forks features. Uncommitted↔Latest changes, Commit & Push↔Ship
it, worktree↔safe copy, merged↔shipped — same rows, re-labeled. Status glyphs never translate. A
feature that only one audience can reach is a bug, not a tier.
When building a surface, this means: design one information architecture and route wording through the
dial; if you find yourself hiding a *capability* (not just renaming it) behind the dial, you've forked
the product — don't.

## 6. Honesty over chrome

Every control does what it says or it doesn't exist. No cosmetic affordances that lie (no fake
terminal "clear" that resurrects on reload), and no ambient judgment calls in the chrome. Durable
notices are **parts** in the stream, never transient pop-ups; a toast is reserved for brief local
feedback such as “copied” or an action failure, on the single friendly top-center Sonner surface.
A turn boundary is a real patch-chip receipt that navigates to the diff, not a decorative divider.
Deterministic chrome earns trust; magic chrome spends it.
When building a control or a notice, this means: wire it to a real effect and a real place, or cut it;
render durable status as a Part, and use a toast only when the feedback has no durable home.

## 7. Close is a view act, never a work act

⌘W closes what you're looking at, scoped to focus (workbench focus → the active workbench tab; chat
focus → the thread tab), Home is pinned and skipped, only ⌘Q quits. Agents keep running in the deck
when you close their tab — closing is hiding, not stopping. ⌘⇧T reopens; ⌘N is new chat; ⌘T stays
Terminal. The mental model is a browser, not a document you might destroy.
When building anything that dismisses, this means: closing a view must never cancel the work behind it;
if a gesture could kill running work, it needs a different, explicit control — and probably a
different key.

## 8. Queue-first composer — one behavior

⏎ always queues. On an idle thread the queue drains instantly so it *feels* like send; on a running
thread the tray materializes (reorder · update · send-now — the Core queue verbs) and ⌘⏎ force-sends
as a steer. One behavior, one button that reads Send or Queue depending on state — never two modes the
user has to think about. Questions embed *in* the composer surface; the composer below never changes
its job.
When building composer or input behavior, this means: model it as enqueue + drain, not send-vs-queue
branches; if you're adding a second input mode, collapse it back into the one queue behavior.

## 9. One command menu, three doors

There is a single search-and-act engine. Home renders it inline and always focused; ⌘K summons it
anywhere; ⌘O is the same overlay pre-scoped to threads. Ranking is fixed and never smart:
Start-new → threads → commands, so ⏎ always means the same thing. Scope (where the agent runs) is the
costly decision and Tab owns it. Don't build a second picker, a smart re-ranker, or a bespoke palette
for one surface.
When building any "find or do" affordance, this means: it's this one component with a scope, not a new
menu; keep the ranking order fixed and make ⏎ predictable.
