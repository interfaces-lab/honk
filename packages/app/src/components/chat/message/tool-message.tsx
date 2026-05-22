import {
  type EnvironmentId,
  type ProviderThreadSnapshot,
  type ThreadId,
} from "@multi/contracts";
import { IconChevronRightMedium, IconClock, IconRobot } from "central-icons";
import { memo, useEffect, useState } from "react";
import {
  type ToolDiffArtifact,
  type ToolDisplayArtifact,
  type WorkLogEntry,
  type WorkLogSubagent,
  type WorkLogSubagentLog,
} from "../../../session-logic";
import { formatProjectRelativePath } from "../shared/file-path-display";
import { formatContextWindowTokens } from "~/lib/context-window";
import { ThinkingStatus, ToolCallRenderer, type ToolCallModel } from "./tool-renderer";
import { Popover, PopoverPopup, PopoverTrigger } from "@multi/ui/popover";
import { cn } from "~/lib/utils";
import { readEnvironmentApi } from "~/environment-api";

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
      {hasSubagents ? (
        <SubagentStatusSurface
          activeThreadId={activeThreadId}
          environmentId={environmentId}
          subagentDetailsEnabled={subagentDetailsEnabled}
          subagents={subagents}
        />
      ) : null}
    </div>
  );
});

function SubagentStatusSurface({
  activeThreadId,
  environmentId,
  subagentDetailsEnabled,
  subagents,
}: {
  activeThreadId: ThreadId;
  environmentId: EnvironmentId;
  subagentDetailsEnabled: boolean;
  subagents: ReadonlyArray<WorkLogSubagent>;
}) {
  return (
    <div className="mt-1 max-h-80 w-full overflow-x-hidden overflow-y-auto pl-5 text-detail">
      {subagents.map((subagent) => (
        <SubagentStatusRow
          key={subagent.providerThreadId ?? subagent.threadId ?? subagent.agentId}
          activeThreadId={activeThreadId}
          environmentId={environmentId}
          subagent={subagent}
          subagentDetailsEnabled={subagentDetailsEnabled}
        />
      ))}
    </div>
  );
}

type SubagentSnapshotState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly snapshot: ProviderThreadSnapshot }
  | { readonly status: "error"; readonly message: string };

function SubagentStatusRow({
  activeThreadId,
  environmentId,
  subagent,
  subagentDetailsEnabled,
}: {
  activeThreadId: ThreadId;
  environmentId: EnvironmentId;
  subagent: WorkLogSubagent;
  subagentDetailsEnabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [snapshotState, setSnapshotState] = useState<SubagentSnapshotState>({ status: "idle" });
  const providerThreadId = subagent.providerThreadId ?? subagent.threadId;
  const hasProviderThread = providerThreadId.trim().length > 0;
  const hasDetails =
    subagentDetailsEnabled && ((subagent.logs?.length ?? 0) > 0 || hasProviderThread);

  useEffect(() => {
    if (!open || !hasDetails || !hasProviderThread || snapshotState.status !== "idle") {
      return;
    }

    const api = readEnvironmentApi(environmentId);
    if (!api) {
      setSnapshotState({ status: "error", message: "Environment API unavailable." });
      return;
    }

    let cancelled = false;
    setSnapshotState({ status: "loading" });
    void api.orchestration
      .getProviderThreadSnapshot({
        threadId: activeThreadId,
        providerThreadId,
        includeTurns: true,
      })
      .then((snapshot) => {
        if (!cancelled) {
          setSnapshotState({ status: "loaded", snapshot });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setSnapshotState({
            status: "error",
            message: error instanceof Error ? error.message : "Failed to load thread snapshot.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeThreadId,
    environmentId,
    hasDetails,
    hasProviderThread,
    open,
    providerThreadId,
    snapshotState.status,
  ]);

  const row = (
    <button
      type="button"
      className={cn(
        "group/subagent-row inline-flex min-h-6 w-fit max-w-full min-w-0 items-center gap-1 overflow-hidden",
        "border-0 bg-transparent p-0 text-left text-detail text-multi-fg-secondary",
        hasDetails &&
          "cursor-pointer hover:text-multi-fg-primary focus-visible:text-multi-fg-primary focus-visible:outline-none",
      )}
      data-subagent-row=""
      data-subagent-state={subagent.rawStatus ?? (subagent.isActive ? "running" : "completed")}
      data-subagent-provider-thread-id={providerThreadId}
      disabled={!hasDetails}
      aria-label={hasDetails ? `Open ${subagent.title ?? "subagent"} details` : undefined}
    >
      <SubagentStatusIndicator subagent={subagent} />
      <span className="inline-flex min-w-0 max-w-full items-baseline gap-1 overflow-hidden">
        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
          {subagent.title ?? subagent.nickname ?? subagent.role ?? "Subagent"}
        </span>
        {subagent.model ? (
          <span className="shrink-0 rounded border border-multi-stroke-tertiary px-1 text-caption text-multi-fg-tertiary">
            {subagent.model}
          </span>
        ) : null}
        {subagent.statusLabel || subagent.latestUpdate ? (
          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-multi-fg-tertiary">
            {subagent.latestUpdate ?? subagent.statusLabel}
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
          )}
          data-subagent-open=""
          aria-hidden="true"
        >
          <IconChevronRightMedium className="size-3" />
        </span>
      ) : null}
    </button>
  );

  if (!hasDetails) {
    return row;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={row} />
      <PopoverPopup
        align="start"
        side="bottom"
        sideOffset={6}
        variant="workbench"
        className="w-[min(520px,calc(100vw-32px))] p-0"
      >
        <SubagentDetailsPopover snapshotState={snapshotState} subagent={subagent} />
      </PopoverPopup>
    </Popover>
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

function SubagentDetailsPopover({
  snapshotState,
  subagent,
}: {
  snapshotState: SubagentSnapshotState;
  subagent: WorkLogSubagent;
}) {
  const logs = subagent.logs ?? [];
  return (
    <div
      className="flex max-h-[min(420px,60vh)] min-w-0 flex-col overflow-hidden"
      data-subagent-thread-overlay=""
    >
      <div className="border-b border-multi-stroke-tertiary px-3 py-2">
        <div className="min-w-0 truncate text-detail font-medium text-multi-fg-primary">
          {subagent.title ?? subagent.nickname ?? subagent.role ?? "Subagent"}
        </div>
        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5 text-caption text-multi-fg-tertiary">
          {subagent.statusLabel ? <span>{subagent.statusLabel}</span> : null}
          {subagent.model ? <span>{subagent.model}</span> : null}
          {subagent.usedTokens !== undefined && subagent.usedTokens > 0 ? (
            <span>{formatSubagentUsageLabel(subagent)}</span>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 overflow-y-auto px-2 py-1.5">
        {logs.length > 0 ? (
          <div className="pb-1">
            <div className="px-1.5 pb-1 text-caption font-medium text-multi-fg-tertiary">
              Live log
            </div>
            {logs.map((log) => (
              <SubagentLogRow key={log.id} log={log} />
            ))}
          </div>
        ) : null}
        <SubagentSnapshotSection snapshotState={snapshotState} />
      </div>
    </div>
  );
}

function SubagentSnapshotSection({
  snapshotState,
}: {
  snapshotState: SubagentSnapshotState;
}) {
  if (snapshotState.status === "idle" || snapshotState.status === "loading") {
    return (
      <div className="px-1.5 py-1 text-detail text-multi-fg-tertiary">
        {snapshotState.status === "loading" ? "Loading thread snapshot..." : "Thread snapshot"}
      </div>
    );
  }

  if (snapshotState.status === "error") {
    return (
      <div className="px-1.5 py-1 text-detail text-multi-fg-red-primary">
        {snapshotState.message}
      </div>
    );
  }

  const turns = snapshotState.snapshot.turns;
  return (
    <div className="pt-1" data-subagent-thread-snapshot="">
      <div className="px-1.5 pb-1 text-caption font-medium text-multi-fg-tertiary">
        Thread snapshot
      </div>
      {turns.length === 0 ? (
        <div className="px-1.5 py-1 text-detail text-multi-fg-tertiary">No turns found.</div>
      ) : (
        turns.map((turn, turnIndex) => (
          <div key={turn.id} className="min-w-0 rounded px-1.5 py-1">
            <div className="text-caption text-multi-fg-tertiary tabular-nums">
              Turn {turnIndex + 1}
            </div>
            <div className="mt-1 flex min-w-0 flex-col gap-1">
              {turn.items.map((item, itemIndex) => (
                <SubagentSnapshotItem
                  key={`${turn.id}:${snapshotItemKey(item, itemIndex)}`}
                  item={item}
                />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function SubagentSnapshotItem({ item }: { item: unknown }) {
  const label = snapshotItemLabel(item);
  const detail = snapshotItemDetail(item);
  return (
    <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-2 text-detail">
      <span className="mt-1.5 size-1 rounded-full bg-multi-icon-tertiary" aria-hidden="true" />
      <div className="min-w-0">
        <div className="truncate text-multi-fg-secondary">{label}</div>
        {detail ? (
          <div className="mt-0.5 line-clamp-3 min-w-0 whitespace-pre-wrap break-words text-multi-fg-tertiary">
            {detail}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SubagentLogRow({ log }: { log: WorkLogSubagentLog }) {
  return (
    <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-2 rounded px-1.5 py-1 text-detail">
      <span className="mt-1 size-1.5 rounded-full bg-multi-icon-tertiary" aria-hidden="true" />
      <div className="min-w-0">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="shrink-0 text-multi-fg-secondary">{log.label}</span>
          {log.status ? (
            <span className="shrink-0 text-caption text-multi-fg-tertiary">{log.status}</span>
          ) : null}
        </div>
        {log.detail ? (
          <div className="mt-0.5 line-clamp-3 min-w-0 overflow-hidden whitespace-pre-wrap break-words text-multi-fg-tertiary">
            {log.detail}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function snapshotItemKey(item: unknown, fallbackIndex: number): string {
  const record = asRecord(item);
  const id = asTrimmedString(record?.id) ?? asTrimmedString(record?.itemId);
  return id ?? String(fallbackIndex);
}

function snapshotItemLabel(item: unknown): string {
  const record = asRecord(item);
  const nested = asRecord(record?.item);
  const type = asTrimmedString(record?.type) ?? asTrimmedString(nested?.type);
  return type ? formatSnapshotTypeLabel(type) : "Item";
}

function snapshotItemDetail(item: unknown): string | undefined {
  const record = asRecord(item);
  const nested = asRecord(record?.item);
  return (
    firstString(record, ["text", "message", "content", "delta", "command", "prompt", "summary"]) ??
    firstString(nested, ["text", "message", "content", "delta", "command", "prompt", "summary"]) ??
    textFromContentArray(record?.content) ??
    textFromContentArray(nested?.content)
  );
}

function formatSnapshotTypeLabel(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function firstString(
  record: Record<string, unknown> | null,
  keys: ReadonlyArray<string>,
): string | undefined {
  if (!record) {
    return undefined;
  }
  for (const key of keys) {
    const value = asTrimmedString(record[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function textFromContentArray(value: unknown): string | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const text = value
    .map((entry) => {
      if (typeof entry === "string") {
        return entry;
      }
      const record = asRecord(entry);
      return firstString(record, ["text", "content"]);
    })
    .filter((entry): entry is string => entry !== undefined && entry.trim().length > 0)
    .join("\n")
    .trim();
  return text.length > 0 ? text : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
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
