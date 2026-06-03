"use client";

import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useRef,
  useState,
} from "react";

import { useMountEffect } from "~/hooks/use-mount-effect";

interface ColumnResizeLimits {
  min: number;
  max: number;
}

interface ColumnResizeState {
  base: number;
  pointerId: number;
  sash: HTMLDivElement;
  startX: number;
}

function clampColumnWidth(width: number, limits: ColumnResizeLimits): number {
  return Math.min(limits.max, Math.max(limits.min, width));
}

export function useColumnResize<TElement extends HTMLElement>(input: {
  width: number;
  limits: ColumnResizeLimits;
  elementRef: RefObject<TElement | null>;
  direction: "left" | "right";
  onCommit: (width: number) => void;
}) {
  const { width, limits, elementRef, direction, onCommit } = input;
  const [dragging, setDragging] = useState(false);
  const stateRef = useRef<ColumnResizeState | null>(null);
  const liveWidthRef = useRef(width);
  const onCommitRef = useRef(onCommit);
  const pendingWidthRef = useRef<number | null>(null);
  const applyWidthFrameRef = useRef<number | null>(null);

  onCommitRef.current = onCommit;

  if (!dragging) {
    liveWidthRef.current = width;
  }

  const applyWidth = (nextWidth: number) => {
    if (elementRef.current) {
      elementRef.current.style.width = `${nextWidth}px`;
    }
  };

  const flushPendingWidth = () => {
    applyWidthFrameRef.current = null;
    const nextWidth = pendingWidthRef.current;
    pendingWidthRef.current = null;
    if (nextWidth !== null) {
      applyWidth(nextWidth);
    }
  };

  const scheduleWidthApply = (nextWidth: number) => {
    pendingWidthRef.current = nextWidth;
    if (applyWidthFrameRef.current !== null) {
      return;
    }
    applyWidthFrameRef.current = window.requestAnimationFrame(flushPendingWidth);
  };

  useMountEffect(() => {
    return () => {
      if (applyWidthFrameRef.current !== null) {
        window.cancelAnimationFrame(applyWidthFrameRef.current);
        applyWidthFrameRef.current = null;
      }
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    };
  });

  const stopResize = (pointerId: number) => {
    const drag = stateRef.current;
    if (!drag || drag.pointerId !== pointerId) {
      return;
    }

    const nextWidth = liveWidthRef.current;
    if (applyWidthFrameRef.current !== null) {
      window.cancelAnimationFrame(applyWidthFrameRef.current);
      applyWidthFrameRef.current = null;
    }
    pendingWidthRef.current = null;
    applyWidth(nextWidth);
    if (drag.sash.hasPointerCapture(pointerId)) {
      drag.sash.releasePointerCapture(pointerId);
    }

    stateRef.current = null;
    setDragging(false);
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
    onCommitRef.current(nextWidth);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    if (stateRef.current) {
      return;
    }

    const node = elementRef.current;
    if (!node) {
      return;
    }

    const width = liveWidthRef.current;
    node.style.width = `${width}px`;
    stateRef.current = {
      base: width,
      pointerId: event.pointerId,
      sash: event.currentTarget,
      startX: event.clientX,
    };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    event.preventDefault();
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = stateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const delta =
      direction === "right" ? event.clientX - drag.startX : drag.startX - event.clientX;
    const nextWidth = clampColumnWidth(drag.base + delta, limits);
    liveWidthRef.current = nextWidth;
    scheduleWidthApply(nextWidth);

    event.preventDefault();
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    stopResize(event.pointerId);
    event.preventDefault();
  };

  return {
    dragging,
    sashProps: {
      onPointerCancel: onPointerUp,
      onPointerDown,
      onPointerMove,
      onPointerUp,
    },
  };
}
