import { type MessageId } from "@honk/contracts";
import {
  Attachment,
  AttachmentFallback,
  AttachmentGroup,
  AttachmentImage,
  AttachmentPreviewTrigger,
} from "@honk/honkkit/attachment";
import { ConversationBubble } from "@honk/honkkit/conversation-bubble";
import { ConversationCollapse } from "@honk/honkkit/conversation-collapse";
import { StatusNotice } from "@honk/honkkit/marker";
import {
  IconBranch,
  IconCloudUpload,
  IconCommits,
  IconPullRequest,
  IconPush,
  type CentralIconBaseProps,
} from "central-icons";
import { type ComponentType, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import {
  buildExpandedImagePreviewByIndex,
  type ExpandedImagePreview,
} from "./expanded-image-preview";
import { TerminalContextInlineChip } from "./terminal-context-chip";
import {
  deriveDisplayedUserMessageState,
  formatInlineTerminalContextLabel as formatInlineTerminalContextSelectionLabel,
  type ParsedTerminalContextEntry,
} from "~/lib/terminal-context";
import { type ChatMessage } from "../../../types";
import { useAuthenticatedImagePreviewSrc } from "./authenticated-image-preview";
import {
  GIT_AGENT_ACTIONS,
  resolveGitAgentActionFromPrompt,
  type GitAgentAction,
} from "~/lib/git-agent-actions";
import { hasRenderableRichText, UserRichTextMessage } from "./rich-text-message";

const TERMINAL_CONTEXT_HEADER_PATTERN = /^(.*?)\s+line(?:s)?\s+(\d+)(?:-(\d+))?$/i;
const USER_MESSAGE_BODY_CLASS = "max-w-full min-w-0 break-words wrap-anywhere";

interface UserMessageProps {
  message: ChatMessage;
  editAvailable: boolean;
  isEditing: boolean;
  editDisabled: boolean;
  isServerThread: boolean;
  editComposer: ReactNode;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  onBeginEditUserMessage: ((messageId: MessageId) => void) | undefined;
}

export function UserMessage({
  message,
  editAvailable,
  isEditing,
  editDisabled,
  isServerThread,
  editComposer,
  onImageExpand,
  onBeginEditUserMessage,
}: UserMessageProps) {
  const userImages = message.attachments ?? [];
  const displayedUserMessage = deriveDisplayedUserMessageState(message.text);
  const terminalContexts = displayedUserMessage.contexts;
  const gitAgentAction = resolveGitAgentActionFromPrompt(message.text);
  const isGitAgentActionMessage =
    gitAgentAction !== null && userImages.length === 0 && terminalContexts.length === 0;
  const shouldRenderRichText =
    terminalContexts.length === 0 &&
    message.richText !== undefined &&
    hasRenderableRichText(message.richText);

  const media =
    userImages.length > 0 ? (
      <AttachmentGroup className="mb-2">
        {userImages.map((image, index) => (
          <UserMessageImageAttachment
            key={image.id}
            image={image}
            imageIndex={index}
            images={userImages}
            onImageExpand={onImageExpand}
          />
        ))}
      </AttachmentGroup>
    ) : null;

  const bodyInner = isGitAgentActionMessage ? (
    <GitAgentActionMessage
      action={gitAgentAction}
      label={GIT_AGENT_ACTIONS[gitAgentAction].label}
    />
  ) : shouldRenderRichText ? (
    <UserRichTextMessage
      fallbackText={displayedUserMessage.visibleText}
      richText={message.richText}
    />
  ) : displayedUserMessage.visibleText.trim().length > 0 || terminalContexts.length > 0 ? (
    <UserMessageBody text={displayedUserMessage.visibleText} terminalContexts={terminalContexts} />
  ) : null;

  const body =
    bodyInner && shouldUseUserMessageCollapse(displayedUserMessage.visibleText) ? (
      <ConversationCollapse>{bodyInner}</ConversationCollapse>
    ) : (
      bodyInner
    );

  if (isEditing && editComposer && !isGitAgentActionMessage) {
    return editComposer;
  }

  const canEdit =
    !isGitAgentActionMessage &&
    isServerThread &&
    !editDisabled &&
    editAvailable &&
    typeof onBeginEditUserMessage === "function";
  const turnErrorFooter =
    message.turnFailure !== undefined ? <StatusNotice message={message.turnFailure} /> : undefined;

  if (isGitAgentActionMessage) {
    return <ConversationBubble role="user">{body}</ConversationBubble>;
  }

  if (canEdit) {
    return (
      <ConversationBubble
        footer={turnErrorFooter}
        media={media}
        role="user"
        surfaceProps={editableUserMessageSurfaceProps({
          messageId: message.id,
          onBeginEditUserMessage,
        })}
      >
        {body}
      </ConversationBubble>
    );
  }

  return (
    <ConversationBubble role="user" footer={turnErrorFooter} media={media}>
      {body}
    </ConversationBubble>
  );
}

function editableUserMessageSurfaceProps(input: {
  messageId: MessageId;
  onBeginEditUserMessage: (messageId: MessageId) => void;
}) {
  const activateEdit = (event: MouseEvent<HTMLDivElement> | KeyboardEvent<HTMLDivElement>) => {
    if ("clientX" in event) {
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) {
        return;
      }
    }
    input.onBeginEditUserMessage(input.messageId);
  };

  return {
    role: "button" as const,
    tabIndex: 0,
    "aria-label": "Edit message",
    "data-editable": "true",
    className: "cursor-pointer",
    onClick: activateEdit,
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
      activateEdit(event);
    },
  };
}

function shouldUseUserMessageCollapse(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return false;
  }
  const lineCount = trimmed.split(/\r?\n/).length;
  return lineCount > 4 || trimmed.length > 360;
}

function UserMessageImageAttachment(props: {
  image: NonNullable<ChatMessage["attachments"]>[number];
  imageIndex: number;
  images: NonNullable<ChatMessage["attachments"]>;
  onImageExpand: (preview: ExpandedImagePreview) => void;
}) {
  const previewSrc = useAuthenticatedImagePreviewSrc(props.image.previewUrl);

  return (
    <Attachment>
      {previewSrc ? (
        <AttachmentPreviewTrigger
          aria-label={`Preview ${props.image.name}`}
          onClick={() => {
            const preview = buildExpandedImagePreviewByIndex(props.images, props.imageIndex);
            if (!preview) return;
            props.onImageExpand(preview);
          }}
        >
          <AttachmentImage src={previewSrc} alt={props.image.name} />
        </AttachmentPreviewTrigger>
      ) : (
        <AttachmentFallback>{props.image.name}</AttachmentFallback>
      )}
    </Attachment>
  );
}

type GitAgentActionIconComponent = ComponentType<CentralIconBaseProps>;

function getGitAgentActionIcon(action: GitAgentAction): GitAgentActionIconComponent {
  switch (action) {
    case "createBranchAndCommit":
      return IconBranch;
    case "createBranchCommitAndPush":
      return IconPush;
    case "commit":
      return IconCommits;
    case "commitAndPush":
      return IconCloudUpload;
    case "createPrWithChanges":
      return IconPullRequest;
  }
}

function GitAgentActionMessage(props: { action: GitAgentAction; label: string }) {
  const ActionIcon = getGitAgentActionIcon(props.action);

  return (
    <div className="flex max-w-full min-w-0 items-center gap-1.5 font-medium text-honk-fg-primary">
      <ActionIcon className="size-3.5 shrink-0 text-honk-icon-tertiary" aria-hidden="true" />
      <span className="min-w-0 truncate">{props.label}</span>
    </div>
  );
}

function UserMessageTerminalContextInlineLabel(props: { context: ParsedTerminalContextEntry }) {
  const tooltipText =
    props.context.body.length > 0
      ? `${props.context.header}\n${props.context.body}`
      : props.context.header;

  return <TerminalContextInlineChip label={props.context.header} tooltipText={tooltipText} />;
}

function buildInlineTerminalContextText(
  contexts: ReadonlyArray<{
    header: string;
  }>,
): string {
  return contexts
    .map((context) => context.header.trim())
    .filter((header) => header.length > 0)
    .map(formatInlineTerminalContextLabel)
    .join(" ");
}

function formatInlineTerminalContextLabel(header: string): string {
  const trimmedHeader = header.trim();
  const match = TERMINAL_CONTEXT_HEADER_PATTERN.exec(trimmedHeader);
  if (!match) {
    return `@${trimmedHeader.toLowerCase().replace(/\s+/g, "-")}`;
  }

  const lineStart = Number.parseInt(match[2] ?? "", 10);
  const lineEnd = Number.parseInt(match[3] ?? match[2] ?? "", 10);
  if (!Number.isFinite(lineStart) || !Number.isFinite(lineEnd)) {
    return `@${trimmedHeader.toLowerCase().replace(/\s+/g, "-")}`;
  }

  return formatInlineTerminalContextSelectionLabel({
    terminalLabel: match[1]?.trim() || "terminal",
    lineStart,
    lineEnd,
  });
}

function textContainsInlineTerminalContextLabels(
  text: string,
  contexts: ReadonlyArray<{
    header: string;
  }>,
): boolean {
  let searchStartIndex = 0;

  for (const context of contexts) {
    const label = formatInlineTerminalContextLabel(context.header);
    const matchIndex = text.indexOf(label, searchStartIndex);
    if (matchIndex === -1) {
      return false;
    }
    searchStartIndex = matchIndex + label.length;
  }

  return true;
}

function UserMessageBody(props: { text: string; terminalContexts: ParsedTerminalContextEntry[] }) {
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

        return <div className={USER_MESSAGE_BODY_CLASS}>{inlineNodes}</div>;
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

    return <div className={USER_MESSAGE_BODY_CLASS}>{inlineNodes}</div>;
  }

  if (props.text.length === 0) {
    return null;
  }

  return <div className={USER_MESSAGE_BODY_CLASS}>{props.text}</div>;
}
