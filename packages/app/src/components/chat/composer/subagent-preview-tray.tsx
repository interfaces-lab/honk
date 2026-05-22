import { type ProviderThreadSnapshot, type ProviderThreadSnapshotItem } from "@multi/contracts";
import { IconCrossSmall } from "central-icons";
import { memo, useEffect, useState } from "react";
import ChatMarkdown from "../markdown/chat-markdown";
import { ExpandableToolMetadataLine, ToolCallLine } from "../message/tool-renderer";
import { cn } from "~/lib/utils";
import { readEnvironmentApi } from "~/environment-api";
import { type WorkLogSubagentLog } from "../../../session-logic";
import {
  subagentPreviewKey,
  useSubagentPreviewStore,
  type SubagentPreviewSelection,
} from "../../../stores/subagent-preview-store";

export const SubagentPreviewTrayStack = memo(function SubagentPreviewTrayStack(props: {
  compact: boolean;
}) {
  const preview = useSubagentPreviewStore((state) => state.preview);
  const closePreview = useSubagentPreviewStore((state) => state.closePreview);

  if (!preview) {
    return null;
  }

  return (
    <div
      className={cn("relative w-full min-w-0", props.compact ? "mx-auto w-full" : "")}
      data-subagent-followup-tray-stack=""
    >
      <div
        className={cn("font-multi text-conversation", props.compact ? "w-full" : "")}
        data-subagent-followup-tray=""
        data-subagent-preview-open=""
      >
        <SubagentPreviewTray selection={preview} onClose={closePreview} />
      </div>
    </div>
  );
});

const SubagentPreviewTray = memo(function SubagentPreviewTray(props: {
  selection: SubagentPreviewSelection;
  onClose: () => void;
}) {
  const { selection, onClose } = props;
  const subagent = selection.subagent;
  const title = subagent.title ?? subagent.nickname ?? subagent.role ?? "Subagent";

  return (
    <div
      className="flex w-full min-w-0 flex-col overflow-hidden text-multi-fg-primary"
      data-subagent-preview-container=""
      data-subagent-provider-thread-id={subagent.providerThreadId}
    >
      <div
        className="flex min-w-0 shrink-0 items-center gap-2 px-3 py-2"
        data-subagent-preview-header=""
      >
        <div
          className="min-w-0 flex-1 truncate text-title font-medium text-multi-fg-primary"
          title={title}
        >
          {title}
        </div>
        <button
          type="button"
          className="flex size-6 shrink-0 items-center justify-center rounded-multi-control border-0 bg-transparent text-multi-icon-secondary transition-colors hover:text-multi-icon-primary focus-visible:ring-1 focus-visible:ring-multi-stroke-focused focus-visible:outline-none"
          aria-label="Close subagent preview"
          title="Close subagent preview"
          onClick={onClose}
        >
          <IconCrossSmall className="size-3.5" aria-hidden="true" />
        </button>
      </div>
      <SubagentPreviewBody selection={selection} />
    </div>
  );
});

type SubagentSnapshotState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly snapshot: ProviderThreadSnapshot }
  | { readonly status: "error"; readonly message: string };

const SubagentPreviewBody = memo(function SubagentPreviewBody(props: {
  selection: SubagentPreviewSelection;
}) {
  const { activeThreadId, environmentId, projectRoot, subagent } = props.selection;
  const previewKey = subagentPreviewKey(subagent);
  const isActive = subagent.isActive === true;
  const [snapshotState, setSnapshotState] = useState<SubagentSnapshotState>({ status: "idle" });
  const logs = aggregateSubagentLogs(subagent.logs ?? []);
  const providerThreadId = subagent.providerThreadId?.trim();
  const canReadTranscript = (providerThreadId?.length ?? 0) > 0;
  const runningLogs = filterVisibleSubagentLogs(logs, canReadTranscript);
  const streamingLogId = runningLogs.at(-1)?.id;

  useEffect(() => {
    setSnapshotState({ status: "idle" });
  }, [isActive, previewKey, providerThreadId]);

  useEffect(() => {
    if (!canReadTranscript || !providerThreadId) {
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
  }, [activeThreadId, canReadTranscript, environmentId, isActive, previewKey, providerThreadId]);

  return (
    <div
      data-subagent-preview-body=""
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-(--chat-timeline-step-gap) overflow-y-auto overscroll-contain px-3 py-2 text-conversation text-multi-fg-primary"
    >
      {canReadTranscript ? (
        <SubagentSnapshotSection
          isStreaming={subagent.isActive === true}
          projectRoot={projectRoot}
          snapshotState={snapshotState}
        />
      ) : null}
      {runningLogs.length > 0 ? (
        <div
          data-subagent-running-log=""
          className="flex min-w-0 flex-col gap-(--chat-timeline-step-gap)"
        >
          {runningLogs.map((log) => (
            <SubagentActivityLine
              key={log.id}
              action={log.label}
              detail={log.detail}
              loading={log.id === streamingLogId}
            />
          ))}
        </div>
      ) : null}
      {!canReadTranscript && runningLogs.length === 0 ? (
        <div className="py-1 text-detail text-multi-fg-tertiary">No thread content yet.</div>
      ) : null}
    </div>
  );
});

function SubagentSnapshotSection({
  isStreaming,
  projectRoot,
  snapshotState,
}: {
  isStreaming: boolean;
  projectRoot: string | undefined;
  snapshotState: SubagentSnapshotState;
}) {
  if (snapshotState.status === "idle" || snapshotState.status === "loading") {
    return (
      <div className="py-1 text-detail text-multi-fg-tertiary">
        {snapshotState.status === "loading" ? "Loading..." : null}
      </div>
    );
  }

  if (snapshotState.status === "error") {
    return (
      <div className="py-1 text-detail text-multi-fg-red-primary">{snapshotState.message}</div>
    );
  }

  const turns = snapshotState.snapshot.turns;
  if (turns.length === 0) {
    return null;
  }

  return (
    <div
      data-subagent-thread-snapshot=""
      className="flex min-w-0 flex-col gap-(--chat-timeline-step-gap)"
    >
      {turns.map((turn, turnIndex) => (
        <div key={turn.id} className="flex min-w-0 flex-col gap-(--chat-timeline-step-gap)">
          {turn.items.map((item, itemIndex) => (
            <SubagentSnapshotItem
              key={item.id ?? `${turn.id}:${itemIndex}`}
              isStreaming={
                isStreaming && turnIndex === turns.length - 1 && itemIndex === turn.items.length - 1
              }
              item={item}
              projectRoot={projectRoot}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function SubagentSnapshotItem({
  isStreaming,
  item,
  projectRoot,
}: {
  isStreaming: boolean;
  item: ProviderThreadSnapshotItem;
  projectRoot: string | undefined;
}) {
  const detail = item.detail;

  if (item.role === "assistant" && detail) {
    return (
      <div className="min-w-0 select-text">
        <ChatMarkdown cwd={projectRoot} isStreaming={isStreaming} text={detail} />
      </div>
    );
  }

  if (item.role === "user" && detail) {
    return (
      <div className="min-w-0 select-text whitespace-pre-wrap break-words text-conversation text-multi-fg-primary">
        {detail}
      </div>
    );
  }

  if (item.role === "assistant" || item.role === "user") {
    return null;
  }

  return (
    <SubagentActivityLine
      action={item.title ?? formatSnapshotTypeLabel(item.itemType)}
      detail={detail}
      loading={isStreaming}
    />
  );
}

const SubagentActivityLine = memo(function SubagentActivityLine({
  action,
  detail,
  loading = false,
}: {
  action: string;
  detail?: string | undefined;
  loading?: boolean | undefined;
}) {
  const body = detail?.trim();
  if (body && shouldExpandSubagentActivityDetail(body)) {
    return (
      <ExpandableToolMetadataLine
        icon={undefined}
        action={action}
        details=""
        output={body}
        loading={loading}
        defaultExpanded={loading}
      />
    );
  }

  return <ToolCallLine action={action} details={body ?? ""} loading={loading} />;
});

function shouldExpandSubagentActivityDetail(detail: string): boolean {
  return detail.includes("\n") || detail.length > 160;
}

function formatSnapshotTypeLabel(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function aggregateSubagentLogs(
  logs: ReadonlyArray<WorkLogSubagentLog>,
): ReadonlyArray<WorkLogSubagentLog> {
  const aggregated: WorkLogSubagentLog[] = [];
  for (const log of logs) {
    const previousIndex = aggregated.length - 1;
    const previous = previousIndex >= 0 ? aggregated[previousIndex] : undefined;
    if (previous && shouldMergeSubagentLog(previous, log)) {
      aggregated[previousIndex] = {
        ...previous,
        id: `${previous.id}:${log.id}`,
        createdAt: log.createdAt,
        detail: mergeStreamText(previous.detail, log.detail),
        status: log.status ?? previous.status,
      };
      continue;
    }
    aggregated.push(log);
  }
  return aggregated.slice(-80);
}

function filterVisibleSubagentLogs(
  logs: ReadonlyArray<WorkLogSubagentLog>,
  hasProviderTranscript: boolean,
): ReadonlyArray<WorkLogSubagentLog> {
  return logs.filter((log) => {
    if (log.kind === "subagent.content.delta") {
      return false;
    }
    if (!hasProviderTranscript) {
      return true;
    }
    if (log.kind === "subagent.thread.state.changed") {
      return false;
    }
    return !isTranscriptItemLog(log);
  });
}

function isTranscriptItemLog(log: WorkLogSubagentLog): boolean {
  switch (log.itemType) {
    case "assistant_message":
    case "user_message":
    case "reasoning":
    case "reasoning_summary":
    case "agent_reasoning":
      return true;
    default:
      return false;
  }
}

function shouldMergeSubagentLog(previous: WorkLogSubagentLog, next: WorkLogSubagentLog): boolean {
  if (previous.kind !== "subagent.content.delta" || next.kind !== "subagent.content.delta") {
    return false;
  }
  if (previous.streamKind !== next.streamKind) {
    return false;
  }
  if (previous.itemId || next.itemId) {
    return previous.itemId === next.itemId;
  }
  return previous.label === next.label;
}

function mergeStreamText(
  previous: string | undefined,
  next: string | undefined,
): string | undefined {
  if (!previous) {
    return next;
  }
  if (!next || next === previous) {
    return previous;
  }
  if (next.startsWith(previous)) {
    return next;
  }
  if (previous.endsWith(next)) {
    return previous;
  }
  return `${previous}${next}`;
}
