import { memo } from "react";
import { ChatLoader } from "./chat-loader";

export const WorkingStatusRow = memo(function WorkingStatusRow() {
  return (
    <div className="flex w-full min-w-0 items-center gap-2 py-0.5">
      <ChatLoader className="max-w-full" label="Thinking" />
    </div>
  );
});
