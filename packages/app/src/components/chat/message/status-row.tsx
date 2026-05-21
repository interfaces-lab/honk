import { memo } from "react";

export const WorkingStatusRow = memo(function WorkingStatusRow() {
  return (
    <div className="flex w-full min-w-0 items-center gap-2 py-0.5">
      <div
        role="status"
        aria-label="Thinking"
        className="inline-flex max-w-full items-center px-0.5 py-1.5 text-muted-foreground/80"
      >
        <span
          className="text-body font-medium thinking-shimmer motion-reduce:animate-none"
          aria-hidden="true"
        >
          Thinking
        </span>
      </div>
    </div>
  );
});
