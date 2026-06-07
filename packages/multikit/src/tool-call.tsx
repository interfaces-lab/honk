"use client";

import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { IconChevronRightMedium } from "central-icons";
import { cva } from "class-variance-authority";
import type { ComponentPropsWithoutRef, ComponentType, ReactNode } from "react";

import { cn, interactiveControlCursorClassName } from "./utils";

type ToolCallIconComponent = ComponentType<{ className?: string | undefined }>;
type ToolCallLineStatus = "idle" | "loading" | "completed" | "error";
type ToolCallExpandableStatus = "running" | "completed" | "error";

const toolCallLineVariants = cva(
  cn(
    "group/tool-call-line inline-flex min-h-6 w-fit max-w-full min-w-0 items-center gap-1 overflow-hidden",
    "border-0 bg-transparent text-left select-none",
    "text-conversation",
    "text-ellipsis whitespace-nowrap text-multi-fg-primary",
  ),
  {
    variants: {
      clickable: {
        false: "",
        true: interactiveControlCursorClassName,
      },
      status: {
        idle: "",
        loading: "",
        completed: "",
        error: "text-multi-fg-red-primary",
      },
    },
    defaultVariants: {
      clickable: false,
      status: "idle",
    },
  },
);

const toolCallLineActionVariants = cva(
  cn(
    "shrink-0 overflow-hidden text-ellipsis whitespace-nowrap",
    "font-normal text-multi-fg-secondary",
    "transition-colors duration-100",
    "group-hover/tool-call-line:text-multi-fg-primary",
  ),
  {
    variants: {
      loading: {
        false: "",
        true: "tool-call-shimmer",
      },
      status: {
        idle: "",
        loading: "",
        completed: "",
        error: "text-multi-fg-red-primary group-hover/tool-call-line:text-multi-fg-red-primary",
      },
    },
    defaultVariants: {
      loading: false,
      status: "idle",
    },
  },
);

const toolCallLineDetailsVariants = cva(
  cn(
    "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-multi-fg-tertiary tabular-nums",
    "transition-colors duration-100",
    "group-hover/tool-call-line:text-multi-fg-secondary",
  ),
  {
    variants: {
      linkable: {
        false: "",
        true: cn(
          "underline",
          interactiveControlCursorClassName,
          "decoration-[color-mix(in_srgb,var(--multi-fg-tertiary)_45%,transparent)]",
          "hover:text-multi-fg-secondary",
          "hover:decoration-[color-mix(in_srgb,var(--multi-fg-secondary)_55%,transparent)]",
          "focus-visible:text-multi-fg-secondary",
          "focus-visible:decoration-[color-mix(in_srgb,var(--multi-fg-secondary)_55%,transparent)]",
        ),
      },
      status: {
        idle: "",
        loading: "",
        completed: "",
        error: "text-multi-fg-red-primary group-hover/tool-call-line:text-multi-fg-red-primary",
      },
    },
    defaultVariants: {
      linkable: false,
      status: "idle",
    },
  },
);

interface ToolCallLineProps {
  action: string;
  className?: string | undefined;
  details: ReactNode;
  icon?: ToolCallIconComponent | undefined;
  linkable?: boolean | undefined;
  loading?: boolean | undefined;
  onClick?: (() => void) | undefined;
  status?: ToolCallLineStatus | undefined;
}

function ToolCallLine({
  action,
  className,
  details,
  icon: Icon,
  linkable = false,
  loading = false,
  onClick,
  status = "idle",
}: ToolCallLineProps) {
  const resolvedStatus = loading ? "loading" : status;
  const content = (
    <>
      {Icon ? <Icon className="size-3.5 shrink-0 text-multi-fg-tertiary" /> : null}
      <ToolCallLineAction loading={resolvedStatus === "loading"} status={resolvedStatus}>
        {action}
      </ToolCallLineAction>
      {details ? (
        <ToolCallLineDetails linkable={linkable} status={resolvedStatus}>
          {details}
        </ToolCallLineDetails>
      ) : null}
    </>
  );

  if (!onClick) {
    return (
      <div
        className={cn(toolCallLineVariants({ clickable: false, status: resolvedStatus }), className)}
        data-status={resolvedStatus}
        data-tool-call-line=""
      >
        {content}
      </div>
    );
  }

  return (
    <ButtonPrimitive
      className={cn(toolCallLineVariants({ clickable: true, status: resolvedStatus }), className)}
      data-status={resolvedStatus}
      data-tool-call-line=""
      onClick={onClick}
      type="button"
    >
      {content}
    </ButtonPrimitive>
  );
}

function ToolCallLineAction({
  className,
  loading = false,
  status = "idle",
  ...props
}: ComponentPropsWithoutRef<"span"> & {
  loading?: boolean | undefined;
  status?: ToolCallLineStatus | undefined;
}) {
  return (
    <span
      className={cn(toolCallLineActionVariants({ loading, status }), className)}
      data-tool-call-line-action=""
      {...props}
    />
  );
}

function ToolCallLineDetails({
  children,
  className,
  linkable = false,
  status = "idle",
  ...spanProps
}: ComponentPropsWithoutRef<"span"> & {
  linkable?: boolean | undefined;
  status?: ToolCallLineStatus | undefined;
}) {
  return (
    <span
      {...spanProps}
      className={cn(toolCallLineDetailsVariants({ linkable, status }), className)}
      data-tool-call-line-details=""
    >
      {children}
    </span>
  );
}

function ToolCallLineChevron({
  className,
  expanded,
  ...props
}: ComponentPropsWithoutRef<"span"> & {
  expanded: boolean;
}) {
  return (
    <span
      className={cn("inline-flex size-3 shrink-0 items-center justify-center", className)}
      data-tool-call-line-chevron=""
      {...props}
    >
      <IconChevronRightMedium
        className={cn(
          "size-3 shrink-0 text-multi-icon-tertiary transition-transform duration-(--motion-duration-collapsible) ease-out motion-reduce:transition-none",
          expanded && "rotate-90",
        )}
      />
    </span>
  );
}

function ToolCallTaskRoot({
  className,
  expanded,
  status,
  ...props
}: ComponentPropsWithoutRef<"div"> & {
  expanded: boolean;
  status: ToolCallExpandableStatus;
}) {
  return (
    <div
      className={cn("group/task-tool-call min-w-0 max-w-full text-conversation", className)}
      data-expanded={expanded ? "true" : "false"}
      data-status={status}
      data-task-tool-call=""
      {...props}
    />
  );
}

function ToolCallTaskHeader({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ButtonPrimitive>) {
  return (
    <ButtonPrimitive
      type="button"
      className={cn(
        "inline-flex min-h-6 w-fit max-w-full min-w-0 items-center gap-1 border-0 bg-transparent p-0 text-left font-[inherit] text-inherit outline-none select-none",
        interactiveControlCursorClassName,
        className,
      )}
      data-task-tool-call-header=""
      data-tool-call-line=""
      {...props}
    />
  );
}

function ToolCallTaskStatusIcon({ className, ...props }: ComponentPropsWithoutRef<"span">) {
  return (
    <span
      className={cn(
        "flex h-5 w-3.5 shrink-0 items-center justify-center text-multi-fg-secondary",
        className,
      )}
      data-task-tool-call-status-icon=""
      {...props}
    />
  );
}

function ToolCallTaskTitleArea({ className, ...props }: ComponentPropsWithoutRef<"span">) {
  return (
    <span
      className={cn(
        "inline-flex min-w-0 max-w-full flex-1 items-baseline gap-1.5 overflow-hidden",
        className,
      )}
      data-task-tool-call-title-area=""
      {...props}
    />
  );
}

function ToolCallTaskTitle({
  className,
  loading = false,
  ...props
}: ComponentPropsWithoutRef<"span"> & {
  loading?: boolean | undefined;
}) {
  return (
    <span
      className={cn(
        "shrink-0 overflow-hidden text-ellipsis whitespace-nowrap leading-5 text-multi-fg-primary",
        loading && "tool-call-shimmer",
        className,
      )}
      data-task-tool-call-title=""
      {...props}
    />
  );
}

function ToolCallTaskSubtitle({ className, ...props }: ComponentPropsWithoutRef<"span">) {
  return (
    <span
      className={cn(
        "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap leading-5 text-multi-fg-tertiary",
        className,
      )}
      data-task-tool-call-subtitle=""
      {...props}
    />
  );
}

function ToolCallTaskChevron({
  className,
  expanded,
  ...props
}: ComponentPropsWithoutRef<typeof IconChevronRightMedium> & {
  expanded: boolean;
}) {
  return (
    <IconChevronRightMedium
      className={cn(
        "size-3 shrink-0 text-multi-icon-tertiary opacity-0 transition-transform duration-(--motion-duration-collapsible) ease-out motion-reduce:transition-none",
        "group-hover/task-tool-call:opacity-100 group-focus-within/task-tool-call:opacity-100",
        expanded && "rotate-90 opacity-100",
        className,
      )}
      data-task-tool-call-chevron=""
      {...props}
    />
  );
}

function ToolCallTaskBody({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn("min-w-0 max-w-full pt-1 pl-[18px]", className)}
      data-task-tool-call-body=""
      {...props}
    />
  );
}

function ToolCallShellRoot({
  className,
  expanded,
  status,
  ...props
}: ComponentPropsWithoutRef<"div"> & {
  expanded: boolean;
  status: ToolCallExpandableStatus;
}) {
  return (
    <div
      className={cn("group/shell-tool-call min-w-0 max-w-full px-0 text-conversation tracking-normal", className)}
      data-expanded={expanded ? "true" : "false"}
      data-shell-tool-call=""
      data-status={status}
      {...props}
    />
  );
}

function ToolCallShellHeader({
  className,
  expandable,
  expanded,
  hasError = false,
  ...props
}: ComponentPropsWithoutRef<typeof ButtonPrimitive> & {
  expandable: boolean;
  expanded: boolean;
  hasError?: boolean | undefined;
}) {
  return (
    <ButtonPrimitive
      type="button"
      className={cn(
        "group/shell-trigger inline-flex min-h-6 w-fit max-w-full min-w-0 items-center gap-1 overflow-visible",
        "border-0 bg-transparent p-0 text-left text-conversation text-multi-fg-primary select-none",
        expandable ? interactiveControlCursorClassName : "cursor-default",
        hasError && "text-multi-fg-red-primary",
        className,
      )}
      aria-expanded={expandable ? expanded : undefined}
      data-shell-tool-call-header=""
      data-tool-call-line=""
      disabled={!expandable}
      {...props}
    />
  );
}

function ToolCallShellBody({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn(
        "mt-1 min-w-0 max-w-full overflow-hidden rounded-multi-control border border-multi-stroke-tertiary bg-multi-bg-elevated",
        className,
      )}
      data-shell-tool-call-body=""
      {...props}
    />
  );
}

export {
  ToolCallLine,
  ToolCallLineAction,
  ToolCallLineChevron,
  ToolCallLineDetails,
  ToolCallShellBody,
  ToolCallShellHeader,
  ToolCallShellRoot,
  ToolCallTaskBody,
  ToolCallTaskChevron,
  ToolCallTaskHeader,
  ToolCallTaskRoot,
  ToolCallTaskStatusIcon,
  ToolCallTaskSubtitle,
  ToolCallTaskTitle,
  ToolCallTaskTitleArea,
  type ToolCallExpandableStatus,
  type ToolCallLineStatus,
  toolCallLineActionVariants,
  toolCallLineDetailsVariants,
  toolCallLineVariants,
};
