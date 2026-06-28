"use client";

import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { IconChevronRightMedium } from "central-icons";
import { cva } from "class-variance-authority";
import {
  useState,
  type ComponentPropsWithoutRef,
  type ComponentType,
  type CSSProperties,
  type ReactNode,
} from "react";

import { cn, interactiveControlCursorVariants } from "./utils";

type ToolCallIconComponent = ComponentType<{ className?: string | undefined }>;
type ToolCallLineStatus = "idle" | "loading" | "completed" | "error";
type ToolCallExpandableStatus = "running" | "completed" | "error";
type ToolCallLineRootProps = ComponentPropsWithoutRef<"div"> & {
  clickable?: boolean | undefined;
  status?: ToolCallLineStatus | undefined;
};
type ToolCallLineButtonRootProps = ComponentPropsWithoutRef<typeof ButtonPrimitive> & {
  status?: ToolCallLineStatus | undefined;
};

const EMPTY_TOOL_METADATA_ITEMS: readonly string[] = [];
const STREAMING_SHELL_OUTPUT_MAX_CHARS = 12_000;
const STREAMING_TOOL_OUTPUT_PREVIEW_MAX_HEIGHT_PX = 90;

const toolCallLineVariants = cva(
  cn(
    "group/tool-call-line inline-flex min-h-6 w-fit max-w-full min-w-0 items-center gap-1 overflow-hidden",
    "border-0 bg-transparent text-left select-none",
    "text-conversation",
    "text-ellipsis whitespace-nowrap text-honk-fg-primary",
  ),
  {
    variants: {
      clickable: {
        false: "",
        true: interactiveControlCursorVariants(),
      },
      status: {
        idle: "",
        loading: "",
        completed: "",
        error: "text-honk-fg-red-primary",
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
    "font-normal text-honk-fg-secondary",
    "transition-colors duration-100",
    "group-hover/tool-call-line:text-honk-fg-primary",
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
        error: "text-honk-fg-red-primary group-hover/tool-call-line:text-honk-fg-red-primary",
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
    "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-honk-fg-tertiary tabular-nums",
    "transition-colors duration-100",
  ),
  {
    variants: {
      hoverTone: {
        default: "group-hover/tool-call-line:text-honk-fg-secondary",
        static: "group-hover/tool-call-line:text-honk-fg-tertiary",
      },
      linkable: {
        false: "",
        true: cn(
          "underline",
          interactiveControlCursorVariants(),
          "decoration-[color-mix(in_srgb,var(--honk-fg-tertiary)_45%,transparent)]",
          "hover:text-honk-fg-secondary",
          "hover:decoration-[color-mix(in_srgb,var(--honk-fg-secondary)_55%,transparent)]",
          "focus-visible:text-honk-fg-secondary",
          "focus-visible:decoration-[color-mix(in_srgb,var(--honk-fg-secondary)_55%,transparent)]",
        ),
      },
      loading: {
        false: "",
        true: "tool-call-shimmer",
      },
      status: {
        idle: "",
        loading: "",
        completed: "",
        error: "text-honk-fg-red-primary group-hover/tool-call-line:text-honk-fg-red-primary",
      },
    },
    defaultVariants: {
      hoverTone: "default",
      linkable: false,
      loading: false,
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
  onClick?: (() => void) | undefined;
  status?: ToolCallLineStatus | undefined;
}

function ToolCallLineRoot({
  className,
  clickable = false,
  status = "idle",
  ...divProps
}: ToolCallLineRootProps) {
  return (
    <div
      className={cn(toolCallLineVariants({ clickable, status }), className)}
      data-status={status}
      data-tool-call-line=""
      {...divProps}
    />
  );
}

function ToolCallLineButtonRoot({
  className,
  status = "idle",
  type = "button",
  ...buttonProps
}: ToolCallLineButtonRootProps) {
  return (
    <ButtonPrimitive
      type={type}
      className={cn(
        toolCallLineVariants({ clickable: true, status }),
        "h-auto py-0 shadow-none before:hidden hover:bg-transparent data-pressed:bg-transparent",
        className,
      )}
      data-status={status}
      data-tool-call-line=""
      {...buttonProps}
    />
  );
}

function ToolCallLine({
  action,
  className,
  details,
  icon: Icon,
  linkable = false,
  onClick,
  status = "idle",
}: ToolCallLineProps) {
  const content = (
    <>
      {Icon ? <Icon className="size-3.5 shrink-0 text-honk-fg-tertiary" /> : null}
      <ToolCallLineAction loading={status === "loading"} status={status}>
        {action}
      </ToolCallLineAction>
      {details ? (
        <ToolCallLineDetails linkable={linkable} status={status}>
          {details}
        </ToolCallLineDetails>
      ) : null}
    </>
  );

  if (!onClick) {
    return (
      <div
        className={cn(
          toolCallLineVariants({ clickable: false, status }),
          className,
        )}
        data-status={status}
        data-tool-call-line=""
      >
        {content}
      </div>
    );
  }

  return (
    <ButtonPrimitive
      className={cn(toolCallLineVariants({ clickable: true, status }), className)}
      data-status={status}
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
  hoverTone = "default",
  linkable = false,
  loading = false,
  status = "idle",
  ...spanProps
}: ComponentPropsWithoutRef<"span"> & {
  hoverTone?: "default" | "static" | undefined;
  linkable?: boolean | undefined;
  loading?: boolean | undefined;
  status?: ToolCallLineStatus | undefined;
}) {
  return (
    <span
      {...spanProps}
      className={cn(toolCallLineDetailsVariants({ hoverTone, linkable, loading, status }), className)}
      data-tool-call-line-details=""
    >
      {children}
    </span>
  );
}

type ToolCallDisclosureLineBaseProps = {
  action: ReactNode;
  ariaLabel?: string | undefined;
  className?: string | undefined;
  details?: ReactNode;
  detailsHoverTone?: "default" | "static" | undefined;
  detailsLoading?: boolean | undefined;
  icon?: ToolCallIconComponent | undefined;
  status?: ToolCallLineStatus | undefined;
  trailing?: ReactNode;
};
type ToolCallDisclosureLineProps =
  | (ToolCallDisclosureLineBaseProps & {
      expanded: boolean;
      onToggleExpanded: () => void;
      onClick?: never;
    })
  | (ToolCallDisclosureLineBaseProps & {
      expanded?: never;
      onClick: () => void;
      onToggleExpanded?: never;
    })
  | (ToolCallDisclosureLineBaseProps & {
      expanded?: never;
      onClick?: never;
      onToggleExpanded?: never;
    });

function ToolCallDisclosureLine({
  action,
  ariaLabel,
  className,
  details,
  detailsHoverTone = "default",
  detailsLoading = false,
  expanded,
  icon: Icon,
  onClick,
  onToggleExpanded,
  status = "idle",
  trailing,
}: ToolCallDisclosureLineProps) {
  const content = (
    <>
      {Icon ? <Icon className="size-3.5 shrink-0 text-honk-fg-tertiary" /> : null}
      <ToolCallLineAction loading={status === "loading"} status={status}>
        {action}
      </ToolCallLineAction>
      {details ? (
        <ToolCallLineDetails
          hoverTone={detailsHoverTone}
          loading={detailsLoading}
          status={status}
        >
          {details}
        </ToolCallLineDetails>
      ) : null}
      {trailing}
      {onToggleExpanded ? <ToolCallLineChevron expanded={expanded} /> : null}
    </>
  );

  if (onToggleExpanded) {
    return (
      <ToolCallLineButtonRoot
        aria-label={ariaLabel}
        aria-expanded={expanded}
        className={className}
        onClick={onToggleExpanded}
        status={status}
      >
        {content}
      </ToolCallLineButtonRoot>
    );
  }

  if (onClick) {
    return (
      <ToolCallLineButtonRoot
        aria-label={ariaLabel}
        className={className}
        onClick={onClick}
        status={status}
      >
        {content}
      </ToolCallLineButtonRoot>
    );
  }

  return (
    <ToolCallLineRoot className={className} status={status}>
      {content}
    </ToolCallLineRoot>
  );
}

function ToolCallDisclosureBody({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      {...props}
      className={cn(
        "max-w-agent-chat font-mono text-conversation text-honk-fg-tertiary",
        className,
      )}
      data-tool-call-line-body=""
    >
      {children}
    </div>
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
          "size-3 shrink-0 text-honk-icon-tertiary transition-transform duration-(--motion-duration-collapsible) ease-out motion-reduce:transition-none",
          expanded && "rotate-90",
        )}
      />
    </span>
  );
}

function ToolCallMetadataDisclosure({
  icon: Icon,
  action,
  details,
  output,
  outputRenderer,
  metadataItems = EMPTY_TOOL_METADATA_ITEMS,
  loading = false,
  onFileClick,
  linkable = false,
  defaultExpanded = false,
  onExpandedChange,
}: {
  icon: ToolCallIconComponent | undefined;
  action: string;
  details: string;
  output: string | null;
  outputRenderer?: ((bodyText: string) => ReactNode) | undefined;
  metadataItems?: ReadonlyArray<string> | undefined;
  loading?: boolean | undefined;
  onFileClick?: (() => void) | undefined;
  linkable?: boolean | undefined;
  defaultExpanded?: boolean | undefined;
  onExpandedChange?: ((expanded: boolean) => void) | undefined;
}) {
  const hasOutput = output !== null && output !== undefined && output.length > 0;
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const showStreamingPreview = loading && hasOutput;
  const showBody = isExpanded || showStreamingPreview;
  const displayOutput = hasOutput ? resolveToolCallStreamingOutput(output ?? "", loading) : null;
  const bodyText = (() => {
    if (!showBody || !displayOutput) {
      return "";
    }
    return displayOutput.text.trim();
  })();

  const toggleExpanded = () => {
    setIsExpanded((current) => {
      const next = !current;
      onExpandedChange?.(next);
      return next;
    });
  };

  const detailsNode = details ? (
    <ToolCallLineDetails
      linkable={linkable}
      role={linkable ? "button" : undefined}
      tabIndex={linkable ? 0 : undefined}
      onClick={
        linkable && onFileClick
          ? (event) => {
              event.stopPropagation();
              onFileClick();
            }
          : undefined
      }
      onKeyDown={
        linkable && onFileClick
          ? (event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              event.stopPropagation();
              onFileClick();
            }
          : undefined
      }
    >
      {details}
    </ToolCallLineDetails>
  ) : null;

  const headerInner = (
    <>
      {Icon ? <Icon className="size-3.5 shrink-0 text-honk-fg-tertiary" /> : null}
      <ToolCallLineAction loading={loading}>{action}</ToolCallLineAction>
      {detailsNode}
    </>
  );

  const chevron = <ToolCallLineChevron expanded={isExpanded} />;

  return (
    <div className="m-0 min-w-0 max-w-full">
      <div className="group/metadata-tool flex w-full min-w-0 items-center gap-1">
        {linkable ? (
          <>
            <div
              className={cn(toolCallLineVariants({ clickable: false }), "w-auto max-w-full")}
              data-tool-call-line=""
            >
              {headerInner}
            </div>
            <ButtonPrimitive
              type="button"
              className={cn(
                "inline-flex size-4 shrink-0 cursor-pointer items-center justify-center",
                "border-0 bg-transparent p-0 text-honk-fg-tertiary",
                "opacity-0 transition-[color,opacity] duration-100",
                "hover:text-honk-fg-secondary hover:opacity-100",
                "focus-visible:text-honk-fg-secondary focus-visible:opacity-100",
                "aria-expanded:opacity-100 group-hover/metadata-tool:opacity-100",
              )}
              aria-label={isExpanded ? "Collapse tool output" : "Expand tool output"}
              aria-expanded={isExpanded}
              onClick={toggleExpanded}
            >
              {chevron}
            </ButtonPrimitive>
          </>
        ) : (
          <ButtonPrimitive
            type="button"
            className={cn(
              toolCallLineVariants({ clickable: true }),
              "h-auto py-0 shadow-none before:hidden hover:bg-transparent data-pressed:bg-transparent",
            )}
            data-tool-call-line=""
            aria-expanded={isExpanded}
            onClick={toggleExpanded}
          >
            {headerInner}
            {chevron}
          </ButtonPrimitive>
        )}
      </div>
      {showBody ? (
        <ToolCallDisclosureBody className="mt-1">
          {bodyText ? (
            <>
              {displayOutput?.truncated ? (
                <div className="pb-1 font-mono text-detail text-honk-fg-tertiary select-none">
                  Showing latest output while tool runs.
                </div>
              ) : null}
              <div
                className={cn(
                  showStreamingPreview && !isExpanded
                    ? "flex max-h-(--streaming-tool-output-preview-max-height) flex-col-reverse overflow-hidden"
                    : "max-h-[min(42vh,520px)] overflow-y-auto overscroll-contain",
                )}
                style={
                  showStreamingPreview && !isExpanded
                    ? ({
                        "--streaming-tool-output-preview-max-height": `${STREAMING_TOOL_OUTPUT_PREVIEW_MAX_HEIGHT_PX}px`,
                      } as CSSProperties)
                    : undefined
                }
              >
                {outputRenderer ? (
                  outputRenderer(bodyText)
                ) : (
                  <pre className="m-0 overflow-hidden whitespace-pre-wrap p-0 wrap-anywhere select-text">
                    {bodyText}
                  </pre>
                )}
              </div>
            </>
          ) : null}
          {isExpanded && metadataItems.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-detail text-honk-fg-tertiary">
              {metadataItems.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          ) : null}
        </ToolCallDisclosureBody>
      ) : null}
    </div>
  );
}

function resolveToolCallStreamingOutput(
  output: string,
  loading: boolean,
): { text: string; truncated: boolean } {
  if (!loading || output.length <= STREAMING_SHELL_OUTPUT_MAX_CHARS) {
    return { text: output, truncated: false };
  }

  const start = Math.max(0, output.length - STREAMING_SHELL_OUTPUT_MAX_CHARS);
  const newlineStart = output.indexOf("\n", start);
  const sliceStart = newlineStart === -1 ? start : newlineStart + 1;
  return { text: output.slice(sliceStart), truncated: true };
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
      className={cn(
        "group/task-tool-call min-w-0 max-w-full px-(--conversation-block-inset) text-conversation",
        className,
      )}
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
        "inline-flex min-h-6 w-fit max-w-full min-w-0 items-center gap-1 border-0 bg-transparent py-0 text-left font-[inherit] text-inherit outline-none select-none",
        interactiveControlCursorVariants(),
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
        "flex h-5 w-3.5 shrink-0 items-center justify-center text-honk-fg-secondary",
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
        "shrink-0 overflow-hidden text-ellipsis whitespace-nowrap leading-5 text-honk-fg-primary",
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
        "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap leading-5 text-honk-fg-tertiary",
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
        "size-3 shrink-0 text-honk-icon-tertiary opacity-0 transition-transform duration-(--motion-duration-collapsible) ease-out motion-reduce:transition-none",
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
      className={cn("min-w-0 max-w-full pt-1", className)}
      data-task-tool-call-body=""
      {...props}
    />
  );
}

function ToolCallTaskDisclosure({
  body,
  defaultExpanded = false,
  loading = false,
  onExpandedChange,
  status,
  statusIcon,
  subtitle,
  title,
}: {
  body: ReactNode;
  defaultExpanded?: boolean | undefined;
  loading?: boolean | undefined;
  onExpandedChange?: ((expanded: boolean) => void) | undefined;
  status: ToolCallExpandableStatus;
  statusIcon?: ReactNode;
  subtitle?: ReactNode;
  title: ReactNode;
}) {
  const hasBody = Boolean(body);
  const [isExpanded, setIsExpanded] = useState(defaultExpanded && hasBody);

  const toggleExpanded = () => {
    if (!hasBody) return;
    setIsExpanded((current) => {
      const next = !current;
      onExpandedChange?.(next);
      return next;
    });
  };

  return (
    <ToolCallTaskRoot expanded={isExpanded} status={status}>
      <ToolCallTaskHeader aria-expanded={isExpanded} onClick={toggleExpanded}>
        {statusIcon ? <ToolCallTaskStatusIcon>{statusIcon}</ToolCallTaskStatusIcon> : null}
        <ToolCallTaskTitleArea>
          <ToolCallTaskTitle loading={loading}>{title}</ToolCallTaskTitle>
          {subtitle ? <ToolCallTaskSubtitle>{subtitle}</ToolCallTaskSubtitle> : null}
        </ToolCallTaskTitleArea>
        <ToolCallTaskChevron expanded={isExpanded} />
      </ToolCallTaskHeader>
      {isExpanded ? <ToolCallTaskBody>{body}</ToolCallTaskBody> : null}
    </ToolCallTaskRoot>
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
      className={cn(
        "group/shell-tool-call min-w-0 max-w-full px-(--conversation-block-inset) text-conversation tracking-normal",
        className,
      )}
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
        "border-0 bg-transparent py-0 text-left text-conversation text-honk-fg-primary select-none",
        expandable ? interactiveControlCursorVariants() : "cursor-default",
        hasError && "text-honk-fg-red-primary",
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
        "mt-1 min-w-0 max-w-full overflow-hidden rounded-honk-xl border border-honk-stroke-tertiary bg-honk-bg-elevated",
        className,
      )}
      data-shell-tool-call-body=""
      {...props}
    />
  );
}

function ToolCallShellDisclosure({
  action,
  body,
  className,
  details,
  expandable,
  expanded,
  hasError = false,
  icon: Icon,
  loading = false,
  onToggleExpanded,
  status,
}: {
  action: ReactNode;
  body: ReactNode;
  className?: string | undefined;
  details?: ReactNode;
  expandable: boolean;
  expanded: boolean;
  hasError?: boolean | undefined;
  icon?: ToolCallIconComponent | undefined;
  loading?: boolean | undefined;
  onToggleExpanded: () => void;
  status: ToolCallExpandableStatus;
}) {
  return (
    <ToolCallShellRoot className={className} expanded={expanded} status={status}>
      <ToolCallShellHeader
        expandable={expandable}
        expanded={expanded}
        hasError={hasError}
        onClick={onToggleExpanded}
      >
        {Icon ? <Icon className="size-3.5 shrink-0 text-honk-fg-tertiary" /> : null}
        <span className="inline-flex min-w-0 max-w-full items-center gap-1 overflow-hidden text-ellipsis whitespace-nowrap">
          <ToolCallLineAction loading={loading}>{action}</ToolCallLineAction>
          {details ? <ToolCallLineDetails>{details}</ToolCallLineDetails> : null}
        </span>
        {expandable ? <ToolCallLineChevron expanded={expanded} /> : null}
      </ToolCallShellHeader>
      {body ? <ToolCallShellBody>{body}</ToolCallShellBody> : null}
    </ToolCallShellRoot>
  );
}

export {
  ToolCallDisclosureBody,
  ToolCallDisclosureLine,
  ToolCallLine,
  ToolCallMetadataDisclosure,
  ToolCallShellDisclosure,
  ToolCallTaskDisclosure,
};
