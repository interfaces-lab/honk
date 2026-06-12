import { cva } from "class-variance-authority";
import { type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { cn } from "~/lib/utils";

type MessageBubbleActivateEvent = MouseEvent<HTMLDivElement> | KeyboardEvent<HTMLDivElement>;

interface ChatMessageBubbleProps {
  messageRole: "user" | "assistant";
  body: ReactNode;
  leadingIcon?: ReactNode;
  footer?: ReactNode;
  media?: ReactNode;
}

interface EditableChatMessageBubbleProps {
  body: ReactNode;
  footer?: ReactNode;
  media?: ReactNode;
  onActivate: (event: MessageBubbleActivateEvent) => void;
}

interface ReadonlyActionChatMessageBubbleProps {
  body: ReactNode;
  footer?: ReactNode;
  media?: ReactNode;
}

type UserMessageBubbleSurfaceProps =
  | {
      body: ReactNode;
      footer?: ReactNode;
      media?: ReactNode;
      editable: true;
      onActivate: (event: MessageBubbleActivateEvent) => void;
      readonlyAction?: never;
    }
  | {
      body: ReactNode;
      footer?: ReactNode;
      media?: ReactNode;
      editable?: false;
      readonlyAction?: boolean;
    };

const assistantMessageSurfaceVariants = cva("box-border flex w-full justify-start", {
  variants: {
    leading: {
      false: "flex-col",
      true: "items-start gap-2",
    },
  },
  defaultVariants: {
    leading: false,
  },
});

const humanMessageBubbleVariants = cva(
  cn(
    "group/message-bubble relative isolate box-border w-full min-w-0 max-w-full overflow-hidden",
    "rounded-xl px-2.5 py-2",
  ),
  {
    variants: {
      editable: {
        false: "",
        true: "cursor-pointer",
      },
    },
    defaultVariants: {
      editable: false,
    },
  },
);

export function MessageMetaRow(props: { alignEnd?: boolean; children: ReactNode }) {
  return (
    <div className={cn("flex items-center gap-2", props.alignEnd && "justify-end")}>
      {props.children}
    </div>
  );
}

export function MessageMeta(props: { children: ReactNode }) {
  return <p className="m-0 select-none text-caption text-honk-fg-tertiary/55">{props.children}</p>;
}

export function MessageActions(props: { children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5",
        "opacity-0 transition-opacity duration-100",
        "group-hover/message-bubble:opacity-100 focus-within:opacity-100",
      )}
    >
      {props.children}
    </div>
  );
}

export function ChatMessageBubble({
  messageRole,
  body,
  leadingIcon,
  footer,
  media,
}: ChatMessageBubbleProps) {
  if (messageRole === "user") {
    return <UserMessageBubbleSurface body={body} footer={footer} media={media} />;
  }

  return (
    <div className={assistantMessageSurfaceVariants({ leading: Boolean(leadingIcon) })}>
      {leadingIcon ? <div className="mt-[3px] shrink-0">{leadingIcon}</div> : null}
      <div className="group/message-bubble w-full min-w-0 text-conversation text-honk-fg-primary">
        {body}
        {footer ? <div className="mt-1.5">{footer}</div> : null}
      </div>
    </div>
  );
}

export function EditableChatMessageBubble({
  body,
  footer,
  media,
  onActivate,
}: EditableChatMessageBubbleProps) {
  const activateEdit = (event: MessageBubbleActivateEvent) => {
    if ("clientX" in event) {
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) {
        return;
      }
    }
    onActivate(event);
  };

  return (
    <UserMessageBubbleSurface
      body={body}
      footer={footer}
      media={media}
      editable
      onActivate={activateEdit}
    />
  );
}

export function ReadonlyActionChatMessageBubble({
  body,
  footer,
  media,
}: ReadonlyActionChatMessageBubbleProps) {
  return <UserMessageBubbleSurface body={body} footer={footer} media={media} readonlyAction />;
}

function UserMessageBubbleSurface(props: UserMessageBubbleSurfaceProps) {
  const readonlyAction = !props.editable && props.readonlyAction === true;
  const editableProps = props.editable
    ? {
        role: "button" as const,
        tabIndex: 0,
        "aria-label": "Edit message",
        onClick: props.onActivate,
        onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
          if (event.key !== "Enter" && event.key !== " ") {
            return;
          }
          event.preventDefault();
          props.onActivate(event);
        },
      }
    : {};

  return (
    <div className="box-border flex w-full min-w-0 justify-end">
      <div
        className={cn(
          humanMessageBubbleVariants({ editable: props.editable }),
          readonlyAction && "cursor-default",
        )}
        data-message-bubble-surface=""
        data-editable={props.editable ? "true" : undefined}
        {...editableProps}
      >
        {props.media ? (
          <div
            className="min-w-0"
            role="presentation"
            onClick={
              props.editable
                ? (event) => {
                    event.stopPropagation();
                  }
                : undefined
            }
            onKeyDown={
              props.editable
                ? (event) => {
                    event.stopPropagation();
                  }
                : undefined
            }
          >
            {props.media}
          </div>
        ) : null}
        <div
          className={cn(
            "flex min-w-0 flex-col whitespace-pre-wrap break-words wrap-anywhere select-text",
            "text-conversation",
            "text-honk-fg-primary",
          )}
        >
          {props.body}
        </div>
        {props.footer ? <div className="mt-1">{props.footer}</div> : null}
      </div>
    </div>
  );
}
