import {
  IconChevronRightMedium,
  IconClock,
  IconCodeBrackets,
  IconCloudDownload,
  IconConsole,
  IconEyeOpen,
  IconFileEdit,
  IconMagnifyingGlass,
  IconRobot,
  IconToolbox,
} from "central-icons";
import { cva } from "class-variance-authority";
import { memo, type ComponentType, type ReactNode, useEffect, useRef, useState } from "react";
import {
  formatDuration,
  type ToolCommandArtifact,
  type ToolDiagnosticArtifact,
  type ToolDiffArtifact,
  type ToolRawArtifact,
  type ToolReadArtifact,
  type ToolSearchArtifact,
  type ToolDisplayArtifact,
} from "../../../session-logic";
import { PretextOneLine } from "~/components/pretext-one-line";
import { cn } from "~/lib/utils";
import { InlineToolDiff } from "./tool-inline-diff";

type CentralIconComponent = ComponentType<{ className?: string | undefined }>;

export type ToolCallConversationDensity = "minimal" | "verbose";

export type ToolCase =
  | "awaitToolCall"
  | "readToolCall"
  | "grepToolCall"
  | "globToolCall"
  | "shellToolCall"
  | "editToolCall"
  | "deleteToolCall"
  | "mcpToolCall"
  | "dynamicToolCall"
  | "taskToolCall"
  | "webSearchToolCall"
  | "webFetchToolCall"
  | "imageViewToolCall"
  | "unknownToolCall";

export interface ToolCallModel {
  tool: {
    case: ToolCase;
    value: {
      action: string;
      details?: string | null;
      command?: string | null;
      output?: string | null;
      path?: string | null;
      stats?: {
        additions?: number | undefined;
        deletions?: number | undefined;
      };
      artifacts?: ReadonlyArray<ToolDisplayArtifact>;
    };
  };
}

export interface ToolCallApproval {
  status: "pending" | "approved" | "rejected";
  label?: string | undefined;
}

export interface ToolCallRendererProps {
  toolCall: ToolCallModel;
  callId?: string | undefined;
  loading?: boolean | undefined;
  startedAtMs?: number | undefined;
  hasError?: boolean | undefined;
  approval?: ToolCallApproval | undefined;
  subagentConversation?: ReactNode;
  renderStep?:
    | ((step: unknown, index: number, parentCallId: string | undefined) => ReactNode)
    | undefined;
  onFileClick?: ((path: string) => void) | undefined;
  onUrlClick?: ((url: string) => void) | undefined;
  onNestedToolExpand?: ((callId: string | undefined, expanded: boolean) => void) | undefined;
  defaultExpanded?: boolean | undefined;
  conversationDensity?: ToolCallConversationDensity | undefined;
}

const thinkingStatusTaskVariants = cva(
  cn(
    "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap",
    "text-detail text-multi-fg-tertiary",
  ),
  {
    variants: {
      active: {
        false: "",
        true: "tool-call-shimmer",
      },
    },
    defaultVariants: {
      active: false,
    },
  },
);

const toolCallLineVariants = cva(
  cn(
    "group/tool-call-line flex min-h-6 min-w-0 items-center gap-1 overflow-hidden",
    "border-0 bg-transparent text-left select-none",
    "text-conversation",
    "text-ellipsis whitespace-nowrap text-multi-fg-primary",
  ),
  {
    variants: {
      clickable: {
        false: "",
        true: "cursor-pointer",
      },
    },
    defaultVariants: {
      clickable: false,
    },
  },
);

const toolCallLineActionVariants = cva(
  cn(
    "shrink-0 font-normal text-multi-fg-secondary",
    "transition-colors duration-100",
    "group-hover/tool-call-line:text-multi-fg-primary",
  ),
  {
    variants: {
      loading: {
        false: "",
        true: "tool-call-shimmer",
      },
    },
    defaultVariants: {
      loading: false,
    },
  },
);

const toolCallLineDetailsVariants = cva(
  cn(
    "overflow-hidden text-ellipsis text-multi-fg-tertiary tabular-nums",
    "transition-colors duration-100",
    "group-hover/tool-call-line:text-multi-fg-secondary",
  ),
  {
    variants: {
      linkable: {
        false: "",
        true: cn(
          "cursor-pointer underline",
          "decoration-[color-mix(in_srgb,var(--multi-fg-tertiary)_45%,transparent)]",
          "hover:text-multi-fg-secondary",
          "hover:decoration-[color-mix(in_srgb,var(--multi-fg-secondary)_55%,transparent)]",
          "focus-visible:text-multi-fg-secondary",
          "focus-visible:decoration-[color-mix(in_srgb,var(--multi-fg-secondary)_55%,transparent)]",
        ),
      },
    },
    defaultVariants: {
      linkable: false,
    },
  },
);

const editToolCallFilenameVariants = cva(
  cn(
    "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-multi-fg-tertiary",
    "transition-colors duration-100",
    "group-hover/tool-call-line:text-multi-fg-secondary",
  ),
  {
    variants: {
      loading: {
        false: "",
        true: "tool-call-shimmer",
      },
      isDelete: {
        false: "",
        true: "group-hover/tool-call-line:text-multi-fg-tertiary",
      },
    },
    defaultVariants: {
      loading: false,
      isDelete: false,
    },
  },
);

export const ThinkingStatus = memo(function ThinkingStatus({
  task,
  active,
}: {
  task: string;
  active: boolean;
}) {
  return (
    <div className="flex min-h-6 items-center gap-1 py-0.5">
      <IconRobot className="size-3.5 shrink-0 text-multi-fg-tertiary" />
      <span className={thinkingStatusTaskVariants({ active })}>{task}</span>
    </div>
  );
});

export const ToolCallRenderer = memo(function ToolCallRenderer({
  toolCall,
  callId,
  loading = false,
  startedAtMs,
  hasError = false,
  approval,
  subagentConversation,
  renderStep,
  onFileClick,
  onUrlClick,
  onNestedToolExpand,
  defaultExpanded = false,
  conversationDensity = "minimal",
}: ToolCallRendererProps) {
  const { action, details, command, output, path, stats, artifacts } = toolCall.tool.value;
  const commandArtifact = artifacts?.find((artifact) => artifact.type === "command");
  const diffArtifact =
    artifacts?.find(
      (artifact): artifact is ToolDiffArtifact =>
        artifact.type === "diff" && artifact.source === "result",
    ) ?? artifacts?.find((artifact): artifact is ToolDiffArtifact => artifact.type === "diff");
  const readArtifact = artifacts?.find((artifact) => artifact.type === "read");
  const searchArtifact = artifacts?.find((artifact) => artifact.type === "search");
  const diagnosticArtifact = artifacts?.find((artifact) => artifact.type === "diagnostic");
  const rawArtifact = artifacts?.find((artifact) => artifact.type === "raw");
  const displayState = {
    action: resolveActionLabel(toolCall.tool.case, action, loading, hasError),
    details: details ?? "",
  };

  switch (toolCall.tool.case) {
    case "awaitToolCall":
      return (
        <ToolCallLine
          action={displayState.action}
          details={
            loading && startedAtMs ? (
              <AwaitDetails details={displayState.details} startedAtMs={startedAtMs} />
            ) : (
              displayState.details
            )
          }
          loading={loading}
        />
      );
    case "shellToolCall":
      return (
        <ShellToolCall
          action={displayState.action}
          details={displayState.details}
          command={commandArtifact?.command ?? command ?? displayState.details}
          output={commandArtifact?.output ?? output ?? null}
          artifact={commandArtifact}
          loading={loading}
          hasError={hasError}
          approval={approval}
          callId={callId}
          defaultExpanded={defaultExpanded}
          onNestedToolExpand={onNestedToolExpand}
        />
      );
    case "editToolCall":
    case "deleteToolCall":
      return (
        <EditToolCall
          action={displayState.action}
          path={(path ?? displayState.details) || "file"}
          stats={stats}
          loading={loading}
          detail={output ?? details ?? null}
          diffArtifact={diffArtifact}
          isDelete={toolCall.tool.case === "deleteToolCall"}
          defaultExpanded={defaultExpanded}
          onFileClick={onFileClick}
          onNestedToolExpand={onNestedToolExpand}
          callId={callId}
          conversationDensity={conversationDensity}
        />
      );
    case "taskToolCall":
      return (
        <TaskToolCall
          action={displayState.action}
          details={displayState.details}
          loading={loading}
          hasError={hasError}
          subagentConversation={subagentConversation}
          renderStep={renderStep}
          toolCall={toolCall}
          callId={callId}
          defaultExpanded={defaultExpanded}
          onNestedToolExpand={onNestedToolExpand}
        />
      );
    case "webSearchToolCall":
    case "webFetchToolCall":
      return (
        <ToolCallLine
          icon={iconForToolCase(toolCall.tool.case)}
          action={displayState.action}
          details={displayState.details}
          loading={loading}
          onClick={
            displayState.details.startsWith("http") && onUrlClick
              ? () => onUrlClick?.(displayState.details)
              : undefined
          }
        />
      );
    case "readToolCall":
    case "grepToolCall":
    case "globToolCall":
    case "mcpToolCall":
    case "dynamicToolCall":
    case "imageViewToolCall":
    case "unknownToolCall":
      return (
        <ExpandableToolMetadataLine
          icon={iconForToolCase(toolCall.tool.case)}
          action={displayState.action}
          details={displayState.details}
          output={
            readArtifact?.output ??
            searchArtifact?.output ??
            diagnosticArtifact?.message ??
            rawArtifact?.text ??
            output ??
            null
          }
          metadataItems={getMetadataArtifactItems(
            readArtifact,
            searchArtifact,
            diagnosticArtifact,
            rawArtifact,
          )}
          loading={loading}
          onFileClick={path && onFileClick ? () => onFileClick(path) : undefined}
          linkable={Boolean(path && onFileClick)}
          defaultExpanded={defaultExpanded}
          callId={callId}
          onNestedToolExpand={onNestedToolExpand}
        />
      );
  }
});

function getCommandMetadataItems(artifact: ToolCommandArtifact | undefined): string[] {
  if (!artifact) {
    return [];
  }
  const items: string[] = [];
  if (artifact.exitCode !== undefined) {
    items.push(`exit ${artifact.exitCode}`);
  }
  if (artifact.durationMs !== undefined) {
    items.push(formatDuration(artifact.durationMs));
  }
  if (artifact.truncated === true) {
    items.push("truncated");
  }
  if (artifact.fullOutputPath) {
    items.push(`full output: ${artifact.fullOutputPath}`);
  }
  return items;
}

function getMetadataArtifactItems(
  readArtifact: ToolReadArtifact | undefined,
  searchArtifact: ToolSearchArtifact | undefined,
  diagnosticArtifact: ToolDiagnosticArtifact | undefined,
  rawArtifact: ToolRawArtifact | undefined,
): string[] {
  const items: string[] = [];
  if (readArtifact?.truncated === true || searchArtifact?.truncated === true) {
    items.push("truncated");
  }
  const matchedCount = searchArtifact?.matchedFiles?.length ?? 0;
  if (matchedCount > 0) {
    items.push(`${matchedCount} ${matchedCount === 1 ? "match" : "matches"}`);
  }
  if (diagnosticArtifact) {
    items.push(diagnosticArtifact.severity);
  }
  if (rawArtifact) {
    items.push("raw");
  }
  return items;
}

function TaskToolCall({
  action,
  details,
  loading,
  hasError,
  subagentConversation,
  renderStep,
  toolCall,
  callId,
  defaultExpanded,
  onNestedToolExpand,
}: {
  action: string;
  details: string;
  loading: boolean;
  hasError: boolean;
  subagentConversation: ReactNode;
  renderStep:
    | ((step: unknown, index: number, parentCallId: string | undefined) => ReactNode)
    | undefined;
  toolCall: ToolCallModel;
  callId: string | undefined;
  defaultExpanded: boolean;
  onNestedToolExpand: ((callId: string | undefined, expanded: boolean) => void) | undefined;
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const hasBody = Boolean(subagentConversation) || Boolean(renderStep);
  const statusIcon = (
    <span className="inline-flex shrink-0 items-center justify-center text-multi-icon-tertiary">
      {loading ? (
        <IconClock className="tool-call-shimmer size-3.5" />
      ) : hasError ? (
        <IconToolbox className="size-3.5 text-multi-fg-red-primary" />
      ) : (
        <IconRobot className="size-3.5" />
      )}
    </span>
  );
  const titleArea = (
    <span className="inline-flex min-w-0 items-baseline gap-1">
      <span
        className={cn(
          "min-w-0 text-body font-medium text-multi-fg-secondary",
          loading && "tool-call-shimmer",
        )}
      >
        {action}
      </span>
      {details ? (
        <PretextOneLine
          text={details}
          title={details}
          truncate="middle"
          className="min-w-0 text-body text-multi-fg-tertiary"
        />
      ) : null}
    </span>
  );
  const toggleExpanded = () => {
    if (!hasBody) return;
    setIsExpanded((current) => {
      const next = !current;
      onNestedToolExpand?.(callId, next);
      return next;
    });
  };

  return (
    <div
      className="ui-task-tool-call min-w-0 max-w-full text-multi-fg-secondary"
      data-status={hasError ? "error" : loading ? "running" : "completed"}
    >
      {hasBody ? (
        <button
          type="button"
          className="ui-task-tool-call__header flex min-h-6 w-fit max-w-full min-w-0 cursor-pointer items-center gap-1"
          aria-expanded={isExpanded}
          onClick={toggleExpanded}
        >
          {statusIcon}
          {titleArea}
          <IconChevronRightMedium
            className={cn(
              "size-3 shrink-0 text-multi-icon-tertiary transition-transform duration-150",
              isExpanded && "rotate-90",
            )}
          />
        </button>
      ) : (
        <div className="ui-task-tool-call__header flex min-h-6 w-fit max-w-full min-w-0 items-center gap-1">
          {statusIcon}
          {titleArea}
        </div>
      )}
      {isExpanded && hasBody ? (
        <div className="ui-task-tool-call__body mt-1 min-w-0 max-w-full">
          {subagentConversation}
          {renderStep?.(toolCall, 0, callId)}
        </div>
      ) : null}
    </div>
  );
}

interface ToolCallLineProps {
  action: string;
  details: ReactNode;
  loading?: boolean | undefined;
  icon?: CentralIconComponent | undefined;
  onClick?: (() => void) | undefined;
  linkable?: boolean | undefined;
}

const ToolCallLine = memo(function ToolCallLine({
  action,
  details,
  loading = false,
  icon: Icon,
  onClick,
  linkable = false,
}: ToolCallLineProps) {
  const content = (
    <>
      {Icon ? <Icon className="size-3.5 shrink-0 text-multi-fg-tertiary" /> : null}
      <span className={toolCallLineActionVariants({ loading })}>{action}</span>
      {details ? (
        typeof details === "string" ? (
          <PretextOneLine
            text={details}
            title={details}
            truncate="middle"
            className={toolCallLineDetailsVariants({ linkable })}
          />
        ) : (
          <span className={toolCallLineDetailsVariants({ linkable })}>{details}</span>
        )
      ) : null}
    </>
  );

  if (!onClick) {
    return <div className={toolCallLineVariants({ clickable: false })}>{content}</div>;
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className={toolCallLineVariants({ clickable: true })}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onClick();
      }}
    >
      {content}
    </div>
  );
});

const ExpandableToolMetadataLine = memo(function ExpandableToolMetadataLine({
  icon: Icon,
  action,
  details,
  output,
  metadataItems = [],
  loading = false,
  onFileClick,
  linkable = false,
  defaultExpanded = false,
  callId,
  onNestedToolExpand,
}: {
  icon: CentralIconComponent;
  action: string;
  details: string;
  output: string | null;
  metadataItems?: ReadonlyArray<string> | undefined;
  loading?: boolean | undefined;
  onFileClick?: (() => void) | undefined;
  linkable?: boolean | undefined;
  defaultExpanded?: boolean | undefined;
  callId?: string | undefined;
  onNestedToolExpand?: ((callId: string | undefined, expanded: boolean) => void) | undefined;
}) {
  const bodyText = output?.trim() ?? "";
  const hasBody = bodyText.length > 0 || metadataItems.length > 0;
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const toggleExpanded = () => {
    if (!hasBody) return;
    setIsExpanded((current) => {
      const next = !current;
      onNestedToolExpand?.(callId, next);
      return next;
    });
  };

  if (!hasBody) {
    return (
      <ToolCallLine
        icon={Icon}
        action={action}
        details={details}
        loading={loading}
        onClick={onFileClick}
        linkable={linkable}
      />
    );
  }

  const detailsNode = details ? (
    <PretextOneLine
      text={details}
      title={details}
      truncate="middle"
      className={toolCallLineDetailsVariants({ linkable })}
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
    />
  ) : null;

  const headerInner = (
    <>
      <Icon className="size-3.5 shrink-0 text-multi-fg-tertiary" />
      <span className={toolCallLineActionVariants({ loading })}>{action}</span>
      {detailsNode}
    </>
  );

  const chevron = (
    <IconChevronRightMedium
      className={cn(
        "size-3 shrink-0 text-multi-icon-tertiary transition-transform duration-150",
        isExpanded && "rotate-90",
      )}
    />
  );

  return (
    <div className="m-0 min-w-0 max-w-full">
      <div className="group/metadata-tool flex min-w-0 items-center gap-1">
        {linkable ? (
          <>
            <div className={toolCallLineVariants({ clickable: false })}>{headerInner}</div>
            <button
              type="button"
              className={cn(
                "inline-flex size-4 shrink-0 cursor-pointer items-center justify-center",
                "border-0 bg-transparent p-0 text-multi-fg-tertiary",
                "opacity-0 transition-[color,opacity] duration-100",
                "hover:text-multi-fg-secondary hover:opacity-100",
                "focus-visible:text-multi-fg-secondary focus-visible:opacity-100",
                "aria-expanded:opacity-100 group-hover/metadata-tool:opacity-100",
              )}
              aria-label={isExpanded ? "Collapse tool output" : "Expand tool output"}
              aria-expanded={isExpanded}
              onClick={toggleExpanded}
            >
              {chevron}
            </button>
          </>
        ) : (
          <button
            type="button"
            className={cn(toolCallLineVariants({ clickable: true }), "w-fit max-w-full min-w-0")}
            aria-expanded={isExpanded}
            onClick={toggleExpanded}
          >
            {headerInner}
            {chevron}
          </button>
        )}
      </div>
      {isExpanded ? (
        <div
          className={cn(
            "mt-1 max-w-agent-chat",
            "overflow-hidden rounded-multi-control border border-multi-stroke-secondary bg-multi-editor",
            "px-(--conversation-tool-card-padding-x) py-1.5",
            "font-mono text-body text-multi-fg-tertiary",
          )}
        >
          {bodyText ? (
            <pre className="m-0 overflow-hidden whitespace-pre-wrap p-0 wrap-anywhere select-text">
              {bodyText}
            </pre>
          ) : null}
          {metadataItems.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 border-t border-multi-stroke-tertiary pt-1 text-detail text-multi-fg-tertiary">
              {metadataItems.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

function ShellToolCall({
  action,
  details,
  command,
  output,
  artifact,
  loading,
  hasError,
  approval,
  callId,
  defaultExpanded,
  onNestedToolExpand,
}: {
  action: string;
  details: string;
  command: string;
  output: string | null;
  artifact: ToolCommandArtifact | undefined;
  loading: boolean;
  hasError: boolean;
  approval: ToolCallApproval | undefined;
  callId: string | undefined;
  defaultExpanded: boolean;
  onNestedToolExpand: ((callId: string | undefined, expanded: boolean) => void) | undefined;
}) {
  const [isExpanded, setIsExpanded] = useState(
    approval && approval.status !== "pending" ? false : defaultExpanded,
  );
  const previousApprovalStatusRef = useRef<ToolCallApproval["status"] | undefined>(
    approval?.status,
  );
  const metadataItems = getCommandMetadataItems(artifact);
  const hasContent = command.length > 0 || Boolean(output) || metadataItems.length > 0;
  const isPending = approval?.status === "pending";
  const expandable = hasContent;

  useEffect(() => {
    const previousStatus = previousApprovalStatusRef.current;
    previousApprovalStatusRef.current = approval?.status;

    if (previousStatus === "pending" && approval?.status !== "pending") {
      setIsExpanded(false);
      onNestedToolExpand?.(callId, false);
    }
  }, [approval?.status, callId, onNestedToolExpand]);

  const toggleExpanded = () => {
    if (!expandable) return;
    setIsExpanded((current) => {
      const next = !current;
      onNestedToolExpand?.(callId, next);
      return next;
    });
  };

  return (
    <div className="group/shell-tool-call min-w-0 max-w-full px-0 text-conversation tracking-normal">
      <button
        type="button"
        className={cn(
          "group/shell-trigger flex min-h-6 w-fit max-w-full min-w-0 items-center gap-1 overflow-hidden",
          "border-0 bg-transparent p-0 text-left select-none",
          "text-conversation text-multi-fg-primary",
          expandable && "cursor-pointer",
          !expandable && "cursor-default",
          hasError && "text-multi-fg-red-primary",
        )}
        aria-expanded={expandable ? isExpanded : undefined}
        disabled={!expandable}
        onClick={toggleExpanded}
      >
        <IconConsole className="size-3.5 shrink-0 text-multi-fg-tertiary" />
        <span
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1",
            "overflow-hidden text-ellipsis whitespace-nowrap",
          )}
        >
          <span
            className={cn(
              "overflow-hidden text-ellipsis text-multi-fg-secondary",
              loading && "tool-call-shimmer",
            )}
          >
            {action}
          </span>
          {details ? (
            <PretextOneLine
              text={details}
              title={details}
              truncate="middle"
              className="min-w-0 flex-1 text-multi-fg-tertiary"
            />
          ) : null}
        </span>
        {expandable ? (
          <IconChevronRightMedium
            className={cn(
              "size-3 shrink-0 text-multi-icon-tertiary transition-transform duration-150",
              isExpanded && "rotate-90",
            )}
          />
        ) : null}
      </button>
      {isExpanded && hasContent ? (
        <div className="mt-1 min-w-0 max-w-full">
          <div
            className={cn(
              "relative overflow-hidden rounded-multi-control border bg-multi-editor",
              "border-multi-stroke-secondary",
              isPending && "border-multi-stroke-primary",
              hasError && "border-multi-fg-red-primary",
            )}
          >
            {command ? (
              <pre
                className={cn(
                  "m-0 bg-multi-editor",
                  "px-(--conversation-tool-card-padding-x)",
                  "py-1.5",
                  "font-mono text-body whitespace-pre-wrap",
                  "text-multi-fg-tertiary wrap-anywhere select-text",
                )}
              >
                <span className="text-multi-fg-tertiary select-none">$ </span>
                <ShellCommandTokens command={command} />
              </pre>
            ) : null}
            {output ? (
              <pre
                className={cn(
                  "m-0 bg-multi-editor",
                  "px-(--conversation-tool-card-padding-x)",
                  "pb-1.5",
                  "font-mono text-body whitespace-pre-wrap",
                  "text-multi-fg-tertiary wrap-anywhere select-text",
                )}
              >
                {output}
              </pre>
            ) : null}
            {metadataItems.length > 0 ? (
              <div className="flex flex-wrap gap-x-2 gap-y-1 border-t border-multi-stroke-tertiary px-(--conversation-tool-card-padding-x) py-1 text-detail text-multi-fg-tertiary">
                {metadataItems.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function EditToolCall({
  action,
  path,
  stats,
  loading,
  detail,
  diffArtifact,
  isDelete,
  defaultExpanded,
  onFileClick,
  onNestedToolExpand,
  callId,
}: {
  action: string;
  path: string;
  stats: ToolCallModel["tool"]["value"]["stats"] | undefined;
  loading: boolean;
  detail: string | null;
  diffArtifact: ToolDiffArtifact | undefined;
  isDelete: boolean;
  defaultExpanded: boolean;
  onFileClick: ((path: string) => void) | undefined;
  onNestedToolExpand: ((callId: string | undefined, expanded: boolean) => void) | undefined;
  callId: string | undefined;
  conversationDensity: ToolCallConversationDensity;
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const hasContent = Boolean(detail) || Boolean(diffArtifact);

  const toggleExpanded = () => {
    if (!hasContent) return;
    setIsExpanded((current) => {
      const next = !current;
      onNestedToolExpand?.(callId, next);
      return next;
    });
  };

  return (
    <div className="m-0">
      <div className="group/edit-tool-call flex min-w-0 items-center gap-1">
        {hasContent ? (
          <button
            type="button"
            className={cn(toolCallLineVariants({ clickable: true }), "w-fit max-w-full min-w-0")}
            aria-label={isExpanded ? "Collapse edit details" : "Expand edit details"}
            aria-expanded={isExpanded}
            onClick={toggleExpanded}
          >
            <IconFileEdit className="size-3.5 shrink-0 text-multi-fg-tertiary" />
            <span className={toolCallLineActionVariants()}>{action}</span>
            <PretextOneLine
              text={path}
              title={path}
              truncate="middle"
              className={editToolCallFilenameVariants({ loading, isDelete })}
            />
            <EditStats stats={stats} />
            <IconChevronRightMedium
              className={cn(
                "size-3 shrink-0 text-multi-icon-tertiary transition-transform duration-150",
                isExpanded && "rotate-90",
              )}
            />
          </button>
        ) : (
          <>
            {onFileClick ? (
              <div
                className={toolCallLineVariants({ clickable: true })}
                role="button"
                tabIndex={0}
                onClick={() => onFileClick(path)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  onFileClick(path);
                }}
              >
                <IconFileEdit className="size-3.5 shrink-0 text-multi-fg-tertiary" />
                <span className={toolCallLineActionVariants()}>{action}</span>
                <PretextOneLine
                  text={path}
                  title={path}
                  truncate="middle"
                  className={editToolCallFilenameVariants({ loading, isDelete })}
                />
              </div>
            ) : (
              <div className={toolCallLineVariants({ clickable: false })}>
                <IconFileEdit className="size-3.5 shrink-0 text-multi-fg-tertiary" />
                <span className={toolCallLineActionVariants()}>{action}</span>
                <PretextOneLine
                  text={path}
                  title={path}
                  truncate="middle"
                  className={editToolCallFilenameVariants({ loading, isDelete })}
                />
              </div>
            )}
            <EditStats stats={stats} />
          </>
        )}
      </div>
      {isExpanded && hasContent ? (
        <div
          className={cn(
            "mt-1 max-w-agent-chat",
            "overflow-hidden rounded-multi-control",
            "border border-multi-stroke-secondary bg-multi-editor",
            "px-(--conversation-tool-card-padding-x) py-1.5",
            "font-mono text-body text-multi-fg-tertiary",
          )}
        >
          {diffArtifact ? (
            <InlineToolDiff artifact={diffArtifact} />
          ) : (
            <pre className="m-0 overflow-hidden whitespace-pre-wrap p-0">{detail}</pre>
          )}
        </div>
      ) : null}
    </div>
  );
}

function EditStats({ stats }: { stats: ToolCallModel["tool"]["value"]["stats"] | undefined }) {
  const additions = stats?.additions ?? 0;
  const deletions = stats?.deletions ?? 0;
  if (additions === 0 && deletions === 0) return null;

  return (
    <span className="ml-1 inline-flex shrink-0 gap-1 tabular-nums">
      {additions > 0 ? <span className="text-multi-diff-addition">+{additions}</span> : null}
      {deletions > 0 ? <span className="text-multi-diff-deletion">-{deletions}</span> : null}
    </span>
  );
}

function AwaitDetails({ details, startedAtMs }: { details: string; startedAtMs: number }) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  const elapsedMs = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000) * 1000);
  const elapsed = formatDuration(elapsedMs);
  return details ? `${details} ${elapsed}` : elapsed;
}

function ShellCommandTokens({ command }: { command: string }) {
  const tokens = tokenizeShellCommand(command);
  return (
    <>
      {tokens.map((token) => (
        <span key={token.start} style={{ color: shellCommandTokenColor(token.kind) }}>
          {token.value}
        </span>
      ))}
    </>
  );
}

function shellCommandTokenColor(
  kind: "whitespace" | "command" | "flag" | "string" | "operator" | "variable" | "text",
): string {
  if (kind === "command") return "var(--multi-fg-primary)";
  if (kind === "flag") return "var(--multi-fg-active)";
  if (kind === "string") return "var(--multi-fg-green-primary)";
  if (kind === "operator") return "var(--multi-fg-secondary)";
  if (kind === "variable") return "var(--multi-fg-green-primary)";
  if (kind === "text") return "var(--multi-fg-secondary)";
  return "inherit";
}

function tokenizeShellCommand(command: string): Array<{
  value: string;
  kind: "whitespace" | "command" | "flag" | "string" | "operator" | "variable" | "text";
  start: number;
}> {
  const result: Array<{
    value: string;
    kind: "whitespace" | "command" | "flag" | "string" | "operator" | "variable" | "text";
    start: number;
  }> = [];
  const regex =
    /"(?:[^"\\]|\\.)*"|'[^']*'|\$\{[^}]+\}|\$\w+|&&|\|\||>>|[|;><]|--?\w[\w-]*|\s+|\S+/g;
  let commandSeen = false;

  for (const match of command.matchAll(regex)) {
    const value = match[0];
    const start = match.index;
    if (/^\s+$/.test(value)) {
      result.push({ value, kind: "whitespace", start });
      continue;
    }
    if (/^(?:&&|\|\||>>|[|;><])$/.test(value)) {
      result.push({ value, kind: "operator", start });
      if (value !== ">") commandSeen = false;
      continue;
    }
    if (/^\$\{?[\w}]+$/.test(value)) {
      result.push({ value, kind: "variable", start });
      continue;
    }
    if (/^(['"]).*\1$/.test(value)) {
      result.push({ value, kind: "string", start });
      continue;
    }
    if (/^--?\w[\w-]*$/.test(value) && commandSeen) {
      result.push({ value, kind: "flag", start });
      continue;
    }
    if (!commandSeen) {
      result.push({ value, kind: "command", start });
      commandSeen = true;
      continue;
    }
    result.push({ value, kind: "text", start });
  }

  return result;
}

function resolveActionLabel(
  toolCase: ToolCase,
  fallback: string,
  loading: boolean,
  hasError: boolean,
) {
  const labels = TOOL_ACTION_LABELS[toolCase];
  if (!labels) return fallback;
  if (loading) return labels.loading;
  if (hasError) return labels.error;
  return labels.completed;
}

function iconForToolCase(toolCase: ToolCase): CentralIconComponent {
  switch (toolCase) {
    case "readToolCall":
    case "imageViewToolCall":
      return IconEyeOpen;
    case "grepToolCall":
    case "globToolCall":
    case "webSearchToolCall":
      return IconMagnifyingGlass;
    case "webFetchToolCall":
      return IconCloudDownload;
    case "awaitToolCall":
      return IconClock;
    case "editToolCall":
    case "deleteToolCall":
      return IconFileEdit;
    case "shellToolCall":
      return IconConsole;
    case "dynamicToolCall":
      return IconCodeBrackets;
    case "mcpToolCall":
    case "taskToolCall":
    case "unknownToolCall":
      return IconToolbox;
  }
}

const TOOL_ACTION_LABELS: Record<ToolCase, { loading: string; completed: string; error: string }> =
  {
    awaitToolCall: { loading: "Waiting", completed: "Waited", error: "Wait" },
    readToolCall: { loading: "Reading", completed: "Read", error: "Read" },
    grepToolCall: { loading: "Grepping", completed: "Grepped", error: "Grep" },
    globToolCall: {
      loading: "Searching files",
      completed: "Searched files",
      error: "Search files",
    },
    shellToolCall: { loading: "Command", completed: "Command", error: "Command" },
    editToolCall: { loading: "Editing", completed: "Edited", error: "Edit" },
    deleteToolCall: { loading: "Deleting", completed: "Deleted", error: "Delete" },
    mcpToolCall: { loading: "Running MCP", completed: "Ran MCP", error: "Run MCP" },
    dynamicToolCall: { loading: "Running tool", completed: "Ran tool", error: "Run tool" },
    taskToolCall: { loading: "Task", completed: "Task", error: "Task" },
    webSearchToolCall: { loading: "Searching web", completed: "Searched web", error: "Search web" },
    webFetchToolCall: { loading: "Fetching", completed: "Fetched", error: "Fetch" },
    imageViewToolCall: { loading: "Viewing image", completed: "Viewed image", error: "View image" },
    unknownToolCall: { loading: "Running tool", completed: "Ran tool", error: "Run tool" },
  };
