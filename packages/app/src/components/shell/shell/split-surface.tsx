import type { EnvironmentId, ThreadId } from "@multi/contracts";
import { useCallback, useMemo } from "react";
import { cn } from "~/lib/utils";
import {
  resolveSplitViewPaneThreadId,
  type SplitView,
  type SplitViewPane,
} from "~/split-view-store";

interface SplitSurfaceProps {
  splitView: SplitView;
  environmentId: EnvironmentId;
  onSetRatio: (ratio: number) => void;
  onSetFocusedPane: (pane: SplitViewPane) => void;
  renderPane: (input: {
    pane: SplitViewPane;
    threadId: ThreadId | null;
    focused: boolean;
  }) => React.ReactNode;
}

export function SplitSurface({
  splitView,
  environmentId: _environmentId,
  onSetRatio,
  onSetFocusedPane,
  renderPane,
}: SplitSurfaceProps) {
  const leftThreadId = resolveSplitViewPaneThreadId(splitView, "left");
  const rightThreadId = resolveSplitViewPaneThreadId(splitView, "right");
  const ratio = splitView.ratio;

  const leftFocused = splitView.focusedPane === "left";
  const rightFocused = splitView.focusedPane === "right";

  const leftPercentage = `${(ratio * 100).toFixed(1)}%`;
  const rightPercentage = `${((1 - ratio) * 100).toFixed(1)}%`;

  const handleDragStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const target = event.currentTarget;
      const container = target.parentElement;
      if (!container) return;

      event.preventDefault();
      target.setPointerCapture(event.pointerId);

      const containerRect = container.getBoundingClientRect();
      const move = (moveEvent: PointerEvent) => {
        const nextRatio = (moveEvent.clientX - containerRect.left) / containerRect.width;
        onSetRatio(nextRatio);
      };
      const up = () => {
        target.releasePointerCapture(event.pointerId);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [onSetRatio],
  );

  const leftContent = useMemo(
    () => renderPane({ pane: "left", threadId: leftThreadId, focused: leftFocused }),
    [renderPane, leftThreadId, leftFocused],
  );
  const rightContent = useMemo(
    () => renderPane({ pane: "right", threadId: rightThreadId, focused: rightFocused }),
    [renderPane, rightThreadId, rightFocused],
  );

  return (
    <div className="flex h-full min-h-0 w-full min-w-0">
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-border/50",
          leftFocused && "ring-1 ring-inset ring-primary/20",
        )}
        style={{ width: leftPercentage }}
        onPointerDown={() => onSetFocusedPane("left")}
      >
        {leftContent}
      </div>
      <div
        className="w-1 shrink-0 cursor-col-resize bg-border/30 transition-colors hover:bg-border/60 active:bg-primary/40"
        onPointerDown={handleDragStart}
      />
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
          rightFocused && "ring-1 ring-inset ring-primary/20",
        )}
        style={{ width: rightPercentage }}
        onPointerDown={() => onSetFocusedPane("right")}
      >
        {rightContent}
      </div>
    </div>
  );
}
