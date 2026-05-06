import { cva } from "class-variance-authority";
import { memo, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { cn } from "~/lib/utils";

function shouldBlockBubbleActivate(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  return Boolean(
    target.closest(
      'button, a, input, textarea, select, summary, [role="button"], [role="link"], [data-human-message-collapse-toggle]',
    ),
  );
}

interface ChatMessageBubbleProps {
  role: "user" | "assistant";
  body: ReactNode;
  leadingIcon?: ReactNode;
  footer?: ReactNode;
  media?: ReactNode;
  interactive?: boolean;
  onClick?: ((event: MouseEvent | KeyboardEvent) => void) | undefined;
}

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

const assistantMessageBodyVariants = cva(
  cn(
    "group/message-bubble w-full min-w-0",
    "text-[length:var(--conversation-text-font-size,var(--conversation-font-size,13px))]/[1.5]",
    "text-multi-fg-primary",
  ),
  {
    variants: {
      interactive: {
        false: "",
        true: "cursor-pointer",
      },
    },
    defaultVariants: {
      interactive: false,
    },
  },
);

const humanMessageBubbleVariants = cva(
  cn(
    "group/message-bubble box-border w-full min-w-0 max-w-full",
    "rounded-xl border border-multi-stroke-tertiary bg-multi-bubble px-3 py-2 shadow-xs",
  ),
  {
    variants: {
      interactive: {
        false: "",
        true: "cursor-pointer",
      },
    },
    defaultVariants: {
      interactive: false,
    },
  },
);

export const MessageMetaRow = memo(function MessageMetaRow(props: {
  alignEnd?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex items-center gap-2", props.alignEnd && "justify-end")}>
      {props.children}
    </div>
  );
});

export const MessageMeta = memo(function MessageMeta(props: { children: ReactNode }) {
  return (
    <p className="m-0 select-none text-[10px]/3 text-[color-mix(in_srgb,var(--multi-fg-tertiary)_56%,transparent)]">
      {props.children}
    </p>
  );
});

export const MessageActions = memo(function MessageActions(props: { children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5",
        "opacity-0 transition-opacity duration-200",
        "group-hover/message-bubble:opacity-100 focus-within:opacity-100",
      )}
    >
      {props.children}
    </div>
  );
});

export const ChatMessageBubble = memo(function ChatMessageBubble({
  role,
  body,
  leadingIcon,
  footer,
  media,
  interactive = false,
  onClick,
}: ChatMessageBubbleProps) {
  if (role === "user") {
    const activateEdit = (event: MouseEvent | KeyboardEvent) => {
      if (!interactive || !onClick) {
        return;
      }
      if ("clientX" in event) {
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed) {
          return;
        }
      }
      if (shouldBlockBubbleActivate(event.target)) {
        return;
      }
      onClick(event);
    };

    return (
      <div className="box-border flex w-full min-w-0">
        <div
          className={humanMessageBubbleVariants({ interactive })}
          role={interactive ? "button" : undefined}
          tabIndex={interactive ? 0 : undefined}
          aria-label={interactive ? "Edit message" : undefined}
          onClick={interactive ? activateEdit : undefined}
          onKeyDown={
            interactive
              ? (event) => {
                  if (event.key !== "Enter" && event.key !== " ") {
                    return;
                  }
                  event.preventDefault();
                  activateEdit(event);
                }
              : undefined
          }
        >
          {media ? (
            <div
              className="min-w-0"
              onClick={
                interactive
                  ? (event) => {
                      event.stopPropagation();
                    }
                  : undefined
              }
            >
              {media}
            </div>
          ) : null}
          <div
            className={cn(
              "flex min-w-0 flex-col whitespace-pre-wrap break-words wrap-anywhere select-text",
              "text-[length:var(--conversation-text-font-size,var(--conversation-font-size,13px))]/[1.5]",
              "text-multi-fg-primary",
            )}
          >
            {body}
          </div>
          {footer ? <div className="mt-1">{footer}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div className={assistantMessageSurfaceVariants({ leading: Boolean(leadingIcon) })}>
      {leadingIcon ? <div className="mt-[3px] shrink-0">{leadingIcon}</div> : null}
      <div
        className={assistantMessageBodyVariants({ interactive })}
        role={interactive ? "button" : undefined}
        tabIndex={interactive ? 0 : undefined}
        onClick={interactive ? (event) => onClick?.(event) : undefined}
        onKeyDown={
          interactive
            ? (event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onClick?.(event);
              }
            : undefined
        }
      >
        {body}
        {footer ? <div className="mt-1.5">{footer}</div> : null}
      </div>
    </div>
  );
});
