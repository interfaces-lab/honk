"use client";

import type { CSSProperties, HTMLAttributes, MouseEventHandler, RefObject } from "react";
import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

import { cn } from "~/lib/utils";

const CHAT_LOADER_MAX_GRID = 5;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

type ChatLoaderPhase = "idle" | "active";
type ChatLoaderPattern = "full" | "ring" | "checker" | "cross" | "slash" | "backslash";

interface ChatLoaderProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  animated?: boolean;
  cellPadding?: number;
  dotSize?: number;
  hoverAnimated?: boolean;
  label?: string;
  maxExtent?: number;
  pattern?: ChatLoaderPattern;
  speed?: number;
}

interface ChatLoaderGlyphProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  animated?: boolean;
  cellPadding?: number;
  dotSize?: number;
  maxExtent?: number;
  pattern?: ChatLoaderPattern;
  speed?: number;
}

interface ChatLoaderDotInput {
  col: number;
  gridSize: number;
  index: number;
  isActive: boolean;
  phase: ChatLoaderPhase;
  reducedMotion: boolean;
  row: number;
}

interface ChatLoaderDotOutput {
  className?: string;
  style?: CSSProperties;
}

type ChatLoaderDotResolver = (input: ChatLoaderDotInput) => ChatLoaderDotOutput;

type ChatLoaderStyle = CSSProperties & {
  "--chat-loader-cell-size"?: string;
  "--chat-loader-dot-size"?: string;
  "--chat-loader-duration"?: string;
};

type ChatLoaderDotStyle = CSSProperties & {
  "--chat-loader-path"?: number;
};

const chatLoaderDotResolver: ChatLoaderDotResolver = ({
  isActive,
  index,
  gridSize,
  reducedMotion,
  phase,
}) => {
  if (!isActive) {
    return { className: "chat-loader-dot-inactive" };
  }

  const path = trBlPathNormFromIndex(index, gridSize);
  const style: ChatLoaderDotStyle = {
    "--chat-loader-path": path,
  };

  if (reducedMotion || phase === "idle") {
    return {
      style: {
        ...style,
        opacity: 0.55,
      },
    };
  }

  return { className: "chat-loader-diagonal-sweep", style };
};

function subscribeReducedMotion(callback: () => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY);
  mediaQuery.addEventListener("change", callback);
  return () => {
    mediaQuery.removeEventListener("change", callback);
  };
}

function getReducedMotionSnapshot(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function getReducedMotionServerSnapshot(): boolean {
  return false;
}

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot,
  );
}

function trBlPathNormFromIndex(index: number, gridSize: number): number {
  const row = Math.floor(index / gridSize);
  const col = index % gridSize;
  const maxPath = Math.max(1, (gridSize - 1) * 2);

  return (row + (gridSize - 1 - col)) / maxPath;
}

function resolveGridSizeFromExtent(extentPx: number, cellSize: number): number {
  if (!Number.isFinite(extentPx) || extentPx <= 0) {
    return CHAT_LOADER_MAX_GRID;
  }

  return Math.min(CHAT_LOADER_MAX_GRID, Math.max(1, Math.floor(extentPx / cellSize)));
}

function useMatrixGridSize(options: {
  cellSize: number;
  fitToLineHeight: boolean;
  maxExtentPx: number | null;
  rootRef: RefObject<HTMLSpanElement | null>;
}): number {
  const { cellSize, fitToLineHeight, maxExtentPx, rootRef } = options;
  const [gridSize, setGridSize] = useState(() => {
    if (maxExtentPx != null) {
      return resolveGridSizeFromExtent(maxExtentPx, cellSize);
    }

    return CHAT_LOADER_MAX_GRID;
  });

  useLayoutEffect(() => {
    if (fitToLineHeight && rootRef.current) {
      const extentPx = rootRef.current.getBoundingClientRect().height;
      const next = resolveGridSizeFromExtent(extentPx, cellSize);
      setGridSize((prev) => (prev === next ? prev : next));
      return;
    }

    if (maxExtentPx != null) {
      const next = resolveGridSizeFromExtent(maxExtentPx, cellSize);
      setGridSize((prev) => (prev === next ? prev : next));
    }
  }, [cellSize, fitToLineHeight, maxExtentPx, rootRef]);

  return gridSize;
}

function useChatLoaderPhases(options: {
  animated: boolean;
  hoverAnimated: boolean;
}): {
  onMouseEnter: MouseEventHandler<HTMLDivElement>;
  onMouseLeave: MouseEventHandler<HTMLDivElement>;
  phase: ChatLoaderPhase;
} {
  const { animated, hoverAnimated } = options;
  const [isHovered, setIsHovered] = useState(false);
  const onMouseEnter = useCallback<MouseEventHandler<HTMLDivElement>>(() => {
    setIsHovered(true);
  }, []);
  const onMouseLeave = useCallback<MouseEventHandler<HTMLDivElement>>(() => {
    setIsHovered(false);
  }, []);
  const phase: ChatLoaderPhase = hoverAnimated
    ? isHovered
      ? "active"
      : "idle"
    : animated
      ? "active"
      : "idle";

  return { onMouseEnter, onMouseLeave, phase };
}

export function ChatLoader({
  animated = true,
  cellPadding = 1,
  className,
  dotSize = 2,
  hoverAnimated = false,
  label = "Thinking",
  maxExtent,
  onMouseEnter,
  onMouseLeave,
  pattern = "full",
  speed = 1,
  style,
  ...props
}: ChatLoaderProps) {
  const reducedMotion = usePrefersReducedMotion();
  const { phase, onMouseEnter: onLoaderMouseEnter, onMouseLeave: onLoaderMouseLeave } =
    useChatLoaderPhases({
      animated: Boolean(animated && !reducedMotion),
      hoverAnimated: Boolean(hoverAnimated && !reducedMotion),
    });
  const handleMouseEnter = useCallback<MouseEventHandler<HTMLDivElement>>(
    (event) => {
      onMouseEnter?.(event);
      onLoaderMouseEnter(event);
    },
    [onMouseEnter, onLoaderMouseEnter],
  );
  const handleMouseLeave = useCallback<MouseEventHandler<HTMLDivElement>>(
    (event) => {
      onMouseLeave?.(event);
      onLoaderMouseLeave(event);
    },
    [onMouseLeave, onLoaderMouseLeave],
  );

  return (
    <div
      role="status"
      aria-label={label}
      className={cn(
        "inline-flex max-w-full items-center gap-2 px-0.5 py-1.5 text-muted-foreground/80",
        className,
      )}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={style}
      {...props}
    >
      <ChatLoaderMatrix
        aria-hidden="true"
        cellPadding={cellPadding}
        dotSize={dotSize}
        fitToLineHeight={maxExtent == null}
        {...(maxExtent == null ? {} : { maxExtent })}
        pattern={pattern}
        phase={phase}
        reducedMotion={reducedMotion}
        speed={speed}
      />
      <span className="text-body font-medium thinking-shimmer motion-reduce:animate-none" aria-hidden="true">
        {label}
      </span>
    </div>
  );
}

export function ChatLoaderGlyph({
  animated = true,
  cellPadding = 1,
  dotSize = 2,
  maxExtent = 16,
  pattern = "full",
  speed = 1,
  ...props
}: ChatLoaderGlyphProps) {
  const reducedMotion = usePrefersReducedMotion();
  const phase: ChatLoaderPhase = animated && !reducedMotion ? "active" : "idle";

  return (
    <ChatLoaderMatrix
      cellPadding={cellPadding}
      dotSize={dotSize}
      fitToLineHeight={false}
      maxExtent={maxExtent}
      pattern={pattern}
      phase={phase}
      reducedMotion={reducedMotion}
      speed={speed}
      {...props}
    />
  );
}

function ChatLoaderMatrix({
  cellPadding,
  className,
  dotSize,
  fitToLineHeight,
  maxExtent,
  pattern,
  phase,
  reducedMotion,
  speed,
  ...props
}: Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  cellPadding: number;
  dotSize: number;
  fitToLineHeight: boolean;
  maxExtent?: number;
  pattern: ChatLoaderPattern;
  phase: ChatLoaderPhase;
  reducedMotion: boolean;
  speed: number;
}) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const normalizedDotSize = positiveNumber(dotSize, 2);
  const normalizedCellPadding = nonNegativeNumber(cellPadding, 1);
  const normalizedMaxExtent =
    maxExtent == null ? null : positiveNumber(maxExtent, CHAT_LOADER_MAX_GRID * 4);
  const normalizedSpeed = positiveNumber(speed, 1);
  const cellSize = normalizedDotSize + normalizedCellPadding * 2;
  const gridSize = useMatrixGridSize({
    cellSize,
    fitToLineHeight,
    maxExtentPx: normalizedMaxExtent,
    rootRef,
  });
  const matrixExtent = gridSize * cellSize;
  const rootStyle: ChatLoaderStyle = {
    "--chat-loader-cell-size": `${cellSize}px`,
    "--chat-loader-dot-size": `${normalizedDotSize}px`,
    "--chat-loader-duration": `${Math.max(0.24, 1.2 / normalizedSpeed).toFixed(3)}s`,
    height: fitToLineHeight ? "var(--text-body--line-height, 1em)" : `${matrixExtent}px`,
    width: `${matrixExtent}px`,
  };
  const gridStyle: CSSProperties = {
    gridTemplateColumns: `repeat(${gridSize}, var(--chat-loader-cell-size))`,
    gridTemplateRows: `repeat(${gridSize}, var(--chat-loader-cell-size))`,
  };

  return (
    <span
      ref={rootRef}
      className={cn("inline-grid shrink-0 place-items-center", className)}
      data-phase={phase}
      data-slot="chat-loader-matrix"
      style={rootStyle}
      {...props}
    >
      <span aria-hidden="true" className="grid" style={gridStyle}>
        {Array.from({ length: gridSize * gridSize }, (_, index) => {
          const row = Math.floor(index / gridSize);
          const col = index % gridSize;
          const isActive = dotMatchesPattern(pattern, row, col, gridSize);
          const resolved = chatLoaderDotResolver({
            col,
            gridSize,
            index,
            isActive,
            phase,
            reducedMotion,
            row,
          });

          return (
            <span className="grid place-items-center" key={`${row}:${col}`}>
              <span
                className={cn("chat-loader-dot", resolved.className)}
                data-active={isActive ? "true" : "false"}
                style={resolved.style}
              />
            </span>
          );
        })}
      </span>
    </span>
  );
}

function dotMatchesPattern(
  pattern: ChatLoaderPattern,
  row: number,
  col: number,
  gridSize: number,
): boolean {
  const last = gridSize - 1;

  switch (pattern) {
    case "backslash":
      return row === col;
    case "checker":
      return (row + col) % 2 === 0;
    case "cross":
      return row === Math.floor(last / 2) || col === Math.floor(last / 2);
    case "ring":
      return row === 0 || col === 0 || row === last || col === last;
    case "slash":
      return row + col === last;
    case "full":
      return true;
  }
}

function positiveNumber(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegativeNumber(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}
