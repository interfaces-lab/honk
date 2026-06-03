import { ChatLoader } from "./chat-loader";

export function WorkingStatusRow() {
  return (
    <div className="flex w-full min-w-0 items-center gap-2 py-0.5">
      <ChatLoader className="py-0" label="Thinking" />
    </div>
  );
}
