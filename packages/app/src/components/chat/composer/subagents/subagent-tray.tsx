import {
  isToolLifecycleItemType,
  type EnvironmentId,
  MessageId,
  type ThreadId,
  type ToolLifecycleItemType,
} from "@honk/contracts";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { IconCrossSmall } from "central-icons";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type RefObject,
} from "react";
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import { Button } from "@honk/honkkit/button";
import { ToolCallLine } from "@honk/honkkit/tool-call";
import { ExpandableToolMetadataLine } from "../../message/tool-renderer";
import { cn } from "~/lib/utils";
import {
  type SubagentTranscriptItem,
  type ToolDisplayArtifact,
  type WorkLogEntry,
  type WorkLogSubagent,
  type WorkLogSubagentLog,
} from "../../../../session-logic";
import { formatSubagentRoleLabel } from "../../../../session/subagents";
import {
  isSubagentTrayLogVisible,
  useSubagentTrayStore,
  type SubagentTraySelection,
} from "../../../../stores/subagent-tray-store";
import {
  refreshSubagentActivityProjection,
  selectSubagentProjection,
  useSubagentActivityStore,
} from "../../../../stores/subagent-activity-store";
import { StepRenderer, type StepRendererContext } from "../../timeline/step-renderer";
import { type TimelineStep } from "../../timeline/timeline-render-items";

const EMPTY_SUBAGENT_LOGS: ReadonlyArray<WorkLogSubagentLog> = [];
const EMPTY_SUBAGENT_TRANSCRIPT_ITEMS: ReadonlyArray<SubagentTranscriptItem> = [];
const DEFAULT_SUBAGENT_TRAY_RECT = { width: 0, height: 360 };
const SUBAGENT_TRANSCRIPT_OVERSCAN = 8;
const SUBAGENT_TRANSCRIPT_ROW_GAP_PX = 8;
const SUBAGENT_TRANSCRIPT_NEAR_BOTTOM_PX = 48;
const SUBAGENT_TRAY_SIDE_OFFSET = 8;
const SUBAGENT_TRAY_COLLISION_AVOIDANCE = {
  side: "shift",
  align: "shift",
  fallbackAxisSide: "none",
} as const;

export type SubagentTrayVirtualRow =
  | {
      readonly kind: "transcript";
      readonly id: string;
      readonly item: SubagentTranscriptItem;
      readonly streaming: boolean;
    }
  | {
      readonly kind: "log";
      readonly id: string;
      readonly log: WorkLogSubagentLog;
      readonly loading: boolean;
    }
  | {
      readonly kind: "empty";
      readonly id: string;
    };

export function SubagentTrayStack(props: {
  activeThreadId: ThreadId | null;
  compact: boolean;
  visible: boolean;
}) {
  const focus = useSubagentTrayStore((state) => state.focus);
  const closeTray = useSubagentTrayStore((state) => state.closeTray);
  const setTrayPresented = useSubagentTrayStore((state) => state.setTrayPresented);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const trayKey = focus?.key ?? null;
  const trayActiveThreadId = focus?.activeThreadId ?? null;
  const belongsToActiveThread =
    props.activeThreadId !== null && trayActiveThreadId === props.activeThreadId;
  const trayRendered = focus !== null && belongsToActiveThread && props.visible;
  const presented = shouldPresentSubagentTray({
    activeThreadId: props.activeThreadId,
    hasFocus: focus !== null,
    trayActiveThreadId,
    visible: props.visible,
  });
  const activeThreadSync = (
    <SubagentTrayActiveThreadSync
      key={`${props.activeThreadId ?? ""}:${trayKey ?? ""}:${belongsToActiveThread ? "1" : "0"}:${presented ? "1" : "0"}`}
      belongsToActiveThread={belongsToActiveThread}
      closeTray={closeTray}
      setTrayPresented={setTrayPresented}
      presented={presented}
      trayKey={trayKey}
    />
  );

  if (!trayRendered || focus === null) {
    return activeThreadSync;
  }

  return (
    <>
      {activeThreadSync}
      <div
        className={cn("relative w-full min-w-0", props.compact ? "mx-auto w-full" : "")}
        data-subagent-followup-tray-stack=""
      >
        <div ref={anchorRef} aria-hidden="true" data-subagent-followup-tray-anchor="" />
        <PopoverPrimitive.Root
          modal={false}
          open
          onOpenChange={(open) => {
            if (!open) {
              closeTray();
            }
          }}
        >
          <PopoverPrimitive.Portal>
            <PopoverPrimitive.Positioner
              anchor={anchorRef}
              align="center"
              collisionAvoidance={SUBAGENT_TRAY_COLLISION_AVOIDANCE}
              positionMethod="fixed"
              side="top"
              sideOffset={SUBAGENT_TRAY_SIDE_OFFSET}
              className="z-(--z-index-workbench-popover)"
            >
              <PopoverPrimitive.Popup
                initialFocus={false}
                finalFocus={false}
                className={cn("font-honk text-conversation", props.compact ? "w-full" : "")}
                data-subagent-followup-tray=""
              >
                <SubagentTray selection={focus} onClose={closeTray} />
              </PopoverPrimitive.Popup>
            </PopoverPrimitive.Positioner>
          </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>
      </div>
    </>
  );
}

export function shouldPresentSubagentTray(input: {
  activeThreadId: ThreadId | null;
  trayActiveThreadId: ThreadId | null;
  hasFocus: boolean;
  visible: boolean;
}): boolean {
  return (
    input.hasFocus &&
    input.visible &&
    input.activeThreadId !== null &&
    input.trayActiveThreadId === input.activeThreadId
  );
}

function SubagentTrayActiveThreadSync({
  belongsToActiveThread,
  closeTray,
  setTrayPresented,
  presented,
  trayKey,
}: {
  belongsToActiveThread: boolean;
  closeTray: () => void;
  setTrayPresented: (presented: boolean) => void;
  presented: boolean;
  trayKey: string | null;
}) {
  useEffect(() => {
    setTrayPresented(trayKey !== null && presented);
    if (trayKey !== null && !belongsToActiveThread) {
      closeTray();
    }
  }, [belongsToActiveThread, closeTray, presented, trayKey, setTrayPresented]);

  return null;
}

function SubagentTray(props: { selection: SubagentTraySelection; onClose: () => void }) {
  const { selection, onClose } = props;
  useEffect(() => {
    refreshSubagentActivityProjection({
      environmentId: selection.environmentId,
      threadId: selection.activeThreadId,
    });
  }, [selection.activeThreadId, selection.environmentId, selection.key]);
  const subagent = useFocusedSubagent(selection);
  const title = subagent?.title ?? subagent?.nickname ?? subagent?.role ?? "Subagent";
  const roleLabel = formatSubagentRoleLabel(subagent?.role);
  const visibleRoleLabel = roleLabel && roleLabel !== title ? roleLabel : undefined;
  const subagentThreadId = subagent?.subagentThreadId ?? selection.subagentThreadId;

  return (
    <div
      className="flex w-full min-w-0 flex-col overflow-hidden text-honk-fg-primary"
      data-subagent-tray-container=""
      data-subagent-thread-id={subagentThreadId}
    >
      <div
        className="flex min-w-0 shrink-0 items-center gap-2 px-3 py-2"
        data-subagent-tray-header=""
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {visibleRoleLabel ? (
            <span
              data-subagent-role=""
              className="shrink-0 text-caption font-medium text-honk-fg-secondary"
              title={subagent?.role}
            >
              {visibleRoleLabel}
            </span>
          ) : null}
          <div
            className="min-w-0 flex-1 truncate text-title font-medium text-honk-fg-primary"
            title={title}
          >
            {title}
          </div>
        </div>
        <Button
          className="ml-auto shrink-0 text-honk-icon-secondary hover:text-honk-icon-primary"
          size="icon-sm"
          variant="ghost"
          aria-label="Close subagent tray"
          title="Close subagent tray"
          onClick={onClose}
        >
          <IconCrossSmall className="size-3.5" aria-hidden="true" />
        </Button>
      </div>
      <SubagentTrayBody
        key={subagentTrayBodyKey(selection)}
        selection={selection}
        subagent={subagent}
      />
    </div>
  );
}

function subagentTrayBodyKey(selection: SubagentTraySelection): string {
  return [
    selection.activeThreadId,
    selection.environmentId,
    selection.key,
    selection.subagentThreadId?.trim() ?? "",
    selection.threadId ?? "",
    selection.agentId ?? "",
  ].join("\u001f");
}

function SubagentTrayBody(props: {
  selection: SubagentTraySelection;
  subagent: WorkLogSubagent | null;
}) {
  const { activeThreadId, environmentId, projectRoot } = props.selection;
  const { subagent } = props;
  const transcriptItems = subagent?.transcriptItems ?? EMPTY_SUBAGENT_TRANSCRIPT_ITEMS;
  const logs = subagent?.logs ?? EMPTY_SUBAGENT_LOGS;
  const renderableTranscriptItems = useMemo(
    () => deriveRenderableSubagentTranscriptItems(transcriptItems),
    [transcriptItems],
  );
  const hasActivityTranscript = renderableTranscriptItems.length > 0;
  const runningLogs = useMemo(
    () => deriveVisibleSubagentLogs(logs, hasActivityTranscript),
    [logs, hasActivityTranscript],
  );
  const streamingLogId = runningLogs.at(-1)?.id;
  const scrollElementRef = useRef<HTMLDivElement | null>(null);
  const isStreaming = subagent?.isActive === true;
  const rows = useMemo(
    () =>
      deriveSubagentTrayVirtualRows({
        items: renderableTranscriptItems,
        isStreaming,
        logs: runningLogs,
        streamingLogId,
      }),
    [isStreaming, renderableTranscriptItems, runningLogs, streamingLogId],
  );

  return (
    <div
      ref={scrollElementRef}
      data-subagent-tray-body=""
      className="min-h-0 min-w-0 flex-1 px-3 py-2 text-conversation text-honk-fg-primary"
    >
      <SubagentTrayVirtualRows
        activeThreadId={activeThreadId}
        environmentId={environmentId}
        isStreaming={isStreaming}
        projectRoot={projectRoot}
        rows={rows}
        scrollElementRef={scrollElementRef}
      />
    </div>
  );
}

export function deriveSubagentTrayVirtualRows(input: {
  items: ReadonlyArray<SubagentTranscriptItem>;
  isStreaming: boolean;
  logs: ReadonlyArray<WorkLogSubagentLog>;
  streamingLogId: string | undefined;
}): ReadonlyArray<SubagentTrayVirtualRow> {
  if (input.items.length === 0 && input.logs.length === 0) {
    return [{ kind: "empty", id: "empty" }];
  }

  const rows: SubagentTrayVirtualRow[] = [];
  const streamingTranscriptItemId = input.isStreaming ? input.items.at(-1)?.id : undefined;
  let itemIndex = 0;
  let logIndex = 0;
  while (itemIndex < input.items.length || logIndex < input.logs.length) {
    const item = input.items[itemIndex];
    const log = input.logs[logIndex];
    if (item && (!log || compareSubagentTranscriptItemToLog(item, log) <= 0)) {
      rows.push(subagentTranscriptItemVirtualRow(item, item.id === streamingTranscriptItemId));
      itemIndex += 1;
      continue;
    }
    if (log) {
      rows.push(subagentLogVirtualRow(log, log.id === input.streamingLogId));
      logIndex += 1;
    }
  }
  return rows;
}

function deriveRenderableSubagentTranscriptItems(
  items: ReadonlyArray<SubagentTranscriptItem>,
): ReadonlyArray<SubagentTranscriptItem> {
  if (items.length === 0) {
    return EMPTY_SUBAGENT_TRANSCRIPT_ITEMS;
  }
  const renderable: SubagentTranscriptItem[] = [];
  for (const item of items) {
    if (hasRenderableSubagentTranscriptItem(item)) {
      renderable.push(item);
    }
  }
  return renderable.length === 0 ? EMPTY_SUBAGENT_TRANSCRIPT_ITEMS : renderable;
}

function subagentTranscriptItemVirtualRow(
  item: SubagentTranscriptItem,
  streaming: boolean,
): SubagentTrayVirtualRow {
  return {
    kind: "transcript",
    id: `transcript:${item.id}`,
    item,
    streaming: streaming && item.loading,
  };
}

function subagentLogVirtualRow(
  log: WorkLogSubagentLog,
  loading: boolean,
): SubagentTrayVirtualRow {
  return {
    kind: "log",
    id: `log:${log.id}`,
    log,
    loading,
  };
}

function compareSubagentTranscriptItemToLog(
  item: SubagentTranscriptItem,
  log: WorkLogSubagentLog,
): number {
  const createdAtOrder = item.createdAt.localeCompare(log.createdAt);
  return createdAtOrder === 0
    ? `transcript:${item.id}`.localeCompare(`log:${log.id}`)
    : createdAtOrder;
}

function useFocusedSubagent(selection: SubagentTraySelection): WorkLogSubagent | null {
  return useSubagentActivityStore((state) => {
    const subagentThreadId = selectedSubagentThreadId(selection);
    if (!subagentThreadId) {
      return null;
    }
    return (
      selectSubagentProjection(state, {
        environmentId: selection.environmentId,
        threadId: selection.activeThreadId,
      }).subagentById[subagentThreadId] ?? null
    );
  });
}

function selectedSubagentThreadId(selection: SubagentTraySelection): string | null {
  return (
    selection.subagentThreadId?.trim() || selection.threadId?.trim() || selection.key.trim() || null
  );
}

function SubagentTrayVirtualRows({
  activeThreadId,
  environmentId,
  isStreaming,
  projectRoot,
  rows,
  scrollElementRef,
}: {
  activeThreadId: ThreadId;
  environmentId: EnvironmentId;
  isStreaming: boolean;
  projectRoot: string | undefined;
  rows: ReadonlyArray<SubagentTrayVirtualRow>;
  scrollElementRef: RefObject<HTMLDivElement | null>;
}) {
  const shouldFollowScrollRef = useRef(true);
  const estimateSize = useCallback(
    (index: number) => estimateSubagentTrayVirtualRowSize(rows[index]),
    [rows],
  );
  const getItemKey = useCallback((index: number) => rows[index]?.id ?? index, [rows]);
  const rowVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rows.length,
    getScrollElement: () => scrollElementRef.current,
    estimateSize,
    getItemKey,
    overscan: SUBAGENT_TRANSCRIPT_OVERSCAN,
    initialRect: DEFAULT_SUBAGENT_TRAY_RECT,
    anchorTo: "end",
    followOnAppend: true,
    scrollEndThreshold: SUBAGENT_TRANSCRIPT_NEAR_BOTTOM_PX,
    useAnimationFrameWithResizeObserver: true,
  });
  const virtualItems = rowVirtualizer.getVirtualItems();
  const virtualContentHeight = rowVirtualizer.getTotalSize();
  const virtualContentStyle = {
    height: virtualContentHeight,
    position: "relative",
  } satisfies CSSProperties;

  useEffect(() => {
    const scrollElement = scrollElementRef.current;
    if (!scrollElement) {
      return;
    }

    const updateShouldFollowScroll = () => {
      shouldFollowScrollRef.current =
        scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight <=
        SUBAGENT_TRANSCRIPT_NEAR_BOTTOM_PX;
    };

    updateShouldFollowScroll();
    scrollElement.addEventListener("scroll", updateShouldFollowScroll, { passive: true });
    return () => scrollElement.removeEventListener("scroll", updateShouldFollowScroll);
  }, [scrollElementRef]);

  useEffect(() => {
    if (!isStreaming || !shouldFollowScrollRef.current || rows.length === 0) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      const scrollElement = scrollElementRef.current;
      if (!scrollElement) {
        return;
      }
      scrollElement.scrollTop = scrollElement.scrollHeight - scrollElement.clientHeight;
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [isStreaming, rows.length, scrollElementRef, virtualContentHeight]);

  return (
    <div
      data-subagent-tray-virtual-content=""
      className="relative min-w-0"
      style={virtualContentStyle}
    >
      {virtualItems.map((virtualRow) => {
        const row = rows[virtualRow.index];
        if (!row) {
          return null;
        }

        return (
          <div
            key={virtualRow.key}
            ref={rowVirtualizer.measureElement}
            data-index={virtualRow.index}
            className="absolute left-0 top-0 w-full pb-(--chat-timeline-step-gap) [contain:layout]"
            style={subagentVirtualRowStyle(virtualRow)}
          >
            <MemoizedSubagentTrayVirtualRowContent
              activeThreadId={activeThreadId}
              environmentId={environmentId}
              projectRoot={projectRoot}
              row={row}
            />
          </div>
        );
      })}
    </div>
  );
}

function SubagentTrayVirtualRowContent({
  activeThreadId,
  environmentId,
  projectRoot,
  row,
}: {
  activeThreadId: ThreadId;
  environmentId: EnvironmentId;
  projectRoot: string | undefined;
  row: SubagentTrayVirtualRow;
}) {
  switch (row.kind) {
    case "transcript":
      return (
        <SubagentTranscriptItemRow
          activeThreadId={activeThreadId}
          environmentId={environmentId}
          isStreaming={row.streaming}
          item={row.item}
          projectRoot={projectRoot}
        />
      );
    case "log":
      return (
        <div data-subagent-running-log="">
          <SubagentActivityLine
            action={row.log.label}
            detail={row.log.detail}
            loading={row.loading}
          />
        </div>
      );
    case "empty":
      return <div className="py-1 text-detail text-honk-fg-tertiary">No thread content yet.</div>;
  }
}

const MemoizedSubagentTrayVirtualRowContent = memo(SubagentTrayVirtualRowContent);

function subagentVirtualRowStyle(virtualRow: VirtualItem): CSSProperties {
  return {
    transform: `translateY(${virtualRow.start}px)`,
  };
}

function estimateSubagentTrayVirtualRowSize(row: SubagentTrayVirtualRow | undefined): number {
  if (!row) {
    return 64 + SUBAGENT_TRANSCRIPT_ROW_GAP_PX;
  }
  if (row.kind === "empty") {
    return 32 + SUBAGENT_TRANSCRIPT_ROW_GAP_PX;
  }
  if (row.kind === "log") {
    return estimateSubagentTextRowSize(row.log.detail, 32);
  }

  const item = row.item;
  const messageRole = subagentTranscriptMessageRole(item);
  if (messageRole === "assistant") {
    return estimateSubagentTextRowSize(item.text, 112);
  }
  if (messageRole === "user") {
    return estimateSubagentTextRowSize(item.text, 72);
  }
  if (isSubagentReasoningTranscriptItem(item)) {
    return estimateSubagentTextRowSize(item.text, 64);
  }
  if (item.kind === "command" || item.kind === "tool") {
    return estimateSubagentTextRowSize(item.output ?? item.text ?? item.command, 64);
  }
  return estimateSubagentTextRowSize(item.text, 44);
}

function estimateSubagentTextRowSize(text: string | undefined, minimum: number): number {
  const trimmed = text?.trim();
  if (!trimmed) {
    return minimum + SUBAGENT_TRANSCRIPT_ROW_GAP_PX;
  }

  const lineCount = trimmed.split("\n").length;
  const wrappedLineEstimate = Math.ceil(trimmed.length / 96);
  return (
    minimum +
    Math.min(420, Math.max(lineCount, wrappedLineEstimate) * 18) +
    SUBAGENT_TRANSCRIPT_ROW_GAP_PX
  );
}

interface SubagentTranscriptItemRowProps {
  activeThreadId: ThreadId;
  environmentId: EnvironmentId;
  isStreaming: boolean;
  item: SubagentTranscriptItem;
  projectRoot: string | undefined;
}

export function SubagentTranscriptItemRow({
  activeThreadId,
  environmentId,
  isStreaming,
  item,
  projectRoot,
}: SubagentTranscriptItemRowProps) {
  const detail = item.text;
  const messageRole = subagentTranscriptMessageRole(item);

  if (messageRole === "assistant") {
    if (!detail) {
      return null;
    }
    return (
      <SubagentTimelineStep
        activeThreadId={activeThreadId}
        environmentId={environmentId}
        projectRoot={projectRoot}
        step={subagentMessageStep({
          id: item.itemId,
          role: "assistant",
          text: detail,
          createdAt: item.createdAt,
          streaming: isStreaming,
        })}
      />
    );
  }

  if (messageRole === "user") {
    if (!detail) {
      return null;
    }
    return (
      <SubagentTimelineStep
        activeThreadId={activeThreadId}
        environmentId={environmentId}
        projectRoot={projectRoot}
        step={subagentMessageStep({
          id: item.itemId,
          role: "user",
          text: detail,
          createdAt: item.createdAt,
          streaming: false,
        })}
      />
    );
  }

  if (isSubagentReasoningTranscriptItem(item)) {
    return detail ? (
      <SubagentTimelineStep
        activeThreadId={activeThreadId}
        environmentId={environmentId}
        projectRoot={projectRoot}
        step={subagentThinkingStep(item.id, item.createdAt, detail, isStreaming)}
      />
    ) : null;
  }

  if (item.kind === "command" || item.kind === "tool") {
    return (
      <SubagentTimelineStep
        activeThreadId={activeThreadId}
        environmentId={environmentId}
        projectRoot={projectRoot}
        step={subagentTranscriptItemStep(item, isStreaming)}
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
}

function SubagentTimelineStep({
  activeThreadId,
  environmentId,
  projectRoot,
  step,
}: {
  activeThreadId: ThreadId;
  environmentId: EnvironmentId;
  projectRoot: string | undefined;
  step: TimelineStep;
}) {
  const ctx = useMemo<StepRendererContext>(
    () => ({
      markdownCwd: projectRoot,
      projectRoot,
      activeThreadId,
      activeThreadEnvironmentId: environmentId,
      isServerThread: false,
      onBeginEditUserMessage: undefined,
      renderEditComposer: undefined,
      onUpdateProposedPlan: undefined,
      onImageExpand: noopImageExpand,
    }),
    [activeThreadId, environmentId, projectRoot],
  );

  return <StepRenderer step={step} editUserMessagesDisabled ctx={ctx} />;
}

function noopImageExpand(): void {
  return;
}

function subagentTranscriptItemStep(
  item: SubagentTranscriptItem,
  isStreaming: boolean,
): TimelineStep {
  const workEntry = subagentTranscriptItemToWorkEntry(item, isStreaming);
  return subagentWorkStep(`subagent-tool-step:${item.id}`, item.createdAt, workEntry);
}

function subagentMessageStep(input: {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  streaming: boolean;
}): TimelineStep {
  const messageId = MessageId.make(input.id);
  return {
    kind: "message",
    id: `subagent-message-step:${input.id}`,
    createdAt: input.createdAt,
    message: {
      id: messageId,
      role: input.role,
      text: input.text,
      turnId: null,
      streaming: input.streaming,
      createdAt: input.createdAt,
    },
    durationStart: input.createdAt,
    editAvailable: false,
    pairId: input.role === "user" ? messageId : null,
    messageIndex: 0,
  };
}

function subagentThinkingStep(
  id: string,
  createdAt: string,
  label: string,
  isStreaming: boolean,
): TimelineStep {
  return subagentWorkStep(`subagent-thinking-step:${id}`, createdAt, {
    id: `subagent-thinking:${id}`,
    createdAt,
    label,
    tone: "thinking",
    status: isStreaming ? "running" : "completed",
  });
}

function subagentWorkStep(id: string, createdAt: string, entry: WorkLogEntry): TimelineStep {
  return {
    kind: "work",
    id,
    createdAt,
    entry,
  };
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
  if (item.kind === "tool") {
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

function subagentTranscriptItemToWorkEntry(
  item: SubagentTranscriptItem,
  isStreaming: boolean,
): WorkLogEntry {
  const itemType =
    item.kind === "command" ? "command_execution" : toToolLifecycleItemType(item.itemType);
  const label = item.title ?? formatSnapshotTypeLabel(itemType ?? item.itemType ?? item.kind);
  const status = resolveSubagentWorkStatus(item.status, isStreaming || item.loading);
  const artifacts = subagentTranscriptItemArtifacts(item, itemType, status);
  return {
    id: `subagent-tool:${item.id}`,
    createdAt: item.createdAt,
    label,
    tone: status === "error" ? "error" : "tool",
    status,
    toolCallId: item.itemId,
    ...(itemType ? { itemType } : {}),
    ...(item.text ? { detail: item.text } : {}),
    ...(item.command ? { command: item.command } : {}),
    ...(item.rawCommand ? { rawCommand: item.rawCommand } : {}),
    ...(item.output ? { output: item.output } : {}),
    ...(item.changedFiles?.length ? { changedFiles: item.changedFiles } : {}),
    ...(artifacts.length > 0 ? { artifacts } : {}),
    ...(item.title ? { toolTitle: item.title } : {}),
  };
}

function subagentTranscriptItemArtifacts(
  item: SubagentTranscriptItem,
  itemType: ToolLifecycleItemType | null,
  status: NonNullable<WorkLogEntry["status"]>,
): ToolDisplayArtifact[] {
  const output = item.output?.trim() || item.text?.trim();
  switch (itemType) {
    case "command_execution": {
      const command = item.command?.trim() || item.rawCommand?.trim();
      if (!command && !output) {
        return [];
      }
      return [
        {
          type: "command",
          ...(command ? { command } : {}),
          ...(output ? { output } : {}),
          ...(status === "running" ? { isPartial: true } : {}),
        },
      ];
    }
    case "file_read": {
      const path = item.changedFiles?.[0]?.trim();
      if (!path && !output) {
        return [];
      }
      return [
        {
          type: "read",
          ...(path ? { path } : {}),
          ...(output ? { output } : {}),
          ...(status === "running" ? { isPartial: true } : {}),
        },
      ];
    }
    case "file_search": {
      const query = item.command?.trim() || item.text?.trim();
      if (!query && !output && !item.changedFiles?.length) {
        return [];
      }
      return [
        {
          type: "search",
          flavor: subagentSearchFlavor(item.title),
          ...(query ? { query } : {}),
          ...(output ? { output } : {}),
          ...(item.changedFiles?.length ? { matchedFiles: item.changedFiles } : {}),
          ...(status === "running" ? { isPartial: true } : {}),
        },
      ];
    }
    case "dynamic_tool_call":
    case "mcp_tool_call":
    case "web_search":
    case "web_fetch":
    case "image_view":
      return output ? [{ type: "raw", text: output }] : [];
    default:
      return [];
  }
}

function subagentSearchFlavor(title: string | undefined): "grep" | "find" | undefined {
  switch (title?.trim().toLowerCase()) {
    case "grep":
      return "grep";
    case "find":
    case "ls":
      return "find";
    default:
      return undefined;
  }
}

function toToolLifecycleItemType(value: string | undefined): ToolLifecycleItemType | null {
  return value && isToolLifecycleItemType(value) ? value : null;
}

function resolveSubagentWorkStatus(
  status: string | undefined,
  isStreaming: boolean,
): NonNullable<WorkLogEntry["status"]> {
  if (status === "failed" || status === "error") {
    return "error";
  }
  if (isStreaming || status === "running" || status === "inProgress") {
    return "running";
  }
  return "completed";
}

function SubagentActivityLine({
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
}

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

function deriveVisibleSubagentLogs(
  logs: ReadonlyArray<WorkLogSubagentLog>,
  hasCanonicalTranscript: boolean,
): ReadonlyArray<WorkLogSubagentLog> {
  const visibleLogs: WorkLogSubagentLog[] = [];
  for (const log of logs) {
    if (!isSubagentTrayLogVisible(log, hasCanonicalTranscript)) {
      continue;
    }
    visibleLogs.push(log);
  }
  return visibleLogs.slice(-80);
}
