import { memo } from "react";
import { ThinkingIndicator } from "./thinking-indicator";

interface WorkingStatusRowProps {
  createdAt: string | null;
}

export const WorkingStatusRow = memo(function WorkingStatusRow({
  createdAt,
}: WorkingStatusRowProps) {
  return (
    <div className="flex w-full min-w-0 items-center gap-2 py-0.5">
      <ThinkingIndicator createdAt={createdAt} className="max-w-full" />
    </div>
  );
});
