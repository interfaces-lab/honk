// Hover-hold coordination for explanation panels attached to menu rows.
//
// Base UI cannot keep these panels alive on its own, for two verified reasons:
// - Menu highlight moves real DOM focus, so leaving a row fires a blur-based close on the
//   row's PreviewCard that bypasses its hover safe-polygon entirely.
// - PreviewCardRoot wraps itself in a private FloatingTree, so the enclosing menu's
//   safe-polygon `hasOpenChildNode()` cannot see an open panel and closes the submenu when
//   the pointer travels toward it.
//
// This hook makes the calculated hover affordance the close authority instead: a panel is
// "held" while the pointer is over the panel, over its origin row, inside the corridor
// spanning the gap between them, or inside Base UI's safe polygon from the row-exit point.
// Base UI close requests arriving while held are vetoed; once the pointer leaves the hold
// region for PANEL_EXIT_GRACE_MS, the hook dismisses the panel itself.

import * as React from "react";

import {
  computeSafeZone,
  isPointInRect,
  isPointInSafeZone,
  type Point,
  type Rect,
} from "../safe-polygon-geometry";

/** Continuous time outside the hold region before the panel dismisses (2x Base UI's 40ms). */
const PANEL_EXIT_GRACE_MS = 80;

// The submenu's safePolygon runs with blockPointerEvents: during traversal Base UI sets
// `body { pointer-events: none }` and re-enables only the submenu trigger and popup. The
// panel is portalled to body, so it inherits `none` and could never be hovered mid-flight.
// An explicit `auto` opts the panel back in, exactly how Base UI re-enables its own two
// elements (useHoverInteractionSharedState `applySafePolygonPointerEventsMutation`).
const INTERACTIVE_PANEL_STYLE: React.CSSProperties = { pointerEvents: "auto" };

type PanelSide = "left" | "right";

// Collision avoidance can flip the panel to either side of its row; derive the actual
// placement from geometry rather than trusting the requested side.
function panelSide(rowRect: Rect, panelRect: Rect): PanelSide | null {
  if (panelRect.right <= rowRect.left + 1) return "left";
  if (panelRect.left >= rowRect.right - 1) return "right";
  return null;
}

// Affordance widening: Base UI clamps its trough to the shorter element (the menu row),
// leaving most of the travel gap unprotected around a thin polygon. Hold the full corridor
// between the panel and the row — the union of both vertical extents — so any path across
// the gap keeps the panel alive. It ends at the row's near edge, so moving onto a
// different row still releases the panel for swapping.
function corridorRect(side: PanelSide, rowRect: Rect, panelRect: Rect): Rect {
  const top = Math.min(panelRect.top, rowRect.top);
  const bottom = Math.max(panelRect.bottom, rowRect.bottom);
  return side === "left"
    ? { left: panelRect.right - 1, right: rowRect.left + 1, top, bottom }
    : { left: rowRect.right - 1, right: panelRect.left + 1, top, bottom };
}

type PreviewPanelHold<Id extends string> = {
  /** Row id whose panel is open, or null. Drive each PreviewCard.Root's `open` from it. */
  readonly openId: Id | null;
  /** Whether any panel is active; veto submenu hover-closes while true. */
  readonly isActive: () => boolean;
  /** Stable callback ref registering a row's rendered element. */
  readonly rowRef: (id: Id) => (node: HTMLElement | null) => void;
  /** Callback ref for the (single) open panel popup element. */
  readonly panelRef: (node: HTMLElement | null) => void;
  /** Controlled onOpenChange for each row's PreviewCard.Root. */
  readonly handleOpenChange: (id: Id, open: boolean) => void;
  /** Clear all hold state; call when the enclosing menu or submenu closes. */
  readonly reset: () => void;
  /** Inline style for PreviewCard.Popup keeping the panel hoverable mid-traversal. */
  readonly panelStyle: React.CSSProperties;
};

function usePreviewPanelHold<Id extends string>(): PreviewPanelHold<Id> {
  const [openId, setOpenId] = React.useState<Id | null>(null);
  // Base UI's open/close requests arrive outside the React render cycle, so decisions
  // must read current state from refs, not closures.
  const openIdRef = React.useRef<Id | null>(null);
  openIdRef.current = openId;
  const rowElsRef = React.useRef(new Map<Id, HTMLElement>());
  const rowRefCallbacksRef = React.useRef(new Map<Id, (node: HTMLElement | null) => void>());
  const panelElRef = React.useRef<HTMLElement | null>(null);
  const pointerRef = React.useRef<Point | null>(null);
  // Pointer position captured when it leaves the row: the polygon apex, per Base UI.
  const anchorRef = React.useRef<Point | null>(null);
  const closeTimerRef = React.useRef<number | null>(null);

  const cancelClose = (): void => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const reset = (): void => {
    cancelClose();
    anchorRef.current = null;
    setOpenId(null);
  };

  const holdRegionContains = (pointer: Point): boolean => {
    const id = openIdRef.current;
    if (id === null) return false;
    const rowRect = rowElsRef.current.get(id)?.getBoundingClientRect();
    if (rowRect !== undefined && isPointInRect(pointer, rowRect)) return true;
    const panelRect = panelElRef.current?.getBoundingClientRect();
    if (panelRect === undefined || rowRect === undefined) return false;
    if (isPointInRect(pointer, panelRect)) return true;
    const side = panelSide(rowRect, panelRect);
    if (side === null) return false;
    if (isPointInRect(pointer, corridorRect(side, rowRect, panelRect))) return true;
    const anchor = anchorRef.current;
    return (
      anchor !== null &&
      isPointInSafeZone(pointer, computeSafeZone(anchor, rowRect, panelRect, side))
    );
  };

  const isActive = (): boolean => openIdRef.current !== null;

  const handleOpenChange = (id: Id, open: boolean): void => {
    if (!open && openIdRef.current === id) {
      const pointer = pointerRef.current;
      // Veto closes while the pointer holds the panel: the mousemove grace timer below
      // dismisses it once the pointer truly leaves. Keyboard-driven closes pass
      // through, since a keyboard-opened panel has no recorded pointer inside.
      if (pointer !== null && holdRegionContains(pointer)) return;
    }
    anchorRef.current = null;
    setOpenId((prev) => (open ? id : prev === id ? null : prev));
  };

  const rowRef = (id: Id): ((node: HTMLElement | null) => void) => {
    const cached = rowRefCallbacksRef.current.get(id);
    if (cached !== undefined) return cached;
    const callback = (node: HTMLElement | null): void => {
      if (node === null) rowElsRef.current.delete(id);
      else rowElsRef.current.set(id, node);
    };
    rowRefCallbacksRef.current.set(id, callback);
    return callback;
  };

  const panelRef = (node: HTMLElement | null): void => {
    // Only one panel mounts at a time; ignore unmount nulls so a swap's mount/unmount
    // ordering cannot clear the incoming panel's element.
    if (node !== null) panelElRef.current = node;
  };

  React.useEffect(() => {
    if (openId === null) return undefined;
    const onMouseMove = (event: MouseEvent): void => {
      const pointer: Point = { x: event.clientX, y: event.clientY };
      pointerRef.current = pointer;
      const rowRect = rowElsRef.current.get(openId)?.getBoundingClientRect();
      if (rowRect !== undefined && isPointInRect(pointer, rowRect)) {
        anchorRef.current = pointer;
      }
      // Skip while the panel is unmeasurable: the popup mounts a tick after open.
      if (panelElRef.current === null) return;
      if (holdRegionContains(pointer)) {
        cancelClose();
        return;
      }
      // First outside sample arms the timer; the timer also covers a pointer that parks
      // outside and stops producing mousemoves.
      if (closeTimerRef.current === null) {
        closeTimerRef.current = window.setTimeout(() => {
          closeTimerRef.current = null;
          const latest = pointerRef.current;
          if (latest === null || !holdRegionContains(latest)) {
            anchorRef.current = null;
            setOpenId(null);
          }
        }, PANEL_EXIT_GRACE_MS);
      }
    };
    window.addEventListener("mousemove", onMouseMove);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      cancelClose();
    };
  }, [openId]);

  return {
    openId,
    isActive,
    rowRef,
    panelRef,
    handleOpenChange,
    reset,
    panelStyle: INTERACTIVE_PANEL_STYLE,
  };
}

export { usePreviewPanelHold };
export type { PreviewPanelHold };
