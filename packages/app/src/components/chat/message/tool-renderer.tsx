import {
  IconCheckCircle2,
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
  type ComponentType,
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { ConversationDensity } from "@honk/contracts/settings";
import { shouldUseCompactEdits, shouldUseCompactShells } from "@honk/shared/conversation-density";
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
import { Badge } from "@honk/multikit/badge";
import {
  ToolCallLine,
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
  toolCallLineActionVariants,
  toolCallLineVariants,
} from "@honk/multikit/tool-call";
import { Button } from "@honk/multikit/button";
import {
  parseFindOutput,
  parseGrepOutput,
  type ParsedFindFile,
  type ParsedGrepFile,
  type ParsedSearchOutput,
} from "./search-output";

type CentralIconComponent = ComponentType<{ className?: string | undefined }>;

export type ToolCallConversationDensity = ConversationDensity;

export function resolveEffectiveToolCallDensity(
  density: ConversationDensity,
  approval: ToolCallApproval | undefined,
): ConversationDensity {
  if (approval?.status === "pending") {
    return "detailed";
  }
  return density;
}

/** Runtime edit tools often emit agent status text in `output`, not diff bodies. */
export function isEditStatusSummary(detail: string): boolean {
  const trimmed = detail.trim();
  if (/^Successfully replaced \d+ block\(s\) in /i.test(trimmed)) {
    return true;
  }
  if (/^Successfully (?:applied|wrote|created|deleted|updated)/i.test(trimmed)) {
    return true;
  }
  return false;
}

function hasEditExpandableContent(
  detail: string | null,
  path: string,
  diffArtifact: ToolDiffArtifact | undefined,
): boolean {
  if (diffArtifact) {
    return true;
  }
  if (!detail || detail === path) {
    return false;
  }
  return !isEditStatusSummary(detail);
}

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
  onFileClick?: ((path: string) => void) | undefined;
  onUrlClick?: ((url: string) => void) | undefined;
  onNestedToolExpand?: ((callId: string | undefined, expanded: boolean) => void) | undefined;
  defaultExpanded?: boolean | undefined;
  defaultEditExpanded?: boolean | undefined;
  conversationDensity?: ConversationDensity | undefined;
}

const thinkingStatusTaskVariants = cva(cn("min-w-0", "text-conversation text-honk-fg-tertiary"), {
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
});

const editToolCallFilenameVariants = cva(
  cn(
    "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-honk-fg-tertiary",
    "transition-colors duration-100",
    "group-hover/tool-call-line:text-honk-fg-secondary",
  ),
  {
    variants: {
      loading: {
        false: "",
        true: "tool-call-shimmer",
      },
      isDelete: {
        false: "",
        true: "group-hover/tool-call-line:text-honk-fg-tertiary",
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
      <IconRobot className="size-3.5 shrink-0 text-honk-fg-tertiary" />
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
  onFileClick,
  onUrlClick,
  onNestedToolExpand,
  defaultExpanded = false,
  defaultEditExpanded,
  conversationDensity = "compact-all-grouped",
}: ToolCallRendererProps) {
  const { action, details, command, output, path, stats, artifacts } = toolCall.tool.value;
  const artifactLookup = useMemo(() => collectToolArtifacts(artifacts), [artifacts]);
  const effectiveDensity = resolveEffectiveToolCallDensity(conversationDensity, approval);
  const compactShells = shouldUseCompactShells(effectiveDensity);
  const compactEdits = shouldUseCompactEdits(effectiveDensity);
  const showDetailedIcons = effectiveDensity === "detailed";
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
    case "shellToolCall": {
      const shellCommand = artifactLookup.command?.command ?? command ?? "";
      if (compactShells) {
        // Cursor parity (kRm compact): collapsed line, accordion to full output on expand.
        return (
          <ExpandableToolMetadataLine
            icon={showDetailedIcons ? IconConsole : undefined}
            action={displayState.action}
            details={shellCommand}
            output={artifactLookup.command?.output ?? output ?? null}
            metadataItems={getCommandMetadataItemsFromValues({
              exitCode: artifactLookup.command?.exitCode,
              durationMs: artifactLookup.command?.durationMs,
              truncated: artifactLookup.command?.truncated,
              fullOutputPath: artifactLookup.command?.fullOutputPath,
            })}
            loading={loading}
            defaultExpanded={defaultExpanded}
            callId={callId}
            onNestedToolExpand={onNestedToolExpand}
          />
        );
      }
      return (
        <ShellToolCall
          action={displayState.action}
          details={shellCommand}
          command={shellCommand}
          output={artifactLookup.command?.output ?? output ?? null}
          artifact={artifactLookup.command}
          loading={loading}
          hasError={hasError}
          approval={approval}
          callId={callId}
          defaultExpanded={defaultExpanded}
          onNestedToolExpand={onNestedToolExpand}
          showIcon={showDetailedIcons}
          showCollapsedPreview
        />
      );
    }
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
          defaultExpanded={defaultEditExpanded ?? defaultExpanded}
          onFileClick={onFileClick}
          onNestedToolExpand={onNestedToolExpand}
          callId={callId}
          showIcon={showDetailedIcons}
          compactLayout={compactEdits}
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
          callId={callId}
          defaultExpanded={defaultExpanded}
          onNestedToolExpand={onNestedToolExpand}
          showIcon={showDetailedIcons}
        />
      );
    case "webSearchToolCall":
    case "webFetchToolCall":
      return (
        <ToolCallLine
          icon={showDetailedIcons ? iconForToolCase(toolCall.tool.case) : undefined}
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
    case "mcpToolCall":
    case "dynamicToolCall":
    case "imageViewToolCall":
    case "unknownToolCall":
      return (
        <ExpandableToolMetadataLine
          icon={showDetailedIcons ? iconForToolCase(toolCall.tool.case) : undefined}
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
    case "grepToolCall":
    case "globToolCall":
      return (
        <SearchToolCall
          action={displayState.action}
          details={displayState.details}
          mode={
            artifactLookup.search?.flavor ??
            (toolCall.tool.case === "grepToolCall" ? "grep" : "find")
          }
          output={artifactLookup.search?.output ?? output ?? null}
          artifact={artifactLookup.search}
          loading={loading}
          defaultExpanded={defaultExpanded}
          callId={callId}
          onNestedToolExpand={onNestedToolExpand}
          showIcon={showDetailedIcons}
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
  details,
  loading,
  hasError,
  subagentConversation,
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
  callId: string | undefined;
  defaultExpanded: boolean;
  onNestedToolExpand: ((callId: string | undefined, expanded: boolean) => void) | undefined;
  showIcon: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const hasBody = Boolean(subagentConversation);
  const subtitle = details.trim();

  useEffect(() => {
    if (!defaultExpanded || !hasBody) {
      return;
    }
    setIsExpanded(true);
  }, [defaultExpanded, hasBody]);

  if (!hasBody) {
    return (
      <ToolCallLine
        icon={showIcon ? IconRobot : undefined}
        action={action}
        details={details}
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
    <ToolCallTaskRoot
      expanded={isExpanded}
      status={hasError ? "error" : loading ? "running" : "completed"}
    >
      <ToolCallTaskHeader aria-expanded={isExpanded} onClick={toggleExpanded}>
        <ToolCallTaskStatusIcon>
          {loading ? (
            <IconClock className="tool-call-shimmer size-3.5" />
          ) : hasError ? (
            <IconWarningSign className="size-3.5 text-honk-fg-red-primary" />
          ) : (
            <IconCheckCircle2 className="size-3.5" />
          )}
        </ToolCallTaskStatusIcon>
        <ToolCallTaskTitleArea>
          <ToolCallTaskTitle loading={loading}>{title}</ToolCallTaskTitle>
          {subtitle ? <ToolCallTaskSubtitle>{subtitle}</ToolCallTaskSubtitle> : null}
        </ToolCallTaskTitleArea>
        <ToolCallTaskChevron expanded={isExpanded} />
      </ToolCallTaskHeader>
      {isExpanded ? <ToolCallTaskBody>{subagentConversation}</ToolCallTaskBody> : null}
    </ToolCallTaskRoot>
  );
}

const EMPTY_TOOL_METADATA_ITEMS: readonly string[] = [];
const STREAMING_SHELL_OUTPUT_MAX_CHARS = 12_000;
const STREAMING_TOOL_OUTPUT_PREVIEW_MAX_HEIGHT_PX = 90;

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
  const showStreamingPreview = loading && hasOutput;
  const showBody = isExpanded || showStreamingPreview;
  const displayOutput = useMemo(
    () => (hasOutput ? resolveStreamingShellOutput(output ?? "", loading) : null),
    [hasOutput, loading, output],
  );
  const bodyText = useMemo(() => {
    if (!showBody || !displayOutput) {
      return "";
    }
    return displayOutput.text.trim();
  }, [displayOutput, showBody]);

  useEffect(() => {
    if (!defaultExpanded || !hasBody) {
      return;
    }
    setIsExpanded(true);
  }, [defaultExpanded, hasBody]);

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
      {Icon ? <Icon className="size-3.5 shrink-0 text-honk-fg-tertiary" /> : null}
      <span className={toolCallLineActionVariants({ loading })} data-tool-call-line-action="">
        {action}
      </span>
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
            <Button
              type="button"
              variant="ghost"
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
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="ghost"
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
          </Button>
        )}
      </div>
      {showBody ? (
        <div
          className="mt-1 max-w-agent-chat font-mono text-conversation text-honk-fg-tertiary"
          data-tool-call-line-body=""
        >
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
                <pre className="m-0 overflow-hidden whitespace-pre-wrap p-0 wrap-anywhere select-text">
                  {bodyText}
                </pre>
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
        </div>
      ) : null}
    </div>
  );
}

function SearchToolCall({
  action,
  details,
  mode,
  output,
  artifact,
  loading,
  defaultExpanded,
  callId,
  onNestedToolExpand,
  showIcon,
}: {
  action: string;
  details: string;
  mode: "grep" | "find";
  output: string | null;
  artifact: ToolSearchArtifact | undefined;
  loading: boolean;
  defaultExpanded: boolean;
  callId: string | undefined;
  onNestedToolExpand: ((callId: string | undefined, expanded: boolean) => void) | undefined;
  showIcon: boolean;
}) {
  const outputText = output ?? "";
  const parsedOutput = useMemo(
    () => (mode === "grep" ? parseGrepOutput(outputText) : parseFindOutput(outputText)),
    [mode, outputText],
  );
  const hasBody = outputText.trim().length > 0;
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  useEffect(() => {
    if (!defaultExpanded || !hasBody) {
      return;
    }
    setIsExpanded(true);
  }, [defaultExpanded, hasBody]);

  const toggleExpanded = () => {
    if (!hasBody) return;
    setIsExpanded((current) => {
      const next = !current;
      onNestedToolExpand?.(callId, next);
      return next;
    });
  };

  const badgeText = formatSearchBadge(mode, artifact, parsedOutput);
  const headerInner = (
    <>
      {showIcon ? (
        <IconMagnifyingGlass className="size-3.5 shrink-0 text-honk-fg-tertiary" />
      ) : null}
      <span className={toolCallLineActionVariants({ loading })} data-tool-call-line-action="">
        {action}
      </span>
      {details ? <ToolCallLineDetails>{details}</ToolCallLineDetails> : null}
      {badgeText ? (
        <Badge
          variant="outline"
          size="sm"
          className="ml-1 h-4 shrink-0 border-honk-stroke-secondary bg-transparent px-1 font-mono text-caption text-honk-fg-tertiary tabular-nums"
        >
          {badgeText}
        </Badge>
      ) : null}
    </>
  );

  if (!hasBody) {
    return (
      <ToolCallLine
        icon={showIcon ? IconMagnifyingGlass : undefined}
        action={action}
        details={details}
        loading={loading}
      />
    );
  }

  return (
    <div className="m-0 min-w-0 max-w-full" data-search-tool-call="" data-search-tool-flavor={mode}>
      <Button
        type="button"
        variant="ghost"
        className={cn(
          toolCallLineVariants({ clickable: true }),
          "h-auto py-0 shadow-none before:hidden hover:bg-transparent data-pressed:bg-transparent",
        )}
        data-tool-call-line=""
        aria-expanded={isExpanded}
        onClick={toggleExpanded}
      >
        {headerInner}
        <ToolCallLineChevron expanded={isExpanded} />
      </Button>
      {isExpanded ? (
        <div className="mt-1 max-w-agent-chat" data-tool-call-line-body="">
          <div className="max-h-[min(42vh,520px)] overflow-y-auto font-mono text-conversation text-honk-fg-tertiary">
            <SearchOutputBody parsedOutput={parsedOutput} fallbackText={outputText} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SearchOutputBody({
  parsedOutput,
  fallbackText,
}: {
  parsedOutput: ParsedSearchOutput;
  fallbackText: string;
}) {
  switch (parsedOutput.kind) {
    case "grep":
      return <GrepOutputBody files={parsedOutput.files} />;
    case "find":
      return <FindOutputBody files={parsedOutput.files} />;
    case "fallback":
      return (
        <pre className="m-0 whitespace-pre-wrap p-0 wrap-anywhere select-text">
          {parsedOutput.text.trim() || fallbackText.trim()}
        </pre>
      );
  }
}

function GrepOutputBody({ files }: { files: ReadonlyArray<ParsedGrepFile> }) {
  return (
    <div className="min-w-0 divide-y divide-honk-stroke-secondary/60">
      {files.map((file) => (
        <div key={file.path} className="min-w-0 py-1.5 first:pt-0 last:pb-0">
          <div className="flex min-w-0 items-center gap-1.5 text-honk-fg-secondary">
            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
              {file.path}
            </span>
            {file.annotation ? (
              <Badge
                variant="outline"
                size="sm"
                className="h-4 shrink-0 border-honk-stroke-secondary bg-transparent px-1 text-caption text-honk-fg-tertiary"
              >
                {file.annotation}
              </Badge>
            ) : null}
          </div>
          <div className="mt-1 min-w-0">
            {file.lines.map((line) => (
              <div
                key={`${file.path}:${line.lineNumber}:${line.separator}:${line.text}`}
                className="grid min-w-0 grid-cols-[3.5rem_minmax(0,1fr)] gap-2"
              >
                <span className="text-right text-honk-fg-quaternary tabular-nums select-none">
                  {line.lineNumber}
                  {line.separator}
                </span>
                <span className="min-w-0 whitespace-pre-wrap break-words text-honk-fg-tertiary wrap-anywhere select-text">
                  {line.text}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function FindOutputBody({ files }: { files: ReadonlyArray<ParsedFindFile> }) {
  return (
    <div className="min-w-0 py-0.5">
      {files.map((file) => (
        <div
          key={`${file.path}:${file.annotation ?? ""}`}
          className="flex min-w-0 items-center gap-1.5 py-0.5"
        >
          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-honk-fg-tertiary select-text">
            {file.path}
          </span>
          {file.annotation ? (
            <Badge
              variant="outline"
              size="sm"
              className="h-4 shrink-0 border-honk-stroke-secondary bg-transparent px-1 text-caption text-honk-fg-tertiary"
            >
              {file.annotation}
            </Badge>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function formatSearchBadge(
  mode: "grep" | "find",
  artifact: ToolSearchArtifact | undefined,
  parsedOutput: ParsedSearchOutput,
): string | null {
  if (!artifact) {
    return null;
  }
  if (mode === "grep") {
    const matched = artifact.totalMatched;
    const matchedFiles =
      parsedOutput.kind === "grep" ? parsedOutput.files.length : artifact.matchedFiles?.length;
    if (matched === undefined && matchedFiles === undefined) {
      return null;
    }
    const matchedText =
      matched === undefined ? "matches" : `${matched} ${matched === 1 ? "match" : "matches"}`;
    if (matchedFiles === undefined) {
      return matchedText;
    }
    const filesText = `${matchedFiles} ${matchedFiles === 1 ? "file" : "files"}`;
    return `${matchedText} in ${filesText}`;
  }

  const total = artifact.totalMatched;
  if (total === undefined) {
    return null;
  }
  const shown = parsedOutput.kind === "find" ? parsedOutput.files.length : undefined;
  const prefix = shown !== undefined && shown < total ? `${shown} of ` : "";
  const suffix = artifact.hasMore === true ? " + more" : "";
  return `${prefix}${total} ${total === 1 ? "file" : "files"}${suffix}`;
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
  showCollapsedPreview = false,
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
  showCollapsedPreview?: boolean | undefined;
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
  const showStreamingPreview = loading && hasPotentialOutput;
  const isExpanded = expandable && activeExpansionState.isExpanded;
  const showCollapsedOutputPreview =
    showCollapsedPreview && hasPotentialOutput && !isExpanded && !loading;
  const showBody = (isExpanded && hasContent) || showStreamingPreview || showCollapsedOutputPreview;

  useEffect(() => {
    if (!defaultExpanded || !expandable) {
      return;
    }
    setExpansionState((current) => ({
      approvalStatus: currentApprovalStatus,
      isExpanded: true,
    }));
  }, [currentApprovalStatus, defaultExpanded, expandable]);

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
    <ToolCallShellRoot
      expanded={isExpanded}
      status={hasError ? "error" : loading ? "running" : "completed"}
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
      {showBody ? (
        <ToolCallShellBody>
          <div className="min-w-0 max-w-full">
            {isExpanded && bodyCommand ? (
              <pre
                className={cn(
                  "m-0",
                  "px-(--conversation-tool-card-padding-x) py-1.5",
                  "font-mono text-conversation whitespace-pre-wrap",
                  hasError ? "text-honk-fg-red-primary" : "text-honk-fg-tertiary",
                  "wrap-anywhere select-text",
                )}
              >
                <span className="text-honk-fg-tertiary select-none">$ </span>
                <ShellCommandTokens command={bodyCommand} />
              </pre>
            ) : null}
            <ShellOutputBlock
              output={output}
              loading={loading}
              preview={showStreamingPreview && !isExpanded ? true : showCollapsedOutputPreview}
            />
            {isExpanded && metadataItems.length > 0 ? (
              <div className="flex flex-wrap gap-x-2 gap-y-1 py-1 text-detail text-honk-fg-tertiary">
                {metadataItems.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            ) : null}
          </div>
        </ToolCallShellBody>
      ) : null}
    </ToolCallShellRoot>
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
    <ToolCallShellHeader
      expandable={expandable}
      expanded={isExpanded}
      hasError={hasError}
      onClick={onToggleExpanded}
    >
      {showIcon ? <IconConsole className="size-3.5 shrink-0 text-honk-fg-tertiary" /> : null}
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
            className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-honk-fg-tertiary"
            data-tool-call-line-details=""
          >
            {details}
          </span>
        ) : null}
      </span>
      {expandable ? <ToolCallLineChevron expanded={isExpanded} /> : null}
    </ToolCallShellHeader>
  );
});

const ShellOutputBlock = memo(function ShellOutputBlock({
  output,
  loading,
  preview = false,
}: {
  output: string | null;
  loading: boolean;
  preview?: boolean | undefined;
}) {
  const outputText = output ?? "";
  const displayOutput = useMemo(
    () => resolveStreamingShellOutput(outputText, loading),
    [loading, outputText],
  );

  if (!hasRenderableText(displayOutput.text)) {
    return null;
  }

  const useStreamingPreview = loading && preview;
  const useCollapsedPreview = !loading && preview;

  return (
    <>
      {displayOutput.truncated ? (
        <div className="px-(--conversation-tool-card-padding-x) pb-1 font-mono text-detail text-honk-fg-tertiary select-none">
          Showing latest output while command runs.
        </div>
      ) : null}
      <div
        className={cn(
          useStreamingPreview || useCollapsedPreview
            ? "flex max-h-(--streaming-tool-output-preview-max-height) flex-col-reverse overflow-hidden"
            : "max-h-[min(42vh,520px)] overflow-y-auto overscroll-contain",
        )}
        style={
          useStreamingPreview || useCollapsedPreview
            ? ({
                "--streaming-tool-output-preview-max-height": `${STREAMING_TOOL_OUTPUT_PREVIEW_MAX_HEIGHT_PX}px`,
              } as CSSProperties)
            : undefined
        }
      >
        <pre
          className={cn(
            "m-0",
            "px-(--conversation-tool-card-padding-x) pb-1.5",
            "font-mono text-conversation whitespace-pre-wrap",
            "text-honk-fg-tertiary wrap-anywhere select-text",
          )}
          data-shell-tool-call-output=""
          data-output-truncated={displayOutput.truncated ? "true" : undefined}
          data-shell-tool-call-output-preview={
            useStreamingPreview || useCollapsedPreview ? "true" : undefined
          }
        >
          {displayOutput.text}
        </pre>
      </div>
    </>
  );
});

export function hasRenderableText(text: string | null | undefined): boolean {
  if (!text) {
    return false;
  }
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charCodeAt(index);
    if (char !== 9 && char !== 10 && char !== 11 && char !== 12 && char !== 13 && char !== 32) {
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
  compactLayout,
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
  compactLayout: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const hasContent = hasEditExpandableContent(detail, path, diffArtifact);
  const showCollapsedPreview = !compactLayout && hasContent && !isExpanded;

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
          <Button
            type="button"
            variant="ghost"
            className={cn(
              toolCallLineVariants({ clickable: true }),
              "h-auto py-0 shadow-none before:hidden hover:bg-transparent data-pressed:bg-transparent",
            )}
            data-tool-call-line=""
            aria-label={isExpanded ? "Collapse edit details" : "Expand edit details"}
            aria-expanded={isExpanded}
            onClick={toggleExpanded}
          >
            {showIcon ? (
              <IconFileEdit className="size-3.5 shrink-0 text-honk-fg-tertiary" />
            ) : null}
            <span className={toolCallLineActionVariants()}>{action}</span>
            <span className={editToolCallFilenameVariants({ loading, isDelete })}>{path}</span>
            <EditStats stats={stats} />
            <ToolCallLineChevron expanded={isExpanded} />
          </Button>
        ) : (
          <>
            {onFileClick ? (
              <Button
                type="button"
                variant="ghost"
                className={cn(
                  toolCallLineVariants({ clickable: true }),
                  "h-auto py-0 shadow-none before:hidden hover:bg-transparent data-pressed:bg-transparent",
                )}
                data-tool-call-line=""
                onClick={() => onFileClick(path)}
              >
                {showIcon ? (
                  <IconFileEdit className="size-3.5 shrink-0 text-honk-fg-tertiary" />
                ) : null}
                <span className={toolCallLineActionVariants()}>{action}</span>
                <span className={editToolCallFilenameVariants({ loading, isDelete })}>{path}</span>
                <EditStats stats={stats} />
              </Button>
            ) : (
              <div className={toolCallLineVariants({ clickable: false })} data-tool-call-line="">
                {showIcon ? (
                  <IconFileEdit className="size-3.5 shrink-0 text-honk-fg-tertiary" />
                ) : null}
                <span className={toolCallLineActionVariants()}>{action}</span>
                <span className={editToolCallFilenameVariants({ loading, isDelete })}>{path}</span>
                <EditStats stats={stats} />
              </div>
            )}
          </>
        )}
      </div>
      {(isExpanded && hasContent) || showCollapsedPreview ? (
        <div className="px-(--conversation-block-inset)">
          <div
            className={cn(
              "mt-1 max-w-agent-chat",
              "overflow-hidden rounded-honk-control border border-honk-stroke-secondary",
              "font-mono text-conversation text-honk-fg-tertiary",
              showCollapsedPreview && "max-h-[var(--streaming-tool-output-preview-max-height)]",
            )}
            style={
              showCollapsedPreview
                ? ({
                    "--streaming-tool-output-preview-max-height": `${STREAMING_TOOL_OUTPUT_PREVIEW_MAX_HEIGHT_PX}px`,
                  } as CSSProperties)
                : undefined
            }
          >
            {diffArtifact ? (
              <InlineToolDiff artifact={diffArtifact} />
            ) : (
              <pre className="m-0 overflow-hidden whitespace-pre-wrap px-(--conversation-tool-card-padding-x) py-1.5">
                {detail}
              </pre>
            )}
          </div>
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
      {additions > 0 ? <span className="text-honk-diff-addition">+{additions}</span> : null}
      {deletions > 0 ? <span className="text-honk-diff-deletion">-{deletions}</span> : null}
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
  if (kind === "command") return "var(--honk-fg-primary)";
  if (kind === "flag") return "var(--honk-fg-active)";
  if (kind === "string") return "var(--honk-fg-green-primary)";
  if (kind === "operator") return "var(--honk-fg-secondary)";
  if (kind === "variable") return "var(--honk-fg-green-primary)";
  if (kind === "text") return "var(--honk-fg-secondary)";
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
    mcpToolCall: { loading: "Running MCP", completed: "Ran MCP", error: "MCP" },
    dynamicToolCall: { loading: "Running", completed: "Ran", error: "Run" },
    taskToolCall: {
      loading: "Task",
      completed: "Task",
      error: "Task",
    },
    webSearchToolCall: { loading: "Searching", completed: "Searched", error: "Search" },
    webFetchToolCall: { loading: "Fetching", completed: "Fetched", error: "Fetch" },
    imageViewToolCall: { loading: "Viewing", completed: "Viewed", error: "View" },
    unknownToolCall: { loading: "Running", completed: "Ran", error: "Run" },
  };
