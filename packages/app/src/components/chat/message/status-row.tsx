import { memo } from "react";
import { ThinkingIndicator } from "./thinking-indicator";

export const WorkingStatusRow = memo(function WorkingStatusRow() {
  return (
    <div className="flex w-full min-w-0 items-center gap-2 py-0.5">
      <ThinkingIndicator className="max-w-full" words={["Thinking"]} />
    </div>
  );
});
