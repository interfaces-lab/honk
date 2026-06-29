"use client";

import {
  defaultRangeExtractor,
  useVirtualizer,
  type Range,
  type VirtualItem,
  type Virtualizer,
} from "@tanstack/react-virtual";
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";

import { cn } from "./utils";

const CONVERSATION_ROW_GAP_PX = 12;
const LAST_ANCHOR_MIN_HEIGHT_RATIO = 0.6;
const LAST_ANCHOR_MIN_HEIGHT_FLOOR_PX = 120;
const SCROLL_INSET_PX = 1;
const NEAR_END_THRESHOLD_PX = 4;
const USER_SCROLL_INPUT_WINDOW_MS = 250;
const PIN_SNAP_THRESHOLD_PX = 1;
const DEFAULT_VIRTUALIZER_RECT = { width: 0, height: 720 };
const DEFAULT_ROW_GAP_PX = CONVERSATION_ROW_GAP_PX;
const DEFAULT_OVERSCAN = 8;
const DEFAULT_MAX_CACHED_SNAPSHOTS = 16;
const DEFAULT_INITIAL_OFFSET_SAMPLE_ROW_COUNT = 64;
const SCROLL_TO_END_BUTTON_SHOW_DELAY_MS = 150;
const STICKY_ROW_Z_INDEX = 1;

interface ScrollFollowState {
  pinned: boolean;
  atEnd: boolean;
}

interface ConversationScrollerSnapshot {
  measuredItems: VirtualItem[];
  scrollOffset: number;
  isAtEnd: boolean;
  firstRowId: string | undefined;
}

const conversationScrollerSnapshots = new Map<string, ConversationScrollerSnapshot>();

export interface ConversationScrollerController {
  scrollToEnd: (options?: { animated?: boolean }) => void;
}

interface ConversationRowRenderInput<TRow> {
  row: TRow;
  index: number;
  isActiveSticky: boolean;
}

interface ConversationScrollToEndButtonRenderInput {
  scrollToEnd: (options?: { animated?: boolean }) => void;
}

interface ConversationScrollerProps<TRow> {
  rows: readonly TRow[];
  getRowId: (row: TRow, index: number) => string;
  renderRow: (input: ConversationRowRenderInput<TRow>) => ReactNode;
  estimateRowSize?: ((row: TRow, index: number) => number) | undefined;
  isAnchorRow?: ((row: TRow, index: number) => boolean) | undefined;
  shouldRenderStickyOverlay?: ((row: TRow, index: number) => boolean) | undefined;
  renderStickyOverlay?: ((input: ConversationRowRenderInput<TRow>) => ReactNode) | undefined;
  renderScrollToEndButton?:
    | ((input: ConversationScrollToEndButtonRenderInput) => ReactNode)
    | undefined;
  canReuseMeasurement?: ((row: TRow) => boolean) | undefined;
  cacheKey?: string | undefined;
  controllerRef?: RefObject<ConversationScrollerController | null> | undefined;
  onIsAtEndChange?: ((isAtEnd: boolean) => void) | undefined;
  isStreaming?: boolean | undefined;
  bottomClearancePx?: number | undefined;
  stickyTop?: number | string | undefined;
  className?: string | undefined;
  viewportClassName?: string | undefined;
  viewportDataAttributes?: Readonly<Record<`data-${string}`, string | undefined>> | undefined;
  contentClassName?: string | undefined;
  rowClassName?: string | undefined;
  stickyOverlayClassName?: string | undefined;
  "aria-label"?: string | undefined;
}

export function ConversationScroller<TRow>({
  rows,
  getRowId,
  renderRow,
  estimateRowSize,
  isAnchorRow,
  shouldRenderStickyOverlay,
  renderStickyOverlay,
  renderScrollToEndButton,
  canReuseMeasurement,
  cacheKey,
  controllerRef,
  onIsAtEndChange,
  isStreaming = false,
  bottomClearancePx = 0,
  stickyTop = 0,
  className,
  viewportClassName,
  viewportDataAttributes,
  contentClassName,
  rowClassName,
  stickyOverlayClassName,
  "aria-label": ariaLabel = "Conversation",
}: ConversationScrollerProps<TRow>) {
  const scrollElementRef = useRef<HTMLDivElement | null>(null);
  const scrollFollowRef = useRef<ScrollFollowState>({ pinned: true, atEnd: true });
  const lastUserScrollInputAtRef = useRef(0);
  const isUserPointerDownRef = useRef(false);
  const previousScrollOffsetRef = useRef(0);
  const isStreamingRef = useRef(isStreaming);
  const programmaticScrollFrameRef = useRef<number | null>(null);
  const showScrollToEndButtonTimeoutRef = useRef<number | null>(null);
  const programmaticScrollDeadlineRef = useRef(0);
  const programmaticScrollActiveRef = useRef(false);
  const initializedScrollRef = useRef(false);
  const rowsRef = useRef(rows);
  const rowIds = rows.map((row, index) => getRowId(row, index));
  const rowIdsRef = useRef(rowIds);
  const stickyRowIndices = rows.flatMap((row, index) =>
    isAnchorRow?.(row, index) === true ? [index] : [],
  );
  const stickyRowIndicesRef = useRef(stickyRowIndices);
  const [scrollViewportHeight, setScrollViewportHeight] = useState(DEFAULT_VIRTUALIZER_RECT.height);
  const [showScrollToEndButton, setShowScrollToEndButton] = useState(false);
  const virtualizerBottomPadding = Math.max(0, Math.ceil(bottomClearancePx));
  const cachedSnapshot = cacheKey ? (conversationScrollerSnapshots.get(cacheKey) ?? null) : null;
  const initialMeasurementsCache = filterReusableMeasurements({
    snapshot: cachedSnapshot,
    rows,
    getRowId,
    canReuseMeasurement,
  });
  const virtualizerMeasurementsRef = useRef<VirtualItem[]>(initialMeasurementsCache);
  const measuredHeightsForPadding = new Map<string, number>();
  const lastAnchorIndex = findLastAnchorRowIndex(rows, isAnchorRow);
  const estimateSize = (index: number) => {
    const row = rows[index]!;
    return (
      estimateRowSize?.(row, index) ?? DEFAULT_VIRTUALIZER_RECT.height / 6 + DEFAULT_ROW_GAP_PX
    );
  };

  if (lastAnchorIndex !== null) {
    for (let index = lastAnchorIndex; index < rows.length; index += 1) {
      const rowId = rowIds[index]!;
      const measuredItem = virtualizerMeasurementsRef.current.find((item) => item.index === index);
      measuredHeightsForPadding.set(rowId, measuredItem?.size ?? estimateSize(index));
    }
  }

  const lastAnchorHeightForPadding = computeLastAnchorContentHeightPx({
    rowIds,
    measuredHeights: measuredHeightsForPadding,
    lastAnchorIndex: lastAnchorIndex ?? undefined,
    estimateRowHeight: estimateSize,
  });
  const lastAnchorMinHeightPx =
    lastAnchorIndex === null
      ? 0
      : computeLastAnchorMinHeightPx({
          viewportHeight: scrollViewportHeight,
          viewportRatio: LAST_ANCHOR_MIN_HEIGHT_RATIO,
          floorPx: LAST_ANCHOR_MIN_HEIGHT_FLOOR_PX,
          scrollInsetPx: SCROLL_INSET_PX,
        });
  const dynamicPaddingEnd =
    lastAnchorIndex === null
      ? virtualizerBottomPadding
      : computeDynamicPaddingEndPx({
          basePadding: virtualizerBottomPadding,
          lastAnchorHeight: lastAnchorHeightForPadding,
          minHeight: lastAnchorMinHeightPx,
        });
  const shouldRestoreInitialScrollOffset =
    cachedSnapshot !== null && shouldRestoreSnapshot(cachedSnapshot, rowIds[0]);
  const initialScrollOffset = shouldRestoreInitialScrollOffset
    ? cachedSnapshot.scrollOffset
    : estimateInitialBottomOffset({
        rowCount: rows.length,
        paddingEnd: dynamicPaddingEnd,
        estimateRowSize: estimateSize,
        initialOffsetSampleRowCount: DEFAULT_INITIAL_OFFSET_SAMPLE_ROW_COUNT,
      });

  rowsRef.current = rows;
  rowIdsRef.current = rowIds;
  stickyRowIndicesRef.current = stickyRowIndices;
  isStreamingRef.current = isStreaming;

  const reportIsAtEnd = useCallback(
    (isAtEnd: boolean, options?: { force?: boolean }) => {
      if (!options?.force && scrollFollowRef.current.atEnd === isAtEnd) {
        return;
      }
      scrollFollowRef.current = { ...scrollFollowRef.current, atEnd: isAtEnd };
      if (isAtEnd) {
        clearScrollToEndButtonTimeout(showScrollToEndButtonTimeoutRef);
        setShowScrollToEndButton(false);
      } else if (showScrollToEndButtonTimeoutRef.current === null) {
        showScrollToEndButtonTimeoutRef.current = window.setTimeout(() => {
          showScrollToEndButtonTimeoutRef.current = null;
          setShowScrollToEndButton(true);
        }, SCROLL_TO_END_BUTTON_SHOW_DELAY_MS);
      }
      onIsAtEndChange?.(isAtEnd);
    },
    [onIsAtEndChange],
  );

  const clearProgrammaticScrollTracking = useCallback(() => {
    programmaticScrollActiveRef.current = false;
    if (programmaticScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(programmaticScrollFrameRef.current);
      programmaticScrollFrameRef.current = null;
    }
  }, []);

  const rangeExtractor = useCallback((range: Range) => {
    const defaultRange = defaultRangeExtractor(range);
    const activeStickyIndex = findActiveStickyRowIndex(
      stickyRowIndicesRef.current,
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
    estimateSize,
    getItemKey: (index) => rowIds[index]!,
    rangeExtractor,
    overscan: DEFAULT_OVERSCAN,
    paddingEnd: dynamicPaddingEnd,
    initialRect: DEFAULT_VIRTUALIZER_RECT,
    initialOffset: initialScrollOffset,
    initialMeasurementsCache,
    anchorTo: "end",
    followOnAppend: true,
    scrollEndThreshold: NEAR_END_THRESHOLD_PX + dynamicPaddingEnd,
    useAnimationFrameWithResizeObserver: true,
  });
  virtualizerMeasurementsRef.current = rowVirtualizer.measurementsCache;
  const virtualContentSize = rowVirtualizer.getTotalSize();

  useLayoutEffect(() => {
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

  useLayoutEffect(() => {
    rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, delta, instance) => {
      const activeStickyIndex = findActiveStickyRowIndex(
        stickyRowIndicesRef.current,
        instance.range?.startIndex ?? item.index,
      );
      if (item.index === activeStickyIndex) {
        return false;
      }

      const scrollOffset = instance.scrollOffset ?? 0;
      const pinnedFollowing = scrollFollowRef.current.pinned;

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

  const getIsAtEnd = useCallback(
    () => rowVirtualizer.isAtEnd(NEAR_END_THRESHOLD_PX + dynamicPaddingEnd),
    [dynamicPaddingEnd, rowVirtualizer],
  );

  const scheduleProgrammaticScrollResolution = useCallback(() => {
    if (programmaticScrollFrameRef.current !== null) {
      return;
    }

    const resolveProgrammaticScroll = () => {
      programmaticScrollFrameRef.current = null;
      if (!programmaticScrollActiveRef.current) {
        return;
      }

      const isAtEnd = getIsAtEnd();
      if (isAtEnd || window.performance.now() >= programmaticScrollDeadlineRef.current) {
        programmaticScrollActiveRef.current = false;
        reportIsAtEnd(isAtEnd);
        return;
      }

      programmaticScrollFrameRef.current = window.requestAnimationFrame(resolveProgrammaticScroll);
    };

    programmaticScrollFrameRef.current = window.requestAnimationFrame(resolveProgrammaticScroll);
  }, [getIsAtEnd, reportIsAtEnd]);

  const scrollToEnd = useCallback(
    (options?: { animated?: boolean }) => {
      if (!scrollElementRef.current) {
        return;
      }

      scrollFollowRef.current = { pinned: true, atEnd: true };

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
        reportIsAtEnd(true);
      }
    },
    [
      clearProgrammaticScrollTracking,
      reportIsAtEnd,
      rowVirtualizer,
      scheduleProgrammaticScrollResolution,
    ],
  );

  const recordUserScrollInput = () => {
    lastUserScrollInputAtRef.current = window.performance.now();
    clearProgrammaticScrollTracking();
  };

  const handleScroll = () => {
    const scrollElement = scrollElementRef.current;
    if (!scrollElement) {
      return;
    }

    const scrollOffset = scrollElement.scrollTop;
    const lastObservedScrollOffset = previousScrollOffsetRef.current;
    previousScrollOffsetRef.current = scrollOffset;

    if (programmaticScrollActiveRef.current) {
      const isAtEnd = getIsAtEnd();
      if (isAtEnd) {
        clearProgrammaticScrollTracking();
        scrollFollowRef.current = { pinned: true, atEnd: true };
        reportIsAtEnd(true);
      }
      return;
    }

    scrollFollowRef.current = computePinnedState(scrollFollowRef.current, {
      totalHeight: scrollElement.scrollHeight,
      clampedOffset: scrollOffset,
      viewportHeight: scrollElement.clientHeight,
      nearEndThresholdPx: NEAR_END_THRESHOLD_PX,
      isScrolling: rowVirtualizer.isScrolling,
      lastObservedScrollOffset,
      isUserPointerDown: isUserPointerDownRef.current,
      msSinceUserScrollInput: window.performance.now() - lastUserScrollInputAtRef.current,
      userInputWindowMs: USER_SCROLL_INPUT_WINDOW_MS,
      isReady: initializedScrollRef.current,
      isProgrammaticScrollActive: programmaticScrollActiveRef.current,
      pinSnapThresholdPx: PIN_SNAP_THRESHOLD_PX,
    });
    reportIsAtEnd(scrollFollowRef.current.atEnd);
  };

  useLayoutEffect(() => {
    if (rows.length === 0 || initializedScrollRef.current) {
      return;
    }

    initializedScrollRef.current = true;
    if (shouldRestoreInitialScrollOffset) {
      scrollFollowRef.current = { pinned: false, atEnd: false };
      reportIsAtEnd(false, { force: true });
      return;
    }

    scrollFollowRef.current = { pinned: true, atEnd: true };
    rowVirtualizer.scrollToEnd({ behavior: "auto" });
    reportIsAtEnd(true, { force: true });
  }, [reportIsAtEnd, rowVirtualizer, rows.length, shouldRestoreInitialScrollOffset]);

  useLayoutEffect(() => {
    if (!initializedScrollRef.current || rows.length === 0) {
      return;
    }

    if (!scrollFollowRef.current.pinned) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      if (!scrollFollowRef.current.pinned) {
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

  useLayoutEffect(() => {
    if (!controllerRef) {
      return;
    }

    const controller: ConversationScrollerController = {
      scrollToEnd,
    };

    controllerRef.current = controller;
    return () => {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    };
  }, [controllerRef, getIsAtEnd, scrollToEnd]);

  useLayoutEffect(
    () => () => {
      if (!cacheKey) {
        return;
      }
      rememberConversationScrollerSnapshot({
        cacheKey,
        maxCachedSnapshots: DEFAULT_MAX_CACHED_SNAPSHOTS,
        isAtEnd: scrollFollowRef.current.atEnd,
        rows: rowsRef.current,
        rowIds: rowIdsRef.current,
        scrollElement: scrollElementRef.current,
        virtualizer: rowVirtualizer,
      });
    },
    [cacheKey, rowVirtualizer],
  );

  useLayoutEffect(
    () => () => {
      clearProgrammaticScrollTracking();
      clearScrollToEndButtonTimeout(showScrollToEndButtonTimeoutRef);
    },
    [clearProgrammaticScrollTracking],
  );

  const virtualItems = rowVirtualizer.getVirtualItems();
  const activeStickyRowIndex = findActiveStickyRowIndex(
    stickyRowIndices,
    rowVirtualizer.range?.startIndex ?? virtualItems[0]?.index ?? 0,
  );
  const activeStickyRow = activeStickyRowIndex === null ? null : rows[activeStickyRowIndex]!;
  const stickyOverlayActive =
    activeStickyRowIndex !== null &&
    activeStickyRow !== null &&
    shouldRenderStickyOverlay?.(activeStickyRow, activeStickyRowIndex) === true;
  const virtualContentStyle = {
    height: rowVirtualizer.getTotalSize(),
    position: "relative",
  } satisfies CSSProperties;

  return (
    <div
      className={cn(
        "relative flex h-full min-h-0 flex-1 flex-col gap-0 overflow-hidden",
        className,
      )}
      data-slot="conversation-scroller"
    >
      <div
        ref={scrollElementRef}
        aria-label={ariaLabel}
        className={cn(
          "h-full min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain [overflow-anchor:none]",
          viewportClassName,
        )}
        data-slot="conversation-scroller-viewport"
        {...viewportDataAttributes}
        onPointerCancel={() => {
          isUserPointerDownRef.current = false;
        }}
        onPointerDown={() => {
          isUserPointerDownRef.current = true;
          recordUserScrollInput();
        }}
        onPointerUp={() => {
          isUserPointerDownRef.current = false;
        }}
        onScroll={handleScroll}
        onTouchStart={recordUserScrollInput}
        onWheel={recordUserScrollInput}
        role="region"
        style={{ scrollbarGutter: "stable both-edges" }}
        tabIndex={0}
      >
        <div
          className={cn("box-border w-full", contentClassName)}
          data-slot="conversation-scroller-content"
          role="log"
          style={virtualContentStyle}
        >
          {virtualItems.map((virtualRow) => {
            const row = rows[virtualRow.index]!;

            const isSticky = isAnchorRow?.(row, virtualRow.index) === true;
            const isActiveSticky = virtualRow.index === activeStickyRowIndex;
            const isStickyOverlayActive = isActiveSticky && stickyOverlayActive;
            const renderInput: ConversationRowRenderInput<TRow> = {
              row,
              index: virtualRow.index,
              isActiveSticky,
            };

            return (
              <div
                key={virtualRow.key}
                ref={isStickyOverlayActive ? undefined : rowVirtualizer.measureElement}
                aria-hidden={isStickyOverlayActive ? "true" : undefined}
                className={cn(
                  "w-full [contain:layout]",
                  isStickyOverlayActive ? "box-border" : "flow-root",
                  rowClassName,
                )}
                data-index={virtualRow.index}
                data-slot="conversation-scroller-row"
                style={virtualRowStyle({
                  virtualRow,
                  isSticky: isActiveSticky,
                  isStickyOverlayActive,
                })}
              >
                {isStickyOverlayActive ? null : renderRow(renderInput)}
              </div>
            );
          })}
        </div>
      </div>
      {stickyOverlayActive &&
      activeStickyRow !== null &&
      activeStickyRowIndex !== null &&
      renderStickyOverlay ? (
        <div
          className={cn("pointer-events-none absolute inset-x-0", stickyOverlayClassName)}
          data-slot="conversation-scroller-sticky-overlay"
          style={{ top: stickyTop }}
        >
          {renderStickyOverlay({
            row: activeStickyRow,
            index: activeStickyRowIndex,
            isActiveSticky: true,
          })}
        </div>
      ) : null}
      {showScrollToEndButton && renderScrollToEndButton ? (
        <>{renderScrollToEndButton({ scrollToEnd })}</>
      ) : null}
    </div>
  );
}

function clearScrollToEndButtonTimeout(timeoutRef: { current: number | null }) {
  if (timeoutRef.current === null) {
    return;
  }
  window.clearTimeout(timeoutRef.current);
  timeoutRef.current = null;
}

function shouldRestoreSnapshot(
  snapshot: ConversationScrollerSnapshot,
  currentFirstRowId: string | undefined,
): boolean {
  return (
    !snapshot.isAtEnd &&
    snapshot.scrollOffset > 0 &&
    Number.isFinite(snapshot.scrollOffset) &&
    snapshot.firstRowId === currentFirstRowId
  );
}

function computeLastAnchorMinHeightPx(input: {
  viewportHeight: number;
  viewportRatio?: number | undefined;
  floorPx?: number | undefined;
  scrollInsetPx?: number | undefined;
}): number {
  if (input.viewportHeight === 0) {
    return 0;
  }

  const viewportRatio = input.viewportRatio ?? LAST_ANCHOR_MIN_HEIGHT_RATIO;
  const floorPx = input.floorPx ?? LAST_ANCHOR_MIN_HEIGHT_FLOOR_PX;
  const scrollInsetPx = input.scrollInsetPx ?? SCROLL_INSET_PX;
  const contentHeight = input.viewportHeight - scrollInsetPx;
  return Math.max(contentHeight * viewportRatio, floorPx);
}

function computeLastAnchorContentHeightPx(input: {
  rowIds: readonly string[];
  measuredHeights: ReadonlyMap<string, number>;
  lastAnchorIndex: number | undefined;
  estimateRowHeight?: ((index: number) => number) | undefined;
}): number {
  const { rowIds, measuredHeights, lastAnchorIndex, estimateRowHeight } = input;
  if (lastAnchorIndex === undefined || lastAnchorIndex < 0) {
    return 0;
  }

  let totalHeight = 0;
  let measuredRowCount = 0;
  for (let index = lastAnchorIndex; index < rowIds.length; index += 1) {
    const rowId = rowIds[index]!;
    totalHeight += measuredHeights.get(rowId) ?? estimateRowHeight?.(index) ?? 0;
    measuredRowCount += 1;
  }

  return totalHeight + Math.max(0, measuredRowCount - 1) * CONVERSATION_ROW_GAP_PX;
}

function computeDynamicPaddingEndPx(input: {
  basePadding: number;
  lastAnchorHeight: number;
  minHeight: number;
}): number {
  const { basePadding, lastAnchorHeight, minHeight } = input;
  if (lastAnchorHeight >= minHeight) {
    return Math.max(basePadding, 0);
  }

  return Math.max(minHeight - lastAnchorHeight, basePadding, 0);
}

function computePinnedState(
  prev: ScrollFollowState,
  event: {
    totalHeight: number;
    clampedOffset: number;
    viewportHeight: number;
    nearEndThresholdPx: number;
    isScrolling: boolean;
    lastObservedScrollOffset: number;
    isUserPointerDown: boolean;
    msSinceUserScrollInput: number;
    userInputWindowMs: number;
    isReady: boolean;
    isProgrammaticScrollActive: boolean;
    pinSnapThresholdPx: number;
  },
): ScrollFollowState {
  const distanceFromEnd = event.totalHeight - event.clampedOffset - event.viewportHeight;
  const atEnd = distanceFromEnd <= event.nearEndThresholdPx;
  const scrolledUp = event.isScrolling && event.clampedOffset < event.lastObservedScrollOffset;
  const hasRecentUserInput =
    event.isUserPointerDown || event.msSinceUserScrollInput <= event.userInputWindowMs;

  if (
    prev.pinned &&
    event.isReady &&
    scrolledUp &&
    !atEnd &&
    !event.isProgrammaticScrollActive &&
    hasRecentUserInput &&
    event.lastObservedScrollOffset - event.clampedOffset > event.pinSnapThresholdPx
  ) {
    return { pinned: false, atEnd };
  }

  if (!prev.pinned && atEnd && !event.isScrolling) {
    return { pinned: true, atEnd };
  }

  return { pinned: prev.pinned, atEnd };
}

function shouldAdjustScrollOnItemResize(input: {
  isStreaming: boolean;
  pinnedFollowing: boolean;
  delta: number;
  itemEnd: number;
  scrollOffset: number;
}): boolean {
  return (
    input.isStreaming &&
    !input.pinnedFollowing &&
    input.delta !== 0 &&
    input.itemEnd <= input.scrollOffset
  );
}

function filterReusableMeasurements<TRow>(input: {
  snapshot: ConversationScrollerSnapshot | null;
  rows: readonly TRow[];
  getRowId: (row: TRow, index: number) => string;
  canReuseMeasurement: ((row: TRow) => boolean) | undefined;
}): VirtualItem[] {
  const { snapshot, rows, getRowId, canReuseMeasurement } = input;
  if (!snapshot || snapshot.measuredItems.length === 0 || rows.length === 0) {
    return [];
  }

  const rowIds = rows.map((row, index) => getRowId(row, index));
  const rowsById = new Map<string, TRow>();
  for (let index = 0; index < rows.length; index += 1) {
    rowsById.set(rowIds[index]!, rows[index]!);
  }
  return snapshot.measuredItems.filter((item) => {
    if (typeof item.key !== "string") {
      return false;
    }
    const row = rowsById.get(item.key);
    return row !== undefined && (canReuseMeasurement?.(row) ?? true);
  });
}

function findLastAnchorRowIndex<TRow>(
  rows: readonly TRow[],
  isAnchorRow: ((row: TRow, index: number) => boolean) | undefined,
): number | null {
  if (!isAnchorRow) {
    return null;
  }

  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]!;
    if (isAnchorRow(row, index)) {
      return index;
    }
  }

  return null;
}

function estimateInitialBottomOffset(input: {
  rowCount: number;
  paddingEnd: number;
  estimateRowSize: (index: number) => number;
  initialOffsetSampleRowCount: number;
}): number {
  if (input.rowCount === 0) {
    return 0;
  }

  const sampleStartIndex = Math.max(0, input.rowCount - input.initialOffsetSampleRowCount);
  let sampledSize = 0;
  let sampledCount = 0;
  for (let index = sampleStartIndex; index < input.rowCount; index += 1) {
    sampledSize += input.estimateRowSize(index);
    sampledCount += 1;
  }

  const averageRowSize =
    sampledCount > 0 ? sampledSize / sampledCount : DEFAULT_VIRTUALIZER_RECT.height / 6;
  const totalSize = averageRowSize * input.rowCount + input.paddingEnd;
  return Math.max(0, totalSize - DEFAULT_VIRTUALIZER_RECT.height);
}

function rememberConversationScrollerSnapshot<TRow>(input: {
  cacheKey: string;
  virtualizer: Virtualizer<HTMLDivElement, HTMLDivElement>;
  scrollElement: HTMLDivElement | null;
  rows: readonly TRow[];
  rowIds: readonly string[];
  isAtEnd: boolean;
  maxCachedSnapshots: number;
}): void {
  if (input.rows.length === 0) {
    return;
  }

  const scrollOffset = Math.max(
    0,
    input.scrollElement?.scrollTop ?? input.virtualizer.scrollOffset ?? 0,
  );
  const measuredItems = input.virtualizer.takeSnapshot();
  if (measuredItems.length === 0 && scrollOffset === 0 && input.isAtEnd) {
    return;
  }

  conversationScrollerSnapshots.delete(input.cacheKey);
  conversationScrollerSnapshots.set(input.cacheKey, {
    measuredItems,
    scrollOffset,
    isAtEnd: input.isAtEnd,
    firstRowId: input.rowIds[0],
  });

  while (conversationScrollerSnapshots.size > input.maxCachedSnapshots) {
    const oldestCacheKey = conversationScrollerSnapshots.keys().next().value;
    if (oldestCacheKey === undefined) {
      return;
    }
    conversationScrollerSnapshots.delete(oldestCacheKey);
  }
}

function findActiveStickyRowIndex(indices: readonly number[], visibleStartIndex: number) {
  let activeIndex: number | null = null;
  for (const index of indices) {
    if (index > visibleStartIndex) {
      break;
    }
    activeIndex = index;
  }
  return activeIndex;
}

function virtualRowStyle(input: {
  virtualRow: VirtualItem;
  isSticky: boolean;
  isStickyOverlayActive: boolean;
}): CSSProperties {
  if (input.isSticky) {
    // Pin flush to the scroll viewport top (top: 0). The visual top inset is the
    // scroller's own container padding (`className`), which shifts the viewport down.
    // A nonzero sticky top would shift the pinned row down at the scroll origin and,
    // because sibling rows are absolutely positioned, overlap the next row and eat
    // its gap. The floating overlay handles its own `stickyTop` offset separately
    // since it lives outside the padded viewport.
    return {
      position: "sticky",
      top: 0,
      zIndex: STICKY_ROW_Z_INDEX,
      ...(input.isStickyOverlayActive ? { height: input.virtualRow.size } : null),
    };
  }

  return {
    position: "absolute",
    top: 0,
    left: 0,
    transform: `translateY(${input.virtualRow.start}px)`,
  };
}
