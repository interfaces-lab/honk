import { type ChatMessage } from "../../../types";
import ChatMarkdown from "../markdown/chat-markdown";
import { ChatMessageBubble } from "./message-surface";

interface AssistantMessageProps {
  message: ChatMessage;
  markdownCwd: string | undefined;
}

export function AssistantMessage({ message, markdownCwd }: AssistantMessageProps) {
  const messageText = message.text || (message.streaming ? "" : "(empty response)");

  const body = (
    <>
      <div className="select-text [&_*]:select-text">
        <ChatMarkdown
          text={messageText}
          cwd={markdownCwd}
          isStreaming={Boolean(message.streaming)}
        />
      </div>
    </>
  );

  return (
    <div className="min-w-0 pt-(--chat-timeline-assistant-top-inset)">
      <ChatMessageBubble messageRole="assistant" body={body} />
    </div>
  );
}
