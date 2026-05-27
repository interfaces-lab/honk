import {
  type ProviderThreadSnapshot,
  type ProviderThreadSnapshotItem,
  type ThreadId,
} from "@multi/contracts";
import { IconCrossSmall } from "central-icons";
import { memo, useEffect, useMemo, useState } from "react";
import ChatMarkdown from "../markdown/chat-markdown";
import { ChatMessageBubble } from "../message/message-surface";
import { ExpandableToolMetadataLine, ToolCallLine } from "../message/tool-renderer";
import { cn } from "~/lib/utils";
import { readEnvironmentApi } from "~/environment-api";
import {
  type SubagentTranscriptItem,
  type WorkLogSubagentLog,
} from "../../../session-logic";
import {
  isSubagentPreviewLogVisible,
  subagentPreviewKey,
  useSubagentPreviewStore,
  type SubagentPreviewSelection,
} from "../../../stores/subagent-preview-store";

const EMPTY_SUBAGENT_LOGS: ReadonlyArray<WorkLogSubagentLog> = [];
const EMPTY_SUBAGENT_TRANSCRIPT_ITEMS: ReadonlyArray<SubagentTranscriptItem> = [];

export const SubagentPreviewTrayStack = memo(function SubagentPreviewTrayStack(props: {
  activeThreadId: ThreadId | null;
  compact: boolean;
  visible: boolean;
}) {
  const focus = useSubagentPreviewStore((state) => state.focus);
  const closePreview = useSubagentPreviewStore((state) => state.closePreview);
  const setPreviewPresented = useSubagentPreviewStore((state) => state.setPreviewPresented);
  const previewKey = focus?.key ?? null;
  const previewActiveThreadId = focus?.activeThreadId ?? null;
  const belongsToActiveThread =
    props.activeThreadId !== null && previewActiveThreadId === props.activeThreadId;
  const presented = focus !== null && belongsToActiveThread && props.visible;
  const activeThreadSync = (
    <SubagentPreviewActiveThreadSync
      key={`${props.activeThreadId ?? ""}:${previewKey ?? ""}:${belongsToActiveThread ? "1" : "0"}:${presented ? "1" : "0"}`}
      belongsToActiveThread={belongsToActiveThread}
      closePreview={closePreview}
      setPreviewPresented={setPreviewPresented}
      presented={presented}
      previewKey={previewKey}
    />
  );

  if (!focus || !belongsToActiveThread || !props.visible) {
    return activeThreadSync;
  }

  return (
    <>
      {activeThreadSync}
      <div
        className={cn("relative w-full min-w-0", props.compact ? "mx-auto w-full" : "")}
        data-subagent-followup-tray-stack=""
      >
        <div
          className={cn("font-multi text-conversation", props.compact ? "w-full" : "")}
          data-subagent-followup-tray=""
          data-subagent-preview-open=""
        >
          <SubagentPreviewTray selection={focus} onClose={closePreview} />
        </div>
      </div>
    </>
  );
});

function SubagentPreviewActiveThreadSync({
  belongsToActiveThread,
  closePreview,
  setPreviewPresented,
  presented,
  previewKey,
}: {
  belongsToActiveThread: boolean;
  closePreview: () => void;
  setPreviewPresented: (presented: boolean) => void;
  presented: boolean;
  previewKey: string | null;
}) {
  useEffect(() => {
    setPreviewPresented(previewKey !== null && presented);
    if (previewKey !== null && !belongsToActiveThread) {
      closePreview();
    }
  }, [belongsToActiveThread, closePreview, presented, previewKey, setPreviewPresented]);

  return null;
}

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
      <SubagentPreviewBody key={subagentPreviewBodyKey(selection)} selection={selection} />
    </div>
  );
});

function subagentPreviewBodyKey(selection: SubagentPreviewSelection): string {
  const subagent = selection.subagent;
  return [
    selection.activeThreadId,
    selection.environmentId,
    subagentPreviewKey(subagent),
    subagent.providerThreadId?.trim() ?? "",
    subagent.isActive === true ? "1" : "0",
  ].join("\u001f");
}

type SubagentSnapshotState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly snapshot: ProviderThreadSnapshot }
  | { readonly status: "error"; readonly message: string };

const SubagentPreviewBody = memo(function SubagentPreviewBody(props: {
  selection: SubagentPreviewSelection;
}) {
  const { activeThreadId, environmentId, projectRoot, subagent } = props.selection;
  const [snapshotState, setSnapshotState] = useState<SubagentSnapshotState>({ status: "idle" });
  const providerThreadId = subagent.providerThreadId?.trim();
  const canReadTranscript = (providerThreadId?.length ?? 0) > 0;
  const transcriptItems = subagent.transcriptItems ?? EMPTY_SUBAGENT_TRANSCRIPT_ITEMS;
  const hasActivityTranscript = transcriptItems.length > 0;
  const hasSnapshotTranscript =
    snapshotState.status === "loaded" && snapshotHasItems(snapshotState.snapshot);
  const hasCanonicalTranscript = hasActivityTranscript || hasSnapshotTranscript;
  const logs = subagent.logs ?? EMPTY_SUBAGENT_LOGS;
  const runningLogs = useMemo(
    () => deriveVisibleSubagentLogs(logs, hasCanonicalTranscript),
    [hasCanonicalTranscript, logs],
  );
  const streamingLogId = runningLogs.at(-1)?.id;

  useEffect(() => {
    if (!canReadTranscript || !providerThreadId || hasActivityTranscript) {
      return;
    }

    const api = readEnvironmentApi(environmentId);
    if (!api) {
      setSnapshotState({ status: "error", message: "Environment API unavailable." });
      return;
    }

    let cancelled = false;

    setSnapshotState((current) => (current.status === "loaded" ? current : { status: "loading" }));

    void api.orchestration
      .getProviderThreadSnapshot({
        threadId: activeThreadId,
        providerThreadId,
        includeTurns: true,
      })
      .then((snapshot) => {
        if (cancelled) {
          return;
        }
        setSnapshotState({ status: "loaded", snapshot });
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setSnapshotState({
          status: "error",
          message: error instanceof Error ? error.message : "Failed to load thread snapshot.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [activeThreadId, canReadTranscript, environmentId, hasActivityTranscript, providerThreadId]);

  return (
    <div
      data-subagent-preview-body=""
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-(--chat-timeline-step-gap) overflow-y-auto overscroll-contain px-3 py-2 text-conversation text-multi-fg-primary"
    >
      {hasActivityTranscript ? (
        <SubagentActivityTranscriptSection
          isStreaming={subagent.isActive === true}
          items={transcriptItems}
          projectRoot={projectRoot}
        />
      ) : canReadTranscript ? (
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
      {!hasActivityTranscript && !canReadTranscript && runningLogs.length === 0 ? (
        <div className="py-1 text-detail text-multi-fg-tertiary">No thread content yet.</div>
      ) : null}
    </div>
  );
});

const SubagentActivityTranscriptSection = memo(function SubagentActivityTranscriptSection({
  isStreaming,
  items,
  projectRoot,
}: {
  isStreaming: boolean;
  items: ReadonlyArray<SubagentTranscriptItem>;
  projectRoot: string | undefined;
}) {
  return (
    <div
      data-subagent-activity-transcript=""
      className="flex min-w-0 flex-col gap-(--chat-timeline-step-gap)"
    >
      {items.map((item, index) => (
        <SubagentTranscriptItemRow
          key={item.id}
          isStreaming={isStreaming && index === items.length - 1 && item.loading}
          item={item}
          projectRoot={projectRoot}
        />
      ))}
    </div>
  );
});

const SubagentTranscriptItemRow = memo(function SubagentTranscriptItemRow({
  isStreaming,
  item,
  projectRoot,
}: {
  isStreaming: boolean;
  item: SubagentTranscriptItem;
  projectRoot: string | undefined;
}) {
  const detail = item.text;

  if (item.kind === "message" && item.role === "assistant" && detail) {
    return (
      <div className="min-w-0 select-text">
        <ChatMarkdown cwd={projectRoot} isStreaming={isStreaming} text={detail} />
      </div>
    );
  }

  if (item.kind === "message" && item.role === "user" && detail) {
    return (
      <ChatMessageBubble
        role="user"
        body={<SubagentUserMessageBody detail={detail} title={item.title} />}
      />
    );
  }

  return (
    <SubagentActivityLine
      action={item.title ?? formatSnapshotTypeLabel(item.itemType ?? item.kind)}
      detail={detail}
      loading={isStreaming}
    />
  );
});

const SubagentSnapshotSection = memo(function SubagentSnapshotSection({
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
});

const SubagentSnapshotItem = memo(function SubagentSnapshotItem({
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
      <ChatMessageBubble
        role="user"
        body={<SubagentUserMessageBody detail={detail} title={item.title} />}
      />
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
});

const SubagentUserMessageBody = memo(function SubagentUserMessageBody({
  detail,
  title,
}: {
  detail: string;
  title: string | undefined;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {title ? (
        <div className="select-none text-caption font-medium text-multi-fg-tertiary">{title}</div>
      ) : null}
      <div className="min-w-0 whitespace-pre-wrap break-words wrap-anywhere">{detail}</div>
    </div>
  );
});

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

function snapshotHasItems(snapshot: ProviderThreadSnapshot): boolean {
  return snapshot.turns.some((turn) => turn.items.length > 0);
}

function formatSnapshotTypeLabel(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function deriveVisibleSubagentLogs(
  logs: ReadonlyArray<WorkLogSubagentLog>,
  hasCanonicalTranscript: boolean,
): ReadonlyArray<WorkLogSubagentLog> {
  const visibleLogs: WorkLogSubagentLog[] = [];
  for (const log of logs) {
    if (!isSubagentPreviewLogVisible(log, hasCanonicalTranscript)) {
      continue;
    }
    visibleLogs.push(log);
  }
  return visibleLogs.slice(-80);
}
