"use client";

import { useThrottledCallback } from "@tanstack/react-pacer";
import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

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

  onCommitRef.current = onCommit;

  if (!dragging) {
    liveWidthRef.current = width;
  }

  useEffect(() => {
    return () => {
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    };
  }, []);

  const applyWidth = useThrottledCallback(
    (nextWidth: number) => {
      if (elementRef.current) {
        elementRef.current.style.width = `${nextWidth}px`;
      }
    },
    { wait: 16, leading: true, trailing: true },
  );

  const stopResize = useCallback((pointerId: number) => {
    const drag = stateRef.current;
    if (!drag || drag.pointerId !== pointerId) {
      return;
    }

    const nextWidth = liveWidthRef.current;
    if (drag.sash.hasPointerCapture(pointerId)) {
      drag.sash.releasePointerCapture(pointerId);
    }

    stateRef.current = null;
    setDragging(false);
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
    onCommitRef.current(nextWidth);
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
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
    },
    [elementRef],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = stateRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }

      const delta =
        direction === "right" ? event.clientX - drag.startX : drag.startX - event.clientX;
      const nextWidth = clampColumnWidth(drag.base + delta, limits);
      liveWidthRef.current = nextWidth;
      applyWidth(nextWidth);

      event.preventDefault();
    },
    [direction, limits, applyWidth],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      stopResize(event.pointerId);
      event.preventDefault();
    },
    [stopResize],
  );

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
