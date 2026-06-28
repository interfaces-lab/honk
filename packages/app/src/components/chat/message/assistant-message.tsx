import { ConversationBubble } from "@honk/honkkit/conversation-bubble";
import { type ChatMessage } from "../../../types";
import ChatMarkdown from "../markdown/chat-markdown";

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
    // Full width inside the flex transcript row: a flex child sizes to max-content,
    // which shrinks short messages and their code blocks with them.
    <div className="w-full min-w-0">
      <ConversationBubble role="assistant">{body}</ConversationBubble>
    </div>
  );
}
