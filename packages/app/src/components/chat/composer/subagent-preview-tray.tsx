import {
  isToolLifecycleItemType,
  type EnvironmentId,
  MessageId,
  type ProviderThreadSnapshot,
  type ProviderThreadSnapshotItem,
  type ThreadId,
  type ToolLifecycleItemType,
} from "@multi/contracts";
import { useVirtualizer } from "@tanstack/react-virtual";
import { IconCrossSmall } from "central-icons";
import { memo, type CSSProperties, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { type ChatMessage } from "../../../types";
import { AssistantMessage } from "../message/assistant-message";
import { HumanMessage } from "../message/human-message";
import { ToolCallMessage } from "../message/tool-message";
import {
  ExpandableToolMetadataLine,
  ThinkingStatus,
  ToolCallLine,
} from "../message/tool-renderer";
import { cn } from "~/lib/utils";
import { readEnvironmentApi } from "~/environment-api";
import {
  type SubagentTranscriptItem,
  type WorkLogEntry,
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
const EMPTY_SUBAGENT_SNAPSHOT_ITEMS: ReadonlyArray<SubagentSnapshotListItem> = [];
type WorkLogStatus = NonNullable<WorkLogEntry["status"]>;
const SUBAGENT_TRANSCRIPT_VIRTUALIZE_THRESHOLD = 80;
const SUBAGENT_TRANSCRIPT_ESTIMATE_PX = 44;
const SUBAGENT_TRANSCRIPT_MESSAGE_ESTIMATE_PX = 120;
const SUBAGENT_TRANSCRIPT_VIRTUAL_OVERSCAN = 8;

interface SubagentSnapshotListItem {
  readonly key: string;
  readonly item: ProviderThreadSnapshotItem;
}

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
  const title = subagent.title ?? subagent.nickname ?? subagent.role;

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
        {title ? (
          <div
            className="min-w-0 flex-1 truncate text-title font-medium text-multi-fg-primary"
            title={title}
          >
            {title}
          </div>
        ) : null}
        <button
          type="button"
          className="ml-auto flex size-6 shrink-0 items-center justify-center rounded-multi-control border-0 bg-transparent text-multi-icon-secondary transition-colors hover:text-multi-icon-primary focus-visible:ring-1 focus-visible:ring-multi-stroke-focused focus-visible:outline-none"
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
  const hasActivityTranscript = transcriptItems.some(hasRenderableSubagentTranscriptItem);
  const hasSnapshotTranscript =
    snapshotState.status === "loaded" && snapshotHasItems(snapshotState.snapshot);
  const hasCanonicalTranscript = hasActivityTranscript || hasSnapshotTranscript;
  const logs = subagent.logs ?? EMPTY_SUBAGENT_LOGS;
  const runningLogs = useMemo(
    () => deriveVisibleSubagentLogs(logs, hasCanonicalTranscript),
    [hasCanonicalTranscript, logs],
  );
  const streamingLogId = runningLogs.at(-1)?.id;
  const bodyRef = useRef<HTMLDivElement | null>(null);

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
      ref={bodyRef}
      data-subagent-preview-body=""
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-(--chat-timeline-step-gap) overflow-y-auto overscroll-contain px-3 py-2 text-conversation text-multi-fg-primary"
    >
      {hasActivityTranscript ? (
        <SubagentActivityTranscriptSection
          activeThreadId={activeThreadId}
          environmentId={environmentId}
          isStreaming={subagent.isActive === true}
          items={transcriptItems}
          projectRoot={projectRoot}
          scrollElementRef={bodyRef}
        />
      ) : canReadTranscript ? (
        <SubagentSnapshotSection
          activeThreadId={activeThreadId}
          environmentId={environmentId}
          isStreaming={subagent.isActive === true}
          projectRoot={projectRoot}
          scrollElementRef={bodyRef}
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
  activeThreadId,
  environmentId,
  isStreaming,
  items,
  projectRoot,
  scrollElementRef,
}: {
  activeThreadId: ThreadId;
  environmentId: EnvironmentId;
  isStreaming: boolean;
  items: ReadonlyArray<SubagentTranscriptItem>;
  projectRoot: string | undefined;
  scrollElementRef: RefObject<HTMLDivElement | null>;
}) {
  const rowVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: items.length,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: (index) => estimateSubagentTranscriptItemSize(items[index]),
    getItemKey: (index) => items[index]?.id ?? index,
    overscan: SUBAGENT_TRANSCRIPT_VIRTUAL_OVERSCAN,
    useAnimationFrameWithResizeObserver: true,
  });

  if (items.length >= SUBAGENT_TRANSCRIPT_VIRTUALIZE_THRESHOLD) {
    return (
      <div
        data-subagent-activity-transcript=""
        data-subagent-transcript-virtualized=""
        className="relative min-w-0"
        style={subagentVirtualListStyle(rowVirtualizer.getTotalSize())}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const item = items[virtualRow.index];
          if (!item) {
            return null;
          }

          return (
            <div
              key={virtualRow.key}
              ref={rowVirtualizer.measureElement}
              data-index={virtualRow.index}
              className="absolute top-0 left-0 w-full pb-(--chat-timeline-step-gap)"
              style={subagentVirtualRowStyle(virtualRow.start)}
            >
              <SubagentTranscriptItemRow
                activeThreadId={activeThreadId}
                environmentId={environmentId}
                isStreaming={isStreaming && virtualRow.index === items.length - 1 && item.loading}
                item={item}
                projectRoot={projectRoot}
              />
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div
      data-subagent-activity-transcript=""
      className="flex min-w-0 flex-col gap-(--chat-timeline-step-gap)"
    >
      {items.map((item, index) => (
        <SubagentTranscriptItemRow
          key={item.id}
          activeThreadId={activeThreadId}
          environmentId={environmentId}
          isStreaming={isStreaming && index === items.length - 1 && item.loading}
          item={item}
          projectRoot={projectRoot}
        />
      ))}
    </div>
  );
});

export const SubagentTranscriptItemRow = memo(function SubagentTranscriptItemRow({
  activeThreadId,
  environmentId,
  isStreaming,
  item,
  projectRoot,
}: {
  activeThreadId: ThreadId;
  environmentId: EnvironmentId;
  isStreaming: boolean;
  item: SubagentTranscriptItem;
  projectRoot: string | undefined;
}) {
  const detail = item.text;
  const messageRole = subagentTranscriptMessageRole(item);

  if (messageRole === "assistant") {
    if (!detail) {
      return null;
    }
    return (
      <SubagentAssistantMessage
        createdAt={item.createdAt}
        id={item.itemId}
        isStreaming={isStreaming}
        projectRoot={projectRoot}
        text={detail}
      />
    );
  }

  if (messageRole === "user") {
    if (!detail) {
      return null;
    }
    return <SubagentHumanMessage createdAt={item.createdAt} id={item.itemId} text={detail} />;
  }

  if (isSubagentReasoningTranscriptItem(item)) {
    return detail ? <ThinkingStatus active={isStreaming} task={detail} wrap /> : null;
  }

  if (item.kind === "command") {
    return (
      <SubagentToolTranscriptItem
        activeThreadId={activeThreadId}
        environmentId={environmentId}
        isStreaming={isStreaming}
        item={item}
        projectRoot={projectRoot}
      />
    );
  }

  if (isSubagentToolTranscriptItem(item)) {
    return (
      <SubagentToolTranscriptItem
        activeThreadId={activeThreadId}
        environmentId={environmentId}
        isStreaming={isStreaming}
        item={item}
        projectRoot={projectRoot}
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
  activeThreadId,
  environmentId,
  isStreaming,
  projectRoot,
  scrollElementRef,
  snapshotState,
}: {
  activeThreadId: ThreadId;
  environmentId: EnvironmentId;
  isStreaming: boolean;
  projectRoot: string | undefined;
  scrollElementRef: RefObject<HTMLDivElement | null>;
  snapshotState: SubagentSnapshotState;
}) {
  const snapshotItems = useMemo(
    () =>
      snapshotState.status === "loaded"
        ? flattenSubagentSnapshotItems(snapshotState.snapshot.turns)
        : EMPTY_SUBAGENT_SNAPSHOT_ITEMS,
    [snapshotState],
  );
  const rowVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: snapshotItems.length,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: (index) => estimateSubagentSnapshotItemSize(snapshotItems[index]?.item),
    getItemKey: (index) => snapshotItems[index]?.key ?? index,
    overscan: SUBAGENT_TRANSCRIPT_VIRTUAL_OVERSCAN,
    useAnimationFrameWithResizeObserver: true,
  });

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

  if (snapshotItems.length === 0) {
    return null;
  }

  if (snapshotItems.length >= SUBAGENT_TRANSCRIPT_VIRTUALIZE_THRESHOLD) {
    return (
      <div
        data-subagent-thread-snapshot=""
        data-subagent-transcript-virtualized=""
        className="relative min-w-0"
        style={subagentVirtualListStyle(rowVirtualizer.getTotalSize())}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const snapshotItem = snapshotItems[virtualRow.index];
          if (!snapshotItem) {
            return null;
          }

          return (
            <div
              key={virtualRow.key}
              ref={rowVirtualizer.measureElement}
              data-index={virtualRow.index}
              className="absolute top-0 left-0 w-full pb-(--chat-timeline-step-gap)"
              style={subagentVirtualRowStyle(virtualRow.start)}
            >
              <SubagentSnapshotItem
                activeThreadId={activeThreadId}
                environmentId={environmentId}
                isStreaming={isStreaming && virtualRow.index === snapshotItems.length - 1}
                item={snapshotItem.item}
                projectRoot={projectRoot}
              />
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div
      data-subagent-thread-snapshot=""
      className="flex min-w-0 flex-col gap-(--chat-timeline-step-gap)"
    >
      {snapshotItems.map((snapshotItem, index) => (
        <SubagentSnapshotItem
          key={snapshotItem.key}
          activeThreadId={activeThreadId}
          environmentId={environmentId}
          isStreaming={isStreaming && index === snapshotItems.length - 1}
          item={snapshotItem.item}
          projectRoot={projectRoot}
        />
      ))}
    </div>
  );
});

function flattenSubagentSnapshotItems(
  turns: ProviderThreadSnapshot["turns"],
): ReadonlyArray<SubagentSnapshotListItem> {
  return turns.flatMap((turn) =>
    turn.items.map((item, itemIndex) => ({
      key: item.id ?? `${turn.id}:${itemIndex}`,
      item,
    })),
  );
}

function estimateSubagentTranscriptItemSize(item: SubagentTranscriptItem | undefined): number {
  if (!item) {
    return SUBAGENT_TRANSCRIPT_ESTIMATE_PX;
  }
  if (subagentTranscriptMessageRole(item)) {
    return SUBAGENT_TRANSCRIPT_MESSAGE_ESTIMATE_PX;
  }
  if (item.kind === "command" || isSubagentToolTranscriptItem(item)) {
    return SUBAGENT_TRANSCRIPT_ESTIMATE_PX;
  }
  if (isSubagentReasoningTranscriptItem(item)) {
    return SUBAGENT_TRANSCRIPT_ESTIMATE_PX;
  }
  return SUBAGENT_TRANSCRIPT_ESTIMATE_PX;
}

function estimateSubagentSnapshotItemSize(
  item: ProviderThreadSnapshotItem | undefined,
): number {
  if (!item) {
    return SUBAGENT_TRANSCRIPT_ESTIMATE_PX;
  }
  if (subagentSnapshotMessageRole(item)) {
    return SUBAGENT_TRANSCRIPT_MESSAGE_ESTIMATE_PX;
  }
  return SUBAGENT_TRANSCRIPT_ESTIMATE_PX;
}

function subagentVirtualListStyle(height: number): CSSProperties {
  return { height, position: "relative" };
}

function subagentVirtualRowStyle(start: number): CSSProperties {
  return { transform: `translateY(${start}px)` };
}

const SubagentSnapshotItem = memo(function SubagentSnapshotItem({
  activeThreadId,
  environmentId,
  isStreaming,
  item,
  projectRoot,
}: {
  activeThreadId: ThreadId;
  environmentId: EnvironmentId;
  isStreaming: boolean;
  item: ProviderThreadSnapshotItem;
  projectRoot: string | undefined;
}) {
  const detail = item.detail;
  const messageRole = subagentSnapshotMessageRole(item);

  if (messageRole === "assistant" && detail) {
    return (
      <SubagentAssistantMessage
        id={item.id ?? "snapshot-assistant-message"}
        isStreaming={isStreaming}
        projectRoot={projectRoot}
        text={detail}
      />
    );
  }

  if (messageRole === "user" && detail) {
    return <SubagentHumanMessage id={item.id ?? `snapshot-user:${detail}`} text={detail} />;
  }

  if (messageRole === "assistant" || messageRole === "user") {
    return null;
  }

  if (isSubagentReasoningSnapshotItem(item)) {
    return detail ? <ThinkingStatus active={isStreaming} task={detail} wrap /> : null;
  }

  if (isSubagentSnapshotToolItem(item)) {
    return (
      <SubagentSnapshotToolItem
        activeThreadId={activeThreadId}
        environmentId={environmentId}
        isStreaming={isStreaming}
        item={item}
        projectRoot={projectRoot}
      />
    );
  }

  return (
    <SubagentActivityLine
      action={item.title ?? formatSnapshotTypeLabel(item.itemType)}
      detail={detail}
      loading={isStreaming}
    />
  );
});

const SubagentAssistantMessage = memo(function SubagentAssistantMessage({
  createdAt = "1970-01-01T00:00:00.000Z",
  id,
  isStreaming,
  projectRoot,
  text,
}: {
  createdAt?: string | undefined;
  id: string;
  isStreaming: boolean;
  projectRoot: string | undefined;
  text: string;
}) {
  const message: ChatMessage = {
    id: MessageId.make(id),
    role: "assistant",
    text,
    createdAt,
    streaming: isStreaming,
  };

  return <AssistantMessage message={message} markdownCwd={projectRoot} />;
});

const SubagentHumanMessage = memo(function SubagentHumanMessage({
  createdAt = "1970-01-01T00:00:00.000Z",
  id,
  text,
}: {
  createdAt?: string | undefined;
  id: string;
  text: string;
}) {
  const message: ChatMessage = {
    id: MessageId.make(id),
    role: "user",
    text,
    createdAt,
    streaming: false,
  };

  return (
    <div className="box-border flex w-full min-w-0 px-0">
      <HumanMessage
        message={message}
        editAvailable={false}
        isEditing={false}
        editDisabled
        isServerThread={false}
        editComposer={null}
        onImageExpand={() => undefined}
        onBeginEditUserMessage={undefined}
      />
    </div>
  );
});

const SubagentToolTranscriptItem = memo(function SubagentToolTranscriptItem({
  activeThreadId,
  environmentId,
  isStreaming,
  item,
  projectRoot,
}: {
  activeThreadId: ThreadId;
  environmentId: EnvironmentId;
  isStreaming: boolean;
  item: SubagentTranscriptItem;
  projectRoot: string | undefined;
}) {
  const workEntry = subagentTranscriptItemToWorkEntry(item, isStreaming);
  if (!workEntry) {
    return null;
  }

  return (
    <ToolCallMessage
      activeThreadId={activeThreadId}
      environmentId={environmentId}
      projectRoot={projectRoot}
      subagentDetailsEnabled={false}
      workEntry={workEntry}
    />
  );
});

const SubagentSnapshotToolItem = memo(function SubagentSnapshotToolItem({
  activeThreadId,
  environmentId,
  isStreaming,
  item,
  projectRoot,
}: {
  activeThreadId: ThreadId;
  environmentId: EnvironmentId;
  isStreaming: boolean;
  item: ProviderThreadSnapshotItem;
  projectRoot: string | undefined;
}) {
  const workEntry = subagentSnapshotItemToWorkEntry(item, isStreaming);
  if (!workEntry) {
    return null;
  }

  return (
    <ToolCallMessage
      activeThreadId={activeThreadId}
      environmentId={environmentId}
      projectRoot={projectRoot}
      subagentDetailsEnabled={false}
      workEntry={workEntry}
    />
  );
});

function isSubagentToolTranscriptItem(item: SubagentTranscriptItem): boolean {
  return isToolLifecycleItemType(item.itemType ?? "");
}

export function hasRenderableSubagentTranscriptItem(item: SubagentTranscriptItem): boolean {
  if (subagentTranscriptMessageRole(item)) {
    return Boolean(item.text?.trim());
  }
  if (isSubagentReasoningTranscriptItem(item) || item.kind === "plan") {
    return Boolean(item.text?.trim());
  }
  if (item.kind === "command") {
    return Boolean(item.command?.trim() || item.output?.trim() || item.text?.trim());
  }
  if (item.itemType === "collab_agent_tool_call") {
    return false;
  }
  if (isSubagentToolTranscriptItem(item)) {
    return true;
  }
  return Boolean(item.text?.trim());
}

function subagentTranscriptMessageRole(
  item: SubagentTranscriptItem,
): "user" | "assistant" | undefined {
  if (item.role === "user" || item.role === "assistant") {
    return item.role;
  }
  switch (item.itemType) {
    case "user_message":
      return "user";
    case "assistant_message":
      return "assistant";
    default:
      break;
  }
  switch (item.title) {
    case "User message":
      return "user";
    case "Assistant message":
      return "assistant";
    default:
      return undefined;
  }
}

function subagentSnapshotMessageRole(
  item: ProviderThreadSnapshotItem,
): "user" | "assistant" | undefined {
  if (item.role === "user" || item.role === "assistant") {
    return item.role;
  }
  switch (item.itemType) {
    case "user_message":
      return "user";
    case "assistant_message":
      return "assistant";
    default:
      break;
  }
  switch (item.title) {
    case "User message":
      return "user";
    case "Assistant message":
      return "assistant";
    default:
      return undefined;
  }
}

function isSubagentReasoningTranscriptItem(item: SubagentTranscriptItem): boolean {
  if (item.kind === "reasoning") {
    return true;
  }
  switch (item.itemType) {
    case "reasoning":
    case "agent_reasoning":
    case "reasoning_summary":
      return true;
    default:
      return item.title === "Reasoning";
  }
}

function isSubagentReasoningSnapshotItem(item: ProviderThreadSnapshotItem): boolean {
  switch (item.itemType) {
    case "reasoning":
      return true;
    default:
      return item.title === "Reasoning";
  }
}

function isSubagentSnapshotToolItem(item: ProviderThreadSnapshotItem): boolean {
  return typeof item.itemType === "string" && isToolLifecycleItemType(item.itemType);
}

function subagentTranscriptItemToWorkEntry(
  item: SubagentTranscriptItem,
  isStreaming: boolean,
): WorkLogEntry | null {
  const itemType =
    item.kind === "command" ? "command_execution" : toToolLifecycleItemType(item.itemType);
  if (!itemType) {
    return null;
  }
  const label = item.title ?? formatSnapshotTypeLabel(itemType);
  const status = resolveSubagentToolStatus(item.status, isStreaming || item.loading);
  return {
    id: `subagent-tool:${item.id}`,
    createdAt: item.createdAt,
    label,
    tone: status === "error" ? "error" : "tool",
    status,
    toolCallId: item.itemId,
    itemType,
    ...(item.text ? { detail: item.text } : {}),
    ...(item.command ? { command: item.command } : {}),
    ...(item.rawCommand ? { rawCommand: item.rawCommand } : {}),
    ...(item.output ? { output: item.output } : {}),
    ...(item.title ? { toolTitle: item.title } : {}),
  };
}

function subagentSnapshotItemToWorkEntry(
  item: ProviderThreadSnapshotItem,
  isStreaming: boolean,
): WorkLogEntry | null {
  const itemType = toToolLifecycleItemType(item.itemType);
  if (!itemType) {
    return null;
  }
  const { command, output } =
    itemType === "command_execution" ? snapshotCommandParts(item) : { command: "", output: null };
  const label = item.title ?? formatSnapshotTypeLabel(itemType);
  const status = resolveSubagentToolStatus(undefined, isStreaming);
  return {
    id: `subagent-snapshot-tool:${item.id ?? label}`,
    createdAt: "1970-01-01T00:00:00.000Z",
    label,
    tone: status === "error" ? "error" : "tool",
    status,
    ...(item.id ? { toolCallId: item.id } : {}),
    itemType,
    ...(item.detail && itemType !== "command_execution" ? { detail: item.detail } : {}),
    ...(command ? { command } : {}),
    ...(output ? { output } : {}),
    ...(item.title ? { toolTitle: item.title } : {}),
  };
}

function toToolLifecycleItemType(value: string | undefined): ToolLifecycleItemType | null {
  return value && isToolLifecycleItemType(value) ? value : null;
}

function resolveSubagentToolStatus(
  status: string | undefined,
  isStreaming: boolean,
): WorkLogStatus {
  if (status === "failed" || status === "error") {
    return "error";
  }
  if (isStreaming || status === "running" || status === "inProgress") {
    return "running";
  }
  return "completed";
}

function snapshotCommandParts(item: ProviderThreadSnapshotItem): {
  command: string;
  output: string | null;
} {
  const data = asRecord(item.data);
  const args = asRecord(data?.args);
  const result = asRecord(data?.result);
  const command =
    asString(data?.command) ??
    asString(data?.cmd) ??
    asString(args?.command) ??
    asString(args?.cmd) ??
    "";
  const output =
    asString(data?.aggregatedOutput) ??
    asString(data?.output) ??
    asString(result?.output) ??
    asString(result?.stdout) ??
    null;
  const detail = item.detail?.trim() ?? "";
  if (command || output || !detail) {
    return { command, output };
  }
  return { command: detail, output: null };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
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
