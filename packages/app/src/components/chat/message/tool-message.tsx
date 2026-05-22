import { type EnvironmentId, type ThreadId } from "@multi/contracts";
import { IconChevronRightMedium, IconClock, IconRobot } from "central-icons";
import { memo, useEffect, type KeyboardEvent, type MouseEvent } from "react";
import {
  type ToolDiffArtifact,
  type ToolDisplayArtifact,
  type WorkLogEntry,
  type WorkLogSubagent,
} from "../../../session-logic";
import { formatProjectRelativePath } from "../shared/file-path-display";
import { formatContextWindowTokens } from "~/lib/context-window";
import { ThinkingStatus, ToolCallRenderer, type ToolCallModel } from "./tool-renderer";
import { cn } from "~/lib/utils";
import {
  subagentPreviewKey,
  useSubagentPreviewStore,
} from "../../../stores/subagent-preview-store";

type ToolCallStatus = "loading" | "completed" | "error";

interface ToolCallMessageProps {
  workEntry: WorkLogEntry;
  projectRoot: string | undefined;
  activeThreadId: ThreadId;
  environmentId: EnvironmentId;
  subagentDetailsEnabled?: boolean | undefined;
}

export const ToolCallMessage = memo(function ToolCallMessage({
  workEntry,
  projectRoot,
  activeThreadId,
  environmentId,
  subagentDetailsEnabled = true,
}: ToolCallMessageProps) {
  const status = resolveStatus(workEntry);
  const isLoading = status === "loading";
  const subagents = workEntry.subagents ?? [];

  if (workEntry.tone === "thinking" && !isToolLikeWorkEntry(workEntry)) {
    return <ThinkingStatus task={resolveThinkingTask(workEntry, isLoading)} active={isLoading} />;
  }

  const toolCall = toToolCall(workEntry, projectRoot);
  const hasSubagents = subagents.length > 0;
  const subagentStatusSurface = hasSubagents ? (
    <SubagentStatusSurface
      activeThreadId={activeThreadId}
      environmentId={environmentId}
      projectRoot={projectRoot}
      subagentDetailsEnabled={subagentDetailsEnabled}
      subagents={subagents}
    />
  ) : null;
  const renderSubagentsInToolBody = hasSubagents && toolCall.tool.case === "taskToolCall";

  return (
    <div className="w-full min-w-0 max-w-full">
      <ToolCallRenderer
        toolCall={toolCall}
        callId={workEntry.toolCallId ?? workEntry.id}
        loading={isLoading}
        startedAtMs={Date.parse(workEntry.createdAt)}
        hasError={status === "error"}
        subagentConversation={renderSubagentsInToolBody ? subagentStatusSurface : undefined}
        defaultExpanded={renderSubagentsInToolBody}
        conversationDensity="minimal"
      />
      {hasSubagents && !renderSubagentsInToolBody ? subagentStatusSurface : null}
    </div>
  );
});

function SubagentStatusSurface({
  activeThreadId,
  environmentId,
  projectRoot,
  subagentDetailsEnabled,
  subagents,
}: {
  activeThreadId: ThreadId;
  environmentId: EnvironmentId;
  projectRoot: string | undefined;
  subagentDetailsEnabled: boolean;
  subagents: ReadonlyArray<WorkLogSubagent>;
}) {
  const openPreviewKey = useSubagentPreviewStore((state) => state.preview?.key ?? null);
  const hasOpenPreview = subagents.some(
    (subagent) => subagentPreviewKey(subagent) === openPreviewKey,
  );

  return (
    <div
      data-subagent-status-container=""
      data-subagent-open={hasOpenPreview ? "" : undefined}
      className="mt-1 w-full min-w-0 max-w-[85%] text-[14px]/5"
    >
      <div
        data-subagent-status-stack=""
        className="flex w-full min-w-0 flex-col items-start pt-0.5"
      >
        {subagents.map((subagent) => (
          <SubagentStatusRow
            key={subagentPreviewKey(subagent)}
            activeThreadId={activeThreadId}
            environmentId={environmentId}
            isPreviewOpen={openPreviewKey === subagentPreviewKey(subagent)}
            projectRoot={projectRoot}
            subagent={subagent}
            subagentDetailsEnabled={subagentDetailsEnabled}
          />
        ))}
      </div>
    </div>
  );
}

function SubagentStatusRow({
  activeThreadId,
  environmentId,
  isPreviewOpen,
  projectRoot,
  subagent,
  subagentDetailsEnabled,
}: {
  activeThreadId: ThreadId;
  environmentId: EnvironmentId;
  isPreviewOpen: boolean;
  projectRoot: string | undefined;
  subagent: WorkLogSubagent;
  subagentDetailsEnabled: boolean;
}) {
  const openPreview = useSubagentPreviewStore((state) => state.openPreview);
  const updatePreviewSubagent = useSubagentPreviewStore((state) => state.updatePreviewSubagent);
  const key = subagentPreviewKey(subagent);
  const providerThreadId = subagent.providerThreadId?.trim() ?? "";
  const hasProviderThread = providerThreadId.length > 0;
  const hasDetails =
    subagentDetailsEnabled &&
    ((subagent.logs?.length ?? 0) > 0 || subagent.hasDetails === true || hasProviderThread);
  const title = subagent.title ?? subagent.nickname ?? subagent.role ?? "Subagent";
  const statusText = subagent.latestUpdate ?? subagent.statusLabel;
  const rowState = subagent.rawStatus ?? (subagent.isActive ? "running" : "completed");

  useEffect(() => {
    if (!isPreviewOpen) {
      return;
    }
    updatePreviewSubagent(subagent);
  }, [isPreviewOpen, subagent, updatePreviewSubagent]);

  const handleOpenPreview = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!hasDetails) {
      return;
    }
    openPreview({
      key,
      activeThreadId,
      environmentId,
      projectRoot,
      subagent,
    });
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  };

  return (
    <button
      type="button"
      className={cn(
        "group/subagent-row inline-flex min-h-6 w-fit max-w-full min-w-0 items-center gap-1 overflow-hidden",
        "border-0 bg-transparent p-0 text-left text-detail text-multi-fg-secondary",
        hasDetails &&
          "cursor-pointer hover:text-multi-fg-primary focus-visible:text-multi-fg-primary focus-visible:outline-none",
        isPreviewOpen && hasDetails && "text-multi-fg-primary",
      )}
      data-subagent-row=""
      data-subagent-state={rowState}
      data-subagent-provider-thread-id={hasProviderThread ? providerThreadId : undefined}
      disabled={!hasDetails}
      aria-label={hasDetails ? `Open ${title} details` : undefined}
      aria-pressed={hasDetails ? isPreviewOpen : undefined}
      onClick={handleOpenPreview}
      onKeyDown={handleKeyDown}
    >
      <SubagentStatusIndicator subagent={subagent} />
      <span className="inline-flex min-w-0 max-w-full items-baseline gap-1 overflow-hidden">
        <span
          data-subagent-name=""
          className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
        >
          {title}
        </span>
        {subagent.model ? (
          <span className="shrink-0 rounded border border-multi-stroke-tertiary px-1 text-caption text-multi-fg-tertiary">
            {subagent.model}
          </span>
        ) : null}
        {statusText ? (
          <span
            data-subagent-task=""
            className={cn(
              "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-multi-fg-tertiary",
              subagent.isActive && "tool-call-shimmer",
            )}
          >
            {statusText}
          </span>
        ) : null}
        {subagent.usedTokens !== undefined && subagent.usedTokens > 0 ? (
          <span className="shrink-0 text-caption text-multi-fg-tertiary tabular-nums">
            {formatSubagentUsageLabel(subagent)}
          </span>
        ) : null}
      </span>
      {hasDetails ? (
        <span
          className={cn(
            "ml-1 inline-flex shrink-0 opacity-0 transition-opacity duration-100",
            "group-hover/subagent-row:opacity-100 group-focus-visible/subagent-row:opacity-100",
            isPreviewOpen && "opacity-100",
          )}
          data-subagent-open=""
          aria-hidden="true"
        >
          <IconChevronRightMedium className="size-3" />
        </span>
      ) : null}
    </button>
  );
}

function SubagentStatusIndicator({ subagent }: { subagent: WorkLogSubagent }) {
  const isFailed =
    subagent.statusLabel === "Failed" ||
    subagent.rawStatus === "errored" ||
    subagent.rawStatus === "failed" ||
    subagent.rawStatus === "error";
  if (subagent.isActive) {
    return (
      <span className="inline-flex shrink-0 items-center justify-center text-multi-icon-accent-primary">
        <IconClock className="tool-call-shimmer size-3" />
      </span>
    );
  }
  if (isFailed) {
    return (
      <span className="size-1.5 shrink-0 rounded-full bg-multi-fg-red-primary" aria-hidden="true" />
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center justify-center text-multi-icon-tertiary">
      <IconRobot className="size-3" />
    </span>
  );
}

function formatSubagentUsageLabel(subagent: WorkLogSubagent): string {
  const usedLabel = formatContextWindowTokens(subagent.usedTokens ?? null);
  if (subagent.usedPercentage !== undefined && subagent.usedPercentage !== null) {
    return `${usedLabel} (${Math.round(subagent.usedPercentage)}%)`;
  }
  if (subagent.maxTokens !== undefined) {
    return `${usedLabel} / ${formatContextWindowTokens(subagent.maxTokens ?? null)}`;
  }
  return `${usedLabel} tokens`;
}

function isToolLikeWorkEntry(workEntry: WorkLogEntry): boolean {
  return Boolean(
    workEntry.requestKind ||
    workEntry.itemType ||
    workEntry.command ||
    (workEntry.changedFiles?.length ?? 0) > 0,
  );
}

function resolveThinkingTask(workEntry: WorkLogEntry, isLoading: boolean): string {
  const action = isLoading ? "Thinking" : "Thought";
  const title = resolveTitle(workEntry);
  const detail = workEntry.detail?.trim();
  if (detail && detail !== title) return `${action} - ${detail}`;
  if (title !== "Thinking" && title !== "Thought") return `${action} - ${title}`;
  return action;
}

function toToolCall(workEntry: WorkLogEntry, projectRoot: string | undefined): ToolCallModel {
  const toolCase = resolveToolCase(workEntry);
  const action =
    toolCase === "taskToolCall"
      ? (workEntry.subagentAction?.tool ?? "Task")
      : resolveTitle(workEntry);
  const details =
    toolCase === "taskToolCall"
      ? workEntry.subagentAction?.summaryText?.trim() ||
        workEntry.subagentAction?.prompt?.trim() ||
        workEntry.detail?.trim() ||
        "subagent"
      : resolveToolDetails(workEntry, projectRoot);
  const commandArtifact = workEntry.artifacts?.find((artifact) => artifact.type === "command");
  const diffArtifact =
    workEntry.artifacts?.find(
      (artifact): artifact is ToolDiffArtifact =>
        artifact.type === "diff" && artifact.source === "result",
    ) ??
    workEntry.artifacts?.find((artifact): artifact is ToolDiffArtifact => artifact.type === "diff");
  const readArtifact = workEntry.artifacts?.find((artifact) => artifact.type === "read");
  const command = commandArtifact?.command ?? workEntry.command ?? null;
  const output = resolveOutput(workEntry, toolCase, workEntry.artifacts);
  const firstChangedFile =
    workEntry.changedFiles?.[0] ?? diffArtifact?.files[0]?.path ?? readArtifact?.path ?? null;
  const path = firstChangedFile ? formatProjectRelativePath(firstChangedFile, projectRoot) : null;
  const stats = diffArtifact ? summarizeDiffStats(diffArtifact) : undefined;

  return {
    tool: {
      case: toolCase,
      value: {
        action,
        details,
        command,
        output,
        path,
        ...(stats ? { stats } : {}),
        ...(workEntry.artifacts ? { artifacts: workEntry.artifacts } : {}),
      },
    },
  };
}

function summarizeDiffStats(diffArtifact: ToolDiffArtifact): {
  additions?: number | undefined;
  deletions?: number | undefined;
} {
  return diffArtifact.files.reduce(
    (stats, file) => ({
      additions: (stats.additions ?? 0) + (file.additions ?? 0),
      deletions: (stats.deletions ?? 0) + (file.deletions ?? 0),
    }),
    { additions: 0, deletions: 0 },
  );
}

function resolveToolCase(workEntry: WorkLogEntry): ToolCallModel["tool"]["case"] {
  if (workEntry.requestKind === "command" || workEntry.itemType === "command_execution") {
    return "shellToolCall";
  }
  if (workEntry.requestKind === "file-change" || workEntry.itemType === "file_change") {
    return "editToolCall";
  }
  if (workEntry.requestKind === "file-read" || workEntry.itemType === "file_read") {
    return "readToolCall";
  }
  if (workEntry.itemType === "file_search") {
    return "globToolCall";
  }
  if (workEntry.itemType === "web_search") {
    return "webSearchToolCall";
  }
  if (workEntry.itemType === "web_fetch") {
    return "webFetchToolCall";
  }
  if (workEntry.itemType === "image_view") {
    return "imageViewToolCall";
  }
  if (workEntry.itemType === "collab_agent_tool_call") {
    return "taskToolCall";
  }
  if (workEntry.itemType === "mcp_tool_call") {
    return "mcpToolCall";
  }
  if (workEntry.itemType === "dynamic_tool_call") {
    return "dynamicToolCall";
  }
  if ((workEntry.changedFiles?.length ?? 0) > 0) {
    return "editToolCall";
  }
  if (workEntry.command) {
    return "shellToolCall";
  }
  return "unknownToolCall";
}

function resolveTitle(workEntry: WorkLogEntry): string {
  const title = (workEntry.toolTitle ?? workEntry.label).trim();
  if (title.length === 0) return workEntry.label;
  return `${title.charAt(0).toUpperCase()}${title.slice(1)}`;
}

function resolveSummary(workEntry: WorkLogEntry, projectRoot: string | undefined): string | null {
  if (workEntry.command) return workEntry.command;
  if (workEntry.detail) return workEntry.detail;
  if ((workEntry.changedFiles?.length ?? 0) === 0) return null;
  const [firstPath] = workEntry.changedFiles ?? [];
  if (!firstPath) return null;
  const displayPath = formatProjectRelativePath(firstPath, projectRoot);
  return workEntry.changedFiles!.length === 1
    ? displayPath
    : `${displayPath} +${workEntry.changedFiles!.length - 1} more`;
}

function resolveOutput(
  workEntry: WorkLogEntry,
  toolCase: ToolCallModel["tool"]["case"],
  artifacts: ReadonlyArray<ToolDisplayArtifact> | undefined,
): string | null {
  const commandArtifact = artifacts?.find((artifact) => artifact.type === "command");
  const readArtifact = artifacts?.find((artifact) => artifact.type === "read");
  const searchArtifact = artifacts?.find((artifact) => artifact.type === "search");
  const diagnosticArtifact = artifacts?.find((artifact) => artifact.type === "diagnostic");
  const rawArtifact = artifacts?.find((artifact) => artifact.type === "raw");
  if (toolCase === "shellToolCall") {
    return commandArtifact?.output ?? workEntry.output ?? null;
  }
  if (toolCase === "editToolCall") {
    return workEntry.detail ?? null;
  }
  if (toolCase === "readToolCall") {
    return readArtifact?.output ?? workEntry.output ?? null;
  }
  if (toolCase === "grepToolCall" || toolCase === "globToolCall") {
    return searchArtifact?.output ?? workEntry.output ?? null;
  }
  if (
    toolCase === "mcpToolCall" ||
    toolCase === "dynamicToolCall" ||
    toolCase === "imageViewToolCall" ||
    toolCase === "unknownToolCall"
  ) {
    return diagnosticArtifact?.message ?? rawArtifact?.text ?? workEntry.output ?? null;
  }
  return resolveRawCommand(workEntry);
}

function resolveRawCommand(workEntry: WorkLogEntry): string | null {
  const rawCommand = workEntry.rawCommand?.trim();
  if (rawCommand && workEntry.command && rawCommand !== workEntry.command.trim()) {
    return rawCommand;
  }
  return null;
}

function resolveToolDetails(
  workEntry: WorkLogEntry,
  projectRoot: string | undefined,
): string | null {
  const toolCase = resolveToolCase(workEntry);
  if (toolCase === "shellToolCall" && workEntry.command) return workEntry.command;
  if (toolCase === "editToolCall" && (workEntry.changedFiles?.length ?? 0) > 0) {
    return resolveSummary(workEntry, projectRoot);
  }
  return resolveSummary(workEntry, projectRoot);
}

function resolveStatus(workEntry: WorkLogEntry): ToolCallStatus {
  if (workEntry.tone === "error" || workEntry.status === "error") return "error";
  if (workEntry.status === "running") return "loading";
  return "completed";
}
