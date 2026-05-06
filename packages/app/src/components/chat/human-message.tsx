import { type MessageId } from "@multi/contracts";
import { memo, type ReactNode } from "react";
import { buildExpandedImagePreview, type ExpandedImagePreview } from "./expanded-image-preview";
import { TerminalContextInlineChip } from "./terminal-context-inline-chip";
import {
  deriveDisplayedUserMessageState,
  type ParsedTerminalContextEntry,
} from "~/lib/terminal-context";
import {
  buildInlineTerminalContextText,
  formatInlineTerminalContextLabel,
  textContainsInlineTerminalContextLabels,
} from "./user-message-terminal-contexts";
import { type ChatMessage } from "../../types";
import { ChatMessageBubble, EditableChatMessageBubble } from "./message-surface";
import { HumanMessageCollapsible } from "./human-message-collapse";

interface HumanMessageProps {
  message: ChatMessage;
  revertTurnCount: number | undefined;
  isEditing: boolean;
  editDisabled: boolean;
  isServerThread: boolean;
  editComposer: ReactNode;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  onBeginEditUserMessage: ((messageId: MessageId) => void) | undefined;
}

export const HumanMessage = memo(function HumanMessage({
  message,
  isEditing,
  editDisabled,
  isServerThread,
  editComposer,
  onImageExpand,
  onBeginEditUserMessage,
}: HumanMessageProps) {
  const userImages = message.attachments ?? [];
  const displayedUserMessage = deriveDisplayedUserMessageState(message.text);
  const terminalContexts = displayedUserMessage.contexts;

  const media =
    userImages.length > 0 ? (
      <div className="mb-2 grid max-w-[420px] grid-cols-2 gap-2">
        {userImages.map((image) => (
          <div
            key={image.id}
            className="overflow-hidden rounded-multi-control border border-multi-stroke-secondary bg-multi-editor"
          >
            {image.previewUrl ? (
              <button
                type="button"
                className="block size-full cursor-zoom-in border-0 bg-transparent p-0"
                aria-label={`Preview ${image.name}`}
                onClick={() => {
                  const preview = buildExpandedImagePreview(userImages, image.id);
                  if (!preview) return;
                  onImageExpand(preview);
                }}
              >
                <img
                  src={image.previewUrl}
                  alt={image.name}
                  className="block h-8 w-full object-cover"
                />
              </button>
            ) : (
              <div className="flex min-h-8 items-center justify-center px-2 py-1 text-center text-[11px]/[14px] text-multi-fg-tertiary">
                {image.name}
              </div>
            )}
          </div>
        ))}
      </div>
    ) : null;

  const bodyInner =
    displayedUserMessage.visibleText.trim().length > 0 || terminalContexts.length > 0 ? (
      <UserMessageBody
        text={displayedUserMessage.visibleText}
        terminalContexts={terminalContexts}
      />
    ) : null;

  const body = bodyInner ? <HumanMessageCollapsible>{bodyInner}</HumanMessageCollapsible> : null;

  if (isEditing && editComposer) {
    return editComposer;
  }

  const canEdit = isServerThread && !editDisabled && typeof onBeginEditUserMessage === "function";

  if (canEdit) {
    return (
      <EditableChatMessageBubble
        body={body}
        media={media}
        onActivate={() => onBeginEditUserMessage(message.id)}
      />
    );
  }

  return (
    <ChatMessageBubble
      role="user"
      body={body}
      media={media}
    />
  );
});

const UserMessageTerminalContextInlineLabel = memo(
  function UserMessageTerminalContextInlineLabel(props: { context: ParsedTerminalContextEntry }) {
    const tooltipText =
      props.context.body.length > 0
        ? `${props.context.header}\n${props.context.body}`
        : props.context.header;

    return <TerminalContextInlineChip label={props.context.header} tooltipText={tooltipText} />;
  },
);

const UserMessageBody = memo(function UserMessageBody(props: {
  text: string;
  terminalContexts: ParsedTerminalContextEntry[];
}) {
  if (props.terminalContexts.length > 0) {
    const hasEmbeddedInlineLabels = textContainsInlineTerminalContextLabels(
      props.text,
      props.terminalContexts,
    );
    const inlinePrefix = buildInlineTerminalContextText(props.terminalContexts);
    const inlineNodes: ReactNode[] = [];

    if (hasEmbeddedInlineLabels) {
      let cursor = 0;

      for (const context of props.terminalContexts) {
        const label = formatInlineTerminalContextLabel(context.header);
        const matchIndex = props.text.indexOf(label, cursor);
        if (matchIndex === -1) {
          inlineNodes.length = 0;
          break;
        }
        if (matchIndex > cursor) {
          inlineNodes.push(
            <span key={`user-terminal-context-inline-before:${context.header}:${cursor}`}>
              {props.text.slice(cursor, matchIndex)}
            </span>,
          );
        }
        inlineNodes.push(
          <UserMessageTerminalContextInlineLabel
            key={`user-terminal-context-inline:${context.header}`}
            context={context}
          />,
        );
        cursor = matchIndex + label.length;
      }

      if (inlineNodes.length > 0) {
        if (cursor < props.text.length) {
          inlineNodes.push(
            <span key={`user-message-terminal-context-inline-rest:${cursor}`}>
              {props.text.slice(cursor)}
            </span>,
          );
        }

        return <div className="max-w-full min-w-0 break-words wrap-anywhere">{inlineNodes}</div>;
      }
    }

    for (const context of props.terminalContexts) {
      inlineNodes.push(
        <UserMessageTerminalContextInlineLabel
          key={`user-terminal-context-inline:${context.header}`}
          context={context}
        />,
      );
      inlineNodes.push(
        <span key={`user-terminal-context-inline-space:${context.header}`} aria-hidden="true">
          {" "}
        </span>,
      );
    }

    if (props.text.length > 0) {
      inlineNodes.push(<span key="user-message-terminal-context-inline-text">{props.text}</span>);
    } else if (inlinePrefix.length === 0) {
      return null;
    }

    return <div className="max-w-full min-w-0 break-words wrap-anywhere">{inlineNodes}</div>;
  }

  if (props.text.length === 0) {
    return null;
  }

  return <div className="max-w-full min-w-0 break-words wrap-anywhere">{props.text}</div>;
});
