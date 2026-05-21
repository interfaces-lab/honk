import { memo } from "react";
import {
  type ToolDiffArtifact,
  type ToolDisplayArtifact,
  type WorkLogEntry,
  type WorkLogSubagent,
} from "../../../session-logic";
import { formatProjectRelativePath } from "../shared/file-path-display";
import { formatContextWindowTokens } from "~/lib/context-window";
import { ThinkingStatus, ToolCallRenderer, type ToolCallModel } from "./tool-renderer";

type ToolCallStatus = "loading" | "completed" | "error";

interface ToolCallMessageProps {
  workEntry: WorkLogEntry;
  projectRoot: string | undefined;
}

export const ToolCallMessage = memo(function ToolCallMessage({
  workEntry,
  projectRoot,
}: ToolCallMessageProps) {
  const status = resolveStatus(workEntry);
  const isLoading = status === "loading";
  const subagents = workEntry.subagents ?? [];

  if (workEntry.tone === "thinking" && !isToolLikeWorkEntry(workEntry)) {
    return <ThinkingStatus task={resolveThinkingTask(workEntry, isLoading)} active={isLoading} />;
  }

  const toolCall = toToolCall(workEntry, projectRoot);
  const hasSubagents = subagents.length > 0;

  return (
    <div className="w-full min-w-0 max-w-full">
      <ToolCallRenderer
        toolCall={toolCall}
        callId={workEntry.toolCallId ?? workEntry.id}
        loading={isLoading}
        startedAtMs={Date.parse(workEntry.createdAt)}
        hasError={status === "error"}
        defaultExpanded={false}
        conversationDensity="minimal"
      />
      {hasSubagents ? <SubagentStatusSurface subagents={subagents} /> : null}
    </div>
  );
});

function SubagentStatusSurface({ subagents }: { subagents: ReadonlyArray<WorkLogSubagent> }) {
  return (
    <div className="mt-1 max-h-80 w-full overflow-x-hidden overflow-y-auto pl-5 text-detail">
      {subagents.map((subagent) => (
        <div
          key={subagent.providerThreadId ?? subagent.threadId ?? subagent.agentId}
          className="group/subagent flex min-h-6 w-fit max-w-full items-center gap-1 overflow-hidden"
          data-status={subagent.isActive ? "running" : "completed"}
        >
          <span
            className="size-1.5 shrink-0 rounded-full bg-multi-icon-tertiary group-data-[status=running]/subagent:bg-multi-icon-accent-primary"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <div className="inline-flex min-w-0 items-baseline gap-1">
              <span className="min-w-0 text-detail text-multi-fg-secondary">
                {subagent.title ?? subagent.nickname ?? subagent.role ?? "Subagent"}
              </span>
              {subagent.model ? (
                <span className="shrink-0 rounded border border-multi-stroke-tertiary px-1 text-caption text-multi-fg-tertiary">
                  {subagent.model}
                </span>
              ) : null}
              {subagent.statusLabel || subagent.latestUpdate ? (
                <span className="min-w-0 overflow-hidden text-detail text-ellipsis whitespace-nowrap text-multi-fg-tertiary">
                  {subagent.latestUpdate ?? subagent.statusLabel}
                </span>
              ) : null}
              {subagent.usedTokens !== undefined && subagent.usedTokens > 0 ? (
                <span className="shrink-0 text-caption text-multi-fg-tertiary tabular-nums">
                  {formatSubagentUsageLabel(subagent)}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      ))}
    </div>
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
