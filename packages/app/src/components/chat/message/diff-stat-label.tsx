import { cn } from "~/lib/utils";

export function hasNonZeroStat(stat: { additions: number; deletions: number }): boolean {
  return stat.additions > 0 || stat.deletions > 0;
}

export function DiffStatLabel(props: {
  additions: number;
  className?: string;
  deletions: number;
  showParentheses?: boolean;
}) {
  return (
    <span className={cn("inline-flex shrink-0 items-baseline gap-1 tabular-nums", props.className)}>
      {props.showParentheses && <span className="text-honk-fg-quaternary">(</span>}
      <span className="text-honk-diff-addition">+{props.additions}</span>
      <span className="text-honk-fg-quaternary">/</span>
      <span className="text-honk-diff-deletion">-{props.deletions}</span>
      {props.showParentheses && <span className="text-honk-fg-quaternary">)</span>}
    </span>
  );
}
