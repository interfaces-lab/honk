import { type EnvironmentId, type ThreadId } from "@multi/contracts";
import {
  IconBubbleQuestion,
  IconChevronRightMedium,
  IconClock,
  IconRobot,
  IconSummary,
} from "central-icons";
import { memo, type KeyboardEvent, type MouseEvent, useMemo } from "react";
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
import { useMountEffect } from "~/hooks/use-mount-effect";
import ChatMarkdown from "../markdown/chat-markdown";
import {
  subagentTrayKey,
  subagentTrayUpdateSignature,
  useSubagentTrayStore,
} from "../../../stores/subagent-tray-store";

type ToolCallStatus = "loading" | "completed" | "error";

function stopSubagentStatusRowKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
  event.stopPropagation();
}

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
  const status = useMemo(() => resolveStatus(workEntry), [workEntry]);
  const isLoading = status === "loading";
  const subagents = workEntry.subagents ?? [];
  const toolCall = useMemo(() => toToolCall(workEntry, projectRoot), [projectRoot, workEntry]);

  if (workEntry.isToolSummary) {
    return <ToolSummaryRow text={workEntry.label} />;
  }

  if (workEntry.extensionUiRequestKind) {
    return <ExtensionUiRequestRow workEntry={workEntry} active={isLoading} />;
  }

  if (workEntry.tone === "thinking" && !isToolLikeWorkEntry(workEntry)) {
    const thinkingMarkdown = resolveThinkingMarkdown(workEntry);
    return thinkingMarkdown ? (
      <ThinkingMarkdown text={thinkingMarkdown} cwd={projectRoot} isStreaming={isLoading} />
    ) : (
      <ThinkingStatus task={resolveThinkingTask(workEntry, isLoading)} active={isLoading} />
    );
  }

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

  if (workEntry.itemType === "collab_agent_tool_call") {
    return subagentStatusSurface;
  }

  return (
    <div
      className="flex w-full min-w-0 max-w-full flex-col gap-1"
      data-tool-call-id={workEntry.toolCallId ?? workEntry.id}
      data-tool-status={status}
      data-tool-has-error={status === "error" ? "true" : undefined}
    >
      <ToolCallRenderer
        toolCall={toolCall}
        callId={workEntry.toolCallId ?? workEntry.id}
        loading={isLoading}
        startedAtMs={Date.parse(workEntry.createdAt)}
        hasError={status === "error"}
        conversationDensity="minimal"
      />
      {subagentStatusSurface}
    </div>
  );
});

function ExtensionUiRequestRow({
  workEntry,
  active,
}: {
  workEntry: WorkLogEntry;
  active: boolean;
}) {
  const detail = workEntry.detail?.trim();
  return (
    <div
      data-extension-ui-request=""
      data-extension-ui-request-kind={workEntry.extensionUiRequestKind}
      data-extension-ui-request-active={active ? "true" : undefined}
      className="flex w-full min-w-0 items-start gap-2 text-conversation text-multi-fg-secondary"
    >
      <IconBubbleQuestion
        className={cn(
          "mt-0.5 size-3.5 shrink-0 text-multi-icon-tertiary",
          active && "tool-call-shimmer text-multi-icon-accent-primary",
        )}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "min-w-0 break-words font-medium text-multi-fg-primary wrap-anywhere",
            active && "tool-call-shimmer",
          )}
        >
          {workEntry.label}
        </div>
        {detail ? (
          <div className="mt-0.5 min-w-0 whitespace-pre-wrap break-words text-multi-fg-tertiary wrap-anywhere">
            {detail}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ToolSummaryRow({ text }: { text: string }) {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return (
    <div
      data-tool-summary=""
      className="flex w-full min-w-0 items-start gap-2 text-conversation text-multi-fg-secondary"
    >
      <IconSummary
        className="mt-0.5 size-3.5 shrink-0 text-multi-icon-tertiary"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1 whitespace-pre-wrap break-words wrap-anywhere">{trimmed}</div>
    </div>
  );
}

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
  const openTrayKey = useSubagentTrayStore((state) => state.focus?.key ?? null);
  const hasOpenTray = subagents.some(
    (subagent) => subagentTrayKey(subagent) === openTrayKey,
  );

  return (
    <div
      data-subagent-status-container=""
      data-subagent-open={hasOpenTray ? "" : undefined}
      className="w-full min-w-0 max-w-full px-3 py-1 text-conversation"
    >
      <div data-subagent-status-stack="" className="flex w-full min-w-0 flex-col items-start gap-1">
        {subagents.map((subagent) => (
          <SubagentStatusRow
            key={subagentTrayKey(subagent)}
            activeThreadId={activeThreadId}
            environmentId={environmentId}
            isTrayOpen={openTrayKey === subagentTrayKey(subagent)}
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
  isTrayOpen,
  projectRoot,
  subagent,
  subagentDetailsEnabled,
}: {
  activeThreadId: ThreadId;
  environmentId: EnvironmentId;
  isTrayOpen: boolean;
  projectRoot: string | undefined;
  subagent: WorkLogSubagent;
  subagentDetailsEnabled: boolean;
}) {
  const openTray = useSubagentTrayStore((state) => state.openTray);
  const updateTraySubagent = useSubagentTrayStore((state) => state.updateTraySubagent);
  const key = subagentTrayKey(subagent);
  const subagentThreadId = subagent.subagentThreadId?.trim() ?? "";
  const hasSubagentThread = subagentThreadId.length > 0;
  const hasDetails =
    subagentDetailsEnabled &&
    ((subagent.logs?.length ?? 0) > 0 || subagent.hasDetails === true || hasSubagentThread);
  const title = subagent.title ?? subagent.nickname ?? subagent.role ?? "Subagent";
  const statusText = subagent.latestUpdate ?? subagent.statusLabel;
  const rowState = subagent.rawStatus ?? (subagent.isActive ? "running" : "completed");
  const trayUpdateSignature = isTrayOpen ? subagentTrayUpdateSignature(subagent) : "";

  const handleOpenTray = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!hasDetails) {
      return;
    }
    openTray({
      key,
      activeThreadId,
      environmentId,
      projectRoot,
      subagent,
    });
  };

  const trayUpdateSync = isTrayOpen ? (
    <SubagentTrayUpdateSync
      key={trayUpdateSignature}
      subagent={subagent}
      updateTraySubagent={updateTraySubagent}
    />
  ) : null;

  return (
    <>
      {trayUpdateSync}
      <button
        type="button"
        className={cn(
          "group/subagent-row inline-flex min-h-6 w-fit max-w-full min-w-0 items-center gap-1.5 overflow-hidden",
          "border-0 bg-transparent p-0 text-left text-conversation text-multi-fg-secondary",
          hasDetails &&
            "cursor-pointer hover:text-multi-fg-primary focus-visible:text-multi-fg-primary focus-visible:outline-none",
          isTrayOpen && hasDetails && "text-multi-fg-primary",
        )}
        data-subagent-row=""
        data-subagent-state={rowState}
        data-subagent-thread-id={hasSubagentThread ? subagentThreadId : undefined}
        disabled={!hasDetails}
        aria-label={hasDetails ? `Open ${title} details` : undefined}
        aria-pressed={hasDetails ? isTrayOpen : undefined}
        onClick={handleOpenTray}
        onKeyDown={stopSubagentStatusRowKeyDown}
      >
        <SubagentStatusIndicator subagent={subagent} />
        <span className="inline-flex min-w-0 max-w-full items-baseline gap-1.5 overflow-hidden">
          <span
            data-subagent-name=""
            className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-medium text-multi-fg-primary"
          >
            {title}
          </span>
          {subagent.model ? (
            <span className="shrink-0 text-caption text-multi-fg-tertiary tabular-nums">
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
              isTrayOpen && "opacity-100",
            )}
            data-subagent-open=""
            aria-hidden="true"
          >
            <IconChevronRightMedium className="size-3" />
          </span>
        ) : null}
      </button>
    </>
  );
}

function SubagentTrayUpdateSync({
  subagent,
  updateTraySubagent,
}: {
  subagent: WorkLogSubagent;
  updateTraySubagent: (subagent: WorkLogSubagent) => void;
}) {
  useMountEffect(() => {
    updateTraySubagent(subagent);
  });

  return null;
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

function resolveThinkingMarkdown(workEntry: WorkLogEntry): string | null {
  const detail = workEntry.detail?.trim();
  if (detail) return detail;
  const output = workEntry.output?.trim();
  if (output) return output;
  const label = workEntry.label.trim();
  if (label && label !== "Thinking" && label !== "Thought") return label;
  return null;
}

function ThinkingMarkdown({
  text,
  cwd,
  isStreaming,
}: {
  text: string;
  cwd: string | undefined;
  isStreaming: boolean;
}) {
  return (
    <div
      className="min-w-0 py-0.5 text-conversation text-multi-fg-secondary"
      data-thinking-markdown=""
    >
      <ChatMarkdown
        text={text}
        cwd={cwd}
        isStreaming={isStreaming}
        className="text-multi-fg-secondary"
      />
    </div>
  );
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
