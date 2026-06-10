import { type MessagesTimelineRow } from "./timeline-rows";

export const TIMELINE_ROW_GAP_PX = 12;
export const LAST_PAIR_MIN_HEIGHT_RATIO = 0.6;
export const LAST_PAIR_MIN_HEIGHT_FLOOR_PX = 120;
export const NEAR_BOTTOM_THRESHOLD_PX = 4;
export const USER_SCROLL_INPUT_WINDOW_MS = 250;
export const PIN_SNAP_THRESHOLD_PX = 1;

export interface TimelineScrollFollowState {
  pinned: boolean;
  atBottom: boolean;
}

export interface TimelinePinnedStateEvent {
  totalHeight: number;
  clampedOffset: number;
  viewportHeight: number;
  nearBottomThresholdPx?: number;
  isScrolling: boolean;
  lastObservedScrollOffset: number;
  isUserPointerDown: boolean;
  msSinceUserScrollInput: number;
  userInputWindowMs?: number;
  isReady: boolean;
  isProgrammaticScrollActive: boolean;
}

export type TimelineScrollFollowEvent =
  | TimelinePinnedStateEvent
  | {
      type: "scroll";
      scrollOffset: number;
      maxScrollOffset: number;
      scrollDelta: number;
      now: number;
      lastUserInputAt: number;
    }
  | { type: "repin" }
  | { type: "restore"; atBottom: boolean };

export function computeLastPairMinHeightPx(viewportHeight: number, scrollInset = 1): number {
  if (viewportHeight === 0) {
    return 0;
  }

  const contentHeight = viewportHeight - scrollInset;
  return Math.max(contentHeight * LAST_PAIR_MIN_HEIGHT_RATIO, LAST_PAIR_MIN_HEIGHT_FLOOR_PX);
}

export function computeLastTurnContentHeightPx(
  rows: readonly MessagesTimelineRow[],
  measuredHeights: ReadonlyMap<string, number>,
  lastHumanIndex: number | undefined,
  estimateRowHeight?: (index: number) => number,
): number {
  if (lastHumanIndex === undefined || lastHumanIndex < 0) {
    return 0;
  }

  let totalHeight = 0;
  let measuredRowCount = 0;
  for (let index = lastHumanIndex; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row) {
      continue;
    }

    totalHeight += measuredHeights.get(row.id) ?? estimateRowHeight?.(index) ?? 0;
    measuredRowCount += 1;
  }

  return totalHeight + Math.max(0, measuredRowCount - 1) * TIMELINE_ROW_GAP_PX;
}

export function computeDynamicPaddingEndPx(input: {
  basePadding: number;
  lastTurnHeight: number;
  minHeight: number;
}): number {
  const { basePadding, lastTurnHeight, minHeight } = input;
  if (lastTurnHeight >= minHeight) {
    return Math.max(basePadding, 0);
  }

  return Math.max(minHeight - lastTurnHeight, basePadding, 0);
}

export function computePinnedState(
  prev: TimelineScrollFollowState,
  event: TimelineScrollFollowEvent,
): TimelineScrollFollowState {
  if ("type" in event) {
    if (event.type === "repin") {
      return { pinned: true, atBottom: true };
    }

    if (event.type === "restore") {
      return { pinned: event.atBottom, atBottom: event.atBottom };
    }

    const atBottom = event.maxScrollOffset - event.scrollOffset <= NEAR_BOTTOM_THRESHOLD_PX;
    const recentUserInput = event.now - event.lastUserInputAt <= USER_SCROLL_INPUT_WINDOW_MS;
    const scrolledUp = event.scrollDelta < -PIN_SNAP_THRESHOLD_PX;

    let pinned = prev.pinned;
    if (atBottom) {
      pinned = true;
    } else if (scrolledUp && recentUserInput) {
      pinned = false;
    }

    return { pinned, atBottom };
  }

  const nearBottomThresholdPx = event.nearBottomThresholdPx ?? NEAR_BOTTOM_THRESHOLD_PX;
  const userInputWindowMs = event.userInputWindowMs ?? USER_SCROLL_INPUT_WINDOW_MS;
  const distanceFromBottom = event.totalHeight - event.clampedOffset - event.viewportHeight;
  const atBottom = distanceFromBottom <= nearBottomThresholdPx;
  const scrolledUp = event.isScrolling && event.clampedOffset < event.lastObservedScrollOffset;
  const hasRecentUserInput =
    event.isUserPointerDown || event.msSinceUserScrollInput <= userInputWindowMs;

  if (
    prev.pinned &&
    event.isReady &&
    scrolledUp &&
    !atBottom &&
    !event.isProgrammaticScrollActive &&
    hasRecentUserInput
  ) {
    return { pinned: false, atBottom };
  }

  if (!prev.pinned && atBottom && !event.isScrolling) {
    return { pinned: true, atBottom };
  }

  return { pinned: prev.pinned, atBottom };
}

export function shouldAdjustScrollOnItemResize(input: {
  isStreaming: boolean;
  pinnedFollowing: boolean;
  delta: number;
  itemEnd: number;
  scrollOffset: number;
}): boolean {
  return (
    input.isStreaming &&
    !input.pinnedFollowing &&
    input.delta !== 0 &&
    input.itemEnd <= input.scrollOffset
  );
}
