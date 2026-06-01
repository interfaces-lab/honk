import { type EnvironmentId, type MessageId, type ThreadId } from "@multi/contracts";
import {
  memo,
  type RefObject,
  useCallback,
  type CSSProperties,
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
import { Spinner } from "@multi/ui/spinner";
import { type TimelineEntry } from "../../../session-logic";
import { type ChatMessage, type ProposedPlan } from "../../../types";
import { type ExpandedImagePreview } from "../message/expanded-image-preview";
import {
  computeStableMessagesTimelineRows,
  deriveMessagesTimelineRows,
  isCommandWorkEntry,
  type StableMessagesTimelineRowsState,
  type MessagesTimelineRow,
} from "./timeline-rows";
import { cn } from "~/lib/utils";
import { useMountEffect } from "~/hooks/use-mount-effect";
import {
  GroupedStepsRenderer,
  StepRenderer,
  WORK_GROUP_HEADER_GAP_PX,
  WORK_GROUP_HEADER_PX,
  WORK_GROUP_PREVIEW_ENTRY_PX,
  WORK_GROUP_PREVIEW_MAX_ENTRIES,
  WORK_GROUP_PREVIEW_PX,
  WORK_GROUP_STEP_GAP_PX,
  type StepRendererContext,
} from "./step-renderer";

type UserMessageTimelineRow = Extract<MessagesTimelineRow, { kind: "message" }>;

const DEFAULT_VIRTUALIZER_RECT = { width: 0, height: 720 };
const VIRTUAL_ROW_GAP_PX = 12;
const VIRTUALIZER_OVERSCAN = 8;
const TIMELINE_SCROLL_END_THRESHOLD_PX = 2;
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
  timelineEntries: TimelineEntry[];
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
  onUpdateProposedPlan?: (proposedPlan: ProposedPlan, nextMarkdown: string) => Promise<boolean>;
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
  onUpdateProposedPlan,
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

  useMountEffect(() => {
    rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, delta, instance) => {
      const activeStickyIndex = findActiveStickyUserRowIndex(
        stickyUserRowIndicesRef.current,
        instance.range?.startIndex ?? item.index,
      );
      if (item.index === activeStickyIndex) {
        return false;
      }
      return (
        delta !== 0 &&
        item.start < (instance.scrollOffset ?? 0) &&
        instance.scrollDirection !== "backward"
      );
    };

    return () => {
      rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = undefined;
    };
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

  const sharedState = useMemo<StepRendererContext>(
    () => ({
      markdownCwd,
      projectRoot,
      activeThreadId,
      activeThreadEnvironmentId,
      isServerThread,
      onBeginEditUserMessage,
      renderEditComposer,
      onUpdateProposedPlan,
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
      onUpdateProposedPlan,
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
  const floatingEditRow =
    activeStickyUserRowIndex === null ? undefined : rows[activeStickyUserRowIndex];
  const floatingEditUserRow =
    floatingEditRow?.kind === "message" &&
    floatingEditRow.message.role === "user" &&
    floatingEditRow.message.id === editingUserMessageId
      ? floatingEditRow
      : null;
  const virtualContentStyle = {
    height: rowVirtualizer.getTotalSize(),
    position: "relative",
  } satisfies CSSProperties;

  return (
    <>
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

              const isEditingUserMessage =
                row.kind === "message" &&
                row.message.role === "user" &&
                row.message.id === editingUserMessageId;
              const isActiveStickyUserRow = virtualRow.index === activeStickyUserRowIndex;
              const isFloatingEditingUserMessage = isActiveStickyUserRow && isEditingUserMessage;

              if (isFloatingEditingUserMessage) {
                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    aria-hidden="true"
                    className="box-border w-full px-4 pb-(--chat-timeline-row-gap) [contain:layout]"
                    style={virtualRowStyle(
                      virtualRow,
                      isActiveStickyUserRow,
                      isFloatingEditingUserMessage,
                    )}
                  />
                );
              }

              return (
                <div
                  key={virtualRow.key}
                  ref={rowVirtualizer.measureElement}
                  data-index={virtualRow.index}
                  className="flow-root w-full px-4 pb-(--chat-timeline-row-gap) [contain:layout]"
                  style={virtualRowStyle(
                    virtualRow,
                    isActiveStickyUserRow,
                    isFloatingEditingUserMessage,
                  )}
                >
                  <div
                    data-sticky={isActiveStickyUserRow ? "true" : undefined}
                    data-editing-user-message={isEditingUserMessage ? "true" : undefined}
                    className="w-full"
                  >
                    <TimelineRowContent
                      row={row}
                      workGroupExpanded={row.kind === "work" && expandedWorkGroupIds.has(row.id)}
                      onToggleWorkGroupExpanded={toggleWorkGroupExpanded}
                      editUserMessagesDisabled={editUserMessagesDisabled}
                      isEditingUserMessage={isEditingUserMessage}
                      ctx={sharedState}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {floatingEditUserRow ? (
          <div
            data-floating-edit-row-backplate="true"
            className="pointer-events-none absolute inset-x-0 z-[102]"
            style={{ top: "var(--chat-timeline-padding-block-start)" }}
          >
            <div className="mx-auto box-border w-full max-w-agent-chat px-4 pb-(--chat-timeline-row-gap)">
              <div
                data-sticky="true"
                data-editing-user-message="true"
                className="pointer-events-auto w-full"
              >
                <TimelineRowContent
                  row={floatingEditUserRow}
                  workGroupExpanded={false}
                  onToggleWorkGroupExpanded={toggleWorkGroupExpanded}
                  editUserMessagesDisabled={editUserMessagesDisabled}
                  isEditingUserMessage
                  ctx={sharedState}
                />
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </>
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

function estimateTimelineRowSize(row: MessagesTimelineRow | undefined, expanded = false): number {
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
    const hasExpandedSummary = row.groupedEntries.some((entry) => !isCommandWorkEntry(entry));
    const expandedRowCount = row.groupedEntries.length + (hasExpandedSummary ? 1 : 0);
    const childRowsHeight = row.groupedEntries.length * WORK_GROUP_PREVIEW_ENTRY_PX;
    const expandedContentGap = Math.max(0, expandedRowCount - 1) * WORK_GROUP_STEP_GAP_PX;
    return (
      WORK_GROUP_HEADER_PX +
      WORK_GROUP_HEADER_GAP_PX +
      childRowsHeight +
      (hasExpandedSummary ? WORK_GROUP_PREVIEW_ENTRY_PX : 0) +
      expandedContentGap +
      VIRTUAL_ROW_GAP_PX
    );
  }

  if (row.isRunning) {
    const previewCount = Math.min(row.groupedEntries.length, WORK_GROUP_PREVIEW_MAX_ENTRIES);
    const previewHeight = Math.min(
      WORK_GROUP_PREVIEW_PX,
      previewCount * WORK_GROUP_PREVIEW_ENTRY_PX,
    );
    return WORK_GROUP_HEADER_PX + WORK_GROUP_HEADER_GAP_PX + previewHeight + VIRTUAL_ROW_GAP_PX;
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

function virtualRowStyle(
  virtualRow: VirtualItem,
  isSticky: boolean,
  isFloatingEdit: boolean,
): CSSProperties {
  if (isSticky) {
    return {
      position: "sticky",
      top: 0,
      zIndex: 101,
      ...(isFloatingEdit ? { height: virtualRow.size } : null),
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
  ctx,
}: {
  row: TimelineRow;
  workGroupExpanded: boolean;
  onToggleWorkGroupExpanded: (rowId: string) => void;
  editUserMessagesDisabled: boolean;
  isEditingUserMessage?: boolean;
  ctx: StepRendererContext;
}) {
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
      data-message-kind={timelineRowMessageKind(row)}
      data-message-index={row.kind === "message" ? row.messageIndex : undefined}
      data-message-pair-id={row.kind === "message" ? (row.pairId ?? undefined) : undefined}
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
  ctx: StepRendererContext;
}) {
  if (row.kind === "work") {
    return (
      <div className="flex w-full min-w-0">
        <GroupedStepsRenderer
          row={row}
          expanded={workGroupExpanded}
          onToggleExpanded={onToggleWorkGroupExpanded}
          editUserMessagesDisabled={editUserMessagesDisabled}
          ctx={ctx}
        />
      </div>
    );
  }

  return (
    <StepRenderer
      step={row.kind === "working" ? row.step : row}
      editUserMessagesDisabled={editUserMessagesDisabled}
      isEditingUserMessage={isEditingUserMessage}
      ctx={ctx}
    />
  );
}

function timelineRowKind(row: TimelineRow): "human" | "assistant" | "tool-call" | "loading" {
  if (row.kind === "message") return row.message.role === "user" ? "human" : "assistant";
  if (row.kind === "working") return "loading";
  return "tool-call";
}

// Matches Cursor's `data-message-kind` semantics: "message" for user/assistant
// text bubbles, "tool" for tool-call rows. Proposed plans and working rows fall
// outside this taxonomy.
function timelineRowMessageKind(row: TimelineRow): "message" | "tool" | undefined {
  if (row.kind === "message") return "message";
  if (row.kind === "work") return "tool";
  return undefined;
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
