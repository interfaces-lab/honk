import { type EnvironmentId, type MessageId, type ThreadId } from "@honk/contracts";
import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useLayoutSyncEffect } from "~/hooks/use-layout-sync-effect";
import { useConversationDensity } from "~/hooks/use-conversation-density";
import {
  defaultRangeExtractor,
  useVirtualizer,
  type Range,
  type VirtualItem,
  type Virtualizer,
} from "@tanstack/react-virtual";
import { type PendingApproval, type TimelineEntry } from "../../../session-logic";
import { type ChatMessage, type ProposedPlan } from "../../../types";
import { type ExpandedImagePreview } from "../message/expanded-image-preview";
import {
  computeStableMessagesTimelineRows,
  deriveMessagesTimelineRows,
  isCommandWorkEntry,
  type StableMessagesTimelineRowsState,
  type MessagesTimelineRow,
} from "./timeline-rows";
import {
  EMPTY_PENDING_APPROVAL_KINDS,
  type PendingApprovalRequestKind,
} from "./timeline-render-items";
import { cn } from "~/lib/utils";
import { useMountEffect } from "~/hooks/use-mount-effect";
import {
  GroupedStepsRenderer,
  StepRenderer,
  countRenderableWorkGroupPreviewSteps,
  runningWorkGroupPreviewOutputStripExtraPx,
  WORK_GROUP_HEADER_GAP_PX,
  WORK_GROUP_HEADER_PX,
  WORK_GROUP_PREVIEW_ENTRY_PX,
  WORK_GROUP_PREVIEW_PX,
  WORK_GROUP_STEP_GAP_PX,
  type StepRendererContext,
} from "./step-renderer";
import {
  computeDynamicPaddingEndPx,
  computeLastPairMinHeightPx,
  computeLastTurnContentHeightPx,
  computePinnedState,
  NEAR_BOTTOM_THRESHOLD_PX,
  shouldAdjustScrollOnItemResize,
  type TimelineScrollFollowState,
} from "./timeline-scroll-follow";

type UserMessageTimelineRow = Extract<MessagesTimelineRow, { kind: "message" }>;

const DEFAULT_VIRTUALIZER_RECT = { width: 0, height: 720 };
const VIRTUAL_ROW_GAP_PX = 12;
const VIRTUALIZER_OVERSCAN = 8;
const MAX_TIMELINE_VIRTUALIZER_SNAPSHOTS = 16;
const INITIAL_OFFSET_SAMPLE_ROW_COUNT = 64;

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
  isTurnActive: boolean;
  isStreaming?: boolean;
  disableAutoScroll?: boolean;
  editUserMessagesDisabled: boolean;
  bottomClearancePx?: number | undefined;
  timelineControllerRef: React.RefObject<MessagesTimelineController | null>;
  timelineEntries: ReadonlyArray<TimelineEntry>;
  pendingApprovals?: ReadonlyArray<PendingApproval> | undefined;
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
  onIsAtBottomChange: (isAtBottom: boolean) => void;
}

// Virtualized message list.

export function MessagesTimeline({
  isWorking,
  isTurnActive,
  isStreaming = false,
  disableAutoScroll = false,
  editUserMessagesDisabled,
  bottomClearancePx = 0,
  timelineControllerRef,
  timelineEntries,
  pendingApprovals,
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
  onIsAtBottomChange,
}: MessagesTimelineProps) {
  const conversationDensity = useConversationDensity();
  const pendingApprovalKinds = useMemo<ReadonlySet<PendingApprovalRequestKind>>(
    () =>
      pendingApprovals && pendingApprovals.length > 0
        ? new Set(pendingApprovals.map((approval) => approval.requestKind))
        : EMPTY_PENDING_APPROVAL_KINDS,
    [pendingApprovals],
  );
  const rawRows = useMemo(
    () =>
      deriveMessagesTimelineRows({
        timelineEntries,
        isTurnActive,
        editableUserMessageIds,
        projectRoot,
        conversationDensity,
        pendingApprovalKinds,
      }),
    [
      conversationDensity,
      editableUserMessageIds,
      isTurnActive,
      pendingApprovalKinds,
      projectRoot,
      timelineEntries,
    ],
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
  const scrollFollowRef = useRef<TimelineScrollFollowState>({ pinned: true, atBottom: true });
  const lastUserScrollInputAtRef = useRef(0);
  const isUserPointerDownRef = useRef(false);
  const previousScrollOffsetRef = useRef(0);
  const disableAutoScrollRef = useRef(disableAutoScroll);
  const isStreamingRef = useRef(isStreaming);
  const programmaticScrollFrameRef = useRef<number | null>(null);
  const programmaticScrollDeadlineRef = useRef(0);
  const programmaticScrollActiveRef = useRef(false);
  const initializedScrollRef = useRef(false);
  const stickyUserRowIndicesRef = useRef(stickyUserRowIndices);
  const rowsRef = useRef(rows);
  const [scrollViewportHeight, setScrollViewportHeight] = useState(DEFAULT_VIRTUALIZER_RECT.height);
  const virtualizerBottomPadding = Math.max(0, Math.ceil(bottomClearancePx));
  disableAutoScrollRef.current = disableAutoScroll;
  isStreamingRef.current = isStreaming;
  const lastHumanRowIndex = stickyUserRowIndices.at(-1) ?? null;
  const estimateRowHeight = useCallback(
    (index: number) => estimateVirtualTimelineRowSize(rows[index], expandedWorkGroupIds),
    [expandedWorkGroupIds, rows],
  );
  const cachedVirtualizerSnapshot = timelineVirtualizerSnapshots.get(timelineCacheKey) ?? null;
  const initialMeasurementsCache = filterReusableTimelineMeasurements(
    cachedVirtualizerSnapshot,
    rows,
  );
  const virtualizerMeasurementsRef = useRef<VirtualItem[]>(initialMeasurementsCache);
  const lastPairMinHeightPx = computeLastPairMinHeightPx(scrollViewportHeight);
  const measuredHeightsForPadding = new Map<string, number>();
  if (lastHumanRowIndex !== null) {
    for (let index = lastHumanRowIndex; index < rows.length; index += 1) {
      const row = rows[index];
      if (!row) {
        continue;
      }
      const measuredItem = virtualizerMeasurementsRef.current.find((item) => item.index === index);
      measuredHeightsForPadding.set(row.id, measuredItem?.size ?? estimateRowHeight(index));
    }
  }
  const lastTurnHeightForPadding = computeLastTurnContentHeightPx(
    rows,
    measuredHeightsForPadding,
    lastHumanRowIndex ?? undefined,
  );
  const dynamicPaddingEnd = computeDynamicPaddingEndPx({
    basePadding: virtualizerBottomPadding,
    lastTurnHeight: lastTurnHeightForPadding,
    minHeight: lastPairMinHeightPx,
  });
  const restoredInitialScrollOffset = shouldRestoreTimelineScrollOffset(
    cachedVirtualizerSnapshot,
    rows,
  )
    ? cachedVirtualizerSnapshot.scrollOffset
    : null;
  const shouldRestoreInitialScrollOffset = restoredInitialScrollOffset !== null;
  const initialScrollOffset =
    restoredInitialScrollOffset !== null
      ? restoredInitialScrollOffset
      : estimateInitialTimelineBottomOffset({
          rows,
          paddingEnd: dynamicPaddingEnd,
          expandedWorkGroupIds,
        });

  rowsRef.current = rows;
  stickyUserRowIndicesRef.current = stickyUserRowIndices;

  const reportIsAtBottom = useCallback(
    (isAtBottom: boolean, options?: { force?: boolean }) => {
      if (!options?.force && scrollFollowRef.current.atBottom === isAtBottom) {
        return;
      }
      scrollFollowRef.current = {
        ...scrollFollowRef.current,
        atBottom: isAtBottom,
      };
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
    estimateSize: (index) => estimateVirtualTimelineRowSize(rows[index], expandedWorkGroupIds),
    getItemKey: (index) => rows[index]?.id ?? index,
    rangeExtractor,
    overscan: VIRTUALIZER_OVERSCAN,
    paddingEnd: dynamicPaddingEnd,
    initialRect: DEFAULT_VIRTUALIZER_RECT,
    initialOffset: initialScrollOffset,
    initialMeasurementsCache,
    anchorTo: "end",
    followOnAppend: true,
    scrollEndThreshold: NEAR_BOTTOM_THRESHOLD_PX + dynamicPaddingEnd,
    useAnimationFrameWithResizeObserver: true,
  });
  virtualizerMeasurementsRef.current = rowVirtualizer.measurementsCache;
  const virtualContentSize = rowVirtualizer.getTotalSize();

  useLayoutSyncEffect(() => {
    const scrollElement = scrollElementRef.current;
    if (!scrollElement) {
      return;
    }

    const updateViewportHeight = () => {
      setScrollViewportHeight(scrollElement.clientHeight);
    };
    updateViewportHeight();

    const observer = new ResizeObserver(updateViewportHeight);
    observer.observe(scrollElement);
    return () => observer.disconnect();
  }, []);

  useLayoutSyncEffect(() => {
    rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, delta, instance) => {
      const activeStickyIndex = findActiveStickyUserRowIndex(
        stickyUserRowIndicesRef.current,
        instance.range?.startIndex ?? item.index,
      );
      if (item.index === activeStickyIndex) {
        return false;
      }

      const scrollOffset = instance.scrollOffset ?? 0;
      const pinnedFollowing = scrollFollowRef.current.pinned && !disableAutoScrollRef.current;

      if (isStreamingRef.current) {
        return shouldAdjustScrollOnItemResize({
          isStreaming: true,
          pinnedFollowing,
          delta,
          itemEnd: item.end,
          scrollOffset,
        });
      }

      return delta !== 0 && item.start < scrollOffset && instance.scrollDirection !== "backward";
    };
  }, [rowVirtualizer]);

  const getIsAtBottom = useCallback(
    () => rowVirtualizer.isAtEnd(NEAR_BOTTOM_THRESHOLD_PX + dynamicPaddingEnd),
    [dynamicPaddingEnd, rowVirtualizer],
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

      scrollFollowRef.current = { pinned: true, atBottom: true };

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

  const recordUserScrollInput = useCallback(() => {
    lastUserScrollInputAtRef.current = window.performance.now();
    clearProgrammaticScrollTracking();
  }, [clearProgrammaticScrollTracking]);

  const handleScroll = useCallback(() => {
    const scrollElement = scrollElementRef.current;
    if (!scrollElement) {
      return;
    }

    const scrollOffset = scrollElement.scrollTop;
    const lastObservedScrollOffset = previousScrollOffsetRef.current;
    previousScrollOffsetRef.current = scrollOffset;

    if (programmaticScrollActiveRef.current) {
      const isAtBottom = getIsAtBottom();
      if (isAtBottom) {
        clearProgrammaticScrollTracking();
        scrollFollowRef.current = { pinned: true, atBottom: true };
        reportIsAtBottom(true);
      }
      return;
    }

    scrollFollowRef.current = computePinnedState(scrollFollowRef.current, {
      totalHeight: scrollElement.scrollHeight,
      clampedOffset: scrollOffset,
      viewportHeight: scrollElement.clientHeight,
      isScrolling: rowVirtualizer.isScrolling,
      lastObservedScrollOffset,
      isUserPointerDown: isUserPointerDownRef.current,
      msSinceUserScrollInput: window.performance.now() - lastUserScrollInputAtRef.current,
      isReady: initializedScrollRef.current,
      isProgrammaticScrollActive: programmaticScrollActiveRef.current,
    });
    reportIsAtBottom(scrollFollowRef.current.atBottom);
  }, [clearProgrammaticScrollTracking, getIsAtBottom, reportIsAtBottom, rowVirtualizer]);

  useLayoutSyncEffect(() => {
    if (rows.length === 0 || initializedScrollRef.current) {
      return;
    }

    initializedScrollRef.current = true;
    if (shouldRestoreInitialScrollOffset) {
      scrollFollowRef.current = { pinned: false, atBottom: false };
      reportIsAtBottom(false, { force: true });
      return;
    }

    scrollFollowRef.current = { pinned: true, atBottom: true };
    rowVirtualizer.scrollToEnd({ behavior: "auto" });
    reportIsAtBottom(true, { force: true });
  }, [reportIsAtBottom, rowVirtualizer, rows.length, shouldRestoreInitialScrollOffset]);

  useLayoutSyncEffect(() => {
    if (!initializedScrollRef.current || rows.length === 0) {
      return;
    }

    if (!scrollFollowRef.current.pinned || disableAutoScrollRef.current) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      if (!scrollFollowRef.current.pinned || disableAutoScrollRef.current) {
        return;
      }
      rowVirtualizer.scrollToEnd({ behavior: "auto" });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [
    dynamicPaddingEnd,
    isStreaming,
    rowVirtualizer,
    rows,
    scrollViewportHeight,
    virtualContentSize,
  ]);

  useLayoutSyncEffect(
    () => () => {
      rememberTimelineVirtualizerSnapshot({
        cacheKey: timelineCacheKey,
        isAtBottom: scrollFollowRef.current.atBottom,
        rows: rowsRef.current,
        scrollElement: scrollElementRef.current,
        virtualizer: rowVirtualizer,
      });
    },
    [rowVirtualizer, timelineCacheKey],
  );

  const sharedState: StepRendererContext = useMemo(
    () => ({
      markdownCwd,
      projectRoot,
      activeThreadId,
      activeThreadEnvironmentId,
      isServerThread,
      pendingApprovalKinds,
      onBeginEditUserMessage,
      renderEditComposer,
      onUpdateProposedPlan,
      onImageExpand,
    }),
    [
      activeThreadEnvironmentId,
      activeThreadId,
      isServerThread,
      markdownCwd,
      onBeginEditUserMessage,
      onImageExpand,
      onUpdateProposedPlan,
      pendingApprovalKinds,
      projectRoot,
      renderEditComposer,
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
          onPointerDown={() => {
            isUserPointerDownRef.current = true;
            recordUserScrollInput();
          }}
          onPointerUp={() => {
            isUserPointerDownRef.current = false;
          }}
          onPointerCancel={() => {
            isUserPointerDownRef.current = false;
          }}
          onTouchStart={recordUserScrollInput}
          onWheel={recordUserScrollInput}
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
                      workGroupExpanded={
                        row.kind === "work" && "steps" in row && expandedWorkGroupIds.has(row.id)
                      }
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
            className="pointer-events-none absolute inset-x-0 z-(--z-index-chat-timeline-floating-edit-row)"
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
}

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

const ASSISTANT_MESSAGE_MIN_PX = 64;
const USER_MESSAGE_MIN_PX = 56;

function filterReusableTimelineMeasurements(
  snapshot: TimelineVirtualizerSnapshot | null,
  rows: readonly MessagesTimelineRow[],
): VirtualItem[] {
  if (!snapshot || snapshot.measuredItems.length === 0 || rows.length === 0) {
    return [];
  }

  const rowsById = new Map(rows.map((row) => [row.id, row] as const));
  return snapshot.measuredItems.filter((item) => {
    if (typeof item.key !== "string") {
      return false;
    }
    const row = rowsById.get(item.key);
    return row !== undefined && row.kind !== "work";
  });
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

function estimateVirtualTimelineRowSize(
  row: MessagesTimelineRow | undefined,
  expandedWorkGroupIds: ReadonlySet<string>,
): number {
  return estimateTimelineRowSize(
    row,
    row?.kind === "work" && "steps" in row && expandedWorkGroupIds.has(row.id),
  );
}

function estimateInitialTimelineBottomOffset(input: {
  rows: readonly MessagesTimelineRow[];
  paddingEnd: number;
  expandedWorkGroupIds: ReadonlySet<string>;
}): number {
  if (input.rows.length === 0) {
    return 0;
  }

  const sampleStartIndex = Math.max(0, input.rows.length - INITIAL_OFFSET_SAMPLE_ROW_COUNT);
  let sampledSize = 0;
  let sampledCount = 0;
  for (let index = sampleStartIndex; index < input.rows.length; index += 1) {
    sampledSize += estimateVirtualTimelineRowSize(input.rows[index], input.expandedWorkGroupIds);
    sampledCount += 1;
  }

  const averageRowSize = sampledCount > 0 ? sampledSize / sampledCount : 96 + VIRTUAL_ROW_GAP_PX;
  const totalSize = averageRowSize * input.rows.length + input.paddingEnd;
  return Math.max(0, totalSize - DEFAULT_VIRTUALIZER_RECT.height);
}

const runningWorkGroupEstimateHeights = new Map<string, number>();

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

  if (row.kind === "runtime-thinking") {
    return 96 + VIRTUAL_ROW_GAP_PX;
  }

  if (
    row.kind === "runtime-task" ||
    row.kind === "runtime-tool" ||
    row.kind === "runtime-extension-ui-request"
  ) {
    return 64 + VIRTUAL_ROW_GAP_PX;
  }

  if (row.kind === "working") {
    return 52 + VIRTUAL_ROW_GAP_PX;
  }

  if (row.kind === "work" && "entry" in row) {
    return 64 + VIRTUAL_ROW_GAP_PX;
  }

  if (expanded) {
    const hasExpandedSummary =
      row.groupedEntries.length > 0
        ? row.groupedEntries.some((entry) => !isCommandWorkEntry(entry))
        : !row.isCommandGroup && !row.isThinkingGroup;
    const expandedRowCount = row.steps.length + (hasExpandedSummary ? 1 : 0);
    const childRowsHeight = row.steps.length * WORK_GROUP_PREVIEW_ENTRY_PX;
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
    const previewCount = countRenderableWorkGroupPreviewSteps(row.steps);
    const previewStepsHeight =
      previewCount > 0
        ? previewCount * WORK_GROUP_PREVIEW_ENTRY_PX +
          Math.max(0, previewCount - 1) * WORK_GROUP_STEP_GAP_PX
        : 0;
    const previewRawHeight =
      previewStepsHeight + runningWorkGroupPreviewOutputStripExtraPx(row.steps);
    const previewContentHeight = Math.min(WORK_GROUP_PREVIEW_PX, previewRawHeight);
    const previewPaddingTop =
      previewCount > 0 && previewContentHeight >= WORK_GROUP_PREVIEW_PX
        ? WORK_GROUP_STEP_GAP_PX
        : 0;
    const previewHeight = previewContentHeight + previewPaddingTop;
    const computedHeight =
      WORK_GROUP_HEADER_PX + WORK_GROUP_HEADER_GAP_PX + previewHeight + VIRTUAL_ROW_GAP_PX;
    const previousHeight = runningWorkGroupEstimateHeights.get(row.id);
    const totalHeight =
      previousHeight === undefined ? computedHeight : Math.max(previousHeight, computedHeight);
    runningWorkGroupEstimateHeights.set(row.id, totalHeight);
    return totalHeight;
  }

  if (row.kind === "work" && !("entry" in row)) {
    runningWorkGroupEstimateHeights.delete(row.id);
  }

  return WORK_GROUP_HEADER_PX + VIRTUAL_ROW_GAP_PX;
}

function estimateMessageTimelineRowSize(row: Extract<MessagesTimelineRow, { kind: "message" }>) {
  const minHeight = row.message.role === "user" ? USER_MESSAGE_MIN_PX : ASSISTANT_MESSAGE_MIN_PX;
  return minHeight + VIRTUAL_ROW_GAP_PX;
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
      zIndex: "var(--z-index-chat-timeline-sticky-user-message)",
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
      data-tool-call-id={
        row.kind === "runtime-task" || row.kind === "runtime-tool" ? row.tool.toolCallId : undefined
      }
      data-tool-status={timelineRowToolStatus(row)}
      data-tool-has-error={timelineRowToolHasError(row) ? "true" : undefined}
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
  if (row.kind === "work" && "steps" in row) {
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
  if (row.kind === "runtime-thinking") return "assistant";
  if (row.kind === "working") return "loading";
  return "tool-call";
}

// Matches Cursor's `data-message-kind` semantics: "message" for user/assistant
// text bubbles, "thinking" for reasoning rows, "tool" for tool-call rows.
// Proposed plans and working rows fall outside this taxonomy.
function timelineRowMessageKind(row: TimelineRow): "message" | "thinking" | "tool" | undefined {
  if (row.kind === "message") return "message";
  if (row.kind === "runtime-thinking") return "thinking";
  if (
    row.kind === "work" ||
    row.kind === "runtime-task" ||
    row.kind === "runtime-tool" ||
    row.kind === "runtime-extension-ui-request"
  ) {
    return "tool";
  }
  return undefined;
}

function timelineRowToolStatus(row: TimelineRow): "loading" | "completed" | "error" | undefined {
  switch (row.kind) {
    case "runtime-task":
    case "runtime-tool":
      if (row.tool.status === "error" || row.tool.isError === true) return "error";
      return row.tool.status === "running" ? "loading" : "completed";
    case "runtime-extension-ui-request":
      return row.request.status === "pending" ? "loading" : "completed";
    case "work":
      if ("entry" in row) {
        if (row.entry.tone === "error" || row.entry.status === "error") {
          return "error";
        }
        return row.entry.status === "running" ? "loading" : "completed";
      }
      // Error state belongs to the individual tool row. Group wrappers stay lifecycle-only so
      // a failed child does not turn the whole collapsed run into a persistent error status.
      return row.isRunning ? "loading" : "completed";
    default:
      return undefined;
  }
}

function timelineRowToolHasError(row: TimelineRow): boolean {
  return timelineRowToolStatus(row) === "error";
}

// Reuse old row references when data has not changed.

function useStableRows(rows: MessagesTimelineRow[]): MessagesTimelineRow[] {
  const prevState = useRef<StableMessagesTimelineRowsState>({
    byId: new Map<string, MessagesTimelineRow>(),
    result: [],
  });

  const nextState = computeStableMessagesTimelineRows(rows, prevState.current);
  prevState.current = nextState;
  return nextState.result;
}
