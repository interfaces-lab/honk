import * as stylex from "@stylexjs/stylex";
import { useVirtualizer } from "@tanstack/react-virtual";
import * as React from "react";

const DEFAULT_OVERSCAN = 8;
const DEFAULT_FOOTER_ESTIMATE_PX = 48;

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
}: VirtualConversationProps<Row>): React.ReactElement {
  const rowCount = rows.length;
  const hasFooter = footer != null;
  const isStreamingRef = React.useRef(isStreaming);
  const shouldFollowRef = React.useRef(true);
  isStreamingRef.current = isStreaming;

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
    anchorTo: "end",
    followOnAppend: true,
    scrollEndThreshold: nearEndThresholdPx,
    useAnimationFrameWithResizeObserver: true,
  });
  const totalSize = virtualizer.getTotalSize();

  React.useLayoutEffect(() => {
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, delta, instance) => {
      if (delta === 0) return false;
      if (isStreamingRef.current) return shouldFollowRef.current;
      const scrollOffset = instance.scrollOffset ?? 0;
      return item.start < scrollOffset && instance.scrollDirection !== "backward";
    };
  }, [virtualizer]);

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
  }, [bottomClearancePx, isStreaming, rowCount, totalSize, virtualizer]);

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
      data-virtual-conversation=""
      {...stylex.props(styles.plane)}
      style={{ height: totalSize }}
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
            {...stylex.props(styles.row)}
            style={{
              transform: `translateY(${String(virtualRow.start)}px)`,
              paddingBlockEnd: rowGapPx,
            }}
          >
            {row === undefined ? footer : renderRow(row, virtualRow.index)}
          </div>
        );
      })}
    </div>
  );
}
