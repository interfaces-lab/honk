import * as React from "react";

import {
  WORKBENCH_WIDTH_MAX,
  WORKBENCH_WIDTH_MIN,
  workbenchActions,
} from "./workbench-controller";

const RAIL_LAYOUT_THRESHOLD = 880;
const WORKBENCH_RESIZE_STEP = 16;
const WORKBENCH_TRANSCRIPT_REMAINDER = 160;

type WorkbenchDrag = {
  readonly pointerId: number;
  readonly startX: number;
  readonly startWidth: number;
  currentWidth: number;
};

type WorkbenchSizing = {
  readonly attachColumn: React.RefCallback<HTMLElement>;
  readonly availablePanelWidth: number;
  readonly handleSashKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  readonly handleSashPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  readonly handleSashPointerEnd: (event: React.PointerEvent<HTMLDivElement>) => void;
  readonly handleSashPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  readonly isResizing: boolean;
  readonly isResponsiveCompact: boolean;
  readonly panelWidth: number;
};

function useWorkbenchSizing(storedWidth: number): WorkbenchSizing {
  const [isResizing, setResizing] = React.useState(false);
  const [isResponsiveCompact, setResponsiveCompact] = React.useState(false);
  const [availablePanelWidth, setAvailablePanelWidth] = React.useState(WORKBENCH_WIDTH_MAX);
  const [liveWidth, setLiveWidth] = React.useState<number | null>(null);
  const dragRef = React.useRef<WorkbenchDrag | null>(null);
  const panelWidth = Math.min(liveWidth ?? storedWidth, availablePanelWidth);

  const attachColumn: React.RefCallback<HTMLElement> = (node) => {
    if (node === null) return;
    const layout = node.parentElement;
    if (layout === null) return;

    const measure = (): void => {
      const layoutWidth = layout.getBoundingClientRect().width;
      setResponsiveCompact(layoutWidth < RAIL_LAYOUT_THRESHOLD);
      setAvailablePanelWidth(
        Math.max(
          WORKBENCH_WIDTH_MIN,
          Math.min(WORKBENCH_WIDTH_MAX, layoutWidth - WORKBENCH_TRANSCRIPT_REMAINDER),
        ),
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(measure);
    // react-doctor-disable-next-line react-doctor/effect-needs-cleanup -- React 19 runs the returned callback-ref teardown, which disconnects this observer.
    observer.observe(layout);
    return () => {
      observer.disconnect();
    };
  };

  const handleSashPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: panelWidth,
      currentWidth: panelWidth,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setResizing(true);
  };

  const handleSashPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (drag === null || event.pointerId !== drag.pointerId) return;
    // The column is on the right, so dragging left grows it.
    const nextWidth = Math.min(
      availablePanelWidth,
      WORKBENCH_WIDTH_MAX,
      Math.max(WORKBENCH_WIDTH_MIN, drag.startWidth + (drag.startX - event.clientX)),
    );
    drag.currentWidth = nextWidth;
    setLiveWidth(nextWidth);
  };

  const handleSashPointerEnd = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    const nextWidth = dragRef.current.currentWidth;
    dragRef.current = null;
    setLiveWidth(null);
    workbenchActions.setWidth(nextWidth);
    setResizing(false);
  };

  const handleSashKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    let nextWidth: number | null = null;
    if (event.key === "ArrowLeft") nextWidth = panelWidth + WORKBENCH_RESIZE_STEP;
    if (event.key === "ArrowRight") nextWidth = panelWidth - WORKBENCH_RESIZE_STEP;
    if (event.key === "Home") nextWidth = WORKBENCH_WIDTH_MIN;
    if (event.key === "End") nextWidth = availablePanelWidth;
    if (nextWidth === null) return;
    event.preventDefault();
    workbenchActions.setWidth(
      Math.min(availablePanelWidth, Math.max(WORKBENCH_WIDTH_MIN, nextWidth)),
    );
  };

  return {
    attachColumn,
    availablePanelWidth,
    handleSashKeyDown,
    handleSashPointerDown,
    handleSashPointerEnd,
    handleSashPointerMove,
    isResizing,
    isResponsiveCompact,
    panelWidth,
  };
}

export { useWorkbenchSizing };
