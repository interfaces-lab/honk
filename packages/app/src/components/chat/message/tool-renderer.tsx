import {
  IconCheckCircle2,
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
  IconWarningSign,
} from "central-icons";
import { cva } from "class-variance-authority";
import {
  memo,
  type ComponentPropsWithoutRef,
  type ComponentType,
  type ReactNode,
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
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
import { cn } from "~/lib/utils";
import { InlineToolDiff } from "./tool-inline-diff";

type CentralIconComponent = ComponentType<{ className?: string | undefined }>;

export type ToolCallConversationDensity = "minimal" | "verbose";

interface ShellToolExpansionState {
  readonly approvalStatus: ToolCallApproval["status"] | undefined;
  readonly isExpanded: boolean;
}

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
    "min-w-0",
    "text-detail text-multi-fg-tertiary",
  ),
  {
    variants: {
      active: {
        false: "",
        true: "tool-call-shimmer",
      },
      wrap: {
        false: "overflow-hidden text-ellipsis whitespace-nowrap",
        true: "whitespace-pre-wrap break-words wrap-anywhere",
      },
    },
    defaultVariants: {
      active: false,
      wrap: false,
    },
  },
);

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
    },
    defaultVariants: {
      loading: false,
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

export function ThinkingStatus({
  task,
  active,
  wrap = false,
}: {
  task: string;
  active: boolean;
  wrap?: boolean | undefined;
}) {
  return (
    <div className={cn("flex min-h-6 gap-1 py-0.5", wrap ? "items-start" : "items-center")}>
      <IconRobot className="size-3.5 shrink-0 text-multi-fg-tertiary" />
      <span className={thinkingStatusTaskVariants({ active, wrap })}>{task}</span>
    </div>
  );
}

export function ToolCallRenderer({
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
  const artifactLookup = useMemo(() => collectToolArtifacts(artifacts), [artifacts]);
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
          command={artifactLookup.command?.command ?? command ?? displayState.details}
          output={artifactLookup.command?.output ?? output ?? null}
          artifact={artifactLookup.command}
          loading={loading}
          hasError={hasError}
          approval={approval}
          callId={callId}
          defaultExpanded={defaultExpanded}
          onNestedToolExpand={onNestedToolExpand}
          showIcon={conversationDensity === "verbose"}
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
          diffArtifact={artifactLookup.diff}
          isDelete={toolCall.tool.case === "deleteToolCall"}
          defaultExpanded={defaultExpanded}
          onFileClick={onFileClick}
          onNestedToolExpand={onNestedToolExpand}
          callId={callId}
          showIcon={conversationDensity === "verbose"}
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
          showIcon={conversationDensity === "verbose"}
        />
      );
    case "webSearchToolCall":
    case "webFetchToolCall":
      return (
        <ToolCallLine
          icon={conversationDensity === "verbose" ? iconForToolCase(toolCall.tool.case) : undefined}
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
          icon={conversationDensity === "verbose" ? iconForToolCase(toolCall.tool.case) : undefined}
          action={displayState.action}
          details={displayState.details}
          output={
            artifactLookup.read?.output ??
            artifactLookup.search?.output ??
            artifactLookup.diagnostic?.message ??
            artifactLookup.raw?.text ??
            output ??
            null
          }
          metadataItems={getMetadataArtifactItems(
            artifactLookup.read,
            artifactLookup.search,
            artifactLookup.diagnostic,
            artifactLookup.raw,
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
}

interface ToolArtifactLookup {
  command: ToolCommandArtifact | undefined;
  diff: ToolDiffArtifact | undefined;
  read: ToolReadArtifact | undefined;
  search: ToolSearchArtifact | undefined;
  diagnostic: ToolDiagnosticArtifact | undefined;
  raw: ToolRawArtifact | undefined;
}

function collectToolArtifacts(
  artifacts: ReadonlyArray<ToolDisplayArtifact> | undefined,
): ToolArtifactLookup {
  const lookup: ToolArtifactLookup = {
    command: undefined,
    diff: undefined,
    read: undefined,
    search: undefined,
    diagnostic: undefined,
    raw: undefined,
  };

  for (const artifact of artifacts ?? []) {
    switch (artifact.type) {
      case "command":
        lookup.command ??= artifact;
        break;
      case "diff":
        if (!lookup.diff || (artifact.source === "result" && lookup.diff.source !== "result")) {
          lookup.diff = artifact;
        }
        break;
      case "read":
        lookup.read ??= artifact;
        break;
      case "search":
        lookup.search ??= artifact;
        break;
      case "diagnostic":
        lookup.diagnostic ??= artifact;
        break;
      case "raw":
        lookup.raw ??= artifact;
        break;
    }
  }

  return lookup;
}

function getCommandMetadataItemsFromValues(input: {
  exitCode: number | undefined;
  durationMs: number | undefined;
  truncated: boolean | undefined;
  fullOutputPath: string | undefined;
}): string[] {
  const items: string[] = [];
  if (input.exitCode !== undefined) {
    items.push(`exit ${input.exitCode}`);
  }
  if (input.durationMs !== undefined) {
    items.push(formatDuration(input.durationMs));
  }
  if (input.truncated === true) {
    items.push("truncated");
  }
  if (input.fullOutputPath) {
    items.push(`full output: ${input.fullOutputPath}`);
  }
  return items;
}

export function hasShellToolPotentialOutput(output: string | null | undefined): boolean {
  return output !== null && output !== undefined && output.length > 0;
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
  loading,
  hasError,
  subagentConversation,
  renderStep,
  toolCall,
  callId,
  defaultExpanded,
  onNestedToolExpand,
  showIcon,
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
  showIcon: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const hasBody = Boolean(subagentConversation) || Boolean(renderStep);

  if (!hasBody) {
    return (
      <ToolCallLine
        icon={showIcon ? IconRobot : undefined}
        action={action}
        details=""
        loading={loading}
      />
    );
  }

  const title = action;
  const toggleExpanded = () => {
    setIsExpanded((current) => {
      const next = !current;
      onNestedToolExpand?.(callId, next);
      return next;
    });
  };

  return (
    <div
      className="min-w-0 max-w-full text-conversation"
      data-task-tool-call=""
      data-status={hasError ? "error" : loading ? "running" : "completed"}
      data-expanded={isExpanded ? "true" : "false"}
    >
      <button
        type="button"
        aria-expanded={isExpanded}
        onClick={toggleExpanded}
        data-task-tool-call-header=""
      >
        <span data-task-tool-call-status-icon="">
          {loading ? (
            <IconClock className="tool-call-shimmer size-3.5" />
          ) : hasError ? (
            <IconWarningSign className="size-3.5 text-multi-fg-red-primary" />
          ) : (
            <IconCheckCircle2 className="size-3.5" />
          )}
        </span>
        <span data-task-tool-call-title-area="">
          <span
            data-task-tool-call-title=""
            className={cn(loading && "tool-call-shimmer")}
          >
            {title}
          </span>
        </span>
        <IconChevronRightMedium className="size-3" data-task-tool-call-chevron="" />
      </button>
      {isExpanded ? (
        <div className="min-w-0 max-w-full" data-task-tool-call-body="">
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

export function ToolCallLine({
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
      <span className={toolCallLineActionVariants({ loading })} data-tool-call-line-action="">
        {action}
      </span>
      {details ? <ToolCallLineDetails linkable={linkable}>{details}</ToolCallLineDetails> : null}
    </>
  );

  if (!onClick) {
    return (
      <div className={toolCallLineVariants({ clickable: false })} data-tool-call-line="">
        {content}
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className={toolCallLineVariants({ clickable: true })}
      data-tool-call-line=""
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
}

function ToolCallLineDetails({
  children,
  className,
  linkable = false,
  ...spanProps
}: ComponentPropsWithoutRef<"span"> & { linkable?: boolean | undefined }) {
  return (
    <span
      {...spanProps}
      className={cn(toolCallLineDetailsVariants({ linkable }), className)}
      data-tool-call-line-details=""
    >
      {children}
    </span>
  );
}

const EMPTY_TOOL_METADATA_ITEMS: readonly string[] = [];
const STREAMING_SHELL_OUTPUT_MAX_CHARS = 12_000;

export function ExpandableToolMetadataLine({
  icon: Icon,
  action,
  details,
  output,
  metadataItems = EMPTY_TOOL_METADATA_ITEMS,
  loading = false,
  onFileClick,
  linkable = false,
  defaultExpanded = false,
  callId,
  onNestedToolExpand,
}: {
  icon: CentralIconComponent | undefined;
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
  const hasOutput = output !== null && output !== undefined && output.length > 0;
  const hasBody = hasOutput || metadataItems.length > 0;
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const bodyText = useMemo(() => {
    if (!isExpanded || !hasOutput) {
      return "";
    }
    return resolveStreamingShellOutput(output ?? "", loading).text.trim();
  }, [hasOutput, isExpanded, loading, output]);

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
      {Icon ? <Icon className="size-3.5 shrink-0 text-multi-fg-tertiary" /> : null}
      <span className={toolCallLineActionVariants({ loading })} data-tool-call-line-action="">
        {action}
      </span>
      {detailsNode}
    </>
  );

  const chevron = (
    <span
      className="inline-flex size-3 shrink-0 items-center justify-center"
      data-tool-call-line-chevron=""
    >
      <IconChevronRightMedium
        className={cn(
          "size-3 shrink-0 text-multi-icon-tertiary transition-transform duration-150",
          isExpanded && "rotate-90",
        )}
      />
    </span>
  );

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
            className={toolCallLineVariants({ clickable: true })}
            data-tool-call-line=""
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
            "pl-[18px] font-mono text-conversation text-multi-fg-tertiary",
          )}
        >
          {bodyText ? (
            <pre className="m-0 overflow-hidden whitespace-pre-wrap p-0 wrap-anywhere select-text">
              {bodyText}
            </pre>
          ) : null}
          {metadataItems.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-detail text-multi-fg-tertiary">
              {metadataItems.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

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
  showIcon,
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
  showIcon: boolean;
}) {
  const currentApprovalStatus = approval?.status;
  const [expansionState, setExpansionState] = useState<ShellToolExpansionState>(() => ({
    approvalStatus: currentApprovalStatus,
    isExpanded: approval && approval.status !== "pending" ? false : defaultExpanded,
  }));
  const activeExpansionState =
    expansionState.approvalStatus === currentApprovalStatus
      ? expansionState
      : {
          approvalStatus: currentApprovalStatus,
          isExpanded:
            expansionState.approvalStatus === "pending" && currentApprovalStatus !== "pending"
              ? false
              : expansionState.isExpanded,
        };
  if (activeExpansionState !== expansionState) {
    setExpansionState(activeExpansionState);
  }
  const metadataItems = useMemo(
    () =>
      getCommandMetadataItemsFromValues({
        exitCode: artifact?.exitCode,
        durationMs: artifact?.durationMs,
        truncated: artifact?.truncated,
        fullOutputPath: artifact?.fullOutputPath,
      }),
    [artifact?.durationMs, artifact?.exitCode, artifact?.fullOutputPath, artifact?.truncated],
  );
  const commandText = command.trim();
  const bodyCommand = commandText && commandText !== details.trim() ? command : "";
  const hasPotentialOutput = hasShellToolPotentialOutput(output);
  const hasExpandedContent = hasPotentialOutput || metadataItems.length > 0;
  const hasContent = bodyCommand.length > 0 || hasExpandedContent;
  const expandable = hasContent;
  const isExpanded = expandable && activeExpansionState.isExpanded;

  const toggleExpanded = useCallback(() => {
    if (!expandable) return;
    setExpansionState((current) => {
      const next = !current.isExpanded;
      onNestedToolExpand?.(callId, next);
      return {
        approvalStatus: currentApprovalStatus,
        isExpanded: next,
      };
    });
  }, [callId, currentApprovalStatus, expandable, onNestedToolExpand]);

  return (
    <div
      className="group/shell-tool-call min-w-0 max-w-full px-0 text-conversation tracking-normal"
      data-shell-tool-call=""
      data-status={hasError ? "error" : loading ? "running" : "completed"}
      data-expanded={isExpanded ? "true" : "false"}
    >
      <ShellToolCallHeader
        action={action}
        details={details}
        expandable={expandable}
        hasError={hasError}
        isExpanded={isExpanded}
        loading={loading}
        onToggleExpanded={toggleExpanded}
        showIcon={showIcon}
      />
      {isExpanded && hasContent ? (
        <div
          className={cn(
            "mt-1 min-w-0 max-w-full overflow-hidden rounded-multi-control",
            "border border-multi-stroke-tertiary bg-multi-bg-elevated",
          )}
          data-shell-tool-call-body=""
        >
          <div className="min-w-0 max-w-full">
            {bodyCommand ? (
              <pre
                className={cn(
                  "m-0",
                  "px-(--conversation-tool-card-padding-x) py-1.5",
                  "font-mono text-conversation whitespace-pre-wrap",
                  hasError
                    ? "text-multi-fg-red-primary"
                    : "text-multi-fg-tertiary",
                  "wrap-anywhere select-text",
                )}
              >
                <span className="text-multi-fg-tertiary select-none">$ </span>
                <ShellCommandTokens command={bodyCommand} />
              </pre>
            ) : null}
            <ShellOutputBlock output={output} loading={loading} />
            {metadataItems.length > 0 ? (
              <div className="flex flex-wrap gap-x-2 gap-y-1 py-1 text-detail text-multi-fg-tertiary">
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

const ShellToolCallHeader = memo(function ShellToolCallHeader({
  action,
  details,
  expandable,
  hasError,
  isExpanded,
  loading,
  onToggleExpanded,
  showIcon,
}: {
  action: string;
  details: string;
  expandable: boolean;
  hasError: boolean;
  isExpanded: boolean;
  loading: boolean;
  onToggleExpanded: () => void;
  showIcon: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        "group/shell-trigger inline-flex min-h-6 w-fit max-w-full min-w-0 items-center gap-1 overflow-hidden",
        "border-0 bg-transparent p-0 text-left select-none",
        "text-conversation text-multi-fg-primary",
        expandable && "cursor-pointer",
        !expandable && "cursor-default",
        hasError && "text-multi-fg-red-primary",
      )}
      aria-expanded={expandable ? isExpanded : undefined}
      data-tool-call-line=""
      data-shell-tool-call-header=""
      disabled={!expandable}
      onClick={onToggleExpanded}
    >
      {showIcon ? <IconConsole className="size-3.5 shrink-0 text-multi-fg-tertiary" /> : null}
      <span
        className={cn(
          "inline-flex min-w-0 max-w-full items-center gap-1",
          "overflow-hidden text-ellipsis whitespace-nowrap",
        )}
      >
        <span className={toolCallLineActionVariants({ loading })} data-tool-call-line-action="">
          {action}
        </span>
        {details ? (
          <span
            className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-multi-fg-tertiary"
            data-tool-call-line-details=""
          >
            {details}
          </span>
        ) : null}
      </span>
      {expandable ? (
        <span
          className="inline-flex size-3 shrink-0 items-center justify-center"
          data-tool-call-line-chevron=""
        >
          <IconChevronRightMedium
            className={cn(
              "size-3 shrink-0 text-multi-icon-tertiary transition-transform duration-(--motion-duration-collapsible) ease-out",
              isExpanded && "rotate-90",
            )}
          />
        </span>
      ) : null}
    </button>
  );
});

const ShellOutputBlock = memo(function ShellOutputBlock({
  output,
  loading,
}: {
  output: string | null;
  loading: boolean;
}) {
  const outputText = output ?? "";
  const displayOutput = useMemo(
    () => resolveStreamingShellOutput(outputText, loading),
    [loading, outputText],
  );

  if (!hasRenderableText(displayOutput.text)) {
    return null;
  }

  return (
    <>
      {displayOutput.truncated ? (
        <div className="px-(--conversation-tool-card-padding-x) pb-1 font-mono text-detail text-multi-fg-tertiary select-none">
          Showing latest output while command runs.
        </div>
      ) : null}
      <pre
        className={cn(
          "m-0",
          "px-(--conversation-tool-card-padding-x) pb-1.5",
          "max-h-[min(42vh,520px)] overflow-y-auto overscroll-contain",
          "font-mono text-conversation whitespace-pre-wrap",
          "text-multi-fg-tertiary wrap-anywhere select-text",
        )}
        data-shell-tool-call-output=""
        data-output-truncated={displayOutput.truncated ? "true" : undefined}
      >
        {displayOutput.text}
      </pre>
    </>
  );
});

export function hasRenderableText(text: string | null | undefined): boolean {
  if (!text) {
    return false;
  }
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charCodeAt(index);
    if (
      char !== 9 &&
      char !== 10 &&
      char !== 11 &&
      char !== 12 &&
      char !== 13 &&
      char !== 32
    ) {
      return true;
    }
  }
  return false;
}

export function resolveStreamingShellOutput(
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
  showIcon,
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
  showIcon: boolean;
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
      <div className="group/edit-tool-call flex w-full min-w-0 items-center gap-1">
        {hasContent ? (
          <button
            type="button"
            className={toolCallLineVariants({ clickable: true })}
            aria-label={isExpanded ? "Collapse edit details" : "Expand edit details"}
            aria-expanded={isExpanded}
            onClick={toggleExpanded}
          >
            {showIcon ? (
              <IconFileEdit className="size-3.5 shrink-0 text-multi-fg-tertiary" />
            ) : null}
            <span className={toolCallLineActionVariants()}>{action}</span>
            <span className={editToolCallFilenameVariants({ loading, isDelete })}>{path}</span>
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
                {showIcon ? (
                  <IconFileEdit className="size-3.5 shrink-0 text-multi-fg-tertiary" />
                ) : null}
                <span className={toolCallLineActionVariants()}>{action}</span>
                <span className={editToolCallFilenameVariants({ loading, isDelete })}>{path}</span>
                <EditStats stats={stats} />
              </div>
            ) : (
              <div className={toolCallLineVariants({ clickable: false })}>
                {showIcon ? (
                  <IconFileEdit className="size-3.5 shrink-0 text-multi-fg-tertiary" />
                ) : null}
                <span className={toolCallLineActionVariants()}>{action}</span>
                <span className={editToolCallFilenameVariants({ loading, isDelete })}>{path}</span>
                <EditStats stats={stats} />
              </div>
            )}
          </>
        )}
      </div>
      {isExpanded && hasContent ? (
        <div
          className={cn(
            "mt-1 max-w-agent-chat",
            "overflow-hidden rounded-multi-control border border-multi-stroke-secondary",
            "font-mono text-conversation text-multi-fg-tertiary",
          )}
        >
          {diffArtifact ? (
            <InlineToolDiff artifact={diffArtifact} />
          ) : (
            <pre className="m-0 overflow-hidden whitespace-pre-wrap px-(--conversation-tool-card-padding-x) py-1.5">
              {detail}
            </pre>
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
  const nowMs = useNowMs(1000);
  const elapsedMs = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000) * 1000);
  const elapsed = formatDuration(elapsedMs);
  return details ? `${details} ${elapsed}` : elapsed;
}

function useNowMs(intervalMs: number): number {
  const store = useMemo(() => createNowMsStore(intervalMs), [intervalMs]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

function createNowMsStore(intervalMs: number) {
  let nowMs = Date.now();
  let intervalId: ReturnType<typeof setInterval> | null = null;
  const listeners = new Set<() => void>();

  const tick = () => {
    nowMs = Date.now();
    for (const listener of listeners) {
      listener();
    }
  };

  return {
    getSnapshot: () => nowMs,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      intervalId ??= setInterval(tick, intervalMs);

      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && intervalId !== null) {
          clearInterval(intervalId);
          intervalId = null;
        }
      };
    },
  };
}

function ShellCommandTokens({ command }: { command: string }) {
  const tokens = useMemo(() => tokenizeShellCommand(command), [command]);
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
      loading: "Searching",
      completed: "Searched",
      error: "Search",
    },
    shellToolCall: { loading: "Running", completed: "Ran", error: "Command" },
    editToolCall: { loading: "Editing", completed: "Edited", error: "Edit" },
    deleteToolCall: { loading: "Deleting", completed: "Deleted", error: "Delete" },
    mcpToolCall: { loading: "Running", completed: "Ran", error: "Run" },
    dynamicToolCall: { loading: "Running", completed: "Ran", error: "Run" },
    taskToolCall: {
      loading: "Subagent",
      completed: "Subagent",
      error: "Subagent",
    },
    webSearchToolCall: { loading: "Searching", completed: "Searched", error: "Search" },
    webFetchToolCall: { loading: "Fetching", completed: "Fetched", error: "Fetch" },
    imageViewToolCall: { loading: "Viewing", completed: "Viewed", error: "View" },
    unknownToolCall: { loading: "Running", completed: "Ran", error: "Run" },
  };
