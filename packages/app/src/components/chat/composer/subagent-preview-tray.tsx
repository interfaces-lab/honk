import {
  isToolLifecycleItemType,
  type EnvironmentId,
  MessageId,
  type ProviderThreadSnapshot,
  type ProviderThreadSnapshotItem,
  type ThreadId,
  type ToolLifecycleItemType,
} from "@multi/contracts";
import { IconCrossSmall } from "central-icons";
import { memo, useEffect, useMemo, useState } from "react";
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
const SUBAGENT_SNAPSHOT_ITEMS_CAP = 200;

export interface SubagentSnapshotListItem {
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
  const renderableTranscriptItems = useMemo(
    () => transcriptItems.filter(hasRenderableSubagentTranscriptItem),
    [transcriptItems],
  );
  const hasActivityTranscript = renderableTranscriptItems.length > 0;
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
          activeThreadId={activeThreadId}
          environmentId={environmentId}
          isStreaming={subagent.isActive === true}
          items={renderableTranscriptItems}
          projectRoot={projectRoot}
        />
      ) : canReadTranscript ? (
        <SubagentSnapshotSection
          activeThreadId={activeThreadId}
          environmentId={environmentId}
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
  activeThreadId,
  environmentId,
  isStreaming,
  items,
  projectRoot,
}: {
  activeThreadId: ThreadId;
  environmentId: EnvironmentId;
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
  snapshotState,
}: {
  activeThreadId: ThreadId;
  environmentId: EnvironmentId;
  isStreaming: boolean;
  projectRoot: string | undefined;
  snapshotState: SubagentSnapshotState;
}) {
  const snapshotItems = useMemo(
    () =>
      snapshotState.status === "loaded"
        ? flattenSubagentSnapshotItems(snapshotState.snapshot.turns).slice(
            -SUBAGENT_SNAPSHOT_ITEMS_CAP,
          )
        : EMPTY_SUBAGENT_SNAPSHOT_ITEMS,
    [snapshotState],
  );

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

export function flattenSubagentSnapshotItems(
  turns: ProviderThreadSnapshot["turns"],
): ReadonlyArray<SubagentSnapshotListItem> {
  const orderedKeys: string[] = [];
  const itemsByKey = new Map<string, SubagentSnapshotListItem>();

  for (const turn of turns) {
    turn.items.forEach((item, itemIndex) => {
      if (!hasRenderableSubagentSnapshotItem(item)) {
        return;
      }

      const key = subagentSnapshotCanonicalKey(String(turn.id), item, itemIndex);
      const existing = itemsByKey.get(key);
      if (!existing) {
        orderedKeys.push(key);
        itemsByKey.set(key, { key, item });
        return;
      }

      itemsByKey.set(key, { key, item: mergeSubagentSnapshotItem(existing.item, item) });
    });
  }

  return orderedKeys.flatMap((key) => {
    const item = itemsByKey.get(key);
    return item ? [item] : [];
  });
}

function subagentSnapshotCanonicalKey(
  turnId: string,
  item: ProviderThreadSnapshotItem,
  itemIndex: number,
): string {
  const payloadItemId = extractSnapshotPayloadItemId(item);
  const toolCallId = extractSnapshotPayloadToolCallId(item);
  const providerItemId = item.id?.trim();
  const stableItemId = toolCallId ?? payloadItemId ?? providerItemId ?? String(itemIndex);
  return `${turnId}\u001f${item.itemType}\u001f${stableItemId}`;
}

function mergeSubagentSnapshotItem(
  previous: ProviderThreadSnapshotItem,
  next: ProviderThreadSnapshotItem,
): ProviderThreadSnapshotItem {
  const previousDetail = subagentSnapshotDisplayDetail(previous);
  const nextDetail = subagentSnapshotDisplayDetail(next);
  const detail = mergeSubagentSnapshotDetail(previousDetail, nextDetail);
  const data = shouldPreferNextSnapshotData(previous, next)
    ? (next.data ?? previous.data)
    : (previous.data ?? next.data);

  return {
    ...previous,
    ...next,
    ...(previous.title && !next.title ? { title: previous.title } : {}),
    ...(detail ? { detail } : {}),
    ...(data !== undefined ? { data } : {}),
  };
}

function mergeSubagentSnapshotDetail(
  previous: string | undefined,
  next: string | undefined,
): string | undefined {
  if (!previous) {
    return next;
  }
  if (!next || next === previous || previous.startsWith(next) || previous.endsWith(next)) {
    return previous;
  }
  if (next.startsWith(previous)) {
    return next;
  }
  return next.length >= previous.length ? next : previous;
}

function shouldPreferNextSnapshotData(
  previous: ProviderThreadSnapshotItem,
  next: ProviderThreadSnapshotItem,
): boolean {
  if (next.itemType === "command_execution" || previous.itemType === "command_execution") {
    const previousCommand = snapshotCommandParts(previous);
    const nextCommand = snapshotCommandParts(next);
    if (nextCommand.output && !previousCommand.output) {
      return true;
    }
    if (nextCommand.command && !previousCommand.command) {
      return true;
    }
  }

  const previousLength = subagentSnapshotDisplayDetail(previous)?.length ?? 0;
  const nextLength = subagentSnapshotDisplayDetail(next)?.length ?? 0;
  return nextLength >= previousLength;
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
  const detail = subagentSnapshotDisplayDetail(item);
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

export function hasRenderableSubagentSnapshotItem(item: ProviderThreadSnapshotItem): boolean {
  if (subagentSnapshotMessageRole(item)) {
    return Boolean(subagentSnapshotDisplayDetail(item)?.trim());
  }
  if (isSubagentReasoningSnapshotItem(item) || item.itemType === "plan") {
    return Boolean(subagentSnapshotDisplayDetail(item)?.trim());
  }
  if (isSubagentSnapshotToolItem(item)) {
    return true;
  }
  return Boolean(subagentSnapshotDisplayDetail(item)?.trim());
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

export function subagentSnapshotDisplayDetail(
  item: ProviderThreadSnapshotItem,
): string | undefined {
  const itemText = extractSnapshotPayloadItemText(item);
  if (shouldPreferRawSnapshotItemText(item.itemType) && itemText) {
    return itemText;
  }
  return item.detail ?? itemText;
}

function extractSnapshotPayloadItemText(item: ProviderThreadSnapshotItem): string | undefined {
  const data = asRecord(item.data);
  const dataItem = asRecord(data?.item) ?? data;
  const text = asString(dataItem?.text);
  if (text) {
    return text;
  }
  return extractSnapshotContentText(dataItem?.content);
}

function extractSnapshotPayloadItemId(item: ProviderThreadSnapshotItem): string | undefined {
  const data = asRecord(item.data);
  const dataItem = asRecord(data?.item) ?? data;
  return (
    asString(dataItem?.id) ??
    asString(dataItem?.itemId) ??
    asString(data?.itemId) ??
    asString(data?.providerItemId)
  );
}

function extractSnapshotPayloadToolCallId(item: ProviderThreadSnapshotItem): string | undefined {
  const data = asRecord(item.data);
  const dataItem = asRecord(data?.item) ?? data;
  return (
    asString(dataItem?.toolCallId) ??
    asString(dataItem?.tool_call_id) ??
    asString(dataItem?.callId) ??
    asString(data?.toolCallId) ??
    asString(data?.tool_call_id) ??
    asString(data?.callId)
  );
}

function extractSnapshotContentText(content: unknown): string | undefined {
  if (!Array.isArray(content)) {
    return undefined;
  }
  const text = content
    .map((entry) => {
      if (typeof entry === "string") {
        return entry;
      }
      const record = asRecord(entry);
      const nestedContent = asRecord(record?.content);
      return asString(record?.text) ?? asString(nestedContent?.text);
    })
    .filter((entry): entry is string => entry !== undefined)
    .join("\n")
    .trim();
  return text.length > 0 ? text : undefined;
}

function shouldPreferRawSnapshotItemText(itemType: string): boolean {
  switch (itemType) {
    case "assistant_message":
    case "user_message":
    case "reasoning":
    case "plan":
      return true;
    default:
      return false;
  }
}

function isSubagentReasoningTranscriptItem(item: SubagentTranscriptItem): boolean {
  if (item.kind === "reasoning") {
    return true;
  }
  switch (item.itemType) {
    case "reasoning":
      return true;
    default:
      return item.title === "Reasoning";
  }
}

export function isSubagentReasoningSnapshotItem(item: ProviderThreadSnapshotItem): boolean {
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
  const detail = subagentSnapshotDisplayDetail(item);
  const status = resolveSubagentToolStatus(undefined, isStreaming);
  return {
    id: `subagent-snapshot-tool:${item.id ?? label}`,
    createdAt: "1970-01-01T00:00:00.000Z",
    label,
    tone: status === "error" ? "error" : "tool",
    status,
    ...(item.id ? { toolCallId: item.id } : {}),
    itemType,
    ...(detail && itemType !== "command_execution" ? { detail } : {}),
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
  const dataItem = asRecord(data?.item) ?? data;
  const args = asRecord(dataItem?.args);
  const result = asRecord(dataItem?.result);
  const command =
    asString(dataItem?.command) ??
    asString(dataItem?.cmd) ??
    asString(args?.command) ??
    asString(args?.cmd) ??
    "";
  const output =
    asString(dataItem?.aggregatedOutput) ??
    asString(dataItem?.output) ??
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
  return snapshot.turns.some((turn) => turn.items.some(hasRenderableSubagentSnapshotItem));
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
