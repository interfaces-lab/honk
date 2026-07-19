import * as stylex from "@stylexjs/stylex";
import { zVars } from "@honk/ui/tokens.stylex";
import {
  defaultRangeExtractor,
  elementScroll,
  useVirtualizer,
  type VirtualItem,
  type Virtualizer,
} from "@tanstack/react-virtual";
import * as React from "react";

const DEFAULT_OVERSCAN = 8;
const DEFAULT_FOOTER_ESTIMATE_PX = 48;
const MAX_RETAINED_CONVERSATIONS = 50;
const FOOTER_KEY = "virtual-footer";
// Synthetic terminal row that reserves scroll room so the latest user message
// can always align to the top of the scrollport. It has no DOM element; its
// size lives only in the virtualizer's measurement cache.
const SPACER_KEY = "last-pair-spacer";
// Ignore sub-pixel drift between the follow target and the actual offset so
// spacer rounding does not cause 1px scroll nudges every measurement.
const FOLLOW_DEADBAND_PX = 2;

type RetainedConversation = {
  readonly offset: number;
  readonly measurements: Array<VirtualItem>;
  readonly shouldFollow: boolean;
  readonly lastStickyKey: string | null;
};

const retainedConversations = new Map<string, RetainedConversation>();

type ElementScrollOptions = Parameters<typeof elementScroll>[1];

// Latest-write-wins guard for deferred adjustment scrolls: a queued adjusted
// write must not overwrite a newer scroll command (adjusted or not) that was
// issued after it. Core computes adjusted targets as absolute offsets from
// accumulated deltas, so dropping superseded writes is lossless.
const scrollGenerations = new WeakMap<Virtualizer<HTMLDivElement, HTMLDivElement>, number>();

function scrollWithDeferredAdjustments(
  offset: number,
  options: ElementScrollOptions,
  instance: Virtualizer<HTMLDivElement, HTMLDivElement>,
): void {
  const generation = (scrollGenerations.get(instance) ?? 0) + 1;
  scrollGenerations.set(instance, generation);
  if (options.adjustments === undefined) {
    elementScroll(offset, options, instance);
    return;
  }
  // Adjustment writes must land after the sizer grows, or the browser clamps them.
  queueMicrotask(() => {
    if (scrollGenerations.get(instance) !== generation) return;
    elementScroll(offset, options, instance);
  });
}

const styles = stylex.create({
  plane: {
    position: "relative",
    minWidth: 0,
    width: "100%",
    overflowAnchor: "none",
  },
  row: {
    position: "absolute",
    insetBlockStart: 0,
    insetInlineStart: 0,
    width: "100%",
    minWidth: 0,
    boxSizing: "border-box",
    contain: "layout",
  },
  // A sticky row's wrapper spans from the row's start to the next sticky
  // row's start, positioned with top (not transform) so CSS sticky resolves
  // against the scrollport. The next sticky region's start is this region's
  // end, which is what pushes the pinned message off the top.
  stickyRegion: {
    position: "absolute",
    insetInlineStart: 0,
    width: "100%",
    minWidth: 0,
    pointerEvents: "none",
  },
  stickyContent: {
    position: "sticky",
    insetBlockStart: 0,
    zIndex: zVars["--honk-z-thread-sticky-message"],
    width: "100%",
    minWidth: 0,
    boxSizing: "border-box",
    pointerEvents: "auto",
  },
});
const dynamic = stylex.create({
  planeHeight: (px: number) => ({ height: `${String(px)}px` }),
  rowStart: (px: number) => ({ transform: `translate3d(0, ${String(px)}px, 0)` }),
  regionFrame: (topPx: number, heightPx: number) => ({
    insetBlockStart: `${String(topPx)}px`,
    height: `${String(heightPx)}px`,
  }),
  rowGap: (px: number) => ({ paddingBlockEnd: `${String(px)}px` }),
});

export type VirtualConversationController = {
  readonly scrollToIndex: (
    index: number,
    options?: { readonly behavior?: ScrollBehavior; readonly align?: "start" | "center" | "end" },
  ) => void;
};

export type VirtualConversationProps<Row> = {
  readonly rows: readonly Row[];
  readonly scrollElementRef: React.RefObject<HTMLDivElement | null>;
  readonly controllerRef?: React.RefObject<VirtualConversationController | null>;
  readonly getRowId: (row: Row) => string;
  readonly isStickyRow: (row: Row) => boolean;
  readonly estimateRowSize: (row: Row) => number;
  readonly getRowGapPx: (row: Row, index: number) => number;
  readonly renderRow: (row: Row, index: number) => React.ReactNode;
  readonly onRowElement?: (row: Row, index: number, element: HTMLDivElement | null) => void;
  readonly footer?: React.ReactNode;
  readonly footerEstimatePx?: number;
  readonly bottomClearancePx: number;
  readonly initialViewportHeightPx: number;
  readonly nearEndThresholdPx: number;
  readonly isStreaming: boolean;
  readonly restorationKey?: string;
};

export function VirtualConversation<Row>({
  rows,
  scrollElementRef,
  controllerRef,
  getRowId,
  isStickyRow,
  estimateRowSize,
  getRowGapPx,
  renderRow,
  onRowElement,
  footer,
  footerEstimatePx = DEFAULT_FOOTER_ESTIMATE_PX,
  bottomClearancePx,
  initialViewportHeightPx,
  nearEndThresholdPx,
  isStreaming,
  restorationKey,
}: VirtualConversationProps<Row>): React.ReactElement {
  const rowCount = rows.length;
  const hasFooter = footer != null;
  const footerIndex = hasFooter ? rowCount : null;
  const spacerIndex = rowCount + (hasFooter ? 1 : 0);
  const stickyIndexes = rows.flatMap((row, index) => (isStickyRow(row) ? [index] : []));
  const lastStickyIndex = stickyIndexes[stickyIndexes.length - 1] ?? null;
  const lastStickyRow = lastStickyIndex === null ? undefined : rows[lastStickyIndex];
  const lastStickyKey = lastStickyRow === undefined ? null : getRowId(lastStickyRow);
  const [restoredConversation] = React.useState(() =>
    restorationKey === undefined ? null : (retainedConversations.get(restorationKey) ?? null),
  );
  const shouldFollowRef = React.useRef(restoredConversation?.shouldFollow ?? true);

  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: spacerIndex + 1,
    getScrollElement: () => scrollElementRef.current,
    getItemKey: (index) => {
      const row = rows[index];
      if (row !== undefined) return getRowId(row);
      return index === footerIndex ? FOOTER_KEY : SPACER_KEY;
    },
    estimateSize: (index) => {
      const row = rows[index];
      if (row !== undefined) return estimateRowSize(row) + getRowGapPx(row, index);
      return index === footerIndex ? footerEstimatePx : bottomClearancePx;
    },
    overscan: DEFAULT_OVERSCAN,
    // The sticky row owning the top of the viewport must stay mounted while
    // its turn scrolls underneath, so CSS sticky keeps the message pinned.
    rangeExtractor: (range) => {
      const base = defaultRangeExtractor(range);
      const owner = stickyIndexes.findLast((index) => index <= range.startIndex);
      const first = base[0];
      if (owner === undefined || first === undefined || owner >= first) return base;
      return [owner, ...base];
    },
    initialRect: { width: 0, height: initialViewportHeightPx },
    initialOffset: restoredConversation?.offset ?? 0,
    initialMeasurementsCache: restoredConversation?.measurements ?? [],
    scrollEndThreshold: nearEndThresholdPx,
    useAnimationFrameWithResizeObserver: true,
    scrollToFn: scrollWithDeferredAdjustments,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  const stickyIndexesRef = React.useRef(stickyIndexes);
  stickyIndexesRef.current = stickyIndexes;

  React.useLayoutEffect(() => {
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, delta, instance) => {
      if (delta === 0 || item.key === SPACER_KEY) return false;
      // Growth above the viewport keeps it visually stable; growth below it
      // never moves it — pinned reading stays still, and following is done
      // explicitly via scrollToEnd rather than per-resize adjustments.
      const scrollOffset = instance.scrollOffset ?? 0;
      if (item.start >= scrollOffset) return false;
      // The currently pinned sticky owner is visually at the top even though
      // its start is above the scroll offset. Compensating its resize would
      // keep the following rows visually still while the header grows,
      // overlapping them (or leaving a gap when it shrinks). Let its delta
      // flow to the rows below instead.
      const stickyOwner = stickyIndexesRef.current.findLast(
        (index) =>
          (instance.measurementsCache[index]?.start ?? Number.POSITIVE_INFINITY) <= scrollOffset,
      );
      if (item.index === stickyOwner) return false;
      // First measurements (estimate → actual) must always be compensated,
      // even while scrolling backward, or unmeasured history jumps as it
      // mounts. Re-measurements skip backward scroll like the core default.
      return !instance.itemSizeCache.has(item.key) || instance.scrollDirection !== "backward";
    };
  }, [virtualizer]);

  // Size the terminal spacer so the latest sticky row plus everything after
  // it spans at least the scrollport. At the max scroll offset the latest
  // user message then sits exactly at the top, and streamed content fills
  // the reserve without moving the viewport (the spacer shrinks in place).
  React.useLayoutEffect(() => {
    const spacer = virtualizer.measurementsCache[spacerIndex];
    if (spacer === undefined) return;
    const lastSticky =
      lastStickyIndex === null ? undefined : virtualizer.measurementsCache[lastStickyIndex];
    const contentEnd = virtualizer.measurementsCache[spacerIndex - 1]?.end ?? 0;
    const viewportPx = scrollElementRef.current?.clientHeight ?? initialViewportHeightPx;
    const reservePx =
      lastSticky === undefined ? 0 : Math.round(viewportPx - (contentEnd - lastSticky.start));
    const targetPx = Math.max(bottomClearancePx, reservePx);
    if (Math.abs(spacer.size - targetPx) >= 1) {
      virtualizer.resizeItem(spacerIndex, targetPx);
    }
  });

  React.useLayoutEffect(() => {
    const scrollElement = scrollElementRef.current;
    if (scrollElement === null) return;
    const handleScroll = (): void => {
      if (virtualizer.scrollDirection === "backward") {
        shouldFollowRef.current = false;
        return;
      }
      if (virtualizer.isAtEnd(nearEndThresholdPx)) shouldFollowRef.current = true;
    };
    const handleWheel = (event: WheelEvent): void => {
      if (event.deltaY < 0) shouldFollowRef.current = false;
    };
    scrollElement.addEventListener("scroll", handleScroll, { passive: true });
    scrollElement.addEventListener("wheel", handleWheel, { passive: true });
    return () => {
      scrollElement.removeEventListener("scroll", handleScroll);
      scrollElement.removeEventListener("wheel", handleWheel);
    };
  }, [nearEndThresholdPx, scrollElementRef, virtualizer]);

  // A newly appended user message always re-enters follow mode so it pins to
  // the top of the scrollport, even if the user was reading history. Seeding
  // the ref from the retained key (not the current one) lets a message that
  // arrived while this conversation was unmounted register as an append below.
  const lastStickyKeyRef = React.useRef(
    restoredConversation === null ? lastStickyKey : restoredConversation.lastStickyKey,
  );
  React.useLayoutEffect(() => {
    if (lastStickyKeyRef.current === lastStickyKey) return;
    lastStickyKeyRef.current = lastStickyKey;
    if (lastStickyKey !== null) shouldFollowRef.current = true;
  }, [lastStickyKey]);

  React.useLayoutEffect(() => {
    if (!shouldFollowRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      if (!shouldFollowRef.current) return;
      if (virtualizer.getDistanceFromEnd() <= FOLLOW_DEADBAND_PX) return;
      virtualizer.scrollToEnd({ behavior: "auto" });
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [bottomClearancePx, isStreaming, lastStickyKey, rowCount, totalSize, virtualizer]);

  React.useLayoutEffect(() => {
    if (restorationKey === undefined) return;
    const scrollElement = scrollElementRef.current;
    return () => {
      retainConversation(restorationKey, {
        offset: virtualizer.scrollOffset ?? scrollElement?.scrollTop ?? 0,
        measurements: virtualizer.takeSnapshot(),
        shouldFollow: shouldFollowRef.current,
        lastStickyKey: lastStickyKeyRef.current,
      });
    };
  }, [restorationKey, scrollElementRef, virtualizer]);

  React.useLayoutEffect(() => {
    if (controllerRef === undefined) return;
    const controller: VirtualConversationController = {
      scrollToIndex: (index, options) => {
        virtualizer.scrollToIndex(index, {
          align: options?.align ?? "start",
          behavior: options?.behavior ?? "auto",
        });
      },
    };
    controllerRef.current = controller;
    return () => {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    };
  }, [controllerRef, virtualizer]);

  const nextStickyStart = (index: number): number => {
    const next = stickyIndexes.find((stickyIndex) => stickyIndex > index);
    if (next === undefined) return totalSize;
    return virtualizer.measurementsCache[next]?.start ?? totalSize;
  };

  return (
    <div
      ref={virtualizer.containerRef}
      data-virtual-conversation=""
      {...stylex.props(styles.plane, dynamic.planeHeight(totalSize))}
    >
      {virtualItems.map((virtualRow) => {
        if (virtualRow.key === SPACER_KEY) return null;
        const row = rows[virtualRow.index];
        if (row !== undefined && isStickyRow(row)) {
          return (
            <div
              key={virtualRow.key}
              ref={(element) => {
                onRowElement?.(row, virtualRow.index, element);
              }}
              data-virtual-conversation-region=""
              {...stylex.props(
                styles.stickyRegion,
                dynamic.regionFrame(
                  virtualRow.start,
                  Math.max(nextStickyStart(virtualRow.index) - virtualRow.start, 0),
                ),
              )}
            >
              <div
                ref={virtualizer.measureElement}
                data-index={virtualRow.index}
                data-virtual-conversation-row=""
                {...stylex.props(
                  styles.stickyContent,
                  dynamic.rowGap(getRowGapPx(row, virtualRow.index)),
                )}
              >
                {renderRow(row, virtualRow.index)}
              </div>
            </div>
          );
        }
        return (
          <div
            key={virtualRow.key}
            ref={(element) => {
              virtualizer.measureElement(element);
              if (row !== undefined) onRowElement?.(row, virtualRow.index, element);
            }}
            data-index={virtualRow.index}
            data-virtual-conversation-row=""
            {...stylex.props(
              styles.row,
              dynamic.rowStart(virtualRow.start),
              dynamic.rowGap(row === undefined ? 0 : getRowGapPx(row, virtualRow.index)),
            )}
          >
            {row === undefined ? footer : renderRow(row, virtualRow.index)}
          </div>
        );
      })}
    </div>
  );
}

function retainConversation(key: string, state: RetainedConversation): void {
  retainedConversations.delete(key);
  retainedConversations.set(key, state);
  if (retainedConversations.size <= MAX_RETAINED_CONVERSATIONS) return;
  const oldest = retainedConversations.keys().next().value;
  if (oldest !== undefined) retainedConversations.delete(oldest);
}
