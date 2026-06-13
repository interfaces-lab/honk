import {
  type EnvironmentId,
  type RuntimeDisplayTimelineExtensionUiRequestItem,
  type RuntimeDisplayTimelineToolItem,
  type ThreadId,
} from "@honk/contracts";
import { Button } from "@honk/honkkit/button";
import { IconBubbleQuestion, IconChevronRightMedium, IconClock, IconSummary } from "central-icons";
import { memo, type KeyboardEvent, type MouseEvent, useMemo } from "react";
import {
  type ToolDiffArtifact,
  type ToolDisplayArtifact,
  type WorkLogEntry,
  type WorkLogSubagent,
} from "../../../session-logic";
import { formatProjectRelativePath } from "../shared/file-path-display";
import { formatContextWindowTokens } from "~/lib/context-window";
import { useConversationDensity } from "~/hooks/use-conversation-density";
import {
  runtimeToolHasPendingApproval,
  workEntryHasPendingApproval,
  type PendingApprovalRequestKind,
} from "../timeline/timeline-render-items";
import {
  ThinkingStatus,
  ToolCallRenderer,
  type ToolCallApproval,
  type ToolCallModel,
} from "./tool-renderer";
import { cn } from "~/lib/utils";
import ChatMarkdown from "../markdown/chat-markdown";
import {
  subagentTrayKey,
  subagentTraySelection,
  useSubagentTrayStore,
} from "../../../stores/subagent-tray-store";

type ToolCallStatus = "loading" | "completed" | "error";
type RuntimeToolDisplay = NonNullable<RuntimeDisplayTimelineToolItem["display"]>;
type RuntimeSubagentDisplay = Extract<RuntimeToolDisplay, { kind: "subagent" }>;
type RuntimeSubagentRun = RuntimeSubagentDisplay["runs"][number];

function stopSubagentStatusRowKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
  event.stopPropagation();
}

const PENDING_TOOL_CALL_APPROVAL: ToolCallApproval = { status: "pending" };

interface ToolCallMessageProps {
  workEntry: WorkLogEntry;
  projectRoot: string | undefined;
  activeThreadId: ThreadId;
  environmentId: EnvironmentId;
  pendingApprovalKinds?: ReadonlySet<PendingApprovalRequestKind> | undefined;
  subagentDetailsEnabled?: boolean | undefined;
  defaultEditExpanded?: boolean | undefined;
}

export const ToolCallMessage = memo(function ToolCallMessage({
  workEntry,
  projectRoot,
  activeThreadId,
  environmentId,
  pendingApprovalKinds,
  subagentDetailsEnabled = true,
  defaultEditExpanded = false,
}: ToolCallMessageProps) {
  const conversationDensity = useConversationDensity();
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
        approval={
          pendingApprovalKinds && workEntryHasPendingApproval(workEntry, pendingApprovalKinds)
            ? PENDING_TOOL_CALL_APPROVAL
            : undefined
        }
        conversationDensity={conversationDensity}
        defaultEditExpanded={defaultEditExpanded}
      />
      {subagentStatusSurface}
    </div>
  );
});

export const RuntimeToolCallMessage = memo(function RuntimeToolCallMessage({
  tool,
  projectRoot,
  activeThreadId,
  environmentId,
  pendingApprovalKinds,
  subagentDetailsEnabled = true,
  defaultEditExpanded = false,
}: {
  tool: RuntimeDisplayTimelineToolItem;
  projectRoot?: string | undefined;
  activeThreadId?: ThreadId | undefined;
  environmentId?: EnvironmentId | undefined;
  pendingApprovalKinds?: ReadonlySet<PendingApprovalRequestKind> | undefined;
  subagentDetailsEnabled?: boolean | undefined;
  defaultEditExpanded?: boolean | undefined;
}) {
  const conversationDensity = useConversationDensity();
  const status = resolveRuntimeToolStatus(tool);
  const isLoading = status === "loading";
  const toolCall = useMemo(() => runtimeToolItemToToolCall(tool), [tool]);
  const runtimeSubagents = useMemo(
    () => runtimeToolDisplayToSubagents(tool.display),
    [tool.display],
  );
  const hasStreamingOutput = runtimeToolHasStreamingOutput(tool);
  const canRenderSubagents =
    runtimeSubagents.length > 0 && activeThreadId !== undefined && environmentId !== undefined;
  const subagentStatusSurface = canRenderSubagents ? (
    <SubagentStatusSurface
      activeThreadId={activeThreadId}
      environmentId={environmentId}
      projectRoot={projectRoot}
      subagentDetailsEnabled={subagentDetailsEnabled}
      subagents={runtimeSubagents}
    />
  ) : null;

  // Cursor parity: a subagent Task renders as the status rows themselves (name, model,
  // latest update) — never as a "Task <prompt>" header duplicating them. The prompt and
  // transcript live in the tray opened from the row. The taskToolCall chrome below remains
  // only as the fallback while no runs are reportable yet.
  if (tool.display?.kind === "subagent" && subagentStatusSurface) {
    return (
      <div
        className="flex w-full min-w-0 max-w-full flex-col"
        data-tool-call-id={tool.toolCallId}
        data-runtime-tool-call=""
        data-runtime-tool-name={tool.toolName}
        data-tool-status={status}
        data-tool-has-error={status === "error" ? "true" : undefined}
      >
        {subagentStatusSurface}
      </div>
    );
  }

  return (
    <div
      className="flex w-full min-w-0 max-w-full flex-col gap-1"
      data-tool-call-id={tool.toolCallId}
      data-runtime-tool-call=""
      data-runtime-tool-name={tool.toolName}
      data-tool-status={status}
      data-tool-has-error={status === "error" ? "true" : undefined}
    >
      <ToolCallRenderer
        toolCall={toolCall}
        callId={tool.toolCallId}
        loading={isLoading}
        startedAtMs={Date.parse(tool.createdAt)}
        hasError={status === "error"}
        approval={
          pendingApprovalKinds && runtimeToolHasPendingApproval(tool, pendingApprovalKinds)
            ? PENDING_TOOL_CALL_APPROVAL
            : undefined
        }
        conversationDensity={conversationDensity}
        defaultExpanded={isLoading && hasStreamingOutput}
        defaultEditExpanded={defaultEditExpanded}
      />
    </div>
  );
});

export function RuntimeExtensionUiRequestMessage({
  request,
}: {
  request: RuntimeDisplayTimelineExtensionUiRequestItem;
}) {
  const active = request.status === "pending";
  const detail = request.message?.trim();
  const label = active ? `Waiting for ${request.title}` : `Answered ${request.title}`;
  return (
    <div
      data-extension-ui-request=""
      data-extension-ui-request-id={request.requestId}
      data-extension-ui-request-kind={request.requestKind}
      data-extension-ui-request-active={active ? "true" : undefined}
      className="flex w-full min-w-0 items-start gap-2 text-conversation text-honk-fg-secondary"
    >
      <IconBubbleQuestion
        className={cn(
          "mt-0.5 size-3.5 shrink-0 text-honk-icon-tertiary",
          active && "tool-call-shimmer text-honk-icon-accent-primary",
        )}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "min-w-0 break-words font-medium text-honk-fg-primary wrap-anywhere",
            active && "tool-call-shimmer",
          )}
        >
          {label}
        </div>
        {detail ? (
          <div className="mt-0.5 min-w-0 whitespace-pre-wrap break-words text-honk-fg-tertiary wrap-anywhere">
            {detail}
          </div>
        ) : null}
      </div>
    </div>
  );
}

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
      className="flex w-full min-w-0 items-start gap-2 text-conversation text-honk-fg-secondary"
    >
      <IconBubbleQuestion
        className={cn(
          "mt-0.5 size-3.5 shrink-0 text-honk-icon-tertiary",
          active && "tool-call-shimmer text-honk-icon-accent-primary",
        )}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "min-w-0 break-words font-medium text-honk-fg-primary wrap-anywhere",
            active && "tool-call-shimmer",
          )}
        >
          {workEntry.label}
        </div>
        {detail ? (
          <div className="mt-0.5 min-w-0 whitespace-pre-wrap break-words text-honk-fg-tertiary wrap-anywhere">
            {detail}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function runtimeToolItemToToolCall(tool: RuntimeDisplayTimelineToolItem): ToolCallModel {
  return runtimeToolDisplayToToolCall(tool, tool.display);
}

export function runtimeToolDisplayToToolCall(
  tool: RuntimeDisplayTimelineToolItem,
  display: RuntimeToolDisplay,
): ToolCallModel {
  switch (display.kind) {
    case "shell":
      return runtimeShellDisplayToToolCall(tool, display);
    case "read":
      return runtimeReadDisplayToToolCall(tool, display);
    case "grep":
      return runtimeGrepDisplayToToolCall(tool, display);
    case "find":
      return runtimeFindDisplayToToolCall(tool, display);
    case "edit":
      return runtimeEditDisplayToToolCall(tool, display);
    case "mcp":
      return {
        tool: {
          case: "mcpToolCall",
          value: {
            action: runtimeToolAction(tool),
            details: display.providerIdentifier ?? tool.toolName,
          },
        },
      };
    case "subagent":
      return runtimeSubagentDisplayToToolCall(tool, display);
    case "unknown":
      return {
        tool: {
          case: "unknownToolCall",
          value: {
            action: runtimeToolAction(tool),
            details: display.toolName,
            output: display.output ?? null,
            ...(display.output
              ? { artifacts: [{ type: "raw", text: display.output } satisfies ToolDisplayArtifact] }
              : {}),
          },
        },
      };
  }
}

function runtimeSubagentDisplayToToolCall(
  tool: RuntimeDisplayTimelineToolItem,
  display: RuntimeSubagentDisplay,
): ToolCallModel {
  return {
    tool: {
      case: "taskToolCall",
      value: {
        action: "Task",
        details: runtimeSubagentDisplayDetails(tool, display),
      },
    },
  };
}

function runtimeSubagentDisplayDetails(
  tool: RuntimeDisplayTimelineToolItem,
  display: RuntimeSubagentDisplay,
): string {
  if (display.runs.length === 1) {
    const run = display.runs[0]!;
    const prompt = run.prompt.trim();
    if (prompt) {
      return prompt;
    }
    return runtimeSubagentTitle(run.nickname, run.role);
  }
  return runtimeSubagentDisplaySummary(tool, display);
}

function runtimeSubagentDisplaySummary(
  tool: RuntimeDisplayTimelineToolItem,
  display: RuntimeSubagentDisplay,
): string {
  if (display.runs.length === 0) {
    return tool.summary?.trim() || "No subagents ran";
  }
  const running = display.runs.filter((run) => run.state === "running").length;
  const completed = display.runs.filter((run) => run.state === "completed").length;
  const failed = display.runs.filter((run) => run.state === "failed").length;
  const aborted = display.runs.filter((run) => run.state === "aborted").length;
  const parts = [`${completed}/${display.runs.length} completed`];
  if (running > 0) {
    parts.push(`${running} running`);
  }
  if (failed > 0) {
    parts.push(`${failed} failed`);
  }
  if (aborted > 0) {
    parts.push(`${aborted} aborted`);
  }
  return parts.join(", ");
}

export function runtimeToolItemToSubagents(
  tool: RuntimeDisplayTimelineToolItem,
): WorkLogSubagent[] {
  return runtimeToolDisplayToSubagents(tool.display);
}

function runtimeToolDisplayToSubagents(
  display: RuntimeDisplayTimelineToolItem["display"],
): WorkLogSubagent[] {
  if (display?.kind !== "subagent") {
    return [];
  }
  return display.runs.map((run): WorkLogSubagent => {
    const title = runtimeSubagentTitle(run.nickname, run.role);
    return {
      threadId: run.subagentThreadId,
      subagentThreadId: run.subagentThreadId,
      agentId: run.agentId,
      nickname: run.nickname,
      role: run.role,
      ...(run.model ? { model: run.model } : {}),
      prompt: run.prompt,
      rawStatus: run.state,
      latestUpdate: runtimeSubagentLatestUpdate(run),
      title,
      statusLabel: runtimeSubagentStatusLabel(run.state),
      isActive: run.state === "running",
      logs: [],
      hasDetails: true,
    };
  });
}

function runtimeSubagentLatestUpdate(run: RuntimeSubagentRun): string | undefined {
  if (run.state === "completed" && run.finalText) {
    return run.finalText;
  }
  if ((run.state === "failed" || run.state === "aborted") && run.errorMessage) {
    return run.errorMessage;
  }
  return run.finalText ?? run.errorMessage ?? undefined;
}

function runtimeSubagentTitle(nickname: string | undefined, role: string | undefined): string {
  return nickname?.trim() || role?.trim() || "Subagent";
}

function runtimeSubagentStatusLabel(state: RuntimeSubagentRun["state"]): string {
  switch (state) {
    case "running":
      return "Running";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "aborted":
      return "Aborted";
  }
}

function runtimeShellDisplayToToolCall(
  tool: RuntimeDisplayTimelineToolItem,
  display: Extract<NonNullable<RuntimeDisplayTimelineToolItem["display"]>, { kind: "shell" }>,
): ToolCallModel {
  const command = runtimeTrimmedString(display.command) ?? "";
  const output = runtimeTrimmedString(display.output);
  const artifact: ToolDisplayArtifact = {
    type: "command",
    ...(command ? { command } : {}),
    ...(output ? { output } : {}),
    ...(display.exitCode !== undefined ? { exitCode: display.exitCode } : {}),
    isPartial: tool.isPartial === true,
  };
  return {
    tool: {
      case: "shellToolCall",
      value: {
        action: runtimeToolAction(tool),
        details: command,
        command: command || null,
        output: output ?? null,
        artifacts: [artifact],
      },
    },
  };
}

function runtimeReadDisplayToToolCall(
  tool: RuntimeDisplayTimelineToolItem,
  display: Extract<NonNullable<RuntimeDisplayTimelineToolItem["display"]>, { kind: "read" }>,
): ToolCallModel {
  const path = runtimeTrimmedString(display.path);
  const output = runtimeTrimmedString(display.output);
  const artifact: ToolDisplayArtifact = {
    type: "read",
    ...(path ? { path } : {}),
    ...(output ? { output } : {}),
    isPartial: tool.isPartial === true,
  };
  return {
    tool: {
      case: "readToolCall",
      value: {
        action: runtimeToolAction(tool),
        details: runtimeReadDisplayDetails(display, path ?? tool.toolName),
        path: path ?? null,
        output: output ?? null,
        artifacts: [artifact],
      },
    },
  };
}

function runtimeGrepDisplayToToolCall(
  tool: RuntimeDisplayTimelineToolItem,
  display: Extract<NonNullable<RuntimeDisplayTimelineToolItem["display"]>, { kind: "grep" }>,
): ToolCallModel {
  const query = runtimeTrimmedString(display.query);
  const path = runtimeTrimmedString(display.path);
  const output = runtimeTrimmedString(display.output);
  const artifact: ToolDisplayArtifact = {
    type: "search",
    flavor: "grep",
    ...(query ? { query } : {}),
    ...(output ? { output } : {}),
    ...(display.matchedFiles ? { matchedFiles: display.matchedFiles } : {}),
    ...(display.totalMatched !== undefined ? { totalMatched: display.totalMatched } : {}),
    ...(display.totalIndexedFiles !== undefined
      ? { totalIndexedFiles: display.totalIndexedFiles }
      : {}),
    isPartial: tool.isPartial === true,
  };
  return {
    tool: {
      case: "grepToolCall",
      value: {
        action: runtimeToolAction(tool),
        details: query ?? path ?? tool.toolName,
        path: path ?? null,
        output: output ?? null,
        artifacts: [artifact],
      },
    },
  };
}

function runtimeFindDisplayToToolCall(
  tool: RuntimeDisplayTimelineToolItem,
  display: Extract<NonNullable<RuntimeDisplayTimelineToolItem["display"]>, { kind: "find" }>,
): ToolCallModel {
  const query = runtimeTrimmedString(display.query);
  const path = runtimeTrimmedString(display.path);
  const output = runtimeTrimmedString(display.output);
  const artifact: ToolDisplayArtifact = {
    type: "search",
    flavor: "find",
    ...(query ? { query } : {}),
    ...(output ? { output } : {}),
    ...(display.totalMatched !== undefined ? { totalMatched: display.totalMatched } : {}),
    ...(display.totalIndexedFiles !== undefined
      ? { totalIndexedFiles: display.totalIndexedFiles }
      : {}),
    ...(display.hasMore !== undefined ? { hasMore: display.hasMore } : {}),
    isPartial: tool.isPartial === true,
  };
  return {
    tool: {
      case: "globToolCall",
      value: {
        action: runtimeToolAction(tool),
        details: query ?? path ?? tool.toolName,
        path: path ?? null,
        output: output ?? null,
        artifacts: [artifact],
      },
    },
  };
}

function runtimeEditDisplayToToolCall(
  tool: RuntimeDisplayTimelineToolItem,
  display: Extract<NonNullable<RuntimeDisplayTimelineToolItem["display"]>, { kind: "edit" }>,
): ToolCallModel {
  const path = runtimeTrimmedString(display.path);
  const output = runtimeTrimmedString(display.output);
  const stats =
    display.additions !== undefined || display.deletions !== undefined
      ? {
          additions: display.additions,
          deletions: display.deletions,
        }
      : null;
  const diffArtifact = runtimeEditDiffArtifact(tool, display, path);

  return {
    tool: {
      case: "editToolCall",
      value: {
        action: runtimeToolAction(tool),
        details: path ?? tool.toolName,
        path: path ?? null,
        output: output ?? null,
        ...(stats ? { stats } : {}),
        ...(diffArtifact ? { artifacts: [diffArtifact] } : {}),
      },
    },
  };
}

function runtimeEditDiffArtifact(
  tool: RuntimeDisplayTimelineToolItem,
  display: Extract<NonNullable<RuntimeDisplayTimelineToolItem["display"]>, { kind: "edit" }>,
  path: string | undefined,
): ToolDiffArtifact | null {
  const unifiedDiff = runtimeTrimmedString(display.diff);
  if (!unifiedDiff) {
    return null;
  }
  const source = tool.status === "running" ? "preview" : "result";
  return {
    type: "diff",
    format: "unified",
    source,
    files: [
      {
        path: path ?? "file",
        ...(display.additions !== undefined ? { additions: display.additions } : {}),
        ...(display.deletions !== undefined ? { deletions: display.deletions } : {}),
      },
    ],
    unifiedDiff,
    ...(source === "preview" ? { isPreview: true } : {}),
  };
}

function runtimeReadDisplayDetails(
  display: Extract<NonNullable<RuntimeDisplayTimelineToolItem["display"]>, { kind: "read" }>,
  label: string,
): string {
  if (display.startLine === undefined && display.endLine === undefined) {
    return label;
  }
  const startLine = display.startLine ?? 1;
  return display.endLine === undefined
    ? `${label}:${startLine}`
    : `${label}:${startLine}-${display.endLine}`;
}

function runtimeToolAction(tool: RuntimeDisplayTimelineToolItem): string {
  const summary = tool.summary?.trim();
  if (summary) {
    return summary;
  }
  return tool.toolName;
}

function runtimeToolHasStreamingOutput(tool: RuntimeDisplayTimelineToolItem): boolean {
  const display = tool.display;
  if (display?.kind === "shell" || display?.kind === "read") {
    return runtimeTrimmedString(display.output) !== undefined;
  }
  return false;
}

function resolveRuntimeToolStatus(tool: RuntimeDisplayTimelineToolItem): ToolCallStatus {
  if (tool.status === "error" || tool.isError === true) {
    return "error";
  }
  if (tool.status === "running") {
    return "loading";
  }
  return "completed";
}

function runtimeTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function ToolSummaryRow({ text }: { text: string }) {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return (
    <div
      data-tool-summary=""
      className="flex w-full min-w-0 items-start gap-2 text-conversation text-honk-fg-secondary"
    >
      <IconSummary
        className="mt-0.5 size-3.5 shrink-0 text-honk-icon-tertiary"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1 whitespace-pre-wrap break-words">{trimmed}</div>
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
  const hasOpenTray = subagents.some((subagent) => subagentTrayKey(subagent) === openTrayKey);

  return (
    <div
      data-subagent-status-container=""
      data-subagent-open={hasOpenTray ? "" : undefined}
      className="w-full min-w-0 max-w-full px-(--conversation-text-inset) py-1 text-conversation"
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
  const key = subagentTrayKey(subagent);
  const subagentThreadId = subagent.subagentThreadId?.trim() ?? "";
  const hasSubagentThread = subagentThreadId.length > 0;
  const hasDetails =
    subagentDetailsEnabled &&
    ((subagent.logs?.length ?? 0) > 0 || subagent.hasDetails === true || hasSubagentThread);
  const title = subagent.title ?? subagent.nickname ?? subagent.role ?? "Subagent";
  const statusText = subagent.latestUpdate ?? subagent.statusLabel;
  const rowState = subagent.rawStatus ?? (subagent.isActive ? "running" : "completed");

  const handleOpenTray = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!hasDetails) {
      return;
    }
    openTray(
      subagentTraySelection({
        activeThreadId,
        environmentId,
        projectRoot,
        subagent,
      }),
    );
  };

  // Cursor parity: two-line row — indicator + name + model badge, with the latest update
  // on its own line under the name — instead of one truncated inline run.
  return (
    <Button
      type="button"
      variant="ghost"
      className={cn(
        "group/subagent-row flex min-h-6 w-fit max-w-full min-w-0 flex-col items-start gap-0.5 overflow-hidden",
        "h-auto border-0 bg-transparent p-0 text-left text-conversation text-honk-fg-secondary shadow-none before:hidden hover:bg-transparent data-pressed:bg-transparent disabled:opacity-100",
        hasDetails &&
          "cursor-pointer hover:text-honk-fg-primary focus-visible:text-honk-fg-primary focus-visible:outline-hidden focus-visible:shadow-[0_0_0_1px_var(--honk-stroke-focused)]",
        isTrayOpen && hasDetails && "text-honk-fg-primary",
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
      <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden">
        <span className="inline-flex w-3 shrink-0 items-center justify-center">
          <SubagentStatusIndicator subagent={subagent} />
        </span>
        <span
          data-subagent-name=""
          className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-medium text-honk-fg-primary"
        >
          {title}
        </span>
        {subagent.model ? (
          <span className="shrink-0 text-caption text-honk-fg-tertiary tabular-nums">
            {subagent.model}
          </span>
        ) : null}
        {subagent.usedTokens !== undefined && subagent.usedTokens > 0 ? (
          <span className="shrink-0 text-caption text-honk-fg-tertiary tabular-nums">
            {formatSubagentUsageLabel(subagent)}
          </span>
        ) : null}
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
      </span>
      {statusText ? (
        <span
          data-subagent-task=""
          className={cn(
            "min-w-0 max-w-full overflow-hidden pl-4.5 text-ellipsis whitespace-nowrap text-honk-fg-tertiary",
            subagent.isActive && "tool-call-shimmer",
          )}
        >
          {statusText}
        </span>
      ) : null}
    </Button>
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
      <span className="inline-flex shrink-0 items-center justify-center text-honk-icon-accent-primary">
        <IconClock className="tool-call-shimmer size-3" />
      </span>
    );
  }
  if (isFailed) {
    return (
      <span className="size-1.5 shrink-0 rounded-full bg-honk-fg-red-primary" aria-hidden="true" />
    );
  }
  // Cursor parity: completed runs get a quiet bullet, not an icon.
  return (
    <span className="size-1.5 shrink-0 rounded-full bg-honk-icon-tertiary" aria-hidden="true" />
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
      className="min-w-0 py-0.5 text-conversation text-honk-fg-tertiary"
      data-thinking-markdown=""
    >
      <ChatMarkdown
        text={text}
        cwd={cwd}
        isStreaming={isStreaming}
        className="text-honk-fg-tertiary"
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
  const command = commandArtifact?.command ?? workEntry.command ?? workEntry.rawCommand ?? null;
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
  if (toolCase === "shellToolCall") {
    return workEntry.command ?? workEntry.rawCommand ?? null;
  }
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
