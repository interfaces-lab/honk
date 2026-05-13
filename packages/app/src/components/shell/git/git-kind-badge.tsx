"use client";

import type { GitFileState } from "~/lib/ui-session-types";

import { Badge } from "@multi/ui/badge";

const kindVariant: Partial<
  Record<GitFileState, "warning" | "success" | "destructive" | "secondary" | "outline">
> = {
  untracked: "warning",
  added: "success",
  deleted: "destructive",
  renamed: "secondary",
  copied: "secondary",
  ignored: "outline",
  conflict: "destructive",
};

const kindLabel: Partial<Record<GitFileState, string>> = {
  untracked: "untracked",
  added: "new",
  deleted: "deleted",
  renamed: "renamed",
  copied: "copied",
  ignored: "ignored",
  conflict: "conflict",
};

export function GitKindBadge(props: { state: GitFileState }) {
  const variant = kindVariant[props.state];
  if (!variant) return null;
  return (
    <Badge variant={variant} className="px-1 py-0 text-detail font-medium">
      {kindLabel[props.state] ?? props.state}
    </Badge>
  );
}
