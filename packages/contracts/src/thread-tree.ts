import { ThreadEntryId, type MessageId, type TurnId } from "./base-schemas";
import type { OrchestrationMessageRole, OrchestrationThreadEntry } from "./orchestration";

type ThreadTreeEntryPathEntry = Pick<OrchestrationThreadEntry, "id" | "parentEntryId" | "kind">;

export type ThreadEntryPathIssue =
  | {
      readonly ok: false;
      readonly reason: "missing-entry";
      readonly entryId: ThreadEntryId;
      readonly missingEntryId: ThreadEntryId;
    }
  | {
      readonly ok: false;
      readonly reason: "cycle";
      readonly entryId: ThreadEntryId;
      readonly cycleEntryId: ThreadEntryId;
    }
  | {
      readonly ok: false;
      readonly reason: "not-navigable";
      readonly entryId: ThreadEntryId;
      readonly invalidEntryId: ThreadEntryId;
    };

export type ThreadEntryPathResult<
  TEntry extends ThreadTreeEntryPathEntry = OrchestrationThreadEntry,
> =
  | {
      readonly ok: true;
      readonly entryId: ThreadEntryId;
      readonly entries: readonly TEntry[];
    }
  | ThreadEntryPathIssue;

export type ThreadBranchPathFacts = {
  readonly entryId: ThreadEntryId;
  readonly messageIds: ReadonlySet<MessageId>;
  readonly turnIds: ReadonlySet<TurnId>;
};

export function threadEntryIdForMessageId(messageId: MessageId): ThreadEntryId {
  return ThreadEntryId.make(`message:${messageId}`);
}

export function isNavigableThreadEntry(entry: Pick<OrchestrationThreadEntry, "kind">): boolean {
  return entry.kind !== "label";
}

export function createThreadEntryIndex<TEntry extends ThreadTreeEntryPathEntry>(
  entries: readonly TEntry[],
): Map<ThreadEntryId, TEntry> {
  return new Map(entries.map((entry) => [entry.id, entry] as const));
}

export function resolveThreadEntryPath<TEntry extends ThreadTreeEntryPathEntry>(input: {
  readonly entries: readonly TEntry[];
  readonly entryId: ThreadEntryId;
  readonly navigableOnly?: boolean;
}): ThreadEntryPathResult<TEntry> {
  const entryById = createThreadEntryIndex(input.entries);
  const path: TEntry[] = [];
  const seen = new Set<ThreadEntryId>();
  const navigableOnly = input.navigableOnly ?? true;
  let cursor: ThreadEntryId | null = input.entryId;

  while (cursor !== null) {
    if (seen.has(cursor)) {
      return {
        ok: false,
        reason: "cycle",
        entryId: input.entryId,
        cycleEntryId: cursor,
      };
    }
    seen.add(cursor);

    const entry = entryById.get(cursor);
    if (!entry) {
      return {
        ok: false,
        reason: "missing-entry",
        entryId: input.entryId,
        missingEntryId: cursor,
      };
    }

    if (navigableOnly && !isNavigableThreadEntry(entry)) {
      return {
        ok: false,
        reason: "not-navigable",
        entryId: input.entryId,
        invalidEntryId: entry.id,
      };
    }

    path.push(entry);
    cursor = entry.parentEntryId;
  }

  return {
    ok: true,
    entryId: input.entryId,
    entries: path.reverse(),
  };
}

export function formatThreadEntryPathIssue(issue: ThreadEntryPathIssue): string {
  switch (issue.reason) {
    case "missing-entry":
      return `Thread entry '${issue.entryId}' has a broken path; missing ancestor '${issue.missingEntryId}'.`;
    case "cycle":
      return `Thread entry '${issue.entryId}' has a cyclic path at '${issue.cycleEntryId}'.`;
    case "not-navigable":
      return `Thread entry '${issue.invalidEntryId}' is metadata and cannot anchor a branch.`;
  }
}

export function resolveActiveEntryIdAfterThreadMessage(input: {
  readonly activeEntryId: ThreadEntryId | null | undefined;
  readonly entryId: ThreadEntryId;
  readonly parentEntryId: ThreadEntryId | null;
  readonly role: OrchestrationMessageRole;
}): ThreadEntryId | null {
  const activeEntryId = input.activeEntryId ?? null;
  if (input.role === "user") {
    return input.entryId;
  }
  if (input.role !== "assistant") {
    return activeEntryId;
  }
  return activeEntryId === input.parentEntryId || activeEntryId === input.entryId
    ? input.entryId
    : activeEntryId;
}
