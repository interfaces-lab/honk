"use client";

import {
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type HTMLAttributes,
  type RefObject,
} from "react";

import { cn } from "./utils";

const CHAT_LOADER_MAX_GRID = 5;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const CHAT_LOADER_DOT_SIZE_PX = 2;
const CHAT_LOADER_CELL_PADDING_PX = 1;

type ChatLoaderPhase = "idle" | "active";

interface ChatLoaderProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  label?: string;
}

interface ChatLoaderGlyphProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  maxExtent?: number;
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
  motion?: "diagonal-sweep" | undefined;
  state?: "inactive" | undefined;
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
    return { state: "inactive" };
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

  return { motion: "diagonal-sweep", style };
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

export function ChatLoader({ className, label = "Thinking", style, ...props }: ChatLoaderProps) {
  return (
    <div
      role="status"
      aria-label={label}
      className={cn(
        "inline-flex max-w-full items-center gap-2 px-0.5 py-1.5 text-muted-foreground/80",
        className,
      )}
      style={style}
      {...props}
    >
      <span
        className="motion-reduce:animate-none"
        data-slot="conversation-loader-thinking"
        aria-hidden="true"
      >
        {label}
      </span>
    </div>
  );
}

export function ChatLoaderGlyph({ maxExtent = 16, speed = 1, ...props }: ChatLoaderGlyphProps) {
  const reducedMotion = usePrefersReducedMotion();
  const phase: ChatLoaderPhase = reducedMotion ? "idle" : "active";

  return (
    <ChatLoaderMatrix
      fitToLineHeight={false}
      maxExtent={maxExtent}
      phase={phase}
      reducedMotion={reducedMotion}
      speed={speed}
      {...props}
    />
  );
}

function ChatLoaderMatrix({
  className,
  fitToLineHeight,
  maxExtent,
  phase,
  reducedMotion,
  speed,
  ...props
}: Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  fitToLineHeight: boolean;
  maxExtent?: number;
  phase: ChatLoaderPhase;
  reducedMotion: boolean;
  speed: number;
}) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const cellSize = CHAT_LOADER_DOT_SIZE_PX + CHAT_LOADER_CELL_PADDING_PX * 2;
  const gridSize = useMatrixGridSize({
    cellSize,
    fitToLineHeight,
    maxExtentPx: maxExtent ?? null,
    rootRef,
  });
  const matrixExtent = gridSize * cellSize;
  const rootStyle: ChatLoaderStyle = {
    "--chat-loader-cell-size": `${cellSize}px`,
    "--chat-loader-dot-size": `${CHAT_LOADER_DOT_SIZE_PX}px`,
    "--chat-loader-duration": `${Math.max(0.24, 1.2 / speed).toFixed(3)}s`,
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
          const resolved = chatLoaderDotResolver({
            col,
            gridSize,
            index,
            isActive: true,
            phase,
            reducedMotion,
            row,
          });

          return (
            <span className="grid place-items-center" key={`${row}:${col}`}>
              <span
                data-slot="chat-loader-dot"
                data-active="true"
                data-motion={resolved.motion}
                data-state={resolved.state}
                style={resolved.style}
              />
            </span>
          );
        })}
      </span>
    </span>
  );
}
