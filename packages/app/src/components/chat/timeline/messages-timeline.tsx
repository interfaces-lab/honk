import { type EnvironmentId, type MessageId, type ThreadId } from "@multi/contracts";
import { useThrottledCallback } from "@tanstack/react-pacer";
import {
  createContext,
  memo,
  type RefObject,
  use,
  useCallback,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLayoutSyncEffect } from "~/hooks/use-layout-sync-effect";
import {
  defaultRangeExtractor,
  useVirtualizer,
  type Range,
  type VirtualItem,
} from "@tanstack/react-virtual";
import { IconChevronRightMedium } from "central-icons";
import { Spinner } from "@multi/ui/spinner";
import { deriveTimelineEntries, formatDuration } from "../../../session-logic";
import { type ChatMessage } from "../../../types";
import { type ExpandedImagePreview } from "../message/expanded-image-preview";
import {
  computeStableMessagesTimelineRows,
  deriveMessagesTimelineRows,
  type StableMessagesTimelineRowsState,
  type MessagesTimelineRow,
} from "./timeline-rows";
import { cn } from "~/lib/utils";
import { HumanMessage } from "../message/human-message";
import { AssistantMessage } from "../message/assistant-message";
import { WorkingStatusRow } from "../message/status-row";
import { ToolCallMessage } from "../message/tool-message";
import { useMountEffect } from "~/hooks/use-mount-effect";

type UserMessageTimelineRow = Extract<MessagesTimelineRow, { kind: "message" }>;

// ---------------------------------------------------------------------------
// Context — shared state consumed by every row component via useContext.
// ---------------------------------------------------------------------------

export interface TimelineRowSharedState {
  markdownCwd: string | undefined;
  projectRoot: string | undefined;
  activeThreadId: ThreadId;
  activeThreadEnvironmentId: EnvironmentId;
  isServerThread: boolean;
  onBeginEditUserMessage: ((messageId: MessageId) => void) | undefined;
  renderEditComposer: ((message: ChatMessage) => ReactNode) | undefined;
  onImageExpand: (preview: ExpandedImagePreview) => void;
}

export const TimelineRowCtx = createContext<TimelineRowSharedState>(null!);

const DEFAULT_VIRTUALIZER_RECT = { width: 0, height: 720 };
const VIRTUAL_ROW_GAP_PX = 12;
const VIRTUALIZER_OVERSCAN = 8;
const keepScrollOffsetOnMeasuredRowResize = () => false;

function useValueIdentityVersion<TValue>(value: TValue): number {
  const valueRef = useRef(value);
  const versionRef = useRef(0);
  if (valueRef.current !== value) {
    valueRef.current = value;
    versionRef.current += 1;
  }
  return versionRef.current;
}

interface MessagesTimelineScrollState {
  isAtBottom: boolean;
}

export interface MessagesTimelineController {
  scrollToBottom: (options?: { animated?: boolean }) => void;
  getScrollState: () => MessagesTimelineScrollState;
}

// ---------------------------------------------------------------------------
// Props (public API)
// ---------------------------------------------------------------------------

interface MessagesTimelineProps {
  isWorking: boolean;
  activeTurnInProgress: boolean;
  editUserMessagesDisabled: boolean;
  activeTurnStartedAt: string | null;
  bottomClearancePx?: number | undefined;
  timelineControllerRef: React.RefObject<MessagesTimelineController | null>;
  timelineEntries: ReturnType<typeof deriveTimelineEntries>;
  revertTurnCountByUserMessageId: Map<MessageId, number>;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  activeThreadEnvironmentId: EnvironmentId;
  activeThreadId: ThreadId;
  markdownCwd: string | undefined;
  projectRoot: string | undefined;
  isServerThread: boolean;
  editingUserMessageId?: MessageId | null | undefined;
  onBeginEditUserMessage: ((messageId: MessageId) => void) | undefined;
  renderEditComposer?: ((message: ChatMessage) => ReactNode) | undefined;
  awaitingServerThreadDetail?: boolean | undefined;
  onIsAtBottomChange: (isAtBottom: boolean) => void;
}

// ---------------------------------------------------------------------------
// MessagesTimeline — list owner
// ---------------------------------------------------------------------------

export const MessagesTimeline = memo(function MessagesTimeline({
  isWorking,
  activeTurnInProgress,
  editUserMessagesDisabled,
  activeTurnStartedAt,
  bottomClearancePx = 0,
  timelineControllerRef,
  timelineEntries,
  revertTurnCountByUserMessageId,
  onImageExpand,
  activeThreadEnvironmentId,
  activeThreadId,
  markdownCwd,
  projectRoot,
  isServerThread,
  editingUserMessageId = null,
  onBeginEditUserMessage,
  renderEditComposer,
  awaitingServerThreadDetail = false,
  onIsAtBottomChange,
}: MessagesTimelineProps) {
  const rawRows = useMemo(
    () =>
      deriveMessagesTimelineRows({
        timelineEntries,
        isWorking,
        activeTurnStartedAt,
        revertTurnCountByUserMessageId,
        projectRoot,
      }),
    [timelineEntries, isWorking, activeTurnStartedAt, revertTurnCountByUserMessageId, projectRoot],
  );
  const rows = useStableRows(rawRows);
  const [expandedWorkGroupIds, setExpandedWorkGroupIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const toggleWorkGroupExpanded = useCallback((rowId: string) => {
    setExpandedWorkGroupIds((current) => {
      const next = new Set(current);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  }, []);
  const stickyUserRowIndices = useMemo(
    () => rows.flatMap((row, index) => (isUserMessageRow(row) ? [index] : [])),
    [rows],
  );
  const scrollElementRef = useRef<HTMLDivElement | null>(null);
  const isAtBottomRef = useRef(true);
  const programmaticScrollFrameRef = useRef<number | null>(null);
  const programmaticScrollDeadlineRef = useRef(0);
  const programmaticScrollTargetRef = useRef<number | null>(null);
  const initializedScrollRef = useRef(false);
  const stickyUserRowIndicesRef = useRef(stickyUserRowIndices);
  const scrollSnapshotRef = useRef({ rowsLength: 0, scrollTop: 0 });
  const renderedRowsLengthRef = useRef(0);
  const pendingScrollTopRestoreRef = useRef<number | null>(null);
  const virtualizerBottomPadding = Math.max(0, Math.ceil(bottomClearancePx));
  const estimatedRowSizes = useMemo(() => rows.map(getEstimatedTimelineRowSize), [rows]);
  const initialScrollOffset = useMemo(
    () => estimateInitialTimelineBottomOffset(estimatedRowSizes, virtualizerBottomPadding),
    [estimatedRowSizes, virtualizerBottomPadding],
  );

  stickyUserRowIndicesRef.current = stickyUserRowIndices;
  if (renderedRowsLengthRef.current !== rows.length) {
    if (
      renderedRowsLengthRef.current > 0 &&
      rows.length > renderedRowsLengthRef.current &&
      !isAtBottomRef.current
    ) {
      pendingScrollTopRestoreRef.current =
        scrollElementRef.current?.scrollTop ?? scrollSnapshotRef.current.scrollTop;
    }
    renderedRowsLengthRef.current = rows.length;
  }

  const reportIsAtBottom = useCallback(
    (isAtBottom: boolean, options?: { force?: boolean }) => {
      if (!options?.force && isAtBottomRef.current === isAtBottom) {
        return;
      }
      isAtBottomRef.current = isAtBottom;
      onIsAtBottomChange(isAtBottom);
    },
    [onIsAtBottomChange],
  );

  const getIsAtBottom = useCallback(() => {
    const scrollElement = scrollElementRef.current;
    if (!scrollElement) {
      return true;
    }

    const maxScrollTop = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight);
    return maxScrollTop <= 1 || scrollElement.scrollTop >= maxScrollTop - 2;
  }, []);

  const clearProgrammaticScrollTracking = useCallback(() => {
    programmaticScrollTargetRef.current = null;
    if (programmaticScrollFrameRef.current != null) {
      window.cancelAnimationFrame(programmaticScrollFrameRef.current);
      programmaticScrollFrameRef.current = null;
    }
  }, []);

  const scheduleProgrammaticScrollResolution = useCallback(() => {
    if (programmaticScrollFrameRef.current != null) {
      return;
    }

    const resolveProgrammaticScroll = () => {
      programmaticScrollFrameRef.current = null;
      if (programmaticScrollTargetRef.current === null) {
        return;
      }

      const isAtBottom = getIsAtBottom();
      if (isAtBottom || window.performance.now() >= programmaticScrollDeadlineRef.current) {
        programmaticScrollTargetRef.current = null;
        reportIsAtBottom(isAtBottom);
        return;
      }

      programmaticScrollFrameRef.current = window.requestAnimationFrame(resolveProgrammaticScroll);
    };

    programmaticScrollFrameRef.current = window.requestAnimationFrame(resolveProgrammaticScroll);
  }, [getIsAtBottom, reportIsAtBottom]);

  const scrollToBottom = useCallback(
    (options?: { animated?: boolean }) => {
      const scrollElement = scrollElementRef.current;
      if (!scrollElement) {
        return;
      }

      const maxScrollTop = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight);
      const animated = options?.animated === true;
      if (animated) {
        programmaticScrollTargetRef.current = maxScrollTop;
        programmaticScrollDeadlineRef.current = window.performance.now() + 1600;
      } else {
        clearProgrammaticScrollTracking();
      }

      scrollElement.scrollTo({
        top: maxScrollTop,
        behavior: animated ? "smooth" : "auto",
      });
      if (animated) {
        scheduleProgrammaticScrollResolution();
      } else {
        reportIsAtBottom(true);
      }
    },
    [clearProgrammaticScrollTracking, reportIsAtBottom, scheduleProgrammaticScrollResolution],
  );

  const scheduleStickToBottom = useThrottledCallback(
    (options?: { animated?: boolean }) => {
      scrollToBottom({ animated: options?.animated ?? false });
    },
    { wait: 16, leading: true, trailing: true },
  );
  const getIsAtBottomVersion = useValueIdentityVersion(getIsAtBottom);
  const rowsVersion = useValueIdentityVersion(rows);
  const scheduleStickToBottomVersion = useValueIdentityVersion(scheduleStickToBottom);
  const scrollToBottomVersion = useValueIdentityVersion(scrollToBottom);

  const handleScroll = useCallback(() => {
    const scrollElement = scrollElementRef.current;
    const isAtBottom = getIsAtBottom();
    if (scrollElement) {
      scrollSnapshotRef.current = {
        rowsLength: rows.length,
        scrollTop: scrollElement.scrollTop,
      };
    }
    if (programmaticScrollTargetRef.current !== null) {
      if (isAtBottom) {
        clearProgrammaticScrollTracking();
        reportIsAtBottom(true);
      }
      return;
    }

    reportIsAtBottom(isAtBottom);
  }, [clearProgrammaticScrollTracking, getIsAtBottom, reportIsAtBottom, rows.length]);

  const rangeExtractor = useCallback((range: Range) => {
    const defaultRange = defaultRangeExtractor(range);
    const activeStickyIndex = findActiveStickyUserRowIndex(
      stickyUserRowIndicesRef.current,
      range.startIndex,
    );

    if (activeStickyIndex === null || defaultRange.includes(activeStickyIndex)) {
      return defaultRange;
    }

    return [activeStickyIndex, ...defaultRange].toSorted((left, right) => left - right);
  }, []);

  const rowVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rows.length,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: (index) => estimatedRowSizes[index] ?? estimateTimelineRowSize(undefined),
    getItemKey: (index) => rows[index]?.id ?? index,
    rangeExtractor,
    overscan: VIRTUALIZER_OVERSCAN,
    paddingEnd: virtualizerBottomPadding,
    initialRect: DEFAULT_VIRTUALIZER_RECT,
    initialOffset: initialScrollOffset,
    useAnimationFrameWithResizeObserver: true,
    onChange: (_instance, sync) => {
      if (!sync && isAtBottomRef.current) {
        scheduleStickToBottom();
      }
    },
  });
  rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = keepScrollOffsetOnMeasuredRowResize;

  useLayoutSyncEffect(() => {
    const scrollElement = scrollElementRef.current;
    if (!scrollElement) {
      scrollSnapshotRef.current = { rowsLength: rows.length, scrollTop: 0 };
      return;
    }

    const restoreScrollTop = pendingScrollTopRestoreRef.current;
    if (restoreScrollTop !== null) {
      pendingScrollTopRestoreRef.current = null;
      isAtBottomRef.current = false;
      rowVirtualizer.scrollToOffset(restoreScrollTop, { behavior: "auto" });
      scrollElement.scrollTop = restoreScrollTop;
      window.requestAnimationFrame(() => {
        rowVirtualizer.scrollToOffset(restoreScrollTop, { behavior: "auto" });
        scrollElement.scrollTop = restoreScrollTop;
      });
    }

    scrollSnapshotRef.current = {
      rowsLength: rows.length,
      scrollTop: scrollElement.scrollTop,
    };
  }, [rows.length]);

  const sharedState = useMemo<TimelineRowSharedState>(
    () => ({
      markdownCwd,
      projectRoot,
      activeThreadId,
      activeThreadEnvironmentId,
      isServerThread,
      onBeginEditUserMessage,
      renderEditComposer,
      onImageExpand,
    }),
    [
      markdownCwd,
      projectRoot,
      activeThreadId,
      activeThreadEnvironmentId,
      isServerThread,
      onBeginEditUserMessage,
      renderEditComposer,
      onImageExpand,
    ],
  );
  const lifecycleSync = (
    <>
      <TimelineControllerSync
        key={`controller:${getIsAtBottomVersion}:${scrollToBottomVersion}`}
        getIsAtBottom={getIsAtBottom}
        scrollToBottom={scrollToBottom}
        timelineControllerRef={timelineControllerRef}
      />
      <ProgrammaticScrollTrackingCleanup
        clearProgrammaticScrollTracking={clearProgrammaticScrollTracking}
      />
      <TimelineRowsStickToBottomSync
        key={`rows-stick:${rowsVersion}:${scheduleStickToBottomVersion}`}
        initializedScrollRef={initializedScrollRef}
        isAtBottomRef={isAtBottomRef}
        reportIsAtBottom={reportIsAtBottom}
        rows={rows}
        scheduleStickToBottom={scheduleStickToBottom}
      />
      <TimelineActiveWorkStickToBottomSync
        key={`active-work-stick:${activeTurnInProgress}:${isWorking}:${scheduleStickToBottomVersion}`}
        activeTurnInProgress={activeTurnInProgress}
        isAtBottomRef={isAtBottomRef}
        isWorking={isWorking}
        scheduleStickToBottom={scheduleStickToBottom}
      />
    </>
  );

  if (rows.length === 0 && !isWorking && awaitingServerThreadDetail) {
    return (
      <>
        {lifecycleSync}
        <div className="flex h-full items-center justify-center" aria-busy="true">
          <Spinner className="size-6 text-muted-foreground" />
        </div>
      </>
    );
  }

  const virtualItems = rowVirtualizer.getVirtualItems();
  const activeStickyUserRowIndex = findActiveStickyUserRowIndex(
    stickyUserRowIndices,
    rowVirtualizer.range?.startIndex ?? virtualItems[0]?.index ?? 0,
  );
  const virtualContentStyle = {
    height: rowVirtualizer.getTotalSize(),
    position: "relative",
  } satisfies CSSProperties;

  return (
    <TimelineRowCtx.Provider value={sharedState}>
      {lifecycleSync}
      <div className="relative flex h-full min-h-0 flex-1 flex-col gap-0 overflow-hidden pt-(--chat-timeline-padding-block-start)">
        <div
          ref={scrollElementRef}
          onScroll={handleScroll}
          onPointerDown={clearProgrammaticScrollTracking}
          onTouchStart={clearProgrammaticScrollTracking}
          onWheel={clearProgrammaticScrollTracking}
          data-chat-timeline-scroll=""
          className="h-full min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain [overflow-anchor:none] scrollbar-gutter-stable-both-edges scrollbar-thin"
        >
          <div className="mx-auto box-border w-full max-w-agent-chat" style={virtualContentStyle}>
            {virtualItems.map((virtualRow) => {
              const row = rows[virtualRow.index];
              if (!row) {
                return null;
              }

              const isActiveStickyUserRow = virtualRow.index === activeStickyUserRowIndex;

              return (
                <div
                  key={virtualRow.key}
                  ref={rowVirtualizer.measureElement}
                  data-index={virtualRow.index}
                  data-sticky={isActiveStickyUserRow ? "true" : undefined}
                  className="w-full px-4 pb-(--chat-timeline-row-gap)"
                  style={virtualRowStyle(virtualRow, isActiveStickyUserRow)}
                >
                  <TimelineRowContent
                    row={row}
                    workGroupExpanded={row.kind === "work" && expandedWorkGroupIds.has(row.id)}
                    onToggleWorkGroupExpanded={toggleWorkGroupExpanded}
                    editUserMessagesDisabled={editUserMessagesDisabled}
                    isEditingUserMessage={
                      row.kind === "message" &&
                      row.message.role === "user" &&
                      row.message.id === editingUserMessageId
                    }
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </TimelineRowCtx.Provider>
  );
});

function TimelineControllerSync({
  getIsAtBottom,
  scrollToBottom,
  timelineControllerRef,
}: {
  getIsAtBottom: () => boolean;
  scrollToBottom: MessagesTimelineController["scrollToBottom"];
  timelineControllerRef: RefObject<MessagesTimelineController | null>;
}) {
  useMountEffect(() => {
    const controller: MessagesTimelineController = {
      scrollToBottom,
      getScrollState: () => ({ isAtBottom: getIsAtBottom() }),
    };

    timelineControllerRef.current = controller;
    return () => {
      if (timelineControllerRef.current === controller) {
        timelineControllerRef.current = null;
      }
    };
  });

  return null;
}

function ProgrammaticScrollTrackingCleanup({
  clearProgrammaticScrollTracking,
}: {
  clearProgrammaticScrollTracking: () => void;
}) {
  useMountEffect(() => () => {
    clearProgrammaticScrollTracking();
  });

  return null;
}

function TimelineRowsStickToBottomSync({
  initializedScrollRef,
  isAtBottomRef,
  reportIsAtBottom,
  rows,
  scheduleStickToBottom,
}: {
  initializedScrollRef: RefObject<boolean>;
  isAtBottomRef: RefObject<boolean>;
  reportIsAtBottom: (isAtBottom: boolean, options?: { force?: boolean }) => void;
  rows: readonly MessagesTimelineRow[];
  scheduleStickToBottom: (options?: { animated?: boolean }) => void;
}) {
  useLayoutSyncEffect(() => {
    if (rows.length === 0) {
      return;
    }

    if (!initializedScrollRef.current) {
      initializedScrollRef.current = true;
      reportIsAtBottom(true);
      scheduleStickToBottom();
      return;
    }

    if (!isAtBottomRef.current) {
      return;
    }

    scheduleStickToBottom();
  }, []);

  return null;
}

function TimelineActiveWorkStickToBottomSync({
  activeTurnInProgress,
  isAtBottomRef,
  isWorking,
  scheduleStickToBottom,
}: {
  activeTurnInProgress: boolean;
  isAtBottomRef: RefObject<boolean>;
  isWorking: boolean;
  scheduleStickToBottom: (options?: { animated?: boolean }) => void;
}) {
  useMountEffect(() => {
    if (!isWorking && !activeTurnInProgress) {
      return;
    }
    if (!isAtBottomRef.current) {
      return;
    }

    scheduleStickToBottom();
  });

  return null;
}

function isUserMessageRow(row: MessagesTimelineRow): row is UserMessageTimelineRow {
  return row.kind === "message" && row.message.role === "user";
}

function findActiveStickyUserRowIndex(indices: readonly number[], visibleStartIndex: number) {
  let activeIndex: number | null = null;
  for (const index of indices) {
    if (index > visibleStartIndex) {
      break;
    }
    activeIndex = index;
  }
  return activeIndex;
}

const WORK_GROUP_PREVIEW_PX = 144;
const WORK_GROUP_HEADER_PX = 28;
const ASSISTANT_MESSAGE_MIN_PX = 156;
const USER_MESSAGE_MIN_PX = 88;
const MESSAGE_ROW_CHROME_PX = 40;
const MESSAGE_TEXT_LINE_HEIGHT_PX = 21;
const ASSISTANT_MESSAGE_CHARS_PER_LINE = 82;
const USER_MESSAGE_CHARS_PER_LINE = 96;
const estimatedTimelineRowSizeCache = new WeakMap<MessagesTimelineRow, number>();

function getEstimatedTimelineRowSize(row: MessagesTimelineRow): number {
  const cachedSize = estimatedTimelineRowSizeCache.get(row);
  if (cachedSize !== undefined) {
    return cachedSize;
  }

  const size = estimateTimelineRowSize(row);
  estimatedTimelineRowSizeCache.set(row, size);
  return size;
}

function estimateInitialTimelineBottomOffset(
  rowSizes: readonly number[],
  paddingEnd: number,
): number {
  const totalSize = rowSizes.reduce((total, size) => total + size, paddingEnd);
  return Math.max(0, totalSize - DEFAULT_VIRTUALIZER_RECT.height);
}

function estimateTimelineRowSize(row: MessagesTimelineRow | undefined): number {
  if (!row) {
    return 96 + VIRTUAL_ROW_GAP_PX;
  }

  if (row.kind === "message") {
    return estimateMessageTimelineRowSize(row);
  }

  if (row.kind === "proposed-plan") {
    return 180 + VIRTUAL_ROW_GAP_PX;
  }

  if (row.kind === "working") {
    return 52 + VIRTUAL_ROW_GAP_PX;
  }

  if (row.isRunning) {
    return WORK_GROUP_HEADER_PX + WORK_GROUP_PREVIEW_PX + VIRTUAL_ROW_GAP_PX;
  }

  return WORK_GROUP_HEADER_PX + VIRTUAL_ROW_GAP_PX;
}

function estimateMessageTimelineRowSize(row: Extract<MessagesTimelineRow, { kind: "message" }>) {
  const minHeight = row.message.role === "user" ? USER_MESSAGE_MIN_PX : ASSISTANT_MESSAGE_MIN_PX;
  const charsPerLine =
    row.message.role === "user" ? USER_MESSAGE_CHARS_PER_LINE : ASSISTANT_MESSAGE_CHARS_PER_LINE;
  const estimatedTextHeight =
    estimateWrappedLineCount(row.message.text, charsPerLine) * MESSAGE_TEXT_LINE_HEIGHT_PX;

  return Math.max(minHeight, MESSAGE_ROW_CHROME_PX + estimatedTextHeight) + VIRTUAL_ROW_GAP_PX;
}

function estimateWrappedLineCount(text: string | undefined, charsPerLine: number): number {
  const value = text?.trim();
  if (!value) {
    return 1;
  }

  let lines = 1;
  let currentLineLength = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 10) {
      lines += 1;
      currentLineLength = 0;
      continue;
    }

    currentLineLength += 1;
    if (currentLineLength >= charsPerLine) {
      lines += 1;
      currentLineLength = 0;
    }
  }

  return lines;
}

function virtualRowStyle(virtualRow: VirtualItem, isSticky: boolean): CSSProperties {
  if (isSticky) {
    return {
      position: "sticky",
      top: 0,
      zIndex: 20,
    };
  }

  return {
    position: "absolute",
    top: 0,
    left: 0,
    transform: `translateY(${virtualRow.start}px)`,
  };
}

// ---------------------------------------------------------------------------
// TimelineRowContent — dispatcher into extracted components
// ---------------------------------------------------------------------------

type TimelineRow = MessagesTimelineRow;

const TimelineRowContent = memo(function TimelineRowContent({
  row,
  workGroupExpanded,
  onToggleWorkGroupExpanded,
  editUserMessagesDisabled,
  isEditingUserMessage = false,
}: {
  row: TimelineRow;
  workGroupExpanded: boolean;
  onToggleWorkGroupExpanded: (rowId: string) => void;
  editUserMessagesDisabled: boolean;
  isEditingUserMessage?: boolean;
}) {
  const ctx = use(TimelineRowCtx);

  return (
    <div
      className={cn(
        "flex w-full min-w-0 flex-col gap-1 overflow-x-hidden",
        row.kind === "message" && row.message.role === "assistant" ? "group/assistant" : null,
      )}
      data-meta-agent-chat-bubble-id={row.id}
      data-meta-agent-chat-message-kind={timelineRowKind(row)}
      data-timeline-root="true"
      data-timeline-row-id={row.id}
      data-timeline-row-kind={row.kind}
      data-message-id={row.kind === "message" ? row.message.id : undefined}
      data-message-role={row.kind === "message" ? row.message.role : undefined}
    >
      <TimelineRowBody
        row={row}
        workGroupExpanded={workGroupExpanded}
        onToggleWorkGroupExpanded={onToggleWorkGroupExpanded}
        editUserMessagesDisabled={editUserMessagesDisabled}
        isEditingUserMessage={isEditingUserMessage}
        ctx={ctx}
      />
    </div>
  );
});

function TimelineRowBody({
  row,
  workGroupExpanded,
  onToggleWorkGroupExpanded,
  editUserMessagesDisabled,
  isEditingUserMessage,
  ctx,
}: {
  row: TimelineRow;
  workGroupExpanded: boolean;
  onToggleWorkGroupExpanded: (rowId: string) => void;
  editUserMessagesDisabled: boolean;
  isEditingUserMessage: boolean;
  ctx: TimelineRowSharedState;
}) {
  return (
    <>
      {row.kind === "work" && (
        <div className="flex w-full min-w-0">
          <WorkGroupSection
            row={row}
            expanded={workGroupExpanded}
            onToggleExpanded={onToggleWorkGroupExpanded}
          />
        </div>
      )}

      {row.kind === "message" && row.message.role === "user" && (
        <HumanTimelineRow
          row={row}
          editUserMessagesDisabled={editUserMessagesDisabled}
          isEditingUserMessage={isEditingUserMessage}
          ctx={ctx}
        />
      )}

      {row.kind === "message" && row.message.role === "assistant" && (
        <div className="box-border flex w-full min-w-0 px-0">
          <AssistantMessage message={row.message} markdownCwd={ctx.markdownCwd} />
        </div>
      )}

      {row.kind === "working" && (
        <div className="flex w-full min-w-0 opacity-75">
          <WorkingStatusRow />
        </div>
      )}
    </>
  );
}

const HumanTimelineRow = memo(function HumanTimelineRow({
  row,
  editUserMessagesDisabled,
  isEditingUserMessage,
  ctx,
}: {
  row: Extract<TimelineRow, { kind: "message" }>;
  editUserMessagesDisabled: boolean;
  isEditingUserMessage: boolean;
  ctx: TimelineRowSharedState;
}) {
  return (
    <div className="box-border flex w-full min-w-0 px-0">
      <HumanMessage
        message={row.message}
        revertTurnCount={row.revertTurnCount}
        isEditing={isEditingUserMessage}
        editDisabled={editUserMessagesDisabled}
        isServerThread={ctx.isServerThread}
        editComposer={isEditingUserMessage ? (ctx.renderEditComposer?.(row.message) ?? null) : null}
        onImageExpand={ctx.onImageExpand}
        onBeginEditUserMessage={ctx.onBeginEditUserMessage}
      />
    </div>
  );
});

// ---------------------------------------------------------------------------
// WorkGroupSection — tool activity group with overflow control
// ---------------------------------------------------------------------------

const WorkGroupSection = memo(function WorkGroupSection({
  row,
  expanded,
  onToggleExpanded,
}: {
  row: Extract<MessagesTimelineRow, { kind: "work" }>;
  expanded: boolean;
  onToggleExpanded: (rowId: string) => void;
}) {
  const { activeThreadEnvironmentId, activeThreadId, projectRoot } = use(TimelineRowCtx);
  const summary = row.summary;
  const isRunning = row.isRunning;
  const isThinkingGroup = row.groupedEntries.every((entry) => entry.tone === "thinking");
  const headerLabel = isThinkingGroup
    ? [summary.action, summary.details].filter(Boolean).join(" ")
    : isRunning
      ? summary.action
      : `Worked for ${formatDuration(row.durationMs)}`;
  const handleToggle = useCallback(() => {
    onToggleExpanded(row.id);
  }, [onToggleExpanded, row.id]);

  return (
    <div
      className="flex min-h-0 min-w-0 max-w-agent-chat flex-1 flex-col gap-(--chat-timeline-collapsible-header-gap) py-0.5 text-conversation"
      data-assistant-work-group=""
      data-work-group-expanded={expanded ? "true" : "false"}
      data-work-group-running={isRunning ? "true" : "false"}
    >
      <button
        type="button"
        className={cn(
          "group/work-header inline-flex w-fit max-w-full min-w-0 items-center gap-(--chat-timeline-collapsible-header-gap) overflow-hidden",
          "border-0 bg-transparent p-0 text-left select-none",
          "text-conversation text-multi-fg-tertiary",
          "hover:text-multi-fg-secondary focus-visible:text-multi-fg-secondary",
        )}
        aria-expanded={expanded}
        onClick={handleToggle}
        data-work-group-header=""
      >
        <span className="shrink-0 whitespace-nowrap tabular-nums">{headerLabel}</span>
        {!expanded && !isRunning && !isThinkingGroup ? (
          <>
            <span aria-hidden="true" className="shrink-0 text-multi-fg-tertiary">
              ·
            </span>
            <WorkGroupSummaryLine summary={summary} />
          </>
        ) : null}
        <IconChevronRightMedium
          className={cn(
            "size-3 shrink-0 text-multi-icon-tertiary transition-transform duration-150",
            expanded && "rotate-90",
          )}
        />
      </button>
      {isRunning ? (
        <>
          {expanded ? <WorkGroupSummaryLine summary={summary} /> : null}
          <WorkGroupPreview
            key={`work-preview:${row.id}`}
            row={row}
            onExpand={handleToggle}
            projectRoot={projectRoot}
          />
        </>
      ) : expanded ? (
        <div className="flex min-w-0 max-w-full flex-col gap-(--chat-timeline-step-gap)">
          <WorkGroupSummaryLine summary={summary} />
          {row.groupedEntries.map((workEntry) => (
            <ToolCallMessage
              key={`work-row:${workEntry.id}`}
              workEntry={workEntry}
              projectRoot={projectRoot}
              activeThreadId={activeThreadId}
              environmentId={activeThreadEnvironmentId}
              subagentDetailsEnabled
            />
          ))}
        </div>
      ) : null}
    </div>
  );
});

function WorkGroupSummaryLine({
  summary,
}: {
  summary: Extract<MessagesTimelineRow, { kind: "work" }>["summary"];
}) {
  return (
    <span
      className="inline-flex min-h-6 w-fit max-w-full min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap text-conversation"
      data-work-group-summary=""
    >
      <span className="shrink-0 overflow-hidden text-ellipsis whitespace-nowrap text-multi-fg-secondary">
        {summary.action}
      </span>
      <span className="min-w-0 overflow-hidden text-ellipsis text-multi-fg-tertiary tabular-nums">
        {summary.details}
      </span>
      <WorkGroupStats summary={summary} />
    </span>
  );
}

const WorkGroupPreview = memo(function WorkGroupPreview({
  row,
  onExpand,
  projectRoot,
}: {
  row: Extract<MessagesTimelineRow, { kind: "work" }>;
  onExpand: () => void;
  projectRoot: string | undefined;
}) {
  const { activeThreadEnvironmentId, activeThreadId } = use(TimelineRowCtx);
  const scrollHostRef = useRef<HTMLDivElement | null>(null);
  const entries = row.groupedEntries;
  const lastEntryId = entries.at(-1)?.id;
  const entryCount = entries.length;

  useLayoutSyncEffect(() => {
    const host = scrollHostRef.current;
    if (!host) return;
    host.scrollTop = host.scrollHeight;
    updatePreviewScrollable(host);
  }, [entryCount, lastEntryId, row.isRunning]);

  useLayoutSyncEffect(() => {
    const host = scrollHostRef.current;
    if (!host) return;
    if (typeof ResizeObserver === "undefined") {
      updatePreviewScrollable(host);
      return;
    }
    const observer = new ResizeObserver(() => {
      updatePreviewScrollable(host);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const onPreviewClick = useCallback(() => {
    onExpand();
  }, [onExpand]);
  const onPreviewKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onExpand();
    },
    [onExpand],
  );

  return (
    <div
      ref={scrollHostRef}
      role="button"
      tabIndex={0}
      aria-label="Expand work group"
      onClick={onPreviewClick}
      onKeyDown={onPreviewKeyDown}
      data-work-group-preview=""
      data-work-preview-scrollable="false"
      className="flex w-full min-h-0 max-w-full shrink-0 cursor-pointer flex-col gap-(--chat-timeline-step-gap) overflow-x-hidden overflow-y-auto [overflow-anchor:none] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{
        height: WORK_GROUP_PREVIEW_PX,
        maxHeight: WORK_GROUP_PREVIEW_PX,
      }}
    >
      {entries.map((workEntry) => (
        <ToolCallMessage
          key={`work-preview-row:${workEntry.id}`}
          workEntry={workEntry}
          projectRoot={projectRoot}
          activeThreadId={activeThreadId}
          environmentId={activeThreadEnvironmentId}
          subagentDetailsEnabled
        />
      ))}
    </div>
  );
});

function updatePreviewScrollable(host: HTMLDivElement): void {
  const scrollable = host.scrollHeight > host.clientHeight + 1;
  host.dataset.workPreviewScrollable = scrollable ? "true" : "false";
}

function WorkGroupStats({
  summary,
}: {
  summary: Extract<MessagesTimelineRow, { kind: "work" }>["summary"];
}) {
  const additions = summary.additions ?? 0;
  const deletions = summary.deletions ?? 0;
  if (additions === 0 && deletions === 0) {
    return null;
  }

  return (
    <span className="inline-flex shrink-0 gap-1 tabular-nums" data-work-group-stats="">
      {additions > 0 ? <span className="text-multi-diff-addition">+{additions}</span> : null}
      {deletions > 0 ? <span className="text-multi-diff-deletion">-{deletions}</span> : null}
    </span>
  );
}

function timelineRowKind(row: TimelineRow): "human" | "assistant" | "tool-call" | "loading" {
  if (row.kind === "message") return row.message.role === "user" ? "human" : "assistant";
  if (row.kind === "working") return "loading";
  return "tool-call";
}

// ---------------------------------------------------------------------------
// Structural sharing — reuse old row references when data hasn't changed
// ---------------------------------------------------------------------------

function useStableRows(rows: MessagesTimelineRow[]): MessagesTimelineRow[] {
  const prevState = useRef<StableMessagesTimelineRowsState>({
    byId: new Map<string, MessagesTimelineRow>(),
    result: [],
  });

  return useMemo(() => {
    const nextState = computeStableMessagesTimelineRows(rows, prevState.current);
    prevState.current = nextState;
    return nextState.result;
  }, [rows]);
}
