"use client";

import type { GitFileState } from "~/lib/ui-session-types";

import { cn } from "~/lib/utils";

const kindBadge: Partial<
  Record<GitFileState, { className: string; label: string; title: string }>
> = {
  untracked: {
    className: "text-(--multi-git-status-added)",
    label: "U",
    title: "Untracked",
  },
  added: {
    className: "text-(--multi-git-status-added)",
    label: "A",
    title: "Added",
  },
  deleted: {
    className: "text-(--multi-git-status-deleted)",
    label: "D",
    title: "Deleted",
  },
  modified: {
    className: "text-(--multi-git-status-modified)",
    label: "M",
    title: "Modified",
  },
  renamed: {
    className: "text-(--multi-git-status-renamed)",
    label: "R",
    title: "Renamed",
  },
  copied: {
    className: "text-(--multi-git-status-renamed)",
    label: "C",
    title: "Copied",
  },
  ignored: {
    className: "text-muted-foreground/78",
    label: "I",
    title: "Ignored",
  },
  conflict: {
    className: "text-(--multi-git-status-deleted)",
    label: "!",
    title: "Conflict",
  },
};

export function GitKindBadge(props: { state: GitFileState }) {
  const badge = kindBadge[props.state];
  if (!badge) return null;
  return (
    <span
      aria-label={badge.title}
      className={cn(
        "inline-flex min-w-3.5 shrink-0 justify-center text-detail font-medium tabular-nums",
        badge.className,
      )}
      title={badge.title}
    >
      {badge.label}
    </span>
  );
}
