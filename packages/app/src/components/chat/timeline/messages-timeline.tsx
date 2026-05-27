import { type EnvironmentId, type MessageId, type ThreadId } from "@multi/contracts";
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
  type Virtualizer,
} from "@tanstack/react-virtual";
import { IconChevronRightMedium } from "central-icons";
import { Spinner } from "@multi/ui/spinner";
import { deriveTimelineEntries, formatDuration, type WorkLogEntry } from "../../../session-logic";
import { type ChatMessage } from "../../../types";
import { type ExpandedImagePreview } from "../message/expanded-image-preview";
import {
  computeStableMessagesTimelineRows,
  deriveMessagesTimelineRows,
  isCommandWorkEntry,
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

// Context shared by every row component via useContext.

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
const TIMELINE_SCROLL_END_THRESHOLD_PX = 2;
const WORK_GROUP_PREVIEW_MAX_ENTRIES = 6;
const MAX_TIMELINE_VIRTUALIZER_SNAPSHOTS = 16;

interface TimelineVirtualizerSnapshot {
  measuredItems: VirtualItem[];
  scrollOffset: number;
  isAtBottom: boolean;
  firstRowId: string | undefined;
}

const timelineVirtualizerSnapshots = new Map<string, TimelineVirtualizerSnapshot>();

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

// Public props.

interface MessagesTimelineProps {
  isWorking: boolean;
  editUserMessagesDisabled: boolean;
  activeTurnStartedAt: string | null;
  bottomClearancePx?: number | undefined;
  timelineControllerRef: React.RefObject<MessagesTimelineController | null>;
  timelineEntries: ReturnType<typeof deriveTimelineEntries>;
  editableUserMessageIds: ReadonlySet<MessageId>;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  activeThreadEnvironmentId: EnvironmentId;
  activeThreadId: ThreadId;
  timelineCacheKey: string;
  markdownCwd: string | undefined;
  projectRoot: string | undefined;
  isServerThread: boolean;
  editingUserMessageId?: MessageId | null | undefined;
  onBeginEditUserMessage: ((messageId: MessageId) => void) | undefined;
  renderEditComposer?: ((message: ChatMessage) => ReactNode) | undefined;
  awaitingServerThreadDetail?: boolean | undefined;
  onIsAtBottomChange: (isAtBottom: boolean) => void;
}

// Virtualized message list.

export const MessagesTimeline = memo(function MessagesTimeline({
  isWorking,
  editUserMessagesDisabled,
  activeTurnStartedAt,
  bottomClearancePx = 0,
  timelineControllerRef,
  timelineEntries,
  editableUserMessageIds,
  onImageExpand,
  activeThreadEnvironmentId,
  activeThreadId,
  timelineCacheKey,
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
        editableUserMessageIds,
        projectRoot,
      }),
    [timelineEntries, isWorking, activeTurnStartedAt, editableUserMessageIds, projectRoot],
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
  const programmaticScrollActiveRef = useRef(false);
  const initializedScrollRef = useRef(false);
  const stickyUserRowIndicesRef = useRef(stickyUserRowIndices);
  const rowsRef = useRef(rows);
  const virtualizerBottomPadding = Math.max(0, Math.ceil(bottomClearancePx));
  const cachedVirtualizerSnapshot = useMemo(
    () => timelineVirtualizerSnapshots.get(timelineCacheKey) ?? null,
    [timelineCacheKey],
  );
  const initialMeasurementsCache = useMemo(
    () => filterReusableTimelineMeasurements(cachedVirtualizerSnapshot, rows),
    [cachedVirtualizerSnapshot, rows],
  );
  const restoredInitialScrollOffset = useMemo(
    () =>
      shouldRestoreTimelineScrollOffset(cachedVirtualizerSnapshot, rows)
        ? cachedVirtualizerSnapshot.scrollOffset
        : null,
    [cachedVirtualizerSnapshot, rows],
  );
  const shouldRestoreInitialScrollOffset = restoredInitialScrollOffset !== null;
  const estimatedRowSizes = useMemo(
    () => rows.map((row) => getEstimatedTimelineRowSize(row, expandedWorkGroupIds)),
    [rows, expandedWorkGroupIds],
  );
  const initialScrollOffset = useMemo(() => {
    if (restoredInitialScrollOffset !== null) {
      return restoredInitialScrollOffset;
    }
    return estimateInitialTimelineBottomOffset(estimatedRowSizes, virtualizerBottomPadding);
  }, [estimatedRowSizes, restoredInitialScrollOffset, virtualizerBottomPadding]);

  rowsRef.current = rows;
  stickyUserRowIndicesRef.current = stickyUserRowIndices;

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

  const clearProgrammaticScrollTracking = useCallback(() => {
    programmaticScrollActiveRef.current = false;
    if (programmaticScrollFrameRef.current != null) {
      window.cancelAnimationFrame(programmaticScrollFrameRef.current);
      programmaticScrollFrameRef.current = null;
    }
  }, []);

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
    initialMeasurementsCache,
    anchorTo: "end",
    followOnAppend: true,
    scrollEndThreshold: TIMELINE_SCROLL_END_THRESHOLD_PX,
    useAnimationFrameWithResizeObserver: true,
  });

  const getIsAtBottom = useCallback(
    () => rowVirtualizer.isAtEnd(TIMELINE_SCROLL_END_THRESHOLD_PX),
    [rowVirtualizer],
  );

  const scheduleProgrammaticScrollResolution = useCallback(() => {
    if (programmaticScrollFrameRef.current != null) {
      return;
    }

    const resolveProgrammaticScroll = () => {
      programmaticScrollFrameRef.current = null;
      if (!programmaticScrollActiveRef.current) {
        return;
      }

      const isAtBottom = getIsAtBottom();
      if (isAtBottom || window.performance.now() >= programmaticScrollDeadlineRef.current) {
        programmaticScrollActiveRef.current = false;
        reportIsAtBottom(isAtBottom);
        return;
      }

      programmaticScrollFrameRef.current = window.requestAnimationFrame(resolveProgrammaticScroll);
    };

    programmaticScrollFrameRef.current = window.requestAnimationFrame(resolveProgrammaticScroll);
  }, [getIsAtBottom, reportIsAtBottom]);

  const scrollToBottom = useCallback(
    (options?: { animated?: boolean }) => {
      if (!scrollElementRef.current) {
        return;
      }

      const animated = options?.animated === true;
      if (animated) {
        programmaticScrollActiveRef.current = true;
        programmaticScrollDeadlineRef.current = window.performance.now() + 1600;
      } else {
        clearProgrammaticScrollTracking();
      }

      rowVirtualizer.scrollToEnd({ behavior: animated ? "smooth" : "auto" });
      if (animated) {
        scheduleProgrammaticScrollResolution();
      } else {
        reportIsAtBottom(true);
      }
    },
    [
      clearProgrammaticScrollTracking,
      reportIsAtBottom,
      rowVirtualizer,
      scheduleProgrammaticScrollResolution,
    ],
  );
  const getIsAtBottomVersion = useValueIdentityVersion(getIsAtBottom);
  const scrollToBottomVersion = useValueIdentityVersion(scrollToBottom);

  const handleScroll = useCallback(() => {
    const isAtBottom = getIsAtBottom();
    if (programmaticScrollActiveRef.current) {
      if (isAtBottom) {
        clearProgrammaticScrollTracking();
        reportIsAtBottom(true);
      }
      return;
    }

    reportIsAtBottom(isAtBottom);
  }, [clearProgrammaticScrollTracking, getIsAtBottom, reportIsAtBottom]);

  useLayoutSyncEffect(() => {
    if (rows.length === 0 || initializedScrollRef.current) {
      return;
    }

    initializedScrollRef.current = true;
    if (shouldRestoreInitialScrollOffset) {
      reportIsAtBottom(false, { force: true });
      return;
    }

    rowVirtualizer.scrollToEnd({ behavior: "auto" });
    reportIsAtBottom(true, { force: true });
  }, [reportIsAtBottom, rowVirtualizer, rows.length, shouldRestoreInitialScrollOffset]);

  useLayoutSyncEffect(() => {
    if (!initializedScrollRef.current || rows.length === 0 || !isAtBottomRef.current) {
      return;
    }

    rowVirtualizer.scrollToEnd({ behavior: "auto" });
  }, [rowVirtualizer, virtualizerBottomPadding]);

  useLayoutSyncEffect(
    () => () => {
      rememberTimelineVirtualizerSnapshot({
        cacheKey: timelineCacheKey,
        isAtBottom: isAtBottomRef.current,
        rows: rowsRef.current,
        scrollElement: scrollElementRef.current,
        virtualizer: rowVirtualizer,
      });
    },
    [rowVirtualizer, timelineCacheKey],
  );

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
const WORK_GROUP_PREVIEW_ENTRY_PX = 28;
const WORK_GROUP_HEADER_PX = 28;
const ASSISTANT_MESSAGE_MIN_PX = 156;
const USER_MESSAGE_MIN_PX = 88;
const MESSAGE_ROW_CHROME_PX = 40;
const MESSAGE_TEXT_LINE_HEIGHT_PX = 21;
const ASSISTANT_MESSAGE_CHARS_PER_LINE = 82;
const USER_MESSAGE_CHARS_PER_LINE = 96;
const estimatedTimelineRowSizeCache = new WeakMap<MessagesTimelineRow, number>();

function filterReusableTimelineMeasurements(
  snapshot: TimelineVirtualizerSnapshot | null,
  rows: readonly MessagesTimelineRow[],
): VirtualItem[] {
  if (!snapshot || snapshot.measuredItems.length === 0 || rows.length === 0) {
    return [];
  }

  const rowIds = new Set(rows.map((row) => row.id));
  return snapshot.measuredItems.filter(
    (item) => typeof item.key === "string" && rowIds.has(item.key),
  );
}

function shouldRestoreTimelineScrollOffset(
  snapshot: TimelineVirtualizerSnapshot | null,
  rows: readonly MessagesTimelineRow[],
): snapshot is TimelineVirtualizerSnapshot {
  return (
    snapshot !== null &&
    !snapshot.isAtBottom &&
    snapshot.scrollOffset > 0 &&
    Number.isFinite(snapshot.scrollOffset) &&
    snapshot.firstRowId === rows[0]?.id
  );
}

function rememberTimelineVirtualizerSnapshot(input: {
  cacheKey: string;
  virtualizer: Virtualizer<HTMLDivElement, HTMLDivElement>;
  scrollElement: HTMLDivElement | null;
  rows: readonly MessagesTimelineRow[];
  isAtBottom: boolean;
}): void {
  if (input.rows.length === 0) {
    return;
  }

  const scrollOffset = Math.max(
    0,
    input.scrollElement?.scrollTop ?? input.virtualizer.scrollOffset ?? 0,
  );
  const measuredItems = input.virtualizer.takeSnapshot();
  if (measuredItems.length === 0 && scrollOffset === 0 && input.isAtBottom) {
    return;
  }

  timelineVirtualizerSnapshots.delete(input.cacheKey);
  timelineVirtualizerSnapshots.set(input.cacheKey, {
    measuredItems,
    scrollOffset,
    isAtBottom: input.isAtBottom,
    firstRowId: input.rows[0]?.id,
  });

  while (timelineVirtualizerSnapshots.size > MAX_TIMELINE_VIRTUALIZER_SNAPSHOTS) {
    const oldestCacheKey = timelineVirtualizerSnapshots.keys().next().value;
    if (oldestCacheKey === undefined) {
      return;
    }
    timelineVirtualizerSnapshots.delete(oldestCacheKey);
  }
}

function getEstimatedTimelineRowSize(
  row: MessagesTimelineRow,
  expandedWorkGroupIds: ReadonlySet<string>,
): number {
  if (row.kind === "work") {
    return estimateTimelineRowSize(row, expandedWorkGroupIds.has(row.id));
  }
  const cachedSize = estimatedTimelineRowSizeCache.get(row);
  if (cachedSize !== undefined) {
    return cachedSize;
  }

  const size = estimateTimelineRowSize(row, false);
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

function estimateTimelineRowSize(
  row: MessagesTimelineRow | undefined,
  expanded = false,
): number {
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

  if (expanded) {
    const childRowsHeight = row.groupedEntries.length * WORK_GROUP_PREVIEW_ENTRY_PX;
    return WORK_GROUP_HEADER_PX + childRowsHeight + VIRTUAL_ROW_GAP_PX;
  }

  if (row.isRunning) {
    const previewCount = Math.min(row.groupedEntries.length, WORK_GROUP_PREVIEW_MAX_ENTRIES);
    const previewHeight = Math.min(
      WORK_GROUP_PREVIEW_PX,
      previewCount * WORK_GROUP_PREVIEW_ENTRY_PX,
    );
    return WORK_GROUP_HEADER_PX + previewHeight + VIRTUAL_ROW_GAP_PX;
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

// Route each row model to its renderer.

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
        editAvailable={row.editAvailable}
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

// Collapsible group for adjacent tool activity rows.

const WorkGroupSection = memo(function WorkGroupSection({
  row,
  expanded,
  onToggleExpanded,
}: {
  row: Extract<MessagesTimelineRow, { kind: "work" }>;
  expanded: boolean;
  onToggleExpanded: (rowId: string) => void;
}) {
  const { projectRoot, activeThreadId, activeThreadEnvironmentId } = use(TimelineRowCtx);
  const summary = row.summary;
  const isRunning = row.isRunning;
  const isThinkingGroup = row.groupedEntries.every((entry) => entry.tone === "thinking");
  const isCommandGroup = row.groupedEntries.every(isCommandWorkEntry);
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
            "size-3 shrink-0 text-multi-icon-tertiary transition-transform duration-(--motion-duration-collapsible) ease-out",
            expanded && "rotate-90",
          )}
        />
      </button>
      {expanded ? (
        <div className="flex min-w-0 max-w-full flex-col gap-(--chat-timeline-step-gap)">
          {!isCommandGroup ? <WorkGroupSummaryLine summary={summary} /> : null}
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
      ) : isRunning ? (
        <WorkGroupPreview
          key={`work-preview:${row.id}`}
          row={row}
          onExpand={handleToggle}
          projectRoot={projectRoot}
          activeThreadId={activeThreadId}
          activeThreadEnvironmentId={activeThreadEnvironmentId}
        />
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
  activeThreadId,
  activeThreadEnvironmentId,
}: {
  row: Extract<MessagesTimelineRow, { kind: "work" }>;
  onExpand: () => void;
  projectRoot: string | undefined;
  activeThreadId: ThreadId;
  activeThreadEnvironmentId: EnvironmentId;
}) {
  const scrollHostRef = useRef<HTMLDivElement | null>(null);
  const entries = row.groupedEntries;
  const previewEntries = entries.slice(-WORK_GROUP_PREVIEW_MAX_ENTRIES);
  const lastEntryId = entries.at(-1)?.id;
  const previewEntryCount = previewEntries.length;

  useLayoutSyncEffect(() => {
    const host = scrollHostRef.current;
    if (!host) return;
    host.scrollTop = host.scrollHeight;
    updatePreviewScrollable(host);
  }, [lastEntryId, previewEntryCount, row.isRunning]);

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
      className="flex w-full min-h-0 max-w-full cursor-pointer flex-col gap-(--chat-timeline-step-gap) overflow-x-hidden overflow-y-auto [overflow-anchor:none] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{
        maxHeight: WORK_GROUP_PREVIEW_PX,
      }}
    >
      {previewEntries.map((workEntry) => (
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

// Reuse old row references when data has not changed.

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
