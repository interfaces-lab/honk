import { IconBranch, IconCircleCheck } from "central-icons";
import { flattenThreadEntryTree, formatThreadEntryPathIssue } from "@multi/contracts";

import type { Thread, ThreadTreeEntry } from "../../../types";
import { cn } from "~/lib/utils";

interface ThreadTreePanelProps {
  thread: Thread;
  variant?: "aside" | "panel";
}

function shortMessageText(thread: Thread, entry: ThreadTreeEntry): string {
  if (entry.messageId === null) {
    return "Entry";
  }
  const message = thread.messages.find((item) => item.id === entry.messageId);
  const text = message?.text.trim().replace(/\s+/g, " ") ?? "";
  if (text.length > 0) {
    return text.length > 96 ? `${text.slice(0, 93)}...` : text;
  }
  return message?.role === "assistant" ? "Assistant response" : "Message";
}

function entryRoleLabel(thread: Thread, entry: ThreadTreeEntry): string {
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

export function ThreadTreePanel({
  thread,
  variant = "aside",
}: ThreadTreePanelProps) {
  const tree = flattenThreadEntryTree({
    entries: thread.entries,
    leafId: thread.leafId,
  });
  const activePath = tree.nodes.filter((node) => node.isActivePath);
  const rootClassName =
    variant === "panel"
      ? "multi-shell-surface flex size-full min-h-0 flex-col overflow-hidden bg-(--multi-workbench-panel-background)"
      : "multi-shell-surface flex min-h-0 w-80 shrink-0 flex-col overflow-hidden border-l border-multi-workbench-panel-border-faint bg-(--multi-workbench-panel-background) md:w-88";

  return (
    <aside className={rootClassName}>
      <div className="multi-workbench-panel-title-row">
        <IconBranch className="size-4 shrink-0 text-multi-icon-secondary" aria-hidden />
        <div className="min-w-0 flex-1 truncate text-sm font-medium text-multi-fg-primary">
          Thread Tree
        </div>
      </div>

      {tree.nodes.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-xs text-multi-fg-tertiary">
          No canonical tree entries.
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <section className="border-b border-multi-workbench-panel-border-muted px-2 py-2">
            <div className="px-1.5 pb-1.5 text-[11px] font-medium text-multi-fg-tertiary">
              Active Branch
            </div>
            <div className="space-y-0.5">
              {activePath.map((node, indexInPath) => (
                <div
                  key={node.entry.id}
                  className="flex min-h-7 items-center gap-1.5 rounded-multi-control px-1.5 py-1 text-xs text-multi-fg-secondary"
                >
                  <span className="w-4 shrink-0 text-center text-[10px] tabular-nums text-multi-fg-tertiary">
                    {indexInPath + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {shortMessageText(thread, node.entry)}
                  </span>
                  {node.isActiveLeaf ? (
                    <IconCircleCheck
                      className="size-3 shrink-0 text-multi-icon-accent-primary"
                      aria-hidden
                    />
                  ) : null}
                </div>
              ))}
            </div>
          </section>

          <section className="px-2 py-2">
            <div className="px-1.5 pb-1.5 text-[11px] font-medium text-multi-fg-tertiary">
              Canonical Flattened Tree
            </div>
            <div className="space-y-0.5">
              {tree.nodes.map((node) => (
                <div
                  key={node.entry.id}
                  className={cn(
                    "flex min-h-8 items-center gap-1 rounded-multi-control px-1.5 py-1 text-xs",
                    node.isActiveLeaf
                      ? "bg-multi-bg-quaternary text-multi-fg-primary"
                      : node.isActivePath
                        ? "text-multi-fg-primary"
                        : "text-multi-fg-secondary",
                  )}
                  style={{ paddingLeft: `${Math.min(node.depth, 8) * 14 + 6}px` }}
                  aria-current={node.isActiveLeaf ? "true" : undefined}
                >
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      node.isActiveLeaf
                        ? "bg-multi-icon-accent-primary"
                        : node.isActivePath
                          ? "bg-multi-icon-secondary"
                          : "bg-multi-stroke-secondary",
                    )}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {shortMessageText(thread, node.entry)}
                  </span>
                  <span className="shrink-0 text-[10px] text-multi-fg-tertiary">
                    {entryRoleLabel(thread, node.entry)}
                  </span>
                  {node.childCount > 0 ? (
                    <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] text-multi-fg-tertiary">
                      <IconBranch className="size-3" aria-hidden />
                      {node.childCount}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </section>

          {tree.issues.length > 0 ? (
            <section className="border-t border-multi-workbench-panel-border-muted px-2 py-2">
              <div className="px-1.5 pb-1.5 text-[11px] font-medium text-multi-fg-tertiary">
                Structural Issues
              </div>
              <div className="space-y-1">
                {tree.issues.map((issue) => (
                  <div
                    key={`${issue.reason}:${issue.entryId}`}
                    className="rounded-multi-control bg-multi-bg-tertiary px-2 py-1.5 text-xs text-multi-fg-tertiary"
                  >
                    {formatThreadEntryPathIssue(issue)}
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </aside>
  );
}
