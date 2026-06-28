"use client";

import * as stylex from "@stylexjs/stylex";
import { type ComponentPropsWithoutRef, type ReactNode } from "react";

import { cn } from "./utils";

interface ConversationBubbleProps {
  role: "user" | "assistant";
  children: ReactNode;
  className?: string | undefined;
  footer?: ReactNode;
  media?: ReactNode;
  surfaceProps?: ComponentPropsWithoutRef<"div"> | undefined;
}

interface UserConversationBubbleSurfaceProps {
  children: ReactNode;
  className?: string | undefined;
  footer?: ReactNode;
  media?: ReactNode;
  surfaceProps?: ComponentPropsWithoutRef<"div"> | undefined;
}

const styles = stylex.create({
  assistantSurface: {
    boxSizing: "border-box",
    display: "flex",
    justifyContent: "flex-start",
    width: "100%",
  },
  assistantSurfaceStacked: {
    flexDirection: "column",
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
  userFooter: {
    marginTop: "var(--honk-spacing-1)",
  },
});

export function ConversationBubble({
  role,
  children,
  className,
  footer,
  media,
  surfaceProps,
}: ConversationBubbleProps) {
  if (role === "user") {
    return (
      <UserConversationBubbleSurface
        className={className}
        footer={footer}
        media={media}
        surfaceProps={surfaceProps}
      >
        {children}
      </UserConversationBubbleSurface>
    );
  }

  const rootProps = stylex.props(styles.assistantSurface, styles.assistantSurfaceStacked);
  const { className: surfaceClassName, ...assistantSurfaceProps } = surfaceProps ?? {};
  const assistantBodyProps = stylex.props(styles.assistantBody);
  return (
    <div {...rootProps} className={cn(rootProps.className, className)}>
      <div
        {...assistantBodyProps}
        {...assistantSurfaceProps}
        className={cn(assistantBodyProps.className, surfaceClassName)}
        data-message-bubble="assistant"
      >
        {children}
        {footer ? <div {...stylex.props(styles.assistantFooter)}>{footer}</div> : null}
      </div>
    </div>
  );
}

function UserConversationBubbleSurface(props: UserConversationBubbleSurfaceProps) {
  const rowProps = stylex.props(styles.userRow);
  const contentProps = stylex.props(styles.userContent);
  const bubbleProps = stylex.props(styles.userBubble);
  const { className: surfaceClassName, ...surfaceProps } = props.surfaceProps ?? {};

  return (
    <div {...rowProps} className={cn(rowProps.className, props.className)}>
      <div
        {...bubbleProps}
        {...surfaceProps}
        className={cn(bubbleProps.className, surfaceClassName)}
        data-message-bubble="user"
        data-message-bubble-surface=""
      >
        <div
          {...contentProps}
          className={cn(contentProps.className, "px-2.5 py-2")}
          data-user-message-content=""
        >
          {props.media ? (
            <div {...stylex.props(styles.media)} role="presentation">
              {props.media}
            </div>
          ) : null}
          {props.children}
          {props.footer ? <div {...stylex.props(styles.userFooter)}>{props.footer}</div> : null}
        </div>
      </div>
    </div>
  );
}
