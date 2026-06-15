import { ThreadEntryId, type MessageId, type TurnId } from "./base-schemas";
import type {
  OrchestrationMessage,
  OrchestrationMessageRole,
  OrchestrationThreadEntry,
} from "./orchestration";

export type ThreadTreeEntry = Pick<
  OrchestrationThreadEntry,
  "id" | "parentEntryId" | "kind" | "messageId" | "turnId"
>;

type ThreadTreeEntryPathEntry = Pick<OrchestrationThreadEntry, "id" | "parentEntryId" | "kind">;
type ThreadTreeOrderableEntry = ThreadTreeEntryPathEntry &
  Partial<Pick<OrchestrationThreadEntry, "createdAt">>;
type ThreadBranchPathMessage = Pick<OrchestrationMessage, "id"> &
  Partial<Pick<OrchestrationMessage, "turnId">>;

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

export type ThreadBranchPathIssue =
  | ThreadEntryPathIssue
  | {
      readonly ok: false;
      readonly reason: "missing-message";
      readonly entryId: ThreadEntryId;
      readonly missingMessageId: MessageId;
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

export type ThreadBranchPathFacts<TEntry extends ThreadTreeEntry = OrchestrationThreadEntry> = {
  readonly entryId: ThreadEntryId;
  readonly entries: readonly TEntry[];
  readonly entryIds: ReadonlySet<ThreadEntryId>;
  readonly messageIds: ReadonlySet<MessageId>;
  readonly turnIds: ReadonlySet<TurnId>;
};

export type ThreadBranchPathResult<TEntry extends ThreadTreeEntry = OrchestrationThreadEntry> =
  | ({
      readonly ok: true;
    } & ThreadBranchPathFacts<TEntry>)
  | ThreadBranchPathIssue;

export type ThreadTreeViewNode<TEntry extends ThreadTreeEntryPathEntry = OrchestrationThreadEntry> =
  {
    readonly entry: TEntry;
    readonly depth: number;
    readonly isActivePath: boolean;
    readonly isActiveLeaf: boolean;
    readonly hasChildren: boolean;
    readonly childCount: number;
    readonly siblingIndex: number;
    readonly siblingCount: number;
    readonly hasNextSibling: boolean;
    readonly ancestorHasNextSibling: readonly boolean[];
  };

export type FlattenThreadEntryTreeResult<
  TEntry extends ThreadTreeEntryPathEntry = OrchestrationThreadEntry,
> = {
  readonly nodes: readonly ThreadTreeViewNode<TEntry>[];
  readonly issues: readonly ThreadEntryPathIssue[];
  readonly activePathEntryIds: ReadonlySet<ThreadEntryId>;
};

export type RepairedThreadEntryTree<TEntry extends ThreadTreeOrderableEntry> = {
  readonly entries: readonly TEntry[];
  readonly leafId: ThreadEntryId | null;
  readonly repaired: boolean;
};

export function threadEntryIdForMessageId(messageId: MessageId): ThreadEntryId {
  return ThreadEntryId.make(`message:${messageId}`);
}

export function isOrchestrationPersistedMessageId(messageId: MessageId): boolean {
  const value = String(messageId);
  return !value.includes(":") || value.startsWith("runtime:");
}

/** Live runtime session tree ids (`runtime:<sessionId>:<entryId>`) before orchestration commits them. */
export function isRuntimeSessionTreeProjectionMessageId(messageId: MessageId): boolean {
  const value = String(messageId);
  if (!value.startsWith("runtime:")) {
    return false;
  }
  return value.split(":").length === 3;
}

export function isNavigableThreadEntry(entry: Pick<OrchestrationThreadEntry, "kind">): boolean {
  return entry.kind === "message";
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
    entries: path.toReversed(),
  };
}

export function getThreadBranch<TEntry extends ThreadTreeEntryPathEntry>(input: {
  readonly entries: readonly TEntry[];
  readonly leafId: ThreadEntryId | null;
}): ThreadEntryPathResult<TEntry> | null {
  if (input.leafId === null) {
    return null;
  }
  return resolveThreadEntryPath({ entries: input.entries, entryId: input.leafId });
}

function isValidThreadLeaf<TEntry extends ThreadTreeEntryPathEntry>(input: {
  readonly entries: readonly TEntry[];
  readonly entryId: ThreadEntryId;
  readonly navigableOnly: boolean;
}): boolean {
  return resolveThreadEntryPath({
    entries: input.entries,
    entryId: input.entryId,
    navigableOnly: input.navigableOnly,
  }).ok;
}

function fallbackThreadLeafId<TEntry extends ThreadTreeOrderableEntry>(input: {
  readonly entries: readonly TEntry[];
  readonly navigableOnly: boolean;
}): ThreadEntryId | null {
  const candidates = input.entries.filter(
    (entry) =>
      (!input.navigableOnly || isNavigableThreadEntry(entry)) &&
      isValidThreadLeaf({
        entries: input.entries,
        entryId: entry.id,
        navigableOnly: input.navigableOnly,
      }),
  );
  return candidates.toSorted(compareThreadTreeEntries).at(-1)?.id ?? null;
}

export function repairThreadEntryTree<TEntry extends ThreadTreeOrderableEntry>(input: {
  readonly entries: readonly TEntry[];
  readonly leafId: ThreadEntryId | null;
  readonly navigableOnly?: boolean;
  readonly repairMissingParents?: boolean;
}): RepairedThreadEntryTree<TEntry> {
  const entryIds = new Set(input.entries.map((entry) => entry.id));
  const repairMissingParents = input.repairMissingParents ?? true;
  let repaired = false;
  const entries = input.entries.map((entry) => {
    const parentEntryId = entry.parentEntryId;
    if (
      parentEntryId === null ||
      (parentEntryId !== entry.id && (!repairMissingParents || entryIds.has(parentEntryId)))
    ) {
      return entry;
    }
    repaired = true;
    return {
      ...entry,
      parentEntryId: null,
    };
  });
  const navigableOnly = input.navigableOnly ?? true;
  const leafId =
    input.leafId !== null &&
    isValidThreadLeaf({
      entries,
      entryId: input.leafId,
      navigableOnly,
    })
      ? input.leafId
      : fallbackThreadLeafId({ entries, navigableOnly });

  if (leafId !== input.leafId) {
    repaired = true;
  }

  return {
    entries: repaired ? entries : input.entries,
    leafId,
    repaired,
  };
}

export function resolveThreadBranchPathFacts<TEntry extends ThreadTreeEntry>(input: {
  readonly entries: readonly TEntry[];
  readonly entryId: ThreadEntryId;
  readonly messages?: readonly ThreadBranchPathMessage[];
  readonly navigableOnly?: boolean;
}): ThreadBranchPathResult<TEntry> {
  const path = resolveThreadEntryPath({
    entries: input.entries,
    entryId: input.entryId,
    ...(input.navigableOnly === undefined ? {} : { navigableOnly: input.navigableOnly }),
  });
  if (!path.ok) {
    return path;
  }

  const messageById =
    input.messages === undefined
      ? null
      : new Map(input.messages.map((message) => [message.id, message] as const));
  const entryIds = new Set<ThreadEntryId>();
  const messageIds = new Set<MessageId>();
  const turnIds = new Set<TurnId>();

  for (const entry of path.entries) {
    entryIds.add(entry.id);
    if (entry.turnId !== null) {
      turnIds.add(entry.turnId);
    }
    if (entry.kind !== "message" || entry.messageId === null) {
      continue;
    }

    messageIds.add(entry.messageId);
    if (messageById === null) {
      continue;
    }

    const message = messageById.get(entry.messageId);
    if (!message) {
      return {
        ok: false,
        reason: "missing-message",
        entryId: entry.id,
        missingMessageId: entry.messageId,
      };
    }
    if (message.turnId !== undefined && message.turnId !== null) {
      turnIds.add(message.turnId);
    }
  }

  return {
    ok: true,
    entryId: input.entryId,
    entries: path.entries,
    entryIds,
    messageIds,
    turnIds,
  };
}

function compareThreadTreeEntries(left: ThreadTreeOrderableEntry, right: ThreadTreeOrderableEntry) {
  const createdAtComparison = (left.createdAt ?? "").localeCompare(right.createdAt ?? "");
  if (createdAtComparison !== 0) {
    return createdAtComparison;
  }
  return left.id.localeCompare(right.id);
}

export function flattenThreadEntryTree<TEntry extends ThreadTreeOrderableEntry>(input: {
  readonly entries: readonly TEntry[];
  readonly leafId: ThreadEntryId | null;
  readonly navigableOnly?: boolean;
}): FlattenThreadEntryTreeResult<TEntry> {
  const navigableOnly = input.navigableOnly ?? true;
  const candidateEntries = navigableOnly
    ? input.entries.filter((entry) => isNavigableThreadEntry(entry))
    : [...input.entries];
  const issues: ThreadEntryPathIssue[] = [];
  const validEntries: TEntry[] = [];

  for (const entry of candidateEntries) {
    const path = resolveThreadEntryPath({
      entries: candidateEntries,
      entryId: entry.id,
      navigableOnly,
    });
    if (path.ok) {
      validEntries.push(entry);
    } else {
      issues.push(path);
    }
  }

  const activePath = input.leafId
    ? resolveThreadEntryPath({
        entries: validEntries,
        entryId: input.leafId,
        navigableOnly,
      })
    : null;
  if (activePath && !activePath.ok) {
    issues.push(activePath);
  }

  const activePathEntryIds =
    activePath?.ok === true
      ? new Set<ThreadEntryId>(activePath.entries.map((entry) => entry.id))
      : new Set<ThreadEntryId>();
  const activeLeafId = activePath?.ok === true ? input.leafId : null;
  const validEntryIds = new Set(validEntries.map((entry) => entry.id));
  const childrenByParentId = new Map<ThreadEntryId | null, TEntry[]>();

  for (const entry of validEntries) {
    const parentEntryId =
      entry.parentEntryId !== null && validEntryIds.has(entry.parentEntryId)
        ? entry.parentEntryId
        : null;
    const siblings = childrenByParentId.get(parentEntryId) ?? [];
    siblings.push(entry);
    childrenByParentId.set(parentEntryId, siblings);
  }

  const sortSiblings = (entries: TEntry[]) =>
    entries.toSorted((left, right) => {
      const leftActive = activePathEntryIds.has(left.id);
      const rightActive = activePathEntryIds.has(right.id);
      if (leftActive !== rightActive) {
        return leftActive ? -1 : 1;
      }
      return compareThreadTreeEntries(left, right);
    });

  for (const [parentEntryId, entries] of childrenByParentId) {
    childrenByParentId.set(parentEntryId, sortSiblings(entries));
  }

  const nodes: ThreadTreeViewNode<TEntry>[] = [];
  const visit = (
    entry: TEntry,
    depth: number,
    siblingIndex: number,
    siblingCount: number,
    ancestorHasNextSibling: readonly boolean[],
  ) => {
    const children = childrenByParentId.get(entry.id) ?? [];
    const hasNextSibling = siblingIndex < siblingCount - 1;
    nodes.push({
      entry,
      depth,
      isActivePath: activePathEntryIds.has(entry.id),
      isActiveLeaf: activeLeafId === entry.id,
      hasChildren: children.length > 0,
      childCount: children.length,
      siblingIndex,
      siblingCount,
      hasNextSibling,
      ancestorHasNextSibling,
    });
    children.forEach((child, childIndex) =>
      visit(child, depth + 1, childIndex, children.length, [
        ...ancestorHasNextSibling,
        hasNextSibling,
      ]),
    );
  };

  const roots = childrenByParentId.get(null) ?? [];
  roots.forEach((root, index) => visit(root, 0, index, roots.length, []));

  return {
    nodes,
    issues,
    activePathEntryIds,
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

export function formatThreadBranchPathIssue(issue: ThreadBranchPathIssue): string {
  if (issue.reason === "missing-message") {
    return `Thread entry '${issue.entryId}' points to missing message '${issue.missingMessageId}'.`;
  }
  return formatThreadEntryPathIssue(issue);
}

export function resolveLeafIdAfterThreadMessage(input: {
  readonly leafId: ThreadEntryId | null;
  readonly entryId: ThreadEntryId;
  readonly parentEntryId: ThreadEntryId | null;
  readonly role: OrchestrationMessageRole;
}): ThreadEntryId | null {
  if (input.role === "user") {
    return input.entryId;
  }
  if (input.role !== "assistant") {
    return input.leafId;
  }
  return input.leafId === input.parentEntryId || input.leafId === input.entryId
    ? input.entryId
    : input.leafId;
}

export function resolveLeafIdAfterThreadNavigate(input: {
  readonly entryId: ThreadEntryId;
}): ThreadEntryId {
  return input.entryId;
}
