import * as stylex from "@stylexjs/stylex";
import { type KeyboardEvent, type MouseEvent, type ReactNode } from "react";

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

const styles = stylex.create({
  metaRow: {
    alignItems: "center",
    display: "flex",
    gap: "var(--honk-spacing-2)",
  },
  metaRowEnd: {
    justifyContent: "flex-end",
  },
  meta: {
    color: "color-mix(in srgb, var(--honk-fg-tertiary) 55%, transparent)",
    fontSize: "var(--honk-text-caption)",
    lineHeight: "var(--honk-leading-caption)",
    margin: 0,
    userSelect: "none",
  },
  actions: {
    alignItems: "center",
    display: "flex",
    gap: "var(--honk-spacing-1-5)",
    opacity: 0,
    transitionDuration: "var(--motion-duration-hover)",
    transitionProperty: "opacity",
    transitionTimingFunction: "var(--ease-shell)",
    ":focus-within": {
      opacity: 1,
    },
  },
  assistantSurface: {
    boxSizing: "border-box",
    display: "flex",
    justifyContent: "flex-start",
    width: "100%",
  },
  assistantSurfaceStacked: {
    flexDirection: "column",
  },
  assistantSurfaceLeading: {
    alignItems: "flex-start",
    gap: "var(--honk-spacing-2)",
  },
  leadingIcon: {
    flexShrink: 0,
    marginTop: 3,
  },
  assistantBody: {
    color: "var(--honk-fg-primary)",
    fontSize: "var(--conversation-text-font-size)",
    lineHeight: "var(--conversation-text-leading)",
    minWidth: 0,
    width: "100%",
    ":hover [data-message-actions]": {
      opacity: 1,
    },
    ":focus-within [data-message-actions]": {
      opacity: 1,
    },
  },
  assistantFooter: {
    marginTop: "var(--honk-spacing-1-5)",
  },
  userRow: {
    boxSizing: "border-box",
    display: "flex",
    justifyContent: "flex-end",
    minWidth: 0,
    width: "100%",
  },
  userBubble: {
    borderRadius: "var(--honk-radius-xl)",
    boxSizing: "border-box",
    isolation: "isolate",
    maxWidth: "100%",
    minWidth: 0,
    overflow: "hidden",
    position: "relative",
    width: "100%",
    ":hover [data-message-actions]": {
      opacity: 1,
    },
    ":focus-within [data-message-actions]": {
      opacity: 1,
    },
  },
  userBubbleEditable: {
    cursor: "pointer",
  },
  userBubbleReadonlyAction: {
    cursor: "default",
  },
  media: {
    minWidth: 0,
  },
  userContent: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    fontSize: "var(--conversation-text-font-size)",
    gap: "var(--honk-spacing-1-5)",
    minWidth: 0,
    width: "100%",
  },
  userBody: {
    color: "var(--honk-fg-primary)",
    display: "flex",
    flexDirection: "column",
    lineHeight: "var(--conversation-text-leading)",
    minWidth: 0,
    overflowWrap: "anywhere",
    userSelect: "text",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  userFooter: {
    marginTop: "var(--honk-spacing-1)",
  },
});

export function MessageMetaRow(props: { alignEnd?: boolean; children: ReactNode }) {
  return <div {...stylex.props(styles.metaRow, props.alignEnd ? styles.metaRowEnd : null)}>{props.children}</div>;
}

export function MessageMeta(props: { children: ReactNode }) {
  return <p {...stylex.props(styles.meta)}>{props.children}</p>;
}

export function MessageActions(props: { children: ReactNode }) {
  return (
    <div {...stylex.props(styles.actions)} data-message-actions="">
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
    <div
      {...stylex.props(
        styles.assistantSurface,
        leadingIcon ? styles.assistantSurfaceLeading : styles.assistantSurfaceStacked,
      )}
    >
      {leadingIcon ? <div {...stylex.props(styles.leadingIcon)}>{leadingIcon}</div> : null}
      <div {...stylex.props(styles.assistantBody)} data-message-bubble="assistant">
        {body}
        {footer ? <div {...stylex.props(styles.assistantFooter)}>{footer}</div> : null}
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
  const userContentProps = stylex.props(styles.userContent);
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
    <div {...stylex.props(styles.userRow)}>
      <div
        {...stylex.props(
          styles.userBubble,
          props.editable ? styles.userBubbleEditable : null,
          readonlyAction ? styles.userBubbleReadonlyAction : null,
        )}
        data-message-bubble="user"
        data-message-bubble-surface=""
        data-editable={props.editable ? "true" : undefined}
        {...editableProps}
      >
        <div
          {...userContentProps}
          className={`${userContentProps.className ?? ""} px-2.5 py-2`}
          data-user-message-content=""
        >
          {props.media ? (
            <div
              {...stylex.props(styles.media)}
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
          <div {...stylex.props(styles.userBody)}>{props.body}</div>
          {props.footer ? <div {...stylex.props(styles.userFooter)}>{props.footer}</div> : null}
        </div>
      </div>
    </div>
  );
}
