import * as stylex from "@stylexjs/stylex";
import {
  elementScroll,
  useVirtualizer,
  type VirtualItem,
  type Virtualizer,
} from "@tanstack/react-virtual";
import * as React from "react";

const DEFAULT_OVERSCAN = 8;
const DEFAULT_FOOTER_ESTIMATE_PX = 48;
const MAX_RETAINED_CONVERSATIONS = 50;

type RetainedConversation = {
  readonly offset: number;
  readonly measurements: Array<VirtualItem>;
  readonly shouldFollow: boolean;
};

const retainedConversations = new Map<string, RetainedConversation>();

type ElementScrollOptions = Parameters<typeof elementScroll>[1];

function scrollWithDeferredAdjustments(
  offset: number,
  options: ElementScrollOptions,
  instance: Virtualizer<HTMLDivElement, HTMLDivElement>,
): void {
  if (options.adjustments === undefined) {
    elementScroll(offset, options, instance);
    return;
  }
  // Adjustment writes must land after the sizer grows, or the browser clamps them.
  queueMicrotask(() => {
    elementScroll(offset, options, instance);
  });
}

const styles = stylex.create({
  plane: {
    position: "relative",
    minWidth: 0,
    width: "100%",
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
});
const dynamic = stylex.create({
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
  readonly estimateRowSize: (row: Row) => number;
  readonly renderRow: (row: Row, index: number) => React.ReactNode;
  readonly onRowElement?: (row: Row, index: number, element: HTMLDivElement | null) => void;
  readonly footer?: React.ReactNode;
  readonly footerEstimatePx?: number;
  readonly rowGapPx: number;
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
  estimateRowSize,
  renderRow,
  onRowElement,
  footer,
  footerEstimatePx = DEFAULT_FOOTER_ESTIMATE_PX,
  rowGapPx,
  bottomClearancePx,
  initialViewportHeightPx,
  nearEndThresholdPx,
  isStreaming,
  restorationKey,
}: VirtualConversationProps<Row>): React.ReactElement {
  const rowCount = rows.length;
  const hasFooter = footer != null;
  const [restoredConversation] = React.useState(() =>
    restorationKey === undefined ? null : (retainedConversations.get(restorationKey) ?? null),
  );
  const shouldFollowRef = React.useRef(restoredConversation?.shouldFollow ?? true);

  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rowCount + (hasFooter ? 1 : 0),
    getScrollElement: () => scrollElementRef.current,
    getItemKey: (index) => {
      const row = rows[index];
      return row === undefined ? "virtual-footer" : getRowId(row);
    },
    estimateSize: (index) => {
      const row = rows[index];
      return (row === undefined ? footerEstimatePx : estimateRowSize(row)) + rowGapPx;
    },
    overscan: DEFAULT_OVERSCAN,
    paddingEnd: bottomClearancePx,
    initialRect: { width: 0, height: initialViewportHeightPx },
    initialOffset: restoredConversation?.offset ?? 0,
    initialMeasurementsCache: restoredConversation?.measurements ?? [],
    anchorTo: "end",
    followOnAppend: true,
    scrollEndThreshold: nearEndThresholdPx,
    useAnimationFrameWithResizeObserver: true,
    directDomUpdates: true,
    scrollToFn: scrollWithDeferredAdjustments,
  });

  React.useLayoutEffect(() => {
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, delta, instance) => {
      if (delta === 0) return false;
      if (isStreaming) return shouldFollowRef.current;
      const scrollOffset = instance.scrollOffset ?? 0;
      return item.start < scrollOffset && instance.scrollDirection !== "backward";
    };
  }, [isStreaming, virtualizer]);

  React.useLayoutEffect(() => {
    const scrollElement = scrollElementRef.current;
    if (scrollElement === null) return;
    const updateFollowState = (): void => {
      shouldFollowRef.current = virtualizer.isAtEnd(nearEndThresholdPx);
    };
    updateFollowState();
    scrollElement.addEventListener("scroll", updateFollowState, { passive: true });
    return () => {
      scrollElement.removeEventListener("scroll", updateFollowState);
    };
  }, [nearEndThresholdPx, scrollElementRef, virtualizer]);

  React.useLayoutEffect(() => {
    if (!shouldFollowRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      if (shouldFollowRef.current) {
        virtualizer.scrollToEnd({ behavior: "auto" });
      }
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [bottomClearancePx, isStreaming, rowCount, virtualizer]);

  React.useLayoutEffect(() => {
    if (restorationKey === undefined) return;
    const scrollElement = scrollElementRef.current;
    return () => {
      retainConversation(restorationKey, {
        offset: virtualizer.scrollOffset ?? scrollElement?.scrollTop ?? 0,
        measurements: virtualizer.takeSnapshot(),
        shouldFollow: shouldFollowRef.current,
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

  return (
    <div
      ref={virtualizer.containerRef}
      data-virtual-conversation=""
      {...stylex.props(styles.plane)}
    >
      {virtualizer.getVirtualItems().map((virtualRow) => {
        const row = rows[virtualRow.index];
        return (
          <div
            key={virtualRow.key}
            ref={(element) => {
              if (element !== null) {
                virtualizer.measureElement(element);
              }
              if (row !== undefined) {
                onRowElement?.(row, virtualRow.index, element);
              }
            }}
            data-index={virtualRow.index}
            data-virtual-conversation-row=""
            {...stylex.props(styles.row, dynamic.rowGap(rowGapPx))}
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
