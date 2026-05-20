"use client";

import type { CSSProperties, HTMLAttributes, MouseEventHandler } from "react";
import { useCallback, useState, useSyncExternalStore } from "react";

import { cn } from "~/lib/utils";

const CHAT_LOADER_GRID_SIZE = 5;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

type ChatLoaderPhase = "idle" | "active";
type ChatLoaderPattern = "full" | "ring" | "checker" | "cross" | "slash" | "backslash";

interface ChatLoaderProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  animated?: boolean;
  boxSize?: number;
  cellPadding?: number;
  dotSize?: number;
  hoverAnimated?: boolean;
  label?: string;
  minSize?: number;
  pattern?: ChatLoaderPattern;
  speed?: number;
}

interface ChatLoaderDotInput {
  col: number;
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
  "--chat-loader-diagonal-parity"?: number;
  "--chat-loader-path"?: number;
};

const chatLoaderDotResolver: ChatLoaderDotResolver = ({
  isActive,
  index,
  row,
  col,
  reducedMotion,
  phase,
}) => {
  if (!isActive) {
    return { className: "chat-loader-dot-inactive" };
  }

  const path = trBlPathNormFromIndex(index);
  const slice = row + (CHAT_LOADER_GRID_SIZE - 1 - col);
  const parity = slice % 2;
  const style: ChatLoaderDotStyle = {
    "--chat-loader-diagonal-parity": parity,
    "--chat-loader-path": path,
  };

  if (reducedMotion || phase === "idle") {
    return {
      style: {
        ...style,
        opacity: parity === 0 ? 0.88 : 0.14,
      },
    };
  }

  return { className: "chat-loader-diagonal-alt-sweep", style };
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

function trBlPathNormFromIndex(index: number, gridSize = CHAT_LOADER_GRID_SIZE): number {
  const row = Math.floor(index / gridSize);
  const col = index % gridSize;
  const maxPath = Math.max(1, (gridSize - 1) * 2);

  return (row + (gridSize - 1 - col)) / maxPath;
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
  boxSize = 24,
  cellPadding = 1,
  className,
  dotSize = 2,
  hoverAnimated = false,
  label = "Thinking",
  minSize = 24,
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
        boxSize={boxSize}
        cellPadding={cellPadding}
        dotSize={dotSize}
        minSize={minSize}
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

function ChatLoaderMatrix({
  boxSize,
  cellPadding,
  className,
  dotSize,
  minSize,
  pattern,
  phase,
  reducedMotion,
  speed,
  ...props
}: Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  boxSize: number;
  cellPadding: number;
  dotSize: number;
  minSize: number;
  pattern: ChatLoaderPattern;
  phase: ChatLoaderPhase;
  reducedMotion: boolean;
  speed: number;
}) {
  const normalizedDotSize = positiveNumber(dotSize, 2);
  const normalizedCellPadding = nonNegativeNumber(cellPadding, 1);
  const normalizedBoxSize = positiveNumber(boxSize, 24);
  const normalizedMinSize = positiveNumber(minSize, 24);
  const normalizedSpeed = positiveNumber(speed, 1);
  const cellSize = normalizedDotSize + normalizedCellPadding * 2;
  const rootStyle: ChatLoaderStyle = {
    "--chat-loader-cell-size": `${cellSize}px`,
    "--chat-loader-dot-size": `${normalizedDotSize}px`,
    "--chat-loader-duration": `${Math.max(0.24, 1.2 / normalizedSpeed).toFixed(3)}s`,
    height: `${normalizedBoxSize}px`,
    minHeight: `${normalizedMinSize}px`,
    minWidth: `${normalizedMinSize}px`,
    width: `${normalizedBoxSize}px`,
  };
  const gridStyle: CSSProperties = {
    gridTemplateColumns: `repeat(${CHAT_LOADER_GRID_SIZE}, var(--chat-loader-cell-size))`,
    gridTemplateRows: `repeat(${CHAT_LOADER_GRID_SIZE}, var(--chat-loader-cell-size))`,
  };

  return (
    <span
      className={cn("inline-grid shrink-0 place-items-center", className)}
      data-phase={phase}
      data-slot="chat-loader-matrix"
      style={rootStyle}
      {...props}
    >
      <span aria-hidden="true" className="grid" style={gridStyle}>
        {Array.from({ length: CHAT_LOADER_GRID_SIZE * CHAT_LOADER_GRID_SIZE }, (_, index) => {
          const row = Math.floor(index / CHAT_LOADER_GRID_SIZE);
          const col = index % CHAT_LOADER_GRID_SIZE;
          const isActive = dotMatchesPattern(pattern, row, col);
          const resolved = chatLoaderDotResolver({
            col,
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

function dotMatchesPattern(pattern: ChatLoaderPattern, row: number, col: number): boolean {
  const last = CHAT_LOADER_GRID_SIZE - 1;

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
