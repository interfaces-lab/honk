# Desktop shell and workbench

The inset recipe is a deep root, 8px gutter, and one borderless base panel floated by a half-pixel ring.
A thread is one panel divided into regions by hairlines, not sibling cards or nested panes. Depth comes
from the ring and layer fills.

Status vocabulary is fixed: matrix glyph working, green done, amber pulse needs attention, red failed,
hollow ring draft, accent corner dot unread, idle gray at rest. Home carries the worst status from its
threads. Do not assign a second meaning or invent another status color.

Command-W closes the focused workbench or thread view, skips pinned Home, and never stops work;
Command-Q quits, Command-Shift-T reopens, Command-N starts chat, and Command-T remains Terminal.

One search-and-act engine has three doors: inline focused on Home, Command-K globally, Command-O
pre-scoped to threads. Ranking remains Start new → threads → commands; Tab owns scope. Do not add a
bespoke picker or smart reranking.
