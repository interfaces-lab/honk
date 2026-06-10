import {
  type ContextWindowSnapshot,
  formatContextUsagePercentage,
  formatContextWindowTokens,
} from "~/lib/context-window";

export function ContextWindowUsageDetails(props: { usage: ContextWindowSnapshot }) {
  const { usage } = props;
  const usedPercentage = formatContextUsagePercentage(usage.usedPercentage);

  return (
    <div className="space-y-1.5 leading-tight">
      <div className="text-detail font-medium uppercase text-muted-foreground">Context window</div>
      {usage.maxTokens !== null && usedPercentage ? (
        <div className="whitespace-nowrap text-detail font-medium tabular-nums text-foreground">
          <span>{usedPercentage}</span>
          <span className="mx-1">·</span>
          <span>{formatContextWindowTokens(usage.usedTokens)}</span>
          <span>/</span>
          <span>{formatContextWindowTokens(usage.maxTokens ?? null)} context used</span>
        </div>
      ) : (
        <div className="text-detail text-foreground">
          {formatContextWindowTokens(usage.usedTokens)} tokens used so far
        </div>
      )}
      {(usage.totalProcessedTokens ?? null) !== null &&
      (usage.totalProcessedTokens ?? 0) > usage.usedTokens ? (
        <div className="text-detail text-muted-foreground">
          Total processed: {formatContextWindowTokens(usage.totalProcessedTokens ?? null)} tokens
        </div>
      ) : null}
      {usage.compactsAutomatically ? (
        <div className="text-detail text-muted-foreground">
          Automatically compacts its context when needed.
        </div>
      ) : null}
    </div>
  );
}
