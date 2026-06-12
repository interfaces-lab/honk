import { type MessageId } from "@honk/contracts";
import { Button } from "@honk/multikit/button";
import {
  IconBranch,
  IconCloudUpload,
  IconCommits,
  IconPullRequest,
  IconPush,
  type CentralIconBaseProps,
} from "central-icons";
import { type ComponentType, type ReactNode } from "react";
import { buildExpandedImagePreview, type ExpandedImagePreview } from "./expanded-image-preview";
import { TerminalContextInlineChip } from "./terminal-context-chip";
import {
  deriveDisplayedUserMessageState,
  formatInlineTerminalContextLabel as formatInlineTerminalContextSelectionLabel,
  type ParsedTerminalContextEntry,
} from "~/lib/terminal-context";
import { type ChatMessage } from "../../../types";
import { useAuthenticatedImagePreviewSrc } from "./authenticated-image-preview";
import {
  ChatMessageBubble,
  EditableChatMessageBubble,
  ReadonlyActionChatMessageBubble,
} from "./message-surface";
import { HumanMessageCollapsible } from "./human-collapse";
import {
  GIT_AGENT_ACTIONS,
  resolveGitAgentActionFromPrompt,
  type GitAgentAction,
} from "~/lib/git-agent-actions";
import { hasRenderableRichText, ReadonlyRichTextMessage } from "./rich-text-message";

const TERMINAL_CONTEXT_HEADER_PATTERN = /^(.*?)\s+line(?:s)?\s+(\d+)(?:-(\d+))?$/i;

interface HumanMessageProps {
  message: ChatMessage;
  editAvailable: boolean;
  isEditing: boolean;
  editDisabled: boolean;
  isServerThread: boolean;
  editComposer: ReactNode;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  onBeginEditUserMessage: ((messageId: MessageId) => void) | undefined;
}

export function HumanMessage({
  message,
  editAvailable,
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
  const gitAgentAction = resolveGitAgentActionFromPrompt(message.text);
  const isGitAgentActionMessage =
    gitAgentAction !== null && userImages.length === 0 && terminalContexts.length === 0;
  const shouldRenderRichText =
    terminalContexts.length === 0 &&
    message.richText !== undefined &&
    hasRenderableRichText(message.richText);

  const media =
    userImages.length > 0 ? (
      <div className="mb-2 grid max-w-md grid-cols-2 gap-2">
        {userImages.map((image) => (
          <HumanMessageImageAttachment
            key={image.id}
            image={image}
            images={userImages}
            onImageExpand={onImageExpand}
          />
        ))}
      </div>
    ) : null;

  const bodyInner = isGitAgentActionMessage ? (
    <GitAgentActionMessage
      action={gitAgentAction}
      label={GIT_AGENT_ACTIONS[gitAgentAction].label}
    />
  ) : shouldRenderRichText ? (
    <ReadonlyRichTextMessage
      fallbackText={displayedUserMessage.visibleText}
      richText={message.richText}
    />
  ) : displayedUserMessage.visibleText.trim().length > 0 || terminalContexts.length > 0 ? (
    <UserMessageBody text={displayedUserMessage.visibleText} terminalContexts={terminalContexts} />
  ) : null;

  const body =
    bodyInner && !isGitAgentActionMessage ? (
      <HumanMessageCollapsible>{bodyInner}</HumanMessageCollapsible>
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

  if (isGitAgentActionMessage) {
    return <ReadonlyActionChatMessageBubble body={body} />;
  }

  if (canEdit) {
    return (
      <EditableChatMessageBubble
        body={body}
        media={media}
        onActivate={() => onBeginEditUserMessage(message.id)}
      />
    );
  }

  return <ChatMessageBubble messageRole="user" body={body} media={media} />;
}

function HumanMessageImageAttachment(props: {
  image: NonNullable<ChatMessage["attachments"]>[number];
  images: NonNullable<ChatMessage["attachments"]>;
  onImageExpand: (preview: ExpandedImagePreview) => void;
}) {
  const previewSrc = useAuthenticatedImagePreviewSrc(props.image.previewUrl);

  return (
    <div className="overflow-hidden rounded-honk-control border border-honk-stroke-secondary bg-(--honk-message-bubble-background)">
      {previewSrc ? (
        <Button
          type="button"
          variant="ghost"
          className="block size-full cursor-zoom-in rounded-none border-0 bg-transparent p-0 shadow-none before:hidden hover:bg-transparent data-pressed:bg-transparent"
          aria-label={`Preview ${props.image.name}`}
          onClick={() => {
            const preview = buildExpandedImagePreview(props.images, props.image.id);
            if (!preview) return;
            props.onImageExpand(preview);
          }}
        >
          <img src={previewSrc} alt={props.image.name} className="block h-8 w-full object-cover" />
        </Button>
      ) : (
        <div className="flex min-h-8 items-center justify-center px-2 py-1 text-center text-detail text-honk-fg-tertiary">
          {props.image.name}
        </div>
      )}
    </div>
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

function findTextFrom(text: string, search: string, fromIndex: number): number {
  return text.indexOf(search, fromIndex);
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
    const matchIndex = findTextFrom(text, label, searchStartIndex);
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
        const matchIndex = findTextFrom(props.text, label, cursor);
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
}
