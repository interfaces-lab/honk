// Pure ranking for the command menu (locked.html §0.5 / §3). Ranking is FIXED,
// never smart: Start-new → threads → commands. A command-verb match may float
// Commands within its band; nothing else reorders bands. Dev/feature-flag
// entries live in a separate registry later — never in SHIPPING_COMMANDS.
//
// Scoring ports the old palette's prefix / exact / includes ideas (lean, no
// @honk/shared dep). Submenu frames replace the root list when the stack is
// non-empty (parity keep: submenu stack).

import type { WorkspaceState } from "./sidecar";

import type { TabStatus } from "./tab-store";
import type { CommandMenuDoor, CommandMenuSubmenuFrame } from "./command-menu-store";

/** Thread row shape from the workspace watch — no direct @honk/api import. */
export type CommandMenuThread = WorkspaceState["threads"][number];

// ── Item vocabulary ──────────────────────────────────────────────────────────────────────────

export type CommandMenuItemKind = "start-new" | "thread" | "command" | "submenu" | "header";

export type CommandMenuItem =
  | {
      readonly kind: "header";
      readonly id: string;
      readonly label: string;
    }
  | {
      readonly kind: "start-new";
      readonly id: "start-new";
      readonly title: string;
      readonly queryPreview: string;
      readonly searchTerms: readonly string[];
    }
  | {
      readonly kind: "thread";
      readonly id: string;
      readonly threadId: string;
      readonly title: string;
      readonly status: TabStatus;
      readonly searchTerms: readonly string[];
    }
  | {
      readonly kind: "command";
      readonly id: string;
      readonly title: string;
      readonly shortcut?: string;
      readonly searchTerms: readonly string[];
      readonly run: CommandMenuCommandId;
    }
  | {
      readonly kind: "submenu";
      readonly id: string;
      readonly title: string;
      readonly searchTerms: readonly string[];
      readonly frame: CommandMenuSubmenuFrame;
    };

/** Shipping command ids — run handlers live in the surface, not the model. */
export type CommandMenuCommandId = "new-thread" | "open-settings";

export type ShippingCommand = {
  readonly id: string;
  readonly title: string;
  readonly searchTerms: readonly string[];
  readonly shortcut?: string;
  readonly run: CommandMenuCommandId;
  /** When true, this command is the Start-new primary row (not listed under Commands). */
  readonly isStartNew?: boolean;
};

// Shipping registry only. Dev flag toggles / engineering-details dial stay out
// (docs/ui-parity.md: separate dev registry, never the shipping list).
export const SHIPPING_COMMANDS: readonly ShippingCommand[] = Object.freeze([
  {
    id: "start-new",
    title: "Start new chat",
    searchTerms: Object.freeze(["start new chat", "new thread", "new chat"]),
    shortcut: "⏎",
    run: "new-thread",
    isStartNew: true,
  },
  {
    id: "new-thread",
    title: "New thread",
    searchTerms: Object.freeze(["new thread", "new chat", "start"]),
    shortcut: "⌘N",
    run: "new-thread",
  },
  {
    id: "open-settings",
    title: "Open settings",
    searchTerms: Object.freeze(["open settings", "settings", "preferences", "appearance"]),
    run: "open-settings",
  },
]);

export const RECENT_THREAD_LIMIT = 12;

// ── Status mapping (SDK ThreadSummary → tab / StatusDot vocabulary) ──────────────────────────

/** Map Core ThreadSummary onto the board's tab status alphabet. */
export function tabStatusFromSummary(summary: CommandMenuThread): TabStatus {
  if (summary.needsAttention) {
    return "needs-you";
  }
  switch (summary.status) {
    case "running":
      return "working";
    case "failed":
      return "failed";
    case "idle":
      return "idle";
    default: {
      const _exhaustive: never = summary.status;
      return _exhaustive;
    }
  }
}

/** StatusDot tone for a tab-status word (principles.md §2). */
export function statusDotTone(
  status: TabStatus,
): "ok" | "warn" | "err" | "neutral" | "draft" {
  switch (status) {
    case "done":
      return "ok";
    case "needs-you":
      return "warn";
    case "failed":
      return "err";
    case "draft":
      return "draft";
    case "idle":
    case "working":
      return "neutral";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

export function statusDotPulse(status: TabStatus): boolean {
  return status === "needs-you";
}

// ── Ranking ──────────────────────────────────────────────────────────────────────────────────

export type RankCommandMenuInput = {
  readonly query: string;
  readonly door: CommandMenuDoor;
  /** Home inline hides the Commands band at rest (locked §3 note). */
  readonly hideCommandsAtRest?: boolean;
  readonly threads: readonly CommandMenuThread[];
  readonly commands?: readonly ShippingCommand[];
  readonly submenuStack?: readonly CommandMenuSubmenuFrame[];
};

/**
 * Build the flat, ranked list the surface renders. Headers are non-selectable
 * markers; selectable rows are everything else. Selection indices in the store
 * address the selectable list only — use `selectableItems` / `flattenForSelection`.
 */
export function rankCommandMenuItems(input: RankCommandMenuInput): readonly CommandMenuItem[] {
  const commands = input.commands ?? SHIPPING_COMMANDS;
  const stack = input.submenuStack ?? [];
  const needle = input.query.trim().toLowerCase().replace(/\s+/g, " ");

  // Submenu replaces the root ranking (parity keep). Empty stub until project
  // pickers land — still honest: show the frame title as a header + empty.
  if (stack.length > 0) {
    const top = stack[stack.length - 1];
    if (top === undefined) {
      return Object.freeze([]);
    }
    return Object.freeze([
      {
        kind: "header" as const,
        id: `submenu:${top.id}`,
        label: top.title,
      },
    ]);
  }

  const startNew = commands.find((c) => c.isStartNew);
  const commandBand = commands.filter((c) => !c.isStartNew);

  const activeThreads = input.threads
    .filter((t) => t.archivedAt === null)
    .slice()
    .sort((a, b) => {
      const byUpdated = b.updatedAt.localeCompare(a.updatedAt);
      return byUpdated === 0 ? String(a.id).localeCompare(String(b.id)) : byUpdated;
    });

  // ⌘O door: threads only (plus Start-new when the query is empty so ⏎ still
  // means the same thing — locked ranking law).
  if (input.door === "threads") {
    return Object.freeze(
      buildList({
        queryText: needle,
        startNew: needle.length === 0 ? startNew : undefined,
        threads: filterAndRankThreads(activeThreads, needle),
        commands: [],
        forceThreadHeader: true,
      }),
    );
  }

  const rankedThreads = filterAndRankThreads(activeThreads, needle).slice(
    0,
    needle.length === 0 ? RECENT_THREAD_LIMIT : undefined,
  );
  const rankedCommands =
    needle.length === 0 && input.hideCommandsAtRest
      ? []
      : filterAndRankCommands(commandBand, needle);

  return Object.freeze(
    buildList({
      queryText: needle,
      startNew,
      threads: rankedThreads,
      commands: rankedCommands,
      forceThreadHeader: false,
    }),
  );
}

/** Selectable rows only — what ArrowUp/Down and Enter address. */
export function selectableItems(
  items: readonly CommandMenuItem[],
): readonly Exclude<CommandMenuItem, { kind: "header" }>[] {
  return items.filter(
    (item): item is Exclude<CommandMenuItem, { kind: "header" }> => item.kind !== "header",
  );
}

function buildList(input: {
  queryText: string;
  startNew: ShippingCommand | undefined;
  threads: readonly CommandMenuThread[];
  commands: readonly ShippingCommand[];
  forceThreadHeader: boolean;
}): CommandMenuItem[] {
  const items: CommandMenuItem[] = [];

  if (input.startNew !== undefined) {
    // Start-new always leads when present — ⏎ means the same thing (locked §3).
    // The typed query becomes the preview; it is never filtered out of the band.
    items.push({
      kind: "start-new",
      id: "start-new",
      title: input.startNew.title,
      queryPreview: input.queryText,
      searchTerms: input.startNew.searchTerms,
    });
  }

  if (input.threads.length > 0) {
    items.push({
      kind: "header",
      id: "header:threads",
      label: input.forceThreadHeader || input.queryText.length > 0 ? "Threads" : "Jump back in",
    });
    for (const thread of input.threads) {
      items.push(threadItem(thread));
    }
  }

  if (input.commands.length > 0) {
    items.push({
      kind: "header",
      id: "header:commands",
      label: "Commands",
    });
    for (const command of input.commands) {
      const row: Extract<CommandMenuItem, { kind: "command" }> = {
        kind: "command",
        id: command.id,
        title: command.title,
        searchTerms: command.searchTerms,
        run: command.run,
        ...(command.shortcut !== undefined ? { shortcut: command.shortcut } : {}),
      };
      items.push(row);
    }
  }

  return items;
}

function threadItem(thread: CommandMenuThread): CommandMenuItem {
  return {
    kind: "thread",
    id: `thread:${String(thread.id)}`,
    threadId: String(thread.id),
    title: thread.title,
    status: tabStatusFromSummary(thread),
    searchTerms: [thread.title, String(thread.id)],
  };
}

function filterAndRankThreads(
  threads: readonly CommandMenuThread[],
  needle: string,
): CommandMenuThread[] {
  if (needle.length === 0) {
    return [...threads];
  }

  return threads
    .map((thread, index) => ({
      thread,
      index,
      rank: bestFieldRank([thread.title, String(thread.id)], needle),
    }))
    .filter((entry) => entry.rank > Number.NEGATIVE_INFINITY)
    .sort((a, b) => b.rank - a.rank || a.index - b.index)
    .map((entry) => entry.thread);
}

function filterAndRankCommands(
  commands: readonly ShippingCommand[],
  needle: string,
): ShippingCommand[] {
  if (needle.length === 0) {
    return [...commands];
  }

  return commands
    .map((command, index) => ({
      command,
      index,
      rank: bestFieldRank(command.searchTerms, needle),
    }))
    .filter((entry) => entry.rank > Number.NEGATIVE_INFINITY)
    .sort((a, b) => b.rank - a.rank || a.index - b.index)
    .map((entry) => entry.command);
}

/** Exact > prefix > includes. Field order is the tie-break weight. */
function bestFieldRank(fields: readonly string[], needle: string): number {
  let best = Number.NEGATIVE_INFINITY;
  for (const [index, field] of fields.entries()) {
    const rank = rankField(field, needle);
    if (rank === Number.NEGATIVE_INFINITY) {
      continue;
    }
    const weighted = 1_000 - index * 100 + rank;
    if (weighted > best) {
      best = weighted;
    }
  }
  return best;
}

function rankField(field: string, needle: string): number {
  const haystack = field.trim().toLowerCase().replace(/\s+/g, " ");
  if (haystack.length === 0 || !haystack.includes(needle)) {
    return Number.NEGATIVE_INFINITY;
  }
  if (haystack === needle) {
    return 3;
  }
  if (haystack.startsWith(needle)) {
    return 2;
  }
  // Word-boundary boost (old palette idea, lean): match after a space.
  if (haystack.includes(` ${needle}`)) {
    return 1.5;
  }
  return 1;
}
