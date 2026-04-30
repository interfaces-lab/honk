"use client";

import { IconArrowLeft, IconSidebar, IconSidebarHiddenLeftWide } from "central-icons";
import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import { isElectronHost } from "~/env";
import {
  type WorkbenchTab,
  shellPanelsActions,
  useActiveTab,
  useIsMuted,
  useLeftOpen,
  useLeftWidth,
  useRightOpen,
  useRightWidth,
} from "~/lib/shell-panels-store";
import { cn } from "~/lib/utils";
import { WorkbenchTabBar } from "./workbench-tabs";

const LEFT_LIMITS = { min: 180, max: 400 } as const;
const RIGHT_LIMITS = { min: 340, max: 600 } as const;

interface ResizeState {
  base: number;
  pointerId: number;
  raf: number | null;
  rail: HTMLDivElement;
  startX: number;
  width: number;
}

type RightPanels = Record<WorkbenchTab, ReactNode>;

export interface AppShellPanels {
  leftOpen: boolean;
  rightOpen: boolean;
  setLeftOpen: (open: boolean) => void;
  setRightOpen: (open: boolean) => void;
  leftW: number;
  rightW: number;
  toggleLeft: () => void;
  toggleRight: () => void;
  setLeftWidth: (n: number) => void;
  setRightWidth: (n: number) => void;
  activeTab: WorkbenchTab;
  setActiveTab: (tab: WorkbenchTab) => void;
}

function clampWidth(width: number, limits: { min: number; max: number }): number {
  return Math.min(limits.max, Math.max(limits.min, width));
}

function resolveEffectiveRightOpen(input: {
  storedRightOpen: boolean;
  routeThreadId: string | null;
  gitFocusId: string | null;
  muted: boolean;
}): boolean {
  return input.storedRightOpen || Boolean(input.routeThreadId && input.gitFocusId && !input.muted);
}

function setRightPanelOpen(cwd: string | null, open: boolean): void {
  shellPanelsActions.setRightOpen(cwd, open);
  shellPanelsActions.setMuted(cwd, !open);
}

function LeftAside(props: { cwd: string | null; children: ReactNode }) {
  const leftOpen = useLeftOpen(props.cwd);
  const leftWidth = useLeftWidth(props.cwd);
  const [dragging, setDragging] = useState(false);
  const railStateRef = useRef<ResizeState | null>(null);
  const liveWidthRef = useRef(leftWidth);
  const asideRef = useRef<HTMLElement | null>(null);

  if (!dragging) {
    liveWidthRef.current = leftWidth;
  }

  useEffect(() => {
    return () => {
      const drag = railStateRef.current;
      if (drag && drag.raf !== null) {
        window.cancelAnimationFrame(drag.raf);
      }
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    };
  }, []);

  const stopResize = (pointerId: number) => {
    const drag = railStateRef.current;
    if (!drag || drag.pointerId !== pointerId) {
      return;
    }

    if (drag.raf !== null) {
      window.cancelAnimationFrame(drag.raf);
    }

    const nextWidth = drag.width;
    if (drag.rail.hasPointerCapture(pointerId)) {
      drag.rail.releasePointerCapture(pointerId);
    }

    railStateRef.current = null;
    setDragging(false);
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
    shellPanelsActions.setLeftWidth(props.cwd, nextWidth);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    const node = asideRef.current;
    if (!node) {
      return;
    }

    const width = liveWidthRef.current;
    node.style.width = `${width}px`;
    railStateRef.current = {
      base: width,
      pointerId: event.pointerId,
      raf: null,
      rail: event.currentTarget,
      startX: event.clientX,
      width,
    };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    event.preventDefault();
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = railStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const delta = event.clientX - drag.startX;
    const nextWidth = clampWidth(drag.base + delta, LEFT_LIMITS);
    drag.width = nextWidth;
    liveWidthRef.current = nextWidth;

    if (drag.raf !== null) {
      event.preventDefault();
      return;
    }

    drag.raf = window.requestAnimationFrame(() => {
      const activeDrag = railStateRef.current;
      if (!activeDrag) {
        return;
      }
      activeDrag.raf = null;
      if (asideRef.current) {
        asideRef.current.style.width = `${activeDrag.width}px`;
      }
    });

    event.preventDefault();
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    stopResize(event.pointerId);
    event.preventDefault();
  };

  return (
    <aside
      className={cn(
        "agent-window__sidebar multi-shell-sidebar relative flex shrink-0 flex-col overflow-hidden border-multi-border/50",
        dragging
          ? "transition-none"
          : "transition-[width,border-right-width] duration-150 ease-out motion-reduce:transition-none",
      )}
      data-agent-window-sidebar=""
      ref={asideRef}
      style={{
        width: leftOpen ? leftWidth : 0,
        borderRightWidth: leftOpen ? 1 : 0,
      }}
    >
      <div
        aria-hidden={!leftOpen}
        className={cn(
          "flex h-full min-h-0 w-full flex-col transition-opacity duration-150 ease-out motion-reduce:transition-none",
          leftOpen ? "opacity-100" : "opacity-0",
        )}
      >
        {props.children}
      </div>
      {leftOpen ? (
        <div
          className="absolute top-0 right-0 z-10 h-full w-1 touch-none cursor-col-resize"
          onPointerCancel={handlePointerUp}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          <div className="h-full w-full hover:bg-multi-hover/70" />
        </div>
      ) : null}
    </aside>
  );
}

function RightAside(props: {
  cwd: string | null;
  changesCount: number;
  rightPanels: RightPanels;
  routeThreadId: string | null;
  gitFocusId: string | null;
}) {
  const storedRightOpen = useRightOpen(props.cwd);
  const rightWidth = useRightWidth(props.cwd);
  const activeTab = useActiveTab(props.cwd);
  const muted = useIsMuted(props.cwd);
  const rightOpen = resolveEffectiveRightOpen({
    storedRightOpen,
    routeThreadId: props.routeThreadId,
    gitFocusId: props.gitFocusId,
    muted,
  });

  const [dragging, setDragging] = useState(false);
  const railStateRef = useRef<ResizeState | null>(null);
  const liveWidthRef = useRef(rightWidth);
  const asideRef = useRef<HTMLElement | null>(null);

  if (!dragging) {
    liveWidthRef.current = rightWidth;
  }

  useEffect(() => {
    return () => {
      const drag = railStateRef.current;
      if (drag && drag.raf !== null) {
        window.cancelAnimationFrame(drag.raf);
      }
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    };
  }, []);

  const stopResize = (pointerId: number) => {
    const drag = railStateRef.current;
    if (!drag || drag.pointerId !== pointerId) {
      return;
    }

    if (drag.raf !== null) {
      window.cancelAnimationFrame(drag.raf);
    }

    const nextWidth = drag.width;
    if (drag.rail.hasPointerCapture(pointerId)) {
      drag.rail.releasePointerCapture(pointerId);
    }

    railStateRef.current = null;
    setDragging(false);
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
    shellPanelsActions.setRightWidth(props.cwd, nextWidth);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    const node = asideRef.current;
    if (!node) {
      return;
    }

    const width = liveWidthRef.current;
    node.style.width = `${width}px`;
    railStateRef.current = {
      base: width,
      pointerId: event.pointerId,
      raf: null,
      rail: event.currentTarget,
      startX: event.clientX,
      width,
    };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    event.preventDefault();
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = railStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const delta = drag.startX - event.clientX;
    const nextWidth = clampWidth(drag.base + delta, RIGHT_LIMITS);
    drag.width = nextWidth;
    liveWidthRef.current = nextWidth;

    if (drag.raf !== null) {
      event.preventDefault();
      return;
    }

    drag.raf = window.requestAnimationFrame(() => {
      const activeDrag = railStateRef.current;
      if (!activeDrag) {
        return;
      }
      activeDrag.raf = null;
      if (asideRef.current) {
        asideRef.current.style.width = `${activeDrag.width}px`;
      }
    });

    event.preventDefault();
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    stopResize(event.pointerId);
    event.preventDefault();
  };

  return (
    <aside
      className={cn(
        "agent-window__workbench multi-shell-surface relative flex shrink-0 flex-col overflow-hidden border-multi-border/50",
        dragging
          ? "transition-none"
          : "transition-[width,border-left-width] duration-100 ease-[cubic-bezier(0.19,1,0.22,1)] motion-reduce:transition-none",
      )}
      data-agent-window-workbench=""
      ref={asideRef}
      style={{
        width: rightOpen ? rightWidth : 0,
        borderLeftWidth: rightOpen ? 1 : 0,
      }}
    >
      <div
        aria-hidden={!rightOpen}
        className={cn(
          "flex h-full min-h-0 w-full flex-col transition-opacity duration-150 ease-out motion-reduce:transition-none",
          rightOpen ? "opacity-100" : "opacity-0",
        )}
      >
        <WorkbenchTabBar
          active={activeTab}
          count={props.changesCount}
          onTab={(tab) => {
            shellPanelsActions.setActiveTab(props.cwd, tab);
            shellPanelsActions.setMuted(props.cwd, false);
          }}
          onToggle={() => setRightPanelOpen(props.cwd, !rightOpen)}
        />
        {props.rightPanels[activeTab]}
      </div>
      {rightOpen ? (
        <div
          className="absolute top-0 left-0 z-10 h-full w-1 touch-none cursor-col-resize"
          onPointerCancel={handlePointerUp}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          <div className="h-full w-full hover:bg-multi-hover/70" />
        </div>
      ) : null}
    </aside>
  );
}

function ElectronHeaderControls(props: {
  cwd: string | null;
  showRight: boolean;
  onBack?: () => void;
  routeThreadId: string | null;
  gitFocusId: string | null;
}) {
  const leftOpen = useLeftOpen(props.cwd);
  const storedRightOpen = useRightOpen(props.cwd);
  const rightWidth = useRightWidth(props.cwd);
  const muted = useIsMuted(props.cwd);
  const rightOpen = resolveEffectiveRightOpen({
    storedRightOpen,
    routeThreadId: props.routeThreadId,
    gitFocusId: props.gitFocusId,
    muted,
  });

  return (
    <div
      className="pointer-events-none absolute top-0 left-0 z-10 h-(--multi-header-height) drag-region"
      style={{ right: rightOpen ? rightWidth : 0 }}
    >
      <div className="pointer-events-none absolute top-(--multi-titlebar-control-row-top) left-(--multi-workbench-toggle-left) flex gap-1">
        {props.onBack ? (
          <button
            type="button"
            onClick={() => props.onBack?.()}
            className="pointer-events-auto no-drag flex h-(--multi-titlebar-control-height) w-(--multi-titlebar-control-height) shrink-0 items-center justify-center rounded-multi-control bg-transparent p-0 leading-none text-muted-foreground [&_svg]:block hover:bg-multi-hover hover:text-foreground"
            aria-label="Back to chat"
          >
            <IconArrowLeft className="size-4 shrink-0" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => shellPanelsActions.toggleLeft(props.cwd)}
          className="pointer-events-auto no-drag flex h-(--multi-titlebar-control-height) w-(--multi-titlebar-control-height) shrink-0 items-center justify-center rounded-multi-control bg-transparent p-0 leading-none text-muted-foreground [&_svg]:block hover:bg-multi-hover hover:text-foreground"
          aria-label={leftOpen ? "Collapse chats" : "Expand chats"}
        >
          {leftOpen ? (
            <IconSidebarHiddenLeftWide className="size-4 shrink-0" />
          ) : (
            <IconSidebar className="size-4 shrink-0" />
          )}
        </button>
      </div>
      {props.showRight && !rightOpen ? (
        <div className="pointer-events-none absolute top-(--multi-titlebar-control-row-top) right-0 flex pr-(--multi-workbench-toggle-right)">
          <button
            type="button"
            onClick={() => setRightPanelOpen(props.cwd, true)}
            className="pointer-events-auto no-drag flex h-(--multi-titlebar-control-height) w-(--multi-titlebar-control-height) shrink-0 items-center justify-center rounded-multi-control bg-transparent p-0 leading-none text-muted-foreground/70 [&_svg]:block hover:bg-multi-hover hover:text-foreground"
            aria-label="Expand panel"
          >
            <IconSidebar className="size-4 shrink-0 opacity-60" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function LeftExpandButton(props: { cwd: string | null }) {
  const leftOpen = useLeftOpen(props.cwd);
  if (leftOpen) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute top-2 left-2 z-10">
      <button
        type="button"
        onClick={() => shellPanelsActions.toggleLeft(props.cwd)}
        className="pointer-events-auto flex size-7 items-center justify-center rounded-multi-control bg-multi-sidebar/80 text-muted-foreground shadow-sm backdrop-blur-sm [&_svg]:block hover:bg-multi-hover hover:text-foreground"
        aria-label="Expand chats"
      >
        <IconSidebar className="size-4 shrink-0" />
      </button>
    </div>
  );
}

export function AppShell(props: {
  cwd: string | null;
  left: ReactNode;
  center: ReactNode;
  right: RightPanels | null;
  changesCount: number;
  routeThreadId?: string | null;
  gitFocusId?: string | null;
  onBack?: () => void;
}) {
  const electron = isElectronHost();
  const showRight = props.right !== null;

  return (
    <div
      className="agent-window relative flex h-full min-w-0 flex-1 flex-row bg-transparent"
      data-component="root"
      data-agent-window=""
    >
      <LeftAside cwd={props.cwd}>{props.left}</LeftAside>

      <div className="agent-window__body flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="relative flex min-h-0 flex-1 flex-row">
          <main
            className="agent-panel agent-window__agent-panel flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-multi-chat outline-hidden"
            data-component="agent-panel"
          >
            {electron ? (
              <div
                aria-hidden
                className="pointer-events-none h-(--multi-header-height) shrink-0 select-none"
              />
            ) : null}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden outline-hidden">
              {props.center}
            </div>
          </main>

          {showRight && props.right ? (
            <RightAside
              cwd={props.cwd}
              changesCount={props.changesCount}
              rightPanels={props.right}
              routeThreadId={props.routeThreadId ?? null}
              gitFocusId={props.gitFocusId ?? null}
            />
          ) : null}
        </div>
      </div>

      {electron ? (
        <ElectronHeaderControls
          cwd={props.cwd}
          showRight={showRight}
          routeThreadId={props.routeThreadId ?? null}
          gitFocusId={props.gitFocusId ?? null}
          {...(props.onBack ? { onBack: props.onBack } : {})}
        />
      ) : (
        <LeftExpandButton cwd={props.cwd} />
      )}
    </div>
  );
}
