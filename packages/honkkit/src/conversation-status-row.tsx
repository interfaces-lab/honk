"use client";

import { type ComponentPropsWithoutRef, type ReactNode } from "react";

import { cn } from "./utils";

interface ConversationStatusRowProps extends ComponentPropsWithoutRef<"div"> {
  active?: boolean | undefined;
  detail?: ReactNode;
  icon: ReactNode;
  label: ReactNode;
}

function ConversationStatusRow({
  active = false,
  className,
  detail,
  icon,
  label,
  ...props
}: ConversationStatusRowProps) {
  return (
    <div
      className={cn(
        "flex w-full min-w-0 items-start gap-2 text-conversation text-honk-fg-secondary",
        className,
      )}
      data-slot="conversation-status-row"
      {...props}
    >
      <span
        className={cn(
          "mt-0.5 inline-flex size-3.5 shrink-0 items-center justify-center text-honk-icon-tertiary",
          "[&>svg]:size-3.5",
          active && "tool-call-shimmer text-honk-icon-accent-primary",
        )}
        data-slot="conversation-status-row-icon"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1" data-slot="conversation-status-row-content">
        <span
          className={cn(
            "block min-w-0 break-words font-medium text-honk-fg-primary wrap-anywhere",
            active && "tool-call-shimmer",
          )}
          data-slot="conversation-status-row-label"
        >
          {label}
        </span>
        {detail ? (
          <span
            className="mt-0.5 block min-w-0 whitespace-pre-wrap break-words text-honk-fg-tertiary wrap-anywhere"
            data-slot="conversation-status-row-detail"
          >
            {detail}
          </span>
        ) : null}
      </span>
    </div>
  );
}

export { ConversationStatusRow };
