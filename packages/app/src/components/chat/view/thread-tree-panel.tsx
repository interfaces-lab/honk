import { memo, useMemo } from "react";
import {
  IconArrowRight,
  IconBranch,
  IconChevronLeftMedium,
  IconChevronRightMedium,
  IconCircleCheck,
  IconCrossMediumDefault,
  IconTarget,
} from "central-icons";
import { Button } from "@multi/ui/button";
import type { Thread, ThreadTreeEntry } from "../../../types";
import type { ThreadEntryId } from "@multi/contracts";
import { cn } from "~/lib/utils";

interface ThreadTreePanelProps {
  thread: Thread;
  open: boolean;
  selectedEntryId: ThreadEntryId | null;
  shortcutLabel: string | null;
  onClose: () => void;
  onSelect: (entryId: ThreadEntryId) => void;
  onActivate: (entryId: ThreadEntryId) => void;
}

interface TreeNode {
  entry: ThreadTreeEntry;
  children: TreeNode[];
}

interface TreeIndex {
  entries: ThreadTreeEntry[];
  entryById: Map<ThreadEntryId, ThreadTreeEntry>;
  childrenByParentId: Map<ThreadEntryId | null, ThreadTreeEntry[]>;
}

function shortMessageText(thread: Thread, entry: ThreadTreeEntry): string {
  if (entry.kind === "branch-summary") {
    return entry.summary?.trim() || "Branch summary";
  }
  if (entry.messageId === null) {
    return entry.label?.trim() || "Entry";
  }
  const message = thread.messages.find((item) => item.id === entry.messageId);
  const text = message?.text.trim().replace(/\s+/g, " ") ?? "";
  if (text.length > 0) {
    return text.length > 96 ? `${text.slice(0, 93)}...` : text;
  }
  return message?.role === "assistant" ? "Assistant response" : "Message";
}

function entryRoleLabel(thread: Thread, entry: ThreadTreeEntry): string {
  if (entry.kind === "branch-summary") {
    return "Summary";
  }
  if (entry.messageId === null) {
    return "Entry";
  }
  const message = thread.messages.find((item) => item.id === entry.messageId);
  if (message?.role === "assistant") {
    return "Assistant";
  }
  if (message?.role === "user") {
    return "User";
  }
  return "System";
}

function sortEntries(entries: ThreadTreeEntry[]): ThreadTreeEntry[] {
  return [...entries].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );
}

function buildTreeIndex(entries: readonly ThreadTreeEntry[]): TreeIndex {
  const messageEntries = sortEntries(entries.filter((entry) => entry.kind !== "label"));
  const entryById = new Map<ThreadEntryId, ThreadTreeEntry>(
    messageEntries.map((entry) => [entry.id, entry]),
  );
  const childrenByParentId = new Map<ThreadEntryId | null, ThreadTreeEntry[]>();

  for (const entry of messageEntries) {
    const parentEntryId =
      entry.parentEntryId && entryById.has(entry.parentEntryId) ? entry.parentEntryId : null;
    const children = childrenByParentId.get(parentEntryId) ?? [];
    children.push(entry);
    childrenByParentId.set(parentEntryId, children);
  }

  for (const [parentEntryId, children] of childrenByParentId) {
    childrenByParentId.set(parentEntryId, sortEntries(children));
  }

  return { entries: messageEntries, entryById, childrenByParentId };
}

function buildTree(index: TreeIndex): TreeNode[] {
  const nodeById = new Map<ThreadEntryId, TreeNode>(
    index.entries.map((entry) => [entry.id, { entry, children: [] }]),
  );
  const roots: TreeNode[] = [];

  for (const entry of index.entries) {
    const node = nodeById.get(entry.id);
    if (!node) continue;
    const parent = entry.parentEntryId ? nodeById.get(entry.parentEntryId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort(
      (left, right) =>
        left.entry.createdAt.localeCompare(right.entry.createdAt) ||
        left.entry.id.localeCompare(right.entry.id),
    );
    for (const node of nodes) {
      sortNodes(node.children);
    }
  };
  sortNodes(roots);
  return roots;
}

function activePathSet(
  entryById: ReadonlyMap<ThreadEntryId, ThreadTreeEntry>,
  activeEntryId: ThreadEntryId | null | undefined,
): Set<ThreadEntryId> {
  const path = new Set<ThreadEntryId>();
  let cursor = activeEntryId ?? null;
  while (cursor !== null && !path.has(cursor)) {
    path.add(cursor);
    cursor = entryById.get(cursor)?.parentEntryId ?? null;
  }
  return path;
}

function activePathEntries(
  entryById: ReadonlyMap<ThreadEntryId, ThreadTreeEntry>,
  activeEntryId: ThreadEntryId | null | undefined,
): ThreadTreeEntry[] {
  const path: ThreadTreeEntry[] = [];
  const seen = new Set<ThreadEntryId>();
  let cursor = activeEntryId ?? null;
  while (cursor !== null && !seen.has(cursor)) {
    seen.add(cursor);
    const entry = entryById.get(cursor);
    if (!entry) break;
    path.push(entry);
    cursor = entry.parentEntryId;
  }
  return path.reverse();
}

function flattenTree(nodes: readonly TreeNode[], depth = 0): Array<{ node: TreeNode; depth: number }> {
  return nodes.flatMap((node) => [{ node, depth }, ...flattenTree(node.children, depth + 1)]);
}

function siblingIndex(entries: readonly ThreadTreeEntry[], entryId: ThreadEntryId): number {
  return entries.findIndex((entry) => entry.id === entryId);
}

export const ThreadTreePanel = memo(function ThreadTreePanel({
  thread,
  open,
  selectedEntryId,
  shortcutLabel,
  onClose,
  onSelect,
  onActivate,
}: ThreadTreePanelProps) {
  const entries = thread.entries ?? [];
  const index = useMemo(() => buildTreeIndex(entries), [entries]);
  const rows = useMemo(() => flattenTree(buildTree(index)), [index]);
  const pathEntryIds = useMemo(() => activePathSet(index.entryById, thread.activeEntryId), [
    index.entryById,
    thread.activeEntryId,
  ]);
  const pathEntries = useMemo(() => activePathEntries(index.entryById, thread.activeEntryId), [
    index.entryById,
    thread.activeEntryId,
  ]);
  const labelByTargetId = useMemo(() => {
    const labels = new Map<ThreadEntryId, string>();
    for (const entry of entries) {
      if (entry.kind !== "label" || entry.targetEntryId === null || !entry.label?.trim()) {
        continue;
      }
      labels.set(entry.targetEntryId, entry.label.trim());
    }
    return labels;
  }, [entries]);
  const selectedEntry =
    (selectedEntryId ? index.entryById.get(selectedEntryId) : undefined) ??
    (thread.activeEntryId ? index.entryById.get(thread.activeEntryId) : undefined) ??
    rows[0]?.node.entry ??
    null;
  const selectedChildren = selectedEntry
    ? (index.childrenByParentId.get(selectedEntry.id) ?? [])
    : [];
  const selectedSiblings = selectedEntry
    ? (index.childrenByParentId.get(selectedEntry.parentEntryId ?? null) ?? [])
    : [];
  const selectedSiblingIndex = selectedEntry
    ? siblingIndex(selectedSiblings, selectedEntry.id)
    : -1;
  const previousSibling =
    selectedSiblingIndex > 0 ? selectedSiblings[selectedSiblingIndex - 1] : undefined;
  const nextSibling =
    selectedSiblingIndex >= 0 && selectedSiblingIndex < selectedSiblings.length - 1
      ? selectedSiblings[selectedSiblingIndex + 1]
      : undefined;

  if (!open) {
    return null;
  }

  const selectedActive = selectedEntry?.id === thread.activeEntryId;

  return (
    <aside className="multi-shell-surface flex min-h-0 w-80 shrink-0 flex-col overflow-hidden border-l border-multi-workbench-panel-border-faint md:w-88">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-multi-workbench-panel-border-muted bg-(--multi-chat-surface-background) px-2">
        <IconBranch className="size-4 shrink-0 text-multi-icon-secondary" aria-hidden />
        <div className="min-w-0 flex-1 truncate text-sm font-medium text-multi-fg-primary">
          Branches
        </div>
        {shortcutLabel ? (
          <span className="shrink-0 rounded-xs border border-multi-workbench-panel-border-muted px-1.5 py-0.5 text-[11px]/none text-multi-fg-tertiary">
            {shortcutLabel}
          </span>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7 shrink-0 rounded-multi-control p-0"
          aria-label="Close branches"
          onClick={onClose}
        >
          <IconCrossMediumDefault className="size-3" aria-hidden />
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-xs text-multi-fg-tertiary">
          No branch entries yet
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 border-b border-multi-workbench-panel-border-muted bg-[color-mix(in_srgb,var(--multi-bg-secondary)_36%,transparent)] px-3 py-3">
            <div className="mb-2 flex items-center gap-2">
              <IconTarget className="size-3.5 shrink-0 text-multi-icon-secondary" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-multi-fg-secondary">
                Selected
              </span>
              {selectedActive ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-xs border border-multi-workbench-panel-border-muted bg-(--multi-chat-surface-background) px-1.5 py-0.5 text-[10px] font-medium text-multi-fg-secondary">
                  <IconCircleCheck className="size-3" aria-hidden />
                  Active
                </span>
              ) : null}
            </div>

            {selectedEntry ? (
              <div className="space-y-2">
                <div>
                  <div className="line-clamp-2 text-sm/5 font-medium text-multi-fg-primary">
                    {shortMessageText(thread, selectedEntry)}
                  </div>
                  <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-multi-fg-tertiary">
                    <span className="shrink-0">{entryRoleLabel(thread, selectedEntry)}</span>
                    {labelByTargetId.get(selectedEntry.id) ? (
                      <span className="min-w-0 truncate rounded-xs border border-multi-workbench-panel-border-muted bg-(--multi-chat-surface-background) px-1.5 py-0.5">
                        {labelByTargetId.get(selectedEntry.id)}
                      </span>
                    ) : null}
                    <span className="shrink-0">
                      {selectedChildren.length === 1
                        ? "1 child"
                        : `${selectedChildren.length} children`}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    className="inline-flex size-7 shrink-0 items-center justify-center rounded-multi-control border border-multi-workbench-panel-border-muted bg-(--multi-chat-surface-background) text-multi-icon-secondary transition-colors hover:bg-multi-bg-tertiary disabled:pointer-events-none disabled:opacity-40"
                    aria-label="Select previous branch"
                    disabled={!previousSibling}
                    onClick={() => {
                      if (previousSibling) {
                        onSelect(previousSibling.id);
                      }
                    }}
                  >
                    <IconChevronLeftMedium className="size-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="inline-flex size-7 shrink-0 items-center justify-center rounded-multi-control border border-multi-workbench-panel-border-muted bg-(--multi-chat-surface-background) text-multi-icon-secondary transition-colors hover:bg-multi-bg-tertiary disabled:pointer-events-none disabled:opacity-40"
                    aria-label="Select next branch"
                    disabled={!nextSibling}
                    onClick={() => {
                      if (nextSibling) {
                        onSelect(nextSibling.id);
                      }
                    }}
                  >
                    <IconChevronRightMedium className="size-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "inline-flex min-h-7 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-multi-control border px-2 text-xs font-medium transition-colors",
                      selectedActive
                        ? "border-multi-workbench-panel-border-muted bg-(--multi-chat-surface-background) text-multi-fg-tertiary"
                        : "border-multi-workbench-panel-border-soft bg-multi-bg-quaternary text-multi-fg-primary hover:bg-multi-bg-tertiary",
                    )}
                    disabled={selectedActive}
                    onClick={() => {
                      onActivate(selectedEntry.id);
                    }}
                  >
                    {selectedActive ? (
                      <IconCircleCheck className="size-3.5 shrink-0" aria-hidden />
                    ) : (
                      <IconArrowRight className="size-3.5 shrink-0" aria-hidden />
                    )}
                    <span className="truncate">
                      {selectedActive ? "Current branch" : "Continue from here"}
                    </span>
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            <section className="border-b border-multi-workbench-panel-border-muted px-2 py-2">
              <div className="px-1.5 pb-1.5 text-[11px] font-medium text-multi-fg-tertiary">
                Active path
              </div>
              <div className="space-y-0.5">
                {pathEntries.map((entry, indexInPath) => (
                  <button
                    key={entry.id}
                    type="button"
                    className={cn(
                      "flex min-h-7 w-full items-center gap-1.5 rounded-multi-control px-1.5 py-1 text-left text-xs transition-colors hover:bg-multi-bg-tertiary",
                      selectedEntry?.id === entry.id
                        ? "bg-multi-bg-quaternary text-multi-fg-primary"
                        : "text-multi-fg-secondary",
                    )}
                    onClick={() => onSelect(entry.id)}
                  >
                    <span className="w-4 shrink-0 text-center text-[10px] tabular-nums text-multi-fg-tertiary">
                      {indexInPath + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{shortMessageText(thread, entry)}</span>
                    {entry.id === thread.activeEntryId ? (
                      <IconCircleCheck className="size-3 shrink-0 text-multi-icon-accent-primary" aria-hidden />
                    ) : null}
                  </button>
                ))}
              </div>
            </section>

            {selectedSiblings.length > 1 ? (
              <section className="border-b border-multi-workbench-panel-border-muted px-2 py-2">
                <div className="px-1.5 pb-1.5 text-[11px] font-medium text-multi-fg-tertiary">
                  Sibling branches
                </div>
                <div className="space-y-0.5">
                  {selectedSiblings.map((entry, indexInSiblings) => (
                    <button
                      key={entry.id}
                      type="button"
                      className={cn(
                        "flex min-h-8 w-full items-center gap-1.5 rounded-multi-control px-1.5 py-1 text-left text-xs transition-colors hover:bg-multi-bg-tertiary",
                        selectedEntry?.id === entry.id
                          ? "bg-multi-bg-quaternary text-multi-fg-primary"
                          : "text-multi-fg-secondary",
                      )}
                      onClick={() => onSelect(entry.id)}
                    >
                      <span className="w-5 shrink-0 rounded-xs bg-multi-bg-tertiary px-1 py-0.5 text-center text-[10px] tabular-nums text-multi-fg-tertiary">
                        {indexInSiblings + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {shortMessageText(thread, entry)}
                      </span>
                      {pathEntryIds.has(entry.id) ? (
                        <span className="size-1.5 shrink-0 rounded-full bg-multi-icon-accent-primary" aria-hidden />
                      ) : null}
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            {selectedChildren.length > 0 ? (
              <section className="border-b border-multi-workbench-panel-border-muted px-2 py-2">
                <div className="px-1.5 pb-1.5 text-[11px] font-medium text-multi-fg-tertiary">
                  Child branches
                </div>
                <div className="space-y-0.5">
                  {selectedChildren.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      className={cn(
                        "flex min-h-8 w-full items-center gap-1.5 rounded-multi-control px-1.5 py-1 text-left text-xs transition-colors hover:bg-multi-bg-tertiary",
                        selectedEntry?.id === entry.id
                          ? "bg-multi-bg-quaternary text-multi-fg-primary"
                          : "text-multi-fg-secondary",
                      )}
                      onClick={() => onSelect(entry.id)}
                    >
                      <IconChevronRightMedium
                        className="size-3 shrink-0 text-multi-icon-tertiary"
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {shortMessageText(thread, entry)}
                      </span>
                      {pathEntryIds.has(entry.id) ? (
                        <span className="size-1.5 shrink-0 rounded-full bg-multi-icon-accent-primary" aria-hidden />
                      ) : null}
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="px-2 py-2">
              <div className="px-1.5 pb-1.5 text-[11px] font-medium text-multi-fg-tertiary">
                Whole tree
              </div>
              <div className="space-y-0.5">
                {rows.map(({ node, depth }) => {
                  const entry = node.entry;
                  const active = thread.activeEntryId === entry.id;
                  const selected = selectedEntry?.id === entry.id;
                  const onPath = pathEntryIds.has(entry.id);
                  const label = labelByTargetId.get(entry.id);
                  const branchCount = node.children.length;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      className={cn(
                        "group/tree-row flex min-h-8 w-full items-center gap-1 rounded-multi-control px-1.5 py-1 text-left text-xs transition-colors",
                        selected
                          ? "bg-multi-bg-quaternary text-multi-fg-primary"
                          : "text-multi-fg-secondary hover:bg-multi-bg-tertiary",
                      )}
                      style={{ paddingLeft: `${Math.min(depth, 8) * 14 + 6}px` }}
                      aria-current={active ? "true" : undefined}
                      aria-selected={selected}
                      onClick={() => onSelect(entry.id)}
                    >
                      <span
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          active
                            ? "bg-multi-icon-accent-primary"
                            : onPath
                              ? "bg-multi-icon-secondary"
                              : "bg-multi-stroke-secondary",
                        )}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {shortMessageText(thread, entry)}
                      </span>
                      {label ? (
                        <span className="max-w-20 shrink-0 truncate rounded-xs bg-multi-bg-tertiary px-1.5 py-0.5 text-[10px] text-multi-fg-tertiary">
                          {label}
                        </span>
                      ) : null}
                      {branchCount > 1 ? (
                        <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] text-multi-fg-tertiary">
                          <IconBranch className="size-3" aria-hidden />
                          {branchCount}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        </div>
      )}
    </aside>
  );
});
